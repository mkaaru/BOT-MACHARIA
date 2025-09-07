
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

    // Trading configuration
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_10');
    const [stakeAmount, setStakeAmount] = useState<number>(1.0);
    const [contractDuration, setContractDuration] = useState<number>(5);
    const [analysisDepth, setAnalysisDepth] = useState<number>(100);
    const [confidenceThreshold, setConfidenceThreshold] = useState<number>(65);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(2.1);
    const [maxMartingaleSteps, setMaxMartingaleSteps] = useState<number>(3);

    // Analysis and trading state
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [isTrading, setIsTrading] = useState<boolean>(false);
    const [analysisResult, setAnalysisResult] = useState<AnalysisData>({});
    const [totalTrades, setTotalTrades] = useState<number>(0);
    const [wins, setWins] = useState<number>(0);
    const [losses, setLosses] = useState<number>(0);
    const [profit, setProfit] = useState<number>(0);
    const [currentMartingaleStep, setCurrentMartingaleStep] = useState<number>(0);
    const [lastTradeResult, setLastTradeResult] = useState<'win' | 'loss' | null>(null);

    // Status and logs
    const [statusMessage, setStatusMessage] = useState<string>('Ready to connect');
    const [tradingLogs, setTradingLogs] = useState<string[]>([]);

    const logMessage = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;
        setTradingLogs(prev => [...prev.slice(-49), logEntry]);
        console.log(logEntry);
    }, []);

    // WebSocket connection management
    const connectWebSocket = useCallback(async () => {
        try {
            setStatusMessage('Connecting to Deriv API...');
            const api = generateDerivApiInstance();
            
            const token = V2GetActiveToken();
            if (!token) {
                throw new Error('No authentication token found. Please login first.');
            }

            // Authorize the connection
            const authResult = await api.authorize(token);
            if (authResult.error) {
                throw new Error(`Authorization failed: ${authResult.error.message}`);
            }

            derivWsRef.current = api;
            setConnectionStatus('connected');
            setStatusMessage('Connected to Deriv API');
            logMessage('Successfully connected to Deriv API');

            return api;
        } catch (error: any) {
            setConnectionStatus('error');
            setStatusMessage(`Connection failed: ${error.message}`);
            logMessage(`Connection error: ${error.message}`);
            throw error;
        }
    }, [logMessage]);

    const disconnectWebSocket = useCallback(() => {
        if (derivWsRef.current) {
            try {
                derivWsRef.current.disconnect();
            } catch (error) {
                console.warn('Error disconnecting WebSocket:', error);
            }
            derivWsRef.current = null;
        }
        setConnectionStatus('disconnected');
        setStatusMessage('Disconnected');
        logMessage('Disconnected from Deriv API');
    }, [logMessage]);

    // Tick data collection
    const startTickCollection = useCallback(async (symbol: string) => {
        if (!derivWsRef.current) {
            throw new Error('WebSocket not connected');
        }

        try {
            logMessage(`Starting tick collection for ${symbol}`);
            
            // Subscribe to ticks
            const tickResponse = await derivWsRef.current.send({
                ticks: symbol,
                subscribe: 1
            });

            if (tickResponse.error) {
                throw new Error(`Tick subscription failed: ${tickResponse.error.message}`);
            }

            // Set up tick data handler
            derivWsRef.current.connection.addEventListener('message', (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.msg_type === 'tick' && data.tick?.symbol === symbol) {
                        const tickData: TickData = {
                            time: data.tick.epoch,
                            quote: parseFloat(data.tick.quote)
                        };

                        setCurrentPrice(tickData.quote);
                        tickHistoryRef.current = [...tickHistoryRef.current.slice(-999), tickData];
                        
                        // Auto-analyze if enabled
                        if (isAnalyzing) {
                            performAnalysis();
                        }
                    }
                } catch (error) {
                    console.warn('Error parsing tick data:', error);
                }
            });

            logMessage(`Tick subscription active for ${symbol}`);
        } catch (error: any) {
            logMessage(`Tick collection error: ${error.message}`);
            throw error;
        }
    }, [isAnalyzing, logMessage]);

    // ML Analysis Engine
    const performAnalysis = useCallback(() => {
        const ticks = tickHistoryRef.current;
        if (ticks.length < analysisDepth) {
            setAnalysisResult({
                recommendation: 'Insufficient data',
                confidence: 0,
                totalTicks: ticks.length
            });
            return;
        }

        const recentTicks = ticks.slice(-analysisDepth);
        let riseCount = 0;
        let fallCount = 0;

        // Simple trend analysis
        for (let i = 1; i < recentTicks.length; i++) {
            if (recentTicks[i].quote > recentTicks[i - 1].quote) {
                riseCount++;
            } else if (recentTicks[i].quote < recentTicks[i - 1].quote) {
                fallCount++;
            }
        }

        const total = riseCount + fallCount;
        const riseRatio = total > 0 ? (riseCount / total) * 100 : 50;
        const fallRatio = total > 0 ? (fallCount / total) * 100 : 50;

        // Enhanced analysis with multiple indicators
        const prices = recentTicks.map(t => t.quote);
        const sma5 = calculateSMA(prices, 5);
        const sma20 = calculateSMA(prices, 20);
        const rsi = calculateRSI(prices, 14);
        
        // Determine recommendation based on multiple factors
        let recommendation = 'HOLD';
        let confidence = 0;

        if (riseRatio > fallRatio) {
            recommendation = 'RISE';
            confidence = Math.min(riseRatio, 85);
        } else {
            recommendation = 'FALL';
            confidence = Math.min(fallRatio, 85);
        }

        // Adjust confidence based on technical indicators
        if (sma5 > sma20 && rsi < 70) {
            confidence += 5;
        } else if (sma5 < sma20 && rsi > 30) {
            confidence += 5;
        }

        confidence = Math.min(confidence, 95);

        const result: AnalysisData = {
            recommendation,
            confidence: Math.round(confidence),
            riseRatio: Math.round(riseRatio),
            fallRatio: Math.round(fallRatio),
            totalTicks: recentTicks.length
        };

        setAnalysisResult(result);

        // Auto-trade if conditions are met
        if (isTrading && confidence >= confidenceThreshold && recommendation !== 'HOLD') {
            executeTrade(recommendation);
        }
    }, [analysisDepth, confidenceThreshold, isTrading, logMessage]);

    // Technical indicators
    const calculateSMA = (prices: number[], period: number): number => {
        if (prices.length < period) return prices[prices.length - 1] || 0;
        const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    };

    const calculateRSI = (prices: number[], period: number): number => {
        if (prices.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses -= change;
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    };

    // Trade execution
    const executeTrade = useCallback(async (direction: string) => {
        if (!derivWsRef.current) {
            logMessage('Cannot execute trade: WebSocket not connected');
            return;
        }

        try {
            const currentStake = stakeAmount * Math.pow(martingaleMultiplier, currentMartingaleStep);
            
            logMessage(`Executing ${direction} trade with stake: ${currentStake.toFixed(2)}`);

            const tradeParams = {
                buy: '1',
                price: currentStake,
                parameters: {
                    amount: currentStake,
                    basis: 'stake',
                    contract_type: direction === 'RISE' ? 'CALL' : 'PUT',
                    currency: 'USD',
                    duration: contractDuration,
                    duration_unit: 't',
                    symbol: selectedSymbol
                }
            };

            const buyResponse = await derivWsRef.current.send(tradeParams);

            if (buyResponse.error) {
                throw new Error(`Trade execution failed: ${buyResponse.error.message}`);
            }

            setTotalTrades(prev => prev + 1);
            logMessage(`Trade placed successfully. Contract ID: ${buyResponse.buy.contract_id}`);

            // Monitor the contract
            monitorContract(buyResponse.buy.contract_id, currentStake);

        } catch (error: any) {
            logMessage(`Trade execution error: ${error.message}`);
        }
    }, [derivWsRef, stakeAmount, martingaleMultiplier, currentMartingaleStep, contractDuration, selectedSymbol, logMessage]);

    const monitorContract = useCallback(async (contractId: string, stakeAmount: number) => {
        if (!derivWsRef.current) return;

        try {
            // Subscribe to contract updates
            const contractResponse = await derivWsRef.current.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            });

            if (contractResponse.error) {
                throw new Error(`Contract monitoring failed: ${contractResponse.error.message}`);
            }

            // Handle contract updates
            const handleContractUpdate = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.contract_id === contractId) {
                        const contract = data.proposal_open_contract;
                        
                        if (contract.is_sold) {
                            const payout = parseFloat(contract.payout || '0');
                            const contractProfit = payout - stakeAmount;
                            
                            setProfit(prev => prev + contractProfit);
                            
                            if (contractProfit > 0) {
                                setWins(prev => prev + 1);
                                setLastTradeResult('win');
                                setCurrentMartingaleStep(0); // Reset martingale on win
                                logMessage(`Trade WON! Profit: ${contractProfit.toFixed(2)}`);
                            } else {
                                setLosses(prev => prev + 1);
                                setLastTradeResult('loss');
                                setCurrentMartingaleStep(prev => Math.min(prev + 1, maxMartingaleSteps));
                                logMessage(`Trade LOST! Loss: ${Math.abs(contractProfit).toFixed(2)}`);
                            }
                            
                            // Remove this specific event listener
                            derivWsRef.current?.connection?.removeEventListener('message', handleContractUpdate);
                        }
                    }
                } catch (error) {
                    console.warn('Error parsing contract update:', error);
                }
            };

            derivWsRef.current.connection.addEventListener('message', handleContractUpdate);

        } catch (error: any) {
            logMessage(`Contract monitoring error: ${error.message}`);
        }
    }, [derivWsRef, maxMartingaleSteps, logMessage]);

    // Control functions
    const handleStartAnalysis = useCallback(async () => {
        try {
            setIsAnalyzing(true);
            if (connectionStatus !== 'connected') {
                await connectWebSocket();
            }
            await startTickCollection(selectedSymbol);
            setStatusMessage('Analysis started');
            logMessage('Market analysis started');
        } catch (error: any) {
            setIsAnalyzing(false);
            setStatusMessage(`Analysis start failed: ${error.message}`);
            logMessage(`Failed to start analysis: ${error.message}`);
        }
    }, [connectionStatus, connectWebSocket, startTickCollection, selectedSymbol, logMessage]);

    const handleStopAnalysis = useCallback(() => {
        setIsAnalyzing(false);
        setStatusMessage('Analysis stopped');
        logMessage('Market analysis stopped');
    }, [logMessage]);

    const handleStartTrading = useCallback(async () => {
        try {
            setIsTrading(true);
            if (!isAnalyzing) {
                await handleStartAnalysis();
            }
            setStatusMessage('Auto-trading started');
            logMessage('Auto-trading started');
        } catch (error: any) {
            setIsTrading(false);
            setStatusMessage(`Trading start failed: ${error.message}`);
            logMessage(`Failed to start trading: ${error.message}`);
        }
    }, [isAnalyzing, handleStartAnalysis, logMessage]);

    const handleStopTrading = useCallback(() => {
        setIsTrading(false);
        setStatusMessage('Auto-trading stopped');
        logMessage('Auto-trading stopped');
    }, [logMessage]);

    const resetStats = useCallback(() => {
        setTotalTrades(0);
        setWins(0);
        setLosses(0);
        setProfit(0);
        setCurrentMartingaleStep(0);
        setLastTradeResult(null);
        setTradingLogs([]);
        tickHistoryRef.current = [];
        logMessage('Statistics reset');
    }, [logMessage]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disconnectWebSocket();
        };
    }, [disconnectWebSocket]);

    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
    const avgProfit = totalTrades > 0 ? (profit / totalTrades).toFixed(2) : '0.00';

    return (
        <div className='ml-trader'>
            <div className='ml-trader__container'>
                <div className='ml-trader__header'>
                    <h2 className='ml-trader__title'>{localize('🤖 AI ML Trading Engine')}</h2>
                    <p className='ml-trader__subtitle'>{localize('Advanced machine learning powered trading system')}</p>
                </div>

                <div className='ml-trader__content'>
                    <div className='ml-trader__card'>
                        {/* Connection Status */}
                        <div className='ml-trader__row'>
                            <div className='ml-trader__status-section'>
                                <div className={`ml-trader__connection-status ml-trader__connection-status--${connectionStatus}`}>
                                    {connectionStatus === 'connected' ? '🟢' : connectionStatus === 'error' ? '🔴' : '🟡'} 
                                    {connectionStatus.toUpperCase()}
                                </div>
                                <Text size='xs' color='general'>{statusMessage}</Text>
                            </div>
                        </div>

                        {/* Trading Configuration */}
                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label>{localize('Symbol')}</label>
                                <select 
                                    value={selectedSymbol} 
                                    onChange={(e) => setSelectedSymbol(e.target.value)}
                                    disabled={isTrading}
                                >
                                    {VOLATILITY_INDICES.map(symbol => (
                                        <option key={symbol.value} value={symbol.value}>
                                            {symbol.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='ml-trader__field'>
                                <label>{localize('Stake Amount')}</label>
                                <input
                                    type='number'
                                    step='0.01'
                                    min='0.35'
                                    value={stakeAmount}
                                    onChange={(e) => setStakeAmount(parseFloat(e.target.value))}
                                    disabled={isTrading}
                                />
                            </div>
                        </div>

                        <div className='ml-trader__row ml-trader__row--compact'>
                            <div className='ml-trader__field'>
                                <label>{localize('Duration (Ticks)')}</label>
                                <input
                                    type='number'
                                    min='1'
                                    max='10'
                                    value={contractDuration}
                                    onChange={(e) => setContractDuration(parseInt(e.target.value))}
                                    disabled={isTrading}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label>{localize('Analysis Depth')}</label>
                                <input
                                    type='number'
                                    min='50'
                                    max='500'
                                    value={analysisDepth}
                                    onChange={(e) => setAnalysisDepth(parseInt(e.target.value))}
                                    disabled={isTrading}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label>{localize('Confidence Threshold (%)')}</label>
                                <input
                                    type='number'
                                    min='50'
                                    max='90'
                                    value={confidenceThreshold}
                                    onChange={(e) => setConfidenceThreshold(parseInt(e.target.value))}
                                    disabled={isTrading}
                                />
                            </div>
                        </div>

                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label>{localize('Martingale Multiplier')}</label>
                                <input
                                    type='number'
                                    step='0.1'
                                    min='1.1'
                                    max='3.0'
                                    value={martingaleMultiplier}
                                    onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value))}
                                    disabled={isTrading}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label>{localize('Max Martingale Steps')}</label>
                                <input
                                    type='number'
                                    min='1'
                                    max='5'
                                    value={maxMartingaleSteps}
                                    onChange={(e) => setMaxMartingaleSteps(parseInt(e.target.value))}
                                    disabled={isTrading}
                                />
                            </div>
                        </div>

                        {/* Current Market Data */}
                        <div className='ml-trader__market-data'>
                            <div className='ml-trader__price-display'>
                                <Text size='m' weight='bold'>
                                    {localize('Current Price')}: {currentPrice.toFixed(4)}
                                </Text>
                            </div>
                            <div className='ml-trader__ticks-collected'>
                                <Text size='xs'>
                                    {localize('Ticks Collected')}: {tickHistoryRef.current.length}
                                </Text>
                            </div>
                        </div>

                        {/* Analysis Results */}
                        {analysisResult.recommendation && (
                            <div className='ml-trader__analysis'>
                                <div className='ml-trader__analysis-header'>
                                    <Text size='s' weight='bold'>{localize('ML Analysis Results')}</Text>
                                </div>
                                <div className='ml-trader__analysis-content'>
                                    <div className={`ml-trader__recommendation ml-trader__recommendation--${analysisResult.recommendation?.toLowerCase()}`}>
                                        <Text size='m' weight='bold'>
                                            {analysisResult.recommendation} ({analysisResult.confidence}%)
                                        </Text>
                                    </div>
                                    <div className='ml-trader__analysis-details'>
                                        <Text size='xs'>
                                            {localize('Rise')}: {analysisResult.riseRatio}% | 
                                            {localize('Fall')}: {analysisResult.fallRatio}%
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Trading Statistics */}
                        <div className='ml-trader__stats'>
                            <div className='ml-trader__stats-header'>
                                <Text size='s' weight='bold'>{localize('Trading Statistics')}</Text>
                            </div>
                            <div className='ml-trader__stats-grid'>
                                <div className='ml-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Total Trades')}</Text>
                                    <Text size='s' weight='bold'>{totalTrades}</Text>
                                </div>
                                <div className='ml-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Wins')}</Text>
                                    <Text size='s' weight='bold' color='profit-success'>{wins}</Text>
                                </div>
                                <div className='ml-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Losses')}</Text>
                                    <Text size='s' weight='bold' color='loss-danger'>{losses}</Text>
                                </div>
                                <div className='ml-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Win Rate')}</Text>
                                    <Text size='s' weight='bold'>{winRate}%</Text>
                                </div>
                                <div className='ml-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Total Profit')}</Text>
                                    <Text 
                                        size='s' 
                                        weight='bold' 
                                        color={profit >= 0 ? 'profit-success' : 'loss-danger'}
                                    >
                                        ${profit.toFixed(2)}
                                    </Text>
                                </div>
                                <div className='ml-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Avg Per Trade')}</Text>
                                    <Text size='s' weight='bold'>${avgProfit}</Text>
                                </div>
                            </div>
                        </div>

                        {/* Control Buttons */}
                        <div className='ml-trader__actions'>
                            <div className='ml-trader__actions-row'>
                                <button
                                    className='ml-trader__btn ml-trader__btn--primary'
                                    onClick={handleStartAnalysis}
                                    disabled={isAnalyzing}
                                >
                                    {isAnalyzing ? localize('Analyzing...') : localize('Start Analysis')}
                                </button>
                                <button
                                    className='ml-trader__btn ml-trader__btn--secondary'
                                    onClick={handleStopAnalysis}
                                    disabled={!isAnalyzing}
                                >
                                    {localize('Stop Analysis')}
                                </button>
                            </div>
                            <div className='ml-trader__actions-row'>
                                <button
                                    className='ml-trader__btn ml-trader__btn--success'
                                    onClick={handleStartTrading}
                                    disabled={isTrading}
                                >
                                    {isTrading ? localize('Trading Active...') : localize('Start Auto Trading')}
                                </button>
                                <button
                                    className='ml-trader__btn ml-trader__btn--danger'
                                    onClick={handleStopTrading}
                                    disabled={!isTrading}
                                >
                                    {localize('Stop Trading')}
                                </button>
                            </div>
                            <div className='ml-trader__actions-row'>
                                <button
                                    className='ml-trader__btn ml-trader__btn--neutral'
                                    onClick={resetStats}
                                    disabled={isTrading}
                                >
                                    {localize('Reset Statistics')}
                                </button>
                                <button
                                    className='ml-trader__btn ml-trader__btn--neutral'
                                    onClick={disconnectWebSocket}
                                    disabled={isTrading}
                                >
                                    {localize('Disconnect')}
                                </button>
                            </div>
                        </div>

                        {/* Trading Logs */}
                        <div className='ml-trader__logs'>
                            <div className='ml-trader__logs-header'>
                                <Text size='s' weight='bold'>{localize('Trading Logs')}</Text>
                            </div>
                            <div className='ml-trader__logs-content'>
                                {tradingLogs.slice(-10).map((log, index) => (
                                    <div key={index} className='ml-trader__log-entry'>
                                        <Text size='xs' color='general'>{log}</Text>
                                    </div>
                                ))}
                                {tradingLogs.length === 0 && (
                                    <Text size='xs' color='general'>{localize('No logs yet...')}</Text>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLTrader;
