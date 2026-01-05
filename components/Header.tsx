
import React from 'react';

export const Header: React.FC = () => {
    return (
        <header className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-blue-100 rounded-2xl mb-4">
                <svg className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
                PDF Statement Converter
            </h1>
            <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-sm mx-auto">
                Extract transactions from bank statements to Excel — securely and instantly
            </p>
        </header>
    );
};
