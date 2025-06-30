import React, { useEffect, useState } from 'react';
import './matrix-loading.scss';
import { localize } from '@deriv-com/translations';

interface MatrixLoadingProps {
    message?: string;
    show?: boolean;
}

const MatrixLoading: React.FC<MatrixLoadingProps> = ({ 
    message = localize('Initializing TradeCortex Ai...'), 
    show = true 
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [progress, setProgress] = useState(0);

    const scanningSteps = [
        localize('Initializing TradeCortex Ai...'),
        localize('Connecting to servers...'),
        localize('Scanning market data...'),
        localize('Loading trading engine...'),
        localize('Preparing workspace...')
    ];

    useEffect(() => {
        if (!show) return;

        const stepInterval = setInterval(() => {
            setCurrentStep((prev) => (prev + 1) % scanningSteps.length);
        }, 1000);

        const progressInterval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 100) return 0;
                return prev + 2;
            });
        }, 100);

        return () => {
            clearInterval(stepInterval);
            clearInterval(progressInterval);
        };
    }, [show]);

    const generateMatrixChars = () => {
        const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
        const columns = 50;
        const matrixColumns = [];

        for (let i = 0; i < columns; i++) {
            const columnChars = [];
            const charCount = Math.floor(Math.random() * 20) + 10;

            for (let j = 0; j < charCount; j++) {
                columnChars.push(chars[Math.floor(Math.random() * chars.length)]);
            }

            matrixColumns.push(
                <div 
                    key={i} 
                    className="matrix-column"
                    style={{
                        left: `${(i / columns) * 100}%`,
                        animationDelay: `${Math.random() * 2}s`,
                        animationDuration: `${3 + Math.random() * 2}s`
                    }}
                >
                    {columnChars.join('')}
                </div>
            );
        }

        return matrixColumns;
    };

    if (!show) return null;

    return (
        <div className="matrix-loading">
            <div className='matrix-loading__content'>
                <h1 className='matrix-loading__title'>TradeCortex Ai</h1>
                <div className='matrix-loading__animation'>
                    {Array.from({ length: 100 }, (_, i) => (
                        <span key={i} className='matrix-loading__char'>
                            {String.fromCharCode(Math.floor(Math.random() * 26) + 65)}
                        </span>
                    ))}
                </div>
                <p className='matrix-loading__message'>{message}</p>
            </div>
        </div>
    );
};

export default MatrixLoading;