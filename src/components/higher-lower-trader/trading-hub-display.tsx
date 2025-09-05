import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import './trading-hub-display.scss';

// Import services
import { marketAnalyzer } from '../../services/market-analyzer';
import { tradingEngine } from '../../services/trading-engine';
import { connectionMonitor } from '../../services/connection-monitor';

interface TradingHubDisplayProps {
    // Optional props for configuration
}

interface StrategyStats {
    totalRuns: number;
    wins: number;
    losses: number;
    totalStake: number;
    totalPayout: number;
    profit: number;
    winRate: number;
}

interface RecentTick {
    id: string;
    symbol: string;
    digit: number;
    timestamp: number;
    result?: 'win' | 'loss';
}

const TradingHubDisplay: React.FC<TradingHubDisplayProps> = observer(() => {
    // Strategy states
    const [autoDifferEnabled, setAutoDifferEnabled] = useState(false);
    const [overUnderEnabled, setOverUnderEnabled] = useState(false);
    const [o5u4Enabled, setO5u4Enabled] = useState(false);

    // Trading configuration
    const [stakeAmount, setStakeAmount] = useState(1);
    const [referenceDigit, setReferenceDigit] = useState(5);
    const [analysisCount, setAnalysisCount] = useState(120);
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);

    // Market data and analysis
    const [marketConnected, setMarketConnected] = useState(false);
    const [activeSymbols, setActiveSymbols] = useState<string[]>([]);
    const [recentTicks, setRecentTicks] = useState<RecentTick[]>([]);

    // Statistics
    const [autoDifferStats, setAutoDifferStats] = useState<StrategyStats>({
        totalRuns: 0, wins: 0, losses: 0, totalStake: 0, totalPayout: 0, profit: 0, winRate: 0
    });
    const [overUnderStats, setOverUnderStats] = useState<StrategyStats>({
        totalRuns: 0, wins: 0, losses: 0, totalStake: 0, totalPayout: 0, profit: 0, winRate: 0
    });
    const [o5u4Stats, setO5u4Stats] = useState<StrategyStats>({
        totalRuns: 0, wins: 0, losses: 0, totalStake: 0, totalPayout: 0, profit: 0, winRate: 0
    });

    // Trading intervals
    const analysisInterval = useRef<NodeJS.Timeout | null>(null);
    const tradingInterval = useRef<NodeJS.Timeout | null>(null);

    // Status and recommendations
    const [statusMessage, setStatusMessage] = useState('Initializing Trading Hub...');
    const [recommendations, setRecommendations] = useState<any>({});

    useEffect(() => {
        // Initialize connections
        initializeConnections();

        // Clean up on unmount
        return () => {
            connectionMonitor.stop();
            marketAnalyzer.disconnect();
            tradingEngine.disconnect();
            if (analysisInterval.current) clearInterval(analysisInterval.current);
            if (tradingInterval.current) clearInterval(tradingInterval.current);
        };
    }, []);

    useEffect(() => {
        // Start analysis loop
        analysisInterval.current = setInterval(() => {
            updateRecommendations();
        }, 2000);

        // Start trading loop when continuous trading is enabled
        if (isContinuousTrading && (autoDifferEnabled || overUnderEnabled || o5u4Enabled)) {
            tradingInterval.current = setInterval(() => {
                executeAutomatedTrades();
            }, 3000);
        } else {
            if (tradingInterval.current) {
                clearInterval(tradingInterval.current);
                tradingInterval.current = null;
            }
        }

        return () => {
            if (analysisInterval.current) clearInterval(analysisInterval.current);
            if (tradingInterval.current) clearInterval(tradingInterval.current);
        };
    }, [autoDifferEnabled, overUnderEnabled, o5u4Enabled, isContinuousTrading]);

    const initializeConnections = async () => {
        try {
            setStatusMessage('Connecting to market data...');

            // Start connection monitor
            connectionMonitor.start();

            // Connect market analyzer
            marketAnalyzer.connect();

            // Connect trading engine
            if (!tradingEngine.isEngineConnected()) {
                // Trading engine auto-connects in constructor
            }

            // Wait for connections
            let attempts = 0;
            const maxAttempts = 30;

            while (attempts < maxAttempts) {
                if (marketAnalyzer.isMarketAnalysisReady && tradingEngine.isEngineConnected()) {
                    setMarketConnected(true);
                    setStatusMessage('Connected - Ready for trading');

                    // Update active symbols
                    const symbols = Array.from(marketAnalyzer.symbolData.keys());
                    setActiveSymbols(symbols);
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            if (attempts >= maxAttempts) {
                setStatusMessage('Connection timeout - Please refresh');
            }

        } catch (error) {
            console.error('Failed to initialize connections:', error);
            setStatusMessage('Connection failed - Please refresh');
        }
    };

    const updateRecommendations = () => {
        try {
            if (!marketAnalyzer.isMarketAnalysisReady) {
                setStatusMessage('Waiting for market data...');
                return;
            }

            const newRecommendations: any = {};

            if (autoDifferEnabled) {
                newRecommendations.autodiff = marketAnalyzer.getAutoDifferRecommendation();
            }

            if (overUnderEnabled) {
                newRecommendations.over_under = marketAnalyzer.getOverUnderRecommendation();
            }

            if (o5u4Enabled) {
                newRecommendations.o5u4 = marketAnalyzer.getO5U4Recommendation();
            }

            setRecommendations(newRecommendations);
            setStatusMessage('Analysis running - Strategies active');

            // Update recent ticks display
            updateRecentTicksDisplay();

        } catch (error) {
            console.error('Error updating recommendations:', error);
        }
    };

    const updateRecentTicksDisplay = () => {
        const allTicks: RecentTick[] = [];

        marketAnalyzer.symbolData.forEach((data, symbol) => {
            const recentSymbolTicks = data.ticks.slice(-5).map(tick => ({
                id: `${symbol}_${tick.epoch}`,
                symbol,
                digit: tick.last_digit,
                timestamp: tick.timestamp
            }));
            allTicks.push(...recentSymbolTicks);
        });

        // Sort by timestamp and take most recent
        allTicks.sort((a, b) => b.timestamp - a.timestamp);
        setRecentTicks(allTicks.slice(0, 6));
    };

    const executeAutomatedTrades = async () => {
        if (!marketAnalyzer.isMarketAnalysisReady || !tradingEngine.isEngineConnected()) {
            return;
        }

        try {
            // Execute AutoDiffer trades
            if (autoDifferEnabled && recommendations.autodiff) {
                await executeAutoDifferTrade(recommendations.autodiff);
            }

            // Execute Over/Under trades
            if (overUnderEnabled && recommendations.over_under) {
                await executeOverUnderTrade(recommendations.over_under);
            }

            // Execute O5U4 trades
            if (o5u4Enabled && recommendations.o5u4) {
                await executeO5U4Trade(recommendations.o5u4);
            }

        } catch (error) {
            console.error('Error executing automated trades:', error);
        }
    };

    const executeAutoDifferTrade = async (recommendation: any) => {
        try {
            const contractRequest = {
                contract_type: 'DIGITDIFF',
                symbol: recommendation.symbol,
                barrier: recommendation.barrier,
                amount: stakeAmount,
                duration: 1,
                duration_unit: 't',
                currency: 'USD'
            };

            const result = await tradingEngine.executeTrade(contractRequest, (tradeResult) => {
                updateAutoDifferStats(tradeResult);
            });

            console.log('AutoDiffer trade executed:', result);

        } catch (error) {
            console.error('AutoDiffer trade failed:', error);
        }
    };

    const executeOverUnderTrade = async (recommendation: any) => {
        try {
            const contractRequest = {
                contract_type: recommendation.contract_type, // DIGITOVER or DIGITUNDER
                symbol: recommendation.symbol,
                barrier: recommendation.barrier,
                amount: stakeAmount,
                duration: 1,
                duration_unit: 't',
                currency: 'USD'
            };

            const result = await tradingEngine.executeTrade(contractRequest, (tradeResult) => {
                updateOverUnderStats(tradeResult);
            });

            console.log('Over/Under trade executed:', result);

        } catch (error) {
            console.error('Over/Under trade failed:', error);
        }
    };

    const executeO5U4Trade = async (recommendation: any) => {
        try {
            const contractRequest = {
                contract_type: recommendation.contract_type,
                symbol: recommendation.symbol,
                barrier: recommendation.barrier || 4, // Default to 4 for O5U4
                amount: stakeAmount,
                duration: 1,
                duration_unit: 't',
                currency: 'USD'
            };

            const result = await tradingEngine.executeTrade(contractRequest, (tradeResult) => {
                updateO5U4Stats(tradeResult);
            });

            console.log('O5U4 trade executed:', result);

        } catch (error) {
            console.error('O5U4 trade failed:', error);
        }
    };

    const updateAutoDifferStats = (result: any) => {
        setAutoDifferStats(prev => {
            const isWin = result.profit > 0;
            return {
                totalRuns: prev.totalRuns + 1,
                wins: prev.wins + (isWin ? 1 : 0),
                losses: prev.losses + (isWin ? 0 : 1),
                totalStake: prev.totalStake + stakeAmount,
                totalPayout: prev.totalPayout + (result.payout || 0),
                profit: prev.profit + result.profit,
                winRate: ((prev.wins + (isWin ? 1 : 0)) / (prev.totalRuns + 1)) * 100
            };
        });
    };

    const updateOverUnderStats = (result: any) => {
        setOverUnderStats(prev => {
            const isWin = result.profit > 0;
            return {
                totalRuns: prev.totalRuns + 1,
                wins: prev.wins + (isWin ? 1 : 0),
                losses: prev.losses + (isWin ? 0 : 1),
                totalStake: prev.totalStake + stakeAmount,
                totalPayout: prev.totalPayout + (result.payout || 0),
                profit: prev.profit + result.profit,
                winRate: ((prev.wins + (isWin ? 1 : 0)) / (prev.totalRuns + 1)) * 100
            };
        });
    };

    const updateO5U4Stats = (result: any) => {
        setO5u4Stats(prev => {
            const isWin = result.profit > 0;
            return {
                totalRuns: prev.totalRuns + 1,
                wins: prev.wins + (isWin ? 1 : 0),
                losses: prev.losses + (isWin ? 0 : 1),
                totalStake: prev.totalStake + stakeAmount,
                totalPayout: prev.totalPayout + (result.payout || 0),
                profit: prev.profit + result.profit,
                winRate: ((prev.wins + (isWin ? 1 : 0)) / (prev.totalRuns + 1)) * 100
            };
        });
    };

    const toggleAutoDiffer = () => {
        setAutoDifferEnabled(prev => !prev);
        if (overUnderEnabled) setOverUnderEnabled(false);
        if (o5u4Enabled) setO5u4Enabled(false);
    };

    const toggleOverUnder = () => {
        setOverUnderEnabled(prev => !prev);
        if (autoDifferEnabled) setAutoDifferEnabled(false);
        if (o5u4Enabled) setO5u4Enabled(false);
    };

    const toggleO5U4 = () => {
        setO5u4Enabled(prev => !prev);
        if (autoDifferEnabled) setAutoDifferEnabled(false);
        if (overUnderEnabled) setOverUnderEnabled(false);
    };

    const resetStats = () => {
        const emptyStats: StrategyStats = {
            totalRuns: 0, wins: 0, losses: 0, totalStake: 0, totalPayout: 0, profit: 0, winRate: 0
        };
        setAutoDifferStats(emptyStats);
        setOverUnderStats(emptyStats);
        setO5u4Stats(emptyStats);
        setRecentTicks([]);
    };

    const renderConnectionStatus = () => (
        <div className="connection-status">
            <div className={`status-indicator ${marketConnected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot"></span>
                Market Connected
            </div>
            <div className="status-message">
                Status: {statusMessage}
            </div>
        </div>
    );

    const renderMarketAnalysisTools = () => (
        <div className="market-analysis-section">
            <h3>MARKET ANALYSIS TOOLS</h3>
            <div className="analysis-controls">
                <div className="control-group">
                    <label>Stake Amount (USD):</label>
                    <input
                        type="number"
                        min="1"
                        max="100"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(Number(e.target.value))}
                    />
                </div>
                <div className="control-group">
                    <label>Reference Digit (0-9):</label>
                    <input
                        type="number"
                        min="0"
                        max="9"
                        value={referenceDigit}
                        onChange={(e) => setReferenceDigit(Number(e.target.value))}
                    />
                </div>
                <div className="control-group">
                    <label>Analysis Count:</label>
                    <input
                        type="number"
                        min="50"
                        max="500"
                        value={analysisCount}
                        onChange={(e) => setAnalysisCount(Number(e.target.value))}
                    />
                </div>
                <button className="apply-settings-btn" onClick={() => setStatusMessage('Settings applied')}>
                    Apply Settings
                </button>
            </div>

            <div className="active-symbols">
                <h4>Active Symbols:</h4>
                <div className="symbol-list">
                    {activeSymbols.map(symbol => (
                        <span key={symbol} className="symbol-badge">{symbol}</span>
                    ))}
                </div>
            </div>

            <div className="recent-ticks">
                <h4>Recent Ticks:</h4>
                <div className="tick-list">
                    {recentTicks.map(tick => (
                        <div key={tick.id} className={`tick-item ${tick.result || ''}`}>
                            <span className="tick-digit">{tick.digit}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderStrategyCard = (
        title: string,
        description: string,
        enabled: boolean,
        onToggle: () => void,
        stats: StrategyStats,
        status: string
    ) => (
        <div className={`strategy-card ${enabled ? 'active' : ''}`}>
            <div className="strategy-header">
                <div className="strategy-info">
                    <h3>{title}</h3>
                    <div className={`strategy-status ${enabled ? 'on' : 'off'}`}>
                        {status}
                    </div>
                </div>
                <button 
                    className={`strategy-toggle ${enabled ? 'active' : ''}`}
                    onClick={onToggle}
                >
                    {enabled ? 'Deactivate' : 'Activate'}
                </button>
            </div>

            <div className="strategy-description">
                {description}
            </div>

            <div className="strategy-stats">
                <div className="stat-item">
                    <span className="stat-label">Runs:</span>
                    <span className="stat-value">{stats.totalRuns}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Win Rate:</span>
                    <span className="stat-value">{stats.winRate.toFixed(1)}%</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Profit:</span>
                    <span className={`stat-value ${stats.profit >= 0 ? 'positive' : 'negative'}`}>
                        ${stats.profit.toFixed(2)}
                    </span>
                </div>
            </div>
        </div>
    );

    return (
        <div className="trading-hub-display">
            <div className="trading-hub-header">
                <h2>Trading Hub</h2>
                <span className="hub-subtitle">Advanced Strategies</span>
                {renderConnectionStatus()}
            </div>

            <div className="trading-hub-content">
                <div className="left-panel">
                    {renderMarketAnalysisTools()}
                </div>

                <div className="strategies-panel">
                    {renderStrategyCard(
                        "AutoDiffer",
                        "Simultaneously analyzes random barriers and provides for optimal digit differ trades.",
                        autoDifferEnabled,
                        toggleAutoDiffer,
                        autoDifferStats,
                        autoDifferEnabled ? "ON" : "OFF"
                    )}

                    {renderStrategyCard(
                        "Auto Over/Under",
                        "Uses advanced AI to identify patterns and recommend optimal over/under positions.",
                        overUnderEnabled,
                        toggleOverUnder,
                        overUnderStats,
                        overUnderEnabled ? "ON" : "OFF"
                    )}

                    {renderStrategyCard(
                        "Auto O5 U4",
                        "Simultaneously tracks Over 5 and Under 4 based on digit frequency analysis across all volatility indices.",
                        o5u4Enabled,
                        toggleO5U4,
                        o5u4Stats,
                        o5u4Enabled ? "ON" : "OFF"
                    )}

                    <div className="continuous-trading-control">
                        <label className="continuous-toggle">
                            <input
                                type="checkbox"
                                checked={isContinuousTrading}
                                onChange={(e) => setIsContinuousTrading(e.target.checked)}
                            />
                            <span>Enable Continuous Trading</span>
                        </label>
                    </div>
                </div>

                <div className="stats-panel">
                    <div className="overall-stats">
                        <h3>Overall Performance</h3>
                        <div className="total-stats">
                            <div className="total-stat">
                                <span className="label">Total stake:</span>
                                <span className="value">
                                    {(autoDifferStats.totalStake + overUnderStats.totalStake + o5u4Stats.totalStake).toFixed(2)} USD
                                </span>
                            </div>
                            <div className="total-stat">
                                <span className="label">Total payout:</span>
                                <span className="value">
                                    {(autoDifferStats.totalPayout + overUnderStats.totalPayout + o5u4Stats.totalPayout).toFixed(2)} USD
                                </span>
                            </div>
                            <div className="total-stat">
                                <span className="label">No. of runs:</span>
                                <span className="value">
                                    {autoDifferStats.totalRuns + overUnderStats.totalRuns + o5u4Stats.totalRuns}
                                </span>
                            </div>
                            <div className="total-stat">
                                <span className="label">Contracts lost:</span>
                                <span className="value">
                                    {autoDifferStats.losses + overUnderStats.losses + o5u4Stats.losses}
                                </span>
                            </div>
                            <div className="total-stat">
                                <span className="label">Contracts won:</span>
                                <span className="value">
                                    {autoDifferStats.wins + overUnderStats.wins + o5u4Stats.wins}
                                </span>
                            </div>
                            <div className="total-stat">
                                <span className="label">Total profit/loss:</span>
                                <span className={`value ${(autoDifferStats.profit + overUnderStats.profit + o5u4Stats.profit) >= 0 ? 'positive' : 'negative'}`}>
                                    {(autoDifferStats.profit + overUnderStats.profit + o5u4Stats.profit).toFixed(2)} USD
                                </span>
                            </div>
                        </div>

                        <button className="reset-btn" onClick={resetStats}>
                            Reset
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default TradingHubDisplay;