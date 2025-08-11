
import React, { useEffect, useState } from 'react';
import './splash-screen.scss';

export interface SplashScreenProps {
    onComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    console.log('SplashScreen component rendered');
    const [progress, setProgress] = useState(0);
    const [currentMessage, setCurrentMessage] = useState('');
    const [displayedText, setDisplayedText] = useState('');

    const messages = [
        'Initializing TradeCortex...',
        'Loading trading interface...',
        'Connecting to markets...',
        'System ready!'
    ];

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

        // Progress completes in 10 seconds (100 updates every 100ms = 10 seconds)
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
        <div className="splash-screen" style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            zIndex: 10000,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontFamily: 'Arial, sans-serif'
        }}>
            <div style={{
                textAlign: 'center',
                maxWidth: '400px',
                padding: '40px'
            }}>
                <div style={{
                    fontSize: '48px',
                    fontWeight: 'bold',
                    marginBottom: '20px'
                }}>
                    TradeCortex
                </div>
                
                <div style={{
                    fontSize: '16px',
                    marginBottom: '40px',
                    opacity: 0.9
                }}>
                    Advanced Trading Intelligence System
                </div>
                
                <div style={{
                    fontSize: '14px',
                    marginBottom: '30px',
                    minHeight: '20px'
                }}>
                    {displayedText}
                    <span style={{
                        opacity: progress < 100 ? 1 : 0,
                        animation: 'blink 1s infinite'
                    }}>|</span>
                </div>
                
                <div style={{
                    width: '100%',
                    height: '4px',
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    marginBottom: '20px'
                }}>
                    <div style={{
                        width: `${progress}%`,
                        height: '100%',
                        backgroundColor: '#4CAF50',
                        transition: 'width 0.1s ease',
                        borderRadius: '2px'
                    }}></div>
                </div>
                
                <div style={{
                    fontSize: '12px',
                    opacity: 0.8
                }}>
                    {Math.round(progress)}% Complete
                </div>
                
                <div style={{
                    fontSize: '10px',
                    marginTop: '40px',
                    opacity: 0.7
                }}>
                    © 2025 TradeCortex - Secure Trading Platform
                </div>
            </div>
            
            <style dangerouslySetInnerHTML={{
                __html: `
                    @keyframes blink {
                        0%, 50% { opacity: 1; }
                        51%, 100% { opacity: 0; }
                    }
                `
            }} />
        </div>
    );
};

export default SplashScreen;
