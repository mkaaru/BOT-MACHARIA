import React from 'react';
import { observer } from 'mobx-react-lite';
import './ml-trader.scss';

const MLTrader = observer(() => {
    return (
        <div className="ml-trader">
            <div className="ml-trader__header">
                <h2>ML Trader</h2>
            </div>
            <div className="ml-trader__content">
                {/* Content cleared */}
            </div>
        </div>
    );
});

export default MLTrader;