import { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { derivVolatilityScanner, ScannerRecommendation, ScannerStatus, VolatilityAnalysis } from '@/services/deriv-volatility-scanner';
import { tickStreamManager } from '@/services/tick-stream-manager';
import { mlTickAnalyzer } from '@/services/ml-tick-analyzer';
import { statisticsEmitter } from '@/utils/statistics-emitter';
import { mlAutoTrader } from '@/services/ml-auto-trader';
import { AutoTradePanel } from './auto-trade-panel';
import { tickPredictionEngine } from '@/services/tick-prediction-engine';
import { executeDirectTrade, getContractTypeFromAction } from '@/services/direct-trade-executor';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { realTimeTrendMonitor, TrendAnalysis, TrendDirection } from '@/services/real-time-trend-monitor';
import { getROCCalculator } from '@/services/roc-calculator';
import './ml-trader.scss';


// ALL Deriv Volatility Symbols - Normal volatilities, 1-second indices and Step Indices
const DERIV_VOLATILITY_SYMBOLS = [
    // Normal Volatilities (ALL)
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s: false, base_volatility: 10 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s: false, base_volatility: 25 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s: false, base_volatility: 50 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s: false, base_volatility: 75 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s: false, base_volatility: 100 },
    { symbol: 'R_150', display_name: 'Volatility 150 Index', is_1s: false, base_volatility: 150 },
    { symbol: 'R_200', display_name: 'Volatility 200 Index', is_1s: false, base_volatility: 200 },
    { symbol: 'R_250', display_name: 'Volatility 250 Index', is_1s: false, base_volatility: 250 },
    { symbol: 'R_300', display_name: 'Volatility 300 Index', is_1s: false, base_volatility: 300 },
    // 1-Second Volatilities (ALL)
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', is_1s: true, base_volatility: 10 },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', is_1s: true, base_volatility: 25 },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', is_1s: true, base_volatility: 50 },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', is_1s: true, base_volatility: 75 },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', is_1s: true, base_volatility: 100 },
    { symbol: '1HZ150V', display_name: 'Volatility 150 (1s) Index', is_1s: true, base_volatility: 150 },
    { symbol: '1HZ200V', display_name: 'Volatility 200 (1s) Index', is_1s: true, base_volatility: 200 },
    { symbol: '1HZ250V', display_name: 'Volatility 250 (1s) Index', is_1s: true, base_volatility: 250 },
    { symbol: '1HZ300V', display_name: 'Volatility 300 (1s) Index', is_1s: true, base_volatility: 300 },
    // Step Indices
    { symbol: 'stpRNG', display_name: 'Step Index 100', is_1s: false, base_volatility: 100 },
    { symbol: 'stpRNG2', display_name: 'Step Index 200', is_1s: false, base_volatility: 200 },
    { symbol: 'stpRNG3', display_name: 'Step Index 300', is_1s: false, base_volatility: 300 },
    { symbol: 'stpRNG4', display_name: 'Step Index 400', is_1s: false, base_volatility: 400 },
    { symbol: 'stpRNG5', display_name: 'Step Index 500', is_1s: false, base_volatility: 500 },
];

// Contract types for Rise/Fall trading
const RISE_FALL_TYPES = [
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
];

// Duration options optimized for momentum trading
const DURATION_OPTIONS = [
    { value: '30s', label: '30 seconds', seconds: 30 },
    { value: '1m', label: '1 minute', seconds: 60 },
    { value: '2m', label: '2 minutes', seconds: 120 },
    { value: '3m', label: '3 minutes', seconds: 180 },
    { value: '5m', label: '5 minutes', seconds: 300 },
];

// Trading interface
interface TradingInterface {
    symbol: string;
    contract_type: 'CALL' | 'PUT';
    duration: number;
    duration_unit: 's' | 'm';
    stake: number;
    is_auto_trading: boolean;
}

const MLTrader = observer(() => {
    const store = useStore();
    const { transactions, run_panel } = store;

    const apiRef = useRef<any>(null);
    const contractInProgressRef = useRef(false);
    const autoTradingRef = useRef(false);
    const autoTradeIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const currentRecommendationRef = useRef<ScannerRecommendation | null>(null);

    // Authentication and account state
    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [account_balance, setAccountBalance] = useState<number>(0);

    // Scanner state
    const [scanner_status, setScannerStatus] = useState<ScannerStatus | null>(null);
    const [recommendations, setRecommendations] = useState<ScannerRecommendation[]>([]);
    const [symbol_analyses, setSymbolAnalyses] = useState<Map<string, VolatilityAnalysis>>(new Map());
    const [is_scanner_active, setIsScannerActive] = useState(false);
    const [scan_progress, setScanProgress] = useState(0);

    // Trading interface state
    const [trading_interface, setTradingInterface] = useState<TradingInterface>({
        symbol: 'R_50',
        contract_type: 'CALL',
        duration: 180,
        duration_unit: 's',
        stake: 1.0,
        is_auto_trading: false
    });

    // UI state
    const [status, setStatus] = useState<string>('');
    const [selected_recommendation, setSelectedRecommendation] = useState<ScannerRecommendation | null>(null);
    const [show_advanced_view, setShowAdvancedView] = useState(false);
    const [show_auto_trade_panel, setShowAutoTradePanel] = useState(false);
    const [use_tick_predictor, setUseTickPredictor] = useState(false);
    const [tick_prediction, setTickPrediction] = useState<any>(null);
    const [filter_settings] = useState({
        min_confidence: 75,
        min_momentum: 60,
        max_risk: 'HIGH' as 'LOW' | 'MEDIUM' | 'HIGH',
        preferred_durations: ['1m', '2m', '3m'] as string[]
    });


    // Performance tracking
    const [trading_stats, setTradingStats] = useState({
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        total_profit: 0,
        win_rate: 0,
        auto_trade_count: 0
    });

    // Real-Time Trend Monitoring State
    const [current_trend, setCurrentTrend] = useState<TrendAnalysis | null>(null);
    const [trend_override_direction, setTrendOverrideDirection] = useState<'RISE' | 'FALL' | null>(null);
    const [trend_changes_count, setTrendChangesCount] = useState(0);

    // Continuous AI Recommendation State (every 3 ticks)
    const [tick_count, setTickCount] = useState(0);
    const [continuous_ai_recommendation, setContinuousAIRecommendation] = useState<'RISE' | 'FALL' | null>(null);
    const [ai_recommendation_confidence, setAIRecommendationConfidence] = useState(0);
    const tickSubscriptionRef = useRef<(() => void) | null>(null);

    // Reinforcement Learning State
    const [rl_state, setRLState] = useState({
        rise_wins: 0,
        rise_losses: 0,
        fall_wins: 0,
        fall_losses: 0,
        rise_win_rate: 0,
        fall_win_rate: 0,
        preferred_direction: null as 'RISE' | 'FALL' | null,
        confidence_threshold: 70,
        last_10_trades: [] as Array<{direction: 'RISE' | 'FALL', profit: number}>
    });

    // ROC (Rate of Change) State
    const [roc_enabled, setRocEnabled] = useState(true);
    const [roc_period, setRocPeriod] = useState(2);
    const [current_roc, setCurrentROC] = useState<{
        symbol: string;
        roc: number;
        direction: 'UP' | 'DOWN' | 'NEUTRAL';
    } | null>(null);

    useEffect(() => {
        initializeMLTrader();
        return () => cleanup();
    }, []);

    useEffect(() => {
        const checkAutoTrade = () => {
            const config = mlAutoTrader.getConfig();

            if (!config.enabled) {
                return;
            }

            if (recommendations.length === 0) {
                console.log('⏳ Auto-trade check: No recommendations available');
                return;
            }

            const topRecommendation = recommendations[0];

            if (mlAutoTrader.shouldExecuteTrade(topRecommendation)) {
                if (!contractInProgressRef.current) {
                    executeAutoTrade(topRecommendation);
                } else {
                }
            } else {
                console.log('❌ Auto-trade conditions not met (confidence/cooldown/duplicate check)');
            }
        };

        const interval = setInterval(checkAutoTrade, 3000);
        return () => clearInterval(interval);
    }, [recommendations]);

    /**
     * Initialize ML Trader with Deriv volatility scanner
     */
    const initializeMLTrader = useCallback(async () => {
        try {
            setStatus('Initializing Advanced ML Trader...');

            // Initialize API connection
            const api = generateDerivApiInstance();
            apiRef.current = api;

            // Query available Step Index symbols from Deriv API
            setStatus('Querying available Step Index symbols...');
            const { active_symbols, error: symbolsError } = await api.send({ active_symbols: 'brief' });
            if (symbolsError) {
                console.error('Error fetching active symbols:', symbolsError);
            } else {
                const stepIndexSymbols = (active_symbols || [])
                    .filter((s: any) =>
                        s.display_name?.toLowerCase().includes('step index') ||
                        s.symbol?.toLowerCase().includes('step') ||
                        s.submarket === 'step_index'
                    );


                if (stepIndexSymbols.length === 0) {
                    console.warn('⚠️ No Step Index symbols found! Using volatility indices instead.');
                    setStatus('No Step Indices available - this environment may not support them');
                }
            }

            // Check authorization
            const client_id = V2GetActiveClientId();
            const token = V2GetActiveToken();

            if (token && client_id) {
                setIsAuthorized(true);
                await getAccountInfo();
            }

            // Initialize tick stream manager
            setStatus('Connecting to Deriv data streams...');
            await initializeTickStreams();

            // Initialize volatility scanner
            setStatus('Initializing momentum-based volatility scanner...');
            await initializeVolatilityScanner();

            setStatus('ML Trader ready - Scanning for momentum opportunities');
            setIsScannerActive(true);

        } catch (error) {
            console.error('Error during ML Trader initialization:', error);
            // Don't show scary error message - scanner can work with partial data
            setStatus('ML Trader ready - Scanning for momentum opportunities');
            setIsScannerActive(true);
        }
    }, []);

    /**
     * Initialize tick streams for all volatility indices
     */
    const initializeTickStreams = useCallback(async () => {
        try {

            // Subscribe to all volatility symbols
            await tickStreamManager.subscribeToAllVolatilities();

            // Add tick callbacks to feed the scanner and ML analyzer
            DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
                tickStreamManager.addTickCallback(symbolInfo.symbol, (tick) => {
                    // Feed tick to volatility scanner
                    derivVolatilityScanner.processTick({
                        symbol: tick.symbol,
                        quote: tick.quote,
                        epoch: tick.epoch
                    });

                    // Calculate ROC for this symbol
                    if (roc_enabled) {
                        const rocCalc = getROCCalculator(tick.symbol, roc_period);
                        const rocData = rocCalc.addPrice(tick.quote);
                        
                        // Update ROC state if this is the selected symbol
                        if (tick.symbol === (selected_recommendation?.symbol || trading_interface.symbol)) {
                            setCurrentROC({
                                symbol: tick.symbol,
                                roc: rocData.roc,
                                direction: rocData.direction
                            });
                        }
                    }

                    // Feed tick to prediction engine if enabled
                    if (use_tick_predictor) {
                        const prediction = tickPredictionEngine.processTick(tick.quote, tick.epoch * 1000);
                        setTickPrediction(prediction);

                        // Log prediction updates
                        if (prediction.direction !== 'HOLD') {
                        }
                    }
                });
            });


        } catch (error) {
            console.error('Failed to initialize tick streams:', error);
            throw error;
        }
    }, []);

    /**
     * Initialize volatility scanner and ML analyzer
     */
    const initializeVolatilityScanner = useCallback(async () => {
        try {

            // Subscribe to scanner status updates
            const statusUnsubscribe = derivVolatilityScanner.onStatusChange((status) => {
                setScannerStatus(status);
                // Calculate progress based on symbols that have loaded historical data
                const analyzedSymbols = status.symbolsTracked;
                const progress = analyzedSymbols > 0 ? (analyzedSymbols / DERIV_VOLATILITY_SYMBOLS.length) * 100 : 0;
                setScanProgress(progress);
            });

            // Subscribe to recommendation updates
            const recommendationsUnsubscribe = derivVolatilityScanner.onRecommendationChange((recs) => {
                setRecommendations(recs);
                updateSymbolAnalyses();

                // Auto-trade if enabled and we have high-confidence signals
                if (autoTradingRef.current && recs.length > 0) {
                    handleAutoTrading(recs);
                }
            });

            // Fetch and process historical data for ML model training (with retry on timeout)
            const fetchHistoricalDataWithRetry = async (symbolInfo: any, retries = 3): Promise<void> => {
                const symbol = symbolInfo.symbol;
                
                for (let attempt = 1; attempt <= retries; attempt++) {
                    try {
                        // Fetch 500 historical ticks (Deriv API limitation)
                        const historicalData = await tickStreamManager.get500HistoricalTicks(symbol);
                        
                        if (historicalData && historicalData.length > 0) {
                            // Transform TickData[] to the format expected by scanner and ML analyzer
                            const formattedData = historicalData.map(tick => ({
                                price: tick.quote,
                                timestamp: tick.epoch * 1000
                            }));

                            // Process bulk data for immediate analysis (volatility scanner and ML)
                            try {
                                // Process through volatility scanner
                                derivVolatilityScanner.processBulkHistoricalData(symbol, formattedData);

                                // Train ML model on historical data
                                mlTickAnalyzer.processBulkHistoricalData(symbol, formattedData);
                                console.log(`✅ Loaded historical data for ${symbol}`);
                                
                            } catch (error) {
                                console.error(`Error processing bulk historical data for ${symbol}:`, error);
                            }
                        } else {
                            console.warn(`No historical data found for ${symbol}`);
                        }
                        
                        // Success - break retry loop
                        break;
                        
                    } catch (error: any) {
                        const isTimeout = error?.message?.includes('timeout') || error?.message?.includes('WebSocket');
                        
                        if (isTimeout && attempt < retries) {
                            console.warn(`⚠️ Timeout fetching data for ${symbol}, retrying (${attempt}/${retries})...`);
                            // Wait 2 seconds before retry
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } else if (attempt === retries) {
                            console.error(`❌ Failed to fetch ${symbol} after ${retries} attempts:`, error);
                            // Don't throw - continue with other symbols
                        } else {
                            console.error(`Error fetching historical data for ${symbol}:`, error);
                            break;
                        }
                    }
                }
            };
            
            // Fetch data for all symbols with retry logic
            const historicalDataPromises = DERIV_VOLATILITY_SYMBOLS.map(symbolInfo => 
                fetchHistoricalDataWithRetry(symbolInfo)
            );

            const results = await Promise.allSettled(historicalDataPromises); // Use allSettled to continue even if some fail
            
            // Log summary of historical data loading
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            console.log(`📊 Historical data loading complete: ${successful} succeeded, ${failed} failed out of ${DERIV_VOLATILITY_SYMBOLS.length} symbols`);

            // Perform immediate initial scan now that historical data is loaded
            console.log('🚀 Performing initial scanner scan with historical data...');
            const scanResult = await derivVolatilityScanner.performFullScan();
            console.log('✅ Initial scan completed, recommendations:', scanResult?.length || 0);

            // Start periodic scanning for ongoing updates (backup to candle-based updates)
            const scanInterval = setInterval(() => {
                if (is_scanner_active) {
                    derivVolatilityScanner.performFullScan();
                }
            }, 60000); // Scan every 60 seconds as backup

            console.log('🕐 Recommendations will update automatically on new 1-minute candles');

            // Return cleanup function
            return () => {
                clearInterval(scanInterval);
                statusUnsubscribe();
                recommendationsUnsubscribe();
            };

        } catch (error) {
            console.error('Error initializing volatility scanner:', error);
            // Don't throw - allow scanner to work with whatever data it has
            // The scanner can still function and will retry failed symbols on next scan
            setStatus('Scanner initialized with partial data - scanning for opportunities');
            return () => {}; // Return empty cleanup function
        }
    }, [is_scanner_active]);

    /**
     * Update symbol analyses
     */
    const updateSymbolAnalyses = useCallback(() => {
        const analysesMap = new Map<string, VolatilityAnalysis>();

        DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const analysis = derivVolatilityScanner.getSymbolAnalysis(symbolInfo.symbol);
            if (analysis) {
                analysesMap.set(symbolInfo.symbol, analysis);
            }
        });

        setSymbolAnalyses(analysesMap);
    }, []);

    /**
     * Get account information
     */
    const getAccountInfo = useCallback(async () => {
        try {
            if (!apiRef.current) return;

            const balance_response = await apiRef.current.send({ balance: 1 });
            if (balance_response.balance) {
                setAccountBalance(balance_response.balance.balance);
                setAccountCurrency(balance_response.balance.currency);
            }

        } catch (error) {
            console.error('Failed to get account info:', error);
        }
    }, []);

    /**
     * Handle auto trading with Reinforcement Learning - called when new recommendations arrive
     * NOW USES RL STATE for adaptive trading
     */
    const handleAutoTrading = useCallback(async (recs: ScannerRecommendation[]) => {
        // Skip if continuous trading loop is handling this (avoid duplicate triggers)
        if (autoTradeIntervalRef.current) {
            console.log('⏭️ Continuous trading active, skipping handleAutoTrading');
            return;
        }

        // REINFORCEMENT LEARNING: Filter recommendations using RL confidence threshold
        const filteredRecs = recs.filter(rec =>
            rec.confidence >= rl_state.confidence_threshold &&
            rec.momentumScore >= filter_settings.min_momentum &&
            filter_settings.preferred_durations.includes(rec.duration) &&
            (filter_settings.max_risk === 'HIGH' ||
             (filter_settings.max_risk === 'MEDIUM' && rec.urgency !== 'CRITICAL') ||
             (filter_settings.max_risk === 'LOW' && rec.urgency === 'LOW'))
        );

        if (filteredRecs.length === 0) {
            console.log(`No recommendations match RL criteria (threshold: ${rl_state.confidence_threshold}%)`);
            return;
        }

        // ADAPTIVE SELECTION: Prefer direction with better historical performance
        let topRec = filteredRecs[0];
        
        if (rl_state.preferred_direction) {
            const preferredRec = filteredRecs.find(
                rec => rec.action === rl_state.preferred_direction
            );
            if (preferredRec) {
                topRec = preferredRec;
                console.log(`🧠 RL: Selected ${rl_state.preferred_direction} (${rl_state.preferred_direction === 'RISE' ? rl_state.rise_win_rate : rl_state.fall_win_rate}% win rate)`);
            }
        }

        // Update current recommendation for auto-trading
        currentRecommendationRef.current = topRec;
        setSelectedRecommendation(topRec);

        // Apply recommendation to trading interface
        applyRecommendation(topRec);

    }, [rl_state, filter_settings]);

    /**
     * Check if symbol is moving (price changing)
     */
    const checkSymbolMovement = useCallback(async (symbol: string): Promise<boolean> => {
        if (!apiRef.current) return false;

        try {
            // Get current tick
            const tick1_response = await apiRef.current.send({
                ticks: symbol,
                subscribe: 0
            });

            if (!tick1_response.tick) return false;
            const price1 = tick1_response.tick.quote;

            // Wait 2 seconds and check again
            await new Promise(resolve => setTimeout(resolve, 2000));

            const tick2_response = await apiRef.current.send({
                ticks: symbol,
                subscribe: 0
            });

            if (!tick2_response.tick) return false;
            const price2 = tick2_response.tick.quote;

            const isMoving = price1 !== price2;

            return isMoving;
        } catch (error) {
            console.error('Movement check error:', error);
            return false;
        }
    }, []);

    /**
     * Execute an automated trade based on recommendation
     */
    const executeAutoTrade = useCallback(async (recommendation: ScannerRecommendation) => {
        if (!apiRef.current || contractInProgressRef.current) return;

        contractInProgressRef.current = true;
        const stake = mlAutoTrader.getConfig().stake_amount;

        // Get contract configuration based on current strategy state
        const contractConfig = mlAutoTrader.getNextContractConfig(recommendation);


        // Check if symbol is moving before trading
        const isMoving = await checkSymbolMovement(recommendation.symbol);
        if (!isMoving) {
            console.warn(`⏸️ Symbol ${recommendation.symbol} is not moving, skipping trade`);
            contractInProgressRef.current = false;
            return;
        }

        try {
            const tradeParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: contractConfig.deriv_contract_type,
                currency: account_currency,
                duration: 2,
                duration_unit: 't',
                symbol: recommendation.symbol
            };

            console.log('📤 Sending proposal request:', tradeParams);
            const proposal_response = await apiRef.current.send(tradeParams);

            if (proposal_response.error) {
                console.error('❌ Proposal error:', proposal_response.error);
                throw new Error(proposal_response.error.message);
            }

            if (proposal_response.proposal) {

                const buy_response = await apiRef.current.send({
                    buy: proposal_response.proposal.id,
                    price: stake
                });

                if (buy_response.error) {
                    console.error('❌ Purchase error:', buy_response.error);
                    throw new Error(buy_response.error.message);
                }

                if (buy_response.buy) {
                    const entryPrice = parseFloat(buy_response.buy.buy_price);
                    const payout = parseFloat(buy_response.buy.payout || 0);


                    mlAutoTrader.registerTrade(
                        recommendation,
                        buy_response.buy.contract_id,
                        entryPrice,
                        payout,
                        contractConfig.deriv_contract_type,
                        contractConfig.mode
                    );

                    statisticsEmitter.emitTradeRun();
                    monitorContract(buy_response.buy.contract_id, true);
                }
            }

        } catch (error) {
            console.error('❌ Auto-trade execution error:', error);
        } finally {
            contractInProgressRef.current = false;
        }
    }, [account_currency, checkSymbolMovement]);

    /**
     * Execute a manual trade based on recommendation
     */
    const executeTrade = useCallback(async (recommendation: ScannerRecommendation) => {
        if (!apiRef.current || contractInProgressRef.current) return;

        contractInProgressRef.current = true;
        setStatus(`Executing ${recommendation.action} trade on ${recommendation.displayName}...`);

        try {
            const tradeParams = {
                proposal: 1,
                amount: trading_interface.stake,
                basis: 'stake',
                contract_type: recommendation.action === 'RISE' ? 'PUT' : 'CALL',
                currency: account_currency,
                duration: 2,
                duration_unit: 't',
                symbol: recommendation.symbol
            };

            const proposal_response = await apiRef.current.send(tradeParams);

            if (proposal_response.error) {
                throw new Error(proposal_response.error.message);
            }

            if (proposal_response.proposal) {
                const buy_response = await apiRef.current.send({
                    buy: proposal_response.proposal.id,
                    price: trading_interface.stake
                });

                if (buy_response.error) {
                    throw new Error(buy_response.error.message);
                }

                if (buy_response.buy) {
                    setStatus(`Trade executed: ${recommendation.action} on ${recommendation.displayName} (Contract ID: ${buy_response.buy.contract_id})`);
                    statisticsEmitter.emitTradeRun();

                    setTradingStats(prev => ({
                        ...prev,
                        total_trades: prev.total_trades + 1
                    }));

                    monitorContract(buy_response.buy.contract_id, false);
                }
            }

        } catch (error) {
            console.error('Trade execution error:', error);
            setStatus(`Trade failed: ${error}`);
        } finally {
            contractInProgressRef.current = false;
        }
    }, [trading_interface.stake, account_currency]);

    /**
     * Monitor contract outcome
     */
    const monitorContract = useCallback(async (contract_id: string, isAutoTrade: boolean = false) => {
        if (!apiRef.current) return;

        try {
            const contract_response = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id,
                subscribe: 1
            });

            if (contract_response.proposal_open_contract) {
                const contract = contract_response.proposal_open_contract;

                if (contract.is_sold) {
                    handleContractResult(contract, isAutoTrade);
                }
            }

        } catch (error) {
            console.error('Contract monitoring error:', error);
        }
    }, []);

    /**
     * Handle contract result
     */
    const handleContractResult = useCallback((contract: any, isAutoTrade: boolean = false) => {
        const profit = parseFloat(contract.profit || 0);
        const is_win = profit > 0;

        if (isAutoTrade) {
            mlAutoTrader.updateTradeResult(
                contract.contract_id,
                profit,
                is_win ? 'won' : 'lost'
            );
        }

        setTradingStats(prev => {
            const new_winning = is_win ? prev.winning_trades + 1 : prev.winning_trades;
            const new_losing = !is_win ? prev.losing_trades + 1 : prev.losing_trades;
            const new_total_profit = prev.total_profit + profit;
            const new_win_rate = prev.total_trades > 0 ? (new_winning / prev.total_trades) * 100 : 0;

            return {
                ...prev,
                winning_trades: new_winning,
                losing_trades: new_losing,
                total_profit: new_total_profit,
                win_rate: new_win_rate
            };
        });

        const result_emoji = is_win ? '✅' : '❌';
        const result_text = is_win ? 'WIN' : 'LOSS';

        setStatus(`${result_emoji} Trade ${result_text}: ${profit.toFixed(2)} ${account_currency}`);

        // Emit trade result to centralized statistics
        statisticsEmitter.emitTradeResult({
            buy_price: Number(contract.buy_price),
            sell_price: Number(contract.sell_price),
            profit: profit,
            currency: account_currency,
            is_win: profit > 0,
            contract_id: contract.contract_id,
            contract_type: contract.contract_type,
            symbol: contract.underlying,
            stake: Number(contract.buy_price)
        });

        console.log(`💰 Profit/Loss: ${profit.toFixed(2)} ${account_currency}`);

        contractInProgressRef.current = false;
    }, [account_currency]);

    /**
     * Reinforcement Learning: Update state based on trade outcome
     */
    const updateRLState = useCallback((direction: 'RISE' | 'FALL', profit: number) => {
        setRLState(prev => {
            const isWin = profit > 0;
            
            // Update direction-specific stats
            const rise_wins = direction === 'RISE' && isWin ? prev.rise_wins + 1 : prev.rise_wins;
            const rise_losses = direction === 'RISE' && !isWin ? prev.rise_losses + 1 : prev.rise_losses;
            const fall_wins = direction === 'FALL' && isWin ? prev.fall_wins + 1 : prev.fall_wins;
            const fall_losses = direction === 'FALL' && !isWin ? prev.fall_losses + 1 : prev.fall_losses;
            
            // Calculate win rates
            const rise_total = rise_wins + rise_losses;
            const fall_total = fall_wins + fall_losses;
            const rise_win_rate = rise_total > 0 ? (rise_wins / rise_total) * 100 : 0;
            const fall_win_rate = fall_total > 0 ? (fall_wins / fall_total) * 100 : 0;
            
            // Update last 10 trades
            const last_10_trades = [...prev.last_10_trades, {direction, profit}].slice(-10);
            
            // Determine preferred direction based on performance
            let preferred_direction: 'RISE' | 'FALL' | null = null;
            if (rise_total >= 3 && fall_total >= 3) {
                // Only set preference after enough data
                preferred_direction = rise_win_rate > fall_win_rate ? 'RISE' : 'FALL';
            }
            
            // Adapt confidence threshold based on recent performance
            const recent_win_rate = last_10_trades.filter(t => t.profit > 0).length / Math.max(last_10_trades.length, 1) * 100;
            let confidence_threshold = 70;
            if (recent_win_rate >= 70) {
                confidence_threshold = 65; // Lower threshold when performing well
            } else if (recent_win_rate < 40) {
                confidence_threshold = 80; // Raise threshold when performing poorly
            }
            
            console.log(`🧠 RL Update: ${direction} ${isWin ? 'WIN' : 'LOSS'} | RISE: ${rise_win_rate.toFixed(1)}% | FALL: ${fall_win_rate.toFixed(1)}% | Preferred: ${preferred_direction || 'None'} | Threshold: ${confidence_threshold}%`);
            
            return {
                rise_wins,
                rise_losses,
                fall_wins,
                fall_losses,
                rise_win_rate,
                fall_win_rate,
                preferred_direction,
                confidence_threshold,
                last_10_trades
            };
        });
    }, []);

    /**
     * Execute trade and map to Run Panel (Trading Hub style)
     */
    const executeTradeAndMapToPanel = useCallback(async (
        symbol: string,
        contractType: 'CALL' | 'PUT' | 'CALLE' | 'PUTE',
        stake: number,
        displayName?: string
    ) => {
        const result = await executeDirectTrade({
            symbol,
            contract_type: contractType,
            stake,
            duration: 2,
            duration_unit: 't'
        });

        if (result.success && result.contract_id) {
            console.log('✅ Trade result received:', result.contract_id);
            
            // Subscribe to contract updates and ONLY send complete data (Trading Hub pattern)
            if (apiRef.current) {
                try {
                    console.log('📡 Subscribing to contract updates...');
                    const res = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: result.contract_id,
                        subscribe: 1
                    });

                    console.log('📡 Subscription response received:', res ? 'OK' : 'NULL');
                    const { proposal_open_contract: pocInit, subscription } = res || {};
                    
                    console.log('📡 pocInit:', pocInit ? 'PRESENT' : 'MISSING', 'subscription:', subscription ? 'PRESENT' : 'MISSING');
                    
                    // ONLY send to Run Panel once we have complete data (prevents crash)
                    if (pocInit && String(pocInit.contract_id) === String(result.contract_id)) {
                        console.log('📡 Sending contract to Run Panel...');
                        console.log('📡 Contract data:', {
                            contract_id: pocInit.contract_id,
                            has_transaction_ids: !!pocInit.transaction_ids,
                            has_entry_tick: !!pocInit.entry_tick_display_value,
                            has_exit_tick: !!pocInit.exit_tick_display_value,
                            status: pocInit.status
                        });
                        
                        try {
                            transactions.onBotContractEvent(pocInit);
                            console.log('✅ Mapped complete contract to Run Panel:', result.contract_id);
                        } catch (error) {
                            console.error('❌ Error mapping contract:', error);
                        }
                    } else {
                        console.warn('⚠️ pocInit missing or contract_id mismatch');
                    }

                    // Subscribe to ongoing updates
                    if (subscription?.id) {
                        const onMessage = (evt: MessageEvent) => {
                            try {
                                const data = JSON.parse(evt.data);
                                if (data?.msg_type === 'proposal_open_contract') {
                                    const poc = data.proposal_open_contract;
                                    if (String(poc?.contract_id) === String(result.contract_id)) {
                                        try {
                                            transactions.onBotContractEvent(poc);
                                            console.log('📊 Contract update:', poc.status);
                                        } catch (error) {
                                            console.error('❌ Error updating contract:', error);
                                        }
                                        
                                        if (poc.is_sold || poc.is_settled) {
                                            apiRef.current?.forget?.({ forget: subscription.id });
                                            apiRef.current?.connection?.removeEventListener('message', onMessage);
                                            console.log('✅ Contract settled');
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error('❌ Error processing message:', error);
                            }
                        };

                        apiRef.current?.connection?.addEventListener('message', onMessage);
                    }
                } catch (error) {
                    console.error('❌ Error setting up subscription:', error);
                }
            }
        }

        return result;
    }, [transactions, account_currency]);

    /**
     * Apply recommendation and execute trade directly via API (bypasses Bot Builder)
     */
    const applyRecommendation = useCallback(async (recommendation: ScannerRecommendation) => {
        // Prevent overlapping trades
        if (contractInProgressRef.current) {
            console.log('⏭️ Skipping trade - contract already in progress');
            return;
        }

        const tradeDirection = recommendation.action;

        // ROC FILTERING: Check if ROC direction matches recommendation
        if (roc_enabled && current_roc && current_roc.symbol === recommendation.symbol) {
            const rocDirection = current_roc.direction;
            const isROCAligned = (
                (tradeDirection === 'RISE' && rocDirection === 'UP') ||
                (tradeDirection === 'FALL' && rocDirection === 'DOWN')
            );

            if (!isROCAligned) {
                console.log(`❌ ROC FILTER BLOCKED: Recommendation is ${tradeDirection} but ROC is ${rocDirection} (${current_roc.roc.toFixed(4)}%)`);
                setStatus(`⏸️ Trade blocked: ROC (${rocDirection}) conflicts with ${tradeDirection} recommendation`);
                return;
            }

            console.log(`✅ ROC FILTER PASSED: ${tradeDirection} aligns with ROC ${rocDirection} (${current_roc.roc.toFixed(4)}%)`);
        }

        contractInProgressRef.current = true;

        try {
            setStatus(`🔄 Executing ${tradeDirection} trade for ${recommendation.displayName}...`);
            
            // For tick-based contracts, ALWAYS use CALL/PUT (not CALLE/PUTE)
            const contractType = getContractTypeFromAction(tradeDirection, 't');
            
            // Execute trade and map to Run Panel
            const result = await executeTradeAndMapToPanel(
                recommendation.symbol,
                contractType,
                trading_interface.stake,
                recommendation.displayName
            );

            if (result.success) {
                setStatus(`✅ Trade executed successfully! Contract ID: ${result.contract_id}, Stake: $${result.buy_price?.toFixed(2)}, Potential Payout: $${result.payout?.toFixed(2)}`);
                console.log('✅ Direct trade executed:', result);
                
                // Emit trade statistics
                statisticsEmitter.emitTradeRun();

                // For 2-tick contracts, wait ~10 seconds for settlement before allowing next trade
                // This prevents overlapping contracts even with API delays
                // NOTE: 2-tick contracts typically settle in 3-5 seconds, 10s provides safety buffer
                setTimeout(() => {
                    contractInProgressRef.current = false;
                    console.log('✅ Contract settlement timeout elapsed, ready for next trade');
                    
                    // TODO: Update RL state when contract settles with actual profit
                    // For now, estimating based on payout vs stake
                    const estimatedProfit = (result.payout || 0) - (result.buy_price || 0);
                    updateRLState(tradeDirection, estimatedProfit);
                }, 10000);
            } else {
                setStatus(`❌ Trade failed: ${result.error}`);
                console.error('❌ Direct trade failed:', result.error);
                contractInProgressRef.current = false; // Reset immediately on failure
                
                // Update RL state with loss
                updateRLState(tradeDirection, -trading_interface.stake);
            }
        } catch (error: any) {
            setStatus(`❌ Error executing trade: ${error.message}`);
            console.error('❌ Direct trade error:', error);
            contractInProgressRef.current = false; // Reset immediately on error
            
            // Update RL state with loss
            updateRLState(tradeDirection, -trading_interface.stake);
        }
    }, [trading_interface.stake, updateRLState]);

    /**
     * Start continuous AI recommendations every 3 ticks
     * Generates trade recommendations when no active contract
     */
    const startContinuousAIRecommendations = useCallback((symbol: string) => {
        if (!apiRef.current) return;
        
        console.log(`🤖 Starting continuous AI recommendations for ${symbol} (every 3 ticks)`);
        
        let tickCounter = 0;
        
        // Subscribe to tick stream
        const unsubscribe = apiRef.current.subscribe({
            ticks: symbol,
            subscribe: 1
        }).subscribe((tick: any) => {
            if (tick.error) {
                console.error('Tick stream error:', tick.error);
                return;
            }
            
            if (tick.tick) {
                tickCounter++;
                setTickCount(tickCounter);
                
                // Process tick with prediction engine
                const prediction = tickPredictionEngine.processTick(
                    tick.tick.quote,
                    Date.now()
                );
                
                // Every 3 ticks, generate recommendation
                if (tickCounter % 3 === 0) {
                    console.log(`🎯 AI Recommendation Cycle #${Math.floor(tickCounter / 3)}: ${prediction.direction} (Confidence: ${prediction.confidence}%)`);
                    
                    // Convert prediction to trade direction and update state
                    if (prediction.direction === 'CALL') {
                        setContinuousAIRecommendation('RISE');
                        setAIRecommendationConfidence(prediction.confidence);
                    } else if (prediction.direction === 'PUT') {
                        setContinuousAIRecommendation('FALL');
                        setAIRecommendationConfidence(prediction.confidence);
                    } else {
                        // HOLD - still update UI but don't execute
                        setContinuousAIRecommendation(null);
                        setAIRecommendationConfidence(prediction.confidence);
                        console.log(`⏸️ AI suggests HOLD (${prediction.confidence}% confidence) - ${prediction.reason}`);
                    }
                    
                    // If no contract in progress and high confidence, execute trade
                    if (!contractInProgressRef.current && prediction.direction !== 'HOLD' && prediction.confidence >= 75) {
                        const tradeDirection = prediction.direction === 'CALL' ? 'RISE' : 'FALL';
                        console.log(`🚀 AUTO-EXECUTING AI RECOMMENDATION: ${tradeDirection} (${prediction.confidence}% confidence)`);
                        console.log(`   Reason: ${prediction.reason}`);
                        
                        // Execute trade using the AI recommendation
                        (async () => {
                            contractInProgressRef.current = true;
                            const contractType = getContractTypeFromAction(tradeDirection, 't');
                            
                            const result = await executeTradeAndMapToPanel(
                                symbol,
                                contractType,
                                trading_interface.stake
                            );
                            
                            if (result.success) {
                                setStatus(`✅ AI ${tradeDirection} trade executed! Confidence: ${prediction.confidence}%`);
                                setTimeout(() => {
                                    contractInProgressRef.current = false;
                                    const estimatedProfit = (result.payout || 0) - (result.buy_price || 0);
                                    updateRLState(tradeDirection, estimatedProfit);
                                }, 10000);
                            } else {
                                contractInProgressRef.current = false;
                                updateRLState(tradeDirection, -trading_interface.stake);
                            }
                        })();
                    } else if (prediction.direction !== 'HOLD' && prediction.confidence < 75) {
                        console.log(`⏭️ AI recommendation below threshold: ${prediction.direction} (${prediction.confidence}% < 75%)`);
                    }
                }
            }
        });
        
        // Store subscription for cleanup
        tickSubscriptionRef.current = unsubscribe;
        
        console.log('✅ Continuous AI recommendations started successfully');
    }, [trading_interface.stake, updateRLState]);
    
    /**
     * Stop continuous AI recommendations
     */
    const stopContinuousAIRecommendations = useCallback(() => {
        if (tickSubscriptionRef.current) {
            try {
                tickSubscriptionRef.current.unsubscribe();
                console.log('⏹️ Stopped continuous AI recommendations');
            } catch (error) {
                console.error('Error stopping AI recommendations:', error);
            }
            tickSubscriptionRef.current = null;
        }
    }, []);

    /**
     * Continuous trading loop with reinforcement learning
     * Adapts to market conditions by continuously scanning and updating recommendations
     * Can trade both RISE and FALL based on changing market analysis
     * Uses RL state to prefer directions with better historical performance
     */
    const startContinuousTrading = useCallback(() => {
        console.log('🔄 Starting adaptive continuous trading with reinforcement learning...');
        console.log(`🧠 Initial RL State: RISE ${rl_state.rise_win_rate.toFixed(1)}% | FALL ${rl_state.fall_win_rate.toFixed(1)}% | Threshold: ${rl_state.confidence_threshold}%`);
        
        const executeContinuousTrade = async () => {
            // Only trade if auto-trading is still active
            if (!autoTradingRef.current) {
                console.log('⏹️ Auto-trading stopped, stopping loop');
                if (autoTradeIntervalRef.current) {
                    clearInterval(autoTradeIntervalRef.current);
                    autoTradeIntervalRef.current = null;
                }
                return;
            }

            // REINFORCEMENT LEARNING: Get fresh recommendations every cycle
            // This allows the system to adapt trade direction (RISE/FALL) based on current market conditions
            console.log('🧠 Adaptive Learning: Analyzing current market conditions with RL...');
            
            // Wait for scanner to update recommendations if needed
            if (recommendations.length === 0) {
                console.log('⏭️ Waiting for market analysis to complete...');
                return;
            }

            // Filter recommendations based on RL confidence threshold
            const viableRecommendations = recommendations.filter(
                rec => rec.confidence >= rl_state.confidence_threshold
            );

            if (viableRecommendations.length === 0) {
                console.log(`⏭️ No recommendations meet RL threshold of ${rl_state.confidence_threshold}%`);
                return;
            }

            // REAL-TIME TREND OVERRIDE: Prioritize trend direction over recommendations
            let selectedRecommendation = viableRecommendations[0];
            let tradeDirection: 'RISE' | 'FALL';
            
            if (trend_override_direction) {
                // TREND-BASED TRADING: Use real-time trend analysis
                tradeDirection = trend_override_direction;
                
                // Try to find a recommendation matching the trend direction
                const trendMatchingRec = viableRecommendations.find(
                    rec => rec.action === trend_override_direction
                );
                
                if (trendMatchingRec) {
                    selectedRecommendation = trendMatchingRec;
                    console.log(`📈 TREND-DRIVEN: ${trend_override_direction} (Trend: ${current_trend?.direction}, Confidence: ${current_trend?.confidence.toFixed(1)}%)`);
                } else {
                    // No matching recommendation, use top one but override its action
                    console.log(`📈 TREND-OVERRIDE: No ${trend_override_direction} recommendation, overriding top recommendation`);
                }
            } else if (rl_state.preferred_direction) {
                // REINFORCEMENT LEARNING: Prefer direction with better historical performance
                tradeDirection = rl_state.preferred_direction;
                
                const preferredRec = viableRecommendations.find(
                    rec => rec.action === rl_state.preferred_direction
                );
                
                if (preferredRec) {
                    selectedRecommendation = preferredRec;
                    tradeDirection = preferredRec.action;
                    console.log(`🧠 RL-Optimized: ${rl_state.preferred_direction} (${rl_state.preferred_direction === 'RISE' ? rl_state.rise_win_rate : rl_state.fall_win_rate}% win rate)`);
                } else {
                    tradeDirection = selectedRecommendation.action;
                    console.log(`🎯 Default: Using top recommendation ${selectedRecommendation.action}`);
                }
            } else {
                tradeDirection = selectedRecommendation.action;
                console.log(`📊 Standard: ${tradeDirection} - Confidence: ${selectedRecommendation.confidence.toFixed(1)}%`);
            }
            
            // ROC FILTERING: Check if ROC direction matches trade direction
            if (roc_enabled && current_roc && current_roc.symbol === selectedRecommendation.symbol) {
                const rocDirection = current_roc.direction;
                const isROCAligned = (
                    (tradeDirection === 'RISE' && rocDirection === 'UP') ||
                    (tradeDirection === 'FALL' && rocDirection === 'DOWN')
                );

                if (!isROCAligned) {
                    console.log(`❌ ROC FILTER BLOCKED (Continuous): ${tradeDirection} conflicts with ROC ${rocDirection} (${current_roc.roc.toFixed(4)}%)`);
                    setStatus(`⏸️ Trade blocked: ROC (${rocDirection}) conflicts with ${tradeDirection}`);
                    return;
                }

                console.log(`✅ ROC FILTER PASSED (Continuous): ${tradeDirection} aligns with ROC ${rocDirection} (${current_roc.roc.toFixed(4)}%)`);
            }
            
            // Execute trade with trend-based or RL-optimized direction
            const contractType = getContractTypeFromAction(tradeDirection, 't');
            
            // Execute trade and map to Run Panel
            if (!contractInProgressRef.current) {
                contractInProgressRef.current = true;
                
                const result = await executeTradeAndMapToPanel(
                    selectedRecommendation.symbol,
                    contractType,
                    trading_interface.stake,
                    selectedRecommendation.displayName
                );

                if (result.success) {
                    setStatus(`✅ ${tradeDirection} trade executed! Contract: ${result.contract_id}`);
                    setTimeout(() => {
                        contractInProgressRef.current = false;
                        const estimatedProfit = (result.payout || 0) - (result.buy_price || 0);
                        updateRLState(tradeDirection, estimatedProfit);
                    }, 10000);
                } else {
                    contractInProgressRef.current = false;
                    updateRLState(tradeDirection, -trading_interface.stake);
                }
            }
        };

        // Execute first trade immediately
        executeContinuousTrade();

        // Then execute every 3 seconds for rapid continuous trading
        // Each cycle re-evaluates market conditions for adaptive trading
        autoTradeIntervalRef.current = setInterval(executeContinuousTrade, 3000);
    }, [recommendations, rl_state, trend_override_direction, current_trend, trading_interface.stake, updateRLState]);

    /**
     * Toggle auto trading
     */
    const toggleAutoTrading = useCallback(() => {
        const newState = !trading_interface.is_auto_trading;
        autoTradingRef.current = newState;

        setTradingInterface(prev => ({
            ...prev,
            is_auto_trading: newState
        }));

        // Enable/disable the mlAutoTrader service
        mlAutoTrader.configure({ enabled: newState });

        if (newState) {
            // Notify Run Panel that bot is starting (no parameters needed)
            globalObserver.emit('bot.running');
            console.log('📡 Emitted bot.running to Run Panel');
            
            // Start real-time trend monitoring for active symbol
            const activeSymbol = selected_recommendation?.symbol || trading_interface.symbol;
            realTimeTrendMonitor.startMonitoring(activeSymbol);
            console.log(`📈 Started real-time trend monitoring for ${activeSymbol}`);
            
            // Subscribe to trend changes - dynamically switch trade direction
            const unsubscribe = realTimeTrendMonitor.onTrendChange((trend) => {
                setCurrentTrend(trend);
                setTrendChangesCount(prev => prev + 1);
                
                // Determine new trade direction based on trend
                const newDirection = trend.direction === 'BULLISH' ? 'RISE' : 'FALL';
                setTrendOverrideDirection(newDirection);
                
                console.log(`🔄 TREND CHANGE #${trend_changes_count + 1}: ${trend.direction} detected → Switching to ${newDirection} trades`);
                console.log(`   Confidence: ${trend.confidence.toFixed(1)}% | Strength: ${trend.strength.toFixed(1)}% | Price Change: ${trend.priceChange.toFixed(4)}%`);
            });
            
            // Store unsubscribe function for cleanup
            (window as any)._trendUnsubscribe = unsubscribe;
            
            // Start continuous AI recommendation system (every 3 ticks)
            startContinuousAIRecommendations(activeSymbol);
            
            // Start auto-trading with continuous loop
            setStatus('🤖 Auto-trading activated with real-time trend adaptation...');
            startContinuousTrading();
        } else {
            // Stop continuous AI recommendations
            stopContinuousAIRecommendations();
            
            // Stop real-time trend monitoring
            realTimeTrendMonitor.stopAll();
            console.log('⏹️ Stopped real-time trend monitoring');
            
            // Unsubscribe from trend changes
            if ((window as any)._trendUnsubscribe) {
                (window as any)._trendUnsubscribe();
                delete (window as any)._trendUnsubscribe;
            }
            
            // Reset trend override and AI recommendations
            setTrendOverrideDirection(null);
            setCurrentTrend(null);
            setContinuousAIRecommendation(null);
            setAIRecommendationConfidence(0);
            setTickCount(0);
            
            // Notify Run Panel that bot is stopping
            globalObserver.emit('bot.stop');
            console.log('📡 Emitted bot.stop to Run Panel');
            
            // Stop auto-trading
            setStatus('⏹️ Auto-trading stopped');
            
            // Clear the continuous trading interval
            if (autoTradeIntervalRef.current) {
                clearInterval(autoTradeIntervalRef.current);
                autoTradeIntervalRef.current = null;
            }
        }
    }, [trading_interface.is_auto_trading, startContinuousTrading]);

    /**
     * Manual trade execution
     */
    const executeManualTrade = useCallback(async () => {
        if (!selected_recommendation) return;

        try {
            await executeTrade(selected_recommendation);
        } catch (error) {
            console.error('Manual trade error:', error);
        }
    }, [selected_recommendation, executeTrade]);

    /**
     * Cleanup function
     */
    const cleanup = useCallback(() => {
        autoTradingRef.current = false;
        contractInProgressRef.current = false;

        // Stop continuous AI recommendations
        stopContinuousAIRecommendations();
        
        // Clear auto-trading interval
        if (autoTradeIntervalRef.current) {
            clearInterval(autoTradeIntervalRef.current);
            autoTradeIntervalRef.current = null;
        }

        // Unsubscribe from tick streams
        DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            tickStreamManager.unsubscribeFromSymbol(symbolInfo.symbol);
        });

        console.log('ML Trader cleanup completed');
    }, []);

    /**
     * Format confidence percentage
     */
    const formatConfidence = (confidence: number): string => {
        if (confidence >= 90) return '🔥 Excellent';
        if (confidence >= 80) return '✅ High';
        if (confidence >= 70) return '👍 Good';
        if (confidence >= 60) return '⚠️ Moderate';
        return '❌ Low';
    };

    /**
     * Get risk color
     */
    const getRiskColor = (riskLevel: string): string => {
        switch (riskLevel) {
            case 'LOW': return '#4CAF50';
            case 'MEDIUM': return '#FF9800';
            case 'HIGH': return '#F44336';
            default: return '#757575';
        }
    };

    /**
     * Get confidence color based on percentage
     */
    const getConfidenceColor = (confidence: number): string => {
        if (confidence >= 90) return '#4CAF50'; // Green - Excellent
        if (confidence >= 80) return '#8BC34A'; // Light Green - High
        if (confidence >= 70) return '#FFC107'; // Amber - Good
        if (confidence >= 60) return '#FF9800'; // Orange - Moderate
        return '#F44336'; // Red - Low
    };

    /**
     * Load recommendation to Bot Builder - Martingale Strategy with Level 3 Limit
     */
    const loadToBotBuilder = useCallback(async (recommendation: ScannerRecommendation) => {
        try {
            console.log('🚀 Loading recommendation to Bot Builder:', recommendation);

            // Validate recommendation data
            if (!recommendation || !recommendation.symbol || !recommendation.action) {
                console.error('❌ Invalid recommendation data:', recommendation);
                setStatus('❌ Invalid recommendation data');
                return;
            }

            // Get display name
            const displayName = recommendation.displayName || recommendation.symbol;

            // Use the symbol directly (already uppercase from DERIV_VOLATILITY_SYMBOLS)
            const symbol = recommendation.symbol;

            // Check symbol type
            const isStepIndex = symbol.toLowerCase().startsWith('stprng');
            const isNormalVolatility = /^R_(10|25|50|75|100|150|200|250|300)$/i.test(symbol);
            const is1sVolatility = /^1HZ(10|25|50|75|100|150|200|250|300)V$/i.test(symbol);

            // Determine market and submarket
            let market = 'synthetic_index';
            let submarket = isStepIndex ? 'step_index' : 'random_index';

            // Determine contract type - ALWAYS use CALL/PUT for tick contracts
            const contractType = recommendation.action === 'RISE' ? 'CALL' : 'PUT';

            // Set default stake
            const defaultStake = 0.35;

            // Debug log all variables before XML generation
            console.log('✅ XML Generation Variables:', {
                market,
                submarket,
                symbol,
                contractType,
                defaultStake,
                displayName,
                action: recommendation.action
            });

            // Martingale strategy with level 3 limit (revert after 2 losses) and max 5 losses
            // Includes ROC (Rate of Change) filtering - only trades when market direction aligns with recommendation
            const strategyXml = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
    <variables>
        <variable id="stake_var">stake</variable>
        <variable id="initial_stake_var">initial_stake</variable>
        <variable id="martingale_var">martingale</variable>
        <variable id="loss_count_var">loss_count</variable>
        <variable id="martingale_level_var">martingale_level</variable>
    </variables>
    <block type="trade_definition" id="trade_definition" deletable="false" movable="false" x="0" y="0">
        <statement name="TRADE_OPTIONS">
            <block type="trade_definition_market" deletable="false" movable="false">
                <field name="MARKET_LIST">${market}</field>
                <field name="SUBMARKET_LIST">${submarket}</field>
                <field name="SYMBOL_LIST">${symbol}</field>
                <next>
                    <block type="trade_definition_tradetype" deletable="false" movable="false">
                        <field name="TRADETYPECAT_LIST">callput</field>
                        <field name="TRADETYPE_LIST">callput</field>
                        <next>
                            <block type="trade_definition_contracttype" deletable="false" movable="false">
                                <field name="TYPE_LIST">${contractType}</field>
                                <next>
                                    <block type="trade_definition_candleinterval" deletable="false" movable="false">
                                        <field name="CANDLEINTERVAL_LIST">60</field>
                                        <next>
                                            <block type="trade_definition_restartbuysell" deletable="false" movable="false">
                                                <field name="TIME_MACHINE_ENABLED">FALSE</field>
                                                <next>
                                                    <block type="trade_definition_restartonerror" deletable="false" movable="false">
                                                        <field name="RESTARTONERROR">TRUE</field>
                                                    </block>
                                                </next>
                                            </block>
                                        </next>
                                    </block>
                                </next>
                            </block>
                        </next>
                    </block>
                </next>
            </block>
        </statement>
        <statement name="INITIALIZATION">
            <block type="variables_set">
                <field name="VAR" id="initial_stake_var">initial_stake</field>
                <value name="VALUE">
                    <block type="math_number">
                        <field name="NUM">${defaultStake}</field>
                    </block>
                </value>
                <next>
                    <block type="variables_set">
                        <field name="VAR" id="stake_var">stake</field>
                        <value name="VALUE">
                            <block type="variables_get">
                                <field name="VAR" id="initial_stake_var">initial_stake</field>
                            </block>
                        </value>
                        <next>
                            <block type="variables_set">
                                <field name="VAR" id="martingale_var">martingale</field>
                                <value name="VALUE">
                                    <block type="math_number">
                                        <field name="NUM">1</field>
                                    </block>
                                </value>
                                <next>
                                    <block type="variables_set">
                                        <field name="VAR" id="loss_count_var">loss_count</field>
                                        <value name="VALUE">
                                            <block type="math_number">
                                                <field name="NUM">0</field>
                                            </block>
                                        </value>
                                        <next>
                                            <block type="variables_set">
                                                <field name="VAR" id="martingale_level_var">martingale_level</field>
                                                <value name="VALUE">
                                                    <block type="math_number">
                                                        <field name="NUM">0</field>
                                                    </block>
                                                </value>
                                            </block>
                                        </next>
                                    </block>
                                </next>
                            </block>
                        </next>
                    </block>
                </next>
            </block>
        </statement>
        <statement name="SUBMARKET">
            <block type="trade_definition_tradeoptions" deletable="false" movable="false">
                <field name="DURATIONTYPE_LIST">t</field>
                <value name="DURATION">
                    <shadow type="math_number">
                        <field name="NUM">2</field>
                    </shadow>
                </value>
                <value name="AMOUNT">
                    <shadow type="math_number">
                        <field name="NUM">${defaultStake}</field>
                    </shadow>
                    <block type="variables_get">
                        <field name="VAR" id="stake_var">stake</field>
                    </block>
                </value>
            </block>
        </statement>
    </block>
    <block type="before_purchase" id="before_purchase" deletable="false" movable="false" x="0" y="0">
        <statement name="BEFOREPURCHASE_STACK">
            <block type="controls_if">
                <value name="IF0">
                    <block type="logic_compare">
                        <field name="OP">GTE</field>
                        <value name="A">
                            <block type="variables_get">
                                <field name="VAR" id="loss_count_var">loss_count</field>
                            </block>
                        </value>
                        <value name="B">
                            <block type="math_number">
                                <field name="NUM">5</field>
                            </block>
                        </value>
                    </block>
                </value>
                <statement name="DO0">
                    <block type="notify">
                        <field name="NOTIFICATION_TYPE">warn</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                            <shadow type="text">
                                <field name="TEXT">Maximum 5 consecutive losses reached. Stopping bot.</field>
                            </shadow>
                        </value>
                        <next>
                            <block type="trade_again">
                                <field name="TRADE_AGAIN">FALSE</field>
                            </block>
                        </next>
                    </block>
                </statement>
                <next>
                    <block type="text_print">
                        <value name="TEXT">
                            <block type="text_join">
                                <mutation items="3"></mutation>
                                <value name="ADD0">
                                    <block type="text">
                                        <field name="TEXT">ROC Check: Recommendation=${recommendation.action}, Expecting ${recommendation.action === 'RISE' ? 'UP' : 'DOWN'} movement</field>
                                    </block>
                                </value>
                            </block>
                        </value>
                        <next>
                            <block type="purchase">
                                <field name="PURCHASE_LIST">${contractType}</field>
                            </block>
                        </next>
                    </block>
                </next>
            </block>
        </statement>
    </block>
    <block type="after_purchase" id="after_purchase" deletable="false" movable="false" x="0" y="0">
        <statement name="AFTERPURCHASE_STACK">
            <block type="controls_if">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                    <block type="contract_check_result">
                        <field name="CHECK_RESULT">win</field>
                    </block>
                </value>
                <statement name="DO0">
                    <block type="variables_set">
                        <field name="VAR" id="stake_var">stake</field>
                        <value name="VALUE">
                            <block type="variables_get">
                                <field name="VAR" id="initial_stake_var">initial_stake</field>
                            </block>
                        </value>
                        <next>
                            <block type="variables_set">
                                <field name="VAR" id="loss_count_var">loss_count</field>
                                <value name="VALUE">
                                    <block type="math_number">
                                        <field name="NUM">0</field>
                                    </block>
                                </value>
                                <next>
                                    <block type="variables_set">
                                        <field name="VAR" id="martingale_level_var">martingale_level</field>
                                        <value name="VALUE">
                                            <block type="math_number">
                                                <field name="NUM">0</field>
                                            </block>
                                        </value>
                                    </block>
                                </next>
                            </block>
                        </next>
                    </block>
                </statement>
                <statement name="ELSE">
                    <block type="variables_set">
                        <field name="VAR" id="loss_count_var">loss_count</field>
                        <value name="VALUE">
                            <block type="math_arithmetic">
                                <field name="OP">ADD</field>
                                <value name="A">
                                    <block type="variables_get">
                                        <field name="VAR" id="loss_count_var">loss_count</field>
                                    </block>
                                </value>
                                <value name="B">
                                    <block type="math_number">
                                        <field name="NUM">1</field>
                                    </block>
                                </value>
                            </block>
                        </value>
                        <next>
                            <block type="variables_set">
                                <field name="VAR" id="martingale_level_var">martingale_level</field>
                                <value name="VALUE">
                                    <block type="math_arithmetic">
                                        <field name="OP">ADD</field>
                                        <value name="A">
                                            <block type="variables_get">
                                                <field name="VAR" id="martingale_level_var">martingale_level</field>
                                            </block>
                                        </value>
                                        <value name="B">
                                            <block type="math_number">
                                                <field name="NUM">1</field>
                                            </block>
                                        </value>
                                    </block>
                                </value>
                                <next>
                                    <block type="controls_if">
                                        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                                        <value name="IF0">
                                            <block type="logic_compare">
                                                <field name="OP">GTE</field>
                                                <value name="A">
                                                    <block type="variables_get">
                                                        <field name="VAR" id="martingale_level_var">martingale_level</field>
                                                    </block>
                                                </value>
                                                <value name="B">
                                                    <block type="math_number">
                                                        <field name="NUM">3</field>
                                                    </block>
                                                </value>
                                            </block>
                                        </value>
                                        <statement name="DO0">
                                            <block type="variables_set">
                                                <field name="VAR" id="stake_var">stake</field>
                                                <value name="VALUE">
                                                    <block type="variables_get">
                                                        <field name="VAR" id="initial_stake_var">initial_stake</field>
                                                    </block>
                                                </value>
                                                <next>
                                                    <block type="variables_set">
                                                        <field name="VAR" id="martingale_level_var">martingale_level</field>
                                                        <value name="VALUE">
                                                            <block type="math_number">
                                                                <field name="NUM">0</field>
                                                            </block>
                                                        </value>
                                                    </block>
                                                </next>
                                            </block>
                                        </statement>
                                        <statement name="ELSE">
                                            <block type="variables_set">
                                                <field name="VAR" id="stake_var">stake</field>
                                                <value name="VALUE">
                                                    <block type="math_arithmetic">
                                                        <field name="OP">MULTIPLY</field>
                                                        <value name="A">
                                                            <block type="variables_get">
                                                                <field name="VAR" id="stake_var">stake</field>
                                                            </block>
                                                        </value>
                                                        <value name="B">
                                                            <block type="math_arithmetic">
                                                                <field name="OP">ADD</field>
                                                                <value name="A">
                                                                    <block type="variables_get">
                                                                        <field name="VAR" id="martingale_var">martingale</field>
                                                                    </block>
                                                                </value>
                                                                <value name="B">
                                                                    <block type="math_number">
                                                                        <field name="NUM">1</field>
                                                                    </block>
                                                                </value>
                                                            </block>
                                                        </value>
                                                    </block>
                                                </value>
                                            </block>
                                        </statement>
                                    </block>
                                </next>
                            </block>
                        </next>
                    </block>
                </statement>
                <next>
                    <block type="trade_again"></block>
                </next>
            </block>
        </statement>
    </block>
</xml>`;

            console.log('📄 Loading ML Trader strategy with continuous trading to Bot Builder...');

            // Switch to Bot Builder tab
            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

            // Wait for tab switch and load the strategy
            setTimeout(async () => {
                try {
                    // Import bot skeleton functions
                    const { load } = await import('@/external/bot-skeleton');
                    const { save_types } = await import('@/external/bot-skeleton/constants/save-type');

                    // Load to workspace
                    if (window.Blockly?.derivWorkspace) {

                        await load({
                            block_string: strategyXml,
                            file_name: `MLTrader_${displayName}_${recommendation.action}_${Date.now()}`,
                            workspace: window.Blockly.derivWorkspace,
                            from: save_types.UNSAVED,
                            drop_event: null,
                            strategy_id: null,
                            showIncompatibleStrategyDialog: null,
                        });

                        // Center workspace
                        window.Blockly.derivWorkspace.scrollCenter();

                        setStatus(`✅ Loaded ${recommendation.action} strategy for ${displayName} to Bot Builder`);

                    } else {
                        console.warn('⚠️ Blockly workspace not ready, using fallback method');

                        // Fallback method
                        setTimeout(() => {
                            if (window.Blockly?.derivWorkspace) {
                                window.Blockly.derivWorkspace.clear();
                                const xmlDoc = window.Blockly.utils.xml.textToDom(strategyXml);
                                window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                                window.Blockly.derivWorkspace.scrollCenter();
                                setStatus(`✅ Loaded ${recommendation.action} strategy using fallback method`);
                            }
                        }, 500);
                    }
                } catch (loadError) {
                    console.error('❌ Error loading ML Trader strategy:', loadError);

                    // Final fallback
                    if (window.Blockly?.derivWorkspace) {
                        window.Blockly.derivWorkspace.clear();
                        const xmlDoc = window.Blockly.utils.xml.textToDom(strategyXml);
                        window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                        window.Blockly.derivWorkspace.scrollCenter();
                        setStatus(`✅ Loaded ${recommendation.action} strategy using final fallback`);
                    }
                }
            }, 300);


        } catch (error) {
            console.error('Error loading recommendation to Bot Builder:', error);
            setStatus(`❌ Error loading strategy: ${error}`);
        }
    }, [store.dashboard]);

    return (
        <div
            className="ml-trader"
            style={{ paddingBottom: '10rem', minHeight: '100vh', overflowY: 'auto' }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="ml-trader__status">
                <div className="status-row">
                    <div className="status-indicator">
                        <div className={`status-dot ${is_scanner_active ? 'active' : 'inactive'}`} />
                        <Text size="sm" weight="bold">{status}</Text>
                    </div>

                    {scanner_status && (
                        <div className="scanner-stats desktop-only">
                            <div className="stat-item">
                                <Text size="xs" color="general">{localize('Symbols')}</Text>
                                <Text size="sm" weight="bold">{scanner_status.symbolsTracked}</Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="general">{localize('Opportunities')}</Text>
                                <Text size="sm" weight="bold">{scanner_status.recommendationsCount}</Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="general">{localize('Avg Confidence')}</Text>
                                <Text size="sm" weight="bold">{scanner_status.avgConfidence.toFixed(1)}%</Text>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="ml-trader__content">
                {/* Recommendations Panel */}
                <div className="ml-trader__recommendations">
                    <div className="recommendations-header">
                        <div className="header-title">
                            <Text size="md" weight="bold">{localize('Live Recommendations')}</Text>
                            <Text size="xs" color="general">
                                {localize('AI-Powered Trading Opportunities')}
                            </Text>
                        </div>
                        <div className="header-controls">
                            <button
                                className={`filter-btn ${use_tick_predictor ? 'active' : ''}`}
                                onClick={() => {
                                    setUseTickPredictor(!use_tick_predictor);
                                    if (!use_tick_predictor) {
                                        tickPredictionEngine.reset();
                                    }
                                }}
                            >
                                {use_tick_predictor ? localize('⚡ 2-Tick ON') : localize('⚡ 2-Tick OFF')}
                            </button>
                            <button
                                className={`filter-btn ${show_auto_trade_panel ? 'active' : ''}`}
                                onClick={() => setShowAutoTradePanel(!show_auto_trade_panel)}
                            >
                                {show_auto_trade_panel ? localize('📊 Recommendations') : localize('🤖 Auto-Trade')}
                            </button>
                            <button
                                className={`filter-btn ${show_advanced_view ? 'active' : ''}`}
                                onClick={() => setShowAdvancedView(!show_advanced_view)}
                            >
                                {localize('Advanced View')}
                            </button>
                        </div>
                    </div>

                    {show_auto_trade_panel ? (
                        <AutoTradePanel 
                            onConfigChange={(config) => {
                                mlAutoTrader.configure(config);
                            }}
                        />
                    ) : use_tick_predictor && tick_prediction ? (
                        <div className="tick-prediction-panel">
                            <div className="prediction-header">
                                <Text size="md" weight="bold">⚡ 2-Tick Prediction Engine</Text>
                                <Text size="xs" color="general">Ultra-short momentum analysis</Text>
                            </div>

                            <div className={`prediction-signal ${tick_prediction.direction.toLowerCase()}`}>
                                <div className="signal-direction">
                                    <Text size="xl" weight="bold">
                                        {tick_prediction.direction === 'CALL' ? '📈 CALL' : 
                                         tick_prediction.direction === 'PUT' ? '📉 PUT' : '⏸️ HOLD'}
                                    </Text>
                                </div>
                                <div className="signal-confidence">
                                    <Text size="lg" weight="bold" color={tick_prediction.confidence >= 80 ? 'profit-success' : 'general'}>
                                        {tick_prediction.confidence.toFixed(1)}%
                                    </Text>
                                    <Text size="xs" color="general">Confidence</Text>
                                </div>
                            </div>

                            <div className="prediction-reason">
                                <Text size="sm">{tick_prediction.reason}</Text>
                            </div>

                            <div className="prediction-metrics">
                                <div className="metric">
                                    <Text size="xs" color="general">Consecutive Ticks</Text>
                                    <Text size="sm" weight="bold">{tick_prediction.metrics.consecutiveTicks}</Text>
                                </div>
                                <div className="metric">
                                    <Text size="xs" color="general">Acceleration</Text>
                                    <Text size="sm" weight="bold">{tick_prediction.metrics.acceleration.toFixed(2)}</Text>
                                </div>
                                <div className="metric">
                                    <Text size="xs" color="general">Momentum</Text>
                                    <Text size="sm" weight="bold">{tick_prediction.metrics.momentumStrength.toFixed(1)}%</Text>
                                </div>
                                <div className="metric">
                                    <Text size="xs" color="general">Volatility</Text>
                                    <Text size="sm" weight="bold">{(tick_prediction.metrics.volatility * 100).toFixed(1)}%</Text>
                                </div>
                            </div>

                            {tick_prediction.direction !== 'HOLD' && tick_prediction.confidence >= 80 && (
                                <div className="prediction-action">
                                    <button 
                                        className="execute-btn"
                                        onClick={() => {
                                            const action = tick_prediction.direction === 'CALL' ? 'RISE' : 'FALL';
                                            console.log(`Executing 2-tick ${action} trade at ${tick_prediction.confidence.toFixed(1)}% confidence`);
                                        }}
                                    >
                                        Execute 2-Tick {tick_prediction.direction} Trade
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="recommendations-list">
                            {recommendations.length === 0 ? (
                                <div className="no-recommendations">
                                    <Text size="sm" color="general">
                                        {localize('Scanning for momentum opportunities...')}
                                    </Text>
                                    <div className="scan-progress">
                                        <div
                                            className="progress-bar"
                                            style={{ width: `${scan_progress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="beautiful-cards-container">
                                {recommendations.slice(0, 6).map((rec, index) => (
                                    <div
                                        key={`${rec.symbol}-${index}`}
                                        className={`recommendation-card beautiful-card ${selected_recommendation?.symbol === rec.symbol ? 'selected' : ''}`}
                                        onClick={() => applyRecommendation(rec)}
                                    >
                                        <div className="card-gradient-overlay" />

                                        <div className="rec-header">
                                            <div className="symbol-info">
                                                <div className="symbol-badge">
                                                    <Text size="xs" weight="bold" color="prominent">
                                                        {rec.displayName}
                                                    </Text>
                                                </div>
                                                <div className="rank-badge">
                                                    <Text size="xxs" color="general">#{rec.rank}</Text>
                                                </div>
                                            </div>

                                            <div className="action-section">
                                                <div className={`action-badge ${rec.action.toLowerCase()}`}>
                                                    <div className={`action-icon ${rec.action.toLowerCase()}`}>
                                                        {rec.action === 'RISE' ? '📈' : '📉'}
                                                    </div>
                                                    <Text size="xs" weight="bold">
                                                        {rec.action}
                                                    </Text>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="confidence-section">
                                            <div className="confidence-circle">
                                                <div
                                                    className="confidence-fill"
                                                    style={{
                                                        background: `conic-gradient(${getConfidenceColor(rec.confidence)} ${rec.confidence * 3.6}deg, #e0e0e0 0deg)`
                                                    }}
                                                >
                                                    <div className="confidence-inner">
                                                        <Text size="sm" weight="bold" color="prominent">
                                                            {rec.confidence.toFixed(0)}%
                                                        </Text>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="confidence-label">
                                                <Text size="xs" color="general">{localize('Confidence')}</Text>
                                                <Text size="xs" weight="bold">
                                                    {formatConfidence(rec.confidence)}
                                                </Text>
                                            </div>
                                        </div>

                                        <div className="rec-metrics">
                                            <div className="metric-item">
                                                <div className="metric-icon">⏱️</div>
                                                <div className="metric-content">
                                                    <Text size="xs" color="general">{localize('Duration')}</Text>
                                                    <Text size="sm" weight="bold">{rec.duration}</Text>
                                                </div>
                                            </div>

                                            <div className="metric-item">
                                                <div className="metric-icon">⚡</div>
                                                <div className="metric-content">
                                                    <Text size="xs" color="general">{localize('Momentum')}</Text>
                                                    <Text size="sm" weight="bold">{rec.momentumScore.toFixed(0)}%</Text>
                                                </div>
                                            </div>

                                            <div className="metric-item">
                                                <div className="metric-icon">🎯</div>
                                                <div className="metric-content">
                                                    <Text size="xs" color="general">{localize('Alignment')}</Text>
                                                    <Text size="sm" weight="bold">{rec.trendAlignment.toFixed(0)}%</Text>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="card-actions">
                                            <button
                                                className="action-btn load-to-bot"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    loadToBotBuilder(rec);
                                                }}
                                            >
                                                <span className="btn-icon">🤖</span>
                                                <Text size="xs" weight="bold">{localize('Load to Bot Builder')}</Text>
                                            </button>

                                            <button
                                                className="action-btn apply-settings"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    applyRecommendation(rec);
                                                }}
                                            >
                                                <span className="btn-icon">⚙️</span>
                                                <Text size="xs" weight="bold">{localize('Apply Settings')}</Text>
                                            </button>
                                        </div>

                                        {show_advanced_view && (
                                            <div className="rec-advanced">
                                                <div className="advanced-reason">
                                                    <Text size="xs" color="general">{rec.reason}</Text>
                                                </div>
                                                <div className="advanced-metrics">
                                                    <div className="adv-metric">
                                                        <span className="adv-label">Risk:</span>
                                                        <span className={`adv-value risk-${rec.urgency.toLowerCase()}`}>
                                                            {rec.urgency}
                                                        </span>
                                                    </div>
                                                    <div className="adv-metric">
                                                        <span className="adv-label">R/R:</span>
                                                        <span className="adv-value">{rec.riskReward.toFixed(2)}</span>
                                                    </div>
                                                    <div className="adv-metric">
                                                        <span className="adv-label">Payout:</span>
                                                        <span className="adv-value">{(rec.expectedPayout * 100).toFixed(0)}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        </div>
                    )}
                </div>

                {/* Trading Interface */}
                <div className="ml-trader__trading-interface">
                    <div className="trading-header">
                        <div className="header-title">
                            <Text size="md" weight="bold">{localize('Automated Trading')}</Text>
                            <Text size="xs" color="general">
                                {localize('Continuous trading with AI recommendations')}
                            </Text>
                        </div>
                    </div>

                    <div className="trading-form">
                        {/* ROC Filter Controls */}
                        <div style={{
                            padding: '12px',
                            marginBottom: '16px',
                            borderRadius: '8px',
                            background: roc_enabled ? 'linear-gradient(135deg, #2196F3 0%, #64B5F6 100%)' : '#757575',
                            color: 'white',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Text size="sm" weight="bold" style={{ color: 'white' }}>
                                        📊 ROC Filter (2-Period)
                                    </Text>
                                    <button
                                        onClick={() => setRocEnabled(!roc_enabled)}
                                        style={{
                                            padding: '4px 12px',
                                            borderRadius: '4px',
                                            border: 'none',
                                            background: roc_enabled ? '#4CAF50' : '#f44336',
                                            color: 'white',
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            fontWeight: 'bold'
                                        }}
                                    >
                                        {roc_enabled ? 'ON' : 'OFF'}
                                    </button>
                                </div>
                            </div>
                            {roc_enabled && current_roc && (
                                <div style={{ fontSize: '11px', opacity: 0.9 }}>
                                    <div>Symbol: <strong>{current_roc.symbol}</strong> | Direction: <strong>{current_roc.direction}</strong></div>
                                    <div>ROC Value: <strong>{current_roc.roc.toFixed(4)}%</strong></div>
                                    <div style={{ marginTop: '4px', fontSize: '10px', opacity: 0.85 }}>
                                        ✓ Only executes trades when recommendation aligns with ROC direction
                                    </div>
                                </div>
                            )}
                            {roc_enabled && !current_roc && (
                                <div style={{ fontSize: '11px', opacity: 0.9 }}>
                                    Waiting for price data to calculate ROC...
                                </div>
                            )}
                        </div>

                        {/* Real-Time Trend Indicator */}
                        {trading_interface.is_auto_trading && current_trend && (
                            <div style={{
                                padding: '12px',
                                marginBottom: '16px',
                                borderRadius: '8px',
                                background: current_trend.direction === 'BULLISH' ? 'linear-gradient(135deg, #4CAF50 0%, #81C784 100%)' : 'linear-gradient(135deg, #f44336 0%, #e57373 100%)',
                                color: 'white',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <Text size="sm" weight="bold" style={{ color: 'white' }}>
                                        {current_trend.direction === 'BULLISH' ? '📈 BULLISH TREND' : '📉 BEARISH TREND'}
                                    </Text>
                                    <span style={{ fontSize: '12px', opacity: 0.9 }}>
                                        Changes: {trend_changes_count}
                                    </span>
                                </div>
                                <div style={{ fontSize: '11px', opacity: 0.9 }}>
                                    <div>Trading: <strong>{trend_override_direction || 'Loading...'}</strong> | Confidence: <strong>{current_trend.confidence.toFixed(1)}%</strong></div>
                                    <div>Strength: <strong>{current_trend.strength.toFixed(1)}%</strong> | Price Change: <strong>{current_trend.priceChange > 0 ? '+' : ''}{current_trend.priceChange.toFixed(4)}%</strong></div>
                                </div>
                            </div>
                        )}

                        {/* Continuous AI Recommendation Indicator */}
                        {trading_interface.is_auto_trading && continuous_ai_recommendation && (
                            <div style={{
                                padding: '10px',
                                marginBottom: '16px',
                                borderRadius: '8px',
                                background: 'linear-gradient(135deg, #2196F3 0%, #64B5F6 100%)',
                                color: 'white',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                border: '2px solid rgba(255,255,255,0.3)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Text size="sm" weight="bold" style={{ color: 'white' }}>
                                        🤖 AI RECOMMENDATION: {continuous_ai_recommendation}
                                    </Text>
                                    <span style={{ fontSize: '11px', opacity: 0.9 }}>
                                        Ticks: {tick_count} | Confidence: {ai_recommendation_confidence.toFixed(0)}%
                                    </span>
                                </div>
                                <div style={{ fontSize: '10px', opacity: 0.85, marginTop: '4px' }}>
                                    {contractInProgressRef.current ? '⏳ Contract in progress...' : '✅ Ready to execute on next cycle'}
                                </div>
                            </div>
                        )}

                        <div className="form-row">
                            <div className="form-field">
                                <Text size="xs" color="general">{localize('Duration')}</Text>
                                <input
                                    type="text"
                                    value="2 ticks"
                                    disabled
                                    style={{ backgroundColor: '#f5f5f5', color: '#666' }}
                                />
                            </div>

                            <div className="form-field">
                                <Text size="xs" color="general">{localize('Stake ({{currency}})', { currency: account_currency })}</Text>
                                <input
                                    type="number"
                                    value={trading_interface.stake}
                                    onChange={(e) => setTradingInterface(prev => ({ ...prev, stake: parseFloat(e.target.value) || 0 }))}
                                    min="0.35"
                                    step="0.01"
                                />
                            </div>
                        </div>

                        <div className="trading-actions">
                            <button
                                className={`auto-trading-btn-big ${trading_interface.is_auto_trading ? 'active' : ''}`}
                                onClick={toggleAutoTrading}
                                disabled={!is_authorized || (!trading_interface.is_auto_trading && recommendations.length === 0)}
                                style={{
                                    width: '100%',
                                    padding: '16px 24px',
                                    fontSize: '18px',
                                    fontWeight: 'bold',
                                    borderRadius: '8px',
                                    border: 'none',
                                    cursor: (!is_authorized || (!trading_interface.is_auto_trading && recommendations.length === 0)) ? 'not-allowed' : 'pointer',
                                    backgroundColor: trading_interface.is_auto_trading ? '#f44336' : '#4CAF50',
                                    color: 'white',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                                }}
                            >
                                {trading_interface.is_auto_trading ? '⏹️ STOP AUTO-TRADING' : '▶️ START AUTO-TRADING'}
                            </button>
                        </div>
                    </div>

                    {/* Selected Recommendation Details */}
                    {selected_recommendation && (
                        <div className="selected-recommendation">
                            <Text size="sm" weight="bold">{localize('Selected Opportunity')}</Text>
                            <div className="rec-details">
                                <div className="detail-row">
                                    <span>{localize('Symbol')}:</span>
                                    <span>{selected_recommendation.displayName}</span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('Action')}:</span>
                                    <span className={`action-text ${selected_recommendation.action.toLowerCase()}`}>
                                        {selected_recommendation.action}
                                    </span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('Confidence')}:</span>
                                    <span>{selected_recommendation.confidence.toFixed(1)}%</span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('Momentum Score')}:</span>
                                    <span>{selected_recommendation.momentumScore.toFixed(1)}%</span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('Trend Alignment')}:</span>
                                    <span>{selected_recommendation.trendAlignment.toFixed(1)}%</span>
                                </div>
                                {selected_recommendation && (() => {
                                    try {
                                        const mlPrediction = mlTickAnalyzer.predict(selected_recommendation.symbol);
                                        if (mlPrediction) {
                                            return (
                                                <>
                                                    <div className="detail-row ml-prediction">
                                                        <span className="adv-label">🧠 ML Score:</span>
                                                        <span className="adv-value profit-success">
                                                            {mlPrediction.learning_score.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                    <div className="detail-row ml-prediction">
                                                        <span className="adv-label">Patterns:</span>
                                                        <span className="adv-value">{mlPrediction.patterns_matched}</span>
                                                    </div>
                                                    <div className="detail-row ml-prediction">
                                                        <span className="adv-label">Direction:</span>
                                                        <span className={`adv-value ${mlPrediction.direction.toLowerCase()}`}>
                                                            {mlPrediction.direction}
                                                        </span>
                                                    </div>
                                                </>
                                            );
                                        }
                                    } catch (error) {
                                        console.error('ML prediction error:', error);
                                    }
                                    return null;
                                })()}
                            </div>
                        </div>
                    )}
                </div>

                {/* Symbol Analysis (Advanced View) */}
                {show_advanced_view && (
                    <div className="symbol-analysis">
                        <div className="panel-header">
                            <Text size="md" weight="bold">{localize('Symbol Analysis')}</Text>
                        </div>

                        <div className="analysis-grid">
                            {Array.from(symbol_analyses.entries()).slice(0, 6).map(([symbol, analysis]) => (
                                <div key={symbol} className="analysis-card">
                                    <div className="card-header">
                                        <Text size="sm" weight="bold">{analysis.displayName}</Text>
                                        <div
                                            className="risk-indicator"
                                            style={{ backgroundColor: getRiskColor(analysis.riskLevel) }}
                                        >
                                            {analysis.riskLevel}
                                        </div>
                                    </div>

                                    <div className="timeframe-analysis">
                                        <div className="timeframe">
                                            <span>5m:</span>
                                            <span className={analysis.timeframes.m5.direction.toLowerCase()}>
                                                {analysis.timeframes.m5.direction} ({analysis.timeframes.m5.roc.toFixed(3)}%)
                                            </span>
                                        </div>
                                        <div className="timeframe">
                                            <span>3m:</span>
                                            <span className={analysis.timeframes.m3.direction.toLowerCase()}>
                                                {analysis.timeframes.m3.direction} ({analysis.timeframes.m3.roc.toFixed(3)}%)
                                            </span>
                                        </div>
                                        <div className="timeframe">
                                            <span>1m:</span>
                                            <span className={analysis.timeframes.m1.direction.toLowerCase()}>
                                                {analysis.timeframes.m1.direction} ({analysis.timeframes.m1.roc.toFixed(3)}%)
                                            </span>
                                        </div>
                                    </div>

                                    <div className="momentum-metrics">
                                        <div className="metric-item">
                                            <span>{localize('Momentum')}:</span>
                                            <span>{analysis.momentum.strength.toFixed(0)}%</span>
                                        </div>
                                        <div className="metric-item">
                                            <span>{localize('Alignment')}:</span>
                                            <span>{analysis.timeframes.alignment.toFixed(0)}%</span>
                                        </div>
                                        <div className="metric-item">
                                            <span>{localize('Phase')}:</span>
                                            <span>{analysis.marketPhase}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Trading Statistics */}
            <div className="ml-trader__footer">
                <div className="trading-stats">
                    <div className="stat-item">
                        <Text size="xs" color="general">{localize('Total Trades')}</Text>
                        <Text size="sm" weight="bold">{trading_stats.total_trades}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" color="general">{localize('Auto Trades')}</Text>
                        <Text size="sm" weight="bold" color={trading_interface.is_auto_trading ? 'profit' : 'general'}>
                            {trading_stats.auto_trade_count} {trading_interface.is_auto_trading ? '🤖' : ''}
                        </Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" color="general">{localize('Win Rate')}</Text>
                        <Text size="sm" weight="bold" color={trading_stats.win_rate >= 60 ? 'profit' : 'loss'}>
                            {trading_stats.win_rate.toFixed(1)}%
                        </Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" color="general">{localize('Total P&L')}</Text>
                        <Text size="sm" weight="bold" color={trading_stats.total_profit >= 0 ? 'profit' : 'loss'}>
                            {trading_stats.total_profit.toFixed(2)} {account_currency}
                        </Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" color="general">{localize('Scanner Status')}</Text>
                        <Text size="sm" color={is_scanner_active ? 'profit' : 'general'}>
                            {is_scanner_active ? localize('Active') : localize('Inactive')}
                        </Text>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLTrader;