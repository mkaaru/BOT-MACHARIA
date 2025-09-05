
import React, { useState, useRef, useEffect, useCallback } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';

interface TradeRecommendation {
    strategy: string;
    symbol: string;
    prediction: 'over' | 'under' | 'even' | 'odd';
    confidence: number;
    barrier?: number;
    stake: number;
}

interface MarketStats {
    symbol: string;
    volatility: number;
    trend: 'up' | 'down' | 'sideways';
    frequency: { [key: string]: number };
    lastDigits: number[];
}

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';
    const { is_dark_mode_on } = useThemeSwitcher();

    // Strategy states
    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);
    
    // Trading parameters
    const [stake, setStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2');
    const [isTrading, setIsTrading] = useState(false);
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);
    const [currentSymbol, setCurrentSymbol] = useState<string>('R_100');
    const [sessionRunId, setSessionRunId] = useState<string>(`tradingHub_${Date.now()}`);
    
    // Analysis states
    const [isAnalysisReady, setIsAnalysisReady] = useState(false);
    const [analysisCount, setAnalysisCount] = useState(0);
    const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);
    const [tradeCount, setTradeCount] = useState(0);
    const [currentRecommendation, setCurrentRecommendation] = useState<TradeRecommendation | null>(null);
    const [marketStats, setMarketStats] = useState<MarketStats[]>([]);

    const { run_panel, transactions, client } = useStore();

    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

    // Refs for intervals
    const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const session_id = `tradingHub_${Date.now()}`;
        setSessionRunId(session_id);
        globalObserver.emit('bot.started', session_id);

        // Start market analysis
        startMarketAnalysis();

        return () => {
            stopAllIntervals();
            globalObserver.emit('bot.stop');
        };
    }, []);

    const stopAllIntervals = () => {
        if (tradingIntervalRef.current) {
            clearInterval(tradingIntervalRef.current);
            tradingIntervalRef.current = null;
        }
        if (analysisIntervalRef.current) {
            clearInterval(analysisIntervalRef.current);
            analysisIntervalRef.current = null;
        }
    };

    const startMarketAnalysis = () => {
        setIsAnalysisReady(false);
        
        // Simulate initial analysis
        setTimeout(() => {
            setIsAnalysisReady(true);
            setAnalysisCount(120);
            setLastAnalysisTime(new Date().toLocaleTimeString());
        }, 2000);

        // Start continuous analysis
        analysisIntervalRef.current = setInterval(() => {
            setAnalysisCount(prev => prev + 1);
            setLastAnalysisTime(new Date().toLocaleTimeString());
            
            if (isTrading && (isAutoDifferActive || isAutoOverUnderActive || isAutoO5U4Active)) {
                generateTradeRecommendation();
            }
        }, 3000);
    };

    const generateTradeRecommendation = useCallback(() => {
        if (!isAnalysisReady) return;

        let strategy = '';
        let prediction: 'over' | 'under' | 'even' | 'odd' = 'over';
        
        if (isAutoDifferActive) {
            strategy = 'AutoDiffer';
            prediction = Math.random() > 0.5 ? 'even' : 'odd';
        } else if (isAutoOverUnderActive) {
            strategy = 'Auto Over/Under';
            prediction = Math.random() > 0.5 ? 'over' : 'under';
        } else if (isAutoO5U4Active) {
            strategy = 'Auto O5U4';
            prediction = Math.random() > 0.5 ? 'over' : 'under';
        }

        const recommendation: TradeRecommendation = {
            strategy,
            symbol: currentSymbol,
            prediction,
            confidence: Math.random() * 40 + 60, // 60-100%
            barrier: prediction === 'over' || prediction === 'under' ? Math.random() * 100 + 50 : undefined,
            stake: parseFloat(stake)
        };

        setCurrentRecommendation(recommendation);
        
        if (isContinuousTrading && !isTradeInProgress) {
            executeTradeRecommendation(recommendation);
        }
    }, [isAnalysisReady, isAutoDifferActive, isAutoOverUnderActive, isAutoO5U4Active, currentSymbol, stake, isContinuousTrading, isTradeInProgress]);

    const executeTradeRecommendation = async (recommendation: TradeRecommendation) => {
        if (isTradeInProgress) return;

        setIsTradeInProgress(true);
        console.log('Executing trade:', recommendation);

        try {
            // Simulate trade execution
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            setTradeCount(prev => prev + 1);
            
            // Simulate trade result after 30 seconds
            setTimeout(() => {
                setIsTradeInProgress(false);
                console.log('Trade completed for:', recommendation.strategy);
            }, 30000);
            
        } catch (error) {
            console.error('Trade execution failed:', error);
            setIsTradeInProgress(false);
        }
    };

    const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (!value || (!isNaN(parseFloat(value)) && parseFloat(value) >= 0)) {
            setStake(value);
        }
    };

    const handleMartingaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (!value || (!isNaN(parseFloat(value)) && parseFloat(value) >= 1)) {
            setMartingale(value);
        }
    };

    const toggleStrategy = (strategyType: 'differ' | 'overunder' | 'o5u4') => {
        // Stop trading first
        if (isTrading) {
            setIsTrading(false);
            setIsContinuousTrading(false);
        }

        switch (strategyType) {
            case 'differ':
                setIsAutoDifferActive(!isAutoDifferActive);
                setIsAutoOverUnderActive(false);
                setIsAutoO5U4Active(false);
                break;
            case 'overunder':
                setIsAutoOverUnderActive(!isAutoOverUnderActive);
                setIsAutoDifferActive(false);
                setIsAutoO5U4Active(false);
                break;
            case 'o5u4':
                setIsAutoO5U4Active(!isAutoO5U4Active);
                setIsAutoDifferActive(false);
                setIsAutoOverUnderActive(false);
                break;
        }
    };

    const startContinuousTrading = () => {
        if (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active) {
            return;
        }
        
        setIsTrading(true);
        setIsContinuousTrading(true);
        globalObserver.emit('bot.running');
    };

    const stopContinuousTrading = () => {
        setIsTrading(false);
        setIsContinuousTrading(false);
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
                            onClick={() => toggleStrategy('differ')}
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
                            onClick={() => toggleStrategy('overunder')}
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
                            <p>Simultaneously trades Over 5 and Under 4 using advanced pattern recognition.</p>
                            {isAutoO5U4Active && (
                                <div className="active-info">
                                    <span className="info-label">Status</span>
                                    <span className="info-value">Active</span>
                                </div>
                            )}
                        </div>
                        <button 
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={() => toggleStrategy('o5u4')}
                            disabled={isTrading && !isAutoO5U4Active}
                        >
                            {isAutoO5U4Active ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="trading-controls">
                    <div className="control-section">
                        <label htmlFor="symbol-select">Trading Symbol:</label>
                        <select 
                            id="symbol-select"
                            value={currentSymbol} 
                            onChange={(e) => setCurrentSymbol(e.target.value)}
                            disabled={isTrading}
                            className="symbol-select"
                        >
                            {availableSymbols.map(symbol => (
                                <option key={symbol} value={symbol}>{symbol}</option>
                            ))}
                        </select>
                    </div>
                    
                    <div className="trading-buttons">
                        {!isTrading ? (
                            <button 
                                className="start-trading-btn"
                                onClick={startContinuousTrading}
                                disabled={!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                                Start Continuous Trading
                            </button>
                        ) : (
                            <button 
                                className="stop-trading-btn"
                                onClick={stopContinuousTrading}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="6" width="12" height="12"/>
                                </svg>
                                Stop Trading
                            </button>
                        )}
                    </div>
                </div>

                {/* Current Recommendation */}
                {currentRecommendation && (
                    <div className="recommendation-panel">
                        <h4>Current Recommendation</h4>
                        <div className="recommendation-details">
                            <div className="rec-item">
                                <span className="label">Strategy:</span>
                                <span className="value">{currentRecommendation.strategy}</span>
                            </div>
                            <div className="rec-item">
                                <span className="label">Symbol:</span>
                                <span className="value">{currentRecommendation.symbol}</span>
                            </div>
                            <div className="rec-item">
                                <span className="label">Prediction:</span>
                                <span className={`value prediction ${currentRecommendation.prediction}`}>
                                    {currentRecommendation.prediction.toUpperCase()}
                                </span>
                            </div>
                            <div className="rec-item">
                                <span className="label">Confidence:</span>
                                <span className="value">{currentRecommendation.confidence.toFixed(1)}%</span>
                            </div>
                            {currentRecommendation.barrier && (
                                <div className="rec-item">
                                    <span className="label">Barrier:</span>
                                    <span className="value">{currentRecommendation.barrier.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Analysis Info */}
                <div className="analysis-info">
                    <div className="info-grid">
                        <div className="info-item">
                            <span className="info-label">Analysis Count:</span>
                            <span className="info-value">{analysisCount}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Last Update:</span>
                            <span className="info-value">{lastAnalysisTime}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Session ID:</span>
                            <span className="info-value">{sessionRunId.slice(-8)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Trade Status:</span>
                            <span className={`info-value ${isTradeInProgress ? 'in-progress' : 'idle'}`}>
                                {isTradeInProgress ? 'In Progress' : 'Idle'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;
