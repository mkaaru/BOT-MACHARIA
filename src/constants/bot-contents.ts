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
    DASHBOARD: 'id-dbot-dashboard',
    BOT_BUILDER: 'id-bot-builder',
    CHART: 'id-charts',
    TUTORIAL: 'id-tutorials',
    REPORTS: 'id-signals',
    TRADING_HUB: 'id-Trading-Hub',
    ANALYSIS_TOOL: 'id-analysis-tool',
    SIGNALS: 'id-signals',
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-free-bots', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-analysis-tool', 'id-signals', 'id-dbot-dashboard'];

export const DEBOUNCE_INTERVAL_TIME = 500;