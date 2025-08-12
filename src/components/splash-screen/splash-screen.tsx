import React, { useEffect, useState } from 'react';
import './splash-screen.scss';

export interface SplashScreenProps {
    onComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    console.log('SplashScreen component rendered with onComplete:', typeof onComplete);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        console.log('SplashScreen useEffect starting');

        // Simple progress animation
        const interval = setInterval(() => {
            setProgress(prev => {
                const newProgress = prev + 5;
                console.log('Progress updated to:', newProgress);

                if (newProgress >= 100) {
                    clearInterval(interval);
                    setTimeout(() => {
                        console.log('Calling onComplete');
                        onComplete?.();
                    }, 500);
                    return 100;
                }
                return newProgress;
            });
        }, 100);

        return () => {
            clearInterval(interval);
        };
    }, [onComplete]);

    const splashStyle: React.CSSProperties = {
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
    };

    console.log('SplashScreen rendering with progress:', progress);

    return (
        <div style={splashStyle}>
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
                    Loading TradeCortex...
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
        </div>
    );
};

export default SplashScreen;