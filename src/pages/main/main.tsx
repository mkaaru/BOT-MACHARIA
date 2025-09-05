import React, { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';
import AnalysistoolComponent from '@/components/analysistool/analysis';
import PercentageTool from '@/components/percentage-tool/percentage-tool';
import VolatilityAnalyzer from '@/components/volatility-analyzer';
import SmartTrader from '@/components/smart-trader';
import MLTrader from '@/components/ml-trader';
import HigherLowerTrader from '@/components/higher-lower-trader';
import AutoTrader from '@/components/auto-trader';


const Chart = lazy(() => import('../chart'));
const Tutorial = lazy(() => import('../tutorials'));

const DashboardIcon = () => (
    <svg width="20" height="20" fill="var(--text-general)" viewBox="0 0 24 24">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
    </svg>
);

const BotBuilderIcon = () => (
   <svg fill="var(--text-general)" width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fillRule="evenodd" d="M20,9.85714286 L20,14.1428571 C20,15.2056811 19.0732946,16 18,16 L6,16 C4.92670537,16 4,15.2056811 4,14.1428571 L4,9.85714286 C4,8.79431889 4.92670537,8 6,8 L18,8 C19.0732946,8 20,8.79431889 20,9.85714286 Z M6,10 L6,14 L18,14 L18,10 L6,10 Z M2,19 L2,17 L22,17 L22,19 L2,19 Z M2,7 L2,5 L22,5 L22,7 L2,7 Z"/>
</svg>
);

const ChartsIcon = () => (
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21 21H7.8C6.11984 21 5.27976 21 4.63803 20.673C4.07354 20.3854 3.6146 19.9265 3.32698 19.362C3 18.7202 3 17.8802 3 16.2V3M6 15L10 11L14 15L20 9M20 9V13M20 9H16" stroke="var(--text-general)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
</svg>
);

const TutorialsIcon = () => (
   <svg width="24px" height="24px" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" fill="none"><path stroke="var(--text-general)" strokeWidth="12" d="M170 96c0-45-4.962-49.999-50-50H72c-45.038.001-50 5-50 50s4.962 49.999 50 50h48c45.038-.001 50-5 50-50Z"/><path stroke="var(--text-general)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="12" d="m82 74 34 22-34 22"/></svg>
);

const AnalysisToolIcon = () => (
    <svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M7.5 3.5V6.5" stroke="var(--text-general)" strokeLinecap="round"/>
<path d="M7.5 14.5V18.5" stroke="var(--text-general)" strokeLinecap="round"/>
<path d="M6.8 6.5C6.08203 6.5 5.5 7.08203 5.5 7.8V13.2C5.5 13.918 6.08203 14.5 6.8 14.5H8.2C8.91797 14.5 9.5 13.918 9.5 13.2V7.8C9.5 7.08203 8.91797 6.5 8.2 6.5H6.8Z" stroke="var(--text-general)"/>
<path d="M16.5 6.5V11.5" stroke="var(--text-general)" strokeLinecap="round"/>
<path d="M16.5 16.5V20.5" stroke="var(--text-general)" strokeLinecap="round"/>
<path d="M15.8 11.5C15.082 11.5 14.5 12.082 14.5 12.8V15.2C14.5 15.918 15.082 16.5 15.8 16.5H17.2C17.918 16.5 18.5 15.918 18.5 15.2V12.8C18.5 12.082 17.918 11.5 17.2 11.5H15.8Z" stroke="var(--text-general)"/>
</svg>
);

const SignalsIcon = () => (
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 6.00067L21 6.00139M8 12.0007L21 12.0015M8 18.0007L21 18.0015M3.5 6H3.51M3.5 12H3.51M3.5 18H3.51M4 6C4 6.27614 3.77614 6.5 3.5 6.5C3.22386 6.5 3 6.27614 3 6C3 5.72386 3.22386 5.5 3.5 5.5C3.77614 5.5 4 5.72386 4 6ZM4 12C4 12.2761 3.77614 12.5 3.5 12.5C3.22386 12.5 3 12.2761 3 12C3 11.7239 3.22386 11.5 3.5 11.5C3.77614 11.5 4 11.7239 4 12ZM4 18C4 18.2761 3.77614 18.5 3.5 18.5C3.22386 18.5 3 18.2761 3 18C3 17.7239 3.22386 17.5 3.5 17.5C3.77614 17.5 4 17.7239 4 18Z" stroke="var(--text-general)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
</svg>
);

const TradingHubIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="var(--text-general)" width="24px" height="24px" viewBox="0 0 24 24"><path d="M21.49 13.926l-3.273 2.48c.054-.663.116-1.435.143-2.275.04-.89.023-1.854-.043-2.835-.043-.487-.097-.98-.184-1.467-.077-.485-.196-.982-.31-1.39-.238-.862-.535-1.68-.9-2.35-.352-.673-.786-1.173-1.12-1.462-.172-.144-.31-.248-.414-.306l-.153-.093c-.083-.05-.187-.056-.275-.003-.13.08-.175.252-.1.388l.01.02s.11.198.258.54c.07.176.155.38.223.63.08.24.14.528.206.838.063.313.114.66.17 1.03l.15 1.188c.055.44.106.826.13 1.246.03.416.033.85.026 1.285.004.872-.063 1.76-.115 2.602-.062.853-.12 1.65-.172 2.335 0 .04-.004.073-.005.11l-.115-.118-2.996-3.028-1.6.454 5.566 6.66 6.394-5.803-1.503-.677z"/><path d="M2.503 9.48L5.775 7c-.054.664-.116 1.435-.143 2.276-.04.89-.023 1.855.043 2.835.043.49.097.98.184 1.47.076.484.195.98.31 1.388.237.862.534 1.68.9 2.35.35.674.785 1.174 1.12 1.463.17.145.31.25.413.307.1.06.152.093.152.093.083.05.187.055.275.003.13-.08.175-.252.1-.388l-.01-.02s-.11-.2-.258-.54c-.07-.177-.155-.38-.223-.63-.082-.242-.14-.528-.207-.84-.064-.312-.115-.658-.172-1.027-.046-.378-.096-.777-.15-1.19-.053-.44-.104-.825-.128-1.246-.03-.415-.033-.85-.026-1.285-.004-.872.063-1.76.115-2.603.064-.853.122-1.65.174-2.334 0-.04.004-.074.005-.11l.114.118 2.996 3.027 1.6-.454L7.394 3 1 8.804l1.503.678z"/></svg>
);

const AutoIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="var(--text-general)" />
        <circle cx="12" cy="8" r="1" fill="var(--text-general)" />
    </svg>
);

const FreeBotsIcon = () => (
   <svg fill="var(--text-general)" width="20px" height="20px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-name="Layer 1"><path d="M10,13H4a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V14A1,1,0,0,0,10,13ZM9,19H5V15H9ZM20,3H14a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,20,3ZM19,9H15V5h4Zm1,7H18V14a1,1,0,0,0-2,0v2H14a1,1,0,0,0,0,2h2v2a1,1,0,0,0,2,0V18h2a1,1,0,0,0,0-2ZM10,3H4A1,1,0,0,0,3,4v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,10,3ZM9,9H5V5H9Z"/></svg>
);

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card } = useStore();
    const {
        active_tab,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
    } = dashboard;
    const { onEntered } = load_modal;
    const { is_dialog_open, dialog_options, onCancelButtonClick, onCloseDialog, onOkButtonClick, stopBot, is_drawer_open } = run_panel;
    const { cancel_button_text, ok_button_text, title, message } = dialog_options as { [key: string]: string };
    const { clear } = summary_card;
    const { FREE_BOTS, BOT_BUILDER, ANALYSIS_TOOL, SIGNALS, DASHBOARD, AUTO, TRADING_HUB } = DBOT_TABS;
    const { isDesktop } = useDevice();
    const location = useLocation();
    const navigate = useNavigate();

    const [bots, setBots] = useState([]);
    // Digits Trading Bot States
  const [selectedIndex, setSelectedIndex] = useState('R_100')
  const [contractType, setContractType] = useState('DIGITEVEN')
  const [predictionModel, setPredictionModel] = useState('neural_network')
  const [stakeAmount, setStakeAmount] = useState('1.00')
  const [isConnected, setIsConnected] = useState(false)
  const [isTrading, setIsTrading] = useState(false)
  const [currentTick, setCurrentTick] = useState<number | null>(null)
  const [currentPrice, setCurrentPrice] = useState<string>('---')
  const [tickHistory, setTickHistory] = useState<{[key: string]: number[]}>({})
  const [digitDistribution, setDigitDistribution] = useState<number[]>(new Array(10).fill(0))
  const [digitPercentages, setDigitPercentages] = useState<number[]>(new Array(10).fill(10))
  const [currentPrediction, setCurrentPrediction] = useState<number | null>(null)
  const [predictionAccuracy, setPredictionAccuracy] = useState(0)
  const [totalPredictions, setTotalPredictions] = useState(0)
  const [correctPredictions, setCorrectPredictions] = useState(0)
  const [chartData, setChartData] = useState<any[]>([])
  const [connectionStatus2, setConnectionStatus2] = useState('Disconnected')
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('---')

    const onTabItemClick = useCallback(
        (tab_index: number) => {
            const queryParams = new URLSearchParams(location.search);
            if (tab_index !== 0) {
                setActiveTab(tab_index);
            } else {
                setActiveTab(DASHBOARD);
                queryParams.delete('utm_source');
                queryParams.delete('utm_medium');
                queryParams.delete('utm_campaign');
                const search = queryParams.toString();
                navigate({
                    pathname: location.pathname,
                    search: search ? `?${search}` : '',
                });
            }
        },
        [location.pathname, location.search, navigate, setActiveTab]
    );

    const tab_data = [
        {
            icon: <DashboardIcon />,
            label: <Localize i18n_default_text="Dashboard" />,
            value: DASHBOARD,
        },
        {
            icon: <BotBuilderIcon />,
            label: <Localize i18n_default_text="Bot Builder" />,
            value: BOT_BUILDER,
        },
        {
            icon: <ChartsIcon />,
            label: <Localize i18n_default_text="Charts" />,
            value: 'CHART',
        },
        {
            icon: <TutorialsIcon />,
            label: <Localize i18n_default_text="Tutorials" />,
            value: 'TUTORIAL',
        },
        {
            icon: <AnalysisToolIcon />,
            label: <Localize i18n_default_text="Analysis Tool" />,
            value: 'ANALYSIS_TOOL',
        },
        {
            icon: <SignalsIcon />,
            label: <Localize i18n_default_text="Signals" />,
            value: 'SIGNALS',
        },
        {
            icon: <TradingHubIcon />,
            label: <Localize i18n_default_text="Trading Hub" />,
            value: 'TRADING_HUB',
        },
        {
            icon: <AutoIcon />,
            label: <Localize i18n_default_text="Auto" />,
            value: AUTO,
        },
        {
            icon: <FreeBotsIcon />,
            label: <Localize i18n_default_text="Free Bots" />,
            value: FREE_BOTS,
        },
    ];

    useEffect(() => {
        let mounted = true;
        if (connectionStatus !== CONNECTION_STATUS.CONNECTED) {
            if (mounted) {
                clear();
            }
        }
        return () => {
            mounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionStatus, clear]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const xmlContent = e.target?.result as string;
                    // Handle XML file loading logic here
                    console.log('XML file loaded:', xmlContent);
                } catch (error) {
                    console.error('Error parsing XML file:', error);
                }
            };
            reader.readAsText(file);
        }
    };

    const renderActiveTabContent = () => {
        switch (active_tab) {
            case 'CHART':
                return (
                    <Suspense fallback={<ChunkLoader />}>
                        <Chart />
                    </Suspense>
                );
            case 'TUTORIAL':
                return (
                    <Suspense fallback={<ChunkLoader />}>
                        <Tutorial />
                    </Suspense>
                );
            case 'ANALYSIS_TOOL':
                return <AnalysistoolComponent />;
            case 'PERCENTAGE_TOOL':
                return <PercentageTool />;
            case 'VOLATILITY_ANALYZER':
                return <VolatilityAnalyzer />;
            case 'SMART_TRADER':
                return <SmartTrader />;
            case 'ML_TRADER':
                return <MLTrader />;
            case 'HIGHER_LOWER_TRADER':
                return <HigherLowerTrader />;
            case 'SIGNALS':
                return <div>Signals Page</div>;
            case 'TRADING_HUB':
                return <div>Trading Hub Page</div>;
            case 'AUTO':
                return <AutoTrader />;
            case 'FREE_BOTS':
                return <div>Free Bots Page</div>;
            default:
                return <Dashboard />;
        }
    };

    return (
        <>
            <div className={classNames('bot-dashboard', isDbotRTL() && 'bot-dashboard--rtl')}>
                <div className="bot-dashboard__container">
                    <div className="bot-dashboard__main">
                        <div className="bot-dashboard__main-header">
                            <Tabs active_index={active_tab} onTabItemClick={onTabItemClick} tab_data={tab_data} />
                        </div>
                        <div className="bot-dashboard__main-content">
                            {renderActiveTabContent()}
                        </div>
                    </div>
                    <RunStrategy />
                </div>
                <DesktopWrapper>
                    <RunPanel />
                </DesktopWrapper>
                <MobileWrapper>
                    {is_drawer_open && <RunPanel />}
                </MobileWrapper>
            </div>
            {is_chart_modal_visible && (
                <ChartModal />
            )}
            {is_trading_view_modal_visible && (
                <TradingViewModal />
            )}
            {is_dialog_open && (
                <Dialog
                    title={title}
                    is_visible={is_dialog_open}
                    confirm_button_text={ok_button_text || localize('Yes')}
                    onConfirm={() => {
                        onOkButtonClick?.();
                        onCloseDialog();
                        stopBot();
                    }}
                    cancel_button_text={cancel_button_text || localize('No')}
                    onCancel={() => {
                        onCancelButtonClick?.();
                        onCloseDialog();
                    }}
                >
                    {message}
                </Dialog>
            )}
        </>
    );
});

export default AppWrapper;