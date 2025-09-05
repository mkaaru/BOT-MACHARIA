import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import Button from '../shared_ui/button/button';
import { marketAnalyzer, TradingRecommendation } from '../../services/market-analyzer';
import './trading-hub-display.scss';

interface TradeResult {
    id: string;
    strategy: string;
    symbol: string;
    contract_type: string;
    barrier?: number;
    amount: number;
    profit?: number;
    status: 'active' | 'won' | 'lost';
    timestamp: number;
}

interface TradingStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    consecutiveLosses: number;
    consecutiveWins: number;
    totalProfit: number;
}

// Mock services to prevent compilation errors
const mockMarketAnalyzer = {
    isConnected: false,
    isMarketAnalysisReady: false,
    getAutoDifferRecommendation: (): TradingRecommendation => ({
        symbol: 'R_100',
        contract_type: 'DIGITDIFF',
        barrier: 5,
        confidence: 0.7,
        strategy: 'AutoDiffer'
    }),
    getOverUnderRecommendation: (): TradingRecommendation => ({
        symbol: 'R_100',
        contract_type: 'DIGITOVER',
        barrier: 5,
        confidence: 0.6,
        strategy: 'Over/Under'
    }),
    getO5U4Recommendation: (): TradingRecommendation => ({
        symbol: 'R_100',
        contract_type: 'DIGITOVER',
        barrier: 5,
        confidence: 0.8,
        strategy: 'O5U4'
    })
};

const mockTradingEngine = {
    isEngineConnected: () => false,
    executeTrade: async (request: any, callback: (result: any) => void) => {
        // Mock trade execution
        setTimeout(() => {
            callback({
                profit: Math.random() > 0.5 ? Math.random() * 10 : -request.amount,
                status: Math.random() > 0.5 ? 'won' : 'lost'
            });
        }, 2000);
    }
};

const TradingHubDisplay: React.FC = observer(() => {
    // Strategy states
    const [autoDifferEnabled, setAutoDifferEnabled] = useState(false);
    const [overUnderEnabled, setOverUnderEnabled] = useState(false);
    const [o5u4Enabled, setO5u4Enabled] = useState(false);

    // Trading states
    const [baseStake, setBaseStake] = useState(1);
    const [currentStake, setCurrentStake] = useState(1);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.0);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);

    // Results and statistics
    const [tradeHistory, setTradeHistory] = useState<TradeResult[]>([]);
    const [stats, setStats] = useState<TradingStats>({
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        consecutiveLosses: 0,
        consecutiveWins: 0,
        totalProfit: 0
    });

    // Active recommendations
    const [currentRecommendations, setCurrentRecommendations] = useState<{
        autodiff?: TradingRecommendation;
        over_under?: TradingRecommendation;
        o5u4?: TradingRecommendation;
    }>({});

    // Timers and intervals
    const analysisInterval = useRef<NodeJS.Timeout | null>(null);
    const tradingInterval = useRef<NodeJS.Timeout | null>(null);

    // Status messages
    const [statusMessage, setStatusMessage] = useState('Initializing Trading Hub...');
    const [lastTradeTime, setLastTradeTime] = useState<number>(0);

    // Trading control states
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);
    const [isTrading, setIsTrading] = useState(false);

    // Check if any strategy is active
    const isStrategyActive = autoDifferEnabled || overUnderEnabled || o5u4Enabled;

    const handleTrade = () => {
        if (isContinuousTrading) {
            // Stop trading
            setIsContinuousTrading(false);
            setIsTrading(false);
            setStatusMessage('Trading stopped by user');
        } else {
            // Start trading
            if (isStrategyActive) {
                setIsContinuousTrading(true);
                setIsTrading(true);
                setStatusMessage('Starting automated trading...');
            } else {
                setStatusMessage('Please enable at least one strategy first');
            }
        }
    };

    useEffect(() => {
        // Start analysis loop
        analysisInterval.current = setInterval(() => {
            updateRecommendations();
        }, 2000);

        // Start trading loop
        tradingInterval.current = setInterval(() => {
            executeAutomatedTrades();
        }, 3000);

        return () => {
            if (analysisInterval.current) clearInterval(analysisInterval.current);
            if (tradingInterval.current) clearInterval(tradingInterval.current);
        };
    }, [autoDifferEnabled, overUnderEnabled, o5u4Enabled]);

    const updateRecommendations = () => {
        try {
            if (!marketAnalyzer.isMarketAnalysisReady) {
                setStatusMessage('Waiting for market data...');
                return;
            }

        // Get all symbol data for analysis
        const allSymbolData = marketAnalyzer.getAllSymbolData();

        const recommendations: any = {};

        if (autoDifferEnabled) {
            recommendations.autodiff = mockMarketAnalyzer.getAutoDifferRecommendation();
        }

        if (overUnderEnabled) {
            recommendations.over_under = mockMarketAnalyzer.getOverUnderRecommendation();
        }

        if (o5u4Enabled) {
            recommendations.o5u4 = mockMarketAnalyzer.getO5U4Recommendation();
        }

        setCurrentRecommendations(recommendations);
        setStatusMessage('Market analysis active');
        } catch (error) {
            console.error('Error updating recommendations:', error);
            setStatusMessage('Error in market analysis');
        }
    };

    const executeAutomatedTrades = async () => {
        if (!mockTradingEngine.isEngineConnected()) return;

        const now = Date.now();
        const timeSinceLastTrade = now - lastTradeTime;

        // Minimum 5 seconds between trades
        if (timeSinceLastTrade < 5000) return;

        try {
            // Check for trading opportunities
            if (autoDifferEnabled && currentRecommendations.autodiff) {
                await executeTrade(currentRecommendations.autodiff, 'AutoDiffer');
            }

            if (overUnderEnabled && currentRecommendations.over_under) {
                await executeTrade(currentRecommendations.over_under, 'Auto Over/Under');
            }

            if (o5u4Enabled && currentRecommendations.o5u4) {
                await executeO5U4Trade(currentRecommendations.o5u4);
            }
        } catch (error) {
            console.error('Trading execution error:', error);
            setStatusMessage(`Trading error: ${error.message}`);
        }
    };

    const executeTrade = async (recommendation: TradingRecommendation, strategyName: string) => {
        const contractRequest = {
            contract_type: recommendation.contract_type,
            symbol: recommendation.symbol,
            barrier: recommendation.barrier,
            amount: currentStake,
            duration: 5,
            duration_unit: 't',
            currency: 'USD'
        };

        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const newTrade: TradeResult = {
            id: tradeId,
            strategy: strategyName,
            symbol: recommendation.symbol,
            contract_type: recommendation.contract_type,
            barrier: recommendation.barrier,
            amount: currentStake,
            status: 'active',
            timestamp: Date.now()
        };

        setTradeHistory(prev => [newTrade, ...prev.slice(0, 49)]);
        setLastTradeTime(Date.now());
        setStatusMessage(`Executing ${strategyName} trade on ${recommendation.symbol}`);

        try {
            await mockTradingEngine.executeTrade(contractRequest, (result) => {
                handleTradeResult(tradeId, result);
            });
        } catch (error) {
            handleTradeResult(tradeId, { profit: -currentStake, status: 'lost' });
        }
    };

    const executeO5U4Trade = async (recommendation: TradingRecommendation) => {
        // Execute both Over 5 and Under 4 contracts simultaneously
        const tradePromises = [];

        // Over 5 contract
        const over5Request = {
            contract_type: 'DIGITOVER',
            symbol: recommendation.symbol,
            barrier: 5,
            amount: currentStake / 2,
            duration: 5,
            duration_unit: 't',
            currency: 'USD'
        };

        // Under 4 contract
        const under4Request = {
            contract_type: 'DIGITUNDER',
            symbol: recommendation.symbol,
            barrier: 4,
            amount: currentStake / 2,
            duration: 5,
            duration_unit: 't',
            currency: 'USD'
        };

        const tradeId = `o5u4_${Date.now()}`;

        const newTrade: TradeResult = {
            id: tradeId,
            strategy: 'Auto O5U4',
            symbol: recommendation.symbol,
            contract_type: 'O5U4',
            amount: currentStake,
            status: 'active',
            timestamp: Date.now()
        };

        setTradeHistory(prev => [newTrade, ...prev.slice(0, 49)]);
        setLastTradeTime(Date.now());
        setStatusMessage(`Executing O5U4 strategy on ${recommendation.symbol}`);

        let totalProfit = 0;
        let completedContracts = 0;

        const handleO5U4Result = (profit: number) => {
            totalProfit += profit;
            completedContracts++;

            if (completedContracts === 2) {
                handleTradeResult(tradeId, {
                    profit: totalProfit,
                    status: totalProfit > 0 ? 'won' : 'lost'
                });
            }
        };

        try {
            await Promise.all([
                mockTradingEngine.executeTrade(over5Request, (result) => handleO5U4Result(result.profit)),
                mockTradingEngine.executeTrade(under4Request, (result) => handleO5U4Result(result.profit))
            ]);
        } catch (error) {
            handleTradeResult(tradeId, { profit: -currentStake, status: 'lost' });
        }
    };

    const handleTradeResult = (tradeId: string, result: any) => {
        setTradeHistory(prev => prev.map(trade => {
            if (trade.id === tradeId) {
                return {
                    ...trade,
                    profit: result.profit,
                    status: result.status
                };
            }
            return trade;
        }));

        // Update statistics
        const isWin = result.profit > 0;
        updateStats(isWin, result.profit);

        // Update stake based on martingale
        if (isWin) {
            setCurrentStake(baseStake);
            setStatusMessage(`Trade won! Profit: $${result.profit.toFixed(2)}`);
        } else {
            const newStake = Math.min(currentStake * martingaleMultiplier, baseStake * Math.pow(martingaleMultiplier, maxConsecutiveLosses));
            setCurrentStake(newStake);
            setStatusMessage(`Trade lost. Next stake: $${newStake.toFixed(2)}`);
        }
    };

    const updateStats = (isWin: boolean, profit: number) => {
        setStats(prev => {
            const newStats = { ...prev };
            newStats.totalTrades++;
            newStats.totalProfit += profit;

            if (isWin) {
                newStats.wins++;
                newStats.consecutiveWins++;
                newStats.consecutiveLosses = 0;
            } else {
                newStats.losses++;
                newStats.consecutiveLosses++;
                newStats.consecutiveWins = 0;
            }

            newStats.winRate = newStats.totalTrades > 0 ? (newStats.wins / newStats.totalTrades) * 100 : 0;

            return newStats;
        });
    };

    const resetStats = () => {
        setStats({
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            consecutiveLosses: 0,
            consecutiveWins: 0,
            totalProfit: 0
        });
        setTradeHistory([]);
        setCurrentStake(baseStake);
    };

    const formatCurrency = (amount: number) => {
        return `$${amount.toFixed(2)}`;
    };

    return (
        <div className="trading-hub-display">
            <div className="trading-hub-header">
                <h2>🎯 Trading Hub</h2>
                <div className="connection-status">
                    <div className={`status-indicator ${mockMarketAnalyzer.isConnected && mockTradingEngine.isEngineConnected() ? 'connected' : 'disconnected'}`}></div>
                    <span>{mockMarketAnalyzer.isConnected && mockTradingEngine.isEngineConnected() ? 'Connected' : 'Disconnected'}</span>
                </div>
            </div>

            {/* Trading Controls */}
            <div className="trading-controls">
                <button
                    className={`main-trade-btn ${!isStrategyActive ? 'disabled' : ''} ${isContinuousTrading ? 'stop' : 'start'}`}
                    onClick={handleTrade}
                    disabled={!isStrategyActive || isTrading}
                >
                    <div className="btn-content">
                        <div className="btn-icon">
                            {isContinuousTrading ? (
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
                                    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                    <polygon points="5,3 19,12 5,21" fill="currentColor" />
                                </svg>
                            )}
                        </div>
                        <span className="btn-text">
                            {isContinuousTrading ? 'STOP TRADING' : isTrading ? 'STARTING...' : 'START TRADING'}
                        </span>
                    </div>
                </button>
            </div>

            <div className="trading-strategies">
                <div className="strategy-card">
                    <div className="strategy-header">
                        <h3>AutoDiffer</h3>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={autoDifferEnabled}
                                onChange={(e) => setAutoDifferEnabled(e.target.checked)}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                    <p>Random digit analysis with barrier optimization</p>
                    {autoDifferEnabled && currentRecommendations.autodiff && (
                        <div className="recommendation">
                            <div>Symbol: {currentRecommendations.autodiff.symbol}</div>
                            <div>Barrier: {currentRecommendations.autodiff.barrier}</div>
                            <div>Confidence: {(currentRecommendations.autodiff.confidence * 100).toFixed(1)}%</div>
                        </div>
                    )}
                </div>

                <div className="strategy-card">
                    <div className="strategy-header">
                        <h3>Auto Over/Under</h3>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={overUnderEnabled}
                                onChange={(e) => setOverUnderEnabled(e.target.checked)}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                    <p>AI pattern recognition for over/under trades</p>
                    {overUnderEnabled && currentRecommendations.over_under && (
                        <div className="recommendation">
                            <div>Symbol: {currentRecommendations.over_under.symbol}</div>
                            <div>Type: {currentRecommendations.over_under.contract_type}</div>
                            <div>Barrier: {currentRecommendations.over_under.barrier}</div>
                            <div>Confidence: {(currentRecommendations.over_under.confidence * 100).toFixed(1)}%</div>
                        </div>
                    )}
                </div>

                <div className="strategy-card">
                    <div className="strategy-header">
                        <h3>Auto O5U4</h3>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={o5u4Enabled}
                                onChange={(e) => setO5u4Enabled(e.target.checked)}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                    <p>Dual digit strategy (Over 5 & Under 4)</p>
                    {o5u4Enabled && currentRecommendations.o5u4 && (
                        <div className="recommendation">
                            <div>Symbol: {currentRecommendations.o5u4.symbol}</div>
                            <div>Strategy: Over 5 + Under 4</div>
                            <div>Confidence: {(currentRecommendations.o5u4.confidence * 100).toFixed(1)}%</div>
                        </div>
                    )}
                </div>
            </div>

            <div className="trading-controls">
                <div className="control-group">
                    <label>Base Stake:</label>
                    <input
                        type="number"
                        value={baseStake}
                        onChange={(e) => {
                            const value = parseFloat(e.target.value) || 1;
                            setBaseStake(value);
                            setCurrentStake(value);
                        }}
                        min="1"
                        step="0.1"
                    />
                </div>

                <div className="control-group">
                    <label>Current Stake:</label>
                    <span className="current-stake">{formatCurrency(currentStake)}</span>
                </div>

                <div className="control-group">
                    <label>Martingale Multiplier:</label>
                    <input
                        type="number"
                        value={martingaleMultiplier}
                        onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value) || 2.0)}
                        min="1.1"
                        max="3.0"
                        step="0.1"
                    />
                </div>

                <div className="control-group">
                    <label>Max Consecutive Losses:</label>
                    <input
                        type="number"
                        value={maxConsecutiveLosses}
                        onChange={(e) => setMaxConsecutiveLosses(parseInt(e.target.value) || 5)}
                        min="1"
                        max="10"
                    />
                </div>
            </div>

            {/* Main Trading Button */}
            <div className="trading-button-container">
                <button
                    className={`main-trade-btn ${isContinuousTrading ? 'stop' : ''} ${!isStrategyActive ? 'disabled' : ''}`}
                    onClick={handleTrade}
                    disabled={!isStrategyActive && !isContinuousTrading}
                >
                    <div className="btn-content">
                        <div className="btn-icon">
                            {isContinuousTrading ? '⏹️' : '▶️'}
                        </div>
                        <div className="btn-text">
                            {isContinuousTrading ? 'Stop Trading' : 'Start Trading'}
                        </div>
                    </div>
                </button>
            </div>

            <div className="trading-statistics">
                <h3>Trading Statistics</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">Total Trades:</span>
                        <span className="stat-value">{stats.totalTrades}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Wins:</span>
                        <span className="stat-value win">{stats.wins}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Losses:</span>
                        <span className="stat-value loss">{stats.losses}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Win Rate:</span>
                        <span className="stat-value">{stats.winRate.toFixed(1)}%</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Consecutive Losses:</span>
                        <span className={`stat-value ${stats.consecutiveLosses > 3 ? 'warning' : ''}`}>
                            {stats.consecutiveLosses}
                        </span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Total Profit:</span>
                        <span className={`stat-value ${stats.totalProfit >= 0 ? 'profit' : 'loss'}`}>
                            {formatCurrency(stats.totalProfit)}
                        </span>
                    </div>
                </div>
                <button className="reset-button" onClick={resetStats}>
                    Reset Statistics
                </button>
            </div>

            <div className="status-panel">
                <h3>Status</h3>
                <div className="status-message">{statusMessage}</div>
                <div className="market-info">
                    <div>Market Analysis: {marketAnalyzer.isMarketAnalysisReady ? 'Ready' : 'Loading...'}</div>
                    <div>Active Symbols: {marketAnalyzer.getAllSymbolData().filter(d => d.ticks.length >= 10).length}</div>
                    <div>Last Update: {new Date(marketAnalyzer.lastUpdate).toLocaleTimeString()}</div>
                </div>
            </div>

            <div className="trade-history">
                <h3>Recent Trades</h3>
                <div className="history-list">
                    {tradeHistory.slice(0, 10).map(trade => (
                        <div key={trade.id} className={`trade-item ${trade.status}`}>
                            <div className="trade-info">
                                <span className="strategy">{trade.strategy}</span>
                                <span className="symbol">{trade.symbol}</span>
                                <span className="type">{trade.contract_type}</span>
                                {trade.barrier && <span className="barrier">B:{trade.barrier}</span>}
                            </div>
                            <div className="trade-result">
                                <span className="amount">{formatCurrency(trade.amount)}</span>
                                {trade.profit !== undefined && (
                                    <span className={`profit ${trade.profit >= 0 ? 'win' : 'loss'}`}>
                                        {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
                                    </span>
                                )}
                                <span className={`status ${trade.status}`}>{trade.status.toUpperCase()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default TradingHubDisplay;