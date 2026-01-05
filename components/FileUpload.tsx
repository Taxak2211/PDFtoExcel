
import React, { useState, useCallback } from 'react';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    disabled: boolean;
}

const FileUploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 sm:w-16 sm:h-16 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);


export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, disabled }) => {
    const [isDragging, setIsDragging] = useState(false);

    const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setIsDragging(true);
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (disabled) return;

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            if (files[0].type === 'application/pdf') {
                onFileSelect(files[0]);
            } else {
                alert("Please upload a valid PDF file.");
            }
        }
    }, [onFileSelect, disabled]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
             if (files[0].type === 'application/pdf') {
                onFileSelect(files[0]);
            } else {
                alert("Please upload a valid PDF file.");
            }
        }
    };
    
    const baseClasses = "relative flex flex-col items-center justify-center w-full min-h-[200px] sm:min-h-[240px] border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200 ease-in-out";
    const disabledClasses = "bg-gray-100 border-gray-300 opacity-60 cursor-not-allowed";
    const enabledClasses = "bg-white border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 active:scale-[0.99]";
    const dragOverClasses = "border-blue-500 bg-blue-50 scale-[1.02]";


    return (
        <div 
            className={`${baseClasses} ${disabled ? disabledClasses : enabledClasses} ${isDragging ? dragOverClasses : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input')?.click()}
        >
            <input
                type="file"
                id="file-input"
                className="hidden"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={disabled}
            />
            <div className="flex flex-col items-center justify-center p-6 text-center">
                <FileUploadIcon />
                <p className="mt-4 text-base font-medium text-gray-700">
                    Upload PDF Statement
                </p>
                <p className="mt-1 text-sm text-gray-500 hidden sm:block">
                    Drag and drop or click to browse
                </p>
                <p className="mt-1 text-sm text-gray-500 sm:hidden">
                    Tap to select file
                </p>
                <div className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                    Choose File
                </div>
            </div>
        </div>
    );
};
