import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import { MenuItem, Text, useDevice } from '@deriv-com/ui';
import { MenuItems as items, TRADERS_HUB_LINK_CONFIG } from '../header-config';
import './menu-items.scss';

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

import { TMenuItem } from '@/components/layout/header/menu-items/types';
import { localize } from '@deriv-com/translations';

export const menu_items: TMenuItem[] = [
    {
        icon: 'IcDashboard',
        label: localize('Dashboard'),
        to: '/dashboard',
    },
    {
        icon: 'IcBotBuilder',
        label: localize('Bot Builder'),
        to: '/bot-builder',
    },
    {
        icon: 'IcChartTabDbot',
        label: localize('Charts'),
        to: '/chart',
    },
    {
        icon: 'IcTutorials',
        label: localize('Tutorials'),
        to: '/tutorials',
    },
    {
        icon: 'IcAnalysis',
        label: localize('Analysis Tool'),
        to: '/analysis',
    },
    {
        icon: 'IcSpeedBot',
        label: localize('Speed Bot'),
        to: '/speed-bot',
    },
    {
        icon: 'IcSmartTrader',
        label: localize('Smart Trader'),
        to: '/smart-trader',
    },
    {
        icon: 'IcMlTrader',
        label: localize('ML Trader'),
        to: '/ml-trader',
    },
    {
        icon: 'IcHigherLowerTrader',
        label: localize('Higher/Lower'),
        to: '/higher-lower-trader',
    },
    {
        icon: 'IcTrendingUp',
        label: localize('Rise/Fall'),
        to: '/rise-fall-trader',
    },
    {
        icon: 'IcVolatilityAnalyzer',
        label: localize('Volatility Analyzer'),
        to: '/volatility-analyzer',
    },
];