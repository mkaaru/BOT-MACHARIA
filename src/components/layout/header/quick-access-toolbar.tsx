
import React from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import './quick-access-toolbar.scss';

interface QuickAccessItem {
    id: string;
    icon: string;
    label: string;
    action: () => void;
    is_active?: boolean;
    tooltip?: string;
}

const QuickAccessToolbar = observer(() => {
    const quickAccessItems: QuickAccessItem[] = [
        {
            id: 'new-bot',
            icon: 'IcAdd',
            label: localize('New Bot'),
            action: () => {
                // Navigate to bot builder
                window.location.href = '/bot-builder';
            },
            tooltip: localize('Create a new trading bot'),
        },
        {
            id: 'run-strategy',
            icon: 'IcPlay',
            label: localize('Run'),
            action: () => {
                // Run current strategy
                console.log('Running strategy...');
            },
            tooltip: localize('Run the current strategy'),
        },
        {
            id: 'stop-strategy',
            icon: 'IcStop',
            label: localize('Stop'),
            action: () => {
                // Stop current strategy
                console.log('Stopping strategy...');
            },
            tooltip: localize('Stop the current strategy'),
        },
        {
            id: 'reset-strategy',
            icon: 'IcReset',
            label: localize('Reset'),
            action: () => {
                // Reset strategy
                console.log('Resetting strategy...');
            },
            tooltip: localize('Reset the strategy'),
        },
        {
            id: 'save-strategy',
            icon: 'IcSave',
            label: localize('Save'),
            action: () => {
                // Save current strategy
                console.log('Saving strategy...');
            },
            tooltip: localize('Save the current strategy'),
        },
        {
            id: 'load-strategy',
            icon: 'IcOpen',
            label: localize('Load'),
            action: () => {
                // Load strategy
                console.log('Loading strategy...');
            },
            tooltip: localize('Load a saved strategy'),
        },
    ];

    return (
        <div className="quick-access-toolbar">
            <div className="quick-access-toolbar__container">
                {quickAccessItems.map((item) => (
                    <button
                        key={item.id}
                        className={`quick-access-toolbar__item ${item.is_active ? 'quick-access-toolbar__item--active' : ''}`}
                        onClick={item.action}
                        title={item.tooltip}
                    >
                        <span className="quick-access-toolbar__icon">{item.icon}</span>
                        <span className="quick-access-toolbar__label">{item.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
});

export default QuickAccessToolbar;
