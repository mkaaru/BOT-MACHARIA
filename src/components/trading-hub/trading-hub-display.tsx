import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import marketAnalyzer, { TradeRecommendation } from '../../services/market-analyzer';

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';

    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);
    const [recommendation, setRecommendation] = useState<TradeRecommendation | null>(null);
    const [marketStats, setMarketStats] = useState<Record<string, any>>({});
    const [stake, setStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2');
    const [isTrading, setIsTrading] = useState(false);
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);
    const [currentBarrier, setCurrentBarrier] = useState<number | null>(null);
    const [currentSymbol, setCurrentSymbol] = useState<string>('R_100');
    const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [sessionRunId, setSessionRunId] = useState<string>(`tradingHub_${Date.now()}`);
    const [isAnalysisReady, setIsAnalysisReady] = useState(false);
    const analysisReadinessInterval = useRef<NodeJS.Timeout | null>(null);
    const [analysisCount, setAnalysisCount] = useState(0);
    const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');
    const analysisInfoInterval = useRef<NodeJS.Timeout | null>(null);
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);
    const [lastTradeId, setLastTradeId] = useState<string>('');
    const [tradeCount, setTradeCount] = useState(0);
    const lastTradeTime = useRef<number>(0);
    const minimumTradeCooldown = 3000;

    const [initialStake, setInitialStake] = useState(MINIMUM_STAKE);
    const [appliedStake, setAppliedStake] = useState(MINIMUM_STAKE);
    const [lastTradeWin, setLastTradeWin] = useState<boolean | null>(null);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);

    const [lastTradeResult, setLastTradeResult] = useState<string>('');
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);
    const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string; contractId: string | null }>({
        success: false,
        message: '',
        contractId: null,
    });

    const { run_panel, transactions, client } = useStore();

    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

    const manageStake = (action: 'init' | 'reset' | 'martingale' | 'update' | 'get', params?: { newValue?: string; lossCount?: number }): string => {
        switch (action) {
            case 'init':
                if (params?.newValue) {
                    const validValue = Math.max(parseFloat(params.newValue), parseFloat(MINIMUM_STAKE)).toFixed(2);
                    setInitialStake(validValue);
                    setAppliedStake(validValue);
                    try {
                        localStorage.setItem('tradingHub_initialStake', validValue);
                    } catch (e) {
                        console.warn('Could not save stake to localStorage', e);
                    }
                }
                break;

            case 'reset':
                const storedInitialStake = localStorage.getItem('tradingHub_initialStake') || initialStake;
                setAppliedStake(storedInitialStake);
                setConsecutiveLosses(0);
                break;

            case 'martingale':
                const newLossCount = params?.lossCount !== undefined ? params.lossCount : consecutiveLosses + 1;
                const baseStake = localStorage.getItem('tradingHub_initialStake') || initialStake;
                const multiplier = parseFloat(martingale);
                const newStake = (parseFloat(baseStake) * Math.pow(multiplier, Math.min(newLossCount, 10))).toFixed(2);

                setAppliedStake(newStake);
                setConsecutiveLosses(newLossCount);
                break;

            case 'update':
                if (params?.newValue !== undefined) {
                    setStake(params.newValue);
                }
                break;

            case 'get':
                return appliedStake;

            default:
                console.error('Unknown stake management action:', action);
        }

        return appliedStake;
    };

    const updateTradeStats = (win: boolean) => {
        if (win) {
            setWinCount(prev => prev + 1);
            setLastTradeResult('WIN');
            setConsecutiveLosses(0);
            manageStake('reset'); // Reset stake after a win
        } else {
            setLossCount(prev => prev + 1);
            setLastTradeResult('LOSS');
            manageStake('martingale'); // Apply martingale after a loss
        }
    };

    useEffect(() => {
        try {
            const savedStake = localStorage.getItem('tradingHub_initialStake');
            if (savedStake) {
                setInitialStake(savedStake);
                setStake(savedStake);
            }

            const savedMartingale = localStorage.getItem('tradingHub_martingale');
            if (savedMartingale) {
                setMartingale(savedMartingale);
            }
        } catch (e) {
            console.warn('Could not load settings from localStorage', e);
        }
    }, [client?.loginid]);

    useEffect(() => {
        const session_id = `tradingHub_${Date.now()}`;
        setSessionRunId(session_id);
        globalObserver.emit('bot.started', session_id);

        marketAnalyzer.start();

        analysisReadinessInterval.current = setInterval(() => {
            if (marketAnalyzer.isReadyForTrading()) {
                setIsAnalysisReady(true);
                if (analysisReadinessInterval.current) {
                    clearInterval(analysisReadinessInterval.current);
                }
            }
        }, 500);

        analysisInfoInterval.current = setInterval(() => {
            const info = marketAnalyzer.getAnalyticsInfo();
            setAnalysisCount(info.analysisCount);
            setLastAnalysisTime(info.lastAnalysisTime ? new Date(info.lastAnalysisTime).toLocaleTimeString() : '');
        }, 1000);

        const unsubscribe = marketAnalyzer.onAnalysis((newRecommendation, allStats) => {
            setRecommendation(newRecommendation);
            setMarketStats(allStats);

            if (isContinuousTrading && isAutoOverUnderActive && newRecommendation) {
                setCurrentStrategy(newRecommendation.strategy);
                setCurrentSymbol(newRecommendation.symbol);
            }
        });

        return () => {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
            }
            if (analysisReadinessInterval.current) {
                clearInterval(analysisReadinessInterval.current);
            }
            if (analysisInfoInterval.current) {
                clearInterval(analysisInfoInterval.current);
            }
            globalObserver.emit('bot.stopped');
            marketAnalyzer.stop();
            unsubscribe();
        };
    }, []);

    const executeTrade = async (strategy: string, symbol: string, direction: string, barrier?: string) => {
        try {
            setIsTradeInProgress(true);

            const currentStake = manageStake('get');

            const tradePayload: any = {
                buy: 1,
                price: parseFloat(currentStake),
                parameters: {
                    contract_type: direction === 'over' ? 'DIGITOVER' : direction === 'under' ? 'DIGITUNDER' : 'DIGITDIFF',
                    symbol: symbol,
                    duration: 1,
                    duration_unit: 't'
                }
            };

            if (barrier) {
                tradePayload.parameters.barrier = barrier;
            }

            console.log(`Executing trade with payload:`, tradePayload);
            const response = await api_base.api.send(tradePayload);

            if (response.error) {
                console.error('Trade execution failed:', response);
                console.error('Error details:', response.error);
                setTradeResult({
                    success: false,
                    message: `Trade failed: ${response.error.message || 'Unknown error'}`,
                    contractId: null
                });
            } else {
                console.log('Trade executed successfully:', response);
                setTradeResult({
                    success: true,
                    message: 'Trade executed successfully',
                    contractId: response.buy?.contract_id || null
                });
                updateTradeStats(true);
            }

        } catch (error) {
            console.error('Trade execution failed:', error);
            setTradeResult({
                success: false,
                message: `An unexpected error occurred: ${error.message || 'Unknown error'}`,
                contractId: null
            });
        } finally {
            setIsTradeInProgress(false);
        }

        return false;
    };

    const executeDigitDifferTrade = async () => {
        if (!recommendation || !isAutoDifferActive) return;

        const success = await executeTrade('Differ', recommendation.symbol, 'differ');
        if (success) {
            console.log('Auto Differ trade executed');
        }
    };

    const executeDigitOverTrade = () => {
        if (!recommendation || !isAutoOverUnderActive) return;

        console.log('Executing Over/Under trade with recommendation:', recommendation);

        executeTrade(
            'auto_over_under',
            recommendation.symbol,
            recommendation.strategy,
            recommendation.barrier
        );
    };

    const executeO5U4Trade = async () => {
        if (!isAutoO5U4Active) return;

        // Execute both Over 5 and Under 4 trades simultaneously
        const over5Success = await executeTrade('O5U4', 'R_100', 'over', '5');
        const under4Success = await executeTrade('O5U4', 'R_100', 'under', '4');

        if (over5Success || under4Success) {
            console.log('O5U4 dual trades executed');
        }
    };

    const toggleStrategy = (strategy: string) => {
        switch (strategy) {
            case 'differ':
                setIsAutoDifferActive(!isAutoDifferActive);
                if (!isAutoDifferActive) {
                    setIsAutoOverUnderActive(false);
                    setIsAutoO5U4Active(false);
                }
                break;
            case 'overunder':
                setIsAutoOverUnderActive(!isAutoOverUnderActive);
                if (!isAutoOverUnderActive) {
                    setIsAutoDifferActive(false);
                    setIsAutoO5U4Active(false);
                }
                break;
            case 'o5u4':
                setIsAutoO5U4Active(!isAutoO5U4Active);
                if (!isAutoO5U4Active) {
                    setIsAutoDifferActive(false);
                    setIsAutoOverUnderActive(false);
                }
                break;
        }
    };

    const toggleContinuousTrading = () => {
        setIsContinuousTrading(!isContinuousTrading);
        if (!isContinuousTrading) {
            setIsTrading(true);
            globalObserver.emit('bot.started', sessionRunId);
            run_panel.setIsRunning(true);
        } else {
            setIsTrading(false);
            globalObserver.emit('bot.stopped');
            run_panel.setIsRunning(false);
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
            }
        }
    };

    useEffect(() => {
        if (isContinuousTrading && isAnalysisReady) {
            const intervalTime = 5000; // 5 seconds

            tradingIntervalRef.current = setInterval(() => {
                const now = Date.now();
                const timeSinceLastTrade = now - lastTradeTime.current;

                if (isTradeInProgress || timeSinceLastTrade < minimumTradeCooldown) {
                    return;
                }

                if (isAutoDifferActive) {
                    executeDigitDifferTrade();
                } else if (isAutoOverUnderActive) {
                    executeDigitOverTrade();
                } else if (isAutoO5U4Active) {
                    executeO5U4Trade();
                }
            }, intervalTime);
        } else {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
                tradingIntervalRef.current = null;
            }
        }

        return () => {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
            }
        };
    }, [isContinuousTrading, isAnalysisReady, isAutoDifferActive, isAutoOverUnderActive, isAutoO5U4Active, recommendation]);

    return (
        <div className="trading-hub-modern">
            <div className="hub-header">
                <div className="header-main">
                    <div className="logo-section">
                        <div className="logo-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                            </svg>
                        </div>
                        <div className="title-group">
                            <h1 className="hub-title">Trading Hub</h1>
                            <p className="hub-subtitle">AI-Powered Trading Strategies</p>
                        </div>
                    </div>
                    <div className="settings-controls">
                        <div className="control-group">
                            <label>Initial Stake</label>
                            <input
                                type="number"
                                value={stake}
                                onChange={(e) => {
                                    setStake(e.target.value);
                                    manageStake('init', { newValue: e.target.value });
                                }}
                                className="compact-input"
                                step="0.01"
                                min={MINIMUM_STAKE}
                            />
                        </div>
                        <div className="control-group">
                            <label>Martingale</label>
                            <input
                                type="number"
                                value={martingale}
                                onChange={(e) => setMartingale(e.target.value)}
                                className="compact-input"
                                step="0.1"
                                min="1"
                            />
                        </div>
                    </div>
                </div>
                <div className="status-bar">
                    <div className={`status-item ${isAnalysisReady ? 'active-trade' : ''}`}>
                        <div className={isAnalysisReady ? 'status-dot' : 'pulse-dot'}></div>
                        Market Analysis: {isAnalysisReady ? 'Ready' : 'Loading...'}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        Analysis Count: {analysisCount}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        Last Update: {lastAnalysisTime || 'N/A'}
                    </div>
                </div>
            </div>

            <div className="trading-hub-content">
                <div className="strategy-grid">
                    {/* Auto Differ Strategy */}
                    <div className={`strategy-card ${isAutoDifferActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto Differ</h4>
                                <p>Digit difference prediction</p>
                            </div>
                            <div className={`strategy-status ${isAutoDifferActive ? 'on' : 'off'}`}>
                                {isAutoDifferActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className="card-content">
                            <p>Advanced digit analysis with pattern recognition for differ contracts.</p>
                            {isAutoDifferActive && recommendation && (
                                <div className="active-info">
                                    <span className="info-label">Current Signal</span>
                                    <div className="info-value">
                                        {recommendation.symbol} - {recommendation.reason}
                                    </div>
                                </div>
                            )}
                            {isAutoDifferActive && !recommendation && (
                                <div className="analyzing-state">
                                    <div className="spinner"></div>
                                    <span>Analyzing market patterns...</span>
                                </div>
                            )}
                        </div>
                        <button
                            className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                            onClick={() => toggleStrategy('differ')}
                            disabled={!isAnalysisReady}
                        >
                            {isAutoDifferActive ? 'Deactivate Strategy' : 'Activate Strategy'}
                        </button>
                    </div>

                    {/* Auto Over/Under Strategy */}
                    <div className={`strategy-card ${isAutoOverUnderActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M7 14l5-5 5 5z"/>
                                    <path d="M7 10l5 5 5-5z"/>
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto Over/Under</h4>
                                <p>Dynamic barrier trading</p>
                            </div>
                            <div className={`strategy-status ${isAutoOverUnderActive ? 'on' : 'off'}`}>
                                {isAutoOverUnderActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className="card-content">
                            <p>AI-driven over/under predictions with real-time market analysis.</p>
                            {isAutoOverUnderActive && recommendation && (
                                <div className="recommendation-card">
                                    <div className="rec-header">
                                        <span className="rec-label">AI Recommendation</span>
                                        <span className="rec-confidence">
                                            {((recommendation.overPercentage + recommendation.underPercentage) / 2).toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="rec-details">
                                        <div className="rec-item">
                                            <span>Symbol:</span>
                                            <strong>{recommendation.symbol}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Strategy:</span>
                                            <strong>{recommendation.strategy.toUpperCase()} {recommendation.barrier}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Pattern:</span>
                                            <span className="pattern-text">{recommendation.reason}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {isAutoOverUnderActive && !recommendation && (
                                <div className="analyzing-state">
                                    <div className="spinner"></div>
                                    <span>Scanning for opportunities...</span>
                                </div>
                            )}
                        </div>
                        <button
                            className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                            onClick={() => toggleStrategy('overunder')}
                            disabled={!isAnalysisReady}
                        >
                            {isAutoOverUnderActive ? 'Deactivate Strategy' : 'Activate Strategy'}
                        </button>
                    </div>

                    {/* Auto O5U4 Strategy */}
                    <div className={`strategy-card ${isAutoO5U4Active ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto O5U4</h4>
                                <p>Dual contract strategy</p>
                            </div>
                            <div className={`strategy-status ${isAutoO5U4Active ? 'on' : 'off'}`}>
                                {isAutoO5U4Active ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className="card-content">
                            <p>Simultaneous Over 5 and Under 4 contracts for maximum coverage.</p>
                            {isAutoO5U4Active && (
                                <div className="o5u4-info">
                                    <div className="active-info">
                                        <span className="info-label">Strategy</span>
                                        <div className="info-value">
                                            Over 5 + Under 4 on R_100
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={() => toggleStrategy('o5u4')}
                            disabled={!isAnalysisReady}
                        >
                            {isAutoO5U4Active ? 'Deactivate Strategy' : 'Activate Strategy'}
                        </button>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="trading-controls">
                    <button
                        className={`main-trade-btn ${isContinuousTrading ? 'stop' : 'start'} ${!isAnalysisReady || !(isAutoDifferActive || isAutoOverUnderActive || isAutoO5U4Active) ? 'disabled' : ''}`}
                        onClick={toggleContinuousTrading}
                        disabled={!isAnalysisReady || !(isAutoDifferActive || isAutoOverUnderActive || isAutoO5U4Active)}
                    >
                        <div className="btn-content">
                            <div className="btn-icon">
                                {isContinuousTrading ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="4" width="4" height="16"/>
                                        <rect x="14" y="4" width="4" height="16"/>
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="8,5 8,19 19,12"/>
                                    </svg>
                                )}
                            </div>
                            <span>
                                {isContinuousTrading ? 'Stop Trading' : 'Start Trading'}
                                {isTradeInProgress && (
                                    <div className="trade-lock">
                                        <span className="lock-icon">🔒</span>
                                        <span>Trade in progress...</span>
                                    </div>
                                )}
                            </span>
                        </div>
                        <div className="btn-glow"></div>
                    </button>
                </div>

                {/* Statistics Dashboard */}
                <div className="stats-dashboard">
                    <div className="stats-grid">
                        <div className="stat-card wins">
                            <div className="stat-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="L9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <div className="stat-value">{winCount}</div>
                                <div className="stat-label">Wins</div>
                            </div>
                        </div>
                        <div className="stat-card losses">
                            <div className="stat-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <div className="stat-value">{lossCount}</div>
                                <div className="stat-label">Losses</div>
                            </div>
                        </div>
                        <div className="stat-card winrate">
                            <div className="stat-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="l9 12 2 2 4-4"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <div className="stat-value">
                                    {tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : '0'}%
                                </div>
                                <div className="stat-label">Win Rate</div>
                            </div>
                        </div>
                        <div className="stat-card martingale">
                            <div className="stat-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <div className="stat-value">{appliedStake}</div>
                                <div className="stat-label">Current Stake</div>
                            </div>
                        </div>
                    </div>

                    {lastTradeResult && (
                        <div className={`last-trade-result ${lastTradeResult.toLowerCase()}`}>
                            <div className="result-icon">
                                {lastTradeResult === 'WIN' ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="L9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                    </svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                    </svg>
                                )}
                            </div>
                            <span>Last Trade: {lastTradeResult}</span>
                        </div>
                    )}
                </div>

                {/* Analysis Information */}
                <div className="analysis-info">
                    <div className="analysis-header">
                        <div className="ai-badge">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="m12 1 3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/>
                            </svg>
                            <span>AI Analysis Engine</span>
                        </div>
                        <div className="analysis-time">
                            {isAnalysisReady ? `Ready • ${analysisCount} analyses` : 'Initializing...'}
                        </div>
                    </div>
                    <div className="analysis-details">
                        <div className="detail-item">
                            <span>Market Coverage</span>
                            <strong>{availableSymbols.length} symbols</strong>
                        </div>
                        <div className="detail-item">
                            <span>Analysis Frequency</span>
                            <strong>Real-time</strong>
                        </div>
                        <div className="detail-item">
                            <span>Active Strategy</span>
                            <strong>
                                {isAutoDifferActive ? 'Auto Differ' : 
                                 isAutoOverUnderActive ? 'Auto Over/Under' : 
                                 isAutoO5U4Active ? 'Auto O5U4' : 'None'}
                            </strong>
                        </div>
                        <div className="detail-item">
                            <span>Total Trades</span>
                            <strong>{tradeCount}</strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;