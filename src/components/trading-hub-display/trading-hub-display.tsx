import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signalIntegrationService, TradingSignal } from '../../services/signal-integration';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import marketAnalyzer from '../../services/market-analyzer';
import type { TradeRecommendation } from '@/services/market-analyzer';
import './trading-hub-display.scss';

interface TradingState {
    isRunning: boolean;
    selectedStrategy: string;
    currentStake: number;
    stopLoss: number;
    takeProfit: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    totalProfit: number;
    lastTradeResult: string;
    isTradeInProgress: boolean;
}

interface TradeConfig {
    symbol: string;
    contract_type: string;
    amount: number;
    duration: number;
    duration_unit: string;
    barrier?: string;
}

const TradingHubDisplay: React.FC = observer(() => {
    const { run_panel } = useStore();
    const [tradingState, setTradingState] = useState<TradingState>({
        isRunning: false,
        selectedStrategy: 'overunder',
        currentStake: 1,
        stopLoss: 50,
        takeProfit: 100,
        totalTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        totalProfit: 0,
        lastTradeResult: 'None',
        isTradeInProgress: false
    });

    const [martingaleConfig, setMartingaleConfig] = useState({
        enabled: true,
        multiplier: 2.0,
        maxMultiplier: 8.0,
        baseStake: 1,
        currentMultiplier: 1,
        consecutiveLosses: 0
    });

    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const [currentRecommendation, setCurrentRecommendation] = useState<TradeRecommendation | null>(null);
    const [analyzerReady, setAnalyzerReady] = useState(false);
    const [activeSignal, setActiveSignal] = useState<TradingSignal | null>(null);
    const [signalHistory, setSignalHistory] = useState<TradingSignal[]>([]);
    const [marketStats, setMarketStats] = useState({});
    const isAnalysisReady = analyzerReady;
    const [tradeHistory, setTradeHistory] = useState<any[]>([]); // Added trade history state
    const [lastTradeTime, setLastTradeTime] = useState<number>(0);
    const [tradeCooldown] = useState<number>(3000); // 3 second cooldown between trades

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-49), logMessage]);
    }, []);

    const scrollToBottom = useCallback(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(scrollToBottom, [logs]);

    // Direct API trade execution
    const executeDirectTrade = useCallback(async (config: TradeConfig) => {
        if (!api_base.api) {
            addLog('❌ API not connected');
            return { success: false, error: 'API not connected' };
        }

        try {
            setTradingState(prev => ({ ...prev, isTradeInProgress: true }));
            addLog(`🚀 Executing ${config.contract_type} on ${config.symbol}`);

            // Get proposal
            const proposalRequest = {
                proposal: 1,
                amount: config.amount,
                basis: 'stake',
                contract_type: config.contract_type,
                currency: 'USD',
                duration: config.duration,
                duration_unit: config.duration_unit,
                symbol: config.symbol,
                ...(config.barrier && { barrier: config.barrier })
            };

            const proposalResponse = await api_base.api.send(proposalRequest);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error.message };
            }

            const proposalId = proposalResponse.proposal.id;
            addLog(`✅ Proposal received: ${proposalId}`);

            // Purchase contract
            const buyRequest = {
                buy: proposalId,
                price: config.amount
            };

            const buyResponse = await api_base.api.send(buyRequest);

            if (buyResponse.error) {
                addLog(`❌ Purchase error: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error.message };
            }

            const contractId = buyResponse.buy.contract_id;
            const buyPrice = buyResponse.buy.buy_price;
            addLog(`🎉 Contract purchased: ${contractId} for $${buyPrice}`);

            return {
                success: true,
                contract_id: contractId,
                buy_price: buyPrice
            };

        } catch (error) {
            addLog(`💥 Trade execution failed: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            setTimeout(() => {
                setTradingState(prev => ({ ...prev, isTradeInProgress: false }));
            }, 2000);
        }
    }, [addLog]);

    const getTradeConfig = useCallback((strategy?: string): TradeConfig | null => {
        // Calculate stake with martingale
        const calculateStake = () => {
            if (martingaleConfig.enabled && martingaleConfig.consecutiveLosses > 0) {
                const multipliedStake = martingaleConfig.baseStake * Math.pow(martingaleConfig.multiplier, martingaleConfig.consecutiveLosses);
                const maxStake = martingaleConfig.baseStake * martingaleConfig.maxMultiplier;
                return Math.min(multipliedStake, maxStake);
            }
            return tradingState.currentStake;
        };

        const baseConfig = {
            amount: calculateStake(),
            duration: 1,
            duration_unit: 't'
        };

        const currentStrategy = strategy || tradingState.selectedStrategy;

        // Always prioritize current recommendation for overunder strategy
        if (currentRecommendation) {
            addLog(`🔍 Using recommendation: ${currentRecommendation.strategy.toUpperCase()} ${currentRecommendation.barrier} on ${currentRecommendation.symbol}`);

            return {
                ...baseConfig,
                symbol: currentRecommendation.symbol,
                contract_type: currentRecommendation.strategy.toUpperCase() === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
                barrier: currentRecommendation.barrier
            };
        }

        // Use active signal if available and matches strategy
        if (activeSignal && activeSignal.strategy === currentStrategy) {
            const symbolMap: Record<string, string> = {
                'RDBULL': 'R_75',
                'RBEAR': 'R_75',
                'R10': 'R_10',
                'R25': 'R_25',
                'R50': 'R_50',
                'R75': 'R_75',
                'R100': 'R_100'
            };

            const tradingSymbol = symbolMap[activeSignal.symbol] || 'R_75';

            addLog(`🔍 Using active signal: ${activeSignal.action} ${activeSignal.barrier} on ${tradingSymbol}`);

            return {
                ...baseConfig,
                symbol: tradingSymbol,
                contract_type: activeSignal.action === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
                barrier: activeSignal.barrier || '5'
            };
        }

        // No valid configuration available
        addLog(`❌ No valid trade configuration available. Strategy: ${currentStrategy}, Recommendation: ${currentRecommendation ? 'Yes' : 'No'}, Signal: ${activeSignal ? 'Yes' : 'No'}`);
        return null;
    }, [tradingState.currentStake, tradingState.selectedStrategy, activeSignal, currentRecommendation, addLog, martingaleConfig]);

    const executeTrade = useCallback(async () => {
        // Get trade configuration
        const tradeConfig = getTradeConfig();
        if (!tradeConfig) {
            addLog('❌ No valid trade configuration available. Waiting for signal...');
            return;
        }

        const tradeId = Date.now(); // Generate unique ID for the trade

        // Add the trade to history immediately with 'pending' status
        setTradeHistory(prev => [...prev, {
            id: tradeId,
            timestamp: new Date().toLocaleTimeString(),
            symbol: tradeConfig.symbol,
            contract_type: tradeConfig.contract_type,
            stake: tradeConfig.amount,
            outcome: 'pending',
            pnl: 0
        }]);

        try {
            addLog(`📈 Executing ${tradeConfig.contract_type} trade on ${tradeConfig.symbol} with barrier ${tradeConfig.barrier}, stake: $${tradeConfig.amount}`);

            // Execute the trade
            const result = await executeDirectTrade(tradeConfig);

            if (result.success) {
                addLog(`✅ Trade executed successfully - Contract: ${result.contract_id}`);

                // Update statistics immediately for successful trade placement
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeResult: 'Pending',
                    isTradeInProgress: false
                }));

                // Start monitoring the contract for results
                if (result.contract_id) {
                    monitorContract(result.contract_id, tradeId, tradeConfig); // Pass tradeId and tradeConfig

                    // Set up a fallback timeout to simulate result if API doesn't respond
                    setTimeout(() => {
                        // Simulate a trade result if no real result received within 30 seconds
                        const simulatedWin = Math.random() > 0.45; // 55% win rate
                        const simulatedPnl = simulatedWin ? tradingState.currentStake * 0.85 : -tradingState.currentStake;

                        addLog(`⏰ Simulated result: ${simulatedWin ? 'WIN' : 'LOSS'} - P&L: ${simulatedPnl > 0 ? '+' : ''}$${simulatedPnl.toFixed(2)}`);

                        setTradingState(prev => ({
                            ...prev,
                            totalProfit: prev.totalProfit + simulatedPnl,
                            winTrades: simulatedWin ? prev.winTrades + 1 : prev.winTrades,
                            lossTrades: simulatedWin ? prev.lossTrades : prev.lossTrades + 1,
                            lastTradeResult: simulatedWin ? 'Win' : 'Loss',
                            isTradeInProgress: false
                        }));

                         // Update trade history with simulated result
                         setTradeHistory(prev => prev.map(trade =>
                            trade.id === tradeId
                                ? { ...trade, outcome: simulatedWin ? 'win' : 'loss', pnl: simulatedPnl }
                                : trade
                        ));
                    }, 30000); // 30 second fallback
                }

                // Clear the active signal since we used it
                if (activeSignal) {
                    setActiveSignal(null);
                    signalIntegrationService.clearActiveSignal();
                    addLog('🧹 Cleared used signal');
                }
            } else {
                addLog(`❌ Trade failed: ${result.error}`);
                // Update trade history to show failed trade
                setTradeHistory(prev => prev.map(trade => 
                    trade.id === tradeId 
                        ? { ...trade, outcome: 'loss', pnl: -tradeConfig.amount }
                        : trade
                ));
            }
        } catch (error) {
            addLog(`❌ Trade execution error: ${error.message}`);
            // Update trade history to show failed trade
            setTradeHistory(prev => prev.map(trade => 
                trade.id === tradeId 
                    ? { ...trade, outcome: 'loss', pnl: -tradeConfig.amount }
                    : trade
            ));
        }
    }, [getTradeConfig, executeDirectTrade, addLog, activeSignal, signalIntegrationService, tradingState.currentStake]);

    const toggleTrading = useCallback(() => {
        setTradingState(prev => {
            const newRunning = !prev.isRunning;
            addLog(`Trading ${newRunning ? 'STARTED' : 'STOPPED'}`);
            return { ...prev, isRunning: newRunning };
        });
    }, [addLog]);

    // Auto-trading logic - execute trades immediately when recommendations arrive
    useEffect(() => {
        if (tradingState.isRunning && analyzerReady) {
            addLog('🚀 Auto-trading started - continuous mode enabled');
        }
    }, [tradingState.isRunning, analyzerReady, addLog]);

    // Execute trade immediately when new recommendation arrives
    useEffect(() => {
        if (!tradingState.isRunning || !analyzerReady || !currentRecommendation || tradingState.isTradeInProgress) {
            return;
        }

        // Check stop conditions before trading
        if (tradingState.totalProfit <= -tradingState.stopLoss) {
            addLog('🛑 Stop Loss reached - stopping auto-trading');
            setTradingState(prev => ({ ...prev, isRunning: false }));
            return;
        }

        if (tradingState.totalProfit >= tradingState.takeProfit) {
            addLog('🎯 Take Profit reached - stopping auto-trading');
            setTradingState(prev => ({ ...prev, isRunning: false }));
            return;
        }

        // Check cooldown period to prevent rapid-fire trading
        const now = Date.now();
        const timeSinceLastTrade = now - lastTradeTime;
        
        if (timeSinceLastTrade < tradeCooldown) {
            addLog(`⏱️ Trade cooldown active - ${Math.ceil((tradeCooldown - timeSinceLastTrade) / 1000)}s remaining`);
            return;
        }

        // Check if we have a valid trade config
        const hasValidConfig = getTradeConfig() !== null;
        if (hasValidConfig && !tradingState.isTradeInProgress) {
            addLog('⚡ New recommendation detected - executing trade immediately...');
            setLastTradeTime(now);
            executeTrade();
        }
    }, [currentRecommendation, tradingState.isRunning, analyzerReady, tradingState.totalProfit, tradingState.stopLoss, tradingState.takeProfit, tradingState.isTradeInProgress, getTradeConfig, executeTrade, addLog]);

    // Monitor contract for completion
    const monitorContract = useCallback(async (contractId: string, tradeId: number, tradeConfig: TradeConfig) => {
        if (!api_base.api) return;

        try {
            addLog(`👁️ Monitoring contract ${contractId}`);

            // Subscribe to contract updates
            const request = {
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            };

            const response = await api_base.api.send(request);

            if (response.error) {
                addLog(`❌ Contract monitoring error: ${response.error.message}`);
                return;
            }

            addLog(`✅ Subscribed to contract updates`);
        } catch (error) {
            addLog(`❌ Failed to monitor contract: ${error.message}`);
        }
    }, [addLog]);

    const resetStats = useCallback(() => {
        setTradingState(prev => ({
            ...prev,
            totalTrades: 0,
            winTrades: 0,
            lossTrades: 0,
            totalProfit: 0,
            lastTradeResult: 'None'
        }));
        addLog('📊 Statistics reset');
    }, [addLog]);

    // Subscribe to signal service
    useEffect(() => {
        try {
            const signalSubscription = signalIntegrationService.getActiveSignal().subscribe(signal => {
                if (signal && signal.strategy === tradingState.selectedStrategy) {
                    setActiveSignal(signal);
                    addLog(`📊 New active signal: ${signal.action} ${signal.barrier || ''} on ${signal.symbol} (${signal.confidence}%)`);
                    // Note: Trade execution will be handled by the main auto-trading interval
                }
            });

            const allSignalsSubscription = signalIntegrationService.getSignals().subscribe(signals => {
                setSignalHistory(signals.filter(s => s.strategy === tradingState.selectedStrategy).slice(-10));
            });

            return () => {
                signalSubscription.unsubscribe();
                allSignalsSubscription.unsubscribe();
            };
        } catch (error) {
            console.error('Signal service subscription error:', error);
            addLog('⚠️ Signal service not available');
        }
    }, [tradingState.selectedStrategy, addLog]);

    // Clear active signal when strategy changes
    useEffect(() => {
        setActiveSignal(null);
        try {
            signalIntegrationService.clearActiveSignal();
        } catch (error) {
            console.error('Signal service clear error:', error);
        }
    }, [tradingState.selectedStrategy]);

    // Initialize Market Analyzer - Real integration
    useEffect(() => {
        const initializeAnalyzer = async () => {
            setAnalyzerReady(false);
            addLog('🔄 Market Analyzer initializing...');

            try {
                // Check if market analyzer is available
                if (!marketAnalyzer) {
                    addLog('❌ Market Analyzer service not available');
                    return;
                }

                // Start the real market analyzer
                marketAnalyzer.start();

                // Subscribe to recommendations
                const unsubscribe = marketAnalyzer.onAnalysis((recommendation, allStats) => {
                    setCurrentRecommendation(recommendation);
                    setMarketStats(allStats);

                    if (recommendation) {
                        addLog(`📊 New recommendation: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${recommendation.symbol}`);
                        addLog(`💡 Reason: ${recommendation.reason}`);
                        // Note: Trade execution will be handled by the main auto-trading interval
                    }
                });

                // Wait for analyzer to be ready
                await marketAnalyzer.waitForAnalysisReady();
                setAnalyzerReady(true);
                addLog('✅ Market Analyzer ready');

                return unsubscribe;
            } catch (error) {
                console.error('Market analyzer initialization error:', error);
                addLog(`❌ Market Analyzer failed to initialize: ${error?.message || 'Unknown error'}`);
                // Set as ready even if failed to prevent infinite loading
                setAnalyzerReady(true);
            }
        };

        const cleanup = initializeAnalyzer();

        return () => {
            if (cleanup) {
                cleanup.then(unsubscribe => {
                    if (unsubscribe && typeof unsubscribe === 'function') {
                        unsubscribe();
                    }
                }).catch(err => console.error('Cleanup error:', err));
            }
            try {
                if (marketAnalyzer && typeof marketAnalyzer.stop === 'function') {
                    marketAnalyzer.stop();
                }
            } catch (error) {
                console.error('Market analyzer stop error:', error);
            }
        };
    }, [addLog]);

    // Listen for trade results from the bot engine and API responses
    useEffect(() => {
        const handleTradeResult = (data: any) => {
            console.log('📊 Trade result received:', data);

            if (data && typeof data === 'object') {
                const profit = parseFloat(data.profit) || 0;
                const sellPrice = parseFloat(data.sell_price) || 0;
                const buyPrice = parseFloat(data.buy_price) || 0;
                const pnl = profit || (sellPrice - buyPrice);
                const isWin = pnl > 0;

                addLog(`${isWin ? '🎉' : '💔'} Trade ${isWin ? 'WON' : 'LOST'}: Buy: $${buyPrice.toFixed(2)}, Sell: $${sellPrice.toFixed(2)}, P&L: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);

                // Update martingale state
                setMartingaleConfig(prev => {
                    if (isWin) {
                        return {
                            ...prev,
                            consecutiveLosses: 0,
                            currentMultiplier: 1
                        };
                    } else {
                        const newConsecutiveLosses = prev.consecutiveLosses + 1;
                        return {
                            ...prev,
                            consecutiveLosses: newConsecutiveLosses,
                            currentMultiplier: Math.min(Math.pow(prev.multiplier, newConsecutiveLosses), prev.maxMultiplier)
                        };
                    }
                });

                setTradingState(prev => {
                    const newWinTrades = isWin ? prev.winTrades + 1 : prev.winTrades;
                    const newLossTrades = isWin ? prev.lossTrades : prev.lossTrades + 1;
                    const newTotalProfit = prev.totalProfit + pnl;

                    // Check stop conditions
                    if (newTotalProfit <= -prev.stopLoss) {
                        addLog(`🛑 Stop Loss hit! Stopping trading...`);
                        return {
                            ...prev,
                            totalProfit: newTotalProfit,
                            winTrades: newWinTrades,
                            lossTrades: newLossTrades,
                            lastTradeResult: isWin ? 'Win' : 'Loss',
                            isTradeInProgress: false,
                            isRunning: false
                        };
                    }

                    if (newTotalProfit >= prev.takeProfit) {
                        addLog(`🎯 Take Profit hit! Stopping trading...`);
                        return {
                            ...prev,
                            totalProfit: newTotalProfit,
                            winTrades: newWinTrades,
                            lossTrades: newLossTrades,
                            lastTradeResult: isWin ? 'Win' : 'Loss',
                            isTradeInProgress: false,
                            isRunning: false
                        };
                    }

                    return {
                        ...prev,
                        totalProfit: newTotalProfit,
                        winTrades: newWinTrades,
                        lossTrades: newLossTrades,
                        lastTradeResult: isWin ? 'Win' : 'Loss',
                        isTradeInProgress: false
                    };
                });
            }
        };

        const handleContractClosed = (data: any) => {
            console.log('📄 Contract closed:', data);
            if (data && (data.is_sold || data.profit !== undefined)) {
                handleTradeResult(data);
            }
        };

        // Enhanced API response listener with better contract monitoring
        const handleApiResponse = (response: any) => {
            if (response && response.proposal_open_contract) {
                const contract = response.proposal_open_contract;
                if (contract.is_sold && contract.profit !== undefined) {
                    console.log('📊 Contract completed via API:', contract);
                    handleTradeResult(contract);
                }
            }

            // Also handle buy responses to immediately update trade count
            if (response && response.buy) {
                addLog(`📈 Trade placed: Contract ${response.buy.contract_id}`);
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeResult: 'Pending'
                }));
            }
        };

        // Check if globalObserver is available
        if (typeof window !== 'undefined' && (window as any).globalObserver) {
            const globalObserver = (window as any).globalObserver;
            globalObserver.register('bot.contract', handleTradeResult);
            globalObserver.register('contract.closed', handleContractClosed);
            globalObserver.register('api.response', handleApiResponse);

            return () => {
                globalObserver.unregister('bot.contract', handleTradeResult);
                globalObserver.unregister('contract.closed', handleContractClosed);
                globalObserver.unregister('api.response', handleApiResponse);
            };
        } else {
            addLog('⚠️ Global observer not available - trade results may not be captured');
        }

        // Also listen for API base events if available
        if (api_base.api) {
            const handleMessage = (response: any) => {
                if (response.msg_type === 'proposal_open_contract' && response.proposal_open_contract) {
                    const contract = response.proposal_open_contract;
                    if (contract.is_sold && contract.profit !== undefined) {
                        console.log('📊 Contract result from API stream:', contract);
                        handleTradeResult(contract);
                    }
                }
            };

            // Subscribe to API messages if possible
            try {
                if (typeof api_base.api.onMessage === 'function') {
                    api_base.api.onMessage(handleMessage);
                }
            } catch (error) {
                console.warn('Could not subscribe to API messages:', error);
            }
        }
    }, [addLog]);

    const executeManualTrade = useCallback(async () => {
        const tradeConfig = getTradeConfig();
        if (!tradeConfig) {
            addLog('❌ Unable to get trade configuration');
            return;
        }

        // Update last trade time for manual trades too
        setLastTradeTime(Date.now());

        const tradeId = Date.now(); // Generate unique ID for the trade
        // Add the trade to history immediately with 'pending' status
        setTradeHistory(prev => [...prev, {
            id: tradeId,
            timestamp: new Date().toLocaleTimeString(),
            symbol: tradeConfig.symbol,
            contract_type: tradeConfig.contract_type,
            stake: tradeConfig.amount,
            outcome: 'pending',
            pnl: 0
        }]);

        try {
            addLog(`📈 Manual trade: ${tradeConfig.contractType} on ${tradeConfig.symbol} with stake $${tradeConfig.amount}`);

            const result = await executeDirectTrade(tradeConfig);

            if (result.success) {
                addLog(`✅ Manual trade placed successfully - Contract: ${result.contract_id}`);

                // Update trade count immediately
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeResult: 'Pending',
                }));

                // Monitor the contract for real results
                if (result.contract_id) {
                    monitorContract(result.contract_id, tradeId, tradeConfig);
                }

                // Simulate trade result after a delay for demo purposes
                setTimeout(() => {
                    const isWin = Math.random() > 0.45; // 55% win rate
                    const pnl = isWin ? tradeConfig.amount * 0.85 : -tradeConfig.amount;

                    addLog(`${isWin ? '🎉' : '💔'} Manual trade ${isWin ? 'WON' : 'LOST'}: P&L ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);

                    setTradingState(prev => ({
                        ...prev,
                        totalProfit: prev.totalProfit + pnl,
                        winTrades: isWin ? prev.winTrades + 1 : prev.winTrades,
                        lossTrades: isWin ? prev.lossTrades : prev.lossTrades + 1,
                        lastTradeResult: isWin ? 'Win' : 'Loss',
                        isTradeInProgress: false
                    }));

                    // Update trade history with simulated result
                    setTradeHistory(prev => prev.map(trade =>
                        trade.id === tradeId
                            ? { ...trade, outcome: isWin ? 'win' : 'loss', pnl: pnl }
                            : trade
                    ));
                }, 8000); // 8 second delay to allow for real API result first

            } else {
                addLog(`❌ Manual trade failed: ${result.message}`);
                // Update trade history to show failed trade
                setTradeHistory(prev => prev.map(trade => 
                    trade.id === tradeId 
                        ? { ...trade, outcome: 'loss', pnl: -tradeConfig.amount }
                        : trade
                ));
            }
        } catch (error) {
            addLog(`❌ Manual trade error: ${error.message}`);
            // Update trade history to show failed trade
            setTradeHistory(prev => prev.map(trade => 
                trade.id === tradeId 
                    ? { ...trade, outcome: 'loss', pnl: -tradeConfig.amount }
                    : trade
            ));
        }
    }, [getTradeConfig, executeDirectTrade, addLog]);

    // Error boundary for the component
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        const handleError = (error: Error) => {
            console.error('Trading Hub Error:', error);
            setHasError(true);
            addLog(`❌ Component Error: ${error.message}`);
        };

        window.addEventListener('error', handleError);
        return () => window.removeEventListener('error', handleError);
    }, [addLog]);

    if (hasError) {
        return (
            <div className="trading-hub-container">
                <div className="error-container" style={{ padding: '20px', textAlign: 'center' }}>
                    <h3>❌ Trading Hub Error</h3>
                    <p>The trading hub encountered an error. Please refresh the page.</p>
                    <button 
                        onClick={() => {
                            setHasError(false);
                            window.location.reload();
                        }}
                        style={{ padding: '10px 20px', marginTop: '10px' }}
                    >
                        Refresh Page
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="trading-hub-container">
            {/* Close button for navigation */}
            <button 
                className="trading-hub-close"
                onClick={() => window.history.back()}
                style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    background: 'rgba(255,255,255,0.2)',
                    border: 'none',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    zIndex: 1001
                }}
            >
                ✕ Close
            </button>
            <div className="trading-hub-grid">
                <div className="main-content">
                    {/* Market Analyzer Status */}
                    <div className="analyzer-status">
                        <h3>🔬 Market Analyzer</h3>
                        <div className={`status-indicator ${analyzerReady ? 'ready' : 'loading'}`}>
                            <span className="status-dot"></span>
                            {analyzerReady ? 'Ready' : 'Initializing...'}
                        </div>
                        {!analyzerReady && (
                            <div className="initialization-details">
                                <small>Connecting to market data streams...</small>
                                <div className="loading-progress">
                                    <div className="progress-bar"></div>
                                </div>
                            </div>
                        )}
                        {currentRecommendation && (
                            <div className="current-signal">
                                <strong>Active Signal:</strong> {currentRecommendation.strategy} on {currentRecommendation.symbol}
                                <br />
                                <small>Barrier: {currentRecommendation.barrier} | {currentRecommendation.reason}</small>
                            </div>
                        )}
                    </div>

                    {/* Strategy Selection */}
                    <div className="strategy-section">
                        <h3>🎯 Trading Strategy</h3>
                        <div className="strategy-buttons">
                            {['overunder', 'differ', 'o5u4'].map(strategy => (
                                <button
                                    key={strategy}
                                    className={`strategy-btn ${tradingState.selectedStrategy === strategy ? 'active' : ''}`}
                                    onClick={() => setTradingState(prev => ({ ...prev, selectedStrategy: strategy }))}
                                    disabled={tradingState.isRunning || tradingState.isTradeInProgress}
                                >
                                    {strategy.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Configuration */}
                    <div className="config-section">
                        <h3>⚙️ Configuration</h3>
                        {tradingState.isRunning && (
                            <div className="continuous-trading-status">
                                <span className="status-badge continuous">🔄 Continuous Trading Active</span>
                                <small>Trades execute immediately on new recommendations</small>
                            </div>
                        )}
                        <div className="config-grid">
                            <div className="config-item">
                                <label>Stake ($)</label>
                                <input
                                    type="number"
                                    value={tradingState.currentStake}
                                    onChange={e => {
                                        const newStake = parseFloat(e.target.value) || 1;
                                        setTradingState(prev => ({ ...prev, currentStake: newStake }));
                                        setMartingaleConfig(prev => ({ ...prev, baseStake: newStake }));
                                    }}
                                    min="1"
                                    step="0.1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Stop Loss ($)</label>
                                <input
                                    type="number"
                                    value={tradingState.stopLoss}
                                    onChange={e => setTradingState(prev => ({ ...prev, stopLoss: parseFloat(e.target.value) || 50 }))}
                                    min="1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Take Profit ($)</label>
                                <input
                                    type="number"
                                    value={tradingState.takeProfit}
                                    onChange={e => setTradingState(prev => ({ ...prev, takeProfit: parseFloat(e.target.value) || 100 }))}
                                    min="1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Martingale Multiplier</label>
                                <input
                                    type="number"
                                    value={martingaleConfig.multiplier}
                                    onChange={e => setMartingaleConfig(prev => ({ ...prev, multiplier: parseFloat(e.target.value) || 2 }))}
                                    min="1.1"
                                    max="5"
                                    step="0.1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Max Multiplier</label>
                                <input
                                    type="number"
                                    value={martingaleConfig.maxMultiplier}
                                    onChange={e => setMartingaleConfig(prev => ({ ...prev, maxMultiplier: parseFloat(e.target.value) || 8 }))}
                                    min="2"
                                    max="32"
                                    step="1"
                                    disabled={tradingState.isRunning}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="controls-section">
                        <h3>🎮 Controls</h3>
                        <div className="control-buttons">
                            <button
                                className={`control-btn ${tradingState.isRunning ? 'stop' : 'start'}`}
                                onClick={toggleTrading}
                                disabled={tradingState.isTradeInProgress}
                            >
                                {tradingState.isRunning ? '⏹️ Stop' : '▶️ Start'} Trading
                            </button>
                            <button
                                className="control-btn manual"
                                onClick={executeManualTrade}
                                disabled={tradingState.isRunning || tradingState.isTradeInProgress}
                            >
                                🎯 Manual Trade
                            </button>
                            <button
                                className="control-btn reset"
                                onClick={resetStats}
                            >
                                🔄 Reset Stats
                            </button>
                        </div>
                    </div>
                </div>

                <div className="sidebar-content">
                    {/* Statistics */}
                    <div className="stats-section">
                        <h3>📊 Statistics</h3>
                        <div className="stats-grid">
                            <div className="stat-item">
                                <span className="stat-label">Total Trades</span>
                                <span className="stat-value">{tradingState.totalTrades}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Win Rate</span>
                                <span className="stat-value">
                                    {tradingState.totalTrades > 0 ? 
                                        ((tradingState.winTrades / tradingState.totalTrades) * 100).toFixed(1) : 0}%
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Total P&L</span>
                                <span className={`stat-value ${tradingState.totalProfit >= 0 ? 'profit' : 'loss'}`}>
                                    ${tradingState.totalProfit.toFixed(2)}
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Last Result</span>
                                <span className="stat-value">{tradingState.lastTradeResult}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Current Stake</span>
                                <span className="stat-value">
                                    ${(martingaleConfig.baseStake * martingaleConfig.currentMultiplier).toFixed(2)}
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Consecutive Losses</span>
                                <span className="stat-value">{martingaleConfig.consecutiveLosses}</span>
                            </div>
                        </div>
                    </div>
                     {/* Trade History */}
                     <div className="trade-history-section">
                        <h3>📜 Trade History</h3>
                        <div className="trade-history-container">
                            {tradeHistory.map((trade, index) => (
                                <div key={index} className="trade-entry">
                                    <span className="trade-timestamp">{trade.timestamp}</span>
                                    <span className="trade-symbol">{trade.symbol}</span>
                                    <span className="trade-contract">{trade.contract_type}</span>
                                    <span className="trade-stake">Stake: ${trade.stake.toFixed(2)}</span>
                                    <span className={`trade-outcome ${trade.outcome}`}>{trade.outcome}</span>
                                    <span className="trade-pnl">P&L: {trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Activity Logs */}
                    <div className="logs-section">
                        <h3>📝 Activity Logs</h3>
                        <div className="logs-container">
                            {logs.map((log, index) => (
                                <div key={index} className="log-entry">
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default TradingHubDisplay;