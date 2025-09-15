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

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [current_price, setCurrentPrice] = useState<number | null>(null);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [trade_mode, setTradeMode] = useState<'rise_fall' | 'higher_lower'>('rise_fall');
    const [contract_type, setContractType] = useState<string>('CALL');
    const [duration, setDuration] = useState<number>(5);
    const [duration_unit, setDurationUnit] = useState<'t' | 's' | 'm'>('t');
    const [stake, setStake] = useState<number>(1.0);
    const [barrier_offset, setBarrierOffset] = useState<number>(0.001);

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

            // Mark as complete after a reasonable time for initial data collection
            setTimeout(() => {
                setInitialScanComplete(true);
                setStatus('Market analysis ready');
            }, 10000); // 10 seconds to allow for data collection

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

        ENHANCED_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const trend = marketScanner.getTrendAnalysis(symbolInfo.symbol);
            if (trend) {
                trendsMap.set(symbolInfo.symbol, trend);
                hasData = true;
            }
        });

        if (hasData) {
            setMarketTrends(trendsMap);
            setVolatilityTrends(trendsMap);
            
            // Mark initial scan as complete when we have trends for at least 3 symbols
            if (trendsMap.size >= 3 && !initial_scan_complete) {
                setInitialScanComplete(true);
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

    // Apply a trading recommendation
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

        // Update trade mode based on recommendation
        if (recommendation.direction === 'CALL' || recommendation.direction === 'PUT') {
            setTradeMode('rise_fall');
        }

        setCurrentPrice(recommendation.currentPrice);
        setStatus(`Applied recommendation: ${recommendation.reason}`);
    }, [is_running]);

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

        if (!current_price && trade_mode === 'higher_lower') {
            throw new Error('Current price not available');
        }

        const trade_option: any = {
            amount: Number(stake),
            basis: 'stake',
            currency: account_currency,
            duration: Number(duration),
            duration_unit,
            symbol,
        };

        // Add barrier for Higher/Lower trades
        if (trade_mode === 'higher_lower' && current_price) {
            const barrier_value = contract_type === 'CALL' 
                ? current_price + barrier_offset 
                : current_price - barrier_offset;
            trade_option.barrier = barrier_value.toFixed(5);
        }

        const buy_req = tradeOptionToBuy(contract_type, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;

        contractInProgressRef.current = true;
        return buy;
    };

    const onStart = async () => {
        if (!selected_recommendation) {
            setStatus('Please select a recommendation first');
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
            const symbol_display = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === symbol)?.display_name || symbol;
            transactions.onBotContractEvent({
                contract_id: buy?.contract_id,
                transaction_ids: { buy: buy?.transaction_id },
                buy_price: buy?.buy_price,
                currency: account_currency,
                contract_type: contract_type as any,
                underlying: symbol,
                display_name: symbol_display,
                date_start: Math.floor(Date.now() / 1000),
                status: 'open',
            } as any);

            run_panel.setHasOpenContract(true);
            run_panel.setContractStage(contract_stages.PURCHASE_SENT);

            setStatus(`Contract purchased: ${buy?.longcode}`);

        } catch (error: any) {
            console.error('Purchase error:', error);
            setStatus(`Purchase failed: ${error.message}`);
            setIsRunning(false);
            run_panel.setIsRunning(false);
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
                                <Text size="xs" color="general">Analyzing market data...</Text>
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
                                                        'Collecting market data...' : 
                                                        'Connecting to market feeds...'
                                                    }
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
                                            onClick={() => applyRecommendation(rec)}
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

                    {/* Trading Interface */}
                    {selected_recommendation && (
                        <div className="ml-trader__trading-interface">
                            <Text as="h3">Trading Interface</Text>

                            <div className="trading-form">
                                <div className="form-row">
                                    <div className="form-field">
                                        <Text as="label">Asset</Text>
                                        <select 
                                            value={symbol} 
                                            onChange={(e) => setSymbol(e.target.value)}
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
                                            value={trade_mode} 
                                            onChange={(e) => setTradeMode(e.target.value as any)}
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
                                            value={contract_type} 
                                            onChange={(e) => setContractType(e.target.value)}
                                            disabled={is_running}
                                        >
                                            {(trade_mode === 'rise_fall' ? TRADE_TYPES : HIGHER_LOWER_TYPES).map(type => (
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
                                            value={stake} 
                                            onChange={(e) => setStake(Number(e.target.value))}
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
                                            value={duration} 
                                            onChange={(e) => setDuration(Number(e.target.value))}
                                            min="1"
                                            disabled={is_running}
                                        />
                                    </div>

                                    <div className="form-field">
                                        <Text as="label">Duration Unit</Text>
                                        <select 
                                            value={duration_unit} 
                                            onChange={(e) => setDurationUnit(e.target.value as any)}
                                            disabled={is_running}
                                        >
                                            <option value="t">Ticks</option>
                                            <option value="s">Seconds</option>
                                            <option value="m">Minutes</option>
                                        </select>
                                    </div>
                                </div>

                                {trade_mode === 'higher_lower' && (
                                    <div className="form-row">
                                        <div className="form-field">
                                            <Text as="label">Barrier Offset</Text>
                                            <input 
                                                type="number" 
                                                value={barrier_offset} 
                                                onChange={(e) => setBarrierOffset(Number(e.target.value))}
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
                                    disabled={!selected_recommendation && !is_running}
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
    );
});

export default MLTrader;