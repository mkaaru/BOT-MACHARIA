
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
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TUTORIAL: 3,
    TRADING_HUB: 4,
    FREE_BOTS: 5,
    ANALYSIS_TOOL: 6,
    SIGNALS: 7,
    AI_TRADER: 8,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-trading-hub', 'id-free-bots', 'id-analysis-tool', 'id-signals'];

export const DEBOUNCE_INTERVAL_TIME = 500;
