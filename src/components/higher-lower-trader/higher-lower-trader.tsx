
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import './higher-lower-trader.scss';

const HigherLowerTrader: React.FC = observer(() => {
    const { ui } = useStore();
    const { is_dark_mode_on } = useThemeSwitcher();

    return (
        <div className={`higher-lower-trader ${is_dark_mode_on ? 'dark' : 'light'}`}>
            <div className="higher-lower-trader__header">
                <h2 className="higher-lower-trader__title">Higher/Lower Trader</h2>
            </div>

            <div className="higher-lower-trader__content">
                <div className="higher-lower-trader__empty">
                    <p>Ready for trading implementation</p>
                </div>
            </div>
        </div>
    );
});

export default HigherLowerTrader;
