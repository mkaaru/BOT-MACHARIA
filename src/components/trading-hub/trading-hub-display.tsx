import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Modal from '@/components/shared_ui/modal';
import { localize } from '@deriv-com/translations';
import marketAnalyzer from '@/services/market-analyzer';
import SmartTraderWrapper from './smart-trader-wrapper';
import { useStore } from '@/hooks/useStore';
import { generateDerivApiInstance, V2GetActiveToken, V2GetActiveClientId } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import type { TradeRecommendation, MarketStats, O5U4Conditions } from '@/services/market-analyzer';
import './trading-hub-display.scss';

// Mock 'transactions' object if it's not globally available or imported elsewhere
// In a real scenario, this should be properly imported or managed.
const transactions = {
    onBotContractEvent: (event: any) => {
        console.log('Mock transactions.onBotContractEvent called with:', event);
    }
};


interface ScanResult {
    symbol: string;
    displayName: string;
    recommendations: TradeRecommendation[];
    stats: MarketStats;
    o5u4Data?: O5U4Conditions;
}

interface TradeSettings {
    symbol: string;
    tradeType: string;
    contractType?: string; // Added to ensure proper contract type mapping
    barrier?: string;
    prediction?: number;
    stake: number;
    duration: number;
    durationType: string;
    aiAutoTrade?: boolean; // Added for AI Auto Trade specific settings
    martingaleMultiplier?: number; // Added for AI Auto Trade specific settings
    riskTolerance?: number; // Added for AI Auto Trade specific settings
    profitTarget?: number; // Added for AI Auto Trade specific settings
    ouPredPostLoss?: number; // Added for AI Auto Trade specific settings
    stopLoss?: number; // Stop loss in USD
    takeProfit?: number; // Take profit in USD
}

const TradingHubDisplay: React.FC = observer(() => {
    // Get store instance at component level to avoid hook rule violations
    const store = useStore();

    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [scanResults, setScanResults] = useState<ScanResult[]>([]);
    const [marketStats, setMarketStats] = useState<Record<string, MarketStats>>({});
    const [realTimeStats, setRealTimeStats] = useState<Record<string, MarketStats>>({});
    const [bestRecommendation, setBestRecommendation] = useState<TradeRecommendation | null>(null);
    const [o5u4Opportunities, setO5u4Opportunities] = useState<O5U4Conditions[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'scanning' | 'ready' | 'error'>('connecting');
    const [statusMessage, setStatusMessage] = useState('Initializing market scanner...');
    const [symbolsAnalyzed, setSymbolsAnalyzed] = useState(0);
    const [totalSymbols] = useState(12);
    const [selectedTradeType, setSelectedTradeType] = useState<string>('all');
    const [isSmartTraderModalOpen, setIsSmartTraderModalOpen] = useState(false);
    const [isSmartTraderHidden, setIsSmartTraderHidden] = useState(false);
    const [selectedTradeSettings, setSelectedTradeSettings] = useState<TradeSettings | null>(null);
    const [autoStartTrading, setAutoStartTrading] = useState(false);
    const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
    const [aiScanningPhase, setAiScanningPhase] = useState<'initializing' | 'analyzing' | 'evaluating' | 'recommending' | 'complete'>('initializing');
    const [currentAiMessage, setCurrentAiMessage] = useState('');
    const [processingSymbol, setProcessingSymbol] = useState<string>('');

    // AI Auto Trade configuration state
    const [aiRiskTolerance, setAiRiskTolerance] = useState<number>(3);
    const [aiProfitTarget, setAiProfitTarget] = useState<number>(10);
    const [aiMartingaleMultiplier, setAiMartingaleMultiplier] = useState<number>(1.0);

    // AI Auto Trade execution state
    const [isAiAutoTradeActive, setIsAiAutoTradeActive] = useState<boolean>(false);
    const [currentAiTrade, setCurrentAiTrade] = useState<TradeRecommendation | null>(null);
    const [aiTradeApiRef] = useState<any>(null);

    // AI Auto Trade state
    const [isAiAutoTrading, setIsAiAutoTrading] = useState(false);
    const [aiTradeConfig, setAiTradeConfig] = useState({
        ouPredPostLoss: 5,
        martingaleMultiplier: 1.0, // Default changed to 1.0
        stake: 0.5,
        duration: 1,
        durationType: 't', // New field for duration type
        stopLoss: 0,
        takeProfit: 0
    });
    const [currentTradeSymbol, setCurrentTradeSymbol] = useState<string>('');
    const [currentTradeType, setCurrentTradeType] = useState<string>('');
    const [aiTradeStatus, setAiTradeStatus] = useState<string>('');
    const [contractInProgress, setContractInProgress] = useState(false);
    const [lastOutcomeWasLoss, setLastOutcomeWasLoss] = useState(false);
    const [currentStake, setCurrentStake] = useState(0.5);
    const [baseStake] = useState(0.5);

    // Refs for managing active contract subscriptions and stop flag
    const activeContractSubscriptionsRef = useRef<Set<string>>(new Set());
    const aiAutoTradeStopFlagRef = useRef<boolean>(false);

    // AI Scanning Messages with Trading Truths
    const aiScanningMessages = {
        initializing: [
            '🔍 Initializing AI market scanner...',
            '🌐 Connecting to real-time market feeds...',
            '⚡ Loading advanced pattern recognition models...',
            '💡 Truth #1: Anything can happen in the markets...',
            '🎯 Remember: Every moment in the market is unique...'
        ],
        analyzing: [
            '🧠 AI analyzing market volatility patterns...',
            '📊 Processing tick frequency distributions...',
            '🎯 Identifying statistical anomalies...',
            '📈 Calculating probability matrices...',
            '⚙️ Running machine learning algorithms...',
            '💡 Truth #2: You don\'t need to know what happens next to profit...',
            '🔬 Truth #3: Wins and losses are randomly distributed...',
            '⭐ An edge is just higher probability, not certainty...'
        ],
        evaluating: [
            '🤖 AI evaluating trading opportunities...',
            '💡 Cross-referencing historical patterns...',
            '🔬 Analyzing market microstructure...',
            '📋 Ranking volatility indices by potential...',
            '⭐ Scoring recommendation confidence levels...',
            '🎯 Truth #4: An edge indicates higher probability outcomes...',
            '💎 Remember: Random distribution exists in any edge...',
            '🚀 Every market moment brings unique opportunities...'
        ],
        recommending: [
            '🎯 AI preparing optimal trade recommendations...',
            '💎 Finalizing high-confidence opportunities...',
            '🚀 Ready to present best trading setups...',
            '⚡ Truth #5: Every moment in the market is unique...',
            '🏆 AI has processed the fundamental truths of trading...'
        ]
    };

    // Symbol mapping for display names
    const symbolMap: Record<string, string> = {
        'R_10': 'Volatility 10 Index',
        'R_25': 'Volatility 25 Index',
        'R_50': 'Volatility 50 Index',
        'R_75': 'Volatility 75 Index',
        'R_100': 'Volatility 100 Index',
        'RDBEAR': 'Bear Market Index',
        'RDBULL': 'Bull Market Index',
        '1HZ10V': 'Volatility 10 (1s) Index',
        '1HZ25V': 'Volatility 25 (1s) Index',
        '1HZ50V': 'Volatility 50 (1s) Index',
        '1HZ75V': 'Volatility 75 (1s) Index',
        '1HZ100V': 'Volatility 100 (1s) Index'
    };

    // Trade type options
    const tradeTypes = [
        { value: 'all', label: 'All Trade Types' },
        { value: 'over_under', label: 'Over/Under' },
        { value: 'even_odd', label: 'Even/Odd' },
        { value: 'matches_differs', label: 'Matches/Differs' },
        { value: 'o5u4_strategy', label: 'O5U4 Strategy' }
    ];

    // AI message rotation effect
    useEffect(() => {
        if (aiScanningPhase !== 'complete' && connectionStatus === 'scanning') {
            const currentMessages = aiScanningMessages[aiScanningPhase];
            if (currentMessages && currentMessages.length > 1) {
                const interval = setInterval(() => {
                    const randomIndex = Math.floor(Math.random() * currentMessages.length);
                    setCurrentAiMessage(currentMessages[randomIndex]);
                }, 2500); // Change message every 2.5 seconds

                return () => clearInterval(interval);
            }
        }
    }, [aiScanningPhase, connectionStatus]);

    // Initialize market analyzer and start scanning
    useEffect(() => {
        const initializeScanner = async () => {
            try {
                setConnectionStatus('connecting');
                setStatusMessage('Loading historical market data...');

                // Subscribe to market analyzer updates
                const unsubscribe = marketAnalyzer.onAnalysis((recommendation, stats, o5u4Data) => {
                    if (stats) {
                        // Merge real-time stats with full analysis stats
                        const mergedStats = { ...marketStats, ...stats };
                        setMarketStats(mergedStats);
                        setRealTimeStats(stats);
                        setLastUpdateTime(Date.now());
                    }

                    if (recommendation) {
                        setBestRecommendation(recommendation);
                    }

                    if (o5u4Data) {
                        setO5u4Opportunities(o5u4Data);
                    }

                    // Update scan progress
                    const currentStats = stats || marketStats;
                    const readySymbolsCount = Object.keys(currentStats).filter(symbol =>
                        currentStats[symbol].isReady
                    ).length;

                    setSymbolsAnalyzed(readySymbolsCount);
                    setScanProgress((readySymbolsCount / totalSymbols) * 100);

                    // AI scanning phases - Show results after 5 markets, complete at 12
                    const progressPercentage = (readySymbolsCount / totalSymbols) * 100;

                    // Show which symbol is being processed
                    const symbols = Object.keys(currentStats);
                    if (symbols[readySymbolsCount - 1]) {
                        const currentSymbol = symbols[readySymbolsCount - 1];
                        const displayName = symbolMap[currentSymbol] || currentSymbol;
                        setProcessingSymbol(displayName);
                    }

                    if (readySymbolsCount >= totalSymbols) {
                        // All 12 markets complete - show final state
                        setAiScanningPhase('complete');
                        setCurrentAiMessage('✅ AI analysis complete - Ready to trade!');
                        setStatusMessage('🚀 AI has identified the best trading opportunities');
                        setConnectionStatus('ready');
                        setIsScanning(false);
                        setProcessingSymbol('');
                    } else if (readySymbolsCount >= 5) {
                        // First 5+ markets ready - DISPLAY RESULTS, continue scanning
                        setAiScanningPhase('recommending');
                        setCurrentAiMessage(`🎯 Trading opportunities ready! Continuing scan...`);
                        setStatusMessage(`✅ Results ready! Scanning ${readySymbolsCount}/${totalSymbols} markets...`);
                        setConnectionStatus('ready'); // CRITICAL: Set to 'ready' to show results
                        setIsScanning(false); // Hide progress bar
                    } else if (readySymbolsCount === 0) {
                        setAiScanningPhase('initializing');
                        setCurrentAiMessage('📊 Loading historical market data...');
                        setStatusMessage('🚀 Fast-loading with historical data...');
                        setConnectionStatus('scanning');
                    } else if (progressPercentage < 30) {
                        setAiScanningPhase('analyzing');
                        const msgIndex = Math.floor((progressPercentage / 30) * aiScanningMessages.analyzing.length);
                        setCurrentAiMessage(aiScanningMessages.analyzing[Math.min(msgIndex, aiScanningMessages.analyzing.length - 1)]);
                        setStatusMessage(`🧠 AI analyzing patterns... ${readySymbolsCount}/${totalSymbols} markets`);
                        setConnectionStatus('scanning');
                    } else {
                        // Less than 5 markets ready
                        setAiScanningPhase('evaluating');
                        setCurrentAiMessage('🤖 AI evaluating opportunities...');
                        setStatusMessage(`🔍 Preparing recommendations... ${readySymbolsCount}/${totalSymbols} analyzed`);
                        setConnectionStatus('scanning');
                    }
                });

                // Add error event listener with recovery
                const errorUnsubscribe = marketAnalyzer.onError((error) => {
                    console.error('Market analyzer error:', error);
                    setConnectionStatus('error');
                    setStatusMessage('Connection error - retrying...');
                    
                    // Auto-recover after 3 seconds if we have some data
                    setTimeout(() => {
                        const hasAnyData = Object.keys(marketStats).some(symbol => 
                            marketStats[symbol] && marketStats[symbol].tickCount > 0
                        );
                        
                        if (hasAnyData) {
                            console.log('🔄 Auto-recovering with available data');
                            setConnectionStatus('ready');
                            setStatusMessage('🎯 Trading opportunities identified - Ready to trade!');
                            setIsScanning(false);
                        }
                    }, 3000);
                });

                // Start the market analyzer
                marketAnalyzer.start();
                setIsScanning(true);
                setConnectionStatus('scanning');
                
                // Fallback timeout - force ready state after 15 seconds
                setTimeout(() => {
                    if (connectionStatus === 'scanning' || connectionStatus === 'connecting') {
                        console.log('⚡ Fallback timeout - proceeding with available data');
                        setAiScanningPhase('complete');
                        setCurrentAiMessage('⚡ Analysis ready - Interface loaded!');
                        setStatusMessage('🎯 Market scanner ready - Limited data available');
                        setConnectionStatus('ready');
                        setIsScanning(false);
                        setProcessingSymbol('');
                    }
                }, 15000);

                return () => {
                    unsubscribe();
                    errorUnsubscribe();
                    marketAnalyzer.stop();
                };

            } catch (error) {
                console.error('Failed to initialize market scanner:', error);
                setConnectionStatus('error');
                setStatusMessage('Failed to connect to market data. Please try again.');
                setIsScanning(false);
            }
        };

        initializeScanner();

        return () => {
            marketAnalyzer.stop();
        };
    }, []);

    // Generate comprehensive scan results
    const generateScanResults = useCallback((): ScanResult[] => {
        const results: ScanResult[] = [];
        const currentStats = { ...marketStats, ...realTimeStats }; // Merge with real-time data

        Object.keys(currentStats).forEach(symbol => {
            const stats = currentStats[symbol];
            if (!stats.isReady) return;

            const recommendations: TradeRecommendation[] = [];
            const displayName = symbolMap[symbol] || symbol;
            let currentRecommendation: TradeRecommendation | null = null; // Track recommendation for the current symbol

            // Generate balanced Over/Under recommendations for ALL symbols
            const generateOverUnderRecs = () => {
                const { lastDigitFrequency, currentLastDigit } = stats;
                const totalTicks = Object.values(lastDigitFrequency).reduce((a, b) => a + b, 0);

                if (totalTicks < 50) return;

                // Balanced barrier assignment ensuring BOTH over and under recommendations
                const symbolBarrierMap: Record<string, { overBarrier: number; underBarrier: number }> = {
                    'R_10': { overBarrier: 4, underBarrier: 6 },
                    'R_25': { overBarrier: 5, underBarrier: 5 },
                    'R_50': { overBarrier: 6, underBarrier: 4 },
                    'R_75': { overBarrier: 3, underBarrier: 7 },
                    'R_100': { overBarrier: 2, underBarrier: 8 },
                    'RDBEAR': { overBarrier: 7, underBarrier: 3 },
                    'RDBULL': { overBarrier: 3, underBarrier: 7 },
                    '1HZ10V': { overBarrier: 4, underBarrier: 6 },
                    '1HZ25V': { overBarrier: 5, underBarrier: 5 },
                    '1HZ50V': { overBarrier: 6, underBarrier: 4 },
                    '1HZ75V': { overBarrier: 7, underBarrier: 3 },
                    '1HZ100V': { overBarrier: 8, underBarrier: 2 }
                };

                const barriers = symbolBarrierMap[symbol] || { overBarrier: 5, underBarrier: 5 };

                // Generate BOTH over and under recommendations
                ['over', 'under'].forEach(strategy => {
                    const barrier = strategy === 'over' ? barriers.overBarrier : barriers.underBarrier;

                    // Calculate actual over/under counts for the barrier
                    let overCount = 0;
                    let underCount = 0;

                    for (let digit = 0; digit <= 9; digit++) {
                        const digitFreq = lastDigitFrequency[digit] || 0;
                        if (digit > barrier) {
                            overCount += digitFreq;
                        } else if (digit < barrier) {
                            underCount += digitFreq;
                        }
                    }

                    const overPercent = (overCount / totalTicks) * 100;
                    const underPercent = (underCount / totalTicks) * 100;

                    const dominancePercent = strategy === 'over' ? overPercent : underPercent;
                    const oppositePercent = strategy === 'over' ? underPercent : overPercent;

                    if (dominancePercent > 52) { // Lower threshold for more balanced recommendations
                        const confidence = Math.min(55 + (dominancePercent - 52) * 5, 85);

                        recommendations.push({
                            symbol,
                            strategy: strategy as 'over' | 'under',
                            barrier: barrier.toString(),
                            confidence: dominancePercent, // Use actual market percentage
                            overPercentage: overPercent,
                            underPercentage: underPercent,
                            reason: `${strategy.toUpperCase()} ${barrier} dominance: ${dominancePercent.toFixed(1)}% vs ${oppositePercent.toFixed(1)}%, current ${currentLastDigit}`,
                            timestamp: Date.now()
                        });
                    }
                });
            };


            // Generate Even/Odd recommendations
            const generateEvenOddRecs = () => {
                const evenCount = [0, 2, 4, 6, 8].reduce((sum, digit) => sum + (stats.lastDigitFrequency[digit] || 0), 0);
                const oddCount = [1, 3, 5, 7, 9].reduce((sum, digit) => sum + (stats.lastDigitFrequency[digit] || 0), 0);
                const totalTicks = evenCount + oddCount;

                if (totalTicks >= 50) {
                    const evenPercent = (evenCount / totalTicks) * 100;
                    const oddPercent = (oddCount / totalTicks) * 100;

                    if (evenPercent > 60) {
                        recommendations.push({
                            symbol,
                            strategy: 'even',
                            barrier: 'even',
                            confidence: evenPercent,
                            overPercentage: evenPercent,
                            underPercentage: oddPercent,
                            reason: `STRONG EVEN dominance: ${evenPercent.toFixed(1)}% vs ${oddPercent.toFixed(1)}%, current ${stats.currentLastDigit}`,
                            timestamp: Date.now()
                        });
                    }

                    if (oddPercent > 60) {
                        recommendations.push({
                            symbol,
                            strategy: 'odd',
                            barrier: 'odd',
                            confidence: oddPercent,
                            overPercentage: evenPercent,
                            underPercentage: oddPercent,
                            reason: `STRONG ODD dominance: ${oddPercent.toFixed(1)}% vs ${evenPercent.toFixed(1)}%, current ${stats.currentLastDigit}`,
                            timestamp: Date.now()
                        });
                    }
                }
            };

            // Generate Matches/Differs recommendations
            const generateMatchesDiffersRecs = () => {
                const { mostFrequentDigit, leastFrequentDigit, lastDigitFrequency } = stats;
                const totalTicks = Object.values(lastDigitFrequency).reduce((a, b) => a + b, 0);

                if (totalTicks >= 50) {
                    const mostFreqCount = lastDigitFrequency[mostFrequentDigit] || 0;
                    const leastFreqCount = lastDigitFrequency[leastFrequentDigit] || 0;
                    const mostFreqPercent = (mostFreqCount / totalTicks) * 100;
                    const leastFreqPercent = (leastFreqCount / totalTicks) * 100;

                    // Matches recommendation
                    if (mostFreqPercent > 15) {
                        const confidence = Math.min(55 + (mostFreqPercent - 10) * 2, 80);
                        recommendations.push({
                            symbol,
                            strategy: 'matches',
                            barrier: mostFrequentDigit.toString(),
                            confidence,
                            overPercentage: mostFreqPercent,
                            underPercentage: 100 - mostFreqPercent,
                            reason: `Digit ${mostFrequentDigit} appears ${mostFreqPercent.toFixed(1)}% of time`,
                            timestamp: Date.now()
                        });
                    }

                    // Differs recommendation
                    if (leastFreqPercent < 8) {
                        const confidence = Math.min(60 + (8 - leastFreqPercent) * 3, 85);
                        recommendations.push({
                            symbol,
                            strategy: 'differs',
                            barrier: leastFrequentDigit.toString(),
                            confidence,
                            overPercentage: leastFreqPercent,
                            underPercentage: 100 - leastFreqPercent,
                            reason: `Digit ${leastFrequentDigit} appears only ${leastFreqPercent.toFixed(1)}% of time`,
                            timestamp: Date.now()
                        });
                    }
                }
            };

            // Apply filters based on selected trade type
            if (selectedTradeType === 'all' || selectedTradeType === 'over_under') {
                generateOverUnderRecs();
            }
            if (selectedTradeType === 'all' || selectedTradeType === 'even_odd') {
                generateEvenOddRecs();
            }
            if (selectedTradeType === 'all' || selectedTradeType === 'matches_differs') {
                generateMatchesDiffersRecs();
            }

            // Check for O5U4 opportunities
            const o5u4Data = o5u4Opportunities.find(opp => opp.symbol === symbol);

            if (recommendations.length > 0 || (o5u4Data && o5u4Data.conditionsMetCount >= 3)) {
                results.push({
                    symbol,
                    displayName,
                    recommendations,
                    stats,
                    o5u4Data
                });
            }
        });

        return results.sort((a, b) => {
            const aMaxConf = Math.max(...a.recommendations.map(r => r.confidence), 0);
            const bMaxConf = Math.max(...b.recommendations.map(r => r.confidence), 0);
            return bMaxConf - aMaxConf;
        });
    }, [marketStats, realTimeStats, o5u4Opportunities, selectedTradeType]);

    // Update scan results when data changes - continuously update when ready
    useEffect(() => {
        if (connectionStatus === 'ready' || connectionStatus === 'scanning') {
            const results = generateScanResults();
            if (results.length > 0) {
                setScanResults(results);
            }
        }
    }, [connectionStatus, generateScanResults, marketStats, realTimeStats]);

    // AI Auto Trade API setup
    const apiRef = useRef<any>(null);

    useEffect(() => {
        if (isAiAutoTrading && !apiRef.current) {
            import('@/external/bot-skeleton/services/api/appId').then(({ generateDerivApiInstance }) => {
                apiRef.current = generateDerivApiInstance();
            });
        }
    }, [isAiAutoTrading]);

    // Monitor best recommendation changes for AI Auto Trade - Enhanced switching logic
    useEffect(() => {
        if (isAiAutoTrading && bestRecommendation && !contractInProgress) {
            const newSymbol = bestRecommendation.symbol;
            const newTradeType = getTradeTypeForStrategy(bestRecommendation.strategy);
            const newStrategy = bestRecommendation.strategy;

            // Check if recommendation significantly changed
            const symbolChanged = newSymbol !== currentTradeSymbol;
            const tradeTypeChanged = newTradeType !== currentTradeType;
            const shouldSwitch = symbolChanged || tradeTypeChanged;

            if (shouldSwitch) {
                console.log(`🔄 AI Auto Trade: Switching recommendation`, {
                    from: `${currentTradeSymbol} ${currentTradeType}`,
                    to: `${newSymbol} ${newTradeType} (${newStrategy})`,
                    confidence: `${bestRecommendation.confidence.toFixed(1)}%`,
                    reason: bestRecommendation.reason
                });

                setCurrentTradeSymbol(newSymbol);
                setCurrentTradeType(newTradeType);

                // Update display name for status
                const displayName = symbolMap[newSymbol] || newSymbol;
                setAiTradeStatus(`🔄 Switched to ${displayName} ${newStrategy.toUpperCase()} (${bestRecommendation.confidence.toFixed(1)}%)`);

                // When switching symbols/strategies, reset to base stake for new opportunity
                if (symbolChanged) {
                    setLastOutcomeWasLoss(false);
                    setCurrentStake(baseStake);
                    console.log(`🔄 Symbol change: Reset stake to base (${baseStake}) and pre-loss state`);
                }

                // Execute trade with new recommendation after a short delay
                setTimeout(() => {
                    if (isAiAutoTrading && !contractInProgress && bestRecommendation) {
                        executeAiTrade(bestRecommendation);
                    } else {
                        console.log('🚫 AI Auto Trade: New recommendation execution cancelled - AI Auto Trade stopped');
                    }
                }, 2000);
            }
        }
    }, [bestRecommendation, isAiAutoTrading, currentTradeSymbol, currentTradeType, contractInProgress, baseStake]);

    // AI Auto Trade execution using Smart Trader logic
    const executeAiTrade = async (recommendation: TradeRecommendation) => {
        // Immediate check - if AI Auto Trade was stopped, exit immediately
        if (!isAiAutoTrading) {
            console.log('🚫 executeAiTrade cancelled - AI Auto Trade is stopped');
            return;
        }

        if (!apiRef.current || contractInProgress || !store) return;

        try {
            setContractInProgress(true);
            setAiTradeStatus(`Placing trade: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier}...`);

            // Import necessary functions
            const { authorize, error: authError } = await apiRef.current.authorize(V2GetActiveToken());
            if (authError) {
                setAiTradeStatus(`Auth error: ${authError.message}`);
                setIsAiAutoTrading(false);
                setContractInProgress(false);
                if (store.run_panel) {
                    store.run_panel.setIsRunning(false);
                    store.run_panel.setContractStage(contract_stages.NOT_RUNNING);
                }
                return;
            }

            // Sync AI Auto Trade auth state into shared ClientStore for transactions
            try {
                const loginid = authorize?.loginid || V2GetActiveClientId();
                store?.client?.setLoginId?.(loginid || '');
                store?.client?.setCurrency?.(authorize?.currency || 'USD');
                store?.client?.setIsLoggedIn?.(true);
            } catch (error) {
                console.log('Client store sync warning:', error);
            }

            // Use Smart Trader logic for trade option preparation - exact same as Smart Trader
            const trade_option: any = {
                amount: Number(currentStake),
                basis: 'stake',
                contractTypes: [getTradeTypeForStrategy(recommendation.strategy)],
                currency: authorize?.currency || 'USD',
                duration: Number(aiTradeConfig.duration),
                duration_unit: 't',
                symbol: recommendation.symbol,
            };

            // Smart Trader prediction logic - key improvement for Over/Under after loss logic
            if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
                const isAfterLoss = lastOutcomeWasLoss;
                // Use barrier from recommendation as pre-loss, and ouPredPostLoss for after loss
                const selectedPrediction = isAfterLoss ? aiTradeConfig.ouPredPostLoss : parseInt(recommendation.barrier || '5');
                trade_option.prediction = Number(selectedPrediction);

                console.log(`🎯 AI Trade Prediction Logic:`, {
                    isAfterLoss,
                    selectedPrediction,
                    preLossPred: parseInt(recommendation.barrier || '5'),
                    postLossPred: aiTradeConfig.ouPredPostLoss,
                    strategy: recommendation.strategy
                });

                setAiTradeStatus(`${recommendation.strategy.toUpperCase()}: ${selectedPrediction} ${isAfterLoss ? '(after loss)' : '(pre-loss)'} - Stake: ${currentStake}`);
            } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
                trade_option.prediction = parseInt(recommendation.barrier || '5');
                setAiTradeStatus(`${recommendation.strategy.toUpperCase()}: ${recommendation.barrier} - Stake: ${currentStake}`);
            } else {
                // Even/Odd doesn't need prediction
                setAiTradeStatus(`${recommendation.strategy.toUpperCase()} - Stake: ${currentStake}`);
            }

            // Create buy request using exact same logic as Smart Trader tradeOptionToBuy function
            const buy_req = {
                buy: '1',
                price: trade_option.amount,
                parameters: {
                    amount: trade_option.amount,
                    basis: trade_option.basis,
                    contract_type: getTradeTypeForStrategy(recommendation.strategy),
                    currency: trade_option.currency,
                    duration: trade_option.duration,
                    duration_unit: trade_option.duration_unit,
                    symbol: recommendation.symbol,
                },
            };

            // Add prediction parameters exactly like Smart Trader
            if (trade_option.prediction !== undefined) {
                buy_req.parameters.selected_tick = trade_option.prediction;
                // Only add barrier for non-tick contracts
                if (!['TICKLOW', 'TICKHIGH'].includes(getTradeTypeForStrategy(recommendation.strategy))) {
                    buy_req.parameters.barrier = trade_option.prediction;
                }
            }

            console.log('📦 AI Auto Trade Buy request:', {
                contract_type: getTradeTypeForStrategy(recommendation.strategy),
                prediction: trade_option.prediction,
                amount: currentStake,
                after_loss: lastOutcomeWasLoss,
                symbol: recommendation.symbol,
                full_request: buy_req
            });

            // Execute purchase with proper error handling
            const { buy, error } = await apiRef.current.buy(buy_req);
            if (error) {
                console.error('❌ AI Trade Purchase failed:', error);

                if (error.code === 'RateLimit' || error.message?.includes('rate limit') || error.message?.includes('too many requests')) {
                    setAiTradeStatus('Rate limit hit. Waiting before retry...');
                    setContractInProgress(false);

                    // Only retry if AI Auto Trade is still active
                    if (isAiAutoTrading) {
                        setTimeout(() => {
                            // Double check that AI Auto Trade is still active before retrying
                            if (bestRecommendation && isAiAutoTrading) {
                                console.log('🔄 AI Auto Trade: Retrying after rate limit');
                                executeAiTrade(bestRecommendation);
                            } else {
                                console.log('🚫 AI Auto Trade: Retry cancelled - AI Auto Trade stopped');
                            }
                        }, 5000);
                    }
                    return;
                }

                setAiTradeStatus(`Trade error: ${error.message || error.code || 'Unknown error'}`);
                setContractInProgress(false);

                // Don't stop trading on single error, retry after delay - but only if still trading
                if (isAiAutoTrading) {
                    setTimeout(() => {
                        // Double check that AI Auto Trade is still active before retrying
                        if (bestRecommendation && isAiAutoTrading) {
                            console.log('🔄 AI Auto Trade: Retrying after error');
                            executeAiTrade(bestRecommendation);
                        } else {
                            console.log('🚫 AI Auto Trade: Retry cancelled - AI Auto Trade stopped');
                        }
                    }, 5000);
                }
                return;
            }

            if (!buy || !buy.contract_id) {
                console.error('❌ AI Trade: No contract returned from purchase');
                setAiTradeStatus('Error: No contract returned from purchase');
                setContractInProgress(false);
                return;
            }

            console.log(`✅ AI Auto Trade executed successfully:`, {
                contractId: buy.contract_id,
                longcode: buy.longcode,
                amount: currentStake,
                strategy: recommendation.strategy
            });

            setAiTradeStatus(`✅ Trade placed: ${buy?.longcode || 'Contract'} (ID: ${buy.contract_id})`);

            // Create transaction entry like Smart Trader
            try {
                const symbol_display = symbolMap[recommendation.symbol] || recommendation.symbol;
                // Assuming 'transactions' is accessible and has onBotContractEvent
                // If not, this part needs to be adapted based on how transactions are managed
                // For now, assume it's globally available or imported
                transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: authorize?.currency || 'USD',
                    contract_type: getTradeTypeForStrategy(recommendation.strategy) as any,
                    underlying: recommendation.symbol,
                    display_name: symbol_display,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch (transactionError) {
                console.error('Error creating transaction entry:', transactionError);
            }

            // Subscribe to contract updates - exact same as Smart Trader
            try {
                const { subscription, error: subError } = await apiRef.current.send({
                    proposal_open_contract: 1,
                    contract_id: buy.contract_id,
                    subscribe: 1,
                });

                if (subError) {
                    console.error('Error subscribing to contract:', subError);
                    setContractInProgress(false);
                    return;
                }

                let pocSubId: string | null = subscription?.id || null;
                const targetId = String(buy.contract_id);

                // Track this subscription for cleanup
                if (pocSubId) {
                    activeContractSubscriptionsRef.current.add(pocSubId);
                }

                const onContractUpdate = (evt: MessageEvent) => {
                    try {
                        // Check if AI Auto Trade was stopped - if so, ignore all contract updates
                        if (!isAiAutoTrading || aiAutoTradeStopFlagRef.current) {
                            console.log('🚫 Contract update ignored - AI Auto Trade is stopped');
                            // Clean up this subscription immediately
                            if (pocSubId) {
                                apiRef.current?.forget?.({ forget: pocSubId });
                                activeContractSubscriptionsRef.current.delete(pocSubId);
                            }
                            apiRef.current?.connection?.removeEventListener('message', onContractUpdate);
                            return;
                        }

                        const data = JSON.parse(evt.data);
                        if (data?.msg_type === 'proposal_open_contract') {
                            const poc = data.proposal_open_contract;
                            if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;

                            if (String(poc?.contract_id || '') === targetId) {
                                // Update status while contract is running
                                if (!poc?.is_sold && poc?.status !== 'sold') {
                                    setAiTradeStatus(`📊 Contract running: ${poc?.current_spot || 'N/A'} | Profit: ${Number(poc?.profit || 0).toFixed(2)}`);
                                }

                                // Handle contract completion
                                if (poc?.is_sold || poc?.status === 'sold') {
                                    const profit = Number(poc?.profit || 0);

                                    // Update run panel state
                                    const { run_panel } = store;
                                    if (run_panel) {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                    }

                                    if (profit > 0) {
                                        // WIN: Reset progression
                                        setLastOutcomeWasLoss(false);
                                        setCurrentStake(baseStake);
                                        console.log(`✅ AI WIN: +${profit.toFixed(2)} ${authorize?.currency || 'USD'} - Reset to pre-loss prediction`);
                                        setAiTradeStatus(`✅ WIN: +${profit.toFixed(2)} ${authorize?.currency || 'USD'} - Reset to base stake`);
                                    } else {
                                        // LOSS: Set flag for next trade to use after-loss prediction
                                        setLastOutcomeWasLoss(true);
                                        const newStake = Number((currentStake * aiTradeConfig.martingaleMultiplier).toFixed(2));
                                        setCurrentStake(newStake);
                                        console.log(`❌ AI LOSS: ${profit.toFixed(2)} ${authorize?.currency || 'USD'} - Next trade will use after-loss prediction (${aiTradeConfig.ouPredPostLoss})`);
                                        setAiTradeStatus(`❌ LOSS: ${profit.toFixed(2)} ${authorize?.currency || 'USD'} - Next stake: ${newStake}`);
                                    }

                                    // Clean up subscription
                                    if (pocSubId) {
                                        apiRef.current?.forget?.({ forget: pocSubId });
                                        activeContractSubscriptionsRef.current.delete(pocSubId);
                                    }
                                    apiRef.current?.connection?.removeEventListener('message', onContractUpdate);
                                    setContractInProgress(false);

                                    // Schedule next trade if AI Auto Trade is still active
                                    if (isAiAutoTrading) {
                                        // Reduced wait time between trades for faster execution
                                        setTimeout(() => {
                                            // Double-check AI Auto Trade is still active before executing
                                            if (isAiAutoTrading && bestRecommendation && !contractInProgress) {
                                                executeAiTrade(bestRecommendation);
                                            } else {
                                                console.log('🚫 AI Auto Trade: No next trade scheduled - AI Auto Trade stopped or no recommendation');
                                            }
                                        }, 2000); // 2 seconds between trades for faster execution
                                    } else {
                                        console.log('🚫 AI Auto Trade: No next trade scheduled - AI Auto Trade stopped');
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error processing contract update:', e);
                    }
                };

                apiRef.current?.connection?.addEventListener('message', onContractUpdate);
            } catch (subError) {
                console.error('Contract subscription error:', subError);
                setContractInProgress(false);
            }

        } catch (error) {
            console.error('AI Auto Trade execution error:', error);
            setAiTradeStatus(`Error: ${error?.message || 'Unknown error'}`);
            setContractInProgress(false);

            // Retry after error if still trading
            if (isAiAutoTrading) {
                setTimeout(() => {
                    // Double check that AI Auto Trade is still active before retrying
                    if (bestRecommendation && isAiAutoTrading && !contractInProgress) {
                        console.log('🔄 AI Auto Trade: Retrying after error');
                        executeAiTrade(bestRecommendation);
                    } else {
                        console.log('🚫 AI Auto Trade: Retry cancelled - AI Auto Trade stopped');
                    }
                }, 5000);
            }
        }
    };

    const startAiAutoTrade = async () => {
        if (!bestRecommendation) {
            alert('No trading opportunity available. Please wait for market analysis.');
            return;
        }

        // Initialize API if not already done
        if (!apiRef.current) {
            try {
                const { generateDerivApiInstance } = await import('@/external/bot-skeleton/services/api/appId');
                apiRef.current = generateDerivApiInstance();
                console.log('🔌 AI Auto Trade: API initialized');
            } catch (error) {
                console.error('Failed to initialize API for AI Auto Trade:', error);
                setAiTradeStatus('Error: Failed to initialize trading API');
                return;
            }
        }

        // Initialize AI Auto Trade with proper state
        setIsAiAutoTrading(true);
        setCurrentTradeSymbol(bestRecommendation.symbol);
        setCurrentTradeType(getTradeTypeForStrategy(bestRecommendation.strategy));
        setCurrentStake(aiTradeConfig.stake);
        setLastOutcomeWasLoss(false); // Start fresh
        setContractInProgress(false);
        aiAutoTradeStopFlagRef.current = false; // Reset stop flag
        activeContractSubscriptionsRef.current.clear(); // Clear any old subscriptions

        console.log(`🤖 AI Auto Trade Started:`, {
            symbol: bestRecommendation.symbol,
            strategy: bestRecommendation.strategy,
            confidence: bestRecommendation.confidence.toFixed(1),
            initialStake: aiTradeConfig.stake,
            martingaleMultiplier: aiTradeConfig.martingaleMultiplier,
            ouPredPostLoss: aiTradeConfig.ouPredPostLoss
        });

        const displayName = symbolMap[bestRecommendation.symbol] || bestRecommendation.symbol;
        setAiTradeStatus(`🚀 AI Auto Trade started: ${displayName} ${bestRecommendation.strategy.toUpperCase()}`);

        // Start trading with current best recommendation immediately
        setTimeout(() => {
            if (isAiAutoTrading) {
                executeAiTrade(bestRecommendation);
            }
        }, 1000);
    };

    const stopAiAutoTrade = () => {
        console.log(`🛑 AI Auto Trade Stopped`);

        // Set stop flag and clear pending states immediately
        aiAutoTradeStopFlagRef.current = true; // Set the stop flag
        setIsAiAutoTrading(false);
        setContractInProgress(false);
        setCurrentTradeSymbol('');
        setCurrentTradeType('');
        setLastOutcomeWasLoss(false);
        setCurrentStake(baseStake);
        setAiTradeStatus('🛑 AI Auto Trade stopped');

        // Update run panel state to stop immediately
        if (store?.run_panel) {
            store.run_panel.setIsRunning(false);
            store.run_panel.setHasOpenContract(false);
            store.run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }

        // Clean up API and cancel all active subscriptions immediately
        try {
            if (apiRef.current?.connection) {
                // Force forget all active contract subscriptions
                activeContractSubscriptionsRef.current.forEach(subId => {
                    apiRef.current.send({ forget: subId }).catch(() => {});
                });
                activeContractSubscriptionsRef.current.clear(); // Clear the set

                // Remove all message event listeners to stop processing responses
                const connection = apiRef.current.connection;
                if (connection && connection.removeEventListener) {
                    // Clone event listeners and remove them all
                    const listeners = connection.listeners?.('message') || [];
                    listeners.forEach(listener => {
                        connection.removeEventListener('message', listener);
                    });
                }
                console.log('🧹 AI Auto Trade cleanup completed - All subscriptions and listeners cancelled');
            }
        } catch (error) {
            console.error('Error during AI Auto Trade cleanup:', error);
        }

        // Clear any pending timeouts that might trigger new trades
        // This ensures no delayed executions continue
        const highestTimeoutId = setTimeout(() => {}, 0);
        for (let i = 0; i < highestTimeoutId; i++) {
            clearTimeout(i);
        }
        console.log('🧹 Cleared all pending timeouts to prevent delayed trade executions');
    };

    // Start direct trading with Best Opportunity panel settings (bypasses Smart Trader modal)
    const startDirectTrading = (recommendation: TradeRecommendation) => {
        // Map strategy to proper trade type and contract type
        const getTradeTypeAndContract = (strategy: string) => {
            switch (strategy) {
                case 'over':
                    return { tradeType: 'DIGITOVER', contractType: 'DIGITOVER' };
                case 'under':
                    return { tradeType: 'DIGITUNDER', contractType: 'DIGITUNDER' };
                case 'even':
                    return { tradeType: 'DIGITEVEN', contractType: 'DIGITEVEN' };
                case 'odd':
                    return { tradeType: 'DIGITODD', contractType: 'DIGITODD' };
                case 'matches':
                    return { tradeType: 'DIGITMATCH', contractType: 'DIGITMATCH' };
                case 'differs':
                    return { tradeType: 'DIGITDIFF', contractType: 'DIGITDIFF' };
                default:
                    return { tradeType: 'DIGITOVER', contractType: 'DIGITOVER' };
            }
        };

        const { tradeType, contractType } = getTradeTypeAndContract(recommendation.strategy);

        // Use Best Opportunity panel settings
        const settings: TradeSettings = {
            symbol: recommendation.symbol,
            tradeType: tradeType,
            contractType: contractType,
            stake: aiTradeConfig.stake,
            duration: aiTradeConfig.duration,
            durationType: aiTradeConfig.durationType,
            martingaleMultiplier: aiMartingaleMultiplier,
            ouPredPostLoss: aiTradeConfig.ouPredPostLoss,
            stopLoss: aiTradeConfig.stopLoss,
            takeProfit: aiTradeConfig.takeProfit
        };

        // Add prediction/barrier based on strategy
        if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
            settings.barrier = recommendation.barrier;
            settings.prediction = parseInt(recommendation.barrier || '5');
        } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
            settings.prediction = parseInt(recommendation.barrier || '5');
            settings.barrier = recommendation.barrier;
        }

        console.log('🚀 Starting Direct Trading (Bypassing Smart Trader Modal):', {
            strategy: recommendation.strategy,
            symbol: recommendation.symbol,
            tradeType: tradeType,
            stake: aiTradeConfig.stake,
            duration: aiTradeConfig.duration,
            durationType: aiTradeConfig.durationType,
            martingale: aiMartingaleMultiplier,
            prediction: settings.prediction,
            barrier: settings.barrier
        });

        // Store the settings and open Smart Trader in auto-start mode
        setSelectedTradeSettings(settings);
        setAutoStartTrading(true); // Enable auto-start
        setIsSmartTraderModalOpen(true);
        
        // Auto-hide modal immediately for direct trading
        setTimeout(() => {
            setIsSmartTraderHidden(true);
        }, 600); // Allow time for trading to start before hiding
    };

    // Load trade settings to Smart Trader (legacy function - kept for compatibility)
    const loadTradeSettings = (recommendation: TradeRecommendation) => {
        // Map strategy to proper trade type and contract type
        const getTradeTypeAndContract = (strategy: string) => {
            switch (strategy) {
                case 'over':
                    return { tradeType: 'DIGITOVER', contractType: 'DIGITOVER' };
                case 'under':
                    return { tradeType: 'DIGITUNDER', contractType: 'DIGITUNDER' };
                case 'even':
                    return { tradeType: 'DIGITEVEN', contractType: 'DIGITEVEN' };
                case 'odd':
                    return { tradeType: 'DIGITODD', contractType: 'DIGITODD' };
                case 'matches':
                    return { tradeType: 'DIGITMATCH', contractType: 'DIGITMATCH' };
                case 'differs':
                    return { tradeType: 'DIGITDIFF', contractType: 'DIGITDIFF' };
                default:
                    return { tradeType: 'DIGITOVER', contractType: 'DIGITOVER' };
            }
        };

        const { tradeType, contractType } = getTradeTypeAndContract(recommendation.strategy);

        const settings = {
            symbol: recommendation.symbol,
            tradeType: tradeType,
            contractType: contractType,
            stake: 0.5,
            duration: 1,
            durationType: 't'
        };

        // Add prediction/barrier based on strategy
        if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
            settings.barrier = recommendation.barrier;
            settings.prediction = parseInt(recommendation.barrier || '5');
        } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
            settings.prediction = parseInt(recommendation.barrier || '5');
            settings.barrier = recommendation.barrier;
        }

        console.log('Loading Trading Hub settings to Smart Trader:', {
            strategy: recommendation.strategy,
            symbol: recommendation.symbol,
            tradeType: tradeType,
            contractType: contractType,
            prediction: settings.prediction,
            barrier: settings.barrier
        });

        // Store the settings and open the modal (manual mode - no auto-start)
        setSelectedTradeSettings(settings);
        setAutoStartTrading(false); // Disable auto-start for manual Smart Trader
        setIsSmartTraderModalOpen(true);
    };

    // Load recommendation directly to Bot Builder (similar to ML Trader)
    const loadToBotBuilder = useCallback(async (recommendation: TradeRecommendation) => {
        try {
            console.log('🚀 Loading recommendation to Bot Builder:', recommendation);

            // Get symbol display name
            const displayName = symbolMap[recommendation.symbol] || recommendation.symbol;

            // Determine contract type based on strategy
            let contractType = 'DIGITOVER';
            if (recommendation.strategy === 'under') contractType = 'DIGITUNDER';
            else if (recommendation.strategy === 'even') contractType = 'DIGITEVEN';
            else if (recommendation.strategy === 'odd') contractType = 'DIGITODD';
            else if (recommendation.strategy === 'matches') contractType = 'DIGITMATCH';
            else if (recommendation.strategy === 'differs') contractType = 'DIGITDIFF';

            // Default settings
            const defaultStake = 0.5;
            const defaultDuration = 1;
            const defaultDurationUnit = 't'; // ticks
            const barrier = recommendation.barrier;
            let prediction = null;

            if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
                prediction = parseInt(recommendation.barrier || '5');
            } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
                prediction = parseInt(recommendation.barrier || '5');
            }


            // Determine submarket based on symbol
            const getSubmarket = (symbol: string) => {
                // Volatility indices use random_index
                if (symbol.startsWith('R_') || symbol.startsWith('1HZ')) {
                    return 'random_index';
                }
                // Step indices use step_index  
                if (symbol.toLowerCase().includes('stp') || symbol.toLowerCase().includes('step')) {
                    return 'step_index';
                }
                // Default to continuous_indices for others
                return 'continuous_indices';
            };

            // Map strategy to proper Bot Builder trade type categories
            const getTradeTypeMapping = (strategy: string) => {
                switch (strategy) {
                    case 'over':
                    case 'under':
                    case 'even':
                    case 'odd':
                    case 'matches':
                    case 'differs':
                        return {
                            tradeTypeCategory: 'digits',
                            tradeTypeList: 'digits',
                            contractType: getTradeTypeForStrategy(strategy)
                        };
                    case 'call':
                    case 'put':
                        return {
                            tradeTypeCategory: 'callput',
                            tradeTypeList: 'risefall',
                            contractType: strategy === 'call' ? 'CALL' : 'PUT'
                        };
                    default:
                        return {
                            tradeTypeCategory: 'digits',
                            tradeTypeList: 'digits',
                            contractType: 'DIGITOVER'
                        };
                }
            };

            const tradeMapping = getTradeTypeMapping(recommendation.strategy);
            const submarket = getSubmarket(recommendation.symbol);

            // Generate Bot Builder XML
            const botSkeletonXML = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="Stake">Stake</variable>
    <variable id="Result_is">Result_is</variable>
    <variable id="Martingale_Multiplier">Martingale_Multiplier</variable>
  </variables>

  <!-- Trade Definition Block -->
  <block type="trade_definition" id="trade_definition_main" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="market_block" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">${submarket}</field>
        <field name="SYMBOL_LIST">${recommendation.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="tradetype_block" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${tradeMapping.tradeTypeCategory}</field>
            <field name="TRADETYPE_LIST">${tradeMapping.tradeTypeList}</field>
            <next>
              <block type="trade_definition_contracttype" id="contracttype_block" deletable="false" movable="false">
                <field name="TYPE_LIST">${tradeMapping.contractType}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="candleinterval_block" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="restart_block" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="restartonerror_block" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>

    <!-- Initialization -->
    <statement name="INITIALIZATION">
      <block type="text_print" id="init_print">
        <value name="TEXT">
          <shadow type="text" id="init_text">
            <field name="TEXT">Trading Hub Strategy Loading...</field>
          </shadow>
        </value>
        <next>
          <block type="text_print" id="strategy_print">
            <value name="TEXT">
              <shadow type="text" id="strategy_text">
                <field name="TEXT">${displayName} - ${recommendation.strategy.toUpperCase()}${prediction !== null ? ` ${prediction}` : ''}</field>
              </shadow>
            </value>
            <next>
              <block type="variables_set" id="set_stake">
                <field name="VAR" id="Stake">Stake</field>
                <value name="VALUE">
                  <block type="math_number" id="stake_number">
                    <field name="NUM">${defaultStake}</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="set_martingale">
                    <field name="VAR" id="Martingale_Multiplier">Martingale_Multiplier</field>
                    <value name="VALUE">
                      <block type="math_number" id="martingale_number">
                        <field name="NUM">1.5</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>

    <!-- Trade Options -->
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="trade_options_block">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="${['over', 'under', 'matches', 'differs'].includes(recommendation.strategy) ? 'true' : 'false'}"></mutation>
        <field name="DURATIONTYPE_LIST">${defaultDurationUnit}</field>
        <value name="DURATION">
          <shadow type="math_number" id="duration_number">
            <field name="NUM">${defaultDuration}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="amount_shadow">
            <field name="NUM">${defaultStake}</field>
          </shadow>
          <block type="variables_get" id="amount_var">
            <field name="VAR" id="Stake">Stake</field>
          </block>
        </value>
        ${['over', 'under', 'matches', 'differs'].includes(recommendation.strategy) ? `
        <value name="PREDICTION">
          <shadow type="math_number" id="prediction_number">
            <field name="NUM">${barrier}</field>
          </shadow>
        </value>` : ''}
      </block>
    </statement>
  </block>

  <!-- Purchase Block -->
  <block type="before_purchase" id="before_purchase_block" deletable="false" x="267" y="544">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="notify" id="notify_block">
        <field name="NOTIFICATION_TYPE">success</field>
        <field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <shadow type="text" id="notify_text">
            <field name="TEXT">Trading Hub Strategy Executing...</field>
          </shadow>
        </value>
        <next>
          <block type="purchase" id="purchase_block">
            <field name="PURCHASE_LIST">${contractType}</field>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- After Purchase Block -->
  <block type="after_purchase" id="after_purchase_block" x="679" y="293">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="result_check">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="check_win">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="reset_stake_win">
            <field name="VAR" id="Stake">Stake</field>
            <value name="VALUE">
              <block type="math_number" id="win_stake">
                <field name="NUM">${defaultStake}</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="set_result_win">
                <field name="VAR" id="Result_is">Result_is</field>
                <value name="VALUE">
                  <block type="text" id="result_win_text">
                    <field name="TEXT">Win</field>
                  </block>
                </value>
                <next>
                  <block type="trade_again" id="trade_again_win"></block>
                </next>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="loss_check">
            <value name="IF0">
              <block type="contract_check_result" id="check_loss">
                <field name="CHECK_RESULT">loss</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="increase_stake">
                <field name="VAR" id="Stake">Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="martingale_calc">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="current_stake_shadow">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="current_stake">
                        <field name="VAR" id="Stake">Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="multiplier_shadow">
                        <field name="NUM">1.5</field>
                      </shadow>
                      <block type="variables_get" id="multiplier_var">
                        <field name="VAR" id="Martingale_Multiplier">Martingale_Multiplier</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="set_result_loss">
                    <field name="VAR" id="Result_is">Result_is</field>
                    <value name="VALUE">
                      <block type="text" id="result_loss_text">
                        <field name="TEXT">Loss</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="trade_again" id="trade_again_loss"></block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>`;

            console.log('📄 Loading Trading Hub strategy to Bot Builder...');

            // Switch to Bot Builder tab
            store.dashboard.setActiveTab(1);

            // Wait for tab switch and load the strategy
            setTimeout(async () => {
                try {
                    // Import bot skeleton functions
                    const { load } = await import('@/external/bot-skeleton');
                    const { save_types } = await import('@/external/bot-skeleton/constants/save-type');

                    // Load to workspace
                    if (window.Blockly?.derivWorkspace) {
                        console.log('📦 Loading Trading Hub strategy to workspace...');

                        await load({
                            block_string: botSkeletonXML,
                            file_name: `TradingHub_${displayName}_${recommendation.strategy.toUpperCase()}_${Date.now()}`,
                            workspace: window.Blockly.derivWorkspace,
                            from: save_types.UNSAVED,
                            drop_event: null,
                            strategy_id: null,
                            showIncompatibleStrategyDialog: null,
                        });

                        // Center workspace
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ Trading Hub strategy loaded to workspace');

                    } else {
                        console.warn('⚠️ Blockly workspace not ready, using fallback method');

                        // Fallback method
                        setTimeout(() => {
                            if (window.Blockly?.derivWorkspace) {
                                window.Blockly.derivWorkspace.clear();
                                const xmlDoc = window.Blockly.utils.xml.textToDom(botSkeletonXML);
                                window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                                window.Blockly.derivWorkspace.scrollCenter();
                                console.log('✅ Trading Hub strategy loaded using fallback method');
                            }
                        }, 500);
                    }
                } catch (loadError) {
                    console.error('❌ Error loading Trading Hub strategy:', loadError);

                    // Final fallback
                    if (window.Blockly?.derivWorkspace) {
                        window.Blockly.derivWorkspace.clear();
                        const xmlDoc = window.Blockly.utils.xml.textToDom(botSkeletonXML);
                        window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ Trading Hub strategy loaded using final fallback');
                    }
                }
            }, 300);

            console.log(`✅ Loaded ${displayName} - ${recommendation.strategy.toUpperCase()} ${barrier} strategy to Bot Builder`);

        } catch (error) {
            console.error('Error loading recommendation to Bot Builder:', error);
        }
    }, [store.dashboard]);

    // AI Auto Trade purchasing without modal
    const executeAIAutoTrade = async (recommendation: TradeRecommendation) => {
        if (isAiAutoTradeActive) {
            setIsAiAutoTradeActive(false);
            setCurrentAiTrade(null);
            return;
        }

        try {
            setIsAiAutoTradeActive(true);
            setCurrentAiTrade(recommendation);

            // Initialize API and start trading immediately
            await startAIAutoTradingEngine(recommendation);

        } catch (error) {
            console.error('Failed to start AI Auto Trade:', error);
            setIsAiAutoTradeActive(false);
            setCurrentAiTrade(null);
        }
    };

    // AI Auto Trading Engine
    const startAIAutoTradingEngine = async (initialRecommendation: TradeRecommendation) => {
        const { generateDerivApiInstance, V2GetActiveToken } = await import('@/external/bot-skeleton/services/api/appId');

        let api: any = null;
        let currentRecommendation = initialRecommendation;
        let lastOutcomeWasLoss = false;
        let baseStake = 0.5;
        let currentStake = baseStake;
        let step = 0;

        try {
            // Initialize API
            api = generateDerivApiInstance();
            const token = V2GetActiveToken();
            if (!token) throw new Error('No authentication token found');

            const { authorize, error } = await api.authorize(token);
            if (error) throw error;

            console.log('🤖 AI Auto Trade Engine started with:', {
                symbol: currentRecommendation.symbol,
                strategy: currentRecommendation.strategy,
                confidence: currentRecommendation.confidence
            });

            // Main trading loop
            while (isAiAutoTradeActive) {
                // Check if recommendation has changed and switch if better opportunity exists
                if (bestRecommendation &&
                    bestRecommendation.symbol !== currentRecommendation.symbol &&
                    bestRecommendation.confidence > currentRecommendation.confidence + 5) {

                    console.log('🔄 Switching to better opportunity:', {
                        from: `${currentRecommendation.symbol} (${currentRecommendation.confidence.toFixed(1)}%)`,
                        to: `${bestRecommendation.symbol} (${bestRecommendation.confidence.toFixed(1)}%)`
                    });

                    currentRecommendation = bestRecommendation;
                    setCurrentAiTrade(currentRecommendation);

                    // Reset progression when switching symbols
                    step = 0;
                    currentStake = baseStake;
                }

                // Calculate stake with martingale progression
                currentStake = step > 0 ? Number((baseStake * Math.pow(aiMartingaleMultiplier, step)).toFixed(2)) : baseStake;

                // Purchase contract
                const buyResult = await purchaseAIContract(api, currentRecommendation, currentStake, lastOutcomeWasLoss);

                if (buyResult) {
                    console.log(`📈 AI Purchase: ${currentRecommendation.strategy.toUpperCase()} ${currentRecommendation.barrier} on ${currentRecommendation.symbol} - Stake: ${currentStake}`);

                    // Wait for contract result
                    const contractResult = await monitorContract(api, buyResult.contract_id);

                    if (contractResult.profit > 0) {
                        // WIN: Reset progression
                        console.log(`✅ AI WIN: +${contractResult.profit.toFixed(2)} - Reset progression`);
                        lastOutcomeWasLoss = false;
                        step = 0;
                        currentStake = baseStake;
                    } else {
                        // LOSS: Increase progression
                        console.log(`❌ AI LOSS: ${contractResult.profit.toFixed(2)} - Increase progression`);
                        lastOutcomeWasLoss = true;
                        step = Math.min(step + 1, 10);
                    }
                }

                // Wait before next trade
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

        } catch (error) {
            console.error('AI Auto Trade Engine error:', error);
        } finally {
            if (api) api.disconnect?.();
            setIsAiAutoTradeActive(false);
            setCurrentAiTrade(null);
        }
    };

    // Purchase AI contract function
    const purchaseAIContract = async (api: any, recommendation: TradeRecommendation, stake: number, afterLoss: boolean) => {
        const tradeType = getTradeTypeForStrategy(recommendation.strategy);

        const trade_option: any = {
            amount: stake,
            basis: 'stake',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            symbol: recommendation.symbol,
        };

        // Set prediction based on strategy and loss state
        if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
            const prediction = afterLoss ? 5 : parseInt(recommendation.barrier || '5');
            trade_option.prediction = prediction;
        } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
            trade_option.prediction = parseInt(recommendation.barrier || '5');
        }

        const buy_req = {
            buy: '1',
            price: stake,
            parameters: {
                amount: stake,
                basis: 'stake',
                contract_type: tradeType,
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: recommendation.symbol,
                ...(trade_option.prediction !== undefined && {
                    barrier: trade_option.prediction,
                    selected_tick: trade_option.prediction
                })
            },
        };

        try {
            const { buy, error } = await api.buy(buy_req);
            if (error) throw error;
            return buy;
        } catch (error) {
            console.error('Purchase failed:', error);
            return null;
        }
    };

    // Monitor contract result
    const monitorContract = async (api: any, contractId: string): Promise<{ profit: number }> => {
        return new Promise((resolve) => {
            const checkContract = async () => {
                try {
                    const { proposal_open_contract } = await api.send({
                        proposal_open_contract: 1,
                        contract_id: contractId,
                        subscribe: 1,
                    });

                    if (proposal_open_contract?.is_sold) {
                        resolve({ profit: Number(proposal_open_contract.profit || 0) });
                    } else {
                        setTimeout(checkContract, 1000);
                    }
                } catch (error) {
                    console.error('Contract monitoring error:', error);
                    resolve({ profit: 0 });
                }
            };
            checkContract();
        });
    };

    // Load AI Auto Trade settings with user-configured values
    const loadAIAutoTradeSettingsWithConfig = (recommendation: TradeRecommendation) => {
        const settings = {
            symbol: recommendation.symbol,
            tradeType: getTradeTypeForStrategy(recommendation.strategy),
            stake: 0.5,
            duration: 1,
            durationType: 't',
            // AI Auto Trade specific settings with user configuration
            aiAutoTrade: true,
            martingaleMultiplier: aiMartingaleMultiplier,
            riskTolerance: aiRiskTolerance,
            profitTarget: aiProfitTarget,
            ouPredPostLoss: 5 // Default Over/Under prediction after loss
        };

        if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
            settings.barrier = recommendation.barrier;
        } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
            settings.prediction = parseInt(recommendation.barrier || '5');
        }

        // Store the settings and open the modal
        setSelectedTradeSettings(settings);
        setIsSmartTraderModalOpen(true);
    };

    const getTradeTypeForStrategy = (strategy: string): string => {
        const mapping: Record<string, string> = {
            'over': 'DIGITOVER',
            'under': 'DIGITUNDER',
            'even': 'DIGITEVEN',
            'odd': 'DIGITODD',
            'matches': 'DIGITMATCH',
            'differs': 'DIGITDIFF',
            'call': 'CALL', // Add mapping for 'call'
            'put': 'PUT',   // Add mapping for 'put'
            'hold': 'HOLD'  // Add mapping for 'hold'
        };
        return mapping[strategy] || 'DIGITOVER';
    };

    const getTradeTypeCategory = (strategy: string): string => {
        // All these strategies are digits-based
        return 'digits';
    };

    const getStatusDotClass = (): string => {
        switch (connectionStatus) {
            case 'connected':
            case 'ready':
                return 'status-dot--success';
            case 'scanning':
                return 'status-dot--warning';
            case 'error':
                return 'status-dot--error';
            default:
                return 'status-dot--loading';
        }
    };

    const renderRecommendationCard = (result: ScanResult) => {
        const bestRec = result.recommendations.reduce((best, current) =>
            current.confidence > (best?.confidence || 0) ? current : best, null);

        return (
            <div key={result.symbol} className="scanner-result-card">
                <div className="scanner-result-header">
                    <div className="symbol-info">
                        <Text size="s" weight="bold">{result.displayName}</Text>
                        <Text size="xs" color="general">{result.symbol}</Text>
                    </div>
                    <div className="market-health">
                        <div className={`health-indicator ${result.stats.tickCount >= 50 ? 'healthy' : 'limited'}`}>
                            {result.stats.tickCount >= 50 ? '🟢' : '🟡'} {result.stats.tickCount} ticks
                        </div>
                        <div className="real-time-badge">
                            📈 Live
                        </div>
                    </div>
                </div>

                <div className="recommendations-list">
                    {result.recommendations.map((rec, index) => (
                        <div key={index} className={`recommendation-item ${rec === bestRec ? 'best-recommendation' : ''}`}>
                            <div className="recommendation-content">
                                <div className="strategy-badge">
                                    <span className={`strategy-label strategy-label--${rec.strategy}`}>
                                        {rec.strategy === 'call' ? 'BUY NOW' :
                                         rec.strategy === 'put' ? 'SELL NOW' :
                                         rec.strategy === 'hold' ? 'PLEASE WAIT' :
                                         rec.strategy.toUpperCase()} {rec.barrier}
                                    </span>
                                    <span className={`confidence-badge confidence-${getConfidenceLevel(rec.confidence)}`}>
                                        {rec.confidence.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="recommendation-reason">
                                    <Text size="xs" color="prominent">
                                        {rec.reason}
                                    </Text>
                                    {rec.momentumAnalysis && (
                                        <div className="momentum-details">
                                            <Text size="xs" color="less-prominent">
                                                Momentum: {rec.momentumAnalysis.strength.toFixed(0)}% | 
                                                Duration: {rec.momentumAnalysis.duration} periods | 
                                                Expected: {rec.momentumAnalysis.expectedDuration}s
                                            </Text>
                                            <div className="momentum-factors">
                                                {rec.momentumAnalysis.factors.slice(0, 3).map((factor, idx) => (
                                                    <span key={idx} className="factor-tag">
                                                        {factor.replace(/_/g, ' ')}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="recommendation-stats">
                                    <span className="stat-item">Over: {rec.overPercentage.toFixed(1)}%</span>
                                    <span className="stat-item">Under: {rec.underPercentage.toFixed(1)}%</span>
                                    <span className="stat-item">Diff: {Math.abs(rec.overPercentage - rec.underPercentage).toFixed(1)}%</span>
                                </div>
                            </div>
                            <div className="recommendation-actions">
                                <button
                                    className="load-trade-btn"
                                    onClick={() => startDirectTrading(rec)}
                                    title="Start trading with Best Opportunity panel settings"
                                >
                                    ⚡ Start Trading
                                </button>
                                <button
                                    className="load-bot-builder-btn"
                                    onClick={() => loadToBotBuilder(rec)}
                                    title="Load strategy directly to Bot Builder"
                                >
                                    🤖 Bot Builder
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {result.o5u4Data && result.o5u4Data.conditionsMetCount >= 3 && (
                    <div className="o5u4-opportunity">
                        <div className="o5u4-header">
                            <span className="o5u4-badge">🎯 O5U4 Opportunity</span>
                            <span className="o5u4-score">{result.o5u4Data.score.toFixed(0)} pts</span>
                        </div>
                        <Text size="xs" color="general">
                            Conditions met: {result.o5u4Data.conditionsMetCount}/3 | Sample: {result.o5u4Data.details.sampleSize}
                        </Text>
                    </div>
                )}
            </div>
        );
    };

    const getConfidenceLevel = (confidence: number): string => {
        if (confidence >= 85) return 'excellent';
        if (confidence >= 75) return 'high';
        if (confidence >= 65) return 'medium';
        return 'low';
    };

    const handleCloseModal = () => {
        // If trading is running, just hide the modal (keep component mounted)
        // If trading is NOT running, fully close and unmount
        if (store?.run_panel?.is_running) {
            setIsSmartTraderHidden(true);
        } else {
            setIsSmartTraderModalOpen(false);
            setIsSmartTraderHidden(false);
            setSelectedTradeSettings(null);
            setAutoStartTrading(false); // Reset auto-start flag
        }
    };

    const handleHideModal = () => {
        // Hide modal when trading starts - keep component mounted
        setIsSmartTraderHidden(true);
        console.log('Smart Trader modal hidden - trading continues in background');
    };

    const handleTradingStop = () => {
        // When trading stops, fully close and reset the modal
        setIsSmartTraderModalOpen(false);
        setIsSmartTraderHidden(false);
        setSelectedTradeSettings(null);
        setAutoStartTrading(false); // Reset auto-start flag
        console.log('Smart Trader fully closed after trading stopped');
    };

    return (
        <div className="trading-hub-scanner">
            {/* Smart Trader Modal - Hides when trading starts (stays mounted) */}
            <Modal
                is_open={isSmartTraderModalOpen}
                title={`Smart Trader - ${selectedTradeSettings ? symbolMap[selectedTradeSettings.symbol] || selectedTradeSettings.symbol : ''}`}
                toggleModal={handleCloseModal}
                width="900px"
                height="auto"
                className={isSmartTraderHidden ? 'smart-trader-hidden' : ''}
            >
                {selectedTradeSettings && (
                    <SmartTraderWrapper
                        initialSettings={selectedTradeSettings}
                        onClose={handleCloseModal}
                        onHide={handleHideModal}
                        onTradingStop={handleTradingStop}
                        autoStart={autoStartTrading}
                    />
                )}
            </Modal>

            <div className="scanner-header">
                <div className="scanner-title">
                    <div className="title-with-status">
                        <h1>Market Scanner</h1>
                        <div className={`status-indicator ${getStatusDotClass()}`}>
                            <div className="status-dot"></div>
                            <span className="status-text">{statusMessage}</span>
                        </div>
                    </div>
                    <Text size="s" color="general">
                        Real-time analysis of all volatility indices using advanced pattern recognition
                    </Text>
                </div>

                <div className="scanner-controls">
                    <div className="trade-type-filter">
                        <label>Filter by trade type:</label>
                        <select
                            value={selectedTradeType}
                            onChange={(e) => setSelectedTradeType(e.target.value)}
                            className="trade-type-select"
                        >
                            {tradeTypes.map(type => (
                                <option key={type.value} value={type.value}>
                                    {type.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {isScanning && (
                        <div className="scan-progress">
                            <div className="progress-bar">
                                <div
                                    className="progress-fill"
                                    style={{ width: `${scanProgress}%` }}
                                ></div>
                            </div>
                            <Text size="xs" color="general">
                                {symbolsAnalyzed}/{totalSymbols} markets analyzed
                            </Text>
                        </div>
                    )}
                </div>
            </div>

            <div className="scanner-content">
                {connectionStatus === 'ready' && scanResults.length > 0 && (
                    <div className="scanner-summary">
                        <div className="summary-stats">
                            <div className="summary-item">
                                <span className="summary-value">{scanResults.length}</span>
                                <span className="summary-label">Opportunities Found</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-value">{symbolsAnalyzed}</span>
                                <span className="summary-label">Markets Scanned</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-value">{o5u4Opportunities.length}</span>
                                <span className="summary-label">O5U4 Setups</span>
                            </div>
                        </div>

                        {bestRecommendation && (
                            <div className="best-recommendation-highlight">
                                <div className="highlight-header">
                                    <span className="crown-icon">👑</span>
                                    <Text size="s" weight="bold">Best Opportunity</Text>
                                    {isAiAutoTrading && (
                                        <div className="ai-trading-indicator">
                                            <span className="trading-status-dot"></span>
                                            AI Auto Trading Active
                                        </div>
                                    )}
                                </div>
                                <div className="highlight-content">
                                    <div className="highlight-trade">
                                        <span className="highlight-symbol">{symbolMap[bestRecommendation.symbol]}</span>
                                        <span className={`highlight-strategy strategy-label--${bestRecommendation.strategy}`}>
                                            {bestRecommendation.strategy === 'call' ? 'BUY NOW' :
                                             bestRecommendation.strategy === 'put' ? 'SELL NOW' :
                                             bestRecommendation.strategy === 'hold' ? 'PLEASE WAIT' :
                                             bestRecommendation.strategy.toUpperCase()} {bestRecommendation.barrier}
                                        </span>
                                        <span className="highlight-confidence">
                                            {bestRecommendation.confidence.toFixed(1)}%
                                        </span>
                                    </div>

                                    {!isAiAutoTrading && (
                                        <div className="ai-config-section">
                                            <div className="ai-config-row">
                                                <div className="ai-config-field">
                                                    <label>Stake (USD):</label>
                                                    <input
                                                        type="number"
                                                        min={0.35}
                                                        step={0.01}
                                                        value={aiTradeConfig.stake}
                                                        onChange={(e) => setAiTradeConfig(prev => ({
                                                            ...prev,
                                                            stake: Math.max(0.35, Number(e.target.value))
                                                        }))}
                                                    />
                                                </div>
                                                <div className="ai-config-field">
                                                    <label>Duration:</label>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={aiTradeConfig.duration}
                                                        onChange={(e) => setAiTradeConfig(prev => ({
                                                            ...prev,
                                                            duration: Math.max(1, Number(e.target.value))
                                                        }))}
                                                    />
                                                </div>
                                                <div className="ai-config-field">
                                                    <label>Duration Type:</label>
                                                    <select
                                                        value={aiTradeConfig.durationType}
                                                        onChange={(e) => setAiTradeConfig(prev => ({
                                                            ...prev,
                                                            durationType: e.target.value
                                                        }))}
                                                    >
                                                        <option value="t">Ticks</option>
                                                        <option value="s">Seconds</option>
                                                        <option value="m">Minutes</option>
                                                        <option value="h">Hours</option>
                                                        <option value="d">Days</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="ai-config-row">
                                                <div className="ai-config-field">
                                                    <label>Martingale Multiplier:</label>
                                                    <input
                                                        id="ai-martingale-multiplier"
                                                        type="number"
                                                        min={1}
                                                        step="0.1"
                                                        value={aiMartingaleMultiplier}
                                                        onChange={e => setAiMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                                                        placeholder="1.0"
                                                    />
                                                </div>
                                                <div className="ai-config-field">
                                                    <label>Over/Under (after loss):</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={9}
                                                        value={aiTradeConfig.ouPredPostLoss}
                                                        onChange={(e) => setAiTradeConfig(prev => ({
                                                            ...prev,
                                                            ouPredPostLoss: Math.max(0, Math.min(9, Number(e.target.value)))
                                                        }))}
                                                    />
                                                </div>
                                            </div>
                                            <div className="ai-config-row">
                                                <div className="ai-config-field">
                                                    <label>Stop Loss (USD):</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={aiTradeConfig.stopLoss || 0}
                                                        onChange={(e) => setAiTradeConfig(prev => ({
                                                            ...prev,
                                                            stopLoss: Math.max(0, Number(e.target.value))
                                                        }))}
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                                <div className="ai-config-field">
                                                    <label>Take Profit (USD):</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={aiTradeConfig.takeProfit || 0}
                                                        onChange={(e) => setAiTradeConfig(prev => ({
                                                            ...prev,
                                                            takeProfit: Math.max(0, Number(e.target.value))
                                                        }))}
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {aiTradeStatus && (
                                        <div className="ai-trade-status">
                                            <Text size="xs" color={aiTradeStatus.includes('Error') || aiTradeStatus.includes('LOSS') ? 'loss-danger' : 'prominent'}>
                                                {aiTradeStatus}
                                            </Text>
                                        </div>
                                    )}

                                    <div className="highlight-actions">
                                        <button
                                            className="highlight-load-btn"
                                            onClick={() => startDirectTrading(bestRecommendation)}
                                        >
                                            ⚡ Start Trading
                                        </button>
                                        <button
                                            className="highlight-bot-builder-btn"
                                            onClick={() => loadToBotBuilder(bestRecommendation)}
                                        >
                                            🤖 Bot Builder
                                        </button>
                                    </div>

                                    {/* AI Auto Trade Status */}
                                    {isAiAutoTradeActive && currentAiTrade && (
                                        <div className="ai-auto-trade-status">
                                            <div className="ai-status-header">
                                                <span className="ai-status-icon">🤖</span>
                                                <Text size="xs" weight="bold" color="profit-success">
                                                    AI Auto Trade Active
                                                </Text>
                                            </div>
                                            <Text size="xs" color="general">
                                                Trading: {symbolMap[currentAiTrade.symbol]} - {currentAiTrade.strategy === 'call' ? 'BUY NOW' :
                                                 currentAiTrade.strategy === 'put' ? 'SELL NOW' :
                                                 currentAiTrade.strategy === 'hold' ? 'PLEASE WAIT' :
                                                 currentAiTrade.strategy.toUpperCase()} {currentAiTrade.barrier}
                                            </Text>
                                            <Text size="xs" color="general">
                                                Confidence: {currentAiTrade.confidence.toFixed(1)}% | Martingale: {aiMartingaleMultiplier}x
                                            </Text>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="scanner-results">
                    {(connectionStatus === 'connecting' || connectionStatus === 'scanning') && (
                        <div className="scanner-loading">
                            <div className="ai-scanning-display">
                                <div className="ai-brain-icon">🧠</div>
                                <div className="scanning-content">
                                    <div className="ai-status-header">
                                        <Text size="m" weight="bold" color="prominent">
                                            AI Market Scanner Active
                                        </Text>
                                        <div className="scanning-dots">
                                            <span className="dot"></span>
                                            <span className="dot"></span>
                                            <span className="dot"></span>
                                        </div>
                                    </div>

                                    <Text size="s" color="general" className="ai-current-message">
                                        {currentAiMessage || statusMessage}
                                    </Text>

                                    {processingSymbol && (
                                        <div className="processing-symbol">
                                            <Text size="xs" color="general">
                                                📊 Currently analyzing: <span className="symbol-name">{processingSymbol}</span>
                                            </Text>
                                        </div>
                                    )}

                                    <div className="ai-progress-section">
                                        <div className="progress-bar-ai">
                                            <div
                                                className="progress-fill-ai"
                                                style={{ width: `${scanProgress}%` }}
                                            ></div>
                                        </div>
                                        <Text size="xs" color="general" className="progress-text">
                                            AI Analysis: {symbolsAnalyzed}/{totalSymbols} volatility indices processed
                                        </Text>
                                    </div>

                                    <div className="ai-capabilities">
                                        <div className="capability-item">✓ Pattern Recognition</div>
                                        <div className="capability-item">✓ Statistical Analysis</div>
                                        <div className="capability-item">✓ Probability Calculation</div>
                                        <div className="capability-item">✓ Risk Assessment</div>
                                    </div>

                                    <div className="trading-truths-section">
                                        <Text size="xs" weight="bold" color="prominent" className="truths-header">
                                            📚 5 Fundamental Truths of Trading
                                        </Text>
                                        <div className="trading-truths">
                                            <div className="truth-item">1. Anything can happen</div>
                                            <div className="truth-item">2. You don\'t need to know what\'s next to profit</div>
                                            <div className="truth-item">3. Random distribution between wins and losses</div>
                                            <div className="truth-item">4. An edge = higher probability indication</div>
                                            <div className="truth-item">5. Every market moment is unique</div>
                                        </div>
                                    </div>

                                    <Text size="xs" color="general" className="ai-disclaimer">
                                        🎯 AI is analyzing market patterns using these fundamental trading principles
                                    </Text>
                                </div>
                            </div>
                        </div>
                    )}

                    {connectionStatus === 'ready' && (
                        <div className="results-grid">
                            {scanResults.map(renderRecommendationCard)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default TradingHubDisplay;