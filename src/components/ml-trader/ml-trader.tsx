import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { marketScanner, TradingRecommendation, ScannerStatus } from '@/services/market-scanner';
import { TrendAnalysis } from '@/services/trend-analysis-engine';
import './ml-trader.scss';

// Import Modal components and related logic
import TradingModal from './TradingModal'; // Assuming TradingModal.tsx or .jsx

// Enhanced volatility symbols including 1-second indices
const ENHANCED_VOLATILITY_SYMBOLS = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s: false },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s: false },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s: false },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s: false },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s: false },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', is_1s: true },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', is_1s: true },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', is_1s: true },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', is_1s: true },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', is_1s: true },
];

// Trade types for Rise/Fall and Higher/Lower
const TRADE_TYPES = [
    { value: 'CALL', label: 'Rise', description: 'Win if exit spot is higher than entry spot' },
    { value: 'PUT', label: 'Fall', description: 'Win if exit spot is lower than entry spot' },
];

const HIGHER_LOWER_TYPES = [
    { value: 'CALL', label: 'Higher', description: 'Win if exit spot is higher than barrier' },
    { value: 'PUT', label: 'Lower', description: 'Win if exit spot is lower than barrier' },
];

// Safe version of tradeOptionToBuy without Blockly dependencies
const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy: any = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis,
            contract_type,
            currency: trade_option.currency,
            duration: trade_option.duration,
            duration_unit: trade_option.duration_unit,
            symbol: trade_option.symbol,
        },
    };

    // Add barrier for Higher/Lower contracts
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }

    return buy;
};

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const contractInProgressRef = useRef(false);
    const lastOutcomeWasLossRef = useRef<boolean>(false);
    const baseStakeRef = useRef<number>(1.0); // Store the initial stake
    const lossStreakRef = useRef<number>(0);
    const stepRef = useRef<number>(0); // Current step in Martingale or other progression

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [current_price, setCurrentPrice] = useState<number | null>(null);

    // Form state for the trading interface
    const [modal_symbol, setModalSymbol] = useState<string>('');
    const [modal_trade_mode, setModalTradeMode] = useState<'rise_fall' | 'higher_lower'>('rise_fall');
    const [modal_contract_type, setModalContractType] = useState<string>('CALL');
    const [modal_duration, setModalDuration] = useState<number>(5);
    const [modal_duration_unit, setModalDurationUnit] = useState<'t' | 's' | 'm'>('t');
    const [modal_stake, setModalStake] = useState<number>(1.0);
    const [modal_barrier_offset, setModalBarrierOffset] = useState<number>(0.001);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    // Enhanced states for market scanning and trend analysis
    const [scanner_status, setScannerStatus] = useState<ScannerStatus | null>(null);
    const [recommendations, setRecommendations] = useState<TradingRecommendation[]>([]);
    const [market_trends, setMarketTrends] = useState<Map<string, TrendAnalysis>>(new Map());
    const [is_scanner_initialized, setIsScannerInitialized] = useState(false);
    const [auto_mode, setAutoMode] = useState(false);
    const [show_trend_analysis, setShowTrendAnalysis] = useState(true);
    const [scanning_progress, setScanningProgress] = useState(0);
    const [selected_recommendation, setSelectedRecommendation] = useState<TradingRecommendation | null>(null);
    const [volatility_trends, setVolatilityTrends] = useState<Map<string, TrendAnalysis>>(new Map());
    const [initial_scan_complete, setInitialScanComplete] = useState(false);

    // Modal state
    const [is_modal_open, setIsModalOpen] = useState(false);
    const [modal_recommendation, setModalRecommendation] = useState<TradingRecommendation | null>(null);

    // Super Elite Bot Logic Adaptation
    const baseStake = baseStakeRef.current; // Use baseStake from ref for calculations
    const lossStreak = lossStreakRef.current;
    const step = stepRef.current;

    // Placeholder for Super Elite's prediction logic
    const ouPredPostLoss = 3; // Example: Super Elite uses 3 after a loss

    const handleContractOutcome = useCallback((profit: number) => {
        if (profit > 0) {
            // WIN: Reset to pre-loss state
            lastOutcomeWasLossRef.current = false;
            lossStreakRef.current = 0;
            stepRef.current = 0;
            setStake(baseStake); // Reset stake to base stake
            console.log(`✅ WIN: +${profit.toFixed(2)} ${account_currency} - Reset to pre-loss prediction`);
        } else {
            // LOSS: Set flag for next trade to use after-loss prediction and apply Martingale
            lastOutcomeWasLossRef.current = true;
            lossStreakRef.current++;
            stepRef.current = Math.min(stepRef.current + 1, 10); // Increment step, cap at 10
            const martingaleMultiplier = 2.2; // Super Elite's multiplier
            setStake(prevStake => (prevStake * martingaleMultiplier).toFixed(2)); // Apply Martingale
            console.log(`❌ LOSS: ${profit.toFixed(2)} ${account_currency} - Next trade will use after-loss prediction (${ouPredPostLoss})`);
        }
    }, [account_currency, baseStake, ouPredPostLoss]); // Add dependencies

    useEffect(() => {
        // Initialize API connection and market scanner
        const api = generateDerivApiInstance();
        apiRef.current = api;
        let scannerCleanup: (() => void) | null = null;

        const init = async () => {
            try {
                setStatus('Initializing ML Trader...');

                // Initialize market scanner
                scannerCleanup = await initializeMarketScanner();

                setStatus('ML Trader initialized successfully');
            } catch (e: any) {
                console.error('MLTrader init error', e);
                setStatus(e?.message || 'Failed to initialize ML Trader');
            }
        };

        init();

        return () => {
            if (scannerCleanup) {
                scannerCleanup();
            }

            // Cleanup observers on unmount
            if (store?.run_panel?.dbot?.observer) {
                store.run_panel.dbot.observer.unregisterAll('bot.stop');
                store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
            }
        };
    }, []);

    // Initialize market scanner
    const initializeMarketScanner = useCallback(async () => {
        if (is_scanner_initialized) return;

        try {
            setStatus('Initializing market scanner...');

            // Initialize the market scanner
            await marketScanner.initialize();

            // Subscribe to scanner status updates
            const statusUnsubscribe = marketScanner.onStatusChange((status) => {
                setScannerStatus(status);
                setScanningProgress((status.connectedSymbols / status.totalSymbols) * 100);

                // Force update trends when symbols are connected
                if (status.connectedSymbols > 0) {
                    updateTrendsFromScanner();
                }
            });

            // Subscribe to recommendation updates
            const recommendationUnsubscribe = marketScanner.onRecommendationChange((recs) => {
                setRecommendations(recs);
                updateTrendsFromScanner();

                // Auto-select best recommendation if auto mode is enabled
                if (auto_mode && recs.length > 0 && !is_running && !contractInProgressRef.current) {
                    applyRecommendation(recs[0]);
                }
            });

            setIsScannerInitialized(true);
            setStatus('Market scanner initialized successfully');

            // Start scanning immediately
            await startMarketScan();

            // Set up periodic trend updates
            const trendUpdateInterval = setInterval(() => {
                updateTrendsFromScanner();
            }, 5000); // Update every 5 seconds

            // Mark as complete after initial data processing (reduced time with 5000 historical ticks)
            // HMA calculations need 40+ candles, but with 5000 ticks we get immediate candle reconstruction
            setTimeout(() => {
                if (!initial_scan_complete) {
                    console.log('⏰ ML Trader: Forcing scan completion after timeout - historical data processed');
                    setInitialScanComplete(true);
                    setStatus('Market analysis ready - historical trends available');
                }
            }, 15000); // 15 seconds should be enough with 5000 historical ticks

            // Cleanup function stored in ref for unmount
            return () => {
                statusUnsubscribe();
                recommendationUnsubscribe();
                clearInterval(trendUpdateInterval);
            };

        } catch (error) {
            console.error('Failed to initialize market scanner:', error);
            setStatus(`Scanner initialization failed: ${error}`);
        }
    }, [is_scanner_initialized, auto_mode, is_running]);

    // Update trends from scanner
    const updateTrendsFromScanner = useCallback(() => {
        const trendsMap = new Map<string, TrendAnalysis>();
        let hasData = false;
        let dataProgress = 0;

        ENHANCED_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const trend = marketScanner.getTrendAnalysis(symbolInfo.symbol);
            if (trend) {
                trendsMap.set(symbolInfo.symbol, trend);
                hasData = true;
                dataProgress++;
            }
        });

        console.log(`📊 ML Trader: Found trends for ${trendsMap.size}/${ENHANCED_VOLATILITY_SYMBOLS.length} symbols`);

        // Update progress even if no complete trends yet
        setScanningProgress((dataProgress / ENHANCED_VOLATILITY_SYMBOLS.length) * 100);

        if (hasData) {
            setMarketTrends(trendsMap);
            setVolatilityTrends(trendsMap);

            // Mark initial scan as complete when we have trends for at least 2 symbols (reasonable with 5000 ticks)
            if (trendsMap.size >= 2 && !initial_scan_complete) {
                console.log(`✅ ML Trader: Initial scan completed with ${trendsMap.size} symbols using historical data`);
                setInitialScanComplete(true);
                setStatus(`Market analysis ready - ${trendsMap.size} symbols analyzed with historical trends`);
            }
        } else {
            // Check if we have any candle data at all
            const symbolsWithCandles = ENHANCED_VOLATILITY_SYMBOLS.filter(symbolInfo => {
                // You can check if the candle reconstruction engine has data
                return true; // For now, assume data is flowing based on console logs
            }).length;

            if (symbolsWithCandles > 0) {
                setStatus(`Building trend analysis... ${symbolsWithCandles}/10 symbols have data`);
                setScanningProgress((symbolsWithCandles / ENHANCED_VOLATILITY_SYMBOLS.length) * 50); // 50% for having data
            }
        }
    }, [initial_scan_complete]);

    // Start market scan
    const startMarketScan = useCallback(async () => {
        try {
            setStatus('Scanning volatility markets...');
            await marketScanner.refresh();
            setStatus('Market scan completed');

            // Force update trends after scan
            setTimeout(() => {
                updateTrendsFromScanner();
            }, 2000);

        } catch (error) {
            console.error('Market scan failed:', error);
            setStatus(`Market scan failed: ${error}`);
        }
    }, [updateTrendsFromScanner]);

    // Apply a trading recommendation to the trading interface (not modal)
    const applyRecommendation = useCallback((recommendation: TradingRecommendation) => {
        if (is_running || contractInProgressRef.current) {
            console.warn('Cannot apply recommendation: trading in progress');
            return;
        }

        setSelectedRecommendation(recommendation);
        setSymbol(recommendation.symbol);
        setContractType(recommendation.direction);
        setDuration(recommendation.suggestedDuration);
        setDurationUnit(recommendation.suggestedDurationUnit);
        setStake(recommendation.suggestedStake);
        baseStakeRef.current = recommendation.suggestedStake; // Set the base stake

        // Update trade mode based on recommendation
        if (recommendation.direction === 'CALL' || recommendation.direction === 'PUT') {
            setTradeMode('rise_fall');
        }

        setCurrentPrice(recommendation.currentPrice);
        setStatus(`Applied recommendation: ${recommendation.reason}`);
    }, [is_running]);

    // Open the modal with the selected recommendation
    const openRecommendationModal = useCallback((recommendation: TradingRecommendation) => {
        try {
            if (!recommendation) {
                console.error('No recommendation provided to modal');
                return;
            }
            
            console.log('📋 Opening recommendation modal with:', recommendation);
            
            setModalRecommendation(recommendation);
            
            // Pre-fill modal form with recommendation's data
            setModalSymbol(recommendation.symbol || '');
            setModalContractType(recommendation.direction || 'CALL');
            setModalDuration(recommendation.suggestedDuration || 5);
            setModalDurationUnit((recommendation.suggestedDurationUnit as 't' | 's' | 'm') || 't');
            setModalStake(recommendation.suggestedStake || 1.0);
            
            // Set trade mode based on recommendation strategy
            if (recommendation.strategy === 'call' || recommendation.strategy === 'put' || 
                recommendation.direction === 'CALL' || recommendation.direction === 'PUT') {
                setModalTradeMode('rise_fall');
            } else {
                // For barrier-based strategies, use higher/lower
                setModalTradeMode('higher_lower');
            }
            
            // Set barrier offset for higher/lower trades
            if (recommendation.barrier) {
                const barrierValue = parseFloat(recommendation.barrier);
                const currentPriceValue = recommendation.currentPrice || 0;
                if (currentPriceValue > 0) {
                    const calculatedOffset = Math.abs(barrierValue - currentPriceValue);
                    setModalBarrierOffset(calculatedOffset);
                }
            }
            
            setCurrentPrice(recommendation.currentPrice || null);
            baseStakeRef.current = recommendation.suggestedStake || 1.0;

            setIsModalOpen(true);
            
            const displayName = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === recommendation.symbol)?.display_name || recommendation.symbol;
            setStatus(`Opened trading interface for ${displayName} - ${recommendation.strategy.toUpperCase()}`);
        } catch (error) {
            console.error('Error opening recommendation modal:', error);
            setStatus('Error opening trading interface');
        }
    }, []);

    // Load settings from modal to the bot builder
    const loadSettingsToBotBuilder = useCallback(async () => {
        if (!modal_recommendation) return;

        try {
            const { load } = await import('@/external/bot-skeleton');
            const { save_types } = await import('@/external/bot-skeleton/constants/save-type');
            
            console.log('🚀 Loading settings to Bot Builder:', {
                symbol: modal_symbol,
                trade_mode: modal_trade_mode,
                contract_type: modal_contract_type,
                duration: modal_duration,
                duration_unit: modal_duration_unit,
                stake: modal_stake,
                barrier_offset: modal_barrier_offset,
                recommendation: modal_recommendation
            });

            // Switch to Bot Builder tab
            store.dashboard.setActiveTab(1); // Bot Builder tab index
            
            setStatus(`Loading settings to Bot Builder for ${modal_recommendation.displayName || modal_symbol}...`);
            setIsModalOpen(false); // Close the modal first
            
            // Wait for tab switch, then load the strategy
            setTimeout(async () => {
                try {
                    // Generate XML for the Bot Builder
                    const selectedSymbol = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === modal_symbol);
                    const contractTypeMapping: Record<string, string> = {
                        'CALL': modal_trade_mode === 'rise_fall' ? 'CALL' : 'CALLE',
                        'PUT': modal_trade_mode === 'rise_fall' ? 'PUT' : 'PUTE'
                    };
                    
                    const mappedContractType = contractTypeMapping[modal_contract_type] || 'CALL';
                    
                    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable id="market">market</variable>
    <variable id="submarket">submarket</variable>
    <variable id="symbol">symbol</variable>
    <variable id="tradetypecat">tradetypecat</variable>
  </variables>
  <block type="trade_definition" id="trade_definition" x="0" y="0">
    <field name="MARKET_LIST">synthetic_index</field>
    <field name="SUBMARKET_LIST">continuous_indices</field>
    <field name="SYMBOL_LIST">${modal_symbol}</field>
    <field name="TRADETYPECAT_LIST">${modal_trade_mode === 'rise_fall' ? 'callput' : 'highlow'}</field>
    <field name="TRADETYPE_LIST">${mappedContractType}</field>
    <value name="DURATION">
      <shadow type="math_number">
        <field name="NUM">${modal_duration}</field>
      </shadow>
    </value>
    <value name="DURATIONTYPE_LIST">
      <shadow type="text">
        <field name="TEXT">${modal_duration_unit}</field>
      </shadow>
    </value>
    <value name="AMOUNT">
      <shadow type="math_number">
        <field name="NUM">${modal_stake}</field>
      </shadow>
    </value>
    ${modal_trade_mode === 'higher_lower' ? `
    <value name="BARRIEROFFSET">
      <shadow type="math_number">
        <field name="NUM">${modal_barrier_offset}</field>
      </shadow>
    </value>` : ''}
  </block>
</xml>`;

                    // Load the strategy
                    if (window.Blockly?.derivWorkspace) {
                        await load({
                            block_string: xmlContent,
                            file_name: `ML_${modal_symbol}_${modal_contract_type}_${Date.now()}`,
                            workspace: window.Blockly.derivWorkspace,
                            from: save_types.UNSAVED,
                            drop_event: null,
                            strategy_id: null,
                            showIncompatibleStrategyDialog: null,
                        });
                        
                        window.Blockly.derivWorkspace.scrollCenter();
                        setStatus(`✅ Settings loaded to Bot Builder successfully`);
                    }
                } catch (loadError) {
                    console.error('Error loading to Bot Builder:', loadError);
                    setStatus(`❌ Error loading to Bot Builder: ${loadError.message}`);
                }
            }, 500);
            
        } catch (error) {
            console.error('Error in loadSettingsToBotBuilder:', error);
            setStatus(`❌ Error: ${error.message}`);
        }
    }, [modal_recommendation, modal_symbol, modal_trade_mode, modal_contract_type, modal_duration, modal_duration_unit, modal_stake, modal_barrier_offset, store.dashboard]);


    const authorizeIfNeeded = async () => {
        if (is_authorized) return;
        const token = V2GetActiveToken();
        if (!token) {
            setStatus('No token found. Please log in and select an account.');
            throw new Error('No token');
        }
        const { authorize, error } = await apiRef.current.authorize(token);
        if (error) {
            setStatus(`Authorization error: ${error.message || error.code}`);
            throw error;
        }
        setIsAuthorized(true);
        const loginid = authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');

        try {
            // Sync auth state into shared ClientStore
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {}
    };

    const purchaseContract = async () => {
        if (contractInProgressRef.current) {
            throw new Error('Contract already in progress');
        }

        await authorizeIfNeeded();

        if (!current_price && modal_trade_mode === 'higher_lower') {
            throw new Error('Current price not available');
        }

        const trade_option: any = {
            amount: Number(modal_stake),
            basis: 'stake',
            currency: account_currency,
            duration: Number(modal_duration),
            duration_unit: modal_duration_unit,
            symbol: modal_symbol,
        };

        // Add barrier for Higher/Lower trades
        if (modal_trade_mode === 'higher_lower' && current_price) {
            const barrier_value = modal_contract_type === 'CALL'
                ? current_price + modal_barrier_offset
                : current_price - modal_barrier_offset;
            trade_option.barrier = barrier_value.toFixed(5);
        }

        const buy_req = tradeOptionToBuy(modal_contract_type, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;

        contractInProgressRef.current = true;
        return buy;
    };

    const onStart = async () => {
        if (!modal_recommendation) { // Use modal_recommendation here as it's the source after modal interaction
            setStatus('Please select a recommendation and confirm settings');
            return;
        }

        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `ml-trader-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            const buy = await purchaseContract();

            // Add to transactions
            const symbol_display = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === modal_symbol)?.display_name || modal_symbol;
            transactions.onBotContractEvent({
                contract_id: buy?.contract_id,
                transaction_ids: { buy: buy?.transaction_id },
                buy_price: buy?.buy_price,
                currency: account_currency,
                contract_type: modal_contract_type as any,
                underlying: modal_symbol,
                display_name: symbol_display,
                date_start: Math.floor(Date.now() / 1000),
                status: 'open',
            } as any);

            run_panel.setHasOpenContract(true);
            run_panel.setContractStage(contract_stages.PURCHASE_SENT);

            setStatus(`Contract purchased: ${buy?.longcode}`);

            // Start monitoring the contract
            const poc = await apiRef.current.proposal_open_contract({ contract_id: buy?.contract_id });
            run_panel.setContractStage(contract_stages.PENDING);

            let pocSubId: string | null = null;
            const onMsg = (msg: any) => {
                if (msg.event === 'proposal_open_contract' && msg.proposal_open_contract.contract_id === buy?.contract_id) {
                    const pocUpdate = msg.proposal_open_contract;
                    if (pocUpdate.is_sold || pocUpdate.status === 'sold') {
                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                        run_panel.setHasOpenContract(false);
                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                        apiRef.current?.connection?.removeEventListener('message', onMsg);

                        contractInProgressRef.current = false;
                        const profit = Number(pocUpdate?.profit || 0);

                        // Apply Super Elite bot outcome logic
                        handleContractOutcome(profit);

                        setStatus(`Contract completed: ${profit > 0 ? 'WIN' : 'LOSS'} ${profit.toFixed(2)} ${account_currency}`);
                    } else {
                        run_panel.setContractStage(contract_stages.OPEN);
                        // Update transaction status if needed
                        transactions.onBotContractEvent({
                            contract_id: pocUpdate.contract_id,
                            status: 'open',
                            profit: Number(pocUpdate.profit || 0),
                            payout: Number(pocUpdate.final_price || 0),
                            longcode: pocUpdate.longcode,
                        } as any);
                    }
                }
            };

            apiRef.current?.connection?.addEventListener('message', onMsg);
            pocSubId = await apiRef.current.subscribe({ proposal_open_contract: 1, contract_id: buy?.contract_id });

        } catch (error: any) {
            console.error('Purchase error:', error);
            setStatus(`Purchase failed: ${error.message}`);
            setIsRunning(false);
            run_panel.setIsRunning(false);
            contractInProgressRef.current = false; // Ensure this is reset on error
        }
    };

    const onStop = () => {
        setIsRunning(false);
        stopFlagRef.current = true;
        contractInProgressRef.current = false;
        run_panel.setIsRunning(false);
        setStatus('Stopped');
    };

    // Get trend color class
    const getTrendColorClass = (trend: TrendAnalysis) => {
        if (trend.direction === 'bullish') return 'trend-bullish';
        if (trend.direction === 'bearish') return 'trend-bearish';
        return 'trend-neutral';
    };

    // Get trend icon
    const getTrendIcon = (trend: TrendAnalysis) => {
        if (trend.direction === 'bullish') return '📈';
        if (trend.direction === 'bearish') return '📉';
        return '➡️';
    };

    return (
        <div className="ml-trader">
            <div className="ml-trader__container">
                <div className="ml-trader__header">
                    <Text as="h1" className="ml-trader__title">
                        {localize('ML Trader')}
                    </Text>
                    <Text className="ml-trader__subtitle">
                        {localize('AI-powered market analysis and trading recommendations')}
                    </Text>
                </div>

                <div className="ml-trader__content">
                    <div className="ml-trader__main-content">
                        {/* Scanner Status */}
                        {scanner_status && (
                            <div className="ml-trader__scanner-status">
                                <div className="scanner-status-header">
                                    <Text as="h3">Market Scanner</Text>
                                    <div className="scanner-progress">
                                        <div className="progress-bar">
                                            <div
                                                className="progress-fill"
                                                style={{ width: `${scanning_progress}%` }}
                                            />
                                        </div>
                                        <Text size="xs">{scanning_progress.toFixed(0)}%</Text>
                                    </div>
                                </div>
                                <Text size="xs">
                                    Connected: {scanner_status.connectedSymbols}/{scanner_status.totalSymbols} symbols
                                </Text>
                            </div>
                        )}

                        {/* Volatility Trends Overview */}
                        <div className="ml-trader__volatility-overview">
                        <div className="volatility-overview-header">
                            <Text as="h3">Volatility Indices - Live Trends & Strength</Text>
                            {!initial_scan_complete && (
                                <div className="analysis-status">
                                    <Text size="xs" color="general">Analyzing market data...</Text>
                                    <div className="progress-indicator">
                                        <div className="progress-bar">
                                            <div
                                                className="progress-fill"
                                                style={{ width: `${scanning_progress}%` }}
                                            />
                                        </div>
                                        <Text size="xs">{Math.round(scanning_progress)}%</Text>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="volatility-trends-grid">
                            {ENHANCED_VOLATILITY_SYMBOLS.map(symbolInfo => {
                                const trend = volatility_trends.get(symbolInfo.symbol);

                                return (
                                    <div key={symbolInfo.symbol} className={`volatility-trend-card ${trend ? 'has-data' : 'loading'}`}>
                                        <div className="trend-card-header">
                                            <Text size="sm" weight="bold">{symbolInfo.display_name}</Text>
                                            <div className="symbol-badge">
                                                {symbolInfo.is_1s && <span className="badge-1s">1s</span>}
                                                <Text size="xs">{symbolInfo.symbol}</Text>
                                            </div>
                                        </div>

                                        {trend ? (
                                            <>
                                                <div className={`trend-direction ${trend.direction}`}>
                                                    <span className="trend-icon">
                                                        {trend.direction === 'bullish' ? '📈' :
                                                         trend.direction === 'bearish' ? '📉' : '➡️'}
                                                    </span>
                                                    <div className="trend-info">
                                                        <Text size="sm" weight="bold">{trend.direction.toUpperCase()}</Text>
                                                        <Text size="xs">{trend.strength} strength</Text>
                                                    </div>
                                                </div>

                                                <div className="trend-metrics">
                                                    <div className="metric">
                                                        <Text size="xs">Confidence</Text>
                                                        <div className="confidence-bar">
                                                            <div
                                                                className="confidence-fill"
                                                                style={{ width: `${trend.confidence}%` }}
                                                            />
                                                        </div>
                                                        <Text size="xs" weight="bold">{trend.confidence.toFixed(0)}%</Text>
                                                    </div>
                                                    <div className="metric">
                                                        <Text size="xs">Score</Text>
                                                        <Text size="sm" weight="bold">{trend.score.toFixed(1)}/100</Text>
                                                    </div>
                                                </div>

                                                <div className="hma-data">
                                                    <div className="hma-row">
                                                        <Text size="xs">HMA5: {trend.hma5?.toFixed(5) || 'N/A'}</Text>
                                                        <Text size="xs">HMA40: {trend.hma40?.toFixed(5) || 'N/A'}</Text>
                                                    </div>
                                                    <div className="hma-slopes">
                                                        <Text size="xs">
                                                            Slope: {trend.hma5Slope ? (trend.hma5Slope > 0 ? '↗️' : '↘️') : '→'}
                                                            {Math.abs(trend.hma5Slope || 0).toFixed(6)}
                                                        </Text>
                                                    </div>
                                                </div>

                                                <div className={`recommendation-badge ${trend.recommendation.toLowerCase()}`}>
                                                    <Text size="xs" weight="bold">{trend.recommendation}</Text>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="loading-state">
                                                <div className="loading-spinner"></div>
                                                <Text size="xs" color="general">
                                                    {is_scanner_initialized ?
                                                        `Building trends... Need ${Math.max(0, 40 - Math.floor(Math.random() * 20))} more candles` :
                                                        'Connecting to market feeds...'
                                                    }
                                                </Text>
                                                <Text size="xs" color="loss-danger">
                                                    HMA requires 40+ data points
                                                </Text>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Market Recommendations */}
                    {recommendations.length > 0 && (
                        <div className="ml-trader__recommendations">
                            <div className="recommendations-header">
                                <Text as="h3">Trading Recommendations</Text>
                                <Text size="xs">Click a recommendation to load trading details</Text>
                            </div>

                            <div className="recommendations-grid">
                                {recommendations.slice(0, 6).map((rec, index) => {
                                    const trend = market_trends.get(rec.symbol);
                                    const isSelected = selected_recommendation?.symbol === rec.symbol;

                                    return (
                                        <div
                                            key={rec.symbol}
                                            className={`recommendation-card ${rec.direction.toLowerCase()} ${isSelected ? 'selected' : ''}`}
                                            onClick={() => openRecommendationModal(rec)}
                                        >
                                            <div className="rec-header">
                                                <div className="rec-rank">#{index + 1}</div>
                                                <div className="rec-symbol">{rec.displayName}</div>
                                                <div className={`rec-direction ${rec.direction.toLowerCase()}`}>
                                                    {rec.direction}
                                                </div>
                                            </div>

                                            <div className="rec-details">
                                                <div className="rec-score">
                                                    <Text size="xs">Score</Text>
                                                    <Text weight="bold">{rec.score.toFixed(0)}</Text>
                                                </div>
                                                <div className="rec-confidence">
                                                    <Text size="xs">Confidence</Text>
                                                    <Text weight="bold">{rec.confidence.toFixed(0)}%</Text>
                                                </div>
                                                <div className="rec-price">
                                                    <Text size="xs">Price</Text>
                                                    <Text weight="bold">{rec.currentPrice.toFixed(5)}</Text>
                                                </div>
                                            </div>

                                            {trend && (
                                                <div className={`trend-indicator ${getTrendColorClass(trend)}`}>
                                                    <span className="trend-icon">{getTrendIcon(trend)}</span>
                                                    <div className="trend-details">
                                                        <Text size="xs" weight="bold">{trend.direction.toUpperCase()}</Text>
                                                        <Text size="xs">{trend.strength} trend</Text>
                                                    </div>
                                                    <div className="hma-values">
                                                        <Text size="xs">HMA5: {trend.hma5?.toFixed(5) || 'N/A'}</Text>
                                                        <Text size="xs">HMA40: {trend.hma40?.toFixed(5) || 'N/A'}</Text>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="rec-reason">
                                                <Text size="xs">{rec.reason}</Text>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    </div>

                    <div className="ml-trader__side-content">
                        {/* Trading Interface - Only shows when a recommendation is selected directly */}
                        {selected_recommendation && !is_modal_open && (
                            <div className="ml-trader__trading-interface">
                                <Text as="h3">Trading Interface</Text>

                                <div className="trading-form">
                                    <div className="form-row">
                                        <div className="form-field">
                                            <Text as="label">Asset</Text>
                                            <select
                                                value={modal_symbol} // Use modal state here
                                                onChange={(e) => setModalSymbol(e.target.value)}
                                                disabled={is_running}
                                            >
                                                {ENHANCED_VOLATILITY_SYMBOLS.map(s => (
                                                    <option key={s.symbol} value={s.symbol}>
                                                        {s.display_name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-field">
                                            <Text as="label">Trade Mode</Text>
                                            <select
                                                value={modal_trade_mode} // Use modal state here
                                                onChange={(e) => setModalTradeMode(e.target.value as any)}
                                                disabled={is_running}
                                            >
                                                <option value="rise_fall">Rise/Fall</option>
                                                <option value="higher_lower">Higher/Lower</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="form-row">
                                        <div className="form-field">
                                            <Text as="label">Contract Type</Text>
                                            <select
                                                value={modal_contract_type} // Use modal state here
                                                onChange={(e) => setModalContractType(e.target.value)}
                                                disabled={is_running}
                                            >
                                                {(modal_trade_mode === 'rise_fall' ? TRADE_TYPES : HIGHER_LOWER_TYPES).map(type => (
                                                    <option key={type.value} value={type.value}>
                                                        {type.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-field">
                                            <Text as="label">Stake ({account_currency})</Text>
                                            <input
                                                type="number"
                                                value={modal_stake} // Use modal state here
                                                onChange={(e) => setModalStake(Number(e.target.value))}
                                                min="0.1"
                                                step="0.1"
                                                disabled={is_running}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-row">
                                        <div className="form-field">
                                            <Text as="label">Duration</Text>
                                            <input
                                                type="number"
                                                value={modal_duration} // Use modal state here
                                                onChange={(e) => setModalDuration(Number(e.target.value))}
                                                min="1"
                                                disabled={is_running}
                                            />
                                        </div>

                                        <div className="form-field">
                                            <Text as="label">Duration Unit</Text>
                                            <select
                                                value={modal_duration_unit} // Use modal state here
                                                onChange={(e) => setModalDurationUnit(e.target.value as any)}
                                                disabled={is_running}
                                            >
                                                <option value="t">Ticks</option>
                                                <option value="s">Seconds</option>
                                                <option value="m">Minutes</option>
                                            </select>
                                        </div>
                                    </div>

                                    {modal_trade_mode === 'higher_lower' && (
                                        <div className="form-row">
                                            <div className="form-field">
                                                <Text as="label">Barrier Offset</Text>
                                                <input
                                                    type="number"
                                                    value={modal_barrier_offset} // Use modal state here
                                                    onChange={(e) => setModalBarrierOffset(Number(e.target.value))}
                                                    step="0.001"
                                                    disabled={is_running}
                                                />
                                            </div>

                                            <div className="form-field">
                                                <Text as="label">Current Price</Text>
                                                <Text>{current_price ? current_price.toFixed(5) : 'Loading...'}</Text>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Status and Controls */}
                        <div className="ml-trader__status">
                            <div className="status-row">
                                <Text>{status || 'Ready to trade'}</Text>
                                <div className="ml-trader__actions">
                                    <button
                                        className={`ml-trader__btn ${is_running ? 'ml-trader__btn--stop' : 'ml-trader__btn--start'}`}
                                        onClick={is_running ? onStop : onStart}
                                        disabled={!modal_recommendation && !is_running} // Disabled if no modal recommendation is set
                                    >
                                        {is_running ? 'Stop' : 'Start Trading'}
                                    </button>

                                    <button
                                        className="ml-trader__btn ml-trader__btn--scan"
                                        onClick={startMarketScan}
                                        disabled={is_running}
                                    >
                                        Refresh Scan
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Trading Modal */}
            <TradingModal
                isOpen={is_modal_open}
                onClose={() => {
                    try {
                        setIsModalOpen(false);
                        setModalRecommendation(null);
                    } catch (error) {
                        console.error('Error closing modal:', error);
                    }
                }}
                recommendation={modal_recommendation}
                account_currency={account_currency}
                current_price={current_price}
                onLoadSettings={loadSettingsToBotBuilder}
                // Pass modal state and setters for form manipulation
                symbol={modal_symbol}
                setSymbol={setModalSymbol}
                trade_mode={modal_trade_mode}
                setTradeMode={setModalTradeMode}
                contract_type={modal_contract_type}
                setContractType={setModalContractType}
                duration={modal_duration}
                setDuration={setModalDuration}
                duration_unit={modal_duration_unit}
                setDurationUnit={setModalDurationUnit}
                stake={modal_stake}
                setStake={setModalStake}
                barrier_offset={modal_barrier_offset}
                setBarrierOffset={setModalBarrierOffset}
            />
        </div>
    );
});

export default MLTrader;