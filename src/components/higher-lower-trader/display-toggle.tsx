
import React from 'react';
import './display-toggle.scss';

interface DisplayToggleProps {
    currentDisplay: 'trading-hub' | 'advanced';
    onDisplayChange: (display: 'trading-hub' | 'advanced') => void;
}

const DisplayToggle: React.FC<DisplayToggleProps> = ({ currentDisplay, onDisplayChange }) => {
    return (
        <div className="display-toggle">
            <div className="toggle-container">
                <button
                    className={`toggle-button ${currentDisplay === 'trading-hub' ? 'active' : ''}`}
                    onClick={() => onDisplayChange('trading-hub')}
                >
                    <div className="button-content">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                        </svg>
                        <span>Trading Hub</span>
                    </div>
                </button>
                <button
                    className={`toggle-button ${currentDisplay === 'advanced' ? 'active' : ''}`}
                    onClick={() => onDisplayChange('advanced')}
                >
                    <div className="button-content">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                        <span>Advanced</span>
                    </div>
                </button>
            </div>
        </div>
    );
};

export default DisplayToggle;
