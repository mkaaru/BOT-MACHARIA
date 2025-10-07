import { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { ScannerRecommendation, ScannerStatus, VolatilityAnalysis } from '@/services/deriv-volatility-scanner';
import { tickStreamManager } from '@/services/tick-stream-manager';
import { mlTickAnalyzer } from '@/services/ml-tick-analyzer';
import { statisticsEmitter } from '@/utils/statistics-emitter';
import { mlAutoTrader } from '@/services/ml-auto-trader';
import { AutoTradePanel } from './auto-trade-panel';
import './ml-trader.scss';

// Define a type for ROC recommendations
interface ROCRecommendation {
    symbol: string;
    displayName: string;
    action: 'RISE' | 'FALL'; // Assuming ROC alignment can suggest direction
    confidence: number; // This might need to be re-evaluated or a new metric introduced
    rank: number;
    roc_5min: number;
    roc_3min: number;
    roc_1min: number;
    // Add any other relevant fields for ROC-based recommendations
}

// Define the ROC analyzer
const rocAnalyzer = (() => {
    const tickData: Record<string, { price: number; timestamp: number }[]> = {};
    const rocCache: Record<string, { roc5: number; roc3: number; roc1: number }> = {};

    const TICK_COUNTS = {
        '5min': 300, // 5 minutes * 60 seconds/min = 300 ticks (assuming 1 tick per second)
        '3min': 180, // 3 minutes * 60 seconds/min = 180 ticks
        '1min': 60,  // 1 minute * 60 seconds/min = 60 ticks
    };

    const getROC = (symbol: string, ticks: number): number => {
        const data = tickData[symbol];
        if (!data || data.length < ticks) {
            return 0; // Not enough data
        }
        const currentPrice = data[data.length - 1].price;
        const pastPrice = data[data.length - ticks].price;
        return ((currentPrice - pastPrice) / pastPrice) * 100;
    };

    const analyze = (symbol: string) => {
        if (!rocCache[symbol]) return null;

        const roc5 = rocCache[symbol].roc5;
        const roc3 = rocCache[symbol].roc3;
        const roc1 = rocCache[symbol].roc1;

        let alignment = false;
        let action: 'RISE' | 'FALL' = 'RISE'; // Default

        // Check for alignment: all ROC values positive or all negative
        if (roc1 > 0 && roc3 > 0 && roc5 > 0) {
            alignment = true;
            action = 'RISE';
        } else if (roc1 < 0 && roc3 < 0 && roc5 < 0) {
            alignment = true;
            action = 'FALL';
        }

        // Simple confidence: based on magnitude of smallest ROC, or a fixed high value if aligned
        const minRoc = Math.min(Math.abs(roc1), Math.abs(roc3), Math.abs(roc5));
        const confidence = alignment ? Math.max(60, Math.min(100, 50 + minRoc)) : 0; // Example confidence

        if (!alignment) return null; // Only return recommendations if aligned

        return {
            roc_5min: roc5,
            roc_3min: roc3,
            roc_1min: roc1,
            alignment: {
                score: confidence, // Using confidence as alignment score for now
                aligned: alignment,
                direction: action
            },
            action: action, // Explicitly return action
            confidence: confidence // Explicitly return confidence
        };
    };

    const processTick = (symbol: string, price: number) => {
        if (!tickData[symbol]) {
            tickData[symbol] = [];
        }
        tickData[symbol].push({ price, timestamp: Date.now() });

        // Keep only enough data for the longest interval
        const maxTicks = TICK_COUNTS['5min'];
        if (tickData[symbol].length > maxTicks) {
            tickData[symbol] = tickData[symbol].slice(tickData[symbol].length - maxTicks);
        }

        // Recalculate ROC if enough data is available
        if (tickData[symbol].length >= TICK_COUNTS['1min']) {
            const roc1 = getROC(symbol, TICK_COUNTS['1min']);
            const roc3 = tickData[symbol].length >= TICK_COUNTS['3min'] ? getROC(symbol, TICK_COUNTS['3min']) : 0;
            const roc5 = tickData[symbol].length >= TICK_COUNTS['5min'] ? getROC(symbol, TICK_COUNTS['5min']) : 0;

            if (!rocCache[symbol]) {
                rocCache[symbol] = { roc5: 0, roc3: 0, roc1: 0 };
            }
            rocCache[symbol] = { roc5, roc3, roc1 };
        }
    };

    const processBulkTicks = (symbol: string, data: { price: number; timestamp: number }[]) => {
        if (!tickData[symbol]) {
            tickData[symbol] = [];
        }
        tickData[symbol] = tickData[symbol].concat(data);

        // Keep only enough data for the longest interval
        const maxTicks = TICK_COUNTS['5min'];
        if (tickData[symbol].length > maxTicks) {
            tickData[symbol] = tickData[symbol].slice(tickData[symbol].length - maxTicks);
        }

        // Recalculate ROC after bulk processing
        if (tickData[symbol].length >= TICK_COUNTS['1min']) {
            const roc1 = getROC(symbol, TICK_COUNTS['1min']);
            const roc3 = tickData[symbol].length >= TICK_COUNTS['3min'] ? getROC(symbol, TICK_COUNTS['3min']) : 0;
            const roc5 = tickData[symbol].length >= TICK_COUNTS['5min'] ? getROC(symbol, TICK_COUNTS['5min']) : 0;

            if (!rocCache[symbol]) {
                rocCache[symbol] = { roc5: 0, roc3: 0, roc1: 0 };
            }
            rocCache[symbol] = { roc5, roc3, roc1 };
        }
    };

    const getAllRecommendations = (symbols: any[]) => {
        const recommendations: ROCRecommendation[] = [];
        let rankCounter = 1;

        symbols.forEach(symbolInfo => {
            const analysisResult = analyze(symbolInfo.symbol);
            if (analysisResult && analysisResult.alignment) {
                recommendations.push({
                    symbol: symbolInfo.symbol,
                    displayName: symbolInfo.display_name,
                    action: analysisResult.action,
                    confidence: analysisResult.confidence,
                    rank: rankCounter++,
                    roc_5min: analysisResult.roc_5min,
                    roc_3min: analysisResult.roc_3min,
                    roc_1min: analysisResult.roc_1min,
                });
            }
        });

        // Sort by confidence (descending)
        recommendations.sort((a, b) => b.confidence - a.confidence);

        return recommendations;
    };

    const reset = () => {
        Object.keys(tickData).forEach(key => tickData[key] = []);
        Object.keys(rocCache).forEach(key => rocCache[key] = { roc5: 0, roc3: 0, roc1: 0 });
    };

    return {
        processTick,
        processBulkTicks,
        analyze,
        getAllRecommendations,
        reset
    };
})();


// Enhanced volatility symbols with 1-second indices and Step Indices
const DERIV_VOLATILITY_SYMBOLS = [
    { symbol: 'stpRNG', display_name: 'Step Index 100', is_1s: false, base_volatility: 100 },
    { symbol: 'stpRNG2', display_name: 'Step Index 200', is_1s: false, base_volatility: 200 },
    { symbol: 'stpRNG3', display_name: 'Step Index 300', is_1s: false, base_volatility: 300 },
    { symbol: 'stpRNG4', display_name: 'Step Index 400', is_1s: false, base_volatility: 400 },
    { symbol: 'stpRNG5', display_name: 'Step Index 500', is_1s: false, base_volatility: 500 },
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s: false, base_volatility: 10 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s: false, base_volatility: 25 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s: false, base_volatility: 50 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s: false, base_volatility: 75 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s: false, base_volatility: 100 },
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

    const apiRef = useRef<any>(null);
    const contractInProgressRef = useRef(false);
    const autoTradingRef = useRef(false);
    const autoTradeIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const currentRecommendationRef = useRef<ROCRecommendation | null>(null); // Use ROCRecommendation

    // Authentication and account state
    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [account_balance, setAccountBalance] = useState<number>(0);

    // Scanner state
    const [scanner_status, setScannerStatus] = useState<ScannerStatus | null>(null); // Keep ScannerStatus for general status if needed
    const [recommendations, setRecommendations] = useState<ROCRecommendation[]>([]); // State for ROC recommendations
    const [selectedSymbol, setSelectedSymbol] = useState<string>(''); // This state might be redundant now, using selected_recommendation
    const [status, setStatus] = useState<string>('Initializing...');
    const [isScannerActive, setIsScannerActive] = useState(false);
    const [scanInterval, setScanInterval] = useState<NodeJS.Timeout | null>(null);
    const [rocData, setRocData] = useState<Record<string, { roc5: number; roc3: number; roc1: number }>>({}); // State for ROC data

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
    const [show_advanced_view, setShowAdvancedView] = useState(false);
    const [show_auto_trade_panel, setShowAutoTradePanel] = useState(false);
    const [filter_settings] = useState({ // This might need adjustment for ROC recommendations
        min_confidence: 75,
        min_momentum: 60, // This might become less relevant or need redefinition for ROC
        max_risk: 'HIGH' as 'LOW' | 'MEDIUM' | 'HIGH',
        preferred_durations: ['1m', '2m', '3m'] as string[] // This might need adjustment
    });

    // Auto-load to Bot Builder state
    const [auto_load_to_bot_builder, setAutoLoadToBotBuilder] = useState(false);

    // Performance tracking
    const [trading_stats, setTradingStats] = useState({
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        total_profit: 0,
        win_rate: 0,
        auto_trade_count: 0
    });

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
            console.log(`🔍 Auto-trade check: Top recommendation = ${topRecommendation.displayName} ${topRecommendation.action} (${topRecommendation.confidence.toFixed(1)}%)`);
            console.log(`📊 Contract in progress status: ${contractInProgressRef.current}`);

            if (mlAutoTrader.shouldExecuteTrade(topRecommendation)) {
                if (!contractInProgressRef.current) {
                    console.log('✅ Auto-trade conditions met - executing trade...');
                    executeAutoTrade(topRecommendation);
                } else {
                    console.log('⏸️ Contract in progress, skipping trade');
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

                console.log('🔍 Found Step Index symbols:', stepIndexSymbols.map((s: any) => `${s.symbol} (${s.display_name})`));

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

            // Initialize volatility scanner (now ROC scanner)
            setStatus('Initializing ROC scanner...');
            await initializeVolatilityScanner();

            setStatus('ML Trader ready - Scanning for ROC opportunities');
            setIsScannerActive(true);

        } catch (error) {
            console.error('Failed to initialize ML Trader:', error);
            setStatus(`Initialization failed: ${error}`);
        }
    }, []);

    /**
     * Initialize tick streams for all volatility indices
     */
    const initializeTickStreams = useCallback(async () => {
        try {
            console.log('🔄 Initializing tick streams for ML Trader...');

            // Subscribe to all volatility symbols
            await tickStreamManager.subscribeToAllVolatilities();

            // Add tick callbacks to feed the ROC analyzer
            DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
                tickStreamManager.addTickCallback(symbolInfo.symbol, (tick) => {
                    // Feed tick to ROC analyzer
                    rocAnalyzer.processTick(tick.symbol, tick.quote);
                });
            });

            console.log('✅ Tick streams initialized for all volatility indices');

        } catch (error) {
            console.error('Failed to initialize tick streams:', error);
            throw error;
        }
    }, []);

    /**
     * Initialize ROC scanner
     */
    const initializeVolatilityScanner = useCallback(async () => {
        try {
            console.log('📊 Initializing ROC-based scanner...');

            // Fetch and process historical data for initial ROC calculation
            const historicalDataPromises = DERIV_VOLATILITY_SYMBOLS.map(async (symbolInfo) => {
                const symbol = symbolInfo.symbol;
                try {
                    // Fetch historical ticks (e.g., 500 ticks for initial calculation)
                    const historicalData = await tickStreamManager.get500HistoricalTicks(symbol);
                    if (historicalData && historicalData.length > 0) {
                        // Transform TickData[] to the format expected by ROC analyzer
                        const formattedData = historicalData.map(tick => ({
                            price: tick.quote,
                            timestamp: tick.epoch * 1000
                        }));

                        // Process bulk data for ROC analyzer
                        try {
                            rocAnalyzer.processBulkTicks(symbol, formattedData);
                            console.log(`✅ Processed ${formattedData.length} ticks for ${symbol}`);
                        } catch (error) {
                            console.error(`Failed to process historical data for ${symbol}:`, error);
                        }
                    } else {
                        console.warn(`No historical data found for ${symbol} to initialize ROC.`);
                    }
                } catch (error) {
                    console.error(`Error fetching historical data for ${symbol}:`, error);
                }
            });

            await Promise.all(historicalDataPromises);

            // Perform immediate scan after historical data loads
            await performScan();

            // Set up periodic scanning every 3 seconds
            const interval = setInterval(async () => {
                await performScan();
            }, 3000);

            setScanInterval(interval);

        } catch (error) {
            console.error('Failed to initialize ROC scanner:', error);
            setStatus(`ROC scanner initialization failed: ${error}`);
        }
    }, []);

    /**
     * Perform ROC scan
     */
    const performScan = useCallback(async () => {
        try {
            // Get all ROC recommendations (only aligned ones)
            const allRecommendations = rocAnalyzer.getAllRecommendations(DERIV_VOLATILITY_SYMBOLS);

            if (allRecommendations.length > 0) {
                setRecommendations(allRecommendations);
                setStatus(`Found ${allRecommendations.length} opportunities with ROC alignment`);

                // Update ROC data for display
                const rocDataMap: Record<string, { roc5: number; roc3: number; roc1: number }> = {};
                DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
                    const analysis = rocAnalyzer.analyze(symbolInfo.symbol);
                    if (analysis) {
                        rocDataMap[symbolInfo.symbol] = {
                            roc5: analysis.roc_5min,
                            roc3: analysis.roc_3min,
                            roc1: analysis.roc_1min
                        };
                    }
                });
                setRocData(rocDataMap);
            } else {
                setStatus('Scanning... No ROC alignment detected');
            }
        } catch (error) {
            console.error('Error during ROC scan:', error);
            setStatus(`Scan error: ${error}`);
        }
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
     * Handle auto trading - called when new recommendations arrive
     */
    const handleAutoTrading = useCallback(async (recs: ROCRecommendation[]) => { // Changed to ROCRecommendation
        // Filter recommendations based on user settings
        const filteredRecs = recs.filter(rec =>
            rec.confidence >= filter_settings.min_confidence &&
            // rec.momentumScore >= filter_settings.min_momentum && // ROC doesn't have momentumScore directly
            filter_settings.preferred_durations.includes(rec.action === 'RISE' ? '5m' : '1m') && // Example: Map action to duration preference
            (filter_settings.max_risk === 'HIGH' || // Risk filtering might need re-evaluation
             (filter_settings.max_risk === 'MEDIUM' && rec.confidence < 90) ||
             (filter_settings.max_risk === 'LOW' && rec.confidence < 80))
        );

        if (filteredRecs.length === 0) {
            console.log('No recommendations match filter criteria');
            return;
        }

        // Take the highest confidence recommendation
        const topRec = filteredRecs[0];

        // Update current recommendation for auto-trading
        currentRecommendationRef.current = topRec;
        setSelectedRecommendation(topRec); // Assuming setSelectedRecommendation can handle ROCRecommendation

        // Apply recommendation to trading interface
        applyRecommendation(topRec);

        console.log(`🎯 Auto-trade switched to: ${topRec.displayName} - ${topRec.action} (${topRec.confidence.toFixed(1)}% confidence)`);
    }, [filter_settings]);

    /**
     * Execute an automated trade based on recommendation
     */
    const executeAutoTrade = useCallback(async (recommendation: ROCRecommendation) => { // Changed to ROCRecommendation
        if (!apiRef.current || contractInProgressRef.current) return;

        contractInProgressRef.current = true;
        const config = mlAutoTrader.getConfig();
        const stake = config.stake_amount || 1.0; // Default stake if not configured

        console.log(`🤖 AUTO-TRADE EXECUTING: ${recommendation.action} on ${recommendation.symbol} (${recommendation.displayName}) - Stake: ${stake}`);

        try {
            // Determine duration based on recommendation's implied timeframe (e.g., action)
            // This is a simplification; ideally, recommendation would include desired duration.
            let durationInSeconds: number;
            let durationUnit: 's' | 'm' = 's';

            if (recommendation.action === 'RISE') {
                // Prioritize longer timeframe for RISE if aligned
                durationInSeconds = DURATION_OPTIONS.find(d => d.label === '5 minutes')?.seconds || 300;
            } else {
                // Prioritize shorter timeframe for FALL if aligned
                durationInSeconds = DURATION_OPTIONS.find(d => d.label === '1 minute')?.seconds || 60;
            }

            const tradeParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: recommendation.action === 'RISE' ? 'CALL' : 'PUT', // Assuming RISE maps to CALL, FALL to PUT
                currency: account_currency,
                duration: durationInSeconds,
                duration_unit: durationUnit,
                symbol: recommendation.symbol
            };

            console.log('📤 Sending proposal request:', tradeParams);
            const proposal_response = await apiRef.current.send(tradeParams);

            if (proposal_response.error) {
                console.error('❌ Proposal error:', proposal_response.error);
                throw new Error(proposal_response.error.message);
            }

            if (proposal_response.proposal) {
                console.log('✅ Proposal received, ID:', proposal_response.proposal.id);

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

                    console.log(`✅ CONTRACT PURCHASED! ID: ${buy_response.buy.contract_id}, Entry: ${entryPrice}, Payout: ${payout}`);

                    mlAutoTrader.registerTrade(
                        recommendation, // Pass the ROCRecommendation
                        buy_response.buy.contract_id,
                        entryPrice,
                        payout
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
    }, [account_currency, mlAutoTrader.getConfig, DURATION_OPTIONS]); // Added dependencies

    /**
     * Execute a manual trade based on recommendation
     */
    const executeTrade = useCallback(async (recommendation: ROCRecommendation) => { // Changed to ROCRecommendation
        if (!apiRef.current || contractInProgressRef.current) return;

        contractInProgressRef.current = true;
        setStatus(`Executing ${recommendation.action} trade on ${recommendation.displayName}...`);

        try {
            // Determine duration based on recommendation's implied timeframe
            let durationInSeconds: number;
            let durationUnit: 's' | 'm' = 's';

            if (recommendation.action === 'RISE') {
                durationInSeconds = DURATION_OPTIONS.find(d => d.label === '5 minutes')?.seconds || 300;
            } else {
                durationInSeconds = DURATION_OPTIONS.find(d => d.label === '1 minute')?.seconds || 60;
            }

            const tradeParams = {
                proposal: 1,
                amount: trading_interface.stake,
                basis: 'stake',
                contract_type: recommendation.action === 'RISE' ? 'CALL' : 'PUT',
                currency: account_currency,
                duration: durationInSeconds,
                duration_unit: durationUnit,
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
    }, [trading_interface.stake, account_currency, DURATION_OPTIONS]); // Added dependencies

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
            const new_total_trades = prev.total_trades + 1;
            const new_winning = is_win ? prev.winning_trades + 1 : prev.winning_trades;
            const new_losing = !is_win ? prev.losing_trades + 1 : prev.losing_trades;
            const new_total_profit = prev.total_profit + profit;
            const new_win_rate = new_total_trades > 0 ? (new_winning / new_total_trades) * 100 : 0;

            return {
                ...prev,
                total_trades: new_total_trades,
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

        console.log(`🎯 Contract completed:`, contract);
        console.log(`💰 Profit/Loss: ${profit.toFixed(2)} ${account_currency}`);

        contractInProgressRef.current = false;
    }, [account_currency]);

    /**
     * Apply recommendation to trading interface
     */
    const applyRecommendation = useCallback((recommendation: ROCRecommendation) => { // Changed to ROCRecommendation
        setTradingInterface(prev => ({
            ...prev,
            symbol: recommendation.symbol,
            contract_type: recommendation.action === 'RISE' ? 'CALL' : 'PUT',
            // Duration should align with the ROC timeframe that triggered the recommendation
            duration: recommendation.action === 'RISE' ? DURATION_OPTIONS.find(d => d.label === '5 minutes')?.seconds || 300 : DURATION_OPTIONS.find(d => d.label === '1 minute')?.seconds || 60,
            duration_unit: 's'
        }));

        setSelectedRecommendation(recommendation);

        setStatus(`Applied recommendation: ${recommendation.action} ${recommendation.displayName} (${recommendation.confidence.toFixed(1)}% confidence)`);
    }, []);

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
            // Start auto-trading
            setStatus('🤖 Auto-trading activated - monitoring recommendations...');
            console.log('✅ Auto-trading ENABLED - mlAutoTrader config:', mlAutoTrader.getConfig());
        } else {
            // Stop auto-trading
            setStatus('⏹️ Auto-trading stopped');
            console.log('⏹️ Auto-trading DISABLED');
        }
    }, [trading_interface.is_auto_trading]);

    /**
     * Manual trade execution
     */
    const executeManualTrade = useCallback(async () => {
        if (!selectedRecommendation) return; // Ensure a recommendation is selected

        try {
            // Use the stored selectedRecommendation to execute the trade
            await executeTrade(selectedRecommendation as ROCRecommendation); // Cast to ROCRecommendation
        } catch (error) {
            console.error('Manual trade error:', error);
        }
    }, [selectedRecommendation, executeTrade]);

    /**
     * Cleanup function
     */
    const cleanup = useCallback(() => {
        autoTradingRef.current = false;
        contractInProgressRef.current = false;

        // Clear auto-trading interval
        if (autoTradeIntervalRef.current) {
            clearInterval(autoTradeIntervalRef.current);
            autoTradeIntervalRef.current = null;
        }

        // Clear scan interval
        if (scanInterval) {
            clearInterval(scanInterval);
            setScanInterval(null);
        }

        // Unsubscribe from tick streams
        DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            tickStreamManager.unsubscribeFromSymbol(symbolInfo.symbol);
        });

        // Reset ROC analyzer data
        rocAnalyzer.reset();

        console.log('ML Trader cleanup completed');
    }, [scanInterval]);

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
     * Load recommendation to Bot Builder
     */
    const loadToBotBuilder = useCallback(async (recommendation: ROCRecommendation) => { // Changed to ROCRecommendation
        try {
            console.log('🚀 Loading recommendation to Bot Builder:', recommendation);

            // Get display name
            const displayName = recommendation.displayName;

            // Determine market and submarket based on symbol
            let market = 'synthetic_index';
            let submarket = 'random_index';

            // Check if it's a Step Index (stpRNG, stpRNG2, stpRNG3, stpRNG4, stpRNG5)
            const isStepIndex = recommendation.symbol.toLowerCase().startsWith('stprng');

            if (isStepIndex) {
                submarket = 'step_index';
            }

            // Use the symbol directly (already uppercase from DERIV_VOLATILITY_SYMBOLS)
            const symbol = recommendation.symbol;

            // Duration and contract type based on recommendation action
            const durationTicks = recommendation.action === 'RISE' ? 300 : 60; // 5 min for RISE, 1 min for FALL
            const contractType = recommendation.action === 'RISE' ? 'CALL' : 'PUT';

            // Set default stake to 0.35
            const defaultStake = 0.35;

            // Prepare strategy XML with martingale settings from default bot builder
            const strategyXml = `
                <xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
                    <variables>
                        <variable id="x]b3MHpbtR?cJQDP@,eG">martingale:resultIsWin</variable>
                        <variable id="[M$5RsD\`g|8-P;C+mbf4">martingale:profit</variable>
                        <variable id="]6T=O624:eVRioXro1kh">Notification:currentStake</variable>
                        <variable id="Kb@{Vb{+5IqV=d~y*dcr">martingale:totalProfit</variable>
                        <variable id="6G^6o^Ic@rjF|sHv*m.6">martingale:tradeAgain</variable>
                        <variable id="3^~61:59m?#VJ(:SG^^[">Maximum Stake</variable>
                        <variable id="*p5|Lkk9Q^ZuPBQ-48g2">martingale:profitThreshold</variable>
                        <variable id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</variable>
                        <variable id="[$B]vBH,~wrN\`PUt5m/f">martingale:initialStake</variable>
                        <variable id="Gh~KH=(G5Q?:C:QU{3(P">stake</variable>
                        <variable id="a1BTYNHC?_yR4sfvNJ7N">martingale:lossThreshold</variable>
                        <variable id="4vh+dtelQS#?}@cNPcN!">maxStake</variable>
                        <variable id="p#@Pr/Y.sKueWX#oRSPl">Notification:totalProfit</variable>
                        <variable id="/VZkC:5@oNcl%%_S,N)K">martingale</variable>
                        <variable id="ipD5?_dQ1Zkvf%v|[?DQ">martingale:size</variable>
                        <variable id="I--KAm(C+#{d?~ip*23e">Notification:profitThresholdReached</variable>
                        <variable id="5SwcMzq.f)VNUzjbKfrw">Notification:lossThresholdReached</variable>
                        <variable id="consecutiveLossCount">consecutiveLossCount</variable>
                        <variable id="maxConsecutiveLoss">maxConsecutiveLoss</variable>
                        <variable id="durationTicks">durationTicks</variable>
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
                                        <field name="TRADETYPE_LIST">${contractType}</field>
                                        <next>
                                            <block type="trade_definition_contracttype" deletable="false" movable="false">
                                                <field name="TYPE_LIST">${contractType}</field>
                                                <next>
                                                    <block type="trade_definition_candleinterval" deletable="false" movable="false">
                                                        <field name="CANDLEINTERVAL_LIST">tick</field> <!-- Set to tick for tick-based analysis -->
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
                            <block type="variables_set" id="init_consecutive_loss">
                                <field name="VAR" id="consecutiveLossCount">consecutiveLossCount</field>
                                <value name="VALUE">
                                    <block type="math_number">
                                        <field name="NUM">0</field>
                                    </block>
                                </value>
                                <next>
                                    <block type="variables_set" id="init_max_consecutive_loss">
                                        <field name="VAR" id="maxConsecutiveLoss">maxConsecutiveLoss</field>
                                        <value name="VALUE">
                                            <block type="math_number">
                                                <field name="NUM">5</field>
                                            </block>
                                        </value>
                                        <next>
                                            <block type="variables_set" id="init_stake">
                                                <field name="VAR" id="Gh~KH=(G5Q?:C:QU{3(P">stake</field>
                                                <value name="VALUE">
                                                    <block type="math_number">
                                                        <field name="NUM">${defaultStake}</field>
                                                    </block>
                                                </value>
                                                <next>
                                                    <block type="variables_set" id="init_duration_ticks">
                                                        <field name="VAR" id="durationTicks">durationTicks</field>
                                                        <value name="VALUE">
                                                            <block type="math_number">
                                                                <field name="NUM">${durationTicks}</field>
                                                            </block>
                                                        </value>
                                                        <next>
                                                            <block type="variables_set" id="init_martingale">
                                                                <field name="VAR" id="/VZkC:5@oNcl%%_S,N)K">martingale</field>
                                                                <value name="VALUE">
                                                                    <block type="math_number">
                                                                        <field name="NUM">1</field>
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
                                <field name="DURATIONTYPE_LIST">t</field> <!-- 't' for ticks -->
                                <value name="DURATION">
                                    <shadow type="math_number">
                                        <field name="NUM">${durationTicks}</field>
                                    </shadow>
                                    <block type="math_number">
                                        <field name="NUM">${durationTicks}</field>
                                    </block>
                                </value>
                                <value name="AMOUNT">
                                    <shadow type="math_number">
                                        <field name="NUM">${defaultStake}</field>
                                    </shadow>
                                    <block type="procedures_callreturn" id="call_martingale_amount">
                                        <mutation xmlns="http://www.w3.org/1999/xhtml" name="Martingale Trade Amount"></mutation>
                                    </block>
                                </value>
                            </block>
                        </statement>
                    </block>
                    <block type="before_purchase" id="before_purchase" deletable="false" movable="false" x="0" y="400">
                        <statement name="BEFOREPURCHASE_STACK">
                            <block type="controls_if" id="check_consecutive_loss">
                                <value name="IF0">
                                    <block type="logic_compare">
                                        <field name="OP">GTE</field>
                                        <value name="A">
                                            <block type="variables_get">
                                                <field name="VAR" id="consecutiveLossCount">consecutiveLossCount</field>
                                            </block>
                                        </value>
                                        <value name="B">
                                            <block type="variables_get">
                                                <field name="VAR" id="maxConsecutiveLoss">maxConsecutiveLoss</field>
                                            </block>
                                        </value>
                                    </block>
                                </value>
                                <statement name="DO0">
                                    <block type="notify">
                                        <field name="NOTIFICATION_TYPE">error</field>
                                        <field name="NOTIFICATION_SOUND">silent</field>
                                        <value name="MESSAGE">
                                            <shadow type="text">
                                                <field name="TEXT">Stop loss triggered: Maximum consecutive losses reached</field>
                                            </shadow>
                                        </value>
                                    </block>
                                </statement>
                                <next>
                                    <block type="purchase" id="purchase">
                                        <field name="PURCHASE_LIST">${contractType}</field>
                                    </block>
                                </next>
                            </block>
                        </statement>
                    </block>
                    <block type="after_purchase" id="after_purchase" deletable="false" movable="false" x="0" y="600">
                        <statement name="AFTERPURCHASE_STACK">
                            <block type="controls_if" id="handle_result">
                                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                                <value name="IF0">
                                    <block type="contract_check_result">
                                        <field name="CHECK_RESULT">win</field>
                                    </block>
                                </value>
                                <statement name="DO0">
                                    <block type="variables_set" id="reset_consecutive_loss_win">
                                        <field name="VAR" id="consecutiveLossCount">consecutiveLossCount</field>
                                        <value name="VALUE">
                                            <block type="math_number">
                                                <field name="NUM">0</field>
                                            </block>
                                        </value>
                                        <next>
                                            <block type="variables_set" id="reset_multiplier_win">
                                                <field name="VAR" id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</field>
                                                <value name="VALUE">
                                                    <block type="math_number">
                                                        <field name="NUM">1</field>
                                                    </block>
                                                </value>
                                            </block>
                                        </next>
                                    </block>
                                </statement>
                                <statement name="ELSE">
                                    <block type="math_change" id="increment_consecutive_loss">
                                        <field name="VAR" id="consecutiveLossCount">consecutiveLossCount</field>
                                        <value name="DELTA">
                                            <shadow type="math_number">
                                                <field name="NUM">1</field>
                                            </shadow>
                                        </value>
                                        <next>
                                            <block type="variables_set" id="update_multiplier_loss">
                                                <field name="VAR" id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</field>
                                                <value name="VALUE">
                                                    <block type="math_arithmetic">
                                                        <field name="OP">MULTIPLY</field>
                                                        <value name="A">
                                                            <shadow type="math_number">
                                                                <field name="NUM">1</field>
                                                            </shadow>
                                                            <block type="variables_get">
                                                                <field name="VAR" id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</field>
                                                            </block>
                                                        </value>
                                                        <value name="B">
                                                            <shadow type="math_number">
                                                                <field name="NUM">1</field>
                                                            </shadow>
                                                            <block type="variables_get">
                                                                <field name="VAR" id="/VZkC:5@oNcl%%_S,N)K">martingale</field>
                                                            </block>
                                                        </value>
                                                    </block>
                                                </value>
                                            </block>
                                        </next>
                                    </block>
                                </statement>
                                <next>
                                    <block type="controls_if" id="check_stop_loss">
                                        <value name="IF0">
                                            <block type="logic_compare">
                                                <field name="OP">LT</field>
                                                <value name="A">
                                                    <block type="variables_get">
                                                        <field name="VAR" id="consecutiveLossCount">consecutiveLossCount</field>
                                                    </block>
                                                </value>
                                                <value name="B">
                                                    <block type="variables_get">
                                                        <field name="VAR" id="maxConsecutiveLoss">maxConsecutiveLoss</field>
                                                    </block>
                                                </value>
                                            </block>
                                        </value>
                                        <statement name="DO0">
                                            <block type="trade_again" id="trade_again">
                                                <field name="TRADE_AGAIN_TYPE">true</field>
                                            </block>
                                        </statement>
                                    </block>
                                </next>
                            </block>
                        </statement>
                    </block>
                    <block type="procedures_defreturn" id="martingale_amount_func" x="0" y="1000">
                        <field name="NAME">Martingale Trade Amount</field>
                        <statement name="STACK">
                            <block type="controls_if" id="init_check_multiplier">
                                <value name="IF0">
                                    <block type="logic_compare">
                                        <field name="OP">EQ</field>
                                        <value name="A">
                                            <block type="variables_get">
                                                <field name="VAR" id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</field>
                                            </block>
                                        </value>
                                        <value name="B">
                                            <block type="logic_null"></block>
                                        </value>
                                    </block>
                                </value>
                                <statement name="DO0">
                                    <block type="variables_set">
                                        <field name="VAR" id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</field>
                                        <value name="VALUE">
                                            <block type="math_number">
                                                <field name="NUM">1</field>
                                            </block>
                                        </value>
                                    </block>
                                </statement>
                            </block>
                        </statement>
                        <value name="RETURN">
                            <block type="math_arithmetic">
                                <field name="OP">MULTIPLY</field>
                                <value name="A">
                                    <shadow type="math_number">
                                        <field name="NUM">1</field>
                                    </shadow>
                                    <block type="variables_get">
                                        <field name="VAR" id="FRbI:RhI/\`[lrO\`o;=P,">martingale:multiplier</field>
                                    </block>
                                </value>
                                <value name="B">
                                    <shadow type="math_number">
                                        <field name="NUM">1</field>
                                    </shadow>
                                    <block type="variables_get">
                                        <field name="VAR" id="Gh~KH=(G5Q?:C:QU{3(P">stake</field>
                                    </block>
                                </value>
                            </block>
                        </value>
                    </block>
                </xml>
            `;

            console.log('📄 Loading ROC strategy with continuous trading to Bot Builder...');

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
                        console.log('📦 Loading ROC strategy to workspace...');

                        await load({
                            block_string: strategyXml,
                            file_name: `ROCTrader_${displayName}_${recommendation.action}_${Date.now()}`,
                            workspace: window.Blockly.derivWorkspace,
                            from: save_types.UNSAVED,
                            drop_event: null,
                            strategy_id: null,
                            showIncompatibleStrategyDialog: null,
                        });

                        // Center workspace
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ ROC strategy loaded to workspace');

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
                                console.log('✅ ROC strategy loaded using fallback method');
                                setStatus(`✅ Loaded ${recommendation.action} strategy using fallback method`);
                            }
                        }, 500);
                    }
                } catch (loadError) {
                    console.error('❌ Error loading ROC strategy:', loadError);

                    // Final fallback
                    if (window.Blockly?.derivWorkspace) {
                        window.Blockly.derivWorkspace.clear();
                        const xmlDoc = window.Blockly.utils.xml.textToDom(strategyXml);
                        window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ ROC strategy loaded using final fallback');
                        setStatus(`✅ Loaded ${recommendation.action} strategy using final fallback`);
                    }
                }
            }, 300);

            console.log(`✅ Loaded ${displayName} - ${recommendation.action} strategy to Bot Builder`);

        } catch (error) {
            console.error('Error loading recommendation to Bot Builder:', error);
            setStatus(`❌ Error loading strategy: ${error}`);
        }
    }, [store.dashboard, DURATION_OPTIONS]); // Added DURATION_OPTIONS dependency

    return (
        <div
            className="ml-trader"
            style={{ paddingBottom: '10rem', minHeight: '100vh', overflowY: 'auto' }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="ml-trader__header">
                <div className="header-title">
                    <Text size="lg" weight="bold" color="prominent">
                        {localize('Advanced ROC Trader')}
                    </Text>
                    <Text size="xs" color="general">
                        {localize('Rate of Change Multi-Timeframe Alignment')}
                    </Text>
                </div>

                <div className="header-stats">
                    {is_authorized && (
                        <div className="account-info desktop-only">
                            <Text size="sm" weight="bold">
                                {localize('Balance: {{balance}} {{currency}}', {
                                    balance: account_balance.toFixed(2),
                                    currency: account_currency
                                })}
                            </Text>
                            <Text size="xs" color="general">
                                {localize('Win Rate: {{rate}}%', { rate: trading_stats.win_rate.toFixed(1) })}
                            </Text>
                        </div>
                    )}
                </div>
            </div>

            <div className="ml-trader__status">
                <div className="status-row">
                    <div className="status-indicator">
                        <div className={`status-dot ${is_scanner_active ? 'active' : 'inactive'}`} />
                        <Text size="sm" weight="bold">{status}</Text>
                    </div>

                    {scanner_status && ( // Keep this if scanner_status provides useful general info
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
                    ) : (
                        <div className="recommendations-list">
                            {recommendations.length === 0 ? (
                                <div className="no-recommendations">
                                    <Text size="sm" color="general">
                                        {localize('Scanning for ROC opportunities...')}
                                    </Text>
                                    {/* Progress bar might be less relevant without bulk scan progress */}
                                    {/* <div className="scan-progress">
                                        <div
                                            className="progress-bar"
                                            style={{ width: `${scan_progress}%` }}
                                        />
                                    </div> */}
                                </div>
                            ) : (
                                <div className="beautiful-cards-container">
                                {recommendations.slice(0, 6).map((rec, index) => (
                                    <div
                                        key={`${rec.symbol}-${index}`}
                                        className={`recommendation-card beautiful-card ${selectedRecommendation?.symbol === rec.symbol ? 'selected' : ''}`}
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

                                        {/* ROC Data Display */}
                                        <div className="recommendation-details">
                                            <div className="detail-row">
                                                <span className="label">5-Min ROC (300 ticks):</span>
                                                <span className={`value ${rec.roc_5min > 0 ? 'bullish' : 'bearish'}`}>
                                                    {rec.roc_5min.toFixed(4)}%
                                                </span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="label">3-Min ROC (180 ticks):</span>
                                                <span className={`value ${rec.roc_3min > 0 ? 'bullish' : 'bearish'}`}>
                                                    {rec.roc_3min.toFixed(4)}%
                                                </span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="label">1-Min ROC (60 ticks):</span>
                                                <span className={`value ${rec.roc_1min > 0 ? 'bullish' : 'bearish'}`}>
                                                    {rec.roc_1min.toFixed(4)}%
                                                </span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="label">Alignment:</span>
                                                <span className={`value bullish`}>
                                                    FULL ALIGNMENT ({rec.action})
                                                </span>
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
                                                {/* Reason and other advanced metrics might need to be adapted for ROC */}
                                                <div className="advanced-reason">
                                                    <Text size="xs" color="general">ROC Alignment detected across multiple timeframes.</Text>
                                                </div>
                                                <div className="advanced-metrics">
                                                    <div className="adv-metric">
                                                        <span className="adv-label">Risk:</span>
                                                        <span className={`adv-value risk-${rec.confidence < 70 ? 'high' : rec.confidence < 90 ? 'medium' : 'low'}`}>
                                                            {rec.confidence < 70 ? 'High' : rec.confidence < 90 ? 'Medium' : 'Low'}
                                                        </span>
                                                    </div>
                                                    {/* Risk/Reward and Payout might need separate calculation based on ROC strategy */}
                                                    <div className="adv-metric">
                                                        <span className="adv-label">R/R:</span>
                                                        <span className="adv-value">N/A</span>
                                                    </div>
                                                    <div className="adv-metric">
                                                        <span className="adv-label">Payout:</span>
                                                        <span className="adv-value">N/A</span>
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
                            <Text size="md" weight="bold">{localize('Trading Interface')}</Text>
                            <Text size="xs" color="general">
                                {localize('Configure and Execute Trades')}
                            </Text>
                        </div>
                        <div className="auto-trading-controls">
                            <button
                                className={`auto-trading-btn ${trading_interface.is_auto_trading ? 'active' : ''}`}
                                onClick={toggleAutoTrading}
                                disabled={!is_authorized || recommendations.length === 0}
                            >
                                {trading_interface.is_auto_trading ? '⏹️ Stop Auto-Trading' : '▶️ Start Auto-Trading'}
                            </button>

                            <div className="auto-load-toggle">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={auto_load_to_bot_builder}
                                        onChange={(e) => setAutoLoadToBotBuilder(e.target.checked)}
                                    />
                                    <span>Auto-load to Bot Builder</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="trading-form">
                        <div className="form-row">
                            <div className="form-field">
                                <Text size="xs" color="general">{localize('Symbol')}</Text>
                                <select
                                    value={trading_interface.symbol}
                                    onChange={(e) => setTradingInterface(prev => ({ ...prev, symbol: e.target.value }))}
                                >
                                    {DERIV_VOLATILITY_SYMBOLS.map(sym => (
                                        <option key={sym.symbol} value={sym.symbol}>
                                            {sym.display_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-field">
                                <Text size="xs" color="general">{localize('Contract Type')}</Text>
                                <select
                                    value={trading_interface.contract_type}
                                    onChange={(e) => setTradingInterface(prev => ({ ...prev, contract_type: e.target.value as 'CALL' | 'PUT' }))}
                                >
                                    {RISE_FALL_TYPES.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-field">
                                <Text size="xs" color="general">{localize('Duration')}</Text>
                                <select
                                    value={`${trading_interface.duration}s`}
                                    onChange={(e) => {
                                        const option = DURATION_OPTIONS.find(d => d.value === e.target.value);
                                        if (option) {
                                            setTradingInterface(prev => ({
                                                ...prev,
                                                duration: option.seconds,
                                                duration_unit: 's'
                                            }));
                                        }
                                    }}
                                >
                                    {DURATION_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
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
                                className="execute-btn manual"
                                onClick={executeManualTrade}
                                disabled={!is_authorized || contractInProgressRef.current || !selectedRecommendation}
                            >
                                {localize('Execute Manual Trade')}
                            </button>
                        </div>
                    </div>

                    {/* Selected Recommendation Details */}
                    {selectedRecommendation && (
                        <div className="selected-recommendation">
                            <Text size="sm" weight="bold">{localize('Selected Opportunity')}</Text>
                            <div className="rec-details">
                                <div className="detail-row">
                                    <span>{localize('Symbol')}:</span>
                                    <span>{selectedRecommendation.displayName}</span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('Action')}:</span>
                                    <span className={`action-text ${selectedRecommendation.action.toLowerCase()}`}>
                                        {selectedRecommendation.action}
                                    </span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('Confidence')}:</span>
                                    <span>{selectedRecommendation.confidence.toFixed(1)}%</span>
                                </div>
                                {/* Display ROC values */}
                                <div className="detail-row">
                                    <span>{localize('5-Min ROC')}:</span>
                                    <span>{selectedRecommendation.roc_5min.toFixed(4)}%</span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('3-Min ROC')}:</span>
                                    <span>{selectedRecommendation.roc_3min.toFixed(4)}%</span>
                                </div>
                                <div className="detail-row">
                                    <span>{localize('1-Min ROC')}:</span>
                                    <span>{selectedRecommendation.roc_1min.toFixed(4)}%</span>
                                </div>
                                {/* ML Prediction might need to be adapted or removed if not relevant to ROC */}
                                {/* {selectedRecommendation && (() => {
                                    try {
                                        const mlPrediction = mlTickAnalyzer.predict(selectedRecommendation.symbol);
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
                                })()} */}
                            </div>
                        </div>
                    )}
                </div>

                {/* Symbol Analysis (Advanced View) - Now showing ROC Data */}
                {show_advanced_view && (
                    <div className="symbol-analysis">
                        <div className="panel-header">
                            <Text size="md" weight="bold">{localize('Symbol Analysis (ROC)')}</Text>
                        </div>

                        <div className="volatility-grid"> {/* Renamed from volatility-grid to reflect ROC */}
                            {DERIV_VOLATILITY_SYMBOLS.map(symbolInfo => {
                                const roc = rocData[symbolInfo.symbol];
                                const analysis = rocAnalyzer.analyze(symbolInfo.symbol); // Get analysis for alignment check
                                if (!roc) return null;

                                return (
                                    <div key={symbolInfo.symbol} className="volatility-card">
                                        <div className="symbol-name">{symbolInfo.display_name}</div>
                                        <div className="roc-indicators">
                                            <div className={`roc-badge ${roc.roc5 > 0 ? 'bullish' : 'bearish'}`}>
                                                5M: {roc.roc5.toFixed(3)}%
                                            </div>
                                            <div className={`roc-badge ${roc.roc3 > 0 ? 'bullish' : 'bearish'}`}>
                                                3M: {roc.roc3.toFixed(3)}%
                                            </div>
                                            <div className={`roc-badge ${roc.roc1 > 0 ? 'bullish' : 'bearish'}`}>
                                                1M: {roc.roc1.toFixed(3)}%
                                            </div>
                                        </div>
                                        {analysis?.alignment && ( // Check if alignment exists from rocAnalyzer
                                            <div className="alignment-badge">
                                                ✓ ALIGNED
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
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