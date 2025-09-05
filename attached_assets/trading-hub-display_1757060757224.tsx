import React, { useState, useRef, useEffect } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import marketAnalyzer, { TradeRecommendation } from '../../services/market-analyzer';

const TradingHubDisplay: React.FC = () => {
    const MINIMUM_STAKE = '0.35';
    const { is_dark_mode_on } = useThemeSwitcher();

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
    const minimumTradeCooldown = 3000; // 3 seconds minimum between trades
    const o5u4LastTradeTime = useRef<number>(0);
    const o5u4MinimumCooldown = 1000; // 1 second cooldown for O5U4 (faster than others)

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

    const { run_panel, transactions, client } = useStore();

    const [activeContracts, setActiveContracts] = useState<Record<string, any>>({});
    const contractUpdateInterval = useRef<NodeJS.Timeout | null>(null);
    const lastTradeRef = useRef<{ id: string | null; profit: number | null }>({ id: null, profit: null });
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);

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

    // O5U4 bot - using market analyzer for all symbols
    const [o5u4Analysis, setO5u4Analysis] = useState<{
        bestSymbol: string | null;
        symbolsAnalysis: Record<string, any>;
        readySymbols: string[];
    }>({
        bestSymbol: null,
        symbolsAnalysis: {},
        readySymbols: []
    });

    // Symbols grid toggle state (hidden by default)
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
    }, [client?.loginid]);

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

            // Update O5U4 analysis for all symbols
            analyzeO5U4AllSymbols(allStats);

            // Check for immediate O5U4 trade execution when conditions are met
            if (isAutoO5U4Active && isContinuousTrading && !isTradeInProgress) {
                const now = Date.now();
                const timeSinceLastO5U4Trade = now - o5u4LastTradeTime.current;
                
                if (timeSinceLastO5U4Trade >= o5u4MinimumCooldown && !activeContractRef.current && 
                    !o5u4ActiveContracts.current.over5ContractId && !o5u4ActiveContracts.current.under4ContractId) {
                    // Check if conditions are met immediately
                    if (checkO5U4Conditions()) {
                        console.log('O5U4 conditions met - executing trade immediately');
                        o5u4LastTradeTime.current = now;
                        executeO5U4Trade();
                    }
                }
            }

            if (isContinuousTrading && isAutoOverUnderActive && newRecommendation) {
                setCurrentStrategy(newRecommendation.strategy);
                setCurrentSymbol(newRecommendation.symbol);
            }
        });

        const contractSettlementHandler = (response: any) => {
            if (
                response?.id === 'contract.settled' &&
                response?.data &&
                lastTradeRef.current?.id !== response.data.contract_id
            ) {
                const contract_info = response.data;

                // Handle O5U4 dual contracts
                if (isAutoO5U4Active && 
                    (contract_info.contract_id === o5u4ActiveContracts.current.over5ContractId || 
                     contract_info.contract_id === o5u4ActiveContracts.current.under4ContractId)) {
                    
                    const isOver5 = contract_info.contract_id === o5u4ActiveContracts.current.over5ContractId;
                    const isWin = contract_info.profit >= 0;
                    
                    console.log(`O5U4 ${isOver5 ? 'Over 5' : 'Under 4'} contract ${contract_info.contract_id} settled with ${isWin ? 'WIN' : 'LOSS'}.`);
                    
                    // Update the result for this contract
                    if (isOver5) {
                        o5u4ActiveContracts.current.over5Result = isWin ? 'win' : 'loss';
                    } else {
                        o5u4ActiveContracts.current.under4Result = isWin ? 'win' : 'loss';
                    }
                    
                    // Check if both contracts are now settled
                    if (o5u4ActiveContracts.current.over5Result !== 'pending' && 
                        o5u4ActiveContracts.current.under4Result !== 'pending' && 
                        !o5u4ActiveContracts.current.bothSettled) {
                        
                        o5u4ActiveContracts.current.bothSettled = true;
                        
                        const over5Won = o5u4ActiveContracts.current.over5Result === 'win';
                        const under4Won = o5u4ActiveContracts.current.under4Result === 'win';
                        
                        console.log(`O5U4 Both contracts settled via handler. Over5: ${over5Won ? 'WIN' : 'LOSS'}, Under4: ${under4Won ? 'WIN' : 'LOSS'}`);
                        
                        // Process combined result
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
                            profit: contract_info.profit, // This will be updated with total profit in the interval
                        };
                        
                        // Reset O5U4 tracking
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
                    
                    return; // Don't process as regular contract
                }

                // Regular single contract handling
                if (contract_info.contract_id === activeContractRef.current) {
                    const isWin = contract_info.profit >= 0;
                    setLastTradeWin(isWin);
                    setLastTradeResult(isWin ? 'WIN' : 'LOSS');

                    console.log(`Contract ${contract_info.contract_id} settled with ${isWin ? 'WIN' : 'LOSS'}.`);
                    console.log(
                        `Current stake: ${currentStakeRef.current}, Initial: ${initialStake}, Consecutive losses: ${currentConsecutiveLossesRef.current}`
                    );

                    lastTradeRef.current = {
                        id: contract_info.contract_id,
                        profit: contract_info.profit,
                    };

                    if (isWin) {
                        manageStake('reset');
                    } else {
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

        contractUpdateInterval.current = setInterval(async () => {
            // Handle O5U4 dual contracts separately
            if (isAutoO5U4Active && o5u4ActiveContracts.current.over5ContractId && o5u4ActiveContracts.current.under4ContractId && !o5u4ActiveContracts.current.bothSettled) {
                try {
                    const over5Id = o5u4ActiveContracts.current.over5ContractId;
                    const under4Id = o5u4ActiveContracts.current.under4ContractId;

                    // Check both contracts
                    const over5Response = await api_base.api.send({
                        proposal_open_contract: 1,
                        contract_id: over5Id,
                    });

                    const under4Response = await api_base.api.send({
                        proposal_open_contract: 1,
                        contract_id: under4Id,
                    });

                    let over5Contract = over5Response?.proposal_open_contract;
                    let under4Contract = under4Response?.proposal_open_contract;

                    // Update active contracts state
                    if (over5Contract) {
                        setActiveContracts(prev => ({
                            ...prev,
                            [over5Contract.contract_id]: over5Contract,
                        }));
                    }

                    if (under4Contract) {
                        setActiveContracts(prev => ({
                            ...prev,
                            [under4Contract.contract_id]: under4Contract,
                        }));
                    }

                    // Check if contracts are settled
                    let over5Settled = over5Contract?.is_sold === 1;
                    let under4Settled = under4Contract?.is_sold === 1;

                    // Update results for settled contracts
                    if (over5Settled && o5u4ActiveContracts.current.over5Result === 'pending') {
                        const isWin = over5Contract.profit >= 0;
                        o5u4ActiveContracts.current.over5Result = isWin ? 'win' : 'loss';
                        console.log(`O5U4 Over 5 contract ${over5Id} settled: ${isWin ? 'WIN' : 'LOSS'}, Profit: ${over5Contract.profit}`);
                    }

                    if (under4Settled && o5u4ActiveContracts.current.under4Result === 'pending') {
                        const isWin = under4Contract.profit >= 0;
                        o5u4ActiveContracts.current.under4Result = isWin ? 'win' : 'loss';
                        console.log(`O5U4 Under 4 contract ${under4Id} settled: ${isWin ? 'WIN' : 'LOSS'}, Profit: ${under4Contract.profit}`);
                    }

                    // If both contracts are settled, process the combined result
                    if (over5Settled && under4Settled && !o5u4ActiveContracts.current.bothSettled) {
                        o5u4ActiveContracts.current.bothSettled = true;
                        
                        const over5Won = o5u4ActiveContracts.current.over5Result === 'win';
                        const under4Won = o5u4ActiveContracts.current.under4Result === 'win';
                        const totalProfit = (over5Contract?.profit || 0) + (under4Contract?.profit || 0);

                        console.log(`O5U4 Both contracts settled. Over5: ${over5Won ? 'WIN' : 'LOSS'}, Under4: ${under4Won ? 'WIN' : 'LOSS'}, Total Profit: ${totalProfit}`);

                        // Update trade counts
                        if (over5Won || under4Won) {
                            setWinCount(prev => prev + 1);
                            setLastTradeResult('WIN');
                            setLastTradeWin(true);
                            manageStake('reset');
                            console.log('O5U4: At least one contract won - resetting stake');
                        } else {
                            setLossCount(prev => prev + 1);
                            setLastTradeResult('LOSS');
                            setLastTradeWin(false);
                            manageStake('martingale');
                            console.log('O5U4: Both contracts lost - applying martingale');
                        }

                        // Record the trade result
                        lastTradeRef.current = {
                            id: over5Id, // Use over5 contract ID as primary
                            profit: totalProfit,
                        };

                        contractSettledTimeRef.current = Date.now();

                        // Clean up contracts
                        setActiveContracts(prev => {
                            const newContracts = { ...prev };
                            delete newContracts[over5Id];
                            delete newContracts[under4Id];
                            return newContracts;
                        });

                        // Reset O5U4 tracking
                        o5u4ActiveContracts.current = {
                            over5ContractId: null,
                            under4ContractId: null,
                            over5Result: null,
                            under4Result: null,
                            bothSettled: false
                        };

                        activeContractRef.current = null;
                    }
                } catch (error) {
                    console.error('Error tracking O5U4 contracts:', error);
                }
                return; // Skip regular single contract tracking for O5U4
            }

            // Regular single contract tracking for other bots
            if (!activeContractRef.current) return;
            try {
                const response = await api_base.api.send({
                    proposal_open_contract: 1,
                    contract_id: activeContractRef.current,
                });
                if (response?.proposal_open_contract) {
                    const contract = response.proposal_open_contract;

                    setActiveContracts(prev => ({
                        ...prev,
                        [contract.contract_id]: contract,
                    }));

                    if (contract.is_sold === 1) {
                        const contractId = contract.contract_id;

                        if (lastTradeRef.current?.id === contractId) {
                            console.log(`Contract ${contractId} already processed, skipping duplicate settlement`);
                            return;
                        }

                        const isWin = contract.profit >= 0;
                        const profit = contract.profit;

                        lastTradeRef.current = { id: contractId, profit };
                        contractSettledTimeRef.current = Date.now();

                        console.log(
                            `Contract ${contractId} sold. Result: ${isWin ? 'WIN' : 'LOSS'}, Profit: ${profit}`
                        );
                        console.log(
                            `Current stake before update: ${currentStakeRef.current}, Consecutive losses: ${currentConsecutiveLossesRef.current}`
                        );

                        if (isWin) {
                            setWinCount(prev => prev + 1);
                            manageStake('reset');
                            setLastTradeResult('WIN');
                        } else {
                            setLossCount(prev => prev + 1);
                            manageStake('martingale');
                            setLastTradeResult('LOSS');
                        }

                        setActiveContracts(prev => {
                            const newContracts = { ...prev };
                            delete newContracts[contractId];
                            return newContracts;
                        });
                        activeContractRef.current = null;
                    }
                }
            } catch (error) {
                console.error('Error tracking contract:', error);
            }
        }, 1000);

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

    useEffect(() => {
        currentStakeRef.current = initialStake;
    }, [initialStake]);

    // Load symbols grid visibility preference from localStorage
    useEffect(() => {
        const savedPreference = localStorage.getItem('trading-hub-symbols-grid-visible');
        if (savedPreference !== null) {
            setIsSymbolsGridVisible(savedPreference === 'true');
        }
    }, []);

    useEffect(() => {
        if (isContinuousTrading) {
            // Use a faster interval for more responsive trading
            const intervalTime = isAutoO5U4Active ? 500 : 2000; // 500ms for O5U4, 2000ms for others
            
            tradingIntervalRef.current = setInterval(() => {
                const now = Date.now();
                const timeSinceLastTrade = now - lastTradeTime.current;
                const timeSinceSettlement = now - contractSettledTimeRef.current;
                
                // Skip if trade is in progress or active contract exists
                if (isTradeInProgress || activeContractRef.current !== null || 
                    (isAutoO5U4Active && (o5u4ActiveContracts.current.over5ContractId || o5u4ActiveContracts.current.under4ContractId))) {
                    if (!waitingForSettlementRef.current) {
                        console.log(
                            `Trade skipped: ${
                                isTradeInProgress
                                    ? 'Trade in progress'
                                    : activeContractRef.current 
                                        ? 'Waiting for previous contract settlement'
                                        : 'O5U4 contracts are active'
                            }`
                        );
                    }

                    if (activeContractRef.current || o5u4ActiveContracts.current.over5ContractId) {
                        waitingForSettlementRef.current = true;
                    }
                    return;
                }

                waitingForSettlementRef.current = false;

                // Different cooldown times for different strategies
                let requiredCooldown = minimumTradeCooldown;
                let lastTradeTimeRef = lastTradeTime;
                
                if (isAutoO5U4Active) {
                    requiredCooldown = o5u4MinimumCooldown;
                    lastTradeTimeRef = o5u4LastTradeTime;
                }

                if (timeSinceLastTrade < requiredCooldown && lastTradeTimeRef.current > 0) {
                    return; // Still in cooldown
                }

                if (timeSinceSettlement < 1000) { // Reduced from 2000ms to 1000ms
                    console.log('Recent settlement, waiting for martingale calculation to complete...');
                    return;
                }

                if (isAutoDifferActive) {
                    executeDigitDifferTrade();
                } else if (isAutoOverUnderActive) {
                    executeDigitOverTrade();
                } else if (isAutoO5U4Active) {
                    executeO5U4Trade();
                }
            }, intervalTime);
        } else {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
                tradingIntervalRef.current = null;
            }
        }
        return () => {
            if (tradingIntervalRef.current) {
                clearInterval(tradingIntervalRef.current);
            }
        };
    }, [isContinuousTrading, isAutoDifferActive, isAutoOverUnderActive, isAutoO5U4Active, isTradeInProgress]);

    const toggleAutoDiffer = () => {
        if (!isAutoDifferActive && isAutoOverUnderActive) {
            setIsAutoOverUnderActive(false);
        }
        if (!isAutoDifferActive && isAutoO5U4Active) {
            setIsAutoO5U4Active(false);
        }
        setIsAutoDifferActive(prev => !prev);
        if (isContinuousTrading) {
            stopTrading();
        }
    };

    const toggleAutoOverUnder = () => {
        if (!isAutoOverUnderActive && isAutoDifferActive) {
            setIsAutoDifferActive(false);
        }
        if (!isAutoOverUnderActive && isAutoO5U4Active) {
            setIsAutoO5U4Active(false);
        }
        setIsAutoOverUnderActive(prev => !prev);
        if (isContinuousTrading) {
            stopTrading();
        }
    };

    const toggleAutoO5U4 = () => {
        if (!isAutoO5U4Active && isAutoDifferActive) {
            setIsAutoDifferActive(false);
        }
        if (!isAutoO5U4Active && isAutoOverUnderActive) {
            setIsAutoOverUnderActive(false);
        }
        
        const newState = !isAutoO5U4Active;
        setIsAutoO5U4Active(newState);
        
        // If activating O5U4 and trading is active, immediately check for conditions
        if (newState && isContinuousTrading) {
            console.log('O5U4 activated - checking for immediate trade opportunities');
            setTimeout(() => {
                if (checkO5U4Conditions() && !isTradeInProgress && !activeContractRef.current && 
                    !o5u4ActiveContracts.current.over5ContractId && !o5u4ActiveContracts.current.under4ContractId) {
                    console.log('O5U4: Immediate trade opportunity found on activation');
                    executeO5U4Trade();
                }
            }, 100); // Small delay to ensure state is updated
        }
        
        if (isContinuousTrading) {
            stopTrading();
        }
    };

    // Toggle symbols grid visibility
    const toggleSymbolsGrid = () => {
        setIsSymbolsGridVisible(prev => !prev);
        // Optionally save preference to localStorage
        localStorage.setItem('trading-hub-symbols-grid-visible', (!isSymbolsGridVisible).toString());
    };

    const handleSaveSettings = () => {
        const validStake =
            stake === ''
                ? MINIMUM_STAKE
                : Math.max(parseFloat(stake) || parseFloat(MINIMUM_STAKE), parseFloat(MINIMUM_STAKE)).toFixed(2);
        console.log(`Saving stake settings from ${initialStake} to ${validStake}`);
        manageStake('init', { newValue: validStake });

        if (validStake !== stake) {
            setStake(validStake);
        }

        const validMartingale = martingale === '' ? '2' : Math.max(parseFloat(martingale) || 1, 1).toFixed(1);
        console.log(`Saving martingale settings from ${martingale} to ${validMartingale}`);
        manageMartingale('init', { newValue: validMartingale });

        if (validMartingale !== martingale) {
            setMartingale(validMartingale);
        }

        // setIsSettingsOpen(false);
    };

    const getRandomBarrier = () => Math.floor(Math.random() * 10);
    const getRandomSymbol = () => {
        const randomIndex = Math.floor(Math.random() * availableSymbols.length);
        return availableSymbols[randomIndex];
    };

    const prepareRunPanelForTradingHub = () => {
        if (!run_panel.is_drawer_open) {
            run_panel.toggleDrawer(true);
        }
        run_panel.setActiveTabIndex(1);
        globalObserver.emit('bot.running');
        const new_session_id = `tradingHub_${Date.now()}`;
        setSessionRunId(new_session_id);
        globalObserver.emit('bot.started', new_session_id);
    };

    const executeDigitDifferTrade = async () => {
        if (isTradeInProgress) {
            console.log('Trade already in progress, skipping new trade request');
            return;
        }

        try {
            setIsTradeInProgress(true);
            setIsTrading(true);
            const barrier = getRandomBarrier();
            const symbol = getRandomSymbol();
            setCurrentBarrier(barrier);
            setCurrentSymbol(symbol);

            const tradeId = `differ_${symbol}_${barrier}_${Date.now()}`;
            setLastTradeId(tradeId);
            setTradeCount(prevCount => prevCount + 1);
            lastTradeTime.current = Date.now();

            const currentTradeStake = manageStake('get');
            console.log(
                `Starting trade #${tradeCount + 1}: ${tradeId} with stake ${currentTradeStake} (consecutive losses: ${currentConsecutiveLossesRef.current})`
            );

            const opts = {
                amount: +currentTradeStake,
                basis: 'stake',
                contract_type: 'DIGITDIFF',
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: symbol,
                barrier: barrier.toString(),
            };

            // Create an array to store all trade promises
            const trades = [];

            // Standard trade for current account
            const standardTradePromise = doUntilDone(() =>
                api_base.api.send({
                    buy: 1,
                    price: opts.amount,
                    parameters: opts,
                }), [], api_base
            );
            trades.push(standardTradePromise);

            // Check copy trading settings from header
            if (client?.loginid) {
                const copyTradeEnabled = localStorage.getItem(`copytradeenabled_${client.loginid}`) === 'true';
                if (copyTradeEnabled) {
                    // Get tokens for copy trading
                    const tokensStr = localStorage.getItem(`extratokens_${client.loginid}`);
                    const tokens = tokensStr ? JSON.parse(tokensStr) : [];

                    if (tokens.length > 0) {
                        const copyOption = {
                            buy_contract_for_multiple_accounts: '1',
                            price: opts.amount,
                            tokens,
                            parameters: {
                                ...opts,
                            },
                        };
                        trades.push(doUntilDone(() => api_base.api.send(copyOption), [], api_base));
                    }

                    // Check if copying to real account is enabled
                    const copyToReal =
                        client.loginid?.startsWith('VR') &&
                        localStorage.getItem(`copytoreal_${client.loginid}`) === 'true';

                    if (copyToReal) {
                        try {
                            const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
                            const realAccountToken = Object.entries(accountsList).find(([id]) =>
                                id.startsWith('CR')
                            )?.[1];

                            if (realAccountToken) {
                                const realOption = {
                                    buy_contract_for_multiple_accounts: '1',
                                    price: opts.amount,
                                    tokens: [realAccountToken],
                                    parameters: {
                                        ...opts,
                                    },
                                };
                                trades.push(doUntilDone(() => api_base.api.send(realOption), [], api_base));
                            }
                        } catch (e) {
                            console.error('Error copying to real account:', e);
                        }
                    }
                }
            }

            // Execute all trades
            const results = await Promise.all(trades);
            const successfulTrades = results.filter(result => result && result.buy);

            if (successfulTrades.length > 0) {
                const result = successfulTrades[0]; // Use the main account result for UI updates
                const buy = result.buy;

                const contractId = buy.contract_id;
                console.log(`Trade purchased. Contract ID: ${contractId}, Stake: ${currentTradeStake}`);
                activeContractRef.current = contractId;
                setActiveContractId(contractId);

                setActiveContracts(prev => ({
                    ...prev,
                    [contractId]: {
                        contract_id: contractId,
                        buy_price: opts.amount,
                        status: 'open',
                        purchase_time: Date.now(),
                    },
                }));

                const contract_info = {
                    contract_id: buy.contract_id,
                    contract_type: opts.contract_type,
                    transaction_ids: { buy: buy.transaction_id },
                    buy_price: opts.amount,
                    currency: opts.currency,
                    symbol: opts.symbol,
                    barrier: opts.barrier,
                    date_start: Math.floor(Date.now() / 1000),
                    barrier_display_value: barrier.toString(),
                    contract_parameter: barrier.toString(),
                    parameter_type: 'differ_barrier',
                    entry_tick_time: Math.floor(Date.now() / 1000),
                    exit_tick_time: Math.floor(Date.now() / 1000) + opts.duration,
                    run_id: sessionRunId,
                    display_name: 'Digit Differs',
                    transaction_time: Math.floor(Date.now() / 1000),
                    underlying: symbol,
                    longcode: `Digit ${barrier} differs from last digit of last tick on ${symbol}.`,
                    display_message: `Contract parameter: Differ from ${barrier} on ${symbol}`,
                };

                globalObserver.emit('trading_hub.running');
                globalObserver.emit('bot.contract', contract_info);
                globalObserver.emit('bot.bot_ready');
                globalObserver.emit('contract.purchase_received', buy.contract_id);
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase',
                    data: contract_info,
                    buy,
                });

                transactions.onBotContractEvent(contract_info);
                console.log(`Trade executed: ${opts.contract_type} with barrier ${opts.barrier} on ${opts.symbol}`);

                if (successfulTrades.length > 1) {
                    console.log(`Successfully placed ${successfulTrades.length} trades (including copy trades)`);
                }
            } else {
                console.error('Trade purchase failed: No buy response received');
                globalObserver.emit('ui.log.error', 'Trade purchase failed: No buy response received');
            }
        } catch (error) {
            console.error('Trade execution error:', error);
            globalObserver.emit('ui.log.error', `Trade execution error: ${error}`);
        } finally {
            setIsTrading(false);
            setTimeout(() => {
                setIsTradeInProgress(false);
            }, 1000);
        }
    };

    const executeDigitOverTrade = async () => {
        if (isTradeInProgress) {
            console.log('Trade already in progress, skipping new trade request');
            return;
        }

        try {
            setIsTradeInProgress(true);
            setIsTrading(true);
            if (!isAnalysisReady) {
                console.log('Waiting for market analysis to be ready...');
                await marketAnalyzer.waitForAnalysisReady();
                console.log('Market analysis ready, proceeding with trade');
            }
            const latestRecommendation = await marketAnalyzer.getLatestRecommendation();
            const tradeRec = latestRecommendation || {
                symbol: 'R_100',
                strategy: 'over',
                barrier: '2',
                overPercentage: 0,
                underPercentage: 0,
            };
            const symbol = tradeRec.symbol;
            const strategy = tradeRec.strategy;
            const barrier = tradeRec.strategy === 'over' ? '2' : '7';
            const contract_type = tradeRec.strategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER';

            const tradeId = `${contract_type.toLowerCase()}_${symbol}_${barrier}_${Date.now()}`;
            setLastTradeId(tradeId);
            setTradeCount(prevCount => prevCount + 1);
            lastTradeTime.current = Date.now();

            const currentTradeStake = manageStake('get');
            console.log(
                `Starting trade #${tradeCount + 1}: ${tradeId} with stake ${currentTradeStake} (consecutive losses: ${currentConsecutiveLossesRef.current})`
            );
            setCurrentBarrier(parseInt(barrier, 10));
            setCurrentSymbol(symbol);
            setCurrentStrategy(strategy);
            const opts = {
                amount: +currentTradeStake,
                basis: 'stake',
                contract_type,
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol,
                barrier,
            };

            const trades = [];

            const standardTradePromise = doUntilDone(() =>
                api_base.api.send({
                    buy: 1,
                    price: opts.amount,
                    parameters: opts,
                }), [], api_base
            );
            trades.push(standardTradePromise);

            if (client?.loginid) {
                const copyTradeEnabled = localStorage.getItem(`copytradeenabled_${client.loginid}`) === 'true';
                if (copyTradeEnabled) {
                    const tokensStr = localStorage.getItem(`extratokens_${client.loginid}`);
                    const tokens = tokensStr ? JSON.parse(tokensStr) : [];

                    if (tokens.length > 0) {
                        const copyOption = {
                            buy_contract_for_multiple_accounts: '1',
                            price: opts.amount,
                            tokens,
                            parameters: {
                                ...opts,
                            },
                        };
                        trades.push(doUntilDone(() => api_base.api.send(copyOption), [], api_base));
                    }

                    const copyToReal =
                        client.loginid?.startsWith('VR') &&
                        localStorage.getItem(`copytoreal_${client.loginid}`) === 'true';

                    if (copyToReal) {
                        try {
                            const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
                            const realAccountToken = Object.entries(accountsList).find(([id]) =>
                                id.startsWith('CR')
                            )?.[1];

                            if (realAccountToken) {
                                const realOption = {
                                    buy_contract_for_multiple_accounts: '1',
                                    price: opts.amount,
                                    tokens: [realAccountToken],
                                    parameters: {
                                        ...opts,
                                    },
                                };
                                trades.push(doUntilDone(() => api_base.api.send(realOption), [], api_base));
                            }
                        } catch (e) {
                            console.error('Error copying to real account:', e);
                        }
                    }
                }
            }

            const results = await Promise.all(trades);
            const successfulTrades = results.filter(result => result && result.buy);

            if (successfulTrades.length > 0) {
                const result = successfulTrades[0];
                const buy = result.buy;

                const contractId = buy.contract_id;
                console.log(`Trade purchased. Contract ID: ${contractId}, Stake: ${currentTradeStake}`);
                activeContractRef.current = contractId;
                setActiveContractId(contractId);

                setActiveContracts(prev => ({
                    ...prev,
                    [contractId]: {
                        contract_id: contractId,
                        buy_price: opts.amount,
                        status: 'open',
                        purchase_time: Date.now(),
                    },
                }));

                const contract_info = {
                    contract_id: buy.contract_id,
                    contract_type: opts.contract_type,
                    transaction_ids: { buy: buy.transaction_id },
                    buy_price: opts.amount,
                    currency: opts.currency,
                    symbol: opts.symbol,
                    barrier: opts.barrier,
                    date_start: Math.floor(Date.now() / 1000),
                    barrier_display_value: barrier,
                    contract_parameter: barrier,
                    parameter_type: strategy === 'over' ? 'over_barrier' : 'under_barrier',
                    entry_tick_time: Math.floor(Date.now() / 1000),
                    exit_tick_time: Math.floor(Date.now() / 1000) + opts.duration,
                    run_id: sessionRunId,
                    display_name: strategy === 'over' ? 'Digit Over' : 'Digit Under',
                    transaction_time: Math.floor(Date.now() / 1000),
                    underlying: symbol,
                    longcode: `Last digit is ${strategy} ${barrier} on ${symbol}.`,
                    display_message: `Contract parameter: ${strategy === 'over' ? 'Over' : 'Under'} ${barrier} on ${symbol}`,
                };

                globalObserver.emit('trading_hub.running');
                globalObserver.emit('bot.contract', contract_info);
                globalObserver.emit('bot.bot_ready');
                globalObserver.emit('contract.purchase_received', buy.contract_id);
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase',
                    data: contract_info,
                    buy,
                });

                transactions.onBotContractEvent(contract_info);
                console.log(`Trade executed: ${opts.contract_type} with barrier ${opts.barrier} on ${opts.symbol}`);

                if (successfulTrades.length > 1) {
                    console.log(`Successfully placed ${successfulTrades.length} trades (including copy trades)`);
                }
            } else {
                console.error('Trade purchase failed: No buy response received');
                globalObserver.emit('ui.log.error', 'Trade purchase failed: No buy response received');
            }
        } catch (error) {
            console.error('Trade execution error:', error);
            globalObserver.emit('ui.log.error', `Trade execution error: ${error}`);
        } finally {
            setIsTrading(false);
            setTimeout(() => {
                setIsTradeInProgress(false);
            }, 1000);
        }
    };

    const executeO5U4Trade = async () => {
        if (isTradeInProgress) {
            console.log('O5U4: Trade already in progress, skipping new trade request');
            return;
        }

        // Check if O5U4 contracts are already active
        if (o5u4ActiveContracts.current.over5ContractId || o5u4ActiveContracts.current.under4ContractId) {
            console.log('O5U4: Contracts already active, skipping new trade request');
            return;
        }

        try {
            setIsTradeInProgress(true);
            setIsTrading(true);

            // Check if conditions are met with detailed logging
            if (!checkO5U4Conditions()) {
                console.log('O5U4: Conditions not met, skipping trade');
                return;
            }

            const symbol = o5u4Analysis.bestSymbol!; // Use the best symbol found by analysis
            setCurrentSymbol(symbol);

            const bestAnalysis = o5u4Analysis.symbolsAnalysis[symbol];
            console.log(`O5U4: EXECUTING TRADE on ${symbol}: ${bestAnalysis.reason} (score: ${bestAnalysis.score})`);

            const tradeId = `o5u4_${symbol}_${Date.now()}`;
            setLastTradeId(tradeId);
            setTradeCount(prevCount => prevCount + 1);
            lastTradeTime.current = Date.now();
            o5u4LastTradeTime.current = Date.now(); // Update O5U4 specific timer

            const currentTradeStake = manageStake('get');
            console.log(
                `Starting O5U4 trade #${tradeCount + 1}: ${tradeId} with stake ${currentTradeStake} (consecutive losses: ${currentConsecutiveLossesRef.current})`
            );

            // Create trades array for both over 5 and under 4
            const trades = [];

            // Over 5 trade
            const overOpts = {
                amount: +currentTradeStake,
                basis: 'stake',
                contract_type: 'DIGITOVER',
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: symbol,
                barrier: '5',
            };

            // Under 4 trade
            const underOpts = {
                amount: +currentTradeStake,
                basis: 'stake',
                contract_type: 'DIGITUNDER',
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: symbol,
                barrier: '4',
            };

            // Standard over 5 trade
            const overTradePromise = doUntilDone(() =>
                api_base.api.send({
                    buy: 1,
                    price: overOpts.amount,
                    parameters: overOpts,
                }), [], api_base
            );
            trades.push(overTradePromise);

            // Standard under 4 trade
            const underTradePromise = doUntilDone(() =>
                api_base.api.send({
                    buy: 1,
                    price: underOpts.amount,
                    parameters: underOpts,
                }), [], api_base
            );
            trades.push(underTradePromise);

            // Check copy trading settings
            if (client?.loginid) {
                const copyTradeEnabled = localStorage.getItem(`copytradeenabled_${client.loginid}`) === 'true';
                if (copyTradeEnabled) {
                    const tokensStr = localStorage.getItem(`extratokens_${client.loginid}`);
                    const tokens = tokensStr ? JSON.parse(tokensStr) : [];

                    if (tokens.length > 0) {
                        // Copy trade for over 5
                        const copyOverOption = {
                            buy_contract_for_multiple_accounts: '1',
                            price: overOpts.amount,
                            tokens,
                            parameters: overOpts,
                        };
                        trades.push(doUntilDone(() => api_base.api.send(copyOverOption), [], api_base));

                        // Copy trade for under 4
                        const copyUnderOption = {
                            buy_contract_for_multiple_accounts: '1',
                            price: underOpts.amount,
                            tokens,
                            parameters: underOpts,
                        };
                        trades.push(doUntilDone(() => api_base.api.send(copyUnderOption), [], api_base));
                    }

                    // Check if copying to real account is enabled
                    const copyToReal =
                        client.loginid?.startsWith('VR') &&
                        localStorage.getItem(`copytoreal_${client.loginid}`) === 'true';

                    if (copyToReal) {
                        try {
                            const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
                            const realAccountToken = Object.entries(accountsList).find(([id]) =>
                                id.startsWith('CR')
                            )?.[1];

                            if (realAccountToken) {
                                // Real account over 5 trade
                                const realOverOption = {
                                    buy_contract_for_multiple_accounts: '1',
                                    price: overOpts.amount,
                                    tokens: [realAccountToken],
                                    parameters: overOpts,
                                };
                                trades.push(doUntilDone(() => api_base.api.send(realOverOption), [], api_base));

                                // Real account under 4 trade
                                const realUnderOption = {
                                    buy_contract_for_multiple_accounts: '1',
                                    price: underOpts.amount,
                                    tokens: [realAccountToken],
                                    parameters: underOpts,
                                };
                                trades.push(doUntilDone(() => api_base.api.send(realUnderOption), [], api_base));
                            }
                        } catch (e) {
                            console.error('Error copying to real account:', e);
                        }
                    }
                }
            }

            // Execute all trades
            const results = await Promise.all(trades);
            const successfulTrades = results.filter(result => result && result.buy);

            if (successfulTrades.length >= 2) { // At least the main over and under trades should succeed
                const overResult = successfulTrades[0];
                const underResult = successfulTrades[1];
                
                const overBuy = overResult.buy;
                const underBuy = underResult.buy;

                console.log(`O5U4 trades purchased. Over 5 Contract ID: ${overBuy.contract_id}, Under 4 Contract ID: ${underBuy.contract_id}, Stake each: ${currentTradeStake}`);
                
                // For O5U4, track both contracts in the special O5U4 tracking
                o5u4ActiveContracts.current = {
                    over5ContractId: overBuy.contract_id,
                    under4ContractId: underBuy.contract_id,
                    over5Result: 'pending',
                    under4Result: 'pending',
                    bothSettled: false
                };

                // Set the first contract as active for UI purposes
                activeContractRef.current = overBuy.contract_id;
                setActiveContractId(overBuy.contract_id);

                // Track both contracts
                setActiveContracts(prev => ({
                    ...prev,
                    [overBuy.contract_id]: {
                        contract_id: overBuy.contract_id,
                        buy_price: overOpts.amount,
                        status: 'open',
                        purchase_time: Date.now(),
                        trade_type: 'over_5'
                    },
                    [underBuy.contract_id]: {
                        contract_id: underBuy.contract_id,
                        buy_price: underOpts.amount,
                        status: 'open',
                        purchase_time: Date.now(),
                        trade_type: 'under_4'
                    }
                }));

                // Create contract info for the over 5 trade
                const overContractInfo = {
                    contract_id: overBuy.contract_id,
                    contract_type: overOpts.contract_type,
                    transaction_ids: { buy: overBuy.transaction_id },
                    buy_price: overOpts.amount,
                    currency: overOpts.currency,
                    symbol: overOpts.symbol,
                    barrier: overOpts.barrier,
                    date_start: Math.floor(Date.now() / 1000),
                    barrier_display_value: '5',
                    contract_parameter: '5',
                    parameter_type: 'over_barrier',
                    entry_tick_time: Math.floor(Date.now() / 1000),
                    exit_tick_time: Math.floor(Date.now() / 1000) + overOpts.duration,
                    run_id: sessionRunId,
                    display_name: 'O5U4 Bot - Over 5',
                    transaction_time: Math.floor(Date.now() / 1000),
                    underlying: symbol,
                    longcode: `Last digit over 5 on ${symbol}.`,
                    display_message: `O5U4 Bot: Over 5 on ${symbol}`,
                };

                // Create contract info for the under 4 trade
                const underContractInfo = {
                    contract_id: underBuy.contract_id,
                    contract_type: underOpts.contract_type,
                    transaction_ids: { buy: underBuy.transaction_id },
                    buy_price: underOpts.amount,
                    currency: underOpts.currency,
                    symbol: underOpts.symbol,
                    barrier: underOpts.barrier,
                    date_start: Math.floor(Date.now() / 1000),
                    barrier_display_value: '4',
                    contract_parameter: '4',
                    parameter_type: 'under_barrier',
                    entry_tick_time: Math.floor(Date.now() / 1000),
                    exit_tick_time: Math.floor(Date.now() / 1000) + underOpts.duration,
                    run_id: sessionRunId,
                    display_name: 'O5U4 Bot - Under 4',
                    transaction_time: Math.floor(Date.now() / 1000),
                    underlying: symbol,
                    longcode: `Last digit under 4 on ${symbol}.`,
                    display_message: `O5U4 Bot: Under 4 on ${symbol}`,
                };

                globalObserver.emit('trading_hub.running');
                globalObserver.emit('bot.contract', overContractInfo);
                globalObserver.emit('bot.contract', underContractInfo);
                globalObserver.emit('bot.bot_ready');
                globalObserver.emit('contract.purchase_received', overBuy.contract_id);
                globalObserver.emit('contract.purchase_received', underBuy.contract_id);
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase',
                    data: overContractInfo,
                    buy: overBuy,
                });
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase',
                    data: underContractInfo,
                    buy: underBuy,
                });

                transactions.onBotContractEvent(overContractInfo);
                transactions.onBotContractEvent(underContractInfo);
                console.log(`O5U4 trades executed: Over 5 and Under 4 on ${symbol}`);

                if (successfulTrades.length > 2) {
                    console.log(`Successfully placed ${successfulTrades.length} trades (including copy trades)`);
                }
            } else {
                console.error('O5U4 trade purchase failed: Insufficient successful trades');
                globalObserver.emit('ui.log.error', 'O5U4 trade purchase failed: Insufficient successful trades');
            }
        } catch (error) {
            console.error('O5U4 trade execution error:', error);
            globalObserver.emit('ui.log.error', `O5U4 trade execution error: ${error}`);
        } finally {
            setIsTrading(false);
            // Reduce timeout for O5U4 to allow faster successive trades
            setTimeout(() => {
                setIsTradeInProgress(false);
            }, 500); // Reduced from 1000ms to 500ms for faster recovery
        }
    };

    // Analyze O5U4 conditions across all symbols
    const analyzeO5U4AllSymbols = (allStats: Record<string, any>) => {
        const symbolsAnalysis: Record<string, any> = {};
        const readySymbols: string[] = [];
        let bestSymbol: string | null = null;
        let bestScore = 0;

        let totalReady = 0;
        let totalMeetingConditions = 0;

        availableSymbols.forEach(symbol => {
            const stats = allStats[symbol];
            if (!stats || !stats.digitCounts || stats.sampleSize < 20) {
                symbolsAnalysis[symbol] = {
                    ready: false,
                    meetsConditions: false,
                    reason: stats ? `Insufficient data (${stats.sampleSize} ticks)` : 'No data'
                };
                return;
            }

            totalReady++;
            readySymbols.push(symbol);
            const analysis = checkO5U4ConditionsForSymbol(stats);
            symbolsAnalysis[symbol] = {
                ready: true,
                meetsConditions: analysis.meetsConditions,
                reason: analysis.reason,
                lastDigit: stats.currentLastDigit,
                sampleSize: stats.sampleSize,
                leastAppearing: analysis.leastAppearing,
                mostAppearing: analysis.mostAppearing,
                score: analysis.score
            };

            if (analysis.meetsConditions) {
                totalMeetingConditions++;
                console.log(`O5U4: ${symbol} meets conditions - ${analysis.reason} (score: ${analysis.score})`);
            }

            // Find the best symbol (highest score among those that meet conditions)
            if (analysis.meetsConditions && analysis.score > bestScore) {
                bestScore = analysis.score;
                bestSymbol = symbol;
            }
        });

        // Log summary only when conditions change or when we have a best symbol
        const previousBest = o5u4Analysis.bestSymbol;
        if (bestSymbol !== previousBest) {
            console.log(`O5U4 Analysis: ${totalReady}/${availableSymbols.length} symbols ready, ${totalMeetingConditions} meeting conditions. Best: ${bestSymbol || 'None'}`);
        }

        setO5u4Analysis({
            bestSymbol,
            symbolsAnalysis,
            readySymbols
        });
    };

    // Check O5U4 conditions for a specific symbol
    const checkO5U4ConditionsForSymbol = (stats: any): {
        meetsConditions: boolean;
        reason: string;
        leastAppearing: number;
        mostAppearing: number;
        score: number;
    } => {
        const lastDigitValue = stats.currentLastDigit;
        
        // Condition 1: Last digit is 4 or 5
        if (lastDigitValue !== 4 && lastDigitValue !== 5) {
            return {
                meetsConditions: false,
                reason: `Last digit ${lastDigitValue} is not 4 or 5`,
                leastAppearing: -1,
                mostAppearing: -1,
                score: 0
            };
        }
        
        // Find least and most appearing digits
        const digitCounts = stats.digitCounts;
        const countEntries = digitCounts.map((count: number, digit: number) => ({
            digit,
            count
        })).filter((entry: any) => entry.count > 0);
        
        if (countEntries.length === 0) {
            return {
                meetsConditions: false,
                reason: 'No digit counts available',
                leastAppearing: -1,
                mostAppearing: -1,
                score: 0
            };
        }
        
        const sortedByCounts = countEntries.sort((a: any, b: any) => a.count - b.count);
        const leastAppearing = sortedByCounts[0].digit;
        const mostAppearing = sortedByCounts[sortedByCounts.length - 1].digit;
        
        // Condition 2: Least appearing digit is 4 or 5
        if (leastAppearing !== 4 && leastAppearing !== 5) {
            return {
                meetsConditions: false,
                reason: `Least appearing digit ${leastAppearing} is not 4 or 5`,
                leastAppearing,
                mostAppearing,
                score: 0
            };
        }
        
        // Condition 3: Most appearing is >5 or <4
        if (!(mostAppearing > 5 || mostAppearing < 4)) {
            return {
                meetsConditions: false,
                reason: `Most appearing digit ${mostAppearing} is not >5 or <4`,
                leastAppearing,
                mostAppearing,
                score: 0
            };
        }
        
        // Calculate score based on frequency differences and sample size
        const leastCount = sortedByCounts[0].count;
        const mostCount = sortedByCounts[sortedByCounts.length - 1].count;
        const frequencyDifference = mostCount - leastCount;
        const score = frequencyDifference * (stats.sampleSize / 100); // Normalize by sample size
        
        return {
            meetsConditions: true,
            reason: `All conditions met: last=${lastDigitValue}, least=${leastAppearing}, most=${mostAppearing}`,
            leastAppearing,
            mostAppearing,
            score
        };
    };

    // Helper function to check O5U4 conditions (updated to use best symbol)
    const checkO5U4Conditions = (): boolean => {
        const hasValidSymbol = o5u4Analysis.bestSymbol !== null;
        if (!hasValidSymbol) {
            console.log('O5U4: No valid symbol found');
        } else {
            console.log(`O5U4: Valid symbol found - ${o5u4Analysis.bestSymbol}`);
        }
        return hasValidSymbol;
    };

    const startTrading = () => {
        prepareRunPanelForTradingHub();
        setIsContinuousTrading(true);

        const persistedStake = localStorage.getItem('tradingHub_initialStake') || initialStake;
        console.log(`Starting trading with persisted stake: ${persistedStake}`);

        setAppliedStake(persistedStake);
        currentStakeRef.current = persistedStake;
        setConsecutiveLosses(0);
        currentConsecutiveLossesRef.current = 0;
        contractSettledTimeRef.current = 0;
        waitingForSettlementRef.current = false;

        setTimeout(() => {
            if (isAutoDifferActive) executeDigitDifferTrade();
            else if (isAutoOverUnderActive) executeDigitOverTrade();
            else if (isAutoO5U4Active) {
                // For O5U4, check immediately and execute if conditions are met
                console.log('O5U4: Starting trading - checking immediate conditions');
                if (checkO5U4Conditions()) {
                    console.log('O5U4: Immediate conditions met on start - executing trade');
                    executeO5U4Trade();
                } else {
                    console.log('O5U4: No immediate conditions met on start - waiting for next opportunity');
                }
            }
        }, isAutoO5U4Active ? 100 : 500); // Faster start for O5U4
    };

    const stopTrading = () => {
        setIsContinuousTrading(false);
        setIsTrading(false);
        globalObserver.emit('bot.stopped');
        manageStake('reset');
        
        // Reset O5U4 contract tracking when stopping
        o5u4ActiveContracts.current = {
            over5ContractId: null,
            under4ContractId: null,
            over5Result: null,
            under4Result: null,
            bothSettled: false
        };
    };

    const handleTrade = () => (isContinuousTrading ? stopTrading() : startTrading());

    const isStrategyActive = isAutoDifferActive || isAutoOverUnderActive || isAutoO5U4Active;

    const displayStake = () => {
        if (parseFloat(appliedStake) === parseFloat(initialStake)) {
            return `$${parseFloat(appliedStake).toFixed(2)}`;
        } else {
            return `$${parseFloat(appliedStake).toFixed(2)} (Base: $${parseFloat(initialStake).toFixed(2)})`;
        }
    };

    return (
        <div className={`trading-hub-modern ${is_dark_mode_on ? 'theme--dark' : 'theme--light'}`}>
            <div className='trading-hub-content'>
                {/* Header Section */}
                <div className='hub-header'>
                    <div className='header-main'>
                        <div className='logo-section'>
                            <div className='logo-icon'>
                                <svg viewBox='0 0 24 24' width='24' height='24'>
                                    <path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' fill='url(#gradient1)' />
                                    <defs>
                                        <linearGradient id='gradient1' x1='0%' y1='0%' x2='100%' y2='100%'>
                                            <stop offset='0%' stopColor='#6366F1' />
                                            <stop offset='100%' stopColor='#8B5CF6' />
                                        </linearGradient>
                                    </defs>
                                </svg>
                            </div>
                            <div className='title-group'>
                                <h1 className='hub-title'>Trading Hub</h1>
                                <p className='hub-subtitle'>AI-Powered Strategies</p>
                            </div>
                        </div>

                        <div className='settings-controls'>
                            <div className='control-group'>
                                <label htmlFor='stake-input'>Stake ($)</label>
                                <input
                                    id='stake-input'
                                    type='number'
                                    min={MINIMUM_STAKE}
                                    step='0.01'
                                    value={stake}
                                    onChange={e => {
                                        const value = e.target.value;
                                        manageStake('update', { newValue: value });
                                    }}
                                    onBlur={handleSaveSettings}
                                    disabled={isContinuousTrading}
                                    className='compact-input'
                                />
                            </div>

                            <div className='control-group'>
                                <label htmlFor='martingale-input'>Martingale</label>
                                <input
                                    id='martingale-input'
                                    type='number'
                                    min='1'
                                    step='0.1'
                                    value={martingale}
                                    onChange={e => {
                                        const value = e.target.value;
                                        manageMartingale('update', { newValue: value });
                                    }}
                                    onBlur={handleSaveSettings}
                                    disabled={isContinuousTrading}
                                    className='compact-input'
                                />
                            </div>
                        </div>
                    </div>

                    {/* Status Bar */}
                    <div className='status-bar'>
                        <div className='status-item'>
                            <div className='status-dot'></div>
                            <span>Market Connected</span>
                        </div>
                        <div className='status-separator'></div>
                        <div className='status-item'>
                            <span>Stake: {displayStake()}</span>
                        </div>
                        {Object.keys(activeContracts).length > 0 && (
                            <>
                                <div className='status-separator'></div>
                                <div className='status-item active-trade'>
                                    <div className='pulse-dot'></div>
                                    <span>Live Trade</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Strategy Cards */}
                <div className='strategy-grid'>
                    <div className={`strategy-card ${isAutoDifferActive ? 'active' : ''}`}>
                        <div className='card-header'>
                            <div className='strategy-icon'>
                                <svg viewBox='0 0 24 24' width='24' height='24'>
                                    <path
                                        d='M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM7.5 18c-.83 0-1.5-.67-1.5-1.5S6.67 15 7.5 15s1.5.67 1.5 1.5S8.33 18 7.5 18zm0-9C6.67 9 6 8.33 6 7.5S6.67 6 7.5 6 9 6.67 9 7.5 8.33 9 7.5 9zm4.5 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0-9c-.83 0-1.5-.67-1.5-1.5S15.67 6 16.5 6s1.5.67 1.5 1.5S17.33 9 16.5 9z'
                                        fill='currentColor'
                                    />
                                </svg>
                            </div>
                            <div className='strategy-title'>
                                <h4>AutoDiffer</h4>
                                <p>Random Digit Analysis</p>
                            </div>
                            <div className={`strategy-status ${isAutoDifferActive ? 'on' : 'off'}`}>
                                {isAutoDifferActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className='card-content'>
                            <p>Automatically analyzes random barriers and symbols for optimal digit differ trades.</p>
                            {isAutoDifferActive && currentBarrier !== null && (
                                <div className='active-info'>
                                    <span className='info-label'>Current Target:</span>
                                    <span className='info-value'>
                                        Barrier {currentBarrier} on {currentSymbol}
                                    </span>
                                </div>
                            )}
                        </div>
                        <button
                            className={`strategy-toggle ${isAutoDifferActive ? 'active' : ''}`}
                            onClick={toggleAutoDiffer}
                            disabled={isContinuousTrading}
                        >
                            {isAutoDifferActive ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>

                    <div className={`strategy-card ${isAutoOverUnderActive ? 'active' : ''}`}>
                        <div className='card-header'>
                            <div className='strategy-icon'>
                                <svg viewBox='0 0 24 24' width='24' height='24'>
                                    <path
                                        d='M21.99 4c0-1.1-.89-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z'
                                        fill='currentColor'
                                    />
                                    <circle cx='8' cy='7' r='1' fill='currentColor'/>
                                    <circle cx='12' cy='7' r='1' fill='currentColor'/>
                                    <circle cx='16' cy='7' r='1' fill='currentColor'/>
                                    <path
                                        d='M20 16v-1.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5V16c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1z'
                                        fill='currentColor'
                                        opacity='0.7'
                                    />
                                </svg>
                            </div>
                            <div className='strategy-title'>
                                <h4>Auto Over/Under</h4>
                                <p>AI Pattern Recognition</p>
                            </div>
                            <div className={`strategy-status ${isAutoOverUnderActive ? 'on' : 'off'}`}>
                                {isAutoOverUnderActive ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className='card-content'>
                            <p>Uses advanced AI to identify patterns and recommend optimal over/under positions.</p>
                            {isAutoOverUnderActive && !isAnalysisReady && (
                                <div className='analyzing-state'>
                                    <div className='spinner'></div>
                                    <span>Analyzing markets...</span>
                                </div>
                            )}
                            {isAutoOverUnderActive && isAnalysisReady && recommendation && (
                                <div className='recommendation-card'>
                                    <div className='rec-header'>
                                        <span className='rec-label'>Recommendation</span>
                                        <span className='rec-confidence'>High Confidence</span>
                                    </div>
                                    <div className='rec-details'>
                                        <div className='rec-item'>
                                            <span>Strategy:</span>
                                            <strong>{recommendation.strategy === 'over' ? 'OVER 2' : 'UNDER 7'}</strong>
                                        </div>
                                        <div className='rec-item'>
                                            <span>Symbol:</span>
                                            <strong>{recommendation.symbol}</strong>
                                        </div>
                                        <div className='rec-item'>
                                            <span>Pattern:</span>
                                            <span className='pattern-text'>{recommendation.reason}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button
                            className={`strategy-toggle ${isAutoOverUnderActive ? 'active' : ''}`}
                            onClick={toggleAutoOverUnder}
                            disabled={isContinuousTrading}
                        >
                            {isAutoOverUnderActive ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>

                    <div className={`strategy-card ${isAutoO5U4Active ? 'active' : ''}`}>
                        <div className='card-header'>
                            <div className='strategy-icon'>
                                <svg viewBox='0 0 24 24' width='24' height='24'>
                                    <path
                                        d='M6 2h12v6h-12z'
                                        fill='currentColor'
                                        opacity='0.7'
                                    />
                                    <path
                                        d='M9 10h6l3 8H6l3-8z'
                                        fill='currentColor'
                                    />
                                    <path
                                        d='M10 6v2h4V6'
                                        stroke='currentColor'
                                        strokeWidth='2'
                                        fill='none'
                                    />
                                    <text x='9' y='7' fontSize='6' fill='white' fontWeight='bold'>5</text>
                                    <text x='6' y='16' fontSize='6' fill='white' fontWeight='bold'>4</text>
                                    <path
                                        d='M14 4v4m-4-4v4'
                                        stroke='currentColor'
                                        strokeWidth='1'
                                    />
                                </svg>
                            </div>
                            <div className='strategy-title'>
                                <h4>Auto O5 U4</h4>
                                <p>Dual Digit Strategy</p>
                            </div>
                            <div className={`strategy-status ${isAutoO5U4Active ? 'on' : 'off'}`}>
                                {isAutoO5U4Active ? 'ON' : 'OFF'}
                            </div>
                        </div>
                        <div className='card-content'>
                            <p>Simultaneously trades Over 5 and Under 4 based on digit frequency analysis across all volatility indices.</p>
                            
                            {isAutoO5U4Active && (
                                <div className='o5u4-info'>
                                    {o5u4Analysis.readySymbols.length === 0 ? (
                                        <div className='analyzing-state'>
                                            <div className='spinner'></div>
                                            <span>Analyzing all markets...</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className='symbols-overview'>
                                                <div className='overview-header'>
                                                    <span>Market Analysis ({o5u4Analysis.readySymbols.length}/12 ready)</span>
                                                    <div className='header-actions'>
                                                        {o5u4Analysis.bestSymbol && (
                                                            <span className='best-symbol'>Best: {o5u4Analysis.bestSymbol}</span>
                                                        )}
                                                        <button 
                                                            className='symbols-grid-toggle'
                                                            onClick={toggleSymbolsGrid}
                                                            title={isSymbolsGridVisible ? 'Hide symbols grid' : 'Show symbols grid'}
                                                        >
                                                            <svg 
                                                                width='16' 
                                                                height='16' 
                                                                viewBox='0 0 24 24' 
                                                                fill='none'
                                                                className={`toggle-icon ${isSymbolsGridVisible ? 'expanded' : 'collapsed'}`}
                                                            >
                                                                <path 
                                                                    d='M7 10L12 15L17 10' 
                                                                    stroke='currentColor' 
                                                                    strokeWidth='2' 
                                                                    strokeLinecap='round' 
                                                                    strokeLinejoin='round'
                                                                />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className={`symbols-grid ${isSymbolsGridVisible ? '' : 'collapsed'}`}>
                                                    {availableSymbols.map(symbol => {
                                                        const analysis = o5u4Analysis.symbolsAnalysis[symbol];
                                                        const isBest = symbol === o5u4Analysis.bestSymbol;
                                                        return (
                                                            <div key={symbol} className={`symbol-status ${analysis?.ready ? 'ready' : 'loading'} ${analysis?.meetsConditions ? 'meets-conditions' : ''} ${isBest ? 'best' : ''}`}>
                                                                <div className='symbol-name'>{symbol}</div>
                                                                <div className='symbol-info'>
                                                                    {analysis?.ready ? (
                                                                        <>
                                                                            <div className='digit-info'>
                                                                                <span>Last: {analysis.lastDigit}</span>
                                                                            </div>
                                                                            <div className={`condition-indicator ${analysis.meetsConditions ? 'met' : 'not-met'}`}>
                                                                                {analysis.meetsConditions ? '✓' : '✗'}
                                                                            </div>
                                                                        </>
                                                                    ) : (
                                                                        <div className='loading-indicator'>...</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {o5u4Analysis.bestSymbol && (
                                                <div className='best-symbol-details'>
                                                    <div className='details-header'>
                                                        <span>Trading Opportunity: {o5u4Analysis.bestSymbol}</span>
                                                    </div>
                                                    <div className='details-content'>
                                                        <div className='detail-item'>
                                                            <span>Conditions:</span>
                                                            <span className='success-text'>All Met ✓</span>
                                                        </div>
                                                        <div className='detail-item'>
                                                            <span>Score:</span>
                                                            <strong>{o5u4Analysis.symbolsAnalysis[o5u4Analysis.bestSymbol]?.score?.toFixed(1) || 'N/A'}</strong>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {!o5u4Analysis.bestSymbol && o5u4Analysis.readySymbols.length > 0 && (
                                                <div className='no-opportunities'>
                                                    <span className='warning-text'>No trading opportunities found</span>
                                                    
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        <button
                            className={`strategy-toggle ${isAutoO5U4Active ? 'active' : ''}`}
                            onClick={toggleAutoO5U4}
                            disabled={isContinuousTrading}
                        >
                            {isAutoO5U4Active ? 'Deactivate' : 'Activate'}
                        </button>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className='trading-controls'>
                    <button
                        className={`main-trade-btn ${!isStrategyActive ? 'disabled' : ''} ${isContinuousTrading ? 'stop' : 'start'}`}
                        onClick={handleTrade}
                        disabled={!isStrategyActive || isTrading}
                    >
                        <div className='btn-content'>
                            <div className='btn-icon'>
                                {isContinuousTrading ? (
                                    <svg viewBox='0 0 24 24' width='20' height='20'>
                                        <rect x='6' y='4' width='4' height='16' fill='currentColor' />
                                        <rect x='14' y='4' width='4' height='16' fill='currentColor' />
                                    </svg>
                                ) : (
                                    <svg viewBox='0 0 24 24' width='20' height='20'>
                                        <polygon points='5,3 19,12 5,21' fill='currentColor' />
                                    </svg>
                                )}
                            </div>
                            <span className='btn-text'>
                                {isContinuousTrading ? 'STOP TRADING' : isTrading ? 'STARTING...' : 'START TRADING'}
                            </span>
                        </div>
                        <div className='btn-glow'></div>
                    </button>
                </div>

                {/* Stats Dashboard */}
                <div className='stats-dashboard'>
                    {(winCount > 0 || lossCount > 0) && (
                        <div className='stats-grid'>
                            <div className='stat-card wins'>
                                <div className='stat-icon'>
                                    <svg viewBox='0 0 24 24' width='20' height='20'>
                                        <path
                                            d='M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
                                            fill='currentColor'
                                        />
                                    </svg>
                                </div>
                                <div className='stat-content'>
                                    <span className='stat-value'>{winCount}</span>
                                    <span className='stat-label'>Wins</span>
                                </div>
                            </div>

                            <div className='stat-card losses'>
                                <div className='stat-icon'>
                                    <svg viewBox='0 0 24 24' width='20' height='20'>
                                        <path
                                            d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
                                            fill='currentColor'
                                        />
                                    </svg>
                                </div>
                                <div className='stat-content'>
                                    <span className='stat-value'>{lossCount}</span>
                                    <span className='stat-label'>Losses</span>
                                </div>
                            </div>

                            <div className='stat-card winrate'>
                                <div className='stat-icon'>
                                    <svg viewBox='0 0 24 24' width='20' height='20'>
                                        <path
                                            d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'
                                            fill='currentColor'
                                        />
                                    </svg>
                                </div>
                                <div className='stat-content'>
                                    <span className='stat-value'>
                                        {winCount + lossCount > 0
                                            ? Math.round((winCount / (winCount + lossCount)) * 100)
                                            : 0}
                                        %
                                    </span>
                                    <span className='stat-label'>Win Rate</span>
                                </div>
                            </div>

                            {consecutiveLosses > 0 && (
                                <div className='stat-card martingale'>
                                    <div className='stat-icon'>
                                        <svg viewBox='0 0 24 24' width='20' height='20'>
                                            <path
                                                d='M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'
                                                fill='currentColor'
                                            />
                                        </svg>
                                    </div>
                                    <div className='stat-content'>
                                        <span className='stat-value'>{consecutiveLosses}</span>
                                        <span className='stat-label'>Martingale</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {lastTradeResult && (
                        <div className={`last-trade-result ${lastTradeResult.toLowerCase()}`}>
                            <div className='result-icon'>
                                {lastTradeResult === 'WIN' ? (
                                    <svg viewBox='0 0 24 24' width='16' height='16'>
                                        <path
                                            d='M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
                                            fill='currentColor'
                                        />
                                    </svg>
                                ) : (
                                    <svg viewBox='0 0 24 24' width='16' height='16'>
                                        <path
                                            d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
                                            fill='currentColor'
                                        />
                                    </svg>
                                )}
                            </div>
                            <span>Last Trade: {lastTradeResult}</span>
                        </div>
                    )}
                </div>

                {/* AI Analysis Info */}
                {isAutoOverUnderActive && isAnalysisReady && (
                    <div className='analysis-info'>
                        <div className='analysis-header'>
                            <div className='ai-badge'>
                                <svg viewBox='0 0 24 24' width='16' height='16'>
                                    <path
                                        d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z'
                                        fill='currentColor'
                                    />
                                    <path d='M8 12l2 2 4-4' fill='white' />
                                </svg>
                                AI Analysis
                            </div>
                            <span className='analysis-time'>
                                {analysisCount} analyses • Last: {lastAnalysisTime || 'N/A'}
                            </span>
                        </div>
                        <div className='analysis-details'>
                            <div className='detail-item'>
                                <span>Most Frequent Digit:</span>
                                <strong>{recommendation?.mostFrequentDigit}</strong>
                            </div>
                            <div className='detail-item'>
                                <span>Current Last Digit:</span>
                                <strong>{recommendation?.currentLastDigit}</strong>
                            </div>
                            <div className='detail-item'>
                                <span>Total Trades:</span>
                                <strong>{tradeCount}</strong>
                                {isTradeInProgress && (
                                    <span className='trade-lock'>
                                        <div className='lock-icon'>🔒</div>
                                        Trade in progress
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TradingHubDisplay;
