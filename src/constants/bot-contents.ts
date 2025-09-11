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
    FREE_BOTS: 1,
    BOT_BUILDER: 2,
    ANALYSIS_TOOL: 3,
    SIGNALS: 4,
    CHARTS: 5,
    TUTORIALS: 6,
    AI_TRADER: 7,
    DASHBOARD: 8,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-trading-hub', 'id-free-bots', 'id-analysis-tool', 'id-signals'];

export const DEBOUNCE_INTERVAL_TIME = 500;