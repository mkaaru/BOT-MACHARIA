import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import { MenuItem, Text, useDevice } from '@deriv-com/ui';
import { MenuItems as items, TRADERS_HUB_LINK_CONFIG } from '../header-config';
import './menu-items.scss';
import React from 'react';

export const getMenuItems = () => [
    {
        id: 'dashboard',
        icon: 'IcDashboard',
        text: localize('Dashboard'),
        link_to: '/dashboard',
        login_only: true,
    },
    {
        id: 'bot-builder',
        icon: 'IcBotBuilder',
        text: localize('Bot Builder'),
        link_to: '/bot-builder',
        login_only: true,
    },
    {
        id: 'quick-strategy',
        icon: 'IcQuickStrategy',
        text: localize('Quick Strategy'),
        link_to: '/quick-strategy',
        login_only: true,
    },
    {
        id: 'trading-hub',
        icon: 'IcChart',
        text: localize('Trading Hub'),
        link_to: '/trading-hub',
        login_only: true,
    },
    {
        id: 'auto',
        icon: 'IcPlay',
        text: localize('Auto'),
        link_to: '/auto',
        login_only: true,
    },
    {
        id: 'higher-lower-trader',
        icon: 'IcTradetypeAccu',
        text: localize('Higher/Lower Trader'),
        link_to: '/higher-lower-trader',
        login_only: true,
    },
    {
        id: 'volatility-analyzer',
        icon: 'IcReports',
        text: localize('Volatility Analyzer'),
        link_to: '/volatility-analyzer',
        login_only: true,
    },
    {
        id: 'smart-trader',
        icon: 'IcPlay',
        text: localize('Smart Trader'),
        link_to: '/smart-trader',
        login_only: true,
    },
    {
        id: 'speed-bot',
        icon: 'IcPlayOutline',
        text: localize('Speed Bot'),
        link_to: '/speed-bot',
        login_only: true,
    },
    {
        id: 'tutorials',
        icon: 'IcTutorials',
        text: localize('Tutorials'),
        link_to: '/tutorials',
        login_only: false,
    },
    {
        id: 'reports',
        icon: 'IcReports',
        text: localize('Reports'),
        link_to: '/reports',
        login_only: true,
    },
    {
        id: 'chart',
        icon: 'IcChartsTabDbot',
        text: localize('Charts'),
        link_to: '/chart',
        login_only: true,
    },
];

export const getAdvancedMenuItems = () => [
    {
        id: 'portfolio-analyzer',
        icon: 'IcReports',
        text: localize('Portfolio Analyzer'),
        link_to: '/portfolio-analyzer',
        login_only: true,
        is_new: true,
    },
    {
        id: 'risk-management',
        icon: 'IcReset',
        text: localize('Risk Management'),
        link_to: '/risk-management',
        login_only: true,
        is_new: true,
    },
    {
        id: 'market-signals',
        icon: 'IcAnalysis',
        text: localize('Market Signals'),
        link_to: '/market-signals',
        login_only: true,
        is_premium: true,
    },
    {
        id: 'auto-trading',
        icon: 'IcPlay',
        text: localize('Auto Trading'),
        link_to: '/auto-trading',
        login_only: true,
        is_premium: true,
    },
    {
        id: 'backtesting',
        icon: 'IcChart',
        text: localize('Backtesting'),
        link_to: '/backtesting',
        login_only: true,
    },
];

export const MenuItems = observer(() => {
    const { localize } = useTranslations();
    const { isDesktop } = useDevice();
    const store = useStore();
    if (!store) return null;
    const { is_logged_in } = store.client;

    return (
        <>
            {is_logged_in &&
                items.map(({ as, href, icon, label }) => (
                    <MenuItem as={as} className='app-header__menu' href={href} key={label} leftComponent={icon}>
                        <Text>{localize(label)}</Text>
                    </MenuItem>
                ))}
        </>
    );
});

export const TradershubLink = () => (
    <MenuItem
        as='a'
        className='app-header__menu'
        href='https://app.deriv.com/appstore/traders-hub'
        key='traders-hub'
    >
        <Text>{localize('Trader\'s Hub')}</Text>
    </MenuItem>
);

export const RiskRewardLink = () => (
    <MenuItem
        as='a'
        className='app-header__menu'
        href='/risk-reward'
        key='risk-reward'
    >
        <Text>{localize('Risk Reward')}</Text>
    </MenuItem>
);