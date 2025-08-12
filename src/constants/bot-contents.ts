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
    FREE_BOTS: 0,
    BOT_BUILDER: 1,
    SIGNALS: 2,
    ANALYSIS_TOOL: 3,
    CHART: 4,
    TUTORIAL: 5,
    TRADING_HUB: 6,
    DASHBOARD: 7,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-free-bots', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-analysis-tool', 'id-signals', 'id-dbot-dashboard'];

export const DEBOUNCE_INTERVAL_TIME = 500;