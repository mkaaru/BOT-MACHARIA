import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signalIntegrationService, TradingSignal } from '../../services/signal-integration';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import marketAnalyzer from '../../services/market-analyzer';
import type { TradeRecommendation } from '@/services/market-analyzer';
import './trading-hub-display.scss';

interface TradingState {
    isRunning: boolean;
    selectedStrategy: string;
    currentStake: number;
    stopLoss: number;
    takeProfit: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    totalProfit: number;
    lastTradeResult: string;
    isTradeInProgress: boolean;
}

interface TradeConfig {
    symbol: string;
    contract_type: string;
    amount: number;
    duration: number;
    duration_unit: string;
    barrier?: string;
}

const TradingHubDisplay: React.FC = observer(() => {
    const { run_panel } = useStore();
    const [tradingState, setTradingState] = useState<TradingState>({
        isRunning: false,
        selectedStrategy: 'overunder',
        currentStake: 1,
        stopLoss: 50,
        takeProfit: 100,
        totalTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        totalProfit: 0,
        lastTradeResult: 'None',
        isTradeInProgress: false
    });

    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const [currentRecommendation, setCurrentRecommendation] = useState<TradeRecommendation | null>(null);
    const [analyzerReady, setAnalyzerReady] = useState(false);
    const [activeSignal, setActiveSignal] = useState<TradingSignal | null>(null);
    const [signalHistory, setSignalHistory] = useState<TradingSignal[]>([]);

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-49), logMessage]);
    }, []);

    const scrollToBottom = useCallback(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(scrollToBottom, [logs]);

    // Direct API trade execution
    const executeDirectTrade = useCallback(async (config: TradeConfig) => {
        if (!api_base.api) {
            addLog('❌ API not connected');
            return { success: false, error: 'API not connected' };
        }

        try {
            setTradingState(prev => ({ ...prev, isTradeInProgress: true }));
            addLog(`🚀 Executing ${config.contract_type} on ${config.symbol}`);

            // Get proposal
            const proposalRequest = {
                proposal: 1,
                amount: config.amount,
                basis: 'stake',
                contract_type: config.contract_type,
                currency: 'USD',
                duration: config.duration,
                duration_unit: config.duration_unit,
                symbol: config.symbol,
                ...(config.barrier && { barrier: config.barrier })
            };

            const proposalResponse = await api_base.api.send(proposalRequest);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error.message };
            }

            const proposalId = proposalResponse.proposal.id;
            addLog(`✅ Proposal received: ${proposalId}`);

            // Purchase contract
            const buyRequest = {
                buy: proposalId,
                price: config.amount
            };

            const buyResponse = await api_base.api.send(buyRequest);

            if (buyResponse.error) {
                addLog(`❌ Purchase error: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error.message };
            }

            const contractId = buyResponse.buy.contract_id;
            const buyPrice = buyResponse.buy.buy_price;
            addLog(`🎉 Contract purchased: ${contractId} for $${buyPrice}`);

            return {
                success: true,
                contract_id: contractId,
                buy_price: buyPrice
            };

        } catch (error) {
            addLog(`💥 Trade execution failed: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            setTimeout(() => {
                setTradingState(prev => ({ ...prev, isTradeInProgress: false }));
            }, 2000);
        }
    }, [addLog]);

    const getTradeConfig = useCallback((strategy: string): TradeConfig => {
        const baseConfig = {
            amount: tradingState.currentStake,
            duration: 1,
            duration_unit: 't'
        };

        // Use active signal if available and matches strategy
        if (activeSignal && activeSignal.strategy === strategy) {
            const symbolMap: Record<string, string> = {
                'RDBULL': 'R_75', // Map signal symbols to trading symbols
                'RBEAR': 'R_75',
                'R10': 'R_10',
                'R25': 'R_25',
                'R50': 'R_50',
                'R75': 'R_75',
                'R100': 'R_100'
            };

            const tradingSymbol = symbolMap[activeSignal.symbol] || 'R_75';

            return {
                ...baseConfig,
                symbol: tradingSymbol,
                contract_type: activeSignal.action === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
                barrier: activeSignal.barrier || '5'
            };

        }

        return {
            ...baseConfig,
            symbol: 'R_10',
            contract_type: 'DIGITEVEN'
        };
    }, [tradingState.currentStake, activeSignal]);

    const executeTrade = useCallback(async () => {
        if (tradingState.isTradeInProgress) {
            addLog('⏳ Trade already in progress');
            return;
        }

        // Check if we have an active signal for the selected strategy
        if (!activeSignal || activeSignal.strategy !== tradingState.selectedStrategy) {
            addLog(`❌ No active signal for ${tradingState.selectedStrategy.toUpperCase()} strategy`);
            addLog('💡 Waiting for signal recommendation...');
            return;
        }

        const config = getTradeConfig(tradingState.selectedStrategy);
        addLog(`🎯 Strategy: ${tradingState.selectedStrategy.toUpperCase()}`);
        addLog(`📊 Using signal: ${activeSignal.action} ${activeSignal.barrier || ''} on ${activeSignal.symbol}`);
        addLog(`💪 Confidence: ${activeSignal.confidence}%`);

        const result = await executeDirectTrade(config);

        if (result.success) {
            setTradingState(prev => ({
                ...prev,
                totalTrades: prev.totalTrades + 1,
                lastTradeResult: 'Executed'
            }));

            // Mark signal as used
            setActiveSignal(null);
            signalIntegrationService.clearActiveSignal();
            addLog('✅ Signal executed, waiting for next signal');
        }
    }, [tradingState.selectedStrategy, tradingState.isTradeInProgress, activeSignal, executeDirectTrade, getTradeConfig, addLog]);

    const toggleTrading = useCallback(() => {
        setTradingState(prev => {
            const newRunning = !prev.isRunning;
            addLog(`Trading ${newRunning ? 'STARTED' : 'STOPPED'}`);
            return { ...prev, isRunning: newRunning };
        });
    }, [addLog]);

    const resetStats = useCallback(() => {
        setTradingState(prev => ({
            ...prev,
            totalTrades: 0,
            winTrades: 0,
            lossTrades: 0,
            totalProfit: 0,
            lastTradeResult: 'None'
        }));
        addLog('📊 Statistics reset');
    }, [addLog]);

    // Subscribe to signal service
    useEffect(() => {
        const signalSubscription = signalIntegrationService.getActiveSignal().subscribe(signal => {
            if (signal && signal.strategy === tradingState.selectedStrategy) {
                setActiveSignal(signal);
                addLog(`📊 New active signal: ${signal.action} ${signal.barrier || ''} on ${signal.symbol} (${signal.confidence}%)`);
            }
        });

        const allSignalsSubscription = signalIntegrationService.getSignals().subscribe(signals => {
            setSignalHistory(signals.filter(s => s.strategy === tradingState.selectedStrategy).slice(-10));
        });

        return () => {
            signalSubscription.unsubscribe();
            allSignalsSubscription.unsubscribe();
        };
    }, [tradingState.selectedStrategy, addLog]);

    // Clear active signal when strategy changes
    useEffect(() => {
        setActiveSignal(null);
        signalIntegrationService.clearActiveSignal();
    }, [tradingState.selectedStrategy]);

    return (
        <div className="trading-hub-container">
            <div className="trading-hub-grid">
                <div className="main-content">
                    {/* Market Analyzer Status */}
                    <div className="analyzer-status">
                        <h3>🔬 Market Analyzer</h3>
                        <div className={`status-indicator ${analyzerReady ? 'ready' : 'loading'}`}>
                            <span className="status-dot"></span>
                            {analyzerReady ? 'Ready' : 'Initializing...'}
                        </div>
                        {currentRecommendation && (
                            <div className="current-signal">
                                <strong>Active Signal:</strong> {currentRecommendation.strategy} on {currentRecommendation.symbol}
                                <br />
                                <small>Barrier: {currentRecommendation.barrier} | {currentRecommendation.reason}</small>
                            </div>
                        )}
                    </div>

                    {/* Strategy Selection */}
                    <div className="strategy-section">
                        <h3>🎯 Trading Strategy</h3>
                        <div className="strategy-buttons">
                            {['overunder', 'differ', 'o5u4'].map(strategy => (
                                <button
                                    key={strategy}
                                    className={`strategy-btn ${tradingState.selectedStrategy === strategy ? 'active' : ''}`}
                                    onClick={() => setTradingState(prev => ({ ...prev, selectedStrategy: strategy }))}
                                    disabled={tradingState.isRunning}
                                >
                                    {strategy.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Configuration */}
                    <div className="config-section">
                        <h3>⚙️ Configuration</h3>
                        <div className="config-grid">
                            <div className="config-item">
                                <label>Stake ($)</label>
                                <input
                                    type="number"
                                    value={tradingState.currentStake}
                                    onChange={e => setTradingState(prev => ({ ...prev, currentStake: parseFloat(e.target.value) || 1 }))}
                                    min="1"
                                    step="0.1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Stop Loss ($)</label>
                                <input
                                    type="number"
                                    value={tradingState.stopLoss}
                                    onChange={e => setTradingState(prev => ({ ...prev, stopLoss: parseFloat(e.target.value) || 50 }))}
                                    min="1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Take Profit ($)</label>
                                <input
                                    type="number"
                                    value={tradingState.takeProfit}
                                    onChange={e => setTradingState(prev => ({ ...prev, takeProfit: parseFloat(e.target.value) || 100 }))}
                                    min="1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="controls-section">
                        <h3>🎮 Controls</h3>
                        <div className="control-buttons">
                            <button
                                className={`control-btn ${tradingState.isRunning ? 'stop' : 'start'}`}
                                onClick={toggleTrading}
                                disabled={tradingState.isTradeInProgress}
                            >
                                {tradingState.isRunning ? '⏹️ Stop' : '▶️ Start'} Trading
                            </button>
                            <button
                                className="control-btn manual"
                                onClick={executeTrade}
                                disabled={tradingState.isRunning || tradingState.isTradeInProgress}
                            >
                                🎯 Manual Trade
                            </button>
                            <button
                                className="control-btn reset"
                                onClick={resetStats}
                            >
                                🔄 Reset Stats
                            </button>
                        </div>
                    </div>
                </div>

                <div className="sidebar-content">
                    {/* Statistics */}
                    <div className="stats-section">
                        <h3>📊 Statistics</h3>
                        <div className="stats-grid">
                            <div className="stat-item">
                                <span className="stat-label">Total Trades</span>
                                <span className="stat-value">{tradingState.totalTrades}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Win Rate</span>
                                <span className="stat-value">
                                    {tradingState.totalTrades > 0 ? 
                                        ((tradingState.winTrades / tradingState.totalTrades) * 100).toFixed(1) : 0}%
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Total P&L</span>
                                <span className={`stat-value ${tradingState.totalProfit >= 0 ? 'profit' : 'loss'}`}>
                                    ${tradingState.totalProfit.toFixed(2)}
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Last Result</span>
                                <span className="stat-value">{tradingState.lastTradeResult}</span>
                            </div>
                        </div>
                    </div>

                    {/* Activity Logs */}
                    <div className="logs-section">
                        <h3>📝 Activity Logs</h3>
                        <div className="logs-container">
                            {logs.map((log, index) => (
                                <div key={index} className="log-entry">
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default TradingHubDisplay;