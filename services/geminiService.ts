import { GoogleGenAI, Type } from "@google/genai";
import { Transaction } from '../types.ts';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

// Define the expected JSON schema for the transaction data
const transactionSchema = {
    type: Type.OBJECT,
    properties: {
        date: { type: Type.STRING, description: "Transaction date in YYYY-MM-DD format (ISO 8601)." },
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
    // Process images in parallel batches (e.g. 5 pages at a time) to speed up extraction
    const BATCH_SIZE = 5;
    const batches: string[][] = [];
    for (let i = 0; i < base64Images.length; i += BATCH_SIZE) {
        batches.push(base64Images.slice(i, i + BATCH_SIZE));
    }

    // Define the prompt logic once
    const generateForBatch = async (batchImages: string[]): Promise<Transaction[]> => {
        const imageParts = batchImages.map(img => ({
            inlineData: {
                mimeType: 'image/jpeg',
                data: img.split(',')[1],
            },
        }));

        const textPart = {
            text: `
            You are an expert financial data extraction assistant. Your task is to accurately extract transaction data from images of a bank statement.
            Analyze the following images and extract all transactional line items. The images may be from banks in **India, Canada, the US, or other regions**.

            Key requirements for diverse global format handling:
            
            1. **Layout & Terminology Adaptation:**
               - Identify columns for Date, Description, Debits (Withdrawals/Dr), Credits (Deposits/Cr), Balance, and Currency.
               - Handle variations in headers (e.g., "Narration", "Particulars" for description; "Value Date" vs "Txn Date").
               - specific handling for single-column amounts: split into credit/debit based on signs (+/-) or "Cr"/"Dr" indicators next to the amount.

            2. **Date Standardization:**
               - Handle international date formats (e.g., DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY).
               - **Standardize all extracted dates to ISO 8601 format: YYYY-MM-DD**.
               - Use the document context (e.g., currency symbols, bank address, or clear dates like 30/02) to resolve ambiguities (like 01/02/2024).
                 - E.g., if Currency is INR, date is likely DD/MM/YYYY. If USD, check for patterns.

            3. **Currency Inference:**
               - Infer currency when not explicitly labeled. Prefer ISO 4217 codes (e.g., INR, USD, CAD, GBP, EUR).
               - Look for symbols (₹, $, C$, £) or text clues. If unknown, omit the field.

            4. **Data Cleaning:**
               - Ignore headers, footers, summary sections, advertisements, and page numbers.
               - Ensure monetary values are parsed as numbers.

            5. **Categorization:**
               - Add a "category" field for each transaction by classifying the description into one of:
                 Bills & Utilities, Car rental, EMI, Entertainment, Fees, Food & Dining, Gas, Groceries, Personal Care, Healthcare, Insurance, Investment, Rent, Shopping, Transportation, Travel, Other.

            Return the data as a valid JSON array of objects that strictly follows the provided schema.
            `
        };

        const CANDIDATE_MODELS = [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.5-pro'
        ];

        let lastError: any;

        for (const modelName of CANDIDATE_MODELS) {
            try {
                console.log(`Attempting transaction extraction with model: ${modelName}`);
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: { parts: [textPart, ...imageParts] },
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: responseSchema,
                        temperature: 0,
                    },
                });
        
                if(!response.text) {
                     throw new Error("Empty text response from AI");
                }

                const jsonText = response.text.trim();
                let data;
                try {
                    data = JSON.parse(jsonText);
                } catch (e) {
                     // If JSON parse fails, throw to trigger fallback to next model
                    throw new Error("AI response was not valid JSON.");
                }
                
                if (!Array.isArray(data)) {
                    throw new Error("AI response was not in the expected array format.");
                }
        
                // Model success - Normalize data and return
                const allowedCategories = new Set([
                    'Bills & Utilities', 'Car rental', 'EMI', 'Entertainment', 'Fees', 'Food & Dining', 'Gas', 'Groceries', 'Personal Care', 'Healthcare', 'Insurance', 'Investment', 'Rent', 'Shopping', 'Transportation', 'Travel', 'Other'
                ]);
        
                return data.map((t: any) => {
                    const out: any = { ...t };
                    if (out.currency && typeof out.currency === 'string') {
                        out.currency = out.currency.trim().toUpperCase();
                    }
                    if (out.category && typeof out.category === 'string') {
                        const cat = out.category.trim();
                        if (!allowedCategories.has(cat)) {
                            const found = Array.from(allowedCategories).find(c => c.toLowerCase() === cat.toLowerCase());
                            out.category = found || 'Other';
                        }
                    }
                    return out as Transaction;
                });
            } catch (error) {
                console.warn(`Model ${modelName} failed transaction extraction:`, error);
                lastError = error;
                // Continue to next model in loop
            }
        }
        
        // If we exit the loop, all models failed
        throw lastError || new Error("All AI models failed to extract data.");
    };

    try {
        // Run all batches in parallel
        const results = await Promise.all(batches.map(generateForBatch));
        return results.flat();
    } catch (error) {
        console.error("Error extracting transactions:", error);
        throw error;
    }
};