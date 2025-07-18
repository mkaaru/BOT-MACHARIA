import React, { useEffect, useState } from 'react';
import './matrix-loading.scss';

interface MatrixLoadingProps {
    message?: string;
    show?: boolean;
}

const MatrixLoading: React.FC<MatrixLoadingProps> = ({ 
    message = 'Initializing Deriv Bot...', 
    show = true 
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [progress, setProgress] = useState(0);

    const scanningSteps = [
        'Initializing Deriv Bot...',
        'Connecting to servers...',
        'Scanning market data...',
        'Loading trading engine...',
        'Preparing workspace...'
    ];

    useEffect(() => {
        if (!show) return;

        console.log(`🔄 Matrix Loading started: ${message}`);

        const stepInterval = setInterval(() => {
            setCurrentStep((prev) => (prev + 1) % scanningSteps.length);
        }, 1000);

        const progressInterval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 100) return 0;
                return prev + 2;
            });
        }, 100);

        // Timeout after 30 seconds
        const timeout = setTimeout(() => {
            console.error('❌ Matrix loading timeout - forcing hide');
            clearInterval(stepInterval);
            clearInterval(progressInterval);
        }, 30000);

        return () => {
            clearInterval(stepInterval);
            clearInterval(progressInterval);
            clearTimeout(timeout);
        };
    }, [show, message]);

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
            <div className="matrix-rain">
                {generateMatrixChars()}
            </div>

            <div className="loading-content">
                <div className="scanning-text">
                    TradeCortex AI
                </div>

                <div className="scanning-lines">
                    {scanningSteps.map((step, index) => (
                        <div 
                            key={index}
                            className={`scan-line ${index === currentStep ? 'active' : ''}`}
                        >
                            {index === currentStep && '> '}{step}
                        </div>
                    ))}
                </div>

                <div className="progress-bar">
                    <div 
                        className="progress-fill" 
                        style={{ width: `${progress}%` }}
                    />
                </div>

                <div className="status-text">
                    System Status: ACTIVE • Scanning Markets...
                </div>
            </div>
        </div>
    );
};

export default MatrixLoading;