
import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Button from '@/components/shared_ui/button';
import { localize } from '@deriv-com/translations';
import { tickScalpingEngine, TickScalpingSignal, TickScalpingStats } from '@/services/tick-scalping-engine';
import { VOLATILITY_SYMBOLS } from '@/services/tick-stream-manager';

import './tick-scalping-dashboard.scss';

interface ScalpingSymbolData {
    symbol: string;
    displayName: string;
    signal: TickScalpingSignal | null;
    stats: TickScalpingStats | null;
    bufferStatus: any;
    isGoodForScalping: boolean;
}

const TickScalpingDashboard = observer(() => {
    const [symbolsData, setSymbolsData] = useState<ScalpingSymbolData[]>([]);
    const [activeSignals, setActiveSignals] = useState<TickScalpingSignal[]>([]);
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set(['R_100', '1HZ100V']));

    // Update dashboard data
    const updateDashboard = useCallback(() => {
        const data: ScalpingSymbolData[] = VOLATILITY_SYMBOLS
            .filter(symbolInfo => selectedSymbols.has(symbolInfo.symbol))
            .map(symbolInfo => ({
                symbol: symbolInfo.symbol,
                displayName: symbolInfo.display_name,
                signal: tickScalpingEngine.getLatestSignal(symbolInfo.symbol),
                stats: tickScalpingEngine.getStats(symbolInfo.symbol),
                bufferStatus: tickScalpingEngine.getBufferStatus(symbolInfo.symbol),
                isGoodForScalping: tickScalpingEngine.isGoodForScalping(symbolInfo.symbol)
            }));

        setSymbolsData(data);

        // Update active signals
        const signals = data
            .map(d => d.signal)
            .filter(s => s !== null)
            .filter(s => (Date.now() - s!.timestamp.getTime()) < 10000) // Last 10 seconds
            .sort((a, b) => b!.timestamp.getTime() - a!.timestamp.getTime());

        setActiveSignals(signals as TickScalpingSignal[]);
    }, [selectedSymbols]);

    // Set up signal callbacks
    useEffect(() => {
        const callbacks: Map<string, (signal: TickScalpingSignal) => void> = new Map();

        selectedSymbols.forEach(symbol => {
            const callback = (signal: TickScalpingSignal) => {
                console.log(`🎯 New Scalping Signal: ${signal.symbol} ${signal.direction} (${signal.confidence}%)`);
                updateDashboard();
            };
            
            tickScalpingEngine.addScalpingCallback(symbol, callback);
            callbacks.set(symbol, callback);
        });

        return () => {
            callbacks.forEach((callback, symbol) => {
                tickScalpingEngine.removeScalpingCallback(symbol, callback);
            });
        };
    }, [selectedSymbols, updateDashboard]);

    // Periodic dashboard updates
    useEffect(() => {
        if (!isMonitoring) return;

        const interval = setInterval(updateDashboard, 1000); // Update every second
        updateDashboard(); // Initial update

        return () => clearInterval(interval);
    }, [isMonitoring, updateDashboard]);

    // Toggle symbol selection
    const toggleSymbol = (symbol: string) => {
        const newSelection = new Set(selectedSymbols);
        if (newSelection.has(symbol)) {
            newSelection.delete(symbol);
        } else {
            newSelection.add(symbol);
        }
        setSelectedSymbols(newSelection);
    };

    // Get signal color class
    const getSignalColorClass = (signal: TickScalpingSignal) => {
        if (signal.direction === 'RISE') return 'signal-rise';
        if (signal.direction === 'FALL') return 'signal-fall';
        return 'signal-neutral';
    };

    // Get confidence color
    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'confidence-high';
        if (confidence >= 60) return 'confidence-medium';
        return 'confidence-low';
    };

    // Format time ago
    const formatTimeAgo = (timestamp: Date) => {
        const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
        if (seconds < 10) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        return `${Math.floor(seconds / 60)}m ago`;
    };

    return (
        <div className="tick-scalping-dashboard">
            <div className="dashboard-header">
                <Text as="h2" size="l" weight="bold" color="prominent">
                    ⚡ Tick Scalping Dashboard
                </Text>
                <div className="header-controls">
                    <Button
                        onClick={() => setIsMonitoring(!isMonitoring)}
                        color={isMonitoring ? 'red' : 'green'}
                        variant="contained"
                        size="small"
                    >
                        {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
                    </Button>
                    <Button
                        onClick={() => tickScalpingEngine.reset()}
                        color="secondary"
                        variant="outlined"
                        size="small"
                    >
                        Reset All
                    </Button>
                </div>
            </div>

            {/* Symbol Selection */}
            <div className="symbol-selection">
                <Text size="s" weight="bold">Select Symbols to Monitor:</Text>
                <div className="symbol-checkboxes">
                    {VOLATILITY_SYMBOLS.map(symbolInfo => (
                        <label key={symbolInfo.symbol} className="symbol-checkbox">
                            <input
                                type="checkbox"
                                checked={selectedSymbols.has(symbolInfo.symbol)}
                                onChange={() => toggleSymbol(symbolInfo.symbol)}
                            />
                            <span className="symbol-name">{symbolInfo.display_name}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Active Signals */}
            {activeSignals.length > 0 && (
                <div className="active-signals">
                    <Text size="s" weight="bold" color="prominent">🎯 Live Scalping Signals</Text>
                    <div className="signals-grid">
                        {activeSignals.slice(0, 6).map((signal, index) => (
                            <div key={`${signal.symbol}-${signal.timestamp.getTime()}`} className={`signal-card ${getSignalColorClass(signal)}`}>
                                <div className="signal-header">
                                    <Text size="xs" weight="bold">{signal.symbol}</Text>
                                    <Text size="xs" className={getConfidenceColor(signal.confidence)}>
                                        {signal.confidence}%
                                    </Text>
                                </div>
                                <div className="signal-direction">
                                    <Text size="s" weight="bold">
                                        {signal.direction === 'RISE' ? '📈 RISE' : '📉 FALL'}
                                    </Text>
                                </div>
                                <Text size="xs" className="signal-reason">{signal.entryReason}</Text>
                                <Text size="xs" className="signal-time">{formatTimeAgo(signal.timestamp)}</Text>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Symbol Details */}
            <div className="symbols-details">
                <Text size="s" weight="bold">Symbol Analysis</Text>
                <div className="symbols-grid">
                    {symbolsData.map(data => (
                        <div key={data.symbol} className={`symbol-card ${data.isGoodForScalping ? 'good-scalping' : 'poor-scalping'}`}>
                            <div className="symbol-header">
                                <Text size="xs" weight="bold">{data.displayName}</Text>
                                <div className={`scalping-indicator ${data.isGoodForScalping ? 'good' : 'poor'}`}>
                                    {data.isGoodForScalping ? '✅' : '❌'}
                                </div>
                            </div>

                            {/* Latest Signal */}
                            {data.signal && (
                                <div className="latest-signal">
                                    <Text size="xs">
                                        Latest: <span className={getSignalColorClass(data.signal)}>
                                            {data.signal.direction}
                                        </span> ({data.signal.confidence}%)
                                    </Text>
                                    <Text size="xs">{formatTimeAgo(data.signal.timestamp)}</Text>
                                </div>
                            )}

                            {/* Statistics */}
                            {data.stats && data.stats.totalTrades > 0 && (
                                <div className="symbol-stats">
                                    <Text size="xs">
                                        Trades: {data.stats.totalTrades} | Win Rate: {data.stats.winRate.toFixed(1)}%
                                    </Text>
                                    <Text size="xs">
                                        P&L: {data.stats.totalPips.toFixed(1)} ticks
                                    </Text>
                                    {data.stats.consecutiveWins > 0 && (
                                        <Text size="xs" color="success">
                                            🔥 {data.stats.consecutiveWins} wins
                                        </Text>
                                    )}
                                    {data.stats.consecutiveLosses > 0 && (
                                        <Text size="xs" color="loss-danger">
                                            💥 {data.stats.consecutiveLosses} losses
                                        </Text>
                                    )}
                                </div>
                            )}

                            {/* Buffer Status */}
                            {data.bufferStatus && (
                                <div className="buffer-status">
                                    <Text size="xs">
                                        Ticks: {data.bufferStatus.tickCount} | 
                                        Vol: {data.bufferStatus.volatility}
                                    </Text>
                                    {data.bufferStatus.consecutiveDirection !== 'neutral' && (
                                        <Text size="xs">
                                            {data.bufferStatus.consecutiveDirection === 'up' ? '⬆️' : '⬇️'} 
                                            {data.bufferStatus.consecutiveCount} consecutive
                                        </Text>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Quick Stats */}
            <div className="quick-stats">
                <div className="stat-card">
                    <Text size="xs">Active Signals</Text>
                    <Text size="s" weight="bold">{activeSignals.length}</Text>
                </div>
                <div className="stat-card">
                    <Text size="xs">Good Symbols</Text>
                    <Text size="s" weight="bold">{symbolsData.filter(d => d.isGoodForScalping).length}</Text>
                </div>
                <div className="stat-card">
                    <Text size="xs">Total Monitored</Text>
                    <Text size="s" weight="bold">{selectedSymbols.size}</Text>
                </div>
            </div>
        </div>
    );
});

export default TickScalpingDashboard;
