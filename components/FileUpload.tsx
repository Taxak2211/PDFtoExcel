
import React, { useState, useCallback } from 'react';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    disabled: boolean;
}

const FileUploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 15v-6m-3 3h6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6" />
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
    
    const baseClasses = "relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ease-in-out";
    const disabledClasses = "bg-gray-200 border-gray-300 opacity-60 cursor-not-allowed";
    const enabledClasses = "bg-white border-gray-300 hover:border-primary hover:bg-gray-50";
    const dragOverClasses = "border-primary bg-blue-50";


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
            <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                <FileUploadIcon />
                <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-gray-500">PDF statement file only</p>
            </div>
        </div>
    );
};
