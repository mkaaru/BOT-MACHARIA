import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signalIntegrationService, TradingSignal } from '../../services/signal-integration';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import marketAnalyzer from '../../services/market-analyzer';
import type { TradeRecommendation } from '@/services/market-analyzer';
import getBotInterface from '@/external/bot-skeleton/services/tradeEngine/Interface/BotInterface';
import TradeEngine from '@/external/bot-skeleton/services/tradeEngine/trade';
import { globalObserver } from '@/utils/tmp/dummy';
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
    const [marketStats, setMarketStats] = useState({});
    const isAnalysisReady = analyzerReady;
    
    // Bot Engine setup
    const [tradeEngine, setTradeEngine] = useState<any>(null);
    const [botInterface, setBotInterface] = useState<any>(null);
    const [botReady, setBotReady] = useState(false);

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-49), logMessage]);
    }, []);

    const scrollToBottom = useCallback(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(scrollToBottom, [logs]);

    // Bot Engine trade execution
    const executeBotTrade = useCallback(async (config: TradeConfig) => {
        if (!botInterface || !botReady) {
            addLog('❌ Bot engine not ready');
            return { success: false, error: 'Bot engine not ready' };
        }

        try {
            setTradingState(prev => ({ ...prev, isTradeInProgress: true }));
            addLog(`🚀 Executing ${config.contract_type} on ${config.symbol} via Bot Engine`);

            // Initialize bot with trade options
            await botInterface.init({
                symbol: config.symbol,
                contract_type: config.contract_type,
                amount: config.amount,
                duration: config.duration,
                duration_unit: config.duration_unit,
                ...(config.barrier && { barrier: config.barrier })
            });

            // Start the trade
            const result = await botInterface.start({
                limitations: {},
                duration: config.duration,
                duration_unit: config.duration_unit,
                currency: 'USD',
                amount: config.amount,
                basis: 'stake'
            });

            // Purchase the contract
            const purchaseResult = await botInterface.purchase(config.contract_type);
            
            if (purchaseResult) {
                addLog(`✅ Trade executed via Bot Engine`);
                addLog(`💰 Ask Price: $${botInterface.getAskPrice(config.contract_type)}`);
                addLog(`🎯 Payout: $${botInterface.getPayout(config.contract_type)}`);
                
                return {
                    success: true,
                    contract_id: botInterface.getPurchaseReference(),
                    buy_price: botInterface.getAskPrice(config.contract_type)
                };
            } else {
                addLog('❌ Trade execution failed');
                return { success: false, error: 'Purchase failed' };
            }

        } catch (error) {
            addLog(`💥 Bot trade execution failed: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            setTimeout(() => {
                setTradingState(prev => ({ ...prev, isTradeInProgress: false }));
            }, 2000);
        }
    }, [botInterface, botReady, addLog]);

    const getTradeConfig = useCallback((strategy: string): TradeConfig => {
        const baseConfig = {
            amount: tradingState.currentStake,
            duration: 1,
            duration_unit: 't'
        };

        // For OVERUNDER strategy, use market analyzer recommendation
        if (strategy === 'overunder' && currentRecommendation) {
            return {
                ...baseConfig,
                symbol: currentRecommendation.symbol,
                contract_type: currentRecommendation.strategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
                barrier: currentRecommendation.barrier
            };
        }

        // Use active signal if available and matches strategy
        if (activeSignal && activeSignal.strategy === strategy) {
            const symbolMap: Record<string, string> = {
                'RDBULL': 'R_75',
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

        // Fallback to first available recommendation
        if (currentRecommendation) {
            return {
                ...baseConfig,
                symbol: currentRecommendation.symbol,
                contract_type: currentRecommendation.strategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
                barrier: currentRecommendation.barrier
            };
        }

        return {
            ...baseConfig,
            symbol: '1HZ25V',
            contract_type: 'DIGITEVEN'
        };
    }, [tradingState.currentStake, activeSignal, currentRecommendation]);

    const executeTrade = useCallback(async () => {
        if (tradingState.isTradeInProgress) {
            addLog('⏳ Trade already in progress');
            return;
        }

        // For OVERUNDER strategy, check market analyzer recommendation
        if (tradingState.selectedStrategy === 'overunder') {
            if (!currentRecommendation) {
                addLog(`❌ No market recommendation for ${tradingState.selectedStrategy.toUpperCase()} strategy`);
                addLog('💡 Waiting for market analysis...');
                return;
            }

            const config = getTradeConfig(tradingState.selectedStrategy);
            addLog(`🎯 Strategy: ${tradingState.selectedStrategy.toUpperCase()}`);
            addLog(`🚀 Executing ${config.contract_type} on ${config.symbol}`);
            addLog(`📊 Recommendation: ${currentRecommendation.reason}`);

            const result = await executeBotTrade(config);

            if (result.success) {
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeResult: 'Executed'
                }));
                addLog('✅ Trade executed successfully');
            }
            return;
        }

        // For other strategies, check active signal
        if (!activeSignal || activeSignal.strategy !== tradingState.selectedStrategy) {
            addLog(`❌ No active signal for ${tradingState.selectedStrategy.toUpperCase()} strategy`);
            addLog('💡 Waiting for signal recommendation...');
            return;
        }

        const config = getTradeConfig(tradingState.selectedStrategy);
        addLog(`🎯 Strategy: ${tradingState.selectedStrategy.toUpperCase()}`);
        addLog(`📊 Using signal: ${activeSignal.action} ${activeSignal.barrier || ''} on ${activeSignal.symbol}`);
        addLog(`💪 Confidence: ${activeSignal.confidence}%`);

        const result = await executeBotTrade(config);

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
    }, [tradingState.selectedStrategy, tradingState.isTradeInProgress, activeSignal, currentRecommendation, executeDirectTrade, getTradeConfig, addLog]);

    const toggleTrading = useCallback(() => {
        setTradingState(prev => {
            const newRunning = !prev.isRunning;
            addLog(`Trading ${newRunning ? 'STARTED' : 'STOPPED'}`);
            return { ...prev, isRunning: newRunning };
        });
    }, [addLog]);

    // Auto-trading logic - execute trades at intervals when running
    useEffect(() => {
        let tradingInterval: NodeJS.Timeout;

        if (tradingState.isRunning && analyzerReady && botReady) {
            tradingInterval = setInterval(() => {
                if (!tradingState.isTradeInProgress) {
                    executeTrade();
                }
            }, 8000); // Execute every 8 seconds like before
        }

        return () => {
            if (tradingInterval) {
                clearInterval(tradingInterval);
            }
        };
    }, [tradingState.isRunning, tradingState.isTradeInProgress, analyzerReady, botReady, executeTrade]);

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

    // Initialize Bot Engine
    useEffect(() => {
        const initializeBotEngine = async () => {
            try {
                addLog('🔄 Bot Engine initializing...');
                
                // Create trade engine instance
                const engine = new TradeEngine();
                const interface = getBotInterface(engine);
                
                setTradeEngine(engine);
                setBotInterface(interface);
                setBotReady(true);
                
                addLog('✅ Bot Engine ready');
            } catch (error) {
                console.error('Bot engine initialization error:', error);
                addLog(`❌ Bot Engine failed to initialize: ${error.message}`);
            }
        };

        initializeBotEngine();
    }, [addLog]);

    // Initialize Market Analyzer - Real integration
    useEffect(() => {
        const initializeAnalyzer = async () => {
            setAnalyzerReady(false);
            addLog('🔄 Market Analyzer initializing...');
            
            try {
                // Start the real market analyzer
                marketAnalyzer.start();
                
                // Subscribe to recommendations
                const unsubscribe = marketAnalyzer.onAnalysis((recommendation, allStats) => {
                    setCurrentRecommendation(recommendation);
                    setMarketStats(allStats);
                    
                    if (recommendation) {
                        addLog(`📊 New recommendation: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${recommendation.symbol}`);
                        addLog(`💡 Reason: ${recommendation.reason}`);
                    }
                });

                // Wait for analyzer to be ready
                await marketAnalyzer.waitForAnalysisReady();
                setAnalyzerReady(true);
                addLog('✅ Market Analyzer ready');
                
                return unsubscribe;
            } catch (error) {
                console.error('Market analyzer initialization error:', error);
                addLog(`❌ Market Analyzer failed to initialize: ${error.message}`);
            }
        };

        const cleanup = initializeAnalyzer();

        return () => {
            cleanup?.then(unsubscribe => unsubscribe?.());
            marketAnalyzer.stop();
        };
    }, [addLog]);

    // Listen for bot contract events
    useEffect(() => {
        const handleTradeComplete = (data: any) => {
            if (data && data.contract) {
                const contract = data.contract;
                const profit = parseFloat(contract.profit || 0);
                const isWin = profit > 0;
                
                setTradingState(prev => ({
                    ...prev,
                    winTrades: prev.winTrades + (isWin ? 1 : 0),
                    lossTrades: prev.lossTrades + (isWin ? 0 : 1),
                    totalProfit: prev.totalProfit + profit,
                    lastTradeResult: isWin ? 'Win' : 'Loss'
                }));
                
                addLog(`${isWin ? '🎉' : '💔'} Trade ${isWin ? 'Won' : 'Lost'}: ${profit > 0 ? '+' : ''}$${profit.toFixed(2)}`);
            }
        };

        const handleError = (data: any) => {
            console.error('❌ Bot engine error:', data);
            if (data && data.error) {
                addLog(`❌ Bot error: ${data.error.message}`);
            }
        };

        if (globalObserver) {
            globalObserver.register('bot.contract', handleTradeComplete);
            globalObserver.register('bot.error', handleError);

            return () => {
                globalObserver.unregister('bot.contract', handleTradeComplete);
                globalObserver.unregister('bot.error', handleError);
            };
        }
    }, [addLog]);

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
                        <div className={`status-indicator ${botReady ? 'ready' : 'loading'}`}>
                            <span className="status-dot"></span>
                            Bot Engine: {botReady ? 'Ready' : 'Initializing...'}
                        </div>
                        {(!analyzerReady || !botReady) && (
                            <div className="initialization-details">
                                <small>Connecting to market data streams and bot engine...</small>
                                <div className="loading-progress">
                                    <div className="progress-bar"></div>
                                </div>
                            </div>
                        )}
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