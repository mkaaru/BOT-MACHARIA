import React, { useState, useRef, useEffect, useCallback } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import AdvancedDisplayModal from './advanced-display-modal';
import DisplayToggle from './display-toggle';
import ProfitLossDisplay from './profit-loss-display';
import marketAnalyzer, { type O5U4Conditions, type MarketStats } from '../../services/market-analyzer';
import { Text } from '@deriv/ui';

interface TradeRecommendation {
    symbol: string;
    timestamp: number;
    evenOdd: {
        recommendation: 'Even' | 'Odd' | null;
        confidence: number;
        evenPercentage: number;
        oddPercentage: number;
        streak?: {
            type: 'even' | 'odd';
            length: number;
        };
    };
    overUnder: {
        recommendation: 'Over' | 'Under' | null;
        confidence: number;
        overPercentage: number;
        underPercentage: number;
        barrier?: number;
        streak?: {
            type: 'over' | 'under';
            length: number;
        };
        analysis?: {
            dynamicBarrier: number;
            accuracy: number;
            pattern: string;
        };
    };
    matchesDiffers: {
        recommendation: 'Matches' | 'Differs' | null;
        confidence: number;
        targetDigit?: number;
        currentDigit?: number;
    };
    totalTicks: number;
    isReady: boolean;
}

interface O5U4Trade {
    contractId: string;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    result: 'pending' | 'win' | 'loss';
    stake: number;
    payout: number;
    profit: number;
    symbol: string;
}

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';

    // Error handling state
    const [hasError, setHasError] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [retryCount, setRetryCount] = useState(0);

    // Strategy states - only one can be active at a time
    const [isAutoDifferActive, setIsAutoDifferActive] = useState(false);
    const [isAutoOverUnderActive, setIsAutoOverUnderActive] = useState(false);
    const [isAutoO5U4Active, setIsAutoO5U4Active] = useState(false);

    // Trading configuration
    const [initialStake, setInitialStake] = useState(MINIMUM_STAKE);
    const [martingale, setMartingale] = useState('2.00');
    const [appliedStake, setAppliedStake] = useState(MINIMUM_STAKE);
    const [stopLoss, setStopLoss] = useState('10.00');

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
    const [lastTradeResult, setLastTradeResult] = useState<string>('');
    const [profitLoss, setProfitLoss] = useState(0);
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);

    // Analysis data
    const [analysisCount, setAnalysisCount] = useState(0);
    const [lastAnalysisTime, setLastAnalysisTime] = useState<string>('');

    // Enhanced market analysis state
    const [marketStats, setMarketStats] = useState<Record<string, MarketStats>>({});
    const [o5u4Opportunities, setO5U4Opportunities] = useState<O5U4Conditions[]>([]);
    const [readySymbolsCount, setReadySymbolsCount] = useState(0);
    const [bestO5U4Opportunity, setBestO5U4Opportunity] = useState<O5U4Conditions | null>(null);

    // O5U4 specific state
    const [o5u4Trades, setO5U4Trades] = useState<O5U4Trade[]>([]);

    // UI state
    const [showAdvancedModal, setShowAdvancedModal] = useState(false);
    const [isAdvancedView, setIsAdvancedView] = useState(false);

    // Refs for continuous trading
    const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const currentStakeRef = useRef(MINIMUM_STAKE);
    const contractSettledTimeRef = useRef(0);
    const waitingForSettlementRef = useRef(false);

    // State for transaction history and API connection
    const [transactionHistory, setTransactionHistory] = useState<{
        id: string;
        type: string;
        symbol: string;
        amount: number;
        result: 'pending' | 'win' | 'loss' | 'failed' | 'executed';
        timestamp: Date;
        profit: number;
        details?: string;
    }[]>([]);
    const [apiConnected, setApiConnected] = useState(false);

    // Balance calculation state
    const [initialBalance, setInitialBalance] = useState(0);
    const [currentBalance, setCurrentBalance] = useState(0);

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

    // Function to get recommendations based on advanced analysis
    const getAdvancedDigitRecommendation = useCallback((overUnderAnalysis: any, evenCount: number, oddCount: number) => {
        const recommendations = [];
        const { bestBarrier, bestAccuracy, currentStreaks, overCount, underCount, pattern } = overUnderAnalysis;

        // Advanced Over/Under recommendations
        let confidence = 'Low';
        if (bestAccuracy > 70) confidence = 'High';
        else if (bestAccuracy > 60) confidence = 'Medium';

        // Streak-based contrarian logic
        if (currentStreaks.over >= 4) {
            recommendations.push({ 
                type: 'Under', 
                confidence: currentStreaks.over >= 6 ? 'High' : 'Medium',
                reason: `${currentStreaks.over} consecutive Over digits (Barrier: ${bestBarrier}) - Strong reversal signal`,
                barrier: bestBarrier,
                accuracy: bestAccuracy,
                pattern: pattern
            });
        } else if (currentStreaks.under >= 4) {
            recommendations.push({ 
                type: 'Over', 
                confidence: currentStreaks.under >= 6 ? 'High' : 'Medium',
                reason: `${currentStreaks.under} consecutive Under digits (Barrier: ${bestBarrier}) - Strong reversal signal`,
                barrier: bestBarrier,
                accuracy: bestAccuracy,
                pattern: pattern
            });
        } else {
            // Pattern-based prediction when no strong streak
            if (overCount > underCount + 3) {
                recommendations.push({ 
                    type: 'Under', 
                    confidence: confidence,
                    reason: `Over bias detected (${overCount}/${underCount}) with ${bestAccuracy.toFixed(1)}% accuracy`,
                    barrier: bestBarrier,
                    accuracy: bestAccuracy,
                    pattern: pattern
                });
            } else if (underCount > overCount + 3) {
                recommendations.push({ 
                    type: 'Over', 
                    confidence: confidence,
                    reason: `Under bias detected (${underCount}/${overCount}) with ${bestAccuracy.toFixed(1)}% accuracy`,
                    barrier: bestBarrier,
                    accuracy: bestAccuracy,
                    pattern: pattern
                });
            }
        }

        // Even/Odd analysis
        if (evenCount > oddCount + 3) {
            recommendations.push({ 
                type: 'Odd', 
                confidence: 'Medium', 
                reason: `Even digits dominant (${evenCount}/${oddCount}) - expect reversal`,
                pattern: 'even_odd'
            });
        } else if (oddCount > evenCount + 3) {
            recommendations.push({ 
                type: 'Even', 
                confidence: 'Medium', 
                reason: `Odd digits dominant (${oddCount}/${evenCount}) - expect reversal`,
                pattern: 'even_odd'
            });
        }

        return recommendations;
    }, []);

    // Enhanced digit analysis with advanced over/under analysis
    const analyzeDigitPatterns = useCallback((symbol: string) => {
        if (!tick_data[symbol] || tick_data[symbol].length < 20) return null;

        const ticks = tick_data[symbol];
        const lastTick = ticks[ticks.length - 1];
        const lastDigit = Math.floor(lastTick.quote % 10);

        // Get more historical data for better analysis
        const recentDigits = ticks.slice(-50).map(tick => Math.floor(tick.quote % 10));
        const last20Digits = recentDigits.slice(-20);

        // Advanced Over/Under Analysis with Dynamic Barrier Optimization
        const analyzeOverUnder = () => {
            const barriers = [2, 3, 4, 5, 6, 7];
            let bestBarrier = 5;
            let bestAccuracy = 0;
            const barrierAnalysis = {};

            barriers.forEach(barrier => {
                const predictions = [];
                const actual = [];

                // Analyze last 30 digits for pattern-based prediction
                for (let i = 10; i < last20Digits.length - 1; i++) {
                    const historyWindow = last20Digits.slice(i - 10, i);
                    const overCount = historyWindow.filter(d => d > barrier).length;
                    const underCount = historyWindow.filter(d => d < barrier).length;

                    // Predict based on pattern
                    const prediction = overCount > underCount ? 'over' : 'under';
                    const actualNext = last20Digits[i + 1] > barrier ? 'over' : 'under';

                    predictions.push(prediction);
                    actual.push(actualNext);
                }

                // Calculate accuracy
                const correct = predictions.filter((pred, idx) => pred === actual[idx]).length;
                const accuracy = predictions.length > 0 ? (correct / predictions.length) * 100 : 0;

                barrierAnalysis[barrier] = {
                    accuracy: accuracy,
                    overCount: last20Digits.filter(d => d > barrier).length,
                    underCount: last20Digits.filter(d => d < barrier).length,
                    equalCount: last20Digits.filter(d => d === barrier).length
                };

                if (accuracy > bestAccuracy) {
                    bestAccuracy = accuracy;
                    bestBarrier = barrier;
                }
            });

            // Advanced streak detection
            const currentStreaks = { over: 0, under: 0 };
            const recentPattern = [];

            for (let i = last20Digits.length - 1; i >= 0; i--) {
                const digit = last20Digits[i];
                const isOver = digit > bestBarrier;
                const isUnder = digit < bestBarrier;

                if (isOver) {
                    recentPattern.unshift('O');
                    if (currentStreaks.under === 0) {
                        currentStreaks.over++;
                    } else {
                        break;
                    }
                } else if (isUnder) {
                    recentPattern.unshift('U');
                    if (currentStreaks.over === 0) {
                        currentStreaks.under++;
                    } else {
                        break;
                    }
                } else {
                    recentPattern.unshift('E');
                    break;
                }
            }

            return {
                bestBarrier,
                bestAccuracy,
                barrierAnalysis,
                currentStreaks,
                pattern: recentPattern.slice(-10).join(''),
                ...barrierAnalysis[bestBarrier]
            };
        };

        const overUnderAnalysis = analyzeOverUnder();

        // Analyze patterns
        const digitCounts = last20Digits.reduce((acc, digit) => {
            acc[digit] = (acc[digit] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);

        // Even/Odd analysis
        const evenCount = last20Digits.filter(d => d % 2 === 0).length;
        const oddCount = last20Digits.filter(d => d % 2 === 1).length;

        return {
            lastDigit,
            recentDigits: last20Digits,
            digitCounts,
            overUnderAnalysis,
            evenCount,
            oddCount,
            recommendation: getAdvancedDigitRecommendation(overUnderAnalysis, evenCount, oddCount)
        };
    }, [tick_data, getAdvancedDigitRecommendation]);

    // Enhanced market analyzer with advanced over/under analysis from volatility analyzer
    const handleMarketAnalysis = useCallback((analysisData: any) => {
        if (!analysisData) return;

        const {
            symbol,
            evenPercentage,
            oddPercentage,
            overPercentage,
            underPercentage,
            mostFrequentDigit,
            currentLastDigit,
            streakInfo,
            totalTicks,
            digitFrequencies,
            tickHistory,
            barrier = 5
        } = analysisData;

        // Advanced over/under analysis with barrier calculation
        let advancedOverPercentage = overPercentage;
        let advancedUnderPercentage = underPercentage;
        let dynamicBarrier = barrier;

        if (tickHistory && Array.isArray(tickHistory) && tickHistory.length > 0) {
            // Calculate digit frequencies for advanced analysis
            const digitCounts = Array(10).fill(0);
            tickHistory.forEach(tick => {
                if (tick.last_digit !== undefined) {
                    digitCounts[tick.last_digit]++;
                }
            });

            // Dynamic barrier optimization - find the barrier that gives best prediction accuracy
            let bestBarrier = 5;
            let bestAccuracy = 0;

            for (let testBarrier = 2; testBarrier <= 7; testBarrier++) {
                let overCount = 0;
                let underCount = 0;

                for (let i = 0; i < 10; i++) {
                    if (i >= testBarrier) {
                        overCount += digitCounts[i];
                    } else {
                        underCount += digitCounts[i];
                    }
                }

                const overPerc = (overCount / totalTicks) * 100;
                const underPerc = (underCount / totalTicks) * 100;
                const accuracy = Math.abs(overPerc - 50) + Math.abs(underPerc - 50);

                if (accuracy > bestAccuracy) {
                    bestAccuracy = accuracy;
                    bestBarrier = testBarrier;
                    advancedOverPercentage = overPerc;
                    advancedUnderPercentage = underPerc;
                }
            }

            dynamicBarrier = bestBarrier;

            // Pattern-based enhancement for over/under
            if (tickHistory.length >= 10) {
                const recentDigits = tickHistory.slice(-10).map(tick => tick.last_digit || 0);
                const recentOverCount = recentDigits.filter(digit => digit >= dynamicBarrier).length;
                const recentUnderCount = 10 - recentOverCount;

                // Adjust confidence based on recent patterns
                const recentOverPerc = (recentOverCount / 10) * 100;
                const recentUnderPerc = (recentUnderCount / 10) * 100;

                // Weighted average of historical and recent data
                advancedOverPercentage = (advancedOverPercentage * 0.7) + (recentOverPerc * 0.3);
                advancedUnderPercentage = (advancedUnderPercentage * 0.7) + (recentUnderPerc * 0.3);
            }
        }

        // Enhanced streak analysis for over/under
        let overUnderStreak = { type: 'over' as 'over' | 'under', length: 0 };
        if (tickHistory && tickHistory.length > 1) {
            const lastDigit = tickHistory[tickHistory.length - 1]?.last_digit || 0;
            const currentType: 'over' | 'under' = lastDigit >= dynamicBarrier ? 'over' : 'under';

            let streakLength = 1;
            for (let i = tickHistory.length - 2; i >= 0; i--) {
                const digit = tickHistory[i]?.last_digit || 0;
                const digitType: 'over' | 'under' = digit >= dynamicBarrier ? 'over' : 'under';

                if (digitType === currentType) {
                    streakLength++;
                } else {
                    break;
                }
            }
            overUnderStreak = { type: currentType, length: streakLength };
        }

        // Update recommendation with advanced over/under analysis
        const newRecommendation: TradeRecommendation = {
            symbol,
            timestamp: Date.now(),
            evenOdd: {
                recommendation: evenPercentage > 55 ? 'Even' : oddPercentage > 55 ? 'Odd' : null,
                confidence: Math.max(evenPercentage, oddPercentage),
                evenPercentage,
                oddPercentage,
                streak: streakInfo
            },
            overUnder: {
                recommendation: advancedOverPercentage > 55 ? 'Over' : advancedUnderPercentage > 55 ? 'Under' : null,
                confidence: Math.max(advancedOverPercentage, advancedUnderPercentage),
                overPercentage: advancedOverPercentage,
                underPercentage: advancedUnderPercentage,
                barrier: dynamicBarrier,
                streak: overUnderStreak,
                analysis: {
                    dynamicBarrier,
                    accuracy: Math.abs(advancedOverPercentage - 50) + Math.abs(advancedUnderPercentage - 50),
                    pattern: tickHistory?.slice(-5).map(tick => 
                        (tick.last_digit || 0) >= dynamicBarrier ? 'O' : 'U'
                    ).join('') || ''
                }
            },
            matchesDiffers: {
                recommendation: mostFrequentDigit !== undefined && digitFrequencies?.[mostFrequentDigit]?.percentage > 15 ? 'Matches' : 'Differs',
                confidence: mostFrequentDigit !== undefined ? digitFrequencies?.[mostFrequentDigit]?.percentage || 0 : 0,
                targetDigit: mostFrequentDigit,
                currentDigit: currentLastDigit
            },
            totalTicks,
            isReady: totalTicks >= 50
        };

        setRecommendation(newRecommendation);
        setIsAnalysisReady(newRecommendation.isReady);

        if (newRecommendation.isReady && !connectionStatus.includes('connected')) {
            setConnectionStatus('connected');
        }
    }, [connectionStatus]);

    // Enhanced stake management with martingale
    const calculateNextStake = useCallback((isWin: boolean): string => {
        if (isWin) {
            return initialStake;
        } else {
            const multiplier = parseFloat(martingale);
            const newStake = (parseFloat(currentStakeRef.current) * multiplier).toFixed(2);
            const calculatedStake = Math.max(parseFloat(newStake), parseFloat(MINIMUM_STAKE)).toFixed(2);
            console.log(`Martingale calculation: New stake: ${calculatedStake}`);
            return calculatedStake;
        }
    }, [initialStake, martingale]);

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

    // Enhanced contract monitoring with improved settlement detection
    const monitorContract = useCallback((contractId: string, isO5U4Part: boolean = false, contractType?: string, symbol?: string, stake?: number): Promise<boolean> => {
        return new Promise((resolve) => {
            let contractData: any = null;
            let contractResolved = false;
            let timeoutId: NodeJS.Timeout | null = null;
            let subscription: any = null;

            const resolveContract = (isWin: boolean, source: string) => {
                if (contractResolved) return;

                contractResolved = true;

                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }

                if (subscription) {
                    subscription.unsubscribe();
                    subscription = null;
                }

                console.log(`Contract ${contractId} resolved via ${source}: ${isWin ? 'WIN' : 'LOSS'}`);

                if (!isO5U4Part) {
                    contractSettledTimeRef.current = Date.now();
                    waitingForSettlementRef.current = false;
                }

                resolve(isWin);
            };

            const checkContractSettlement = (data: any, source: string): boolean => {
                if (!data) return false;

                // Check if contract is settled through multiple conditions
                const isSettled = data.is_settled || data.is_sold || data.status === 'sold' || data.status === 'won' || data.status === 'lost';

                if (!isSettled) return false;

                contractData = data;

                // Enhanced win/loss detection
                const profit = parseFloat(data.profit || '0');
                const sellPrice = parseFloat(data.sell_price || '0');
                const buyPrice = parseFloat(data.buy_price || stake?.toString() || '0');
                const payout = parseFloat(data.payout || '0');

                let isWin = false;

                // Primary check: status indicates win
                if (data.status === 'won') {
                    isWin = true;
                } else if (data.status === 'lost') {
                    isWin = false;
                } else {
                    // Secondary checks for unclear status
                    if (profit > 0) {
                        isWin = true;
                    } else if (payout > buyPrice) {
                        isWin = true;
                    } else if (sellPrice > buyPrice) {
                        isWin = true;
                    } else {
                        // Final check: verify against contract logic
                        if (data.exit_spot && data.barrier) {
                            const exitSpot = parseFloat(data.exit_spot);
                            const barrier = parseFloat(data.barrier);
                            const lastDigit = Math.floor(exitSpot * 100) % 10;

                            if (contractType === 'DIGITOVER' && lastDigit > barrier) {
                                isWin = true;
                            } else if (contractType === 'DIGITUNDER' && lastDigit < barrier) {
                                isWin = true;
                            }
                        }
                    }
                }

                // Log settlement details
                console.log(`Contract ${contractId} settlement details (${source}):`, {
                    contract_id: contractId,
                    status: data.status,
                    is_settled: data.is_settled,
                    is_sold: data.is_sold,
                    profit: profit,
                    buy_price: buyPrice,
                    sell_price: sellPrice,
                    payout: payout,
                    exit_spot: data.exit_spot,
                    barrier: data.barrier,
                    last_digit: data.exit_spot ? Math.floor(parseFloat(data.exit_spot) * 100) % 10 : null,
                    calculated_win: isWin
                });

                // Create transaction entry for run panel
                if (run_panel?.root_store?.transactions) {
                    try {
                        let actualProfit;
                        if (isWin) {
                            actualProfit = profit > 0 ? profit : (payout > 0 ? payout - buyPrice : sellPrice - buyPrice);
                        } else {
                            actualProfit = -Math.abs(buyPrice);
                        }

                        const profitPercentage = buyPrice > 0 ? ((actualProfit / buyPrice) * 100).toFixed(2) : '0.00';
                        const contractIdNum = typeof contractId === 'string' ? parseInt(contractId.replace(/[^0-9]/g, ''), 10) : contractId;

                        const formattedTransaction = {
                            contract_id: contractIdNum,
                            transaction_ids: {
                                buy: contractIdNum,
                                sell: data.transaction_ids?.sell || contractIdNum + 1
                            },
                            buy_price: buyPrice,
                            sell_price: isWin ? sellPrice : 0,
                            profit: actualProfit,
                            currency: client?.currency || 'USD',
                            contract_type: contractType || 'DIGITOVER',
                            underlying: symbol || 'R_100',
                            shortcode: data.shortcode || `${contractType}_${symbol}_${contractIdNum}`,
                            display_name: data.display_name || `${contractType} on ${symbol}`,
                            date_start: data.date_start || new Date().toISOString(),
                            entry_tick_display_value: data.entry_spot || data.entry_tick || 0,
                            exit_tick_display_value: data.exit_spot || data.exit_tick || 0,
                            entry_tick_time: data.entry_tick_time || data.date_start || new Date().toISOString(),
                            exit_tick_time: data.exit_tick_time || new Date().toISOString(),
                            barrier: data.barrier || '',
                            tick_count: data.tick_count || 1,
                            payout: isWin ? payout : 0,
                            is_completed: true,
                            is_sold: true,
                            profit_percentage: profitPercentage,
                            status: isWin ? 'won' : 'lost',
                            longcode: `${contractType} prediction on ${symbol}`,
                            app_id: 16929,
                            purchase_time: data.date_start || new Date().toISOString(),
                            sell_time: data.exit_tick_time || new Date().toISOString(),
                            transaction_time: new Date().toISOString()
                        };

                        run_panel.root_store.transactions.onBotContractEvent(formattedTransaction);

                        console.log(`✅ Transaction recorded: ${contractId} - ${isWin ? 'WIN' : 'LOSS'} - Profit: ${actualProfit}`);
                    } catch (error) {
                        console.error('Failed to add transaction to run panel:', error);
                    }
                }

                // Update balance for non-O5U4 trades
                if (!isO5U4Part) {
                    api_base.api?.send({ balance: 1 }).then((balanceResponse: any) => {
                        if (balanceResponse?.balance?.balance && run_panel?.summary_card_store) {
                            run_panel.summary_card_store.updateBalance(balanceResponse.balance.balance);
                        }
                    }).catch(error => {
                        console.error('Failed to update balance:', error);
                    });
                }

                const tradeType = isO5U4Part ? 'O5U4 Part' : contractType;
                globalObserver.emit('ui.log.info', 
                    `${tradeType} Contract ${contractId}: ${isWin ? 'WON' : 'LOST'} - Profit: ${profit.toFixed(2)}`);

                resolveContract(isWin, source);
                return true;
            };

            // Set up subscription for contract updates
            subscription = api_base.api?.onMessage().subscribe(async (response: any) => {
                if (response.proposal_open_contract && 
                    response.proposal_open_contract.contract_id === contractId &&
                    !contractResolved) {

                    checkContractSettlement(response.proposal_open_contract, 'subscription');
                }
            });

            // Send subscription request and get immediate status
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
                // Check if contract is already settled
                if (immediateResponse?.proposal_open_contract && !contractResolved) {
                    checkContractSettlement(immediateResponse.proposal_open_contract, 'immediate');
                }
            }).catch(error => {
                console.error('Error in contract monitoring setup:', error);
                if (!contractResolved) {
                    resolveContract(false, 'setup_error');
                }
            });

            // Set timeout with proper cleanup
            timeoutId = setTimeout(() => {
                if (!contractResolved) {
                    console.warn(`Contract ${contractId} monitoring timeout after 5 seconds`);

                    // Final attempt with last known data
                    if (contractData) {
                        if (checkContractSettlement(contractData, 'timeout_fallback')) {
                            return; // Contract was resolved in final check
                        }
                    }

                    // True timeout - no settlement detected
                    globalObserver.emit('ui.log.error', `Contract ${contractId} monitoring timeout`);
                    resolveContract(false, 'timeout');
                }
            }, 5000); // Increased timeout for better reliability
        });
    }, [run_panel, client]);

    // Execute trade using the enhanced trade engine
    const executeTrade = useCallback((
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

                // Log purchase to journal (using component-level stores)
                if (run_panel?.root_store?.journal) {
                    const logMessage = `📈 Contract Purchased: ${symbol} - Stake: ${buyPrice} ${client?.currency || 'USD'}`;
                    run_panel.root_store.journal.pushMessage(logMessage, 'notify', '', { 
                        current_currency: client?.currency || 'USD' 
                    });
                } else {
                    console.warn('Run panel journal not available for logging');
                }

                // Log purchase to transactions store (using component-level stores)
                if (run_panel?.root_store?.transactions) {
                    const contractData = {
                        contract_id: contractId,
                        transaction_ids: {
                            buy: contractId,
                            sell: null
                        },
                        display_name: symbol,
                        buy_price: buyPrice,
                        payout: 0,
                        profit: 0,
                        bid_price: 0,
                        currency: client?.currency || 'USD',
                        date_start: new Date().toISOString(),
                        entry_tick_display_value: '',
                        entry_tick_time: new Date().toISOString(),
                        exit_tick_display_value: '',
                        exit_tick_time: '',
                        barrier: '',
                        is_completed: false,
                        status: 'open'
                    };
                    run_panel.root_store.transactions.onBotContractEvent(contractData);
                } else {
                    console.warn('Transactions store not available for logging');
                }

                // Update balance for non-O5U4 trades
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

    // Enhanced trade result handling with stop loss check based on run panel statistics
    const handleTradeResult = useCallback((isWin: boolean, buyPrice?: number) => {
        const currentStakeAmount = buyPrice || parseFloat(appliedStake);
        const newStake = calculateNextStake(isWin);
        setAppliedStake(newStake);
        currentStakeRef.current = newStake;
        setTotalTrades(prev => prev + 1);
        setTotalStake(prev => prev + currentStakeAmount);

        let profitAmount = 0;
        if (isWin) {
            setWinCount(prev => prev + 1);
            setLastTradeResult('WIN');
            profitAmount = currentStakeAmount * 0.95; // 95% payout
            setTotalPayout(prev => prev + (currentStakeAmount + profitAmount));
            setProfitLoss(prev => {
                const newProfitLoss = prev + profitAmount;
                return newProfitLoss;
            });
            globalObserver.emit('ui.log.success', `Trade WON! Profit: +${profitAmount.toFixed(2)}`);
        } else {
            setLossCount(prev => prev + 1);
            setLastTradeResult('LOSS');
            profitAmount = -currentStakeAmount;
            setProfitLoss(prev => {
                const newProfitLoss = prev + profitAmount;
                return newProfitLoss;
            });
            globalObserver.emit('ui.log.error', `Trade LOST! Loss: ${profitAmount.toFixed(2)}`);
        }

        // Check stop loss based on run panel's total profit/loss after state updates
        setTimeout(() => {
            const runPanelProfitLoss = run_panel?.root_store?.transactions?.statistics?.total_profit || 0;
            const stopLossAmount = parseFloat(stopLoss);

            // Stop trading if total loss from run panel exceeds user-defined stop loss
            if (runPanelProfitLoss < 0 && Math.abs(runPanelProfitLoss) >= stopLossAmount) {
                globalObserver.emit('ui.log.error', 
                    `Stop loss of ${stopLossAmount} reached. Run panel total loss: ${Math.abs(runPanelProfitLoss).toFixed(2)}. Trading stopped.`);
                setIsContinuousTrading(false);
                if (run_panel) {
                    run_panel.setIsRunning(false);
                }
            }
        }, 100); // Small delay to ensure transaction store is updated

        // Update balance for non-O5U4 trades
        if (!isO5U4Part) {
             api_base.api?.send({ balance: 1 }).then((balanceResponse: any) => {
                if (balanceResponse?.balance?.balance && run_panel?.summary_card_store) {
                    run_panel.summary_card_store.updateBalance(balanceResponse.balance.balance);
                }
            }).catch(error => {
                console.error('Failed to update balance:', error);
            });
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
    }, [calculateNextStake, appliedStake, totalTrades, winCount, lossCount, profitLoss, stopLoss, run_panel]);

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

    // Enhanced Auto Over/Under strategy with advanced volatility analyzer integration
    const executeDigitOverTrade = useCallback(async () => {
        if (!recommendation?.overUnder || isTradeInProgress || !client?.loginid || !api_base.is_authorized) {
            return;
        }

        const { 
            overPercentage, 
            underPercentage, 
            barrier = 5, 
            streak,
            analysis 
        } = recommendation.overUnder;

        // Advanced decision logic using volatility analyzer insights
        let contractType = '';
        let dynamicBarrier = analysis?.dynamicBarrier || barrier;

        // Enhanced confidence thresholds with streak consideration
        const streakBonus = streak && streak.length >= 3 ? 2 : 0; // Bonus confidence for streaks
        const requiredConfidence = 55 - streakBonus;

        if (overPercentage > requiredConfidence + 2) {
            contractType = 'DIGITOVER';
        } else if (underPercentage > requiredConfidence + 2) {
            contractType = 'DIGITUNDER';
        } else if (overPercentage > underPercentage && overPercentage > requiredConfidence) {
            contractType = 'DIGITOVER';
        } else if (underPercentage > overPercentage && underPercentage > requiredConfidence) {
            contractType = 'DIGITUNDER';
        } else {
            console.log('Over/Under conditions not met for trading', {
                overPercentage: overPercentage.toFixed(2),
                underPercentage: underPercentage.toFixed(2),
                requiredConfidence,
                barrier: dynamicBarrier,
                streak: streak ? `${streak.length} ${streak.type}` : 'none'
            });
            return;
        }

        // Streak-based barrier adjustment for better accuracy
        if (streak && streak.length >= 4) {
            if (streak.type === 'over' && contractType === 'DIGITUNDER') {
                dynamicBarrier = Math.max(2, dynamicBarrier - 1); // Lower barrier for contrarian play
            } else if (streak.type === 'under' && contractType === 'DIGITOVER') {
                dynamicBarrier = Math.min(8, dynamicBarrier + 1); // Higher barrier for contrarian play
            }
        }

        setIsTradeInProgress(true);
        const timestamp = new Date().toLocaleTimeString();

        try {
            console.log(`[${timestamp}] 🎯 Executing Advanced Over/Under trade:`, {
                contractType,
                barrier: dynamicBarrier,
                confidence: Math.max(overPercentage, underPercentage).toFixed(2),
                streak: streak ? `${streak.length} ${streak.type}` : 'none',
                pattern: analysis?.pattern || 'N/A',
                accuracy: analysis?.accuracy?.toFixed(2) || 'N/A'
            });

            const tradeParams = {
                contract_type: contractType,
                symbol: 'R_100',
                basis: 'stake',
                amount: parseFloat(appliedStake),
                duration: 1,
                duration_unit: 't',
                barrier: dynamicBarrier.toString()
            };

            // Get proposal first
            const proposalResponse = await api_base.api.send({ proposal: 1, ...tradeParams });

            if (proposalResponse.error) {
                throw new Error(proposalResponse.error.message);
            }

            // Execute the purchase
            const buyResponse = await api_base.api.send({
                buy: proposalResponse.proposal.id,
                price: parseFloat(appliedStake)
            });

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            // Log successful purchase with enhanced details
            globalObserver.emit('ui.log.info', 
                `Advanced Over/Under ${contractType} (Barrier: ${dynamicBarrier}) purchased: ID ${buyResponse.buy.contract_id}, Stake: ${appliedStake}, Confidence: ${Math.max(overPercentage, underPercentage).toFixed(1)}%`);

            console.log(`[${timestamp}] ✅ Advanced Over/Under trade executed successfully:`, {
                contractId: buyResponse.buy.contract_id,
                contractType,
                barrier: dynamicBarrier,
                stake: appliedStake,
                confidence: Math.max(overPercentage, underPercentage).toFixed(2),
                streak: streak ? `${streak.length} ${streak.type}` : 'none',
                pattern: analysis?.pattern || 'N/A'
            });

        } catch (error: any) {
            console.error(`[${timestamp}] ❌ Advanced Over/Under trade failed:`, error);
            globalObserver.emit('ui.log.error', `Advanced Over/Under trade failed: ${error.message}`);
        } finally {
            setIsTradeInProgress(false);
        }
    }, [recommendation, isTradeInProgress, client, appliedStake]);

    const executeO5U4Trade = useCallback(async (): Promise<boolean> => {
        if (isTradeInProgress || !bestO5U4Opportunity) return false;

        try {
            console.log(`Executing Enhanced O5U4 dual trade on ${bestO5U4Opportunity.symbol}...`);
            setIsTradeInProgress(true);

            const currentStake = parseFloat(appliedStake);
            const selectedSymbol = bestO5U4Opportunity.symbol;

            // Log the AI decision
            globalObserver.emit('ui.log.info', 
                `O5U4 AI Selection: ${selectedSymbol} (Score: ${bestO5U4Opportunity.score.toFixed(1)}, Conditions: ${bestO5U4Opportunity.conditionsMetCount}/3)`);

            // Execute both trades simultaneously on the AI-selected symbol
            const [over5Result, under4Result] = await Promise.all([
                executeTrade('O5U4 Over', selectedSymbol, 'DIGITOVER', '5', true),
                executeTrade('O5U4 Under', selectedSymbol, 'DIGITUNDER', '4', true)
            ]);

            // Log individual O5U4 trade results with enhanced detail
            globalObserver.emit('ui.log.info', 
                `O5U4 ${selectedSymbol} Over 5: ${over5Result ? 'WON' : 'LOST'}`);
            globalObserver.emit('ui.log.info', 
                `O5U4 ${selectedSymbol} Under 4: ${under4Result ? 'WON' : 'LOST'}`);

            // Enhanced O5U4 result processing
            const completedO5U4Trades: O5U4Trade[] = [
                { 
                    contractId: `O5U4_OVER_5_${selectedSymbol}`, 
                    contractType: 'DIGITOVER', 
                    result: over5Result ? 'win' : 'loss', 
                    stake: currentStake, 
                    payout: currentStake * 1.95, 
                    profit: over5Result ? currentStake * 0.95 : -currentStake,
                    symbol: selectedSymbol
                },
                { 
                    contractId: `O5U4_UNDER_4_${selectedSymbol}`, 
                    contractType: 'DIGITUNDER', 
                    result: under4Result ? 'win' : 'loss', 
                    stake: currentStake, 
                    payout: currentStake * 1.95, 
                    profit: under4Result ? currentStake * 0.95 : -currentStake,
                    symbol: selectedSymbol
                }
            ];

            // Enhanced O5U4 dual trade result calculation
            const overTrade = completedO5U4Trades.find(t => t.contractType === 'DIGITOVER');
            const underTrade = completedO5U4Trades.find(t => t.contractType === 'DIGITUNDER');

            if (overTrade && underTrade) {
                const overWin = overTrade.result === 'win';
                const underWin = underTrade.result === 'win';
                const isOverallWin = overWin || underWin;

                // Calculate net profit/loss with enhanced tracking
                const overProfit = overWin ? (overTrade.payout - overTrade.stake) : -overTrade.stake;
                const underProfit = underWin ? (underTrade.payout - underTrade.stake) : -underTrade.stake;
                const profitAmount = overProfit + underProfit;

                // Enhanced win/loss logic with AI feedback
                if (isOverallWin) {
                    setWinCount(prev => prev + 1);
                    currentStakeRef.current = parseFloat(initialStake);

                    const winType = overWin && underWin ? 'Both contracts won' : 'One contract won';
                    setLastTradeResult(`O5U4 AI Win: ${winType} on ${selectedSymbol} - Profit: +${Math.abs(profitAmount).toFixed(2)}`);

                    globalObserver.emit('ui.log.success', 
                        `O5U4 Strategy Success: ${winType} on ${selectedSymbol} (AI Score: ${bestO5U4Opportunity.score.toFixed(1)})`);
                } else {
                    setLossCount(prev => prev + 1);

                    const newStake = (currentStakeRef.current * parseFloat(martingale)).toFixed(2);
                    currentStakeRef.current = parseFloat(newStake);
                    setAppliedStake(newStake);
                    setLastTradeResult(`O5U4 Loss: Both contracts lost on ${selectedSymbol} - Loss: ${profitAmount.toFixed(2)}`);

                    globalObserver.emit('ui.log.error', 
                        `O5U4 Both lost on ${selectedSymbol} (Score was: ${bestO5U4Opportunity.score.toFixed(1)})`);
                }

                // Update comprehensive statistics
                setTotalTrades(prev => prev + 2);
                setTotalStake(prev => prev + (currentStake * 2));
                setProfitLoss(prev => prev + profitAmount);

                // Check stop loss based on run panel's total profit/loss
                setTimeout(() => {
                    const runPanelProfitLoss = run_panel?.root_store?.transactions?.statistics?.total_profit || 0;
                    const stopLossAmount = parseFloat(stopLoss);

                    if (runPanelProfitLoss < 0 && Math.abs(runPanelProfitLoss) >= stopLossAmount) {
                        globalObserver.emit('ui.log.error', 
                            `Stop loss of ${stopLossAmount} reached. Run panel total loss: ${Math.abs(runPanelProfitLoss).toFixed(2)}. Trading stopped.`);
                        setIsContinuousTrading(false);
                        if (run_panel) {
                            run_panel.setIsRunning(false);
                        }
                    }
                }, 100); // Small delay to ensure transaction store is updated

                if (isOverallWin) {
                    setTotalPayout(prev => prev + overTrade.payout + underTrade.payout);
                }

                // Enhanced summary card update with AI metrics
                if (run_panel?.summary_card_store) {
                    const newStats = {
                        total_trades: totalTrades + 2,
                        wins: isOverallWin ? winCount + 1 : winCount,
                        losses: !isOverallWin ? lossCount + 1 : lossCount,
                        profit_loss: profitLoss + profitAmount,
                        last_trade_result: isOverallWin ? 'WIN' : 'LOSS',
                        current_stake: appliedStake
                    };

                    run_panel.summary_card_store.updateTradingHubStats(newStats);

                    // Quick balance refresh for immediate next trade
                    setTimeout(async () => {
                        try {
                            const balanceResponse = await api_base.api?.send({ balance: 1 });
                            if (balanceResponse?.balance?.balance && run_panel.summary_card_store) {
                                run_panel.summary_card_store.updateBalance(balanceResponse.balance.balance);
                            }

                            contractSettledTimeRef.current = Date.now();
                            waitingForSettlementRef.current = false;

                            globalObserver.emit('ui.log.success', 
                                'Enhanced O5U4: Ready for next AI-driven execution');
                        } catch (error) {
                            console.error('Enhanced O5U4: Balance refresh failed:', error);
                        }
                    }, 300); // Faster execution cycle
                }

                return isOverallWin;
            }

            return false;
        } catch (error) {
            console.error('Enhanced O5U4 execution failed:', error);
            globalObserver.emit('ui.log.error', `Enhanced O5U4 strategy failed: ${error.message || 'Unknown error'}`);

            // Enhanced failure handling
            const newStake = calculateNextStake(false);
            setAppliedStake(newStake);
            currentStakeRef.current = newStake;
            setTotalTrades(prev => prev + 2);
            setLossCount(prev => prev + 1);
            setLastTradeResult('Enhanced O5U4: Execution Failed');

            return false;
        } finally {
            setIsTradeInProgress(false);
        }
    }, [isTradeInProgress, bestO5U4Opportunity, executeTrade, calculateNextStake, appliedStake, totalTrades, winCount, lossCount, profitLoss, run_panel, initialStake, martingale]);

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

                // Check if we have a fresh recommendation (less than 20 seconds old for faster execution)
                if (!recommendation || (Date.now() - recommendation.timestamp) > 20000) {
                    console.log('No fresh recommendation available for immediate execution');
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
        isTradeInProgress, recommendation, stopTrading, executeDigitDifferTrade, executeDigitOverTrade, executeO5U4Trade, client]);

    // Error recovery function
    const handleError = useCallback((error: any, context: string) => {
        console.error(`Trading Hub Error (${context}):`, error);
        const message = error?.message || error?.toString() || 'Unknown error occurred';
        setErrorMessage(`${context}: ${message}`);
        setHasError(true);

        // Auto-retry mechanism for connection errors
        if (retryCount < 3 && (message.includes('connection') || message.includes('network') || message.includes('fetch'))) {
            setTimeout(() => {
                setRetryCount(prev => prev + 1);
                setHasError(false);
                setErrorMessage('');
            }, 2000 * (retryCount + 1));
        }
    }, [retryCount]);

    // Initialize component and enhanced market analyzer
    useEffect(() => {
        const initializeApi = async () => {
            try {
                setHasError(false);
                setErrorMessage('');

                if (!api_base.api || api_base.api.connection?.readyState !== 1) {
                    await api_base.init();
                }

                const initToken = client?.getToken() || localStorage.getItem('authToken') || client?.token;
                if (client?.loginid && initToken && !api_base.is_authorized) {
                    await api_base.api?.send({ authorize: initToken });
                }
            } catch (error: any) {
                handleError(error, 'API Initialization');
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

        const savedStopLoss = localStorage.getItem('tradingHub_stopLoss');
        if (savedStopLoss) {
            setStopLoss(savedStopLoss);
        }

        // Initialize enhanced market analyzer with error handling
        let unsubscribe: (() => void) | undefined;
        try {
            unsubscribe = marketAnalyzer.onAnalysis(handleMarketAnalysis);
            marketAnalyzer.start();
            console.log('Enhanced Trading Hub initialized with multi-symbol market analyzer');
        } catch (error) {
            handleError(error, 'Market Analyzer Initialization');
        }

        return () => {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
            }
            if (analysisIntervalRef.current) {
                clearInterval(analysisIntervalRef.current);
            }

            // Clean up market analyzer
            try {
                if (unsubscribe) {
                    unsubscribe();
                }
                marketAnalyzer.stop();
            } catch (error) {
                console.warn('Error during cleanup:', error);
            }
        };
    }, [client?.loginid, client?.token, handleMarketAnalysis, handleError]);

    // Monitor connection status
    useEffect(() => {
        const checkConnection = () => {
            if (api_base?.api?.connection) {
                const readyState = api_base.api.connection.readyState;
                setConnectionStatus(readyState === 1 ? 'connected' : readyState === 0 ? 'connecting' : 'disconnected');
                setApiConnected(readyState === WebSocket.OPEN);
            } else {
                setConnectionStatus('disconnected');
                setApiConnected(false);
            }
            setIsApiAuthorized(api_base?.is_authorized || false);
        };

        checkConnection();
        const interval = setInterval(checkConnection, 2000);
        return () => clearInterval(interval);
    }, []);

    // Update balance based on transaction history
    useEffect(() => {
        const totalProfit = transactionHistory.reduce((sum, transaction) => sum + transaction.profit, 0);
        setCurrentBalance(initialBalance + totalProfit);
    }, [transactionHistory, initialBalance]);

    const winRate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(1) : '0';
    const hasActiveStrategy = isAutoDifferActive || isAutoOverUnderActive || isAutoO5U4Active;

    // Handle advanced settings application
    const handleAdvancedSettings = (settings: any) => {
        setAppliedStake(settings.stake);
        currentStakeRef.current = settings.stake;
        localStorage.setItem('tradingHub_initialStake', settings.stake);
        globalObserver.emit('ui.log.success', `Advanced settings applied - Stake: ${settings.stake}, Reference: ${settings.referenceDigit}`);
    };

    // Error boundary display
    if (hasError) {
        return (
            <div className="trading-hub-modern">
                <div className="hub-header">
                    <div className="error-container" style={{
                        padding: '40px',
                        textAlign: 'center',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '12px',
                        margin: '20px'
                    }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                        <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>Trading Hub Error</h2>
                        <p style={{ color: 'rgba(255, 255, 255, 0.8)', marginBottom: '24px' }}>
                            {errorMessage || 'An unexpected error occurred while loading the Trading Hub.'}
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                onClick={() => {
                                    setHasError(false);
                                    setErrorMessage('');
                                    setRetryCount(0);
                                    window.location.reload();
                                }}
                                style={{
                                    padding: '12px 24px',
                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: '600'
                                }}
                            >
                                Retry
                            </button>
                            <button
                                onClick={() => window.location.href = '/'}
                                style={{
                                    padding: '12px 24px',
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: 'white',
                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: '600'
                                }}
                            >
                                Go Home
                            </button>
                        </div>
                        {retryCount > 0 && (
                            <p style={{ color: 'rgba(255, 255, 255, 0.6)', marginTop: '16px', fontSize: '14px' }}>
                                Retry attempt: {retryCount}/3
                            </p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    try {
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
                            <DisplayToggle onToggle={setIsAdvancedView} />
                            <button
                                className="advanced-settings-btn"
                                onClick={() => setShowAdvancedModal(true)}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
                                </svg>
                                Advanced Settings
                            </button>
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

                            <div className="control-group">
                                <label>Stop Loss ($)<br/><small>Based on Run Panel Total</small></label>
                                <input
                                    type="number"
                                    value={stopLoss}
                                    onChange={(e) => {
                                        const value = Math.max(parseFloat(e.target.value), 1).toFixed(2);
                                        setStopLoss(value);
                                        localStorage.setItem('tradingHub_stopLoss', value);
                                    }}
                                    className="stop-loss-input"
                                    step="0.01"
                                    min="1"
                                    disabled={isContinuousTrading}
                                    title="Trading will stop when total loss in Run Panel exceeds this amount"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="status-bar">
                        <div className="status-item">
                            <div className={`status-dot ${isAnalysisReady ? 'ready' : 'loading'}`}></div>
                            Multi-Symbol AI: {isAnalysisReady ? 'Ready' : 'Analyzing...'}
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            Ready Markets: {readySymbolsCount}/12
                        </div>
                        <div className="status-separator"></div>
                        <div className="status-item">
                            Analysis: {analysisCount} cycles
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
                        <div className="status-separator"></div>
                        <div className="status-item">
                            <div className={`status-dot ${apiConnected ? 'connected' : 'disconnected'}`}></div>
                            <span>{apiConnected ? 'API Connected' : 'API Disconnected'}</span>
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
                                <p>Advanced AI pattern recognition across 12 volatility indices. Analyzes digit frequencies and recommends UNDER 7 or OVER 2 based on optimal market conditions.</p>

                                {isAutoOverUnderActive && recommendation && (
                                    <div className="recommendation-display">
                                        <div className="rec-item">
                                            <span>AI Selection:</span>
                                            <strong>{recommendation.symbol}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Strategy:</span>
                                            <strong>{recommendation.strategy.toUpperCase()} {recommendation.barrier}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>AI Confidence:</span>
                                            <strong className={recommendation.confidence > 80 ? 'high-confidence' : recommendation.confidence > 75 ? 'medium-confidence' : 'low-confidence'}>
                                                {recommendation.confidence.toFixed(1)}%
                                            </strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Pattern:</span>
                                            <strong>{recommendation.reason.includes('Most frequent digit') ? 
                                                `${recommendation.reason.match(/Most frequent digit (\d)/)?.[1]} vs ${recommendation.reason.match(/current (\d)/)?.[1]}` : 
                                                'Secondary Pattern'}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Ready Markets:</span>
                                            <strong>{readySymbolsCount}/12</strong>
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
                                <p>Sophisticated dual-contract AI strategy. Analyzes all 12 markets simultaneously, scores opportunities, and selects the best symbol meeting 3 critical conditions for 80% theoretical win rate.</p>

                                {isAutoO5U4Active && (
                                    <div className="recommendation-display">
                                        <div className="rec-item">
                                            <span>AI Best Symbol:</span>
                                            <strong>{bestO5U4Opportunity?.symbol || 'Analyzing...'}</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Strategy:</span>
                                            <strong>OVER 5 + UNDER 4</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>AI Score:</span>
                                            <strong>{bestO5U4Opportunity?.score.toFixed(1) || '0.0'}/100</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Conditions:</span>
                                            <strong>{bestO5U4Opportunity?.conditionsMetCount || 0}/3 Met</strong>
                                        </div>
                                        <div className="rec-item">
                                            <span>Opportunities:</span>
                                            <strong>{o5u4Opportunities.length} Found</strong>
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

                    {/* Transaction History */}
                    <div className="transaction-history">
                        <h3>Transaction Log</h3>
                        {transactionHistory.length === 0 ? (
                            <p>No transactions yet.</p>
                        ) : (
                            <ul>
                                {transactionHistory.map((transaction) => (
                                    <li key={transaction.id} className={`transaction-item ${transaction.result}`}>
                                        <div className="transaction-info">
                                            <span className="timestamp">{transaction.timestamp.toLocaleTimeString()}</span>
                                            <span className="type">{transaction.type}</span>
                                            <span className="symbol">{transaction.symbol}</span>
                                            <span className="amount">${transaction.amount.toFixed(2)}</span>
                                        </div>
                                        <div className="transaction-details">
                                            <span className={`result ${transaction.result}`}>
                                                {transaction.result.toUpperCase()}
                                            </span>
                                            <span className={`profit ${transaction.profit >= 0 ? 'positive' : 'negative'}`}>
                                                {transaction.profit >= 0 ? '+' : ''}{transaction.profit.toFixed(2)} USD
                                            </span>
                                            {transaction.details && (
                                                <div className="transaction-note">
                                                    {transaction.details}
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                </div>

                {/* Advanced Display Modal */}
                <AdvancedDisplayModal
                    isOpen={showAdvancedModal}
                    onClose={() => setShowAdvancedModal(false)}
                    onApplySettings={handleAdvancedSettings}
                />
            </div>
        );
    } catch (error: any) {
        console.error('Trading Hub Render Error:', error);
        setHasError(true);
        setErrorMessage(`Render error: ${error.message || 'Unknown render error'}`);
        return (
            <div className="trading-hub-error" style={{
                padding: '40px',
                textAlign: 'center',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                margin: '20px'
            }}>
                <h3 style={{ color: '#ef4444', marginBottom: '16px' }}>Trading Hub Render Error</h3>
                <p style={{ marginBottom: '16px' }}>Failed to render Trading Hub component</p>
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        padding: '8px 16px',
                        background: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}
                >
                    Refresh Page
                </button>
            </div>
        );
    }
};

export default TradingHubDisplay;