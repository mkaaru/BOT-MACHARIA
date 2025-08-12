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
    ANALYSIS_TOOL: 1,
    DECYCLER_BOT: 2,
} as const;

export const MAX_STRATEGIES = 10;

export const TAB_IDS = {
    FREE_BOTS: 'FREE_BOTS',
    ANALYSIS_TOOL: 'ANALYSIS_TOOL',
    DECYCLER_BOT: 'DECYCLER_BOT',
} as const;

export const DEBOUNCE_INTERVAL_TIME = 500;