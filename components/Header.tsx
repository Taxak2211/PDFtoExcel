
import React from 'react';

export const Header: React.FC = () => {
    return (
        <header className="text-center p-4 sm:p-6">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">
                PDF Statement Converter
            </h1>
            <p className="mt-2 text-md sm:text-lg text-gray-600">
                Intelligently extract transactions to Excel — securely and instantly.
            </p>
        </header>
    );
};
