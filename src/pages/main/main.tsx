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
import TradingHubDisplay from '@/components/trading-hub/trading-hub-display';


const Chart = lazy(() => import('../chart'));
const Tutorial = lazy(() => import('../tutorials'));

const DashboardIcon = () => (
    <svg width="20" height="20" fill="var(--text-general)" viewBox="0 0 24 24">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
    </svg>
);

const BotBuilderIcon = () => (
   <svg fill="var(--text-general)" width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" d="M20,9.85714286 L20,14.1428571 C20,15.2056811 19.0732946,16 18,16 L6,16 C4.92670537,16 4,15.2056811 4,14.1428571 L4,9.85714286 C4,8.79431889 4.92670537,8 6,8 L18,8 C19.0732946,8 20,8.79431889 20,9.85714286 Z M6,10 L6,14 L18,14 L18,10 L6,10 Z M2,19 L2,17 L22,17 L22,19 L2,19 Z M2,7 L2,5 L22,5 L22,7 L2,7 Z"/>
</svg>
);

const ChartsIcon = () => (
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21 21H7.8C6.11984 21 5.27976 21 4.63803 20.673C4.07354 20.3854 3.6146 19.9265 3.32698 19.362C3 18.7202 3 17.8802 3 16.2V3M6 15L10 11L14 15L20 9M20 9V13M20 9H16" stroke="var(--text-general)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
);

const TutorialsIcon = () => (
   <svg width="24px" height="24px" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" fill="none"><path stroke="var(--text-general)" stroke-width="12" d="M170 96c0-45-4.962-49.999-50-50H72c-45.038.001-50 5-50 50s4.962 49.999 50 50h48c45.038-.001 50-5 50-50Z"/><path stroke="var(--text-general)" stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="m82 74 34 22-34 22"/></svg>
);

const AnalysisToolIcon = () => (
    <svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M7.5 3.5V6.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M7.5 14.5V18.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M6.8 6.5C6.08203 6.5 5.5 7.08203 5.5 7.8V13.2C5.5 13.918 6.08203 14.5 6.8 14.5H8.2C8.91797 14.5 9.5 13.918 9.5 13.2V7.8C9.5 7.08203 8.91797 6.5 8.2 6.5H6.8Z" stroke="var(--text-general)"/>
<path d="M16.5 6.5V11.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M16.5 16.5V20.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M15.8 11.5C15.082 11.5 14.5 12.082 14.5 12.8V15.2C14.5 15.918 15.082 16.5 15.8 16.5H17.2C17.918 16.5 18.5 15.918 18.5 15.2V12.8C18.5 12.082 17.918 11.5 17.2 11.5H15.8Z" stroke="var(--text-general)"/>
</svg>
);

const SignalsIcon = () => (
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 6.00067L21 6.00139M8 12.0007L21 12.0015M8 18.0007L21 18.0015M3.5 6H3.51M3.5 12H3.51M3.5 18H3.51M4 6C4 6.27614 3.77614 6.5 3.5 6.5C3.22386 6.5 3 6.27614 3 6C3 5.72386 3.22386 5.5 3.5 5.5C3.77614 5.5 4 5.72386 4 6ZM4 12C4 12.2761 3.77614 12.5 3.5 12.5C3.22386 12.5 3 12.2761 3 12C3 11.7239 3.22386 11.5 3.5 11.5C3.77614 11.5 4 11.7239 4 12ZM4 18C4 18.2761 3.77614 18.5 3.5 18.5C3.22386 18.5 3 18.2761 3 18C3 17.7239 3.22386 17.5 3.5 17.5C3.77614 17.5 4 17.7239 4 18Z" stroke="var(--text-general)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
);

const TradingHubIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="var(--text-general)" width="24px" height="24px" viewBox="0 0 24 24">
        <path d="M21.49 13.926l-3.273 2.48c.054-.663.116-1.435.143-2.275.04-.89.023-1.854-.043-2.835-.043-.487-.097-.98-.184-1.467-.077-.485-.196-.982-.31-1.39-.238-.862-.535-1.68-.9-2.35-.352-.673-.786-1.173-1.12-1.462-.172-.144-.31-.248-.414-.306l-.153-.093c-.083-.05-.187-.056-.275-.003-.13.08-.175.252-.1.388l.01.02s.11.198.258.54c.07.176.155.38.223.63.08.24.14.528.206.838.063.313.114.66.17 1.03l.15 1.188c.055.44.106.826.13 1.246.03.416.033.85.026 1.285.004.872-.063 1.76-.115 2.602-.062.853-.12 1.65-.172 2.335 0 .04-.004.073-.005.11l-.115-.118-2.996-3.028-1.6.454 5.566 6.66 6.394-5.803-1.503-.677z"/>
        <path d="M2.503 9.48L5.775 7c-.054.664-.116 1.435-.143 2.276-.04.89-.023 1.855.043 2.835.043.49.097.98.184 1.47.076.484.195.98.31 1.388.237.862.534 1.68.9 2.35.35.674.785 1.174 1.12 1.463.17.145.31.25.413.307.1.06.152.093.152.093.083.05.187.055.275.003.13-.08.175-.252.1-.388l-.01-.02s-.11-.2-.258-.54c-.07-.177-.155-.38-.223-.63-.082-.242-.14-.528-.207-.84-.064-.312-.115-.658-.172-1.19-.053-.44-.104-.825-.128-1.246-.03-.415-.033-.85-.026-1.285-.004-.872.063-1.76.115-2.603.064-.853.122-1.65.174-2.334 0-.04.004-.074.005-.11l.114.118 2.996 3.027 1.6-.454L7.394 3 1 8.804l1.503.678z"/>
    </svg>
);

const FreeBotsIcon = () => (
   <svg fill="var(--text-general)" width="20px" height="20px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-name="Layer 1"><path d="M10,13H4a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V14A1,1,0,0,0,10,13ZM9,19H5V15H9ZM20,3H14a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,20,3ZM19,9H15V5h4Zm1,7H18V14a1,1,0,0,0-2,0v2H14a1,1,0,0,0,0,2h2v2a1,1,0,0,0,2,0V18h2a1,1,0,0,0,0-2ZM10,3H4A1,1,0,0,0,3,4v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,10,3ZM9,9H5V5H9Z"/></svg>
);

const BotIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="var(--text-general)" />
    </svg>
);

const AITraderIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="var(--text-general)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="12" cy="12" r="2" fill="var(--text-general)"/>
    </svg>
);

// Import actual components
// import VolatilityAnalyzer from '@/components/volatility-analyzer/volatility-analyzer';


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
    const { FREE_BOTS, BOT_BUILDER, ANALYSIS_TOOL, SIGNALS, DASHBOARD, AI_TRADER, TRADING_HUB } = DBOT_TABS;
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
  const [nextPrediction, setNextPrediction] = useState<string>('')
  const [confidence, setConfidence] = useState(0)
  const [predictionAccuracy, setPredictionAccuracy] = useState(0)
  const [evenOddBias, setEvenOddBias] = useState('NEUTRAL')
  const [overUnderBias, setOverUnderBias] = useState('NEUTRAL')
  const [streakPattern, setStreakPattern] = useState('---')
  const [tradingLog, setTradingLog] = useState<any[]>([])
  const [totalTrades, setTotalTrades] = useState(0)
  const [winRate, setWinRate] = useState(0)
  const [profitLoss, setProfitLoss] = useState(0)
  const [currentStreak, setCurrentStreak] = useState(0)
  const [websocket, setWebsocket] = useState<WebSocket | null>(null)
    const [pythonCode, setPythonCode] = useState('');
    const [pythonOutput, setPythonOutput] = useState([]);
    const [savedScripts, setSavedScripts] = useState([]);
    const [isExecuting, setIsExecuting] = useState(false);
    // Add new state for analysis tool URL


    // Add function to check if analysis tool is active
    const isAnalysisToolActive = active_tab === ANALYSIS_TOOL;

    useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
            if (is_bot_running) {
                clear();
                stopBot();
                api_base.setIsRunning(false);
            }
        }
    }, [clear, connectionStatus, stopBot]);

    useEffect(() => {
        // Fetch the XML files and parse them
        const fetchBots = async () => {
            const botFiles = [
                'Upgraded Candlemine.xml',
                'Super Elite.xml',
                'AUTO C4 PRO Version.xml',
                'Mkorean SV4.xml',
            ];

            const loadedBots = [];

            for (const file of botFiles) {
                try {
                    // Try multiple fetch approaches for better compatibility
                    let response;
                    let text = null;

                    // Try public directory with encoded URI
                    try {
                        const encodedFile = encodeURIComponent(file);
                        response = await fetch(`/${encodedFile}`);
                        if (response.ok) {
                            text = await response.text();
                        }
                    } catch (e) {
                        console.log(`Failed to fetch encoded: ${file}`);
                    }

                    // Try normal fetch if encoded didn't work
                    if (!text) {
                        try {
                            response = await fetch(`/${file}`);
                            if (response.ok) {
                                text = await response.text();
                            }
                        } catch (e) {
                            console.log(`Failed to fetch normal: ${file}`);
                        }
                    }

                    // Try without leading slash
                    if (!text) {
                        try {
                            response = await fetch(file);
                            if (response.ok) {
                                text = await response.text();
                            }
                        } catch (e) {
                            console.log(`Failed to fetch without slash: ${file}`);
                        }
                    }

                    if (!text) {
                        console.warn(`Could not load bot file: ${file}`);
                        loadedBots.push({
                            title: file.replace('.xml', ''),
                            image: 'default_image_path',
                            filePath: file,
                            xmlContent: null,
                            isPlaceholder: true
                        });
                        continue;
                    }

                    // Validate XML content
                    if (!text.trim().startsWith('<xml') && !text.trim().startsWith('<?xml')) {
                        console.warn(`Invalid XML content for ${file}`);
                        loadedBots.push({
                            title: file.replace('.xml', ''),
                            image: 'default_image_path',
                            filePath: file,
                            xmlContent: null,
                            isPlaceholder: true
                        });
                        continue;
                    }

                    const parser = new DOMParser();
                    const xml = parser.parseFromString(text, 'application/xml');

                    // Check if XML parsing was successful
                    const parseError = xml.getElementsByTagName('parsererror')[0];
                    if (parseError) {
                        console.warn(`XML parsing error for ${file}:`, parseError.textContent);
                        loadedBots.push({
                            title: file.replace('.xml', ''),
                            image: 'default_image_path',
                            filePath: file,
                            xmlContent: text, // Still include the content even if parsing failed
                            isPlaceholder: false
                        });
                        continue;
                    }

                    loadedBots.push({
                        title: file.replace('.xml', ''),
                        image: xml.getElementsByTagName('image')[0]?.textContent || 'default_image_path',
                        filePath: file,
                        xmlContent: text,
                        isPlaceholder: false
                    });

                    console.log(`Successfully loaded: ${file}`);

                } catch (error) {
                    console.error(`Error loading bot ${file}:`, error);
                    loadedBots.push({
                        title: file.replace('.xml', ''),
                        image: 'default_image_path',
                        filePath: file,
                        xmlContent: null,
                        isPlaceholder: true
                    });
                }
            }

            setBots(loadedBots);
            console.log(`Loaded ${loadedBots.length} bots total`);
            console.log(`Successful: ${loadedBots.filter(b => !b.isPlaceholder).length}`);
            console.log(`Placeholders: ${loadedBots.filter(b => b.isPlaceholder).length}`);
        };

        fetchBots();
    }, []);

    const runBot = (xmlContent: string) => {
        // Load the strategy into the bot builder
        updateWorkspaceName(xmlContent);
        console.log('Running bot with content:', xmlContent);
    };

    const handleTabChange = React.useCallback(
        (tab_index: number) => {
            setActiveTab(tab_index);
        },
        [setActiveTab]
    );

    const handleBotClick = useCallback(async (bot: { filePath: string; xmlContent: string | null; title?: string; isPlaceholder?: boolean }) => {
        try {
            console.log("Loading bot:", bot.title, "Placeholder:", bot.isPlaceholder);

            let xmlContent = bot.xmlContent;

            // If it's a placeholder bot or no content, try to load the content now
            if (bot.isPlaceholder || !xmlContent) {
                console.log("Attempting to load XML content for bot...");
                try {
                    let response;
                    let success = false;

                    // Try multiple approaches
                    const attempts = [
                        `/${encodeURIComponent(bot.filePath)}`,
                        `/${bot.filePath}`,
                        bot.filePath
                    ];

                    for (const url of attempts) {
                        try {
                            response = await fetch(url);
                            if (response.ok) {
                                xmlContent = await response.text();
                                console.log(`Successfully loaded XML from: ${url}`);
                                success = true;
                                break;
                            }
                        } catch (e) {
                            console.log(`Failed attempt with URL: ${url}`);
                        }
                    }

                    if (!success) {
                        throw new Error(`Could not fetch ${bot.filePath} from any URL`);
                    }
                } catch (fetchError) {
                    console.error("Failed to load bot content:", fetchError);
                    alert(`Failed to load bot: ${bot.title}. Please check if the file exists.`);
                    return;
                }
            }

            if (!xmlContent || xmlContent.trim().length === 0) {
                alert("Bot file is empty or invalid.");
                return;
            }

            console.log("XML Content length:", xmlContent?.length);
            console.log("XML Content preview:", xmlContent?.substring(0, 200));

            // Validate XML content with better error handling
            const trimmedContent = xmlContent.trim();
            if (!trimmedContent.startsWith('<xml') && !trimmedContent.startsWith('<?xml')) {
                alert("Invalid bot file format. Please ensure the file contains valid XML.");
                return;
            }

            // Clean up and validate XML structure with more tolerance
            let cleanXmlContent = xmlContent;
            try {
                // Remove any potential BOM or extra whitespace
                cleanXmlContent = xmlContent.replace(/^\uFEFF/, '').trim();

                // Try to parse and fix common XML issues
                const parser = new DOMParser();
                let xmlDoc = parser.parseFromString(cleanXmlContent, 'application/xml');

                // Check for parser errors
                const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
                if (parseError) {
                    console.warn("XML parsing warning:", parseError.textContent);

                    // Try to fix common XML issues
                    cleanXmlContent = cleanXmlContent
                        .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;') // Fix unescaped ampersands
                        .replace(/<([^>]*[^/])>/g, (match, content) => {
                            // Ensure proper tag closing
                            if (!content.includes('/') && !content.includes(' ')) {
                                return match;
                            }
                            return match;
                        });

                    // Try parsing again
                    xmlDoc = parser.parseFromString(cleanXmlContent, 'application/xml');
                    const secondParseError = xmlDoc.getElementsByTagName('parsererror')[0];

                    if (secondParseError) {
                        console.error("XML parsing still failed after cleanup:", secondParseError.textContent);
                        // Continue anyway - let the workspace loader handle it
                        console.log("Proceeding with potentially problematic XML...");
                    }
                }

                // Update the content to use the cleaned version
                xmlContent = cleanXmlContent;

            } catch (parseError) {
                console.warn("XML validation warning:", parseError);
                console.log("Proceeding with original XML content...");
                // Don't fail here - let the workspace loader try to handle it
            }

            // First switch to Bot Builder tab
            setActiveTab(DBOT_TABS.BOT_BUILDER);

            // Wait for the tab to load and workspace to be ready
            await new Promise(resolve => setTimeout(resolve, 300));

            // Get the main Blockly workspace
            const workspace = window.Blockly?.derivWorkspace || window.Blockly?.getMainWorkspace();

            if (!workspace) {
                console.error("Blockly workspace not found");
                alert("Bot Builder workspace is not ready. Please try again.");
                return;
            }

            console.log("Clearing workspace before loading new bot...");

            // Clear the workspace completely to prevent conflicts
            try {
                // Use asyncClear if available, otherwise use regular clear
                if (workspace.asyncClear) {
                    await workspace.asyncClear();
                } else {
                    workspace.clear();
                }

                // Also clear undo history
                workspace.clearUndo();

                console.log("Workspace cleared successfully");
            } catch (clearError) {
                console.error("Error clearing workspace:", clearError);
            }

            // Wait a moment after clearing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Use the external bot-skeleton load utility with enhanced error handling
            try {
                const { load } = await import('@/external/bot-skeleton/scratch/utils');

                if (load && xmlContent) {
                    console.log("Loading bot using bot-skeleton load utility...");

                    // Load the XML content into the workspace
                    const loadResult = await load({
                        block_string: xmlContent,
                        file_name: bot.title || 'Loaded Bot',
                        workspace: workspace,
                        from: 'free_bots',
                        showIncompatibleStrategyDialog: false // Disable incompatible strategy dialog
                    });

                    // Check if load returned an error
                    if (loadResult && loadResult.error) {
                        console.warn("Load utility returned error:", loadResult.error);
                        throw new Error(loadResult.error);
                    }

                    console.log("Bot loaded successfully into workspace!");

                    // Update workspace name if available
                    if (typeof updateWorkspaceName === 'function') {
                        updateWorkspaceName(xmlContent);
                    }

                    // Clean up the workspace layout
                    if (workspace.cleanUp) {
                        workspace.cleanUp();
                    }

                } else {
                    throw new Error("Load utility not available");
                }

            } catch (loadError) {
                console.error("Error loading bot with load utility:", loadError);

                // Enhanced fallback: try multiple approaches
                try {
                    console.log("Attempting enhanced fallback XML loading...");

                    // Try different XML parsing approaches
                    let xmlDoc;

                    // Approach 1: Use Blockly's textToDom
                    try {
                        xmlDoc = window.Blockly.utils.xml.textToDom(xmlContent);
                    } catch (e1) {
                        console.log("Blockly textToDom failed, trying DOMParser...");

                        // Approach 2: Use DOMParser and convert
                        try {
                            const parser = new DOMParser();
                            const parsedDoc = parser.parseFromString(xmlContent, 'application/xml');
                            xmlDoc = parsedDoc.documentElement;
                        } catch (e2) {
                            console.log("DOMParser failed, trying manual XML cleanup...");

                            // Approach 3: Clean up XML and try again
                            const cleanedXml = xmlContent
                                .replace(/xmlns="[^"]*"/g, '') // Remove namespace declarations that might cause issues
                                .replace(/\s+/g, ' ') // Normalize whitespace
                                .trim();

                            xmlDoc = window.Blockly.utils.xml.textToDom(cleanedXml);
                        }
                    }

                    if (!xmlDoc) {
                        throw new Error("Could not parse XML with any method");
                    }

                    // Thoroughly clear workspace again before fallback load
                    workspace.clear();
                    workspace.clearUndo();
                    workspace.cleanUp();

                    // Load XML directly
                    window.Blockly.Xml.domToWorkspace(xmlDoc, workspace);

                    // Update workspace properties
                    workspace.current_strategy_id = window.Blockly.utils.idGenerator.genUid();

                    // Clean up
                    workspace.cleanUp();
                    workspace.clearUndo();

                    console.log("Bot loaded successfully via enhanced fallback method!");

                } catch (fallbackError) {
                    console.error("Enhanced fallback loading also failed:", fallbackError);

                    // Final attempt: try to load what we can and ignore errors
                    try {
                        console.log("Attempting partial load with error tolerance...");

                        // Try to extract the main strategy blocks and load them individually
                        const strategyMatch = xmlContent.match(/<block[^>]*type="trade_definition"[\s\S]*?<\/block>/);
                        if (strategyMatch) {
                            const simpleXml = `<xml xmlns="https://developers.google.com/blockly/xml">${strategyMatch[0]}</xml>`;
                            const simpleDoc = window.Blockly.utils.xml.textToDom(simpleXml);
                            workspace.clear();
                            window.Blockly.Xml.domToWorkspace(simpleDoc, workspace);
                            workspace.cleanUp();
                            console.log("Partial bot loaded - main strategy block only");
                            alert("Bot loaded partially. Some advanced features may not be available.");
                        } else {
                            throw new Error("No recognizable strategy blocks found");
                        }
                    } catch (finalError) {
                        console.error("All loading attempts failed:", finalError);
                        alert("Failed to load the bot. The XML file may be corrupted or contain unsupported elements. Please try a different bot or contact support.");
                    }
                }
            }

        } catch (error) {
            console.error("Error loading bot:", error);
            alert("An unexpected error occurred while loading the bot. Please try again.");
        }
    }, [setActiveTab]);

    const handleOpen = useCallback(async () => {
        await load_modal.loadFileFromRecent();
        setActiveTab(DBOT_TABS.BOT_BUILDER);
        // rudderStackSendDashboardClickEvent({ dashboard_click_name: 'open', subpage_name: 'bot_builder' });
    }, [load_modal, setActiveTab]);

    // Digits Trading Bot Functions
  const connectToAPI = async () => {
    try {
      // Close existing connection if any
      if (websocket) {
        websocket.close()
        setWebsocket(null)
      }

      setCurrentPrice('Connecting...')
      setIsConnected(false)

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771')

      ws.onopen = () => {
        console.log('WebSocket connected successfully')
        setIsConnected(true)
        setWebsocket(ws)
        setCurrentPrice('Connected - Waiting for ticks...')

        // First, get historical ticks for the selected volatility
        const historyRequest = {
          ticks_history: selectedIndex,
          count: 5000,
          end: 'latest',
          style: 'ticks',
          req_id: 2
        }
        console.log('Requesting historical ticks:', historyRequest)
        ws.send(JSON.stringify(historyRequest))

        // Then subscribe to real-time tick stream
        const tickRequest = {
          ticks: selectedIndex,
          subscribe: 1,
          req_id: 1
        }
        console.log('Sending tick subscription request:', tickRequest)
        ws.send(JSON.stringify(tickRequest))
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('WebSocket message received:', data)

          // Handle historical tick data
          if (data.history && data.history.prices) {
            const symbol = data.echo_req.ticks_history
            const prices = data.history.prices.map(price => parseFloat(price))
            console.log(`Received ${prices.length} historical ticks for ${symbol}`)

            // Store historical ticks for this volatility
            setTickHistory(prev => ({
              ...prev,
              [symbol]: prices
            }))

            // Set current price to latest historical tick
            if (prices.length > 0) {
              const latestPrice = prices[prices.length - 1]
              setCurrentPrice(latestPrice.toFixed(5))

              // Calculate distributions for historical data
              calculateDigitDistribution(prices)
              analyzePatterns(prices)
              makePrediction(prices)
              calculateContractProbabilities(prices)
            }
          }

          // Handle real-time tick data
          if (data.tick && (data.tick.symbol === selectedIndex || getAlternativeSymbol(data.tick.symbol) === selectedIndex)) {
            console.log('Real-time tick received for', data.tick.symbol, ':', data.tick.quote)
            const price = parseFloat(data.tick.quote)
            if (!isNaN(price)) {
              setCurrentPrice(price.toFixed(5))
              handleNewTick(price, data.tick.symbol)
            }
          }

          // Handle subscription confirmation
          if (data.msg_type === 'tick' && data.subscription) {
            console.log('Tick subscription confirmed for:', data.subscription.id)
            setCurrentPrice('Connected - Receiving ticks for ' + selectedIndex)
          }

          // Handle errors
          if (data.error) {
            console.error('WebSocket API error:', data.error)
            setCurrentPrice(`Error: ${data.error.message}`)

            // Try alternative symbol formats for common volatility indices
            if (data.error.code === 'InvalidSymbol') {
              console.log('Invalid symbol, trying alternative format...')
              const altSymbol = getAlternativeSymbol(selectedIndex)
              if (altSymbol && altSymbol !== selectedIndex) {
                console.log('Trying alternative symbol:', altSymbol)
                const altRequest = {
                  ticks_history: altSymbol,
                  count: 5000,
                  end: 'latest',
                  style: 'ticks',
                  req_id: Date.now()
                }
                ws.send(JSON.stringify(altRequest))
              }
            }
          }

          // Handle forget_all response
          if (data.msg_type === 'forget_all') {
            console.log('All subscriptions forgotten successfully')
          }
        } catch (parseError) {
          console.error('Error parsing WebSocket message:', parseError)
          setCurrentPrice('Parse Error')
        }
      }

      ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason)
        setIsConnected(false)
        setWebsocket(null)
        setCurrentPrice('Disconnected')

        // Auto-reconnect after 3 seconds if not manually closed
        if (event.code !== 1000) {
          setTimeout(() => {
            console.log('Attempting to reconnect...')
            connectToAPI()
          }, 3000)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setIsConnected(false)
        setWebsocket(null)
        setCurrentPrice('Connection Error')
      }

    } catch (error) {
      console.error('Connection failed:', error)
      setIsConnected(false)
      setCurrentPrice('Failed to connect')
    }
  }

  // Helper function to get alternative symbol formats
  const getAlternativeSymbol = (symbol) => {
    const symbolMap = {
      // Forward mapping
      'R_10': '1HZ10V',
      'R_25': '1HZ25V',
      'R_50': '1HZ50V',
      'R_75': '1HZ75V',
      'R_100': '1HZ100V',
      'R_150': '1HZ150V',
      'R_200': '1HZ200V',
      'R_250': '1HZ250V',
      'R_300': '1HZ300V',
      // Reverse mapping
      '1HZ10V': 'R_10',
      '1HZ25V': 'R_25',
      '1HZ50V': 'R_50',
      '1HZ75V': 'R_75',
      '1HZ100V': 'R_100',
      '1HZ150V': 'R_150',
      '1HZ200V': 'R_200',
      '1HZ250V': 'R_250',
      '1HZ300V': 'R_300',
      // Boom/Crash indices
      'BOOM1000': 'BOOM1000',
      'CRASH1000': 'CRASH1000',
      'BOOM500': 'BOOM500',
      'CRASH500': 'CRASH500',
      'BOOM300': 'BOOM300',
      'CRASH300': 'CRASH300'
    }
    return symbolMap[symbol] || symbol
  }

  const handleNewTick = (tick: number, symbol: string) => {
    try {
      if (typeof tick !== 'number' || isNaN(tick)) {
        console.warn('Invalid tick received:', tick)
        return
      }

      console.log('Processing tick:', tick, 'for symbol:', symbol)

      // Update current tick and price display
      setCurrentTick(tick)
      const priceStr = tick.toFixed(5)
      setCurrentPrice(priceStr)

      // Store in tick history per volatility (keep last 5000 per symbol)
      setTickHistory(prev => {
        const currentHistory = prev[symbol] || []
        const newHistory = [...currentHistory, tick].slice(-5000)

        const updated = {
          ...prev,
          [symbol]: newHistory
        }

        // Only run analysis if we have enough data for current symbol
        if (newHistory.length >= 10) {
          // Calculate digit distribution with real-time updates
          calculateDigitDistribution(newHistory)

          // Perform enhanced pattern analysis
          analyzePatterns(newHistory)

          // Make AI-powered prediction
          makePrediction(newHistory)

          // Calculate contract-specific probabilities
          calculateContractProbabilities(newHistory)
        }

        return updated
      })

      // Execute trade if trading is active
      if (isTrading) {
        executeTradeDecision(tick)
      }
    } catch (error) {
      console.error('Error handling new tick:', error)
    }
  }

  const calculateContractProbabilities = (history: number[]) => {
    if (history.length < 10) return

    const recentTicks = history.slice(-100) // Use last 100 ticks for probability calculation
    const lastDigits = recentTicks.map(tick => Math.floor(Math.abs(tick * 100000)) % 10)

    // Calculate probabilities based on contract type
    let probabilities = {}

    if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
      const evenCount = lastDigits.filter(d => d % 2 === 0).length
      const oddCount = lastDigits.length - evenCount
      const total = lastDigits.length

      probabilities = {
        even: ((evenCount / total) * 100).toFixed(1),
        odd: ((oddCount / total) * 100).toFixed(1)
      }
    } else if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') {
      const underCount = lastDigits.filter(d => d < 5).length // 0,1,2,3,4
      const overCount = lastDigits.filter(d => d >= 5).length // 5,6,7,8,9
      const total = lastDigits.length

      probabilities = {
        under: ((underCount / total) * 100).toFixed(1),
        over: ((overCount / total) * 100).toFixed(1)
      }
    } else if (contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') {
      // For match/differs, show probability for each digit
      const digitCounts = new Array(10).fill(0)
      lastDigits.forEach(d => digitCounts[d]++)
      const total = lastDigits.length

      probabilities = {}
      for (let i = 0; i < 10; i++) {
        probabilities[`digit_${i}`] = ((digitCounts[i] / total) * 100).toFixed(1)
      }
    }

    // You can use these probabilities to update UI or make trading decisions
    console.log('Contract probabilities:', probabilities)
  }

  const calculateDigitDistribution = (history: number[]) => {
    if (history.length === 0) return

    const digitCounts = new Array(10).fill(0)

    // Count occurrences of each last digit
    history.forEach(tick => {
      const lastDigit = Math.floor(Math.abs(tick * 100000)) % 10
      digitCounts[lastDigit]++
    })

    setDigitDistribution(digitCounts)

    // Calculate percentages
    const total = history.length
    const percentages = digitCounts.map(count => total > 0 ? (count / total) * 100 : 10)
    setDigitPercentages(percentages)
  }

  const analyzePatterns = (history: number[]) => {
    if (history.length < 100) return

    try {
      const recentTicks = history.slice(-100)
      const lastDigits = recentTicks.map(tick => Math.floor(Math.abs(tick * 100000)) % 10)

      // Analyze even/odd bias
      const evenCount = lastDigits.filter(d => d % 2 === 0).length
      const oddCount = lastDigits.filter(d => d % 2 === 1).length

      if (evenCount > oddCount * 1.2) {
        setEvenOddBias('EVEN BIAS')
      } else if (oddCount > evenCount * 1.2) {
        setEvenOddBias('ODD BIAS')
      } else {
        setEvenOddBias('NEUTRAL')
      }

      // Analyze over/under bias (0-4 vs 5-9)
      const underCount = lastDigits.filter(d => d < 5).length
      const overCount = lastDigits.filter(d => d >= 5).length

      if (underCount > overCount * 1.2) {
        setOverUnderBias('UNDER BIAS')
      } else if (overCount > underCount * 1.2) {
        setOverUnderBias('OVER BIAS')
      } else {
        setOverUnderBias('NEUTRAL')
      }

      // Analyze streak patterns
      const streaks = []
      if (lastDigits.length > 0) {
        let currentStreakType = lastDigits[0] % 2
        let streakLength = 1

        for (let i = 1; i < lastDigits.length; i++) {
          if (lastDigits[i] % 2 === currentStreakType) {
            streakLength++
          } else {
            streaks.push(streakLength)
            currentStreakType = lastDigits[i] % 2
            streakLength = 1
          }
        }

        if (streaks.length > 0) {
          const avgStreak = streaks.reduce((a, b) => a + b, 0) / streaks.length
          setStreakPattern(`AVG: ${avgStreak.toFixed(1)}`)
        } else {
          setStreakPattern('---')
        }
      }
    } catch (error) {
      console.error('Error in pattern analysis:', error)
    }
  }

  const makePrediction = (history: number[]) => {
    if (history.length < 50) return

    try {
      const recentTicks = history.slice(-50)
      const lastDigits = recentTicks.map(tick => Math.floor(Math.abs(tick * 100000)) % 10)

      // Advanced prediction based on contract type
      if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
        const evenCount = lastDigits.filter(d => d % 2 === 0).length
        const oddCount = lastDigits.length - evenCount

        if (contractType === 'DIGITEVEN') {
          setNextPrediction(evenCount < oddCount ? 'EVEN' : 'ODD')
          setConfidence(Math.min(95, 60 + Math.abs(evenCount - oddCount) * 2))
        } else {
          setNextPrediction(oddCount < evenCount ? 'ODD' : 'EVEN')
          setConfidence(Math.min(95, 60 + Math.abs(evenCount - oddCount) * 2))
        }
      } else if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') {
        const underCount = lastDigits.filter(d => d < 5).length
        const overCount = lastDigits.length - underCount

        if (contractType === 'DIGITOVER') {
          setNextPrediction(overCount < underCount ? 'OVER' : 'UNDER')
          setConfidence(Math.min(95, 60 + Math.abs(overCount - underCount) * 2))
        } else {
          setNextPrediction(underCount < overCount ? 'UNDER' : 'OVER')
          setConfidence(Math.min(95, 60 + Math.abs(overCount - underCount) * 2))
        }
      } else {
        // For match/differs contracts, find least frequent digit
        const digitCounts = new Array(10).fill(0)
        lastDigits.forEach(d => digitCounts[d]++)
        const minCount = Math.min(...digitCounts)
        const leastFrequentDigit = digitCounts.indexOf(minCount)

        setNextPrediction(leastFrequentDigit.toString())
        setConfidence(Math.min(95, 50 + (10 - minCount) * 5))
      }
    } catch (error) {
      console.error('Error in prediction:', error)
    }
  }

  const executeTradeDecision = (tick: number) => {
    const lastDigit = tick % 10
    const timestamp = new Date().toLocaleTimeString()

    // Simple trading logic based on prediction
    let shouldTrade = false
    let tradeType = contractType

    if (contractType === 'DIGITEVEN' && nextPrediction === 'EVEN' && confidence > 70) {
      shouldTrade = true
    } else if (contractType === 'DIGITODD' && nextPrediction === 'ODD' && confidence > 70) {
      shouldTrade = true
        }

    if (shouldTrade) {
      // Simulate trade execution
      const isWin = Math.random() > 0.45 // 55% win rate simulation
      const pnl = isWin ? parseFloat(stakeAmount) * 0.95 : -parseFloat(stakeAmount)

      setTradingLog(prev => [...prev, {
        timestamp,
        action: `${tradeType} @ ${tick}`,
        result: isWin ? 'WIN' : 'LOSS',
        pnl: (pnl > 0 ? '+' : '') + pnl.toFixed(2),
        type: isWin ? 'win' : 'loss'
      }])

      setTotalTrades(prev => prev + 1)
      setProfitLoss(prev => prev + pnl)
      setCurrentStreak(prev => isWin ? (prev > 0 ? prev + 1 : 1) : (prev < 0 ? prev - 1 : -1))

      // Update win rate
      setWinRate(prev => {
        const wins = tradingLog.filter(log => log.type === 'win').length + (isWin ? 1 : 0)
        const total = totalTrades + 1
        return (wins / total) * 100
      })
    }
  }

  const startTrading = () => {
    if (!isConnected) return
    setIsTrading(true)

    setTradingLog(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      action: 'TRADING STARTED',
      result: 'SYSTEM',
      pnl: '---',
      type: 'system'
    }])
  }

  const stopTrading = () => {
    setIsTrading(false)

    setTradingLog(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      action: 'TRADING STOPPED',
      result: 'SYSTEM',
      pnl: '---',
      type: 'system'
    }])
  }

    const executePythonCode = useCallback(async () => {
        if (!pythonCode.trim()) {
            addOutput('error', 'No Python code to execute');
            return;
        }

        setIsExecuting(true);
        addOutput('info', 'Starting Python script execution...');

        try {
            // In a real implementation, this would send the code to a Python backend
            // For demo purposes, we'll simulate execution
            const response = await fetch('/api/execute-python', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code: pythonCode }),
            });

            if (response.ok) {
                const result = await response.json();
                addOutput('success', 'Script executed successfully');
                if (result.output) {
                    result.output.split('\n').forEach(line => {
                        if (line.trim()) {
                            addOutput('output', line);
                        }
                    });
                }
            } else {
                throw new Error('Failed to execute Python script');
            }
        } catch (error) {
            // Simulate Python execution for demo
            addOutput('info', 'Simulating Python script execution...');

            setTimeout(() => {
                addOutput('output', 'Starting auto trading script...');
                addOutput('output', 'Market: EUR/USD - Price: 1.0850 - Action: HOLD');
                addOutput('output', 'Market: EUR/USD - Price: 1.0865 - Action: BUY');
                addOutput('success', 'Trade executed: {"action": "BUY", "amount": 1.0, "status": "executed"}');
                addOutput('output', 'Auto trading script completed.');
                setIsExecuting(false);
            }, 2000);

            return;
        }

        setIsExecuting(false);
    }, [pythonCode]);

    const clearPythonCode = useCallback(() => {
        setPythonCode('');
        setPythonOutput([]);
        addOutput('info', 'Editor cleared');
    }, []);

    const savePythonScript = useCallback(() => {
        if (!pythonCode.trim()) {
            addOutput('error', 'No code to save');
            return;
        }

        const scriptName = prompt('Enter script name:');
        if (scriptName) {
            const newScript = {
                name: scriptName,
                code: pythonCode,
                created: new Date().toISOString(),
            };

            const updatedScripts = [...savedScripts, newScript];
            setSavedScripts(updatedScripts);
            localStorage.setItem('pythonTradingScripts', JSON.stringify(updatedScripts));
            addOutput('success', `Script '${scriptName}' saved successfully`);
        }
    }, [pythonCode, savedScripts]);

    const loadSavedScript = useCallback((scriptName) => {
        if (!scriptName) return;

        const script = savedScripts.find(s => s.name === scriptName);
        if (script) {
            setPythonCode(script.code);
            addOutput('info', `Loaded script: ${scriptName}`);
        }
    }, [savedScripts]);

    const addOutput = useCallback((type, content) => {
        const newLine = {
            type,
            content,
            timestamp: new Date().toLocaleTimeString(),
        };
        setPythonOutput(prev => [...prev, newLine]);
    }, []);

    const loadTemplate = useCallback((templateType) => {
        const templates = {
            basic_strategy: `# Basic Trading Strategy Template
import time
from datetime import datetime

def simple_trading_strategy():
    """Basic buy/sell strategy based on price movements"""
    print("Executing basic trading strategy...")

    # Simulate market analysis
    current_price = 1.0850
    support_level = 1.0800
    resistance_level = 1.0900

    if current_price < support_level:
        print(f"Price {current_price} below support {support_level} - BUY signal")
        return "BUY"
    elif current_price > resistance_level:
        print(f"Price {current_price} above resistance {resistance_level} - SELL signal")
        return "SELL"
    else:
        print(f"Price {current_price} in range - HOLD")
        return "HOLD"

if __name__ == "__main__":
    action = simple_trading_strategy()
    print(f"Trading action: {action}")`,

            moving_average: `# Moving Average Strategy Template
import numpy as np
from datetime import datetime

def moving_average_strategy(prices, short_period=5, long_period=20):
    """Moving average crossover strategy"""
    print("Calculating moving averages...")

    # Sample price data
    prices = [1.0800, 1.0820, 1.0850, 1.0840, 1.0860, 1.0880, 1.0870, 1.0890]

    if len(prices) < long_period:
        print("Not enough data for moving average calculation")
        return "HOLD"

    short_ma = sum(prices[-short_period:]) / short_period
    long_ma = sum(prices[-long_period:]) / long_period

    print(f"Short MA ({short_period}): {short_ma:.4f}")
    print(f"Long MA ({long_period}): {long_ma:.4f}")

    if short_ma > long_ma:
        print("Short MA above Long MA - BUY signal")
        return "BUY"
    elif short_ma < long_ma:
        print("Short MA below Long MA - SELL signal")
        return "SELL"
    else:
        return "HOLD"

if __name__ == "__main__":
    action = moving_average_strategy([])
    print(f"Trading action: {action}")`,

            risk_management: `# Risk Management Template
def calculate_position_size(account_balance, risk_percent, stop_loss_pips):
    """Calculate position size based on risk management rules"""
    risk_amount = account_balance * (risk_percent / 100)
    position_size = risk_amount / stop_loss_pips

    print(f"Account Balance: ${account_balance}")
    print(f"Risk Percentage: {risk_percent}%")
    print(f"Risk Amount: ${risk_amount}")
    print(f"Stop Loss: {stop_loss_pips} pips")
    print(f"Calculated Position Size: {position_size}")

    return position_size

def risk_management_check(current_trades, max_trades, daily_loss_limit):
    """Check risk management parameters"""
    print("Performing risk management checks...")

    if current_trades >= max_trades:
        print(f"Maximum trades ({max_trades}) reached for today")
        return False

    # Simulate daily P&L check
    daily_pnl = -150  # Example loss
    if daily_pnl <= -daily_loss_limit:
        print(f"Daily loss limit (${daily_loss_limit}) reached")
        return False

    print("Risk management checks passed")
    return True

if __name__ == "__main__":
    position_size = calculate_position_size(10000, 2, 50)
    can_trade = risk_management_check(3, 5, 200)
    print(f"Can place trade: {can_trade}")`,

            api_integration: `# API Integration Template
import json
import time
from datetime import datetime

class TradingAPI:
    """Mock trading API integration"""

    def __init__(self, api_key, demo_mode=True):
        self.api_key = api_key
        self.demo_mode = demo_mode
        print(f"Initialized Trading API in {'demo' if demo_mode else 'live'} mode")

    def get_market_data(self, symbol):
        """Fetch real-time market data"""
        # Mock API response
        data = {
            'symbol': symbol,
            'bid': 1.0845,
            'ask': 1.0847,
            'timestamp': datetime.now().isoformat()
        }
        print(f"Market data for {symbol}: {data}")
        return data

    def place_order(self, symbol, order_type, volume):
        """Place trading order"""
        order = {
            'order_id': f"ORD_{int(time.time())}",
            'symbol': symbol,
            'type': order_type,
            'volume': volume,
            'status': 'filled' if self.demo_mode else 'pending',
            'timestamp': datetime.now().isoformat()
        }
        print(f"Order placed: {order}")
        return order

    def get_account_info(self):
        """Get account information"""
        account = {
            'balance': 10000.00,
            'equity': 10150.00,
            'margin': 50.00,
            'free_margin': 10100.00
        }
        print(f"Account info: {account}")
        return account

def automated_trading():
    """Main automated trading function"""
    api = TradingAPI("your_api_key_here", demo_mode=True)

    # Get account info
    account = api.get_account_info()

    # Analyze market
    market_data = api.get_market_data("EURUSD")

    # Simple trading logic
    if market_data['bid'] > 1.0850:
        order = api.place_order("EURUSD", "SELL", 0.1)
        print(f"Sell order executed: {order['order_id']}")
    elif market_data['ask'] < 1.0840:
        order = api.place_order("EURUSD", "BUY", 0.1)
        print(f"Buy order executed: {order['order_id']}")
    else:
        print("No trading signal - waiting...")

if __name__ == "__main__":
    automated_trading()`
        };

        if (templates[templateType]) {
            setPythonCode(templates[templateType]);
            addOutput('info', `Loaded ${templateType.replace('_', ' ')} template`);
        }
    }, [addOutput]);

    // Load saved scripts on component mount
    useEffect(() => {
        const saved = localStorage.getItem('pythonTradingScripts');
        if (saved) {
            try {
                setSavedScripts(JSON.parse(saved));
            } catch (error) {
                console.error('Error loading saved scripts:', error);
            }
        }
    }, []);

    useEffect(() => {
      if (active_tab === 'auto-trades') {
        // Auto trades specific logic can go here
      }

      // Cleanup WebSocket connection on unmount
      return () => {
        if (websocket) {
          websocket.close()
          setWebsocket(null)
          setIsConnected(false)
        }
      }
    }, [active_tab])

    // Reconnect when volatility changes
    useEffect(() => {
      if (isConnected && websocket && websocket.readyState === WebSocket.OPEN) {
        console.log('Volatility changed to:', selectedIndex, 'Getting data...')

        // Unsubscribe from all ticks first
        websocket.send(JSON.stringify({
          forget_all: "ticks",
          req_id: 99
        }))

        // Get historical data and subscribe to new symbol after a short delay
        setTimeout(() => {
          // Check if we already have data for this volatility
          const currentVolatilityHistory = tickHistory[selectedIndex]

          if (!currentVolatilityHistory || currentVolatilityHistory.length === 0) {
            // Request historical ticks if we don't have them
            const historyRequest = {
              ticks_history: selectedIndex,
              count: 5000,
              end: 'latest',
              style: 'ticks',
              req_id: Date.now()
            }
            console.log('Requesting historical ticks for new volatility:', historyRequest)
            websocket.send(JSON.stringify(historyRequest))
          } else {
            // Use existing data for immediate display
            calculateDigitDistribution(currentVolatilityHistory)
            analyzePatterns(currentVolatilityHistory)
            makePrediction(currentVolatilityHistory)
            calculateContractProbabilities(currentVolatilityHistory)

            if (currentVolatilityHistory.length > 0) {
              const latestPrice = currentVolatilityHistory[currentVolatilityHistory.length - 1]
              setCurrentPrice(latestPrice.toFixed(5))
            }
          }

          // Subscribe to real-time ticks
          const newTickRequest = {
            ticks: selectedIndex,
            subscribe: 1,
            req_id: Date.now() + 1
          }
          console.log('Sending new tick subscription:', newTickRequest)
          websocket.send(JSON.stringify(newTickRequest))
        }, 500)

        setCurrentPrice('Loading ' + selectedIndex + ' data...')
        setCurrentTick(null)
      } else if (!isConnected) {
        // If not connected, reset display
        setCurrentPrice('Not connected - Select ' + selectedIndex)
        setCurrentTick(null)
      }
    }, [selectedIndex, isConnected, websocket, tickHistory])


    // Always show run panel on all pages
    const showRunPanel = true;


    return (
        <>
            <div className='main'>
                <div className='main__container main-content'>
                    <Tabs active_index={active_tab} className='main__tabs' onTabItemChange={onEntered} onTabItemClick={handleTabChange} top>
                        <div label={<><AITraderIcon /><Localize i18n_default_text='🤖 ML Trader' /></>} id='id-ml-trader'>
                            <div className={classNames('dashboard__chart-wrapper', {
                                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                            })}>
                                <MLTrader />
                            </div>
                        </div>
                        <div label={<><BotBuilderIcon /><Localize i18n_default_text='Bot Builder' /></>} id='id-bot-builder' />
                        <div label={<><FreeBotsIcon /><Localize i18n_default_text='Free Bots' /></>} id='id-free-bots'>

<div className='free-bots-container'>
                            <Tabs active_index={0} className='free-bots-tabs' top>
                                <div label={<Localize i18n_default_text='Free Bots' />} id='id-free-bots-list'>
                                    <div className='free-bots'>
                                        <h2 className='free-bots__heading'><Localize i18n_default_text='Free Bots' /></h2>
                                        <div className='free-bots__content-wrapper'>
                                            <div className='free-bots__content'>
                                                {bots.map((bot, index) => (
                                                    <div
                                                        className={`free-bot-card ${bot.isPlaceholder ? 'free-bot-card--loading' : ''}`}
                                                        key={index}
                                                        onClick={() => {
                                                            handleBotClick(bot);
                                                        }}
                                                        style={{
                                                            cursor: 'pointer',
                                                            opacity: bot.isPlaceholder ? 0.7 : 1
                                                        }}
                                                    >
                                                        <div className='free-bot-card__icon'>
                                                            <svg width="48" height="48" viewBox="0 0 24 24" fill="#1976D2">
                                                                <path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z"/>
                                                                <rect x="6" y="10" width="12" height="8" rx="2" fill="#1976D2"/>
                                                                <circle cx="9" cy="13" r="1.5" fill="white"/>
                                                                <circle cx="15" cy="13" r="1.5" fill="white"/>
                                                                <rect x="10" y="15" width="4" height="1" rx="0.5" fill="white"/>
                                                                <rect x="4" y="12" width="2" height="4" rx="1" fill="#1976D2"/>
                                                                <rect x="18" y="12" width="2" height="4" rx="1" fill="#1976D2"/>
                                                            </svg>
                                                        </div>
                                                        <div className='free-bot-card__details'>
                                                            <h3 className='free-bot-card__title'>{bot.title}</h3>
                                                            <p className='free-bot-card__description'>{bot.description}</p>
                                                            <p className='free-bot-card__action'>
                                                                {bot.isPlaceholder ? 'Loading bot...' : 'Click to load this bot'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div label={<Localize i18n_default_text='Smart Trading' />} id='smart-trading'>
                                    <VolatilityAnalyzer />
                                </div>
                            </Tabs>
                        </div>

                        </div>
                        <div label={<><TradingHubIcon /><Localize i18n_default_text='Trading Hub' /></>} id='id-Trading-Hub'>
                            <div className={classNames('dashboard__chart-wrapper', {
                                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                            })}>
                                <TradingHubDisplay />
                            </div>
                        </div>
                        <div label={<><AnalysisToolIcon /><Localize i18n_default_text='Analysis Tool' /></>} id='id-analysis-tool'>
                            <div className={classNames('dashboard__chart-wrapper', {
                                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                            })}>
                                <Tabs
                                    className="analysis-tool-tabs"
                                    active_tab_icon_color="var(--brand-secondary)"
                                    background_color="var(--general-main-1)"
                                    single_tab_has_no_label
                                    should_update_hash={false}
                                >
                                    <div label={<Localize i18n_default_text='Technical Analysis' />} id='technical-analysis'>
                                        <AnalysistoolComponent />
                                    </div>
                                    <div label={<Localize i18n_default_text='Market Analyzer' />} id='market-analyzer'>
                                        <iframe
                                            src="https://api.binarytool.site/"
                                            title="Market Analyzer"
                                        />
                                    </div>
                                </Tabs>
                            </div>
                        </div>
                        <div label={<><SignalsIcon /><Localize i18n_default_text='Signal Scanner' /></>} id='id-signals'>
                            <div className={classNames('dashboard__chart-wrapper', {
                                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                            })}>
                                <iframe
                                    src="https://tracktool.netlify.app/signals.html"
                                    width="100%"
                                    height="100%"
                                    style={{
                                        border: 'none',
                                        display: 'block',
                                        minHeight: '600px',
                                        height: 'calc(100vh - 200px)'
                                    }}
                                    scrolling="yes"
                                    title="Trading Signals"
                                />
                            </div>
                        </div>
                        <div label={<><ChartsIcon /><Localize i18n_default_text='Charts' /></>} id='id-charts'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading chart...')} />}>
                                <Chart show_digits_stats={false} />                            </Suspense>
                        </div>
                        <div label={<><TutorialsIcon /><Localize i18n_default_text='Tutorials' /></>} id='id-tutorials'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading tutorials...')} />}>
                                <Tutorial handleTabChange={handleTabChange} />
                            </Suspense>
                        </div>
                        <div label={<><AITraderIcon /><Localize i18n_default_text='AI Trader' /></>} id='id-ai-trader'>
                            <SmartTrader />
                        </div>
                        <div label={<><DashboardIcon /><Localize i18n_default_text='Dashboard' /></>} id='id-dbot-dashboard'>
                            <Dashboard handleTabChange={handleTabChange} />
                            <button onClick={handleOpen}>Load Bot</button>
                        </div>
                    </Tabs>
                </div>
            </div>
            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    {showRunPanel && <RunPanel />}
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>
            <MobileWrapper>
                <RunPanel />
            </MobileWrapper>
            <Dialog cancel_button_text={cancel_button_text || localize('Cancel')} confirm_button_text={ok_button_text || localize('Ok')} has_close_icon is_visible={is_dialog_open} onCancel={onCancelButtonClick} onClose={onCloseDialog} onConfirm={onOkButtonClick || onCloseDialog} title={title}>
                {message}
            </Dialog>
        </>
    );
});

export default AppWrapper;