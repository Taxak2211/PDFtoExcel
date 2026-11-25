import { Transaction } from '../types.ts';


const CLIENT_BATCH_SIZE = 2;
const CLIENT_CONCURRENCY = 3;

async function extractBatch(images: string[]): Promise<Transaction[]> {
    const response = await fetch('/api/extract-transactions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ images }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        const message = payload?.error || `Request failed (${response.status})`;
        throw new Error(message);
    }

    const transactions = payload?.transactions;
    if (!Array.isArray(transactions)) {
        throw new Error('Invalid server response.');
    }

    return transactions as Transaction[];
}

export const extractTransactionsFromImages = async (base64Images: string[]): Promise<Transaction[]> => {
    try {
        const batches: string[][] = [];
        for (let i = 0; i < base64Images.length; i += CLIENT_BATCH_SIZE) {
            batches.push(base64Images.slice(i, i + CLIENT_BATCH_SIZE));
        }

        const results: Transaction[][] = new Array(batches.length);
        for (let i = 0; i < batches.length; i += CLIENT_CONCURRENCY) {
            const chunk = batches.slice(i, i + CLIENT_CONCURRENCY);
            const chunkResults = await Promise.all(chunk.map((batch) => extractBatch(batch)));
            for (let j = 0; j < chunkResults.length; j++) {
                results[i + j] = chunkResults[j];
            }
        }

        return results.flat();
    } catch (error) {
        console.error("Error extracting transactions:", error);
        throw error;
    }
};