import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { derivVolatilityScanner, ScannerRecommendation, ScannerStatus, VolatilityAnalysis } from '@/services/deriv-volatility-scanner';
import { tickStreamManager } from '@/services/tick-stream-manager';
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
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const contractInProgressRef = useRef(false);
    const autoTradingRef = useRef(false);

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
    const [filter_settings, setFilterSettings] = useState({
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
        win_rate: 0
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

            // Add tick callbacks to feed the scanner
            DERIV_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
                tickStreamManager.addTickCallback(symbolInfo.symbol, (tick) => {
                    console.log(`📊 ML Trader received tick: ${tick.symbol} = ${tick.quote.toFixed(5)}`);
                    
                    // Feed tick to volatility scanner
                    derivVolatilityScanner.processTick({
                        symbol: tick.symbol,
                        quote: tick.quote,
                        epoch: tick.epoch
                    });
                });
            });

            console.log('✅ Tick streams initialized for all volatility indices');

        } catch (error) {
            console.error('Failed to initialize tick streams:', error);
            throw error;
        }
    }, []);

    /**
     * Initialize volatility scanner
     */
    const initializeVolatilityScanner = useCallback(async () => {
        try {
            console.log('🔄 Initializing volatility scanner...');
            
            // Subscribe to scanner status updates
            const statusUnsubscribe = derivVolatilityScanner.onStatusChange((status) => {
                console.log('📊 Scanner status update:', status);
                setScannerStatus(status);
                setScanProgress((status.recommendationsCount / DERIV_VOLATILITY_SYMBOLS.length) * 100);
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

            // Start periodic scanning after a delay to allow data to accumulate
            setTimeout(() => {
                const scanInterval = setInterval(() => {
                    if (is_scanner_active) {
                        console.log('🔍 Performing periodic scan...');
                        derivVolatilityScanner.performFullScan();
                    }
                }, 30000); // Scan every 30 seconds

                // Store interval for cleanup
                return () => clearInterval(scanInterval);
            }, 60000); // Wait 1 minute before starting periodic scans

            // Initial scan after 2 minutes to allow sufficient data
            setTimeout(async () => {
                console.log('🚀 Performing initial scanner scan...');
                await derivVolatilityScanner.performFullScan();
            }, 120000);

            console.log('✅ Volatility scanner initialized');

            return () => {
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
     * Handle auto trading
     */
    const handleAutoTrading = useCallback(async (recs: ScannerRecommendation[]) => {
        if (contractInProgressRef.current) return;

        // Filter recommendations based on user settings
        const filteredRecs = recs.filter(rec => 
            rec.confidence >= filter_settings.min_confidence &&
            rec.momentumScore >= filter_settings.min_momentum &&
            filter_settings.preferred_durations.includes(rec.duration) &&
            (filter_settings.max_risk === 'HIGH' || 
             (filter_settings.max_risk === 'MEDIUM' && rec.urgency !== 'CRITICAL') ||
             (filter_settings.max_risk === 'LOW' && rec.urgency === 'LOW'))
        );

        if (filteredRecs.length === 0) return;

        // Take the highest confidence recommendation
        const topRec = filteredRecs[0];

        try {
            await executeTrade(topRec);
        } catch (error) {
            console.error('Auto-trading error:', error);
            setStatus(`Auto-trading error: ${error}`);
        }
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
                    setStatus(`Trade executed: ${recommendation.action} on ${recommendation.displayName} (Contract ID: ${buy_response.buy.contract_id})`);

                    // Update trading stats
                    setTradingStats(prev => ({
                        ...prev,
                        total_trades: prev.total_trades + 1
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

        console.log(`Trade result: ${result_text} ${profit.toFixed(2)} ${account_currency}`);
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

        setStatus(newState ? 'Auto-trading enabled' : 'Auto-trading disabled');
    }, [trading_interface.is_auto_trading]);

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

    return (
        <div className="ml-trader">
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
                        <div className="account-info">
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
                <div className="status-indicator">
                    <div className={`status-dot ${is_scanner_active ? 'active' : 'inactive'}`} />
                    <Text size="sm">{status}</Text>
                </div>

                {scanner_status && (
                    <div className="scanner-stats">
                        <Text size="xs">
                            {localize('Scanning {{symbols}} symbols | {{recs}} opportunities | Avg confidence: {{conf}}%', {
                                symbols: scanner_status.symbolsTracked,
                                recs: scanner_status.recommendationsCount,
                                conf: scanner_status.avgConfidence.toFixed(1)
                            })}
                        </Text>
                    </div>
                )}
            </div>

            <div className="ml-trader__content">
                {/* Recommendations Panel */}
                <div className="recommendations-panel">
                    <div className="panel-header">
                        <Text size="md" weight="bold">{localize('Live Recommendations')}</Text>
                        <div className="filter-controls">
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
                            recommendations.slice(0, 5).map((rec, index) => (
                                <div 
                                    key={rec.symbol}
                                    className={`recommendation-card ${selected_recommendation?.symbol === rec.symbol ? 'selected' : ''}`}
                                    onClick={() => applyRecommendation(rec)}
                                >
                                    <div className="rec-header">
                                        <div className="symbol-info">
                                            <Text size="sm" weight="bold">{rec.displayName}</Text>
                                            <Text size="xs" color="general">#{rec.rank}</Text>
                                        </div>
                                        <div className={`action-badge ${rec.action.toLowerCase()}`}>
                                            {rec.action}
                                        </div>
                                    </div>

                                    <div className="rec-metrics">
                                        <div className="metric">
                                            <Text size="xs" color="general">{localize('Confidence')}</Text>
                                            <Text size="sm" weight="bold">
                                                {formatConfidence(rec.confidence)}
                                            </Text>
                                        </div>
                                        <div className="metric">
                                            <Text size="xs" color="general">{localize('Duration')}</Text>
                                            <Text size="sm">{rec.duration}</Text>
                                        </div>
                                        <div className="metric">
                                            <Text size="xs" color="general">{localize('Momentum')}</Text>
                                            <Text size="sm">{rec.momentumScore.toFixed(0)}%</Text>
                                        </div>
                                    </div>

                                    {show_advanced_view && (
                                        <div className="rec-advanced">
                                            <Text size="xs" color="general">{rec.reason}</Text>
                                            <div className="advanced-metrics">
                                                <span>Risk: {rec.urgency}</span>
                                                <span>R/R: {rec.riskReward.toFixed(2)}</span>
                                                <span>Payout: {(rec.expectedPayout * 100).toFixed(0)}%</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Trading Interface */}
                <div className="trading-interface">
                    <div className="panel-header">
                        <Text size="md" weight="bold">{localize('Trading Interface')}</Text>
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