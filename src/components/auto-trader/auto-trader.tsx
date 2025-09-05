
import React, { useState, useRef, useEffect } from 'react';
import './auto-trader.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import marketAnalyzer, { TradeRecommendation } from '../../services/market-analyzer';

const MINIMUM_STAKE = 0.35;

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

const AutoTrader: React.FC = () => {
    const { is_dark_mode_on } = useThemeSwitcher();
    const store = useStore();

    // Strategy states
    const [autoDifferEnabled, setAutoDifferEnabled] = useState(false);
    const [overUnderEnabled, setOverUnderEnabled] = useState(false);
    const [o5u4Enabled, setO5u4Enabled] = useState(false);

    // Trading states
    const [baseStake, setBaseStake] = useState(MINIMUM_STAKE);
    const [currentStake, setCurrentStake] = useState(MINIMUM_STAKE);
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
        autodiff?: TradeRecommendation;
        over_under?: TradeRecommendation;
        o5u4?: TradeRecommendation;
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
        // Initialize market analyzer
        marketAnalyzer.connect();

        return () => {
            marketAnalyzer.disconnect();
        };
    }, []);

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
    }, [autoDifferEnabled, overUnderEnabled, o5u4Enabled, isContinuousTrading]);

    const updateRecommendations = () => {
        try {
            if (!marketAnalyzer.isMarketAnalysisReady) {
                setStatusMessage('Waiting for market data...');
                return;
            }

            const recommendations: any = {};

            if (autoDifferEnabled) {
                recommendations.autodiff = marketAnalyzer.getAutoDifferRecommendation();
            }

            if (overUnderEnabled) {
                recommendations.over_under = marketAnalyzer.getOverUnderRecommendation();
            }

            if (o5u4Enabled) {
                recommendations.o5u4 = marketAnalyzer.getO5U4Recommendation();
            }

            setCurrentRecommendations(recommendations);
            setStatusMessage('Market analysis active');
        } catch (error) {
            console.error('Error updating recommendations:', error);
            setStatusMessage('Error in market analysis');
        }
    };

    const executeAutomatedTrades = async () => {
        if (!isContinuousTrading) {
            return;
        }

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

    const executeTrade = async (recommendation: TradeRecommendation, strategyName: string) => {
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

        // Simulate trade execution
        setTimeout(() => {
            const profit = Math.random() > 0.5 ? currentStake * 0.9 : -currentStake;
            handleTradeResult(tradeId, { profit, status: profit > 0 ? 'won' : 'lost' });
        }, 2000);
    };

    const executeO5U4Trade = async (recommendation: TradeRecommendation) => {
        // Execute both Over 5 and Under 4 contracts simultaneously
        await executeTrade({
            ...recommendation,
            contract_type: 'DIGITOVER',
            barrier: 5
        }, 'O5U4 Over');

        await executeTrade({
            ...recommendation,
            contract_type: 'DIGITUNDER',
            barrier: 4
        }, 'O5U4 Under');
    };

    const handleTradeResult = (tradeId: string, result: any) => {
        setTradeHistory(prev => 
            prev.map(trade => 
                trade.id === tradeId 
                    ? { ...trade, profit: result.profit, status: result.status }
                    : trade
            )
        );

        // Update statistics
        setStats(prevStats => {
            const newStats = { ...prevStats };
            newStats.totalTrades += 1;
            newStats.totalProfit += result.profit;

            if (result.status === 'won') {
                newStats.wins += 1;
                newStats.consecutiveWins += 1;
                newStats.consecutiveLosses = 0;
                setCurrentStake(baseStake); // Reset to base stake after win
            } else {
                newStats.losses += 1;
                newStats.consecutiveLosses += 1;
                newStats.consecutiveWins = 0;

                // Apply martingale
                if (newStats.consecutiveLosses < maxConsecutiveLosses) {
                    setCurrentStake(prev => prev * martingaleMultiplier);
                } else {
                    setCurrentStake(baseStake); // Reset after max losses
                }
            }

            newStats.winRate = newStats.totalTrades > 0 ? (newStats.wins / newStats.totalTrades) * 100 : 0;
            return newStats;
        });
    };

    const formatCurrency = (amount: number) => {
        return `$${amount.toFixed(2)}`;
    };

    const isConnected = marketAnalyzer.isConnected;

    return (
        <div className={`auto-trader ${is_dark_mode_on ? 'theme--dark' : 'theme--light'}`}>
            <div className="auto-trader__header">
                <h2>🎯 Trading Hub</h2>
                <div className="connection-status">
                    <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></div>
                    <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
            </div>

            <div className="auto-trader__content">
                <div className="strategies-section">
                    <h3>Trading Strategies</h3>
                    
                    <div className="strategy-card">
                        <div className="strategy-header">
                            <h4>🎲 AutoDiffer</h4>
                            <label className="toggle-switch">
                                <input 
                                    type="checkbox" 
                                    checked={autoDifferEnabled}
                                    onChange={(e) => setAutoDifferEnabled(e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                        <p>Automatically analyzes random barriers and symbols for optimal digit differ trades.</p>
                        {currentRecommendations.autodiff && (
                            <div className="recommendation">
                                <span>Symbol: {currentRecommendations.autodiff.symbol}</span>
                                <span>Barrier: {currentRecommendations.autodiff.barrier}</span>
                                <span>Confidence: {(currentRecommendations.autodiff.confidence * 100).toFixed(1)}%</span>
                            </div>
                        )}
                    </div>

                    <div className="strategy-card">
                        <div className="strategy-header">
                            <h4>📊 Auto Over/Under</h4>
                            <label className="toggle-switch">
                                <input 
                                    type="checkbox" 
                                    checked={overUnderEnabled}
                                    onChange={(e) => setOverUnderEnabled(e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                        <p>Uses advanced AI to identify patterns and recommend optimal over/under positions.</p>
                        {currentRecommendations.over_under && (
                            <div className="recommendation">
                                <span>Symbol: {currentRecommendations.over_under.symbol}</span>
                                <span>Type: {currentRecommendations.over_under.contract_type}</span>
                                <span>Confidence: {(currentRecommendations.over_under.confidence * 100).toFixed(1)}%</span>
                            </div>
                        )}
                    </div>

                    <div className="strategy-card">
                        <div className="strategy-header">
                            <h4>🎯 Auto O5U4</h4>
                            <label className="toggle-switch">
                                <input 
                                    type="checkbox" 
                                    checked={o5u4Enabled}
                                    onChange={(e) => setO5u4Enabled(e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                        <p>Simultaneously trades Over 5 and Under 4 based on digit frequency analysis across all volatility indices.</p>
                        {currentRecommendations.o5u4 && (
                            <div className="recommendation">
                                <span>Symbol: {currentRecommendations.o5u4.symbol}</span>
                                <span>Strategy: O5U4</span>
                                <span>Confidence: {(currentRecommendations.o5u4.confidence * 100).toFixed(1)}%</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="trading-controls">
                    <div className="stake-controls">
                        <label>
                            Base Stake:
                            <input 
                                type="number" 
                                value={baseStake} 
                                onChange={(e) => setBaseStake(Math.max(MINIMUM_STAKE, parseFloat(e.target.value) || MINIMUM_STAKE))}
                                min={MINIMUM_STAKE}
                                step="0.01"
                            />
                        </label>
                        <label>
                            Current Stake: {formatCurrency(currentStake)}
                        </label>
                    </div>

                    <div className="martingale-controls">
                        <label>
                            Martingale Multiplier:
                            <input 
                                type="number" 
                                value={martingaleMultiplier} 
                                onChange={(e) => setMartingaleMultiplier(Math.max(1, parseFloat(e.target.value) || 2))}
                                min="1"
                                step="0.1"
                            />
                        </label>
                        <label>
                            Max Consecutive Losses:
                            <input 
                                type="number" 
                                value={maxConsecutiveLosses} 
                                onChange={(e) => setMaxConsecutiveLosses(Math.max(1, parseInt(e.target.value) || 5))}
                                min="1"
                            />
                        </label>
                    </div>

                    <button 
                        className={`trade-button ${isContinuousTrading ? 'stop' : 'start'}`}
                        onClick={handleTrade}
                        disabled={!isConnected}
                    >
                        {isContinuousTrading ? '⏹️ Stop Trading' : '▶️ Start Trading'}
                    </button>
                </div>

                <div className="status-section">
                    <p className="status-message">{statusMessage}</p>
                </div>

                <div className="statistics-section">
                    <h3>Trading Statistics</h3>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">Total Trades:</span>
                            <span className="stat-value">{stats.totalTrades}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Wins:</span>
                            <span className="stat-value wins">{stats.wins}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Losses:</span>
                            <span className="stat-value losses">{stats.losses}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Win Rate:</span>
                            <span className="stat-value">{stats.winRate.toFixed(1)}%</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Total Profit:</span>
                            <span className={`stat-value ${stats.totalProfit >= 0 ? 'profit' : 'loss'}`}>
                                {formatCurrency(stats.totalProfit)}
                            </span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Consecutive:</span>
                            <span className="stat-value">
                                {stats.consecutiveWins > 0 ? `${stats.consecutiveWins} wins` : `${stats.consecutiveLosses} losses`}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="trade-history">
                    <h3>Recent Trades</h3>
                    <div className="history-list">
                        {tradeHistory.slice(0, 10).map(trade => (
                            <div key={trade.id} className={`trade-item ${trade.status}`}>
                                <span className="trade-strategy">{trade.strategy}</span>
                                <span className="trade-symbol">{trade.symbol}</span>
                                <span className="trade-amount">{formatCurrency(trade.amount)}</span>
                                <span className={`trade-profit ${trade.profit && trade.profit >= 0 ? 'positive' : 'negative'}`}>
                                    {trade.profit !== undefined ? formatCurrency(trade.profit) : 'Pending...'}
                                </span>
                                <span className="trade-time">
                                    {new Date(trade.timestamp).toLocaleTimeString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AutoTrader;
