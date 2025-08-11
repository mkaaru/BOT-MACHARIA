
import React from 'react';
import './splash-screen.scss';

interface SplashScreenProps {
    onComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    return (
        <div className="splash-screen">
            <div className="splash-content">
                <h1>Loading...</h1>
            </div>
        </div>
    );
};

export default SplashScreen;
