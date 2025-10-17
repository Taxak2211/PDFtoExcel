import { GoogleGenAI, Type } from "@google/genai";
import { Transaction } from '../types.ts';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

// Define the expected JSON schema for the transaction data
const transactionSchema = {
    type: Type.OBJECT,
    properties: {
        date: { type: Type.STRING, description: "Transaction date in MM/DD/YYYY or YYYY-MM-DD format." },
        description: { type: Type.STRING, description: "Detailed description of the transaction." },
        debit: { type: Type.NUMBER, description: "The debit amount (money spent)." },
        credit: { type: Type.NUMBER, description: "The credit amount (money received)." },
        balance: { type: Type.NUMBER, description: "The running balance after the transaction." },
        currency: { type: Type.STRING, description: "Currency code for the transaction (ISO 4217, e.g., INR, USD, CAD)." },
        category: { 
            type: Type.STRING, 
            description: "Category of the transaction from the allowed set.",
            enum: [
                'Bills & Utilities', 'Car rental', 'EMI', 'Entertainment', 'Fees', 'Food & Dining', 'Gas', 'Groceries', 'Personal Care', 'Healthcare', 'Insurance', 'Investment', 'Rent', 'Shopping', 'Transportation', 'Travel', 'Other'
            ]
        },
    },
    required: ["date", "description"]
};

const responseSchema = {
    type: Type.ARRAY,
    items: transactionSchema
};


export const extractTransactionsFromImages = async (base64Images: string[]): Promise<Transaction[]> => {
    const imageParts = base64Images.map(img => ({
        inlineData: {
            mimeType: 'image/jpeg',
            data: img.split(',')[1], // Remove the 'data:image/jpeg;base64,' prefix
        },
    }));

    const textPart = {
        text: `
        You are an expert financial data extraction assistant. Your task is to accurately extract transaction data from images of a bank statement.
        Analyze the following images and extract all transactional line items.
        
        - Identify columns for date, description, debits (withdrawals), credits (deposits), balance, and currency.
        - Infer currency when not explicitly labeled. Prefer ISO 4217 codes (e.g., INR, USD, CAD, GBP, EUR). If unknown, omit the field.
        - Ignore headers, footers, summary sections, advertisements, and any non-transactional text.
        - Ensure all monetary values are parsed as numbers. If a value is not present for a transaction (e.g., a debit for a credit transaction), that field can be omitted.
        - Add a "category" field for each transaction by classifying the description into one of the following categories:
          Bills & Utilities, Car rental, EMI, Entertainment, Fees, Food & Dining, Gas, Groceries, Personal Care, Healthcare, Insurance, Investment, Rent, Shopping, Transportation, Travel, Other.
          Choose the best fitting one. If unsure, use "Other".
        - Return the data as a valid JSON array of objects that strictly follows the provided schema.
        `
    };

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [textPart, ...imageParts] },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0,
            },
        });

    const jsonText = response.text.trim();
    const data = JSON.parse(jsonText);
        
        if (!Array.isArray(data)) {
            throw new Error("AI response was not in the expected array format.");
        }
        
        // Basic validation of the returned data structure
        const isValid = data.every(item => typeof item === 'object' && item !== null && 'date' in item && 'description' in item);
        if (!isValid) {
            throw new Error("Some items in the AI response are missing required fields.");
        }

        const allowedCategories = new Set([
            'Bills & Utilities', 'Car rental', 'EMI', 'Entertainment', 'Fees', 'Food & Dining', 'Gas', 'Groceries', 'Personal Care', 'Healthcare', 'Insurance', 'Investment', 'Rent', 'Shopping', 'Transportation', 'Travel', 'Other'
        ]);

        const normalized: Transaction[] = data.map((t: any) => {
            const out: any = { ...t };
            if (out.currency && typeof out.currency === 'string') {
                out.currency = out.currency.trim().toUpperCase();
            }
            if (out.category && typeof out.category === 'string') {
                const cat = out.category.trim();
                // Try exact match first; else try case-insensitive mapping; else Other
                if (!allowedCategories.has(cat)) {
                    const found = Array.from(allowedCategories).find(c => c.toLowerCase() === cat.toLowerCase());
                    out.category = found || 'Other';
                }
            }
            return out as Transaction;
        });

        return normalized;
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to extract data using AI. The document format might be unsupported or the API key may be invalid.");
    }
};