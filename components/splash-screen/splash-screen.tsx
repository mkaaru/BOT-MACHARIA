
import React, { useEffect, useState } from 'react';
import './splash-screen.scss';

export interface SplashScreenProps {
    onComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    console.log('SplashScreen component rendered');
    const [progress, setProgress] = useState(0);
    const [currentMessage, setCurrentMessage] = useState('INITIALIZING TRADING ENGINE');
    const [systemReadiness, setSystemReadiness] = useState(0);

    const messages = [
        'INITIALIZING TRADING ENGINE',
        'LOADING MARKET DATA',
        'CONNECTING TO SERVERS',
        'SYSTEM READY'
    ];

    useEffect(() => {
        let messageIndex = 0;
        
        const messageInterval = setInterval(() => {
            if (messageIndex < messages.length - 1) {
                messageIndex++;
                setCurrentMessage(messages[messageIndex]);
            }
        }, 1500);

        // Progress bar animation
        const progressInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(progressInterval);
                    clearInterval(messageInterval);
                    setCurrentMessage('SYSTEM READY');
                    // Auto complete after progress reaches 100%
                    setTimeout(() => {
                        onComplete?.();
                    }, 1000);
                    return 100;
                }
                return prev + 2;
            });
        }, 60);

        // System readiness animation
        const readinessInterval = setInterval(() => {
            setSystemReadiness(prev => prev >= 100 ? 0 : prev + 2);
        }, 100);

        return () => {
            clearInterval(progressInterval);
            clearInterval(messageInterval);
            clearInterval(readinessInterval);
        };
    }, [onComplete]);

    return (
        <div className="premium-splash-screen">
            <div className="grid-background"></div>
            
            <div className="splash-container">
                {/* Welcome Header */}
                <div className="welcome-header">
                    <div className="welcome-badge">WELCOME TO</div>
                </div>

                {/* Main Title */}
                <div className="main-title">
                    <div className="title-text">TRADE CORTEX</div>
                    <div className="subtitle">Professional Trading Platform</div>
                </div>

                {/* Loading Section */}
                <div className="loading-section">
                    <div className="loading-icon">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="8" stroke="#00D4FF" strokeWidth="2" fill="none" opacity="0.3"/>
                            <circle cx="10" cy="10" r="8" stroke="#00D4FF" strokeWidth="2" fill="none"
                                strokeDasharray="50" strokeDashoffset={50 - (progress / 2)}
                                style={{ transform: 'rotate(-90deg)', transformOrigin: '10px 10px' }}/>
                        </svg>
                    </div>
                    <div className="loading-text">{currentMessage}</div>
                </div>

                {/* System Readiness */}
                <div className="system-status">
                    <div className="status-label">SYSTEM READINESS</div>
                    <div className="status-bar">
                        <div className="status-progress" style={{ width: `${systemReadiness}%` }}></div>
                    </div>
                    <div className="status-percentage">{Math.round(systemReadiness)}%</div>
                </div>

                {/* Feature Icons */}
                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M3 13l4-4 4 4 7-7" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="m21 6-7 7-4-4-4 4" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="feature-title">Real-time</div>
                        <div className="feature-subtitle">Fast Execution</div>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="#00D4FF" strokeWidth="2"/>
                                <circle cx="9" cy="7" r="4" stroke="#00D4FF" strokeWidth="2"/>
                                <path d="m22 21-3-3m1.5-5.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z" stroke="#00D4FF" strokeWidth="2"/>
                            </svg>
                        </div>
                        <div className="feature-title">Community</div>
                        <div className="feature-subtitle">Social trading</div>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="feature-title">Fast</div>
                        <div className="feature-subtitle">Low latency</div>
                    </div>

                    <div className="feature-card">
                        <div className="feature-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="feature-title">Secure</div>
                        <div className="feature-subtitle">Encrypted</div>
                    </div>
                </div>

                {/* Secure Connection Button */}
                <div className="connection-button">
                    <div className="connection-text">SECURE CONNECTION</div>
                </div>
            </div>
        </div>
    );
};

export default SplashScreen;
