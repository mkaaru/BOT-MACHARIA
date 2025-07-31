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
    SMART_TRADING: 2,
    SPEED_BOT: 3,
    SIGNALS: 4,
    ANALYSIS_TOOL: 5,
    CHART: 6,
    TUTORIALS: 7,
    TRADING_HUB: 8,
    DASHBOARD: 9,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-free-bots', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-analysis-tool', 'id-signals', 'id-dbot-dashboard'];

export const DEBOUNCE_INTERVAL_TIME = 500;