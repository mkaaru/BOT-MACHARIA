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

export const DBOT_TABS = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TUTORIAL: 3,
    ANALYSIS_TOOL: 4,
    TRADING_HUB: 5,
    SIGNALS: 6,
    AI_TRADER: 7,
    FREE_BOTS: 8,
    ML_TRADER: 9,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-trading-hub', 'id-free-bots', 'id-analysis-tool', 'id-signals'];

export const DEBOUNCE_INTERVAL_TIME = 500;