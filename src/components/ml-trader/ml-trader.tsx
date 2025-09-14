import { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { marketScanner, TradingRecommendation, ScannerStatus } from '@/services/market-scanner';
import { VOLATILITY_SYMBOLS } from '@/services/tick-stream-manager';
import { TrendAnalysis } from '@/services/trend-analysis-engine';
import './ml-trader.scss';

// Correct trade types for Deriv API
const TRADE_TYPES = [
    { value: 'CALL', label: 'Rise', description: 'Win if exit spot is higher than entry spot' },
    { value: 'PUT', label: 'Fall', description: 'Win if exit spot is lower than entry spot' },
    { value: 'CALLE', label: 'Rise (Allow Equals)', description: 'Win if exit spot is higher than or equal to entry spot' },
    { value: 'PUTE', label: 'Fall (Allow Equals)', description: 'Win if exit spot is lower than or equal to entry spot' },
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
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const contractInProgressRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);
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

    // Enhanced states for trend analysis
    const [scanner_status, setScannerStatus] = useState<ScannerStatus | null>(null);
    const [recommendations, setRecommendations] = useState<TradingRecommendation[]>([]);
    const [current_trend, setCurrentTrend] = useState<TrendAnalysis | null>(null);
    const [is_scanner_initialized, setIsScannerInitialized] = useState(false);
    const [auto_mode, setAutoMode] = useState(false);
    const [show_trend_analysis, setShowTrendAnalysis] = useState(true);

    useEffect(() => {
        // Initialize API connection and fetch active symbols
        const api = generateDerivApiInstance();
        apiRef.current = api;
        let scannerCleanup: (() => void) | null = null;

        const init = async () => {
            try {
                // Fetch active symbols (volatility indices)
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;

                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));

                setSymbols(syn);
                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    // Remove direct tick subscription - MarketScanner handles this now
                }

                // Initialize scanner and capture cleanup function
                scannerCleanup = await initializeMarketScanner();
            } catch (e: any) {
                console.error('MLTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
            }
        };

        init();

        return () => {
            // Clean up scanner subscriptions first
            if (scannerCleanup) {
                scannerCleanup();
                scannerCleanup = null;
            }

            // Clean up streams and socket
            try {
                if (tickStreamIdRef.current) {
                    apiRef.current?.forget({ forget: tickStreamIdRef.current });
                    tickStreamIdRef.current = null;
                }
                if (messageHandlerRef.current) {
                    apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                    messageHandlerRef.current = null;
                }
                api?.disconnect?.();
            } catch { /* noop */ }

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
            });
            
            // Subscribe to recommendation updates
            const recommendationUnsubscribe = marketScanner.onRecommendationChange((recs) => {
                setRecommendations(recs);
                
                // Auto-select best recommendation if auto mode is enabled
                // Check both running state AND contract in progress to prevent race conditions
                if (auto_mode && recs.length > 0 && !is_running && !contractInProgressRef.current) {
                    applyRecommendation(recs[0]);
                }
            });
            
            setIsScannerInitialized(true);
            setStatus('Market scanner initialized successfully');
            
            // Cleanup function stored in ref for unmount
            return () => {
                statusUnsubscribe();
                recommendationUnsubscribe();
            };
            
        } catch (error) {
            console.error('Failed to initialize market scanner:', error);
            setStatus(`Scanner initialization failed: ${error}`);
        }
    }, [is_scanner_initialized, auto_mode, is_running]);

    // Get current price from shared services instead of direct subscription
    const getCurrentPriceFromServices = useCallback((sym: string): number | null => {
        try {
            // Get current price from trend analysis or HMA calculator
            const trend = marketScanner.getTrendAnalysis(sym);
            return trend?.currentPrice || null;
        } catch (error) {
            console.warn(`Failed to get current price for ${sym} from services:`, error);
            return null;
        }
    }, []);

    // Integration verification function to check system health
    const verifyIntegration = useCallback(() => {
        const verificationResults = {
            timestamp: new Date().toISOString(),
            scannerInitialized: is_scanner_initialized,
            recommendations: recommendations.length,
            errors: [],
            warnings: [],
            hmaVerification: {
                hma5: null as number | null,
                hma40: null as number | null,
                crossoverDetected: false,
            },
            subscriptionHealth: {
                activeSymbols: 0,
                duplicateSubscriptions: false,
            }
        };

        try {
            // Verify HMA calculations are working
            if (symbol && is_scanner_initialized) {
                const trend = marketScanner.getTrendAnalysis(symbol);
                if (trend) {
                    verificationResults.hmaVerification.hma5 = trend.hma5?.value || null;
                    verificationResults.hmaVerification.hma40 = trend.hma40?.value || null;
                    verificationResults.hmaVerification.crossoverDetected = 
                        trend.signal === 'BUY' || trend.signal === 'SELL';
                } else {
                    verificationResults.warnings.push(`No trend analysis available for ${symbol}`);
                }
            }

            // Verify subscription health
            const scannerStatus = marketScanner.getStatus();
            verificationResults.subscriptionHealth.activeSymbols = scannerStatus.connectedSymbols;

            // Check for common issues
            if (scannerStatus.errors.length > 0) {
                verificationResults.errors.push(...scannerStatus.errors);
            }

            if (verificationResults.recommendations === 0 && is_scanner_initialized) {
                verificationResults.warnings.push('No trading recommendations available');
            }

            // Integration health summary
            const isHealthy = 
                verificationResults.scannerInitialized &&
                verificationResults.errors.length === 0 &&
                verificationResults.subscriptionHealth.activeSymbols > 0;

            console.log('🔍 ML Trader Integration Verification:', {
                ...verificationResults,
                isHealthy,
                summary: isHealthy ? 'HEALTHY' : 'NEEDS ATTENTION'
            });

            return { ...verificationResults, isHealthy };

        } catch (error) {
            console.error('Integration verification failed:', error);
            verificationResults.errors.push(`Verification failed: ${error}`);
            return { ...verificationResults, isHealthy: false };
        }
    }, [symbol, is_scanner_initialized, recommendations]);

    // Apply a trading recommendation with race condition protection
    const applyRecommendation = useCallback((recommendation: TradingRecommendation) => {
        // Prevent applying recommendations during active trading
        if (is_running || contractInProgressRef.current) {
            console.warn('Cannot apply recommendation: trading in progress');
            setStatus('Cannot apply recommendation: trading in progress');
            return;
        }
        
        setSymbol(recommendation.symbol);
        setContractType(recommendation.direction);
        setDuration(recommendation.suggestedDuration);
        setDurationUnit(recommendation.suggestedDurationUnit);
        setStake(recommendation.suggestedStake);
        
        // Update trade mode based on recommendation
        if (recommendation.direction === 'CALL' || recommendation.direction === 'PUT') {
            setTradeMode('rise_fall');
        }
        
        // Use current price from recommendation (already available from scanner)
        setCurrentPrice(recommendation.currentPrice);
        
        setStatus(`Applied recommendation: ${recommendation.reason}`);
    }, [is_running]);

    // Update current trend analysis and price when symbol changes
    useEffect(() => {
        if (symbol && is_scanner_initialized) {
            const trend = marketScanner.getTrendAnalysis(symbol);
            setCurrentTrend(trend);
            
            // Update current price from shared services
            const currentPrice = getCurrentPriceFromServices(symbol);
            setCurrentPrice(currentPrice);
        }
    }, [symbol, is_scanner_initialized, getCurrentPriceFromServices]);

    // Run verification automatically when scanner is initialized
    useEffect(() => {
        if (is_scanner_initialized && recommendations.length > 0) {
            // Run verification after a short delay to ensure data is ready
            const timer = setTimeout(() => {
                verifyIntegration();
            }, 3000);
            
            return () => clearTimeout(timer);
        }
    }, [is_scanner_initialized, recommendations.length, verifyIntegration]);

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

    const stopTicks = () => {
        try {
            if (tickStreamIdRef.current) {
                apiRef.current?.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }
            if (messageHandlerRef.current) {
                apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                messageHandlerRef.current = null;
            }
        } catch {}
    };

    const startTicks = async (sym: string) => {
        stopTicks();
        setCurrentPrice(null);

        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            // Listen for streaming ticks on the raw websocket
            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        setCurrentPrice(quote);
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const purchaseContract = async () => {
        // Check for race conditions before purchasing
        if (contractInProgressRef.current) {
            throw new Error('Contract already in progress. Cannot purchase multiple contracts simultaneously.');
        }
        
        await authorizeIfNeeded();

        if (!current_price && trade_mode === 'higher_lower') {
            throw new Error('Current price not available. Please wait for price data.');
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
            trade_option.barrier = Number(barrier_value.toFixed(5));
        }

        const buy_req = tradeOptionToBuy(contract_type, trade_option);
        console.log('📦 Buy request:', buy_req);

        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;

        // Set contract in progress flag immediately after successful purchase
        contractInProgressRef.current = true;
        console.log(`✅ Purchase confirmed: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id})`);

        setStatus(`Contract purchased: ${buy?.longcode || contract_type}`);

        return buy;
    };

    const onRun = async () => {
        // Prevent starting if already running or contract in progress
        if (is_running || contractInProgressRef.current) {
            setStatus('Trading already in progress');
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

        // Register observers for Run Panel stop events
        if (store?.run_panel?.dbot?.observer) {
            store.run_panel.dbot.observer.register('bot.stop', handleRunPanelStop);
            store.run_panel.dbot.observer.register('bot.click_stop', handleRunPanelStop);
        }

        try {
            while (!stopFlagRef.current) {
                const buy = await purchaseContract();

                // Seed transaction row for UI
                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
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
                } catch {}

                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                // Subscribe to contract updates
                try {
                    const res = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: buy?.contract_id,
                        subscribe: 1,
                    });

                    const { error, proposal_open_contract: pocInit, subscription } = res || {};
                    if (error) throw error;

                    let pocSubId: string | null = subscription?.id || null;
                    const targetId = String(buy?.contract_id || '');

                    if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                        transactions.onBotContractEvent(pocInit);
                        run_panel.setHasOpenContract(true);
                    }

                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const data = JSON.parse(evt.data as any);
                            if (data?.msg_type === 'proposal_open_contract') {
                                const poc = data.proposal_open_contract;
                                if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                                if (String(poc?.contract_id || '') === targetId) {
                                    transactions.onBotContractEvent(poc);
                                    run_panel.setHasOpenContract(true);

                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);
                                        contractInProgressRef.current = false;

                                        const profit = Number(poc?.profit || 0);
                                        const result = profit > 0 ? 'WIN' : 'LOSS';
                                        console.log(`${result}: ${profit.toFixed(2)} ${account_currency}`);
                                        
                                        // Update status to reflect contract completion
                                        setStatus(`Contract completed: ${result} ${profit.toFixed(2)} ${account_currency}`);
                                    }
                                }
                            }
                        } catch {}
                    };
                    apiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    console.error('subscribe poc error', subErr);
                }

                // Wait before next trade
                const waitTime = 5000 + Math.random() * 3000; // 5-8 seconds
                await new Promise(res => setTimeout(res, waitTime));
            }
        } catch (e: any) {
            console.error('MLTrader run loop error', e);
            const msg = e?.message || e?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            contractInProgressRef.current = false;
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    const handleRunPanelStop = () => {
        if (is_running) {
            onStop();
        }
    };

    const onStop = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        contractInProgressRef.current = false; // Clear contract flag on manual stop
        stopTicks();
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');

        if (store?.run_panel?.dbot?.observer) {
            store.run_panel.dbot.observer.unregisterAll('bot.stop');
            store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
        }
    };

    // Cleanup scanner on unmount
    useEffect(() => {
        return () => {
            if (is_scanner_initialized) {
                marketScanner.stop();
            }
        };
    }, [is_scanner_initialized]);

    const current_trade_types = trade_mode === 'rise_fall' ? TRADE_TYPES : HIGHER_LOWER_TYPES;

    // Render trend indicator
    const renderTrendIndicator = (trend: TrendAnalysis) => {
        const getColorClass = () => {
            switch (trend.direction) {
                case 'bullish': return 'trend-bullish';
                case 'bearish': return 'trend-bearish';
                default: return 'trend-neutral';
            }
        };
        
        const getIcon = () => {
            switch (trend.direction) {
                case 'bullish': return '📈';
                case 'bearish': return '📉';
                default: return '➡️';
            }
        };
        
        return (
            <div className={`trend-indicator ${getColorClass()}`}>
                <span className="trend-icon">{getIcon()}</span>
                <div className="trend-details">
                    <div className="trend-direction">{trend.direction.toUpperCase()}</div>
                    <div className="trend-strength">{trend.strength} ({trend.confidence.toFixed(0)}%)</div>
                    <div className="trend-score">Score: {trend.score.toFixed(1)}/100</div>
                </div>
            </div>
        );
    };

    // Render recommendation card
    const renderRecommendationCard = (rec: TradingRecommendation, index: number) => {
        const isSelected = symbol === rec.symbol;
        
        return (
            <div 
                key={rec.symbol}
                className={`recommendation-card ${isSelected ? 'selected' : ''} ${rec.direction.toLowerCase()}`}
                onClick={() => applyRecommendation(rec)}
            >
                <div className="rec-header">
                    <span className="rec-rank">#{index + 1}</span>
                    <span className="rec-symbol">{rec.displayName}</span>
                    <span className={`rec-direction ${rec.direction.toLowerCase()}`}>
                        {rec.direction}
                    </span>
                </div>
                <div className="rec-details">
                    <div className="rec-score">{rec.score.toFixed(1)}/100</div>
                    <div className="rec-confidence">{rec.confidence.toFixed(0)}% confidence</div>
                    <div className="rec-strength">{rec.trendStrength}</div>
                </div>
                <div className="rec-params">
                    <span>Stake: ${rec.suggestedStake}</span>
                    <span>Duration: {rec.suggestedDuration}{rec.suggestedDurationUnit}</span>
                </div>
                <div className="rec-reason">{rec.reason}</div>
            </div>
        );
    };

    return (
        <div className='ml-trader'>
            <div className='ml-trader__container'>
                <div className='ml-trader__content'>
                    <div className='ml-trader__card'>
                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-symbol'>{localize('Asset')}</label>
                                <select
                                    id='ml-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);
                                        // Price and trend updates handled by useEffect when symbol changes
                                    }}
                                >
                                    {symbols.map(s => (
                                        <option key={s.symbol} value={s.symbol}>
                                            {s.display_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-trade-mode'>{localize('Trade Mode')}</label>
                                <select
                                    id='ml-trade-mode'
                                    value={trade_mode}
                                    onChange={e => {
                                        setTradeMode(e.target.value as 'rise_fall' | 'higher_lower');
                                        setContractType(e.target.value === 'rise_fall' ? 'CALL' : 'CALL');
                                    }}
                                >
                                    <option value='rise_fall'>Rise/Fall</option>
                                    <option value='higher_lower'>Higher/Lower</option>
                                </select>
                            </div>
                        </div>

                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-contract-type'>{localize('Contract Type')}</label>
                                <select
                                    id='ml-contract-type'
                                    value={contract_type}
                                    onChange={e => setContractType(e.target.value)}
                                >
                                    {current_trade_types.map(t => (
                                        <option key={t.value} value={t.value} title={t.description}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-stake'>{localize('Stake')}</label>
                                <input
                                    id='ml-stake'
                                    type='number'
                                    step='0.01'
                                    min={0.35}
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-duration'>{localize('Duration')}</label>
                                <input
                                    id='ml-duration'
                                    type='number'
                                    min={1}
                                    max={duration_unit === 't' ? 10 : duration_unit === 's' ? 3600 : 60}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-duration-unit'>{localize('Duration Unit')}</label>
                                <select
                                    id='ml-duration-unit'
                                    value={duration_unit}
                                    onChange={e => setDurationUnit(e.target.value as 't' | 's' | 'm')}
                                >
                                    <option value='t'>Ticks</option>
                                    <option value='s'>Seconds</option>
                                    <option value='m'>Minutes</option>
                                </select>
                            </div>
                        </div>

                        {trade_mode === 'higher_lower' && (
                            <div className='ml-trader__row'>
                                <div className='ml-trader__field'>
                                    <label htmlFor='ml-barrier-offset'>{localize('Barrier Offset')}</label>
                                    <input
                                        id='ml-barrier-offset'
                                        type='number'
                                        step='0.001'
                                        min={0.001}
                                        max={1.0}
                                        value={barrier_offset}
                                        onChange={e => setBarrierOffset(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        )}

                        {current_price && (
                            <div className='ml-trader__price-info'>
                                <Text size='xs' color='prominent'>
                                    {localize('Current Price:')} {current_price}
                                </Text>
                                {trade_mode === 'higher_lower' && (
                                    <Text size='xs' color='general'>
                                        {localize('Barrier:')} {
                                            contract_type === 'CALL' 
                                                ? (current_price + barrier_offset).toFixed(5)
                                                : (current_price - barrier_offset).toFixed(5)
                                        }
                                    </Text>
                                )}
                            </div>
                        )}

                        {/* Trend Analysis Display */}
                        {show_trend_analysis && current_trend && (
                            <div className='ml-trader__trend-analysis'>
                                <div className='trend-section-header'>
                                    <Text size='s' weight='bold' color='prominent'>
                                        {localize('Trend Analysis')}
                                    </Text>
                                    <button 
                                        className='toggle-trend-btn'
                                        onClick={() => setShowTrendAnalysis(!show_trend_analysis)}
                                    >
                                        ↕️
                                    </button>
                                </div>
                                {renderTrendIndicator(current_trend)}
                                
                                <div className='hma-values'>
                                    <div className='hma-row'>
                                        <span>HMA5: {current_trend.hma5?.toFixed(5) || 'N/A'}</span>
                                        <span>HMA40: {current_trend.hma40?.toFixed(5) || 'N/A'}</span>
                                    </div>
                                    <div className='hma-slopes'>
                                        <span>Slope5: {current_trend.hma5Slope?.toFixed(6) || 'N/A'}</span>
                                        <span>Slope40: {current_trend.hma40Slope?.toFixed(6) || 'N/A'}</span>
                                    </div>
                                </div>
                                
                                {current_trend.crossover !== 0 && (
                                    <div className={`crossover-alert ${current_trend.crossover > 0 ? 'bullish' : 'bearish'}`}>
                                        🚨 {current_trend.crossover > 0 ? 'Bullish' : 'Bearish'} Crossover Detected!
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Scanner Status */}
                        {scanner_status && (
                            <div className='ml-trader__scanner-status'>
                                <Text size='xs' color='general'>
                                    Scanner: {scanner_status.connectedSymbols}/{scanner_status.totalSymbols} symbols
                                    | Candles: {scanner_status.candlesGenerated}
                                    | Trends: {scanner_status.trendsAnalyzed}
                                </Text>
                                {scanner_status.errors.length > 0 && (
                                    <Text size='xs' color='loss-danger'>
                                        Errors: {scanner_status.errors.length}
                                    </Text>
                                )}
                            </div>
                        )}

                        {/* Auto Mode Toggle */}
                        <div className='ml-trader__auto-mode'>
                            <label className='auto-mode-toggle'>
                                <input
                                    type='checkbox'
                                    checked={auto_mode}
                                    onChange={(e) => setAutoMode(e.target.checked)}
                                    disabled={is_running}
                                />
                                <span>{localize('Auto-select best recommendations')}</span>
                            </label>
                        </div>

                        <div className='ml-trader__actions'>
                            <button
                                className='ml-trader__run'
                                onClick={onRun}
                                disabled={is_running || !symbol || !apiRef.current}
                            >
                                {is_running ? localize('Running...') : localize('Start Trading')}
                            </button>
                            {is_running && (
                                <button className='ml-trader__stop' onClick={onStop}>
                                    {localize('Stop')}
                                </button>
                            )}
                            <button
                                className='ml-trader__refresh'
                                onClick={() => marketScanner.refresh()}
                                disabled={!is_scanner_initialized}
                            >
                                {localize('Refresh Scanner')}
                            </button>
                        </div>

                        {status && (
                            <div className='ml-trader__status'>
                                <Text size='xs' color={/error|fail/i.test(status) ? 'loss-danger' : 'prominent'}>
                                    {status}
                                </Text>
                            </div>
                        )}
                    </div>

                    {/* Trading Recommendations */}
                    {is_scanner_initialized && recommendations.length > 0 && (
                        <div className='ml-trader__recommendations'>
                            <div className='recommendations-header'>
                                <Text size='s' weight='bold' color='prominent'>
                                    {localize('Top Trading Opportunities')}
                                </Text>
                                <Text size='xs' color='general'>
                                    Click on a recommendation to apply it
                                </Text>
                            </div>
                            <div className='recommendations-grid'>
                                {recommendations.slice(0, 6).map((rec, index) => 
                                    renderRecommendationCard(rec, index)
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default MLTrader;