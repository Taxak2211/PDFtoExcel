const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CANDIDATE_MODELS = [
  'qwen/qwen3.8-27b',
];

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

function isRetryableError(err) {
  if (!err) return false;
  const msg = String(err?.message ?? '');
  const code = err?.status ?? err?.code;
  return (
    code === 429 ||
    code === 503 ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('rate_limit') ||
    msg.includes('UNAVAILABLE')
  );
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
      if (!isRetryableError(err) || attempt === maxAttempts) throw err;
      const backoffMs = Math.min(10_000, 800 * 2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

const SYSTEM_PROMPT = `You are an expert financial data extraction assistant. Your task is to accurately extract transaction data from images of a bank or credit card statement.
Analyze the provided images and extract all transactional line items. The images may be from banks in India, Canada, the US, or other regions.

Key requirements:
1. Layout & Terminology Adaptation:
   - Identify columns for Date, Description, Debits (Withdrawals/Dr), Credits (Deposits/Cr), Balance, and Currency.
   - Handle variations in headers (e.g., "Narration", "Particulars" for description; "Value Date" vs "Txn Date").
   - Specific handling for single-column amounts (e.g., credit card statements): positive charges are "debit"; negative amounts (e.g., -$50.00, ($50.00)), "Cr" indicators, refunds, or "PAYMENT RECEIVED" are "credit" (as a positive number) and NOT "debit".
   - Only populate "balance" if a running balance column is explicitly present; do not copy the transaction amount into "balance".

2. Date Standardization:
   - Handle international date formats (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY).
   - Standardize all extracted dates to ISO 8601 format: YYYY-MM-DD.

3. Currency Inference:
   - Infer ISO 4217 currency code (e.g., INR, USD, CAD, GBP, EUR) from symbols or document context. If unknown, omit the field.

4. Data Cleaning:
   - Ignore headers, footers, summary sections, advertisements, and page numbers.
   - Ensure debit, credit, and balance are numbers (omit if not applicable).

5. Description Refinement:
   - Extract only the entity name (Payee/Merchant) and relevant purpose.
   - Remove transaction IDs, reference numbers, "UPI/DR/" prefixes, "WDL TFR", branch codes, and repetitive bank jargon.

6. Categorization:
   - Add a "category" field using one of:
     Bills & Utilities, Car rental, EMI, Entertainment, Fees, Food & Dining, Gas, Groceries, Personal Care, Healthcare, Insurance, Investment, Rent, Shopping, Transportation, Travel, Other.

Output format:
Return ONLY a valid JSON object with a single key "transactions" containing an array of objects, each with:
- "date" (string, YYYY-MM-DD, required)
- "description" (string, required)
- "debit" (number, optional)
- "credit" (number, optional)
- "balance" (number, optional)
- "currency" (string, optional)
- "category" (string, optional)`;

export async function extractTransactionsFromBase64Images(params) {
  const { images, apiKey } = params;

  const BATCH_SIZE = 2;
  const CONCURRENCY = 2;

  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }

  async function extractBatch(batch) {
    const imageParts = batch.map((img) => {
      const str = String(img);
      const url = str.startsWith('data:') ? str : `data:image/jpeg;base64,${str}`;
      return {
        type: 'image_url',
        image_url: { url },
      };
    });

    let lastError;
    const modelErrors = [];

    for (const modelName of CANDIDATE_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new Error(`Model ${modelName} timed out after 50s`)),
        50_000
      );

      try {
        const content = await withRetry(async () => {
          const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'Extract all transactions from these statement page images as a JSON object with a "transactions" array.',
                    },
                    ...imageParts,
                  ],
                },
              ],
              temperature: 0,
              max_completion_tokens: 8192,
              response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            const err = new Error(
              payload?.error?.message || JSON.stringify(payload) || `HTTP ${response.status}`
            );
            err.status = response.status;
            throw err;
          }

          const text = payload?.choices?.[0]?.message?.content;
          if (!text) throw new Error('Empty text response from Groq');
          return text;
        }, 3);

        const parsed = JSON.parse(content.trim());
        const list = Array.isArray(parsed) ? parsed : parsed?.transactions;
        if (!Array.isArray(list)) {
          throw new Error('Groq response did not contain a transactions array');
        }

        return normalizeTransactions(list);
      } catch (err) {
        const msg = err?.message || String(err);
        console.error(`Model ${modelName} failed:`, msg);
        modelErrors.push(`${modelName}: ${msg}`);
        lastError = err;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (lastError) {
      throw new Error(`All Groq models failed -> ${modelErrors.join(' | ')}`);
    }
    return [];
  }

  const batchResults = new Array(batches.length);
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((batch) => extractBatch(batch)));
    for (let j = 0; j < results.length; j++) {
      batchResults[i + j] = results[j];
    }
  }

  return batchResults.flat();
}
