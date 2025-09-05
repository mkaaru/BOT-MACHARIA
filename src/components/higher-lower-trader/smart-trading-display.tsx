import React, { useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { Button, Text } from '@deriv-com/ui';
import { localize } from '@deriv-com/translations';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import '../smart-trader/smart-trader.scss';

// Extend Window interface for volatility analyzer
declare global {
    interface Window {
        volatilityAnalyzer?: {
            reconnect?: () => void;
        };
        initVolatilityAnalyzer?: () => void;
    }
}

interface TradeSettings {
    stake: number;
    ticks: number; // Duration in ticks
    martingaleMultiplier: number;

    // Optional input state properties for handling empty inputs
    stakeInput?: string;
    ticksInput?: string;
    martingaleMultiplierInput?: string;

    // Add trading condition properties
    conditionType?: string; // 'rise' or 'fall'
    conditionOperator?: string; // '>', '<', '>=', '<=', '='
    conditionValue?: number; // Percentage threshold
    conditionValueInput?: string; // For UI handling of input
    conditionAction?: string; // 'Rise' or 'Fall' contract

    // Pattern condition properties (for even-odd-2)
    patternDigitCount?: number; // How many digits to check
    patternDigitCountInput?: string; // For UI handling of input
    patternType?: string; // 'even' or 'odd'
    patternAction?: string; // 'Even' or 'Odd' contract type to buy
    // Over/Under pattern condition properties (for over-under-2)
    overUnderPatternDigitCount?: number; // How many digits to check
    overUnderPatternDigitCountInput?: string; // For UI handling of input
    overUnderPatternType?: string; // 'over' or 'under'
    overUnderPatternBarrier?: number; // Barrier value for over/under comparison
    overUnderPatternBarrierInput?: string; // For UI handling of barrier input
    overUnderPatternAction?: string; // 'Over' or 'Under' contract to buy
    overUnderPatternTradingBarrier?: number; // Independent trading barrier digit (0-9)
    overUnderPatternTradingBarrierInput?: string; // For UI handling of trading barrier input// Matches/Differs condition properties
    conditionDigit?: number; // The digit to match/differ (0-9)

    // Trading barrier properties (for over/under strategies)
    tradingBarrier?: number; // Independent trading barrier digit (0-9)
    tradingBarrierInput?: string; // For UI handling of trading barrier input
}

interface AnalysisStrategy {
    id: string;
    name: string;
    description: string;
    settings: TradeSettings;
    activeContractType: string | null; // e.g., "Rise", "Fall", or null
    currentStake?: number; // Current stake after applying martingale
    lastTradeResult?: string; // Result of the last trade (WIN/LOSS)
}

const initialAnalysisStrategies: AnalysisStrategy[] = [
    {
        id: 'rise-fall',
        name: localize('Rise/Fall'),
        description: localize('Trades based on market rise/fall predictions.'),
        settings: {
            stake: 0.5,
            ticks: 1,
            martingaleMultiplier: 1,
            conditionType: 'rise',
            conditionOperator: '>',
            conditionValue: 65,
            conditionAction: 'Rise'
        },
        activeContractType: null,
    },
    {
        id: 'even-odd',
        name: localize('Even/Odd'),
        description: localize('Trades based on the last digit being even or odd.'),
        settings: {
            stake: 0.5,
            ticks: 1,
            martingaleMultiplier: 1,
            conditionType: 'even',
            conditionOperator: '>',
            conditionValue: 60,
            conditionAction: 'Even'
        },
        activeContractType: null,
    },
    {
        id: 'even-odd-2',
        name: localize('Even/Odd'),
        description: localize('Alternative strategy for even/odd last digit trading.'),
        settings: {
            stake: 0.5,
            ticks: 1,
            martingaleMultiplier: 1,
            patternDigitCount: 3,
            patternType: 'even',
            patternAction: 'Even'
        },
        activeContractType: null,
    },
    {
        id: 'over-under',
        name: localize('Over/Under'),
        description: localize('Trades based on the last digit being over or under a predicted number.'), settings: {
            stake: 0.5,
            ticks: 1,
            martingaleMultiplier: 1,
            conditionType: 'over',
            conditionOperator: '>',
            conditionValue: 55,
            conditionAction: 'Over',
            tradingBarrier: 5
        },
        activeContractType: null,
    },
    {
        id: 'over-under-2',
        name: localize('Over/Under'),
        description: localize('Alternative approach for over/under digit trading with custom parameters.'), settings: {
            stake: 0.5,
            ticks: 1,
            martingaleMultiplier: 1,
            overUnderPatternDigitCount: 3,
            overUnderPatternType: 'over',
            overUnderPatternBarrier: 5,
            overUnderPatternAction: 'Over',
            overUnderPatternTradingBarrier: 5
        },
        activeContractType: null,
    },
    {
        id: 'matches-differs',
        name: localize('Matches/Differs'),
        description: localize('Trades based on the last digit matching or differing from a predicted number.'),
        settings: {
            stake: 0.5,
            ticks: 1,
            martingaleMultiplier: 1,
            conditionType: 'matches',
            conditionOperator: '>',

            conditionValue: 55,
            conditionDigit: 5,  // The digit to match/differ (0-9)
            conditionAction: 'Matches'
        },
        activeContractType: null,
    },
];

const SmartTradingDisplay = observer(() => {
    const { run_panel, transactions, client } = useStore();
    const { is_drawer_open } = run_panel;
    const [analysisStrategies, setAnalysisStrategies] = useState<AnalysisStrategy[]>(initialAnalysisStrategies);
    const [analysisData, setAnalysisData] = useState<Record<string, any>>({});
    const [selectedSymbol, setSelectedSymbol] = useState<string>("R_10");
    const [tickCount, setTickCount] = useState<number>(120); // Actual numeric tick count
    const [currentPrice, setCurrentPrice] = useState<string>('');
    const [barrierValue, setBarrierValue] = useState<number>(5); // Default barrier for over/under
    const [barrierInput, setBarrierInput] = useState<string>(barrierValue.toString()); // State for barrier input
    const volatilityAnalyzerLoaded = useRef<boolean>(false);

    // Add a state to track if we've sent initialization commands
    const [hasSentInitCommands, setHasSentInitCommands] = useState(false);

    // Add state for tracking tick count input value during editing
    const [tickCountInput, setTickCountInput] = useState<string>(tickCount.toString()); // UI state for tick input

    // Trading-related state variables (enhanced from TradingHub)
    const [activeContracts, setActiveContracts] = useState<Record<string, any>>({});
    const [tradeCount, setTradeCount] = useState(0);
    const [winCount, setWinCount] = useState(0);
    const [lossCount, setLossCount] = useState(0);
    const [isTradeInProgress, setIsTradeInProgress] = useState(false);
    const [sessionRunId, setSessionRunId] = useState<string>(`smartTrading_${Date.now()}`);
    const [lastTradeResult, setLastTradeResult] = useState<string>('');
    const [consecutiveLosses, setConsecutiveLosses] = useState<Record<string, number>>({});
    const [currentStakes, setCurrentStakes] = useState<Record<string, number>>({});
    const [lastConditionStates, setLastConditionStates] = useState<Record<string, boolean>>({});

    // Reference to store per-strategy state that should not trigger re-renders
    const strategyRefsMap = useRef<Record<string, any>>({});
    // Enhanced refs for trading management (from TradingHub)
    const activeContractRef = useRef<string | null>(null);
    const lastTradeTime = useRef<number>(0);
    const minimumTradeCooldown = 3000; // 3 seconds between trades for more frequent trading
    const contractUpdateInterval = useRef<NodeJS.Timeout | null>(null);
    const lastTradeRef = useRef<{ id: string | null, profit: number | null }>({ id: null, profit: null });
    const contractSettledTimeRef = useRef(0);
    const waitingForSettlementRef = useRef(false);

    // Add refs from TradingHub for robust state management
    const currentStakeRefs = useRef<Record<string, string>>({});
    const currentConsecutiveLossesRefs = useRef<Record<string, number>>({});
    const lastMartingaleActionRefs = useRef<Record<string, string>>({});
    const lastWinTimeRefs = useRef<Record<string, number>>({});

    // CRITICAL FIX: Add ref for activeContracts to avoid stale state in event handlers
    const activeContractsRef = useRef<Record<string, any>>({});

    // API and WebSocket refs
    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const contractSubscriptionRef = useRef<string | null>(null);

    // Trading data state
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [allVolatilitiesData, setAllVolatilitiesData] = useState<Record<string, Array<{ time: number, price: number, close: number }>>>({});
    const [contractStatus, setContractStatus] = useState<string>('');
    const [isApiConnected, setIsApiConnected] = useState(false);

    // Initialize Deriv API connection
    const initializeAPI = useCallback(async () => {
        try {
            const token = await getToken();
            if (!token) {
                console.error('No token available for API connection');
                return;
            }

            // Create API instance
            const api = await generateDerivApiInstance();
            apiRef.current = api;

            // Set up connection handlers
            api.onopen = () => {
                console.log('✅ Smart Trading API connection established');
                setIsApiConnected(true);
                authorizeAPI();
            };

            api.onclose = () => {
                console.log('❌ Smart Trading API connection closed');
                setIsApiConnected(false);
            };

            api.onerror = (error: any) => {
                console.error('Smart Trading API error:', error);
                setIsApiConnected(false);
            };

            // Handle incoming messages
            api.onmessage = handleAPIMessage;

        } catch (error) {
            console.error('Failed to initialize Smart Trading API:', error);
        }
    }, []);

    // Authorize API connection
    const authorizeAPI = async () => {
        try {
            const token = await getToken();
            if (!apiRef.current || !token) return;

            const authResponse = await apiRef.current.send({
                authorize: token
            });

            if (authResponse.error) {
                console.error('Authorization failed:', authResponse.error);
                return;
            }

            console.log('✅ Smart Trading API authorized');
            // Load available symbols after authorization
            await loadActiveSymbols();

        } catch (error) {
            console.error('Authorization error:', error);
        }
    };

    // Load available trading symbols
    const loadActiveSymbols = async () => {
        try {
            if (!apiRef.current) return;

            const response = await apiRef.current.send({
                active_symbols: 'brief',
                product_type: 'basic'
            });

            if (response.error) {
                console.error('Failed to load symbols:', response.error);
                return;
            }

            if (response.active_symbols) {
                const volatilitySymbols = response.active_symbols.filter((s: any) =>
                    s.symbol.startsWith('R_') && s.market === 'synthetic_index'
                );

                console.log('Loaded volatility symbols:', volatilitySymbols.length);

                // Load historical data for all volatilities
                await loadAllVolatilitiesHistoricalData(volatilitySymbols);
            }
        } catch (error) {
            console.error('Error loading active symbols:', error);
        }
    };

    // Load historical data for all volatility indices
    const loadAllVolatilitiesHistoricalData = async (volatilities: Array<{ symbol: string; display_name: string }>) => {
        if (!apiRef.current) return;

        console.log('Loading historical data for all volatilities...');

        try {
            const allData: Record<string, Array<{ time: number, price: number, close: number }>> = {};

            // Load historical data in batches to avoid overwhelming the API
            const batchSize = 3;
            for (let i = 0; i < volatilities.length; i += batchSize) {
                const batch = volatilities.slice(i, i + batchSize);

                const batchPromises = batch.map(async (vol) => {
                    try {
                        const request = {
                            ticks_history: vol.symbol,
                            adjust_start_time: 1,
                            count: 5000,
                            end: "latest",
                            start: 1,
                            style: "ticks"
                        };

                        const response = await apiRef.current.send(request);

                        if (response.error) {
                            console.error(`Historical ticks fetch error for ${vol.symbol}:`, response.error);
                            return;
                        }

                        if (response.history && response.history.prices && response.history.times) {
                            const historicalData = response.history.prices.map((price: string, index: number) => ({
                                time: response.history.times[index] * 1000,
                                price: parseFloat(price),
                                close: parseFloat(price)
                            }));

                            allData[vol.symbol] = historicalData;
                            console.log(`Loaded ${historicalData.length} historical ticks for ${vol.symbol}`);
                        }
                    } catch (error) {
                        console.error(`Error loading historical data for ${vol.symbol}:`, error);
                    }
                });

                await Promise.all(batchPromises);

                // Small delay between batches
                if (i + batchSize < volatilities.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            setAllVolatilitiesData(allData);
            console.log('All volatilities historical data loaded:', Object.keys(allData));

        } catch (error) {
            console.error('Error loading all volatilities historical data:', error);
        }
    };

    // Handle API messages
    const handleAPIMessage = (event: any) => {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        if (data.error) {
            console.error('API Error:', data.error);
            return;
        }

        // Handle tick stream
        if (data.tick && selectedSymbol && data.tick.symbol === selectedSymbol) {
            const newTick = {
                time: data.tick.epoch * 1000,
                price: parseFloat(data.tick.quote),
                close: parseFloat(data.tick.quote)
            };

            setTickData(prev => {
                const updated = [...prev, newTick].slice(-2000); // Keep last 2000 ticks
                return updated;
            });

            setCurrentPrice(data.tick.quote);
        }

        // Handle contract updates
        if (data.proposal_open_contract) {
            handleContractUpdate(data.proposal_open_contract);
        }

        // Handle buy response
        if (data.buy) {
            console.log('Contract purchased:', data.buy);
            subscribeToContract(data.buy.contract_id);
        }
    };

    // Subscribe to contract updates
    const subscribeToContract = async (contractId: string) => {
        if (!apiRef.current) return;

        try {
            const response = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            });

            if (response.error) {
                console.error('Contract subscription error:', response.error);
                return;
            }

            contractSubscriptionRef.current = contractId;
            console.log('Subscribed to contract:', contractId);

        } catch (error) {
            console.error('Error subscribing to contract:', error);
        }
    };

    // Handle contract updates
    const handleContractUpdate = (contract: any) => {
        setContractStatus(contract.status || '');

        if (contract.status === 'won' || contract.status === 'lost') {
            console.log(`Contract ${contract.status}:`, contract);

            // Update strategy based on outcome
            updateStrategyAfterTrade(contract);

            // Unsubscribe from this contract
            if (contractSubscriptionRef.current) {
                apiRef.current?.send({
                    forget: contractSubscriptionRef.current
                });
                contractSubscriptionRef.current = null;
            }
        }
    };

    // Update strategy settings after trade outcome
    const updateStrategyAfterTrade = (contract: any) => {
        const isWin = contract.status === 'won';

        setAnalysisStrategies(prevStrategies =>
            prevStrategies.map(strategy => {
                if (strategy.activeContractType) {
                    const updatedStrategy = { ...strategy };

                    // Update last trade result
                    updatedStrategy.lastTradeResult = contract.status.toUpperCase();

                    // Apply martingale logic
                    if (isWin) {
                        // Reset stake on win
                        updatedStrategy.currentStake = updatedStrategy.settings.stake;
                        setConsecutiveLosses(prev => ({ ...prev, [strategy.id]: 0 }));
                    } else {
                        // Increase stake on loss
                        const currentLosses = consecutiveLosses[strategy.id] || 0;
                        const newLossCount = currentLosses + 1;
                        setConsecutiveLosses(prev => ({ ...prev, [strategy.id]: newLossCount }));

                        const newStake = updatedStrategy.settings.stake *
                            Math.pow(updatedStrategy.settings.martingaleMultiplier, newLossCount);
                        updatedStrategy.currentStake = newStake;
                    }

                    // Reset active contract type
                    updatedStrategy.activeContractType = null;

                    return updatedStrategy;
                }
                return strategy;
            })
        );
    };

    // Execute trade for a strategy
    const executeTrade = async (strategy: AnalysisStrategy, contractType: string) => {
        if (!apiRef.current || !isApiConnected) {
            console.error('API not connected');
            return;
        }

        const effectiveStake = strategy.currentStake || strategy.settings.stake;

        // Build trade parameters
        const tradeParams: any = {
            amount: effectiveStake,
            basis: 'stake',
            contract_type: contractType,
            currency: 'USD', // Should come from account settings
            duration: strategy.settings.ticks,
            duration_unit: 't',
            symbol: selectedSymbol,
        };

        // Add specific parameters based on contract type
        if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType)) {
            // Add barrier/prediction for digit contracts
            if (strategy.settings.tradingBarrier !== undefined) {
                tradeParams.barrier = strategy.settings.tradingBarrier;
            } else if (strategy.settings.conditionDigit !== undefined) {
                tradeParams.barrier = strategy.settings.conditionDigit; // For matches/differs
            }
        }

        try {
            console.log('Executing trade:', tradeParams);

            const buyRequest = {
                buy: '1',
                price: effectiveStake,
                parameters: tradeParams
            };

            const response = await apiRef.current.send(buyRequest);

            if (response.error) {
                console.error('Trade execution failed:', response.error);
                return;
            }

            // Update strategy state
            setAnalysisStrategies(prevStrategies =>
                prevStrategies.map(s =>
                    s.id === strategy.id
                        ? { ...s, activeContractType: contractType }
                        : s
                )
            );

            console.log('Trade executed successfully:', response.buy);

        } catch (error) {
            console.error('Error executing trade:', error);
        }
    };

    // Get token from client store
    const getToken = async () => {
        try {
            // Try to get token from client store
            const token = client?.loginid ? await doUntilDone(() => {
                // Ensure api_base.api is initialized before use
                if (api_base.api) {
                    return api_base.api.send({ authorize: client.token });
                }
                return Promise.reject(new Error("API not initialized"));
            }).then(() => client.token) : null;

            return token;
        } catch (error) {
            console.error('Error getting token:', error);
            return null;
        }
    };

    // Initialize API on component mount
    useEffect(() => {
        initializeAPI();

        return () => {
            // Cleanup on unmount
            if (apiRef.current) {
                apiRef.current.disconnect?.();
            }
        };
    }, [initializeAPI]);

    // Effect to handle message listening from analyzer
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (!event.data || typeof event.data !== 'object') return;

            // Check origin before processing message
            if (event.origin !== window.location.origin) {
                console.warn("Ignoring message from different origin:", event.origin);
                return;
            }

            const { type, strategyId, data } = event.data;

            switch (type) {
                case 'ANALYSIS_DATA':
                    if (data && strategyId) {
                        console.log(`Received analysis for ${strategyId}:`, data);
                        setAnalysisData(prev => ({
                            ...prev,
                            [strategyId]: {
                                ...data,
                                timestamp: Date.now()
                            }
                        }));

                        // Auto-execute trades if conditions are met
                        if (data.recommendation && isApiConnected) {
                            const strategy = analysisStrategies.find(s => s.id === strategyId);
                            if (strategy && !strategy.activeContractType) {
                                // Map recommendation to contract type
                                const contractType = mapRecommendationToContractType(data.recommendation);
                                if (contractType) {
                                    // Check if already trading to prevent multiple trades
                                    if (!strategy.activeContractType) {
                                        executeTrade(strategy, contractType);
                                    }
                                }
                            }
                        }
                    }
                    break;

                case 'PRICE_UPDATE':
                    if (data?.price) {
                        setCurrentPrice(data.price);
                    }
                    break;

                case 'ANALYZER_CONNECTION_STATUS':
                    console.log('Analyzer connection status:', data.status);
                    break;

                default:
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [analysisStrategies, isApiConnected]); // Dependencies updated

    // Map analysis recommendation to contract type
    const mapRecommendationToContractType = (recommendation: string): string | null => {
        const mapping: Record<string, string> = {
            'Rise': 'CALL',
            'Fall': 'PUT',
            'Even': 'DIGITEVEN',
            'Odd': 'DIGITODD',
            'Over': 'DIGITOVER',
            'Under': 'DIGITUNDER',
            'Matches': 'DIGITMATCH',
            'Differs': 'DIGITDIFF'
        };

        return mapping[recommendation] || null;
    };

    // Effect to load and initialize volatility analyzer (original effect)
    useEffect(() => {
        if (!volatilityAnalyzerLoaded.current) {
            const script = document.createElement('script');
            // Add cache-busting parameter to prevent loading cached version
            script.src = `/ai/volatility-analyzer.js?v=${Date.now()}`;
            script.async = true;
            script.onload = () => {
                volatilityAnalyzerLoaded.current = true;
                console.log('Volatility analyzer loaded');

                // Explicitly initialize the analyzer
                if (typeof window.initVolatilityAnalyzer === 'function') {
                    try {
                        window.initVolatilityAnalyzer();
                        console.log('Volatility analyzer initialized');
                    } catch (e) {
                        console.error('Error initializing volatility analyzer:', e);
                    }
                }

                // Load the enhancer script after the main analyzer is loaded
                const enhancerScript = document.createElement('script');
                enhancerScript.src = `/ai/analyzer-enhancer.js?v=${Date.now()}`;
                enhancerScript.async = true;
                enhancerScript.onload = () => {
                    console.log('Analyzer enhancer loaded');

                    // Send initial configuration immediately after enhancer loads
                    setTimeout(() => {
                        console.log('Sending initial configuration');
                        window.postMessage({
                            type: 'UPDATE_SYMBOL',
                            symbol: selectedSymbol
                        }, '*');
                        window.postMessage({
                            type: 'UPDATE_TICK_COUNT',
                            tickCount: tickCount
                        }, '*');
                        window.postMessage({
                            type: 'UPDATE_BARRIER',
                            barrier: barrierValue
                        }, '*');
                        setHasSentInitCommands(true);

                        // Request immediate analysis
                        window.postMessage({
                            type: 'REQUEST_ANALYSIS'
                        }, '*');
                    }, 500);

                    // Set up a connection timeout
                    setTimeout(() => {
                        if (Object.keys(analysisData).length === 0) {
                            console.log('No data received, attempting reconnection...');
                            if (window.volatilityAnalyzer?.reconnect) {
                                window.volatilityAnalyzer.reconnect();
                            }
                        }
                    }, 10000); // 10 second timeout
                };
                document.body.appendChild(enhancerScript);
            };

            script.onerror = (e) => {
                console.error('Failed to load volatility analyzer:', e);
            };

            document.body.appendChild(script);
        }
    }, [analysisData, selectedSymbol, tickCount, barrierValue]); // Added dependencies

    return (
        <div className="smart-trading-display">
            <div className="smart-trading-header">
                <h2>Smart Trading</h2>
                <p className="derivs-text">AI-powered trading strategies</p>
                <div className="controls-container">
                    <div className="control-item">
                        <label>Symbol</label>
                        <select value={selectedSymbol} onChange={(e) => {
                            setSelectedSymbol(e.target.value);
                            window.postMessage({
                                type: 'UPDATE_SYMBOL',
                                symbol: e.target.value
                            }, '*');
                        }}>
                            <option value="R_10">Volatility 10 Index</option>
                            <option value="R_25">Volatility 25 Index</option>
                            <option value="R_50">Volatility 50 Index</option>
                            <option value="R_75">Volatility 75 Index</option>
                            <option value="R_100">Volatility 100 Index</option>
                        </select>
                    </div>
                    <div className="control-item">
                        <label>Ticks</label>
                        <input
                            type="number"
                            value={tickCountInput}
                            onChange={(e) => {
                                setTickCountInput(e.target.value);
                                const newTickCount = parseInt(e.target.value, 10);
                                if (!isNaN(newTickCount)) {
                                    setTickCount(newTickCount);
                                    window.postMessage({
                                        type: 'UPDATE_TICK_COUNT',
                                        tickCount: newTickCount
                                    }, '*');
                                }
                            }}
                        />
                    </div>
                    <div className="price-display">
                        <span>Price: <strong>{currentPrice || '0.00'}</strong></span>
                        <div className="update-indicator"></div>
                    </div>
                </div>
            </div>
            <div className="smart-trading-strategies">
                {analysisStrategies.map(strategy => (
                    <div key={strategy.id} className={`strategy-card ${strategy.activeContractType ? 'trading' : ''}`}>
                        <div className="strategy-card__header">
                            <h4 className="strategy-card__name">{strategy.name}</h4>
                        </div>
                        <div className="strategy-card__analysis-content">
                            {analysisData[strategy.id] ? (
                                <div>
                                    {analysisData[strategy.id].recommendation && (
                                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#2c5aa0', marginBottom: '8px' }}>
                                            📈 {analysisData[strategy.id].recommendation}
                                        </div>
                                    )}
                                    {analysisData[strategy.id].confidence && (
                                        <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                                            Confidence: {analysisData[strategy.id].confidence}%
                                        </div>
                                    )}

                                    {/* Strategy-specific data displays */}
                                    {strategy.id === 'rise-fall' && analysisData[strategy.id].riseRatio && (
                                        <div style={{ fontSize: '13px' }}>
                                            <div>📊 Rise: {analysisData[strategy.id].riseRatio}% | Fall: {analysisData[strategy.id].fallRatio}%</div>
                                            {analysisData[strategy.id].pattern && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                    Recent: {analysisData[strategy.id].pattern}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {strategy.id === 'even-odd' && analysisData[strategy.id].evenProbability && (
                                        <div style={{ fontSize: '13px' }}>
                                            <div>📊 Even: {analysisData[strategy.id].evenProbability}% | Odd: {analysisData[strategy.id].oddProbability}%</div>
                                            {analysisData[strategy.id].pattern && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                    Pattern: {analysisData[strategy.id].pattern}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {strategy.id === 'even-odd-2' && analysisData[strategy.id].evenOddPattern && (
                                        <div style={{ fontSize: '13px' }}>
                                            <div>📊 Even: {analysisData[strategy.id].evenProbability}% | Odd: {analysisData[strategy.id].oddProbability}%</div>
                                            <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                Pattern: {analysisData[strategy.id].evenOddPattern.slice(-5).join('')}
                                            </div>
                                            {analysisData[strategy.id].streak > 1 && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: '#e67e22' }}>
                                                    🔥 Streak: {analysisData[strategy.id].streak} {analysisData[strategy.id].streakType}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {strategy.id === 'over-under' && analysisData[strategy.id].overProbability && (
                                        <div style={{ fontSize: '13px' }}>
                                            <div>📊 Over: {analysisData[strategy.id].overProbability}% | Under: {analysisData[strategy.id].underProbability}%</div>
                                            <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                Barrier: {analysisData[strategy.id].barrier}
                                            </div>
                                            {analysisData[strategy.id].pattern && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                    Recent: {analysisData[strategy.id].pattern}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {strategy.id === 'over-under-2' && analysisData[strategy.id].overUnderPattern && (
                                        <div style={{ fontSize: '13px' }}>
                                            <div>📊 Over: {analysisData[strategy.id].overProbability}% | Under: {analysisData[strategy.id].underProbability}%</div>
                                            <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                Pattern: {analysisData[strategy.id].overUnderPattern.slice(-5).join('')} | Barrier: {analysisData[strategy.id].barrier}
                                            </div>
                                        </div>
                                    )}

                                    {strategy.id === 'matches-differs' && analysisData[strategy.id].matchProbability && (
                                        <div style={{ fontSize: '13px' }}>
                                            <div>📊 Matches: {analysisData[strategy.id].matchProbability}% | Differs: {analysisData[strategy.id].differProbability}%</div>
                                            <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                Target: {analysisData[strategy.id].targetDigit}
                                            </div>
                                            {analysisData[strategy.id].pattern && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                                                    Recent: {analysisData[strategy.id].pattern}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
                                    <div style={{ fontSize: '14px', marginBottom: '8px' }}>📊 Loading analysis...</div>
                                    <div style={{ fontSize: '12px' }}>Connecting to market data</div>
                                </div>
                            )}
                        </div>
                        <div className="strategy-card__settings">
                            <div className="control-item">
                                <label>Stake</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={strategy.settings.stake}
                                    onChange={(e) => {
                                        const newStrategies = [...analysisStrategies];
                                        const strategyIndex = newStrategies.findIndex(s => s.id === strategy.id);
                                        newStrategies[strategyIndex].settings.stake = parseFloat(e.target.value) || 0;
                                        setAnalysisStrategies(newStrategies);
                                    }}
                                />
                            </div>
                            <div className="control-item">
                                <label>Ticks</label>
                                <input
                                    type="number"
                                    value={strategy.settings.ticks}
                                    onChange={(e) => {
                                        const newStrategies = [...analysisStrategies];
                                        const strategyIndex = newStrategies.findIndex(s => s.id === strategy.id);
                                        newStrategies[strategyIndex].settings.ticks = parseInt(e.target.value) || 1;
                                        setAnalysisStrategies(newStrategies);
                                    }}
                                />
                            </div>
                            <div className="control-item">
                                <label>Martingale</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={strategy.settings.martingaleMultiplier}
                                    onChange={(e) => {
                                        const newStrategies = [...analysisStrategies];
                                        const strategyIndex = newStrategies.findIndex(s => s.id === strategy.id);
                                        newStrategies[strategyIndex].settings.martingaleMultiplier = parseFloat(e.target.value) || 1;
                                        setAnalysisStrategies(newStrategies);
                                    }}
                                />
                            </div>
                            {/* Add barrier input for relevant strategies */}
                            {(strategy.id === 'over-under' || strategy.id === 'over-under-2' || strategy.id === 'matches-differs') && (
                                <div className="control-item">
                                    <label>{strategy.id === 'matches-differs' ? 'Target Digit' : 'Barrier'}</label>
                                    <input
                                        type="number"
                                        value={strategy.settings.tradingBarrier !== undefined ? strategy.settings.tradingBarrier : strategy.settings.conditionDigit ?? ''}
                                        onChange={(e) => {
                                            const newStrategies = [...analysisStrategies];
                                            const strategyIndex = newStrategies.findIndex(s => s.id === strategy.id);
                                            const barrierValue = parseInt(e.target.value, 10);
                                            if (!isNaN(barrierValue)) {
                                                if (strategy.id === 'matches-differs') {
                                                    newStrategies[strategyIndex].settings.conditionDigit = barrierValue;
                                                } else {
                                                    newStrategies[strategyIndex].settings.tradingBarrier = barrierValue;
                                                }
                                                setAnalysisStrategies(newStrategies);
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="strategy-card__actions">
                            <Button
                                className="strategy-card__trade-button strategy-card__trade-button--single"
                                variant={strategy.activeContractType ? "danger" : "contained"}
                                size="sm"
                                color={strategy.activeContractType ? "white" : "primary"}
                                onClick={() => {
                                    // Toggle trading for this strategy
                                    const newStrategies = [...analysisStrategies];
                                    const strategyIndex = newStrategies.findIndex(s => s.id === strategy.id);

                                    let newActiveContractType: string | null = null;
                                    let actionToPerform: 'executeTrade' | 'stopAutoTrading' | null = null;

                                    if (!strategy.activeContractType) {
                                        // Determine contract type from strategy settings or analysis data
                                        const determinedContractType = strategy.settings.conditionAction ||
                                                                       (analysisData[strategy.id]?.recommendation ? mapRecommendationToContractType(analysisData[strategy.id].recommendation) : null);

                                        if (determinedContractType) {
                                            newActiveContractType = determinedContractType;
                                            actionToPerform = 'executeTrade';
                                        } else {
                                            console.warn(`Could not determine contract type for ${strategy.name}. Please check settings or analysis data.`);
                                        }
                                    }

                                    newStrategies[strategyIndex].activeContractType = newActiveContractType;
                                    setAnalysisStrategies(newStrategies);

                                    // Inform the analyzer about the trading status change
                                    window.postMessage({
                                        type: 'UPDATE_TRADING_STATUS',
                                        strategyId: strategy.id,
                                        isActive: !!newActiveContractType,
                                        contractType: newActiveContractType
                                    }, '*');

                                    // If starting auto trading and we have a contract type, execute the first trade
                                    if (actionToPerform === 'executeTrade' && newActiveContractType) {
                                        executeTrade(strategy, newActiveContractType);
                                    }
                                }}
                            >
                                {strategy.activeContractType ? 'Stop Auto Trading' : 'Start Auto Trading'}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default SmartTradingDisplay;