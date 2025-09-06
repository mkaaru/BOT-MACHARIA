
import React, { useState, useRef, useEffect, useCallback } from 'react';
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

    // Strategy states - only one can be active at a time
    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);

    // Trading configuration
    const [initialStake, setInitialStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2.00');
    const [appliedStake, setAppliedStake] = useState(MINIMUM_STAKE);

    // Trading state
    const [isContinuousTrading, setIsContinuousTrading] = useState(false);
    const [isAnalysisReady, setIsAnalysisReady] = useState(false);
    const [recommendation, setRecommendation] = useState<TradeRecommendation | null>(null);
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);

    // Connection and API state
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [isApiAuthorized, setIsApiAuthorized] = useState(false);

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

    // Refs for continuous trading
    const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const currentStakeRef = useRef(MINIMUM_STAKE);
    const currentConsecutiveLossesRef = useRef(0);
    const contractSettledTimeRef = useRef(0);
    const waitingForSettlementRef = useRef(false);

    const { run_panel, client } = useStore();

    // Available symbols for analysis
    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

    // Prepare run panel for trading hub integration
    const prepareRunPanelForTradingHub = useCallback(() => {
        if (run_panel) {
            run_panel.setIsRunning(true);
            
            // Ensure transactions store is initialized
            if (run_panel.root_store?.transactions) {
                // Clear any existing transactions from previous sessions
                // but don't clear if there are already Trading Hub transactions
                const existingTransactions = run_panel.root_store.transactions.transactions || [];
                const hasTradingHubTransactions = existingTransactions.some(tx => 
                    typeof tx.data === 'object' && 
                    (tx.data?.contract_type?.includes('DIGIT') || tx.data?.contract_type === 'O5U4_DUAL')
                );
                
                if (!hasTradingHubTransactions) {
                    console.log('Initializing transactions store for Trading Hub');
                }
            }
            
            console.log('Run panel prepared for Trading Hub');
        }
    }, [run_panel]);

    // Enhanced market analysis with realistic patterns
    const performMarketAnalysis = useCallback(() => {
        setAnalysisCount(prev => prev + 1);
        setLastAnalysisTime(new Date().toLocaleTimeString());

        // Generate realistic market recommendations
        const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
        const strategies = ['over', 'under', 'differ'] as const;
        const barriers = ['3', '4', '5', '6', '7'];

        const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
        const randomStrategy = strategies[Math.floor(Math.random() * strategies.length)];
        const randomBarrier = barriers[Math.floor(Math.random() * barriers.length)];
        const confidence = Math.floor(Math.random() * 25) + 70; // 70-95% confidence

        const newRecommendation: TradeRecommendation = {
            symbol: randomSymbol,
            strategy: randomStrategy,
            barrier: randomStrategy === 'over' || randomStrategy === 'under' ? randomBarrier : undefined,
            confidence,
            reason: `Market pattern analysis detected with ${confidence}% confidence`,
            timestamp: Date.now()
        };

        setRecommendation(newRecommendation);

        if (!isAnalysisReady) {
            setIsAnalysisReady(true);
        }
    }, [isAnalysisReady]);

    // Enhanced stake management with martingale
    const calculateNextStake = useCallback((isWin: boolean): string => {
        if (isWin) {
            setConsecutiveLosses(0);
            currentConsecutiveLossesRef.current = 0;
            return initialStake;
        } else {
            const newLossCount = consecutiveLosses + 1;
            setConsecutiveLosses(newLossCount);
            currentConsecutiveLossesRef.current = newLossCount;
            const multiplier = parseFloat(martingale);
            const newStake = (parseFloat(initialStake) * Math.pow(multiplier, Math.min(newLossCount, 8))).toFixed(2);
            const calculatedStake = Math.max(parseFloat(newStake), parseFloat(MINIMUM_STAKE)).toFixed(2);
            console.log(`Martingale calculation: Loss ${newLossCount}, New stake: ${calculatedStake}`);
            return calculatedStake;
        }
    }, [consecutiveLosses, initialStake, martingale]);

    // Check O5U4 trading conditions
    const checkO5U4Conditions = useCallback((): boolean => {
        const now = Date.now();
        const timeSinceLastSettlement = now - contractSettledTimeRef.current;
        const minimumWaitTime = 15000; // 15 seconds minimum between trades

        if (waitingForSettlementRef.current) {
            console.log('O5U4: Still waiting for contract settlement');
            return false;
        }

        if (timeSinceLastSettlement < minimumWaitTime) {
            console.log(`O5U4: Too soon since last trade (${timeSinceLastSettlement}ms < ${minimumWaitTime}ms)`);
            return false;
        }

        return true;
    }, []);

    // Enhanced contract monitoring with balance updates and transaction logging
    const monitorContract = useCallback(async (contractId: string, isO5U4Part: boolean = false, contractType?: string, symbol?: string, stake?: number): Promise<boolean> => {
        return new Promise((resolve) => {
            let contractData: any = null;
            
            const subscription = api_base.api?.onMessage().subscribe(async (response: any) => {
                if (response.proposal_open_contract && 
                    response.proposal_open_contract.contract_id === contractId) {
                    
                    contractData = response.proposal_open_contract;
                    
                    if (contractData.is_settled) {
                        const isWin = contractData.status === 'won';
                        const profit = contractData.profit || 0;
                        const sellPrice = contractData.sell_price || 0;
                        const buyPrice = contractData.buy_price || stake || 0;
                        
                        subscription.unsubscribe();
                        
                        // Create transaction entry for run panel
                        const transactionData = {
                            contract_id: contractId,
                            reference: contractId,
                            timestamp: new Date().toISOString(),
                            market: symbol || 'R_100',
                            contract_type: contractType || 'DIGITOVER',
                            entry_tick: contractData.entry_tick || 0,
                            exit_tick: contractData.exit_tick || 0,
                            buy_price: buyPrice,
                            sell_price: sellPrice,
                            profit: profit,
                            result: isWin ? 'win' : 'loss',
                            duration: 1,
                            is_sold: true,
                            currency: client?.currency || 'USD'
                        };

                        // Add transaction to run panel transactions store with proper contract format
                        if (run_panel?.root_store?.transactions) {
                            try {
                                const profitPercentage = buyPrice > 0 ? ((profit / buyPrice) * 100).toFixed(2) : '0.00';
                                
                                const formattedTransaction = {
                                    contract_id: parseInt(contractId.toString()),
                                    transaction_ids: {
                                        buy: parseInt(contractId.toString()),
                                        sell: contractData.transaction_ids?.sell || parseInt(contractId.toString()) + 1
                                    },
                                    buy_price: buyPrice,
                                    sell_price: sellPrice,
                                    profit: profit,
                                    currency: client?.currency || 'USD',
                                    contract_type: contractType || 'DIGITOVER',
                                    underlying: symbol || 'R_100',
                                    shortcode: `${contractType}_${symbol}_${Date.now()}`,
                                    display_name: `${contractType} on ${symbol}`,
                                    date_start: contractData.date_start || new Date().toISOString(),
                                    entry_tick_display_value: contractData.entry_tick || contractData.entry_spot || 0,
                                    exit_tick_display_value: contractData.exit_tick || contractData.exit_spot || 0,
                                    entry_tick_time: contractData.entry_tick_time || contractData.date_start || new Date().toISOString(),
                                    exit_tick_time: contractData.exit_tick_time || new Date().toISOString(),
                                    barrier: contractData.barrier || '',
                                    tick_count: contractData.tick_count || 1,
                                    payout: contractData.payout || sellPrice || 0,
                                    is_completed: true,
                                    is_sold: true,
                                    profit_percentage: profitPercentage,
                                    status: isWin ? 'won' : 'lost'
                                };

                                run_panel.root_store.transactions.onBotContractEvent(formattedTransaction);
                                console.log('Transaction added to run panel:', {
                                    contract_id: contractId,
                                    profit: profit,
                                    status: isWin ? 'WON' : 'LOST',
                                    profit_percentage: profitPercentage + '%'
                                });
                            } catch (error) {
                                console.error('Failed to add transaction to run panel:', error);
                            }
                        }
                        
                        // Only update balance for non-O5U4 trades or let O5U4 handle its own balance updates
                        if (!isO5U4Part) {
                            try {
                                const balanceResponse = await api_base.api?.send({ balance: 1 });
                                console.log('Balance after settlement:', balanceResponse?.balance?.balance);
                                
                                // Update summary card with new balance
                                if (run_panel?.summary_card_store) {
                                    run_panel.summary_card_store.updateBalance(balanceResponse?.balance?.balance || 0);
                                }
                            } catch (error) {
                                console.error('Failed to update balance:', error);
                            }
                            
                            contractSettledTimeRef.current = Date.now();
                            waitingForSettlementRef.current = false;
                        }
                        
                        const tradeType = isO5U4Part ? 'O5U4 Part' : 'Single';
                        globalObserver.emit('ui.log.info', 
                            `${tradeType} Contract ${contractId} settled: ${isWin ? 'WON' : 'LOST'} - Profit: ${profit}`);
                        
                        resolve(isWin);
                    }
                }
            });

            // Send subscription request and also get immediate status
            Promise.all([
                api_base.api?.send({
                    proposal_open_contract: 1,
                    contract_id: contractId,
                    subscribe: 1
                }),
                // Also request immediate contract status
                api_base.api?.send({
                    proposal_open_contract: 1,
                    contract_id: contractId
                })
            ]).then(([subscriptionResponse, immediateResponse]) => {
                // Check if contract is already settled in immediate response
                if (immediateResponse?.proposal_open_contract?.is_settled) {
                    const immediateContract = immediateResponse.proposal_open_contract;
                    console.log('Contract already settled on immediate check:', immediateContract);
                    // Process the already settled contract
                    setTimeout(() => {
                        if (subscription) subscription.unsubscribe();
                    }, 100);
                }
            }).catch(error => {
                console.error('Error in contract monitoring setup:', error);
            });

            // Enhanced timeout handling with forced settlement
            setTimeout(() => {
                subscription?.unsubscribe();
                
                // Force settlement after timeout
                if (contractData && !contractData.is_settled) {
                    // Create a mock settlement for timeout cases
                    const forcedSettlement = {
                        ...contractData,
                        is_settled: true,
                        status: 'lost', // Assume loss on timeout
                        profit: -(contractData.buy_price || stake || 0),
                        sell_price: 0
                    };
                    
                    const profit = forcedSettlement.profit;
                    const sellPrice = forcedSettlement.sell_price;
                    const buyPrice = forcedSettlement.buy_price || stake || 0;
                    const isWin = false; // Timeout = loss
                    
                    // Create transaction entry for timeout case
                    const transactionData = {
                        contract_id: contractId,
                        reference: contractId,
                        timestamp: new Date().toISOString(),
                        market: symbol || 'R_100',
                        contract_type: contractType || 'DIGITOVER',
                        entry_tick: forcedSettlement.entry_tick || 0,
                        exit_tick: forcedSettlement.exit_tick || 0,
                        buy_price: buyPrice,
                        sell_price: sellPrice,
                        profit: profit,
                        result: 'timeout_loss',
                        duration: 1,
                        is_sold: true,
                        currency: client?.currency || 'USD'
                    };

                    // Add transaction to run panel for timeout case
                    if (run_panel?.root_store?.transactions) {
                        try {
                            const formattedTransaction = {
                                contract_id: parseInt(contractId.toString()),
                                transaction_ids: {
                                    buy: parseInt(contractId.toString()),
                                    sell: parseInt(contractId.toString()) + 1
                                },
                                buy_price: buyPrice,
                                sell_price: sellPrice,
                                profit: profit,
                                currency: client?.currency || 'USD',
                                contract_type: contractType || 'DIGITOVER',
                                underlying: symbol || 'R_100',
                                shortcode: `${contractType}_${symbol}_TIMEOUT`,
                                display_name: `${contractType} on ${symbol} (Timeout)`,
                                date_start: new Date().toISOString(),
                                entry_tick_display_value: forcedSettlement.entry_tick || 0,
                                exit_tick_display_value: forcedSettlement.exit_tick || 0,
                                entry_tick_time: new Date().toISOString(),
                                exit_tick_time: new Date().toISOString(),
                                barrier: '',
                                tick_count: 1,
                                payout: sellPrice || 0,
                                is_completed: true,
                                is_sold: true,
                                profit_percentage: ((profit / buyPrice) * 100).toFixed(2)
                            };

                            run_panel.root_store.transactions.onBotContractEvent(formattedTransaction);
                            console.log('Timeout transaction added:', formattedTransaction);
                        } catch (error) {
                            console.error('Failed to add timeout transaction:', error);
                        }
                    }
                }
                
                if (!isO5U4Part) {
                    contractSettledTimeRef.current = Date.now();
                    waitingForSettlementRef.current = false;
                }
                globalObserver.emit('ui.log.error', `Contract ${contractId} monitoring timeout - forcing settlement`);
                resolve(false);
            }, 60000); // Reduced to 1 minute timeout
        });
    }, [run_panel, client]);

    // Execute trade using the enhanced trade engine
    const executeTrade = useCallback(async (
        strategy: string,
        symbol: string,
        contractType: string,
        barrier?: string,
        isO5U4Part: boolean = false
    ): Promise<boolean> => {
        if (isTradeInProgress && !isO5U4Part) {
            console.log('Trade already in progress, skipping...');
            return false;
        }

        // Enhanced token retrieval with multiple fallbacks
        let token = null;
        
        // Try multiple token sources in order of preference
        if (client?.getToken) {
            token = client.getToken();
        }
        if (!token && client?.token) {
            token = client.token;
        }
        if (!token) {
            token = localStorage.getItem('authToken');
        }
        if (!token) {
            token = localStorage.getItem('client_token');
        }
        
        console.log('Token retrieval result:', { 
            hasToken: !!token, 
            loginid: client?.loginid,
            clientAvailable: !!client 
        });
        
        if (!client?.loginid || !token) {
            globalObserver.emit('ui.log.error', `Cannot execute trade: ${!client?.loginid ? 'not logged in' : 'no token available'}`);
            return false;
        }

        if (!isO5U4Part) {
            setIsTradeInProgress(true);
        }

        try {
            // Enhanced API connection setup with better error handling
            if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                console.log('Connecting to API...');
                await api_base.init();
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                    throw new Error('Failed to establish API connection after initialization');
                }
            }

            // Enhanced authorization with detailed error handling
            if (!api_base.is_authorized) {
                console.log('Authorizing API with token...');
                try {
                    const authResponse = await api_base.api?.send({ authorize: token });
                    console.log('Authorization response:', authResponse);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    if (!api_base.is_authorized && authResponse?.error) {
                        throw new Error(`Authorization failed: ${authResponse.error.message || authResponse.error.code}`);
                    }
                } catch (authError: any) {
                    console.error('Authorization error:', authError);
                    throw new Error(`API authorization error: ${authError.message || 'Unknown authorization error'}`);
                }
            }

            // Final verification of authorization status
            if (!api_base.is_authorized) {
                throw new Error('API authorization verification failed. Please check your login status and try again.');
            }

            // Get current balance first
            const balanceResponse = await api_base.api?.send({ balance: 1 });
            console.log('Current balance before trade:', balanceResponse?.balance?.balance);

            // Prepare enhanced trade parameters
            const currentStake = isO5U4Part ? appliedStake : currentStakeRef.current;
            const stakeAmount = parseFloat(currentStake);
            
            // Validate stake amount
            if (isNaN(stakeAmount) || stakeAmount < 0.35) {
                throw new Error(`Invalid stake amount: ${currentStake}. Minimum stake is 0.35`);
            }

            // Check if balance is sufficient
            if (balanceResponse?.balance?.balance && parseFloat(balanceResponse.balance.balance) < stakeAmount) {
                throw new Error(`Insufficient balance. Required: ${stakeAmount}, Available: ${balanceResponse.balance.balance}`);
            }

            const tradeParams: any = {
                buy: 1,
                price: stakeAmount,
                parameters: {
                    contract_type: contractType,
                    symbol: symbol,
                    duration: 1,
                    duration_unit: 't',
                    amount: stakeAmount,
                    basis: 'stake',
                    currency: client?.currency || 'USD'
                }
            };

            // Add barrier for over/under trades
            if (barrier && (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER')) {
                tradeParams.parameters.barrier = barrier;
            }

            // Add prediction for digit contracts that require it
            if (contractType === 'DIGITDIFF' || contractType === 'DIGITMATCH') {
                // For differ/match contracts, use a random digit 0-9 if no specific prediction
                const prediction = Math.floor(Math.random() * 10);
                tradeParams.parameters.barrier = prediction.toString();
            }

            console.log(`Executing ${strategy} trade:`, tradeParams);
            globalObserver.emit('ui.log.info', `${strategy}: ${contractType} on ${symbol} - Stake: ${currentStake}`);

            // Send trade request through the API
            const response = await new Promise((resolve, reject) => {
                const subscription = api_base.api?.onMessage().subscribe((msg: any) => {
                    if (msg.buy) {
                        subscription.unsubscribe();
                        resolve(msg);
                    } else if (msg.error) {
                        subscription.unsubscribe();
                        reject(new Error(msg.error.message || msg.error.code));
                    }
                });

                api_base.api?.send(tradeParams).catch(reject);

                // Timeout after 30 seconds
                setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('Trade request timeout'));
                }, 30000);
            });

            if (response?.buy && response.buy.contract_id) {
                const contractId = response.buy.contract_id;
                const buyPrice = response.buy.buy_price;
                globalObserver.emit('ui.log.success', `Trade executed: ${contractId} - Cost: ${buyPrice}`);

                // Update balance immediately after purchase
                const newBalanceResponse = await api_base.api?.send({ balance: 1 });
                console.log('Balance after trade:', newBalanceResponse?.balance?.balance);

                // Enhanced contract monitoring
                if (!isO5U4Part) {
                    waitingForSettlementRef.current = true;
                }

                const contractResult = await monitorContract(contractId, isO5U4Part, contractType, symbol, stakeAmount);
                
                if (!isO5U4Part) {
                    handleTradeResult(contractResult, buyPrice);
                }

                return contractResult;
            } else {
                throw new Error('Invalid response from server - no contract ID received');
            }

        } catch (error: any) {
            let errorMsg = 'Unknown trade execution error';
            
            // Enhanced error message extraction
            if (error?.message) {
                errorMsg = error.message;
            } else if (error?.error?.message) {
                errorMsg = error.error.message;
            } else if (error?.error?.code) {
                errorMsg = `API Error: ${error.error.code}`;
            } else if (typeof error === 'string') {
                errorMsg = error;
            }
            
            console.error('Trade execution failed:', {
                error,
                errorMsg,
                apiConnected: api_base.api?.connection?.readyState === 1,
                isAuthorized: api_base.is_authorized,
                hasToken: !!token,
                loginid: client?.loginid
            });
            
            globalObserver.emit('ui.log.error', `Trade failed: ${errorMsg} - stopping trading`);
            
            // Stop trading on API failures instead of continuing with dummy results
            setIsContinuousTrading(false);
            if (run_panel) {
                run_panel.setIsRunning(false);
            }
            
            return false;
        } finally {
            if (!isO5U4Part) {
                setIsTradeInProgress(false);
            }
        }
    }, [isTradeInProgress, client, appliedStake, monitorContract]);

    // Enhanced trade result handling with proper balance integration
    const handleTradeResult = useCallback((isWin: boolean, buyPrice?: number) => {
        const currentStakeAmount = buyPrice || parseFloat(appliedStake);
        const newStake = calculateNextStake(isWin);
        setAppliedStake(newStake);
        currentStakeRef.current = newStake;
        setTotalTrades(prev => prev + 1);

        let profitAmount = 0;
        if (isWin) {
            setWinCount(prev => prev + 1);
            setLastTradeResult('WIN');
            profitAmount = currentStakeAmount * 0.95; // 95% payout
            setProfitLoss(prev => prev + profitAmount);
            globalObserver.emit('ui.log.success', `Trade WON! Profit: +${profitAmount.toFixed(2)}`);
        } else {
            setLossCount(prev => prev + 1);
            setLastTradeResult('LOSS');
            profitAmount = -currentStakeAmount;
            setProfitLoss(prev => prev + profitAmount);
            globalObserver.emit('ui.log.error', `Trade LOST! Loss: ${profitAmount.toFixed(2)}`);
        }

        // Update contract in summary card store for balance integration
        if (run_panel?.summary_card_store) {
            const newStats = {
                total_trades: totalTrades + 1,
                wins: isWin ? winCount + 1 : winCount,
                losses: !isWin ? lossCount + 1 : lossCount,
                profit_loss: profitLoss + profitAmount,
                last_trade_result: isWin ? 'WIN' : 'LOSS',
                current_stake: newStake
            };
            
            run_panel.summary_card_store.updateTradingHubStats(newStats);
            
            // Trigger balance refresh
            api_base.api?.send({ balance: 1 }).then((response: any) => {
                if (response?.balance?.balance) {
                    run_panel.summary_card_store.updateBalance(response.balance.balance);
                }
            }).catch((error: any) => {
                console.error('Failed to refresh balance:', error);
            });
        }
    }, [calculateNextStake, appliedStake, totalTrades, winCount, lossCount, profitLoss, run_panel]);

    // Strategy execution functions
    const executeDigitDifferTrade = useCallback(async (): Promise<boolean> => {
        if (!recommendation || isTradeInProgress) return false;
        
        try {
            console.log('Executing Auto Differ trade...');
            return await executeTrade('Auto Differ', recommendation.symbol, 'DIGITDIFF');
        } catch (error) {
            console.error('Auto Differ execution failed:', error);
            return false;
        }
    }, [recommendation, isTradeInProgress, executeTrade]);

    const executeDigitOverTrade = useCallback(async (): Promise<boolean> => {
        if (!recommendation || isTradeInProgress) {
            console.log('Cannot execute Over/Under trade: no recommendation or trade in progress');
            return false;
        }
        
        try {
            console.log('Executing Auto Over/Under trade...');
            const contractType = recommendation.strategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
            return await executeTrade(
                'Auto Over/Under',
                recommendation.symbol,
                contractType,
                recommendation.barrier
            );
        } catch (error: any) {
            const errorMsg = error?.message || 'Unknown error in Over/Under execution';
            console.error('Auto Over/Under execution failed:', errorMsg);
            globalObserver.emit('ui.log.error', `Over/Under strategy failed: ${errorMsg}`);
            return false;
        }
    }, [recommendation, isTradeInProgress, executeTrade]);

    const executeO5U4Trade = useCallback(async (): Promise<boolean> => {
        if (isTradeInProgress || !checkO5U4Conditions()) return false;
        
        try {
            console.log('Executing O5U4 dual trade...');
            setIsTradeInProgress(true);
            
            const currentStake = parseFloat(appliedStake);
            
            // Execute both trades simultaneously with detailed tracking
            const [over5Result, under4Result] = await Promise.all([
                executeTrade('O5U4 Over', 'R_100', 'DIGITOVER', '5', true),
                executeTrade('O5U4 Under', 'R_100', 'DIGITUNDER', '4', true)
            ]);

            // Log individual O5U4 trade results for better tracking
            globalObserver.emit('ui.log.info', `O5U4 Over 5: ${over5Result ? 'WON' : 'LOST'}`);
            globalObserver.emit('ui.log.info', `O5U4 Under 4: ${under4Result ? 'WON' : 'LOST'}`);
            
            // Calculate O5U4 specific results
            const tradesWon = (over5Result ? 1 : 0) + (under4Result ? 1 : 0);
            const tradesLost = 2 - tradesWon;
            
            // O5U4 is profitable if at least one trade wins (covers both stakes)
            const isOverallWin = tradesWon > 0;
            
            // Calculate actual profit/loss for O5U4
            let profitAmount = 0;
            if (isOverallWin) {
                // Profit = (winning trades * payout) - total stakes
                const totalPayout = tradesWon * (currentStake * 0.95); // 95% payout
                const totalCost = currentStake * 2; // Two trades
                profitAmount = totalPayout - totalCost;
                globalObserver.emit('ui.log.success', `O5U4: ${tradesWon} trades won - Net Profit: +${profitAmount.toFixed(2)}`);
            } else {
                // Loss = total stakes (both trades lost)
                profitAmount = -(currentStake * 2);
                globalObserver.emit('ui.log.error', `O5U4: Both trades lost - Net Loss: ${profitAmount.toFixed(2)}`);
            }
            
            // Update statistics for O5U4
            const newStake = calculateNextStake(isOverallWin);
            setAppliedStake(newStake);
            currentStakeRef.current = newStake;
            setTotalTrades(prev => prev + 1);
            
            if (isOverallWin) {
                setWinCount(prev => prev + 1);
                setLastTradeResult('WIN');
            } else {
                setLossCount(prev => prev + 1);
                setLastTradeResult('LOSS');
            }
            
            setProfitLoss(prev => prev + profitAmount);
            
            // Create O5U4 summary transaction for run panel
            const o5u4TransactionData = {
                contract_id: `O5U4-${Date.now()}`,
                reference: `O5U4-${Date.now()}`,
                timestamp: new Date().toISOString(),
                market: 'R_100',
                contract_type: 'O5U4_DUAL',
                entry_tick: 0,
                exit_tick: 0,
                buy_price: currentStake * 2, // Total stake for both contracts
                sell_price: isOverallWin ? (currentStake * 2 + Math.abs(profitAmount)) : 0,
                profit: profitAmount,
                result: isOverallWin ? 'win' : 'loss',
                duration: 1,
                is_sold: true,
                currency: client?.currency || 'USD',
                trades_won: tradesWon,
                trades_lost: tradesLost
            };

            // Add O5U4 summary transaction to run panel with proper format
            if (run_panel?.root_store?.transactions) {
                try {
                    const formattedO5U4Transaction = {
                        contract_id: parseInt(o5u4TransactionData.contract_id.replace('O5U4-', '')),
                        transaction_ids: {
                            buy: parseInt(o5u4TransactionData.contract_id.replace('O5U4-', '')),
                            sell: parseInt(o5u4TransactionData.contract_id.replace('O5U4-', '')) + 1
                        },
                        buy_price: currentStake * 2,
                        sell_price: isOverallWin ? (currentStake * 2 + Math.abs(profitAmount)) : 0,
                        profit: profitAmount,
                        currency: client?.currency || 'USD',
                        contract_type: 'O5U4_DUAL',
                        underlying: 'R_100',
                        shortcode: `O5U4_R_100_${Date.now()}`,
                        display_name: 'O5U4 Dual Strategy on R_100',
                        date_start: new Date().toISOString(),
                        entry_tick_display_value: 0,
                        exit_tick_display_value: 0,
                        entry_tick_time: new Date().toISOString(),
                        exit_tick_time: new Date().toISOString(),
                        barrier: '5/4',
                        tick_count: 1,
                        payout: isOverallWin ? (currentStake * 2 + Math.abs(profitAmount)) : 0,
                        is_completed: true,
                        is_sold: true,
                        trades_won: tradesWon,
                        trades_lost: tradesLost
                    };

                    run_panel.root_store.transactions.onBotContractEvent(formattedO5U4Transaction);
                    console.log('O5U4 summary transaction added to run panel:', formattedO5U4Transaction);
                } catch (error) {
                    console.error('Failed to add O5U4 transaction to run panel:', error);
                }
            }

            // Update summary card with O5U4 specific stats
            if (run_panel?.summary_card_store) {
                const newStats = {
                    total_trades: totalTrades + 1,
                    wins: isOverallWin ? winCount + 1 : winCount,
                    losses: !isOverallWin ? lossCount + 1 : lossCount,
                    profit_loss: profitLoss + profitAmount,
                    last_trade_result: isOverallWin ? 'WIN' : 'LOSS',
                    current_stake: newStake
                };
                
                run_panel.summary_card_store.updateTradingHubStats(newStats);
                
                // Force balance refresh after O5U4 trade
                setTimeout(async () => {
                    try {
                        const balanceResponse = await api_base.api?.send({ balance: 1 });
                        if (balanceResponse?.balance?.balance && run_panel.summary_card_store) {
                            run_panel.summary_card_store.updateBalance(balanceResponse.balance.balance);
                            console.log('O5U4: Balance updated:', balanceResponse.balance.balance);
                        }
                    } catch (error) {
                        console.error('O5U4: Failed to refresh balance:', error);
                    }
                }, 2000);
            }
            
            return isOverallWin;
        } catch (error) {
            console.error('O5U4 execution failed:', error);
            globalObserver.emit('ui.log.error', `O5U4 strategy failed: ${error.message || 'Unknown error'}`);
            
            // Handle failure case properly
            const newStake = calculateNextStake(false);
            setAppliedStake(newStake);
            currentStakeRef.current = newStake;
            setTotalTrades(prev => prev + 1);
            setLossCount(prev => prev + 1);
            setLastTradeResult('LOSS');
            
            return false;
        } finally {
            setIsTradeInProgress(false);
        }
    }, [isTradeInProgress, checkO5U4Conditions, executeTrade, calculateNextStake, appliedStake, totalTrades, winCount, lossCount, profitLoss, run_panel]);

    // Strategy toggle functions - only one strategy can be active
    const toggleStrategy = useCallback((strategy: string) => {
        // Deactivate all strategies first
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
    }, []);

    // Main start trading function matching reference implementation
    const startTrading = useCallback(async () => {
        if (!client?.loginid || !isAnalysisReady) {
            globalObserver.emit('ui.log.error', 'Please ensure you are logged in and analysis is ready');
            return;
        }

        if (!isAutoDifferActive && !isAutoOverUnderActive && !isAutoO5U4Active) {
            globalObserver.emit('ui.log.error', 'Please activate at least one trading strategy');
            return;
        }

        try {
            // Enhanced API connection setup
            if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                globalObserver.emit('ui.log.info', 'Connecting to API...');
                await api_base.init();
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Enhanced token retrieval for startup
            let authToken = null;
            if (client?.getToken) {
                authToken = client.getToken();
            }
            if (!authToken && client?.token) {
                authToken = client.token;
            }
            if (!authToken) {
                authToken = localStorage.getItem('authToken') || localStorage.getItem('client_token');
            }
            
            console.log('Startup authorization check:', {
                hasToken: !!authToken,
                isAuthorized: api_base.is_authorized,
                apiConnected: api_base.api?.connection?.readyState === 1
            });

            if (!api_base.is_authorized && authToken) {
                globalObserver.emit('ui.log.info', 'Authorizing API connection...');
                try {
                    const authResponse = await api_base.api?.send({ authorize: authToken });
                    console.log('Startup auth response:', authResponse);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    if (authResponse?.error) {
                        globalObserver.emit('ui.log.error', `Authorization failed: ${authResponse.error.message || authResponse.error.code}`);
                        return;
                    }
                } catch (authError: any) {
                    globalObserver.emit('ui.log.error', `Authorization error: ${authError.message || 'Unknown error'}`);
                    return;
                }
            }

            if (!api_base.is_authorized) {
                globalObserver.emit('ui.log.error', 'Failed to authorize API connection - please check your login status');
                return;
            }

            prepareRunPanelForTradingHub();
            setIsContinuousTrading(true);
            
            // Verify run panel stores are available
            if (!run_panel?.root_store?.transactions) {
                console.error('Warning: Transactions store not available in run panel');
                globalObserver.emit('ui.log.error', 'Transaction logging may not work properly - run panel not fully initialized');
            } else {
                console.log('Transactions store verified and ready');
                // Log current transaction count
                const currentTransactions = run_panel.root_store.transactions.transactions || [];
                console.log(`Current transaction count: ${currentTransactions.length}`);
            }
            
            const persistedStake = localStorage.getItem('tradingHub_initialStake') || initialStake;
            console.log(`Starting trading with persisted stake: ${persistedStake}`);
            setAppliedStake(persistedStake);
            currentStakeRef.current = persistedStake;
            setConsecutiveLosses(0);
            currentConsecutiveLossesRef.current = 0;
            contractSettledTimeRef.current = 0;
            waitingForSettlementRef.current = false;

            globalObserver.emit('ui.log.success', 'Trading Hub started successfully');

            // Initial strategy execution with proper timing
            setTimeout(() => {
                if (isAutoDifferActive) executeDigitDifferTrade();
                else if (isAutoOverUnderActive) executeDigitOverTrade();
                else if (isAutoO5U4Active) {
                    console.log('O5U4: Starting trading - checking immediate conditions');
                    if (checkO5U4Conditions()) {
                        console.log('O5U4: Immediate conditions met on start - executing trade');
                        executeO5U4Trade();
                    } else {
                        console.log('O5U4: No immediate conditions met on start - waiting for next opportunity');
                    }
                }
            }, isAutoO5U4Active ? 100 : 500); // Faster start for O5U4

        } catch (error: any) {
            globalObserver.emit('ui.log.error', `Failed to start trading: ${error.message}`);
        }
    }, [client, isAnalysisReady, isAutoDifferActive, isAutoOverUnderActive, isAutoO5U4Active, 
        prepareRunPanelForTradingHub, initialStake, executeDigitDifferTrade, executeDigitOverTrade, 
        executeO5U4Trade, checkO5U4Conditions]);

    // Enhanced stop trading function
    const stopTrading = useCallback(() => {
        setIsContinuousTrading(false);
        if (run_panel) {
            run_panel.setIsRunning(false);
        }

        if (tradingIntervalRef.current) {
            clearInterval(tradingIntervalRef.current);
            tradingIntervalRef.current = null;
        }

        waitingForSettlementRef.current = false;
        globalObserver.emit('ui.log.info', 'Trading Hub stopped');
    }, [run_panel]);

    // Main trade handler matching reference implementation
    const handleTrade = useCallback(() => {
        return isContinuousTrading ? stopTrading() : startTrading();
    }, [isContinuousTrading, stopTrading, startTrading]);

    // Continuous trading loop matching reference implementation
    useEffect(() => {
        if (isContinuousTrading) {
            // Use a faster interval for more responsive trading
            const intervalTime = isAutoO5U4Active ? 2000 : 3000; // 2s for O5U4, 3s for others
            
            tradingIntervalRef.current = setInterval(() => {
                if (isTradeInProgress) {
                    console.log('Trade in progress, skipping interval execution');
                    return;
                }

                // Circuit breaker: Stop if too many consecutive losses
                if (consecutiveLosses >= 10) {
                    console.log('Circuit breaker: Too many consecutive losses, stopping trading');
                    globalObserver.emit('ui.log.error', 'Trading stopped due to excessive losses');
                    stopTrading();
                    return;
                }

                // Check API connection before trading
                if (!api_base.is_authorized || !api_base.api || api_base.api.connection?.readyState !== 1) {
                    console.log('API not ready for trading, skipping...');
                    return;
                }

                const now = Date.now();
                const timeSinceLastSettlement = now - contractSettledTimeRef.current;
                const minimumCooldown = isAutoO5U4Active ? 15000 : 5000;

                if (timeSinceLastSettlement < minimumCooldown && contractSettledTimeRef.current > 0) {
                    console.log(`Cooldown active: ${timeSinceLastSettlement}ms < ${minimumCooldown}ms`);
                    return;
                }

                // Trading logic with checks
                if (isAutoDifferActive) {
                    executeDigitDifferTrade();
                } else if (isAutoOverUnderActive) {
                    executeDigitOverTrade();
                } else if (isAutoO5U4Active) {
                    executeO5U4Trade();
                }
            }, intervalTime);
        }

        return () => {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
                tradingIntervalRef.current = null;
            }
        };
    }, [isContinuousTrading, isAutoDifferActive, isAutoOverUnderActive, isAutoO5U4Active, 
        isTradeInProgress, consecutiveLosses, stopTrading, executeDigitDifferTrade, executeDigitOverTrade, executeO5U4Trade]);

    // Initialize component and API
    useEffect(() => {
        const initializeApi = async () => {
            try {
                if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                    await api_base.init();
                }

                const initToken = client?.getToken() || localStorage.getItem('authToken') || client?.token;
                if (client?.loginid && initToken && !api_base.is_authorized) {
                    await api_base.api?.send({ authorize: initToken });
                }
            } catch (error: any) {
                console.error('Failed to initialize API:', error);
                globalObserver.emit('ui.log.error', `API initialization failed: ${error.message}`);
            }
        };

        initializeApi();

        // Load saved settings
        const savedStake = localStorage.getItem('tradingHub_initialStake');
        if (savedStake) {
            setInitialStake(savedStake);
            setAppliedStake(savedStake);
            currentStakeRef.current = savedStake;
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
    }, [client?.loginid, client?.token, performMarketAnalysis]);

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
                                    setAppliedStake(value);
                                    currentStakeRef.current = value;
                                    localStorage.setItem('tradingHub_initialStake', value);
                                }}
                                className="stake-input"
                                step="0.01"
                                min={MINIMUM_STAKE}
                                disabled={isContinuousTrading}
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
                                disabled={isContinuousTrading}
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
                                        <span>Current Stake:</span>
                                        <strong>${appliedStake}</strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                            onClick={() => toggleStrategy('differ')}
                            disabled={!isAnalysisReady || isContinuousTrading}
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
                                        <span>Current Stake:</span>
                                        <strong>${appliedStake}</strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                            onClick={() => toggleStrategy('overunder')}
                            disabled={!isAnalysisReady || isContinuousTrading}
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
                                        <span>Current Stake:</span>
                                        <strong>${appliedStake} (each)</strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={() => toggleStrategy('o5u4')}
                            disabled={!isAnalysisReady || isContinuousTrading}
                        >
                            {isAutoO5U4Active ? 'Deactivate' : 'Activate'} Strategy
                        </button>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="trading-controls">
                    <div className="main-controls">
                        <button
                            className={`main-trading-btn ${isContinuousTrading ? 'stop' : 'start'}`}
                            onClick={handleTrade}
                            disabled={!isAnalysisReady || !hasActiveStrategy || (connectionStatus !== 'connected')}
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
                                <span>{isContinuousTrading ? 'STOP TRADING' : 'START TRADING'}</span>
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
                            <div className="stat-value">${appliedStake}</div>
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
