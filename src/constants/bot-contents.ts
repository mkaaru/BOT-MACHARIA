type TTabsTitle = {
    [key: string]: string | number;
};


export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS = {
    TRADING_HUB: 0,
    BOT_BUILDER: 1,
    FREE_BOTS: 2,
    ML_TRADER: 3,
    SMART_TRADING: 4,
    ANALYSIS_TOOL: 5,
    SIGNALS: 6,
    CHART: 7,
    TUTORIAL: 8,
    AI_TRADER: 9,
    DASHBOARD: 10,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-trading-hub', 'id-bot-builder', 'id-free-bots', 'id-ml-trader', 'id-smart-trading', 'id-analysis-tool', 'id-signals', 'id-charts', 'id-tutorials', 'id-ai-trader', 'id-dbot-dashboard'];

export const DEBOUNCE_INTERVAL_TIME = 500;