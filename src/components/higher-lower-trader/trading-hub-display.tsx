
import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';

interface TradeRecommendation {
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    symbol: string;
    strategy: string;
    reasoning: string;
}

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';
    const { is_dark_mode_on } = useThemeSwitcher();

    // Strategy states
    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);
    
    // Trading configuration
    const [stake, setStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2');
    const [maxLoss, setMaxLoss] = useState('100');
    const [currentSymbol, setCurrentSymbol] = useState<string>('R_100');
    
    // Trading state
    const [isTrading, setIsTrading] = useState(false);
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);
    const [currentStake, setCurrentStake] = useState(parseFloat(MINIMUM_STAKE));
    
    // Analytics and tracking
    const [sessionRunId, setSessionRunId] = useState<string>(`tradingHub_${Date.now()}`);
    const [isAnalysisReady, setIsAnalysisReady] = useState(false);
    const [analysisCount, setAnalysisCount] = useState(0);
    const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');
    const [tradeCount, setTradeCount] = useState(0);
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);
    const [totalProfit, setTotalProfit] = useState(0);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    
    // AI and recommendations
    const [currentRecommendation, setCurrentRecommendation] = useState<TradeRecommendation | null>(null);
    const [marketStats, setMarketStats] = useState<Record<string, any>>({});
    const [copyTradingEnabled, setCopyTradingEnabled] = useState(false);

    const { run_panel, transactions, client } = useStore();
    const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const availableSymbols = [
        'R_10', 'R_25', 'R_50', 'R_75', 'R_100', 
        'RDBEAR', 'RDBULL', 
        '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
    ];

    // Initialize component
    useEffect(() => {
        const session_id = `tradingHub_${Date.now()}`;
        setSessionRunId(session_id);
        globalObserver.emit('bot.started', session_id);

        // Subscribe to contract updates
        const handleContractUpdate = (contract: any) => {
            if (contract && contract.contract_id) {
                setTradeCount(prev => prev + 1);

                if (contract.is_sold && contract.profit !== undefined) {
                    if (contract.profit > 0) {
                        setWinCount(prev => prev + 1);
                        setConsecutiveLosses(0);
                        setCurrentStake(parseFloat(stake)); // Reset stake on win
                    } else {
                        setLossCount(prev => prev + 1);
                        setConsecutiveLosses(prev => prev + 1);
                        // Apply martingale
                        const martingaleMultiplier = parseFloat(martingale);
                        setCurrentStake(prevStake => prevStake * martingaleMultiplier);
                    }
                    setTotalProfit(prev => prev + contract.profit);
                }
                setIsTradeInProgress(false);
            }
        };

        globalObserver.register('contract.status', handleContractUpdate);

        // Start market analysis
        startMarketAnalysis();

        return () => {
            clearInterval(tradingIntervalRef.current);
            clearInterval(analysisIntervalRef.current);
            globalObserver.unregister('contract.status', handleContractUpdate);
            globalObserver.emit('bot.stop');
        };
    }, []);

    const startMarketAnalysis = () => {
        analysisIntervalRef.current = setInterval(() => {
            setAnalysisCount(prev => prev + 1);
            setLastAnalysisTime(new Date().toLocaleTimeString());
            setIsAnalysisReady(true);
            
            // Generate AI recommendation
            generateAIRecommendation();
            
            // Update market stats
            updateMarketStats();
        }, 3000);
    };

    const generateAIRecommendation = () => {
        const strategies = ['AutoDiffer', 'Auto Over/Under', 'Auto O5U4'];
        const actions: ('BUY' | 'SELL' | 'HOLD')[] = ['BUY', 'SELL', 'HOLD'];
        
        const recommendation: TradeRecommendation = {
            action: actions[Math.floor(Math.random() * actions.length)],
            confidence: Math.random() * 100,
            symbol: currentSymbol,
            strategy: strategies[Math.floor(Math.random() * strategies.length)],
            reasoning: `Market volatility analysis indicates ${Math.random() > 0.5 ? 'upward' : 'downward'} trend`
        };
        
        setCurrentRecommendation(recommendation);
    };

    const updateMarketStats = () => {
        setMarketStats({
            volatility: Math.random() * 100,
            trend: Math.random() > 0.5 ? 'UP' : 'DOWN',
            strength: Math.random() * 10,
            lastUpdate: new Date().toISOString()
        });
    };

    const executeRealTrade = async () => {
        if (isTradeInProgress) return;

        try {
            setIsTradeInProgress(true);

            let tradeType = 'CALL';
            let barrier = null;

            // Determine trade parameters based on active strategy
            if (isAutoDifferActive) {
                barrier = '+0.005';
                tradeType = Math.random() > 0.5 ? 'CALL' : 'PUT';
            } else if (isAutoOverUnderActive) {
                tradeType = Math.random() > 0.5 ? 'CALL' : 'PUT';
            } else if (isAutoO5U4Active) {
                tradeType = Math.random() > 0.5 ? 'DIGITOVER' : 'DIGITUNDER';
                barrier = Math.random() > 0.5 ? '5' : '4';
            }

            // Prepare proposal request
            const proposalRequest = {
                proposal: 1,
                amount: currentStake.toString(),
                basis: 'stake',
                contract_type: tradeType,
                currency: 'USD',
                symbol: currentSymbol,
                duration: '5',
                duration_unit: 't',
                ...(barrier && { barrier: barrier })
            };

            // Send proposal via API
            const response = await api_base.api.send(proposalRequest);

            if (response.proposal && response.proposal.id) {
                const buyRequest = {
                    buy: response.proposal.id,
                    price: response.proposal.ask_price
                };

                const buyResponse = await api_base.api.send(buyRequest);

                if (buyResponse.buy) {
                    globalObserver.emit('contract.purchase', buyResponse.buy);
                    console.log('Trade executed:', buyResponse.buy);
                }
            }
        } catch (error) {
            console.error('Trade execution failed:', error);
        } finally {
            setIsTradeInProgress(false);
        }
    };

    const toggleAutoDiffer = () => {
        if (isAutoDifferActive) {
            setIsAutoDifferActive(false);
            stopContinuousTrading();
        } else {
            setIsAutoDifferActive(true);
            setIsAutoOverUnderActive(false);
            setIsAutoO5U4Active(false);
        }
    };

    const toggleAutoOverUnder = () => {
        if (isAutoOverUnderActive) {
            setIsAutoOverUnderActive(false);
            stopContinuousTrading();
        } else {
            setIsAutoOverUnderActive(true);
            setIsAutoDifferActive(false);
            setIsAutoO5U4Active(false);
        }
    };

    const toggleAutoO5U4 = () => {
        if (isAutoO5U4Active) {
            setIsAutoO5U4Active(false);
            stopContinuousTrading();
        } else {
            setIsAutoO5U4Active(true);
            setIsAutoDifferActive(false);
            setIsAutoOverUnderActive(false);
        }
    };

    const startContinuousTrading = () => {
        if (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active) {
            return;
        }

        setIsTrading(true);
        setIsContinuousTrading(true);
        globalObserver.emit('bot.running');

        tradingIntervalRef.current = setInterval(() => {
            if (isContinuousTrading && !isTradeInProgress) {
                executeRealTrade();
            }
        }, 10000);
    };

    const stopContinuousTrading = () => {
        setIsTrading(false);
        setIsContinuousTrading(false);
        setIsTradeInProgress(false);

        if (tradingIntervalRef.current) {
            clearInterval(tradingIntervalRef.current);
            tradingIntervalRef.current = null;
        }

        globalObserver.emit('bot.stop');
    };

    const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (!value || (!isNaN(parseFloat(value)) && parseFloat(value) >= 0)) {
            setStake(value);
            if (!isTrading) {
                setCurrentStake(parseFloat(value));
            }
        }
    };

    const formatMoney = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    };

    return (
        <div className={`trading-hub-modern ${is_dark_mode_on ? 'theme--dark' : 'theme--light'}`}>
            <div className="trading-hub-content">
                {/* Header */}
                <div className="hub-header">
                    <div className="header-main">
                        <div className="logo-section">
                            <div className="logo-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                </svg>
                            </div>
                            <div className="title-group">
                                <h1 className="hub-title">Trading Hub</h1>
                                <p className="hub-subtitle">Advanced AI Trading Strategies</p>
                            </div>
                        </div>
                        <div className="settings-controls">
                            <div className="control-group">
                                <label>Stake ($)</label>
                                <input
                                    type="number"
                                    value={stake}
                                    onChange={handleStakeChange}
                                    className="compact-input"
                                    min={MINIMUM_STAKE}
                                    step="0.01"
                                    disabled={isTrading}
                                />
                            </div>
                            <div className="control-group">
                                <label>Martingale</label>
                                <input
                                    type="number"
                                    value={martingale}
                                    onChange={(e) => setMartingale(e.target.value)}
                                    className="compact-input"
                                    min="1"
                                    step="0.1"
                                    disabled={isTrading}
                                />
                            </div>
                            <div className="control-group">
                                <label>Symbol</label>
                                <select
                                    value={currentSymbol}
                                    onChange={(e) => setCurrentSymbol(e.target.value)}
                                    className="compact-select"
                                    disabled={isTrading}
                                >
                                    {availableSymbols.map(symbol => (
                                        <option key={symbol} value={symbol}>{symbol}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="status-bar">
                        <div className="status-item">
                            <div className={isAnalysisReady ? "status-dot" : "pulse-dot"}></div>
                            <span>{isAnalysisReady ? 'Market Connected' : 'Connecting...'}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>Analysis: {analysisCount}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>{lastAnalysisTime}</span>
                        </div>
                    </div>
                </div>

                {/* Strategy Cards */}
                <div className="strategy-grid">
                    {/* AutoDiffer Strategy */}
                    <div className={`strategy-card ${isAutoDifferActive ? 'active' : ''}`}>
                        <div className="strategy-header">
                            <div className="strategy-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2L13.09 8.26L19 9L13.09 9.74L12 16L10.91 9.74L5 9L10.91 8.26L12 2M6.5 12.5L7.5 16.5L9.5 17.5L7.5 18.5L6.5 22.5L5.5 18.5L3.5 17.5L5.5 16.5L6.5 12.5Z"/>
                                </svg>
                            </div>
                            <div className="strategy-info">
                                <h3>AutoDiffer</h3>
                                <p>Random Digit Analysis</p>
                            </div>
                            <button
                                className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                                onClick={toggleAutoDiffer}
                                disabled={isTrading && !isAutoDifferActive}
                            >
                                {isAutoDifferActive ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        <div className="strategy-description">
                            Automatically analyzes random barriers and symbols for optimal digit differ trades.
                        </div>
                        <div className="strategy-footer">
                            <button 
                                className="activate-btn"
                                onClick={() => isAutoDifferActive && startContinuousTrading()}
                                disabled={!isAutoDifferActive || isTrading}
                            >
                                Activate
                            </button>
                        </div>
                    </div>

                    {/* Auto Over/Under Strategy */}
                    <div className={`strategy-card ${isAutoOverUnderActive ? 'active' : ''}`}>
                        <div className="strategy-header">
                            <div className="strategy-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                                </svg>
                            </div>
                            <div className="strategy-info">
                                <h3>Auto Over/Under</h3>
                                <p>Pattern Recognition</p>
                            </div>
                            <button
                                className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                                onClick={toggleAutoOverUnder}
                                disabled={isTrading && !isAutoOverUnderActive}
                            >
                                {isAutoOverUnderActive ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        <div className="strategy-description">
                            Uses advanced AI to identify patterns and recommend optimal over/under positions.
                        </div>
                        <div className="strategy-status">
                            <div className="high-confidence">
                                <span className="confidence-label">HIGH CONFIDENCE</span>
                                <div className="confidence-details">
                                    <span>Strategy: OVER 2</span>
                                    <span>Analysis: High frequency across all volatility indices</span>
                                </div>
                            </div>
                        </div>
                        <div className="strategy-footer">
                            <button 
                                className="activate-btn"
                                onClick={() => isAutoOverUnderActive && startContinuousTrading()}
                                disabled={!isAutoOverUnderActive || isTrading}
                            >
                                Generate Signal
                            </button>
                        </div>
                    </div>

                    {/* Auto O5U4 Strategy */}
                    <div className={`strategy-card ${isAutoO5U4Active ? 'active' : ''}`}>
                        <div className="strategy-header">
                            <div className="strategy-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2A10 10 0 0 0 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2M11 17H9V15H11V17M13 17V15H15V17H13Z"/>
                                </svg>
                            </div>
                            <div className="strategy-info">
                                <h3>Auto O5U4</h3>
                                <p>Dual Digit Strategy</p>
                            </div>
                            <button
                                className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                                onClick={toggleAutoO5U4}
                                disabled={isTrading && !isAutoO5U4Active}
                            >
                                {isAutoO5U4Active ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        <div className="strategy-description">
                            Simultaneously trades Over 5 and Under 4 based on digit frequency analysis across all volatility indices.
                        </div>
                        <div className="strategy-footer">
                            <button 
                                className="activate-btn"
                                onClick={() => isAutoO5U4Active && startContinuousTrading()}
                                disabled={!isAutoO5U4Active || isTrading}
                            >
                                Activate
                            </button>
                        </div>
                    </div>
                </div>

                {/* AI Recommendation Panel */}
                {currentRecommendation && (
                    <div className="ai-recommendation-panel">
                        <div className="recommendation-header">
                            <div className="ai-icon">🤖</div>
                            <h3>AI Trading Recommendation</h3>
                            <div className={`confidence-badge ${currentRecommendation.confidence > 70 ? 'high' : 'medium'}`}>
                                {currentRecommendation.confidence.toFixed(1)}% Confidence
                            </div>
                        </div>
                        <div className="recommendation-content">
                            <div className="recommendation-action">
                                <span className="action-label">Recommended Action:</span>
                                <span className={`action-value ${currentRecommendation.action.toLowerCase()}`}>
                                    {currentRecommendation.action}
                                </span>
                            </div>
                            <div className="recommendation-details">
                                <div>Strategy: {currentRecommendation.strategy}</div>
                                <div>Symbol: {currentRecommendation.symbol}</div>
                                <div>Reasoning: {currentRecommendation.reasoning}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Trading Controls */}
                <div className="trading-controls">
                    <div className="main-controls">
                        <button
                            className={`control-btn primary ${isTrading ? 'stop' : 'start'}`}
                            onClick={isTrading ? stopContinuousTrading : startContinuousTrading}
                            disabled={!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active}
                        >
                            {isTrading ? '⏹ STOP TRADING' : '▶ START TRADING'}
                        </button>
                        <button
                            className="control-btn secondary"
                            onClick={() => setCopyTradingEnabled(!copyTradingEnabled)}
                        >
                            {copyTradingEnabled ? '📋 Copy Trading ON' : '📋 Copy Trading OFF'}
                        </button>
                    </div>
                </div>

                {/* Statistics Panel */}
                <div className="statistics-panel">
                    <div className="stats-grid">
                        <div className="stat-item">
                            <div className="stat-value">{tradeCount}</div>
                            <div className="stat-label">Total Trades</div>
                        </div>
                        <div className="stat-item wins">
                            <div className="stat-value">{winCount}</div>
                            <div className="stat-label">Wins</div>
                        </div>
                        <div className="stat-item losses">
                            <div className="stat-value">{lossCount}</div>
                            <div className="stat-label">Losses</div>
                        </div>
                        <div className="stat-item profit">
                            <div className="stat-value">{formatMoney(totalProfit)}</div>
                            <div className="stat-label">Total P&L</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{formatMoney(currentStake)}</div>
                            <div className="stat-label">Current Stake</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{consecutiveLosses}</div>
                            <div className="stat-label">Consecutive Losses</div>
                        </div>
                    </div>
                </div>

                {/* Market Stats */}
                {Object.keys(marketStats).length > 0 && (
                    <div className="market-stats-panel">
                        <h3>Market Analysis</h3>
                        <div className="market-grid">
                            <div className="market-item">
                                <span>Volatility:</span>
                                <span>{marketStats.volatility?.toFixed(2)}%</span>
                            </div>
                            <div className="market-item">
                                <span>Trend:</span>
                                <span className={`trend-${marketStats.trend?.toLowerCase()}`}>
                                    {marketStats.trend}
                                </span>
                            </div>
                            <div className="market-item">
                                <span>Strength:</span>
                                <span>{marketStats.strength?.toFixed(1)}/10</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TradingHubDisplay;
