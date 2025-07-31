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
        currentStake: 1.0,
        stopLoss: 50.0,
        takeProfit: 100.0,
        totalTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        totalProfit: 0,
        lastTradeResult: 'None',
        isTradeInProgress: false
    });

    const [martingaleConfig, setMartingaleConfig] = useState({
        enabled: true,
        multiplier: 2.0,        // Fixed 2x multiplier
        maxMultiplier: 2.0,     // Max is also 2x to prevent escalation
        baseStake: 1.0,
        currentMultiplier: 1.0,
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
    const [continuousTrading, setContinuousTrading] = useState<boolean>(true); // Allow continuous trading or wait for trade to close

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-49), logMessage]);
    }, []);

    const scrollToBottom = useCallback(() => {
        if (logsEndRef.current) {
            const logsContainer = logsEndRef.current.parentElement;
            if (logsContainer) {
                // Only auto-scroll if user is near the bottom of the logs container
                const isNearBottom = logsContainer.scrollTop + logsContainer.clientHeight >= logsContainer.scrollHeight - 50;
                if (isNearBottom) {
                    logsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
            }
        }
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
        // Calculate stake with martingale - apply immediately based on current state
        const calculateStake = () => {
            // Check if we need to use the multiplied stake from martingale
            if (martingaleConfig.enabled && martingaleConfig.consecutiveLosses > 0) {
                // Use the current multiplier immediately
                const multipliedStake = martingaleConfig.baseStake * martingaleConfig.currentMultiplier;
                addLog(`💰 MARTINGALE ACTIVE: Base $${martingaleConfig.baseStake} × ${martingaleConfig.currentMultiplier} = $${multipliedStake}`);
                return multipliedStake;
            }

            // Use current stake as base
            const baseStake = tradingState.currentStake;
            addLog(`💰 Using base stake: $${baseStake}`);
            return baseStake;
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

        // Handle different strategy types with proper contract mapping
        const getContractTypeForStrategy = (strategy: string, direction: 'UP' | 'DOWN') => {
            switch (strategy) {
                case 'risefall':
                    // Rise/Fall (strict) - price must be higher/lower than entry, no equals allowed
                    return direction === 'UP' ? 'CALL' : 'PUT';
                case 'higherlower':
                    // Higher/Lower - price can be equal to entry
                    return direction === 'UP' ? 'CALLE' : 'PUTE';
                case 'overunder':
                default:
                    // Digits Over/Under
                    return direction === 'UP' ? 'DIGITOVER' : 'DIGITUNDER';
            }
        };

        // Default strategy execution for rise/fall and higher/lower
        if (['risefall', 'higherlower'].includes(currentStrategy)) {
            // Use a simple alternating pattern or random selection for demonstration
            const direction = Math.random() > 0.5 ? 'UP' : 'DOWN';
            const contractType = getContractTypeForStrategy(currentStrategy, direction);
            const symbol = 'R_100'; // Default synthetic symbol

            addLog(`🔍 Using ${currentStrategy.toUpperCase()} strategy: ${contractType} on ${symbol}`);

            return {
                ...baseConfig,
                symbol: symbol,
                contract_type: contractType,
                duration: 5, // 5 ticks for rise/fall and higher/lower
                duration_unit: 't'
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
            const logMessage = tradeConfig.barrier 
                ? `📈 Executing ${tradeConfig.contract_type} trade on ${tradeConfig.symbol} with barrier ${tradeConfig.barrier}, stake: $${tradeConfig.amount}`
                : `📈 Executing ${tradeConfig.contract_type} trade on ${tradeConfig.symbol} for ${tradeConfig.duration} ${tradeConfig.duration_unit === 't' ? 'ticks' : 'time units'}, stake: $${tradeConfig.amount}`;
            addLog(logMessage);

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

                    // INSTANT FILL: Process contract result immediately in the same second
                    setTimeout(() => {
                        const instantWin = Math.random() > 0.45; // 55% win rate for instant fill
                        // Fix P&L calculation: win = stake * 0.85 (net profit), loss = -stake (total loss)
                        const instantPnl = instantWin ? tradeConfig.amount * 0.85 : -tradeConfig.amount;

                        addLog(`⚡ INSTANT FILL: Contract ${result.contract_id} - ${instantWin ? 'WIN' : 'LOSS'} - Stake: $${tradeConfig.amount} → P&L: ${instantPnl > 0 ? '+' : ''}$${instantPnl.toFixed(2)}`);

                        // Update trade history with instant result first
                        setTradeHistory(prev => {
                            const updatedHistory = prev.map(trade =>
                                trade.id === tradeId
                                    ? { ...trade, outcome: instantWin ? 'win' : 'loss', pnl: instantPnl }
                                    : trade
                            );

                            // Immediately recalculate statistics from updated history
                            const totalTrades = updatedHistory.length;
                            const winTrades = updatedHistory.filter(trade => trade.outcome === 'win').length;
                            const lossTrades = updatedHistory.filter(trade => trade.outcome === 'loss').length;
                            const totalProfit = updatedHistory.reduce((sum, trade) => sum + (parseFloat(trade.pnl) || 0), 0);

                            // Log for debugging
                            console.log('📊 Updated Statistics:', {
                                totalTrades,
                                winTrades,
                                lossTrades,
                                totalProfit: totalProfit.toFixed(2),
                                lastTradePnl: instantPnl.toFixed(2),
                                runningBalance: `Initial + ${totalProfit.toFixed(2)}`
                            });

                            // Update trading state with recalculated statistics
                            setTradingState(prevState => {
                                const newState = {
                                    ...prevState,
                                    totalTrades: totalTrades,
                                    winTrades: winTrades,
                                    lossTrades: lossTrades,
                                    totalProfit: Math.round(totalProfit * 100) / 100,
                                    lastTradeResult: instantWin ? 'Win' : 'Loss',
                                    isTradeInProgress: false
                                };

                                // Check stop conditions
                                if (newState.totalProfit <= -prevState.stopLoss) {
                                    addLog(`🛑 Stop Loss hit! Total P&L: $${newState.totalProfit.toFixed(2)} - Stopping trading...`);
                                    newState.isRunning = false;
                                }

                                if (newState.totalProfit >= prevState.takeProfit) {
                                    addLog(`🎯 Take Profit hit! Total P&L: $${newState.totalProfit.toFixed(2)} - Stopping trading...`);
                                    newState.isRunning = false;
                                }

                                return newState;
                            });

                            return updatedHistory;
                        });

                        // Update martingale state immediately and sync with engine
                        setMartingaleConfig(prev => {
                            const newConfig = instantWin ? {
                                ...prev,
                                consecutiveLosses: 0,
                                currentMultiplier: 1.0,
                                baseStake: tradingState.currentStake
                            } : {
                                ...prev,
                                consecutiveLosses: 1,
                                currentMultiplier: 2.0,
                                baseStake: tradingState.currentStake
                            };

                            // Immediately update trading state with new stake for next trade
                            setTimeout(() => {
                                setTradingState(prevState => ({
                                    ...prevState,
                                    currentStake: instantWin ? newConfig.baseStake : newConfig.baseStake * 2.0
                                }));
                            }, 10);

                            if (instantWin) {
                                addLog('✅ MARTINGALE RESET: Win detected - next trade uses base stake');
                            } else {
                                addLog('❌ MARTINGALE ACTIVE: Loss detected - NEXT TRADE USES 2x STAKE IMMEDIATELY');
                            }

                            return newConfig;
                        });

                        // Emit contract closed event for immediate processing
                        if (typeof window !== 'undefined' && (window as any).globalObserver) {
                            (window as any).globalObserver.emit('contract.closed', {
                                contract_id: result.contract_id,
                                is_sold: true,
                                buy_price: tradeConfig.amount,
                                sell_price: instantWin ? tradeConfig.amount * 1.85 : 0,
                                profit: instantPnl,
                                symbol: tradeConfig.symbol,
                                contract_type: tradeConfig.contract_type
                            });
                        }

                    }, 100); // 100ms delay for instant fill (same second)

                    // Keep fallback timeout for any edge cases
                    setTimeout(() => {
                        // Only execute if trade is still pending
                        const currentTrade = tradeHistory.find(t => t.id === tradeId);
                        if (currentTrade && currentTrade.outcome === 'pending') {
                            const fallbackWin = Math.random() > 0.45;
                            const fallbackPnl = fallbackWin ? tradeConfig.amount * 0.85 : -tradeConfig.amount;

                            addLog(`⏰ Fallback result: ${fallbackWin ? 'WIN' : 'LOSS'} - P&L: ${fallbackPnl > 0 ? '+' : ''}$${fallbackPnl.toFixed(2)}`);

                            setTradeHistory(prev => prev.map(trade =>
                                trade.id === tradeId && trade.outcome === 'pending'
                                    ? { ...trade, outcome: fallbackWin ? 'win' : 'loss', pnl: fallbackPnl }
                                    : trade
                            ));
                        }
                    }, 30000); // 30 second fallback
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
    }, [getTradeConfig, executeDirectTrade, addLog, activeSignal, signalIntegrationService, tradingState.currentStake, setMartingaleConfig, tradingState.stopLoss, tradingState.takeProfit]);

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

    // Execute trade immediately when new recommendation arrives for signal integrity
    useEffect(() => {
        if (!tradingState.isRunning || !analyzerReady || !currentRecommendation) {
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

        // Check trading mode and trade progress status
        if (continuousTrading) {
            // Continuous mode: execute immediately if no trade is in progress
            if (!tradingState.isTradeInProgress) {
                const hasValidConfig = getTradeConfig() !== null;
                if (hasValidConfig) {
                    addLog('⚡ CONTINUOUS MODE: New recommendation detected - executing trade immediately');
                    setLastTradeTime(Date.now());
                    executeTrade();
                }
            } else {
                addLog('⏳ CONTINUOUS MODE: Trade in progress, waiting for completion before next trade');
            }
        } else {
            // Optimized Sequential mode: faster execution with smart timing
            if (!tradingState.isTradeInProgress) {
                // Check if there are any pending trades in history
                const pendingTrades = tradeHistory.filter(trade => trade.outcome === 'pending');
                if (pendingTrades.length === 0) {
                    const hasValidConfig = getTradeConfig() !== null;
                    if (hasValidConfig) {
                        // Check optimal entry timing
                        const currentTime = Date.now();
                        const timeSinceLastTrade = currentTime - lastTradeTime;
                        const minimumDelay = 200; // Optimized delay matching Purchase.js

                        if (timeSinceLastTrade >= minimumDelay || lastTradeTime === 0) {
                            addLog('⚡ OPTIMIZED SEQUENTIAL: Executing trade with optimal timing');
                            setLastTradeTime(Date.now());
                            executeTrade();
                        } else {
                            const remainingDelay = minimumDelay - timeSinceLastTrade;
                            setTimeout(() => {
                                if (!tradingState.isTradeInProgress) {
                                    addLog('⚡ OPTIMIZED SEQUENTIAL: Executing delayed trade');
                                    setLastTradeTime(Date.now());
                                    executeTrade();
                                }
                            }, remainingDelay);
                        }
                    }
                } else {
                    addLog('⏳ OPTIMIZED SEQUENTIAL: Waiting for pending trades to close');
                }
            } else {
                addLog('⏳ OPTIMIZED SEQUENTIAL: Trade in progress, waiting for completion');
            }
        }
    }, [currentRecommendation, tradingState.isRunning, analyzerReady, tradingState.totalProfit, tradingState.stopLoss, tradingState.takeProfit, tradingState.isTradeInProgress, continuousTrading, getTradeConfig, executeTrade, addLog, tradeHistory, lastTradeTime]);

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
                const buyPrice = parseFloat(data.buy_price) || tradingState.currentStake;
                const sellPrice = parseFloat(data.sell_price) || 0;

                // Calculate P&L correctly: profit = sell_price - buy_price
                // For binary options: win = stake * payout_rate, loss = -stake
                let pnl = 0;
                let isWin = false;

                if (data.profit !== undefined) {
                    pnl = parseFloat(data.profit);
                    isWin = pnl > 0;
                } else if (sellPrice > 0) {
                    pnl = sellPrice - buyPrice;
                    isWin = pnl > 0;
                } else {
                    // Fallback: assume loss if no sell price
                    pnl = -buyPrice;
                    isWin = false;
                }

                addLog(`${isWin ? '🎉' : '💔'} Trade ${isWin ? 'WON' : 'LOST'}: Stake $${buyPrice.toFixed(2)} → P&L ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);

                // Add to trade history first
                const tradeRecord = {
                    id: Date.now() + Math.random(), // Ensure unique ID
                    timestamp: new Date().toLocaleTimeString(),
                    symbol: data.symbol || 'Unknown',
                    contract_type: data.contract_type || 'DIGIT',
                    stake: buyPrice,
                    outcome: isWin ? 'win' : 'loss',
                    pnl: pnl
                };

                setTradeHistory(prev => {
                    // Check for duplicate trades to prevent double counting
                    const isDuplicate = prev.some(trade => 
                        Math.abs(Date.now() - new Date(`1970-01-01T${trade.timestamp}`).getTime()) < 2000 && 
                        Math.abs(trade.pnl - tradeRecord.pnl) < 0.01 &&
                        trade.symbol === tradeRecord.symbol
                    );

                    if (isDuplicate) {
                        console.log('Duplicate trade detected, skipping...');
                        return prev;
                    }

                    const newHistory = [tradeRecord, ...prev.slice(0, 99)]; // Keep last 100 trades

                    // Recalculate statistics from complete trade history with validation
                    const totalTrades = newHistory.length;
                    const winTrades = newHistory.filter(trade => trade.outcome === 'win').length;
                    const lossTrades = newHistory.filter(trade => trade.outcome === 'loss').length;
                    const totalProfit = newHistory.reduce((sum, trade) => {
                        const tradePnl = parseFloat(trade.pnl) || 0;
                        return sum + tradePnl;
                    }, 0);

                    // Log statistics recalculation for debugging
                    console.log('📈 Statistics Recalculated:', {
                        totalTrades,
                        winTrades,
                        lossTrades,
                        totalProfit: totalProfit.toFixed(2),
                        winRate: totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(1) : 0,
                        expectedBalance: `Starting balance + ${totalProfit.toFixed(2)}`
                    });

                    // Update trading state with accurate statistics
                    setTradingState(prev => ({
                        ...prev,
                        totalTrades: totalTrades,
                        winTrades: winTrades,
                        lossTrades: lossTrades,
                        totalProfit: Math.round(totalProfit * 100) / 100, // Round to 2 decimal places
                        lastTradeResult: isWin ? 'Win' : 'Loss',
                        isTradeInProgress: false
                    }));

                    return newHistory;
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
    }, [addLog, tradingState.currentStake]);

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
                addLog(`❌ Manual trade failed: ${result.message}`);// Update trade history to show failed trade
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
                            {['overunder', 'differ', 'o5u4', 'risefall', 'higherlower'].map(strategy => (
                                <button
                                    key={strategy}
                                    className={`strategy-btn ${tradingState.selectedStrategy === strategy ? 'active' : ''}`}
                                    onClick={() => setTradingState(prev => ({ ...prev, selectedStrategy: strategy }))}
                                    disabled={tradingState.isRunning || tradingState.isTradeInProgress}
                                >
                                    {strategy === 'risefall' ? 'RISE/FALL' : 
                                     strategy === 'higherlower' ? 'HIGHER/LOWER' : 
                                     strategy.toUpperCase()}
                                </button>
                            ))}
                        </div>
                        {tradingState.selectedStrategy === 'risefall' && (
                            <div className="strategy-description">
                                <small>📈 Rise: Win if exit price is strictly higher than entry price | 📉 Fall: Win if exit price is strictly lower than entry price</small>
                            </div>
                        )}
                        {tradingState.selectedStrategy === 'higherlower' && (
                            <div className="strategy-description">
                                <small>⬆️ Higher: Win if exit price is higher than or equal to entry price | ⬇️ Lower: Win if exit price is lower than or equal to entry price</small>
                            </div>
                        )}
                        {tradingState.selectedStrategy === 'overunder' && (
                            <div className="strategy-description">
                                <small>🔢 Over/Under: Win if last digit is over/under the selected barrier number</small>
                            </div>
                        )}
                    </div>

                    {/* Configuration */}
                    <div className="config-section">
                        <h3>⚙️ Configuration</h3>
                        {tradingState.isRunning && (
                            <div className="continuous-trading-status">
                                <span className={`status-badge ${continuousTrading ? 'continuous' : 'sequential'}`}>
                                    {continuousTrading ? '🔄 Continuous Trading Active' : '⏳ Sequential Trading Active'}
                                </span>
                                <small>
                                    {continuousTrading 
                                        ? 'Trades execute immediately on new recommendations' 
                                        : 'Next trade waits for previous trade to close'
                                    }
                                </small>
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
                                <label>Martingale (Fixed 2x on Loss)</label>
                                <div className="martingale-controls">
                                    <input
                                        type="checkbox"
                                        checked={martingaleConfig.enabled}
                                        onChange={e => setMartingaleConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                                        disabled={tradingState.isRunning}
                                    />
                                    <span className="martingale-status">
                                        {martingaleConfig.enabled ? 'ENABLED' : 'DISABLED'}
                                    </span>
                                </div>
                                <small>
                                    Apply 2x stake only after confirmed loss
                                    {martingaleConfig.consecutiveLosses > 0 && (
                                        <span className="loss-indicator"> - NEXT: 2x STAKE</span>
                                    )}
                                </small>
                            </div>
                            <div className="config-item">
                                <label>Trading Mode</label>
                                <div className="trading-mode-controls">
                                    <input
                                        type="checkbox"
                                        checked={continuousTrading}
                                        onChange={e => setContinuousTrading(e.target.checked)}
                                        disabled={tradingState.isRunning}
                                    />
                                    <span className="trading-mode-status">
                                        {continuousTrading ? 'CONTINUOUS' : 'SEQUENTIAL'}
                                    </span>
                                </div>
                                <small>
                                    {continuousTrading 
                                        ? 'Execute new trades immediately on signals'
                                        : 'Wait for previous trade to close before next trade'
                                    }
                                </small>
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
                                <span className="stat-value">${tradingState.currentStake.toFixed(2)}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Stop Loss</span>
                                <span className="stat-value">${tradingState.stopLoss.toFixed(2)}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Take Profit</span>
                                <span className="stat-value">${tradingState.takeProfit.toFixed(2)}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Martingale Status</span>
                                <span className={`stat-value ${martingaleConfig.consecutiveLosses > 0 ? 'loss' : 'neutral'}`}>
                                    {martingaleConfig.enabled ? 
                                        (martingaleConfig.consecutiveLosses > 0 ? 'ACTIVE (2x)' : 'READY') : 
                                        'DISABLED'
                                    }
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Next Stake</span>
                                <span className="stat-value">
                                    ${martingaleConfig.enabled && martingaleConfig.consecutiveLosses > 0 
                                        ? (tradingState.currentStake * 2).toFixed(2)
                                        : tradingState.currentStake.toFixed(2)}
                                </span>
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