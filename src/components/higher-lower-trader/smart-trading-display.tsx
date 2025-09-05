import React from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './smart-trading-display.scss';

const SmartTradingDisplay: React.FC = observer(() => {
    const { run_panel } = useStore();
    const { is_drawer_open } = run_panel;

    return (
        <div className={classNames('smart-trading-display', {
            'smart-trading-display--run-panel-open': is_drawer_open
        })}>
            <div className="smart-trading-placeholder">
                <h2>{localize('Smart Trading')}</h2>
                <p>{localize('Content cleared - ready for new implementation')}</p>
            </div>
        </div>
    );
});

export default SmartTradingDisplay;