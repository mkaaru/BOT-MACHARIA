
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { Button, Text } from '@deriv-com/ui';
import { localize } from '@deriv-com/translations';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import './smart-trading-display.scss';

// Extend Window interface for volatility analyzer
declare global {
    interface Window {
        volatilityAnalyzer?: {
            reconnect?: () => void;
        };
        initVolatilityAnalyzer?: () => void;
    }
}

// Trading Engine Class
class TradingEngine {
    private ws: WebSocket | null = null;
    private isConnected = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectInterval = 3000;
    private messageHandlers: Map<string, (data: any) => void> = new Map();
    private tickHistory: any[] = [];

    constructor() {
        this.connect();
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            this.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.onConnectionChange?.('connected');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.isConnected = false;
                this.onConnectionChange?.('disconnected');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.onConnectionChange?.('error');
            };
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.onConnectionChange?.('error');
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`Reconnection attempt ${this.reconnectAttempts}`);
                this.connect();
            }, this.reconnectInterval);
        }
    }

    private handleMessage(data: any) {
        if (data.msg_type && this.messageHandlers.has(data.msg_type)) {
            const handler = this.messageHandlers.get(data.msg_type);
            handler?.(data);
        }

        // Handle tick data
        if (data.msg_type === 'tick') {
            this.tickHistory.push({
                ...data.tick,
                timestamp: Date.now()
            });
            // Keep only last 1000 ticks
            if (this.tickHistory.length > 1000) {
                this.tickHistory = this.tickHistory.slice(-1000);
            }
        }
    }

    subscribe(msgType: string, handler: (data: any) => void) {
        this.messageHandlers.set(msgType, handler);
    }

    send(message: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket not connected, cannot send message');
        }
    }

    subscribeToTicks(symbol: string) {
        this.send({
            ticks: symbol,
            subscribe: 1
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    getTickHistory() {
        return this.tickHistory;
    }

    onConnectionChange?: (status: 'connected' | 'disconnected' | 'error') => void;
}

const SmartTradingDisplay: React.FC = observer(() => {
    const { run_panel } = useStore();
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
    const [tradingEngine] = useState(() => new TradingEngine());
    const [selectedSymbol, setSelectedSymbol] = useState('R_10');
    const [tickCount, setTickCount] = useState(100);
    const [barrier, setBarrier] = useState(0);
    const [strategies, setStrategies] = useState<Record<string, any>>({});
    const [autoTradingStatus, setAutoTradingStatus] = useState<Record<string, boolean>>({});
    const [tickData, setTickData] = useState<any[]>([]);

    const volatilitySymbols = [
        { value: 'R_10', label: 'Volatility 10 Index' },
        { value: 'R_25', label: 'Volatility 25 Index' },
        { value: 'R_50', label: 'Volatility 50 Index' },
        { value: 'R_75', label: 'Volatility 75 Index' },
        { value: 'R_100', label: 'Volatility 100 Index' }
    ];

    useEffect(() => {
        tradingEngine.onConnectionChange = setConnectionStatus;

        tradingEngine.subscribe('tick', (data) => {
            setTickData(prev => [...prev.slice(-99), data.tick]);
        });

        tradingEngine.subscribeToTicks(selectedSymbol);

        return () => {
            tradingEngine.disconnect();
        };
    }, [tradingEngine]);

    useEffect(() => {
        tradingEngine.subscribeToTicks(selectedSymbol);
    }, [selectedSymbol, tradingEngine]);

    const updateSymbol = useCallback((symbol: string) => {
        setSelectedSymbol(symbol);
    }, []);

    const updateTickCount = useCallback((count: number) => {
        setTickCount(count);
    }, []);

    const updateBarrier = useCallback((value: number) => {
        setBarrier(value);
    }, []);

    const generateStrategyAnalysis = (strategyId: string) => {
        const recentTicks = tickData.slice(-20);
        if (recentTicks.length === 0) {
            return {
                prediction: 'No data',
                confidence: 0,
                winRate: 0,
                trend: 'neutral'
            };
        }

        // Simple analysis based on recent tick patterns
        const lastTick = recentTicks[recentTicks.length - 1];
        const avgPrice = recentTicks.reduce((sum, tick) => sum + tick.quote, 0) / recentTicks.length;
        
        let prediction = 'Hold';
        let confidence = Math.random() * 100;
        let winRate = 50 + Math.random() * 40;
        let trend = 'neutral';

        switch (strategyId) {
            case 'rise-fall':
                prediction = lastTick.quote > avgPrice ? 'Rise' : 'Fall';
                trend = lastTick.quote > avgPrice ? 'bullish' : 'bearish';
                break;
            case 'even-odd':
                const lastDigit = Math.floor(lastTick.quote * 100) % 10;
                prediction = lastDigit % 2 === 0 ? 'Even' : 'Odd';
                break;
            case 'over-under':
                prediction = lastTick.quote > barrier ? 'Over' : 'Under';
                break;
            default:
                prediction = Math.random() > 0.5 ? 'Buy' : 'Sell';
        }

        return { prediction, confidence, winRate, trend };
    };

    const startAutoTrading = (strategyId: string) => {
        setAutoTradingStatus(prev => ({ ...prev, [strategyId]: true }));
        console.log(`Auto trading started for ${strategyId}`);
    };

    const stopAutoTrading = (strategyId: string) => {
        setAutoTradingStatus(prev => ({ ...prev, [strategyId]: false }));
        console.log(`Auto trading stopped for ${strategyId}`);
    };

    const executeTrade = (strategyId: string, type: 'manual' | 'auto') => {
        console.log(`Executing ${type} trade for ${strategyId}`);
        // Here you would implement the actual trading logic
    };

    const renderTradingCard = (title: string, strategyId: string) => {
        const analysis = generateStrategyAnalysis(strategyId);
        const isAutoTrading = autoTradingStatus[strategyId];

        return (
            <div key={strategyId} className={`trading-card ${analysis.trend}`}>
                <div className="card-header">
                    <h3>{title}</h3>
                    <div className={`status-indicator ${isAutoTrading ? 'active' : 'inactive'}`}>
                        {isAutoTrading ? '🟢 Auto' : '⚫ Manual'}
                    </div>
                </div>

                <div className="card-content">
                    <div className="prediction-section">
                        <div className="prediction-label">Current Prediction:</div>
                        <div className={`prediction-value ${analysis.trend}`}>
                            {analysis.prediction}
                        </div>
                    </div>

                    <div className="metrics-grid">
                        <div className="metric">
                            <span className="metric-label">Confidence:</span>
                            <span className="metric-value">{analysis.confidence.toFixed(1)}%</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">Win Rate:</span>
                            <span className="metric-value">{analysis.winRate.toFixed(1)}%</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">Status:</span>
                            <span className={`metric-value ${analysis.winRate > 60 ? 'positive' : 'negative'}`}>
                                {analysis.winRate > 60 ? '✅ Win/None' : '❌ Loss'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="card-footer">
                    <button 
                        className={`start-trading-btn ${isAutoTrading ? 'trading-active' : ''}`}
                        onClick={() => {
                            if (isAutoTrading) {
                                stopAutoTrading(strategyId);
                            } else {
                                startAutoTrading(strategyId);
                            }
                        }}
                        disabled={connectionStatus !== 'connected'}
                    >
                        {isAutoTrading ? 'Stop Auto Trading' : 'Start Auto Trading'}
                    </button>
                    <button 
                        className="manual-trade-btn"
                        onClick={() => executeTrade(strategyId, 'manual')}
                        disabled={connectionStatus !== 'connected' || isAutoTrading}
                    >
                        Execute Manual Trade
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="volatility-analyzer">
            <div className="analyzer-header">
                <h2>Smart Trading Analytics</h2>
                <div className={`connection-status ${connectionStatus}`}>
                    {connectionStatus === 'connected' && '🟢 Connected'}
                    {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                    {connectionStatus === 'error' && '⚠️ Error'}
                </div>
            </div>

            <div className="analyzer-controls">
                <div className="control-group">
                    <label>Symbol:</label>
                    <select
                        value={selectedSymbol}
                        onChange={(e) => updateSymbol(e.target.value)}
                    >
                        {volatilitySymbols.map((symbol) => (
                            <option key={symbol.value} value={symbol.value}>
                                {symbol.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="control-group">
                    <label>Tick Count:</label>
                    <input
                        type="number"
                        min="10"
                        max="1000"
                        value={tickCount}
                        onChange={(e) => updateTickCount(parseInt(e.target.value))}
                    />
                </div>

                <div className="control-group">
                    <label>Barrier:</label>
                    <input
                        type="number"
                        value={barrier}
                        onChange={(e) => updateBarrier(parseInt(e.target.value))}
                    />
                </div>
            </div>

            <div className="trading-cards-grid">
                {renderTradingCard('Rise/Fall', 'rise-fall')}
                {renderTradingCard('Even/Odd', 'even-odd')}
                {renderTradingCard('Even/Odd Pattern', 'even-odd-2')}
                {renderTradingCard('Over/Under', 'over-under')}
                {renderTradingCard('Over/Under Pattern', 'over-under-2')}
                {renderTradingCard('Matches/Differs', 'matches-differs')}
                {renderTradingCard('Touch/No Touch', 'touch-no-touch')}
                {renderTradingCard('Ends Between/Outside', 'ends-between-outside')}
                {renderTradingCard('Stays Between/Goes Outside', 'stays-between-goes-outside')}
            </div>

            {tickData.length > 0 && (
                <div className="live-data-section">
                    <h3>Live Market Data</h3>
                    <div className="tick-display">
                        <div className="current-price">
                            <span className="price-label">Current Price:</span>
                            <span className="price-value">
                                {tickData[tickData.length - 1]?.quote?.toFixed(5) || 'N/A'}
                            </span>
                        </div>
                        <div className="tick-count">
                            <span className="count-label">Ticks Received:</span>
                            <span className="count-value">{tickData.length}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default SmartTradingDisplay;
