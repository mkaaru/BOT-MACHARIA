type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS = {
    DASHBOARD: 'dashboard',
    BOT_BUILDER: 'bot_builder',
    CHART: 'chart',
    TUTORIALS: 'tutorials',
    DECYCLER_BOT: 'decycler_bot',
    FREE_BOTS: 'free_bots',
    SMART_TRADING: 'smart_trading',
    SPEED_BOT: 'speed_bot',
    SIGNALS: 'signals',
    ANALYSIS_TOOL: 'analysis_tool',
    TRADING_HUB: 'trading_hub',
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = {
    DASHBOARD: 'DASHBOARD',
    BOT_BUILDER: 'BOT_BUILDER',
    CHART: 'CHART',
    TUTORIALS: 'TUTORIALS',
    DECYCLER_BOT: 'DECYCLER_BOT',
    FREE_BOTS: 'FREE_BOTS',
    SMART_TRADING: 'SMART_TRADING',
    SPEED_BOT: 'SPEED_BOT',
    SIGNALS: 'SIGNALS',
    ANALYSIS_TOOL: 'ANALYSIS_TOOL',
    TRADING_HUB: 'TRADING_HUB',
} as const;

export const DEBOUNCE_INTERVAL_TIME = 500;