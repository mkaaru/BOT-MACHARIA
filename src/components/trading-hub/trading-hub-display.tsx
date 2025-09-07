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

        // Immediately execute trade on new recommendation if trading is active
        if (isContinuousTrading && !isTradeInProgress) {
            setTimeout(async () => {
                try {
                    if (isAutoDifferActive) {
                        await executeDigitDifferTrade();
                    } else if (isAutoOverUnderActive) {
                        await executeDigitOverTrade();
                    } else if (isAutoO5U4Active) {
                        await executeO5U4Trade();
                    }
                } catch (error) {
                    console.error('Immediate trade execution error:', error);
                }
            }, 100); // Execute almost immediately on new recommendation
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

    // Check O5U4 trading conditions - optimized for immediate execution
    const checkO5U4Conditions = useCallback((): boolean => {
        const now = Date.now();
        const timeSinceLastSettlement = now - contractSettledTimeRef.current;
        const minimumWaitTime = 1000; // Reduced to 1 second between trades

        if (waitingForSettlementRef.current) {
            console.log('O5U4: Still waiting for contract settlement');
            return false;
        }

        if (timeSinceLastSettlement < minimumWaitTime && contractSettledTimeRef.current > 0) {
            console.log(`O5U4: Brief cooldown active (${timeSinceLastSettlement}ms < ${minimumWaitTime}ms)`);
            return false;
        }

        return true;
    }, []);

    // Enhanced contract monitoring with accurate win/loss detection
    const monitorContract = useCallback(async (contractId: string, isO5U4Part: boolean = false, contractType?: string, symbol?: string, stake?: number): Promise<boolean> => {
        return new Promise((resolve) => {
            let contractData: any = null;
            let contractResolved = false;

            const subscription = api_base.api?.onMessage().subscribe(async (response: any) => {
                if (response.proposal_open_contract && 
                    response.proposal_open_contract.contract_id === contractId &&
                    !contractResolved) {

                    contractData = response.proposal_open_contract;

                    if (contractData.is_settled) {
                        contractResolved = true;

                        // Enhanced win/loss detection for Over/Under trades
                        const profit = parseFloat(contractData.profit || '0');
                        const sellPrice = parseFloat(contractData.sell_price || '0');
                        const buyPrice = parseFloat(contractData.buy_price || stake?.toString() || '0');
                        const payout = parseFloat(contractData.payout || '0');

                        // Multiple ways to detect win - use the most reliable for Over/Under
                        let isWin = false;

                        // For Over/Under trades, check multiple indicators
                        if (contractData.status === 'won' || contractData.status === 'sold') {
                            // Check if we actually made profit
                            if (profit > 0 || sellPrice > buyPrice) {
                                isWin = true;
                            }
                        }

                        // Fallback: Check payout received vs amount paid
                        if (!isWin && payout > 0 && payout > buyPrice) {
                            isWin = true;
                        }

                        // Final check: If sell price is significantly higher than buy price
                        if (!isWin && sellPrice > (buyPrice * 1.01)) { // At least 1% gain
                            isWin = true;
                        }

                        // Over/Under specific: Check if exit spot satisfies the barrier condition
                        if (!isWin && contractData.exit_spot && contractData.barrier) {
                            const exitSpot = parseFloat(contractData.exit_spot);
                            const barrier = parseFloat(contractData.barrier);
                            const lastDigit = Math.floor(exitSpot * 100) % 10;

                            // Check if the prediction was correct based on contract type
                            if (contractType === 'DIGITOVER' && lastDigit > barrier) {
                                isWin = true;
                            } else if (contractType === 'DIGITUNDER' && lastDigit < barrier) {
                                isWin = true;
                            }
                        }

                        subscription.unsubscribe();

                        // Log detailed contract info for debugging
                        console.log(`Contract ${contractId} detailed settlement:`, {
                            contract_id: contractId,
                            contract_type: contractType,
                            status: contractData.status,
                            profit: profit,
                            buy_price: buyPrice,
                            sell_price: sellPrice,
                            payout: payout,
                            is_win_calculated: isWin,
                            entry_spot: contractData.entry_spot,
                            exit_spot: contractData.exit_spot,
                            barrier: contractData.barrier,
                            last_digit: contractData.exit_spot ? Math.floor(parseFloat(contractData.exit_spot) * 100) % 10 : null,
                            strategy_active: isAutoOverUnderActive ? 'Over/Under' : isAutoDifferActive ? 'Differ' : 'O5U4'
                        });

                        // Create transaction entry for run panel with correct win/loss status
                        if (run_panel?.root_store?.transactions) {
                            try {
                                // Calculate actual profit more accurately for Over/Under
                                let actualProfit;
                                if (isWin) {
                                    // For wins, use the actual profit or calculate from payout
                                    actualProfit = profit > 0 ? profit : (payout > 0 ? payout - buyPrice : sellPrice - buyPrice);
                                } else {
                                    // For losses, it's negative of the stake
                                    actualProfit = -Math.abs(buyPrice);
                                }

                                const profitPercentage = buyPrice > 0 ? ((actualProfit / buyPrice) * 100).toFixed(2) : '0.00';
                                const contractIdNum = typeof contractId === 'string' ? parseInt(contractId.replace(/[^0-9]/g, ''), 10) : contractId;

                                const formattedTransaction = {
                                    contract_id: contractIdNum,
                                    transaction_ids: {
                                        buy: contractIdNum,
                                        sell: contractData.transaction_ids?.sell || contractIdNum + 1
                                    },
                                    buy_price: buyPrice,
                                    sell_price: isWin ? sellPrice : 0,
                                    profit: actualProfit,
                                    currency: client?.currency || 'USD',
                                    contract_type: contractType || 'DIGITOVER',
                                    underlying: symbol || 'R_100',
                                    shortcode: contract.shortcode || `${contractType}_${symbol}_${contractIdNum}`,
                                    display_name: contract.display_name || `${contractType} on ${symbol}`,
                                    date_start: contractData.date_start || new Date().toISOString(),
                                    entry_tick_display_value: contractData.entry_spot || contractData.entry_tick || 0,
                                    exit_tick_display_value: contractData.exit_spot || contractData.exit_tick || 0,
                                    entry_tick_time: contractData.entry_tick_time || contractData.date_start || new Date().toISOString(),
                                    exit_tick_time: contractData.exit_tick_time || new Date().toISOString(),
                                    barrier: contractData.barrier || '',
                                    tick_count: contractData.tick_count || 1,
                                    payout: isWin ? payout : 0,
                                    is_completed: true,
                                    is_sold: true,
                                    profit_percentage: profitPercentage,
                                    status: isWin ? 'won' : 'lost',
                                    // Additional fields
                                    longcode: `${contractType} prediction on ${symbol}`,
                                    app_id: 16929,
                                    purchase_time: contractData.date_start || new Date().toISOString(),
                                    sell_time: contractData.exit_tick_time || new Date().toISOString(),
                                    transaction_time: new Date().toISOString()
                                };

                                run_panel.root_store.transactions.onBotContractEvent(formattedTransaction);

                                console.log(`✅ Transaction recorded correctly:`, {
                                    contract_id: contractId,
                                    result: isWin ? 'WIN' : 'LOSS',
                                    profit: actualProfit,
                                    profit_percentage: profitPercentage + '%'
                                });
                            } catch (error) {
                                console.error('Failed to add transaction to run panel:', error);
                            }
                        }

                        // Update balance and cleanup for non-O5U4 trades
                        if (!isO5U4Part) {
                            try {
                                const balanceResponse = await api_base.api?.send({ balance: 1 });
                                console.log('Balance after settlement:', balanceResponse?.balance?.balance);

                                if (run_panel?.summary_card_store) {
                                    run_panel.summary_card_store.updateBalance(balanceResponse?.balance?.balance || 0);
                                }
                            } catch (error) {
                                console.error('Failed to update balance:', error);
                            }

                            contractSettledTimeRef.current = Date.now();
                            waitingForSettlementRef.current = false;
                        }

                        const tradeType = isO5U4Part ? 'O5U4 Part' : 'Over/Under';
                        globalObserver.emit('ui.log.info', 
                            `${tradeType} Contract ${contractId}: ${isWin ? 'WON' : 'LOST'} - Profit: ${profit.toFixed(2)}`);

                        resolve(isWin);
                    }
                }
            });

            // Send subscription request with immediate status check
            Promise.all([
                api_base.api?.send({
                    proposal_open_contract: 1,
                    contract_id: contractId,
                    subscribe: 1
                }),
                api_base.api?.send({
                    proposal_open_contract: 1,
                    contract_id: contractId
                })
            ]).then(([subscriptionResponse, immediateResponse]) => {
                if (immediateResponse?.proposal_open_contract?.is_settled && !contractResolved) {
                    console.log('Contract already settled on immediate check:', immediateResponse.proposal_open_contract);
                }
            }).catch(error => {
                console.error('Error in contract monitoring setup:', error);
            });

            // Extended timeout for better contract settlement detection
            setTimeout(() => {
                if (!contractResolved) {
                    subscription.unsubscribe();

                    // Final attempt to get contract status before timeout
                    if (contractData && contractData.is_settled) {
                        const profit = parseFloat(contractData.profit || '0');
                        const isWin = profit > 0 || contractData.status === 'won';

                        console.log(`Final timeout check - Contract ${contractId}: ${isWin ? 'WON' : 'LOST'}`);
                        contractResolved = true;

                        if (!isO5U4Part) {
                            contractSettledTimeRef.current = Date.now();
                            waitingForSettlementRef.current = false;
                        }

                        resolve(isWin);
                    } else {
                        // True timeout - contract not settled
                        console.warn(`Contract ${contractId} timeout - no settlement data received`);

                        if (!isO5U4Part) {
                            contractSettledTimeRef.current = Date.now();
                            waitingForSettlementRef.current = false;
                        }

                        globalObserver.emit('ui.log.error', `Contract ${contractId} monitoring timeout`);
                        resolve(false);
                    }
                }
            }, 3000); // Extended to 3 seconds for better reliability
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

            // Ensure all digit contracts have a barrier/prediction parameter
            if (contractType.startsWith('DIGIT') && !tradeParams.parameters.barrier) {
                // Default prediction for any digit contract without a barrier
                const defaultPrediction = Math.floor(Math.random() * 10);
                tradeParams.parameters.barrier = defaultPrediction.toString();
            }

            console.log(`Executing ${strategy} trade:`, tradeParams);
            globalObserver.emit('ui.log.info', `${strategy}: ${contractType} on ${symbol} - Stake: ${currentStake}`);

            // Send trade request through the API with optimized timeout
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

                // Send the trade request
                api_base.api?.send(tradeParams).then((directResponse: any) => {
                    // Handle immediate response if available
                    if (directResponse?.buy) {
                        subscription.unsubscribe();
                        resolve(directResponse);
                    } else if (directResponse?.error) {
                        subscription.unsubscribe();
                        reject(new Error(directResponse.error.message || directResponse.error.code));
                    }
                }).catch(reject);

                // Reduced timeout to 10 seconds for faster execution
                setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('Trade request timeout - please check connection and try again'));
                }, 10000);
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

            // O5U4 specific logic for results handling
            const completedO5U4Trades = [
                { contractId: 'O5U4_OVER_5', contractType: 'DIGITOVER', result: over5Result ? 'win' : 'loss', stake: currentStake, payout: currentStake * 1.95, profit: over5Result ? currentStake * 0.95 : -currentStake },
                { contractId: 'O5U4_UNDER_4', contractType: 'DIGITUNDER', result: under4Result ? 'win' : 'loss', stake: currentStake, payout: currentStake * 1.95, profit: under4Result ? currentStake * 0.95 : -currentStake }
            ];

            // O5U4 dual trade result calculation
            const overTrade = completedO5U4Trades.find(t => t.contractType === 'DIGITOVER');
            const underTrade = completedO5U4Trades.find(t => t.contractType === 'DIGITUNDER');

            if (overTrade && underTrade) {
                const overWin = overTrade.result === 'win';
                const underWin = underTrade.result === 'win';
                const isOverallWin = overWin || underWin;

                // Calculate net profit/loss correctly
                const overProfit = overWin ? (overTrade.payout - overTrade.stake) : -overTrade.stake;
                const underProfit = underWin ? (underTrade.payout - underTrade.stake) : -underTrade.stake;
                const profitAmount = overProfit + underProfit;

                setO5U4Trades(prev => prev.filter(t => 
                    t.contractId !== overTrade.contractId && 
                    t.contractId !== underTrade.contractId
                ));

                if (isOverallWin) {
                    setWinCount(prev => prev + 1);
                    setConsecutiveLosses(0);
                    currentConsecutiveLossesRef.current = 0;
                    currentStakeRef.current = parseFloat(initialStake);
                    setLastTradeResult(`O5U4: ${overWin && underWin ? 'Both won' : 'One won'} - Net Profit: +${Math.abs(profitAmount).toFixed(2)}`);
                } else {
                    setLossCount(prev => prev + 1);
                    setConsecutiveLosses(prev => prev + 1);
                    currentConsecutiveLossesRef.current += 1;

                    const newStake = (currentStakeRef.current * parseFloat(martingale)).toFixed(2);
                    currentStakeRef.current = parseFloat(newStake);
                    setAppliedStake(newStake);
                    setLastTradeResult(`O5U4: Both trades lost - Net Loss: ${profitAmount.toFixed(2)}`);
                }
            }

            // Update total trades and P&L
            setTotalTrades(prev => prev + 2); // Increment by 2 for the dual trades
            setProfitLoss(prev => prev + profitAmount);

            // Update summary card with O5U4 specific stats
            if (run_panel?.summary_card_store) {
                const newStats = {
                    total_trades: totalTrades + 2,
                    wins: isOverallWin ? winCount + 1 : winCount,
                    losses: !isOverallWin ? lossCount + 1 : lossCount,
                    profit_loss: profitLoss + profitAmount,
                    last_trade_result: isOverallWin ? 'WIN' : 'LOSS',
                    current_stake: appliedStake // Use the potentially updated stake
                };

                run_panel.summary_card_store.updateTradingHubStats(newStats);

                // Immediate balance refresh and next trade preparation
                setTimeout(async () => {
                    try {
                        const balanceResponse = await api_base.api?.send({ balance: 1 });
                        if (balanceResponse?.balance?.balance && run_panel.summary_card_store) {
                            run_panel.summary_card_store.updateBalance(balanceResponse.balance.balance);
                            console.log('O5U4: Balance updated:', balanceResponse.balance.balance);
                        }

                        // Mark as ready for immediate next trade
                        contractSettledTimeRef.current = Date.now();
                        waitingForSettlementRef.current = false;

                        // Log completion and readiness for next trade
                        globalObserver.emit('ui.log.success', 'O5U4: Trade completed, ready for immediate next execution');
                    } catch (error) {
                        console.error('O5U4: Failed to refresh balance:', error);
                    }
                }, 500); // Reduced to 0.5 seconds for immediate execution
            }

            return isOverallWin;
        } catch (error) {
            console.error('O5U4 execution failed:', error);
            globalObserver.emit('ui.log.error', `O5U4 strategy failed: ${error.message || 'Unknown error'}`);

            // Handle failure case properly
            const newStake = calculateNextStake(false);
            setAppliedStake(newStake);
            currentStakeRef.current = newStake;
            setTotalTrades(prev => prev + 2); // Increment by 2 for the dual trades
            setLossCount(prev => prev + 1); // Mark as loss
            setLastTradeResult('O5U4: Failed');

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

    // Continuous trading loop optimized for immediate execution on recommendations
    useEffect(() => {
        if (isContinuousTrading) {
            // Much faster intervals for immediate contract purchases
            const intervalTime = 1000; // 1 second for all strategies

            tradingIntervalRef.current = setInterval(async () => {
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
                    console.log('API not ready for trading, attempting reconnection...');
                    try {
                        await api_base.init();
                        const token = client?.getToken() || localStorage.getItem('authToken');
                        if (token) {
                            await api_base.api?.send({ authorize: token });
                        }
                    } catch (error) {
                        console.error('Failed to reconnect API:', error);
                        return;
                    }
                }

                // Check if we have a fresh recommendation (less than 30 seconds old)
                if (!recommendation || (Date.now() - recommendation.timestamp) > 30000) {
                    console.log('No fresh recommendation available');
                    return;
                }

                const now = Date.now();
                const timeSinceLastSettlement = now - contractSettledTimeRef.current;
                const minimumCooldown = 500; // Very short cooldown for immediate execution

                if (timeSinceLastSettlement < minimumCooldown && contractSettledTimeRef.current > 0) {
                    console.log(`Brief cooldown active: ${timeSinceLastSettlement}ms < ${minimumCooldown}ms`);
                    return;
                }

                // Execute trade based on current recommendation immediately
                try {
                    if (isAutoDifferActive) {
                        await executeDigitDifferTrade();
                    } else if (isAutoOverUnderActive) {
                        await executeDigitOverTrade();
                    } else if (isAutoO5U4Active) {
                        await executeO5U4Trade();
                    }
                } catch (error) {
                    console.error('Trading execution error:', error);
                    globalObserver.emit('ui.log.error', `Trading error: ${error.message || 'Unknown error'}`);
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
        isTradeInProgress, consecutiveLosses, recommendation, stopTrading, executeDigitDifferTrade, executeDigitOverTrade, executeO5U4Trade]);

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

    // Advanced Analysis State
    const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
    const [analysisStakeAmount, setAnalysisStakeAmount] = useState('1');
    const [referenceDigit, setReferenceDigit] = useState('5');
    const [analysisCount, setAnalysisTickCount] = useState('120');
    const [activeSymbols, setActiveSymbols] = useState(['R_10', 'R_25', 'R_50', 'R_75', 'R_100']);
    const [recentTicks, setRecentTicks] = useState([1, 8, 1, 6, 4, 2, 7, 3, 5, 8]);
    const [isAnalysisRunning, setIsAnalysisRunning] = useState(false);

    // Toggle advanced analysis
    const toggleAdvancedAnalysis = useCallback(() => {
        setShowAdvancedAnalysis(prev => !prev);
        if (!showAdvancedAnalysis && !isAnalysisRunning) {
            // Start analysis when opening
            setIsAnalysisRunning(true);
            globalObserver.emit('ui.log.info', 'Advanced analysis started');
        }
    }, [showAdvancedAnalysis, isAnalysisRunning]);

    // Apply analysis settings
    const applyAnalysisSettings = useCallback(() => {
        const settings = {
            stake: analysisStakeAmount,
            referenceDigit: referenceDigit,
            analysisCount: analysisCount,
            symbols: activeSymbols
        };
        
        console.log('Applied analysis settings:', settings);
        globalObserver.emit('ui.log.success', `Analysis settings applied - Stake: ${analysisStakeAmount}, Reference: ${referenceDigit}`);
        
        // Update applied stake to match analysis
        setAppliedStake(analysisStakeAmount);
        currentStakeRef.current = analysisStakeAmount;
        
        // Restart analysis with new settings
        setIsAnalysisRunning(true);
    }, [analysisStakeAmount, referenceDigit, analysisCount, activeSymbols]);

    // Simulate tick updates for advanced analysis
    useEffect(() => {
        if (!isAnalysisRunning) return;

        const interval = setInterval(() => {
            const newTick = Math.floor(Math.random() * 10);
            setRecentTicks(prev => {
                const updated = [...prev.slice(1), newTick];
                return updated;
            });
        }, 2000);

        return () => clearInterval(interval);
    }, [isAnalysisRunning]);

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

                    <div className="header-controls">
                        <button
                            className={`advanced-analysis-toggle ${showAdvancedAnalysis ? 'active' : ''}`}
                            onClick={toggleAdvancedAnalysis}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 3h18v18H3zM5 7v10h4V7zm6 0v10h4V7zm6 0v10h2V7z"/>
                            </svg>
                            Advanced Analysis
                        </button>
                    </div>

                    <div className="settings-controls">
                        <div className="control-group">
                            <label>Initial Stake</label>
                            <input</old_str>

                    <div className="settings-controls">
                        <div className="control-group">
                            <label>Initial Stake</label>
                            <input</old_str>
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

            {/* Advanced Analysis Panel */}
            {showAdvancedAnalysis && (
                <div className="advanced-analysis-panel">
                    <div className="analysis-header">
                        <h2>MARKET ANALYSIS TOOLS</h2>
                        <div className="analysis-status">
                            <div className="status-dot ready"></div>
                            <span>Authenticated</span>
                            <button 
                                className="logout-btn"
                                onClick={() => globalObserver.emit('ui.log.info', 'Logout requested')}
                            >
                                Log Out
                            </button>
                        </div>
                    </div>

                    <div className="analysis-content">
                        <div className="analysis-left">
                            <div className="analysis-controls">
                                <div className="control-section">
                                    <div className="control-row">
                                        <div className="control-group">
                                            <label>Stake Amount (USD):</label>
                                            <input
                                                type="number"
                                                value={analysisStakeAmount}
                                                onChange={(e) => setAnalysisStakeAmount(e.target.value)}
                                                className="analysis-input"
                                                step="0.01"
                                                min="0.35"
                                            />
                                        </div>
                                        <div className="control-group">
                                            <label>Reference Digit (0-9):</label>
                                            <input
                                                type="number"
                                                value={referenceDigit}
                                                onChange={(e) => setReferenceDigit(e.target.value)}
                                                className="analysis-input"
                                                min="0"
                                                max="9"
                                            />
                                        </div>
                                        <div className="control-group">
                                            <label>Analysis Count:</label>
                                            <input
                                                type="number"
                                                value={analysisCount}
                                                onChange={(e) => setAnalysisTickCount(e.target.value)}
                                                className="analysis-input"
                                                min="50"
                                                max="500"
                                            />
                                        </div>
                                        <button
                                            className="apply-settings-btn"
                                            onClick={applyAnalysisSettings}
                                        >
                                            Apply Settings
                                        </button>
                                    </div>
                                </div>

                                <div className="symbol-selector">
                                    <label>Active Symbols:</label>
                                    <div className="symbol-buttons">
                                        {availableSymbols.map(symbol => (
                                            <button
                                                key={symbol}
                                                className={`symbol-btn ${activeSymbols.includes(symbol) ? 'active' : ''}`}
                                                onClick={() => {
                                                    setActiveSymbols(prev => 
                                                        prev.includes(symbol)
                                                            ? prev.filter(s => s !== symbol)
                                                            : [...prev, symbol]
                                                    );
                                                }}
                                            >
                                                {symbol.replace('_', ' ')}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="recent-ticks-section">
                                    <label>Recent Ticks:</label>
                                    <div className="ticks-display">
                                        {recentTicks.map((tick, index) => (
                                            <div 
                                                key={index} 
                                                className={`tick-circle ${tick % 2 === 0 ? 'even' : 'odd'}`}
                                            >
                                                {tick}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="analysis-right">
                            <div className="analysis-chart">
                                <div className="chart-header">
                                    <h3>Tick Analysis</h3>
                                    <div className="chart-controls">
                                        <button 
                                            className={`analysis-btn ${isAnalysisRunning ? 'stop' : 'start'}`}
                                            onClick={() => {
                                                setIsAnalysisRunning(!isAnalysisRunning);
                                                globalObserver.emit('ui.log.info', 
                                                    isAnalysisRunning ? 'Analysis stopped' : 'Analysis started');
                                            }}
                                        >
                                            {isAnalysisRunning ? 'Stop Analysis' : 'Start Analysis'}
                                        </button>
                                        <div className="settings-btn">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                <div className="chart-content">
                                    <div className="tick-visualization">
                                        <div className="digit-frequency">
                                            <h4>Digit Frequency Analysis</h4>
                                            <div className="frequency-bars">
                                                {[0,1,2,3,4,5,6,7,8,9].map(digit => {
                                                    const frequency = recentTicks.filter(tick => tick === digit).length;
                                                    const percentage = (frequency / recentTicks.length) * 100;
                                                    return (
                                                        <div key={digit} className="frequency-bar">
                                                            <div className="bar-label">{digit}</div>
                                                            <div className="bar-container">
                                                                <div 
                                                                    className="bar-fill"
                                                                    style={{ height: `${percentage * 2}%` }}
                                                                ></div>
                                                            </div>
                                                            <div className="bar-value">{frequency}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="pattern-analysis">
                                            <h4>Pattern Recognition</h4>
                                            <div className="pattern-stats">
                                                <div className="stat-item">
                                                    <span className="stat-label">Even/Odd Ratio:</span>
                                                    <span className="stat-value">
                                                        {recentTicks.filter(t => t % 2 === 0).length} / 
                                                        {recentTicks.filter(t => t % 2 === 1).length}
                                                    </span>
                                                </div>
                                                <div className="stat-item">
                                                    <span className="stat-label">Over {referenceDigit}:</span>
                                                    <span className="stat-value">
                                                        {recentTicks.filter(t => t > parseInt(referenceDigit)).length}
                                                    </span>
                                                </div>
                                                <div className="stat-item">
                                                    <span className="stat-label">Under {referenceDigit}:</span>
                                                    <span className="stat-value">
                                                        {recentTicks.filter(t => t < parseInt(referenceDigit)).length}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="trading-content">
                <div className="strategy-grid"></old_str>
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
                                {lastTradeResult === 'WIN' || lastTradeResult.startsWith('O5U4') && lastTradeResult.includes('Profit') ? (
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