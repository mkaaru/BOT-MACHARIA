import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import DisplayToggle from './display-toggle';
import TradingHubDisplay from './trading-hub-display';
import AdvancedDisplay from './advanced-display';
import './higher-lower-trader.scss';

const HigherLowerTrader = observer(() => {
    const [currentDisplay, setCurrentDisplay] = useState<'trading-hub' | 'advanced'>('trading-hub');

    const handleDisplayChange = (display: 'trading-hub' | 'advanced') => {
        setCurrentDisplay(display);
    };

    return (
        <div className="higher-lower-trader">
            <DisplayToggle 
                currentDisplay={currentDisplay}
                onDisplayChange={handleDisplayChange}
            />
            
            <div className="higher-lower-trader__content">
                {currentDisplay === 'trading-hub' ? (
                    <TradingHubDisplay />
                ) : (
                    <AdvancedDisplay />
                )}
            </div>
        </div>
    );
});

export default HigherLowerTrader;