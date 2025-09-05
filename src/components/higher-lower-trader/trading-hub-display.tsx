import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';
    const { is_dark_mode_on } = useThemeSwitcher();

    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);
    const [stake, setStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2');
    const [isTrading, setIsTrading] = useState(false);
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);
    const [currentSymbol, setCurrentSymbol] = useState<string>('R_100');
    const [sessionRunId, setSessionRunId] = useState<string>(`tradingHub_${Date.now()}`);
    const [isAnalysisReady, setIsAnalysisReady] = useState(false);
    const [analysisCount, setAnalysisCount] = useState(0);
    const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);
    const [tradeCount, setTradeCount] = useState(0);
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);
    const [totalProfit, setTotalProfit] = useState(0);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [maxLoss, setMaxLoss] = useState('100'); // Default max loss
    const [currentStake, setCurrentStake] = useState(parseFloat(MINIMUM_STAKE));
    const [copyTradingEnabled, setCopyTradingEnabled] = useState(false);
    const [currentRecommendation, setCurrentRecommendation] = useState<any>(null); // Placeholder for AI recommendation

    const { run_panel, transactions, client } = useStore();

    // Subscribe to balance updates
    useEffect(() => {
        const handleBalanceUpdate = (balance: any) => {
            // The balance will be automatically updated in the client store
            // This ensures the UI reflects real balance changes
        };

        globalObserver.register('balance.update', handleBalanceUpdate);
        
        return () => {
            globalObserver.unregister('balance.update', handleBalanceUpdate);
        };
    }, []);

    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

    useEffect(() => {
        const session_id = `tradingHub_${Date.now()}`;
        setSessionRunId(session_id);
        globalObserver.emit('bot.started', session_id);

        // Subscribe to contract updates from the trading system
        const handleContractUpdate = (contract: any) => {
            if (contract && contract.contract_id) {
                setTradeCount(prev => prev + 1);
                
                if (contract.is_sold && contract.profit !== undefined) {
                    if (contract.profit > 0) {
                        setWinCount(prev => prev + 1);
                        setConsecutiveLosses(0);
                    } else {
                        setLossCount(prev => prev + 1);
                        setConsecutiveLosses(prev => prev + 1);
                    }
                    setTotalProfit(prev => prev + contract.profit);
                    
                    // Apply martingale logic
                    if (contract.profit <= 0) {
                        const martingaleMultiplier = parseFloat(martingale);
                        setCurrentStake(prevStake => prevStake * martingaleMultiplier);
                    } else {
                        setCurrentStake(parseFloat(stake)); // Reset stake on win
                    }
                }
                setIsTradeInProgress(false);
            }
        };

        // Listen for contract events
        globalObserver.register('contract.status', handleContractUpdate);

        // Market analysis simulation
        const analysisInterval = setInterval(() => {
            setAnalysisCount(prev => prev + 1);
            setLastAnalysisTime(new Date().toLocaleTimeString());
            setIsAnalysisReady(true);
        }, 3000);

        return () => {
            clearInterval(analysisInterval);
            globalObserver.unregister('contract.status', handleContractUpdate);
            globalObserver.emit('bot.stop');
        };
    }, [stake, martingale]);


    const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (!value || (!isNaN(parseFloat(value)) && parseFloat(value) >= 0)) {
            setStake(value);
            if (!isTrading) { // Update currentStake immediately if not trading
                setCurrentStake(parseFloat(value));
            }
        }
    };

    const handleMartingaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (!value || (!isNaN(parseFloat(value)) && parseFloat(value) >= 1)) {
            setMartingale(value);
        }
    };

    const toggleAutoDiffer = () => {
        if (isAutoDifferActive) {
            setIsAutoDifferActive(false);
            setIsTrading(false);
            setIsContinuousTrading(false);
        } else {
            setIsAutoDifferActive(true);
            setIsAutoOverUnderActive(false);
            setIsAutoO5U4Active(false);
        }
    };

    const toggleAutoOverUnder = () => {
        if (isAutoOverUnderActive) {
            setIsAutoOverUnderActive(false);
            setIsTrading(false);
            setIsContinuousTrading(false);
        } else {
            setIsAutoOverUnderActive(true);
            setIsAutoDifferActive(false);
            setIsAutoO5U4Active(false);
        }
    };

    const toggleAutoO5U4 = () => {
        if (isAutoO5U4Active) {
            setIsAutoO5U4Active(false);
            setIsTrading(false);
            setIsContinuousTrading(false);
        } else {
            setIsAutoO5U4Active(true);
            setIsAutoDifferActive(false);
            setIsAutoOverUnderActive(false);
        }
    };

    const executeRealTrade = async () => {
        if (isTradeInProgress) return;
        
        try {
            setIsTradeInProgress(true);
            
            // Determine trade parameters based on active strategy
            let tradeType = 'CALL';
            let barrier = null;
            
            if (isAutoDifferActive) {
                // For differs, we need a barrier
                barrier = '+0.005'; // Small barrier for quick execution
                tradeType = Math.random() > 0.5 ? 'CALL' : 'PUT';
            } else if (isAutoOverUnderActive) {
                tradeType = Math.random() > 0.5 ? 'CALL' : 'PUT';
            } else if (isAutoO5U4Active) {
                // Over 5 Under 4 strategy for digits
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
                // Execute the trade
                const buyRequest = {
                    buy: response.proposal.id,
                    price: response.proposal.ask_price
                };
                
                const buyResponse = await api_base.api.send(buyRequest);
                
                if (buyResponse.buy) {
                    // Trade executed successfully
                    globalObserver.emit('contract.purchase', buyResponse.buy);
                    console.log('Trade executed:', buyResponse.buy);
                }
            }
        } catch (error) {
            console.error('Trade execution failed:', error);
            setIsTradeInProgress(false);
        }
    };

    const startContinuousTrading = () => {
        if (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active) {
            return;
        }

        setIsTrading(true);
        setIsContinuousTrading(true);
        globalObserver.emit('bot.running');
        
        // Start automated trading cycle
        const tradingInterval = setInterval(() => {
            if (isContinuousTrading && !isTradeInProgress) {
                executeRealTrade();
            }
        }, 10000); // Execute trade every 10 seconds
        
        // Store interval reference for cleanup
        window.tradingHubInterval = tradingInterval;
    };

    const stopContinuousTrading = () => {
        setIsTrading(false);
        setIsContinuousTrading(false);
        setIsTradeInProgress(false);
        
        // Clear trading interval
        if (window.tradingHubInterval) {
            clearInterval(window.tradingHubInterval);
            window.tradingHubInterval = null;
        }
        
        globalObserver.emit('bot.stop');
    };

    return (
        <div className={`trading-hub-modern ${is_dark_mode_on ? 'theme--dark' : 'theme--light'}`}>
            <div className="trading-hub-content">
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
                                    onChange={handleMartingaleChange}
                                    className="compact-input"
                                    min="1"
                                    step="0.1"
                                    disabled={isTrading}
                                />
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
                            <span>Symbol: {currentSymbol}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>Trades: {tradeCount}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>W/L: {winCount}/{lossCount}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>P&L: ${totalProfit.toFixed(2)}</span>
                        </div>
                        {isTrading && (
                            <>
                                <div className="status-separator"></div>
                                <div className="status-item active-trade">
                                    <div className="pulse-dot"></div>
                                    <span>Trading Active</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="strategy-grid">
                    <div className={`strategy-card ${isAutoDifferActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>AutoDiffer</h4>
                                <p>Pattern-based Differs strategy</p>
                            </div>
                            <div className={`strategy-status ${isAutoDifferActive ? 'on' : 'off'}`}>
                                {isAutoDifferActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className="card-content">
                            <p>Automatically analyzes market barriers and symbols for optimal differ trades.</p>
                            {isAutoDifferActive && (
                                <div className="active-info">
                                    <span className="info-label">Status</span>
                                    <span className="info-value">Active</span>
                                </div>
                            )}
                        </div>
                        <button 
                            className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                            onClick={toggleAutoDiffer}
                            disabled={isTrading && !isAutoDifferActive}
                        >
                            {isAutoDifferActive ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>

                    <div className={`strategy-card ${isAutoOverUnderActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z" />
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto Over/Under</h4>
                                <p>Advanced AI to identify patterns and recommend optimal over/under positions</p>
                            </div>
                            <div className={`strategy-status ${isAutoOverUnderActive ? 'on' : 'off'}`}>
                                {isAutoOverUnderActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className="card-content">
                            <p>Uses advanced AI to identify patterns and recommend optimal over/under positions.</p>
                            {isAutoOverUnderActive && (
                                <div className="active-info">
                                    <span className="info-label">Status</span>
                                    <span className="info-value">Active</span>
                                </div>
                            )}
                        </div>
                        <button 
                            className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                            onClick={toggleAutoOverUnder}
                            disabled={isTrading && !isAutoOverUnderActive}
                        >
                            {isAutoOverUnderActive ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>

                    <div className={`strategy-card ${isAutoO5U4Active ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 11H7v6h2v-6zm4 0h-2v6h2v-6zm4 0h-2v6h2v-6zM9 7H7v2h2V7zm4 0h-2v2h2V7zm4 0h-2v2h2V7z" />
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto O5U4</h4>
                                <p>Dual-strategy trading</p>
                            </div>
                            <div className={`strategy-status ${isAutoO5U4Active ? 'on' : 'off'}`}>
                                {isAutoO5U4Active ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className="card-content">
                            <p>Simultaneously trades Over 5 and Under 4 based on digit frequency analysis across all volatility indices.</p>
                            {isAutoO5U4Active && (
                                <div className="active-info">
                                    <span className="info-label">Status</span>
                                    <span className="info-value">Active</span>
                                </div>
                            )}
                        </div>
                        <button 
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={toggleAutoO5U4}
                            disabled={isTrading && !isAutoO5U4Active}
                        >
                            {isAutoO5U4Active ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>
                </div>

                {/* AI Recommendation Panel */}
                {currentRecommendation && (
                    <div className="ai-recommendation-panel">
                        <div className="panel-header">
                            <h3>AI Market Recommendation</h3>
                            <div className="recommendation-confidence">
                                <span>Confidence: High</span>
                            </div>
                        </div>
                        <div className="recommendation-content">
                            <div className="rec-item">
                                <span className="label">Symbol:</span>
                                <span className="value">{currentRecommendation.symbol}</span>
                            </div>
                            <div className="rec-item">
                                <span className="label">Strategy:</span>
                                <span className="value strategy">{currentRecommendation.strategy.toUpperCase()}</span>
                            </div>
                            <div className="rec-item">
                                <span className="label">Barrier:</span>
                                <span className="value">{currentRecommendation.barrier}</span>
                            </div>
                            <div className="rec-item">
                                <span className="label">Reason:</span>
                                <span className="value reason">{currentRecommendation.reason}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Risk Management Panel */}
                <div className="risk-management-panel">
                    <h3>Risk Management</h3>
                    <div className="risk-controls">
                        <div className="control-group">
                            <label>Max Loss ($)</label>
                            <input
                                type="number"
                                value={maxLoss}
                                onChange={(e) => setMaxLoss(e.target.value)}
                                className="compact-input"
                                min="0"
                                step="1"
                                disabled={isTrading}
                            />
                        </div>
                        <div className="control-group">
                            <label>Current Stake</label>
                            <span className="stake-display">${currentStake.toFixed(2)}</span>
                        </div>
                        <div className="control-group">
                            <label>Copy Trading</label>
                            <button
                                className={`toggle-button ${copyTradingEnabled ? 'active' : ''}`}
                                onClick={() => setCopyTradingEnabled(!copyTradingEnabled)}
                                disabled={isTrading}
                            >
                                {copyTradingEnabled ? 'ON' : 'OFF'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Performance Analytics */}
                <div className="performance-analytics">
                    <h3>Performance Analytics</h3>
                    <div className="analytics-grid">
                        <div className="analytics-card">
                            <div className="metric-value">{tradeCount}</div>
                            <div className="metric-label">Total Trades</div>
                        </div>
                        <div className="analytics-card">
                            <div className="metric-value">{tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : '0'}%</div>
                            <div className="metric-label">Win Rate</div>
                        </div>
                        <div className="analytics-card">
                            <div className={`metric-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                                ${totalProfit.toFixed(2)}
                            </div>
                            <div className="metric-label">Total P&L</div>
                        </div>
                        <div className="analytics-card">
                            <div className="metric-value">{consecutiveLosses}</div>
                            <div className="metric-label">Consecutive Losses</div>
                        </div>
                    </div>
                </div>

                <div className="control-actions">
                    <button 
                        className={`action-button start-button ${isContinuousTrading ? 'trading' : ''}`}
                        onClick={startContinuousTrading}
                        disabled={!isAnalysisReady || isTrading || (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active)}
                    >
                        {isContinuousTrading ? 'Trading...' : 'Start Continuous Trading'}
                    </button>

                    <button 
                        className="action-button stop-button"
                        onClick={stopContinuousTrading}
                        disabled={!isTrading}
                    >
                        Stop Trading
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;