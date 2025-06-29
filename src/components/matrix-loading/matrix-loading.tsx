
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
    const [showInterruption, setShowInterruption] = useState(false);

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

        // Simulate interruption randomly between 30-70% progress
        const interruptAt = 30 + Math.random() * 40;
        let interrupted = false;

        const interval = setInterval(() => {
            setProgress(prev => {
                const newProgress = prev + 12.5; // 8 steps * 12.5 = 100%
                
                // Check for interruption
                if (newProgress >= interruptAt && !interrupted && Math.random() < 0.3) {
                    interrupted = true;
                    setShowInterruption(true);
                    return prev; // Stop progress
                }
                
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

    const handleRefresh = () => {
        setShowInterruption(false);
        setProgress(0);
        setScanningText('INITIALIZING MARKET SCANNER...');
        // Continue with normal loading
        const interval = setInterval(() => {
            setProgress(prev => {
                const newProgress = prev + 25; // Faster completion after refresh
                
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
        }, 312); // Faster intervals
    };

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
            
            {showInterruption && (
                <div className="interruption-modal">
                    <div className="interruption-content">
                        <div className="interruption-icon">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="#ff4444" strokeWidth="2"/>
                                <path d="M12 8v4m0 4h.01" stroke="#ff4444" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                        </div>
                        <h2>Sorry for the interruption</h2>
                        <button onClick={handleRefresh} className="refresh-button">
                            Refresh
                        </button>
                    </div>
                </div>
            )}
            
            <div className={`matrix-loading-content ${showInterruption ? 'blurred' : ''}`}>
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
