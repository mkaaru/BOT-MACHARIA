
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

interface TradeSettings {
    stake: number;
    ticks: number;
    martingaleMultiplier: number;
    stakeInput?: string;
    ticksInput?: string;
    martingaleMultiplierInput?: string;
    conditionType?: string;
    conditionOperator?: string;
    conditionValue?: number;
    conditionValueInput?: string;
    conditionAction?: string;
    patternDigitCount?: number;
    patternDigitCountInput?: string;
    patternType?: string;
    patternAction?: string;
    overUnderPatternDigitCount?: number;
    overUnderPatternDigitCountInput?: string;
    overUnderPatternType?: string;
    overUnderPatternBarrier?: number;
    overUnderPatternBarrierInput?: string;
    overUnderPatternAction?: string;
    overUnderPatternTradingBarrier?: number;
    overUnderPatternTradingBarrierInput?: string;
    conditionDigit?: number;
    tradingBarrier?: number;
    tradingBarrierInput?: string;
}

interface AnalysisStrategy {
    id: string;
    name: string;
    description: string;
    settings: TradeSettings;
    activeContractType: string | null;
    currentStake?: number;
    lastTradeResult?: string;
    analysisData?: {
        successRate: number;
        recommendation: string;
        confidence: number;
        lastAnalysis: Date;
    };
}

interface TickData {
    tick: number;
    epoch: number;
    quote: number;
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
        description: localize('Trades based on the last digit being over or under a predicted number.'),
        settings: {
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
        description: localize('Alternative approach for over/under digit trading with custom parameters.'),
        settings: {
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
            conditionDigit: 5,
            conditionAction: 'Matches'
        },
        activeContractType: null,
    },
];

const SmartTradingDisplay = observer(() => {
    const { run_panel, transactions, client } = useStore();
    const { is_drawer_open } = run_panel;
    const [analysisStrategies, setAnalysisStrategies] = useState<AnalysisStrategy[]>(initialAnalysisStrategies);
    const [selectedSymbol, setSelectedSymbol] = useState<string>("R_10");
    const [tickCount, setTickCount] = useState<number>(120);
    const [currentPrice, setCurrentPrice] = useState<string>('');
    const [barrierValue, setBarrierValue] = useState<number>(5);
    const [barrierInput, setBarrierInput] = useState<string>(barrierValue.toString());
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [tickData, setTickData] = useState<TickData[]>([]);
    const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());

    const tickCountInput = useState<string>(tickCount.toString());

    // Trading-related state variables
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

    // Refs for trading management
    const activeContractRef = useRef<string | null>(null);
    const lastTradeTime = useRef<number>(0);
    const minimumTradeCooldown = 3000;
    const contractUpdateInterval = useRef<NodeJS.Timeout | null>(null);
    const lastTradeRef = useRef<{ id: string | null, profit: number | null }>({ id: null, profit: null });
    const contractSettledTimeRef = useRef(0);
    const waitingForSettlementRef = useRef(false);

    const currentStakeRefs = useRef<Record<string, string>>({});
    const currentConsecutiveLossesRefs = useRef<Record<string, number>>({});
    const lastMartingaleActionRefs = useRef<Record<string, string>>({});
    const lastWinTimeRefs = useRef<Record<string, number>>({});

    const activeContractsRef = useRef<Record<string, any>>({});

    // Initialize tick data subscription
    useEffect(() => {
        const subscribeToTicks = async () => {
            try {
                if (api_base.api) {
                    // Subscribe to tick stream for selected symbol
                    const ticksRequest = {
                        ticks: selectedSymbol,
                        subscribe: 1
                    };

                    const response = await api_base.api.send(ticksRequest);
                    if (response.tick) {
                        const newTick: TickData = {
                            tick: response.tick.id,
                            epoch: response.tick.epoch,
                            quote: response.tick.quote
                        };
                        
                        setCurrentPrice(response.tick.quote.toFixed(response.tick.pip ? response.tick.pip : 5));
                        
                        setTickData(prevData => {
                            const newData = [...prevData, newTick];
                            // Keep only last 1000 ticks for performance
                            return newData.slice(-1000);
                        });
                    }

                    // Listen for subsequent tick updates
                    api_base.api.onMessage()?.subscribe(({ data }: any) => {
                        if (data.tick && data.tick.symbol === selectedSymbol) {
                            const newTick: TickData = {
                                tick: data.tick.id,
                                epoch: data.tick.epoch,
                                quote: data.tick.quote
                            };
                            
                            setCurrentPrice(data.tick.quote.toFixed(data.tick.pip ? data.tick.pip : 5));
                            
                            setTickData(prevData => {
                                const newData = [...prevData, newTick];
                                return newData.slice(-1000);
                            });
                        }
                    });
                }
            } catch (error) {
                console.error('Error subscribing to ticks:', error);
            }
        };

        subscribeToTicks();

        return () => {
            // Cleanup subscription
            if (api_base.api) {
                api_base.api.send({ forget_all: 'ticks' }).catch(console.error);
            }
        };
    }, [selectedSymbol]);

    // Analyze tick data and update strategies
    useEffect(() => {
        if (tickData.length >= 10) {
            analyzeTickData();
        }
    }, [tickData]);

    const analyzeTickData = () => {
        if (tickData.length < 10) return;

        setIsAnalyzing(true);
        
        const recentTicks = tickData.slice(-100); // Analyze last 100 ticks
        
        setAnalysisStrategies(prevStrategies => 
            prevStrategies.map(strategy => {
                const analysisData = performStrategyAnalysis(strategy, recentTicks);
                return {
                    ...strategy,
                    analysisData: {
                        ...analysisData,
                        lastAnalysis: new Date()
                    }
                };
            })
        );

        setLastUpdateTime(new Date());
        setIsAnalyzing(false);
    };

    const performStrategyAnalysis = (strategy: AnalysisStrategy, ticks: TickData[]) => {
        let successfulPredictions = 0;
        let totalPredictions = 0;
        let recommendation = 'Hold';
        let confidence = 0;

        switch (strategy.id) {
            case 'rise-fall':
                // Analyze price movements
                for (let i = 1; i < ticks.length; i++) {
                    const currentPrice = ticks[i].quote;
                    const previousPrice = ticks[i - 1].quote;
                    const actualDirection = currentPrice > previousPrice ? 'rise' : 'fall';
                    
                    // Simple trend analysis
                    const trend = analyzeTrend(ticks.slice(Math.max(0, i - 5), i));
                    const predictedDirection = trend > 0 ? 'rise' : 'fall';
                    
                    if (actualDirection === predictedDirection) {
                        successfulPredictions++;
                    }
                    totalPredictions++;
                }
                break;

            case 'even-odd':
            case 'even-odd-2':
                // Analyze last digit patterns
                const lastDigits = ticks.map(tick => Math.floor((tick.quote * 100000) % 10));
                const evenCount = lastDigits.filter(digit => digit % 2 === 0).length;
                const oddCount = lastDigits.length - evenCount;
                
                successfulPredictions = Math.max(evenCount, oddCount);
                totalPredictions = lastDigits.length;
                recommendation = evenCount > oddCount ? 'Even' : 'Odd';
                break;

            case 'over-under':
            case 'over-under-2':
                // Analyze over/under barrier patterns
                const barrier = strategy.settings.tradingBarrier || 5;
                const digits = ticks.map(tick => Math.floor((tick.quote * 100000) % 10));
                const overCount = digits.filter(digit => digit > barrier).length;
                const underCount = digits.filter(digit => digit < barrier).length;
                
                successfulPredictions = Math.max(overCount, underCount);
                totalPredictions = digits.length;
                recommendation = overCount > underCount ? 'Over' : 'Under';
                break;

            case 'matches-differs':
                // Analyze matches/differs patterns
                const targetDigit = strategy.settings.conditionDigit || 5;
                const matchDigits = ticks.map(tick => Math.floor((tick.quote * 100000) % 10));
                const matchCount = matchDigits.filter(digit => digit === targetDigit).length;
                const differCount = matchDigits.length - matchCount;
                
                successfulPredictions = Math.max(matchCount, differCount);
                totalPredictions = matchDigits.length;
                recommendation = matchCount > differCount ? 'Matches' : 'Differs';
                break;
        }

        const successRate = totalPredictions > 0 ? (successfulPredictions / totalPredictions) * 100 : 0;
        confidence = Math.min(95, Math.max(50, successRate));

        return {
            successRate: Math.round(successRate * 100) / 100,
            recommendation,
            confidence: Math.round(confidence)
        };
    };

    const analyzeTrend = (ticks: TickData[]): number => {
        if (ticks.length < 2) return 0;
        
        let upCount = 0;
        let downCount = 0;
        
        for (let i = 1; i < ticks.length; i++) {
            if (ticks[i].quote > ticks[i - 1].quote) {
                upCount++;
            } else if (ticks[i].quote < ticks[i - 1].quote) {
                downCount++;
            }
        }
        
        return upCount - downCount;
    };

    const handleStartTrading = async (strategyId: string) => {
        const strategy = analysisStrategies.find(s => s.id === strategyId);
        if (!strategy || !strategy.analysisData) return;

        setIsTradeInProgress(true);
        
        try {
            // Implement trading logic based on strategy
            console.log(`Starting trading for strategy: ${strategy.name}`);
            console.log(`Recommendation: ${strategy.analysisData.recommendation}`);
            console.log(`Confidence: ${strategy.analysisData.confidence}%`);
            
            // Here you would implement the actual trading logic
            // This is a placeholder for the trading implementation
            
        } catch (error) {
            console.error('Error starting trading:', error);
        } finally {
            setIsTradeInProgress(false);
        }
    };

    return (
        <div className="smart-trading-display">
            <div className="smart-trading-header">
                <h2>Smart Trading</h2>
                <p className="derivs-text">AI-powered trading strategies</p>
                <div className="controls-container">
                    <div className="control-group">
                        <label>Symbol:</label>
                        <select 
                            value={selectedSymbol} 
                            onChange={(e) => setSelectedSymbol(e.target.value)}
                            className="control-select"
                        >
                            <option value="R_10">Volatility 10 (1s) Index</option>
                            <option value="R_25">Volatility 25 (1s) Index</option>
                            <option value="R_50">Volatility 50 (1s) Index</option>
                            <option value="R_75">Volatility 75 (1s) Index</option>
                            <option value="R_100">Volatility 100 (1s) Index</option>
                        </select>
                    </div>
                    <div className="control-group">
                        <label>Current Price:</label>
                        <span className="price-display">{currentPrice || 'Loading...'}</span>
                    </div>
                    <div className="control-group">
                        <label>Data Points:</label>
                        <span className="data-count">{tickData.length}</span>
                    </div>
                    <div className="control-group">
                        <label>Last Update:</label>
                        <span className="last-update">{lastUpdateTime.toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>

            <div className="strategies-grid">
                {analysisStrategies.map((strategy, index) => (
                    <div key={strategy.id} className="strategy-card">
                        <div className="strategy-header">
                            <h3>{strategy.name}</h3>
                            <p>{strategy.description}</p>
                        </div>
                        
                        <div className="strategy-analysis">
                            {strategy.analysisData && !isAnalyzing ? (
                                <>
                                    <div className="analysis-metrics">
                                        <div className="metric">
                                            <label>Success Rate:</label>
                                            <span className={`value ${strategy.analysisData.successRate >= 60 ? 'good' : strategy.analysisData.successRate >= 50 ? 'neutral' : 'poor'}`}>
                                                {strategy.analysisData.successRate.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="metric">
                                            <label>Recommendation:</label>
                                            <span className="value recommendation">{strategy.analysisData.recommendation}</span>
                                        </div>
                                        <div className="metric">
                                            <label>Confidence:</label>
                                            <span className={`value ${strategy.analysisData.confidence >= 70 ? 'good' : strategy.analysisData.confidence >= 60 ? 'neutral' : 'poor'}`}>
                                                {strategy.analysisData.confidence}%
                                            </span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="analysis-loading">
                                    {isAnalyzing ? (
                                        <div className="loading-text">
                                            <div className="loading-spinner"></div>
                                            Analyzing market data...
                                        </div>
                                    ) : (
                                        <div className="no-data">
                                            {tickData.length < 10 ? 
                                                `Collecting data... (${tickData.length}/10)` : 
                                                'Initializing analysis...'
                                            }
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="strategy-settings">
                            <div className="settings-row">
                                <div className="setting">
                                    <label>Stake:</label>
                                    <span>${strategy.settings.stake}</span>
                                </div>
                                <div className="setting">
                                    <label>Ticks:</label>
                                    <span>{strategy.settings.ticks}</span>
                                </div>
                                <div className="setting">
                                    <label>Martingale:</label>
                                    <span>{strategy.settings.martingaleMultiplier}x</span>
                                </div>
                            </div>
                        </div>

                        <div className="strategy-actions">
                            <Button
                                className={classNames('start-trading-btn', {
                                    'btn-disabled': !strategy.analysisData || isTradeInProgress
                                })}
                                onClick={() => handleStartTrading(strategy.id)}
                                disabled={!strategy.analysisData || isTradeInProgress}
                            >
                                {isTradeInProgress ? 'Trading...' : 'Start Auto Trading'}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default SmartTradingDisplay;
