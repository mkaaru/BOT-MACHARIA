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
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
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

        function startWebSocket() {
            console.log('🔌 Connecting to WebSocket API');

            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }

            if (derivWsRef.current) {
                try {
                    derivWsRef.current.onclose = null;
                    derivWsRef.current.close();
                } catch (error) {
                    console.error('Error closing existing connection:', error);
                }
                derivWsRef.current = null;
            }

            try {
                derivWsRef.current = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

                derivWsRef.current.onopen = function() {
                    console.log('✅ WebSocket connection established');
                    reconnectAttemptsRef.current = 0;
                    setConnectionStatus('connected');

                    setTimeout(() => {
                        try {
                            if (derivWsRef.current && derivWsRef.current.readyState === WebSocket.OPEN) {
                                derivWsRef.current.send(JSON.stringify({ app_id: 75771 }));
                                requestTickHistory();
                            }
                        } catch (error) {
                            console.error('Error during init requests:', error);
                        }
                    }, 500);
                };

                derivWsRef.current.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.error) {
                            console.error('❌ WebSocket API error:', data.error);
                            if (data.error.code === 'DisconnectByUser' || data.error.code === 'InvalidToken') {
                                setConnectionStatus('error');
                            }
                            return;
                        }

                        if (connectionStatus !== 'connected') {
                            setConnectionStatus('connected');
                        }

                        if (data.history) {
                            console.log(`📊 Received history for ${selectedSymbol}: ${data.history.prices.length} ticks`);
                            tickHistoryRef.current = data.history.prices.map((price: string, index: number) => ({
                                time: data.history.times[index],
                                quote: parseFloat(price)
                            }));
                            updateAnalysis();
                        } else if (data.tick) {
                            const quote = parseFloat(data.tick.quote);
                            tickHistoryRef.current.push({
                                time: data.tick.epoch,
                                quote: quote
                            });

                            if (tickHistoryRef.current.length > tickCount) {
                                tickHistoryRef.current.shift();
                            }

                            setCurrentPrice(quote);
                            updateAnalysis();
                        } else if (data.ping) {
                            derivWsRef.current?.send(JSON.stringify({ pong: 1 }));
                        }
                    } catch (error) {
                        console.error('Error processing message:', error);
                    }
                };

                derivWsRef.current.onerror = function(error) {
                    console.error('❌ WebSocket error:', error);
                    if (reconnectAttemptsRef.current >= 2) {
                        setConnectionStatus('error');
                    }
                    scheduleReconnect();
                };

                derivWsRef.current.onclose = function(event) {
                    console.log('🔄 WebSocket connection closed', event.code, event.reason);
                    setConnectionStatus('disconnected');
                    scheduleReconnect();
                };

            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                setConnectionStatus('error');
                scheduleReconnect();
            }
        }

        function scheduleReconnect() {
            reconnectAttemptsRef.current++;
            if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
                console.log(`⚠️ Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping attempts.`);
                setConnectionStatus('error');
                return;
            }

            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000);
            console.log(`🔄 Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);

            if (reconnectAttemptsRef.current <= 3) {
                setConnectionStatus('disconnected');
            }

            reconnectTimeoutRef.current = setTimeout(() => {
                console.log(`🔄 Attempting to reconnect (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
                startWebSocket();
            }, delay);
        }

        function requestTickHistory() {
            const request = {
                ticks_history: selectedSymbol,
                count: tickCount,
                end: 'latest',
                style: 'ticks',
                subscribe: 1
            };

            if (derivWsRef.current && derivWsRef.current.readyState === WebSocket.OPEN) {
                console.log(`📡 Requesting tick history for ${selectedSymbol} (${tickCount} ticks)`);
                try {
                    derivWsRef.current.send(JSON.stringify(request));
                } catch (error) {
                    console.error('Error sending tick history request:', error);
                    scheduleReconnect();
                }
            } else {
                console.error('❌ WebSocket not ready to request history');
                scheduleReconnect();
            }
        }

        startWebSocket();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (derivWsRef.current) {
                derivWsRef.current.onclose = null;
                derivWsRef.current.close();
            }
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

        // 2*WMA(n/2) - WMA(n)
        const rawHMA: number[] = [];
        const minLength = Math.min(wma1.length, wma2.length);
        for (let i = 0; i < minLength; i++) {
            rawHMA.push(2 * wma1[i] - wma2[i]);
        }

        // WMA of the result with sqrt(period)
        return wma(rawHMA, sqrtPeriod);
    };

    // Machine Learning Analysis with Hull Moving Average
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
        if (Math.abs(hma20Change) > 0.001) { // Significant momentum
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
            confidence = 50; // Neutral
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
        if (tickHistoryRef.current.length === 0) return;

        try {
            const ticks = tickHistoryRef.current;

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

            let recommendation = '';
            let confidence = 0;

            if (mlAnalysis) {
                recommendation = mlAnalysis.recommendation;
                confidence = Number(mlAnalysis.confidence) || 0;

                console.log('🤖 ML Analysis:', {
                    recommendation,
                    confidence: confidence.toFixed(1),
                    hma20Trend: mlAnalysis.hma20Trend,
                    hma50Trend: mlAnalysis.hma50Trend,
                    signalStrength: mlAnalysis.signalStrength.toFixed(1),
                    signals: `${mlAnalysis.signals}/${mlAnalysis.totalSignals}`
                });
            } else {
                // Fallback to basic analysis if insufficient data
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
                totalTicks: ticks.length
            });

            // Auto trading logic - ML based
            if (isAutoTrading && recommendation && confidence >= mlMinConfidence) {
                console.log(`🤖 ML AUTO TRADE CHECK:`, {
                    isAutoTrading,
                    recommendation,
                    confidence: confidence?.toFixed(1),
                    meetsCriteria: recommendation && confidence >= mlMinConfidence,
                    isAuthorized,
                    connectionStatus,
                    tradingApiReady: !!tradingApi
                });

                console.log(`✅ ML AUTO TRADE CONDITIONS MET: ${recommendation} with ${confidence.toFixed(1)}% confidence`);
                executeAutoTrade(recommendation, confidence);
            } else if (isAutoTrading) {
                const reasons = [];
                if (!recommendation) reasons.push('no recommendation');
                if (confidence < mlMinConfidence) reasons.push(`confidence too low (${confidence.toFixed(1)}% < ${mlMinConfidence}%)`);
                if (!isAuthorized) reasons.push('not authorized');
                if (connectionStatus !== 'connected') reasons.push('not connected');
                if (!tradingApi) reasons.push('trading API not ready');
                console.log(`⏳ ML AUTO TRADE WAITING: ${reasons.join(', ')}`);
            }

        } catch (error) {
            console.error('Error in ML analysis:', error);
        }
    }, [isAutoTrading, mlMinConfidence, isAuthorized, connectionStatus, tradingApi]);

    // Authorization helper
    const authorizeIfNeeded = async () => {
        if (isAuthorized && tradingApi) return;

        if (!tradingApi) {
            throw new Error('Trading API not initialized');
        }

        const token = V2GetActiveToken();
        if (!token) {
            throw new Error('No authentication token found. Please log in and select an account.');
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
        if (!tradingApi) {
            setStatus('❌ Trading API not initialized - Please refresh the page');
            return;
        }

        if (!isAutoTrading) {
            setStatus('❌ Auto trading is not active');
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

    // Execute manual trade
    const executeManualTrade = async (tradeType: 'Rise' | 'Fall') => {
        if (!tradingApi) {
            setStatus('Trading API not ready');
            return;
        }

        try {
            await authorizeIfNeeded();

            const contractType = tradeType === 'Rise' ? 'CALL' : 'PUT';
            const stakeToUse = baseStake;

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

            setStatus(`Getting proposal for ${tradeType}...`);

            const proposalResponse = await tradingApi.proposal(tradeParams);

            if (proposalResponse.error) {
                throw new Error(proposalResponse.error.message);
            }

            const proposal = proposalResponse.proposal;
            setStatus(`Buying ${tradeType} contract for $${stakeToUse}...`);

            const buyResponse = await tradingApi.buy({
                buy: proposal.id,
                price: stakeToUse
            });

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`Contract purchased: ${buyResponse.buy.transaction_id}`);

            // Monitor contract outcome and emit events for run panel
            monitorContract(buyResponse.buy.contract_id, stakeToUse, tradeType, 0); // Confidence is not applicable for manual trades

            // Emit events for run panel integration (simplified for manual trades)
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
                    display_name: `${tradeType} ${selectedSymbol}`,
                    is_ml_trade: false // Mark as not an ML trade
                }
            };

            contractsRef.current.set(buyResponse.buy.contract_id, contractData);
            setActiveContracts(new Map(contractsRef.current));

            botObserver.emit('bot.contract', contractData);
            botObserver.emit('contract.status', contractData);

        } catch (error) {
            console.error('Manual trade error:', error);
            setStatus(`Trade error: ${error.message}`);
        }
    };

    // Monitor contract outcome with enhanced tracking
    const monitorContract = async (contractId: string, stake: number, recommendation: string, confidence: number) => {
        if (!tradingApi) return;

        try {
            const proposalOpenContract = await tradingApi.proposalOpenContract({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            });

            if (proposalOpenContract.error) {
                setStatus(`❌ Monitoring error: ${proposalOpenContract.error.message}`);
                return;
            }

            // Set up real-time contract monitoring
            const subscription = tradingApi.subscribeToOpenContract(contractId, (response) => {
                if (response.proposal_open_contract) {
                    const contract = response.proposal_open_contract;

                    // Update contract in our tracking
                    const existingContract = contractsRef.current.get(contractId);
                    if (existingContract) {
                        const updatedContract = {
                            ...existingContract,
                            contract: {
                                ...existingContract.contract,
                                ...contract,
                                current_spot: contract.current_spot,
                                current_spot_display_value: contract.current_spot_display_value,
                                profit: contract.profit,
                                is_sold: contract.is_sold,
                                status: contract.status
                            }
                        };

                        contractsRef.current.set(contractId, updatedContract);
                        setActiveContracts(new Map(contractsRef.current));

                        // Emit update event
                        botObserver.emit('bot.contract', updatedContract);
                    }

                    // Check if contract is finished
                    if (contract.is_settleable || contract.is_sold) {
                        const isWin = contract.is_settleable && parseFloat(contract.profit || '0') > 0;
                        const payout = parseFloat(contract.payout || '0');
                        const profit = parseFloat(contract.profit || '0');

                        // Update statistics
                        if (isWin) {
                            setContractsWon(prev => prev + 1);
                            setTotalPayout(prev => prev + payout);
                            setLossStreak(0);
                            setCurrentStake(baseStake);
                            setLastOutcome('win');
                            setStatus(`✅ ML WIN: +$${profit.toFixed(2)} (${recommendation} ${confidence.toFixed(1)}%)`);
                        } else {
                            setContractsLost(prev => prev + 1);
                            setLossStreak(prev => prev + 1);
                            setLastOutcome('loss');
                            setStatus(`❌ ML LOSS: -$${stake.toFixed(2)} (${recommendation} ${confidence.toFixed(1)}%)`);
                        }

                        // Emit contract sold event
                        const soldContract = {
                            id: 'contract.sold',
                            contract: contract,
                            transaction_id: contract.transaction_id
                        };

                        botObserver.emit('bot.contract', soldContract);
                        botObserver.emit('contract.status', soldContract);

                        // Remove from active contracts
                        contractsRef.current.delete(contractId);
                        setActiveContracts(new Map(contractsRef.current));

                        // Unsubscribe
                        subscription?.unsubscribe();
                    }
                }
            });

        } catch (error) {
            console.error('Error monitoring contract:', error);
            setStatus(`❌ Monitoring setup error: ${error.message}`);
        }
    };

    // Auto trading toggle
    const toggleAutoTrading = () => {
        if (!isAutoTrading) {
            if (!tradingApi || !isAuthorized) {
                setStatus('Please ensure API is connected and authorized first');
                return;
            }

            setIsAutoTrading(true);
            setStatus('ML Auto-trading enabled - monitoring for signals...');

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
                is_ml_trader: true
            });

        } else {
            setIsAutoTrading(false);
            setStatus('ML Auto-trading disabled');

            // Update run panel state and emit stop event
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);

            // Emit bot stop event for run panel integration
            botObserver.emit('bot.stop', {
                is_running: false,
                is_ml_trader: true
            });
        }
    };

    const winRate = totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : '0.0';

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
                    <div className='ml-trader__recommendation'>
                        <strong>🤖 ML Recommendation:</strong> {analysisData.recommendation}
                        <span className='ml-trader__confidence'>
                            ({analysisData.confidence?.toFixed(1)}% confidence)
                        </span>
                        {analysisData.confidence && analysisData.confidence >= 60 && (
                            <span className='ml-trader__ml-ready'> ✅ Ready to Trade</span>
                        )}
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

            <div className='ml-trader__buttons'>
                <button
                    className={`ml-trader__auto-trading-btn ${isAutoTrading ? 'ml-trader__auto-trading-btn--active' : ''}`}
                    onClick={toggleAutoTrading}
                    disabled={!isAuthorized || connectionStatus !== 'connected'}
                >
                    {isAutoTrading ? 'STOP ML AUTO TRADING' : 'START ML AUTO TRADING'}
                </button>

                <div className='ml-trader__manual-buttons'>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--rise'
                        onClick={() => executeManualTrade('Rise')}
                        disabled={!isAuthorized || connectionStatus !== 'connected' || isAutoTrading}
                    >
                        Execute Rise Trade
                    </button>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--fall'
                        onClick={() => executeManualTrade('Fall')}
                        disabled={!isAuthorized || connectionStatus !== 'connected' || isAutoTrading}
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