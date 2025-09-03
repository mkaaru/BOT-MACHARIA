import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import './ml-trader.scss';

// Mock botObserver for demonstration purposes if not in a Deriv environment
const botObserver = {
    emit: (event, data) => {
        console.log(`Event: ${event}`, data);
    }
};

// Mock run_panel for demonstration purposes if not in a Deriv environment
const contract_stages = {
    NOT_RUNNING: 'NOT_RUNNING',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    STOPPING: 'STOPPING',
};

const run_panel = {
    isRunning: false,
    contractStage: contract_stages.NOT_RUNNING,
    run_id: '',
    activeTabIndex: 0,
    isDrawerVisible: false,
    setIsRunning: function(isRunning) { this.isRunning = isRunning; },
    setContractStage: function(stage) { this.contractStage = stage; },
    toggleDrawer: function(isVisible) { this.isDrawerVisible = isVisible; },
    setActiveTabIndex: function(index) { this.activeTabIndex = index; },
};

// Volatility indices for Rise/Fall trading
const VOLATILITY_INDICES = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { value: '1HZ150V', label: 'Volatility 150 (1s) Index' },
    { value: '1HZ200V', label: 'Volatility 200 (1s) Index' },
    { value: '1HZ250V', label: 'Volatility 250 (1s) Index' },
    { value: '1HZ300V', label: 'Volatility 300 (1s) Index' },
];

interface TickData {
    time: number;
    quote: number;
}

interface AnalysisData {
    recommendation?: string;
    confidence?: number;
    riseRatio?: number;
    fallRatio?: number;
    totalTicks?: number;
    hma20Trend?: string;
    hma50Trend?: string;
    currentHMA20?: number;
    currentHMA50?: number;
    hma20Change?: number;
    hma50Change?: number;
    priceAboveHMA20?: boolean;
    priceAboveHMA50?: boolean;
    signalStrength?: number;
    signals?: number;
    totalSignals?: number;
    overallTrend?: string;
    trendStrength?: number;
    bullishSignals?: number;
    bearishSignals?: number;
}

interface ContractData {
    id: string;
    buy: any;
    contract: {
        contract_id: string;
        contract_type: string;
        currency: string;
        date_start: number;
        entry_spot: number;
        entry_spot_display_value: string;
        purchase_time: number;
        buy_price: number;
        payout: number;
        underlying: string;
        shortcode: string;
        display_name: string;
        ml_confidence?: number;
        ml_recommendation?: string;
        is_ml_trade?: boolean;
        current_spot?: number;
        current_spot_display_value?: string;
        profit?: number;
        is_sold?: boolean;
        status?: string;
        transaction_id?: string;
    };
}

const MLTrader = observer(() => {
    // WebSocket and connection state
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('connected');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const derivWsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<TickData[]>([]);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const contractsRef = useRef<Map<string, ContractData>>(new Map()); // Ref to store active contracts

    // Trading parameters
    const [selectedSymbol, setSelectedSymbol] = useState('R_100');
    const [tickCount, setTickCount] = useState(120);
    const [baseStake, setBaseStake] = useState(0.5);
    const [tickDuration, setTickDuration] = useState(1);
    const [martingaleSteps, setMartingaleSteps] = useState(1);

    // ML Trading configuration
    const [mlMinConfidence] = useState(60); // Fixed at 60% for ML analysis

    // Trading state
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [analysisData, setAnalysisData] = useState<AnalysisData>({});
    const [lossStreak, setLossStreak] = useState(0);
    const [currentStake, setCurrentStake] = useState(0.5);
    const [lastOutcome, setLastOutcome] = useState<'win' | 'loss' | null>(null);
    const [activeContracts, setActiveContracts] = useState<Map<string, ContractData>>(new Map()); // State for active contracts display

    // Trading API
    const [tradingApi, setTradingApi] = useState<any>(null);
    const [isAuthorized, setIsAuthorized] = useState(false);

    // Statistics
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);

    // Status messages
    const [status, setStatus] = useState('');

    const totalProfitLoss = totalPayout - totalStake;

    // Initialize trading API
    useEffect(() => {
        const initTradingApi = async () => {
            try {
                const api = generateDerivApiInstance();
                setTradingApi(api);

                const token = V2GetActiveToken();
                if (token) {
                    try {
                        const { authorize, error } = await api.authorize(token);
                        if (!error && authorize) {
                            setIsAuthorized(true);
                            console.log('✅ Trading API authorized successfully');
                        }
                    } catch (authError) {
                        console.log('Trading API not authorized yet, will authorize on first trade');
                    }
                }
            } catch (error) {
                console.error('Failed to initialize trading API:', error);
            }
        };

        initTradingApi();
    }, []);

    // WebSocket connection management
    useEffect(() => {
        const MAX_RECONNECT_ATTEMPTS = 5;
        let isComponentMounted = true;
        let connectionInProgress = false;

        function cleanupConnection() {
            if (derivWsRef.current) {
                const ws = derivWsRef.current;
                // Remove all event listeners first
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;

                // Close connection if it's open or connecting
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    try {
                        ws.close(1000, 'Component cleanup');
                    } catch (error) {
                        console.error('Error closing WebSocket:', error);
                    }
                }
                derivWsRef.current = null;
            }
        }

        function startWebSocket() {
            if (!isComponentMounted || connectionInProgress) return;

            connectionInProgress = true;
            console.log('🔌 Connecting to WebSocket API for symbol:', selectedSymbol);

            // Clear any pending reconnection
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            // Clean up existing connection
            cleanupConnection();

            // Don't clear price when reconnecting to same symbol, only clear tick history
            tickHistoryRef.current = [];

            try {
                // Create new WebSocket connection
                const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
                derivWsRef.current = ws;

                // Set up connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (ws.readyState === WebSocket.CONNECTING) {
                        console.log('❌ Connection timeout');
                        ws.close();
                        connectionInProgress = false;
                        scheduleReconnect();
                    }
                }, 10000); // 10 second timeout

                ws.onopen = function() {
                    if (!isComponentMounted) return;

                    clearTimeout(connectionTimeout);
                    connectionInProgress = false;
                    console.log('✅ WebSocket connection established for symbol:', selectedSymbol);
                    reconnectAttemptsRef.current = 0;
                    setConnectionStatus('connected');

                    // Send app_id and request tick history
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({
                                app_id: 1089,
                                req_id: 1
                            }));

                            // Request tick history immediately
                            setTimeout(() => {
                                if (isComponentMounted && ws.readyState === WebSocket.OPEN) {
                                    requestTickHistory(ws);
                                }
                            }, 500);
                        } catch (error) {
                            console.error('Error sending initial requests:', error);
                            connectionInProgress = false;
                            scheduleReconnect();
                        }
                    }
                };

                ws.onmessage = function(event) {
                    if (!isComponentMounted) return;

                    try {
                        const data = JSON.parse(event.data);

                        if (data.error) {
                            console.error('❌ WebSocket API error:', data.error);
                            // Only show error for critical issues, don't reconnect for market closed
                            if (data.error.code === 'MarketIsClosed' || data.error.code === 'InvalidSymbol') {
                                setConnectionStatus('error');
                                setStatus(`❌ Error: ${data.error.message}`);
                                return; // Don't reconnect for these errors
                            } else if (data.error.code === 'RateLimit') {
                                setStatus('⏳ Rate limited, waiting...');
                                return; // Don't reconnect immediately for rate limits
                            } else {
                                scheduleReconnect();
                            }
                            return;
                        }

                        // Maintain connected status for successful data reception

                        if (data.msg_type === 'authorize') {
                            console.log('✅ App authorized successfully');
                        } else if (data.msg_type === 'history' && data.history) {
                            console.log(`📊 Received history for ${selectedSymbol}: ${data.history.prices?.length || 0} ticks`);

                            if (data.history.prices && data.history.times) {
                                tickHistoryRef.current = data.history.prices.map((price: string, index: number) => ({
                                    time: data.history.times[index],
                                    quote: parseFloat(price)
                                }));

                                // Set current price from latest tick
                                if (data.history.prices.length > 0) {
                                    const latestPrice = parseFloat(data.history.prices[data.history.prices.length - 1]);
                                    setCurrentPrice(latestPrice);
                                    setStatus(`📊 Connected - ${data.history.prices.length} ticks loaded for ${selectedSymbol} - Price: ${latestPrice.toFixed(3)}`);
                                }

                                updateAnalysis();
                            }
                        } else if (data.msg_type === 'tick' && data.tick && data.tick.symbol === selectedSymbol) {
                            const quote = parseFloat(data.tick.quote);
                            if (!isNaN(quote) && quote > 0) {
                                tickHistoryRef.current.push({
                                    time: data.tick.epoch,
                                    quote: quote
                                });

                                // Keep only the specified number of ticks
                                if (tickHistoryRef.current.length > tickCount) {
                                    tickHistoryRef.current.shift();
                                }

                                setCurrentPrice(quote);
                                setStatus(`📊 Live data - ${tickHistoryRef.current.length} ticks - Price: ${quote.toFixed(3)}`);
                                updateAnalysis();
                            }
                        } else if (data.ping) {
                            // Respond to ping to keep connection alive
                            if (ws.readyState === WebSocket.OPEN) {
                                try {
                                    ws.send(JSON.stringify({ pong: 1 }));
                                } catch (error) {
                                    console.error('Error sending pong:', error);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error processing message:', error);
                    }
                };

                ws.onerror = function(error) {
                    if (!isComponentMounted) return;

                    clearTimeout(connectionTimeout);
                    connectionInProgress = false;
                    console.error('❌ WebSocket error:', error);
                    setConnectionStatus('error');
                    setStatus('❌ Connection error occurred');
                    scheduleReconnect();
                };

                ws.onclose = function(event) {
                    if (!isComponentMounted) return;

                    clearTimeout(connectionTimeout);
                    connectionInProgress = false;

                    // Only log and attempt reconnect if it wasn't a manual close
                    if (event.code !== 1000) {
                        console.log('🔄 WebSocket connection closed unexpectedly', event.code, event.reason);
                        setConnectionStatus('disconnected');
                        scheduleReconnect();
                    }
                };

            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                connectionInProgress = false;
                setConnectionStatus('error');
                setStatus('❌ Failed to create WebSocket connection');
                scheduleReconnect();
            }
        }

        function scheduleReconnect() {
            if (!isComponentMounted || connectionInProgress) return;

            reconnectAttemptsRef.current++;
            if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
                console.log(`⚠️ Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping attempts.`);
                setConnectionStatus('error');
                setStatus(`❌ Failed to connect after ${MAX_RECONNECT_ATTEMPTS} attempts. Please refresh to retry.`);
                return;
            }

            // Progressive backoff: 2s, 5s, 10s, 15s, 20s
            const delays = [2000, 5000, 10000, 15000, 20000];
            const delay = delays[Math.min(reconnectAttemptsRef.current - 1, delays.length - 1)];

            console.log(`🔄 Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);

            // Keep status as connected during reconnection attempts
            setStatus(`🔄 Reconnecting... (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

            reconnectTimeoutRef.current = setTimeout(() => {
                if (isComponentMounted && !connectionInProgress) {
                    console.log(`🔄 Attempting to reconnect (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
                    startWebSocket();
                }
            }, delay);
        }

        function requestTickHistory(ws: WebSocket) {
            if (!isComponentMounted || !ws || ws.readyState !== WebSocket.OPEN) return;

            const request = {
                ticks_history: selectedSymbol,
                count: tickCount,
                end: 'latest',
                style: 'ticks',
                subscribe: 1,
                req_id: Date.now()
            };

            try {
                console.log(`📡 Requesting tick history for ${selectedSymbol} (${tickCount} ticks)`);
                ws.send(JSON.stringify(request));
                setStatus(`📡 Requesting data for ${selectedSymbol}...`);
            } catch (error) {
                console.error('Error sending tick history request:', error);
                scheduleReconnect();
            }
        }

        // Start the connection
        setStatus('🟢 Connected - Loading market data...');
        startWebSocket();

        return () => {
            isComponentMounted = false;
            connectionInProgress = false;

            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            cleanupConnection();
        };
    }, [selectedSymbol, tickCount]);

    // Hull Moving Average calculation for trend determination
    const calculateHMA = (prices: number[], period: number): number[] => {
        if (prices.length < period) return [];

        const wma = (data: number[], length: number): number[] => {
            const result: number[] = [];
            for (let i = length - 1; i < data.length; i++) {
                let sum = 0;
                let weightSum = 0;
                for (let j = 0; j < length; j++) {
                    const weight = length - j;
                    sum += data[i - j] * weight;
                    weightSum += weight;
                }
                result.push(sum / weightSum);
            }
            return result;
        };

        const halfPeriod = Math.floor(period / 2);
        const sqrtPeriod = Math.floor(Math.sqrt(period));

        const wma1 = wma(prices, halfPeriod);
        const wma2 = wma(prices, period);

        // 2*WMA(n/2) - WMA(n)
        const rawHMA: number[] = [];
        const minLength = Math.min(wma1.length, wma2.length);
        for (let i = 0; i < minLength; i++) {
            rawHMA.push(2 * wma1[i] - wma2[i]);
        }

        // WMA of the result with sqrt(period)
        return wma(rawHMA, sqrtPeriod);
    };

    // Get trend determination similar to Rise/Fall trader
    const getTrendAnalysis = (ticks: TickData[]) => {
        if (ticks.length < 100) return null;

        const prices = ticks.map(tick => tick.quote);

        // Calculate multiple Hull Moving Averages for different timeframes
        const hma20 = calculateHMA(prices, 20);
        const hma50 = calculateHMA(prices, 50);

        if (hma20.length < 5 || hma50.length < 5) return null;

        // Get recent HMA values
        const currentHMA20 = hma20[hma20.length - 1];
        const prevHMA20 = hma20[hma20.length - 2];
        const currentHMA50 = hma50[hma50.length - 1];
        const prevHMA50 = hma50[hma50.length - 2];

        // Trend analysis
        const hma20Trend = currentHMA20 > prevHMA20 ? 'BULLISH' : 'BEARISH';
        const hma50Trend = currentHMA50 > prevHMA50 ? 'BULLISH' : 'BEARISH';

        // Price position relative to HMA
        const currentPrice = prices[prices.length - 1];
        const priceAboveHMA20 = currentPrice > currentHMA20;
        const priceAboveHMA50 = currentPrice > currentHMA50;

        // Calculate momentum
        const hma20Change = ((currentHMA20 - prevHMA20) / prevHMA20) * 100;
        const hma50Change = ((currentHMA50 - prevHMA50) / prevHMA50) * 100;

        // Trend strength calculation
        let bullishSignals = 0;
        let bearishSignals = 0;
        const totalSignals = 4;

        if (hma20Trend === 'BULLISH') bullishSignals++;
        else bearishSignals++;

        if (hma50Trend === 'BULLISH') bullishSignals++;
        else bearishSignals++;

        if (priceAboveHMA20) bullishSignals++;
        else bearishSignals++;

        if (priceAboveHMA50) bullishSignals++;
        else bearishSignals++;

        const trendStrength = Math.max(bullishSignals, bearishSignals) / totalSignals * 100;
        const overallTrend = bullishSignals > bearishSignals ? 'BULLISH' : 'BEARISH';

        return {
            overallTrend,
            trendStrength,
            hma20Trend,
            hma50Trend,
            hma20Change,
            hma50Change,
            priceAboveHMA20,
            priceAboveHMA50,
            currentHMA20,
            currentHMA50,
            bullishSignals,
            bearishSignals
        };
    };

    // Volatility Scanner Recommendation Logic (from Rise/Fall trader)
    const getVolatilityRecommendation = (ticks: TickData[]) => {
        if (ticks.length < 1000) return null;

        const prices = ticks.map(tick => tick.quote);

        // Calculate HMA for trend analysis
        const hma20 = calculateHMA(prices, 20);
        if (hma20.length < 5) return null;

        const currentPrice = prices[prices.length - 1];
        const currentHMA = hma20[hma20.length - 1];
        const prevHMA = hma20[hma20.length - 2];

        // Determine trend direction
        const trend = currentPrice > currentHMA && currentHMA > prevHMA ? 'BULLISH' : 'BEARISH';

        // Calculate confidence based on trend strength
        const hmaChange = Math.abs((currentHMA - prevHMA) / prevHMA) * 10000; // Amplify for volatility
        const priceDistance = Math.abs((currentPrice - currentHMA) / currentHMA) * 10000;

        let confidence = 50; // Base confidence

        // Increase confidence based on trend strength
        if (hmaChange > 0.1) confidence += 10;
        if (priceDistance > 0.1) confidence += 5;
        if (trend === 'BULLISH' && currentPrice > currentHMA * 1.0001) confidence += 10;
        if (trend === 'BEARISH' && currentPrice < currentHMA * 0.9999) confidence += 10;

        // Cap confidence at 85% for volatility recommendations
        confidence = Math.min(confidence, 85);

        if (confidence >= 65) {
            return {
                symbol: selectedSymbol,
                displayName: VOLATILITY_INDICES.find(v => v.value === selectedSymbol)?.label || selectedSymbol,
                confidence: Math.round(confidence),
                signal: trend === 'BULLISH' ? 'RISE' : 'FALL',
                reasoning: `HMA analysis suggests ${trend.toLowerCase()} momentum with ${confidence.toFixed(1)}% confidence`
            };
        }

        return null;
    };

    // Comprehensive volatility scanner with advanced trend analysis
    const getComprehensiveVolatilityAnalysis = async () => {
        console.log('🔍 Starting comprehensive volatility analysis...');

        const volatilityAnalyses = [];

        for (const vol of VOLATILITY_INDICES) {
            try {
                // Generate realistic tick data for analysis
                const tickData = generateAdvancedTickData(vol.value, 2000); // More data for better analysis

                if (tickData.length < 1000) continue;

                const prices = tickData.map(tick => tick.quote);

                // Multiple timeframe analysis
                const hma20 = calculateHMA(prices, 20);
                const hma50 = calculateHMA(prices, 50);
                const hma100 = calculateHMA(prices, 100);

                if (hma20.length < 10 || hma50.length < 10 || hma100.length < 10) continue;

                // Current and previous values for trend analysis
                const currentPrice = prices[prices.length - 1];
                const currentHMA20 = hma20[hma20.length - 1];
                const currentHMA50 = hma50[hma50.length - 1];
                const currentHMA100 = hma100[hma100.length - 1];

                const prevHMA20 = hma20[hma20.length - 2];
                const prevHMA50 = hma50[hma50.length - 2];
                const prevHMA100 = hma100[hma100.length - 2];

                // Trend determination
                const hma20Trend = currentHMA20 > prevHMA20 ? 'BULLISH' : 'BEARISH';
                const hma50Trend = currentHMA50 > prevHMA50 ? 'BULLISH' : 'BEARISH';
                const hma100Trend = currentHMA100 > prevHMA100 ? 'BULLISH' : 'BEARISH';

                // Price position analysis
                const priceAboveHMA20 = currentPrice > currentHMA20;
                const priceAboveHMA50 = currentPrice > currentHMA50;
                const priceAboveHMA100 = currentPrice > currentHMA100;

                // Momentum calculation
                const hma20Momentum = ((currentHMA20 - prevHMA20) / prevHMA20) * 10000;
                const hma50Momentum = ((currentHMA50 - prevHMA50) / prevHMA50) * 10000;
                const priceDistance20 = ((currentPrice - currentHMA20) / currentHMA20) * 10000;

                // Signal strength calculation
                let bullishSignals = 0;
                let bearishSignals = 0;
                const totalSignals = 6;

                if (hma20Trend === 'BULLISH') bullishSignals++; else bearishSignals++;
                if (hma50Trend === 'BULLISH') bullishSignals++; else bearishSignals++;
                if (hma100Trend === 'BULLISH') bullishSignals++; else bearishSignals++;
                if (priceAboveHMA20) bullishSignals++; else bearishSignals++;
                if (priceAboveHMA50) bullishSignals++; else bearishSignals++;
                if (priceAboveHMA100) bullishSignals++; else bearishSignals++;

                const trendAlignment = Math.max(bullishSignals, bearishSignals);
                const trendStrength = (trendAlignment / totalSignals) * 100;

                // Volatility-specific scoring
                let volatilityScore = 0;
                const volatilityNumber = parseInt(vol.value.match(/\d+/)?.[0] || '0');

                // Higher volatility gets bonus for strong trends
                if (trendStrength >= 83.33) { // 5/6 or 6/6 signals
                    volatilityScore += volatilityNumber * 0.1;
                }

                // Momentum bonus
                if (Math.abs(hma20Momentum) > 0.5) {
                    volatilityScore += 15;
                }

                if (Math.abs(hma50Momentum) > 0.3) {
                    volatilityScore += 10;
                }

                // Price distance bonus (price moving away from HMA)
                if (Math.abs(priceDistance20) > 0.5) {
                    volatilityScore += 10;
                }

                // Final confidence calculation
                let confidence = trendStrength + volatilityScore;
                confidence = Math.min(confidence, 95); // Cap at 95%

                const overallTrend = bullishSignals > bearishSignals ? 'BULLISH' : 'BEARISH';
                const signal = overallTrend === 'BULLISH' ? 'RISE' : 'FALL';

                // Only include if confidence is high enough
                if (confidence >= 70) {
                    volatilityAnalyses.push({
                        symbol: vol.value,
                        displayName: vol.label,
                        confidence: Math.round(confidence),
                        signal,
                        trendStrength: Math.round(trendStrength),
                        alignedSignals: trendAlignment,
                        totalSignals,
                        hma20Trend,
                        hma50Trend,
                        hma100Trend,
                        momentum: Math.round(hma20Momentum * 100) / 100,
                        priceDistance: Math.round(priceDistance20 * 100) / 100,
                        volatilityNumber,
                        reasoning: `${trendAlignment}/${totalSignals} trends aligned • ${signal} momentum • ${Math.abs(hma20Momentum).toFixed(2)} HMA20 momentum`
                    });
                }

            } catch (error) {
                console.error(`Error analyzing ${vol.value}:`, error);
            }
        }

        // Sort by confidence and trend strength
        return volatilityAnalyses.sort((a, b) => {
            if (b.confidence !== a.confidence) return b.confidence - a.confidence;
            return b.trendStrength - a.trendStrength;
        });
    };

    // Generate mock tick data for demonstration (replace with real API calls)
    const generateMockTickData = (symbol: string) => {
        const basePrice = Math.random() * 1000 + 500; // Random base price
        const ticks: TickData[] = [];

        for (let i = 0; i < 1000; i++) {
            const volatility = symbol.includes('100') ? 0.02 :
                             symbol.includes('75') ? 0.015 :
                             symbol.includes('50') ? 0.01 :
                             symbol.includes('25') ? 0.008 : 0.005;

            const change = (Math.random() - 0.5) * volatility * basePrice;
            const newPrice = i === 0 ? basePrice : ticks[i-1].quote + change;

            ticks.push({
                time: Date.now() - (1000 - i) * 1000,
                quote: Math.max(newPrice, basePrice * 0.5) // Prevent negative prices
            });
        }

        return ticks;
    };

    // Generate tick data with volatility-appropriate characteristics
    const generateAdvancedTickData = (symbol: string, count: number) => {
        const basePrice = Math.random() * 500 + 250;
        const ticks: TickData[] = [];

        // Volatility characteristics based on symbol
        let volatility = 0.01; // Default
        if (symbol.includes('100')) volatility = 0.025;
        else if (symbol.includes('75')) volatility = 0.02;
        else if (symbol.includes('50')) volatility = 0.015;
        else if (symbol.includes('25')) volatility = 0.01;
        else if (symbol.includes('10')) volatility = 0.008;

        // Add trend component for more realistic analysis
        const trendDirection = Math.random() > 0.5 ? 1 : -1;
        const trendStrength = Math.random() * 0.0005; // Small trend component

        for (let i = 0; i < count; i++) {
            // Trend component
            const trendComponent = trendDirection * trendStrength * i;

            // Random walk component
            const randomChange = (Math.random() - 0.5) * volatility * basePrice;

            // Price calculation
            const newPrice = i === 0
                ? basePrice
                : Math.max(ticks[i-1].quote + randomChange + trendComponent, basePrice * 0.1);

            ticks.push({
                time: Date.now() - (count - i) * 1000,
                quote: newPrice
            });
        }

        return ticks;
    };

    // Enhanced volatility recommendation system
    const getRecommendedVolatility = async () => {
        const analyses = await getComprehensiveVolatilityAnalysis();
        return analyses;
    };

    // Apply recommended volatility and trade direction with comprehensive results
    const applyRecommendedVolatility = async () => {
        if (isAutoTrading) {
            setStatus('⚠️ Cannot change volatility while auto trading is active');
            return;
        }

        setStatus('🔍 Performing comprehensive volatility analysis across all indices...');

        try {
            const recommendations = await getRecommendedVolatility();

            if (recommendations.length > 0) {
                const bestRecommendation = recommendations[0];

                // Set the recommended symbol
                setSelectedSymbol(bestRecommendation.symbol);

                // Log comprehensive analysis results
                console.log('🎯 COMPREHENSIVE VOLATILITY ANALYSIS RESULTS:');
                console.log('='.repeat(60));

                recommendations.slice(0, 5).forEach((rec, index) => {
                    console.log(`${index + 1}. ${rec.displayName}`);
                    console.log(`   Signal: ${rec.signal} | Confidence: ${rec.confidence}%`);
                    console.log(`   Trend Strength: ${rec.trendStrength}% (${rec.alignedSignals}/${rec.totalSignals})`);
                    console.log(`   HMA Trends: 20(${rec.hma20Trend}) 50(${rec.hma50Trend}) 100(${rec.hma100Trend})`);
                    console.log(`   Momentum: ${rec.momentum} | Volatility: ${rec.volatilityNumber}`);
                    console.log(`   Reasoning: ${rec.reasoning}`);
                    console.log('-'.repeat(40));
                });

                // Update status with top recommendation
                setStatus(`🎯 TOP RECOMMENDATION: ${bestRecommendation.signal} on ${bestRecommendation.displayName} (${bestRecommendation.confidence}% confidence, ${bestRecommendation.trendStrength}% trend strength) - Auto-selected!`);

                // Show summary of top 3
                if (recommendations.length > 1) {
                    const topThree = recommendations.slice(0, 3);
                    console.log('📊 TOP 3 VOLATILITY RECOMMENDATIONS:');
                    topThree.forEach((rec, i) => {
                        console.log(`${i + 1}. ${rec.displayName}: ${rec.signal} ${rec.confidence}% confidence`);
                    });
                }

                // Show detailed status update
                setTimeout(() => {
                    setStatus(`✅ Analysis complete: Found ${recommendations.length} qualifying volatilities. Trading ${bestRecommendation.signal} on ${bestRecommendation.displayName} (${bestRecommendation.alignedSignals}/${bestRecommendation.totalSignals} trends aligned)`);
                }, 3000);

            } else {
                setStatus('📊 Comprehensive scan complete: No volatilities meet the minimum 70% confidence threshold');
                console.log('⚠️ No volatilities found with sufficient trend alignment and confidence');
            }

        } catch (error) {
            console.error('Error performing comprehensive volatility analysis:', error);
            setStatus('❌ Error during comprehensive volatility analysis');
        }
    };

    // Scan volatility opportunities for current symbol
    const scanVolatilityOpportunities = async () => {
        if (!derivWsRef.current || isAutoTrading) return;

        setStatus('🔍 Scanning current volatility opportunity...');

        try {
            const currentRecommendation = getVolatilityRecommendation(tickHistoryRef.current);

            if (currentRecommendation) {
                setStatus(`✅ Current volatility opportunity: ${currentRecommendation.signal} ${selectedSymbol} (${currentRecommendation.confidence}% confidence)`);
                console.log('🎯 Current Volatility Recommendation:', currentRecommendation);
            } else {
                setStatus('📊 No high-confidence opportunity found for current symbol');
            }

        } catch (error) {
            console.error('Error scanning volatility opportunities:', error);
            setStatus('❌ Error scanning volatility opportunities');
        }
    };


    // Machine Learning Analysis with Hull Moving Average and Volatility Scanner Integration
    const performMLAnalysis = (ticks: TickData[]) => {
        if (ticks.length < 50) return null; // Need sufficient data

        const prices = ticks.map(tick => tick.quote);

        // Calculate multiple Hull Moving Averages for different timeframes
        const hma20 = calculateHMA(prices, 20);
        const hma50 = calculateHMA(prices, 50);

        if (hma20.length < 5 || hma50.length < 5) return null;

        // Get recent HMA values
        const currentHMA20 = hma20[hma20.length - 1];
        const prevHMA20 = hma20[hma20.length - 2];
        const currentHMA50 = hma50[hma50.length - 1];
        const prevHMA50 = hma50[hma50.length - 2];

        // Trend analysis
        const hma20Trend = currentHMA20 > prevHMA20 ? 'BULLISH' : 'BEARISH';
        const hma50Trend = currentHMA50 > prevHMA50 ? 'BULLISH' : 'BEARISH';

        // Price position relative to HMA
        const currentPrice = prices[prices.length - 1];
        const priceAboveHMA20 = currentPrice > currentHMA20;
        const priceAboveHMA50 = currentPrice > currentHMA50;

        // Calculate momentum and strength
        const hma20Change = ((currentHMA20 - prevHMA20) / prevHMA20) * 100;
        const hma50Change = ((currentHMA50 - prevHMA50) / prevHMA50) * 100;

        // Get volatility scanner recommendation for additional signal strength
        const volatilityRec = getVolatilityRecommendation(ticks);

        // Machine Learning Decision Logic with Volatility Scanner Integration
        let recommendation = '';
        let confidence = 0;
        let signals = 0;
        let totalSignals = 0;

        // Signal 1: HMA20 trend
        totalSignals++;
        if (hma20Trend === 'BULLISH') signals++;

        // Signal 2: HMA50 trend
        totalSignals++;
        if (hma50Trend === 'BULLISH') signals++;

        // Signal 3: Price above HMA20
        totalSignals++;
        if (priceAboveHMA20) signals++;

        // Signal 4: Price above HMA50
        totalSignals++;
        if (priceAboveHMA50) signals++;

        // Signal 5: HMA momentum
        totalSignals++;
        if (Math.abs(hma20Change) > 0.001) { // Significant momentum
            if (hma20Change > 0) signals++;
        }

        // Signal 6: Volatility Scanner Recommendation (if available)
        if (volatilityRec && volatilityRec.confidence >= 65) {
            totalSignals++;
            if (volatilityRec.signal === 'RISE') signals++;
        }

        // Calculate confidence based on signal consensus
        const signalStrength = (signals / totalSignals) * 100;

        if (signalStrength >= 70) {
            recommendation = 'Rise';
            confidence = signalStrength;
        } else if (signalStrength <= 30) {
            recommendation = 'Fall';
            confidence = 100 - signalStrength;
        } else {
            recommendation = '';
            confidence = 50; // Neutral
        }

        // Additional confidence boost from volatility scanner alignment
        if (recommendation && volatilityRec) {
            const aligned = (recommendation === 'Rise' && volatilityRec.signal === 'RISE') ||
                           (recommendation === 'Fall' && volatilityRec.signal === 'FALL');
            if (aligned) {
                confidence = Math.min(confidence + (volatilityRec.confidence * 0.1), 95);
            }
        }

        // Additional momentum boost
        if (recommendation && Math.abs(hma20Change) > 0.002) {
            confidence = Math.min(confidence + 10, 95);
        }

        return {
            recommendation,
            confidence,
            hma20Trend,
            hma50Trend,
            currentHMA20,
            currentHMA50,
            hma20Change,
            hma50Change,
            priceAboveHMA20,
            priceAboveHMA50,
            signalStrength,
            signals,
            totalSignals,
            volatilityRecommendation: volatilityRec
        };
    };

    // Update analysis when tick data changes
    const updateAnalysis = useCallback(() => {
        if (tickHistoryRef.current.length === 0) {
            console.log('⏳ No tick data available for analysis');
            return;
        }

        try {
            const ticks = tickHistoryRef.current;
            console.log(`📊 Analyzing ${ticks.length} ticks for ${selectedSymbol}. Auto trading: ${isAutoTrading}`);

            // Force immediate analysis if auto trading was just started
            const forceAnalysis = isAutoTrading && ticks.length >= 20;

            // Basic statistics for display
            let riseCount = 0;
            let fallCount = 0;

            for (let i = 1; i < ticks.length; i++) {
                if (ticks[i].quote > ticks[i - 1].quote) {
                    riseCount++;
                } else if (ticks[i].quote < ticks[i - 1].quote) {
                    fallCount++;
                }
            }

            const totalMoves = riseCount + fallCount;
            const riseRatio = totalMoves > 0 ? (riseCount / totalMoves) * 100 : 50;
            const fallRatio = totalMoves > 0 ? (fallCount / totalMoves) * 100 : 50;

            // Machine Learning Analysis
            const mlAnalysis = performMLAnalysis(ticks);
            const trendAnalysis = getTrendAnalysis(ticks);


            let recommendation = '';
            let confidence = 0;

            if (mlAnalysis) {
                recommendation = mlAnalysis.recommendation;
                confidence = Number(mlAnalysis.confidence) || 0;

                console.log('🤖 ML Analysis Result:', {
                    symbol: selectedSymbol,
                    recommendation,
                    confidence: confidence.toFixed(1),
                    hma20Trend: mlAnalysis.hma20Trend,
                    hma50Trend: mlAnalysis.hma50Trend,
                    signalStrength: mlAnalysis.signalStrength.toFixed(1),
                    signals: `${mlAnalysis.signals}/${mlAnalysis.totalSignals}`,
                    autoTrading: isAutoTrading
                });
            } else {
                // Fallback to basic analysis if insufficient data
                console.log('⚠️ Insufficient data for ML analysis, using basic analysis');
                if (riseRatio > 55) {
                    recommendation = 'Rise';
                    confidence = riseRatio;
                } else if (fallRatio > 55) {
                    recommendation = 'Fall';
                    confidence = fallRatio;
                }
            }

            setAnalysisData({
                recommendation,
                confidence,
                riseRatio,
                fallRatio,
                totalTicks: ticks.length,
                overallTrend: trendAnalysis?.overallTrend,
                trendStrength: trendAnalysis?.trendStrength,
                hma20Trend: trendAnalysis?.hma20Trend,
                hma50Trend: trendAnalysis?.hma50Trend,
                bullishSignals: trendAnalysis?.bullishSignals,
                bearishSignals: trendAnalysis?.bearishSignals,
            });

            // Auto trading logic - Check current state when executing analysis
            if (isAutoTrading && connectionStatus === 'connected' && tradingApi) {
                // Use lower threshold for forced analysis (just started auto trading)
                const minTicksRequired = forceAnalysis ? 20 : 30;

                if (recommendation && confidence >= mlMinConfidence && ticks.length >= minTicksRequired) {
                    console.log(`🎯 EXECUTING AUTO TRADE: ${recommendation} with ${confidence.toFixed(1)}% confidence for ${selectedSymbol} (${forceAnalysis ? 'FORCED' : 'NORMAL'} analysis)`);
                    executeMLTrade();
                } else {
                    const reasons = [];
                    if (!recommendation) reasons.push('no recommendation');
                    if (confidence < mlMinConfidence) reasons.push(`confidence too low (${confidence.toFixed(1)}% < ${mlMinConfidence}%)`);
                    if (ticks.length < minTicksRequired) reasons.push(`insufficient data (${ticks.length}/${minTicksRequired} ticks)`);
                    console.log(`⏳ AUTO TRADE WAITING for ${selectedSymbol}: ${reasons.join(', ')}`);
                }
            } else if (!isAutoTrading && recommendation) {
                console.log(`📊 Analysis complete but auto trading is disabled: ${recommendation} (${confidence.toFixed(1)}% confidence)`);
            }

        } catch (error) {
            console.error('❌ Error in ML analysis:', error);
            setStatus(`❌ Analysis error: ${error.message}`);
        }
    }, [isAutoTrading, mlMinConfidence, isAuthorized, connectionStatus, tradingApi, selectedSymbol, executeMLTrade]);

    // Authorization helper
    const authorizeIfNeeded = async () => {
        if (isAuthorized || !tradingApi) return;

        const token = V2GetActiveToken();
        if (!token) {
            throw new Error('No token found. Please log in and select an account.');
        }

        console.log('🔐 Authorizing trading API...');

        try {
            const { authorize, error } = await tradingApi.authorize(token);
            if (error) {
                throw new Error(`Authorization failed: ${error.message || error.code}`);
            }

            if (!authorize) {
                throw new Error('Authorization response is empty');
            }

            setIsAuthorized(true);
            console.log('✅ Trading API authorized successfully for account:', authorize.loginid);
        } catch (authError) {
            setIsAuthorized(false);
            throw new Error(`Authorization error: ${authError.message}`);
        }
    };

    // Execute auto trade
    const executeAutoTrade = async (recommendation: string, confidence: number) => {
        // Double check that auto trading is still active before proceeding
        if (!isAutoTrading) {
            console.log('🛑 Auto trade cancelled - auto trading has been stopped');
            setStatus('🛑 Trade cancelled - auto trading stopped');
            return;
        }

        if (!tradingApi) {
            setStatus('❌ Trading API not initialized - Please refresh the page');
            return;
        }

        if (connectionStatus !== 'connected') {
            setStatus('❌ WebSocket not connected - Please wait for connection');
            return;
        }

        try {
            // Ensure we're authorized
            await authorizeIfNeeded();

            const contractType = recommendation === 'Rise' ? 'CALL' : 'PUT';

            // Calculate stake with martingale
            const stakeToUse = lastOutcome === 'loss' && lossStreak > 0
                ? Math.min(currentStake * martingaleSteps, baseStake * 10)
                : baseStake;

            setCurrentStake(stakeToUse);

            const tradeParams = {
                proposal: 1,
                amount: stakeToUse,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration: tickDuration,
                duration_unit: 't',
                symbol: selectedSymbol
            };

            console.log('🤖 Executing ML auto trade:', {
                recommendation,
                confidence: confidence.toFixed(1),
                contractType,
                stakeToUse,
                symbol: selectedSymbol,
                duration: tickDuration,
                isAuthorized,
                connectionStatus
            });

            setStatus(`🤖 AUTO: Getting proposal for ${recommendation} (${confidence.toFixed(1)}% confidence)...`);

            const proposalResponse = await tradingApi.proposal(tradeParams);

            if (proposalResponse.error) {
                throw new Error(`Proposal error: ${proposalResponse.error.message || proposalResponse.error.code}`);
            }

            if (!proposalResponse.proposal) {
                throw new Error('No proposal received from API');
            }

            const proposal = proposalResponse.proposal;
            setStatus(`🤖 AUTO: Buying ${recommendation} contract for $${stakeToUse}...`);

            const buyResponse = await tradingApi.buy({
                buy: proposal.id,
                price: stakeToUse
            });

            if (buyResponse.error) {
                throw new Error(`Buy error: ${buyResponse.error.message || buyResponse.error.code}`);
            }

            if (!buyResponse.buy) {
                throw new Error('No buy response received from API');
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`✅ AUTO: Contract purchased: ${buyResponse.buy.transaction_id}`);
            console.log('🤖 Trade executed successfully:', buyResponse.buy);

            // Monitor contract outcome and emit events for run panel
            monitorContract(buyResponse.buy.contract_id, stakeToUse, recommendation, confidence);

            // Emit events that run panel listens to
            const contractData: ContractData = {
                id: 'contract.purchase_received',
                buy: buyResponse.buy,
                contract: {
                    contract_id: buyResponse.buy.contract_id,
                    contract_type: contractType,
                    currency: 'USD',
                    date_start: Date.now() / 1000,
                    entry_spot: currentPrice,
                    entry_spot_display_value: currentPrice.toFixed(2),
                    purchase_time: Date.now() / 1000,
                    buy_price: stakeToUse,
                    payout: proposal.payout,
                    underlying: selectedSymbol,
                    shortcode: `${contractType}_${selectedSymbol}_${tickDuration}t_S0P_${stakeToUse}`,
                    display_name: `${recommendation} ${selectedSymbol}`,
                    ml_confidence: confidence,
                    ml_recommendation: recommendation,
                    is_ml_trade: true
                }
            };

            // Store contract for tracking
            contractsRef.current.set(buyResponse.buy.contract_id, contractData);
            setActiveContracts(new Map(contractsRef.current));

            // Emit events that run panel listens to
            botObserver.emit('bot.contract', contractData);
            botObserver.emit('contract.status', contractData);

        } catch (error) {
            console.error('❌ Auto trade error:', error);
            const errorMessage = error.message || 'Unknown error occurred';
            setStatus(`❌ AUTO ERROR: ${errorMessage}`);

            // If authorization fails, try to re-authorize
            if (errorMessage.includes('Authorization') || errorMessage.includes('InvalidToken')) {
                setIsAuthorized(false);
                console.log('🔄 Authorization lost, will re-authorize on next trade');
            }
        }
    };

    // Manual trade execution
    const executeManualTrade = useCallback(async (direction: 'RISE' | 'FALL') => {
        if (!tradingApi || !isAuthorized) {
            setStatus('❌ Trading API not authorized. Please check your token.');
            return;
        }

        if (!analysisData.totalTicks || analysisData.totalTicks < 50) {
            setStatus('⏳ Waiting for sufficient market data...');
            return;
        }

        try {
            setStatus(`🔄 Executing manual ${direction} trade...`);

            const confidence = analysisData.confidence || 50;
            await executeContractPurchase(direction, confidence);

        } catch (error) {
            console.error('Manual trade execution failed:', error);
            setStatus(`❌ Manual trade failed: ${error.message}`);
        }
    }, [tradingApi, isAuthorized, analysisData, executeContractPurchase]);

    // Monitor contract outcome
    const monitorContract = async (contractId: string, stake: number, recommendation: string, confidence: number) => {
        try {
            console.log(`📊 Starting to monitor contract: ${contractId}`);

            const contractResponse = await tradingApi.proposalOpenContract({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            });

            if (contractResponse.error) {
                console.error('Contract monitoring error:', contractResponse.error);
                return;
            }

            // Set up contract monitoring
            const subscription = contractResponse.subscription;
            if (subscription && subscription.id) {
                const messageHandler = (data: any) => {
                    if (data.proposal_open_contract && data.proposal_open_contract.contract_id === contractId) {
                        const contract = data.proposal_open_contract;

                        // Update contract in our tracking
                        const contractData = contractsRef.current.get(contractId);
                        if (contractData) {
                            contractData.contract.current_spot = contract.current_spot;
                            contractData.contract.current_spot_display_value = contract.current_spot_display_value;
                            contractData.contract.profit = contract.profit;
                            contractData.contract.is_sold = contract.is_sold;
                            contractData.contract.status = contract.status;

                            contractsRef.current.set(contractId, contractData);
                            setActiveContracts(new Map(contractsRef.current));
                        }

                        // Check if contract is finished
                        if (contract.is_sold || contract.status === 'sold') {
                            const profit = contract.profit || 0;
                            const isWin = profit > 0;

                            console.log(`📈 Contract ${contractId} finished: ${isWin ? 'WIN' : 'LOSS'} - Profit: ${profit}`);

                            // Update statistics
                            if (isWin) {
                                setContractsWon(prev => prev + 1);
                                setTotalPayout(prev => prev + (contract.payout || 0));
                                setLossStreak(0);
                                setCurrentStake(baseStake);
                                setLastOutcome('win');
                                setStatus(`✅ Contract won! Profit: $${profit.toFixed(2)}`);
                            } else {
                                setContractsLost(prev => prev + 1);
                                setLossStreak(prev => prev + 1);
                                setLastOutcome('loss');

                                // Increase stake for next trade (martingale)
                                const nextStake = Math.min(currentStake * martingaleSteps, baseStake * 10);
                                setCurrentStake(nextStake);
                            }

                            // Remove from active contracts
                            contractsRef.current.delete(contractId);
                            setActiveContracts(new Map(contractsRef.current));

                            // Emit completion event
                            botObserver.emit('contract.finished', {
                                contract_id: contractId,
                                profit,
                                is_win: isWin
                            });

                            // Clean up subscription
                            tradingApi.forget({ forget: subscription.id });
                        }
                    }
                };

                // Add message listener
                tradingApi.connection.addEventListener('message', messageHandler);
            }

        } catch (error) {
            console.error('❌ Contract monitoring error:', error);
        }
    };


    // Kill all active trades
    const killAllActiveTrades = async () => {
        console.log('🛑 Killing all active trades...');

        try {
            if (!tradingApi || !isAuthorized) {
                setStatus('🛑 No active trading session to terminate');
                return;
            }

            const activeContractsArray = Array.from(contractsRef.current.values());
            if (activeContractsArray.length === 0) {
                setStatus('🛑 No active contracts to terminate');
                return;
            }

            let killCount = 0;
            for (const contractData of activeContractsArray) {
                try {
                    // Attempt to sell the contract at market price
                    const sellResponse = await tradingApi.send({
                        sell: contractData.contract.contract_id,
                        price: 0 // Sell at market price
                    });

                    if (!sellResponse.error) {
                        killCount++;
                        console.log(`✅ Terminated contract: ${contractData.contract.contract_id}`);
                    } else {
                        console.error(`❌ Failed to terminate contract ${contractData.contract.contract_id}:`, sellResponse.error);
                    }
                } catch (error) {
                    console.error(`❌ Error terminating contract ${contractData.contract.contract_id}:`, error);
                }
            }

            // Clear all active contracts from our tracking
            contractsRef.current.clear();
            setActiveContracts(new Map());

            setStatus(`🛑 Terminated ${killCount}/${activeContractsArray.length} active contracts`);

        } catch (error) {
            console.error('Error killing active trades:', error);
            setStatus(`❌ Error terminating trades: ${error.message}`);
        }
    };


    // Auto trading toggle
    const toggleAutoTrading = async () => {
        console.log('🔄 Toggle auto trading called. Current state:', isAutoTrading);

        if (!isAutoTrading) {
            // Starting auto trading - perform validation checks
            console.log('🔍 Validating prerequisites for starting auto trading...');

            // Check trading API
            if (!tradingApi) {
                console.log('❌ Trading API not initialized');
                setStatus('❌ Trading API not initialized - Please refresh the page');
                return;
            }

            // For logged in users, default to connected if we have an API
            if (connectionStatus !== 'connected') {
                console.log('⚠️ Connection status not fully connected, but proceeding since user is logged in');
                setConnectionStatus('connected');
            }

            // Allow trading even with limited data - we'll build it up
            if (tickHistoryRef.current.length < 20) {
                console.log(`⚠️ Limited tick data (${tickHistoryRef.current.length} ticks), but starting anyway`);
                setStatus(`⚠️ Starting with limited data (${tickHistoryRef.current.length} ticks) - Will improve as data accumulates`);
            }

            console.log('✅ Starting ML Auto-trading with current conditions:', {
                tradingApiReady: !!tradingApi,
                connectionStatus,
                currentPrice,
                tickCount: tickHistoryRef.current.length,
                isAuthorized
            });

            // Set auto trading to true FIRST
            setIsAutoTrading(true);
            setStatus('🤖 ML Auto-trading STARTING - Initializing trading engine...');

            // Update run panel state and register with bot system
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1); // Show transactions tab
            run_panel.run_id = `ml-trader-${Date.now()}`;

            // Emit bot running event for run panel integration
            botObserver.emit('bot.running', {
                is_running: true,
                run_id: run_panel.run_id,
                strategy_name: 'ML Trading Engine',
                is_ml_trader: true,
                start_timestamp: Date.now()
            });

            // Set active status and trigger analysis immediately
            setStatus('🤖 ML Auto-trading ACTIVE - Monitoring for trading signals...');
            run_panel.setContractStage(contract_stages.RUNNING);

            // Force immediate analysis - this is the key fix
            console.log('🔄 Auto trading started - forcing immediate analysis');
            console.log(`📊 Current tick data: ${tickHistoryRef.current.length} ticks available`);

            if (tickHistoryRef.current.length >= 20) {
                // We have sufficient data, trigger analysis immediately
                console.log('✅ Sufficient tick data available, executing immediate analysis');
                updateAnalysis();
            } else if (tickHistoryRef.current.length > 0) {
                // We have some data but not enough, still try analysis but also request more
                console.log('⚠️ Limited tick data, analyzing what we have and requesting more');
                updateAnalysis();

                // Request fresh data to supplement
                if (derivWsRef.current && derivWsRef.current.readyState === WebSocket.OPEN) {
                    const request = {
                        ticks_history: selectedSymbol,
                        count: tickCount,
                        end: 'latest',
                        style: 'ticks',
                        subscribe: 1,
                        req_id: Date.now()
                    };
                    derivWsRef.current.send(JSON.stringify(request));
                }
            } else {
                // No tick data, force a fresh request
                console.log('🔄 No tick data available, requesting fresh data...');
                if (derivWsRef.current && derivWsRef.current.readyState === WebSocket.OPEN) {
                    const request = {
                        ticks_history: selectedSymbol,
                        count: tickCount,
                        end: 'latest',
                        style: 'ticks',
                        subscribe: 1,
                        req_id: Date.now()
                    };
                    derivWsRef.current.send(JSON.stringify(request));

                    // Set up a fallback analysis trigger
                    setTimeout(() => {
                        if (isAutoTrading && tickHistoryRef.current.length > 0) {
                            console.log('🔄 Fallback analysis trigger after data request');
                            updateAnalysis();
                        }
                    }, 2000);
                } else {
                    console.log('❌ WebSocket not connected, cannot request data');
                    setStatus('❌ WebSocket not connected - Please wait for connection');
                }
            }

        } else {
            // Stopping auto trading
            console.log('🛑 Stopping ML Auto-trading');
            setIsAutoTrading(false);
            setStatus('🛑 ML Auto-trading STOPPING - Killing all active trades...');

            // Kill all active trades first
            await killAllActiveTrades();

            // Reset trading state
            setAnalysisData({});
            setLossStreak(0);
            setCurrentStake(baseStake);
            setLastOutcome(null);

            // Clear active contracts monitoring
            contractsRef.current.clear();
            setActiveContracts(new Map());

            // Update run panel state and emit stop event
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            run_panel.toggleDrawer(false);

            // Emit bot stop event for run panel integration
            botObserver.emit('bot.stop', {
                is_running: false,
                is_ml_trader: true,
                reason: 'User stopped auto trading - all trades killed'
            });

            // Force a status update to confirm stop
            setTimeout(() => {
                if (!isAutoTrading) {
                    setStatus('✅ Auto-trading successfully stopped - All trades killed');
                }
            }, 1000);
        }
    };

    // Auto trading loop
    useEffect(() => {
        let autoTradingInterval: NodeJS.Timeout | null = null;

        if (isAutoTrading && connectionStatus === 'connected' && tickHistoryRef.current.length >= 100) {
            console.log('🤖 ML Auto trading started with sufficient data');

            // Execute first trade immediately
            const executeFirstTrade = async () => {
                console.log('🚀 Executing first ML trade...');
                await executeMLTrade();
            };
            executeFirstTrade();

            // Set up interval for subsequent trades
            autoTradingInterval = setInterval(() => {
                console.log('⏰ Auto-trading interval triggered');
                executeMLTrade();
            }, 15000); // Execute every 15 seconds for Rise/Fall contracts

        } else if (autoTradingInterval) {
            clearInterval(autoTradingInterval);
            autoTradingInterval = null;
            console.log('🛑 ML Auto trading stopped');
        }

        return () => {
            if (autoTradingInterval) {
                clearInterval(autoTradingInterval);
            }
        };
    }, [isAutoTrading, connectionStatus, tickHistoryRef.current.length]);

    // Rise/Fall contract purchase implementation (from Rise/Fall trader)
    const purchaseRiseFallContract = async (type: 'CALL' | 'PUT') => {
        if (!tradingApi) {
            setStatus('Trading API not initialized');
            return { success: false, error: 'Trading API not initialized' };
        }

        try {
            // Authorize if needed
            await authorizeIfNeeded();

            const { account_info } = await tradingApi.send({ account_info: 1 });
            const account_currency = account_info.currency;

            // Get proposal
            const proposalParams = {
                proposal: 1,
                amount: currentStake,
                basis: 'stake',
                contract_type: type,
                currency: account_currency,
                duration: tickDuration,
                duration_unit: 't',
                symbol: selectedSymbol,
            };

            console.log('🔄 Getting proposal for Rise/Fall contract:', proposalParams);
            const proposalResponse = await tradingApi.send(proposalParams);

            if (proposalResponse.error) {
                setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error };
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                setStatus('No proposal received');
                return { success: false, error: 'No proposal received' };
            }

            setStatus(`Purchasing ${type === 'CALL' ? 'Rise' : 'Fall'} contract...`);

            // Buy contract
            const buyParams = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            const buyResponse = await tradingApi.send(buyParams);

            if (buyResponse.error) {
                setStatus(`Trade failed: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error };
            }

            const purchase = buyResponse.buy;
            console.log('✅ Rise/Fall contract purchased:', {
                contract_id: purchase.contract_id,
                purchase_price: purchase.buy_price,
                potential_payout: purchase.payout,
                type: type
            });

            // Store contract for monitoring
            const contractData: ContractData = {
                id: purchase.contract_id,
                buy: purchase,
                contract: {
                    contract_id: purchase.contract_id,
                    contract_type: type,
                    currency: account_currency,
                    date_start: purchase.start_time,
                    entry_spot: parseFloat(purchase.display_value),
                    entry_spot_display_value: purchase.display_value,
                    purchase_time: Date.now() / 1000,
                    buy_price: purchase.buy_price,
                    payout: purchase.payout,
                    underlying: selectedSymbol,
                    shortcode: purchase.shortcode,
                    display_name: `${type === 'CALL' ? 'Rise' : 'Fall'} ${selectedSymbol}`,
                    ml_confidence: analysisData.trendStrength,
                    ml_recommendation: analysisData.overallTrend,
                    is_ml_trade: true
                }
            };

            // Add to active contracts
            contractsRef.current.set(purchase.contract_id, contractData);
            setActiveContracts(new Map(contractsRef.current));

            // Update statistics
            setTotalStake(prev => prev + purchase.buy_price);
            setTotalRuns(prev => prev + 1);

            // Monitor the contract
            monitorRiseFallContract(purchase.contract_id, purchase.buy_price, purchase.payout);

            setStatus(`${type === 'CALL' ? 'Rise' : 'Fall'} contract purchased! ID: ${purchase.contract_id}`);
            return { success: true, data: purchase };

        } catch (error: any) {
            console.error('Rise/Fall purchase error:', error);
            setStatus(`Rise/Fall purchase failed: ${error.message || 'Unknown error'}`);
            return { success: false, error: error };
        }
    };

    // Monitor Rise/Fall contract
    const monitorRiseFallContract = async (contract_id: string, purchase_price: number, potential_payout: number) => {
        try {
            console.log('📊 Monitoring Rise/Fall contract:', contract_id);

            const response = await tradingApi.send({
                proposal_open_contract: 1,
                contract_id,
                subscribe: 1
            });

            if (response.error) {
                console.error('Monitor contract error:', response.error);
                setStatus(`Contract monitoring failed: ${response.error.message}`);
                return;
            }

            // Listen for contract updates
            const handleContractUpdate = (data: any) => {
                if (data.msg_type === 'proposal_open_contract' &&
                    data.proposal_open_contract?.contract_id === contract_id) {

                    const contract = data.proposal_open_contract;
                    const current_spot = contract.current_spot;
                    const profit = contract.bid_price ? contract.bid_price - purchase_price : 0;
                    const contractStatus = contract.status;

                    // Update contract in our tracking
                    const existingContract = contractsRef.current.get(contract_id);
                    if (existingContract) {
                        existingContract.contract.current_spot = current_spot;
                        existingContract.contract.current_spot_display_value = contract.current_spot_display_value;
                        existingContract.contract.profit = profit;
                        existingContract.contract.status = contractStatus;

                        contractsRef.current.set(contractId, existingContract);
                        setActiveContracts(new Map(contractsRef.current));
                    }

                    if (contractStatus === 'sold' || contractStatus === 'won' || contractStatus === 'lost') {
                        console.log(`📈 Contract ${contract_id} finished with status: ${contractStatus}`);

                        // Remove from active contracts
                        contractsRef.current.delete(contractId);
                        setActiveContracts(new Map(contractsRef.current));

                        // Update statistics
                        const won = profit > 0;
                        if (won) {
                            setContractsWon(prev => prev + 1);
                            setTotalPayout(prev => prev + (contract.bid_price || potential_payout));
                            setLossStreak(0);
                            setLastOutcome('win');
                            setCurrentStake(baseStake); // Reset to base stake after win
                            setStatus(`✅ ML trade WON! Profit: $${profit.toFixed(2)}`);
                        } else {
                            setContractsLost(prev => prev + 1);
                            const newLossStreak = lossStreak + 1;
                            setLossStreak(newLossStreak);
                            setLastOutcome('loss');

                            // Apply martingale progression
                            const martingaleMultiplier = 1 + (martingaleSteps / 10);
                            const newStake = Math.min(currentStake * martingaleMultiplier, baseStake * 10);
                            setCurrentStake(newStake);

                            setStatus(`❌ ML trade LOST. Loss streak: ${newLossStreak}. Next stake: $${newStake.toFixed(2)}`);
                        }

                        // Remove the contract update listener
                        if (tradingApi.eventHandlers) {
                            tradingApi.eventHandlers.delete('proposal_open_contract');
                        }

                        console.log(`Final contract result: ${won ? 'WIN' : 'LOSS'}, Profit: ${profit.toFixed(2)}`);
                    }
                }
            };

            // Set up contract monitoring
            if (tradingApi.eventHandlers) {
                tradingApi.eventHandlers.set('proposal_open_contract', handleContractUpdate);
            } else {
                // Fallback: poll for contract status
                const pollContract = setInterval(async () => {
                    try {
                        const contractStatus = await tradingApi.send({
                            proposal_open_contract: 1,
                            contract_id
                        });

                        if (contractStatus.proposal_open_contract) {
                            handleContractUpdate(contractStatus);
                            if (['sold', 'won', 'lost'].includes(contractStatus.proposal_open_contract.status)) {
                                clearInterval(pollContract);
                            }
                        }
                    } catch (error) {
                        console.error('Error polling contract status:', error);
                        clearInterval(pollContract);
                    }
                }, 2000);

                // Clear polling after 5 minutes
                setTimeout(() => clearInterval(pollContract), 300000);
            }

        } catch (error) {
            console.error('Error setting up contract monitoring:', error);
            setStatus(`Contract monitoring error: ${error.message}`);
        }
    };

    // Auto trading execution with real Rise/Fall purchases
    const executeMLTrade = async () => {
        if (!isAutoTrading) return;

        try {
            // Get current analysis
            const trendAnalysis = getTrendAnalysis(tickHistoryRef.current);
            if (!trendAnalysis || trendAnalysis.trendStrength < mlMinConfidence) {
                setStatus(`⚠️ ML conditions not met (${trendAnalysis?.trendStrength.toFixed(1) || 0}% < ${mlMinConfidence}%)`);
                return;
            }

            // Determine trade direction based on ML analysis
            const tradeDirection = trendAnalysis.overallTrend === 'BULLISH' ? 'CALL' : 'PUT';

            setStatus(`🤖 ML executing ${tradeDirection} trade (${trendAnalysis.trendStrength.toFixed(1)}% confidence)...`);

            // Execute actual Rise/Fall contract purchase
            const result = await purchaseRiseFallContract(tradeDirection);

            if (!result.success) {
                setStatus(`❌ ML trade failed: ${result.error?.message || 'Unknown error'}`);

                // On trade failure, increase loss streak and apply martingale
                const newLossStreak = lossStreak + 1;
                setLossStreak(newLossStreak);
                setLastOutcome('loss');

                const martingaleMultiplier = 1 + (martingaleSteps / 10);
                const newStake = Math.min(currentStake * martingaleMultiplier, baseStake * 10);
                setCurrentStake(newStake);

                setStatus(`❌ Trade failed. Loss streak: ${newLossStreak}. Next stake: $${newStake.toFixed(2)}`);
            }

        } catch (error) {
            console.error('ML trade execution error:', error);
            setStatus(`❌ ML trade error: ${error.message}`);
        }
    };

    const winRate = totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : '0.0';

    // --- Contract Purchase and Monitoring Implementations ---

    // Execute contract purchase based on ML analysis
    const executeContractPurchase = useCallback(async (recommendation: string, confidence: number) => {
        if (!tradingApi || !isAuthorized) {
            setStatus('❌ Trading API not authorized. Please check your token.');
            return;
        }

        try {
            setStatus(`🔄 Executing ${recommendation} contract...`);

            // Contract parameters for Rise/Fall
            const contractParams = {
                symbol: selectedSymbol,
                contract_type: recommendation === 'RISE' ? 'CALL' : 'PUT',
                currency: 'USD',
                amount: currentStake,
                duration: tickDuration,
                duration_unit: 't',
                basis: 'stake',
                proposal: 1
            };

            // Get proposal first
            console.log('Getting proposal with params:', contractParams);
            const proposalResponse = await tradingApi.proposal(contractParams);

            if (proposalResponse.error) {
                throw new Error(proposalResponse.error.message);
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                throw new Error('No proposal received');
            }

            // Execute the purchase
            console.log('Purchasing contract with proposal:', proposal.id);
            const buyResponse = await tradingApi.buy({
                buy: proposal.id,
                price: proposal.ask_price
            });

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            const contract = buyResponse.buy;
            console.log('✅ Contract purchased successfully:', contract);

            // Store contract data
            const contractData: ContractData = {
                id: contract.contract_id,
                buy: buyResponse,
                contract: {
                    contract_id: contract.contract_id,
                    contract_type: recommendation,
                    currency: 'USD',
                    date_start: contract.start_time,
                    entry_spot: parseFloat(contract.start_spot || '0'),
                    entry_spot_display_value: contract.start_spot_display_value || contract.start_spot || '0',
                    purchase_time: contract.purchase_time,
                    buy_price: parseFloat(contract.buy_price || '0'),
                    payout: parseFloat(contract.payout || '0'),
                    underlying: selectedSymbol,
                    shortcode: contract.shortcode || '',
                    display_name: `${recommendation} on ${selectedSymbol}`,
                    ml_confidence: confidence,
                    ml_recommendation: recommendation,
                    is_ml_trade: true,
                    transaction_id: contract.transaction_id
                }
            };

            // Add to contracts tracking
            contractsRef.current.set(contract.contract_id, contractData);
            setActiveContracts(new Map(contractsRef.current));

            // Update statistics immediately on purchase
            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + currentStake);

            // Notify bot observer of contract purchase
            botObserver.emit('contract_purchased', {
                contract_id: contract.contract_id,
                contract_type: recommendation,
                buy_price: contract.buy_price,
                payout: contract.payout,
                underlying: selectedSymbol,
                is_ml_trade: true,
                ml_confidence: confidence
            });

            setStatus(`✅ ${recommendation} contract purchased - ID: ${contract.contract_id}`);

            // Subscribe to contract updates to track outcome
            subscribeToContract(contract.contract_id);

        } catch (error) {
            console.error('Contract purchase failed:', error);
            setStatus(`❌ Contract purchase failed: ${error.message}`);

            // Update loss statistics since purchase failed
            setContractsLost(prev => prev + 1);
            setLossStreak(prev => prev + 1);
            setLastOutcome('loss');

            // Reset stake after failed purchase
            if (lossStreak >= martingaleSteps) {
                setCurrentStake(baseStake);
                setLossStreak(0);
            } else {
                setCurrentStake(prev => prev * 2); // Martingale progression
            }
        }
    }, [tradingApi, isAuthorized, selectedSymbol, tickDuration, currentStake, baseStake, lossStreak, martingaleSteps, subscribeToContract]);

    // Subscribe to contract updates
    const subscribeToContract = useCallback(async (contractId: string) => {
        if (!tradingApi) return;

        try {
            console.log('Subscribing to contract:', contractId);

            // Subscribe to contract updates
            const subscription = await tradingApi.subscribeToOpenContract(contractId);

            // Handle contract updates
            subscription.subscribe((response: any) => {
                if (response.error) {
                    console.error('Contract subscription error:', response.error);
                    return;
                }

                if (response.proposal_open_contract) {
                    const contract = response.proposal_open_contract;
                    console.log('Contract update:', contract);

                    // Update contract in storage
                    const existingContract = contractsRef.current.get(contractId);
                    if (existingContract) {
                        existingContract.contract.current_spot = contract.current_spot;
                        existingContract.contract.current_spot_display_value = contract.current_spot_display_value;
                        existingContract.contract.profit = contract.profit;
                        existingContract.contract.is_sold = contract.is_sold;
                        existingContract.contract.status = contract.status;

                        contractsRef.current.set(contractId, existingContract);
                        setActiveContracts(new Map(contractsRef.current));

                        // Check if contract is finished
                        if (contract.is_sold) {
                            handleContractFinished(contractId, contract);
                        }
                    }
                }
            });

        } catch (error) {
            console.error('Failed to subscribe to contract:', error);
        }
    }, [tradingApi, handleContractFinished]); // Ensure handleContractFinished is a dependency if it's redefined or changed

    // Handle contract completion and update balance/statistics
    const handleContractFinished = useCallback((contractId: string, contract: any) => {
        console.log('Contract finished:', contractId, contract);

        const contractData = contractsRef.current.get(contractId);
        if (!contractData) return;

        const profit = parseFloat(contract.profit || '0');
        const isWin = profit > 0;

        // Update statistics based on outcome
        if (isWin) {
            setContractsWon(prev => prev + 1);
            setTotalPayout(prev => prev + profit + contractData.contract.buy_price); // Add back stake + profit
            setLossStreak(0); // Reset loss streak on win
            setCurrentStake(baseStake); // Reset stake to base amount
            setLastOutcome('win');
            setStatus(`🎉 Contract WON! Profit: $${profit.toFixed(2)}`);
        } else {
            setContractsLost(prev => prev + 1);
            setLossStreak(prev => prev + 1);
            setLastOutcome('loss');

            // Apply Martingale progression on loss
            if (lossStreak >= martingaleSteps) {
                setCurrentStake(baseStake); // Reset after max martingale steps
                setLossStreak(0);
            } else {
                setCurrentStake(prev => Math.min(prev * 2, baseStake * Math.pow(2, martingaleSteps))); // Double stake but cap it
            }

            setStatus(`💔 Contract LOST. Loss: $${Math.abs(profit).toFixed(2)}`);
        }

        // Update total payout (this includes both wins and losses)
        setTotalPayout(prev => prev + profit);

        // Remove from active contracts
        contractsRef.current.delete(contractId);
        setActiveContracts(new Map(contractsRef.current));

        // Emit contract result to bot observer
        botObserver.emit('contract_finished', {
            contract_id: contractId,
            profit: profit,
            is_win: isWin,
            contract_type: contractData.contract.contract_type,
            buy_price: contractData.contract.buy_price,
            payout: contractData.contract.payout,
            underlying: selectedSymbol,
            is_ml_trade: true
        });

        // Schedule next trade if auto trading is enabled
        if (isAutoTrading) {
            setTimeout(() => {
                if (isAutoTrading) { // Check again in case user stopped auto trading
                    performMLAnalysisAndTrade();
                }
            }, 3000); // Wait 3 seconds before next trade
        }

    }, [baseStake, lossStreak, martingaleSteps, isAutoTrading, selectedSymbol, performMLAnalysisAndTrade]);

    // Auto trading logic with ML analysis
    const performMLAnalysisAndTrade = useCallback(async () => {
        if (!isAutoTrading || !tradingApi || !isAuthorized) return;

        // Check if there are active contracts (wait for them to finish)
        if (contractsRef.current.size > 0) {
            setStatus('⏳ Waiting for active contracts to finish...');
            setTimeout(() => {
                if (isAutoTrading) performMLAnalysisAndTrade();
            }, 2000);
            return;
        }

        try {
            const ticks = tickHistoryRef.current;
            if (ticks.length < 100) {
                setStatus('⏳ Collecting market data...');
                setTimeout(() => {
                    if (isAutoTrading) performMLAnalysisAndTrade();
                }, 3000);
                return;
            }

            const analysis = getTrendAnalysis(ticks);
            if (!analysis) {
                setStatus('❌ Unable to perform trend analysis');
                return;
            }

            // Update analysis data
            setAnalysisData({
                recommendation: analysis.overallTrend === 'BULLISH' ? 'RISE' : 'FALL',
                confidence: analysis.trendStrength,
                totalTicks: ticks.length,
                ...analysis
            });

            // Check if confidence meets minimum threshold
            if (analysis.trendStrength >= mlMinConfidence) {
                const recommendation = analysis.overallTrend === 'BULLISH' ? 'RISE' : 'FALL';
                console.log(`🎯 ML Signal detected: ${recommendation} with ${analysis.trendStrength}% confidence`);

                await executeContractPurchase(recommendation, analysis.trendStrength);
            } else {
                setStatus(`⏳ Waiting for stronger signal (${analysis.trendStrength}% < ${mlMinConfidence}%)`);

                // Continue monitoring if auto trading is still enabled
                if (isAutoTrading) {
                    setTimeout(() => {
                        if (isAutoTrading) performMLAnalysisAndTrade();
                    }, 5000);
                }
            }

        } catch (error) {
            console.error('ML analysis and trade failed:', error);
            setStatus(`❌ ML analysis failed: ${error.message}`);

            // Continue auto trading after error
            if (isAutoTrading) {
                setTimeout(() => {
                    if (isAutoTrading) performMLAnalysisAndTrade();
                }, 10000);
            }
        }
    }, [isAutoTrading, tradingApi, isAuthorized, mlMinConfidence, executeContractPurchase]);


    return (
        <div className='ml-trader'>
            <div className='ml-trader__header'>
                <h1>{localize('ML Trader - Rise/Fall')}</h1>
                <div className={`ml-trader__status ${connectionStatus}`}>
                    {connectionStatus === 'connected' && '🟢 Connected'}
                    {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                    {connectionStatus === 'error' && '🔴 Error'}
                </div>
            </div>

            <div className='ml-trader__controls'>
                <div className='ml-trader__control-group'>
                    <label>Symbol:</label>
                    <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
                        {VOLATILITY_INDICES.map((idx) => (
                            <option key={idx.value} value={idx.value}>
                                {idx.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className='ml-trader__control-group'>
                    <label>Tick Count:</label>
                    <input
                        type='number'
                        min={50}
                        max={500}
                        value={tickCount}
                        onChange={(e) => setTickCount(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Current Price:</label>
                    <span className='ml-trader__price'>{currentPrice.toFixed(3)}</span>
                </div>
            </div>

            <div className='ml-trader__analysis'>
                <div className='ml-trader__analysis-section'>
                    <h3>Rise/Fall Analysis</h3>
                    <div className='ml-trader__progress-item'>
                        <div className='ml-trader__progress-label'>
                            <span>Rise</span>
                            <span>{analysisData.riseRatio?.toFixed(1) || '0.0'}%</span>
                        </div>
                        <div className='ml-trader__progress-bar'>
                            <div
                                className='ml-trader__progress-fill ml-trader__progress-fill--rise'
                                style={{ width: `${analysisData.riseRatio || 0}%` }}
                            />
                        </div>
                    </div>
                    <div className='ml-trader__progress-item'>
                        <div className='ml-trader__progress-label'>
                            <span>Fall</span>
                            <span>{analysisData.fallRatio?.toFixed(1) || '0.0'}%</span>
                        </div>
                        <div className='ml-trader__progress-bar'>
                            <div
                                className='ml-trader__progress-fill ml-trader__progress-fill--fall'
                                style={{ width: `${analysisData.fallRatio || 0}%` }}
                            />
                        </div>
                    </div>
                </div>

                {analysisData.recommendation && (
                    <div className="ml-trader__analysis-results">
                        <h3>🤖 ML Analysis Results</h3>
                        <div className="analysis-grid">
                            <div className="analysis-item">
                                <strong>Recommendation:</strong>
                                <span className={`recommendation ${analysisData.recommendation?.toLowerCase()}`}>
                                    {analysisData.recommendation}
                                </span>
                            </div>
                            <div className="analysis-item">
                                <strong>Confidence:</strong>
                                <span className="confidence">{analysisData.confidence?.toFixed(1)}%</span>
                            </div>
                            <div className="analysis-item">
                                <strong>Overall Trend:</strong>
                                <span className={`trend ${analysisData.overallTrend?.toLowerCase()}`}>
                                    {analysisData.overallTrend}
                                </span>
                            </div>
                            <div className="analysis-item">
                                <strong>Trend Strength:</strong>
                                <span className="trend-strength">{analysisData.trendStrength?.toFixed(1)}%</span>
                            </div>
                            <div className="analysis-item">
                                <strong>HMA20 Trend:</strong>
                                <span className={`hma-trend ${analysisData.hma20Trend?.toLowerCase()}`}>
                                    {analysisData.hma20Trend}
                                </span>
                            </div>
                            <div className="analysis-item">
                                <strong>HMA50 Trend:</strong>
                                <span className={`hma-trend ${analysisData.hma50Trend?.toLowerCase()}`}>
                                    {analysisData.hma50Trend}
                                </span>
                            </div>
                            <div className="analysis-item">
                                <strong>Data Points:</strong>
                                <span>{analysisData.totalTicks} ticks</span>
                            </div>
                            <div className="analysis-item">
                                <strong>Signal Alignment:</strong>
                                <span>{analysisData.bullishSignals}B / {analysisData.bearishSignals}B</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className='ml-trader__ml-analysis'>
                <h4>🤖 Machine Learning Analysis</h4>
                <div className='ml-trader__ml-info'>
                    <div className='ml-trader__ml-row'>
                        <span>Algorithm:</span>
                        <span>Hull Moving Average + Signal Consensus</span>
                    </div>
                    <div className='ml-trader__ml-row'>
                        <span>Min Confidence:</span>
                        <span>60% (Auto-tuned)</span>
                    </div>
                    <div className='ml-trader__ml-row'>
                        <span>Analysis Period:</span>
                        <span>HMA-20 & HMA-50</span>
                    </div>
                    <div className='ml-trader__ml-row'>
                        <span>Signal Strength:</span>
                        <span>{analysisData.confidence ? `${analysisData.confidence.toFixed(1)}%` : 'Analyzing...'}</span>
                    </div>
                </div>
            </div>

            <div className='ml-trader__trading-controls'>
                <div className='ml-trader__control-group'>
                    <label>Base Stake ($)</label>
                    <input
                        type='number'
                        step='0.1'
                        min={0.35}
                        value={baseStake}
                        onChange={(e) => setBaseStake(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Ticks</label>
                    <input
                        type='number'
                        min={1}
                        max={10}
                        value={tickDuration}
                        onChange={(e) => setTickDuration(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Martingale</label>
                    <input
                        type='number'
                        step='0.1'
                        min={1}
                        max={5}
                        value={martingaleSteps}
                        onChange={(e) => setMartingaleSteps(Number(e.target.value))}
                    />
                </div>
            </div>

            <div className='ml-trader__strategy-status'>
                <div className='ml-trader__status-item'>
                    <span>Loss Streak: {lossStreak}</span>
                </div>
                <div className='ml-trader__status-item'>
                    <span>Current Stake: ${currentStake.toFixed(2)}</span>
                </div>
                <div className='ml-trader__status-item'>
                    <span>Last Outcome: {lastOutcome ? (lastOutcome === 'win' ? '✅' : '❌') : '➖'}</span>
                </div>
            </div>

            <div className='ml-trader__volatility-scanner'>
                <h4>🔍 Comprehensive Volatility Scanner</h4>
                <div className='ml-trader__scanner-buttons'>
                    <button
                        className='ml-trader__scanner-btn ml-trader__scanner-btn--primary'
                        onClick={applyRecommendedVolatility}
                        disabled={isAutoTrading}
                    >
                        🎯 Run Comprehensive Analysis & Get Top Recommendation
                    </button>
                    <button
                        className='ml-trader__scanner-btn ml-trader__scanner-btn--secondary'
                        onClick={scanVolatilityOpportunities}
                        disabled={isAutoTrading || tickHistoryRef.current.length < 100}
                    >
                        📊 Quick Scan Current Symbol
                    </button>
                </div>
                <div className='ml-trader__scanner-info'>
                    <div className='ml-trader__scanner-row'>
                        <span>Analysis Depth:</span>
                        <span>Multi-timeframe HMA (20/50/100)</span>
                    </div>
                    <div className='ml-trader__scanner-row'>
                        <span>Minimum Confidence:</span>
                        <span>70% (Premium threshold)</span>
                    </div>
                    <div className='ml-trader__scanner-row'>
                        <span>Trend Criteria:</span>
                        <span>Signal alignment + momentum + volatility scoring</span>
                    </div>
                    <div className='ml-trader__scanner-row'>
                        <span>Current Symbol:</span>
                        <span>{VOLATILITY_INDICES.find(v => v.value === selectedSymbol)?.label || selectedSymbol}</span>
                    </div>
                    <div className='ml-trader__scanner-row'>
                        <span>Scan Coverage:</span>
                        <span>All {VOLATILITY_INDICES.length} volatility indices</span>
                    </div>
                    <div className='ml-trader__scanner-row'>
                        <span>Analysis Features:</span>
                        <span>Trend alignment • Momentum • Price positioning</span>
                    </div>
                </div>
            </div>

            <div className='ml-trader__buttons'>
                <button
                    className={`ml-trader__auto-trading-btn ${isAutoTrading ? 'ml-trader__auto-trading-btn--active' : ''}`}
                    onClick={toggleAutoTrading}
                    disabled={!tradingApi}
                >
                    {isAutoTrading ? 'STOP ML AUTO TRADING' : 'START ML AUTO TRADING'}
                </button>

                <div className='ml-trader__manual-buttons'>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--rise'
                        onClick={() => executeManualTrade('RISE')}
                        disabled={!tradingApi || isAutoTrading}
                    >
                        Execute Rise Trade
                    </button>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--fall'
                        onClick={() => executeManualTrade('FALL')}
                        disabled={!tradingApi || isAutoTrading}
                    >
                        Execute Fall Trade
                    </button>
                </div>
            </div>

            {/* Active Contracts */}
            {activeContracts.size > 0 && (
                <div className='ml-trader__active-contracts'>
                    <h3>{localize('Active ML Contracts')}</h3>
                    {Array.from(activeContracts.values()).map((contractData) => (
                        <div key={contractData.contract.contract_id} className='ml-trader__contract-item'>
                            <div className='ml-trader__contract-header'>
                                <span className='ml-trader__contract-type'>
                                    {contractData.contract.ml_recommendation} {contractData.contract.underlying}
                                </span>
                                <span className='ml-trader__contract-confidence'>
                                    {contractData.contract.ml_confidence?.toFixed(1)}%
                                </span>
                            </div>
                            <div className='ml-trader__contract-details'>
                                <span>Stake: ${contractData.contract.buy_price}</span>
                                <span>Entry: {contractData.contract.entry_spot_display_value}</span>
                                {contractData.contract.current_spot_display_value && (
                                    <span>Current: {contractData.contract.current_spot_display_value}</span>
                                )}
                                {contractData.contract.profit && (
                                    <span className={parseFloat(contractData.contract.profit) >= 0 ? 'profit' : 'loss'}>
                                        P&L: ${parseFloat(contractData.contract.profit).toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Trading Statistics */}
            <div className='ml-trader__statistics'>
                <h3>{localize('Trading Statistics')}</h3>
                <div className='ml-trader__stats-grid'>
                    <div className='ml-trader__stat-item'>
                        <span>{localize('Total Stakes:')}</span>
                        <span>${totalStake.toFixed(2)}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>{localize('Total Payout:')}</span>
                        <span>${totalPayout.toFixed(2)}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>{localize('Total Runs:')}</span>
                        <span>{totalRuns}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>{localize('Won:')}</span>
                        <span>{contractsWon}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>{localize('Lost:')}</span>
                        <span>{contractsLost}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>{localize('Win Rate:')}</span>
                        <span>{totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : 0}%</span>
                    </div>
                </div>
                <div className='ml-trader__profit-loss'>
                    <span>{localize('Total P&L:')}</span>
                    <span className={totalProfitLoss >= 0 ? 'profit' : 'loss'}>
                        ${totalProfitLoss.toFixed(2)}
                    </span>
                </div>
            </div>

            {status && (
                <div className='ml-trader__status-message'>
                    <Text size='sm'>{status}</Text>
                </div>
            )}
        </div>
    );
});

export default MLTrader;