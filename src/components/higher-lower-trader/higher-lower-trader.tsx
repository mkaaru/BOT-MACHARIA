import React from 'react';
import { observer } from 'mobx-react-lite';
import './higher-lower-trader.scss';

const HigherLowerTrader = observer(() => {
    return (
        <div className="higher-lower-trader">
            <div className="higher-lower-trader__header">
                <h2>Higher Lower Trader</h2>
            </div>
            <div className="higher-lower-trader__content">
                {/* Content cleared */}
            </div>
        </div>
    );
});

export default HigherLowerTrader;