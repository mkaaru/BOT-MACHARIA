
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

    const { run_panel, transactions, client } = useStore();

    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

    useEffect(() => {
        const session_id = `tradingHub_${Date.now()}`;
        setSessionRunId(session_id);
        globalObserver.emit('bot.started', session_id);

        return () => {
            globalObserver.emit('bot.stop');
        };
    }, []);

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

                <div className="trading-controls">
                    <button 
                        className={`main-trade-btn ${isContinuousTrading ? 'active' : ''}`}
                        onClick={isContinuousTrading ? stopContinuousTrading : startContinuousTrading}
                        disabled={!isAnalysisReady || (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active)}
                    >
                        {isContinuousTrading ? 'Stop Trading' : 'Start Continuous Trading'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;
