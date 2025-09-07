
import React, { useState } from 'react';
import './display-toggle.scss';

interface DisplayToggleProps {
    onToggle: (isAdvanced: boolean) => void;
}

const DisplayToggle: React.FC<DisplayToggleProps> = ({ onToggle }) => {
    const [isAdvanced, setIsAdvanced] = useState(false);

    const handleToggle = () => {
        const newState = !isAdvanced;
        setIsAdvanced(newState);
        onToggle(newState);
    };

    return (
        <div className="display-toggle">
            <div className="toggle-container">
                <span className={`toggle-label ${!isAdvanced ? 'active' : ''}`}>
                    Standard
                </span>
                <div 
                    className={`toggle-switch ${isAdvanced ? 'advanced' : ''}`}
                    onClick={handleToggle}
                >
                    <div className="toggle-slider"></div>
                </div>
                <span className={`toggle-label ${isAdvanced ? 'active' : ''}`}>
                    Advanced
                </span>
            </div>
        </div>
    );
};

export default DisplayToggle;
