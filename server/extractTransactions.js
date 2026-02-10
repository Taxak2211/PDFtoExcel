import { GoogleGenAI, Type } from '@google/genai';

const transactionSchema = {
  type: Type.OBJECT,
  properties: {
    date: {
      type: Type.STRING,
      description: 'Transaction date in YYYY-MM-DD format (ISO 8601).',
    },
    description: {
      type: Type.STRING,
      description: 'Detailed description of the transaction.',
    },
    debit: { type: Type.NUMBER, description: 'The debit amount (money spent).' },
    credit: { type: Type.NUMBER, description: 'The credit amount (money received).' },
    balance: {
      type: Type.NUMBER,
      description: 'The running balance after the transaction.',
    },
    currency: {
      type: Type.STRING,
      description: 'Currency code for the transaction (ISO 4217, e.g., INR, USD, CAD).',
    },
    category: {
      type: Type.STRING,
      description: 'Category of the transaction from the allowed set.',
      enum: [
        'Bills & Utilities',
        'Car rental',
        'EMI',
        'Entertainment',
        'Fees',
        'Food & Dining',
        'Gas',
        'Groceries',
        'Personal Care',
        'Healthcare',
        'Insurance',
        'Investment',
        'Rent',
        'Shopping',
        'Transportation',
        'Travel',
        'Other',
      ],
    },
  },
  required: ['date', 'description'],
};

const responseSchema = {
  type: Type.ARRAY,
  items: transactionSchema,
};

const allowedCategories = new Set([
  'Bills & Utilities',
  'Car rental',
  'EMI',
  'Entertainment',
  'Fees',
  'Food & Dining',
  'Gas',
  'Groceries',
  'Personal Care',
  'Healthcare',
  'Insurance',
  'Investment',
  'Rent',
  'Shopping',
  'Transportation',
  'Travel',
  'Other',
]);

function normalizeTransactions(data) {
  return data.map((t) => {
    const out = { ...t };

    if (out.currency && typeof out.currency === 'string') {
      out.currency = out.currency.trim().toUpperCase();
    }

    if (out.category && typeof out.category === 'string') {
      const cat = out.category.trim();
      if (!allowedCategories.has(cat)) {
        const found = Array.from(allowedCategories).find(
          (c) => c.toLowerCase() === cat.toLowerCase()
        );
        out.category = found || 'Other';
      }
    }

    return out;
  });
}

function isRateLimitError(err) {
  if (!err) return false;
  const anyErr = err;
  const msg = String(anyErr?.message ?? '');
  const code = anyErr?.status ?? anyErr?.code;
  return code === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, maxAttempts) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || attempt === maxAttempts) throw err;
      const backoffMs = Math.min(10_000, 800 * 2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export async function extractTransactionsFromBase64Images(params) {
  const { images, apiKey } = params;

  const ai = new GoogleGenAI({ apiKey });

  const textPart = {
    text: `
You are an expert financial data extraction assistant. Your task is to accurately extract transaction data from images of a bank statement.
Analyze the following images and extract all transactional line items. The images may be from banks in **India, Canada, the US, or other regions**.

Key requirements for diverse global format handling:

1. **Layout & Terminology Adaptation:**
   - Identify columns for Date, Description, Debits (Withdrawals/Dr), Credits (Deposits/Cr), Balance, and Currency.
   - Handle variations in headers (e.g., "Narration", "Particulars" for description; "Value Date" vs "Txn Date").
   - Specific handling for single-column amounts: split into credit/debit based on signs (+/-) or "Cr"/"Dr" indicators next to the amount.

2. **Date Standardization:**
   - Handle international date formats (e.g., DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY).
   - **Standardize all extracted dates to ISO 8601 format: YYYY-MM-DD**.
   - Use the document context (e.g., currency symbols, bank address, or clear dates like 30/02) to resolve ambiguities (like 01/02/2024).

3. **Currency Inference:**
   - Infer currency when not explicitly labeled. Prefer ISO 4217 codes (e.g., INR, USD, CAD, GBP, EUR).
   - Look for symbols (₹, $, C$, £) or text clues. If unknown, omit the field.

4. **Data Cleaning:**
   - Ignore headers, footers, summary sections, advertisements, and page numbers.
   - Ensure monetary values are parsed as numbers.

5. **Description Refinement:**
   - **Simplification is Key:** Do NOT return the full raw messy text. Extract only the entity name (Payee/Merchant) and relevant purpose.
   - **Remove:** Transaction IDs, Reference numbers, "UPI/DR/" prefixes, "WDL TFR", branch codes, and repetitive bank jargon.

6. **Categorization:**
   - Add a "category" field for each transaction by classifying the description into one of:
     Bills & Utilities, Car rental, EMI, Entertainment, Fees, Food & Dining, Gas, Groceries, Personal Care, Healthcare, Insurance, Investment, Rent, Shopping, Transportation, Travel, Other.

Return the data as a valid JSON array of objects that strictly follows the provided schema.
`,
  };

  const BATCH_SIZE = 3;
  const CANDIDATE_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];

  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }

  const allTransactions = [];

  for (const batch of batches) {
    const imageParts = batch.map((img) => {
      const data = String(img).includes(',') ? String(img).split(',')[1] : String(img);
      return {
        inlineData: {
          mimeType: 'image/jpeg',
          data,
        },
      };
    });

    let lastError;

    for (const modelName of CANDIDATE_MODELS) {
      try {
        const response = await withRetry(
          () =>
            ai.models.generateContent({
              model: modelName,
              contents: { parts: [textPart, ...imageParts] },
              config: {
                responseMimeType: 'application/json',
                responseSchema,
                temperature: 0,
              },
            }),
          3
        );

        if (!response.text) throw new Error('Empty text response from AI');
        const parsed = JSON.parse(response.text.trim());
        if (!Array.isArray(parsed)) throw new Error('AI response was not an array');

        allTransactions.push(...normalizeTransactions(parsed));
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
  }

  return allTransactions;
}
