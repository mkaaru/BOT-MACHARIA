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
    BOT_BUILDER: 'bot_builder',
    CHART: 'chart',
    DASHBOARD: 'dashboard',
    TUTORIAL: 'tutorials',
    SIGNALS: 'signals',
    AI_TRADER: 'ai_trader',
    ANALYSIS_TOOL: 'analysis_tool',
    ML_TRADER: 'ml_trader',
    SMART_TRADER: 'smart_trader',
    SPEED_BOT: 'speed_bot',
    PERCENTAGE_TOOL: 'percentage_tool',
    VOLATILITY_ANALYZER: 'volatility_analyzer',
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-free-bots', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-analysis-tool', 'id-signals', 'id-dbot-dashboard'];

export const DEBOUNCE_INTERVAL_TIME = 500;