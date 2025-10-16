import React, { useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { extractTransactionsFromImages } from './services/geminiService.ts';
import { Transaction } from './types.ts';
import { FileUpload } from './components/FileUpload.tsx';
import { ProcessingIndicator } from './components/ProcessingIndicator.tsx';
import { Header } from './components/Header.tsx';
import { PrivacyNotice } from './components/PrivacyNotice.tsx';
import { DownloadArea } from './components/DownloadArea.tsx';

interface ProcessedFile {
    blob: Blob;
    fileName: string;
    transactions: Transaction[];
}

const App: React.FC = () => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStep, setProcessingStep] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [processedFile, setProcessedFile] = useState<ProcessedFile | null>(null);


    useEffect(() => {
        // Set the worker source for pdf.js
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    }, []);

    const convertPdfToImages = async (file: File, password?: string): Promise<string[]> => {
        setProcessingStep('Reading PDF file...');
        const fileReader = new FileReader();

        return new Promise((resolve, reject) => {
            fileReader.onload = async (event) => {
                if (!event.target?.result) {
                    return reject(new Error("Failed to read file."));
                }

                try {
                    const typedarray = new Uint8Array(event.target.result as ArrayBuffer);
                    const pdfOptions: any = { data: typedarray };
                    
                    // Add password if provided
                    if (password) {
                        pdfOptions.password = password;
                    }
                    
                    const pdf = await pdfjsLib.getDocument(pdfOptions).promise;
                    const imagePromises: Promise<string>[] = [];
                    const canvas = document.createElement("canvas");

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: 1.5 });
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        const context = canvas.getContext("2d");

                        if (!context) {
                           return reject(new Error("Could not get canvas context."));
                        }

                        await page.render({ canvasContext: context, viewport, canvas }).promise;
                        imagePromises.push(Promise.resolve(canvas.toDataURL("image/jpeg")));
                    }
                    
                    const images = await Promise.all(imagePromises);
                    canvas.remove();
                    resolve(images);

                } catch (err: any) {
                    console.error("Error processing PDF:", err);
                    
                    // Check if it's a password error
                    if (err.message && err.message.includes('password')) {
                        reject(new Error("PDF_PASSWORD_REQUIRED"));
                    } else {
                        reject(new Error("Could not process the PDF. It may be corrupted."));
                    }
                }
            };
            fileReader.onerror = () => reject(new Error("Error reading file."));
            fileReader.readAsArrayBuffer(file);
        });
    };
    
    const generateExcel = (data: Transaction[], fileName: string): ProcessedFile => {
        setProcessingStep('Creating Excel file...');
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
        
        // Auto-fit columns
        const cols = Object.keys(data[0] || {});
        if (cols.length > 0) {
            const colWidths = cols.map(col => ({
                wch: Math.max(...data.map(item => item[col as keyof Transaction]?.toString().length ?? 0), col.length) + 2
            }));
            worksheet['!cols'] = colWidths;
        }
        
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const finalFileName = `${fileName.replace(/\.pdf$/i, '')}_statement.xlsx`;
        
        return { blob, fileName: finalFileName, transactions: data };
    };

    const handleFileSelect = useCallback(async (file: File) => {
        setIsProcessing(true);
        setError(null);
        setProcessedFile(null);
        setProcessingStep('Starting conversion...');

        try {
            let images: string[] = [];
            try {
                images = await convertPdfToImages(file);
            } catch (err: any) {
                // If password is required, prompt user
                if (err.message === "PDF_PASSWORD_REQUIRED") {
                    const password = prompt("This PDF is password-protected. Please enter the password:");
                    if (password === null) {
                        throw new Error("Password required but not provided.");
                    }
                    images = await convertPdfToImages(file, password);
                } else {
                    throw err;
                }
            }

            setProcessingStep('Analyzing statement with AI...');
            const transactions = await extractTransactionsFromImages(images);

            if (transactions.length === 0) {
                throw new Error("No transactions could be extracted. Please check the PDF content.");
            }

            const fileData = generateExcel(transactions, file.name);
            setProcessedFile(fileData);

        } catch (err: any) {
            setError(err.message || 'An unknown error occurred.');
        } finally {
            setIsProcessing(false);
            setProcessingStep('');
        }
    }, []);

    const handleReset = useCallback(() => {
        setError(null);
        setProcessedFile(null);
    }, []);
    
    const renderContent = () => {
        if (isProcessing) {
            return <ProcessingIndicator step={processingStep} />;
        }
        if (processedFile) {
            return <DownloadArea fileBlob={processedFile.blob} fileName={processedFile.fileName} transactions={processedFile.transactions} onReset={handleReset} />;
        }
        return <FileUpload onFileSelect={handleFileSelect} disabled={isProcessing} />;
    };


    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 font-sans">
            <main className="w-full max-w-2xl mx-auto bg-gray-50 p-6 sm:p-8 rounded-xl shadow-lg">
                <Header />
                <div className="mt-8">
                    {renderContent()}
                </div>
                {error && !processedFile && (
                    <div className="mt-4 text-center p-3 bg-red-100 border border-red-300 text-red-800 rounded-lg">
                        <p><span className="font-bold">Error:</span> {error}</p>
                    </div>
                )}
                <PrivacyNotice />
            </main>
            <footer className="text-center mt-6 text-gray-500 text-sm">
                <p>&copy; {new Date().getFullYear()} Secure Statement Converter. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default App;