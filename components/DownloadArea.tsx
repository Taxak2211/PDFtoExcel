import React, { useEffect, useState } from 'react';
import { Transaction } from '../types.ts';

interface DownloadAreaProps {
    fileBlob: Blob;
    fileName: string;
    transactions: Transaction[];
    onReset: () => void;
}

const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

const SuccessIcon = () => (
     <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);


export const DownloadArea: React.FC<DownloadAreaProps> = ({ fileBlob, fileName, transactions, onReset }) => {
    const [showPreview, setShowPreview] = useState(true);
    const [targetOrigin, setTargetOrigin] = useState<string>('*');
    const [isEmbedded, setIsEmbedded] = useState<boolean>(false);

    // Detect embed mode and capture safe postMessage origin
    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const embedded = params.get('embed') === '1';
            setIsEmbedded(embedded);
            const originFromQuery = params.get('targetOrigin');
            if (originFromQuery) setTargetOrigin(originFromQuery);

            const onHandshake = (e: MessageEvent) => {
                if (e?.data?.type === 'EXPENSO_PARENT_HANDSHAKE' && typeof (e as any).data.origin === 'string') {
                    setTargetOrigin((e as any).data.origin);
                }
            };
            window.addEventListener('message', onHandshake);
            return () => window.removeEventListener('message', onHandshake);
        } catch (e) {
            // ignore
        }
    }, []);
    
    // Compute columns in a fixed order but hide any column that has no values at all
    const getAllKeys = (): (keyof Transaction)[] => {
        const order: (keyof Transaction)[] = ['date', 'description', 'category', 'currency', 'debit', 'credit', 'balance'];
        const hasAnyValue = (key: keyof Transaction) => transactions.some(t => {
            const v = t[key] as any;
            if (v === null || v === undefined) return false;
            if (typeof v === 'string') return v.trim().length > 0;
            if (typeof v === 'number') return !Number.isNaN(v);
            return true;
        });
        return order.filter(hasAnyValue);
    };
    
    const columnKeys = getAllKeys();
    
    const handleDownload = () => {
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

        const handleSendToExpenso = () => {
                // Build payload
                const payload = {
                        type: 'TRANSACTIONS_EXTRACTED',
                        transactions: transactions,
                };

                // Prefer popup (opener) if available
                if (window.opener && !window.opener.closed) {
                        try {
                                window.opener.postMessage(payload, targetOrigin || '*');
                                // Close only if we are actually in a popup
                                setTimeout(() => { try { window.close(); } catch {} }, 500);
                                return;
                        } catch (e) {
                                console.error('Failed to postMessage to opener:', e);
                        }
                }

                // Fallback to iframe parent when embedded
                if (window.parent && window.parent !== window) {
                        try {
                                window.parent.postMessage(payload, targetOrigin || '*');
                                return;
                        } catch (e) {
                                console.error('Failed to postMessage to parent:', e);
                        }
                }

                alert('Could not send data to parent window. Please open this as a popup or embed it.');
        };

    return (
        <div className="flex flex-col gap-6">
            {/* Success Message */}
            <div className="flex flex-col items-center justify-center w-full bg-white rounded-lg border-2 border-dashed border-accent p-6 text-center">
                <SuccessIcon />
                <h2 className="mt-4 text-xl font-semibold text-gray-800">Conversion Successful!</h2>
                <p className="text-gray-600">Your Excel file is ready. Preview below or download directly.</p>
            </div>

            {/* Preview Toggle */}
            <div className="flex gap-2 justify-center">
                <button
                    onClick={() => setShowPreview(true)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        showPreview
                            ? 'bg-primary text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Preview Data
                </button>
                <button
                    onClick={() => setShowPreview(false)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        !showPreview
                            ? 'bg-primary text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                    Download
                </button>
            </div>

            {/* Preview Table */}
            {showPreview && (
                <div className="w-full bg-white rounded-lg border border-gray-300 p-4 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-300">
                                {columnKeys.map((key) => (
                                    <th key={key} className="text-left px-4 py-2 font-semibold text-gray-700 bg-gray-100">
                                        {key.charAt(0).toUpperCase() + key.slice(1)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.map((transaction, idx) => (
                                <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                                    {columnKeys.map((key) => (
                                        <td key={`${idx}-${key}`} className="px-4 py-2 text-gray-800">
                                            {transaction[key] !== null && 
                                             transaction[key] !== undefined 
                                                ? String(transaction[key]) 
                                                : ''}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-2 text-sm text-gray-600">
                        Showing {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
                    </p>
                </div>
            )}

            {/* Action Buttons */}
            {!showPreview && (
                <div className="w-full bg-white rounded-lg border border-gray-300 p-4 text-center">
                    <p className="text-gray-600 mb-4">Ready to download your converted Excel file.</p>
                </div>
            )}

                        {/* Download & Reset Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
                <button
                    onClick={handleDownload}
                    className="flex-1 flex items-center justify-center w-full px-4 py-3 font-semibold text-white bg-primary rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-200"
                >
                    <DownloadIcon />
                    Download Excel
                </button>
                <button
                    onClick={handleSendToExpenso}
                    className="flex-1 flex items-center justify-center w-full px-4 py-3 font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200"
                >
                    Import to Expenso
                </button>
                <button
                    onClick={onReset}
                    className="flex-1 w-full px-4 py-3 font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors duration-200"
                >
                    Convert Another
                </button>
            </div>
        </div>
    );
};
