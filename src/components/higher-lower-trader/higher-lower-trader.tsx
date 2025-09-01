import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './higher-lower-trader.scss';

// Volatility indices for Higher/Lower trading
const VOLATILITY_INDICES = [
  { value: 'R_10', label: 'Volatility 10 (1s) Index' },
  { value: 'R_25', label: 'Volatility 25 (1s) Index' },
  { value: 'R_50', label: 'Volatility 50 (1s) Index' },
  { value: 'R_75', label: 'Volatility 75 (1s) Index' },
  { value: 'R_100', label: 'Volatility 100 (1s) Index' },
  { value: 'BOOM500', label: 'Boom 500 Index' },
  { value: 'BOOM1000', label: 'Boom 1000 Index' },
  { value: 'CRASH500', label: 'Crash 500 Index' },
  { value: 'CRASH1000', label: 'Crash 1000 Index' },
  { value: 'stpRNG', label: 'Step Index' },
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
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }
    return buy;
};

const HigherLowerTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions, client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state - Higher/Lower specific
    const [symbol, setSymbol] = useState<string>('');
    const [contractType, setContractType] = useState<string>('CALL'); // CALL for Higher, PUT for Lower
    const [duration, setDuration] = useState<number>(60); // Duration in seconds
    const [durationType, setDurationType] = useState<string>('s'); // 's' for seconds, 'm' for minutes
    const [stake, setStake] = useState<number>(1.0);
    const [baseStake, setBaseStake] = useState<number>(1.0);
    const [barrier, setBarrier] = useState<string>('+0.37');

    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(2.0);
    const [useStopOnProfit, setUseStopOnProfit] = useState<boolean>(false);
    const [targetProfit, setTargetProfit] = useState<number>(10.0);

    // Contract tracking state
    const [currentProfit, setCurrentProfit] = useState<number>(0);
    const [contractValue, setContractValue] = useState<number>(0);
    const [potentialPayout, setPotentialPayout] = useState<number>(0);
    const [contractDuration, setContractDuration] = useState<string>('00:00:00');

    // Live price state
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Hull Moving Average trend analysis state
    const [hullTrends, setHullTrends] = useState({
        '15s': { trend: 'NEUTRAL', value: 0, confirmationCount: 0 },
        '1m': { trend: 'NEUTRAL', value: 0, confirmationCount: 0 },
        '5m': { trend: 'NEUTRAL', value: 0, confirmationCount: 0 },
        '15m': { trend: 'NEUTRAL', value: 0, confirmationCount: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);
    const lastOutcomeWasLossRef = useRef(false);

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    // --- Helper Functions ---

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

        const wmaHalf = calculateWMA(data, halfPeriod);
        const wmaFull = calculateWMA(data, period);

        if (wmaHalf === null || wmaFull === null) return null;

        const rawHMA = 2 * wmaHalf - wmaFull;
        return rawHMA;
    };

    // Advanced EMA calculation for multiple timeframes
    const calculateEMA = (data: number[], period: number) => {
        if (data.length === 0) return null;
        
        const k = 2 / (period + 1);
        let ema = data[0];
        
        for (let i = 1; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
        }
        
        return ema;
    };

    // MACD calculation for momentum analysis
    const calculateMACD = (data: number[], fast = 12, slow = 26, signal = 9) => {
        if (data.length < slow) return null;

        const fastEMA = calculateEMA(data, fast);
        const slowEMA = calculateEMA(data, slow);
        
        if (fastEMA === null || slowEMA === null) return null;
        
        const macdLine = fastEMA - slowEMA;
        
        // Calculate signal line (EMA of MACD)
        const macdHistory = [];
        for (let i = slow - 1; i < data.length; i++) {
            const subset = data.slice(0, i + 1);
            const fEMA = calculateEMA(subset, fast);
            const sEMA = calculateEMA(subset, slow);
            if (fEMA && sEMA) {
                macdHistory.push(fEMA - sEMA);
            }
        }
        
        const signalLine = calculateEMA(macdHistory, signal);
        const histogram = signalLine ? macdLine - signalLine : 0;
        
        return { macdLine, signalLine, histogram };
    };

    // Enhanced trend strength calculation
    const calculateTrendStrength = (prices: number[], period = 20) => {
        if (prices.length < period) return 0;
        
        const recentPrices = prices.slice(-period);
        const firstPrice = recentPrices[0];
        const lastPrice = recentPrices[recentPrices.length - 1];
        
        // Calculate price movement as percentage
        const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
        
        // Calculate volatility (standard deviation)
        const mean = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
        const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / recentPrices.length;
        const volatility = Math.sqrt(variance);
        
        // Trend strength = price change / volatility (normalized)
        const strength = Math.abs(priceChange) / (volatility / mean * 100);
        
        return Math.min(strength * 10, 100); // Scale to 0-100
    };

    // Advanced market momentum detection
    const detectMarketMomentum = (prices: number[], period = 14) => {
        if (prices.length < period * 2) return 'NEUTRAL';
        
        const recent = prices.slice(-period);
        const previous = prices.slice(-period * 2, -period);
        
        const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
        const previousAvg = previous.reduce((sum, p) => sum + p, 0) / previous.length;
        
        const recentVolatility = Math.sqrt(recent.reduce((sum, p) => sum + Math.pow(p - recentAvg, 2), 0) / recent.length);
        const previousVolatility = Math.sqrt(previous.reduce((sum, p) => sum + Math.pow(p - previousAvg, 2), 0) / previous.length);
        
        const volatilityChange = (recentVolatility - previousVolatility) / previousVolatility;
        
        if (volatilityChange > 0.1) return 'ACCELERATING';
        if (volatilityChange < -0.1) return 'DECELERATING';
        return 'NEUTRAL';
    };

    // Hybrid trend determination combining multiple indicators
    const getHybridTrend = (prices: number[]) => {
        if (prices.length < 50) return 'NEUTRAL';
        
        const hma21 = calculateHMA(prices, 21);
        const ema12 = calculateEMA(prices, 12);
        const ema26 = calculateEMA(prices, 26);
        const macd = calculateMACD(prices, 12, 26, 9);
        
        if (!hma21 || !ema12 || !ema26 || !macd) return 'NEUTRAL';
        
        const currentPrice = prices[prices.length - 1];
        const previousPrice = prices[prices.length - 2];
        
        // Scoring system for trend determination
        let bullishScore = 0;
        let bearishScore = 0;
        
        // HMA trend
        if (currentPrice > hma21) bullishScore += 2;
        else bearishScore += 2;
        
        // EMA crossover
        if (ema12 > ema26) bullishScore += 2;
        else bearishScore += 2;
        
        // MACD signals
        if (macd.macdLine > macd.signalLine) bullishScore += 1;
        else bearishScore += 1;
        
        if (macd.histogram > 0) bullishScore += 1;
        else bearishScore += 1;
        
        // Price momentum
        if (currentPrice > previousPrice) bullishScore += 1;
        else bearishScore += 1;
        
        // Recent price action (last 5 ticks)
        const recentPrices = prices.slice(-5);
        const upMoves = recentPrices.filter((price, i) => i > 0 && price > recentPrices[i - 1]).length;
        
        if (upMoves >= 3) bullishScore += 1;
        else if (upMoves <= 1) bearishScore += 1;
        
        // Determine trend with confidence threshold
        const scoreDifference = Math.abs(bullishScore - bearishScore);
        
        if (scoreDifference >= 3) {
            return bullishScore > bearishScore ? 'BULLISH' : 'BEARISH';
        }
        
        return 'NEUTRAL';
    };

    // Convert tick data to candles for better trend analysis
    const ticksToCandles = (ticks: Array<{ time: number, price: number }>, timeframeSeconds: number) => {
        if (ticks.length === 0) return [];

        const candles = [];
        const timeframeMsec = timeframeSeconds * 1000;
        const buckets = new Map();

        ticks.forEach(tick => {
            const bucketTime = Math.floor(tick.time / timeframeMsec) * timeframeMsec;
            if (!buckets.has(bucketTime)) {
                buckets.set(bucketTime, []);
            }
            buckets.get(bucketTime).push(tick.price);
        });

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

    // Enhanced trend analysis with hybrid methodology
    const updateHullTrends = (newTickData: Array<{ time: number, price: number, close: number }>) => {
        const newTrends = { ...hullTrends };
        const tickPrices = newTickData.map(tick => tick.price);

        // Calculate trend strength and momentum
        const strength = calculateTrendStrength(tickPrices);
        const momentum = detectMarketMomentum(tickPrices);
        
        setTrendStrength(strength);
        setMarketMomentum(momentum);

        // Define tick count requirements for different timeframe analysis
        const timeframeTickCounts = {
            '15s': 600,   // 600 ticks for 15-second analysis
            '1m': 1000,   // 1000 ticks for 1-minute analysis
            '5m': 2000,   // 2000 ticks for 5-minute analysis
            '15m': 4500   // 4500 ticks for 15-minute analysis
        };

        Object.entries(timeframeTickCounts).forEach(([timeframe, tickCount]) => {
            // Use the most recent ticks for this timeframe
            const recentTicks = newTickData.slice(-tickCount);

            if (recentTicks.length >= Math.min(50, tickCount)) { // Minimum 50 ticks required
                const tickPrices = recentTicks.map(tick => tick.price);
                let trend = 'NEUTRAL';

                // Apply selected trend method
                if (trendMethod === 'HULL') {
                    const hmaPeriods = {
                        '15s': Math.min(50, Math.floor(tickPrices.length * 0.4)),
                        '1m': Math.min(80, Math.floor(tickPrices.length * 0.5)),
                        '5m': Math.min(120, Math.floor(tickPrices.length * 0.6)),
                        '15m': Math.min(200, Math.floor(tickPrices.length * 0.7))
                    };

                    const hmaPeriod = hmaPeriods[timeframe as keyof typeof hmaPeriods] || 14;
                    const hmaValue = calculateHMA(tickPrices, hmaPeriod);

                    if (hmaValue !== null && tickPrices.length >= 10) {
                        const prevHMA = calculateHMA(tickPrices.slice(0, -5), Math.min(hmaPeriod, tickPrices.length - 5));
                        const hmaSlope = prevHMA !== null ? hmaValue - prevHMA : 0;
                        const currentPrice = tickPrices[tickPrices.length - 1];
                        
                        const slopeThreshold = {
                            '15s': 0.00008,
                            '1m': 0.00015,
                            '5m': 0.0003,
                            '15m': 0.0006
                        }[timeframe] || 0.00015;

                        if (hmaSlope > slopeThreshold && currentPrice > hmaValue) {
                            trend = 'BULLISH';
                        } else if (hmaSlope < -slopeThreshold && currentPrice < hmaValue) {
                            trend = 'BEARISH';
                        }
                    }
                } else if (trendMethod === 'EMA') {
                    const emaFast = calculateEMA(tickPrices, emaConfig.fast);
                    const emaSlow = calculateEMA(tickPrices, emaConfig.slow);
                    const macd = calculateMACD(tickPrices, emaConfig.fast, emaConfig.slow, emaConfig.signal);
                    
                    if (emaFast && emaSlow && macd) {
                        const currentPrice = tickPrices[tickPrices.length - 1];
                        
                        // EMA crossover with MACD confirmation
                        if (emaFast > emaSlow && macd.macdLine > macd.signalLine && currentPrice > emaFast) {
                            trend = 'BULLISH';
                        } else if (emaFast < emaSlow && macd.macdLine < macd.signalLine && currentPrice < emaFast) {
                            trend = 'BEARISH';
                        }
                    }
                } else if (trendMethod === 'HYBRID') {
                    trend = getHybridTrend(tickPrices);
                }

                // Enhanced trend persistence with market conditions
                const currentTrendData = hullTrends[timeframe as keyof typeof hullTrends];
                const baseConfirmations = {
                    '15s': 3,
                    '1m': 4,
                    '5m': 5,
                    '15m': 6
                }[timeframe] || 3;

                // Adjust confirmations based on market momentum
                const requiredConfirmations = momentum === 'ACCELERATING' ? 
                    Math.max(2, baseConfirmations - 1) : 
                    momentum === 'DECELERATING' ? baseConfirmations + 1 : baseConfirmations;

                let finalTrend = currentTrendData.trend;
                let confirmationCount = currentTrendData.confirmationCount || 0;

                if (trend === currentTrendData.trend) {
                    confirmationCount = Math.min(confirmationCount + 1, requiredConfirmations);
                    if (confirmationCount >= requiredConfirmations) {
                        finalTrend = trend;
                    }
                } else if (trend !== 'NEUTRAL') {
                    // New trend detected
                    if (strength > 50 && momentum === 'ACCELERATING') {
                        // Strong trend with acceleration - faster confirmation
                        finalTrend = trend;
                        confirmationCount = Math.min(2, requiredConfirmations);
                    } else {
                        confirmationCount = 1;
                    }
                } else {
                    confirmationCount = Math.max(0, confirmationCount - 1);
                    if (confirmationCount === 0) {
                        finalTrend = 'NEUTRAL';
                    }
                }

                newTrends[timeframe as keyof typeof hullTrends] = {
                    trend: finalTrend,
                    value: Number(tickPrices[tickPrices.length - 1].toFixed(5)),
                    confirmationCount
                };

                // Advanced logging for 15s timeframe
                if (timeframe === '15s') {
                    console.log(`Enhanced Trend Analysis - ${timeframe}:`, {
                        method: trendMethod,
                        trend: finalTrend,
                        strength: strength.toFixed(2),
                        momentum,
                        confirmations: confirmationCount,
                        required: requiredConfirmations,
                        tickCount: tickPrices.length
                    });
                }
            }
        });

        setHullTrends(newTrends);
    };

    // Fetch historical tick data for Hull Moving Average analysis
    const fetchHistoricalTicks = async (symbolToFetch: string) => {
        try {
            const request = {
                ticks_history: symbolToFetch,
                adjust_start_time: 1,
                count: 1000,
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
                    time: response.history.times[index] * 1000,
                    price: parseFloat(price),
                    close: parseFloat(price)
                }));

                setTickData(prev => {
                    const combinedData = [...historicalData, ...prev];
                    const uniqueData = combinedData.filter((tick, index, arr) =>
                        arr.findIndex(t => t.time === tick.time) === index
                    ).sort((a, b) => a.time - b.time);

                    const trimmedData = uniqueData.slice(-2000);
                    updateHullTrends(trimmedData);
                    return trimmedData;
                });
            }
        } catch (error) {
            console.error('Error fetching historical ticks:', error);
        }
    };

    // State to store preloaded data for all volatilities
    const [preloadedData, setPreloadedData] = useState<{[key: string]: Array<{ time: number, price: number, close: number }>}>({});
    const [isPreloading, setIsPreloading] = useState(false);

    // Enhanced trend analysis state
    const [trendMethod, setTrendMethod] = useState<'HULL' | 'EMA' | 'HYBRID'>('HYBRID');
    const [emaConfig, setEmaConfig] = useState({ fast: 12, slow: 26, signal: 9 });
    const [trendStrength, setTrendStrength] = useState(0);
    const [marketMomentum, setMarketMomentum] = useState<'ACCELERATING' | 'DECELERATING' | 'NEUTRAL'>('NEUTRAL');

    // Preload historical data for all volatility indices
    const preloadAllVolatilityData = async (api: any) => {
        setIsPreloading(true);
        setStatus('Preloading historical data for trend analysis...');

        const volatilitySymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'BOOM500', 'BOOM1000', 'CRASH500', 'CRASH1000', 'stpRNG'];
        const preloadedDataMap: {[key: string]: Array<{ time: number, price: number, close: number }>} = {};

        try {
            // Fetch 5000 ticks for each volatility index
            const promises = volatilitySymbols.map(async (sym) => {
                try {
                    const request = {
                        ticks_history: sym,
                        adjust_start_time: 1,
                        count: 5000, // Maximum allowed by Deriv
                        end: "latest",
                        start: 1,
                        style: "ticks"
                    };

                    const response = await api.send(request);

                    if (response.error) {
                        console.warn(`Error fetching data for ${sym}:`, response.error);
                        return;
                    }

                    if (response.history && response.history.prices && response.history.times) {
                        const historicalData = response.history.prices.map((price: string, index: number) => ({
                            time: response.history.times[index] * 1000,
                            price: parseFloat(price),
                            close: parseFloat(price)
                        }));

                        preloadedDataMap[sym] = historicalData;
                        console.log(`Preloaded ${historicalData.length} ticks for ${sym}`);
                    }
                } catch (error) {
                    console.warn(`Failed to preload data for ${sym}:`, error);
                }
            });

            await Promise.all(promises);
            setPreloadedData(preloadedDataMap);
            setStatus(`Preloaded historical data for ${Object.keys(preloadedDataMap).length} volatility indices`);
        } catch (error) {
            console.error('Error during preloading:', error);
            setStatus('Failed to preload some historical data, but continuing...');
        } finally {
            setIsPreloading(false);
        }
    };

    // Effect to initialize API connection and fetch active symbols
    useEffect(() => {
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

                // Preload historical data for all volatility indices
                await preloadAllVolatilityData(api);

                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    // Use preloaded data if available
                    if (preloadedData[syn[0].symbol]) {
                        setTickData(preloadedData[syn[0].symbol]);
                        updateHullTrends(preloadedData[syn[0].symbol]);
                    } else {
                        await fetchHistoricalTicks(syn[0].symbol);
                    }
                    startTicks(syn[0].symbol);
                }
            } catch (e: any) {
                console.error('HigherLowerTrader init error', e);
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

    // Effect to fetch historical data when symbol changes
    useEffect(() => {
        if (symbol && apiRef.current) {
            // Use preloaded data if available, otherwise fetch
            if (preloadedData[symbol] && preloadedData[symbol].length > 0) {
                setTickData(preloadedData[symbol]);
                updateHullTrends(preloadedData[symbol]);
                console.log(`Using preloaded data for ${symbol}: ${preloadedData[symbol].length} ticks`);
            } else {
                fetchHistoricalTicks(symbol);
            }
        }
    }, [symbol, preloadedData]);

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
        setTicksProcessed(0);

        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const tickTime = data.tick.epoch * 1000;

                        setCurrentPrice(quote);
                        setTicksProcessed(prev => prev + 1);

                        setTickData(prev => {
                            const newTickData = [...prev, {
                                time: tickTime,
                                price: quote,
                                close: quote
                            }];

                            const trimmedData = newTickData.slice(-2000);
                            updateHullTrends(trimmedData);
                            return trimmedData;
                        });
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const purchaseOnceWithStake = async (stakeAmount: number) => {
        await authorizeIfNeeded();

        const trade_option: any = {
            amount: Number(stakeAmount),
            basis: 'stake',
            contractTypes: [contractType],
            currency: account_currency,
            duration: durationType === 's' ? Number(duration) : Number(duration * 60),
            duration_unit: durationType,
            symbol,
            barrier: barrier
        };

        const buy_req = tradeOptionToBuy(contractType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;
        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stakeAmount}`);
        return buy;
    };

    const onRun = async () => {
        setStatus('Starting Higher/Lower trader...');
        setIsRunning(true);
        stopFlagRef.current = false;

        // Set up run panel
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `higher-lower-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            // Ensure authorization first
            await authorizeIfNeeded();
            setStatus('Authorization successful, starting trading...');

            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake);

            while (!stopFlagRef.current) {
                try {
                    const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;
                    setStake(effectiveStake);

                    setStatus(`Placing ${contractType === 'CALL' ? 'Higher' : 'Lower'} trade with stake ${effectiveStake} ${account_currency}...`);

                    const buy = await purchaseOnceWithStake(effectiveStake);

                    if (!buy?.contract_id) {
                        throw new Error('Failed to get contract ID from purchase');
                    }

                    // Update statistics
                    setTotalStake(prev => prev + effectiveStake);
                    setTotalRuns(prev => prev + 1);

                    // Notify transaction store
                    try {
                        const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                        transactions.onBotContractEvent({
                            contract_id: buy.contract_id,
                            transaction_ids: { buy: buy.transaction_id },
                            buy_price: buy.buy_price,
                            longcode: buy.longcode,
                            start_time: buy.start_time,
                            shortcode: buy.shortcode,
                            underlying: symbol,
                            contract_type: contractType,
                            is_completed: false,
                            profit: 0,
                            profit_percentage: 0
                        });
                    } catch (e) {
                        console.warn('Failed to notify transaction store:', e);
                    }

                    run_panel.setContractStage(contract_stages.PURCHASE_SENT);
                    run_panel.setHasOpenContract(true);

                    // Notify contract purchase sent
                    run_panel.onContractStatusEvent({
                        id: 'contract.purchase_sent',
                        data: effectiveStake
                    });

                    setStatus(`📈 ${contractType} contract started with barrier ${barrier} for $${effectiveStake}`);

                    // Initialize contract display values
                    setContractValue(effectiveStake);
                    setPotentialPayout(buy.payout ? Number(buy.payout) : effectiveStake * 1.95); // Estimate based on typical payout ratio
                    setCurrentProfit(0);

                    // Wait for contract completion
                    const contractResult = await new Promise((resolve, reject) => {
                        let pollCount = 0;
                        const maxPolls = 300; // 5 minutes max

                        const checkContract = async () => {
                            try {
                                pollCount++;
                                if (pollCount > maxPolls) {
                                    throw new Error('Contract polling timeout');
                                }

                                const response = await apiRef.current.send({
                                    proposal_open_contract: 1,
                                    contract_id: buy.contract_id
                                });

                                const contract = response.proposal_open_contract;
                                if (!contract) {
                                    throw new Error('Contract not found');
                                }

                                if (contract.is_sold) {
                                    const profit = Number(contract.profit || 0);
                                    const isWin = profit > 0;

                                    resolve({
                                        profit,
                                        isWin,
                                        sell_price: contract.sell_price,
                                        sell_transaction_id: contract.transaction_ids?.sell,
                                        contract_id: buy.contract_id,
                                        transaction_id: buy.transaction_id,
                                        buy_price: buy.buy_price,
                                        longcode: buy.longcode,
                                        start_time: buy.start_time,
                                        shortcode: buy.shortcode,
                                        underlying: symbol,
                                        entry_tick_display_value: contract.entry_tick_display_value,
                                        exit_tick_display_value: contract.exit_tick_display_value,
                                        payout: contract.sell_price
                                    });
                                } else {
                                    // Contract still running - update UI
                                    const currentBidPrice = Number(contract.bid_price || 0);
                                    const currentProfit = Number(contract.profit || 0);

                                    // Calculate potential payout based on current contract value
                                    const potentialPayout = contract.payout ? Number(contract.payout) :
                                                          (currentBidPrice > 0 ? currentBidPrice :
                                                           (effectiveStake + currentProfit));

                                    setContractValue(currentBidPrice);
                                    setPotentialPayout(potentialPayout);
                                    setCurrentProfit(currentProfit);

                                    const duration_left = (contract.date_expiry || 0) - Date.now() / 1000;
                                    if (duration_left > 0) {
                                        const hours = Math.floor(duration_left / 3600);
                                        const minutes = Math.floor((duration_left % 3600) / 60);
                                        const seconds = Math.floor(duration_left % 60);
                                        setContractDuration(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                                    }

                                    // Continue polling
                                    setTimeout(checkContract, 1000);
                                }
                            } catch (error) {
                                console.error('Contract polling error:', error);
                                reject(error);
                            }
                        };

                        // Start polling after a short delay
                        setTimeout(checkContract, 2000);
                    });

                    // Process contract result
                    const { profit, isWin, sell_price, sell_transaction_id } = contractResult as any;

                    setTotalPayout(prev => prev + Number(sell_price || 0));
                    setTotalProfitLoss(prev => prev + profit);

                    // Update transaction record
                    const transactionData = {
                        ...contractResult,
                        profit: contractResult.profit || 0,
                        buy_price: effectiveStake,
                        contract_type: contractType,
                        currency: account_currency,
                        is_completed: true,
                        run_id: run_panel.run_id,
                        contract_id: contractResult.contract_id || Date.now(),
                        transaction_ids: {
                            buy: contractResult.transaction_id || Date.now(),
                            sell: sell_transaction_id
                        },
                        date_start: buy.start_time,
                        entry_tick_display_value: contractResult.entry_tick_display_value,
                        exit_tick_display_value: contractResult.exit_tick_display_value,
                        shortcode: buy.shortcode,
                        longcode: buy.longcode,
                        underlying: symbol
                    };

                    // Notify transaction store
                    transactions.onBotContractEvent(transactionData);

                    // Update run panel with contract event
                    run_panel.onBotContractEvent(transactionData);

                    // Update statistics
                    setTotalRuns(prev => prev + 1);
                    setTotalStake(prev => prev + effectiveStake);
                    setTotalPayout(prev => prev + (contractResult.payout || 0));

                    if (contractResult.profit > 0) {
                        setContractsWon(prev => prev + 1);
                        setTotalProfitLoss(prev => prev + contractResult.profit);
                        setStatus(`✅ Contract won! Profit: $${contractResult.profit.toFixed(2)}`);
                    } else {
                        setContractsLost(prev => prev + 1);
                        setTotalProfitLoss(prev => prev + contractResult.profit);
                        setStatus(`❌ Contract lost! Loss: $${Math.abs(contractResult.profit).toFixed(2)}`);
                    }

                    run_panel.setHasOpenContract(false);

                    // Notify contract completion
                    run_panel.onContractStatusEvent({
                        id: 'contract.sold',
                        data: transactionData
                    });

                    // Check stop conditions
                    const newTotalProfit = totalProfitLoss + profit;
                    if (useStopOnProfit && newTotalProfit >= targetProfit) {
                        setStatus(`🎯 Target profit reached: ${newTotalProfit.toFixed(2)} ${account_currency}. Stopping bot.`);
                        stopFlagRef.current = true;
                        break;
                    }

                    // Wait between trades (only if continuing)
                    if (!stopFlagRef.current) {
                        setStatus(`Waiting 3 seconds before next trade...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                } catch (error: any) {
                    console.error('Trade execution error:', error);
                    setStatus(`❌ Trade error: ${error.message || 'Unknown error'}`);

                    if (error.code === 'AuthorizationRequired' || error.message?.includes('authorization')) {
                        setIsAuthorized(false);
                        setStatus('❌ Authorization lost. Please refresh and try again.');
                        break;
                    }

                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error: any) {
            console.error('Higher/Lower trader error:', error);
            setStatus(`❌ Trading error: ${error.message || 'Unknown error'}`);
        } finally {
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            setStatus('Higher/Lower trader stopped.');
        }
    };

    // --- Stop Trading Logic ---
    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);

        // Update Run Panel state
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);

        setStatus('Trading stopped - Trends analysis continues');

        // Keep tick stream running for trend analysis - don't call stopTicks()
        // The tick stream should continue to update trends even when not trading
    };

    const resetStats = () => {
        setTotalStake(0);
        setTotalPayout(0);
        setTotalRuns(0);
        setContractsWon(0);
        setContractsLost(0);
        setTotalProfitLoss(0);
    };

    // Determine aligned trend when 3+ timeframes agree
    const getAlignedTrend = () => {
        const trends = Object.values(hullTrends);
        const bullishCount = trends.filter(t => t.trend === 'BULLISH').length;
        const bearishCount = trends.filter(t => t.trend === 'BEARISH').length;
        
        // Require at least 3 timeframes to align for a confirmed trend
        if (bullishCount >= 3) return 'BULLISH';
        if (bearishCount >= 3) return 'BEARISH';
        return 'NEUTRAL';
    };

    // Enhanced auto-recommendation system
    const getRecommendedContractType = () => {
        const alignedTrend = getAlignedTrend();
        
        // Strong trend with high confidence
        if (alignedTrend === 'BULLISH' && trendStrength > 50) return 'CALL';
        if (alignedTrend === 'BEARISH' && trendStrength > 50) return 'PUT';
        
        // Medium confidence - check momentum
        if (alignedTrend === 'BULLISH' && marketMomentum === 'ACCELERATING') return 'CALL';
        if (alignedTrend === 'BEARISH' && marketMomentum === 'ACCELERATING') return 'PUT';
        
        return contractType; // Keep current if unclear
    };

    // Get recommended entry timing
    const getEntryTiming = () => {
        const alignedTrend = getAlignedTrend();
        
        if (alignedTrend !== 'NEUTRAL' && trendStrength > 70) return 'IMMEDIATE';
        if (alignedTrend !== 'NEUTRAL' && trendStrength > 40 && marketMomentum === 'ACCELERATING') return 'SOON';
        if (trendStrength < 30) return 'WAIT';
        return 'MONITOR';
    };

    // Auto-update contract type based on trends (optional feature)
    const [autoSelectContract, setAutoSelectContract] = useState(false);
    
    useEffect(() => {
        if (autoSelectContract && !is_running) {
            const recommended = getRecommendedContractType();
            if (recommended !== contractType && getAlignedTrend() !== 'NEUTRAL' && trendStrength > 60) {
                setContractType(recommended);
            }
        }
    }, [hullTrends, trendStrength, autoSelectContract, is_running]);

    // Optimal duration recommendation based on trend strength
    const getRecommendedDuration = () => {
        if (trendStrength > 80) return 15; // Strong trends - shorter duration
        if (trendStrength > 50) return 30; // Medium trends - medium duration  
        return 60; // Weak trends - longer duration for development
    };

    // Check if user is authorized - check if balance is available and user is logged in
    const isAuthorized = client?.balance !== undefined && client?.balance !== null && client?.is_logged_in;

    return (
        <div className='higher-lower-trader'>
            <div className='higher-lower-trader__container'>
                <div className='higher-lower-trader__content'>
                    <div className='higher-lower-trader__card'>
                        <h3>{localize('Higher/Lower Trading')}</h3>

                        {/* Connection Status */}
                        <div className='form-group'>
                            <div className='connection-status'>
                                <span className={`status-indicator ${isAuthorized ? 'connected' : 'disconnected'}`}></span>
                                <span className='status-text'>
                                    {isAuthorized ? `Authorized (${client?.currency || account_currency}) - Balance: ${client?.balance}` : 'Not Authorized - Please ensure you are logged in'}
                                </span>
                            </div>
                        </div>

                        {/* Trading Parameters */}
                        <div className='higher-lower-trader__row higher-lower-trader__row--two'>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-symbol'>
                                    {localize('Volatility')}
                                    {isPreloading && <span className='loading-indicator'> (Loading...)</span>}
                                </label>
                                <select
                                    id='hl-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);
                                        // Use preloaded data if available
                                        if (preloadedData[v] && preloadedData[v].length > 0) {
                                            setTickData(preloadedData[v]);
                                            updateHullTrends(preloadedData[v]);
                                        } else {
                                            fetchHistoricalTicks(v);
                                        }
                                        startTicks(v);
                                    }}
                                    disabled={isPreloading}
                                >
                                    {symbols.map(s => (
                                        <option key={s.symbol} value={s.symbol}>
                                            {s.display_name} {preloadedData[s.symbol] ? `(${preloadedData[s.symbol].length} ticks)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-contractType'>{localize('Contract Type')}</label>
                                <select
                                    id='hl-contractType'
                                    value={contractType}
                                    onChange={e => setContractType(e.target.value)}
                                >
                                    <option value='CALL'>{localize('Higher (Call)')}</option>
                                    <option value='PUT'>{localize('Lower (Put)')}</option>
                                </select>
                            </div>
                        </div>

                        {/* Duration Controls */}
                        <div className='higher-lower-trader__row higher-lower-trader__row--two'>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-duration-type'>{localize('Duration Type')}</label>
                                <select
                                    id='hl-duration-type'
                                    value={durationType}
                                    onChange={e => setDurationType(e.target.value)}
                                >
                                    <option value='s'>{localize('Seconds')}</option>
                                    <option value='m'>{localize('Minutes')}</option>
                                </select>
                            </div>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-duration'>{localize('Duration')}</label>
                                <input
                                    id='hl-duration'
                                    type='number'
                                    min={durationType === 's' ? 15 : 1}
                                    max={durationType === 's' ? 86400 : 1440}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        {/* Stake and Barrier */}
                        <div className='higher-lower-trader__row higher-lower-trader__row--two'>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-stake'>{localize('Stake')}</label>
                                <input
                                    id='hl-stake'
                                    type='number'
                                    step='0.01'
                                    min={0.35}
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-barrier'>{localize('Barrier')}</label>
                                <input
                                    id='hl-barrier'
                                    type='text'
                                    value={barrier}
                                    onChange={e => setBarrier(e.target.value)}
                                    placeholder='0.00 = current price, +0.37, -0.25'
                                    title='Set to 0.00 to use current price as barrier'
                                />
                            </div>
                        </div>

                        {/* Trend Analysis Method */}
                        <div className='higher-lower-trader__row higher-lower-trader__row--two'>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-trend-method'>{localize('Trend Analysis Method')}</label>
                                <select
                                    id='hl-trend-method'
                                    value={trendMethod}
                                    onChange={e => setTrendMethod(e.target.value as 'HULL' | 'EMA' | 'HYBRID')}
                                >
                                    <option value='HYBRID'>{localize('Hybrid (Recommended)')}</option>
                                    <option value='HULL'>{localize('Hull Moving Average')}</option>
                                    <option value='EMA'>{localize('EMA + MACD')}</option>
                                </select>
                            </div>
                            <div className='higher-lower-trader__field'>
                                <label>{localize('Trend Strength')}: {trendStrength.toFixed(1)}%</label>
                                <div className='trend-strength-bar'>
                                    <div 
                                        className={`trend-strength-fill ${trendStrength > 70 ? 'strong' : trendStrength > 40 ? 'medium' : 'weak'}`}
                                        style={{ width: `${Math.min(trendStrength, 100)}%` }}
                                    ></div>
                                </div>
                                <span className={`momentum-indicator momentum-${marketMomentum.toLowerCase()}`}>
                                    {marketMomentum}
                                </span>
                            </div>
                        </div>

                        {/* EMA Configuration (when EMA method is selected) */}
                        {trendMethod === 'EMA' && (
                            <div className='higher-lower-trader__row higher-lower-trader__row--three'>
                                <div className='higher-lower-trader__field'>
                                    <label htmlFor='ema-fast'>{localize('Fast EMA')}</label>
                                    <input
                                        id='ema-fast'
                                        type='number'
                                        min={5}
                                        max={50}
                                        value={emaConfig.fast}
                                        onChange={e => setEmaConfig({...emaConfig, fast: Number(e.target.value)})}
                                    />
                                </div>
                                <div className='higher-lower-trader__field'>
                                    <label htmlFor='ema-slow'>{localize('Slow EMA')}</label>
                                    <input
                                        id='ema-slow'
                                        type='number'
                                        min={10}
                                        max={100}
                                        value={emaConfig.slow}
                                        onChange={e => setEmaConfig({...emaConfig, slow: Number(e.target.value)})}
                                    />
                                </div>
                                <div className='higher-lower-trader__field'>
                                    <label htmlFor='ema-signal'>{localize('Signal Line')}</label>
                                    <input
                                        id='ema-signal'
                                        type='number'
                                        min={5}
                                        max={20}
                                        value={emaConfig.signal}
                                        onChange={e => setEmaConfig({...emaConfig, signal: Number(e.target.value)})}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Advanced Settings */}
                        <div className='higher-lower-trader__row higher-lower-trader__row--two'>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hl-martingale'>{localize('Martingale Multiplier')}</label>
                                <input
                                    id='hl-martingale'
                                    type='number'
                                    min={1}
                                    step='0.1'
                                    value={martingaleMultiplier}
                                    onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                                />
                            </div>
                            <div className='higher-lower-trader__field'>
                                <label>
                                    <input
                                        type='checkbox'
                                        checked={useStopOnProfit}
                                        onChange={e => setUseStopOnProfit(e.target.checked)}
                                    />
                                    {localize('Stop on Profit')}
                                </label>
                                {useStopOnProfit && (
                                    <input
                                        type='number'
                                        step='0.01'
                                        value={targetProfit}
                                        onChange={e => setTargetProfit(Number(e.target.value))}
                                        placeholder='Target profit'
                                    />
                                )}
                            </div>
                        </div>

                        {/* Live Price Display */}
                        <div className='higher-lower-trader__price-display'>
                            <h4>{localize('Live Price')}: {currentPrice.toFixed(5)}</h4>
                            <p>{localize('Ticks Processed')}: {ticksProcessed}</p>
                            {preloadedData[symbol] && (
                                <p className='preload-info'>
                                    {localize('Historical Data')}: {preloadedData[symbol].length} ticks preloaded
                                </p>
                            )}
                        </div>

                        {/* Enhanced Market Trends */}
                        <div className='higher-lower-trader__trends'>
                            <h4>{localize('Market Trends')} ({trendMethod === 'HULL' ? 'Hull MA' : trendMethod === 'EMA' ? 'EMA+MACD' : 'Hybrid Analysis'})</h4>
                            
                            {/* Trend Method Information */}
                            <div className='trend-method-info'>
                                {trendMethod === 'HYBRID' && (
                                    <Text size='xs' className='method-description'>
                                        {localize('Combining Hull MA, EMA crossovers, MACD signals, and price momentum for optimal accuracy')}
                                    </Text>
                                )}
                                {trendMethod === 'EMA' && (
                                    <Text size='xs' className='method-description'>
                                        {localize('Using EMA')} {emaConfig.fast}/{emaConfig.slow} {localize('crossover with MACD')} ({emaConfig.signal}) {localize('confirmation')}
                                    </Text>
                                )}
                                {trendMethod === 'HULL' && (
                                    <Text size='xs' className='method-description'>
                                        {localize('Hull Moving Average with adaptive periods for noise reduction')}
                                    </Text>
                                )}
                            </div>

                            <div className='trends-grid'>
                                {Object.entries(hullTrends).map(([timeframe, data]) => {
                                    const tickCounts = {
                                        '15s': 600,
                                        '1m': 1000,
                                        '5m': 2000,
                                        '15m': 4500
                                    };

                                    const maxTicks = tickCounts[timeframe as keyof typeof tickCounts] || 600;
                                    const actualTicks = Math.min(tickData.length, maxTicks);
                                    
                                    const requiredConfirmations = {
                                        '15s': 3,
                                        '1m': 4,
                                        '5m': 5,
                                        '15m': 6
                                    }[timeframe] || 3;

                                    const confirmationBars = '█'.repeat(data.confirmationCount || 0) + 
                                                               '░'.repeat(Math.max(0, requiredConfirmations - (data.confirmationCount || 0)));

                                    // Calculate confidence based on confirmations and trend strength
                                    const confidence = Math.min(100, ((data.confirmationCount || 0) / requiredConfirmations) * 100 + (trendStrength * 0.3));

                                    return (
                                        <div key={timeframe} className={`trend-item trend-${data.trend.toLowerCase()}`}>
                                            <span className='timeframe'>{timeframe}</span>
                                            <span className='trend'>{data.trend}</span>
                                            <span className='value'>{data.value.toFixed(5)}</span>
                                            <span className='confirmation'>{confirmationBars}</span>
                                            <span className='confidence'>{confidence.toFixed(0)}%</span>
                                            <span className='tick-count'>({actualTicks} ticks)</span>
                                        </div>
                                    );
                                })}
                            </div>
                            
                            <div className='trend-recommendation'>
                                <div className='trend-alignment'>
                                    <Text size='xs'>
                                        {localize('Aligned Trend')}: <strong className={`trend-${getAlignedTrend().toLowerCase()}`}>
                                            {getAlignedTrend()}
                                        </strong>
                                        <span className='trend-strength-badge'>
                                            {trendStrength > 70 ? '🔥 STRONG' : trendStrength > 40 ? '⚡ MEDIUM' : '💭 WEAK'}
                                        </span>
                                    </Text>
                                </div>
                                <Text size='xs'>
                                    {localize('Recommended')}: <strong>{getRecommendedContractType() === 'CALL' ? 'Higher' : 'Lower'}</strong>
                                    {getAlignedTrend() !== 'NEUTRAL' && trendStrength > 50 && (
                                        <span className='confidence-indicator'> (High Confidence - {marketMomentum})</span>
                                    )}
                                </Text>
                                
                                {/* Trading Signals */}
                                <div className='trading-signals'>
                                    {getAlignedTrend() === 'BULLISH' && trendStrength > 60 && (
                                        <span className='signal signal-buy'>🟢 STRONG BUY SIGNAL</span>
                                    )}
                                    {getAlignedTrend() === 'BEARISH' && trendStrength > 60 && (
                                        <span className='signal signal-sell'>🔴 STRONG SELL SIGNAL</span>
                                    )}
                                    {trendStrength < 30 && (
                                        <span className='signal signal-wait'>⏳ WAIT FOR CLEARER SIGNAL</span>
                                    )}
                                </div>

                                {/* Entry Timing and Recommendations */}
                                <div className='entry-recommendations'>
                                    <Text size='xs'>
                                        {localize('Entry Timing')}: <strong className={`timing-${getEntryTiming().toLowerCase()}`}>
                                            {getEntryTiming()}
                                        </strong>
                                    </Text>
                                    <Text size='xs'>
                                        {localize('Recommended Duration')}: <strong>{getRecommendedDuration()}s</strong>
                                        {trendStrength > 70 && <span className='duration-reason'> (Strong trend - quick resolution)</span>}
                                        {trendStrength < 40 && <span className='duration-reason'> (Weak trend - needs time to develop)</span>}
                                    </Text>
                                </div>

                                {/* Auto-recommendation controls */}
                                <div className='auto-controls'>
                                    <label>
                                        <input
                                            type='checkbox'
                                            checked={autoSelectContract}
                                            onChange={e => setAutoSelectContract(e.target.checked)}
                                            disabled={is_running}
                                        />
                                        {localize('Auto-select contract type based on trends')}
                                    </label>
                                    
                                    {autoSelectContract && (
                                        <button
                                            className='apply-recommendations-btn'
                                            onClick={() => {
                                                setContractType(getRecommendedContractType());
                                                setDuration(getRecommendedDuration());
                                            }}
                                            disabled={is_running}
                                        >
                                            {localize('Apply All Recommendations')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Contract Info During Trading */}
                        {is_running && (
                            <div className='higher-lower-trader__contract-info'>
                                <h4>{localize('Current Contract')}</h4>
                                <div className='contract-stats'>
                                    <div className='stat-item'>
                                        <span>{localize('Profit/Loss')}: </span>
                                        <span className={currentProfit >= 0 ? 'profit' : 'loss'}>
                                            {currentProfit >= 0 ? '+' : ''}{currentProfit.toFixed(2)} {account_currency}
                                        </span>
                                    </div>
                                    <div className='stat-item'>
                                        <span>{localize('Contract Value')}: </span>
                                        <span>{contractValue.toFixed(2)} {account_currency}</span>
                                    </div>
                                    <div className='stat-item'>
                                        <span>{localize('Potential Payout')}: </span>
                                        <span>{potentialPayout.toFixed(2)} {account_currency}</span>
                                    </div>
                                    <div className='stat-item'>
                                        <span>{localize('Time Remaining')}: </span>
                                        <span>{contractDuration}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Trading Statistics */}
                        <div className='higher-lower-trader__stats'>
                            <h4>{localize('Trading Statistics')}</h4>
                            <div className='stats-grid'>
                                <div className='stat-item'>
                                    <span>{localize('Total Runs')}: </span>
                                    <span>{totalRuns}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Won')}: </span>
                                    <span className='win'>{contractsWon}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Lost')}: </span>
                                    <span className='loss'>{contractsLost}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Total Stake')}: </span>
                                    <span>{totalStake.toFixed(2)} {account_currency}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Total Payout')}: </span>
                                    <span>{totalPayout.toFixed(2)} {account_currency}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Total P&L')}: </span>
                                    <span className={totalProfitLoss >= 0 ? 'profit' : 'loss'}>
                                        {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} {account_currency}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={resetStats}
                                className='reset-stats-btn'
                                disabled={is_running}
                            >
                                {localize('Reset Statistics')}
                            </button>
                        </div>

                        {/* Control Buttons */}
                        <div className='higher-lower-trader__buttons'>
                            {!is_running ? (
                                <button
                                    onClick={onRun}
                                    className='btn-start'
                                    disabled={!isAuthorized || symbols.length === 0}
                                >
                                    <Play className='icon' />
                                    {localize('Start Trading')}
                                </button>
                            ) : (
                                <button
                                    onClick={stopTrading}
                                    className='btn-stop'
                                >
                                    <Square className='icon' />
                                    {localize('Stop Trading')}
                                </button>
                            )}

                            {!is_running && (
                                <button
                                    className='control-button restart-ticks-button'
                                    onClick={() => symbol && startTicks(symbol)}
                                    disabled={!symbol || !apiRef.current}
                                >
                                    <Clock size={16} />
                                    Restart Ticks
                                </button>
                            )}
                        </div>

                        {/* Status Display */}
                        {status && (
                            <div className='higher-lower-trader__status'>
                                <Text size='xs'>{status}</Text>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default HigherLowerTrader;