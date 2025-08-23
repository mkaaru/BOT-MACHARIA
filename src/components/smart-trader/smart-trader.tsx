import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

// Advanced AI Trading Engine with Higher/Lower support
class AITradingEngine {
    private tickHistory: number[] = [];
    private digitHistory: number[] = [];
    private consecutivePatterns: { [key: string]: number } = {};
    private streakCounts: { even: number; odd: number; over5: number; under5: number } = {
        even: 0, odd: 0, over5: 0, under5: 0
    };

    updateTick(quote: number): void {
        this.tickHistory.push(quote);
        if (this.tickHistory.length > 200) {
            this.tickHistory = this.tickHistory.slice(-200);
        }

        const digit = Number(String(quote).slice(-1));
        this.digitHistory.push(digit);
        if (this.digitHistory.length > 100) {
            this.digitHistory = this.digitHistory.slice(-100);
        }

        this.updateStreaks(digit);
    }

    private updateStreaks(digit: number): void {
        const isEven = digit % 2 === 0;
        const isOver5 = digit > 5;

        // Reset opposite streaks
        if (isEven) {
            this.streakCounts.even++;
            this.streakCounts.odd = 0;
        } else {
            this.streakCounts.odd++;
            this.streakCounts.even = 0;
        }

        if (isOver5) {
            this.streakCounts.over5++;
            this.streakCounts.under5 = 0;
        } else {
            this.streakCounts.under5++;
            this.streakCounts.over5 = 0;
        }
    }

    generateRecommendation(): {
        tradeType: string;
        prediction?: number;
        reasoning: string;
        confidence: number;
        barrier?: string;
    } {
        if (this.digitHistory.length < 20) {
            return {
                tradeType: 'DIGITEVEN',
                reasoning: 'Insufficient data for analysis',
                confidence: 0
            };
        }

        const recent = this.digitHistory.slice(-20);
        const evenCount = recent.filter(d => d % 2 === 0).length;
        const oddCount = recent.length - evenCount;
        const over5Count = recent.filter(d => d > 5).length;
        const under5Count = recent.length - over5Count;

        let tradeType = 'DIGITEVEN';
        let prediction: number | undefined;
        let reasoning = '';
        let confidence = 50;
        let barrier: string | undefined;

        // Higher/Lower analysis based on price movement
        if (this.tickHistory.length >= 10) {
            const priceChanges = this.tickHistory.slice(-10).map((price, idx, arr) => 
                idx > 0 ? price - arr[idx - 1] : 0
            ).slice(1);

            const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
            const currentPrice = this.tickHistory[this.tickHistory.length - 1];

            if (Math.abs(avgChange) > 0.0001) {
                if (avgChange > 0) {
                    tradeType = 'CALL';
                    barrier = `+${Math.abs(avgChange * 5).toFixed(5)}`;
                    confidence = Math.min(85, 60 + Math.abs(avgChange) * 100000);
                    reasoning = `Strong upward trend detected (avg: ${(avgChange * 100).toFixed(4)}%) - Higher signal`;
                } else {
                    tradeType = 'PUT';
                    barrier = `+${Math.abs(avgChange * 5).toFixed(5)}`;
                    confidence = Math.min(85, 60 + Math.abs(avgChange) * 100000);
                    reasoning = `Strong downward trend detected (avg: ${(avgChange * 100).toFixed(4)}%) - Lower signal`;
                }
                return { tradeType, reasoning, confidence, barrier };
            }
        }

        // Even/Odd analysis with high confidence patterns
        if (this.streakCounts.even >= 5) {
            tradeType = 'DIGITODD';
            confidence = Math.min(90, 70 + this.streakCounts.even * 3);
            reasoning = `${this.streakCounts.even} consecutive even digits - strong odd reversal signal`;
        } else if (this.streakCounts.odd >= 5) {
            tradeType = 'DIGITEVEN';
            confidence = Math.min(90, 70 + this.streakCounts.odd * 3);
            reasoning = `${this.streakCounts.odd} consecutive odd digits - strong even reversal signal`;
        }
        // Over/Under 5 analysis
        else if (over5Count >= 15) {
            tradeType = 'DIGITUNDER';
            prediction = Math.floor(Math.random() * 5); // 0-4
            confidence = Math.min(85, 65 + (over5Count - 10) * 2);
            reasoning = `${over5Count}/20 digits over 5 - under correction expected`;
        } else if (under5Count >= 15) {
            tradeType = 'DIGITOVER';
            prediction = Math.floor(Math.random() * 4) + 6; // 6-9
            confidence = Math.min(85, 65 + (under5Count - 10) * 2);
            reasoning = `${under5Count}/20 digits under 5 - over correction expected`;
        }
        // Moderate patterns
        else if (evenCount >= 14) {
            tradeType = 'DIGITODD';
            confidence = Math.min(75, 55 + (evenCount - 10) * 3);
            reasoning = `${evenCount}/20 even digits - odd correction likely`;
        } else if (oddCount >= 14) {
            tradeType = 'DIGITEVEN';
            confidence = Math.min(75, 55 + (oddCount - 10) * 3);
            reasoning = `${oddCount}/20 odd digits - even correction likely`;
        }
        // Match/Differ patterns
        else if (this.digitHistory.length >= 5) {
            const lastDigit = this.digitHistory[this.digitHistory.length - 1];
            const matchCount = recent.filter(d => d === lastDigit).length;
            if (matchCount >= 4) {
                tradeType = 'DIGITDIFF';
                prediction = lastDigit;
                confidence = Math.min(80, 60 + matchCount * 4);
                reasoning = `Digit ${lastDigit} appeared ${matchCount} times - differs likely`;
            } else if (matchCount <= 1) {
                tradeType = 'DIGITMATCH';
                prediction = lastDigit;
                confidence = Math.min(75, 50 + (5 - matchCount) * 5);
                reasoning = `Digit ${lastDigit} rare in recent ticks - match possible`;
            }
        }

        return { tradeType, prediction, reasoning, confidence, barrier };
    }

    getStats(): any {
        return {
            tickCount: this.tickHistory.length,
            digitCount: this.digitHistory.length,
            streaks: this.streakCounts,
            recentDigits: this.digitHistory.slice(-10)
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
    { value: 'CALL', label: 'Higher' },
    { value: 'PUT', label: 'Lower' },
];

const SmartTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const aiEngineRef = useRef(new AITradingEngine());

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [trade_type, setTradeType] = useState<string>('DIGITOVER');
    const [ticks, setTicks] = useState<number>(1);
    const [stake, setStake] = useState<number>(0.5);
    const [prediction, setPrediction] = useState<number>(5);
    const [barrier, setBarrier] = useState<string>('+0.00');
    const [duration, setDuration] = useState<number>(1);
    const [durationType, setDurationType] = useState<string>('m');
    const [autoTrade, setAutoTrade] = useState<boolean>(false);
    const [minConfidence, setMinConfidence] = useState<number>(70);

    // AI state
    const [aiRecommendation, setAiRecommendation] = useState<any>(null);
    const [engineStats, setEngineStats] = useState<any>(null);
    const [executed_trades, setExecutedTrades] = useState<any[]>([]);

    // Tick state
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);
    const [currentPrice, setCurrentPrice] = useState<number>(0);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);

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
                console.error('SmartTrader init error', e);
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
        aiEngineRef.current = new AITradingEngine(); // Reset AI engine

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

                        // Update AI engine
                        aiEngineRef.current.updateTick(quote);

                        setCurrentPrice(quote);
                        setLastDigit(digit);
                        setDigits(prev => [...prev.slice(-19), digit]);
                        setTicksProcessed(prev => prev + 1);

                        // Generate AI recommendation every 5 ticks
                        if (ticksProcessed > 0 && ticksProcessed % 5 === 0) {
                            const recommendation = aiEngineRef.current.generateRecommendation();
                            setAiRecommendation(recommendation);

                            // Auto-execute if enabled and confidence is sufficient
                            if (autoTrade && recommendation.confidence >= minConfidence && is_running) {
                                executeTradeWithAI(recommendation, sym);
                            }
                        }

                        setEngineStats(aiEngineRef.current.getStats());
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const executeTradeWithAI = async (recommendation: any, currentSymbol: string) => {
        const tradeId = `ai-trade_${Date.now()}`;
        const trade = {
            id: tradeId,
            symbol: currentSymbol,
            symbol_display: symbols.find(s => s.symbol === currentSymbol)?.display_name || currentSymbol,
            timestamp: new Date().toLocaleTimeString(),
            trade_type: recommendation.tradeType,
            prediction: recommendation.prediction,
            confidence: recommendation.confidence,
            reasoning: recommendation.reasoning,
            stake: stake,
            status: 'executing'
        };

        setExecutedTrades(prev => [trade, ...prev.slice(0, 19)]);

        try {
            const result = await executeTrade(recommendation.tradeType, recommendation.prediction, recommendation.barrier);

            setExecutedTrades(prev => prev.map(t => 
                t.id === tradeId 
                    ? { ...t, status: 'completed', result: result }
                    : t
            ));

            setStatus(`✅ AI Trade: ${recommendation.tradeType} (${recommendation.confidence}% confidence)`);

        } catch (error) {
            setExecutedTrades(prev => prev.map(t => 
                t.id === tradeId 
                    ? { ...t, status: 'failed', error: error.message }
                    : t
            ));

            setStatus(`❌ AI Trade failed: ${error.message}`);
        }
    };

    const executeTrade = async (tradeType?: string, predictionValue?: number, barrierValue?: string) => {
        try {
            await authorizeIfNeeded();

            const useTradeType = tradeType || trade_type;
            const usePrediction = predictionValue !== undefined ? predictionValue : prediction;
            const useBarrier = barrierValue || barrier;

            const trade_option: any = {
                amount: Number(stake),
                basis: 'stake',
                contractTypes: [useTradeType],
                currency: account_currency,
                duration: Number(ticks),
                duration_unit: 't',
                symbol,
            };

            // Handle Higher/Lower specific parameters
            if (useTradeType === 'CALL' || useTradeType === 'PUT') {
                const barrierOffset = parseFloat(useBarrier);
                const calculatedBarrier = (currentPrice + barrierOffset).toFixed(5);
                trade_option.barrier = calculatedBarrier;
                trade_option.duration = Number(duration);
                trade_option.duration_unit = durationType;
            } else if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(useTradeType)) {
                trade_option.prediction = Number(usePrediction);
            }

            const buy_req = {
                buy: '1',
                price: trade_option.amount,
                parameters: {
                    amount: trade_option.amount,
                    basis: trade_option.basis,
                    contract_type: useTradeType,
                    currency: trade_option.currency,
                    duration: trade_option.duration,
                    duration_unit: trade_option.duration_unit,
                    symbol: trade_option.symbol,
                },
            };

            if (trade_option.prediction !== undefined) {
                buy_req.parameters.selected_tick = trade_option.prediction;
                if (!['TICKLOW', 'TICKHIGH'].includes(useTradeType)) {
                    buy_req.parameters.barrier = trade_option.prediction;
                }
            }

            // Set barrier for Higher/Lower trades
            if (useTradeType === 'CALL' || useTradeType === 'PUT') {
                buy_req.parameters.barrier = trade_option.barrier;
            }

            const { buy, error } = await apiRef.current.buy(buy_req);
            if (error) throw error;

            setStatus(`Trade executed: ${useTradeType} - ${buy?.longcode || 'Contract'}`);

            // Add to transactions
            try {
                const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: account_currency,
                    contract_type: useTradeType as any,
                    underlying: symbol,
                    display_name: symbol_display,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch {}

            return buy;

        } catch (e: any) {
            console.error('Execute trade error', e);
            setStatus(`Trade error: ${e?.message || 'Unknown error'}`);
            throw e;
        }
    };

    const toggleTrading = () => {
        if (is_running) {
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            setStatus('Trading stopped');
        } else {
            setIsRunning(true);
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1);
            run_panel.run_id = `smart-trader-${Date.now()}`;
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);
            setStatus('Trading started');
        }
    };

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'is-green';
        if (confidence >= 60) return 'is-yellow';
        if (confidence >= 40) return 'is-orange';
        return 'is-red';
    };

    return (
        <div className='smart-trader'>
            <div className='smart-trader__container'>
                <div className='smart-trader__header'>
                    <h2 className='smart-trader__title'>{localize('🎯 AI Smart Trader')}</h2>
                    <p className='smart-trader__subtitle'>{localize('Advanced AI trading with Higher/Lower support')}</p>
                </div>

                <div className='smart-trader__content'>
                    {/* Configuration Section */}
                    <div className='smart-trader__config'>
                        <div className='smart-trader__row'>
                            <div className='smart-trader__field'>
                                <label htmlFor='smart-symbol'>{localize('Symbol')}</label>
                                <select
                                    id='smart-symbol'
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
                            <div className='smart-trader__field'>
                                <label htmlFor='smart-trade-type'>{localize('Trade Type')}</label>
                                <select
                                    id='smart-trade-type'
                                    value={trade_type}
                                    onChange={e => setTradeType(e.target.value)}
                                >
                                    {TRADE_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='smart-trader__field'>
                                <label htmlFor='smart-stake'>{localize('Stake')}</label>
                                <input
                                    id='smart-stake'
                                    type='number'
                                    step='0.01'
                                    min={0.35}
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className='smart-trader__row'>
                            {['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(trade_type) && (
                                <div className='smart-trader__field'>
                                    <label htmlFor='smart-prediction'>{localize('Prediction')}</label>
                                    <input
                                        id='smart-prediction'
                                        type='number'
                                        min={0}
                                        max={9}
                                        value={prediction}
                                        onChange={e => setPrediction(Number(e.target.value))}
                                    />
                                </div>
                            )}

                            {(trade_type === 'CALL' || trade_type === 'PUT') && (
                                <>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='smart-barrier'>{localize('Barrier Offset')}</label>
                                        <select
                                            id='smart-barrier'
                                            value={barrier}
                                            onChange={e => setBarrier(e.target.value)}
                                        >
                                            <option value='+0.50'>+0.50</option>
                                            <option value='+0.25'>+0.25</option>
                                            <option value='+0.10'>+0.10</option>
                                            <option value='+0.05'>+0.05</option>
                                            <option value='+0.00'>+0.00</option>
                                            <option value='-0.05'>-0.05</option>
                                            <option value='-0.10'>-0.10</option>
                                            <option value='-0.25'>-0.25</option>
                                            <option value='-0.50'>-0.50</option>
                                        </select>
                                        {currentPrice > 0 && (
                                            <div className='smart-trader__barrier-preview'>
                                                Barrier: {(currentPrice + parseFloat(barrier)).toFixed(5)}
                                            </div>
                                        )}
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='smart-duration'>{localize('Duration')}</label>
                                        <input
                                            id='smart-duration'
                                            type='number'
                                            min={1}
                                            max={60}
                                            value={duration}
                                            onChange={e => setDuration(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='smart-duration-type'>{localize('Duration Unit')}</label>
                                        <select
                                            id='smart-duration-type'
                                            value={durationType}
                                            onChange={e => setDurationType(e.target.value)}
                                        >
                                            <option value='m'>Minutes</option>
                                            <option value='h'>Hours</option>
                                            <option value='d'>Days</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {!['CALL', 'PUT'].includes(trade_type) && (
                                <div className='smart-trader__field'>
                                    <label htmlFor='smart-ticks'>{localize('Ticks')}</label>
                                    <input
                                        id='smart-ticks'
                                        type='number'
                                        min={1}
                                        max={10}
                                        value={ticks}
                                        onChange={e => setTicks(Number(e.target.value))}
                                    />
                                </div>
                            )}
                        </div>

                        <div className='smart-trader__row'>
                            <div className='smart-trader__field'>
                                <label>
                                    <input
                                        type='checkbox'
                                        checked={autoTrade}
                                        onChange={e => setAutoTrade(e.target.checked)}
                                    />
                                    {localize('Auto-trade on AI signals')}
                                </label>
                            </div>
                            <div className='smart-trader__field'>
                                <label htmlFor='smart-confidence'>{localize('Min Confidence %')}</label>
                                <input
                                    id='smart-confidence'
                                    type='number'
                                    min={40}
                                    max={95}
                                    value={minConfidence}
                                    onChange={e => setMinConfidence(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* AI Recommendation Panel */}
                    {aiRecommendation && (
                        <div className='smart-trader__recommendation'>
                            <h3 className='smart-trader__rec-title'>🤖 AI Recommendation</h3>
                            <div className={`smart-trader__rec-card ${getConfidenceColor(aiRecommendation.confidence)}`}>
                                <div className='smart-trader__rec-header'>
                                    <span className='smart-trader__rec-action'>
                                        {aiRecommendation.tradeType}
                                        {aiRecommendation.prediction !== undefined && ` (${aiRecommendation.prediction})`}
                                    </span>
                                    <span className='smart-trader__rec-confidence'>{aiRecommendation.confidence}%</span>
                                </div>
                                <div className='smart-trader__rec-reasoning'>
                                    {aiRecommendation.reasoning}
                                </div>
                                {aiRecommendation.confidence >= minConfidence && (
                                    <div className='smart-trader__execute-section'>
                                        <button
                                            className='smart-trader__execute-btn'
                                            onClick={() => executeTradeWithAI(aiRecommendation, symbol)}
                                            disabled={autoTrade && is_running}
                                        >
                                            {autoTrade && is_running ? 
                                                localize('Auto-Trading Active') : 
                                                localize('Execute AI Trade')} ({aiRecommendation.confidence}%)
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Live Digits Display */}
                    <div className='smart-trader__digits'>
                        <h4 className='smart-trader__digits-title'>{localize('Live Tick Stream')}</h4>
                        <div className='smart-trader__digits-container'>
                            {digits.map((d, idx) => (
                                <div
                                    key={`${idx}-${d}`}
                                    className={`smart-trader__digit ${d === lastDigit ? 'is-current' : ''}`}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                        <div className='smart-trader__meta'>
                            <Text size='xs' color='general'>
                                {localize('Processed:')} {ticksProcessed} | {localize('Last:')} {lastDigit ?? '-'}
                            </Text>
                        </div>
                    </div>

                    {/* Engine Statistics */}
                    {engineStats && (
                        <div className='smart-trader__stats'>
                            <h4 className='smart-trader__stats-title'>{localize('AI Engine Stats')}</h4>
                            <div className='smart-trader__stats-grid'>
                                <div className='smart-trader__stat'>
                                    <span className='smart-trader__stat-label'>{localize('Tick Count:')}</span>
                                    <span className='smart-trader__stat-value'>{engineStats.tickCount}</span>
                                </div>
                                <div className='smart-trader__stat'>
                                    <span className='smart-trader__stat-label'>{localize('Even Streak:')}</span>
                                    <span className='smart-trader__stat-value'>{engineStats.streaks?.even || 0}</span>
                                </div>
                                <div className='smart-trader__stat'>
                                    <span className='smart-trader__stat-label'>{localize('Odd Streak:')}</span>
                                    <span className='smart-trader__stat-value'>{engineStats.streaks?.odd || 0}</span>
                                </div>
                                <div className='smart-trader__stat'>
                                    <span className='smart-trader__stat-label'>{localize('Recent Digits:')}</span>
                                    <span className='smart-trader__stat-value'>
                                        {engineStats.recentDigits?.join(', ') || '-'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Executed Trades */}
                    {executed_trades.length > 0 && (
                        <div className='smart-trader__trades'>
                            <h4 className='smart-trader__trades-title'>{localize('📊 Recent AI Trades')}</h4>
                            <div className='smart-trader__trades-list'>
                                {executed_trades.slice(0, 10).map(trade => (
                                    <div key={trade.id} className='smart-trader__trade-item'>
                                        <div className='smart-trader__trade-header'>
                                            <span className='smart-trader__trade-time'>{trade.timestamp}</span>
                                            <span className={`smart-trader__trade-status status-${trade.status}`}>
                                                {trade.status.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className='smart-trader__trade-details'>
                                            <span className='smart-trader__trade-market'>{trade.symbol_display}</span>
                                            <span className='smart-trader__trade-type'>{trade.trade_type}</span>
                                            <span className='smart-trader__trade-confidence'>{trade.confidence}%</span>
                                            <span className='smart-trader__trade-stake'>${trade.stake}</span>
                                        </div>
                                        {trade.reasoning && (
                                            <div className='smart-trader__trade-reasoning'>
                                                {trade.reasoning}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    <div className='smart-trader__actions'>
                        <button
                            className='smart-trader__execute'
                            onClick={() => executeTrade()}
                            disabled={!symbol || !is_authorized}
                        >
                            {localize('Execute Trade')}
                        </button>

                        <button
                            className={`smart-trader__toggle ${is_running ? 'is-stop' : 'is-start'}`}
                            onClick={toggleTrading}
                            disabled={!symbol}
                        >
                            {is_running ? localize('Stop Trading') : localize('Start Trading')}
                        </button>
                    </div>

                    {status && (
                        <div className='smart-trader__status'>
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

export default SmartTrader;