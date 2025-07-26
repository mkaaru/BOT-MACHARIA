import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import marketAnalyzer from '@/services/market-analyzer';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
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
    const { run_panel, dashboard } = useStore();
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

    const [botConfig, setBotConfig] = useState({
        selectedStrategy: 'martingale',
        initialStake: 1,
        martingaleMultiplier: 2,
        maxConsecutiveLosses: 5,
        stopLoss: 50,
        takeProfit: 100
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

    // Sync bot configuration with bot builder immediately
    const updateBotBuilder = useCallback((config: typeof botConfig) => {
        // Update configuration in real-time
        if (window.dbot?.interpreter?.bot) {
            const botInterface = window.dbot.interpreter.bot.getInterface();

            // Update bot builder parameters immediately
            if (botInterface.updateConfig) {
                botInterface.updateConfig({
                    strategy: config.selectedStrategy,
                    initialStake: config.initialStake,
                    martingaleMultiplier: config.martingaleMultiplier,
                    maxConsecutiveLosses: config.maxConsecutiveLosses,
                    stopLoss: config.stopLoss,
                    takeProfit: config.takeProfit,
                    autoSymbolSelection: true,
                    autoContractSelection: true
                });
            }

            // Configure strategy settings
            botInterface.setMartingaleLimits?.(config.martingaleMultiplier, config.maxConsecutiveLosses);
            botInterface.setMartingaleEnabled?.(config.selectedStrategy.includes('martingale'));
            botInterface.setStopLoss?.(config.stopLoss);
            botInterface.setTakeProfit?.(config.takeProfit);
            botInterface.setInitialStake?.(config.initialStake);

            // Apply settings to trade engine
            if (window.dbot.interpreter.bot.tradeEngine) {
                window.dbot.interpreter.bot.tradeEngine.updateSettings({
                    stake: config.initialStake,
                    martingaleMultiplier: config.martingaleMultiplier,
                    maxLoss: config.maxConsecutiveLosses,
                    stopLoss: config.stopLoss,
                    takeProfit: config.takeProfit
                });
            }
        }
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
        if (tradingState.isTradeInProgress || run_panel.is_running) {
            addLog('⏳ Trade already in progress, skipping...');
            return;
        }

        try {
            setTradingState(prev => ({ ...prev, isTradeInProgress: true }));
            addLog(`🎯 Executing Auto ${botConfig.selectedStrategy.toUpperCase()} trade: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${botConfig.symbol}`);

            // Auto-determine symbol and contract type based on active strategy
            let symbol = '1HZ10V'; // Volatility 10 (1s) for fast execution
            let contractType = 'DIGITEVEN'; // Default contract type

            // Strategy-based symbol and contract selection
            if (tradingState.isAutoOverUnderActive) {
                symbol = '1HZ25V'; // Volatility 25 for over/under
                contractType = recommendation.strategy === 'under' ? 'DIGITUNDER' : 'DIGITOVER';
                addLog(`🎯 Auto Over/Under: ${contractType} on ${symbol}`);
            } else if (tradingState.isAutoDifferActive) {
                symbol = '1HZ50V'; // Volatility 50 for even/odd
                contractType = recommendation.lastDigit % 2 === 0 ? 'DIGITODD' : 'DIGITEVEN';
                addLog(`🎯 Auto Differ: ${contractType} on ${symbol}`);
            } else if (tradingState.isAutoO5U4Active) {
                symbol = '1HZ75V'; // Volatility 75 for O5U4
                contractType = recommendation.barrier > 5 ? 'DIGITUNDER' : 'DIGITOVER';
                addLog(`🎯 Auto O5U4: ${contractType} on ${symbol}`);
            }

            // Create enhanced trade parameters with bot configuration
            const tradeParams = {
                contract_type: contractType,
                symbol: symbol,
                duration: 1,
                duration_unit: 't',
                amount: botConfig.initialStake,
                basis: 'stake',
                barrier: recommendation.barrier,
                // Martingale configuration
                martingale_enabled: botConfig.selectedStrategy === 'martingale',
                martingale_multiplier: botConfig.martingaleMultiplier,
                max_consecutive_losses: botConfig.maxConsecutiveLosses,
                // Risk management
                stop_loss: botConfig.stopLoss,
                take_profit: botConfig.takeProfit
            };

            addLog(`📋 Trade params: ${JSON.stringify(tradeParams)}`);

            // Use the main trade engine through the bot interface
            if (window.dbot?.interpreter?.bot) {
                const botInterface = window.dbot.interpreter.bot.getInterface();

                // Initialize trade engine with bot configuration
                if (!window.dbot.interpreter.bot.tradeEngine.initArgs) {
                    await botInterface.init(api_base.token, { 
                        symbol: botConfig.symbol,
                        strategy: botConfig.selectedStrategy
                    });
                }

                // Configure martingale settings if enabled
                if (botConfig.selectedStrategy === 'martingale') {
                    botInterface.setMartingaleLimits?.(botConfig.martingaleMultiplier, botConfig.maxConsecutiveLosses);
                    botInterface.setMartingaleEnabled?.(true);
                }

                // Start trading with the parameters
                botInterface.start(tradeParams);

                addLog(`✅ Trade submitted through ${botConfig.selectedStrategy} strategy`);
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeTime: Date.now(),
                    tradeHistory: [...prev.tradeHistory.slice(-19), {
                        time: Date.now(),
                        symbol: tradeParams.symbol,
                        type: recommendation.strategy,
                        barrier: recommendation.barrier,
                        amount: botConfig.initialStake,
                        status: 'submitted',
                        contractId: 'pending',
                        strategy: botConfig.selectedStrategy
                    }]
                }));
            } else {
                // Fallback to direct API execution
                const result = await executeTrade(tradeParams);
                if (result.success) {
                    addLog(`✅ Trade executed successfully: ${result.contract_id}`);
                } else {
                    addLog(`❌ Trade execution failed: ${result.error}`);
                }
            }

        } catch (error) {
            addLog(`❌ Trade execution error: ${error.message}`);
        } finally {
            // Reset trade in progress after delay
            setTimeout(() => {
                setTradingState(prev => ({ 
                    ...prev, 
                    isTradeInProgress: false,
                    currentRecommendation: null
                }));
            }, 2000);
        }
    }, [tradingState.isTradeInProgress, run_panel.is_running, botConfig]);

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

            if (newState) {
                // Start the main run panel if not already running
                if (!run_panel.is_running) {
                    addLog(`🚀 Starting main trading engine...`);
                    // Trigger the main run button
                    run_panel.onRunButtonClick();
                }
            } else {
                // Stop the main run panel if running
                if (run_panel.is_running) {
                    addLog(`⏹️ Stopping main trading engine...`);
                    run_panel.onStopButtonClick();
                }
            }

            return { ...prev, isContinuousTrading: newState };
        });
    }, [addLog, run_panel]);

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

        if (run_panel.is_running) {
            addLog('⚠️ Main trading engine is running, manual trade not available');
            return;
        }

        addLog('🎯 Executing manual trade...');
        await executeAutoTrade(tradingState.currentRecommendation);
    }, [tradingState.currentRecommendation, executeAutoTrade, run_panel.is_running]);

    // Sync with Run Panel state
    useEffect(() => {
        if (run_panel.is_running && !tradingState.isContinuousTrading) {
            setTradingState(prev => ({ ...prev, isContinuousTrading: true }));
            addLog('🔗 Synced with main trading engine - Trading started');
        } else if (!run_panel.is_running && tradingState.isContinuousTrading) {
            setTradingState(prev => ({ ...prev, isContinuousTrading: false }));
            addLog('🔗 Synced with main trading engine - Trading stopped');
        }
    }, [run_panel.is_running, tradingState.isContinuousTrading, addLog]);

    // Listen for bot events
    useEffect(() => {
        const handleBotContractEvent = (data: any) => {
            if (data.buy) {
                addLog(`✅ Contract purchased: ${data.buy.contract_id} at ${data.buy.buy_price}`);
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeTime: Date.now()
                }));
            }
            if (data.is_sold) {
                const profit = parseFloat(data.sell_price || 0) - parseFloat(data.buy_price || 0);
                addLog(`📊 Contract closed: P&L ${profit > 0 ? '+' : ''}${profit.toFixed(2)}`);
                setTradingState(prev => ({
                    ...prev,
                    profit: prev.profit + profit,
                    winTrades: profit > 0 ? prev.winTrades + 1 : prev.winTrades,
                    lossTrades: profit < 0 ? prev.lossTrades + 1 : prev.lossTrades
                }));
            }
        };

        globalObserver.register('bot.contract', handleBotContractEvent);

        return () => {
            globalObserver.unregisterAll('bot.contract');
        };
    }, [addLog]);

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
                            <span className={`status-value ${(tradingState.isTradeInProgress || run_panel.is_running) ? 'trading' : 'idle'}`}>
                                {(tradingState.isTradeInProgress || run_panel.is_running) ? '🔄 Trading' : '💤 Idle'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">Engine State:</span>
                            <span className={`status-value ${run_panel.is_running ? 'connected' : 'disconnected'}`}>
                                {run_panel.is_running ? '🟢 Running' : '🔴 Stopped'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="bot-configuration-section">
                    <h3>⚙️ Auto Trading Configuration</h3>
                    <div className="config-grid">
                        <div className="config-group">
                            <label>Strategy:</label>
                            <select 
                                value={botConfig.selectedStrategy} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, selectedStrategy: e.target.value};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                    addLog(`🔄 Strategy changed to: ${e.target.value.toUpperCase()}`);
                                }}
                                disabled={tradingState.isContinuousTrading}
                            >
                                <option value="martingale">Martingale</option>
                                <option value="dalembert">D'Alembert</option>
                                <option value="oscars_grind">Oscar's Grind</option>
                                <option value="reverse_martingale">Reverse Martingale</option>
                            </select>
                        </div>
                        <div className="config-group">
                            <label>Initial Stake ($):</label>
                            <input 
                                type="number" 
                                value={botConfig.initialStake} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, initialStake: parseFloat(e.target.value) || 1};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="0.35" 
                                step="0.01"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Martingale Multiplier:</label>
                            <input 
                                type="number" 
                                value={botConfig.martingaleMultiplier} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, martingaleMultiplier: parseFloat(e.target.value) || 2};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1.1" 
                                step="0.1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Max Consecutive Losses:</label>
                            <input 
                                type="number" 
                                value={botConfig.maxConsecutiveLosses} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, maxConsecutiveLosses: parseInt(e.target.value) || 5};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1" 
                                step="1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Stop Loss ($):</label>
                            <input 
                                type="number" 
                                value={botConfig.stopLoss} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, stopLoss: parseFloat(e.target.value) || 50};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1" 
                                step="1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Take Profit ($):</label>
                            <input 
                                type="number" 
                                value={botConfig.takeProfit} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, takeProfit: parseFloat(e.target.value) || 100};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1" 
                                step="1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                    </div>
                    <div className="config-info">
                        <p>📍 Symbol & Contract Type are automatically selected based on active trading strategy</p>
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
                            className={`control-btn ${(tradingState.isContinuousTrading || run_panel.is_running) ? 'stop-btn' : 'start-btn'}`}
                            onClick={toggleContinuousTrading}
                            disabled={tradingState.isTradeInProgress || run_panel.is_stop_button_disabled}
                        >
                            {(tradingState.isContinuousTrading || run_panel.is_running) ? '⏹️ Stop Trading' : '▶️ Start Trading'}
                        </button>

                        <button
                            className="control-btn manual-btn"
                            onClick={executeManualTrade}
                            disabled={tradingState.isTradeInProgress || !tradingState.currentRecommendation || run_panel.is_running}
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

                <div className="trading-summary-section">
                    <h3>📊 Trading Summary</h3>
                    <div className="summary-grid">
                        <div className="summary-item">
                            <span className="summary-label">Strategy:</span>
                            <span className="summary-value">{botConfig.selectedStrategy.toUpperCase()}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Total Trades:</span>
                            <span className="summary-value">{tradingState.totalTrades}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Win Rate:</span>
                            <span className="summary-value">
                                {tradingState.totalTrades > 0 ? 
                                    ((tradingState.winTrades / tradingState.totalTrades) * 100).toFixed(1) : 0}%
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Total P&L:</span>
                            <span className={`summary-value ${tradingState.profit >= 0 ? 'profit' : 'loss'}`}>
                                ${tradingState.profit.toFixed(2)}
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Current Stake:</span>
                            <span className="summary-value">${botConfig.initialStake}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Stop Loss:</span>
                            <span className="summary-value">${botConfig.stopLoss}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Take Profit:</span>
                            <span className="summary-value">${botConfig.takeProfit}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Auto Symbol:</span>
                            <span className="summary-value">
                                {tradingState.isAutoOverUnderActive ? '1HZ25V' : 
                                 tradingState.isAutoDifferActive ? '1HZ50V' : 
                                 tradingState.isAutoO5U4Active ? '1HZ75V' : '1HZ10V'}
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Auto Contract:</span>
                            <span className="summary-value">
                                {tradingState.isAutoOverUnderActive ? 'Over/Under' : 
                                 tradingState.isAutoDifferActive ? 'Even/Odd' : 
                                 tradingState.isAutoO5U4Active ? 'O5U4' : 'Strategy-Based'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="trade-history-section">
                    <h3>📋 Recent Trades</h3>
                    <div className="trade-history-container">
                        {tradingState.tradeHistory.length > 0 ? (
                            <table className="trade-history-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Symbol</th>
                                        <th>Type</th>
                                        <th>Amount</th>
                                        <th>Strategy</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tradingState.tradeHistory.slice(-10).reverse().map((trade, index) => (
                                        <tr key={index}>
                                            <td>{new Date(trade.time).toLocaleTimeString()}</td>
                                            <td>{trade.symbol}</td>
                                            <td>{trade.type}</td>
                                            <td>${trade.amount}</td>
                                            <td>{trade.strategy || 'manual'}</td>
                                            <td className={`status-${trade.status}`}>{trade.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="no-trades">No trades executed yet</div>
                        )}
                    </div>
                </div>


            </div>
        </div>
    );
});

export default TradingHubDisplay;