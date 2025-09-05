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

        // ML decision tree logic with dynamic confidence
        let recommendation = 'WAIT';
        let confidence = 0;
        let reasoning = '';
        let tradeType = 'DIGITEVEN';
        let prediction: number | undefined;

        // Calculate time-based confidence modifier
        const tickCount = this.tickHistory.length;
        const timeModifier = Math.min(1.2, 1 + (tickCount / 100) * 0.2);

        // High confidence signals with dynamic thresholds
        if (evenRatio > 0.75 && maxConsecutive < 4 && volatility < 0.0002) {
            recommendation = 'STRONG_ODD';
            tradeType = 'DIGITODD';
            confidence = Math.min(95, (70 + (evenRatio - 0.75) * 100) * timeModifier);
            reasoning = `Very strong even streak (${(evenRatio * 100).toFixed(1)}%) with low volatility - high probability odd reversal`;
        } else if (evenRatio < 0.25 && maxConsecutive < 4 && volatility < 0.0002) {
            recommendation = 'STRONG_EVEN';
            tradeType = 'DIGITEVEN';
            confidence = Math.min(95, (70 + (0.25 - evenRatio) * 100) * timeModifier);
            reasoning = `Very strong odd streak (${((1 - evenRatio) * 100).toFixed(1)}%) with low volatility - high probability even reversal`;
        }
        // Over/Under predictions with improved logic
        else if (over5Ratio > 0.7 && volatility < 0.0001 && momentum < 0) {
            recommendation = 'STRONG_UNDER';
            tradeType = 'DIGITUNDER';
            prediction = Math.max(0, Math.min(4, Math.floor(4 - (over5Ratio - 0.7) * 15)));
            confidence = Math.min(90, (60 + (over5Ratio - 0.7) * 100) * timeModifier);
            reasoning = `Extremely high over-5 ratio (${(over5Ratio * 100).toFixed(1)}%) with downward momentum - strong under signal`;
        } else if (over5Ratio < 0.3 && volatility < 0.0001 && momentum > 0) {
            recommendation = 'STRONG_OVER';
            tradeType = 'DIGITOVER';
            prediction = Math.max(6, Math.min(9, Math.floor(6 + (0.3 - over5Ratio) * 15)));
            confidence = Math.min(90, (60 + (0.3 - over5Ratio) * 100) * timeModifier);
            reasoning = `Extremely low over-5 ratio (${(over5Ratio * 100).toFixed(1)}%) with upward momentum - strong over signal`;
        }
        // Higher/Lower predictions based on trend and momentum
        else if (momentum > 0.002 && trend > 0 && rsi < 30) {
            recommendation = 'STRONG_HIGHER';
            tradeType = 'CALL';
            confidence = Math.min(85, (65 + momentum * 10000) * timeModifier);
            reasoning = `Strong upward momentum (${(momentum * 100).toFixed(3)}%) with oversold RSI - strong higher signal`;
        } else if (momentum < -0.002 && trend < 0 && rsi > 70) {
            recommendation = 'STRONG_LOWER';
            tradeType = 'PUT';
            confidence = Math.min(85, (65 + Math.abs(momentum) * 10000) * timeModifier);
            reasoning = `Strong downward momentum (${(momentum * 100).toFixed(3)}%) with overbought RSI - strong lower signal`;
        }
        // Medium-high confidence patterns
        else if (maxConsecutive >= 5 && volatility < 0.0003) {
            if (evenRatio > 0.6) {
                recommendation = 'HIGH_ODD';
                tradeType = 'DIGITODD';
                confidence = Math.min(85, (55 + maxConsecutive * 8) * timeModifier);
                reasoning = `${maxConsecutive} consecutive even pattern with low volatility - strong odd reversal signal`;
            } else {
                recommendation = 'HIGH_EVEN';
                tradeType = 'DIGITEVEN';
                confidence = Math.min(85, (55 + maxConsecutive * 8) * timeModifier);
                reasoning = `${maxConsecutive} consecutive odd pattern with low volatility - strong even reversal signal`;
            }
        }
        // Medium confidence signals
        else if (maxConsecutive >= 3) {
            if (evenRatio > 0.55) {
                recommendation = 'MEDIUM_ODD';
                tradeType = 'DIGITODD';
                confidence = Math.min(75, (40 + maxConsecutive * 6 + (evenRatio - 0.5) * 50) * timeModifier);
                reasoning = `${maxConsecutive} consecutive pattern (${(evenRatio * 100).toFixed(1)}% even) suggests odd reversal`;
            } else {
                recommendation = 'MEDIUM_EVEN';
                tradeType = 'DIGITEVEN';
                confidence = Math.min(75, (40 + maxConsecutive * 6 + (0.5 - evenRatio) * 50) * timeModifier);
                reasoning = `${maxConsecutive} consecutive pattern (${((1-evenRatio) * 100).toFixed(1)}% odd) suggests even reversal`;
            }
        }
        // RSI-based signals with trend confirmation
        else if (rsi > 75 && momentum > 0.001 && trend < 0) {
            recommendation = 'MEDIUM_LOWER';
            tradeType = 'PUT';
            confidence = Math.min(80, (45 + (rsi - 70) * 2) * timeModifier);
            reasoning = `Overbought RSI (${rsi.toFixed(1)}) with strong momentum and downtrend - reversal expected`;
        } else if (rsi < 25 && momentum < -0.001 && trend > 0) {
            recommendation = 'MEDIUM_HIGHER';
            tradeType = 'CALL';
            confidence = Math.min(80, (45 + (30 - rsi) * 2) * timeModifier);
            reasoning = `Oversold RSI (${rsi.toFixed(1)}) with strong downward momentum and uptrend - reversal expected`;
        }
        // Additional digit-based signals for backwards compatibility
        else if (rsi > 75 && momentum > 0.001) {
            recommendation = 'MEDIUM_UNDER';
            tradeType = 'DIGITUNDER';
            prediction = Math.floor(3 + Math.random() * 2);
            confidence = Math.min(75, (40 + (rsi - 70) * 2) * timeModifier);
            reasoning = `Overbought RSI (${rsi.toFixed(1)}) suggests digit under signal`;
        } else if (rsi < 25 && momentum < -0.001) {
            recommendation = 'MEDIUM_OVER';
            tradeType = 'DIGITOVER';
            prediction = Math.floor(6 + Math.random() * 2);
            confidence = Math.min(75, (40 + (30 - rsi) * 2) * timeModifier);
            reasoning = `Oversold RSI (${rsi.toFixed(1)}) suggests digit over signal`;
        }
        // Weak signals for continuous recommendations
        else if (evenRatio > 0.6) {
            recommendation = 'WEAK_ODD';
            tradeType = 'DIGITODD';
            confidence = Math.max(35, Math.min(55, (30 + (evenRatio - 0.5) * 40) * timeModifier));
            reasoning = `Slight even bias (${(evenRatio * 100).toFixed(1)}%) suggests potential odd correction`;
        } else if (evenRatio < 0.4) {
            recommendation = 'WEAK_EVEN';
            tradeType = 'DIGITEVEN';
            confidence = Math.max(35, Math.min(55, (30 + (0.5 - evenRatio) * 40) * timeModifier));
            reasoning = `Slight odd bias (${((1-evenRatio) * 100).toFixed(1)}%) suggests potential even correction`;
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
    { value: 'CALL', label: 'Higher' }, // Higher/Lower using CALL
    { value: 'PUT', label: 'Lower' }, // Higher/Lower using PUT
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
    const [market_analysis, setMarketAnalysis] = useState<{[key: string]: any}>({});
    const [isConnected, setIsConnected] = useState(false); // State to track API connection status

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [ticks, setTicks] = useState<number>(1);
    const [stake, setStake] = useState<number>(0.5);
    const [autoTrade, setAutoTrade] = useState<boolean>(false);
    const [minConfidence, setMinConfidence] = useState<number>(70);
    const [maxStopLoss, setMaxStopLoss] = useState<number>(50);
    const [takeProfit, setTakeProfit] = useState<number>(100);

    // New state for Higher/Lower trades
    const [strikePrice, setStrikePrice] = useState<string>('+0.00');
    const [duration, setDuration] = useState<number>(1);
    const [durationType, setDurationType] = useState<string>('m');

    // Current market price for barrier calculation
    const [currentPrice, setCurrentPrice] = useState<number>(0);

    // ML state
    const [mlRecommendation, setMlRecommendation] = useState<any>(null);
    const [modelStats, setModelStats] = useState<any>(null);
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);
    const [predictionHistory, setPredictionHistory] = useState<any[]>([]);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const [is_auto_executing, setIsAutoExecuting] = useState(false);
    const [current_recommendation, setCurrentRecommendation] = useState<any>(null);
    const [executed_trades, setExecutedTrades] = useState<any[]>([]);
    const [market_scanner_active, setMarketScannerActive] = useState(false);
    const [best_market_signal, setBestMarketSignal] = useState<any>(null);
    const [scanning_markets, setScanningMarkets] = useState<string[]>([]);
    const stopFlagRef = useRef<boolean>(false);
    const autoExecutionRef = useRef<boolean>(false);
    const lastRecommendationRef = useRef<string>('');

    const getRecommendationColor = (confidence: number) => {
        if (confidence >= 80) return 'is-green';
        if (confidence >= 60) return 'is-yellow';
        if (confidence >= 40) return 'is-red';
        return 'is-red';
    };

    // Helper to get trade options, including barriers for Higher/Lower
    const getTradeOptions = (selectedSymbol: string, tradeType: string) => {
        const symbolTicks = ticks[selectedSymbol];
        if (!symbolTicks || symbolTicks.length === 0) {
            console.warn(`No ticks available for ${selectedSymbol}`);
            return null;
        }

        const currentTick = symbolTicks[symbolTicks.length - 1];
        if (!currentTick || isNaN(currentTick)) {
            console.warn(`Invalid current tick for ${selectedSymbol}:`, currentTick);
            return null;
        }

        const baseConfig = {
            symbol: selectedSymbol,
            contract_type: tradeType,
            duration: 1,
            duration_unit: 't',
        };

        try {
            switch (tradeType) {
                case 'CALL':
                    const callBarrier = (parseFloat(currentTick.toString()) + 0.001).toFixed(5);
                    return {
                        ...baseConfig,
                        barrier: callBarrier,
                    };
                case 'PUT':
                    const putBarrier = (parseFloat(currentTick.toString()) - 0.001).toFixed(5);
                    return {
                        ...baseConfig,
                        barrier: putBarrier,
                    };
                case 'DIGITEVEN':
                case 'DIGITODD':
                case 'DIGITOVER':
                case 'DIGITUNDER':
                case 'DIGITMATCH':
                case 'DIGITDIFF':
                    // Digit contracts don't need barriers
                    return baseConfig;
                default:
                    console.warn(`Unsupported trade type: ${tradeType}`);
                    return baseConfig;
            }
        } catch (error) {
            console.error('Error calculating trade options:', error);
            return null;
        }
    };


    // Effect for initializing API and fetching symbols
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
                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    // Initial call to startTicks after symbols are loaded
                    startTicks(syn[0].symbol);
                }
            } catch (e: any) {
                console.error('MLTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
            }
        };
        init();

        return () => {
            // Cleanup on component unmount
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

    // Function to connect to the API and subscribe to ticks
    const connectToAPI = useCallback(async () => {
        if (!symbol) {
            setStatus('Please select a symbol first');
            return;
        }

        try {
            setStatus('Connecting to API...');

            // Initialize API connection with proper error handling
            const api = apiRef.current;
            if (!api) {
                console.log('Initializing API connection...');
                // Try to reconnect API if not available
                setTimeout(() => connectToAPI(), 2000);
                return;
            }

            // Check if we're already connected
            if (api.connection && api.connection.readyState === 1) {
                setIsConnected(true);
                setStatus(`Already connected to ${symbol} - Ready for analysis`);
                return;
            }

            // Subscribe to ticks for the selected symbol with retry logic
            let retryCount = 0;
            const maxRetries = 3;

            const attemptSubscription = async () => {
                try {
                    const subscription = await api.subscribe({
                        ticks: symbol,
                        subscribe: 1
                    });

                    if (subscription && subscription.error) {
                        throw new Error(subscription.error.message);
                    }

                    setIsConnected(true);
                    setStatus(`Connected to ${symbol} - Ready for analysis`);

                } catch (subError) {
                    retryCount++;
                    if (retryCount < maxRetries) {
                        setStatus(`Connection attempt ${retryCount}/${maxRetries} failed, retrying...`);
                        setTimeout(attemptSubscription, 1000 * retryCount);
                    } else {
                        throw subError;
                    }
                }
            };

            await attemptSubscription();

        } catch (error) {
            console.error('API connection error:', error);
            setStatus(`Connection failed: ${error?.message || 'Unknown error'}. Please check your internet connection and try again.`);
            setIsConnected(false);
        }
    }, [symbol]);

    // Function to authorize the user if not already
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

    // Function to stop the tick stream
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

    // Function to start receiving tick data
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

                        // Update current price for barrier calculation
                        setCurrentPrice(quote);

                        setLastDigit(digit);
                        setDigits(prev => [...prev.slice(-19), digit]);
                        setTicksProcessed(prev => prev + 1);

                        // Update the ticks state for getTradeOptions
                        setTicks(prevTicks => ({
                            ...prevTicks,
                            [sym]: [...(prevTicks[sym] || []), quote]
                        }));

                        // Generate ML prediction on every tick for real-time updates
                        const features = mlEngineRef.current.extractFeatures(mlEngineRef.current['tickHistory']);
                        if (features.length > 0) {
                            const prediction = mlEngineRef.current.predict(features);

                            // Always update the current recommendation
                            setMlRecommendation(prediction);

                            // Add to prediction history every 2 ticks to avoid spam
                            if (ticksProcessed % 2 === 0) {
                                setPredictionHistory(prev => [
                                    ...prev.slice(-9),
                                    {
                                        timestamp: new Date().toLocaleTimeString(),
                                        ...prediction,
                                        tick: quote,
                                        digit: digit
                                    }
                                ]);
                            }

                            // Check if recommendation significantly changed for auto-execution
                            const recommendationKey = `${prediction.tradeType}_${prediction.recommendation}_${Math.floor(prediction.confidence / 5) * 5}`;
                            if (lastRecommendationRef.current !== recommendationKey && prediction.confidence >= minConfidence) {
                                lastRecommendationRef.current = recommendationKey;
                                setCurrentRecommendation(prediction);

                                console.log('New ML Signal:', {
                                    recommendation: prediction.recommendation,
                                    tradeType: prediction.tradeType,
                                    confidence: prediction.confidence,
                                    reasoning: prediction.reasoning
                                });

                                // Auto-execute if auto-trade is enabled and confidence is sufficient
                                if ((autoTrade || is_auto_executing) && prediction.confidence >= minConfidence && is_running) {
                                    executeTradeWithLogging(prediction, sym);
                                }
                            }
                        }

                        // Update model stats
                        setModelStats(mlEngineRef.current.getModelStats());
                    }
                } catch (msgError) {
                    console.error('Error processing tick message:', msgError);
                }
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
            setStatus(`Failed to start ticks: ${e?.message || 'Unknown error'}`);
        }
    };

    // Function to scan markets for the best signal
    const scanMarkets = async () => {
        const marketsToScan = symbols.slice(0, 5); // Scan top 5 markets
        setScanningMarkets(marketsToScan.map(s => s.symbol));
        setMarketScannerActive(true);

        const marketSignals: any[] = [];

        for (const market of marketsToScan) {
            try {
                // Get historical data for this market
                const { history } = await apiRef.current.send({
                    ticks_history: market.symbol,
                    count: 100,
                    end: 'latest',
                    style: 'ticks'
                });

                if (history?.prices) {
                    const prices = history.prices.map((p: string) => parseFloat(p));
                    const tempEngine = new MLTradingEngine();

                    // Populate engine with historical data
                    prices.forEach(price => tempEngine.updateModel(price));

                    // Get prediction for this market
                    const features = tempEngine.extractFeatures(prices);
                    if (features.length > 0) {
                        const prediction = tempEngine.predict(features);

                        marketSignals.push({
                            symbol: market.symbol,
                            display_name: market.display_name,
                            ...prediction,
                            last_price: prices[prices.length - 1]
                        });
                    }
                }
            } catch (error) {
                console.error(`Error scanning market ${market.symbol}:`, error);
            }
        }

        // Find best signal
        const bestSignal = marketSignals.reduce((best, current) => {
            return (current.confidence > (best?.confidence || 0)) ? current : best;
        }, null);

        setBestMarketSignal(bestSignal);
        setMarketAnalysis(
            marketSignals.reduce((acc, signal) => {
                acc[signal.symbol] = signal;
                return acc;
            }, {})
        );

        setMarketScannerActive(false);
        setScanningMarkets([]);

        // Switch to best market if found and confidence is high
        if (bestSignal && bestSignal.confidence >= minConfidence + 10) {
            setSymbol(bestSignal.symbol);
            startTicks(bestSignal.symbol);
            setStatus(`Switched to ${bestSignal.display_name} (${bestSignal.confidence}% confidence)`);
        }
    };

    // Function to execute a trade and log the process
    const executeTradeWithLogging = async (prediction: any, selectedSymbol: string) => {
        if (!prediction || !selectedSymbol) return;

        try {
            setStatus(`Executing ${prediction.tradeType} trade...`);

            // Check if API is connected
            if (!apiRef.current || !isConnected) {
                throw new Error('API not connected. Please connect first.');
            }

            const trade_option = getTradeOptions(selectedSymbol, prediction.tradeType);
            if (!trade_option) {
                throw new Error(`Invalid trade configuration for ${prediction.tradeType} on ${selectedSymbol}`);
            }

            // Validate prediction type for Higher/Lower contracts
            if ((prediction.tradeType === 'CALL' || prediction.tradeType === 'PUT') && !trade_option.barrier) {
                throw new Error('Barrier required for Higher/Lower contracts but not provided');
            }

            const buy_req: any = {
                buy: 1,
                price: parseFloat(stake) || 1,
                parameters: {
                    contract_type: prediction.tradeType,
                    symbol: selectedSymbol,
                    duration: 1,
                    duration_unit: 't',
                    amount: parseFloat(stake) || 1,
                    basis: 'stake',
                    currency: account_currency || 'USD'
                }
            };

            // Set barrier for Higher/Lower trades
            if (prediction.tradeType === 'CALL' || prediction.tradeType === 'PUT') {
                buy_req.parameters.barrier = trade_option.barrier;
                setStatus(`Setting barrier at ${trade_option.barrier} for ${prediction.tradeType} trade`);
            }

            console.log('Executing trade with parameters:', buy_req);

            const result = await apiRef.current.buy(buy_req);
            const { buy, error } = result || {};

            if (error) {
                throw new Error(error.message || 'Trade execution failed');
            }

            if (!buy) {
                throw new Error('No buy response received from API');
            }

            setStatus(`✅ ${prediction.tradeType} trade executed (${prediction.confidence}% confidence) - ${buy?.longcode || 'Contract placed'}`);

            // Add to transactions with error handling
            try {
                const symbol_display = symbols.find(s => s.symbol === selectedSymbol)?.display_name || selectedSymbol;
                transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: account_currency || 'USD',
                    contract_type: prediction.tradeType as any,
                    underlying: selectedSymbol,
                    display_name: symbol_display,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch (transactionError) {
                console.warn('Failed to add to transactions:', transactionError);
            }

        } catch (e: any) {
            console.error('Execute trade error:', e);
            const errorMessage = e?.message || e?.error?.message || 'Unknown trading error';
            setStatus(`❌ Trade failed: ${errorMessage}`);

            // If it's a connection error, try to reconnect
            if (errorMessage.includes('connection') || errorMessage.includes('network')) {
                setIsConnected(false);
                setStatus('Connection lost. Please reconnect and try again.');
            }
        }
    };

    // Function to toggle the main analysis running state
    const toggleTrading = () => {
        if (is_running) {
            setIsRunning(false);
            setIsAutoExecuting(false);
            stopFlagRef.current = true;
            autoExecutionRef.current = false;
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            setStatus('Analysis and trading stopped');
        } else {
            setIsRunning(true);
            stopFlagRef.current = false;
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1);
            run_panel.run_id = `ml-trader-${Date.now()}`;
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);
            setStatus('ML Analysis started');
            // Ensure connection is attempted when starting
            connectToAPI();
        }
    };

    // Function to toggle the auto-execution feature
    const toggleAutoExecution = () => {
        if (is_auto_executing) {
            setIsAutoExecuting(false);
            autoExecutionRef.current = false;
            setStatus('Auto-execution stopped');
        } else {
            setIsAutoExecuting(true);
            autoExecutionRef.current = true;
            setStatus('Auto-execution enabled - will trade on recommendation changes');

            // Start market scanning if not already running
            if (!market_scanner_active) {
                scanMarkets();
            }
        }
    };

    // Function to stop all analysis and trading activities
    const stopAnalysis = () => {
        setIsRunning(false);
        setIsAutoExecuting(false);
        setMarketScannerActive(false);
        stopFlagRef.current = true;
        autoExecutionRef.current = false;
        run_panel.setIsRunning(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('All analysis and trading stopped');

        // Stop tick stream
        stopTicks();
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
                                        startTicks(v); // Start ticks when symbol changes
                                        connectToAPI(); // Ensure connection is active for the new symbol
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

                        <div className='ml-trader__row'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-stop-loss'>{localize('Max Stop Loss ($)')}</label>
                                <input
                                    id='ml-stop-loss'
                                    type='number'
                                    step='0.01'
                                    min={1}
                                    value={maxStopLoss}
                                    onChange={e => setMaxStopLoss(Number(e.target.value))}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-take-profit'>{localize('Take Profit ($)')}</label>
                                <input
                                    id='ml-take-profit'
                                    type='number'
                                    step='0.01'
                                    min={1}
                                    value={takeProfit}
                                    onChange={e => setTakeProfit(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className='ml-trader__row'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-strike-price'>{localize('Barrier Offset (Higher/Lower)')}</label>
                                <select
                                    id='ml-strike-price'
                                    value={strikePrice}
                                    onChange={e => setStrikePrice(e.target.value)}
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
                                    <div className='ml-trader__barrier-preview'>
                                        Barrier: {(currentPrice + parseFloat(strikePrice)).toFixed(5)}
                                    </div>
                                )}
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-duration'>{localize('Duration (Higher/Lower)')}</label>
                                <input
                                    id='ml-duration'
                                    type='number'
                                    min={1}
                                    max={60}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-duration-type'>{localize('Duration Unit')}</label>
                                <select
                                    id='ml-duration-type'
                                    value={durationType}
                                    onChange={e => setDurationType(e.target.value)}
                                >
                                    <option value='m'>Minutes</option>
                                    <option value='h'>Hours</option>
                                    <option value='d'>Days</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* ML Recommendation Panel */}
                    {mlRecommendation && (
                        <div className='ml-trader__recommendation'>
                            <h3 className='ml-trader__rec-title'>🎯 ML Recommendation (Live)</h3>
                            <div className={`ml-trader__rec-card ${getRecommendationColor(mlRecommendation.confidence)}`}>
                                <div className='ml-trader__rec-header'>
                                    <span className='ml-trader__rec-action'>
                                        {mlRecommendation.recommendation}
                                        <span className='ml-trader__rec-blink'>●</span>
                                    </span>
                                    <span className='ml-trader__rec-confidence'>{mlRecommendation.confidence}%</span>
                                </div>
                                <div className='ml-trader__rec-details'>
                                    <div className='ml-trader__rec-trade-type'>
                                        <strong>{localize('Trade Type:')}</strong> {mlRecommendation.tradeType}
                                        {mlRecommendation.prediction !== undefined && (
                                            <span> | <strong>{localize('Prediction:')}</strong> {mlRecommendation.prediction}</span>
                                        )}
                                    </div>
                                    <div className='ml-trader__rec-reasoning'>
                                        <strong>{localize('Analysis:')}</strong> {mlRecommendation.reasoning}
                                    </div>
                                    <div className='ml-trader__rec-meta'>
                                        <span><strong>Ticks Analyzed:</strong> {ticksProcessed}</span>
                                        <span><strong>Last Digit:</strong> {lastDigit}</span>
                                        <span><strong>Updated:</strong> {new Date().toLocaleTimeString()}</span>
                                    </div>
                                </div>
                                {mlRecommendation.confidence >= minConfidence && (
                                    <div className='ml-trader__execute-section'>
                                        <button
                                            className='ml-trader__execute-btn'
                                            onClick={() => executeTradeWithLogging(mlRecommendation, symbol)}
                                            disabled={autoTrade && is_running}
                                        >
                                            {autoTrade && is_running ?
                                                localize('Auto-Trading Active') :
                                                localize('Execute Trade')} ({mlRecommendation.confidence}%)
                                        </button>
                                        {autoTrade && is_running && (
                                            <div className='ml-trader__auto-status'>
                                                ✓ {localize('Will execute automatically on next signal')}
                                            </div>
                                        )}
                                    </div>
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

                    {/* Market Scanner */}
                    {best_market_signal && (
                        <div className='ml-trader__market-scanner'>
                            <h4 className='ml-trader__scanner-title'>{localize('🔍 Best Market Signal')}</h4>
                            <div className='ml-trader__best-signal'>
                                <div className='ml-trader__best-signal-header'>
                                    <span className='ml-trader__best-signal-market'>{best_market_signal.display_name}</span>
                                    <span className={`ml-trader__best-signal-confidence ${getRecommendationColor(best_market_signal.confidence)}`}>
                                        {best_market_signal.confidence}%
                                    </span>
                                </div>
                                <div className='ml-trader__best-signal-details'>
                                    <span className='ml-trader__best-signal-type'>{best_market_signal.tradeType}</span>
                                    <span className='ml-trader__best-signal-action'>{best_market_signal.recommendation}</span>
                                </div>
                            </div>
                            {market_scanner_active && (
                                <div className='ml-trader__scanning'>
                                    <Text size='xs' color='general'>
                                        {localize('Scanning markets:')} {scanning_markets.join(', ')}...
                                    </Text>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Executed Trades */}
                    {executed_trades.length > 0 && (
                        <div className='ml-trader__trades'>
                            <h4 className='ml-trader__trades-title'>{localize('📊 Recent Trades')}</h4>
                            <div className='ml-trader__trades-list'>
                                {executed_trades.slice(0, 10).map(trade => (
                                    <div key={trade.id} className='ml-trader__trade-item'>
                                        <div className='ml-trader__trade-header'>
                                            <span className='ml-trader__trade-time'>{trade.timestamp}</span>
                                            <span className={`ml-trader__trade-status status-${trade.status}`}>
                                                {trade.status.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className='ml-trader__trade-details'>
                                            <span className='ml-trader__trade-market'>{trade.symbol_display}</span>
                                            <span className='ml-trader__trade-type'>{trade.trade_type}</span>
                                            <span className='ml-trader__trade-confidence'>{trade.confidence}%</span>
                                            <span className='ml-trader__trade-stake'>${trade.stake}</span>
                                        </div>
                                        <div className='ml-trader__trade-risk'>
                                            <span className='ml-trader__trade-sl'>SL: ${trade.max_stop_loss || maxStopLoss}</span>
                                            <span className='ml-trader__trade-tp'>TP: ${trade.take_profit || takeProfit}</span>
                                        </div>
                                        {trade.reasoning && (
                                            <div className='ml-trader__trade-reasoning'>
                                                {trade.reasoning}
                                            </div>
                                        )}
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
                            {is_running ? localize('Stop Analysis') : localize('Start ML Analysis')}
                        </button>

                        <button
                            className={`ml-trader__auto-execute ${is_auto_executing ? 'is-active' : ''}`}
                            onClick={toggleAutoExecution}
                            disabled={!is_running}
                        >
                            {is_auto_executing ? localize('Stop Auto-Execute') : localize('Start Auto-Execute')}
                        </button>

                        <button
                            className='ml-trader__scan-markets'
                            onClick={scanMarkets}
                            disabled={market_scanner_active || !is_running}
                        >
                            {market_scanner_active ? localize('Scanning...') : localize('Scan Markets')}
                        </button>

                        <button
                            className='ml-trader__stop-all'
                            onClick={stopAnalysis}
                            disabled={!is_running && !is_auto_executing}
                        >
                            {localize('🛑 Stop All')}
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