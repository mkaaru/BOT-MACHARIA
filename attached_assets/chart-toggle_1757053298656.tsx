import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import SmartTradingDisplay from './smart-trading-display';
import SpeedBotDisplay from './speed-bot-display';
import './chart-toggle.scss';

const ChartToggle = observer(({ children }) => {
    const [activeDisplay, setActiveDisplay] = useState('smart-trading'); // Changed default to 'smart-trading'
    const { dashboard, run_panel } = useStore();

    // Use run_panel store to check if drawer is open
    const { is_drawer_open } = run_panel;

    return (
        <div className={`chart-display-container ${is_drawer_open ? 'run-panel-active' : ''}`}>
            <div className='chart-display-toggle'>
                {/* Reordered buttons - Smart Trading first */}
                <button
                    className={`chart-display-toggle__button ${activeDisplay === 'smart-trading' ? 'active' : ''}`}
                    onClick={() => setActiveDisplay('smart-trading')}
                >
                    Smart Trading
                </button>
                <button
                    className={`chart-display-toggle__button ${activeDisplay === 'speed-bot' ? 'active' : ''}`}
                    onClick={() => setActiveDisplay('speed-bot')}
                >
                    Speed Bot
                </button>
                <button
                    className={`chart-display-toggle__button ${activeDisplay === 'charts' ? 'active' : ''}`}
                    onClick={() => setActiveDisplay('charts')}
                >
                    Charts
                </button>
            </div>
            <div className='chart-display-content'>
                {activeDisplay === 'charts' ? (
                    children
                ) : activeDisplay === 'speed-bot' ? (
                    <SpeedBotDisplay />
                ) : (
                    <SmartTradingDisplay />
                )}
            </div>
        </div>
    );
});

export default ChartToggle;
