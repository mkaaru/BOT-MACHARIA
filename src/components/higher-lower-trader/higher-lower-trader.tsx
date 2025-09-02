import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './higher-lower-trader.scss';

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

    // Add barrier if provided (for Higher/Lower contracts)
    if (trade_option.barrier !== undefined && trade_option.barrier !== '' && trade_option.barrier !== '0') {
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

    // Trading mode state (Higher/Lower or Rise/Fall)
    const [tradingMode, setTradingMode] = useState<'HIGHER_LOWER' | 'RISE_FALL'>('HIGHER_LOWER');


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
                        if (tradingMode === 'RISE_FALL') {
                            setEntrySpot(quote); // Update entry spot for Rise/Fall
                        }
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

            const purchase_receipt = buyResponse.buy;
            const purchase_price = purchase_receipt.buy_price;
            const potential_payout = purchase_receipt.payout;
            const contract_id = purchase_receipt.contract_id;

            console.log('Rise/Fall contract purchased:', {
                contract_id,
                purchase_price,
                potential_payout,
                type: apiContractType
            });

            setStatus(`${apiContractType} contract purchased! ID: ${contract_id}`);
            setPotentialPayout(potential_payout);
            setContractValue(purchase_price);

            // Update trade statistics
            setTotalStake(prev => prev + purchase_price);
            setTotalRuns(prev => prev + 1);

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

                        setCurrentProfit(profit);
                        setContractValue(contract.bid_price || purchase_price);

                        // Update contract duration display
                        if (contract.date_expiry && contract.current_spot_time) {
                            const expiryTime = contract.date_expiry * 1000;
                            const currentTime = contract.current_spot_time * 1000;
                            const remainingTime = Math.max(0, expiryTime - currentTime);
                            const minutes = Math.floor(remainingTime / 60000);
                            const seconds = Math.floor((remainingTime % 60000) / 1000);
                            setContractDuration(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:00`);
                        }

                        if (contractStatus === 'sold' || contractStatus === 'won' || contractStatus === 'lost') {
                            const final_profit = contract.bid_price - purchase_price;
                            const won = final_profit > 0;

                            if (won) {
                                setContractsWon(prev => prev + 1);
                                lastOutcomeWasLossRef.current = false;
                                // Reset stake to base stake on win
                                setStake(baseStake);
                            } else {
                                setContractsLost(prev => prev + 1);
                                lastOutcomeWasLossRef.current = true;
                                // Apply martingale on loss
                                setStake(prevStake => Number((prevStake * martingaleMultiplier).toFixed(2)));
                            }

                            setTotalPayout(prev => prev + (contract.bid_price || 0));
                            setTotalProfitLoss(prev => prev + final_profit);

                            setStatus(`Rise/Fall contract ${won ? 'WON' : 'LOST'}! P&L: ${final_profit.toFixed(2)} ${account_currency}`);

                            // Check stop on profit condition
                            if (useStopOnProfit && final_profit > 0 && (totalProfitLoss + final_profit) >= targetProfit) {
                                setStatus(`Target profit reached! Stopping...`);
                                handleStop();
                            }

                            // Remove event listener after contract completion
                            apiRef.current?.connection?.removeEventListener('message', onMessage);
                        }
                    }
                } catch (error) {
                    console.error('Error parsing Rise/Fall contract monitor message:', error);
                }
            };

            apiRef.current?.connection?.addEventListener('message', onMessage);

        } catch (error: any) {
            console.error('Rise/Fall contract monitor setup error:', error);
            setStatus(`Contract monitoring failed: ${error.message || 'Unknown error'}`);
        }
    };

    // Monitor contract and update UI (fallback for Higher/Lower mode)
    const monitorContract = async (contract_id: string, purchase_price: number, potential_payout: number) => {
        try {
            const response = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id,
                subscribe: 1
            });

            if (response.error) {
                console.error('Monitor contract error:', response.error);
                return;
            }

            const onMessage = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data);
                    if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.contract_id === contract_id) {
                        const contract = data.proposal_open_contract;
                        const profit = contract.bid_price ? contract.bid_price - purchase_price : 0;
                        const status = contract.status;

                        setCurrentProfit(profit);
                        setContractValue(contract.bid_price || purchase_price);

                        if (status === 'sold') {
                            const final_profit = contract.bid_price - purchase_price;
                            const won = final_profit > 0;

                            if (won) {
                                setContractsWon(prev => prev + 1);
                                lastOutcomeWasLossRef.current = false;
                            } else {
                                setContractsLost(prev => prev + 1);
                                lastOutcomeWasLossRef.current = true;
                                setStake(prevStake => Number((prevStake * martingaleMultiplier).toFixed(2)));
                            }

                            setTotalPayout(prev => prev + (contract.bid_price || 0));
                            setTotalProfitLoss(prev => prev + final_profit);

                            setStatus(`Contract ${won ? 'WON' : 'LOST'}! P&L: ${final_profit.toFixed(2)} ${account_currency}`);

                            if (useStopOnProfit && final_profit > 0 && (totalProfitLoss + final_profit) >= targetProfit) {
                                setStatus(`Target profit reached! Stopping...`);
                                handleStop();
                            }

                            apiRef.current?.connection?.removeEventListener('message', onMessage);
                        }
                    }
                } catch (error) {
                    console.error('Error parsing contract monitor message:', error);
                }
            };

            apiRef.current?.connection?.addEventListener('message', onMessage);

        } catch (error: any) {
            console.error('Monitor contract setup error:', error);
        }
    };

    // Placeholder for purchaseHigherLowerContract - it should exist in the original code.
    // If not, a basic implementation or error handling would be needed.
    const purchaseHigherLowerContract = async () => {
        await authorizeIfNeeded();

        let apiContractType = contractType;
        if (contractType === 'CALL') apiContractType = 'CALL'; // Higher
        else if (contractType === 'PUT') apiContractType = 'PUT'; // Lower

        const trade_option: any = {
            amount: stake,
            basis: 'stake',
            currency: account_currency,
            symbol,
            duration: durationType === 's' ? duration : duration * 60,
            duration_unit: durationType,
        };

        if (barrier && barrier !== '0') {
            trade_option.barrier = barrier;
        }

        const buy_request = tradeOptionToBuy(apiContractType, trade_option);
        setStatus(`Purchasing ${apiContractType === 'CALL' ? 'Higher' : 'Lower'} contract for ${stake} ${account_currency}...`);

        const response = await apiRef.current.send(buy_request);
        if (response.error) {
            console.error('Purchase error:', response.error);
            throw response.error;
        }

        const buy = response.buy;
        setStatus(`${apiContractType === 'CALL' ? 'Higher' : 'Lower'} contract purchased: ${buy?.longcode || apiContractType}`);
        setTotalStake(prev => prev + Number(stake));
        setTotalRuns(prev => prev + 1);

        // Monitor contract
        await monitorContract(buy.contract_id, buy.buy_price, buy.payout);
        return buy;
    };


    const executeTrade = async () => {
        try {
            if (tradingMode === 'RISE_FALL') {
                await purchaseRiseFallContract();
            } else {
                await purchaseHigherLowerContract();
            }
        } catch (error: any) {
            console.error('Execute trade error:', error);
            setStatus(`Trade execution failed: ${error.message || 'Unknown error'}`);
        }
    };

    const executeSingleTrade = async () => {
        setIsRunning(true);
        stopFlagRef.current = false;

        try {
            if (tradingMode === 'RISE_FALL') {
                // For Rise/Fall, execute directly
                await purchaseRiseFallContract();
            } else {
                // For Higher/Lower, use existing logic
                await executeTrade();
            }
        } catch (error: any) {
            console.error('Single trade error:', error);
            setStatus(`Single trade failed: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    const handleStart = async () => {
        if (is_running) {
            handleStop();
            return;
        }

        if (!symbol) {
            setStatus('Please select a symbol');
            return;
        }

        setIsRunning(true);
        stopFlagRef.current = false;
        setStatus('Starting trading...');

        try {
            await authorizeIfNeeded();

            // Check API connection for Rise/Fall mode
            if (tradingMode === 'RISE_FALL' && !apiRef.current) {
                setStatus('API connection not available. Please try again.');
                setIsRunning(false);
                return;
            }

            const runLoop = async () => {
                while (!stopFlagRef.current) {
                    try {
                        if (tradingMode === 'HIGHER_LOWER') {
                            // Check if Hull trends support our trade direction
                            const trendsSupport = checkTrendSupport();
                            if (!trendsSupport) {
                                setStatus('Waiting for better trend conditions...');
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                continue;
                            }
                            await executeTrade();
                        } else if (tradingMode === 'RISE_FALL') {
                            // Execute Rise/Fall trade directly
                            await purchaseRiseFallContract();
                        }

                        if (!stopFlagRef.current) {
                            setStatus('Waiting for next trade opportunity...');
                            // Wait for contract completion before next trade
                            await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay between trades
                        }
                    } catch (error: any) {
                        console.error('Trading loop error:', error);
                        setStatus(`Trade error: ${error.message}`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            };

            await runLoop();

        } catch (error: any) {
            console.error('Trading start error:', error);
            setStatus(`Failed to start trading: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    // Placeholder for checkTrendSupport - it should exist in the original code.
    // If not, a basic implementation or error handling would be needed.
    const checkTrendSupport = () => {
        // This function should return true if the current trends support the desired trade direction (Higher/Lower).
        // For now, we'll return true to allow trading without trend confirmation.
        // In a real implementation, this would check `hullTrends` and `contractType`.
        return true;
    };

    // Placeholder for handleStop - it should exist in the original code.
    // If not, a basic implementation or error handling would be needed.
    const handleStop = () => {
        stopTrading();
    };

    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        stopTicks();
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');
    };

    // Calculate statistics
    const calculateStats = useCallback(() => {
        const totalTrades = tradeHistory.length;
        const wins = tradeHistory.filter(trade => trade.result === 'win').length;
        const losses = tradeHistory.filter(trade => trade.result === 'loss').length;
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

        const totalStake = tradeHistory.reduce((sum, trade) => sum + trade.stake, 0);
        const totalPayout = tradeHistory.reduce((sum, trade) => {
          return sum + (trade.result === 'win' ? trade.payout : 0);
        }, 0);

        // Calculate net profit/loss correctly
        const totalProfit = tradeHistory.reduce((sum, trade) => {
          if (trade.result === 'win') {
            return sum + (trade.payout - trade.stake); // Only profit portion
          } else {
            return sum - trade.stake; // Loss of stake
          }
        }, 0);

        return {
          totalTrades,
          wins,
          losses,
          winRate: Math.round(winRate * 100) / 100,
          totalStake: Math.round(totalStake * 100) / 100,
          totalPayout: Math.round(totalPayout * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100
        };
      }, [tradeHistory]);

    const stats = useMemo(() => calculateStats(), [calculateStats, tradeHistory]);

    const resetStats = () => {
        setTotalStake(0);
        setTotalPayout(0);
        setTotalRuns(0);
        setContractsWon(0);
        setContractsLost(0);
        setTotalProfitLoss(0);
        setTradeHistory([]);
    };

    // Get trading recommendation based on Hull trends - requires at least 3 trends to align
    const getTradingRecommendation = () => {
        const trends = Object.entries(hullTrends);
        const bullishCount = trends.filter(([_, data]) => data.trend === 'BULLISH').length;
        const bearishCount = trends.filter(([_, data]) => data.trend === 'BEARISH').length;
        const neutralCount = trends.filter(([_, data]) => data.trend === 'NEUTRAL').length;
        const totalTrends = trends.length;

        let recommendation = 'NEUTRAL';
        let confidence = 0;

        // Only provide recommendation when at least 3 trends align
        const minAlignedTrends = 3;

        if (bullishCount >= minAlignedTrends) {
            recommendation = 'HIGHER';
            confidence = totalTrends > 0 ? bullishCount / totalTrends : 0;
        } else if (bearishCount >= minAlignedTrends) {
            recommendation = 'LOWER';
            confidence = totalTrends > 0 ? bearishCount / totalTrends : 0;
        } else {
            // Not enough aligned trends - remain neutral
            recommendation = 'NEUTRAL';
            confidence = 0.5;
        }

        return {
            recommendation,
            confidence,
            alignedTrends: Math.max(bullishCount, bearishCount),
            requiredAlignment: minAlignedTrends
        };
    };

    // Auto contract type selection based on Hull trends
    const getRecommendedContractType = () => {
        const { recommendation } = getTradingRecommendation();
        if (recommendation === 'HIGHER') return 'CALL'; // CALL for Higher
        if (recommendation === 'LOWER') return 'PUT'; // PUT for Lower
        return contractType; // Keep current if neutral
    };

    // Scan all volatilities for recommendations
    const scanVolatilities = async () => {
        setIsScanning(true);
        setStatus('Scanning volatilities for trend alignment...');

        const recommendations: any[] = [];
        const minAlignedTrends = 3;

        for (const volatility of VOLATILITY_INDICES) {
            const symbolData = preloadedData[volatility.value];
            if (symbolData && symbolData.length >= 1000) { // Ensure enough data for analysis
                // Temporarily update hullTrends for this symbol to get its recommendation
                const tempHullTrends: { [key: string]: { trend: string; value: number } } = {};
                const tempTickData = symbolData.slice(-4000); // Use the most recent 4000 ticks

                // This requires a way to calculate trends for a specific symbol without affecting the main state.
                // For simplicity, we'll simulate by calling updateEhlersTrends with specific data.

                // --- SIMULATION of updateEhlersTrends for a specific symbol ---
                const simulatedHullTrends: { [key: string]: { trend: string; value: number } } = {};
                const simulatedPreviousTrends: { [key: string]: { trend: string; value: number; smoothedValue: number } } = {
                    '1000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
                    '2000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
                    '3000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 },
                    '4000': { trend: 'NEUTRAL', value: 0, smoothedValue: 0 }
                };
                const simulatedTrendUpdateCounters = { '1000': 0, '2000': 0, '3000': 0, '4000': 0 };
                const timeframeConfigs = {
                    '1000': { requiredTicks: 1000, updateEvery: 1, smoothingPeriod: 20 },
                    '2000': { requiredTicks: 2000, updateEvery: 1, smoothingPeriod: 25 },
                    '3000': { requiredTicks: 3000, updateEvery: 1, smoothingPeriod: 30 },
                    '4000': { requiredTicks: 4000, updateEvery: 1, smoothingPeriod: 35 }
                };

                Object.entries(timeframeConfigs).forEach(([tickCountStr, config]) => {
                    const recentTicks = tempTickData.slice(-config.requiredTicks);
                    if (recentTicks.length >= Math.min(15, config.requiredTicks)) {
                        const tickPrices = recentTicks.map(tick => tick.price);
                        const smoothedPrices = applySuperSmoother(tickPrices, config.smoothingPeriod);
                        const decycledPrices = applyDecycler(smoothedPrices, Math.max(10, config.smoothingPeriod));
                        const hmaPeriod = Math.max(8, Math.min(Math.floor(decycledPrices.length * 0.3), 25));
                        const hmaValue = calculateHMA(decycledPrices, hmaPeriod);

                        if (hmaValue !== null) {
                            const prevData = simulatedPreviousTrends[tickCountStr as keyof typeof simulatedPreviousTrends];
                            const smoothingFactor = 0.3;
                            const smoothedHMA = prevData.smoothedValue === 0 ? hmaValue :
                                              (smoothingFactor * hmaValue) + ((1 - smoothingFactor) * prevData.smoothedValue);

                            let trend = 'NEUTRAL';
                            const hmaSlopeLookback = Math.max(3, Math.floor(hmaPeriod / 4));
                            const prevHMA = calculateHMA(decycledPrices.slice(0, -hmaSlopeLookback), hmaPeriod);
                            const hmaSlope = prevHMA !== null ? smoothedHMA - prevHMA : 0;
                            const currentPrice = decycledPrices[decycledPrices.length - 1];
                            const priceAboveHMA = currentPrice > smoothedHMA;
                            const priceRange = Math.max(...decycledPrices.slice(-Math.min(50, decycledPrices.length))) -
                                             Math.min(...decycledPrices.slice(-Math.min(50, decycledPrices.length)));
                            const timeframeMultiplier = config.requiredTicks / 60;
                            const adaptiveThreshold = priceRange * (0.05 + timeframeMultiplier * 0.02);
                            const slopeThreshold = Math.max(0.000005, adaptiveThreshold * 0.2);
                            const trendStrength = Math.abs(hmaSlope) / slopeThreshold;
                            const minTrendStrength = prevData.trend === 'NEUTRAL' ? 1.2 : 0.8;

                            if (trendStrength > minTrendStrength) {
                                if (hmaSlope > slopeThreshold && priceAboveHMA) {
                                    trend = 'BULLISH';
                                } else if (hmaSlope < -slopeThreshold && !priceAboveHMA) {
                                    trend = 'BEARISH';
                                } else {
                                    trend = prevData.trend;
                                }
                            } else {
                                // Weak signal - maintain previous trend unless it's been neutral for a while
                                trend = prevData.trend !== 'NEUTRAL' ? prevData.trend : 'NEUTRAL';
                            }

                            if (trend !== prevData.trend && prevData.trend !== 'NEUTRAL') {
                                // Require stronger confirmation for trend reversals
                                const confirmationStrength = 1.5;
                                if (trendStrength < confirmationStrength) {
                                    trend = prevData.trend;
                                }
                            }
                            simulatedHullTrends[tickCountStr as keyof typeof simulatedHullTrends] = { trend, value: Number(smoothedHMA.toFixed(5)) };
                        }
                    }
                });
                // --- END SIMULATION ---

                const bullishCount = Object.values(simulatedHullTrends).filter(t => t.trend === 'BULLISH').length;
                const bearishCount = Object.values(simulatedHullTrends).filter(t => t.trend === 'BEARISH').length;
                const totalTrends = Object.keys(simulatedHullTrends).length;
                let recommendation = 'NEUTRAL';
                let confidence = 0;

                if (bullishCount >= minAlignedTrends) {
                    recommendation = 'HIGHER';
                    confidence = totalTrends > 0 ? bullishCount / totalTrends : 0;
                } else if (bearishCount >= minAlignedTrends) {
                    recommendation = 'LOWER';
                    confidence = totalTrends > 0 ? bearishCount / totalTrends : 0;
                }

                if (recommendation !== 'NEUTRAL') {
                    recommendations.push({
                        symbol: volatility.value,
                        label: volatility.label,
                        recommendation,
                        confidence,
                        alignedTrends: Math.max(bullishCount, bearishCount),
                        requiredAlignment: minAlignedTrends,
                        trends: simulatedHullTrends // Include trends for display
                    });
                }
            } else {
                console.log(`Not enough data for ${volatility.value} to perform scan.`);
            }
        }

        setVolatilityRecommendations(recommendations.sort((a, b) => b.confidence - a.confidence));
        setIsScanning(false);
        setStatus(recommendations.length > 0
            ? `Scan complete. Found ${recommendations.length} opportunities.`
            : 'Scan complete. No significant opportunities found.');
    };

    const selectVolatilityFromRecommendation = (rec: any) => {
        setSymbol(rec.symbol);
        // Set contract type based on recommendation, mapping 'HIGHER' to 'CALL' and 'LOWER' to 'PUT'
        setContractType(rec.recommendation === 'HIGHER' ? 'CALL' : 'PUT');
        setTradingMode('HIGHER_LOWER'); // Default to Higher/Lower mode

        // Use the data if available
        if (preloadedData[rec.symbol]) {
            setTickData(preloadedData[rec.symbol]);
            updateEhlersTrends(preloadedData[rec.symbol]);
        }

        startTicks(rec.symbol);
        setStatus(`Selected ${rec.symbol} with ${rec.recommendation} recommendation`);
    };

    // Check if user is authorized - check if balance is available and user is logged in
    const isAuthorized = client?.balance !== undefined && client?.balance !== null && client?.is_logged_in;

    // Get available symbols based on trading mode
    const getAvailableSymbols = () => {
        if (tradingMode === 'RISE_FALL') {
            // Rise/Fall works with 1-second volatility indices
            return [
                { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
                { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
                { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
                { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
                { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
                { value: '1HZ150V', label: 'Volatility 150 (1s) Index' },
                { value: '1HZ200V', label: 'Volatility 200 (1s) Index' },
                { value: '1HZ250V', label: 'Volatility 250 (1s) Index' },
                { value: '1HZ300V', label: 'Volatility 300 (1s) Index' },
                // Some regular volatilities also support Rise/Fall
                { value: 'R_10', label: 'Volatility 10 Index' },
                { value: 'R_25', label: 'Volatility 25 Index' },
                { value: 'R_50', label: 'Volatility 50 Index' },
                { value: 'R_75', label: 'Volatility 75 Index' },
                { value: 'R_100', label: 'Volatility 100 Index' },
            ];
        } else {
            // Higher/Lower mode symbols - now includes Rise/Fall volatilities
            return [
                // 1-second volatility indices (from Rise/Fall)
                { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
                { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
                { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
                { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
                { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
                { value: '1HZ150V', label: 'Volatility 150 (1s) Index' },
                { value: '1HZ200V', label: 'Volatility 200 (1s) Index' },
                { value: '1HZ250V', label: 'Volatility 250 (1s) Index' },
                { value: '1HZ300V', label: 'Volatility 300 (1s) Index' },
                // Regular volatility indices
                { value: 'R_10', label: 'Volatility 10 Index' },
                { value: 'R_25', label: 'Volatility 25 Index' },
                { value: 'R_50', label: 'Volatility 50 Index' },
                { value: 'R_75', label: 'Volatility 75 Index' },
                { value: 'R_100', label: 'Volatility 100 Index' },
                // Other indices
                { value: 'BOOM500', label: 'Boom 500 Index' },
                { value: 'BOOM1000', label: 'Boom 1000 Index' },
                { value: 'CRASH500', label: 'Crash 500 Index' },
                { value: 'CRASH1000', label: 'Crash 1000 Index' },
                { value: 'stpRNG', label: 'Step Index' },
            ];
        }
    };

    const availableSymbols = getAvailableSymbols();

    // Function to handle contract type change, considering trading mode
    const handleContractTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newContractType = e.target.value;

        // If in Rise/Fall mode, map display values to actual contract types
        if (tradingMode === 'RISE_FALL') {
            if (newContractType === 'Rise') setContractType('CALL');
            else if (newContractType === 'Fall') setContractType('PUT');
            else if (newContractType === 'RiseEquals') setContractType('CALLE'); // Rise with equals
            else if (newContractType === 'FallEquals') setContractType('PUTE'); // Fall with equals
            else setContractType(newContractType);
        } else {
            // Higher/Lower mode uses CALL/PUT directly
            setContractType(newContractType);
        }
    };

    return (
        <div className="higher-lower-trader">
            <div className="higher-lower-trader__container">
                <div className="higher-lower-trader__content">
                    {/* Main Trading Form */}
                    <div className="higher-lower-trader__card">
                        <h3>{localize(tradingMode === 'RISE_FALL' ? 'Rise/Fall Trading' : 'Higher/Lower Trading')}</h3>

                        {/* Trading Mode Selection */}
                        <div className='form-group'>
                            <label>{localize('Trading Mode')}</label>
                            <select
                                id='hlt-trading-mode'
                                value={tradingMode}
                                onChange={e => {
                                    const newMode = e.target.value as 'HIGHER_LOWER' | 'RISE_FALL';
                                    setTradingMode(newMode);
                                    // Reset contract type and barrier when mode changes
                                    if (newMode === 'RISE_FALL') {
                                        setContractType('CALL'); // Default to Rise
                                        setBarrier('0'); // Default barrier to 0 for Rise/Fall
                                    } else {
                                        setContractType('CALL'); // Default to Higher
                                        setBarrier('+0.37'); // Default barrier for Higher/Lower
                                    }
                                }}
                            >
                                <option value='HIGHER_LOWER'>{localize('Higher/Lower')}</option>
                                <option value='RISE_FALL'>{localize('Rise/Fall')}</option>
                            </select>
                        </div>


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
                                <label htmlFor='hlt-symbol'>{localize('Volatility')}</label>
                                <select
                                    id='hlt-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);
                                        // Use preloaded data if available
                                        if (preloadedData[v] && preloadedData[v].length > 0) {
                                            setTickData(preloadedData[v]);
                                            updateEhlersTrends(preloadedData[v]);
                                        } else {
                                            fetchHistoricalTicks(v);
                                        }
                                        startTicks(v);
                                    }}
                                    disabled={isPreloading}
                                >
                                    {availableSymbols.map(s => (
                                        <option key={s.value} value={s.value}>
                                            {s.label} {preloadedData[s.value] ? `(${preloadedData[s.value].length} ticks)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='higher-lower-trader__field'>
                                <label htmlFor='hlt-contract-type'>{localize('Contract Type')}</label>
                                <select
                                    id='hlt-contract-type'
                                    value={contractType}
                                    onChange={handleContractTypeChange}
                                >
                                    {tradingMode === 'HIGHER_LOWER' ? (
                                        <>
                                            <option value='CALL'>{localize('Higher')}</option>
                                            <option value='PUT'>{localize('Lower')}</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value='CALL'>{localize('Rise')}</option>
                                            <option value='PUT'>{localize('Fall')}</option>
                                            <option value='CALLE'>{localize('Rise (Allow Equals)')}</option>
                                            <option value='PUTE'>{localize('Fall (Allow Equals)')}</option>
                                        </>
                                    )}
                                </select>
                            </div>
                        </div>

                        {/* Duration Controls */}
                        {tradingMode === 'HIGHER_LOWER' && (
                            <div className="higher-lower-trader__field">
                                <label>
                                    Duration ({duration} {durationType === 's' ? 'seconds' : 'minutes'})
                                </label>
                                <div className="higher-lower-trader__row">
                                    <input
                                        type="number"
                                        value={duration}
                                        onChange={(e) => setDuration(Number(e.target.value))}
                                        min="1"
                                        max={durationType === 's' ? 3600 : 60}
                                    />
                                    <select
                                        value={durationType}
                                        onChange={(e) => setDurationType(e.target.value)}
                                    >
                                        <option value="s">Seconds</option>
                                        <option value="m">Minutes</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {tradingMode === 'RISE_FALL' && (
                            <div className="higher-lower-trader__field">
                                <label>Contract Duration</label>
                                <div style={{
                                    padding: '0.75rem',
                                    background: 'var(--general-section-2)',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-normal)'
                                }}>
                                    <strong>Next Tick</strong>
                                    <small className="field-description" style={{ display: 'block', marginTop: '0.25rem' }}>
                                        Rise/Fall contracts expire on the next tick after purchase. Entry spot is the current price.
                                    </small>
                                </div>
                            </div>
                        )}

                        {/* Stake and Barrier/Entry Spot */}
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
                            {tradingMode === 'HIGHER_LOWER' && (
                                <div className="higher-lower-trader__field">
                                    <label>Barrier</label>
                                    <input
                                        type="text"
                                        value={barrier}
                                        onChange={(e) => setBarrier(e.target.value)}
                                        placeholder="+0.37"
                                    />
                                    <small className="field-description">
                                        Price level for Higher/Lower prediction
                                    </small>
                                </div>
                            )}

                            {tradingMode === 'RISE_FALL' && (
                                <div className="higher-lower-trader__field">
                                    <label>
                                        Entry Spot (Live Price)
                                        <span className="higher-lower-trader__entry-note">
                                            Current: {currentPrice.toFixed(5)}
                                        </span>
                                    </label>
                                    <input
                                        type="text"
                                        value={currentPrice.toFixed(5)}
                                        disabled
                                        className="higher-lower-trader__live-price"
                                    />
                                    <small className="field-description">
                                        Entry spot is automatically set to the current price when contract is purchased
                                    </small>
                                </div>
                            )}
                        </div>

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

                        {/* Hull Moving Average Trends */}
                        <div className='higher-lower-trader__trends'>
                            <h4>{localize('Market Trends (Hull MA from Ticks)')}</h4>
                            <div className='trends-grid'>
                                {Object.entries(hullTrends).map(([tickCount, data]) => (
                                    <div key={tickCount} className={`trend-item trend-${data.trend.toLowerCase()}`}>
                                        <div className="trend-timeframe">{tickCount} ticks</div>
                                        <div className="trend-status">{data.trend}</div>
                                        <div className="trend-value">{data.value.toFixed(5)}</div>
                                    </div>
                                ))}
                            </div>

                            {(() => {
                                const recommendation = getTradingRecommendation();
                                const isAligned = recommendation.alignedTrends >= recommendation.requiredAlignment;

                                return (
                                    <div className={`trading-recommendation ${recommendation.recommendation.toLowerCase()}`}>
                                        <div className="recommendation-header">
                                            <h5>{localize('Current Symbol Recommendation')}</h5>
                                            <div className={`rec-badge ${recommendation.recommendation.toLowerCase()}`}>
                                                {recommendation.recommendation}
                                            </div>
                                        </div>
                                        <div className="recommendation-details">
                                            <div className="rec-stat">
                                                <span className="label">{localize('Aligned Trends')}:</span>
                                                <span className={`value ${isAligned ? 'strong' : 'weak'}`}>
                                                    {recommendation.alignedTrends}/{recommendation.requiredAlignment}
                                                </span>
                                            </div>
                                            <div className="rec-stat">
                                                <span className="label">{localize('Confidence')}:</span>
                                                <span className="value">{(recommendation.confidence * 100).toFixed(1)}%</span>
                                            </div>
                                        </div>
                                        {isAligned && (
                                            <div className="recommendation-action">
                                                <button
                                                    className={`btn-auto-select ${recommendation.recommendation.toLowerCase()}`}
                                                    onClick={() => {
                                                        const recommendedType = getRecommendedContractType();
                                                        setContractType(recommendedType);
                                                        const displayText = tradingMode === 'RISE_FALL' ?
                                                            (recommendation.recommendation === 'HIGHER' ? 'Rise' : 'Fall') :
                                                            recommendedType;
                                                        setStatus(`Auto-selected ${displayText} based on trend analysis`);
                                                    }}
                                                >
                                                    {localize('Use Recommendation')} ({tradingMode === 'RISE_FALL' ?
                                                        (recommendation.recommendation === 'HIGHER' ? 'Rise' : 'Fall') :
                                                        (recommendation.recommendation === 'HIGHER' ? 'CALL' : 'PUT')})
                                                </button>
                                            </div>
                                        )}
                                        {!isAligned && (
                                            <div className="recommendation-warning">
                                                <small>{localize('Insufficient trend alignment for confident recommendation')}</small>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Volatility Scanner Section */}
                            <div className="volatility-scanner-section">
                                <div className="scanner-header">
                                    <h4>{localize('Volatility Opportunities Scanner')}</h4>
                                    <button
                                        className="btn-scan"
                                        onClick={scanVolatilities}
                                        disabled={isScanning || isPreloading}
                                    >
                                        {isScanning ? localize('Scanning...') : localize('Scan All Volatilities')}
                                    </button>
                                </div>

                                {volatilityRecommendations.length > 0 && (
                                    <div className="recommendations-list">
                                        <div className="list-header">
                                            <h5>{localize('High-Confidence Opportunities')} ({volatilityRecommendations.length})</h5>
                                            <small>{localize('Volatilities with 3+ aligned trends')}</small>
                                        </div>

                                        <div className="recommendations-grid">
                                            {volatilityRecommendations.slice(0, 6).map((rec, index) => (
                                                <div key={rec.symbol} className={`recommendation-card ${rec.recommendation.toLowerCase()}`}>
                                                    <div className="card-header">
                                                        <div className="symbol-info">
                                                            <strong>{rec.symbol}</strong>
                                                            <small>{rec.label}</small>
                                                        </div>
                                                        <div className={`rec-badge ${rec.recommendation.toLowerCase()}`}>
                                                            {rec.recommendation}
                                                        </div>
                                                    </div>

                                                    <div className="card-stats">
                                                        <div className="stat">
                                                            <span className="label">{localize('Aligned')}:</span>
                                                            <span className={`value ${rec.confidence === 'HIGH' ? 'strong' : ''}`}>
                                                                {rec.alignedTrends}/4
                                                            </span>
                                                        </div>
                                                        <div className="stat">
                                                            <span className="label">{localize('Confidence')}:</span>
                                                            <span className="value">{(rec.confidence * 100).toFixed(0)}%</span>
                                                        </div>
                                                    </div>

                                                    <div className="trends-mini">
                                                        {Object.entries(rec.trends).map(([timeframe, trendData]) => (
                                                            <div key={timeframe} className={`trend-mini ${trendData.trend.toLowerCase()}`}>
                                                                <span className="timeframe">{timeframe}</span>
                                                                <span className="trend">{trendData.trend.charAt(0)}</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <button
                                                        className={`btn-select-volatility ${rec.recommendation.toLowerCase()}`}
                                                        onClick={() => selectVolatilityFromRecommendation(rec)}
                                                        disabled={is_running}
                                                    >
                                                        {localize('Select & Trade')} {rec.recommendation}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        {volatilityRecommendations.length > 6 && (
                                            <div className="more-recommendations">
                                                <small>
                                                    {localize('Showing top 6 of')} {volatilityRecommendations.length} {localize('opportunities')}
                                                </small>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {volatilityRecommendations.length === 0 && !isScanning && !isPreloading && (
                                    <div className="no-recommendations">
                                        <p>{localize('No volatilities currently have 3+ aligned trends.')}</p>
                                        <small>{localize('Click "Scan All Volatilities" to check for new opportunities.')}</small>
                                    </div>
                                )}
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
                                    <span>{stats.totalRuns}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Wins/Losses')}: </span>
                                    <span className='stat-value'>{stats.wins}/{stats.losses}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Win Rate')}: </span>
                                    <span className='stat-value'>{stats.winRate.toFixed(1)}%</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Total Stake')}: </span>
                                    <span className='stat-value'>${stats.totalStake.toFixed(2)}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Total Payout')}: </span>
                                    <span className='stat-value'>${stats.totalPayout.toFixed(2)}</span>
                                </div>
                                <div className='stat-item'>
                                    <span>{localize('Net P&L')}: </span>
                                    <span className={`stat-value ${stats.totalProfit >= 0 ? 'profit' : 'loss'}`}>
                                        {stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(2)}
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
                                    onClick={handleStart}
                                    className='btn-start'
                                    disabled={!isAuthorized || symbols.length === 0}
                                >
                                    <Play className='icon' />
                                    {localize('Start Trading')}
                                </button>
                            ) : (
                                <button
                                    onClick={handleStop}
                                    className='btn-stop'
                                >
                                    <Square className='icon' />
                                    {localize('Stop Trading')}
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