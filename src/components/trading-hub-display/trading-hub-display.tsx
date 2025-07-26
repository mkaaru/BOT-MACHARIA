
import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import marketAnalyzer, { TradeRecommendation } from '../../services/market-analyzer';
import { useApiBase } from '@/hooks/useApiBase';

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';
    const { is_dark_mode_on } = useThemeSwitcher();
    const { connectionStatus, isAuthorized, accountList, authData } = useApiBase();

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
    const [currentStrategy, setCurrentStrategy] = useState<string>('over');
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
    const o5u4LastTradeTime = useRef<number>(0);
    const o5u4MinimumCooldown = 1000;

    const [initialStake, setInitialStake] = useState(MINIMUM_STAKE);
    const [appliedStake, setAppliedStake] = useState(MINIMUM_STAKE);
    const [lastTradeWin, setLastTradeWin] = useState<boolean | null>(null);
    const [activeContractId, setActiveContractId] = useState<string | null>(null);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);

    const activeContractRef = useRef<string | null>(null);
    const [lastTradeResult, setLastTradeResult] = useState<string>('');

    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

    const lastMartingaleActionRef = useRef<string>('initial');
    const lastWinTimeRef = useRef<number>(0);

    const { run_panel, transactions } = useStore();

    const [activeContracts, setActiveContracts] = useState<Record<string, any>>({});
    const contractUpdateInterval = useRef<NodeJS.Timeout | null>(null);
    const lastTradeRef = useRef<{ id: string | null; profit: number | null }>({ id: null, profit: null });
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);

    // Use bot skeleton connection status
    const isWebSocketConnected = connectionStatus === 'OPENED' && isAuthorized;

    const currentStakeRef = useRef(MINIMUM_STAKE);
    const currentConsecutiveLossesRef = useRef(0);
    const contractSettledTimeRef = useRef(0);
    const waitingForSettlementRef = useRef(false);

    // O5U4 specific contract tracking
    const o5u4ActiveContracts = useRef<{
        over5ContractId: string | null;
        under4ContractId: string | null;
        over5Result: 'pending' | 'win' | 'loss' | null;
        under4Result: 'pending' | 'win' | 'loss' | null;
        bothSettled: boolean;
    }>({
        over5ContractId: null,
        under4ContractId: null,
        over5Result: null,
        under4Result: null,
        bothSettled: false
    });

    // O5U4 bot analysis
    const [o5u4Analysis, setO5u4Analysis] = useState<{
        bestSymbol: string | null;
        symbolsAnalysis: Record<string, any>;
        readySymbols: string[];
    }>({
        bestSymbol: null,
        symbolsAnalysis: {},
        readySymbols: []
    });

    const [isSymbolsGridVisible, setIsSymbolsGridVisible] = useState(false);

    const manageMartingale = (
        action: 'init' | 'update' | 'get',
        params?: {
            newValue?: string;
        }
    ): string => {
        switch (action) {
            case 'init':
                if (params?.newValue) {
                    const validValue = Math.max(parseFloat(params.newValue), 1).toFixed(1);
                    console.log(`Martingale initialization from ${martingale} to ${validValue}`);
                    setMartingale(validValue);

                    try {
                        localStorage.setItem('tradingHub_martingale', validValue);
                    } catch (e) {
                        console.warn('Could not save martingale to localStorage', e);
                    }
                }
                break;

            case 'update':
                if (params?.newValue !== undefined) {
                    setMartingale(params.newValue);
                }
                break;

            case 'get':
                const storedValue = localStorage.getItem('tradingHub_martingale');
                if (storedValue) {
                    const parsedValue = parseFloat(storedValue);
                    if (!isNaN(parsedValue) && parsedValue >= 1) {
                        return storedValue;
                    }
                }
                return martingale;

            default:
                console.error('Unknown martingale management action:', action);
        }

        return martingale;
    };

    const manageStake = (
        action: 'init' | 'reset' | 'martingale' | 'update' | 'get',
        params?: {
            newValue?: string;
            lossCount?: number;
        }
    ): string => {
        switch (action) {
            case 'init':
                if (params?.newValue) {
                    const validValue = Math.max(parseFloat(params.newValue), parseFloat(MINIMUM_STAKE)).toFixed(2);
                    console.log(`Stake initialization from ${initialStake} to ${validValue}`);
                    setInitialStake(validValue);
                    setAppliedStake(validValue);
                    currentStakeRef.current = validValue;

                    try {
                        localStorage.setItem('tradingHub_initialStake', validValue);
                    } catch (e) {
                        console.warn('Could not save stake to localStorage', e);
                    }
                }
                break;

            case 'update':
                if (params?.newValue !== undefined) {
                    const inputValue = params.newValue;
                    setStake(inputValue);
                }
                break;

            case 'reset':
                const storedInitialStake = localStorage.getItem('tradingHub_initialStake') || initialStake;
                lastMartingaleActionRef.current = 'reset';
                lastWinTimeRef.current = Date.now();

                console.log(
                    `Resetting stake from ${currentStakeRef.current} to stored initial: ${storedInitialStake} (state value: ${initialStake})`
                );
                console.log(`Consecutive losses counter reset from ${currentConsecutiveLossesRef.current} to 0`);

                setAppliedStake(storedInitialStake);
                currentStakeRef.current = storedInitialStake;
                setConsecutiveLosses(0);
                currentConsecutiveLossesRef.current = 0;
                break;

            case 'martingale':
                if (lastMartingaleActionRef.current === 'martingale' && Date.now() - lastWinTimeRef.current < 2000) {
                    console.warn('Prevented duplicate martingale application - too soon after last martingale');
                    return currentStakeRef.current;
                }

                const prevLossCount = currentConsecutiveLossesRef.current;
                const newLossCount = params?.lossCount !== undefined ? params.lossCount : prevLossCount + 1;

                const maxLossCount = 10;
                const safeLossCount = Math.min(newLossCount, maxLossCount);

                currentConsecutiveLossesRef.current = safeLossCount;

                const baseStake = localStorage.getItem('tradingHub_initialStake') || initialStake;

                const currentMartingale = manageMartingale('get');
                const multiplier = parseFloat(currentMartingale);
                const validMultiplier = !isNaN(multiplier) && multiplier >= 1 ? multiplier : 1;

                const newStake = (parseFloat(baseStake) * Math.pow(validMultiplier, safeLossCount)).toFixed(2);

                console.log(`Martingale calculation details:`);
                console.log(`- Base stake: ${baseStake}`);
                console.log(`- Multiplier: ${validMultiplier}`);
                console.log(`- Previous loss count: ${prevLossCount}`);
                console.log(`- New loss count: ${safeLossCount}`);
                console.log(`- Formula: ${baseStake} × ${validMultiplier}^${safeLossCount} = ${newStake}`);

                lastMartingaleActionRef.current = 'martingale';
                currentStakeRef.current = newStake;
                setAppliedStake(newStake);
                setConsecutiveLosses(safeLossCount);
                break;

            case 'get':
                return currentStakeRef.current || initialStake;

            default:
                console.error('Unknown stake management action:', action);
        }

        return currentStakeRef.current;
    };

    const analyzeO5U4AllSymbols = (allStats: Record<string, any>) => {
        const symbolsAnalysis: Record<string, any> = {};
        const readySymbols: string[] = [];
        let bestSymbol: string | null = null;
        let bestScore = 0;

        availableSymbols.forEach(symbol => {
            const stats = allStats[symbol];
            if (!stats || stats.sampleSize < 30) return;

            const over5Count = [6, 7, 8, 9].reduce((sum, digit) => sum + (stats.digitCounts[digit] || 0), 0);
            const under4Count = [0, 1, 2, 3].reduce((sum, digit) => sum + (stats.digitCounts[digit] || 0), 0);
            
            const over5Percentage = (over5Count / stats.sampleSize) * 100;
            const under4Percentage = (under4Count / stats.sampleSize) * 100;
            
            const combined = Math.max(over5Percentage, under4Percentage);
            const analysis = {
                over5Percentage,
                under4Percentage,
                combined,
                sampleSize: stats.sampleSize,
                ready: combined >= 45,
                currentLastDigit: stats.currentLastDigit,
            };

            symbolsAnalysis[symbol] = analysis;

            if (analysis.ready) {
                readySymbols.push(symbol);
                if (combined > bestScore) {
                    bestScore = combined;
                    bestSymbol = symbol;
                }
            }
        });

        setO5u4Analysis({
            bestSymbol,
            symbolsAnalysis,
            readySymbols
        });
    };

    const checkO5U4Conditions = (): boolean => {
        if (!o5u4Analysis.bestSymbol) return false;
        
        const bestAnalysis = o5u4Analysis.symbolsAnalysis[o5u4Analysis.bestSymbol];
        return bestAnalysis?.ready && bestAnalysis.combined >= 45;
    };

    const executeO5U4Trade = async () => {
        if (!o5u4Analysis.bestSymbol || isTradeInProgress) return;

        setIsTradeInProgress(true);
        
        try {
            const symbol = o5u4Analysis.bestSymbol;
            const currentStake = manageStake('get');
            
            // Execute both Over 5 and Under 4 trades
            const over5Trade = await api_base.api.send({
                buy: 1,
                parameters: {
                    contract_type: 'DIGITOVER',
                    symbol: symbol,
                    amount: parseFloat(currentStake) / 2,
                    duration: 1,
                    duration_unit: 't',
                    barrier: '5'
                }
            });

            const under4Trade = await api_base.api.send({
                buy: 1,
                parameters: {
                    contract_type: 'DIGITUNDER',
                    symbol: symbol,
                    amount: parseFloat(currentStake) / 2,
                    duration: 1,
                    duration_unit: 't',
                    barrier: '4'
                }
            });

            if (over5Trade.buy && under4Trade.buy) {
                o5u4ActiveContracts.current = {
                    over5ContractId: over5Trade.buy.contract_id,
                    under4ContractId: under4Trade.buy.contract_id,
                    over5Result: 'pending',
                    under4Result: 'pending',
                    bothSettled: false
                };

                activeContractRef.current = over5Trade.buy.contract_id;
                setTradeCount(prev => prev + 1);
                console.log(`O5U4 trade executed on ${symbol}: Over 5 (${over5Trade.buy.contract_id}) and Under 4 (${under4Trade.buy.contract_id})`);
            }
        } catch (error) {
            console.error('O5U4 trade execution failed:', error);
        } finally {
            setIsTradeInProgress(false);
        }
    };

    const executeSingleTrade = async (strategy: string, symbol: string) => {
        if (isTradeInProgress || !isWebSocketConnected) {
            console.warn('Cannot execute trade: trade in progress or WebSocket disconnected');
            return;
        }

        // Validate client authentication
        if (!isAuthorized || !authData?.loginid) {
            console.error('Client not authenticated');
            return;
        }

        setIsTradeInProgress(true);
        
        try {
            const currentStake = manageStake('get');
            let contractType = '';
            let barrier = '';

            switch (strategy) {
                case 'over':
                    contractType = 'DIGITOVER';
                    barrier = '5';
                    break;
                case 'under':
                    contractType = 'DIGITUNDER';
                    barrier = '5';
                    break;
                default:
                    console.error('Unknown strategy:', strategy);
                    return;
            }

            console.log(`Executing ${strategy.toUpperCase()} trade on ${symbol} with stake ${currentStake}`);

            const trade = await api_base.api.send({
                buy: 1,
                parameters: {
                    contract_type: contractType,
                    symbol: symbol,
                    amount: parseFloat(currentStake),
                    duration: 1,
                    duration_unit: 't',
                    barrier: barrier
                }
            });

            if (trade.buy) {
                activeContractRef.current = trade.buy.contract_id;
                setTradeCount(prev => prev + 1);
                console.log(`${strategy.toUpperCase()} trade executed successfully:`, {
                    contract_id: trade.buy.contract_id,
                    symbol: symbol,
                    stake: currentStake,
                    buy_price: trade.buy.buy_price
                });
            } else if (trade.error) {
                console.error('Trade execution error:', trade.error);
                throw new Error(trade.error.message || 'Trade execution failed');
            }
        } catch (error) {
            console.error('Trade execution failed:', error);
            // Reset trade progress on error
            setIsTradeInProgress(false);
            // You might want to show a user notification here
        } finally {
            // Only set to false if no error occurred above
            if (isTradeInProgress) {
                setIsTradeInProgress(false);
            }
        }
    };

    const startContinuousTrading = () => {
        setIsContinuousTrading(true);
        setIsTrading(true);
        console.log('Starting continuous trading...');
    };

    const stopContinuousTrading = () => {
        setIsContinuousTrading(false);
        setIsTrading(false);
        console.log('Stopping continuous trading...');
    };

    

    useEffect(() => {
        try {
            const savedStake = localStorage.getItem('tradingHub_initialStake');
            if (savedStake) {
                console.log(`Loaded saved stake from storage: ${savedStake}`);
                setInitialStake(savedStake);
                setStake(savedStake);
                currentStakeRef.current = savedStake;
            }

            const savedMartingale = localStorage.getItem('tradingHub_martingale');
            if (savedMartingale) {
                console.log(`Loaded saved martingale from storage: ${savedMartingale}`);
                setMartingale(savedMartingale);
            }
        } catch (e) {
            console.warn('Could not load settings from localStorage', e);
        }
    }, []);

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

            analyzeO5U4AllSymbols(allStats);

            if (isAutoO5U4Active && isContinuousTrading && !isTradeInProgress) {
                const now = Date.now();
                const timeSinceLastO5U4Trade = now - o5u4LastTradeTime.current;
                
                if (timeSinceLastO5U4Trade >= o5u4MinimumCooldown && !activeContractRef.current && 
                    !o5u4ActiveContracts.current.over5ContractId && !o5u4ActiveContracts.current.under4ContractId) {
                    if (checkO5U4Conditions()) {
                        console.log('O5U4 conditions met - executing trade immediately');
                        o5u4LastTradeTime.current = now;
                        executeO5U4Trade();
                    }
                }
            }

            if (isContinuousTrading && (isAutoDifferActive || isAutoOverUnderActive) && newRecommendation) {
                const now = Date.now();
                const timeSinceLastTrade = now - lastTradeTime.current;
                
                if (timeSinceLastTrade >= minimumTradeCooldown && !activeContractRef.current) {
                    lastTradeTime.current = now;
                    
                    if (isAutoOverUnderActive) {
                        setCurrentStrategy(newRecommendation.strategy);
                        setCurrentSymbol(newRecommendation.symbol);
                        executeSingleTrade(newRecommendation.strategy, newRecommendation.symbol);
                    }
                }
            }
        });

        const contractSettlementHandler = (response: any) => {
            if (
                response?.id === 'contract.settled' &&
                response?.data &&
                lastTradeRef.current?.id !== response.data.contract_id
            ) {
                const contract_info = response.data;

                if (isAutoO5U4Active && 
                    (contract_info.contract_id === o5u4ActiveContracts.current.over5ContractId || 
                     contract_info.contract_id === o5u4ActiveContracts.current.under4ContractId)) {
                    
                    const isOver5 = contract_info.contract_id === o5u4ActiveContracts.current.over5ContractId;
                    const isWin = contract_info.profit >= 0;
                    
                    console.log(`O5U4 ${isOver5 ? 'Over 5' : 'Under 4'} contract ${contract_info.contract_id} settled with ${isWin ? 'WIN' : 'LOSS'}.`);
                    
                    if (isOver5) {
                        o5u4ActiveContracts.current.over5Result = isWin ? 'win' : 'loss';
                    } else {
                        o5u4ActiveContracts.current.under4Result = isWin ? 'win' : 'loss';
                    }
                    
                    if (o5u4ActiveContracts.current.over5Result !== 'pending' && 
                        o5u4ActiveContracts.current.under4Result !== 'pending' && 
                        !o5u4ActiveContracts.current.bothSettled) {
                        
                        o5u4ActiveContracts.current.bothSettled = true;
                        
                        const over5Won = o5u4ActiveContracts.current.over5Result === 'win';
                        const under4Won = o5u4ActiveContracts.current.under4Result === 'win';
                        
                        console.log(`O5U4 Both contracts settled. Over5: ${over5Won ? 'WIN' : 'LOSS'}, Under4: ${under4Won ? 'WIN' : 'LOSS'}`);
                        
                        if (over5Won || under4Won) {
                            setLastTradeWin(true);
                            setLastTradeResult('WIN');
                            manageStake('reset');
                            console.log('O5U4: At least one contract won - resetting stake');
                        } else {
                            setLastTradeWin(false);
                            setLastTradeResult('LOSS');
                            manageStake('martingale');
                            console.log('O5U4: Both contracts lost - applying martingale');
                        }
                        
                        lastTradeRef.current = {
                            id: o5u4ActiveContracts.current.over5ContractId!,
                            profit: contract_info.profit,
                        };
                        
                        setTimeout(() => {
                            o5u4ActiveContracts.current = {
                                over5ContractId: null,
                                under4ContractId: null,
                                over5Result: null,
                                under4Result: null,
                                bothSettled: false
                            };
                            activeContractRef.current = null;
                        }, 100);
                    }
                    
                    return;
                }

                if (contract_info.contract_id === activeContractRef.current) {
                    const isWin = contract_info.profit >= 0;
                    setLastTradeWin(isWin);
                    setLastTradeResult(isWin ? 'WIN' : 'LOSS');

                    console.log(`Contract ${contract_info.contract_id} settled with ${isWin ? 'WIN' : 'LOSS'}.`);

                    lastTradeRef.current = {
                        id: contract_info.contract_id,
                        profit: contract_info.profit,
                    };

                    if (isWin) {
                        setWinCount(prev => prev + 1);
                        manageStake('reset');
                    } else {
                        setLossCount(prev => prev + 1);
                        manageStake('martingale');
                    }

                    activeContractRef.current = null;
                }
            }
        };

        globalObserver.register('contract.status', (response: any) => {
            if (response?.data?.is_sold) {
                contractSettlementHandler({
                    id: 'contract.settled',
                    data: response.data,
                });
            }
        });

        globalObserver.register('contract.settled', contractSettlementHandler);

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
            if (contractUpdateInterval.current) {
                clearInterval(contractUpdateInterval.current);
            }
            globalObserver.emit('bot.stopped');
            marketAnalyzer.stop();
            unsubscribe();
            globalObserver.unregisterAll('contract.status');
            globalObserver.unregisterAll('contract.settled');
        };
    }, []);

    return (
        <div className="trading-hub-modern">
            <div className="trading-hub-content">
                {/* Header */}
                <div className="hub-header">
                    <div className="header-main">
                        <div className="logo-section">
                            <div className="logo-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z"/>
                                </svg>
                            </div>
                            <div className="title-group">
                                <h1 className="hub-title">Trading Hub</h1>
                                <p className="hub-subtitle">Advanced Trading Strategies</p>
                            </div>
                        </div>
                        
                        <div className="settings-controls">
                            <div className="control-group">
                                <label>Stake ($)</label>
                                <input
                                    type="number"
                                    className="compact-input"
                                    value={stake}
                                    onChange={(e) => {
                                        setStake(e.target.value);
                                        manageStake('update', { newValue: e.target.value });
                                    }}
                                    onBlur={() => manageStake('init', { newValue: stake })}
                                    min="0.35"
                                    step="0.01"
                                    disabled={isTrading}
                                />
                            </div>
                            
                            <div className="control-group">
                                <label>Martingale</label>
                                <input
                                    type="number"
                                    className="compact-input"
                                    value={martingale}
                                    onChange={(e) => manageMartingale('update', { newValue: e.target.value })}
                                    onBlur={() => manageMartingale('init', { newValue: martingale })}
                                    min="1"
                                    step="0.1"
                                    disabled={isTrading}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="status-bar">
                        <div className="status-item">
                            <div className={`status-dot ${isWebSocketConnected ? '' : 'disconnected'}`}></div>
                            <span>WebSocket: {isWebSocketConnected ? 'Connected' : 'Disconnected'}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <div className="status-dot"></div>
                            <span>Analysis: {isAnalysisReady ? 'Ready' : 'Loading'}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>Count: {analysisCount}</span>
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <span>Last: {lastAnalysisTime || 'Never'}</span>
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

                {/* Strategy Grid */}
                <div className="strategy-grid">
                    {/* AutoDiffer Strategy */}
                    <div className={`strategy-card ${isAutoDifferActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 11H7l3-3 3 3h-2v4h-2v-4zm1 4l-3 3 3 3v-2h4v-2H10v-2z"/>
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>AutoDiffer</h4>
                                <p>Smart Difference Detection</p>
                            </div>
                            <div className={`strategy-status ${isAutoDifferActive ? 'on' : 'off'}`}>
                                {isAutoDifferActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        
                        <div className="card-content">
                            <p>Automatically analyzes market barriers and symbols for optimal differ predictions.</p>
                            
                            {isAutoDifferActive && recommendation ? (
                                <div className="recommendation-card">
                                    <div className="rec-header">
                                        <span className="rec-label">Current Recommendation</span>
                                        <span className="rec-confidence">Active</span>
                                    </div>
                                    <div className="rec-details">
                                        <div className="rec-item">
                                            <span>Symbol:</span>
                                            <strong>{recommendation.symbol}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Strategy:</span>
                                            <strong>{recommendation.strategy.toUpperCase()}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Reason:</span>
                                            <span className="pattern-text">{recommendation.reason}</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="analyzing-state">
                                    <div className="spinner"></div>
                                    <span>Analyzing market patterns...</span>
                                </div>
                            )}
                        </div>
                        
                        <button
                            className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                            onClick={() => {
                                setIsAutoDifferActive(!isAutoDifferActive);
                                console.log(`AutoDiffer ${!isAutoDifferActive ? 'activated' : 'deactivated'}`);
                            }}
                            disabled={!isAnalysisReady}
                        >
                            {isAutoDifferActive ? 'Deactivate AutoDiffer' : 'Activate AutoDiffer'}
                        </button>
                    </div>

                    {/* Auto Over/Under Strategy */}
                    <div className={`strategy-card ${isAutoOverUnderActive ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M7 14l5-5 5 5z"/>
                                    <path d="M7 10l5 5 5-5z"/>
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto Over/Under</h4>
                                <p>AI-Powered Pattern Recognition</p>
                            </div>
                            <div className={`strategy-status ${isAutoOverUnderActive ? 'on' : 'off'}`}>
                                {isAutoOverUnderActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        
                        <div className="card-content">
                            <p>Uses advanced AI to identify patterns and recommend optimal over/under positions.</p>
                            
                            {isAutoOverUnderActive && recommendation ? (
                                <div className="recommendation-card">
                                    <div className="rec-header">
                                        <span className="rec-label">AI Recommendation</span>
                                        <span className="rec-confidence">High Confidence</span>
                                    </div>
                                    <div className="rec-details">
                                        <div className="rec-item">
                                            <span>Symbol:</span>
                                            <strong>{recommendation.symbol}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Action:</span>
                                            <strong>{recommendation.strategy.toUpperCase()} {recommendation.barrier}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Most Frequent:</span>
                                            <strong>Digit {recommendation.mostFrequentDigit}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Current Digit:</span>
                                            <strong>{recommendation.currentLastDigit}</strong>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="analyzing-state">
                                    <div className="spinner"></div>
                                    <span>AI analyzing market data...</span>
                                </div>
                            )}
                        </div>
                        
                        <button
                            className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                            onClick={() => {
                                setIsAutoOverUnderActive(!isAutoOverUnderActive);
                                console.log(`Auto Over/Under ${!isAutoOverUnderActive ? 'activated' : 'deactivated'}`);
                            }}
                            disabled={!isAnalysisReady}
                        >
                            {isAutoOverUnderActive ? 'Deactivate Over/Under' : 'Activate Over/Under'}
                        </button>
                    </div>

                    {/* Auto O5U4 Strategy */}
                    <div className={`strategy-card ${isAutoO5U4Active ? 'active' : ''}`}>
                        <div className="card-header">
                            <div className="strategy-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                </svg>
                            </div>
                            <div className="strategy-title">
                                <h4>Auto O5U4</h4>
                                <p>Dual-Strategy Trading</p>
                            </div>
                            <div className={`strategy-status ${isAutoO5U4Active ? 'on' : 'off'}`}>
                                {isAutoO5U4Active ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        
                        <div className="card-content">
                            <p>Simultaneously trades Over 5 and Under 4 based on digit frequency analysis across all volatility indices.</p>
                            
                            {isAutoO5U4Active ? (
                                <div className="o5u4-info">
                                    <div className="symbols-overview">
                                        <div className="overview-header">
                                            <span>Multi-Symbol Analysis</span>
                                            <div className="header-actions">
                                                {o5u4Analysis.bestSymbol && (
                                                    <span className="best-symbol">
                                                        Best: {o5u4Analysis.bestSymbol}
                                                    </span>
                                                )}
                                                <button 
                                                    className="toggle-grid-btn"
                                                    onClick={() => setIsSymbolsGridVisible(!isSymbolsGridVisible)}
                                                >
                                                    {isSymbolsGridVisible ? 'Hide' : 'Show'} Details
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div className="ready-count">
                                            Ready Symbols: {o5u4Analysis.readySymbols.length}/{availableSymbols.length}
                                        </div>
                                        
                                        {isSymbolsGridVisible && (
                                            <div className="symbols-grid">
                                                {availableSymbols.map(symbol => {
                                                    const analysis = o5u4Analysis.symbolsAnalysis[symbol];
                                                    const isReady = analysis?.ready || false;
                                                    const isBest = symbol === o5u4Analysis.bestSymbol;
                                                    
                                                    return (
                                                        <div 
                                                            key={symbol} 
                                                            className={`symbol-tile ${isReady ? 'ready' : 'not-ready'} ${isBest ? 'best' : ''}`}
                                                        >
                                                            <div className="symbol-name">{symbol}</div>
                                                            {analysis ? (
                                                                <>
                                                                    <div className="symbol-stats">
                                                                        <div className="stat-item">
                                                                            <span>O5:</span>
                                                                            <span>{analysis.over5Percentage?.toFixed(1) || '0'}%</span>
                                                                        </div>
                                                                        <div className="stat-item">
                                                                            <span>U4:</span>
                                                                            <span>{analysis.under4Percentage?.toFixed(1) || '0'}%</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="combined-score">
                                                                        {analysis.combined?.toFixed(1) || '0'}%
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <div className="loading-symbol">Loading...</div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="analyzing-state">
                                    <div className="spinner"></div>
                                    <span>Preparing dual-strategy analysis...</span>
                                </div>
                            )}
                        </div>
                        
                        <button
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={() => {
                                setIsAutoO5U4Active(!isAutoO5U4Active);
                                console.log(`Auto O5U4 ${!isAutoO5U4Active ? 'activated' : 'deactivated'}`);
                            }}
                            disabled={!isAnalysisReady}
                        >
                            {isAutoO5U4Active ? 'Deactivate O5U4' : 'Activate O5U4'}
                        </button>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="trading-controls">
                    <button
                        className={`main-trade-btn ${isContinuousTrading ? 'stop' : 'start'} ${!isAnalysisReady || !isWebSocketConnected || (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active) ? 'disabled' : ''}`}
                        onClick={isContinuousTrading ? stopContinuousTrading : startContinuousTrading}
                        disabled={!isAnalysisReady || !isWebSocketConnected || (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active)}
                        title={!isWebSocketConnected ? 'WebSocket connection required to start trading' : ''}
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
                                        <polygon points="5,3 19,12 5,21"/>
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

                {/* Stats Dashboard */}
                <div className="stats-dashboard">
                    <div className="stats-grid">
                        <div className="stat-card wins">
                            <div className="stat-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
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
                                    <path d="M9 11H7l3-3 3 3h-2v4h-2v-4zm1 4l-3 3 3 3v-2h4v-2H10v-2z"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <div className="stat-value">
                                    {tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : '0.0'}%
                                </div>
                                <div className="stat-label">Win Rate</div>
                            </div>
                        </div>
                        
                        <div className="stat-card martingale">
                            <div className="stat-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <div className="stat-value">{consecutiveLosses}</div>
                                <div className="stat-label">Consecutive Losses</div>
                            </div>
                        </div>
                    </div>
                    
                    {lastTradeResult && (
                        <div className={`last-trade-result ${lastTradeResult.toLowerCase()}`}>
                            <div className="result-icon">
                                {lastTradeResult === 'WIN' ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
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

                {/* Analysis Info */}
                <div className="analysis-info">
                    <div className="analysis-header">
                        <div className="ai-badge">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                            </svg>
                            <span>AI Market Analysis</span>
                        </div>
                        <div className="analysis-time">
                            Updated: {lastAnalysisTime || 'Never'}
                        </div>
                    </div>
                    
                    <div className="analysis-details">
                        <div className="detail-item">
                            <span>Analysis Count</span>
                            <strong>{analysisCount}</strong>
                        </div>
                        <div className="detail-item">
                            <span>Current Stake</span>
                            <strong>${appliedStake}</strong>
                        </div>
                        <div className="detail-item">
                            <span>Martingale Level</span>
                            <strong>{consecutiveLosses}x</strong>
                        </div>
                        <div className="detail-item">
                            <span>Active Strategies</span>
                            <strong>
                                {[isAutoDifferActive && 'AutoDiffer', isAutoOverUnderActive && 'Over/Under', isAutoO5U4Active && 'O5U4']
                                    .filter(Boolean)
                                    .join(', ') || 'None'}
                            </strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;
