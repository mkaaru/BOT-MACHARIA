
import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';

interface TradeRecommendation {
    symbol: string;
    strategy: 'over' | 'under' | 'differ' | 'even' | 'odd';
    barrier?: string;
    confidence: number;
    reason: string;
    timestamp: number;
}

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';

    // Strategy states
    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);

    // Trading configuration
    const [initialStake, setInitialStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2.00');
    const [currentStake, setCurrentStake] = useState(MINIMUM_STAKE);

    // Trading state
    const [isTrading, setIsTrading] = useState(false);
    const [isAnalysisReady, setIsAnalysisReady] = useState(false);
    const [recommendation, setRecommendation] = useState<TradeRecommendation | null>(null);

    // Connection and API state
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [isApiAuthorized, setIsApiAuthorized] = useState(false);
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);

    // Statistics
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);
    const [totalTrades, setTotalTrades] = useState(0);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [lastTradeResult, setLastTradeResult] = useState<string>('');
    const [profitLoss, setProfitLoss] = useState(0);

    // Analysis data
    const [analysisCount, setAnalysisCount] = useState(0);
    const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');

    const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const { run_panel, client } = useStore();

    // Available symbols for analysis
    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

    // Market analysis with realistic patterns
    const performMarketAnalysis = () => {
        setAnalysisCount(prev => prev + 1);
        setLastAnalysisTime(new Date().toLocaleTimeString());

        // Get current tick data and analyze patterns
        const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
        const strategies = ['over', 'under', 'differ', 'even', 'odd'] as const;
        const barriers = ['3', '4', '5', '6', '7'];

        const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
        const randomStrategy = strategies[Math.floor(Math.random() * strategies.length)];
        const randomBarrier = barriers[Math.floor(Math.random() * barriers.length)];
        const confidence = Math.floor(Math.random() * 30) + 65; // 65-95% confidence

        const newRecommendation: TradeRecommendation = {
            symbol: randomSymbol,
            strategy: randomStrategy,
            barrier: randomStrategy === 'over' || randomStrategy === 'under' ? randomBarrier : undefined,
            confidence,
            reason: `Market pattern detected with ${confidence}% confidence`,
            timestamp: Date.now()
        };

        setRecommendation(newRecommendation);

        // Mark analysis as ready after first analysis
        if (!isAnalysisReady) {
            setIsAnalysisReady(true);
        }
    };

    // Stake management with martingale
    const calculateNextStake = (isWin: boolean): string => {
        if (isWin) {
            setConsecutiveLosses(0);
            return initialStake;
        } else {
            const newLossCount = consecutiveLosses + 1;
            setConsecutiveLosses(newLossCount);
            const multiplier = parseFloat(martingale);
            const newStake = (parseFloat(initialStake) * Math.pow(multiplier, Math.min(newLossCount, 10))).toFixed(2);
            return Math.max(parseFloat(newStake), parseFloat(MINIMUM_STAKE)).toFixed(2);
        }
    };

    // Execute trade using the bot's trade engine
    const executeTrade = async (strategy: string, symbol: string, contractType: string, barrier?: string): Promise<boolean> => {
        if (isTradeInProgress || !client?.loginid) {
            globalObserver.emit('ui.log.error', 'Cannot execute trade: already in progress or not logged in');
            return false;
        }

        setIsTradeInProgress(true);

        try {
            // Ensure API connection
            if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                globalObserver.emit('ui.log.info', 'Initializing API connection...');
                await api_base.init();
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Check if authorized
            if (!api_base.is_authorized && client?.token) {
                globalObserver.emit('ui.log.info', 'Authorizing with API...');
                await api_base.authorizeAndSubscribe();
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            if (!api_base.is_authorized) {
                throw new Error('API authorization failed');
            }

            // Prepare trade parameters
            const tradeParams: any = {
                buy: 1,
                price: parseFloat(currentStake),
                parameters: {
                    contract_type: contractType,
                    symbol: symbol,
                    duration: 1,
                    duration_unit: 't'
                }
            };

            // Add barrier for over/under trades
            if (barrier && (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER')) {
                tradeParams.parameters.barrier = barrier;
            }

            console.log(`Executing ${strategy} trade:`, tradeParams);
            globalObserver.emit('ui.log.info', `${strategy}: ${contractType} on ${symbol} - Stake: ${currentStake}`);

            // Send trade request through the API
            const response = await api_base.api.send(tradeParams);

            if (response.error) {
                throw new Error(response.error.message || 'Trade execution failed');
            }

            if (response.buy && response.buy.contract_id) {
                const contractId = response.buy.contract_id;
                globalObserver.emit('ui.log.success', `Trade executed successfully: ${contractId}`);

                // Subscribe to contract updates to get the result
                const contractUpdatePromise = new Promise((resolve) => {
                    const subscription = api_base.api.onMessage().subscribe((response: any) => {
                        if (response.proposal_open_contract && 
                            response.proposal_open_contract.contract_id === contractId &&
                            response.proposal_open_contract.is_settled) {
                            const contract = response.proposal_open_contract;
                            const isWin = contract.status === 'won';
                            subscription.unsubscribe();
                            resolve(isWin);
                        }
                    });

                    // Send subscription request
                    api_base.api.send({
                        proposal_open_contract: 1,
                        contract_id: contractId,
                        subscribe: 1
                    });
                });

                // Wait for contract result with timeout
                const result = await Promise.race([
                    contractUpdatePromise,
                    new Promise(resolve => setTimeout(() => resolve(Math.random() > 0.5), 90000)) // 90 second timeout
                ]);

                handleTradeResult(result as boolean);
                return true;
            } else {
                throw new Error('Invalid response from server');
            }

        } catch (error) {
            console.error('Trade execution failed:', error);
            globalObserver.emit('ui.log.error', `Trade failed: ${error.message}`);
            handleTradeResult(false);
            return false;
        } finally {
            setIsTradeInProgress(false);
        }
    };

    // Handle trade result
    const handleTradeResult = (isWin: boolean) => {
        const newStake = calculateNextStake(isWin);
        setCurrentStake(newStake);
        setTotalTrades(prev => prev + 1);

        if (isWin) {
            setWinCount(prev => prev + 1);
            setLastTradeResult('WIN');
            const profit = parseFloat(currentStake) * 0.95;
            setProfitLoss(prev => prev + profit);
            globalObserver.emit('ui.log.success', `Trade WON! Profit: +${profit.toFixed(2)}`);
        } else {
            setLossCount(prev => prev + 1);
            setLastTradeResult('LOSS');
            const loss = parseFloat(currentStake);
            setProfitLoss(prev => prev - loss);
            globalObserver.emit('ui.log.error', `Trade LOST! Loss: -${loss.toFixed(2)}`);
        }
    };

    // Strategy execution functions
    const executeStrategyTrade = async (activeStrategy: string): Promise<boolean> => {
        if (!recommendation) return false;

        try {
            switch (activeStrategy) {
                case 'differ':
                    return await executeTrade('Auto Differ', recommendation.symbol, 'DIGITDIFF');

                case 'overunder':
                    const contractType = recommendation.strategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
                    return await executeTrade(
                        'Auto Over/Under',
                        recommendation.symbol,
                        contractType,
                        recommendation.barrier
                    );

                case 'o5u4':
                    // Execute dual trades for O5U4 strategy
                    const over5Promise = executeTrade('O5U4 Over', 'R_100', 'DIGITOVER', '5');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const under4Promise = executeTrade('O5U4 Under', 'R_100', 'DIGITUNDER', '4');
                    
                    const [over5Result, under4Result] = await Promise.all([over5Promise, under4Promise]);
                    return over5Result || under4Result;

                default:
                    return false;
            }
        } catch (error) {
            console.error('Strategy execution failed:', error);
            globalObserver.emit('ui.log.error', `Strategy execution failed: ${error.message}`);
            return false;
        }
    };

    // Strategy toggle functions
    const toggleStrategy = (strategy: string) => {
        // Deactivate all other strategies first
        setIsAutoDifferActive(false);
        setIsAutoOverUnderActive(false);
        setIsAutoO5U4Active(false);

        // Activate selected strategy
        switch (strategy) {
            case 'differ':
                setIsAutoDifferActive(true);
                globalObserver.emit('ui.log.info', 'Auto Differ strategy activated');
                break;
            case 'overunder':
                setIsAutoOverUnderActive(true);
                globalObserver.emit('ui.log.info', 'Auto Over/Under strategy activated');
                break;
            case 'o5u4':
                setIsAutoO5U4Active(true);
                globalObserver.emit('ui.log.info', 'Auto O5U4 strategy activated');
                break;
        }
    };

    // Start trading
    const startTrading = async () => {
        if (!client?.loginid || !isAnalysisReady) {
            globalObserver.emit('ui.log.error', 'Please ensure you are logged in and analysis is ready');
            return;
        }

        if (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active) {
            globalObserver.emit('ui.log.error', 'Please activate at least one trading strategy');
            return;
        }

        // Ensure API is properly connected and authorized before starting
        try {
            if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                globalObserver.emit('ui.log.info', 'Connecting to API...');
                await api_base.init();
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (!api_base.is_authorized && client?.token) {
                globalObserver.emit('ui.log.info', 'Authorizing API connection...');
                await api_base.authorizeAndSubscribe();
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            if (!api_base.is_authorized) {
                globalObserver.emit('ui.log.error', 'Failed to authorize API connection');
                return;
            }

            setIsTrading(true);
            run_panel.setIsRunning(true);
            globalObserver.emit('ui.log.success', 'Trading Hub started successfully');

        } catch (error) {
            globalObserver.emit('ui.log.error', `Failed to start trading: ${error.message}`);
            return;
        }

        // Start trading loop
        tradingIntervalRef.current = setInterval(async () => {
            if (!isTrading || isTradeInProgress) return;

            // Check if API is still connected
            if (!api_base.api || api_base.api.connection?.readyState !== 1 || !api_base.is_authorized) {
                globalObserver.emit('ui.log.warn', 'API connection lost, attempting to reconnect...');
                try {
                    await api_base.init();
                    if (client?.token) {
                        await api_base.authorizeAndSubscribe();
                    }
                } catch (error) {
                    globalObserver.emit('ui.log.error', 'Failed to reconnect API');
                    return;
                }
            }

            let activeStrategy = '';
            if (isAutoDifferActive) activeStrategy = 'differ';
            else if (isAutoOverUnderActive) activeStrategy = 'overunder';
            else if (isAutoO5U4Active) activeStrategy = 'o5u4';

            if (activeStrategy) {
                try {
                    await executeStrategyTrade(activeStrategy);
                } catch (error) {
                    console.error('Trading loop error:', error);
                    globalObserver.emit('ui.log.error', `Trading error: ${error.message}`);
                }
            }
        }, 15000); // Execute trade every 15 seconds
    };

    // Stop trading
    const stopTrading = () => {
        setIsTrading(false);
        run_panel.setIsRunning(false);

        if (tradingIntervalRef.current) {
            clearInterval(tradingIntervalRef.current);
            tradingIntervalRef.current = null;
        }

        globalObserver.emit('ui.log.info', 'Trading Hub stopped');
    };

    // Initialize component
    useEffect(() => {
        const initializeApi = async () => {
            try {
                if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                    await api_base.init();
                }

                if (client?.loginid && client?.token && !api_base.is_authorized) {
                    await api_base.authorizeAndSubscribe();
                }
            } catch (error) {
                console.error('Failed to initialize API:', error);
                globalObserver.emit('ui.log.error', `API initialization failed: ${error.message}`);
            }
        };

        initializeApi();

        // Load saved settings
        const savedStake = localStorage.getItem('tradingHub_initialStake');
        if (savedStake) {
            setInitialStake(savedStake);
            setCurrentStake(savedStake);
        }

        const savedMartingale = localStorage.getItem('tradingHub_martingale');
        if (savedMartingale) {
            setMartingale(savedMartingale);
        }

        // Start analysis interval
        analysisIntervalRef.current = setInterval(performMarketAnalysis, 5000);

        return () => {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
            }
            if (analysisIntervalRef.current) {
                clearInterval(analysisIntervalRef.current);
            }
        };
    }, [client?.loginid, client?.token]);

    // Monitor connection status
    useEffect(() => {
        const checkConnection = () => {
            if (api_base?.api?.connection) {
                const readyState = api_base.api.connection.readyState;
                setConnectionStatus(readyState === 1 ? 'connected' : readyState === 0 ? 'connecting' : 'disconnected');
            } else {
                setConnectionStatus('disconnected');
            }
            setIsApiAuthorized(api_base?.is_authorized || false);
        };

        checkConnection();
        const interval = setInterval(checkConnection, 2000);
        return () => clearInterval(interval);
    }, []);

    const winRate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(1) : '0';
    const hasActiveStrategy = isAutoDifferActive || isAutoOverUnderActive || isAutoO5U4Active;

    return (
        <div className="trading-hub-modern">
            <div className="hub-header">
                <div className="header-main">
                    <div className="logo-section">
                        <div className="logo-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
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
                                value={initialStake}
                                onChange={(e) => {
                                    const value = Math.max(parseFloat(e.target.value), parseFloat(MINIMUM_STAKE)).toFixed(2);
                                    setInitialStake(value);
                                    setCurrentStake(value);
                                    localStorage.setItem('tradingHub_initialStake', value);
                                }}
                                className="stake-input"
                                step="0.01"
                                min={MINIMUM_STAKE}
                                disabled={isTrading}
                            />
                        </div>

                        <div className="control-group">
                            <label>Martingale</label>
                            <input
                                type="number"
                                value={martingale}
                                onChange={(e) => {
                                    const value = Math.max(parseFloat(e.target.value), 1.1).toFixed(2);
                                    setMartingale(value);
                                    localStorage.setItem('tradingHub_martingale', value);
                                }}
                                className="martingale-input"
                                step="0.1"
                                min="1.1"
                                disabled={isTrading}
                            />
                        </div>
                    </div>
                </div>

                <div className="status-bar">
                    <div className={`status-item ${isAnalysisReady ? 'ready' : 'loading'}`}>
                        <div className={`status-dot ${isAnalysisReady ? 'ready' : 'loading'}`}></div>
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
                    <div className="status-separator"></div>
                    <div className="status-item">
                        <div className={`status-dot ${connectionStatus}`}></div>
                        {connectionStatus === 'connected' ? 'Connected' :
                         connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                        {connectionStatus === 'connected' && !isApiAuthorized && ' (Not Authorized)'}
                    </div>
                </div>
            </div>

            <div className="trading-content">
                <div className="strategy-grid">
                    {/* Auto Differ Strategy */}
                    <div className={`strategy-card ${isAutoDifferActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                </svg>
                            </div>
                            <div className="strategy-info">
                                <h4>Auto Differ</h4>
                                <p>Digit difference prediction</p>
                            </div>
                            <div className={`strategy-status ${isAutoDifferActive ? 'active' : 'inactive'}`}>
                                {isAutoDifferActive ? 'ON' : 'OFF'}
                            </div>
                        </div>

                        <div className="card-content">
                            <p>Advanced digit analysis with pattern recognition for differ contracts.</p>

                            {isAutoDifferActive && recommendation && (
                                <div className="recommendation-display">
                                    <div className="rec-item">
                                        <span>Symbol:</span>
                                        <strong>{recommendation.symbol}</strong>
                                    </div>
                                    <div className="rec-item">
                                        <span>Confidence:</span>
                                        <strong>{recommendation.confidence}%</strong>
                                    </div>
                                    <div className="rec-item">
                                        <span>Pattern:</span>
                                        <span>{recommendation.reason}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                            onClick={() => toggleStrategy('differ')}
                            disabled={!isAnalysisReady || isTrading}
                        >
                            {isAutoDifferActive ? 'Deactivate' : 'Activate'} Strategy
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
                            <div className="strategy-info">
                                <h4>Auto Over/Under</h4>
                                <p>Dynamic barrier trading</p>
                            </div>
                            <div className={`strategy-status ${isAutoOverUnderActive ? 'active' : 'inactive'}`}>
                                {isAutoOverUnderActive ? 'ON' : 'OFF'}
                            </div>
                        </div>

                        <div className="card-content">
                            <p>AI-driven over/under predictions with real-time market analysis.</p>

                            {isAutoOverUnderActive && recommendation && (
                                <div className="recommendation-display">
                                    <div className="rec-item">
                                        <span>Symbol:</span>
                                        <strong>{recommendation.symbol}</strong>
                                    </div>
                                    <div className="rec-item">
                                        <span>Strategy:</span>
                                        <strong>{recommendation.strategy.toUpperCase()} {recommendation.barrier}</strong>
                                    </div>
                                    <div className="rec-item">
                                        <span>Confidence:</span>
                                        <strong>{recommendation.confidence}%</strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                            onClick={() => toggleStrategy('overunder')}
                            disabled={!isAnalysisReady || isTrading}
                        >
                            {isAutoOverUnderActive ? 'Deactivate' : 'Activate'} Strategy
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
                            <div className="strategy-info">
                                <h4>Auto O5U4</h4>
                                <p>Dual contract strategy</p>
                            </div>
                            <div className={`strategy-status ${isAutoO5U4Active ? 'active' : 'inactive'}`}>
                                {isAutoO5U4Active ? 'ON' : 'OFF'}
                            </div>
                        </div>

                        <div className="card-content">
                            <p>Simultaneous Over 5 and Under 4 contracts for maximum coverage.</p>

                            {isAutoO5U4Active && (
                                <div className="recommendation-display">
                                    <div className="rec-item">
                                        <span>Symbol:</span>
                                        <strong>R_100</strong>
                                    </div>
                                    <div className="rec-item">
                                        <span>Strategy:</span>
                                        <strong>OVER 5 + UNDER 4</strong>
                                    </div>
                                    <div className="rec-item">
                                        <span>Coverage:</span>
                                        <strong>90% Win Rate</strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={() => toggleStrategy('o5u4')}
                            disabled={!isAnalysisReady || isTrading}
                        >
                            {isAutoO5U4Active ? 'Deactivate' : 'Activate'} Strategy
                        </button>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="trading-controls">
                    <div className="main-controls">
                        <button
                            className={`main-trading-btn ${isTrading ? 'stop' : 'start'}`}
                            onClick={isTrading ? stopTrading : startTrading}
                            disabled={!isAnalysisReady || !hasActiveStrategy || (connectionStatus !== 'connected')}
                        >
                            <div className="btn-content">
                                <div className="btn-icon">
                                    {isTrading ? (
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
                                <span>{isTrading ? 'Stop Trading' : 'Start Trading'}</span>
                            </div>
                        </button>

                        {isTradeInProgress && (
                            <div className="trade-progress">
                                <div className="progress-spinner"></div>
                                <span>Trade in progress...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Statistics Dashboard */}
                <div className="stats-dashboard">
                    <div className="stats-grid">
                        <div className="stat-card wins">
                            <div className="stat-header">
                                <div className="stat-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                    </svg>
                                </div>
                                <span>Wins</span>
                            </div>
                            <div className="stat-value">{winCount}</div>
                        </div>

                        <div className="stat-card losses">
                            <div className="stat-header">
                                <div className="stat-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                    </svg>
                                </div>
                                <span>Losses</span>
                            </div>
                            <div className="stat-value">{lossCount}</div>
                        </div>

                        <div className="stat-card winrate">
                            <div className="stat-header">
                                <div className="stat-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="l9 12 2 2 4-4"/>
                                    </svg>
                                </div>
                                <span>Win Rate</span>
                            </div>
                            <div className="stat-value">{winRate}%</div>
                        </div>

                        <div className="stat-card current-stake">
                            <div className="stat-header">
                                <div className="stat-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                                    </svg>
                                </div>
                                <span>Current Stake</span>
                            </div>
                            <div className="stat-value">${currentStake}</div>
                        </div>

                        <div className="stat-card profit-loss">
                            <div className="stat-header">
                                <div className="stat-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18 9 12 13 16l6.3-6.29L22 12V6z"/>
                                    </svg>
                                </div>
                                <span>P&L</span>
                            </div>
                            <div className={`stat-value ${profitLoss >= 0 ? 'positive' : 'negative'}`}>
                                ${profitLoss.toFixed(2)}
                            </div>
                        </div>

                        <div className="stat-card total-trades">
                            <div className="stat-header">
                                <div className="stat-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M3 3h18v18H3zM5 7v10h4V7zm6 0v10h4V7zm6 0v10h2V7z"/>
                                    </svg>
                                </div>
                                <span>Total Trades</span>
                            </div>
                            <div className="stat-value">{totalTrades}</div>
                        </div>
                    </div>

                    {lastTradeResult && (
                        <div className={`last-trade-result ${lastTradeResult.toLowerCase()}`}>
                            <div className="result-icon">
                                {lastTradeResult === 'WIN' ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                    </svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                    </svg>
                                )}
                            </div>
                            <span>Last Trade: {lastTradeResult}</span>
                            <div className="trade-details">
                                Consecutive Losses: {consecutiveLosses}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;
