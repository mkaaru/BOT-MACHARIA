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
import './ml-trader.scss';


// Enhanced volatility symbols with 1-second indices
const DERIV_VOLATILITY_SYMBOLS = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s: false, base_volatility: 10 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s: false, base_volatility: 25 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s: false, base_volatility: 50 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s: false, base_volatility: 75 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s: false, base_volatility: 100 },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', is_1s: true, base_volatility: 10 },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', is_1s: true, base_volatility: 25 },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', is_1s: true, base_volatility: 50 },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', is_1s: true, base_volatility: 75 },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', is_1s: true, base_volatility: 100 },
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

    useEffect(() => {
        initializeMLTrader();
        return () => cleanup();
    }, []);

    /**
     * Initialize ML Trader with Deriv volatility scanner
     */
    const initializeMLTrader = useCallback(async () => {
        try {
            setStatus('Initializing Advanced ML Trader...');

            // Initialize API connection
            const api = generateDerivApiInstance();
            apiRef.current = api;

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

            // Add tick callbacks to feed the scanner and ML analyzer
            DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
                tickStreamManager.addTickCallback(symbolInfo.symbol, (tick) => {
                    // Feed tick to volatility scanner
                    derivVolatilityScanner.processTick({
                        symbol: tick.symbol,
                        quote: tick.quote,
                        epoch: tick.epoch
                    });

                    // Feed tick to ML analyzer (for real-time prediction if implemented)
                    // For now, ML model is trained on historical data in bulk.
                    // mlTickAnalyzer.processTick(tick.symbol, tick); // Example if real-time prediction is added
                });
            });

            console.log('✅ Tick streams initialized for all volatility indices');

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
            console.log('🔄 Initializing volatility scanner and ML analyzer...');

            // Subscribe to scanner status updates
            const statusUnsubscribe = derivVolatilityScanner.onStatusChange((status) => {
                console.log('📊 Scanner status update:', status);
                setScannerStatus(status);
                // Calculate progress based on symbols that have loaded historical data
                const analyzedSymbols = status.symbolsTracked;
                const progress = analyzedSymbols > 0 ? (analyzedSymbols / DERIV_VOLATILITY_SYMBOLS.length) * 100 : 0;
                setScanProgress(progress);
            });

            // Subscribe to recommendation updates
            const recommendationsUnsubscribe = derivVolatilityScanner.onRecommendationChange((recs) => {
                console.log(`🎯 New recommendations: ${recs.length} opportunities found`);
                setRecommendations(recs);
                updateSymbolAnalyses();

                // Auto-trade if enabled and we have high-confidence signals
                if (autoTradingRef.current && recs.length > 0) {
                    handleAutoTrading(recs);
                }
            });

            // Fetch and process historical data for ML model training
            const historicalDataPromises = DERIV_VOLATILITY_SYMBOLS.map(async (symbolInfo) => {
                const symbol = symbolInfo.symbol;
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

                            console.log(`🧠 ML Model trained on ${historicalData.length} ticks for ${symbol}`);
                        } catch (error) {
                            console.error(`Error processing bulk historical data for ${symbol}:`, error);
                        }
                    } else {
                        console.warn(`No historical data found for ${symbol} to train ML model.`);
                    }
                } catch (error) {
                    console.error(`Error fetching historical data for ${symbol}:`, error);
                }
            });

            await Promise.all(historicalDataPromises);
            console.log('✅ Historical data processed for ML model training.');

            // Perform immediate initial scan now that historical data is loaded
            console.log('🚀 Performing initial scanner scan with historical data...');
            await derivVolatilityScanner.performFullScan();
            console.log('✅ Initial scan completed');

            // Start periodic scanning for ongoing updates (backup to candle-based updates)
            const scanInterval = setInterval(() => {
                if (is_scanner_active) {
                    console.log('🔍 Performing periodic scan (backup)...');
                    derivVolatilityScanner.performFullScan();
                }
            }, 60000); // Scan every 60 seconds as backup

            console.log('✅ Volatility scanner initialized');
            console.log('🕐 Recommendations will update automatically on new 1-minute candles');

            // Return cleanup function
            return () => {
                clearInterval(scanInterval);
                statusUnsubscribe();
                recommendationsUnsubscribe();
            };

        } catch (error) {
            console.error('Failed to initialize volatility scanner:', error);
            throw error;
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
     * Handle auto trading - called when new recommendations arrive
     */
    const handleAutoTrading = useCallback(async (recs: ScannerRecommendation[]) => {
        // Filter recommendations based on user settings
        const filteredRecs = recs.filter(rec =>
            rec.confidence >= filter_settings.min_confidence &&
            rec.momentumScore >= filter_settings.min_momentum &&
            filter_settings.preferred_durations.includes(rec.duration) &&
            (filter_settings.max_risk === 'HIGH' ||
             (filter_settings.max_risk === 'MEDIUM' && rec.urgency !== 'CRITICAL') ||
             (filter_settings.max_risk === 'LOW' && rec.urgency === 'LOW'))
        );

        if (filteredRecs.length === 0) {
            console.log('No recommendations match filter criteria');
            return;
        }

        // Take the highest confidence recommendation
        const topRec = filteredRecs[0];
        
        // Update current recommendation for auto-trading
        currentRecommendationRef.current = topRec;
        setSelectedRecommendation(topRec);
        
        // Apply recommendation to trading interface
        applyRecommendation(topRec);
        
        console.log(`🎯 Auto-trade switched to: ${topRec.displayName} - ${topRec.action} (${topRec.confidence.toFixed(1)}% confidence)`);
    }, [filter_settings]);

    /**
     * Execute a trade based on recommendation
     */
    const executeTrade = useCallback(async (recommendation: ScannerRecommendation) => {
        if (!apiRef.current || contractInProgressRef.current) return;

        contractInProgressRef.current = true;
        setStatus(`Executing ${recommendation.action} trade on ${recommendation.displayName}...`);

        try {
            // Convert duration to appropriate format
            const durationSeconds = DURATION_OPTIONS.find(d => d.value === recommendation.duration)?.seconds || 180;

            // Prepare trade parameters
            const tradeParams = {
                proposal: 1,
                amount: trading_interface.stake,
                basis: 'stake',
                contract_type: recommendation.action === 'RISE' ? 'CALL' : 'PUT',
                currency: account_currency,
                duration: durationSeconds,
                duration_unit: 's',
                symbol: recommendation.symbol
            };

            // Get proposal
            const proposal_response = await apiRef.current.send(tradeParams);

            if (proposal_response.error) {
                throw new Error(proposal_response.error.message);
            }

            if (proposal_response.proposal) {
                // Buy the contract
                const buy_response = await apiRef.current.send({
                    buy: proposal_response.proposal.id,
                    price: trading_interface.stake
                });

                if (buy_response.error) {
                    throw new Error(buy_response.error.message);
                }

                if (buy_response.buy) {
                    const isAutoTrade = autoTradingRef.current;
                    setStatus(`${isAutoTrade ? 'AUTO' : 'MANUAL'} Trade executed: ${recommendation.action} on ${recommendation.displayName} (Contract ID: ${buy_response.buy.contract_id})`);

                    // Emit trade run to statistics
                    statisticsEmitter.emitTradeRun();

                    // Update trading stats
                    setTradingStats(prev => ({
                        ...prev,
                        total_trades: prev.total_trades + 1,
                        auto_trade_count: isAutoTrade ? prev.auto_trade_count + 1 : prev.auto_trade_count
                    }));

                    // Monitor contract outcome
                    monitorContract(buy_response.buy.contract_id);
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
    const monitorContract = useCallback(async (contract_id: string) => {
        if (!apiRef.current) return;

        try {
            // Subscribe to contract updates
            const contract_response = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id,
                subscribe: 1
            });

            if (contract_response.proposal_open_contract) {
                const contract = contract_response.proposal_open_contract;

                if (contract.is_sold) {
                    handleContractResult(contract);
                }
            }

        } catch (error) {
            console.error('Contract monitoring error:', error);
        }
    }, []);

    /**
     * Handle contract result
     */
    const handleContractResult = useCallback((contract: any) => {
        const profit = parseFloat(contract.profit || 0);
        const is_win = profit > 0;

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

        console.log(`🎯 Contract completed:`, contract);
        console.log(`💰 Profit/Loss: ${profit.toFixed(2)} ${account_currency}`);

        contractInProgressRef.current = false;
    }, [account_currency]);

    /**
     * Apply recommendation to trading interface
     */
    const applyRecommendation = useCallback((recommendation: ScannerRecommendation) => {
        setTradingInterface(prev => ({
            ...prev,
            symbol: recommendation.symbol,
            contract_type: recommendation.action === 'RISE' ? 'CALL' : 'PUT',
            duration: DURATION_OPTIONS.find(d => d.value === recommendation.duration)?.seconds || 180,
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

        if (newState) {
            // Start auto-trading
            setStatus('🤖 Auto-trading enabled - Waiting for recommendations...');
            
            // Start continuous trading interval (every 35 seconds to avoid rate limits)
            autoTradeIntervalRef.current = setInterval(async () => {
                const currentRec = currentRecommendationRef.current;
                
                if (autoTradingRef.current && currentRec && !contractInProgressRef.current) {
                    console.log(`🤖 Auto-trading: Executing ${currentRec.action} on ${currentRec.displayName}`);
                    try {
                        await executeTrade(currentRec);
                    } catch (error) {
                        console.error('Auto-trade execution error:', error);
                    }
                }
            }, 35000); // Trade every 35 seconds
            
            console.log('✅ Auto-trading started - Will execute trades every 35 seconds');
        } else {
            // Stop auto-trading
            if (autoTradeIntervalRef.current) {
                clearInterval(autoTradeIntervalRef.current);
                autoTradeIntervalRef.current = null;
            }
            setStatus('Auto-trading disabled');
            console.log('⏹️ Auto-trading stopped');
        }
    }, [trading_interface.is_auto_trading, executeTrade]);

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
     * Load recommendation to Bot Builder using Trading Hub loading logic
     */
    const loadToBotBuilder = useCallback(async (recommendation: ScannerRecommendation) => {
        try {
            console.log('🚀 Loading recommendation to Bot Builder:', recommendation);

            // Get symbol display name
            const displayName = recommendation.displayName || recommendation.symbol;

            // Determine contract type based on strategy (map ML Trader actions to contract types)
            let contractType = 'DIGITOVER';
            if (recommendation.action === 'RISE') contractType = 'CALL';
            else if (recommendation.action === 'FALL') contractType = 'PUT';

            // Default settings
            const defaultStake = 1.0;
            const defaultDuration = 1; // 1 tick
            const defaultDurationUnit = 't'; // ticks
            const martingaleMultiplier = 1.0; // Default martingale multiplier

            // Map ML Trader recommendation to Trading Hub style trade type categories
            const getTradeTypeMapping = (action: string) => {
                switch (action) {
                    case 'RISE':
                    case 'FALL':
                        return {
                            tradeTypeCategory: 'callput',
                            tradeTypeList: 'callput',
                            contractType: action === 'RISE' ? 'CALL' : 'PUT'
                        };
                    default:
                        return {
                            tradeTypeCategory: 'callput',
                            tradeTypeList: 'callput',
                            contractType: 'CALL'
                        };
                }
            };

            const tradeMapping = getTradeTypeMapping(recommendation.action);

            // Generate Bot Builder XML using Trading Hub structure
            const botSkeletonXML = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="Stake">Stake</variable>
    <variable id="Initial_Stake">Initial_Stake</variable>
    <variable id="Result_is">Result_is</variable>
    <variable id="Martingale_Multiplier">Martingale_Multiplier</variable>
  </variables>

  <!-- Trade Definition Block -->
  <block type="trade_definition" id="trade_definition_main" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="market_block" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">continuous_indices</field>
        <field name="SYMBOL_LIST">${recommendation.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="tradetype_block" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${tradeMapping.tradeTypeCategory}</field>
            <field name="TRADETYPE_LIST">${tradeMapping.tradeTypeList}</field>
            <next>
              <block type="trade_definition_contracttype" id="contracttype_block" deletable="false" movable="false">
                <field name="TYPE_LIST">${tradeMapping.contractType}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="candleinterval_block" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="restart_block" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="restartonerror_block" deletable="false" movable="false">
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

    <!-- Initialization -->
    <statement name="INITIALIZATION">
      <block type="text_print" id="init_print">
        <value name="TEXT">
          <shadow type="text" id="init_text">
            <field name="TEXT">ML Trader Strategy Loading...</field>
          </shadow>
        </value>
        <next>
          <block type="text_print" id="strategy_print">
            <value name="TEXT">
              <shadow type="text" id="strategy_text">
                <field name="TEXT">${displayName} - ${recommendation.action} (${recommendation.confidence.toFixed(1)}% confidence)</field>
              </shadow>
            </value>
            <next>
              <block type="variables_set" id="set_initial_stake">
                <field name="VAR" id="Initial_Stake">Initial_Stake</field>
                <value name="VALUE">
                  <block type="math_number" id="initial_stake_number">
                    <field name="NUM">${defaultStake}</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="set_stake">
                    <field name="VAR" id="Stake">Stake</field>
                    <value name="VALUE">
                      <block type="variables_get" id="stake_from_initial">
                        <field name="VAR" id="Initial_Stake">Initial_Stake</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="set_martingale">
                        <field name="VAR" id="Martingale_Multiplier">Martingale_Multiplier</field>
                        <value name="VALUE">
                          <block type="math_number" id="martingale_number">
                            <field name="NUM">${martingaleMultiplier}</field>
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

    <!-- Trade Options -->
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="trade_options_block">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation>
        <field name="DURATIONTYPE_LIST">${defaultDurationUnit}</field>
        <value name="DURATION">
          <shadow type="math_number" id="duration_number">
            <field name="NUM">${defaultDuration}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="amount_shadow">
            <field name="NUM">${defaultStake}</field>
          </shadow>
          <block type="variables_get" id="amount_var">
            <field name="VAR" id="Stake">Stake</field>
          </block>
        </value>
      </block>
    </statement>
  </block>

  <!-- Purchase Block -->
  <block type="before_purchase" id="before_purchase_block" deletable="false" x="267" y="544">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="notify" id="notify_block">
        <field name="NOTIFICATION_TYPE">success</field>
        <field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <shadow type="text" id="notify_text">
            <field name="TEXT">ML Trader Strategy Executing...</field>
          </shadow>
        </value>
        <next>
          <block type="purchase" id="purchase_block">
            <field name="PURCHASE_LIST">${tradeMapping.contractType}</field>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- After Purchase Block -->
  <block type="after_purchase" id="after_purchase_block" x="679" y="293">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="result_check">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="check_win">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="reset_stake_win">
            <field name="VAR" id="Stake">Stake</field>
            <value name="VALUE">
              <block type="variables_get" id="win_stake">
                <field name="VAR" id="Initial_Stake">Initial_Stake</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="set_result_win">
                <field name="VAR" id="Result_is">Result_is</field>
                <value name="VALUE">
                  <block type="text" id="result_win_text">
                    <field name="TEXT">Win</field>
                  </block>
                </value>
                <next>
                  <block type="trade_again" id="trade_again_win"></block>
                </next>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="loss_check">
            <value name="IF0">
              <block type="contract_check_result" id="check_loss">
                <field name="CHECK_RESULT">loss</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="increase_stake">
                <field name="VAR" id="Stake">Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="martingale_calc">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="current_stake_shadow">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="current_stake">
                        <field name="VAR" id="Stake">Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="multiplier_shadow">
                        <field name="NUM">${martingaleMultiplier}</field>
                      </shadow>
                      <block type="variables_get" id="multiplier_var">
                        <field name="VAR" id="Martingale_Multiplier">Martingale_Multiplier</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="set_result_loss">
                    <field name="VAR" id="Result_is">Result_is</field>
                    <value name="VALUE">
                      <block type="text" id="result_loss_text">
                        <field name="TEXT">Loss</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="trade_again" id="trade_again_loss"></block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>`;

            console.log('📄 Loading ML Trader strategy to Bot Builder...');

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
                        console.log('📦 Loading ML Trader strategy to workspace...');

                        await load({
                            block_string: botSkeletonXML,
                            file_name: `MLTrader_${displayName}_${recommendation.action}_${Date.now()}`,
                            workspace: window.Blockly.derivWorkspace,
                            from: save_types.UNSAVED,
                            drop_event: null,
                            strategy_id: null,
                            showIncompatibleStrategyDialog: null,
                        });

                        // Center workspace
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ ML Trader strategy loaded to workspace');

                        setStatus(`✅ Loaded ${recommendation.action} strategy for ${displayName} to Bot Builder`);

                    } else {
                        console.warn('⚠️ Blockly workspace not ready, using fallback method');

                        // Fallback method
                        setTimeout(() => {
                            if (window.Blockly?.derivWorkspace) {
                                window.Blockly.derivWorkspace.clear();
                                const xmlDoc = window.Blockly.utils.xml.textToDom(botSkeletonXML);
                                window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                                window.Blockly.derivWorkspace.scrollCenter();
                                console.log('✅ ML Trader strategy loaded using fallback method');
                                setStatus(`✅ Loaded ${recommendation.action} strategy using fallback method`);
                            }
                        }, 500);
                    }
                } catch (loadError) {
                    console.error('❌ Error loading ML Trader strategy:', loadError);

                    // Final fallback
                    if (window.Blockly?.derivWorkspace) {
                        window.Blockly.derivWorkspace.clear();
                        const xmlDoc = window.Blockly.utils.xml.textToDom(botSkeletonXML);
                        window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ ML Trader strategy loaded using final fallback');
                        setStatus(`✅ Loaded ${recommendation.action} strategy using final fallback`);
                    }
                }
            }, 300);

            console.log(`✅ Loaded ${displayName} - ${recommendation.action} strategy to Bot Builder`);

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
            <div className="ml-trader__header">
                <div className="header-title">
                    <Text size="lg" weight="bold" color="prominent">
                        {localize('Advanced ML Trader')}
                    </Text>
                    <Text size="xs" color="general">
                        {localize('Momentum-Weighted Multi-Timeframe Analysis')}
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
                                className={`filter-btn ${show_advanced_view ? 'active' : ''}`}
                                onClick={() => setShowAdvancedView(!show_advanced_view)}
                            >
                                {localize('Advanced View')}
                            </button>
                        </div>
                    </div>

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
                        <div className="auto-trading-toggle">
                            <button
                                className={`toggle-btn ${trading_interface.is_auto_trading ? 'active' : ''}`}
                                onClick={toggleAutoTrading}
                                disabled={!is_authorized}
                            >
                                {trading_interface.is_auto_trading ? localize('Auto Trading ON') : localize('Auto Trading OFF')}
                            </button>
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
                                disabled={!is_authorized || contractInProgressRef.current || !selected_recommendation}
                            >
                                {localize('Execute Manual Trade')}
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