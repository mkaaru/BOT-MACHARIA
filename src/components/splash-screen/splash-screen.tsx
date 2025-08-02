
import React, { useEffect, useState } from 'react';
import './splash-screen.scss';

interface SplashScreenProps {
    onComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    const [progress, setProgress] = useState(0);
    const [currentMessage, setCurrentMessage] = useState('Initializing your account...');

    const messages = [
        'Initializing your account...',
        'Loading trading strategies...',
        'Connecting to markets...',
        'Optimizing performance for the best trading experience'
    ];

    useEffect(() => {
        const progressInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(progressInterval);
                    setTimeout(() => onComplete?.(), 500);
                    return 100;
                }
                return prev + 2;
            });
        }, 50);

        const messageInterval = setInterval(() => {
            setCurrentMessage(messages[Math.floor(Math.random() * messages.length)]);
        }, 1500);

        return () => {
            clearInterval(progressInterval);
            clearInterval(messageInterval);
        };
    }, [onComplete]);

    return (
        <div className="splash-screen">
            <div className="splash-content">
                <div className="logo-container">
                    <div className="logo-avatar">
                        <img src="/deriv-logo.png" alt="Trade Cortex" className="logo-image" />
                    </div>
                </div>
                
                <div className="brand-section">
                    <h1 className="brand-title">
                        Trade<span className="brand-highlight">Cortex</span>
                    </h1>
                    <p className="brand-subtitle">by The Binary Blueprint</p>
                </div>

                <div className="progress-section">
                    <div className="progress-bar">
                        <div 
                            className="progress-fill" 
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="progress-percentage">{Math.round(progress)}%</div>
                </div>

                <div className="status-section">
                    <div className="status-message">{currentMessage}</div>
                    <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>

                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-icon">⚡</div>
                        <div className="feature-text">Lightning Fast</div>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">🎯</div>
                        <div className="feature-text">Precise Trading</div>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">🚀</div>
                        <div className="feature-text">Advanced Strategies</div>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">📊</div>
                        <div className="feature-text">Real-time Analytics</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SplashScreen;
