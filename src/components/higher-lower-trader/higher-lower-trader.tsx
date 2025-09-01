import React, { useState, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, BarChart3, Settings, RefreshCw } from 'lucide-react';
import './higher-lower-trader.scss';

interface TickData {
    epoch: number;
    quote: number;
    symbol: string;
}

interface HMAData {
    value: number;
    trend: 'up' | 'down' | 'neutral';
    strength: number;
}

interface TradingSignal {
    direction: 'higher' | 'lower';
    confidence: number;
    reasoning: string;
    timestamp: number;
}

const HigherLowerTrader: React.FC = observer(() => {
    const [isConnected, setIsConnected] = useState(false);
    const [isTrading, setIsTrading] = useState(false);
    const [currentSymbol, setCurrentSymbol] = useState('R_10'); // Volatility 10 Index
    const [tickHistory, setTickHistory] = useState<TickData[]>([]);
    const [hmaData, setHmaData] = useState<HMAData | null>(null);
    const [tradingSignal, setTradingSignal] = useState<TradingSignal | null>(null);
    const [stats, setStats] = useState({
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        currentStreak: 0
    });
    const [settings, setSettings] = useState({
        hmaPeriod: 21,
        tickCount: 5000,
        minConfidence: 0.7,
        autoTrade: false
    });

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Hull Moving Average calculation
    const calculateHMA = (prices: number[], period: number): number | null => {
        if (prices.length < period) return null;

        const wma1 = calculateWMA(prices.slice(-period), period);
        const wma2 = calculateWMA(prices.slice(-Math.floor(period/2)), Math.floor(period/2));

        if (wma1 === null || wma2 === null) return null;

        const rawHMA = 2 * wma2 - wma1;
        const sqrtPeriod = Math.floor(Math.sqrt(period));

        // For final HMA calculation, we need more data points
        if (prices.length < sqrtPeriod) return rawHMA;

        const hmaArray = [];
        for (let i = 0; i < sqrtPeriod; i++) {
            const idx = prices.length - sqrtPeriod + i;
            if (idx >= 0) {
                const wma1_i = calculateWMA(prices.slice(0, idx + 1).slice(-period), period);
                const wma2_i = calculateWMA(prices.slice(0, idx + 1).slice(-Math.floor(period/2)), Math.floor(period/2));
                if (wma1_i !== null && wma2_i !== null) {
                    hmaArray.push(2 * wma2_i - wma1_i);
                }
            }
        }

        return calculateWMA(hmaArray, sqrtPeriod);
    };

    // Weighted Moving Average calculation
    const calculateWMA = (prices: number[], period: number): number | null => {
        if (prices.length < period) return null;

        const weights = Array.from({ length: period }, (_, i) => i + 1);
        const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

        let weightedSum = 0;
        for (let i = 0; i < period; i++) {
            weightedSum += prices[prices.length - period + i] * weights[i];
        }

        return weightedSum / weightSum;
    };

    // Analyze HMA trend and generate trading signals
    const analyzeHMATrend = (tickData: TickData[]): { hma: HMAData | null, signal: TradingSignal | null } => {
        if (tickData.length < settings.hmaPeriod + 10) {
            return { hma: null, signal: null };
        }

        const prices = tickData.map(tick => tick.quote);
        const currentHMA = calculateHMA(prices, settings.hmaPeriod);

        if (currentHMA === null) {
            return { hma: null, signal: null };
        }

        // Calculate previous HMA values for trend analysis
        const prevHMA = calculateHMA(prices.slice(0, -1), settings.hmaPeriod);
        const prevHMA2 = calculateHMA(prices.slice(0, -2), settings.hmaPeriod);

        if (prevHMA === null || prevHMA2 === null) {
            return { hma: null, signal: null };
        }

        // Determine trend direction and strength
        const currentPrice = prices[prices.length - 1];
        const priceVsHMA = currentPrice - currentHMA;
        const hmaSlope = currentHMA - prevHMA;
        const hmaAcceleration = (currentHMA - prevHMA) - (prevHMA - prevHMA2);

        let trend: 'up' | 'down' | 'neutral';
        let strength: number;

        if (hmaSlope > 0 && priceVsHMA > 0) {
            trend = 'up';
            strength = Math.min(Math.abs(hmaSlope) * 1000, 1);
        } else if (hmaSlope < 0 && priceVsHMA < 0) {
            trend = 'down';
            strength = Math.min(Math.abs(hmaSlope) * 1000, 1);
        } else {
            trend = 'neutral';
            strength = 0;
        }

        // Generate trading signal based on HMA analysis
        let signal: TradingSignal | null = null;

        if (strength >= settings.minConfidence) {
            const volatilityFactor = calculateVolatility(prices.slice(-20));
            const momentumFactor = Math.abs(hmaAcceleration) * 10000;

            let confidence = strength * 0.7 + volatilityFactor * 0.2 + momentumFactor * 0.1;
            confidence = Math.min(confidence, 0.95);

            if (confidence >= settings.minConfidence) {
                signal = {
                    direction: trend === 'up' ? 'higher' : 'lower',
                    confidence,
                    reasoning: `HMA ${trend === 'up' ? 'bullish' : 'bearish'} trend with ${(confidence * 100).toFixed(1)}% confidence. Slope: ${hmaSlope.toFixed(5)}, Acceleration: ${hmaAcceleration.toFixed(5)}`,
                    timestamp: Date.now()
                };
            }
        }

        return {
            hma: { value: currentHMA, trend, strength },
            signal
        };
    };

    // Calculate price volatility
    const calculateVolatility = (prices: number[]): number => {
        if (prices.length < 2) return 0;

        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }

        const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;

        return Math.sqrt(variance);
    };

    // WebSocket connection management
    const connectWebSocket = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        try {
            wsRef.current = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

            wsRef.current.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
                requestTickHistory();
            };

            wsRef.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };

            wsRef.current.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                scheduleReconnect();
            };

            wsRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                setIsConnected(false);
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            scheduleReconnect();
        }
    };

    const scheduleReconnect = () => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
        }, 3000);
    };

    const requestTickHistory = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const request = {
            ticks_history: currentSymbol,
            adjust_start_time: 1,
            count: settings.tickCount,
            end: 'latest',
            style: 'ticks'
        };

        wsRef.current.send(JSON.stringify(request));
    };

    const subscribeToTicks = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const request = {
            ticks: currentSymbol,
            subscribe: 1
        };

        wsRef.current.send(JSON.stringify(request));
    };

    const handleWebSocketMessage = (data: any) => {
        if (data.msg_type === 'history') {
            const prices = data.history.prices || [];
            const times = data.history.times || [];

            const newTickHistory = times.map((time: number, index: number) => ({
                epoch: time,
                quote: parseFloat(prices[index]),
                symbol: currentSymbol
            }));

            setTickHistory(newTickHistory);
            subscribeToTicks();
        } else if (data.msg_type === 'tick') {
            const newTick: TickData = {
                epoch: data.tick.epoch,
                quote: data.tick.quote,
                symbol: data.tick.symbol
            };

            setTickHistory(prev => {
                const updated = [...prev, newTick].slice(-settings.tickCount);

                // Analyze HMA and generate signals
                const analysis = analyzeHMATrend(updated);
                setHmaData(analysis.hma);

                if (analysis.signal) {
                    setTradingSignal(analysis.signal);
                }

                return updated;
            });
        }
    };

    // Start/Stop trading
    const toggleTrading = () => {
        if (!isTrading) {
            connectWebSocket();
        }
        setIsTrading(!isTrading);
    };

    // Manual refresh
    const handleRefresh = () => {
        setTickHistory([]);
        setHmaData(null);
        setTradingSignal(null);
        if (isConnected) {
            requestTickHistory();
        } else {
            connectWebSocket();
        }
    };

    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, []);

    return (
        <div className="higher-lower-trader">
            <div className="trader-header">
                <h2>Higher/Lower Trader - HMA Analysis</h2>
                <div className="connection-status">
                    <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
                    <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
            </div>

            <div className="trading-controls">
                <div className="symbol-selector">
                    <label>Symbol:</label>
                    <select 
                        value={currentSymbol} 
                        onChange={(e) => setCurrentSymbol(e.target.value)}
                        disabled={isTrading}
                    >
                        <option value="R_10">Volatility 10 Index</option>
                        <option value="R_25">Volatility 25 Index</option>
                        <option value="R_50">Volatility 50 Index</option>
                        <option value="R_75">Volatility 75 Index</option>
                        <option value="R_100">Volatility 100 Index</option>
                    </select>
                </div>

                <div className="action-buttons">
                    <button 
                        className={`trade-button ${isTrading ? 'stop' : 'start'}`}
                        onClick={toggleTrading}
                    >
                        {isTrading ? <Square size={16} /> : <Play size={16} />}
                        {isTrading ? 'Stop' : 'Start'} Trading
                    </button>

                    <button className="refresh-button" onClick={handleRefresh}>
                        <RefreshCw size={16} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="trading-dashboard">
                <div className="hma-analysis">
                    <h3>HMA Analysis</h3>
                    <div className="hma-data">
                        {hmaData ? (
                            <>
                                <div className="hma-value">
                                    <span>HMA Value: {hmaData.value.toFixed(5)}</span>
                                </div>
                                <div className={`trend-indicator trend-${hmaData.trend}`}>
                                    {hmaData.trend === 'up' ? <TrendingUp size={20} /> : 
                                     hmaData.trend === 'down' ? <TrendingDown size={20} /> : 
                                     <BarChart3 size={20} />}
                                    <span>Trend: {hmaData.trend.toUpperCase()}</span>
                                </div>
                                <div className="strength-meter">
                                    <span>Strength: {(hmaData.strength * 100).toFixed(1)}%</span>
                                    <div className="strength-bar">
                                        <div 
                                            className="strength-fill" 
                                            style={{ width: `${hmaData.strength * 100}%` }}
                                        />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="no-data">Waiting for sufficient data...</div>
                        )}
                    </div>
                </div>

                <div className="trading-signal">
                    <h3>Current Signal</h3>
                    {tradingSignal ? (
                        <div className={`signal-card signal-${tradingSignal.direction}`}>
                            <div className="signal-direction">
                                <strong>{tradingSignal.direction.toUpperCase()}</strong>
                            </div>
                            <div className="signal-confidence">
                                Confidence: {(tradingSignal.confidence * 100).toFixed(1)}%
                            </div>
                            <div className="signal-reasoning">
                                {tradingSignal.reasoning}
                            </div>
                            <div className="signal-time">
                                {new Date(tradingSignal.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    ) : (
                        <div className="no-signal">No trading signal available</div>
                    )}
                </div>

                <div className="market-data">
                    <h3>Market Data</h3>
                    <div className="data-stats">
                        <div className="stat">
                            <span>Ticks Received:</span>
                            <span>{tickHistory.length}</span>
                        </div>
                        <div className="stat">
                            <span>Current Price:</span>
                            <span>{tickHistory.length > 0 ? tickHistory[tickHistory.length - 1].quote.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="stat">
                            <span>HMA Period:</span>
                            <span>{settings.hmaPeriod}</span>
                        </div>
                    </div>
                </div>

                <div className="trading-stats">
                    <h3>Trading Statistics</h3>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span>Total Trades:</span>
                            <span>{stats.totalTrades}</span>
                        </div>
                        <div className="stat-item">
                            <span>Wins:</span>
                            <span className="wins">{stats.wins}</span>
                        </div>
                        <div className="stat-item">
                            <span>Losses:</span>
                            <span className="losses">{stats.losses}</span>
                        </div>
                        <div className="stat-item">
                            <span>Win Rate:</span>
                            <span>{stats.winRate.toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="settings-panel">
                <details>
                    <summary>
                        <Settings size={16} />
                        Advanced Settings
                    </summary>
                    <div className="settings-content">
                        <div className="setting-group">
                            <label>HMA Period:</label>
                            <input
                                type="number"
                                min="5"
                                max="100"
                                value={settings.hmaPeriod}
                                onChange={(e) => setSettings(prev => ({ ...prev, hmaPeriod: parseInt(e.target.value) }))}
                            />
                        </div>
                        <div className="setting-group">
                            <label>Tick Count:</label>
                            <input
                                type="number"
                                min="1000"
                                max="10000"
                                value={settings.tickCount}
                                onChange={(e) => setSettings(prev => ({ ...prev, tickCount: parseInt(e.target.value) }))}
                            />
                        </div>
                        <div className="setting-group">
                            <label>Min Confidence:</label>
                            <input
                                type="number"
                                min="0.1"
                                max="0.95"
                                step="0.05"
                                value={settings.minConfidence}
                                onChange={(e) => setSettings(prev => ({ ...prev, minConfidence: parseFloat(e.target.value) }))}
                            />
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
});

export default HigherLowerTrader;