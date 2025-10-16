
import React from 'react';

interface ProcessingIndicatorProps {
    step: string;
}

export const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({ step }) => {
    return (
        <div className="flex flex-col items-center justify-center w-full h-64 bg-white rounded-lg border-2 border-dashed border-gray-300">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-lg font-semibold text-gray-700">{step}</p>
            <p className="text-sm text-gray-500">Please wait, this may take a moment...</p>
        </div>
    );
};
