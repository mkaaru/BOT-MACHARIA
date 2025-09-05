
import React from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import DisplayToggle from './display-toggle';
import './smart-trading-display.scss';

const SmartTradingDisplay: React.FC = observer(() => {
    const { run_panel } = useStore();
    const { is_drawer_open } = run_panel;

    return (
        <div className={classNames('smart-trading-display', {
            'smart-trading-display--run-panel-open': is_drawer_open
        })}>
            <DisplayToggle />
        </div>
    );
});

export default SmartTradingDisplay;
