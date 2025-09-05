
import React from 'react';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import './display-toggle.scss';

interface DisplayToggleProps {
    currentDisplay: 'trading-hub' | 'advanced';
    onDisplayChange: (display: 'trading-hub' | 'advanced') => void;
}

const DisplayToggle: React.FC<DisplayToggleProps> = ({ currentDisplay, onDisplayChange }) => {
    const { is_dark_mode_on } = useThemeSwitcher();

    return (
        <div className={`display-toggle ${is_dark_mode_on ? 'theme--dark' : 'theme--light'}`}>
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
                            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
                        </svg>
                        <span>Advanced Charts</span>
                    </div>
                </button>
            </div>
        </div>
    );
};

export default DisplayToggle;
