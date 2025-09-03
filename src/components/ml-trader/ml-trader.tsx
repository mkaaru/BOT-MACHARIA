import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import './ml-trader.scss';

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
}

const MLTrader = observer(() => {
    // WebSocket and connection state
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const derivWsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<TickData[]>([]);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);

    // Trading parameters
    const [selectedSymbol, setSelectedSymbol] = useState('R_100');
    const [tickCount, setTickCount] = useState(4500);
    const [baseStake, setBaseStake] = useState(0.5);
    const [tickDuration, setTickDuration] = useState(1);
    const [martingaleSteps, setMartingaleSteps] = useState(1);

    // Trading condition
    const [conditionType, setConditionType] = useState('Rise Prob');
    const [conditionOperator, setConditionOperator] = useState('>');
    const [conditionValue, setConditionValue] = useState(55);

    // Trading state
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [analysisData, setAnalysisData] = useState<AnalysisData>({});
    const [lossStreak, setLossStreak] = useState(0);
    const [currentStake, setCurrentStake] = useState(0.5);
    const [lastOutcome, setLastOutcome] = useState<'win' | 'loss' | null>(null);

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

    // Auto trading interval - KEY ADDITION FROM WORKING CODE
    const [tradingInterval, setTradingInterval] = useState<NodeJS.Timeout | null>(null);
    const lastTradeTimeRef = useRef(0);
    const minTimeBetweenTrades = 3000; // 3 seconds minimum between trades

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

                            if (tickHistoryRef.current.length > Math.max(tickCount, 5000)) {
                                tickHistoryRef.current = tickHistoryRef.current.slice(-tickCount);
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

    // Update analysis when tick data changes - REMOVED AUTO TRADING LOGIC FROM HERE
    const updateAnalysis = useCallback(() => {
        if (tickHistoryRef.current.length === 0) return;

        try {
            const ticks = tickHistoryRef.current;
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

            let recommendation = '';
            let confidence = 0;

            if (riseRatio > 50) {
                recommendation = 'Rise';
                confidence = riseRatio;
            } else if (fallRatio > 50) {
                recommendation = 'Fall';
                confidence = fallRatio;
            }

            setAnalysisData({
                recommendation,
                confidence,
                riseRatio,
                fallRatio,
                totalTicks: ticks.length
            });

        } catch (error) {
            console.error('Error in analysis:', error);
        }
    }, []);

    // NEW: Separate auto-trading condition checker (from working VolatilityAnalyzer)
    const checkTradingConditions = useCallback(() => {
        if (!analysisData || Object.keys(analysisData).length === 0) {
            return false;
        }

        let currentValue = 0;
        const timestamp = new Date().toLocaleTimeString();

        switch (conditionType) {
            case 'Rise Prob':
                currentValue = analysisData.riseRatio || 0;
                break;
            case 'Fall Prob':
                currentValue = analysisData.fallRatio || 0;
                break;
            default:
                console.warn(`[${timestamp}] Unknown condition type:`, conditionType);
                return false;
        }

        if (isNaN(currentValue) || currentValue === 0) {
            console.log(`[${timestamp}] Invalid or zero value for ${conditionType}:`, currentValue);
            return false;
        }

        const result = (() => {
            switch (conditionOperator) {
                case '>':
                    return currentValue > conditionValue;
                case '>=':
                    return currentValue >= conditionValue;
                case '<':
                    return currentValue < conditionValue;
                case '=':
                    return Math.abs(currentValue - conditionValue) < 0.1;
                default:
                    console.warn(`[${timestamp}] Unknown operator:`, conditionOperator);
                    return false;
            }
        })();

        const logStyle = result ? '🟢' : '🔴';
        console.log(`[${timestamp}] ${logStyle} Condition check:`, {
            condition: conditionType,
            currentValue: currentValue.toFixed(2),
            operator: conditionOperator,
            threshold: conditionValue,
            result: result ? 'MET ✅' : 'NOT MET ❌'
        });

        return result;
    }, [analysisData, conditionType, conditionOperator, conditionValue]);

    // Authorization helper
    const authorizeIfNeeded = async () => {
        if (isAuthorized || !tradingApi) return;

        const token = V2GetActiveToken();
        if (!token) {
            throw new Error('No token found. Please log in and select an account.');
        }

        const { authorize, error } = await tradingApi.authorize(token);
        if (error) {
            throw new Error(`Authorization error: ${error.message || error.code}`);
        }

        setIsAuthorized(true);
        console.log('✅ Trading API authorized successfully');
    };

    // Auto trade execution with enhanced debugging and connection checks
    const executeAutoTrade = async () => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🚀 Checking auto trade conditions`);

        if (!tradingApi) {
            console.error(`[${timestamp}] Trading API not ready`);
            return;
        }

        // Add connection check
        if (!tradingApi.connection || tradingApi.connection.readyState !== WebSocket.OPEN) {
            console.error(`[${timestamp}] Trading API connection not ready`);
            return;
        }

        if (connectionStatus !== 'connected') {
            console.error(`[${timestamp}] Not connected to market data API`);
            return;
        }

        // Check if enough time has passed since last trade
        const currentTime = Date.now();
        if (currentTime - lastTradeTimeRef.current < minTimeBetweenTrades) {
            console.log(`[${timestamp}] Too soon since last trade, skipping`);
            return;
        }

        // Check trading conditions
        const conditionsMet = checkTradingConditions();
        if (!conditionsMet) {
            console.log(`[${timestamp}] Trading conditions not met`);
            return;
        }

        try {
            await authorizeIfNeeded();

            // Determine contract type based on condition
            let contractType = '';
            if (conditionType === 'Rise Prob') {
                contractType = 'CALL';
            } else if (conditionType === 'Fall Prob') {
                contractType = 'PUT';
            } else {
                // Default based on current analysis
                contractType = (analysisData.riseRatio || 0) > (analysisData.fallRatio || 0) ? 'CALL' : 'PUT';
            }

            // Calculate stake with martingale
            const stakeToUse = lastOutcome === 'loss' && lossStreak > 0
                ? Math.min(currentStake * martingaleSteps, baseStake * 10)
                : baseStake;

            setCurrentStake(stakeToUse);

            const buyRequest = {
                buy: '1',
                price: stakeToUse,
                parameters: {
                    amount: stakeToUse,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: 'USD',
                    duration: tickDuration,
                    duration_unit: 't',
                    symbol: selectedSymbol
                }
            };

            console.log(`[${timestamp}] Sending buy request:`, JSON.stringify(buyRequest, null, 2));
            setStatus(`Auto trading: Buying ${contractType} contract for $${stakeToUse}...`);

            lastTradeTimeRef.current = currentTime;

            const buyResponse = await tradingApi.buy(buyRequest);
            console.log(`[${timestamp}] Buy response:`, JSON.stringify(buyResponse, null, 2));

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            if (!buyResponse.buy || !buyResponse.buy.contract_id) {
                throw new Error('Invalid buy response: missing contract_id');
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`✅ Auto trade executed: ${buyResponse.buy.contract_id}`);
            console.log(`[${timestamp}] ✅ Auto trade successful: ${buyResponse.buy.contract_id}`);

            monitorContract(buyResponse.buy.contract_id, stakeToUse);

        } catch (error) {
            console.error(`[${timestamp}] ❌ Auto trade error:`, error);
            setStatus(`Auto trade error: ${error.message}`);
            setLastOutcome('loss');
            setLossStreak(prev => prev + 1);
        }
    };

    // Execute manual trade (unchanged)
    const executeManualTrade = async (tradeType: 'Rise' | 'Fall') => {
        if (!tradingApi) {
            setStatus('Trading API not ready');
            return;
        }

        try {
            await authorizeIfNeeded();

            const contractType = tradeType === 'Rise' ? 'CALL' : 'PUT';
            const stakeToUse = baseStake;

            const buyRequest = {
                buy: '1',
                price: stakeToUse,
                parameters: {
                    amount: stakeToUse,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: 'USD',
                    duration: tickDuration,
                    duration_unit: 't',
                    symbol: selectedSymbol
                }
            };

            setStatus(`Buying ${tradeType} contract for $${stakeToUse}...`);

            const buyResponse = await tradingApi.buy(buyRequest);

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`Contract purchased: ${buyResponse.buy.contract_id}`);

            monitorContract(buyResponse.buy.contract_id, stakeToUse);

        } catch (error) {
            console.error('Manual trade error:', error);
            setStatus(`Trade error: ${error.message}`);
        }
    };

    // Monitor contract outcome with proper MessageEvent handling
    const monitorContract = async (contractId: string, stakeAmount: number) => {
        try {
            // Check if trading API connection is available
            if (!tradingApi?.connection) {
                throw new Error('Trading API connection not available');
            }

            const subscribeRequest = {
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            };

            // Send subscription request
            await tradingApi.send(subscribeRequest);

            // Create proper message handler for WebSocket events
            const handleContractUpdate = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.msg_type === 'proposal_open_contract' &&
                        data.proposal_open_contract &&
                        String(data.proposal_open_contract.contract_id) === String(contractId)) {

                        const contract = data.proposal_open_contract;

                        if (contract.is_sold || contract.status === 'sold') {
                            const profit = Number(contract.profit || 0);
                            const payout = Number(contract.payout || 0);

                            setTotalPayout(prev => prev + payout);

                            if (profit > 0) {
                                setContractsWon(prev => prev + 1);
                                setLastOutcome('win');
                                setLossStreak(0);
                                setCurrentStake(baseStake);
                                setStatus(`✅ Contract won! Profit: $${profit.toFixed(2)}`);
                            } else {
                                setContractsLost(prev => prev + 1);
                                setLastOutcome('loss');
                                setLossStreak(prev => prev + 1);
                                setStatus(`❌ Contract lost. Loss: $${Math.abs(profit).toFixed(2)}`);
                            }

                            // Remove listener
                            tradingApi.connection.removeEventListener('message', handleContractUpdate);
                        }
                    }
                } catch (error) {
                    console.error('Error processing contract update:', error);
                }
            };

            // Add event listener to the actual connection
            tradingApi.connection.addEventListener('message', handleContractUpdate);

            // Auto cleanup after 5 minutes
            setTimeout(() => {
                if (tradingApi.connection) {
                    tradingApi.connection.removeEventListener('message', handleContractUpdate);
                }
            }, 300000);

        } catch (error) {
            console.error('Error monitoring contract:', error);
            setStatus(`Monitoring error: ${error.message}`);
        }
    };

    // NEW: Auto trading management (combining start/stop)
    const startAutoTrading = () => {
        if (connectionStatus !== 'connected') {
            alert('Cannot start auto trading: Not connected to market data API');
            return;
        }

        if (!tradingApi) {
            alert('Trading API not initialized');
            return;
        }

        if (!tradingApi.connection || tradingApi.connection.readyState !== WebSocket.OPEN) {
            alert('Trading API connection not ready. Please wait...');
            return;
        }

        // Clear existing interval if any
        if (tradingInterval) {
            clearInterval(tradingInterval);
            setTradingInterval(null);
        }

        setIsAutoTrading(true);
        setStatus('Auto trading started - checking conditions...');

        // More conservative interval timing
        let intervalMs = 2000; // 2 seconds default
        if (selectedSymbol.includes('1HZ')) {
            intervalMs = 1500; // 1.5 seconds for 1s volatilities
        }

        console.log(`Starting auto trading with ${intervalMs}ms interval`);

        // Create the trading interval
        const interval = setInterval(executeAutoTrade, intervalMs);
        setTradingInterval(interval);

        console.log('✅ Auto trading started');
    };

    const stopAutoTrading = () => {
        if (tradingInterval) {
            clearInterval(tradingInterval);
            setTradingInterval(null);
        }

        setIsAutoTrading(false);
        setStatus('Auto trading stopped');
        console.log('Auto trading stopped');
    };

    // NEW: Toggle auto trading (combining start/stop)
    const toggleAutoTrading = () => {
        if (isAutoTrading) {
            stopAutoTrading();
        } else {
            startAutoTrading();
        }
    };

    // Add trading API status monitoring
    useEffect(() => {
        console.log('Trading API status:', {
            hasTradingApi: !!tradingApi,
            isAuthorized,
            connectionReady: tradingApi?.connection?.readyState === WebSocket.OPEN
        });
    }, [tradingApi, isAuthorized]);

    // Add connection status monitoring
    useEffect(() => {
        const checkConnection = () => {
            if (tradingApi?.connection) {
                console.log('Trading API connection state:', tradingApi.connection.readyState);
            }
        };

        const interval = setInterval(checkConnection, 5000);
        return () => clearInterval(interval);
    }, [tradingApi]);

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (tradingInterval) {
                clearInterval(tradingInterval);
            }
        };
    }, [tradingInterval]);

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
                        max={5000}
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
                        <strong>Recommendation:</strong> {analysisData.recommendation}
                        <span className='ml-trader__confidence'>({analysisData.confidence?.toFixed(1)}%)</span>
                    </div>
                )}
            </div>

            <div className='ml-trader__trading-condition'>
                <h4>Trading Condition</h4>
                <div className='ml-trader__condition-row'>
                    <span>If</span>
                    <select value={conditionType} onChange={(e) => setConditionType(e.target.value)}>
                        <option value='Rise Prob'>Rise Prob</option>
                        <option value='Fall Prob'>Fall Prob</option>
                    </select>
                    <select value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value)}>
                        <option value='>'>{'>'}</option>
                        <option value='>='>{'≥'}</option>
                    </select>
                    <input
                        type='number'
                        min={50}
                        max={95}
                        value={conditionValue}
                        onChange={(e) => setConditionValue(Number(e.target.value))}
                    />
                    <span>%</span>
                </div>
                <div className='ml-trader__condition-row'>
                    <span>Then</span>
                    <span>Buy {conditionType === 'Rise Prob' ? 'Rise' : 'Fall'}</span>
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
                    {isAutoTrading ? 'STOP AUTO TRADING' : 'START AUTO TRADING'}
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

            <div className='ml-trader__statistics'>
                <h4>Trading Statistics</h4>
                <div className='ml-trader__stats-grid'>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Total Stake: ${totalStake.toFixed(2)}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Total Payout: ${totalPayout.toFixed(2)}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Total Runs: {totalRuns}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Won: {contractsWon}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Lost: {contractsLost}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Win Rate: {winRate}%</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>P&L: ${totalProfitLoss.toFixed(2)}</Text>
                    </div>
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