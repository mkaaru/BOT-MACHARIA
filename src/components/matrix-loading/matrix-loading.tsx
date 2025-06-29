
import React, { useEffect, useState } from 'react';
import './matrix-loading.scss';

interface MatrixLoadingProps {
    isVisible: boolean;
    onComplete: () => void;
}

const MatrixLoading: React.FC<MatrixLoadingProps> = ({ isVisible, onComplete }) => {
    const [scanningText, setScanningText] = useState('INITIALIZING MARKET SCANNER...');
    const [progress, setProgress] = useState(0);
    const [matrixChars, setMatrixChars] = useState<string[]>([]);

    const scanningMessages = [
        'INITIALIZING MARKET SCANNER...',
        'ANALYZING VOLATILITY PATTERNS...',
        'SCANNING MARKET TRENDS...',
        'DETECTING SIGNAL STRENGTH...',
        'CALIBRATING AI ALGORITHMS...',
        'OPTIMIZING TRADING PARAMETERS...',
        'ESTABLISHING SECURE CONNECTION...',
        'SYSTEM READY - LAUNCHING TRADECORTEX...'
    ];

    useEffect(() => {
        if (!isVisible) return;

        // Generate random matrix characters
        const chars = [];
        for (let i = 0; i < 200; i++) {
            chars.push(String.fromCharCode(0x30A0 + Math.random() * 96));
        }
        setMatrixChars(chars);

        const interval = setInterval(() => {
            setProgress(prev => {
                const newProgress = prev + 12.5; // 8 steps * 12.5 = 100%
                
                if (newProgress <= 100) {
                    const messageIndex = Math.floor((newProgress / 100) * scanningMessages.length);
                    if (messageIndex < scanningMessages.length) {
                        setScanningText(scanningMessages[messageIndex]);
                    }
                }

                if (newProgress >= 100) {
                    setTimeout(onComplete, 500);
                    return 100;
                }
                
                return newProgress;
            });
        }, 625); // 5 seconds total / 8 steps

        return () => clearInterval(interval);
    }, [isVisible, onComplete]);

    if (!isVisible) return null;

    return (
        <div className="matrix-loading-overlay">
            <div className="matrix-background">
                {matrixChars.map((char, index) => (
                    <span
                        key={index}
                        className="matrix-char"
                        style={{
                            left: `${(index % 20) * 5}%`,
                            animationDelay: `${Math.random() * 2}s`,
                            animationDuration: `${2 + Math.random() * 3}s`
                        }}
                    >
                        {char}
                    </span>
                ))}
            </div>
            
            <div className="matrix-loading-content">
                <div className="matrix-logo">
                    <h1>TRADECORTEX</h1>
                    <div className="logo-underline"></div>
                </div>
                
                <div className="scanning-section">
                    <div className="scanning-grid">
                        {Array.from({ length: 12 }, (_, i) => (
                            <div
                                key={i}
                                className={`scanning-cell ${progress > (i * 8.33) ? 'active' : ''}`}
                            />
                        ))}
                    </div>
                    
                    <div className="scanning-text">
                        <span className="scanning-label">{scanningText}</span>
                        <div className="progress-bar">
                            <div 
                                className="progress-fill"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <span className="progress-text">{Math.floor(progress)}% COMPLETE</span>
                    </div>
                </div>

                <div className="market-data">
                    <div className="data-stream">
                        <span>VOLATILITY_10: ANALYZING...</span>
                        <span>VOLATILITY_25: OPTIMIZING...</span>
                        <span>VOLATILITY_50: CALIBRATING...</span>
                        <span>VOLATILITY_75: READY</span>
                        <span>VOLATILITY_100: SCANNING...</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MatrixLoading;
