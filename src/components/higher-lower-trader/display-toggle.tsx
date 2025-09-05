
import React, { useState } from 'react';
import TradingHubDisplay from './trading-hub-display';
import AdvancedDisplay from './advanced-display';
import './display-toggle.scss';

const DisplayToggle = () => {
    const [activeDisplay, setActiveDisplay] = useState('trading'); // 'trading' or 'advanced'

    return (
        <div className='display-container'>
            <div className='display-toggle'>
                <button
                    className={`display-toggle__button ${activeDisplay === 'trading' ? 'active' : ''}`}
                    onClick={() => setActiveDisplay('trading')}
                >
                    Trading Hub
                </button>
                <button
                    className={`display-toggle__button ${activeDisplay === 'advanced' ? 'active' : ''}`}
                    onClick={() => setActiveDisplay('advanced')}
                >
                    Advanced
                </button>
            </div>
            <div className='display-content'>
                {activeDisplay === 'trading' ? <TradingHubDisplay /> : <AdvancedDisplay />}
            </div>
        </div>
    );
};

export default DisplayToggle;
