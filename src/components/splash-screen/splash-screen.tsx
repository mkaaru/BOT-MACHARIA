
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
    const [error, setError] = useState<string | null>(null);

    const messages = [
        'Initializing TradeCortex...',
        'Loading trading interface...',
        'Connecting to markets...',
        'System ready!'
    ];

    useEffect(() => {
        try {
            let messageIndex = 0;
            let charIndex = 0;
            
            const typeMessage = () => {
                try {
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
                } catch (err) {
                    console.error('Error in typeMessage:', err);
                    setError('Animation error occurred');
                }
            };

            // Start typing animation
            setCurrentMessage(messages[0]);
            typeMessage();

            // Progress bar animation
            const progressInterval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 100) {
                        clearInterval(progressInterval);
                        // Auto complete after progress reaches 100%
                        setTimeout(() => {
                            try {
                                onComplete?.();
                            } catch (err) {
                                console.error('Error in onComplete:', err);
                            }
                        }, 500);
                        return 100;
                    }
                    return prev + 2;
                });
            }, 60);

            return () => {
                clearInterval(progressInterval);
            };
        } catch (err) {
            console.error('SplashScreen useEffect error:', err);
            setError('Initialization error occurred');
        }
    }, [onComplete]);

    if (error) {
        return (
            <div style={{ 
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
                fontFamily: 'Arial, sans-serif',
                flexDirection: 'column'
            }}>
                <h2>TradeCortex</h2>
                <p>Loading...</p>
                <button 
                    onClick={() => onComplete?.()} 
                    style={{
                        padding: '10px 20px',
                        marginTop: '20px',
                        background: '#00ff88',
                        border: 'none',
                        borderRadius: '5px',
                        color: '#000',
                        cursor: 'pointer'
                    }}
                >
                    Continue
                </button>
            </div>
        );
    }

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
                    backgroundColor: 'rgba(255,255,255,0.3)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    marginBottom: '20px'
                }}>
                    <div style={{
                        width: `${progress}%`,
                        height: '100%',
                        backgroundColor: '#00ff88',
                        borderRadius: '2px',
                        transition: 'width 0.3s ease'
                    }} />
                </div>

                <div style={{
                    fontSize: '12px',
                    opacity: 0.8
                }}>
                    {progress.toFixed(0)}% Complete
                </div>
            </div>

            <style>{`
                @keyframes blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }
            `}</style>
        </div>
    );
};

export default SplashScreen;
