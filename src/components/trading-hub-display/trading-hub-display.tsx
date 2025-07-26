import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import marketAnalyzer from '@/services/market-analyzer';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import './trading-hub-display.scss';

interface TradingState {
    isContinuousTrading: boolean;
    isAutoOverUnderActive: boolean;
    isAutoDifferActive: boolean;
    isAutoO5U4Active: boolean;
    isTradeInProgress: boolean;
    lastTradeTime: number;
    balance: number;
    profit: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    currentRecommendation: any;
    tradeHistory: any[];
}

interface MarketData {
    symbol: string;
    lastTick: number;
    recommendation: string;
    confidence: number;
    lastUpdate: number;
}

const TradingHubDisplay: React.FC = observer(() => {
    const { run_panel } = useStore();
    const [tradingState, setTradingState] = useState<TradingState>({
        isContinuousTrading: false,
        isAutoOverUnderActive: false,
        isAutoDifferActive: false,
        isAutoO5U4Active: false,
        isTradeInProgress: false,
        lastTradeTime: 0,
        balance: 10000,
        profit: 0,
        totalTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        currentRecommendation: null,
        tradeHistory: []
    });

    const [marketData, setMarketData] = useState<MarketData[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const tradeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-49), logMessage]);
        console.log('🔄', logMessage);
    }, []);

    const scrollToBottom = useCallback(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(scrollToBottom, [logs]);

    // Initialize market analyzer and API connection
    useEffect(() => {
        addLog('Initializing trading system...');

        // Check API connection
        if (!api_base.api) {
            addLog('❌ API not connected! Please ensure you are logged in to Deriv.');
            return;
        }

        addLog('✅ API connection available');

        if (!marketAnalyzer.isReadyForTrading()) {
            marketAnalyzer.start();
            addLog('Market analyzer started');
        }

        const unsubscribe = marketAnalyzer.onAnalysis((recommendation, allStats) => {
            if (recommendation) {
                addLog(`📊 New recommendation: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${recommendation.symbol} (${recommendation.reason})`);

                setTradingState(prev => ({
                    ...prev,
                    currentRecommendation: recommendation
                }));
            }

            // Update market data
            const newMarketData = Object.entries(allStats).map(([symbol, stats]) => ({
                symbol,
                lastTick: stats.currentLastDigit,
                recommendation: stats.recommendation,
                confidence: Math.max(...stats.digitPercentages),
                lastUpdate: stats.lastUpdated
            }));
            setMarketData(newMarketData);
        });

        return () => {
            unsubscribe();
            marketAnalyzer.stop();
        };
    }, []);

    // Auto-trade effect - separate from market analyzer
    useEffect(() => {
        if (tradingState.isContinuousTrading && 
            tradingState.currentRecommendation &&
            !tradingState.isTradeInProgress &&
            (tradingState.isAutoOverUnderActive || tradingState.isAutoDifferActive || tradingState.isAutoO5U4Active)) {

            // Clear any existing timeout
            if (tradeTimeoutRef.current) {
                clearTimeout(tradeTimeoutRef.current);
            }

            // Execute trade after a short delay to prevent rapid trades
            tradeTimeoutRef.current = setTimeout(() => {
                executeAutoTrade(tradingState.currentRecommendation);
            }, 1000);
        }

        return () => {
            if (tradeTimeoutRef.current) {
                clearTimeout(tradeTimeoutRef.current);
            }
        };
    }, [tradingState.isContinuousTrading, tradingState.currentRecommendation, tradingState.isTradeInProgress, 
        tradingState.isAutoOverUnderActive, tradingState.isAutoDifferActive, tradingState.isAutoO5U4Active]);

    const executeAutoTrade = useCallback(async (recommendation: any) => {
        if (tradingState.isTradeInProgress) {
            addLog('⏳ Trade already in progress, skipping...');
            return;
        }

        try {
            setTradingState(prev => ({ ...prev, isTradeInProgress: true }));
            addLog(`🎯 Executing Auto Over/Under trade: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${recommendation.symbol}`);

            // Determine contract type based on recommendation
            let contractType = 'DIGITOVER';
            if (recommendation.strategy === 'under') {
                contractType = 'DIGITUNDER';
            }

            // Create trade parameters for digits contract
            const tradeParams = {
                proposal: 1,
                contract_type: contractType,
                symbol: recommendation.symbol,
                duration: 1,
                duration_unit: 't',
                amount: 1,
                basis: 'stake',
                barrier: recommendation.barrier
            };

            addLog(`📋 Trade params: ${JSON.stringify(tradeParams)}`);

            // Execute trade through Bot's API
            const result = await executeTrade(tradeParams);

            if (result.success) {
                addLog(`✅ Trade executed successfully: ${result.contract_id}`);
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeTime: Date.now(),
                    tradeHistory: [...prev.tradeHistory.slice(-19), {
                        time: Date.now(),
                        symbol: recommendation.symbol,
                        type: recommendation.strategy,
                        barrier: recommendation.barrier,
                        amount: 1,
                        status: 'executed',
                        contractId: result.contract_id
                    }]
                }));
            } else {
                addLog(`❌ Trade execution failed: ${result.error}`);
            }

        } catch (error) {
            addLog(`❌ Trade execution error: ${error.message}`);
        } finally {
            // Reset trade in progress after delay
            setTimeout(() => {
                setTradingState(prev => ({ 
                    ...prev, 
                    isTradeInProgress: false,
                    currentRecommendation: null // Clear recommendation to prevent repeated trades
                }));
            }, 5000);
        }
    }, [tradingState.isTradeInProgress]);

    const executeTrade = async (params: any) => {
        try {
            addLog(`🔄 Sending proposal request...`);

            // Get proposal first
            const proposalResponse = await api_base.api.send(params);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error.message };
            }

            if (!proposalResponse.proposal) {
                addLog(`❌ No proposal received`);
                return { success: false, error: 'No proposal received' };
            }

            addLog(`✅ Proposal received: ${proposalResponse.proposal.id}, Price: ${proposalResponse.proposal.display_value}`);

            // Buy the contract
            const buyParams = {
                buy: proposalResponse.proposal.id,
                price: params.amount
            };

            addLog(`🔄 Sending buy request...`);
            const buyResponse = await api_base.api.send(buyParams);

            if (buyResponse.error) {
                addLog(`❌ Buy error: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error.message };
            }

            if (!buyResponse.buy) {
                addLog(`❌ No buy confirmation received`);
                return { success: false, error: 'No buy confirmation received' };
            }

            addLog(`✅ Contract purchased: ${buyResponse.buy.contract_id}`);
            return { success: true, contract_id: buyResponse.buy.contract_id };

        } catch (error) {
            addLog(`❌ Trade execution exception: ${error.message}`);
            return { success: false, error: error.message };
        }
    };

    const handleStrategyToggle = useCallback((strategy: string) => {
        setTradingState(prev => {
            const newState = { ...prev };

            switch (strategy) {
                case 'overunder':
                    newState.isAutoOverUnderActive = !prev.isAutoOverUnderActive;
                    addLog(`Auto Over/Under ${newState.isAutoOverUnderActive ? 'activated' : 'deactivated'}`);
                    break;
                case 'differ':
                    newState.isAutoDifferActive = !prev.isAutoDifferActive;
                    addLog(`Auto Differ ${newState.isAutoDifferActive ? 'activated' : 'deactivated'}`);
                    break;
                case 'o5u4':
                    newState.isAutoO5U4Active = !prev.isAutoO5U4Active;
                    addLog(`Auto O5U4 ${newState.isAutoO5U4Active ? 'activated' : 'deactivated'}`);
                    break;
            }

            return newState;
        });
    }, [addLog]);

    const toggleContinuousTrading = useCallback(() => {
        setTradingState(prev => {
            const newState = !prev.isContinuousTrading;
            addLog(`Continuous trading ${newState ? 'started' : 'stopped'}`);

            // Debug current state
            console.log('🔄 Current trading state:', {
                isContinuousTrading: newState,
                isAutoOverUnderActive: prev.isAutoOverUnderActive,
                isAutoDifferActive: prev.isAutoDifferActive,
                isAutoO5U4Active: prev.isAutoO5U4Active,
                isTradeInProgress: prev.isTradeInProgress,
                hasRecommendation: !!prev.currentRecommendation
            });

            return { ...prev, isContinuousTrading: newState };
        });
    }, [addLog]);

    const resetStats = useCallback(() => {
        setTradingState(prev => ({
            ...prev,
            profit: 0,
            totalTrades: 0,
            winTrades: 0,
            lossTrades: 0,
            tradeHistory: []
        }));
        addLog('Statistics reset');
    }, [addLog]);

    const executeManualTrade = useCallback(async () => {
        if (!tradingState.currentRecommendation) {
            addLog('❌ No recommendation available for manual trade');
            return;
        }

        addLog('🎯 Executing manual trade...');
        await executeAutoTrade(tradingState.currentRecommendation);
    }, [tradingState.currentRecommendation, executeAutoTrade]);

    // Debug effect to log state changes
    useEffect(() => {
        console.log('🔄 Current trading state:', tradingState);
    }, [tradingState]);

    return (
        <div className="trading-hub-container">
            <div className="trading-hub-header">
                <h2>🎯 Deriv Trading Hub</h2>
                <div className="status-indicator">
                    <span className={`status-dot ${api_base.api ? 'connected' : 'disconnected'}`}></span>
                    {api_base.api ? 'Connected' : 'Disconnected'}
                </div>
            </div>

            <div className="trading-hub-content">
                <div className="logs-section">
                    <h3>📜 Activity Logs</h3>
                    <div className="logs-container">
                        {logs.map((log, index) => (
                            <div key={index} className="log-item">{log}</div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>

                <div className="connection-status">
                    <h3>🔗 System Status</h3>
                    <div className="status-grid">
                        <div className="status-item">
                            <span className="status-label">API:</span>
                            <span className={`status-value ${api_base.api ? 'connected' : 'disconnected'}`}>
                                {api_base.api ? '✅ Connected' : '❌ Disconnected'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">Market Analyzer:</span>
                            <span className={`status-value ${marketAnalyzer.isReadyForTrading() ? 'connected' : 'disconnected'}`}>
                                {marketAnalyzer.isReadyForTrading() ? '✅ Ready' : '⏳ Loading...'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">Trade Status:</span>
                            <span className={`status-value ${tradingState.isTradeInProgress ? 'trading' : 'idle'}`}>
                                {tradingState.isTradeInProgress ? '🔄 Trading' : '💤 Idle'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="recommendation-section">
                    <h3>📊 Current Recommendation</h3>
                    {tradingState.currentRecommendation ? (
                        <div className="recommendation-card">
                            <div className="rec-header">
                                <span className="rec-symbol">{tradingState.currentRecommendation.symbol}</span>
                                <span className="rec-type">
                                    {tradingState.currentRecommendation.strategy.toUpperCase()} {tradingState.currentRecommendation.barrier}
                                </span>
                            </div>
                            <div className="rec-reason">{tradingState.currentRecommendation.reason}</div>
                            <div className="rec-percentages">
                                Over: {tradingState.currentRecommendation.overPercentage?.toFixed(1)}% | 
                                Under: {tradingState.currentRecommendation.underPercentage?.toFixed(1)}%
                            </div>
                        </div>
                    ) : (
                        <div className="no-recommendation">
                            Waiting for market analysis...
                        </div>
                    )}
                </div>

                <div className="strategy-section">
                    <h3>⚙️ Trading Strategies</h3>
                    <div className="strategy-toggles">
                        <label className="strategy-toggle">
                            <input
                                type="checkbox"
                                checked={tradingState.isAutoOverUnderActive}
                                onChange={() => handleStrategyToggle('overunder')}
                            />
                            <span>Auto Over/Under</span>
                        </label>
                        <label className="strategy-toggle">
                            <input
                                type="checkbox"
                                checked={tradingState.isAutoDifferActive}
                                onChange={() => handleStrategyToggle('differ')}
                            />
                            <span>Auto Differ</span>
                        </label>
                        <label className="strategy-toggle">
                            <input
                                type="checkbox"
                                checked={tradingState.isAutoO5U4Active}
                                onChange={() => handleStrategyToggle('o5u4')}
                            />
                            <span>Auto O5U4</span>
                        </label>
                    </div>
                </div>

                <div className="control-section">
                    <h3>🎮 Trading Controls</h3>
                    <div className="control-buttons">
                        <button
                            className={`control-btn ${tradingState.isContinuousTrading ? 'stop-btn' : 'start-btn'}`}
                            onClick={toggleContinuousTrading}
                            disabled={tradingState.isTradeInProgress}
                        >
                            {tradingState.isContinuousTrading ? '⏹️ Stop Trading' : '▶️ Start Trading'}
                        </button>

                        <button
                            className="control-btn manual-btn"
                            onClick={executeManualTrade}
                            disabled={tradingState.isTradeInProgress || !tradingState.currentRecommendation}
                        >
                            🎯 Manual Trade
                        </button>

                        <button
                            className="control-btn reset-btn"
                            onClick={resetStats}
                        >
                            🔄 Reset Stats
                        </button>
                    </div>
                </div>

                <div className="market-data-section">
                    <h3>📈 Market Data</h3>
                    <div className="market-data-grid">
                        {marketData.map(data => (
                            <div key={data.symbol} className="market-data-card">
                                <div className="data-symbol">{data.symbol}</div>
                                <div className="data-tick">Last: {data.lastTick}</div>
                                <div className="data-recommendation">{data.recommendation}</div>
                                <div className="data-confidence">{data.confidence.toFixed(1)}%</div>
                                <div className="data-update">{new Date(data.lastUpdate).toLocaleTimeString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default TradingHubDisplay;