import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { Button, Text } from '@deriv-com/ui';
import { localize } from '@deriv-com/translations';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import './smart-trading-display.scss';

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

    // Effect to load and initialize volatility analyzer
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
                };
                document.body.appendChild(enhancerScript);

                // Wait a bit to ensure everything is initialized
                setTimeout(() => {
                    // Send initial configuration
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

                    // Force a status check
                    window.postMessage({
                        type: 'REQUEST_STATUS'
                    }, '*');
                }, 1000); // Wait longer to ensure both scripts are loaded
            };

            script.onerror = (e) => {
                console.error('Failed to load volatility analyzer:', e);
            };

            document.body.appendChild(script);
        }

        // Listen for messages from the volatility analyzer
    }, []);

    // Effect to handle messages from the volatility analyzer
    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            // Ensure the message is from our domain and relevant
            if (event.origin !== window.location.origin) return;

            const { type, data } = event.data;

            if (type === 'ANALYSIS_DATA') {
                setAnalysisData(prevData => ({
                    ...prevData,
                    [data.strategyId]: {
                        ...prevData[data.strategyId], // Preserve existing data if any
                        ...data.analysis, // Update with new analysis data
                    }
                }));
            } else if (type === 'PRICE_UPDATE') {
                setCurrentPrice(data.price.toFixed(4)); // Assuming price is a number
            } else if (type === 'STATUS_RESPONSE') {
                console.log('Status Response:', data);
                // Handle status response if needed, e.g., check connection status
            }
        };

        window.addEventListener('message', messageHandler);

        // Cleanup the event listener when the component unmounts
        return () => {
            window.removeEventListener('message', messageHandler);
        };
    }, []); // Empty dependency array ensures this effect runs only once on mount


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
                                    const newActiveContractType = strategy.activeContractType ? null : strategy.settings.conditionAction || 'Rise';
                                    newStrategies[strategyIndex].activeContractType = newActiveContractType;
                                    setAnalysisStrategies(newStrategies);

                                    // Inform the analyzer about the trading status change
                                    window.postMessage({
                                        type: 'UPDATE_TRADING_STATUS',
                                        strategyId: strategy.id,
                                        isActive: !!newActiveContractType,
                                        contractType: newActiveContractType
                                    }, '*');
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