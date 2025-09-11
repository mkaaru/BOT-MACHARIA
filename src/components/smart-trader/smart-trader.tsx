import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
// import { tradeOptionToBuy } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

// Minimal trade types we will support initially
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
// Safe version of tradeOptionToBuy without Blockly dependencies
const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy = {
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
    if (trade_option.prediction !== undefined) {
        buy.parameters.selected_tick = trade_option.prediction;
    }
    if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }
    return buy;
};

const SmartTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const lastOutcomeWasLossRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [tradeType, setTradeType] = useState<string>('DIGITOVER');
    const [ticks, setTicks] = useState<number>(1);
    const [duration, setDuration] = useState<number>(46); // For time-based duration
    const [durationType, setDurationType] = useState<string>('t'); // 't' for ticks, 's' for seconds, 'm' for minutes
    const [stake, setStake] = useState<number>(0.5);
    // const [baseStake, setBaseStake] = useState<number>(0.5); // Removed as initialStake and currentStake handle this
    // Predictions
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(5);
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(5);
    const [mdPrediction, setMdPrediction] = useState<number>(5); // for match/diff
    // Higher/Lower barrier
    const [barrier, setBarrier] = useState<string>('+0.37');
    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(1.5);
    const [maxMartingaleMultiplier, setMaxMartingaleMultiplier] = useState<number>(4); // Default max is 4

    // Martingale strategy state
    const [initialStake, setInitialStake] = useState(1);
    const [currentStake, setCurrentStake] = useState(1);
    const [lastTradeResult, setLastTradeResult] = useState<'win' | 'loss' | null>(null);
    const [lossStreak, setLossStreak] = useState(0);
    const [totalTrades, setTotalTrades] = useState(0);
    const [totalProfit, setTotalProfit] = useState(0);
    const [winRate, setWinRate] = useState(0);

    // Contract tracking state
    const [currentProfit, setCurrentProfit] = useState<number>(0);
    const [contractValue, setContractValue] = useState<number>(0);
    const [potentialPayout, setPotentialPayout] = useState<number>(0);
    const [contractDuration, setContractDuration] = useState<string>('00:00:00');

    // Live digits state
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Hull Moving Average trend analysis state
    const [hullTrends, setHullTrends] = useState({
        '15s': { trend: 'NEUTRAL', value: 0 },
        '1m': { trend: 'NEUTRAL', value: 0 },
        '5m': { trend: 'NEUTRAL', value: 0 },
        '15m': { trend: 'NEUTRAL', value: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [allVolatilitiesData, setAllVolatilitiesData] = useState<Record<string, Array<{ time: number, price: number, close: number }>>>({});

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    // --- New State Variables for Run Panel Integration ---
    const [isTrading, setIsTrading] = useState(false); // Tracks if trading is active
    const [isConnected, setIsConnected] = useState(false); // Tracks API connection status
    const [websocket, setWebsocket] = useState<any>(null); // Stores websocket instance
    const [autoExecute, setAutoExecute] = useState(false); // Flag for auto-execution
    const [tickHistory, setTickHistory] = useState<Array<{ time: number, price: number }>>([]); // For tick history

    // --- Helper Functions ---

    const getHintClass = (d: number) => {
        if (tradeType === 'DIGITEVEN') return d % 2 === 0 ? 'is-green' : 'is-red';
        if (tradeType === 'DIGITODD') return d % 2 !== 0 ? 'is-green' : 'is-red';
        if ((tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER')) {
            const activePred = lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
            if (tradeType === 'DIGITOVER') {
                if (d > Number(activePred)) return 'is-green';
                if (d < Number(activePred)) return 'is-red';
                return 'is-neutral';
            }
            if (tradeType === 'DIGITUNDER') {
                if (d < Number(activePred)) return 'is-green';
                if (d > Number(activePred)) return 'is-red';
                return 'is-neutral';
            }
        }
        return '';
    };

    // Load historical data for all volatility indices
    const loadAllVolatilitiesHistoricalData = async (volatilities: Array<{ symbol: string; display_name: string }>) => {
        if (!apiRef.current) return;

        setStatus('Loading historical data for all volatilities...');

        try {
            const allData: Record<string, Array<{ time: number, price: number, close: number }>> = {};

            // Load historical data for each volatility in batches to avoid overwhelming the API
            const batchSize = 3;
            for (let i = 0; i < volatilities.length; i += batchSize) {
                const batch = volatilities.slice(i, i + batchSize);

                const batchPromises = batch.map(async (vol) => {
                    try {
                        const request = {
                            ticks_history: vol.symbol,
                            adjust_start_time: 1,
                            count: 5000, // Maximum historical data
                            end: "latest",
                            start: 1,
                            style: "ticks"
                        };

                        const response = await apiRef.current.send(request);

                        if (response.error) {
                            console.error(`Historical ticks fetch error for ${vol.symbol}:`, response.error);
                            return;
                        }

                        if (response.history && response.history.prices && response.history.times) {
                            const historicalData = response.history.prices.map((price: string, index: number) => ({
                                time: response.history.times[index] * 1000, // Convert to milliseconds
                                price: parseFloat(price),
                                close: parseFloat(price)
                            }));

                            allData[vol.symbol] = historicalData;
                            console.log(`Loaded ${historicalData.length} historical ticks for ${vol.symbol}`);
                        }
                    } catch (error) {
                        console.error(`Error loading historical data for ${vol.symbol}:`, error);
                    }
                });

                // Wait for current batch to complete before starting next batch
                await Promise.all(batchPromises);

                // Small delay between batches to be respectful to the API
                if (i + batchSize < volatilities.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            setAllVolatilitiesData(allData);
            setStatus(`Loaded historical data for ${Object.keys(allData).length} volatilities`);

            console.log('All volatilities historical data loaded:', Object.keys(allData));

        } catch (error) {
            console.error('Error loading all volatilities historical data:', error);
            setStatus('Failed to load historical data');
        }
    };

    // Fetch historical tick data for Hull Moving Average analysis
    const fetchHistoricalTicks = async (symbolToFetch: string) => {
        try {
            const request = {
                ticks_history: symbolToFetch,
                adjust_start_time: 1,
                count: 1000, // Get more historical data for better HMA calculation
                end: "latest",
                start: 1,
                style: "ticks"
            };

            const response = await apiRef.current.send(request);

            if (response.error) {
                console.error('Historical ticks fetch error:', response.error);
                return;
            }

            if (response.history && response.history.prices && response.history.times) {
                const historicalData = response.history.prices.map((price: string, index: number) => ({
                    time: response.history.times[index] * 1000, // Convert to milliseconds
                    price: parseFloat(price),
                    close: parseFloat(price)
                }));

                setTickData(prev => {
                    const combinedData = [...historicalData, ...prev];
                    const uniqueData = combinedData.filter((tick, index, arr) =>
                        arr.findIndex(t => t.time === tick.time) === index
                    ).sort((a, b) => a.time - b.time);

                    // Keep only last 2000 ticks to prevent memory issues
                    const trimmedData = uniqueData.slice(-2000);

                    // Update Hull trends with historical data
                    if (tradeType === 'CALL' || tradeType === 'PUT') {
                        updateHullTrends(trimmedData);
                    }

                    return trimmedData;
                });
            }
        } catch (error) {
            console.error('Error fetching historical ticks:', error);
        }
    };

    // Hull Moving Average calculation with Weighted Moving Average
    const calculateHMA = (data: number[], period: number) => {
        if (data.length < period) return null;

        const calculateWMA = (values: number[], periods: number) => {
            if (values.length < periods) return null;
            const weights = Array.from({length: periods}, (_, i) => i + 1);
            const weightSum = weights.reduce((sum, w) => sum + w, 0);
            const recentValues = values.slice(-periods);
            const weightedSum = recentValues.reduce((sum, val, i) => sum + val * weights[i], 0);
            return weightedSum / weightSum;
        };

        const halfPeriod = Math.floor(period / 2);
        const sqrtPeriod = Math.floor(Math.sqrt(period));

        // Calculate WMA for half period and full period
        const wmaHalf = calculateWMA(data, halfPeriod);
        const wmaFull = calculateWMA(data, period);

        if (wmaHalf === null || wmaFull === null) return null;

        // Hull MA formula: WMA(2*WMA(n/2) - WMA(n), sqrt(n))
        const rawHMA = 2 * wmaHalf - wmaFull;

        // For a complete HMA calculation, we should apply WMA to the raw HMA values
        // But for simplicity in real-time, we'll use the raw calculation
        return rawHMA;
    };

    // Convert tick data to candles for better trend analysis
    const ticksToCandles = (ticks: Array<{ time: number, price: number }>, timeframeSeconds: number) => {
        if (ticks.length === 0) return [];

        const candles = [];
        const timeframeMsec = timeframeSeconds * 1000;

        // Group ticks into timeframe buckets
        const buckets = new Map();

        ticks.forEach(tick => {
            const bucketTime = Math.floor(tick.time / timeframeMsec) * timeframeMsec;
            if (!buckets.has(bucketTime)) {
                buckets.set(bucketTime, []);
            }
            buckets.get(bucketTime).push(tick.price);
        });

        // Convert buckets to OHLC candles
        Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).forEach(([time, prices]) => {
            if (prices.length > 0) {
                candles.push({
                    time,
                    open: prices[0],
                    high: Math.max(...prices),
                    low: Math.min(...prices),
                    close: prices[prices.length - 1]
                });
            }
        });

        return candles;
    };

    // Update Hull trends based on tick data with improved analysis
    const updateHullTrends = (newTickData: Array<{ time: number, price: number, close: number }>) => {
        const newTrends = { ...hullTrends };

        // Define timeframe periods in seconds
        const timeframes = {
            '15s': 15,
            '1m': 60,
            '5m': 300,
            '15m': 900
        };

        Object.entries(timeframes).forEach(([timeframe, seconds]) => {
            // Convert ticks to candles for this timeframe
            const candles = ticksToCandles(newTickData, seconds);

            if (candles.length >= 20) { // Need enough candles for meaningful HMA
                const closePrices = candles.map(candle => candle.close);
                const hmaValue = calculateHMA(closePrices, Math.min(14, closePrices.length));

                if (hmaValue !== null && candles.length >= 3) {
                    const currentCandle = candles[candles.length - 1];
                    const previousCandle = candles[candles.length - 2];
                    const prevPrevCandle = candles[candles.length - 3];

                    let trend = 'NEUTRAL';

                    // Enhanced trend detection using HMA and price action
                    const hmaSlope = hmaValue - calculateHMA(closePrices.slice(0, -1), Math.min(14, closePrices.length - 1));
                    const priceAboveHMA = currentCandle.close > hmaValue;
                    const risingPrices = currentCandle.close > previousCandle.close && previousCandle.close > prevPrevCandle.close;
                    const fallingPrices = currentCandle.close < previousCandle.close && previousCandle.close < prevPrevCandle.close;

                    if (hmaSlope > 0 && priceAboveHMA && risingPrices) {
                        trend = 'BULLISH';
                    } else if (hmaSlope < 0 && !priceAboveHMA && fallingPrices) {
                        trend = 'BEARISH';
                    } else if (hmaSlope > 0 && priceAboveHMA) {
                        trend = 'BULLISH';
                    } else if (hmaSlope < 0 && !priceAboveHMA) {
                        trend = 'BEARISH';
                    }

                    newTrends[timeframe as keyof typeof hullTrends] = {
                        trend,
                        value: Number(hmaValue.toFixed(5))
                    };
                }
            }
        });

        setHullTrends(newTrends);
    };

    // --- Core Trading Logic ---

    // Effect to initialize API connection and fetch active symbols
    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;
        const init = async () => {
            try {
                // Fetch active symbols (volatility indices)
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;
                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);
                if (!symbol && syn[0]?.symbol) setSymbol(syn[0].symbol);

                // Load historical data for all volatility indices for better Hull MA analysis
                await loadAllVolatilitiesHistoricalData(syn);

                if (syn[0]?.symbol) startTicks(syn[0].symbol);
            } catch (e: any) {
                // eslint-disable-next-line no-console
                console.error('SmartTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
            }
        };
        init();

        return () => {
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
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Effect to use pre-loaded historical data when trade type changes to Higher/Lower
    useEffect(() => {
        if ((tradeType === 'CALL' || tradeType === 'PUT') && symbol) {
            // Use pre-loaded historical data if available
            if (allVolatilitiesData[symbol] && allVolatilitiesData[symbol].length > 0) {
                setTickData(allVolatilitiesData[symbol]);
                updateHullTrends(allVolatilitiesData[symbol]);
                console.log(`Using pre-loaded data for ${symbol}: ${allVolatilitiesData[symbol].length} ticks`);
            } else if (apiRef.current) {
                // Fallback to fetching if not pre-loaded
                fetchHistoricalTicks(symbol);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tradeType, symbol, allVolatilitiesData]);

    // Update initial stake when stake input changes
    useEffect(() => {
        setInitialStake(stake);
        setCurrentStake(stake);
    }, [stake]);


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
            // Sync Smart Trader auth state into shared ClientStore so Transactions store keys correctly by account
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

        try {
            // Use pre-loaded historical data for Hull Moving Average analysis if available
            if (tradeType === 'CALL' || tradeType === 'PUT') {
                if (allVolatilitiesData[sym] && allVolatilitiesData[sym].length > 0) {
                    setTickData(allVolatilitiesData[sym]);
                    updateHullTrends(allVolatilitiesData[sym]);
                } else {
                    await fetchHistoricalTicks(sym);
                }
            }

            // Then start live tick subscription
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            // Listen for streaming ticks on the raw websocket
            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const digit = Number(String(quote).slice(-1));
                        const tickTime = data.tick.epoch * 1000; // Use server time
                        setTickHistory(prev => [...prev.slice(-500), { time: tickTime, price: quote }]); // Keep last 500 ticks for tick history

                        setLastDigit(digit);
                        setDigits(prev => [...prev.slice(-8), digit]);
                        setTicksProcessed(prev => prev + 1);

                        // Update tick data for Hull Moving Average analysis
                        setTickData(prev => {
                            const newTickData = [...prev, {
                                time: tickTime,
                                price: quote,
                                close: quote
                            }];

                            // Keep only last 2000 ticks to prevent memory issues
                            const trimmedData = newTickData.slice(-2000);

                            // Update Hull trends for Higher/Lower trades
                            if (tradeType === 'CALL' || tradeType === 'PUT') {
                                updateHullTrends(trimmedData);
                            }

                            return trimmedData;
                        });
                    }
                    if (data?.forget?.id && data?.forget?.id === tickStreamIdRef.current) {
                        // stopped
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('startTicks error', e);
        }
    };

    const purchaseOnceWithStake = async (stakeAmount: number) => {
        await authorizeIfNeeded();

        const trade_option: any = {
            amount: Number(stakeAmount),
            basis: 'stake',
            contractTypes: [tradeType],
            currency: account_currency,
            duration: durationType === 't' ? Number(ticks) : Number(duration),
            duration_unit: durationType,
            symbol,
        };
        // Choose prediction based on trade type and last outcome
        if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
            trade_option.prediction = Number(lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss);
        } else if (tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') {
            trade_option.prediction = Number(mdPrediction);
        } else if (tradeType === 'CALL' || tradeType === 'PUT') {
            trade_option.barrier = barrier;
        }

        const buy_req = tradeOptionToBuy(tradeType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;
        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stakeAmount}`);
        return buy;
    };

    const onRun = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1); // Transactions tab index in run panel tabs
        run_panel.run_id = `smart-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            let currentLossStreak = 0;
            let step = 0;

            while (!stopFlagRef.current) {
                // Calculate Martingale stake
                // Ensure the stake does not exceed the maximum allowed multiplier
                const effectiveStake = step > 0 ?
                    Number((initialStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) :
                    initialStake;
                const cappedStake = Math.min(effectiveStake, initialStake * maxMartingaleMultiplier);


                const isOU = tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER';
                if (isOU) {
                    lastOutcomeWasLossRef.current = currentLossStreak > 0;
                }

                // Update UI stake display
                setCurrentStake(cappedStake);
                setLossStreak(currentLossStreak);

                const buy = await purchaseOnceWithStake(cappedStake);

                // Seed an initial transaction row immediately so the UI shows a live row like Bot Builder
                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: tradeType as any,
                        underlying: symbol,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}

                // Reflect stage immediately after successful buy
                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                // subscribe to contract updates for this purchase and push to transactions
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

                    // Push initial snapshot if present in the first response
                    if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                        transactions.onBotContractEvent(pocInit);
                        run_panel.setHasOpenContract(true);
                    }

                    // Listen for subsequent streaming updates
                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const data = JSON.parse(evt.data as any);
                            if (data?.msg_type === 'proposal_open_contract') {
                                const poc = data.proposal_open_contract;
                                // capture subscription id for later forget
                                if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                                if (String(poc?.contract_id || '') === targetId) {
                                    transactions.onBotContractEvent(poc);
                                    run_panel.setHasOpenContract(true);

                                    // Update contract tracking values
                                    setCurrentProfit(Number(poc?.profit || 0));
                                    setContractValue(Number(poc?.bid_price || 0));
                                    setPotentialPayout(Number(poc?.payout || 0));

                                    // Calculate remaining time
                                    if (poc?.date_expiry && !poc?.is_sold) {
                                        const now = Math.floor(Date.now() / 1000);
                                        const expiry = Number(poc.date_expiry);
                                        const remaining = Math.max(0, expiry - now);
                                        const hours = Math.floor(remaining / 3600);
                                        const minutes = Math.floor((remaining % 3600) / 60);
                                        const seconds = remaining % 60;
                                        setContractDuration(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                                    }

                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);

                                        const profit = Number(poc?.profit || 0);
                                        const isWin = profit > 0;

                                        // Update trading statistics
                                        setTotalTrades(prev => prev + 1);
                                        setTotalProfit(prev => prev + profit);

                                        if (isWin) {
                                            // Reset Martingale on win
                                            lastOutcomeWasLossRef.current = false;
                                            currentLossStreak = 0;
                                            step = 0;
                                            setLastTradeResult('win');
                                            setCurrentStake(initialStake);
                                        } else {
                                            // Apply Martingale on loss
                                            lastOutcomeWasLossRef.current = true;
                                            currentLossStreak++;
                                            // Ensure step does not exceed maxMartingaleMultiplier - 1
                                            step = Math.min(step + 1, maxMartingaleMultiplier - 1);
                                            setLastTradeResult('loss');
                                        }

                                        // Update win rate
                                        setWinRate(prev => {
                                            const newTotal = totalTrades + 1;
                                            const totalWins = isWin ? Math.round(prev * totalTrades) + 1 : Math.round(prev * totalTrades);
                                            return totalWins / newTotal;
                                        });

                                        // Reset contract values
                                        setCurrentProfit(0);
                                        setContractValue(0);
                                        setPotentialPayout(0);
                                        setContractDuration('00:00:00');
                                    }
                                }
                            }
                        } catch {
                            // noop
                        }
                    };
                    apiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    // eslint-disable-next-line no-console
                    console.error('subscribe poc error', subErr);
                }

                // Wait minimally between purchases: we'll wait for ticks duration completion by polling poc completion
                // Simple delay to prevent spamming if API rejects immediate buy loop
                await new Promise(res => setTimeout(res, 500));
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('SmartTrader run loop error', e);
            const msg = e?.message || e?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);

        }
    };

    // --- Stop Trading Logic ---
    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        setIsTrading(false);
        // Cleanup live ticks
        stopTicks();
        // Update Run Panel state
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');
    };

    // Listen for Run Panel stop events
    useEffect(() => {
        const handleRunPanelStop = () => {
            if (is_running) { // Only stop if currently trading
                stopTrading();
            }
        };

        // Register listener for Run Panel stop button
        // Ensure run_panel and its observer are available before registering
        if (run_panel?.dbot?.observer) {
            run_panel.dbot.observer.register('bot.stop', handleRunPanelStop);
            run_panel.dbot.observer.register('bot.click_stop', handleRunPanelStop);
        }

        return () => {
            // Cleanup listeners if they were registered
            if (run_panel?.dbot?.observer) {
                run_panel.dbot.observer.unregisterAll('bot.stop');
                run_panel.dbot.observer.unregisterAll('bot.click_stop');
            }
        };
        // Depend on is_running and run_panel to ensure correct listener attachment/detachment
    }, [is_running, run_panel]);


    // --- Start Trading Logic ---
    const startTrading = () => {
        if (!apiRef.current) { // Check if API is initialized
            setStatus('Please connect to API first');
            return;
        }

        // Reset statistics for new session
        setTotalTrades(0);
        setTotalProfit(0);
        setWinRate(0);
        setLossStreak(0);
        setLastTradeResult(null);
        setCurrentStake(initialStake);

        setIsTrading(true);
        // Call the actual trading logic
        onRun();
    };

    const applyMartingaleStrategy = (isWin: boolean) => {
        if (isWin) {
            // Reset to initial stake after a win
            setCurrentStake(initialStake);
            setLastTradeResult('win');
        } else {
            // Apply martingale multiplier after a loss
            // Ensure the stake does not exceed the maximum allowed multiplier
            const nextStake = Math.round((currentStake * martingaleMultiplier) * 100) / 100;
            setCurrentStake(Math.min(nextStake, initialStake * maxMartingaleMultiplier));
            setLastTradeResult('loss');
        }
    };

    const trackContract = (contractId: string) => {
        const checkResult = async () => {
            try {
                const result = await apiRef.current.send({ // Use apiRef.current.send
                    proposal_open_contract: 1,
                    contract_id: contractId
                });

                if (result.proposal_open_contract && result.proposal_open_contract.is_sold) {
                    const profit = result.proposal_open_contract.profit;
                    const isWin = profit > 0;

                    setContracts(prev => prev.map(contract =>
                        contract.id === contractId
                            ? { ...contract, profit, status: isWin ? 'won' : 'lost' }
                            : contract
                    ));

                    setTotalProfit(prev => prev + profit);
                    setTotalTrades(prev => prev + 1);

                    // Update win rate
                    setWinRate(prev => {
                        const newTotal = totalTrades + 1;
                        const wins = isWin ? 1 : 0;
                        return ((prev * totalTrades) + wins) / newTotal;
                    });

                    // Update streak
                    setCurrentStreak(prev => isWin ? prev + 1 : 0);

                    // Apply Martingale strategy
                    applyMartingaleStrategy(isWin);
                } else {
                    setTimeout(checkResult, 1000);
                }
            } catch (error) {
                console.error('Error tracking contract:', error);
                setTimeout(checkResult, 2000);
            }
        };

        checkResult();
    };


    return (
        <div className='smart-trader'>
            <div className='smart-trader__container'>

                <div className='smart-trader__content'>
                    <div className='smart-trader__card'>
                        <div className='smart-trader__row smart-trader__row--two'>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-symbol'>{localize('Volatility')}</label>
                                <select
                                    id='st-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);

                                        // Use pre-loaded historical data if available
                                        if (allVolatilitiesData[v] && (tradeType === 'CALL' || tradeType === 'PUT')) {
                                            setTickData(allVolatilitiesData[v]);
                                            updateHullTrends(allVolatilitiesData[v]);
                                        }

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
                                <label htmlFor='st-tradeType'>{localize('Trade type')}</label>
                                <select
                                    id='st-tradeType'
                                    value={tradeType}
                                    onChange={e => setTradeType(e.target.value)}
                                >
                                    {TRADE_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Duration Controls */}
                        <div className='smart-trader__row smart-trader__row--two'>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-duration-type'>{localize('Duration Type')}</label>
                                <select
                                    id='st-duration-type'
                                    value={durationType}
                                    onChange={e => setDurationType(e.target.value)}
                                >
                                    <option value='t'>{localize('Ticks')}</option>
                                    <option value='s'>{localize('Seconds')}</option>
                                    <option value='m'>{localize('Minutes')}</option>
                                </select>
                            </div>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-duration'>{localize('Duration')}</label>
                                {durationType === 't' ? (
                                    <input
                                        id='st-duration'
                                        type='number'
                                        min={1}
                                        max={10}
                                        value={ticks}
                                        onChange={e => setTicks(Number(e.target.value))}
                                    />
                                ) : (
                                    <input
                                        id='st-duration'
                                        type='number'
                                        min={durationType === 's' ? 15 : 1}
                                        max={durationType === 's' ? 86400 : 1440}
                                        value={duration}
                                        onChange={e => setDuration(Number(e.target.value))}
                                    />
                                )}
                            </div>
                        </div>

                        <div className='smart-trader__row smart-trader__row--compact'>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-stake'>{localize('Initial Stake (USD)')}</label>
                                <input id='st-stake' type='number' min={0.35} step='0.01' value={stake}
                                    onChange={e => setStake(Math.max(0.35, Number(e.target.value)))} />
                                {currentStake !== initialStake && (
                                    <small style={{color: '#ff6444'}}>
                                        Current stake: ${currentStake} (Martingale applied)
                                    </small>
                                )}
                            </div>

                            {/* Strategy controls */}
                            {(tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') ? (
                                <div className='smart-trader__row smart-trader__row--two'>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-md-pred'>{localize('Match/Diff prediction digit')}</label>
                                        <input id='st-md-pred' type='number' min={0} max={9} value={mdPrediction}
                                            onChange={e => { const v = Math.max(0, Math.min(9, Number(e.target.value))); setMdPrediction(v); }} />
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-martingale-md'>{localize('Martingale multiplier')}</label>
                                        <input id='st-martingale-md' type='number' min={1} max={maxMartingaleMultiplier} step='0.1' value={martingaleMultiplier}
                                            onChange={e => setMartingaleMultiplier(Math.max(1, Math.min(maxMartingaleMultiplier, Number(e.target.value))))} />
                                        <small style={{color: '#999'}}>
                                            Multiplier applied to stake after each loss. Resets to initial stake after a win.
                                        </small>
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-max-martingale-md'>{localize('Maximum martingale multiplier')}</label>
                                        <input id='st-max-martingale-md' type='number' min={1} max={4} step='0.1' value={maxMartingaleMultiplier}
                                            onChange={e => {
                                                const newMax = Math.max(1, Math.min(4, Number(e.target.value)));
                                                setMaxMartingaleMultiplier(newMax);
                                                // Ensure current multiplier doesn't exceed new max
                                                if (martingaleMultiplier > newMax) {
                                                    setMartingaleMultiplier(newMax);
                                                }
                                            }} />
                                        <small style={{color: '#999'}}>
                                            Maximum allowed multiplier value (capped at 4x).
                                        </small>
                                    </div>
                                </div>
                            ) : (tradeType !== 'CALL' && tradeType !== 'PUT') ? (
                                <div className='smart-trader__row smart-trader__row--compact'>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-ou-pred-pre'>{localize('Over/Under prediction (pre-loss)')}</label>
                                        <input id='st-ou-pred-pre' type='number' min={0} max={9} value={ouPredPreLoss}
                                            onChange={e => setOuPredPreLoss(Math.max(0, Math.min(9, Number(e.target.value))))} />
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-ou-pred-post'>{localize('Over/Under prediction (after loss)')}</label>
                                        <input id='st-ou-pred-post' type='number' min={0} max={9} value={ouPredPostLoss}
                                            onChange={e => setOuPredPostLoss(Math.max(0, Math.min(9, Number(e.target.value))))} />
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-martingale'>{localize('Martingale multiplier')}</label>
                                        <input id='st-martingale' type='number' min={1} max={maxMartingaleMultiplier} step='0.1' value={martingaleMultiplier}
                                            onChange={e => setMartingaleMultiplier(Math.max(1, Math.min(maxMartingaleMultiplier, Number(e.target.value))))} />
                                        <small style={{color: '#999'}}>
                                            Multiplier applied to stake after each loss. Resets to initial stake after a win.
                                        </small>
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-max-martingale'>{localize('Maximum martingale multiplier')}</label>
                                        <input id='st-max-martingale' type='number' min={1} max={4} step='0.1' value={maxMartingaleMultiplier}
                                            onChange={e => {
                                                const newMax = Math.max(1, Math.min(4, Number(e.target.value)));
                                                setMaxMartingaleMultiplier(newMax);
                                                // Ensure current multiplier doesn't exceed new max
                                                if (martingaleMultiplier > newMax) {
                                                    setMartingaleMultiplier(newMax);
                                                }
                                            }} />
                                        <small style={{color: '#999'}}>
                                            Maximum allowed multiplier value (capped at 4x).
                                        </small>
                                    </div>
                                </div>
                            ) : null}

                        </div>

                        {/* Higher/Lower Barrier Controls */}
                        {(tradeType === 'CALL' || tradeType === 'PUT') && (
                            <div className='smart-trader__row smart-trader__row--two'>
                                <div className='smart-trader__field'>
                                    <label htmlFor='st-barrier'>{localize('Barrier')}</label>
                                    <input
                                        id='st-barrier'
                                        type='text'
                                        value={barrier}
                                        onChange={e => setBarrier(e.target.value)}
                                        placeholder='+0.37'
                                    />
                                </div>
                                <div className='smart-trader__field'>
                                    <label htmlFor='st-martingale-hl'>{localize('Martingale multiplier')}</label>
                                    <input
                                        id='st-martingale-hl'
                                        type='number'
                                        min={1}
                                        max={maxMartingaleMultiplier}
                                        step='0.1'
                                        value={martingaleMultiplier}
                                        onChange={e => setMartingaleMultiplier(Math.max(1, Math.min(maxMartingaleMultiplier, Number(e.target.value))))}
                                    />
                                    <small style={{color: '#999'}}>
                                        Multiplier applied to stake after each loss. Resets to initial stake after a win.
                                    </small>
                                </div>
                                <div className='smart-trader__field'>
                                    <label htmlFor='st-max-martingale-hl'>{localize('Maximum martingale multiplier')}</label>
                                    <input
                                        id='st-max-martingale-hl'
                                        type='number'
                                        min={1}
                                        max={4}
                                        step='0.1'
                                        value={maxMartingaleMultiplier}
                                        onChange={e => {
                                            const newMax = Math.max(1, Math.min(4, Number(e.target.value)));
                                            setMaxMartingaleMultiplier(newMax);
                                            // Ensure current multiplier doesn't exceed new max
                                            if (martingaleMultiplier > newMax) {
                                                setMartingaleMultiplier(newMax);
                                            }
                                        }} />
                                    <small style={{color: '#999'}}>
                                        Maximum allowed multiplier value (capped at 4x).
                                    </small>
                                </div>
                            </div>
                        )}

                        {/* Hull Moving Average Trend Analysis for Higher/Lower */}
                        {(tradeType === 'CALL' || tradeType === 'PUT') && (
                            <div className='smart-trader__hull-trends'>
                                <div className='smart-trader__trends-header'>
                                    <Text size='s' weight='bold'>{localize('Hull MA Trend Analysis')}</Text>
                                </div>
                                <div className='smart-trader__trends-grid'>
                                    {Object.entries(hullTrends).map(([timeframe, data]) => (
                                        <div key={timeframe} className='smart-trader__trend-item'>
                                            <div className='smart-trader__timeframe'>
                                                <Text size='xs' color='general'>{timeframe}</Text>
                                            </div>
                                            <div className={`smart-trader__trend-badge ${data.trend.toLowerCase()}`}>
                                                <Text size='xs' weight='bold' color='prominent'>
                                                    {data.trend === 'BULLISH' ? '📈 BULLISH' :
                                                     data.trend === 'BEARISH' ? '📉 BEARISH' :
                                                     '➡️ NEUTRAL'}
                                                </Text>
                                            </div>
                                            <div className='smart-trader__trend-value'>
                                                <Text size='xs' color='general'>
                                                    {data.value.toFixed(5)}
                                                </Text>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Open Position Display for Higher/Lower */}
                        {(tradeType === 'CALL' || tradeType === 'PUT') && run_panel.hasOpenContract && (
                            <div className='smart-trader__open-position'>
                                <div className='smart-trader__position-header'>
                                    <Text size='s' weight='bold'>{localize('Open positions')}</Text>
                                </div>
                                <div className='smart-trader__position-card'>
                                    <div className='smart-trader__position-info'>
                                        <div className='smart-trader__symbol-info'>
                                            <Text size='xs' color='general'>
                                                {symbols.find(s => s.symbol === symbol)?.display_name || symbol}
                                            </Text>
                                            <div className='smart-trader__trade-direction'>
                                                <span className={`smart-trader__direction-badge ${tradeType === 'CALL' ? 'higher' : 'lower'}`}>
                                                    {tradeType === 'CALL' ? 'Higher' : 'Lower'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className='smart-trader__duration-display'>
                                            <Text size='xs' color='general'>{contractDuration}</Text>
                                        </div>
                                        <div className='smart-trader__contract-values'>
                                            <div className='smart-trader__value-row'>
                                                <div className='smart-trader__value-item'>
                                                    <Text size='xs' color='general'>{localize('Total profit/loss:')}</Text>
                                                    <Text size='xs' color={currentProfit >= 0 ? 'profit-success' : 'loss-danger'}>
                                                        {currentProfit >= 0 ? '+' : ''}{currentProfit.toFixed(2)}
                                                    </Text>
                                                </div>
                                                <div className='smart-trader__value-item'>
                                                    <Text size='xs' color='general'>{localize('Contract value:')}</Text>
                                                    <Text size='xs' color='prominent'>
                                                        {contractValue.toFixed(2)}
                                                    </Text>
                                                </div>
                                            </div>
                                            <div className='smart-trader__value-row'>
                                                <div className='smart-trader__value-item'>
                                                    <Text size='xs' color='general'>{localize('Stake:')}</Text>
                                                    <Text size='xs' color='prominent'>{stake.toFixed(2)}</Text>
                                                </div>
                                                <div className='smart-trader__value-item'>
                                                    <Text size='xs' color='general'>{localize('Potential payout:')}</Text>
                                                    <Text size='xs' color='prominent'>{potentialPayout.toFixed(2)}</Text>
                                                </div>
                                            </div>
                                        </div>
                                        <button className='smart-trader__sell-button'>
                                            {localize('Sell')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {(tradeType !== 'CALL' && tradeType !== 'PUT') && (
                            <div className='smart-trader__digits'>
                                {digits.map((d, idx) => (
                                    <div
                                        key={`${idx}-${d}`}
                                        className={`smart-trader__digit ${d === lastDigit ? 'is-current' : ''} ${getHintClass(d)}`}
                                    >
                                        {d}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Martingale Statistics */}
                        {(totalTrades > 0 || is_running) && (
                            <div className='smart-trader__stats'>
                                <div className='smart-trader__stats-header'>
                                    <Text size='s' weight='bold'>{localize('Trading Statistics')}</Text>
                                </div>
                                <div className='smart-trader__stats-grid'>
                                    <div className='smart-trader__stat-item'>
                                        <Text size='xs' color='general'>{localize('Total Trades:')}</Text>
                                        <Text size='xs' color='prominent'>{totalTrades}</Text>
                                    </div>
                                    <div className='smart-trader__stat-item'>
                                        <Text size='xs' color='general'>{localize('Win Rate:')}</Text>
                                        <Text size='xs' color='prominent'>{(winRate * 100).toFixed(1)}%</Text>
                                    </div>
                                    <div className='smart-trader__stat-item'>
                                        <Text size='xs' color='general'>{localize('Loss Streak:')}</Text>
                                        <Text size='xs' color={lossStreak > 2 ? 'loss-danger' : 'prominent'}>{lossStreak}</Text>
                                    </div>
                                    <div className='smart-trader__stat-item'>
                                        <Text size='xs' color='general'>{localize('Total P&L:')}</Text>
                                        <Text size='xs' color={totalProfit >= 0 ? 'profit-success' : 'loss-danger'}>
                                            {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} {account_currency}
                                        </Text>
                                    </div>
                                    <div className='smart-trader__stat-item'>
                                        <Text size='xs' color='general'>{localize('Next Stake:')}</Text>
                                        <Text size='xs' color={currentStake > initialStake ? 'loss-danger' : 'prominent'}>
                                            {currentStake.toFixed(2)} {account_currency}
                                        </Text>
                                    </div>
                                    <div className='smart-trader__stat-item'>
                                        <Text size='xs' color='general'>{localize('Multiplier:')}</Text>
                                        <Text size='xs' color='prominent'>{martingaleMultiplier}x</Text>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className='smart-trader__meta'>
                            <Text size='xs' color='general'>
                                {localize('Ticks Processed:')} {ticksProcessed}
                            </Text>
                            {(tradeType !== 'CALL' && tradeType !== 'PUT') && (
                                <Text size='xs' color='general'>
                                    {localize('Last Digit:')} {lastDigit ?? '-'}
                                </Text>
                            )}
                            {(tradeType === 'CALL' || tradeType === 'PUT') && (
                                <div className='smart-trader__hl-meta'>
                                    <Text size='xs' color='general'>
                                        {localize('Barrier:')} {barrier}
                                    </Text>
                                    <Text size='xs' color='general'>
                                        {localize('Duration:')} {durationType === 't' ? `${ticks} ${localize('ticks')}` : `${duration} ${durationType === 's' ? localize('seconds') : localize('minutes')}`}
                                    </Text>
                                </div>
                            )}
                        </div>

                        <div className='smart-trader__actions'>
                            <button
                                className='smart-trader__run'
                                onClick={startTrading}
                                disabled={is_running || !symbol || !apiRef.current}
                            >
                                {is_running ? localize('Running...') : localize('Start Trading')}
                            </button>
                            {is_running && (
                                <button className='smart-trader__stop' onClick={stopTrading}>
                                    {localize('Stop')}
                                </button>
                            )}
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
        </div>
    );
});

export default SmartTrader;