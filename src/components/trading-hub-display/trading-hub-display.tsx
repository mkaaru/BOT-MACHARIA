import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import marketAnalyzer from '@/services/market-analyzer';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import './trading-hub-display.scss';

interface TradingState {
    isContinuousTrading: boolean;
    isAutoOverUnderActive: boolean;
    isAutoDifferActive: boolean;
    isAutoO5U4Active: boolean;
    isTradeInProgress: boolean;
    lastTradeTime: number;
    balance: number;
    profit: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    currentRecommendation: any;
    tradeHistory: any[];
}

interface MarketData {
    symbol: string;
    lastTick: number;
    recommendation: string;
    confidence: number;
    lastUpdate: number;
}

const TradingHubDisplay: React.FC = observer(() => {
    const { run_panel, dashboard } = useStore();
    const [tradingState, setTradingState] = useState<TradingState>({
        isContinuousTrading: false,
        isAutoOverUnderActive: false,
        isAutoDifferActive: false,
        isAutoO5U4Active: false,
        isTradeInProgress: false,
        lastTradeTime: 0,
        balance: 10000,
        profit: 0,
        totalTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        currentRecommendation: null,
        tradeHistory: []
    });

    const [botConfig, setBotConfig] = useState({
        selectedStrategy: 'martingale',
        initialStake: 1,
        martingaleMultiplier: 2,
        maxConsecutiveLosses: 5,
        stopLoss: 50,
        takeProfit: 100
    });

    // Martingale state management for direct trading
    const [martingaleState, setMartingaleState] = useState({
        currentStake: 1,
        consecutiveLosses: 0,
        isActive: false,
        totalProfit: 0
    });

    const [marketData, setMarketData] = useState<MarketData[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const tradeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-49), logMessage]);
        console.log('🔄', logMessage);
    }, []);

    // Sync bot configuration with bot builder immediately
    const updateBotBuilder = useCallback((config: typeof botConfig) => {
        // Update configuration in real-time
        if (window.dbot?.interpreter?.bot) {
            const botInterface = window.dbot.interpreter.bot.getInterface();

            // Update bot builder parameters immediately
            if (botInterface.updateConfig) {
                botInterface.updateConfig({
                    strategy: config.selectedStrategy,
                    initialStake: config.initialStake,
                    martingaleMultiplier: config.martingaleMultiplier,
                    maxConsecutiveLosses: config.maxConsecutiveLosses,
                    stopLoss: config.stopLoss,
                    takeProfit: config.takeProfit,
                    autoSymbolSelection: true,
                    autoContractSelection: true
                });
            }

            // Configure strategy settings
            botInterface.setMartingaleLimits?.(config.martingaleMultiplier, config.maxConsecutiveLosses);
            botInterface.setMartingaleEnabled?.(config.selectedStrategy.includes('martingale'));
            botInterface.setStopLoss?.(config.stopLoss);
            botInterface.setTakeProfit?.(config.takeProfit);
            botInterface.setInitialStake?.(config.initialStake);

            // Apply settings to trade engine
            if (window.dbot.interpreter.bot.tradeEngine) {
                window.dbot.interpreter.bot.tradeEngine.updateSettings({
                    stake: config.initialStake,
                    martingaleMultiplier: config.martingaleMultiplier,
                    maxLoss: config.maxConsecutiveLosses,
                    stopLoss: config.stopLoss,
                    takeProfit: config.takeProfit
                });
            }
        }
    }, []);

    const scrollToBottom = useCallback(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(scrollToBottom, [logs]);

    // Initialize market analyzer and API connection
    useEffect(() => {
        addLog('Initializing trading system...');

        // Check API connection
        if (!api_base.api) {
            addLog('❌ API not connected! Please ensure you are logged in to Deriv.');
            return;
        }

        addLog('✅ API connection available');

        if (!marketAnalyzer.isReadyForTrading()) {
            marketAnalyzer.start();
            addLog('Market analyzer started');
        }

        const unsubscribe = marketAnalyzer.onAnalysis((recommendation, allStats) => {
            if (recommendation) {
                addLog(`📊 New recommendation: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${recommendation.symbol} (${recommendation.reason})`);

                setTradingState(prev => ({
                    ...prev,
                    currentRecommendation: recommendation
                }));
            }

            // Update market data
            const newMarketData = Object.entries(allStats).map(([symbol, stats]) => ({
                symbol,
                lastTick: stats.currentLastDigit,
                recommendation: stats.recommendation,
                confidence: Math.max(...stats.digitPercentages),
                lastUpdate: stats.lastUpdated
            }));
            setMarketData(newMarketData);
        });

        return () => {
            unsubscribe();
            marketAnalyzer.stop();
        };
    }, []);

    // Auto-trade effect - separate from market analyzer
    useEffect(() => {
        if (tradingState.isContinuousTrading && 
            tradingState.currentRecommendation &&
            !tradingState.isTradeInProgress &&
            (tradingState.isAutoOverUnderActive || tradingState.isAutoDifferActive || tradingState.isAutoO5U4Active)) {

            // Clear any existing timeout
            if (tradeTimeoutRef.current) {
                clearTimeout(tradeTimeoutRef.current);
            }

            // Execute trade after a short delay to prevent rapid trades
            tradeTimeoutRef.current = setTimeout(() => {
                executeAutoTrade(tradingState.currentRecommendation);
            }, 1000);
        }

        return () => {
            if (tradeTimeoutRef.current) {
                clearTimeout(tradeTimeoutRef.current);
            }
        };
    }, [tradingState.isContinuousTrading, tradingState.currentRecommendation, tradingState.isTradeInProgress, 
        tradingState.isAutoOverUnderActive, tradingState.isAutoDifferActive, tradingState.isAutoO5U4Active]);

    // Direct trade engine execution bypassing market wizard
    const executeDirectTrade = useCallback(async (tradeConfig: any) => {
        if (!api_base.api) {
            addLog('❌ API not connected! Cannot execute trade.');
            return { success: false, error: 'API not connected' };
        }

        try {
            addLog(`🚀 Direct trade execution: ${tradeConfig.contract_type} on ${tradeConfig.symbol}`);
            
            // Step 1: Get proposal
            const proposalRequest = {
                proposal: 1,
                amount: tradeConfig.amount,
                basis: 'stake',
                contract_type: tradeConfig.contract_type,
                currency: 'USD',
                duration: tradeConfig.duration || 1,
                duration_unit: tradeConfig.duration_unit || 't',
                symbol: tradeConfig.symbol,
                ...(tradeConfig.barrier && { barrier: tradeConfig.barrier })
            };

            addLog(`📊 Getting proposal: ${JSON.stringify(proposalRequest)}`);
            const proposalResponse = await api_base.api.send(proposalRequest);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error.message };
            }

            if (!proposalResponse.proposal) {
                addLog(`❌ No proposal received`);
                return { success: false, error: 'No proposal received' };
            }

            const proposalId = proposalResponse.proposal.id;
            const displayValue = proposalResponse.proposal.display_value;
            addLog(`✅ Proposal received: ID=${proposalId}, Price=${displayValue}`);

            // Step 2: Purchase the contract
            const buyRequest = {
                buy: proposalId,
                price: tradeConfig.amount
            };

            addLog(`💰 Purchasing contract: ${JSON.stringify(buyRequest)}`);
            const buyResponse = await api_base.api.send(buyRequest);

            if (buyResponse.error) {
                addLog(`❌ Purchase error: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error.message };
            }

            if (!buyResponse.buy) {
                addLog(`❌ Purchase failed - no buy confirmation`);
                return { success: false, error: 'Purchase failed' };
            }

            const contractId = buyResponse.buy.contract_id;
            const buyPrice = buyResponse.buy.buy_price;
            addLog(`🎉 Contract purchased! ID=${contractId}, Price=${buyPrice}`);

            return {
                success: true,
                contract_id: contractId,
                buy_price: buyPrice,
                proposal_id: proposalId
            };

        } catch (error) {
            addLog(`💥 Direct trade execution failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }, [addLog]);

    // Strategy-specific trade logic
    const getTradeConfigForStrategy = useCallback((strategy: string, currentTick?: number) => {
        const baseConfig = {
            duration: 1,
            duration_unit: 't',
            amount: botConfig.initialStake,
            basis: 'stake'
        };

        // Get current last digit for analysis (mock data if no real tick)
        const lastDigit = currentTick ? currentTick % 10 : Math.floor(Math.random() * 10);
        
        if (strategy === 'overunder') {
            // Over/Under Strategy Logic
            const barrier = 5; // Can be dynamic based on analysis
            const isOver = lastDigit > barrier;
            
            return {
                ...baseConfig,
                symbol: '1HZ25V', // Volatility 25 (1s)
                contract_type: isOver ? 'DIGITUNDER' : 'DIGITOVER',
                barrier: barrier.toString(),
                strategyReason: `Last digit ${lastDigit} is ${isOver ? 'over' : 'under'} ${barrier}`
            };
        } else if (strategy === 'differ') {
            // Even/Odd Differ Strategy Logic
            const isEven = lastDigit % 2 === 0;
            
            return {
                ...baseConfig,
                symbol: '1HZ50V', // Volatility 50 (1s)
                contract_type: isEven ? 'DIGITODD' : 'DIGITEVEN',
                strategyReason: `Last digit ${lastDigit} is ${isEven ? 'even' : 'odd'}, predicting opposite`
            };
        } else if (strategy === 'o5u4') {
            // Over 5 Under 4 Strategy Logic
            const barrier = 5;
            const shouldGoOver = lastDigit <= 4;
            
            return {
                ...baseConfig,
                symbol: '1HZ75V', // Volatility 75 (1s)
                contract_type: shouldGoOver ? 'DIGITOVER' : 'DIGITUNDER',
                barrier: '4',
                strategyReason: `Last digit ${lastDigit}, ${shouldGoOver ? 'going OVER 4' : 'going UNDER 5'}`
            };
        }

        // Default fallback
        return {
            ...baseConfig,
            symbol: '1HZ10V',
            contract_type: 'DIGITEVEN',
            strategyReason: 'Default strategy'
        };
    }, [botConfig.initialStake]);

    const executeAutoTrade = useCallback(async (recommendation: any) => {
        if (tradingState.isTradeInProgress) {
            addLog('⏳ Trade already in progress, skipping...');
            return;
        }

        try {
            setTradingState(prev => ({ ...prev, isTradeInProgress: true }));
            
            // Determine which strategy is active
            let activeStrategy = '';
            if (tradingState.isAutoOverUnderActive) {
                activeStrategy = 'overunder';
            } else if (tradingState.isAutoDifferActive) {
                activeStrategy = 'differ';
            } else if (tradingState.isAutoO5U4Active) {
                activeStrategy = 'o5u4';
            }

            if (!activeStrategy) {
                addLog('❌ No active trading strategy selected');
                return;
            }

            addLog(`🎯 Executing ${activeStrategy.toUpperCase()} strategy with ${botConfig.selectedStrategy} money management`);

            // Get the current tick for strategy analysis
            const currentTick = recommendation?.lastTick || Math.floor(Math.random() * 10000);
            
            // Get trade configuration for the active strategy
            const tradeConfig = getTradeConfigForStrategy(activeStrategy, currentTick);
            
            addLog(`📊 Strategy Analysis: ${tradeConfig.strategyReason}`);
            addLog(`📋 Trade Config: ${tradeConfig.contract_type} on ${tradeConfig.symbol}${tradeConfig.barrier ? ` (Barrier: ${tradeConfig.barrier})` : ''}`);

            // Execute trade directly through API, bypassing bot builder
            const result = await executeDirectTrade(tradeConfig);
            
            if (result.success) {
                addLog(`✅ ${activeStrategy.toUpperCase()} trade executed: ${result.contract_id} (Price: ${result.buy_price})`);
                
                // Update trading state
                setTradingState(prev => ({
                    ...prev,
                    totalTrades: prev.totalTrades + 1,
                    lastTradeTime: Date.now(),
                    tradeHistory: [...prev.tradeHistory.slice(-19), {
                        time: Date.now(),
                        symbol: tradeConfig.symbol,
                        type: tradeConfig.contract_type,
                        barrier: tradeConfig.barrier || '',
                        amount: tradeConfig.amount,
                        status: 'purchased',
                        contractId: result.contract_id,
                        strategy: `${activeStrategy}_${botConfig.selectedStrategy}`,
                        buyPrice: result.buy_price,
                        strategyReason: tradeConfig.strategyReason
                    }]
                }));

                // Apply martingale logic for next trade
                if (botConfig.selectedStrategy === 'martingale') {
                    addLog(`🔄 Martingale enabled - will adjust stake on next trade based on result`);
                }

            } else {
                addLog(`❌ ${activeStrategy.toUpperCase()} trade execution failed: ${result.error}`);
            }

        } catch (error) {
            addLog(`❌ Auto trade execution error: ${error.message}`);
        } finally {
            // Reset trade in progress after delay
            setTimeout(() => {
                setTradingState(prev => ({ 
                    ...prev, 
                    isTradeInProgress: false,
                    currentRecommendation: null
                }));
            }, 3000); // Increased delay to allow for contract processing
        }
    }, [tradingState.isTradeInProgress, botConfig, tradingState.isAutoOverUnderActive, 
        tradingState.isAutoDifferActive, tradingState.isAutoO5U4Active, executeDirectTrade, 
        getTradeConfigForStrategy, addLog]);

    const executeTrade = async (params: any) => {
        try {
            addLog(`🔄 Sending proposal request...`);

            // Get proposal first
            const proposalResponse = await api_base.api.send(params);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error.message };
            }

            if (!proposalResponse.proposal) {
                addLog(`❌ No proposal received`);
                return { success: false, error: 'No proposal received' };
            }

            addLog(`✅ Proposal received: ${proposalResponse.proposal.id}, Price: ${proposalResponse.proposal.display_value}`);

            // Buy the contract
            const buyParams = {
                buy: proposalResponse.proposal.id,
                price: params.amount
            };

            addLog(`🔄 Sending buy request...`);
            const buyResponse = await api_base.api.send(buyParams);

            if (buyResponse.error) {
                addLog(`❌ Buy error: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error.message };
            }

            if (!buyResponse.buy) {
                addLog(`❌ No buy confirmation received`);
                return { success: false, error: 'No buy confirmation received' };
            }

            addLog(`✅ Contract purchased: ${buyResponse.buy.contract_id}`);
            return { success: true, contract_id: buyResponse.buy.contract_id };

        } catch (error) {
            addLog(`❌ Trade execution exception: ${error.message}`);
            return { success: false, error: error.message };
        }
    };

    const handleStrategyToggle = useCallback((strategy: string) => {
        setTradingState(prev => {
            const newState = { ...prev };

            // Deactivate all other strategies when one is selected (only one active at a time)
            newState.isAutoOverUnderActive = false;
            newState.isAutoDifferActive = false;
            newState.isAutoO5U4Active = false;

            switch (strategy) {
                case 'overunder':
                    newState.isAutoOverUnderActive = !prev.isAutoOverUnderActive;
                    if (newState.isAutoOverUnderActive) {
                        addLog(`🎯 Auto Over/Under Strategy ACTIVATED - Independent trading on Volatility 25`);
                        addLog(`📊 Strategy: Predicts OVER/UNDER based on last digit analysis`);
                    } else {
                        addLog(`❌ Auto Over/Under Strategy DEACTIVATED`);
                    }
                    break;
                case 'differ':
                    newState.isAutoDifferActive = !prev.isAutoDifferActive;
                    if (newState.isAutoDifferActive) {
                        addLog(`🎯 Auto Differ Strategy ACTIVATED - Independent trading on Volatility 50`);
                        addLog(`📊 Strategy: Predicts opposite of current EVEN/ODD pattern`);
                    } else {
                        addLog(`❌ Auto Differ Strategy DEACTIVATED`);
                    }
                    break;
                case 'o5u4':
                    newState.isAutoO5U4Active = !prev.isAutoO5U4Active;
                    if (newState.isAutoO5U4Active) {
                        addLog(`🎯 Auto O5U4 Strategy ACTIVATED - Independent trading on Volatility 75`);
                        addLog(`📊 Strategy: Over 5 when last digit ≤4, Under 4 when last digit >4`);
                    } else {
                        addLog(`❌ Auto O5U4 Strategy DEACTIVATED`);
                    }
                    break;
            }

            return newState;
        });
    }, [addLog]);

    const toggleContinuousTrading = useCallback(() => {
        setTradingState(prev => {
            const newState = !prev.isContinuousTrading;
            addLog(`Continuous trading ${newState ? 'started' : 'stopped'}`);

            if (newState) {
                // Start the main run panel if not already running
                if (!run_panel.is_running) {
                    addLog(`🚀 Starting main trading engine...`);
                    // Trigger the main run button
                    run_panel.onRunButtonClick();
                }
            } else {
                // Stop the main run panel if running
                if (run_panel.is_running) {
                    addLog(`⏹️ Stopping main trading engine...`);
                    run_panel.onStopButtonClick();
                }
            }

            return { ...prev, isContinuousTrading: newState };
        });
    }, [addLog, run_panel]);

    const resetStats = useCallback(() => {
        setTradingState(prev => ({
            ...prev,
            profit: 0,
            totalTrades: 0,
            winTrades: 0,
            lossTrades: 0,
            tradeHistory: []
        }));
        addLog('Statistics reset');
    }, [addLog]);

    const executeManualTrade = useCallback(async () => {
        if (!tradingState.currentRecommendation) {
            addLog('❌ No recommendation available for manual trade');
            return;
        }

        if (run_panel.is_running) {
            addLog('⚠️ Main trading engine is running, manual trade not available');
            return;
        }

        addLog('🎯 Executing manual trade...');
        await executeAutoTrade(tradingState.currentRecommendation);
    }, [tradingState.currentRecommendation, executeAutoTrade, run_panel.is_running]);

    // Sync with Run Panel state
    useEffect(() => {
        if (run_panel.is_running && !tradingState.isContinuousTrading) {
            setTradingState(prev => ({ ...prev, isContinuousTrading: true }));
            addLog('🔗 Synced with main trading engine - Trading started');
        } else if (!run_panel.is_running && tradingState.isContinuousTrading) {
            setTradingState(prev => ({ ...prev, isContinuousTrading: false }));
            addLog('🔗 Synced with main trading engine - Trading stopped');
        }
    }, [run_panel.is_running, tradingState.isContinuousTrading, addLog]);

    // Contract monitoring for direct trades
    useEffect(() => {
        if (!api_base.api) return;

        const subscription = api_base.api.onMessage().subscribe(({ data }) => {
            // Monitor contract updates
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                const contract = data.proposal_open_contract;
                
                if (contract.is_sold) {
                    const profit = parseFloat(contract.sell_price) - parseFloat(contract.buy_price);
                    const isWin = profit > 0;
                    
                    addLog(`📊 Contract ${contract.contract_id} closed: P&L ${profit > 0 ? '+' : ''}${profit.toFixed(2)}`);
                    
                    // Update trading statistics
                    setTradingState(prev => ({
                        ...prev,
                        profit: prev.profit + profit,
                        winTrades: isWin ? prev.winTrades + 1 : prev.winTrades,
                        lossTrades: !isWin ? prev.lossTrades + 1 : prev.lossTrades
                    }));

                    // Handle martingale logic for direct trades
                    if (botConfig.selectedStrategy === 'martingale') {
                        setMartingaleState(prev => {
                            const newConsecutiveLosses = isWin ? 0 : prev.consecutiveLosses + 1;
                            const newStake = isWin ? 
                                botConfig.initialStake : 
                                Math.min(
                                    prev.currentStake * botConfig.martingaleMultiplier,
                                    botConfig.initialStake * Math.pow(botConfig.martingaleMultiplier, botConfig.maxConsecutiveLosses)
                                );

                            addLog(`🎲 Martingale: ${isWin ? 'WIN' : 'LOSS'} - Next stake: ${newStake}, Consecutive losses: ${newConsecutiveLosses}`);

                            return {
                                ...prev,
                                currentStake: newStake,
                                consecutiveLosses: newConsecutiveLosses,
                                totalProfit: prev.totalProfit + profit,
                                isActive: newConsecutiveLosses > 0 && newConsecutiveLosses < botConfig.maxConsecutiveLosses
                            };
                        });

                        // Update bot config with new stake for next trade
                        setBotConfig(prevConfig => ({
                            ...prevConfig,
                            initialStake: isWin ? prevConfig.initialStake : 
                                Math.min(
                                    martingaleState.currentStake * prevConfig.martingaleMultiplier,
                                    prevConfig.initialStake * Math.pow(prevConfig.martingaleMultiplier, prevConfig.maxConsecutiveLosses)
                                )
                        }));
                    }
                }
            }

            // Handle transaction events
            if (data.msg_type === 'transaction' && data.transaction) {
                const transaction = data.transaction;
                if (transaction.action === 'buy') {
                    addLog(`💰 Transaction: Buy ${transaction.contract_id} for ${transaction.amount}`);
                } else if (transaction.action === 'sell') {
                    addLog(`💸 Transaction: Sell ${transaction.contract_id} for ${transaction.amount}`);
                }
            }
        });

        api_base.pushSubscription(subscription);

        return () => {
            subscription.unsubscribe();
        };
    }, [addLog, botConfig.selectedStrategy, botConfig.martingaleMultiplier, 
        botConfig.maxConsecutiveLosses, botConfig.initialStake, martingaleState.currentStake]);

    return (
        <div className="trading-hub-container">
            <div className="trading-hub-header">
                <h2>🎯 Deriv Trading Hub</h2>
                <div className="status-indicator">
                    <span className={`status-dot ${api_base.api ? 'connected' : 'disconnected'}`}></span>
                    {api_base.api ? 'Connected' : 'Disconnected'}
                </div>
            </div>

            <div className="trading-hub-content">
                <div className="connection-status">
                    <h3>🔗 System Status</h3>
                    <div className="status-grid">
                        <div className="status-item">
                            <span className="status-label">API:</span>
                            <span className={`status-value ${api_base.api ? 'connected' : 'disconnected'}`}>
                                {api_base.api ? '✅ Connected' : '❌ Disconnected'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">Market Analyzer:</span>
                            <span className={`status-value ${marketAnalyzer.isReadyForTrading() ? 'connected' : 'disconnected'}`}>
                                {marketAnalyzer.isReadyForTrading() ? '✅ Ready' : '⏳ Loading...'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">Trade Status:</span>
                            <span className={`status-value ${(tradingState.isTradeInProgress || run_panel.is_running) ? 'trading' : 'idle'}`}>
                                {(tradingState.isTradeInProgress || run_panel.is_running) ? '🔄 Trading' : '💤 Idle'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="status-label">Engine State:</span>
                            <span className={`status-value ${run_panel.is_running ? 'connected' : 'disconnected'}`}>
                                {run_panel.is_running ? '🟢 Running' : '🔴 Stopped'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="bot-configuration-section">
                    <h3>⚙️ Auto Trading Configuration</h3>
                    <div className="config-grid">
                        <div className="config-group">
                            <label>Strategy:</label>
                            <select 
                                value={botConfig.selectedStrategy} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, selectedStrategy: e.target.value};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                    addLog(`🔄 Strategy changed to: ${e.target.value.toUpperCase()}`);
                                }}
                                disabled={tradingState.isContinuousTrading}
                            >
                                <option value="martingale">Martingale</option>
                                <option value="dalembert">D'Alembert</option>
                                <option value="oscars_grind">Oscar's Grind</option>
                                <option value="reverse_martingale">Reverse Martingale</option>
                            </select>
                        </div>
                        <div className="config-group">
                            <label>Initial Stake ($):</label>
                            <input 
                                type="number" 
                                value={botConfig.initialStake} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, initialStake: parseFloat(e.target.value) || 1};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="0.35" 
                                step="0.01"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Martingale Multiplier:</label>
                            <input 
                                type="number" 
                                value={botConfig.martingaleMultiplier} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, martingaleMultiplier: parseFloat(e.target.value) || 2};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1.1" 
                                step="0.1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Max Consecutive Losses:</label>
                            <input 
                                type="number" 
                                value={botConfig.maxConsecutiveLosses} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, maxConsecutiveLosses: parseInt(e.target.value) || 5};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1" 
                                step="1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Stop Loss ($):</label>
                            <input 
                                type="number" 
                                value={botConfig.stopLoss} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, stopLoss: parseFloat(e.target.value) || 50};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1" 
                                step="1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                        <div className="config-group">
                            <label>Take Profit ($):</label>
                            <input 
                                type="number" 
                                value={botConfig.takeProfit} 
                                onChange={(e) => {
                                    const newConfig = {...botConfig, takeProfit: parseFloat(e.target.value) || 100};
                                    setBotConfig(newConfig);
                                    updateBotBuilder(newConfig);
                                }}
                                min="1" 
                                step="1"
                                disabled={tradingState.isContinuousTrading}
                            />
                        </div>
                    </div>
                    <div className="config-info">
                        <p>📍 Symbol & Contract Type are automatically selected based on active trading strategy</p>
                    </div>
                </div>

                <div className="recommendation-section">
                    <h3>📊 Current Recommendation</h3>
                    {tradingState.currentRecommendation ? (
                        <div className="recommendation-card">
                            <div className="rec-header">
                                <span className="rec-symbol">{tradingState.currentRecommendation.symbol}</span>
                                <span className="rec-type">
                                    {tradingState.currentRecommendation.strategy.toUpperCase()} {tradingState.currentRecommendation.barrier}
                                </span>
                            </div>
                            <div className="rec-reason">{tradingState.currentRecommendation.reason}</div>
                            <div className="rec-percentages">
                                Over: {tradingState.currentRecommendation.overPercentage?.toFixed(1)}% | 
                                Under: {tradingState.currentRecommendation.underPercentage?.toFixed(1)}%
                            </div>
                        </div>
                    ) : (
                        <div className="no-recommendation">
                            Waiting for market analysis...
                        </div>
                    )}
                </div>

                <div className="strategy-section">
                    <h3>⚙️ Independent Trading Strategies</h3>
                    <p className="strategy-note">Select ONE strategy to activate (bypasses DBot interface):</p>
                    <div className="strategy-toggles">
                        <label className="strategy-toggle">
                            <input
                                type="radio"
                                name="trading_strategy"
                                checked={tradingState.isAutoOverUnderActive}
                                onChange={() => handleStrategyToggle('overunder')}
                                disabled={tradingState.isContinuousTrading}
                            />
                            <span>Auto Over/Under (Vol 25)</span>
                        </label>
                        <label className="strategy-toggle">
                            <input
                                type="radio"
                                name="trading_strategy"
                                checked={tradingState.isAutoDifferActive}
                                onChange={() => handleStrategyToggle('differ')}
                                disabled={tradingState.isContinuousTrading}
                            />
                            <span>Auto Differ (Vol 50)</span>
                        </label>
                        <label className="strategy-toggle">
                            <input
                                type="radio"
                                name="trading_strategy"
                                checked={tradingState.isAutoO5U4Active}
                                onChange={() => handleStrategyToggle('o5u4')}
                                disabled={tradingState.isContinuousTrading}
                            />
                            <span>Auto O5U4 (Vol 75)</span>
                        </label>
                        <label className="strategy-toggle">
                            <input
                                type="radio"
                                name="trading_strategy"
                                checked={!tradingState.isAutoOverUnderActive && !tradingState.isAutoDifferActive && !tradingState.isAutoO5U4Active}
                                onChange={() => {
                                    setTradingState(prev => ({
                                        ...prev,
                                        isAutoOverUnderActive: false,
                                        isAutoDifferActive: false,
                                        isAutoO5U4Active: false
                                    }));
                                    addLog('🚫 All independent strategies deactivated');
                                }}
                                disabled={tradingState.isContinuousTrading}
                            />
                            <span>None (Use DBot)</span>
                        </label>
                    </div>
                </div>

                <div className="control-section">
                    <h3>🎮 Trading Controls</h3>
                    <div className="control-buttons">
                        <button
                            className={`control-btn ${(tradingState.isContinuousTrading || run_panel.is_running) ? 'stop-btn' : 'start-btn'}`}
                            onClick={toggleContinuousTrading}
                            disabled={tradingState.isTradeInProgress || run_panel.is_stop_button_disabled}
                        >
                            {(tradingState.isContinuousTrading || run_panel.is_running) ? '⏹️ Stop Trading' : '▶️ Start Trading'}
                        </button>

                        <button
                            className="control-btn manual-btn"
                            onClick={executeManualTrade}
                            disabled={tradingState.isTradeInProgress || !tradingState.currentRecommendation || run_panel.is_running}
                        >
                            🎯 Manual Trade
                        </button>

                        <button
                            className="control-btn reset-btn"
                            onClick={resetStats}
                        >
                            🔄 Reset Stats
                        </button>
                    </div>
                </div>

                <div className="trading-summary-section">
                    <h3>📊 Direct Trading Engine Summary</h3>
                    <div className="summary-grid">
                        <div className="summary-item">
                            <span className="summary-label">Trade Mode:</span>
                            <span className="summary-value">🚀 DIRECT API (Bypassing Wizard)</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Strategy:</span>
                            <span className="summary-value">{botConfig.selectedStrategy.toUpperCase()}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Total Trades:</span>
                            <span className="summary-value">{tradingState.totalTrades}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Win Rate:</span>
                            <span className="summary-value">
                                {tradingState.totalTrades > 0 ? 
                                    ((tradingState.winTrades / tradingState.totalTrades) * 100).toFixed(1) : 0}%
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Total P&L:</span>
                            <span className={`summary-value ${tradingState.profit >= 0 ? 'profit' : 'loss'}`}>
                                ${tradingState.profit.toFixed(2)}
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Current Stake:</span>
                            <span className="summary-value">${botConfig.initialStake}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Martingale State:</span>
                            <span className="summary-value">
                                {martingaleState.isActive ? 
                                    `🔄 Active (${martingaleState.consecutiveLosses} losses)` : 
                                    '✅ Reset'}
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Stop Loss:</span>
                            <span className="summary-value">${botConfig.stopLoss}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Take Profit:</span>
                            <span className="summary-value">${botConfig.takeProfit}</span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Auto Symbol:</span>
                            <span className="summary-value">
                                {tradingState.isAutoOverUnderActive ? '1HZ25V' : 
                                 tradingState.isAutoDifferActive ? '1HZ50V' : 
                                 tradingState.isAutoO5U4Active ? '1HZ75V' : '1HZ10V'}
                            </span>
                        </div>
                        <div className="summary-item">
                            <span className="summary-label">Auto Contract:</span>
                            <span className="summary-value">
                                {tradingState.isAutoOverUnderActive ? 'Over/Under' : 
                                 tradingState.isAutoDifferActive ? 'Even/Odd' : 
                                 tradingState.isAutoO5U4Active ? 'O5U4' : 'Strategy-Based'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="trade-history-section">
                    <h3>📋 Recent Trades</h3>
                    <div className="trade-history-container">
                        {tradingState.tradeHistory.length > 0 ? (
                            <table className="trade-history-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Symbol</th>
                                        <th>Type</th>
                                        <th>Amount</th>
                                        <th>Strategy</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tradingState.tradeHistory.slice(-10).reverse().map((trade, index) => (
                                        <tr key={index}>
                                            <td>{new Date(trade.time).toLocaleTimeString()}</td>
                                            <td>{trade.symbol}</td>
                                            <td>{trade.type}</td>
                                            <td>${trade.amount}</td>
                                            <td>{trade.strategy || 'manual'}</td>
                                            <td className={`status-${trade.status}`}>{trade.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="no-trades">No trades executed yet</div>
                        )}
                    </div>
                </div>


            </div>
        </div>
    );
});

export default TradingHubDisplay;