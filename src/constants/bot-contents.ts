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
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = {
    DASHBOARD: 'DASHBOARD',
    BOT_BUILDER: 'BOT_BUILDER',
    CHART: 'CHART',
    TUTORIALS: 'TUTORIALS',
    DECYCLER_BOT: 'DECYCLER_BOT',
} as const;

export const DEBOUNCE_INTERVAL_TIME = 500;