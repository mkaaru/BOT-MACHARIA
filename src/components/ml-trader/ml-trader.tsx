
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Mock TradingEngine for demonstration purposes. In a real scenario, this would be imported and configured.
const tradingEngine = {
    isEngineConnected: () => true, // Assume connected for this example
    getProposal: async (params: any) => {
        // Simulate a successful proposal response
        return {
            proposal: {
                id: `proposal_${Math.random().toString(36).substr(2, 9)}`,
                ask_price: parseFloat((params.amount * 1.95).toFixed(2)), // Simulate a price
                longcode: `${params.contract_type} ${params.symbol}`,
                // Add other necessary proposal fields if needed
            },
            error: null,
        };
    },
    buyContract: async (proposal_id: string, price: number) => {
        // Simulate a successful contract purchase
        const contract_id = `contract_${Math.random().toString(36).substr(2, 9)}`;
        return {
            buy: {
                id: contract_id,
                contract_id: contract_id,
                buy_price: price,
                payout: price * 1.95, // Simulate payout
                transaction_id: `tx_${Math.random().toString(36).substr(2, 9)}`,
                longcode: 'Simulated Rise/Fall Contract',
                shortcode: 'RISEFALL',
                start_time: Math.floor(Date.now() / 1000),
                symbol: 'R_100', // Example symbol
                contract_type: 'CALL',
                currency: 'USD',
                // Add other necessary purchase receipt fields
            },
            error: null,
        };
    },
    subscribeToContract: async (contract_id: string) => {
        // Simulate subscription
        console.log(`Subscribing to contract ${contract_id}`);
        return { error: null };
    },
    getWebSocket: () => {
        // In a real implementation, this would return the actual WebSocket connection
        // For this mock, we'll simulate it by returning an object with addEventListener and removeEventListener
        let listeners: { [key: string]: ((event: MessageEvent) => void)[] } = {};
        return {
            addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
                if (!listeners[type]) listeners[type] = [];
                listeners[type].push(listener);
            },
            removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
                if (listeners[type]) {
                    listeners[type] = listeners[type].filter(l => l !== listener);
                }
            },
            // Mock dispatchEvent to simulate receiving messages
            dispatchEvent: (event: MessageEvent) => {
                if (listeners['message']) {
                    listeners['message'].forEach(listener => listener(event));
                }
            }
        };
    },
};

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

// Safe version of tradeOptionToBuy without Blockly dependencies
const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy: any = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis || 'stake',
            contract_type,
            currency: trade_option.currency,
            symbol: trade_option.symbol,
        },
    };

    // Add duration
    if (trade_option.duration !== undefined && trade_option.duration_unit !== undefined) {
        buy.parameters.duration = trade_option.duration;
        buy.parameters.duration_unit = trade_option.duration_unit;
    }

    return buy;
};

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions, client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

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
    const [entrySpot, setEntrySpot] = useState<number>(0); // For Rise/Fall mode
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Hull Moving Average trend analysis state - using 1000 tick increments for stability
    const [hullTrends, setHullTrends] = useState({
        '1000': { trend: 'NEUTRAL', value: 0 },
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

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    // Volatility scanner state
    const [isScanning, setIsScanning] = useState(false);
    const [volatilityRecommendations, setVolatilityRecommendations] = useState<any[]>([]);
    const [preloadedData, setPreloadedData] = useState<{[key: string]: Array<{ time: number, price: number, close: number }>}>({});
    const [isPreloading, setIsPreloading] = useState<boolean>(false);

    // State to track trend update counters for independent timing
    const [trendUpdateCounters, setTrendUpdateCounters] = useState({
        '1000': 0,
        '2000': 0,
        '3000': 0,
        '4000': 0
    });

    // State to store previous trend values for smoothing
    const [previousTrends, setPreviousTrends] = useState({
        '1000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
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
            '1000': prev['1000'] + 1,
            '2000': prev['2000'] + 1,
            '3000': prev['3000'] + 1,
            '4000': prev['4000'] + 1
        }));

        const newTrends = { ...hullTrends };

        // Define tick count requirements and update frequencies for different timeframes
        // Using 1000 tick increments for more stable trend detection
        const timeframeConfigs = {
            '1000': { requiredTicks: 1000, updateEvery: 10, smoothingPeriod: 20 },  // Update every 10 ticks
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

        const volatilitySymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'BOOM500', 'BOOM1000', 'CRASH500', 'CRASH1000', 'stpRNG'];
        const preloadedDataMap: {[key: string]: Array<{ time: number, price: number, close: number }>} = {};

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
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol) || s.symbol.startsWith('BOOM') || s.symbol.startsWith('CRASH') || s.symbol === 'stpRNG')
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

    // Rise/Fall mode - tick-based contracts using real Deriv API
    const purchaseRiseFallContract = async () => {
        await authorizeIfNeeded();

        try {
            // Map contract types correctly for Rise/Fall
            let apiContractType = contractType;
            if (contractType === 'CALL') apiContractType = 'CALL'; // Rise
            if (contractType === 'PUT') apiContractType = 'PUT'; // Fall

            setStatus(`Getting proposal for ${apiContractType} contract...`);

            // Get proposal using real Deriv API
            const proposalParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: apiContractType,
                currency: account_currency,
                duration: 1, // Duration is 1 tick for Rise/Fall
                duration_unit: 't', // tick unit
                symbol: symbol,
            };

            console.log('Getting proposal for Rise/Fall:', proposalParams);

            const proposalResponse = await apiRef.current.send(proposalParams);

            if (proposalResponse.error) {
                setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                console.error('Proposal error:', proposalResponse.error);
                return;
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                setStatus('No proposal received');
                return;
            }

            setStatus(`Purchasing ${apiContractType} contract...`);

            // Buy contract using real Deriv API
            const buyParams = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            const buyResponse = await apiRef.current.send(buyParams);

            if (buyResponse.error) {
                setStatus(`Trade failed: ${buyResponse.error.message}`);
                console.error('Buy error:', buyResponse.error);
                return;
            }

            const purchase = buyResponse.buy;
            console.log('Rise/Fall Contract purchased:', purchase);

            // Update statistics
            setTotalStake(prev => prev + stake);
            setTotalRuns(prev => prev + 1);

            // Add to trade history
            const tradeRecord = {
                id: purchase.contract_id,
                symbol: symbol,
                contract_type: apiContractType,
                buy_price: purchase.buy_price,
                payout: purchase.payout,
                timestamp: new Date().toISOString(),
                status: 'purchased'
            };

            setTradeHistory(prev => [tradeRecord, ...prev.slice(0, 99)]);

            setStatus(`${apiContractType} contract purchased successfully! Contract ID: ${purchase.contract_id}`);

            // Subscribe to contract updates
            try {
                const contractSubscription = await apiRef.current.send({
                    proposal_open_contract: 1,
                    contract_id: purchase.contract_id,
                    subscribe: 1
                });

                if (contractSubscription.error) {
                    console.error('Contract subscription error:', contractSubscription.error);
                } else {
                    console.log('Subscribed to contract updates');
                }
            } catch (subscriptionError) {
                console.error('Error subscribing to contract:', subscriptionError);
            }

        } catch (error) {
            console.error('Purchase error:', error);
            setStatus(`Purchase failed: ${error}`);
        }
    };

    const handleStartTrading = () => {
        if (is_running) {
            setIsRunning(false);
            stopFlagRef.current = true;
            setStatus('Trading stopped');
        } else {
            setIsRunning(true);
            stopFlagRef.current = false;
            setStatus('Trading started');
        }
    };

    const handleManualTrade = (tradeType: string) => {
        setContractType(tradeType);
        purchaseRiseFallContract();
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
                            startTicks(e.target.value);
                        }}
                    >
                        {symbols.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
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
            </div>

            <div className="ml-trader__market-info">
                <div className="market-data">
                    <Text size="sm" weight="bold">Current Price: {currentPrice.toFixed(5)}</Text>
                    <Text size="sm">Entry Spot: {entrySpot.toFixed(5)}</Text>
                    <Text size="sm">Ticks Processed: {ticksProcessed}</Text>
                </div>
            </div>

            <div className="ml-trader__trend-analysis">
                <Text size="sm" weight="bold">Hull Moving Average Trend Analysis</Text>
                <div className="trend-grid">
                    {Object.entries(hullTrends).map(([period, data]) => (
                        <div key={period} className="trend-item">
                            <div className="trend-period">{period} Ticks</div>
                            <div className={`trend-indicator ${data.trend.toLowerCase()}`}>
                                <span className="trend-arrow">
                                    {data.trend === 'BULLISH' ? '↗️' : data.trend === 'BEARISH' ? '↘️' : '➡️'}
                                </span>
                                <span className="trend-text">{data.trend}</span>
                            </div>
                            <div className="trend-value">HMA: {data.value.toFixed(5)}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="ml-trader__actions">
                <div className="contract-buttons">
                    <button
                        className="contract-btn rise-btn"
                        onClick={() => handleManualTrade('CALL')}
                        disabled={is_running}
                    >
                        <TrendingUp size={16} />
                        Rise
                    </button>
                    <button
                        className="contract-btn fall-btn"
                        onClick={() => handleManualTrade('PUT')}
                        disabled={is_running}
                    >
                        <TrendingDown size={16} />
                        Fall
                    </button>
                </div>

                <button
                    className={`trading-btn ${is_running ? 'stop' : 'start'}`}
                    onClick={handleStartTrading}
                >
                    {is_running ? (
                        <>
                            <Square size={16} />
                            Stop Trading
                        </>
                    ) : (
                        <>
                            <Play size={16} />
                            Start Auto Trading
                        </>
                    )}
                </button>
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
                                    {trade.contract_type} - {trade.buy_price} {account_currency}
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
