import { Transaction } from '../types.ts';


export const extractTransactionsFromImages = async (base64Images: string[]): Promise<Transaction[]> => {
    try {
        const response = await fetch('/api/extract-transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ images: base64Images }),
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
    } catch (error) {
        console.error("Error extracting transactions:", error);
        throw error;
    }
};