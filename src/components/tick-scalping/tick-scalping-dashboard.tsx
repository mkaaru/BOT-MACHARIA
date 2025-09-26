
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/shared_ui/button';
import { Text } from '@/components/shared_ui/text';
import { Modal } from '@/components/shared_ui/modal';
import { marketScanner } from '@/services/market-scanner';
import { ScalpingSignal, ScalpingStats } from '@/services/tick-scalping-engine';
import './tick-scalping-dashboard.scss';

interface TickScalpingDashboardProps {
    isOpen: boolean;
    onClose: () => void;
}

export const TickScalpingDashboard: React.FC<TickScalpingDashboardProps> = ({
    isOpen,
    onClose
}) => {
    const [scalpingStats, setScalpingStats] = useState<ScalpingStats | null>(null);
    const [activeSignals, setActiveSignals] = useState<ScalpingSignal[]>([]);
    const [isScalpingEnabled, setIsScalpingEnabled] = useState(true);
    const [recentSignals, setRecentSignals] = useState<ScalpingSignal[]>([]);

    // Update stats and signals
    const updateData = useCallback(() => {
        if (!isOpen) return;
        
        const stats = marketScanner.getScalpingStats();
        const signals = marketScanner.getActiveScalpingSignals();
        
        setScalpingStats(stats);
        setActiveSignals(signals);
    }, [isOpen]);

    // Setup scalping signal listener
    useEffect(() => {
        if (!isOpen) return;

        const unsubscribe = marketScanner.onScalpingSignal((signal: ScalpingSignal) => {
            setRecentSignals(prev => {
                const updated = [signal, ...prev];
                return updated.slice(0, 10); // Keep last 10 signals
            });
        });

        return unsubscribe;
    }, [isOpen]);

    // Update data periodically
    useEffect(() => {
        if (!isOpen) return;

        updateData();
        const interval = setInterval(updateData, 2000); // Update every 2 seconds

        return () => clearInterval(interval);
    }, [isOpen, updateData]);

    const handleCloseAllSignals = () => {
        marketScanner.closeAllScalpingSignals();
        setActiveSignals([]);
    };

    const handleResetStats = () => {
        marketScanner.resetScalpingStats();
        updateData();
    };

    const formatPrice = (price: number): string => {
        return price.toFixed(5);
    };

    const formatTime = (timestamp: number): string => {
        return new Date(timestamp).toLocaleTimeString();
    };

    const getSignalAge = (timestamp: number): string => {
        const ageMs = Date.now() - timestamp;
        const ageSeconds = Math.floor(ageMs / 1000);
        
        if (ageSeconds < 60) return `${ageSeconds}s`;
        if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
        return `${Math.floor(ageSeconds / 3600)}h`;
    };

    if (!isOpen) return null;

    return (
        <Modal
            is_open={isOpen}
            title="Tick Scalping Dashboard"
            className="tick-scalping-dashboard"
            should_header_stick_body={false}
            has_close_icon
            onClose={onClose}
        >
            <div className="scalping-dashboard">
                {/* Header Controls */}
                <div className="scalping-header">
                    <div className="status-indicator">
                        <div className={`status-dot ${isScalpingEnabled ? 'active' : 'inactive'}`} />
                        <Text size="sm" weight="bold">
                            Scalping Engine: {isScalpingEnabled ? 'ACTIVE' : 'INACTIVE'}
                        </Text>
                    </div>
                    
                    <div className="header-controls">
                        <Button
                            secondary
                            small
                            onClick={handleCloseAllSignals}
                            disabled={activeSignals.length === 0}
                        >
                            Close All Signals
                        </Button>
                        <Button
                            secondary
                            small
                            onClick={handleResetStats}
                        >
                            Reset Stats
                        </Button>
                    </div>
                </div>

                {/* Statistics Panel */}
                {scalpingStats && (
                    <div className="stats-panel">
                        <Text size="sm" weight="bold" className="panel-title">
                            📊 Performance Statistics
                        </Text>
                        <div className="stats-grid">
                            <div className="stat-item">
                                <Text size="xs" color="secondary">Total Signals</Text>
                                <Text size="sm" weight="bold">{scalpingStats.totalSignals}</Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="secondary">Win Rate</Text>
                                <Text 
                                    size="sm" 
                                    weight="bold"
                                    color={scalpingStats.winRate >= 60 ? 'success' : scalpingStats.winRate >= 40 ? 'warning' : 'loss-danger'}
                                >
                                    {scalpingStats.winRate.toFixed(1)}%
                                </Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="secondary">Active Positions</Text>
                                <Text size="sm" weight="bold">{scalpingStats.currentPositions}</Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="secondary">Successful</Text>
                                <Text size="sm" weight="bold" color="success">{scalpingStats.successfulTrades}</Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="secondary">Failed</Text>
                                <Text size="sm" weight="bold" color="loss-danger">{scalpingStats.failedTrades}</Text>
                            </div>
                            <div className="stat-item">
                                <Text size="xs" color="secondary">Last Signal</Text>
                                <Text size="xs">{formatTime(scalpingStats.lastSignalTime.getTime())}</Text>
                            </div>
                        </div>
                    </div>
                )}

                {/* Active Signals */}
                <div className="signals-panel">
                    <Text size="sm" weight="bold" className="panel-title">
                        🎯 Active Scalping Signals ({activeSignals.length})
                    </Text>
                    
                    {activeSignals.length === 0 ? (
                        <div className="no-signals">
                            <Text size="sm" color="secondary">No active scalping signals</Text>
                        </div>
                    ) : (
                        <div className="signals-list">
                            {activeSignals.map((signal, index) => (
                                <div key={`${signal.symbol}-${signal.timestamp}`} className="signal-card active">
                                    <div className="signal-header">
                                        <Text size="sm" weight="bold">{signal.symbol}</Text>
                                        <div className="signal-badges">
                                            <span className={`action-badge ${signal.action.toLowerCase()}`}>
                                                {signal.action}
                                            </span>
                                            <span className="confidence-badge">
                                                {signal.confidence.toFixed(0)}%
                                            </span>
                                            <span className="age-badge">
                                                {getSignalAge(signal.timestamp)}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div className="signal-prices">
                                        <div className="price-item">
                                            <Text size="xs" color="secondary">Entry</Text>
                                            <Text size="xs">{formatPrice(signal.entryPrice)}</Text>
                                        </div>
                                        <div className="price-item">
                                            <Text size="xs" color="secondary">Target</Text>
                                            <Text size="xs" color="success">{formatPrice(signal.targetPrice)}</Text>
                                        </div>
                                        <div className="price-item">
                                            <Text size="xs" color="secondary">Stop</Text>
                                            <Text size="xs" color="loss-danger">{formatPrice(signal.stopLoss)}</Text>
                                        </div>
                                        <div className="price-item">
                                            <Text size="xs" color="secondary">R:R</Text>
                                            <Text size="xs">{signal.riskReward.toFixed(2)}</Text>
                                        </div>
                                    </div>
                                    
                                    <Text size="xs" color="secondary" className="signal-reason">
                                        {signal.reasoning}
                                    </Text>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Recent Signals History */}
                <div className="signals-panel">
                    <Text size="sm" weight="bold" className="panel-title">
                        📋 Recent Signals ({recentSignals.length})
                    </Text>
                    
                    {recentSignals.length === 0 ? (
                        <div className="no-signals">
                            <Text size="sm" color="secondary">No recent signals</Text>
                        </div>
                    ) : (
                        <div className="signals-list recent">
                            {recentSignals.map((signal, index) => (
                                <div key={`recent-${signal.symbol}-${signal.timestamp}`} className="signal-card recent">
                                    <div className="signal-header">
                                        <Text size="sm">{signal.symbol}</Text>
                                        <div className="signal-badges">
                                            <span className={`action-badge ${signal.action.toLowerCase()}`}>
                                                {signal.action}
                                            </span>
                                            <span className="confidence-badge">
                                                {signal.confidence.toFixed(0)}%
                                            </span>
                                            <Text size="xs" color="secondary">
                                                {formatTime(signal.timestamp)}
                                            </Text>
                                        </div>
                                    </div>
                                    
                                    <div className="signal-prices compact">
                                        <Text size="xs" color="secondary">
                                            Entry: {formatPrice(signal.entryPrice)} | 
                                            Target: {formatPrice(signal.targetPrice)} | 
                                            R:R: {signal.riskReward.toFixed(2)}
                                        </Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default TickScalpingDashboard;
