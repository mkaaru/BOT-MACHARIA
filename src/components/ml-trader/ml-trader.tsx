
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// ML-based feature extraction and prediction
class MLTradingEngine {
    private tickHistory: number[] = [];
    private features: number[][] = [];
    private predictions: any[] = [];
    private modelWeights = {
        trend: 0.3,
        volatility: 0.25,
        momentum: 0.2,
        pattern: 0.15,
        seasonality: 0.1
    };

    // Extract features from tick data
    extractFeatures(ticks: number[], windowSize = 20): number[] {
        if (ticks.length < windowSize) return [];

        const recent = ticks.slice(-windowSize);
        const features = [];

        // 1. Trend indicators
        const sma5 = this.calculateSMA(recent, 5);
        const sma10 = this.calculateSMA(recent, 10);
        const trend = sma5 > sma10 ? 1 : -1;
        features.push(trend);

        // 2. Volatility (standard deviation)
        const volatility = this.calculateStdDev(recent);
        features.push(volatility);

        // 3. Momentum (rate of change)
        const momentum = recent.length > 1 ? (recent[recent.length - 1] - recent[0]) / recent[0] : 0;
        features.push(momentum);

        // 4. RSI-like indicator
        const rsi = this.calculateRSI(recent);
        features.push(rsi);

        // 5. Last digit patterns
        const lastDigits = recent.map(tick => Math.floor(Math.abs(tick * 100000)) % 10);
        const evenCount = lastDigits.filter(d => d % 2 === 0).length;
        const oddCount = lastDigits.length - evenCount;
        features.push(evenCount / lastDigits.length);

        // 6. Consecutive patterns
        const consecutive = this.analyzeConsecutivePatterns(lastDigits);
        features.push(consecutive.maxConsecutive);

        // 7. Over/Under 5 patterns
        const over5Count = lastDigits.filter(d => d > 5).length;
        features.push(over5Count / lastDigits.length);

        return features;
    }

    // Simple Moving Average
    calculateSMA(data: number[], period: number): number {
        if (data.length < period) return data[data.length - 1] || 0;
        const sum = data.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    }

    // Standard Deviation
    calculateStdDev(data: number[]): number {
        const mean = data.reduce((a, b) => a + b, 0) / data.length;
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
        return Math.sqrt(variance);
    }

    // RSI calculation
    calculateRSI(data: number[], period = 14): number {
        if (data.length < period + 1) return 50;
        
        let gains = 0, losses = 0;
        for (let i = 1; i < Math.min(period + 1, data.length); i++) {
            const change = data[i] - data[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / (avgLoss || 1);
        return 100 - (100 / (1 + rs));
    }

    // Analyze consecutive digit patterns
    analyzeConsecutivePatterns(digits: number[]): { maxConsecutive: number, pattern: string } {
        let maxConsecutive = 1;
        let currentConsecutive = 1;
        let pattern = 'MIXED';

        for (let i = 1; i < digits.length; i++) {
            if ((digits[i] % 2) === (digits[i-1] % 2)) {
                currentConsecutive++;
                maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
            } else {
                currentConsecutive = 1;
            }
        }

        if (maxConsecutive >= 5) pattern = 'STRONG_STREAK';
        else if (maxConsecutive >= 3) pattern = 'MODERATE_STREAK';

        return { maxConsecutive, pattern };
    }

    // ML prediction using weighted feature analysis
    predict(features: number[]): {
        recommendation: string;
        confidence: number;
        reasoning: string;
        tradeType: string;
        prediction?: number;
    } {
        if (features.length < 7) {
            return {
                recommendation: 'WAIT',
                confidence: 0,
                reasoning: 'Insufficient data for prediction',
                tradeType: 'NONE'
            };
        }

        const [trend, volatility, momentum, rsi, evenRatio, maxConsecutive, over5Ratio] = features;

        // ML decision tree logic
        let recommendation = 'WAIT';
        let confidence = 0;
        let reasoning = '';
        let tradeType = 'DIGITEVEN';
        let prediction: number | undefined;

        // High confidence signals
        if (evenRatio > 0.7 && maxConsecutive < 3) {
            recommendation = 'STRONG_ODD';
            tradeType = 'DIGITODD';
            confidence = Math.min(90, 60 + (evenRatio - 0.7) * 100);
            reasoning = `Strong even streak (${(evenRatio * 100).toFixed(1)}%) suggests odd reversal`;
        } else if (evenRatio < 0.3 && maxConsecutive < 3) {
            recommendation = 'STRONG_EVEN';
            tradeType = 'DIGITEVEN';
            confidence = Math.min(90, 60 + (0.3 - evenRatio) * 100);
            reasoning = `Strong odd streak (${((1 - evenRatio) * 100).toFixed(1)}%) suggests even reversal`;
        }
        // Over/Under predictions based on trend and volatility
        else if (over5Ratio > 0.65 && volatility < 0.0001) {
            recommendation = 'STRONG_UNDER';
            tradeType = 'DIGITUNDER';
            prediction = Math.floor(4 - (over5Ratio - 0.65) * 10);
            confidence = Math.min(85, 55 + (over5Ratio - 0.65) * 80);
            reasoning = `High over-5 ratio (${(over5Ratio * 100).toFixed(1)}%) with low volatility suggests under reversal`;
        } else if (over5Ratio < 0.35 && volatility < 0.0001) {
            recommendation = 'STRONG_OVER';
            tradeType = 'DIGITOVER';
            prediction = Math.floor(6 + (0.35 - over5Ratio) * 10);
            confidence = Math.min(85, 55 + (0.35 - over5Ratio) * 80);
            reasoning = `Low over-5 ratio (${(over5Ratio * 100).toFixed(1)}%) with low volatility suggests over reversal`;
        }
        // Medium confidence signals
        else if (maxConsecutive >= 4) {
            if (evenRatio > 0.5) {
                recommendation = 'MEDIUM_ODD';
                tradeType = 'DIGITODD';
                confidence = 45 + maxConsecutive * 5;
                reasoning = `${maxConsecutive} consecutive pattern suggests reversal to odd`;
            } else {
                recommendation = 'MEDIUM_EVEN';
                tradeType = 'DIGITEVEN';
                confidence = 45 + maxConsecutive * 5;
                reasoning = `${maxConsecutive} consecutive pattern suggests reversal to even`;
            }
        }
        // RSI-based signals
        else if (rsi > 70 && momentum > 0) {
            recommendation = 'MEDIUM_SELL';
            tradeType = trend > 0 ? 'DIGITUNDER' : 'DIGITEVEN';
            prediction = trend > 0 ? 4 : undefined;
            confidence = Math.min(75, 40 + (rsi - 70) * 1.5);
            reasoning = `Overbought RSI (${rsi.toFixed(1)}) with positive momentum suggests reversal`;
        } else if (rsi < 30 && momentum < 0) {
            recommendation = 'MEDIUM_BUY';
            tradeType = trend > 0 ? 'DIGITOVER' : 'DIGITODD';
            prediction = trend > 0 ? 6 : undefined;
            confidence = Math.min(75, 40 + (30 - rsi) * 1.5);
            reasoning = `Oversold RSI (${rsi.toFixed(1)}) with negative momentum suggests reversal`;
        }

        return {
            recommendation,
            confidence: Math.round(confidence),
            reasoning,
            tradeType,
            prediction
        };
    }

    // Update model with new tick data
    updateModel(tick: number): void {
        this.tickHistory.push(tick);
        if (this.tickHistory.length > 100) {
            this.tickHistory = this.tickHistory.slice(-100);
        }

        const features = this.extractFeatures(this.tickHistory);
        if (features.length > 0) {
            this.features.push(features);
            if (this.features.length > 50) {
                this.features = this.features.slice(-50);
            }
        }
    }

    getModelStats(): any {
        return {
            tickCount: this.tickHistory.length,
            featureCount: this.features.length,
            lastFeatures: this.features[this.features.length - 1] || [],
            recentTicks: this.tickHistory.slice(-10)
        };
    }
}

const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
];

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const mlEngineRef = useRef(new MLTradingEngine());

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [ticks, setTicks] = useState<number>(1);
    const [stake, setStake] = useState<number>(0.5);
    const [autoTrade, setAutoTrade] = useState<boolean>(false);
    const [minConfidence, setMinConfidence] = useState<number>(70);

    // ML state
    const [mlRecommendation, setMlRecommendation] = useState<any>(null);
    const [modelStats, setModelStats] = useState<any>(null);
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);
    const [predictionHistory, setPredictionHistory] = useState<any[]>([]);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    const getRecommendationColor = (confidence: number) => {
        if (confidence >= 80) return 'is-green';
        if (confidence >= 60) return 'is-yellow';
        if (confidence >= 40) return 'is-orange';
        return 'is-red';
    };

    useEffect(() => {
        // Initialize API connection and fetch active symbols
        const api = generateDerivApiInstance();
        apiRef.current = api;
        const init = async () => {
            try {
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;
                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);
                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    startTicks(syn[0].symbol);
                }
            } catch (e: any) {
                console.error('MLTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
            }
        };
        init();

        return () => {
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
        };
    }, []);

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
        setDigits([]);
        setLastDigit(null);
        setTicksProcessed(0);
        mlEngineRef.current = new MLTradingEngine(); // Reset ML engine
        
        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const digit = Number(String(quote).slice(-1));
                        
                        // Update ML model
                        mlEngineRef.current.updateModel(quote);
                        
                        setLastDigit(digit);
                        setDigits(prev => [...prev.slice(-19), digit]);
                        setTicksProcessed(prev => prev + 1);

                        // Generate ML prediction every few ticks
                        if (ticksProcessed % 3 === 0) {
                            const features = mlEngineRef.current.extractFeatures(mlEngineRef.current['tickHistory']);
                            if (features.length > 0) {
                                const prediction = mlEngineRef.current.predict(features);
                                setMlRecommendation(prediction);
                                
                                // Add to prediction history
                                setPredictionHistory(prev => [
                                    ...prev.slice(-9),
                                    {
                                        timestamp: new Date().toLocaleTimeString(),
                                        ...prediction,
                                        tick: quote
                                    }
                                ]);

                                // Auto-trade if enabled and confidence is high
                                if (autoTrade && prediction.confidence >= minConfidence && is_running) {
                                    executeTrade(prediction);
                                }
                            }
                        }

                        // Update model stats
                        setModelStats(mlEngineRef.current.getModelStats());
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const executeTrade = async (prediction: any) => {
        try {
            await authorizeIfNeeded();

            const trade_option: any = {
                amount: Number(stake),
                basis: 'stake',
                contractTypes: [prediction.tradeType],
                currency: account_currency,
                duration: Number(ticks),
                duration_unit: 't',
                symbol,
            };

            if (prediction.prediction !== undefined) {
                trade_option.prediction = Number(prediction.prediction);
            }

            const buy_req = {
                buy: '1',
                price: trade_option.amount,
                parameters: {
                    amount: trade_option.amount,
                    basis: trade_option.basis,
                    contract_type: prediction.tradeType,
                    currency: trade_option.currency,
                    duration: trade_option.duration,
                    duration_unit: trade_option.duration_unit,
                    symbol: trade_option.symbol,
                },
            };

            if (trade_option.prediction !== undefined) {
                buy_req.parameters.selected_tick = trade_option.prediction;
                if (!['TICKLOW', 'TICKHIGH'].includes(prediction.tradeType)) {
                    buy_req.parameters.barrier = trade_option.prediction;
                }
            }

            const { buy, error } = await apiRef.current.buy(buy_req);
            if (error) throw error;

            setStatus(`ML Auto-Trade: ${prediction.tradeType} (${prediction.confidence}% confidence) - ${buy?.longcode || 'Contract'}`);

            // Add to transactions
            try {
                const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: account_currency,
                    contract_type: prediction.tradeType as any,
                    underlying: symbol,
                    display_name: symbol_display,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch {}

        } catch (e: any) {
            console.error('Execute trade error', e);
            setStatus(`Trade error: ${e?.message || 'Unknown error'}`);
        }
    };

    const toggleTrading = () => {
        if (is_running) {
            setIsRunning(false);
            stopFlagRef.current = true;
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        } else {
            setIsRunning(true);
            stopFlagRef.current = false;
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1);
            run_panel.run_id = `ml-trader-${Date.now()}`;
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);
        }
    };

    return (
        <div className='ml-trader'>
            <div className='ml-trader__container'>
                <div className='ml-trader__header'>
                    <h2 className='ml-trader__title'>{localize('🤖 AI ML Trading Engine')}</h2>
                    <p className='ml-trader__subtitle'>{localize('Machine Learning powered tick analysis and trading recommendations')}</p>
                </div>

                <div className='ml-trader__content'>
                    {/* Configuration Section */}
                    <div className='ml-trader__config'>
                        <div className='ml-trader__row'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-symbol'>{localize('Symbol')}</label>
                                <select
                                    id='ml-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);
                                        startTicks(v);
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
                                <label htmlFor='ml-ticks'>{localize('Ticks')}</label>
                                <input
                                    id='ml-ticks'
                                    type='number'
                                    min={1}
                                    max={10}
                                    value={ticks}
                                    onChange={e => setTicks(Number(e.target.value))}
                                />
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

                        <div className='ml-trader__row'>
                            <div className='ml-trader__field'>
                                <label>
                                    <input
                                        type='checkbox'
                                        checked={autoTrade}
                                        onChange={e => setAutoTrade(e.target.checked)}
                                    />
                                    {localize('Auto-trade on ML signals')}
                                </label>
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-confidence'>{localize('Min Confidence %')}</label>
                                <input
                                    id='ml-confidence'
                                    type='number'
                                    min={40}
                                    max={95}
                                    value={minConfidence}
                                    onChange={e => setMinConfidence(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* ML Recommendation Panel */}
                    {mlRecommendation && (
                        <div className='ml-trader__recommendation'>
                            <h3 className='ml-trader__rec-title'>🎯 ML Recommendation</h3>
                            <div className={`ml-trader__rec-card ${getRecommendationColor(mlRecommendation.confidence)}`}>
                                <div className='ml-trader__rec-header'>
                                    <span className='ml-trader__rec-action'>{mlRecommendation.recommendation}</span>
                                    <span className='ml-trader__rec-confidence'>{mlRecommendation.confidence}%</span>
                                </div>
                                <div className='ml-trader__rec-details'>
                                    <div className='ml-trader__rec-trade-type'>
                                        <strong>{localize('Trade Type:')}</strong> {mlRecommendation.tradeType}
                                        {mlRecommendation.prediction && (
                                            <span> | <strong>{localize('Prediction:')}</strong> {mlRecommendation.prediction}</span>
                                        )}
                                    </div>
                                    <div className='ml-trader__rec-reasoning'>
                                        <strong>{localize('Analysis:')}</strong> {mlRecommendation.reasoning}
                                    </div>
                                </div>
                                {mlRecommendation.confidence >= minConfidence && (
                                    <button
                                        className='ml-trader__execute-btn'
                                        onClick={() => executeTrade(mlRecommendation)}
                                        disabled={is_running && autoTrade}
                                    >
                                        {localize('Execute Trade')}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Live Digits Display */}
                    <div className='ml-trader__digits'>
                        <h4 className='ml-trader__digits-title'>{localize('Live Tick Stream')}</h4>
                        <div className='ml-trader__digits-container'>
                            {digits.map((d, idx) => (
                                <div
                                    key={`${idx}-${d}`}
                                    className={`ml-trader__digit ${d === lastDigit ? 'is-current' : ''}`}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                        <div className='ml-trader__meta'>
                            <Text size='xs' color='general'>
                                {localize('Processed:')} {ticksProcessed} | {localize('Last:')} {lastDigit ?? '-'}
                            </Text>
                        </div>
                    </div>

                    {/* Model Statistics */}
                    {modelStats && (
                        <div className='ml-trader__stats'>
                            <h4 className='ml-trader__stats-title'>{localize('ML Model Stats')}</h4>
                            <div className='ml-trader__stats-grid'>
                                <div className='ml-trader__stat'>
                                    <span className='ml-trader__stat-label'>{localize('Tick Count:')}</span>
                                    <span className='ml-trader__stat-value'>{modelStats.tickCount}</span>
                                </div>
                                <div className='ml-trader__stat'>
                                    <span className='ml-trader__stat-label'>{localize('Features:')}</span>
                                    <span className='ml-trader__stat-value'>{modelStats.featureCount}</span>
                                </div>
                                <div className='ml-trader__stat'>
                                    <span className='ml-trader__stat-label'>{localize('Recent Ticks:')}</span>
                                    <span className='ml-trader__stat-value'>
                                        {modelStats.recentTicks?.slice(-5).join(', ')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Prediction History */}
                    {predictionHistory.length > 0 && (
                        <div className='ml-trader__history'>
                            <h4 className='ml-trader__history-title'>{localize('Recent Predictions')}</h4>
                            <div className='ml-trader__history-list'>
                                {predictionHistory.slice(-5).map((pred, idx) => (
                                    <div key={idx} className='ml-trader__history-item'>
                                        <span className='ml-trader__history-time'>{pred.timestamp}</span>
                                        <span className={`ml-trader__history-rec ${getRecommendationColor(pred.confidence)}`}>
                                            {pred.recommendation} ({pred.confidence}%)
                                        </span>
                                        <span className='ml-trader__history-type'>{pred.tradeType}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    <div className='ml-trader__actions'>
                        <button
                            className={`ml-trader__toggle ${is_running ? 'is-stop' : 'is-start'}`}
                            onClick={toggleTrading}
                            disabled={!symbol}
                        >
                            {is_running ? localize('Stop ML Trading') : localize('Start ML Analysis')}
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
            </div>
        </div>
    );
});

export default MLTrader;
