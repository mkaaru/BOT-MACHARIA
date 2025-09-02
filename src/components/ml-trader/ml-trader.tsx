import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Volatility indices for Rise/Fall trading
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

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions, client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const pocSubIdRef = useRef<string | null>(null); // Ref for proposal_open_contract subscription ID
    const autoTradingIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for auto-trading interval

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state - Rise/Fall specific
    const [symbol, setSymbol] = useState<string>('');
    const [contractType, setContractType] = useState<string>('CALL'); // CALL for Rise, PUT for Fall
    const [duration, setDuration] = useState<number>(1); // Duration in ticks for Rise/Fall
    const [durationType, setDurationType] = useState<string>('t'); // 't' for ticks
    const [stake, setStake] = useState<number>(1.0);
    const [baseStake, setBaseStake] = useState<number>(1.0);
    const [allowEquals, setAllowEquals] = useState<boolean>(false); // State for "Allow Equals" option

    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(2.0);
    const [martingaleRuns, setMartingaleRuns] = useState<number>(10); // Default to 10 runs
    const [stopLoss, setStopLoss] = useState<number>(50.0);
    const [takeProfit, setTakeProfit] = useState<number>(100.0);
    const [currentMartingaleCount, setCurrentMartingaleCount] = useState<number>(0);
    const [isInMartingaleSplit, setIsInMartingaleSplit] = useState<boolean>(false);

    // Contract tracking state
    const [currentProfit, setCurrentProfit] = useState<number>(0);
    const [contractValue, setContractValue] = useState<number>(0);
    const [potentialPayout, setPotentialPayout] = useState<number>(0);
    const [contractDuration, setContractDuration] = useState<string>('00:00:00');

    // Live price state
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [entrySpot, setEntrySpot] = useState<number>(0); // For Rise/Fall mode
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Volatility scanner state
    const [isScanning, setIsScanning] = useState(false);
    const [volatilityRecommendations, setVolatilityRecommendations] = useState<any[]>([]);
    const [preloadedData, setPreloadedData] = useState<{[key: string]: Array<{ time: number, price: number, close: number }>}>({});
    const [isPreloading, setIsPreloading] = useState<boolean>(false);
    const [marketRecommendation, setMarketRecommendation] = useState<any>(null);
    const [isAutoTrading, setIsAutoTrading] = useState<boolean>(false); // State to manage auto-trading status

    // Rise/Fall Analytics State
    const [tickStream, setTickStream] = useState<Array<{ price: number; direction: 'R' | 'F' | 'N'; time: number }>>([]);
    const [risePercentage, setRisePercentage] = useState<number>(0);
    const [fallPercentage, setFallPercentage] = useState<number>(0);

    // Hull Moving Average trend analysis state - using 1000 tick increments for stability
    const [hullTrends, setHullTrends] = useState({
        '500': { trend: 'NEUTRAL', value: 0 },
        '1000': { trend: 'NEUTRAL', value: 0 },
        '1500': { trend: 'NEUTRAL', value: 0 },
        '2000': { trend: 'NEUTRAL', value: 0 },
        '3000': { trend: 'NEUTRAL', value: 0 },
        '4000': { trend: 'NEUTRAL', value: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [tradeHistory, setTradeHistory] = useState<Array<any>>([]);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);
    const lastOutcomeWasLossRef = useRef(false);
    let lossStreak = 0;
    let step = 0;

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    // State to track trend update counters for independent timing
    const [trendUpdateCounters, setTrendUpdateCounters] = useState({
        '500': 0,
        '1000': 0,
        '1500': 0,
        '2000': 0,
        '3000': 0,
        '4000': 0
    });

    // State to store previous trend values for smoothing
    const [previousTrends, setPreviousTrends] = useState({
        '500': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
        '1000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
        '1500': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
        '2000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
        '3000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
        '4000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 }
    });

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

    // Ehlers Super Smoother Filter to remove aliasing noise
    const applySuperSmoother = (prices: number[], period: number = 10) => {
        if (prices.length < period) return prices;

        const smoothed = [...prices];
        const a1 = Math.exp(-1.414 * Math.PI / period);
        const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / period);
        const c2 = b1;
        const c3 = -a1 * a1;
        const c1 = 1 - c2 - c3;

        for (let i = 2; i < prices.length; i++) {
            smoothed[i] = c1 * (prices[i] + prices[i - 1]) / 2 + c2 * smoothed[i - 1] + c3 * smoothed[i - 2];
        }

        return smoothed;
    };

    // Ehlers Decycler to remove market noise
    const applyDecycler = (prices: number[], period: number = 20) => {
        if (prices.length < 3) return prices;

        const decycled = [...prices];
        const alpha = (Math.cos(0.707 * 2 * Math.PI / period) + Math.sin(0.707 * 2 * Math.PI / period) - 1) /
                      Math.cos(0.707 * 2 * Math.PI / period);

        for (let i = 2; i < prices.length; i++) {
            decycled[i] = (alpha / 2) * (prices[i] + prices[i - 1]) + (1 - alpha) * decycled[i - 1];
        }

        return decycled;
    };

    // Update Ehlers trends with noise reduction and independent timing
    const updateEhlersTrends = (newTickData: Array<{ time: number, price: number, close: number }>) => {
        // Update counters
        setTrendUpdateCounters(prev => ({
            '500': prev['500'] + 1,
            '1000': prev['1000'] + 1,
            '1500': prev['1500'] + 1,
            '2000': prev['2000'] + 1,
            '3000': prev['3000'] + 1,
            '4000': prev['4000'] + 1
        }));

        const newTrends = { ...hullTrends };

        // Define tick count requirements and update frequencies for different timeframes
        // Using tick count increments for more stable trend detection
        const timeframeConfigs = {
            '500': { requiredTicks: 500, updateEvery: 5, smoothingPeriod: 15 },
            '1000': { requiredTicks: 1000, updateEvery: 10, smoothingPeriod: 20 },  // Update every 10 ticks
            '1500': { requiredTicks: 1500, updateEvery: 15, smoothingPeriod: 25 },
            '2000': { requiredTicks: 2000, updateEvery: 15, smoothingPeriod: 25 },  // Update every 15 ticks
            '3000': { requiredTicks: 3000, updateEvery: 20, smoothingPeriod: 30 },  // Update every 20 ticks
            '4000': { requiredTicks: 4000, updateEvery: 25, smoothingPeriod: 35 }   // Update every 25 ticks (most stable)
        };

        Object.entries(timeframeConfigs).forEach(([tickCountStr, config]) => {
            const currentCounter = trendUpdateCounters[tickCountStr as keyof typeof trendUpdateCounters];

            // Only update if it's time for this timeframe
            if (currentCounter % config.updateEvery !== 0) {
                return; // Skip this update cycle
            }

            const recentTicks = newTickData.slice(-config.requiredTicks);

            if (recentTicks.length >= Math.min(15, config.requiredTicks)) {
                const tickPrices = recentTicks.map(tick => tick.price);

                // Apply Ehlers noise reduction techniques
                const smoothedPrices = applySuperSmoother(tickPrices, config.smoothingPeriod);
                const decycledPrices = applyDecycler(smoothedPrices, Math.max(10, config.smoothingPeriod));

                // Use adaptive HMA period based on tick count and timeframe
                const hmaPeriod = Math.max(8, Math.min(Math.floor(decycledPrices.length * 0.3), 25));

                const hmaValue = calculateHMA(decycledPrices, hmaPeriod);

                if (hmaValue !== null) {
                    // Get previous values for smoothing
                    const prevData = previousTrends[tickCountStr as keyof typeof previousTrends];

                    // Apply exponential smoothing to HMA value
                    const smoothingFactor = 0.3; // Adjust between 0.1 (more smoothing) and 0.5 (less smoothing)
                    const smoothedHMA = prevData.smoothedValue === 0 ? hmaValue :
                                      (smoothingFactor * hmaValue) + ((1 - smoothingFactor) * prevData.smoothedValue);

                    let trend = 'NEUTRAL';

                    // Calculate trend using smoothed values
                    const hmaSlopeLookback = Math.max(3, Math.floor(hmaPeriod / 4));
                    const prevHMA = calculateHMA(decycledPrices.slice(0, -hmaSlopeLookback), hmaPeriod);
                    const hmaSlope = prevHMA !== null ? smoothedHMA - prevHMA : 0;

                    // Get current price from smoothed data
                    const currentPrice = decycledPrices[decycledPrices.length - 1];
                    const priceAboveHMA = currentPrice > smoothedHMA;

                    // Calculate adaptive thresholds based on timeframe
                    const priceRange = Math.max(...decycledPrices.slice(-Math.min(50, decycledPrices.length))) -
                                     Math.min(...decycledPrices.slice(-Math.min(50, decycledPrices.length)));

                    // Larger timeframes need bigger thresholds to avoid noise
                    const timeframeMultiplier = config.requiredTicks / 60;
                    const adaptiveThreshold = priceRange * (0.05 + timeframeMultiplier * 0.02);
                    const slopeThreshold = Math.max(0.000005, adaptiveThreshold * 0.2);

                    // Enhanced trend detection with hysteresis (prevent rapid changes)
                    const trendStrength = Math.abs(hmaSlope) / slopeThreshold;
                    const minTrendStrength = prevData.trend === 'NEUTRAL' ? 1.2 : 0.8; // Hysteresis

                    if (trendStrength > minTrendStrength) {
                        if (hmaSlope > slopeThreshold && priceAboveHMA) {
                            trend = 'BULLISH';
                        } else if (hmaSlope < -slopeThreshold && !priceAboveHMA) {
                            trend = 'BEARISH';
                        } else {
                            // Keep previous trend if conditions are mixed
                            trend = prevData.trend;
                        }
                    } else {
                        // Weak signal - maintain previous trend unless it's been neutral for a while
                        trend = prevData.trend !== 'NEUTRAL' ? prevData.trend : 'NEUTRAL';
                    }

                    // Additional confirmation for trend changes
                    if (trend !== prevData.trend && prevData.trend !== 'NEUTRAL') {
                        // Require stronger confirmation for trend reversals
                        const confirmationStrength = 1.5;
                        if (trendStrength < confirmationStrength) {
                            trend = prevData.trend; // Keep previous trend
                        }
                    }

                    newTrends[tickCountStr as keyof typeof hullTrends] = {
                        trend,
                        value: Number(smoothedHMA.toFixed(5))
                    };

                    // Update previous trends for smoothing
                    setPreviousTrends(prev => ({
                        ...prev,
                        [tickCountStr]: {
                            trend,
                            value: Number(hmaValue.toFixed(5)),
                            smoothedValue: smoothedHMA
                        }
                    }));
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
                count: 4000, // Fetch enough ticks for the longest analysis (4000 tick timeframe)
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

                    const trimmedData = uniqueData.slice(-4000); // Keep only the most recent 4000 ticks
                    updateEhlersTrends(trimmedData);
                    return trimmedData;
                });
            }
        } catch (error) {
            console.error('Error fetching historical ticks:', error);
        }
    };

    // Preload historical data for all volatilities
    const preloadAllVolatilityData = async (api: any) => {
        setIsPreloading(true);
        setStatus('Preloading historical data for trend analysis...');

        // Use only standard Deriv volatility indices
        const volatilitySymbols = VOLATILITY_INDICES.map(v => v.value);

        const preloadedDataMap: {[key: string]: Array<{ time: number, price: number, close: number }>}= {};

        try {
            // Fetch 4000 ticks for each volatility index for trend analysis
            const promises = volatilitySymbols.map(async (sym) => {
                try {
                    const request = {
                        ticks_history: sym,
                        adjust_start_time: 1,
                        count: 4000, // Fetch enough for the longest trend analysis (4000 tick timeframe)
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
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol) || s.symbol.startsWith('BOOM') || s.symbol.startsWith('CRASH') || s.symbol === 'stpRNG' || s.symbol.startsWith('1HZ'))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);

                // Preload historical data for all volatility indices
                await preloadAllVolatilityData(api);

                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    // Use preloaded data if available
                    if (preloadedData[syn[0].symbol] && preloadedData[syn[0].symbol].length > 0) {
                        setTickData(preloadedData[syn[0].symbol]);
                        updateEhlersTrends(preloadedData[syn[0].symbol]);
                    } else {
                        await fetchHistoricalTicks(syn[0].symbol);
                    }
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

    // Effect to fetch historical data when symbol changes
    useEffect(() => {
        if (symbol && apiRef.current) {
            // Use preloaded data if available, otherwise fetch
            if (preloadedData[symbol] && preloadedData[symbol].length > 0) {
                setTickData(preloadedData[symbol]);
                updateEhlersTrends(preloadedData[symbol]);
                console.log(`Using preloaded data for ${symbol}: ${preloadedData[symbol].length} ticks`);
            } else {
                fetchHistoricalTicks(symbol);
            }
        }
    }, [symbol, preloadedData]);

    // Add event listener for volatility scanner symbol selection
    useEffect(() => {
        // Initialize with default symbol
        if (symbols.length > 0) {
            const defaultSymbol = symbols[0].symbol;
            setSymbol(defaultSymbol);
            // Use preloaded data if available
            if (preloadedData[defaultSymbol] && preloadedData[defaultSymbol].length > 0) {
                setTickData(preloadedData[defaultSymbol]);
                updateEhlersTrends(preloadedData[defaultSymbol]);
            } else {
                fetchHistoricalTicks(defaultSymbol);
            }
            startTicks(defaultSymbol);
        }

        // Listen for symbol selection from volatility scanner
        const handleSymbolSelection = (event: CustomEvent) => {
            const { symbol: selectedSymbol, displayName } = event.detail;

            // Find the symbol in available symbols or use it directly
            const symbolToUse = symbols.find(s => s.symbol === selectedSymbol)?.symbol || selectedSymbol;

            setSymbol(symbolToUse);
            // Use preloaded data if available
            if (preloadedData[symbolToUse] && preloadedData[symbolToUse].length > 0) {
                setTickData(preloadedData[symbolToUse]);
                updateEhlersTrends(preloadedData[symbolToUse]);
            } else {
                fetchHistoricalTicks(symbolToUse);
            }
            startTicks(symbolToUse);

            console.log(`Selected symbol from scanner: ${selectedSymbol} (${displayName}) -> Trading with: ${symbolToUse}`);
        };

        window.addEventListener('selectVolatilitySymbol', handleSymbolSelection as EventListener);

        return () => {
            window.removeEventListener('selectVolatilitySymbol', handleSymbolSelection as EventListener);
        };
    }, [symbols, preloadedData]); // Depend on symbols and preloadedData

    // Update market recommendation when trends change
    useEffect(() => {
        const recommendation = getMarketRecommendation();
        setMarketRecommendation(recommendation);
    }, [hullTrends, symbol]);

    // Scan for volatility opportunities when preloaded data is available
    useEffect(() => {
        if (Object.keys(preloadedData).length >= 5 && !isScanning) {
            scanVolatilityOpportunities();
        }
    }, [preloadedData]);


    const authorizeIfNeeded = async () => {
        if (is_authorized) return;
        const token = V2GetActiveToken();
        if (!token) {
            setStatus('No token found. Please log in and select an account.');
            throw new Error('No token');
        }
        const response = await apiRef.current.authorize(token);
        if (response.error) {
            setStatus(`Authorization error: ${response.error.message || response.error.code}`);
            throw response.error;
        }
        setIsAuthorized(true);
        const loginid = response.authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(response.authorize?.currency || 'USD');
        try {
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(response.authorize?.currency || 'USD');
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
        setTickStream([]); // Clear tick stream on new symbol
        setRisePercentage(0);
        setFallPercentage(0);

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
                        setEntrySpot(quote); // Update entry spot for Rise/Fall
                        setTicksProcessed(prev => prev + 1);

                        // Update tick stream for R/F analysis (borrowed from volatility analyzer)
                        setTickStream(prev => {
                            const lastPrice = prev.length > 0 ? prev[prev.length - 1].price : quote;
                            let direction: 'R' | 'F' | 'N' = 'N';

                            if (quote > lastPrice) {
                                direction = 'R'; // Rise
                            } else if (quote < lastPrice) {
                                direction = 'F'; // Fall
                            }

                            const newTick = { price: quote, direction, time: tickTime };
                            const updatedStream = [...prev, newTick].slice(-120); // Keep last 120 ticks

                            // Calculate rise/fall percentages
                            const riseCount = updatedStream.filter(t => t.direction === 'R').length;
                            const fallCount = updatedStream.filter(t => t.direction === 'F').length;
                            const totalDirectional = riseCount + fallCount;

                            if (totalDirectional > 0) {
                                setRisePercentage(Math.round((riseCount / totalDirectional) * 100));
                                setFallPercentage(Math.round((fallCount / totalDirectional) * 100));
                            } else {
                                setRisePercentage(0);
                                setFallPercentage(0);
                            }

                            return updatedStream;
                        });

                        setTickData(prev => {
                            const newTickData = [...prev, {
                                time: tickTime,
                                price: quote,
                                close: quote
                            }];

                            const trimmedData = newTickData.slice(-4000);
                            updateEhlersTrends(trimmedData);
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

    // Execute Rise/Fall trade using real Deriv API
    const executeRiseFallTrade = async (direction: 'RISE' | 'FALL') => {
        if (!apiRef.current) {
            setStatus('API not connected');
            return;
        }

        try {
            await authorizeIfNeeded();
            setStatus(`Executing ${direction} trade...`);

            // Determine contract type based on direction and allowEquals setting
            let contractTypeToUse: string;
            if (direction === 'RISE') {
                contractTypeToUse = allowEquals ? 'CALLE' : 'CALL';  // CALLE allows equals for Rise
            } else {
                contractTypeToUse = allowEquals ? 'PUTE' : 'PUT';    // PUTE allows equals for Fall
            }

            // Get proposal for Rise/Fall trade
            const proposalParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: contractTypeToUse,
                currency: account_currency,
                duration: duration,
                duration_unit: durationType,
                symbol: symbol,
            };

            console.log('Rise/Fall proposal params:', proposalParams);

            const proposalResponse = await apiRef.current.send(proposalParams);

            if (proposalResponse.error) {
                setStatus(`Proposal error: ${proposalResponse.error.message}`);
                return;
            }

            const proposal = proposalResponse.proposal;
            const proposalId = proposal.id;
            const askPrice = proposal.ask_price;

            console.log('Rise/Fall proposal received:', proposal);

            // Execute the purchase
            const purchaseParams = {
                buy: proposalId,
                price: askPrice,
            };

            const purchaseResponse = await apiRef.current.send(purchaseParams);

            if (purchaseResponse.error) {
                setStatus(`Purchase error: ${purchaseResponse.error.message}`);
                return;
            }

            const purchase = purchaseResponse.buy;
            const contract_id = purchase.contract_id;
            const purchase_price = purchase.buy_price;
            const potential_payout = purchase.payout;

            console.log('Rise/Fall purchase successful:', purchase);

            // Update trading statistics
            setTotalStake(prev => prev + purchase_price);
            setTotalRuns(prev => prev + 1);
            setStatus(`${direction} contract purchased: ${contract_id}`);

            // Track contract value and potential payout
            setContractValue(purchase_price);
            setPotentialPayout(potential_payout);
            setEntrySpot(proposal.spot); // Store entry spot for Rise/Fall

            // Add to trade history
            const tradeRecord = {
                id: contract_id,
                symbol: symbol,
                contract_type: contractTypeToUse,
                direction: direction,
                stake: purchase_price,
                potential_payout: potential_payout,
                entry_spot: proposal.spot,
                timestamp: Date.now(),
                status: 'OPEN'
            };

            setTradeHistory(prev => [...prev, tradeRecord]);

            // Monitor contract using real Deriv API
            await monitorRiseFallContract(contract_id, purchase_price, potential_payout);

        } catch (error: any) {
            console.error('Rise/Fall purchase error:', error);
            setStatus(`Rise/Fall purchase failed: ${error.message || 'Unknown error'}`);
        }
    };

    // Monitor Rise/Fall contract using real Deriv API
    const monitorRiseFallContract = async (contract_id: string, purchase_price: number, potential_payout: number) => {
        try {
            // Subscribe to contract updates using real Deriv API
            const response = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id,
                subscribe: 1
            });

            if (response.error) {
                console.error('Monitor contract error:', response.error);
                setStatus(`Contract monitoring failed: ${response.error.message}`);
                return;
            }

            const onMessage = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data);
                    if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.contract_id === contract_id) {
                        const contract = data.proposal_open_contract;
                        const profit = contract.bid_price ? contract.bid_price - purchase_price : 0;
                        const contractStatus = contract.status;
                        const currentContractData = {
                            ...contract,
                            profit: profit,
                            status: contractStatus,
                            run_id: run_panel.run_id,
                        };

                        transactions.onBotContractEvent(currentContractData);
                        run_panel.setHasOpenContract(true);

                        if (contractStatus === 'sold' || contract.is_sold) {
                            const result = profit > 0 ? '✅ WIN' : '❌ LOSS';
                            const profitText = profit > 0 ? `+${profit.toFixed(2)}` : profit.toFixed(2);
                            setStatus(`${result}: ${profitText} ${account_currency} | Contract completed`);

                            run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                            run_panel.setHasOpenContract(false);
                            if (pocSubIdRef.current) apiRef.current?.forget?.({ forget: pocSubIdRef.current });
                            apiRef.current?.connection?.removeEventListener('message', onMessage);

                            // Update martingale logic
                            if (profit > 0) {
                                lastOutcomeWasLossRef.current = false;
                                lossStreak = 0;
                                step = 0;
                                setStake(baseStake);
                                setCurrentMartingaleCount(0); // Reset martingale count on win
                                setIsInMartingaleSplit(false); // Reset mode on win
                            } else {
                                lastOutcomeWasLossRef.current = true;
                                lossStreak++;
                                step = Math.min(step + 1, martingaleRuns); // Cap at martingaleRuns
                                setCurrentMartingaleCount(step);
                                setIsInMartingaleSplit(true); // Enter split mode

                                // Adjust stake based on martingale multiplier and step
                                const nextStake = baseStake * Math.pow(martingaleMultiplier, step);
                                setStake(nextStake);

                                // Check if max martingale runs reached
                                if (step >= martingaleRuns) {
                                    setStatus(`Martingale runs limit (${martingaleRuns}) reached. Resetting stake.`);
                                    setStake(baseStake);
                                    setCurrentMartingaleCount(0);
                                    setIsInMartingaleSplit(false);
                                }
                            }
                            setTotalProfitLoss(prev => prev + profit); // Update total P&L
                            setTotalPayout(prev => prev + profit); // Update total payout

                        } else {
                            // Contract is still running
                            setStatus(`📈 Running: ${contract.longcode || 'Contract'} | Current P&L: ${profit.toFixed(2)} ${account_currency}`);
                            run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
                        }
                    }
                } catch (err) {
                    console.error('Error processing contract update:', err);
                }
            };
            // Capture subscription ID for later forget
            if (response.subscription?.id) pocSubIdRef.current = response.subscription.id;
            apiRef.current?.connection?.addEventListener('message', onMessage);
            messageHandlerRef.current = onMsg; // Store the handler for potential removal
        } catch (error) {
            console.error('Monitor contract error:', error);
            setStatus(`Contract monitoring failed: ${error.message || 'Unknown error'}`);
        }
    };

    // Start auto trading based on Hull Moving Average trends and volatility scanner
    const startAutoTrading = () => {
        if (isAutoTrading) {
            setStatus('Auto trading already running');
            return;
        }

        setIsAutoTrading(true);
        setStatus('Starting auto trading based on trend analysis and volatility opportunities...');

        autoTradingIntervalRef.current = setInterval(() => {
            if (stopFlagRef.current) {
                stopAutoTrading();
                return;
            }

            // First check volatility opportunities from scanner
            if (volatilityRecommendations.length > 0) {
                // Find best volatility opportunity
                const bestOpportunity = volatilityRecommendations.reduce((best, current) => {
                    // Use the higher of rise/fall percentage as the score
                    const currentScore = Math.max(current.risePercentage, current.fallPercentage);
                    const bestScore = Math.max(best.risePercentage, best.fallPercentage);
                    return currentScore > bestScore ? current : best;
                }, volatilityRecommendations[0]); // Initialize with the first recommendation

                // Only trade if opportunity score is above threshold
                const threshold = 65; // 65% threshold for volatility opportunities
                const riseScore = bestOpportunity.risePercentage;
                const fallScore = bestOpportunity.fallPercentage;

                if (riseScore > threshold || fallScore > threshold) {
                    setSymbol(bestOpportunity.symbol);

                    if (riseScore > fallScore && riseScore > threshold) {
                        setStatus(`Auto trading: RISE on ${bestOpportunity.displayName} (Rise: ${riseScore.toFixed(1)}%)`);
                        executeRiseFallTrade('RISE');
                    } else if (fallScore > threshold) {
                        setStatus(`Auto trading: FALL on ${bestOpportunity.displayName} (Fall: ${fallScore.toFixed(1)}%)`);
                        executeRiseFallTrade('FALL');
                    }
                    return;
                }
            }

            // Fallback to Hull Moving Average trends
            const recommendation = getMarketRecommendation();

            if (recommendation) {
                const { recommendation: action, confidence, symbol: recommendedSymbol, reasoning } = recommendation;

                if (confidence >= 70) { // Only trade with high confidence
                    setSymbol(recommendedSymbol);
                    setStatus(`Auto trading: ${action} on ${recommendedSymbol} (${reasoning})`);

                    // Execute trade based on recommendation
                    if (action === 'RISE') {
                        executeRiseFallTrade('RISE');
                    } else if (action === 'FALL') {
                        executeRiseFallTrade('FALL');
                    }
                } else {
                    setStatus(`Auto trading: Waiting for high confidence signal (current: ${(confidence).toFixed(1)}%)`);
                }
            } else {
                setStatus('Auto trading: No clear opportunities detected, waiting...');
            }
        }, 30000); // Check every 30 seconds for auto trading opportunities
    };

    const stopAutoTrading = () => {
        setIsAutoTrading(false);
        setIsRunning(false);
        stopFlagRef.current = true;
        if (autoTradingIntervalRef.current) {
            clearInterval(autoTradingIntervalRef.current);
            autoTradingIntervalRef.current = null;
        }
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Auto trading stopped');
    };

    const executeAutoTradingLoop = async () => {
        while (!stopFlagRef.current && isAutoTrading) {
            try {
                // Check stop loss and take profit before each trade
                if (totalProfitLoss <= -stopLoss) {
                    setStatus(`Stop Loss hit ($${stopLoss}). Stopping auto trading.`);
                    stopAutoTrading();
                    return;
                }
                if (totalProfitLoss >= takeProfit) {
                    setStatus(`Take Profit hit ($${takeProfit}). Stopping auto trading.`);
                    stopAutoTrading();
                    return;
                }

                // Get market recommendation to determine trade direction
                const recommendation = getMarketRecommendation();
                const tradeType = recommendation?.recommendation === 'FALL' ? 'PUT' : 'CALL';

                setStatus(`🔄 Executing auto trade: ${tradeType} based on ML analysis...`);

                // Execute the trade and wait for completion
                await executeNextTrade(tradeType);

                // Small delay before next trade to avoid spam
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error('Auto trading loop error:', error);
                setStatus(`Trade execution error: ${error.message || 'Unknown error'}`);

                // Wait a bit before retrying on error
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    };

    const executeNextTrade = async (tradeType: string) => {
        return new Promise<void>(async (resolve, reject) => {
            try {
                await authorizeIfNeeded();

                // Check martingale conditions
                let currentStakeAmount = baseStake;
                if (isInMartingaleSplit && currentMartingaleCount > 0) {
                    currentStakeAmount = baseStake * Math.pow(martingaleMultiplier, currentMartingaleCount);
                }
                setStake(currentStakeAmount);

                setStatus(`Getting proposal for ${tradeType} contract...`);

                // Get proposal using real Deriv API
                const proposalParams = {
                    proposal: 1,
                    amount: currentStakeAmount,
                    basis: 'stake',
                    contract_type: tradeType,
                    currency: account_currency,
                    duration: 1, // Duration is 1 tick for Rise/Fall
                    duration_unit: 't', // tick unit
                    symbol: symbol,
                };

                const proposalResponse = await apiRef.current.send(proposalParams);

                if (proposalResponse.error) {
                    setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                    reject(new Error(proposalResponse.error.message));
                    return;
                }

                const proposal = proposalResponse.proposal;
                if (!proposal) {
                    setStatus('No proposal received');
                    reject(new Error('No proposal received'));
                    return;
                }

                setStatus(`Purchasing ${tradeType} contract...`);

                // Buy contract using real Deriv API
                const buyParams = {
                    buy: proposal.id,
                    price: proposal.ask_price
                };

                const buyResponse = await apiRef.current.send(buyParams);

                if (buyResponse.error) {
                    setStatus(`Trade failed: ${buyResponse.error.message}`);
                    reject(new Error(buyResponse.error.message));
                    return;
                }

                const buy = buyResponse.buy;

                // Update statistics
                setTotalStake(prev => prev + currentStakeAmount);
                setTotalRuns(prev => prev + 1);

                // Add to trade history
                const tradeRecord = {
                    id: buy?.contract_id,
                    symbol: symbol,
                    contract_type: tradeType,
                    stake: currentStakeAmount,
                    potential_payout: buy?.payout,
                    entry_spot: proposal.spot,
                    timestamp: Date.now(),
                    status: 'OPEN'
                };

                setTradeHistory(prev => [tradeRecord, ...prev.slice(0, 99)]);

                // Seed transaction for UI
                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    const contractData = {
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: tradeType as any,
                        underlying: symbol,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                        shortcode: buy?.shortcode || `${tradeType}_${symbol}_1T_${currentStakeAmount}`,
                        longcode: buy?.longcode || `${tradeType} prediction on ${symbol_display}`,
                        is_completed: false,
                        profit: 0,
                        payout: buy?.payout || 0,
                        run_id: run_panel.run_id,
                    } as any;

                    transactions.onBotContractEvent(contractData);
                } catch (err) {
                    console.error('Error seeding transaction:', err);
                }

                setStatus(`${tradeType} contract purchased! Contract ID: ${buy.contract_id}`);

                // Subscribe to contract updates and wait for completion
                try {
                    const contractSubscription = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: buy.contract_id,
                        subscribe: 1
                    });

                    if (contractSubscription.error) {
                        console.error('Contract subscription error:', contractSubscription.error);
                        resolve(); // Continue even if subscription fails
                        return;
                    }

                    let contractCompleted = false;
                    let pocSubId = contractSubscription.subscription?.id;

                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const data = JSON.parse(evt.data as any);
                            if (data?.msg_type === 'proposal_open_contract') {
                                const poc = data.proposal_open_contract;
                                if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;

                                if (String(poc?.contract_id || '') === buy.contract_id) {
                                    // Update transaction in run panel
                                    transactions.onBotContractEvent({
                                        ...poc,
                                        run_id: run_panel.run_id,
                                    });
                                    run_panel.setHasOpenContract(true);

                                    const profit = Number(poc?.profit || 0);

                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        const result = profit > 0 ? '✅ WIN' : '❌ LOSS';
                                        const profitText = profit > 0 ? `+${profit.toFixed(2)}` : profit.toFixed(2);
                                        setStatus(`${result}: ${profitText} ${account_currency} | Contract completed`);

                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);

                                        // Clean up subscription
                                        if (pocSubId) {
                                            apiRef.current?.forget?.({ forget: pocSubId });
                                        }
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);

                                        // Update statistics
                                        setTotalPayout(prev => prev + profit);
                                        setTotalProfitLoss(prev => prev + profit);

                                        if (profit > 0) {
                                            setContractsWon(prev => prev + 1);
                                            lastOutcomeWasLossRef.current = false;

                                            // Handle martingale after win
                                            if (isInMartingaleSplit) {
                                                setCurrentMartingaleCount(0);
                                                setIsInMartingaleSplit(false);
                                                setStake(baseStake);
                                            }
                                        } else {
                                            setContractsLost(prev => prev + 1);
                                            lastOutcomeWasLossRef.current = true;

                                            // Handle martingale after loss
                                            if (currentMartingaleCount < martingaleRuns) {
                                                setIsInMartingaleSplit(true);
                                                setCurrentMartingaleCount(prev => prev + 1);
                                            } else {
                                                setCurrentMartingaleCount(0);
                                                setIsInMartingaleSplit(false);
                                                setStake(baseStake);
                                            }
                                        }

                                        contractCompleted = true;
                                        resolve(); // Resolve the promise to continue the loop
                                    }
                                }
                            }
                        } catch (error) {
                            console.error('Contract update parsing error:', error);
                        }
                    };

                    apiRef.current?.connection?.addEventListener('message', onMsg);

                    // Set a timeout in case the contract doesn't complete normally
                    setTimeout(() => {
                        if (!contractCompleted) {
                            console.warn('Contract completion timeout, continuing...');
                            if (pocSubId) {
                                apiRef.current?.forget?.({ forget: pocSubId });
                            }
                            apiRef.current?.connection?.removeEventListener('message', onMsg);
                            resolve();
                        }
                    }, 30000); // 30 second timeout

                } catch (subscriptionError) {
                    console.error('Contract subscription error:', subscriptionError);
                    resolve(); // Continue even if subscription fails
                }

            } catch (error) {
                console.error('Execute trade error:', error);
                reject(error);
            }
        });
    };

    // Get market recommendation based on HMA trend analysis
    const getMarketRecommendation = () => {
        if (Object.keys(hullTrends).length === 0) return null;

        // Count aligned trends for different timeframes
        const trendCounts = {
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0
        };

        Object.entries(hullTrends).forEach(([timeframe, trendData]) => {
            const { trend } = trendData;
            if (trend === 'BULLISH') trendCounts.bullishCount++;
            else if (trend === 'BEARISH') trendCounts.bearishCount++;
            else trendCounts.neutralCount++;
        });

        const totalTrends = Object.keys(hullTrends).length;
        const alignedBullish = trendCounts.bullishCount;
        const alignedBearish = trendCounts.bearishCount;

        // Determine recommendation based on trend alignment
        let recommendation: 'RISE' | 'FALL' | 'WAIT' = 'WAIT';
        let confidence = 0;
        let alignedTrends = 0;
        let reasoning = '';

        if (alignedBullish >= 3) {
            recommendation = 'RISE';
            alignedTrends = alignedBullish;
            confidence = Math.min(95, (alignedBullish / totalTrends) * 100);
            reasoning = `${alignedBullish} out of ${totalTrends} Hull Moving Average timeframes show bullish trend. Strong upward momentum detected.`;
        } else if (alignedBearish >= 3) {
            recommendation = 'FALL';
            alignedTrends = alignedBearish;
            confidence = Math.min(95, (alignedBearish / totalTrends) * 100);
            reasoning = `${alignedBearish} out of ${totalTrends} Hull Moving Average timeframes show bearish trend. Strong downward momentum detected.`;
        } else if (alignedBullish === 2 && alignedBearish <= 1) {
            recommendation = 'RISE';
            alignedTrends = alignedBullish;
            confidence = 65;
            reasoning = `${alignedBullish} out of ${totalTrends} timeframes show bullish trend. Moderate upward momentum.`;
        } else if (alignedBearish === 2 && alignedBullish <= 1) {
            recommendation = 'FALL';
            alignedTrends = alignedBearish;
            confidence = 65;
            reasoning = `${alignedBearish} out of ${totalTrends} timeframes show bearish trend. Moderate downward momentum.`;
        } else {
            alignedTrends = Math.max(alignedBullish, alignedBearish);
            confidence = 30;
            reasoning = 'Mixed signals across timeframes. ${trendCounts.bullishCount} bullish, ${trendCounts.bearishCount} bearish, ${trendCounts.neutralCount} neutral. Market conditions unclear.';
        }

        return {
            symbol,
            recommendation,
            confidence,
            alignedTrends,
            totalTrends,
            reasoning
        };
    };

    // Scan all volatility indices for opportunities
    const scanVolatilityOpportunities = async () => {
        if (!apiRef.current || isScanning) return;

        setIsScanning(true);
        setStatus('Scanning volatility opportunities...');

        const opportunities: any[] = [];
        // Use only standard Deriv volatility indices
        const volatilitySymbols = VOLATILITY_INDICES.map(v => v.value);

        try {
            // Fetch recommendations for all volatilities
            const promises = volatilitySymbols.map(async (volatilitySymbol) => {
                const symbolData = preloadedData[volatilitySymbol];
                if (!symbolData || symbolData.length < 4000) return;

                // Calculate trends for this symbol
                const symbolTrends = calculateTrendsForSymbol(symbolData);

                if (symbolTrends) {
                    const recommendation = getRecommendationForTrends(symbolTrends);

                    if (recommendation && (recommendation.confidence >= 65 || recommendation.alignedTrends >=3)) { // Filter for high confidence or strong alignment
                        opportunities.push({
                            symbol: volatilitySymbol,
                            displayName: VOLATILITY_INDICES.find(v => v.value === volatilitySymbol)?.label || volatilitySymbol,
                            tradingSymbol: volatilitySymbol,
                            confidence: recommendation.confidence,
                            signal: recommendation.recommendation === 'RISE' ? 'HIGHER' : recommendation.recommendation === 'FALL' ? 'LOWER' : 'WAIT',
                            alignedCount: recommendation.alignedTrends,
                            totalCount: recommendation.totalTrends,
                            reasoning: recommendation.reasoning,
                            // Add rise/fall percentages for auto-trading logic
                            risePercentage: recommendation.recommendation === 'RISE' ? recommendation.confidence : (recommendation.recommendation === 'FALL' ? 100 - recommendation.confidence : 50),
                            fallPercentage: recommendation.recommendation === 'FALL' ? recommendation.confidence : (recommendation.recommendation === 'RISE' ? 100 - recommendation.confidence : 50)
                        });
                    }
                }
            });

            await Promise.all(promises);

            // Sort by confidence and filter out 'WAIT' signals
            opportunities.sort((a, b) => b.confidence - a.confidence);
            setVolatilityRecommendations(opportunities.slice(0, 5)); // Top 5 opportunities

        } catch (error) {
            console.error('Error scanning volatility opportunities:', error);
        } finally {
            setIsScanning(false);
            setStatus('Volatility scan completed');
        }
    };

    // Calculate trends for a specific symbol's data
    const calculateTrendsForSymbol = (symbolData: Array<{ time: number, price: number, close: number }>) => {
        const trends = {
            '500': { trend: 'NEUTRAL', value: 0 },
            '1000': { trend: 'NEUTRAL', value: 0 },
            '1500': { trend: 'NEUTRAL', value: 0 },
            '2000': { trend: 'NEUTRAL', value: 0 },
            '3000': { trend: 'NEUTRAL', value: 0 },
            '4000': { trend: 'NEUTRAL', value: 0 }
        };

        const timeframeConfigs = {
            '500': { requiredTicks: 500, smoothingPeriod: 15 },
            '1000': { requiredTicks: 1000, smoothingPeriod: 20 },
            '1500': { requiredTicks: 1500, smoothingPeriod: 25 },
            '2000': { requiredTicks: 2000, smoothingPeriod: 25 },
            '3000': { requiredTicks: 3000, smoothingPeriod: 30 },
            '4000': { requiredTicks: 4000, smoothingPeriod: 35 }
        };

        Object.entries(timeframeConfigs).forEach(([tickCountStr, config]) => {
            const recentTicks = symbolData.slice(-config.requiredTicks);

            if (recentTicks.length >= Math.min(15, config.requiredTicks)) {
                const tickPrices = recentTicks.map(tick => tick.price);
                const smoothedPrices = applySuperSmoother(tickPrices, config.smoothingPeriod);
                const decycledPrices = applyDecycler(smoothedPrices, Math.max(10, config.smoothingPeriod));
                const hmaPeriod = Math.max(8, Math.min(Math.floor(decycledPrices.length * 0.3), 25));
                const hmaValue = calculateHMA(decycledPrices, hmaPeriod);

                if (hmaValue !== null) {
                    let trend = 'NEUTRAL';
                    const hmaSlopeLookback = Math.max(3, Math.floor(hmaPeriod / 4));
                    const prevHMA = calculateHMA(decycledPrices.slice(0, -hmaSlopeLookback), hmaPeriod);
                    const hmaSlope = prevHMA !== null ? hmaValue - prevHMA : 0;
                    const currentPrice = decycledPrices[decycledPrices.length - 1];
                    const priceAboveHMA = currentPrice > hmaValue;

                    const priceRange = Math.max(...decycledPrices.slice(-Math.min(50, decycledPrices.length))) -
                                     Math.min(...decycledPrices.slice(-Math.min(50, decycledPrices.length)));
                    const timeframeMultiplier = config.requiredTicks / 60;
                    const adaptiveThreshold = priceRange * (0.05 + timeframeMultiplier * 0.02);
                    const slopeThreshold = Math.max(0.000005, adaptiveThreshold * 0.2);

                    const trendStrength = Math.abs(hmaSlope) / slopeThreshold;

                    if (trendStrength > 1.2) {
                        if (hmaSlope > slopeThreshold && priceAboveHMA) {
                            trend = 'BULLISH';
                        } else if (hmaSlope < -slopeThreshold && !priceAboveHMA) {
                            trend = 'BEARISH';
                        }
                    }

                    trends[tickCountStr as keyof typeof trends] = {
                        trend,
                        value: Number(hmaValue.toFixed(5))
                    };
                }
            }
        });

        return trends;
    };

    // Get recommendation for calculated trends
    const getRecommendationForTrends = (trends: any) => {
        const trendCounts = {
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0
        };

        Object.entries(trends).forEach(([timeframe, trendData]: [string, any]) => {
            const { trend } = trendData;
            if (trend === 'BULLISH') trendCounts.bullishCount++;
            else if (trend === 'BEARISH') trendCounts.bearishCount++;
            else trendCounts.neutralCount++;
        });

        const totalTrends = Object.keys(trends).length;
        const alignedBullish = trendCounts.bullishCount;
        const alignedBearish = trendCounts.bearishCount;

        let recommendation: 'RISE' | 'FALL' | 'WAIT' = 'WAIT';
        let confidence = 0;
        let alignedTrends = 0;
        let reasoning = '';

        if (alignedBullish >= 3) {
            recommendation = 'RISE';
            alignedTrends = alignedBullish;
            confidence = Math.min(95, (alignedBullish / totalTrends) * 100);
            reasoning = `${alignedBullish} out of ${totalTrends} timeframes bullish`;
        } else if (alignedBearish >= 3) {
            recommendation = 'FALL';
            alignedTrends = alignedBearish;
            confidence = Math.min(95, (alignedBearish / totalTrends) * 100);
            reasoning = `${alignedBearish} out of ${totalTrends} timeframes bearish`;
        } else if (alignedBullish === 2 && alignedBearish <= 1) {
            recommendation = 'RISE';
            alignedTrends = alignedBullish;
            confidence = 65;
            reasoning = `${alignedBullish} out of ${totalTrends} timeframes bullish (moderate)`;
        } else if (alignedBearish === 2 && alignedBullish <= 1) {
            recommendation = 'FALL';
            alignedTrends = alignedBearish;
            confidence = 65;
            reasoning = `${alignedBearish} out of ${totalTrends} timeframes bearish (moderate)`;
        } else {
            alignedTrends = Math.max(alignedBullish, alignedBearish);
            confidence = 30;
            reasoning = 'Mixed signals across timeframes';
        }

        return {
            recommendation,
            confidence,
            alignedTrends,
            totalTrends,
            reasoning
        };
    };


    return (
        <div className="ml-trader">
            <div className="ml-trader__header">
                <Text size="xl" weight="bold">
                    Rise/Fall Trader
                </Text>
                <div className="ml-trader__status">
                    <Text size="sm" color={is_running ? 'success' : 'general'}>
                        {is_running ? 'Active' : 'Inactive'}
                    </Text>
                </div>
            </div>

            <div className="ml-trader__controls">
                <div className="control-group">
                    <Text size="sm" weight="bold">Symbol</Text>
                    <select
                        value={symbol}
                        onChange={(e) => {
                            setSymbol(e.target.value);
                            if (e.target.value && !tickStreamIdRef.current) {
                                fetchHistoricalTicks(e.target.value);
                            }
                        }}
                    >
                        <option value="">Select Symbol</option>
                        {VOLATILITY_INDICES.map(vol => (
                            <option key={vol.value} value={vol.value}>
                                {vol.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="control-group">
                    <Text size="sm" weight="bold">Stake ({account_currency})</Text>
                    <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={stake}
                        onChange={(e) => setStake(parseFloat(e.target.value) || 1)}
                    />
                </div>

                <div className="control-group">
                    <Text size="sm" weight="bold">Duration</Text>
                    <input
                        type="number"
                        min="1"
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                    />
                    <select
                        value={durationType}
                        onChange={(e) => setDurationType(e.target.value)}
                    >
                        <option value="t">Ticks</option>
                    </select>
                </div>

                <div className="control-group">
                    <label>Base Stake</label>
                    <input
                        type="number"
                        value={baseStake}
                        onChange={(e) => setBaseStake(Number(e.target.value))}
                        min="0.1"
                        step="0.1"
                    />
                </div>

                <div className="control-group">
                    <label>
                        <input
                            type="checkbox"
                            checked={allowEquals}
                            onChange={(e) => setAllowEquals(e.target.checked)}
                        />
                        Allow Equals (CALLE/PUTE)
                    </label>
                </div>
            </div>

            <div className="ml-trader__market-info">
                <div className="live-data-section">
                    <div className="live-price">
                        <Text size="sm" weight="bold">
                            Current Price: {currentPrice.toFixed(5)}
                        </Text>
                        <Text size="sm">
                            Ticks Processed: {ticksProcessed}
                        </Text>
                        <Text size="sm">
                            Entry Spot: {entrySpot.toFixed(5)}
                        </Text>
                    </div>

                    {/* Rise/Fall Analytics borrowed from volatility analyzer */}
                    <div className="rise-fall-analytics">
                        <h3>Rise/Fall Analysis</h3>
                        <div className="analytics-grid">
                            <div className="analytics-item">
                                <div className="progress-item">
                                    <div className="progress-label">
                                        <span>Rise</span>
                                        <span className="progress-percentage">{risePercentage}%</span>
                                    </div>
                                    <div className="progress-bar">
                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: `${risePercentage}%`,
                                                backgroundColor: '#4CAF50'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="analytics-item">
                                <div className="progress-item">
                                    <div className="progress-label">
                                        <span>Fall</span>
                                        <span className="progress-percentage">{fallPercentage}%</span>
                                    </div>
                                    <div className="progress-bar">
                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: `${fallPercentage}%`,
                                                backgroundColor: '#f44336'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tick Stream Display */}
                    <div className="tick-stream">
                        <h4>Last 10 Ticks Pattern:</h4>
                        <div className="pattern-grid">
                            {tickStream.slice(-10).map((tick, index) => (
                                <div
                                    key={index}
                                    className={`digit-item ${tick.direction === 'R' ? 'rise' : tick.direction === 'F' ? 'fall' : 'neutral'}`}
                                >
                                    {tick.direction}
                                </div>
                            ))}
                        </div>
                        <div className="pattern-info">
                            Recent pattern: {tickStream.slice(-10).map(t => t.direction).join('')}
                        </div>
                    </div>
                </div>
            </div>

            {/* Volatility Scanner Recommendations */}
            {volatilityRecommendations.length > 0 && (
                <div className="volatility-recommendations">
                    <h3>Volatility Opportunities</h3>
                    <div className="recommendations-grid">
                        {volatilityRecommendations.slice(0, 3).map((rec, index) => (
                            <div key={rec.symbol} className="recommendation-card">
                                <div className="rec-header">
                                    <span className="symbol">{rec.displayName}</span>
                                    <span className={`rank rank-${index + 1}`}>#{index + 1}</span>
                                </div>
                                <div className="rec-stats">
                                    <div className={`stat ${rec.risePercentage > rec.fallPercentage ? 'dominant' : ''}`}>
                                        <span className="label">Rise:</span>
                                        <span className="value">{rec.risePercentage.toFixed(1)}%</span>
                                    </div>
                                    <div className={`stat ${rec.fallPercentage > rec.risePercentage ? 'dominant' : ''}`}>
                                        <span className="label">Fall:</span>
                                        <span className="value">{rec.fallPercentage.toFixed(1)}%</span>
                                    </div>
                                </div>
                                <button
                                    className="select-symbol-btn"
                                    onClick={() => {
                                        setSymbol(rec.symbol);
                                        setStatus(`Selected ${rec.displayName} from volatility scanner`);
                                        // Trigger tick updates for the new symbol
                                        if (preloadedData[rec.symbol] && preloadedData[rec.symbol].length > 0) {
                                            setTickData(preloadedData[rec.symbol]);
                                            updateEhlersTrends(preloadedData[rec.symbol]);
                                        } else {
                                            fetchHistoricalTicks(rec.symbol);
                                        }
                                        startTicks(rec.symbol);
                                        // Set contract type based on signal
                                        if (rec.risePercentage > rec.fallPercentage) {
                                            setContractType('CALL');
                                        } else {
                                            setContractType('PUT');
                                        }
                                    }}
                                >
                                    Select Symbol
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Market Recommendation Display */}
            {marketRecommendation && (
                <div className='ml-trader__recommendation'>
                    <h3>{localize('Current Symbol Recommendation')}</h3>
                    <div className={`recommendation-card ${marketRecommendation.recommendation.toLowerCase()}`}>
                        <div className='recommendation-header'>
                            <span className='symbol'>{marketRecommendation.symbol}</span>
                            <span className={`signal ${marketRecommendation.recommendation.toLowerCase()}`}>
                                {marketRecommendation.recommendation}
                            </span>
                        </div>
                        <div className='recommendation-details'>
                            <div className='confidence'>
                                <span>Confidence: {marketRecommendation.confidence.toFixed(1)}%</span>
                            </div>
                            <div className='alignment'>
                                <span>Aligned Trends: {marketRecommendation.alignedTrends}/{marketRecommendation.totalTrends}</span>
                            </div>
                        </div>
                        {marketRecommendation.confidence >= 70 && (
                            <button
                                className={`use-recommendation-btn ${marketRecommendation.recommendation.toLowerCase()}`}
                                onClick={() => {
                                    if (marketRecommendation.recommendation === 'RISE') {
                                        setContractType('CALL');
                                    } else if (marketRecommendation.recommendation === 'FALL') {
                                        setContractType('PUT');
                                    }
                                }}
                            >
                                Use Recommendation ({marketRecommendation.recommendation})
                            </button>
                        )}
                    </div>
                    <div className='recommendation-reasoning'>
                        <small>{marketRecommendation.reasoning}</small>
                    </div>
                </div>
            )}


            <div className="ml-trader__trend-analysis">
                <h3>{localize('Hull Moving Average Trend Analysis')}</h3>
                <div className='trend-timeframes'>
                    {Object.entries(hullTrends).map(([timeframe, trendData]) => (
                        <div key={timeframe} className={`trend-item trend-${trendData.trend.toLowerCase()}`}>
                            <span className='timeframe'>{timeframe} Tick:</span>
                            <span className='trend'>{trendData.trend}</span>
                            <span className='value'>({trendData.value.toFixed(5)})</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="ml-trader__actions">
                <div className="contract-buttons">
                    <button
                        className="higher-btn"
                        onClick={() => {
                            setContractType('CALL');
                            if (!isAutoTrading) {
                                executeRiseFallTrade('RISE');
                            }
                        }}
                        disabled={!symbol || isAutoTrading}
                    >
                        Rise (Manual)
                    </button>
                    <button
                        className="lower-btn"
                        onClick={() => {
                            setContractType('PUT');
                            if (!isAutoTrading) {
                                executeRiseFallTrade('FALL');
                            }
                        }}
                        disabled={!symbol || isAutoTrading}
                    >
                        Fall (Manual)
                    </button>

                    <button
                        className={`start-trading-btn ${isAutoTrading ? 'trading-active' : ''}`}
                        onClick={isAutoTrading ? stopAutoTrading : startAutoTrading}
                        disabled={!symbol}
                    >
                        {isAutoTrading ? 'Stop Auto Trading' : 'Start Auto Trading'}
                    </button>
                </div>
            </div>

            <div className="ml-trader__statistics">
                <Text size="sm" weight="bold">Trading Statistics</Text>
                <div className="stats-grid">
                    <div className="stat-item">
                        <Text size="xs">Total Runs</Text>
                        <Text size="sm" weight="bold">{totalRuns}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Won</Text>
                        <Text size="sm" weight="bold" color="success">{contractsWon}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Lost</Text>
                        <Text size="sm" weight="bold" color="danger">{contractsLost}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Total Stake</Text>
                        <Text size="sm" weight="bold">{totalStake.toFixed(2)} {account_currency}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Total Payout</Text>
                        <Text size="sm" weight="bold">{totalPayout.toFixed(2)} {account_currency}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">P&L</Text>
                        <Text
                            size="sm"
                            weight="bold"
                            color={totalProfitLoss >= 0 ? 'success' : 'danger'}
                        >
                            {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} {account_currency}
                        </Text>
                    </div>
                </div>
            </div>

            {status && (
                <div className="ml-trader__status-message">
                    <Text size="sm">{status}</Text>
                </div>
            )}

            {tradeHistory.length > 0 && (
                <div className="ml-trader__history">
                    <Text size="sm" weight="bold">Recent Trades</Text>
                    <div className="history-list">
                        {tradeHistory.slice(0, 5).map((trade, index) => (
                            <div key={trade.id || index} className="history-item">
                                <Text size="xs">
                                    {trade.contract_type} - {trade.stake} {account_currency}
                                </Text>
                                <Text size="xs" color="general">
                                    {new Date(trade.timestamp).toLocaleTimeString()}
                                </Text>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

export default MLTrader;