import React, { useState, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import './higher-lower-trader.scss';
import TradingHubDisplay from './trading-hub-display';
import ChartToggle from './chart-toggle';

const HigherLowerTrader: React.FC = observer(() => {
    const { ui } = useStore();
    const { is_dark_mode_on } = useThemeSwitcher();
    const [showChart, setShowChart] = useState(true);

    return (
        <div className={`higher-lower-trader ${is_dark_mode_on ? 'dark' : 'light'}`}>
            <div className="higher-lower-trader__header">
                <h2 className="higher-lower-trader__title">Higher/Lower Trader</h2>
                <div className="higher-lower-trader__controls">
                    <ChartToggle
                        showChart={showChart}
                        onToggle={setShowChart}
                    />
                </div>
            </div>

            <div className="higher-lower-trader__content">
                <TradingHubDisplay showChart={showChart} />
            </div>
        </div>
    );
});

export default HigherLowerTrader;