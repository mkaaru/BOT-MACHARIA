import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';

interface TradingStrategy {
    id: string;
    name: string;
    description: string;
    isActive: boolean;
    icon: string;
    prediction?: string;
    confidence?: number;
}

const TradingHubDisplay: React.FC = () => {
    const { run_panel } = useStore();
    const MINIMUM_STAKE = '0.35';

    // Core state
    const [initialStake, setInitialStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2');
    const [isConnected, setIsConnected] = useState(false);
    const [isTradingActive, setIsTradingActive] = useState(false);

    // Analysis state
    const [analysisCount, setAnalysisCount] = useState(78);
    const [lastUpdateTime, setLastUpdateTime] = useState('1:32:17 PM');
    const [isAnalysisReady, setIsAnalysisReady] = useState(true);

    // Strategy states
    const [strategies, setStrategies] = useState<TradingStrategy[]>([
        {
            id: 'auto_differ',
            name: 'Auto Differ',
            description: 'Digit difference prediction',
            isActive: false,
            icon: '📊',
            prediction: 'DIFFERS',
            confidence: 85
        },
        {
            id: 'auto_over_under',
            name: 'Auto Over/Under',
            description: 'AI-driven over/under predictions with real-time market analysis',
            isActive: true,
            icon: '📈',
            prediction: 'OVER 5',
            confidence: 94.5
        },
        {
            id: 'auto_o5u4',
            name: 'Auto O5U4',
            description: 'Simultaneous Over 5 and Under 4 contracts for maximum coverage',
            isActive: false,
            icon: '⚡',
        }
    ]);

    // Trading session state
    const [sessionStats, setSessionStats] = useState({
        totalStake: '0.00',
        totalPayout: '0.00',
        noOfRuns: 0,
        contractsLost: 0,
        contractsWon: 0,
        totalProfitLoss: '0.00'
    });

    useEffect(() => {
        // Initialize connection status
        checkConnection();

        // Set up intervals for updates
        const updateInterval = setInterval(() => {
            setLastUpdateTime(new Date().toLocaleTimeString('en-US', { 
                hour12: true, 
                hour: 'numeric', 
                minute: '2-digit', 
                second: '2-digit' 
            }));
        }, 1000);

        return () => clearInterval(updateInterval);
    }, []);

    const checkConnection = async () => {
        try {
            if (api_base.api?.connection?.readyState === 1) {
                setIsConnected(true);
            } else {
                await api_base.init();
                setIsConnected(true);
            }
        } catch (error) {
            console.error('Connection failed:', error);
            setIsConnected(false);
        }
    };

    const toggleStrategy = (strategyId: string) => {
        setStrategies(prev => prev.map(strategy => ({
            ...strategy,
            isActive: strategy.id === strategyId ? !strategy.isActive : false
        })));
    };

    const activateStrategy = async (strategyId: string) => {
        if (!isConnected) {
            globalObserver.emit('ui.log.error', 'Not connected to trading server');
            return;
        }

        try {
            toggleStrategy(strategyId);
            globalObserver.emit('ui.log.success', `${strategyId} strategy activated`);
        } catch (error) {
            console.error('Strategy activation failed:', error);
            globalObserver.emit('ui.log.error', 'Failed to activate strategy');
        }
    };

    const handleStopTrading = () => {
        setStrategies(prev => prev.map(strategy => ({
            ...strategy,
            isActive: false
        })));
        setIsTradingActive(false);
        run_panel.setIsRunning(false);
        globalObserver.emit('ui.log.info', 'All trading strategies stopped');
    };

    const downloadStrategy = (strategyName: string) => {
        globalObserver.emit('ui.log.info', `Downloading ${strategyName} strategy`);
    };

    return (
        <div className="trading-hub-container">
            {/* Header */}
            <div className="hub-header">
                <div className="header-content">
                    <div className="logo-section">
                        <div className="hub-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                            </svg>
                        </div>
                        <div className="title-group">
                            <h1>Trading Hub</h1>
                            <p>AI-Powered Trading Strategies</p>
                        </div>
                    </div>

                    <div className="header-controls">
                        <div className="control-item">
                            <label>Initial Stake</label>
                            <input
                                type="number"
                                value={initialStake}
                                onChange={(e) => setInitialStake(e.target.value)}
                                min={MINIMUM_STAKE}
                                step="0.01"
                                className="stake-input"
                            />
                        </div>
                        <div className="control-item">
                            <label>Martingale</label>
                            <input
                                type="number"
                                value={martingale}
                                onChange={(e) => setMartingale(e.target.value)}
                                min="1"
                                step="0.1"
                                className="martingale-input"
                            />
                        </div>
                    </div>
                </div>

                {/* Status Bar */}
                <div className="status-bar">
                    <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                        <div className="status-dot"></div>
                        {isConnected ? 'Connected' : 'Disconnected'}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        <span className={`analysis-status ${isAnalysisReady ? 'ready' : 'loading'}`}>
                            Market Analysis: {isAnalysisReady ? 'Ready' : 'Loading...'}
                        </span>
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">Analysis Count: {analysisCount}</div>
                    <div className="status-separator"></div>
                    <div className="status-item">Last Update: {lastUpdateTime}</div>
                </div>
            </div>

            {/* Strategy Grid */}
            <div className="strategies-grid">
                {strategies.map(strategy => (
                    <div 
                        key={strategy.id}
                        className={`strategy-card ${strategy.isActive ? 'active' : ''}`}
                    >
                        <div className="card-header">
                            <div className="strategy-info">
                                <div className="strategy-icon">{strategy.icon}</div>
                                <div className="strategy-details">
                                    <h3>{strategy.name}</h3>
                                    <p>{strategy.description}</p>
                                </div>
                            </div>
                            <div className={`strategy-status ${strategy.isActive ? 'on' : 'off'}`}>
                                {strategy.isActive ? 'ON' : 'OFF'}
                            </div>
                        </div>

                        {strategy.isActive && strategy.prediction && (
                            <div className="prediction-info">
                                <div className="prediction-row">
                                    <span className="label">Signal:</span>
                                    <span className="value">{strategy.prediction}</span>
                                </div>
                                {strategy.confidence && (
                                    <div className="prediction-row">
                                        <span className="label">Confidence:</span>
                                        <span className="value">{strategy.confidence}%</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="card-actions">
                            <button
                                className={`activate-btn ${strategy.isActive ? 'stop' : 'start'}`}
                                onClick={() => activateStrategy(strategy.id)}
                            >
                                {strategy.isActive ? 'Deactivate' : 'Activate Strategy'}
                            </button>
                            <button
                                className="download-btn"
                                onClick={() => downloadStrategy(strategy.name)}
                            >
                                Download Strategy
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Session Summary */}
            <div className="session-summary">
                <div className="summary-header">
                    <h3>What's this?</h3>
                </div>
                <div className="summary-stats">
                    <div className="stat-group">
                        <div className="stat-item">
                            <span className="stat-label">Total stake</span>
                            <span className="stat-value">{sessionStats.totalStake} USD</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Total payout</span>
                            <span className="stat-value">{sessionStats.totalPayout} USD</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">No. of runs</span>
                            <span className="stat-value">{sessionStats.noOfRuns}</span>
                        </div>
                    </div>
                    <div className="stat-group">
                        <div className="stat-item">
                            <span className="stat-label">Contracts lost</span>
                            <span className="stat-value">{sessionStats.contractsLost}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Contracts won</span>
                            <span className="stat-value">{sessionStats.contractsWon}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Total profit/loss</span>
                            <span className="stat-value">{sessionStats.totalProfitLoss} USD</span>
                        </div>
                    </div>
                </div>
                <button className="reset-btn">Reset</button>
            </div>

            {/* Stop Trading Button */}
            {strategies.some(s => s.isActive) && (
                <div className="stop-trading-container">
                    <button
                        className="stop-trading-btn"
                        onClick={handleStopTrading}
                    >
                        ⏸ Stop Trading
                    </button>
                </div>
            )}
        </div>
    );
};

export default TradingHubDisplay;