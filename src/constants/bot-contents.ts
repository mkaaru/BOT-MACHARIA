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
    TRADING_HUB: 0,
    BOT_BUILDER: 1,
    FREE_BOTS: 2,
    AI_TRADER: 3,
    ANALYSIS_TOOL: 4,
    SIGNALS: 5,
    CHARTS: 6,
    TUTORIALS: 7,
    DASHBOARD: 8,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-trading-hub', 'id-bot-builder', 'id-free-bots', 'id-ml-trader', 'id-analysis-tool', 'id-signals', 'id-charts', 'id-tutorials', 'id-dbot-dashboard'];

export const DEBOUNCE_INTERVAL_TIME = 500;