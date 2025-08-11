
import React, { useEffect, useState } from 'react';
import './splash-screen.scss';

interface SplashScreenProps {
    onComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    console.log('SplashScreen component rendered');
    const [progress, setProgress] = useState(0);
    const [currentMessage, setCurrentMessage] = useState('');
    const [displayedText, setDisplayedText] = useState('');
    const [matrixChars, setMatrixChars] = useState<string[]>([]);

    const messages = [
        '> Connecting to trading servers...',
        '> Loading market data streams...',
        '> Initializing trading algorithms...',
        '> Analyzing market conditions...',
        '> Preparing trading interface...',
        '> System ready - Welcome to TradeCortex!'
    ];

    // Generate random matrix characters
    useEffect(() => {
        const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
        const matrix: string[] = [];
        for (let i = 0; i < 2000; i++) {
            matrix.push(chars.charAt(Math.floor(Math.random() * chars.length)));
        }
        setMatrixChars(matrix);
    }, []);

    useEffect(() => {
        let messageIndex = 0;
        let charIndex = 0;
        
        const typeMessage = () => {
            if (messageIndex < messages.length) {
                const currentMsg = messages[messageIndex];
                if (charIndex < currentMsg.length) {
                    setDisplayedText(currentMsg.substring(0, charIndex + 1));
                    charIndex++;
                    setTimeout(typeMessage, 50);
                } else {
                    setTimeout(() => {
                        messageIndex++;
                        charIndex = 0;
                        if (messageIndex < messages.length) {
                            setCurrentMessage(messages[messageIndex]);
                            typeMessage();
                        }
                    }, 1000);
                }
            }
        };

        setTimeout(() => {
            setCurrentMessage(messages[0]);
            typeMessage();
        }, 500);

        const progressInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(progressInterval);
                    setTimeout(() => onComplete?.(), 500);
                    return 100;
                }
                return prev + 1;
            });
        }, 100);

        return () => {
            clearInterval(progressInterval);
        };
    }, [onComplete]);

    return (
        <div className="splash-screen terminal-style" style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            zIndex: 10000,
            background: '#000000'
        }}>
            <div className="matrix-background">
                {matrixChars.map((char, index) => (
                    <span 
                        key={index} 
                        className="matrix-char" 
                        style={{
                            left: `${(index % 40) * 2.5}%`,
                            top: `${Math.floor(index / 40) * 20}px`,
                            animationDelay: `${Math.random() * 3}s`
                        }}
                    >
                        {char}
                    </span>
                ))}
            </div>
            
            <div className="terminal-container">
                <div className="terminal-header">
                    <div className="terminal-title">TradeCortex AI</div>
                    <div className="terminal-subtitle">Advanced Trading Intelligence System</div>
                </div>
                
                <div className="terminal-content">
                    <div className="boot-sequence">
                        <div className="boot-line">
                            <span className="prompt">$</span> 
                            <span className="command">initialize_trading_system.sh</span>
                        </div>
                        <div className="boot-line">
                            <span className="status-text">System initialization started...</span>
                        </div>
                        <div className="boot-line">
                            <span className="status-text">Loading core modules: [OK]</span>
                        </div>
                        <div className="boot-line">
                            <span className="status-text">Establishing market connection: [OK]</span>
                        </div>
                    </div>
                    
                    <div className="current-status">
                        <div className="status-line">
                            <span className="status-indicator">►</span>
                            <span className="typing-text">{displayedText}</span>
                            <span className="cursor">_</span>
                        </div>
                    </div>
                    
                    <div className="progress-section">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                        <div className="progress-text">
                            Loading... {Math.round(progress)}%
                        </div>
                    </div>
                    
                    <div className="system-info">
                        <div className="info-line">
                            <span className="label">Version:</span>
                            <span className="value">2.1.0-BETA</span>
                        </div>
                        <div className="info-line">
                            <span className="label">Build:</span>
                            <span className="value">TC-{new Date().getFullYear()}.{String(new Date().getMonth() + 1).padStart(2, '0')}</span>
                        </div>
                        <div className="info-line">
                            <span className="label">Status:</span>
                            <span className="value success">ONLINE</span>
                        </div>
                    </div>
                </div>
                
                <div className="terminal-footer">
                    <div className="copyright">© 2025 TradeCortex - Secure Trading Platform</div>
                </div>
            </div>
        </div>
    );
};

export default SplashScreen;
