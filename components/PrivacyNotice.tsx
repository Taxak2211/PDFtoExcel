
import React from 'react';

const PrivacyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 20.417l5.5-5.5a1 1 0 011.414 0l5.5 5.5a12.02 12.02 0 005.618-9.377z" />
    </svg>
);

export const PrivacyNotice: React.FC = () => {
    return (
        <div className="mt-6 sm:mt-8 flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
            <PrivacyIcon />
            <div>
                <p className="text-sm font-semibold text-green-800">Privacy-First Processing</p>
                <p className="text-xs sm:text-sm text-green-700 mt-1">
                    Sensitive data is automatically redacted before AI processing. You'll review and edit before proceeding.
                </p>
            </div>
        </div>
    );
};
