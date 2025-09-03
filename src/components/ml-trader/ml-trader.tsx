import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import './ml-trader.scss';

// Mock botObserver for demonstration purposes if not in a Deriv environment
const botObserver = {
    emit: (event: string, data: any) => {
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
    setIsRunning: function(isRunning: boolean) { this.isRunning = isRunning; },
    setContractStage: function(stage: string) { this.contractStage = stage; },
    toggleDrawer: function(isVisible: boolean) { this.isDrawerVisible = isVisible; },
    setActiveTabIndex: function(index: number) { this.activeTabIndex = index; },
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
    const contractsRef = useRef<Map<string, ContractData>>(new Map());

    // Trading parameters
    const [selectedSymbol, setSelectedSymbol] = useState('R_100');
    const [tickCount, setTickCount] = useState(120);
    const [baseStake, setBaseStake] = useState(0.5);
    const [tickDuration, setTickDuration] = useState(1);
    const [martingaleSteps, setMartingaleSteps] = useState(1);

    // ML Trading configuration
    const [mlMinConfidence] = useState(60);

    // Trading state
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [analysisData, setAnalysisData] = useState<AnalysisData>({});
    const [lossStreak, setLossStreak] = useState(0);
    const [currentStake, setCurrentStake] = useState(0.5);
    const [lastOutcome, setLastOutcome] = useState<'win' | 'loss' | null>(null);
    const [activeContracts, setActiveContracts] = useState<Map<string, ContractData>>(new Map());

    // Trading API
    const [tradingApi, setTradingApi] = useState<any>(null);
    const [isAuthorized, setIsAuthorized] = useState(false);

    // Statistics
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);

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
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;

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

            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            cleanupConnection();
            tickHistoryRef.current = [];

            try {
                const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
                derivWsRef.current = ws;

                const connectionTimeout = setTimeout(() => {
                    if (ws.readyState === WebSocket.CONNECTING) {
                        console.log('❌ Connection timeout');
                        ws.close();
                        connectionInProgress = false;
                        scheduleReconnect();
                    }
                }, 10000);

                ws.onopen = function() {
                    if (!isComponentMounted) return;

                    clearTimeout(connectionTimeout);
                    connectionInProgress = false;
                    console.log('✅ WebSocket connection established for symbol:', selectedSymbol);
                    reconnectAttemptsRef.current = 0;
                    setConnectionStatus('connected');

                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({
                                app_id: 1089,
                                req_id: 1
                            }));

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
                            if (data.error.code === 'MarketIsClosed' || data.error.code === 'InvalidSymbol') {
                                setConnectionStatus('error');
                                setStatus(`❌ Error: ${data.error.message}`);
                                return;
                            } else if (data.error.code === 'RateLimit') {
                                setStatus('⏳ Rate limited, waiting...');
                                return;
                            } else {
                                scheduleReconnect();
                            }
                            return;
                        }

                        if (data.msg_type === 'authorize') {
                            console.log('✅ App authorized successfully');
                        } else if (data.msg_type === 'history' && data.history) {
                            console.log(`📊 Received history for ${selectedSymbol}: ${data.history.prices?.length || 0} ticks`);

                            if (data.history.prices && data.history.times) {
                                tickHistoryRef.current = data.history.prices.map((price: string, index: number) => ({
                                    time: data.history.times[index],
                                    quote: parseFloat(price)
                                }));

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

                                if (tickHistoryRef.current.length > tickCount) {
                                    tickHistoryRef.current.shift();
                                }

                                setCurrentPrice(quote);
                                setStatus(`📊 Live data - ${tickHistoryRef.current.length} ticks - Price: ${quote.toFixed(3)}`);
                                updateAnalysis();
                            }
                        } else if (data.ping) {
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

            const delays = [2000, 5000, 10000, 15000, 20000];
            const delay = delays[Math.min(reconnectAttemptsRef.current - 1, delays.length - 1)];

            console.log(`🔄 Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);
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

        setStatus('🟢 Initializing ML Trading Engine...');
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

    // Hull Moving Average calculation
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

        const rawHMA: number[] = [];
        const minLength = Math.min(wma1.length, wma2.length);
        for (let i = 0; i < minLength; i++) {
            rawHMA.push(2 * wma1[i] - wma2[i]);
        }

        return wma(rawHMA, sqrtPeriod);
    };

    // Machine Learning Analysis with Hull Moving Average
    const performMLAnalysis = (ticks: TickData[]) => {
        if (ticks.length < 50) return null;

        const prices = ticks.map(tick => tick.quote);

        // Calculate multiple Hull Moving Averages
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

        // Machine Learning Decision Logic
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
        if (Math.abs(hma20Change) > 0.001) {
            if (hma20Change > 0) signals++;
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
            confidence = 50;
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
            totalSignals
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

            // Basic statistics
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

            let recommendation = '';
            let confidence = 0;

            if (mlAnalysis) {
                recommendation = mlAnalysis.recommendation;
                confidence = Number(mlAnalysis.confidence) || 0;

                console.log('🤖 ML Analysis Result:', {
                    symbol: selectedSymbol,
                    recommendation,
                    confidence: confidence.toFixed(1),
                    signals: `${mlAnalysis.signals}/${mlAnalysis.totalSignals}`,
                    hma20Trend: mlAnalysis.hma20Trend,
                    hma50Trend: mlAnalysis.hma50Trend,
                    pricePosition: `Above HMA20: ${mlAnalysis.priceAboveHMA20}, Above HMA50: ${mlAnalysis.priceAboveHMA50}`
                });

                // Update analysis data state
                setAnalysisData({
                    recommendation,
                    confidence,
                    riseRatio,
                    fallRatio,
                    totalTicks: ticks.length,
                    ...mlAnalysis
                });

                // Auto-execute trade if conditions are met
                if (isAutoTrading && recommendation && confidence >= mlMinConfidence) {
                    console.log(`🚀 ML Auto-trading conditions met: ${recommendation} with ${confidence.toFixed(1)}% confidence`);
                    executeMLTrade(recommendation, confidence);
                }
            } else {
                setAnalysisData({
                    riseRatio,
                    fallRatio,
                    totalTicks: ticks.length,
                    recommendation: '',
                    confidence: 0
                });
            }

        } catch (error) {
            console.error('Error in updateAnalysis:', error);
            setStatus('❌ Error during analysis');
        }
    }, [selectedSymbol, isAutoTrading, mlMinConfidence, executeMLTrade]);

    // Original Rise/Fall contract purchase implementation
    const purchaseRiseFallContract = async (direction: string, stake: number, confidence: number) => {
        if (!tradingApi) {
            throw new Error('Trading API not available');
        }

        console.log(`💰 Purchasing ${direction} contract for ${selectedSymbol} with stake ${stake}`);

        try {
            // Authorize if needed
            if (!isAuthorized) {
                const token = V2GetActiveToken();
                if (token) {
                    const { authorize, error } = await tradingApi.authorize(token);
                    if (error) {
                        throw new Error(`Authorization failed: ${error.message}`);
                    }
                    setIsAuthorized(true);
                }
            }

            // Get proposal first
            const proposalRequest = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: direction.toUpperCase(),
                currency: 'USD',
                duration: tickDuration,
                duration_unit: 't',
                symbol: selectedSymbol
            };

            console.log('📋 Getting proposal:', proposalRequest);

            const proposalResponse = await tradingApi.proposal(proposalRequest);

            if (proposalResponse.error) {
                throw new Error(`Proposal failed: ${proposalResponse.error.message}`);
            }

            if (!proposalResponse.proposal) {
                throw new Error('No proposal received');
            }

            const proposal = proposalResponse.proposal;
            console.log('✅ Proposal received:', {
                id: proposal.id,
                ask_price: proposal.ask_price,
                payout: proposal.payout
            });

            // Purchase the contract
            const buyRequest = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            console.log('💸 Purchasing contract:', buyRequest);

            const buyResponse = await tradingApi.buy(buyRequest);

            if (buyResponse.error) {
                throw new Error(`Purchase failed: ${buyResponse.error.message}`);
            }

            if (!buyResponse.buy) {
                throw new Error('No buy confirmation received');
            }

            const contractData: ContractData = {
                id: buyResponse.buy.contract_id,
                buy: buyResponse.buy,
                contract: {
                    contract_id: buyResponse.buy.contract_id,
                    contract_type: direction.toUpperCase(),
                    currency: 'USD',
                    date_start: buyResponse.buy.start_time,
                    entry_spot: buyResponse.buy.start_spot,
                    entry_spot_display_value: buyResponse.buy.start_spot_display_value,
                    purchase_time: buyResponse.buy.purchase_time,
                    buy_price: buyResponse.buy.buy_price,
                    payout: buyResponse.buy.payout,
                    underlying: selectedSymbol,
                    shortcode: buyResponse.buy.shortcode,
                    display_name: `${direction.toUpperCase()} ${selectedSymbol}`,
                    ml_confidence: confidence,
                    ml_recommendation: direction,
                    is_ml_trade: true,
                    transaction_id: buyResponse.buy.transaction_id
                }
            };

            // Store contract for monitoring
            contractsRef.current.set(contractData.id, contractData);
            setActiveContracts(new Map(contractsRef.current));

            // Update statistics
            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stake);

            console.log('✅ Contract purchased successfully:', {
                contract_id: contractData.id,
                type: direction,
                stake: stake,
                confidence: confidence,
                entry_spot: buyResponse.buy.start_spot
            });

            // Monitor contract
            monitorContract(contractData.id);

            return contractData;

        } catch (error) {
            console.error('Error purchasing contract:', error);
            throw error;
        }
    };

    // Monitor contract for completion
    const monitorContract = async (contractId: string) => {
        if (!tradingApi) return;

        try {
            console.log(`👀 Monitoring contract: ${contractId}`);

            const streamResponse = await tradingApi.subscribeToPOC(contractId);

            if (streamResponse.error) {
                console.error('Error subscribing to contract:', streamResponse.error);
                return;
            }

            // Handle contract updates
            tradingApi.onMessage().subscribe((data: any) => {
                if (data.proposal_open_contract && data.proposal_open_contract.contract_id === contractId) {
                    const poc = data.proposal_open_contract;

                    // Update contract data
                    const existingContract = contractsRef.current.get(contractId);
                    if (existingContract) {
                        existingContract.contract.current_spot = poc.current_spot;
                        existingContract.contract.current_spot_display_value = poc.current_spot_display_value;
                        existingContract.contract.profit = poc.profit;
                        existingContract.contract.is_sold = poc.is_sold;
                        existingContract.contract.status = poc.status;

                        // Update active contracts state
                        setActiveContracts(new Map(contractsRef.current));

                        // Handle contract completion
                        if (poc.is_sold) {
                            handleContractCompletion(contractId, poc);
                        }
                    }
                }
            });

        } catch (error) {
            console.error('Error monitoring contract:', error);
        }
    };

    // Handle contract completion
    const handleContractCompletion = (contractId: string, contractResult: any) => {
        const contract = contractsRef.current.get(contractId);
        if (!contract) return;

        const isWin = contractResult.profit > 0;
        const profit = contractResult.profit;

        console.log(`📊 Contract ${contractId} completed:`, {
            type: contract.contract.contract_type,
            result: isWin ? 'WIN' : 'LOSS',
            profit: profit,
            entry_spot: contract.contract.entry_spot,
            exit_spot: contractResult.exit_spot
        });

        // Update statistics
        if (isWin) {
            setContractsWon(prev => prev + 1);
            setTotalPayout(prev => prev + contractResult.sell_price);
            setLossStreak(0);
            setLastOutcome('win');
            setCurrentStake(baseStake); // Reset to base stake on win
        } else {
            setContractsLost(prev => prev + 1);
            setLossStreak(prev => prev + 1);
            setLastOutcome('loss');

            // Apply martingale on loss
            if (lossStreak < martingaleSteps) {
                setCurrentStake(prev => prev * 2);
            } else {
                setCurrentStake(baseStake); // Reset after max martingale steps
                setLossStreak(0);
            }
        }

        // Remove from active contracts
        contractsRef.current.delete(contractId);
        setActiveContracts(new Map(contractsRef.current));

        // Schedule next trade if auto trading is active
        if (isAutoTrading) {
            setTimeout(() => {
                console.log('⏰ Preparing next ML auto-trade...');
                updateAnalysis(); // This will trigger next trade if conditions are met
            }, 2000);
        }
    };

    // Execute ML trade based on analysis
    const executeMLTrade = async (direction: string, confidence: number) => {
        if (!tradingApi || !isAuthorized) {
            setStatus('❌ Trading API not available or not authorized');
            return;
        }

        try {
            setStatus(`🚀 Executing ML ${direction} trade with ${confidence.toFixed(1)}% confidence...`);

            await purchaseRiseFallContract(direction.toLowerCase(), currentStake, confidence);

            setStatus(`✅ ML ${direction} contract purchased! Confidence: ${confidence.toFixed(1)}% | Stake: $${currentStake}`);

        } catch (error) {
            console.error('Error executing ML trade:', error);
            setStatus(`❌ Failed to execute ML trade: ${error.message}`);
        }
    };

    // Manual trade execution
    const handleManualTrade = async (direction: string) => {
        if (!tradingApi) {
            setStatus('❌ Trading API not available');
            return;
        }

        try {
            setStatus(`📈 Executing manual ${direction} trade...`);

            const confidence = analysisData.confidence || 50;
            await purchaseRiseFallContract(direction.toLowerCase(), currentStake, confidence);

            setStatus(`✅ Manual ${direction} contract purchased! Stake: $${currentStake}`);

        } catch (error) {
            console.error('Error executing manual trade:', error);
            setStatus(`❌ Failed to execute manual trade: ${error.message}`);
        }
    };

    // Start/Stop ML Auto Trading
    const toggleMLAutoTrading = () => {
        if (isAutoTrading) {
            setIsAutoTrading(false);
            setStatus('🛑 ML Auto Trading stopped');
            console.log('🛑 ML Auto Trading stopped by user');
        } else {
            setIsAutoTrading(true);
            setStatus('🚀 ML Auto Trading started - waiting for high-confidence signals...');
            console.log('🚀 ML Auto Trading started');

            // Trigger immediate analysis
            updateAnalysis();
        }
    };

    const getConnectionStatusColor = () => {
        switch (connectionStatus) {
            case 'connected':
                return '#4CAF50';
            case 'disconnected':
                return '#FF9800';
            case 'error':
                return '#F44336';
            default:
                return '#9E9E9E';
        }
    };

    const getRecommendationColor = () => {
        if (!analysisData.recommendation) return '#9E9E9E';
        return analysisData.recommendation === 'Rise' ? '#4CAF50' : '#F44336';
    };

    return (
        <div className="ml-trader">
            <div className="ml-trader-container">
                {/* Header */}
                <div className="ml-trader-header">
                    <div className="title-section">
                        <h2>🤖 ML Trading Engine</h2>
                        <p>Machine Learning powered Rise/Fall analysis and trading</p>
                    </div>

                    <div className="status-section">
                        <div
                            className="connection-status"
                            style={{ backgroundColor: getConnectionStatusColor() }}
                        >
                            {connectionStatus.toUpperCase()}
                        </div>
                        <div className="price-display">
                            <Text size="sm" weight="bold">
                                {selectedSymbol}: {currentPrice.toFixed(3)}
                            </Text>
                        </div>
                    </div>
                </div>

                {/* Configuration */}
                <div className="trading-config">
                    <div className="config-row">
                        <div className="config-field">
                            <label>Symbol</label>
                            <select
                                value={selectedSymbol}
                                onChange={(e) => setSelectedSymbol(e.target.value)}
                                disabled={isAutoTrading}
                            >
                                {VOLATILITY_INDICES.map(symbol => (
                                    <option key={symbol.value} value={symbol.value}>
                                        {symbol.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="config-field">
                            <label>Ticks</label>
                            <input
                                type="number"
                                min="20"
                                max="1000"
                                value={tickCount}
                                onChange={(e) => setTickCount(Number(e.target.value))}
                                disabled={isAutoTrading}
                            />
                        </div>

                        <div className="config-field">
                            <label>Base Stake ($)</label>
                            <input
                                type="number"
                                min="0.35"
                                max="1000"
                                step="0.01"
                                value={baseStake}
                                onChange={(e) => setBaseStake(Number(e.target.value))}
                                disabled={isAutoTrading}
                            />
                        </div>

                        <div className="config-field">
                            <label>Duration (ticks)</label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={tickDuration}
                                onChange={(e) => setTickDuration(Number(e.target.value))}
                                disabled={isAutoTrading}
                            />
                        </div>
                    </div>
                </div>

                {/* ML Analysis Display */}
                <div className="ml-analysis">
                    <div className="analysis-header">
                        <h3>🧠 Machine Learning Analysis</h3>
                        <div className="confidence-meter">
                            <span>Confidence: </span>
                            <span
                                style={{
                                    color: getRecommendationColor(),
                                    fontWeight: 'bold'
                                }}
                            >
                                {analysisData.confidence?.toFixed(1) || 0}%
                            </span>
                        </div>
                    </div>

                    <div className="analysis-content">
                        <div className="recommendation-section">
                            <div className="recommendation">
                                <Text size="lg" weight="bold" color={getRecommendationColor()}>
                                    {analysisData.recommendation || 'Analyzing...'}
                                </Text>
                            </div>

                            {analysisData.signals && (
                                <div className="signal-strength">
                                    <Text size="sm">
                                        Signals: {analysisData.signals}/{analysisData.totalSignals}
                                        ({analysisData.signalStrength?.toFixed(1)}%)
                                    </Text>
                                </div>
                            )}
                        </div>

                        <div className="trend-info">
                            <div className="trend-item">
                                <span>HMA20: </span>
                                <span style={{ color: analysisData.hma20Trend === 'BULLISH' ? '#4CAF50' : '#F44336' }}>
                                    {analysisData.hma20Trend || 'N/A'}
                                </span>
                            </div>
                            <div className="trend-item">
                                <span>HMA50: </span>
                                <span style={{ color: analysisData.hma50Trend === 'BULLISH' ? '#4CAF50' : '#F44336' }}>
                                    {analysisData.hma50Trend || 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="trading-controls">
                    <div className="auto-trading-section">
                        <button
                            className={`auto-trade-btn ${isAutoTrading ? 'active' : ''}`}
                            onClick={toggleMLAutoTrading}
                            disabled={connectionStatus !== 'connected'}
                        >
                            {isAutoTrading ? '🛑 Stop ML Auto Trading' : '🚀 Start ML Auto Trading'}
                        </button>

                        <div className="auto-trade-info">
                            <Text size="xs">
                                Min Confidence: {mlMinConfidence}% | Current Stake: ${currentStake}
                            </Text>
                        </div>
                    </div>

                    <div className="manual-trading-section">
                        <div className="manual-trade-buttons">
                            <button
                                className="manual-trade-btn rise-btn"
                                onClick={() => handleManualTrade('rise')}
                                disabled={connectionStatus !== 'connected' || isAutoTrading}
                            >
                                📈 Manual Rise
                            </button>

                            <button
                                className="manual-trade-btn fall-btn"
                                onClick={() => handleManualTrade('fall')}
                                disabled={connectionStatus !== 'connected' || isAutoTrading}
                            >
                                📉 Manual Fall
                            </button>
                        </div>
                    </div>
                </div>

                {/* Statistics */}
                <div className="trading-statistics">
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">Total Trades</span>
                            <span className="stat-value">{totalRuns}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Won</span>
                            <span className="stat-value win">{contractsWon}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Lost</span>
                            <span className="stat-value loss">{contractsLost}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Win Rate</span>
                            <span className="stat-value">
                                {totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : 0}%
                            </span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Total Stake</span>
                            <span className="stat-value">${totalStake.toFixed(2)}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Total Payout</span>
                            <span className="stat-value">${totalPayout.toFixed(2)}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">P&L</span>
                            <span className={`stat-value ${totalProfitLoss >= 0 ? 'win' : 'loss'}`}>
                                ${totalProfitLoss.toFixed(2)}
                            </span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Loss Streak</span>
                            <span className="stat-value">{lossStreak}</span>
                        </div>
                    </div>
                </div>

                {/* Active Contracts */}
                {activeContracts.size > 0 && (
                    <div className="active-contracts">
                        <h3>🔄 Active Contracts</h3>
                        <div className="contracts-list">
                            {Array.from(activeContracts.values()).map(contract => (
                                <div key={contract.id} className="contract-card">
                                    <div className="contract-header">
                                        <span className="contract-type">{contract.contract.contract_type}</span>
                                        <span className="contract-symbol">{contract.contract.underlying}</span>
                                        {contract.contract.is_ml_trade && (
                                            <span className="ml-badge">
                                                🤖 ML ({contract.contract.ml_confidence?.toFixed(1)}%)
                                            </span>
                                        )}
                                    </div>
                                    <div className="contract-details">
                                        <div className="detail-row">
                                            <span>Entry: {contract.contract.entry_spot_display_value}</span>
                                            <span>Current: {contract.contract.current_spot_display_value || 'N/A'}</span>
                                        </div>
                                        <div className="detail-row">
                                            <span>Stake: ${contract.contract.buy_price}</span>
                                            <span className={contract.contract.profit && contract.contract.profit >= 0 ? 'profit-positive' : 'profit-negative'}>
                                                P&L: ${contract.contract.profit?.toFixed(2) || '0.00'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Status Bar */}
                {status && (
                    <div className="status-bar">
                        <Text size="sm" className="status-text">
                            {status}
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
});

export default MLTrader;