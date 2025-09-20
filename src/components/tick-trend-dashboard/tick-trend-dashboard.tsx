
import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Button from '@/components/shared_ui/button';
import { tickTrendAnalyzer } from '@/services/tick-trend-analyzer';
import { tickStreamManager } from '@/services/tick-stream-manager';
import './tick-trend-dashboard.scss';

interface SymbolData {
    symbol: string;
    displayName: string;
    signal: any;
    analysis: any;
    marketCondition: any;
    decision: any;
    lastUpdate: Date;
}

const BINARY_SYMBOLS = [
    { symbol: 'R_10', displayName: 'Volatility 10 Index' },
    { symbol: 'R_25', displayName: 'Volatility 25 Index' },
    { symbol: 'R_50', displayName: 'Volatility 50 Index' },
    { symbol: 'R_75', displayName: 'Volatility 75 Index' },
    { symbol: 'R_100', displayName: 'Volatility 100 Index' },
    { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index' },
];

const TickTrendDashboard: React.FC = observer(() => {
    const [symbolData, setSymbolData] = useState<Map<string, SymbolData>>(new Map());
    const [isActive, setIsActive] = useState(false);
    const [systemStatus, setSystemStatus] = useState<any>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_10');
    const [autoRefresh, setAutoRefresh] = useState(true);

    // Process tick updates
    const processTick = useCallback((tick: any) => {
        const tickData = {
            symbol: tick.symbol,
            price: tick.quote,
            timestamp: Date.now(),
            epoch: tick.epoch
        };

        const signal = tickTrendAnalyzer.processTick(tickData);
        
        if (signal) {
            const analytics = tickTrendAnalyzer.getDetailedAnalytics(tick.symbol);
            const decision = tickTrendAnalyzer.generateTradingDecision(tick.symbol);
            
            setSymbolData(prev => {
                const newData = new Map(prev);
                const symbolInfo = BINARY_SYMBOLS.find(s => s.symbol === tick.symbol);
                
                newData.set(tick.symbol, {
                    symbol: tick.symbol,
                    displayName: symbolInfo?.displayName || tick.symbol,
                    signal,
                    analysis: analytics.currentAnalysis,
                    marketCondition: analytics.marketCondition,
                    decision,
                    lastUpdate: new Date()
                });
                
                return newData;
            });
        }
    }, []);

    // Start/stop analyzer
    const toggleAnalyzer = useCallback(async () => {
        if (!isActive) {
            try {
                console.log('🎯 Starting 2-minute binary options analyzer...');
                
                // Subscribe to tick streams
                for (const symbolInfo of BINARY_SYMBOLS) {
                    tickStreamManager.addTickCallback(symbolInfo.symbol, processTick);
                    await tickStreamManager.subscribeToSymbol(symbolInfo.symbol);
                }
                
                setIsActive(true);
                console.log('✅ Analyzer started successfully');
            } catch (error) {
                console.error('❌ Failed to start analyzer:', error);
            }
        } else {
            console.log('⏹️ Stopping analyzer...');
            
            // Unsubscribe from all symbols
            for (const symbolInfo of BINARY_SYMBOLS) {
                tickStreamManager.removeTickCallback(symbolInfo.symbol, processTick);
                await tickStreamManager.unsubscribeFromSymbol(symbolInfo.symbol);
            }
            
            setIsActive(false);
            setSymbolData(new Map());
            console.log('✅ Analyzer stopped');
        }
    }, [isActive, processTick]);

    // Update system status
    useEffect(() => {
        if (isActive) {
            const interval = setInterval(() => {
                setSystemStatus(tickTrendAnalyzer.getSystemStatus());
            }, 2000);
            
            return () => clearInterval(interval);
        }
    }, [isActive]);

    // Auto-refresh detailed view
    useEffect(() => {
        if (isActive && autoRefresh && selectedSymbol) {
            const interval = setInterval(() => {
                const analytics = tickTrendAnalyzer.getDetailedAnalytics(selectedSymbol);
                if (analytics.currentAnalysis) {
                    setSymbolData(prev => {
                        const newData = new Map(prev);
                        const existing = newData.get(selectedSymbol);
                        if (existing) {
                            newData.set(selectedSymbol, {
                                ...existing,
                                analysis: analytics.currentAnalysis,
                                marketCondition: analytics.marketCondition,
                                decision: tickTrendAnalyzer.generateTradingDecision(selectedSymbol),
                                lastUpdate: new Date()
                            });
                        }
                        return newData;
                    });
                }
            }, 1000);
            
            return () => clearInterval(interval);
        }
    }, [isActive, autoRefresh, selectedSymbol]);

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'var(--color-green)';
        if (confidence >= 65) return 'var(--color-yellow)';
        return 'var(--color-red)';
    };

    const getDirectionIcon = (direction: string) => {
        switch (direction) {
            case 'UP': return '🚀';
            case 'DOWN': return '📉';
            default: return '⚪';
        }
    };

    const selectedData = selectedSymbol ? symbolData.get(selectedSymbol) : null;

    return (
        <div className="tick-trend-dashboard">
            <div className="tick-trend-dashboard__header">
                <div className="tick-trend-dashboard__title">
                    <Text size="xl" weight="bold" color="prominent">
                        🎯 2-Minute Binary Options Analyzer
                    </Text>
                    <Text size="s" color="general">
                        Ultra-fast tick-based trend detection for binary options trading
                    </Text>
                </div>
                
                <div className="tick-trend-dashboard__controls">
                    <Button
                        type={isActive ? 'secondary' : 'primary'}
                        size="medium"
                        onClick={toggleAnalyzer}
                    >
                        {isActive ? '⏹️ Stop Analyzer' : '▶️ Start Analyzer'}
                    </Button>
                </div>
            </div>

            {isActive && systemStatus && (
                <div className="tick-trend-dashboard__system-status">
                    <div className="status-item">
                        <Text size="xs" color="general">Active Symbols:</Text>
                        <Text size="s" weight="bold">{systemStatus.activeSymbols}</Text>
                    </div>
                    <div className="status-item">
                        <Text size="xs" color="general">Total Ticks:</Text>
                        <Text size="s" weight="bold">{systemStatus.totalTicks.toLocaleString()}</Text>
                    </div>
                    <div className="status-item">
                        <Text size="xs" color="general">Signals Generated:</Text>
                        <Text size="s" weight="bold">{systemStatus.totalSignals}</Text>
                    </div>
                    <div className="status-item">
                        <Text size="xs" color="general">Memory Usage:</Text>
                        <Text size="s" weight="bold">{systemStatus.memoryUsage}</Text>
                    </div>
                </div>
            )}

            <div className="tick-trend-dashboard__content">
                <div className="tick-trend-dashboard__symbols-grid">
                    {BINARY_SYMBOLS.map(symbolInfo => {
                        const data = symbolData.get(symbolInfo.symbol);
                        const isSelected = selectedSymbol === symbolInfo.symbol;
                        
                        return (
                            <div
                                key={symbolInfo.symbol}
                                className={`symbol-card ${isSelected ? 'selected' : ''} ${!data ? 'inactive' : ''}`}
                                onClick={() => setSelectedSymbol(symbolInfo.symbol)}
                            >
                                <div className="symbol-card__header">
                                    <Text size="s" weight="bold">{symbolInfo.symbol}</Text>
                                    {data?.signal && (
                                        <div className="signal-indicator">
                                            <span className="direction-icon">
                                                {getDirectionIcon(data.signal.direction)}
                                            </span>
                                            <Text 
                                                size="xs" 
                                                style={{ color: getConfidenceColor(data.signal.confidence) }}
                                            >
                                                {data.signal.confidence.toFixed(0)}%
                                            </Text>
                                        </div>
                                    )}
                                </div>
                                
                                <Text size="xs" color="general" className="symbol-name">
                                    {symbolInfo.displayName}
                                </Text>
                                
                                {data?.decision && (
                                    <div className="trading-decision">
                                        <div className={`action-badge ${data.decision.action.toLowerCase()}`}>
                                            <Text size="xs" weight="bold">
                                                {data.decision.action}
                                            </Text>
                                        </div>
                                        <Text size="xs" color="general">
                                            Risk: {data.decision.riskLevel}
                                        </Text>
                                    </div>
                                )}
                                
                                {data?.lastUpdate && (
                                    <Text size="xs" color="general" className="last-update">
                                        Updated: {data.lastUpdate.toLocaleTimeString()}
                                    </Text>
                                )}
                            </div>
                        );
                    })}
                </div>

                {selectedData && (
                    <div className="tick-trend-dashboard__details">
                        <div className="details-header">
                            <Text size="l" weight="bold">
                                {selectedData.displayName} - Detailed Analysis
                            </Text>
                            <div className="auto-refresh-toggle">
                                <input
                                    type="checkbox"
                                    id="auto-refresh"
                                    checked={autoRefresh}
                                    onChange={(e) => setAutoRefresh(e.target.checked)}
                                />
                                <label htmlFor="auto-refresh">
                                    <Text size="xs">Auto Refresh</Text>
                                </label>
                            </div>
                        </div>

                        <div className="details-grid">
                            {/* Signal Details */}
                            <div className="detail-section">
                                <Text size="m" weight="bold" color="prominent">
                                    🎯 Current Signal
                                </Text>
                                {selectedData.signal && (
                                    <div className="signal-details">
                                        <div className="signal-row">
                                            <Text size="s">Direction:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.signal.direction === 'UP' ? 'var(--color-green)' : selectedData.signal.direction === 'DOWN' ? 'var(--color-red)' : 'var(--color-neutral)' }}>
                                                {getDirectionIcon(selectedData.signal.direction)} {selectedData.signal.direction}
                                            </Text>
                                        </div>
                                        <div className="signal-row">
                                            <Text size="s">Confidence:</Text>
                                            <Text size="s" weight="bold" style={{ color: getConfidenceColor(selectedData.signal.confidence) }}>
                                                {selectedData.signal.confidence.toFixed(1)}%
                                            </Text>
                                        </div>
                                        <div className="signal-row">
                                            <Text size="s">Strength:</Text>
                                            <Text size="s" weight="bold">{selectedData.signal.strength}</Text>
                                        </div>
                                        <div className="signal-row">
                                            <Text size="s">Time to Expiry:</Text>
                                            <Text size="s" weight="bold">{selectedData.signal.timeToExpiry}s</Text>
                                        </div>
                                        
                                        <div className="signal-reasons">
                                            <Text size="s" weight="bold">Reasons:</Text>
                                            {selectedData.signal.reasons.map((reason: string, index: number) => (
                                                <Text key={index} size="xs" color="general">
                                                    • {reason}
                                                </Text>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Technical Analysis */}
                            <div className="detail-section">
                                <Text size="m" weight="bold" color="prominent">
                                    📊 Technical Analysis
                                </Text>
                                {selectedData.analysis && (
                                    <div className="analysis-details">
                                        <div className="indicator-row">
                                            <Text size="s">EMA 5:</Text>
                                            <Text size="s" weight="bold">{selectedData.analysis.ema5.toFixed(5)}</Text>
                                        </div>
                                        <div className="indicator-row">
                                            <Text size="s">EMA 13:</Text>
                                            <Text size="s" weight="bold">{selectedData.analysis.ema13.toFixed(5)}</Text>
                                        </div>
                                        <div className="indicator-row">
                                            <Text size="s">EMA 21:</Text>
                                            <Text size="s" weight="bold">{selectedData.analysis.ema21.toFixed(5)}</Text>
                                        </div>
                                        <div className="indicator-row">
                                            <Text size="s">RSI:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.analysis.rsi > 70 ? 'var(--color-red)' : selectedData.analysis.rsi < 30 ? 'var(--color-green)' : 'var(--color-neutral)' }}>
                                                {selectedData.analysis.rsi.toFixed(1)}
                                            </Text>
                                        </div>
                                        <div className="indicator-row">
                                            <Text size="s">Momentum:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.analysis.momentum > 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
                                                {selectedData.analysis.momentum.toFixed(3)}%
                                            </Text>
                                        </div>
                                        <div className="indicator-row">
                                            <Text size="s">Tick Velocity:</Text>
                                            <Text size="s" weight="bold">{selectedData.analysis.tickVelocity.toFixed(6)}</Text>
                                        </div>
                                        <div className="indicator-row">
                                            <Text size="s">Price Action:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.analysis.priceAction === 'BULLISH' ? 'var(--color-green)' : selectedData.analysis.priceAction === 'BEARISH' ? 'var(--color-red)' : 'var(--color-neutral)' }}>
                                                {selectedData.analysis.priceAction}
                                            </Text>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Market Condition */}
                            <div className="detail-section">
                                <Text size="m" weight="bold" color="prominent">
                                    🌊 Market Condition
                                </Text>
                                {selectedData.marketCondition && (
                                    <div className="market-details">
                                        <div className="market-row">
                                            <Text size="s">Trending:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.marketCondition.trending ? 'var(--color-green)' : 'var(--color-red)' }}>
                                                {selectedData.marketCondition.trending ? 'Yes' : 'No'}
                                            </Text>
                                        </div>
                                        <div className="market-row">
                                            <Text size="s">Volatility:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.marketCondition.volatility === 'HIGH' ? 'var(--color-red)' : selectedData.marketCondition.volatility === 'MEDIUM' ? 'var(--color-yellow)' : 'var(--color-green)' }}>
                                                {selectedData.marketCondition.volatility}
                                            </Text>
                                        </div>
                                        <div className="market-row">
                                            <Text size="s">Suitable for Trading:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.marketCondition.suitableForTrading ? 'var(--color-green)' : 'var(--color-red)' }}>
                                                {selectedData.marketCondition.suitableForTrading ? 'Yes' : 'No'}
                                            </Text>
                                        </div>
                                        <div className="market-row">
                                            <Text size="s">Reason:</Text>
                                            <Text size="s">{selectedData.marketCondition.reason}</Text>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Trading Decision */}
                            <div className="detail-section">
                                <Text size="m" weight="bold" color="prominent">
                                    💡 Trading Decision
                                </Text>
                                {selectedData.decision && (
                                    <div className="decision-details">
                                        <div className={`decision-action ${selectedData.decision.action.toLowerCase()}`}>
                                            <Text size="l" weight="bold">
                                                {selectedData.decision.action}
                                            </Text>
                                            {selectedData.decision.expiry > 0 && (
                                                <Text size="s">
                                                    Expiry: {selectedData.decision.expiry}s
                                                </Text>
                                            )}
                                        </div>
                                        
                                        <div className="decision-row">
                                            <Text size="s">Confidence:</Text>
                                            <Text size="s" weight="bold" style={{ color: getConfidenceColor(selectedData.decision.confidence) }}>
                                                {selectedData.decision.confidence.toFixed(1)}%
                                            </Text>
                                        </div>
                                        
                                        <div className="decision-row">
                                            <Text size="s">Risk Level:</Text>
                                            <Text size="s" weight="bold" style={{ color: selectedData.decision.riskLevel === 'LOW' ? 'var(--color-green)' : selectedData.decision.riskLevel === 'HIGH' ? 'var(--color-red)' : 'var(--color-yellow)' }}>
                                                {selectedData.decision.riskLevel}
                                            </Text>
                                        </div>
                                        
                                        <div className="decision-reasoning">
                                            <Text size="s" weight="bold">Reasoning:</Text>
                                            {selectedData.decision.reasoning.map((reason: string, index: number) => (
                                                <Text key={index} size="xs" color="general">
                                                    • {reason}
                                                </Text>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

export default TickTrendDashboard;
