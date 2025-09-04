
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import './ml-trader.scss';

// Volatility indices for scanning
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
];

interface TickData {
    time: number;
    quote: number;
}

interface EhlersAnalysis {
    symbol: string;
    signal: 'RISE' | 'FALL' | 'NONE';
    strength: number;
    smi: number;
    mama: number;
    fama: number;
    cyberCycle: number;
    dominantCycle: number;
    iTrend: number;
}

interface SymbolData {
    symbol: string;
    ticks: TickData[];
    lastUpdate: number;
    analysis: EhlersAnalysis | null;
}

const EhlersTrader = observer(() => {
    // WebSocket connections - one for market data, one for trading
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
    const marketWsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);

    // Symbol data storage
    const symbolDataRef = useRef<Map<string, SymbolData>>(new Map());
    const [bestSymbol, setBestSymbol] = useState<string>('');
    const [currentAnalyses, setCurrentAnalyses] = useState<Map<string, EhlersAnalysis>>(new Map());

    // Trading parameters
    const [tickCount, setTickCount] = useState(1000);
    const [baseStake, setBaseStake] = useState(0.5);
    const [tickDuration, setTickDuration] = useState(1);
    const [stopLoss, setStopLoss] = useState(-10.0); // Stop loss in USD
    const [takeProfit, setTakeProfit] = useState(20.0); // Take profit in USD
    const [enableStopLoss, setEnableStopLoss] = useState(true);
    const [enableTakeProfit, setEnableTakeProfit] = useState(true);

    // Martingale state
    const [consecutiveWins, setConsecutiveWins] = useState(0);
    const [martingaleStake, setMartingaleStake] = useState(0.5);
    const [lastOutcome, setLastOutcome] = useState<'win' | 'loss' | null>(null);

    // Trading state
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [tradingInterval, setTradingInterval] = useState<NodeJS.Timeout | null>(null);
    const lastTradeTimeRef = useRef(0);
    const minTimeBetweenTrades = 3000;

    // Trading API
    const [tradingApi, setTradingApi] = useState<any>(null);
    const [isAuthorized, setIsAuthorized] = useState(false);

    // Statistics
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [currentPnL, setCurrentPnL] = useState(0);
    const [sessionStartPnL, setSessionStartPnL] = useState(0);

    // Status
    const [status, setStatus] = useState('');
    const [scanningStatus, setScanningStatus] = useState('');

    const totalProfitLoss = totalPayout - totalStake;
    const sessionPnL = currentPnL - sessionStartPnL;

    // John Ehlers Technical Analysis Functions
    const calculateEMA = (data: number[], period: number): number[] => {
        const ema = [];
        const multiplier = 2 / (period + 1);
        ema[0] = data[0];
        
        for (let i = 1; i < data.length; i++) {
            ema[i] = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
        }
        return ema;
    };

    const calculateSMI = (highs: number[], lows: number[], closes: number[], kPeriod = 14, dPeriod = 3): number => {
        if (closes.length < kPeriod) return 0;
        
        const recentCloses = closes.slice(-kPeriod);
        const recentHighs = highs.slice(-kPeriod);
        const recentLows = lows.slice(-kPeriod);
        
        const highestHigh = Math.max(...recentHighs);
        const lowestLow = Math.min(...recentLows);
        const currentClose = closes[closes.length - 1];
        
        if (highestHigh === lowestLow) return 0;
        
        const smi = ((currentClose - (highestHigh + lowestLow) / 2) / ((highestHigh - lowestLow) / 2)) * 100;
        return Math.max(-100, Math.min(100, smi));
    };

    const calculateMAMA = (prices: number[], fastLimit = 0.5, slowLimit = 0.05): { mama: number, fama: number } => {
        if (prices.length < 5) return { mama: prices[prices.length - 1] || 0, fama: prices[prices.length - 1] || 0 };
        
        const recentPrices = prices.slice(-50);
        const smoothPrices = calculateEMA(recentPrices, 5);
        
        // Simplified MAMA calculation
        let period = 10;
        let alpha = 2 / (period + 1);
        alpha = Math.max(slowLimit, Math.min(fastLimit, alpha));
        
        const mama = smoothPrices[smoothPrices.length - 1];
        const fama = smoothPrices[smoothPrices.length - 2] || mama;
        
        return { mama, fama };
    };

    const calculateCyberCycle = (prices: number[]): number => {
        if (prices.length < 7) return 0;
        
        const alpha = 0.07;
        const recentPrices = prices.slice(-7);
        
        // Simplified Cyber Cycle calculation
        const smooth = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
        const cycle = (recentPrices[recentPrices.length - 1] - smooth) / smooth * 100;
        
        return Math.max(-50, Math.min(50, cycle));
    };

    const calculateDominantCycle = (prices: number[]): number => {
        if (prices.length < 20) return 20;
        
        // Simplified dominant cycle period calculation
        const recentPrices = prices.slice(-40);
        let maxCorrelation = 0;
        let dominantPeriod = 20;
        
        for (let period = 10; period <= 30; period++) {
            if (recentPrices.length >= period * 2) {
                let correlation = 0;
                for (let i = 0; i < period; i++) {
                    const idx1 = recentPrices.length - 1 - i;
                    const idx2 = recentPrices.length - 1 - i - period;
                    if (idx2 >= 0) {
                        correlation += recentPrices[idx1] * recentPrices[idx2];
                    }
                }
                if (Math.abs(correlation) > Math.abs(maxCorrelation)) {
                    maxCorrelation = correlation;
                    dominantPeriod = period;
                }
            }
        }
        
        return dominantPeriod;
    };

    const calculateITrend = (prices: number[]): number => {
        if (prices.length < 7) return 0;
        
        const alpha = 0.07;
        const recentPrices = prices.slice(-7);
        
        // Simplified iTrend calculation
        const ema1 = calculateEMA(recentPrices, 3);
        const ema2 = calculateEMA(recentPrices, 7);
        
        const iTrend = ((ema1[ema1.length - 1] - ema2[ema2.length - 1]) / ema2[ema2.length - 1]) * 100;
        return Math.max(-10, Math.min(10, iTrend));
    };

    // Comprehensive Ehlers Analysis
    const performEhlersAnalysis = (symbol: string, ticks: TickData[]): EhlersAnalysis => {
        if (ticks.length < 50) {
            return {
                symbol,
                signal: 'NONE',
                strength: 0,
                smi: 0,
                mama: 0,
                fama: 0,
                cyberCycle: 0,
                dominantCycle: 20,
                iTrend: 0
            };
        }

        const prices = ticks.map(t => t.quote);
        const highs = ticks.map(t => t.quote); // Using close as high/low for tick data
        const lows = ticks.map(t => t.quote);

        // Calculate all Ehlers indicators
        const smi = calculateSMI(highs, lows, prices);
        const { mama, fama } = calculateMAMA(prices);
        const cyberCycle = calculateCyberCycle(prices);
        const dominantCycle = calculateDominantCycle(prices);
        const iTrend = calculateITrend(prices);

        // Determine signal based on multiple indicators
        let riseScore = 0;
        let fallScore = 0;

        // SMI contribution
        if (smi > 20) riseScore += 2;
        else if (smi < -20) fallScore += 2;
        else if (smi > 0) riseScore += 1;
        else fallScore += 1;

        // MAMA/FAMA contribution
        if (mama > fama) riseScore += 2;
        else fallScore += 2;

        // Cyber Cycle contribution
        if (cyberCycle > 10) riseScore += 1;
        else if (cyberCycle < -10) fallScore += 1;

        // iTrend contribution
        if (iTrend > 2) riseScore += 3;
        else if (iTrend < -2) fallScore += 3;

        // Price momentum contribution
        const recentTicks = ticks.slice(-10);
        if (recentTicks.length >= 10) {
            const firstPrice = recentTicks[0].quote;
            const lastPrice = recentTicks[recentTicks.length - 1].quote;
            const momentum = ((lastPrice - firstPrice) / firstPrice) * 100;
            
            if (momentum > 0.01) riseScore += 1;
            else if (momentum < -0.01) fallScore += 1;
        }

        const totalScore = riseScore + fallScore;
        const signal = riseScore > fallScore ? 'RISE' : (fallScore > riseScore ? 'FALL' : 'NONE');
        const strength = totalScore > 0 ? Math.max(riseScore, fallScore) / totalScore * 100 : 0;

        return {
            symbol,
            signal,
            strength,
            smi,
            mama,
            fama,
            cyberCycle,
            dominantCycle,
            iTrend
        };
    };

    // Find best trading opportunity across all symbols
    const findBestTradingOpportunity = (): { symbol: string; analysis: EhlersAnalysis } | null => {
        let bestOpportunity = null;
        let maxStrength = 50; // Minimum strength threshold

        symbolDataRef.current.forEach((data, symbol) => {
            if (data.analysis && data.analysis.signal !== 'NONE' && data.analysis.strength > maxStrength) {
                maxStrength = data.analysis.strength;
                bestOpportunity = { symbol, analysis: data.analysis };
            }
        });

        return bestOpportunity;
    };

    // Update martingale stake based on last outcome
    const updateMartingaleStake = (outcome: 'win' | 'loss') => {
        if (outcome === 'win') {
            setConsecutiveWins(prev => prev + 1);
            // After 2 consecutive wins, increase stake by 1.5x for next 2 trades
            if (consecutiveWins >= 1) {
                setMartingaleStake(baseStake * 1.5);
            }
        } else {
            setConsecutiveWins(0);
            setMartingaleStake(baseStake); // Revert to base stake on loss
        }
    };

    // Check stop loss and take profit conditions
    const checkStopConditions = (): boolean => {
        if (enableStopLoss && sessionPnL <= stopLoss) {
            console.log(`Stop loss hit: ${sessionPnL.toFixed(2)}`);
            stopAutoTrading();
            setStatus(`🛑 Stop loss hit: $${sessionPnL.toFixed(2)}`);
            return true;
        }

        if (enableTakeProfit && sessionPnL >= takeProfit) {
            console.log(`Take profit hit: ${sessionPnL.toFixed(2)}`);
            stopAutoTrading();
            setStatus(`🎯 Take profit hit: $${sessionPnL.toFixed(2)}`);
            return true;
        }

        return false;
    };

    // Reset session P&L
    const resetSession = () => {
        setSessionStartPnL(totalProfitLoss);
        setCurrentPnL(totalProfitLoss);
        setTotalRuns(0);
        setContractsWon(0);
        setContractsLost(0);
        setTotalStake(0);
        setTotalPayout(0);
        setConsecutiveWins(0);
        setMartingaleStake(baseStake);
        setLastOutcome(null);
        setStatus('Session reset');
    };

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
                        console.log('Trading API not authorized yet');
                    }
                }
            } catch (error) {
                console.error('Failed to initialize trading API:', error);
            }
        };

        initTradingApi();
    }, []);

    // WebSocket connection management for market data
    useEffect(() => {
        const MAX_RECONNECT_ATTEMPTS = 5;

        function startWebSocket() {
            console.log('🔌 Connecting to market data WebSocket');

            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }

            if (marketWsRef.current) {
                try {
                    marketWsRef.current.onclose = null;
                    marketWsRef.current.close();
                } catch (error) {
                    console.error('Error closing existing connection:', error);
                }
                marketWsRef.current = null;
            }

            try {
                marketWsRef.current = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

                marketWsRef.current.onopen = function() {
                    console.log('✅ Market data WebSocket connection established');
                    reconnectAttemptsRef.current = 0;
                    setConnectionStatus('connected');

                    setTimeout(() => {
                        subscribeToAllSymbols();
                    }, 1000);
                };

                marketWsRef.current.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.error) {
                            console.error('❌ WebSocket API error:', data.error);
                            return;
                        }

                        if (data.history && data.req_id) {
                            const symbol = data.req_id.replace('_history', '');
                            console.log(`📊 Received history for ${symbol}: ${data.history.prices.length} ticks`);
                            
                            const ticks = data.history.prices.map((price: string, index: number) => ({
                                time: data.history.times[index],
                                quote: parseFloat(price)
                            }));

                            const symbolData: SymbolData = {
                                symbol,
                                ticks,
                                lastUpdate: Date.now(),
                                analysis: null
                            };

                            symbolData.analysis = performEhlersAnalysis(symbol, ticks);
                            symbolDataRef.current.set(symbol, symbolData);
                            
                            updateAnalysisDisplay();
                        } else if (data.tick && data.subscription) {
                            const symbol = data.subscription.id.replace('_tick', '');
                            const quote = parseFloat(data.tick.quote);
                            
                            const symbolData = symbolDataRef.current.get(symbol);
                            if (symbolData) {
                                symbolData.ticks.push({
                                    time: data.tick.epoch,
                                    quote: quote
                                });

                                // Keep only recent ticks
                                if (symbolData.ticks.length > tickCount * 1.2) {
                                    symbolData.ticks = symbolData.ticks.slice(-tickCount);
                                }
                                
                                symbolData.lastUpdate = Date.now();
                                symbolData.analysis = performEhlersAnalysis(symbol, symbolData.ticks);
                                
                                updateAnalysisDisplay();
                            }
                        } else if (data.ping) {
                            marketWsRef.current?.send(JSON.stringify({ pong: 1 }));
                        }
                    } catch (error) {
                        console.error('Error processing message:', error);
                    }
                };

                marketWsRef.current.onerror = function(error) {
                    console.error('❌ WebSocket error:', error);
                    setConnectionStatus('error');
                    scheduleReconnect();
                };

                marketWsRef.current.onclose = function(event) {
                    console.log('🔄 WebSocket connection closed');
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
                console.log(`⚠️ Maximum reconnection attempts reached`);
                setConnectionStatus('error');
                return;
            }

            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000);
            
            reconnectTimeoutRef.current = setTimeout(() => {
                startWebSocket();
            }, delay);
        }

        function subscribeToAllSymbols() {
            VOLATILITY_INDICES.forEach((idx, index) => {
                setTimeout(() => {
                    if (marketWsRef.current && marketWsRef.current.readyState === WebSocket.OPEN) {
                        // Get history first
                        const historyRequest = {
                            ticks_history: idx.value,
                            count: tickCount,
                            end: 'latest',
                            style: 'ticks',
                            req_id: `${idx.value}_history`
                        };
                        
                        marketWsRef.current.send(JSON.stringify(historyRequest));
                        
                        // Then subscribe to live ticks
                        setTimeout(() => {
                            if (marketWsRef.current && marketWsRef.current.readyState === WebSocket.OPEN) {
                                const tickRequest = {
                                    ticks: idx.value,
                                    subscribe: 1,
                                    req_id: `${idx.value}_tick`
                                };
                                marketWsRef.current.send(JSON.stringify(tickRequest));
                            }
                        }, 500);
                    }
                }, index * 200); // Stagger requests
            });
        }

        function updateAnalysisDisplay() {
            const analyses = new Map();
            symbolDataRef.current.forEach((data, symbol) => {
                if (data.analysis) {
                    analyses.set(symbol, data.analysis);
                }
            });
            setCurrentAnalyses(analyses);
            
            // Update best symbol
            const bestOpportunity = findBestTradingOpportunity();
            if (bestOpportunity) {
                setBestSymbol(bestOpportunity.symbol);
                setScanningStatus(`Best: ${bestOpportunity.symbol} - ${bestOpportunity.analysis.signal} (${bestOpportunity.analysis.strength.toFixed(1)}%)`);
            } else {
                setScanningStatus('Scanning for opportunities...');
            }
        }

        startWebSocket();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (marketWsRef.current) {
                marketWsRef.current.onclose = null;
                marketWsRef.current.close();
            }
        };
    }, [tickCount]);

    // Auto trading execution
    const executeAutoTrade = async () => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🚀 Checking for trading opportunities`);

        if (!tradingApi || !isAuthorized) {
            console.error(`[${timestamp}] Trading API not ready or not authorized`);
            return;
        }

        if (connectionStatus !== 'connected') {
            console.error(`[${timestamp}] Not connected to market data`);
            return;
        }

        // Check stop loss and take profit conditions
        if (checkStopConditions()) {
            return;
        }

        // Check time since last trade
        const currentTime = Date.now();
        if (currentTime - lastTradeTimeRef.current < minTimeBetweenTrades) {
            return;
        }

        // Find best trading opportunity
        const bestOpportunity = findBestTradingOpportunity();
        if (!bestOpportunity || bestOpportunity.analysis.strength < 60) {
            console.log(`[${timestamp}] No strong signal found`);
            return;
        }

        try {
            const { symbol, analysis } = bestOpportunity;
            const contractType = analysis.signal === 'RISE' ? 'CALL' : 'PUT';
            const stakeToUse = martingaleStake;

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
                    symbol: symbol
                }
            };

            console.log(`[${timestamp}] Executing trade:`, {
                symbol,
                signal: analysis.signal,
                strength: analysis.strength,
                stake: stakeToUse,
                contractType
            });

            setStatus(`Trading ${symbol}: ${analysis.signal} ($${stakeToUse}) - Strength: ${analysis.strength.toFixed(1)}%`);
            lastTradeTimeRef.current = currentTime;

            const buyResponse = await tradingApi.buy(buyRequest);

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`✅ Trade executed: ${buyResponse.buy.contract_id} on ${symbol}`);
            
            monitorContract(buyResponse.buy.contract_id, stakeToUse);

        } catch (error) {
            console.error(`[${timestamp}] Auto trade error:`, error);
            setStatus(`Trade error: ${error.message}`);
        }
    };

    // Monitor contract outcome
    const monitorContract = async (contractId: string, stakeAmount: number) => {
        try {
            if (!tradingApi?.connection) {
                throw new Error('Trading API connection not available');
            }

            const subscribeRequest = {
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            };

            await tradingApi.send(subscribeRequest);
            
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
                            setCurrentPnL(prev => prev + profit);
                            
                            if (profit > 0) {
                                setContractsWon(prev => prev + 1);
                                setLastOutcome('win');
                                updateMartingaleStake('win');
                                setStatus(`✅ Contract won! Profit: $${profit.toFixed(2)}`);
                            } else {
                                setContractsLost(prev => prev + 1);
                                setLastOutcome('loss');
                                updateMartingaleStake('loss');
                                setStatus(`❌ Contract lost. Loss: $${Math.abs(profit).toFixed(2)}`);
                            }
                            
                            tradingApi.connection.removeEventListener('message', handleContractUpdate);
                        }
                    }
                } catch (error) {
                    console.error('Error parsing contract update:', error);
                }
            };

            tradingApi.connection.addEventListener('message', handleContractUpdate);
            
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

    // Auto trading control
    const startAutoTrading = () => {
        if (connectionStatus !== 'connected') {
            alert('Cannot start auto trading: Not connected to market data');
            return;
        }

        if (!tradingApi || !isAuthorized) {
            alert('Trading API not ready');
            return;
        }

        if (tradingInterval) {
            clearInterval(tradingInterval);
        }

        setIsAutoTrading(true);
        setStatus('Auto trading started - analyzing markets...');
        setSessionStartPnL(totalProfitLoss); // Set session start point
        setCurrentPnL(totalProfitLoss);

        const interval = setInterval(executeAutoTrade, 5000); // Check every 5 seconds
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

    const toggleAutoTrading = () => {
        if (isAutoTrading) {
            stopAutoTrading();
        } else {
            startAutoTrading();
        }
    };

    // Cleanup on unmount
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
                <h1>{localize('Ehlers Multi-Volatility Trading Bot')}</h1>
                <div className={`ml-trader__status ${connectionStatus}`}>
                    {connectionStatus === 'connected' && '🟢 Connected'}
                    {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                    {connectionStatus === 'error' && '🔴 Error'}
                </div>
            </div>

            <div className='ml-trader__controls'>
                <div className='ml-trader__control-group'>
                    <label>Tick Count per Symbol:</label>
                    <input
                        type='number'
                        min={100}
                        max={2000}
                        value={tickCount}
                        onChange={(e) => setTickCount(Number(e.target.value))}
                        disabled={isAutoTrading}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Base Stake ($):</label>
                    <input
                        type='number'
                        step='0.1'
                        min={0.35}
                        value={baseStake}
                        onChange={(e) => setBaseStake(Number(e.target.value))}
                        disabled={isAutoTrading}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Contract Duration (ticks):</label>
                    <input
                        type='number'
                        min={1}
                        max={10}
                        value={tickDuration}
                        onChange={(e) => setTickDuration(Number(e.target.value))}
                        disabled={isAutoTrading}
                    />
                </div>
            </div>

            <div className='ml-trader__risk-management'>
                <h3>Risk Management</h3>
                <div className='ml-trader__control-row'>
                    <div className='ml-trader__control-group'>
                        <label>
                            <input
                                type='checkbox'
                                checked={enableStopLoss}
                                onChange={(e) => setEnableStopLoss(e.target.checked)}
                                disabled={isAutoTrading}
                            />
                            Enable Stop Loss
                        </label>
                        {enableStopLoss && (
                            <input
                                type='number'
                                step='1'
                                value={stopLoss}
                                onChange={(e) => setStopLoss(Number(e.target.value))}
                                disabled={isAutoTrading}
                                placeholder='Stop Loss ($)'
                            />
                        )}
                    </div>

                    <div className='ml-trader__control-group'>
                        <label>
                            <input
                                type='checkbox'
                                checked={enableTakeProfit}
                                onChange={(e) => setEnableTakeProfit(e.target.checked)}
                                disabled={isAutoTrading}
                            />
                            Enable Take Profit
                        </label>
                        {enableTakeProfit && (
                            <input
                                type='number'
                                step='1'
                                min={1}
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(Number(e.target.value))}
                                disabled={isAutoTrading}
                                placeholder='Take Profit ($)'
                            />
                        )}
                    </div>
                </div>

                <div className='ml-trader__pnl-display'>
                    <div className='ml-trader__pnl-item'>
                        <Text size='sm' weight='bold'>Session P&L: </Text>
                        <Text size='sm' color={sessionPnL >= 0 ? 'profit-success' : 'loss-danger'}>
                            ${sessionPnL.toFixed(2)}
                        </Text>
                    </div>
                    <div className='ml-trader__pnl-item'>
                        <Text size='sm' weight='bold'>Total P&L: </Text>
                        <Text size='sm' color={totalProfitLoss >= 0 ? 'profit-success' : 'loss-danger'}>
                            ${totalProfitLoss.toFixed(2)}
                        </Text>
                    </div>
                </div>

                <button
                    className='ml-trader__reset-btn'
                    onClick={resetSession}
                    disabled={isAutoTrading}
                >
                    Reset Session
                </button>
            </div>

            <div className='ml-trader__market-analysis'>
                <h3>Market Analysis</h3>
                <div className='ml-trader__scanning-status'>
                    <Text size='sm'>{scanningStatus}</Text>
                </div>
                
                <div className='ml-trader__symbols-grid'>
                    {Array.from(currentAnalyses.entries()).map(([symbol, analysis]) => (
                        <div key={symbol} className={`ml-trader__symbol-card ${analysis.signal.toLowerCase()}`}>
                            <div className='ml-trader__symbol-name'>{symbol}</div>
                            <div className='ml-trader__signal'>{analysis.signal}</div>
                            <div className='ml-trader__strength'>{analysis.strength.toFixed(1)}%</div>
                            <div className='ml-trader__indicators'>
                                <span>SMI: {analysis.smi.toFixed(1)}</span>
                                <span>iTrend: {analysis.iTrend.toFixed(2)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className='ml-trader__trading-controls'>
                <button
                    className={`ml-trader__auto-trading-btn ${isAutoTrading ? 'ml-trader__auto-trading-btn--active' : ''}`}
                    onClick={toggleAutoTrading}
                    disabled={!isAuthorized || connectionStatus !== 'connected'}
                >
                    {isAutoTrading ? 'STOP AUTO TRADING' : 'START AUTO TRADING'}
                </button>
            </div>

            <div className='ml-trader__statistics'>
                <h4>Trading Statistics</h4>
                <div className='ml-trader__stats-grid'>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Session Stake: ${totalStake.toFixed(2)}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs' weight='bold'>Session Payout: ${totalPayout.toFixed(2)}</Text>
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
                        <Text size='xs' weight='bold'>Current Stake: ${martingaleStake.toFixed(2)}</Text>
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

export default EhlersTrader;
