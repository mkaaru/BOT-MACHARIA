import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Modal from '@/components/shared_ui/modal';
import { localize } from '@deriv-com/translations';
import { contract_stages } from '@/constants/contract-stage';
import marketAnalyzer from '@/services/market-analyzer';
import SmartTraderWrapper from './smart-trader-wrapper';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import type { TradeRecommendation, MarketStats, O5U4Conditions } from '@/services/market-analyzer';
import './trading-hub-display.scss';

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
    barrier?: string;
    prediction?: number;
    stake: number;
    duration: number;
    durationType: string;
}

const TradingHubDisplay: React.FC = observer(() => {
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
    const [selectedTradeSettings, setSelectedTradeSettings] = useState<TradeSettings | null>(null);
    const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
    const [aiScanningPhase, setAiScanningPhase] = useState<'initializing' | 'analyzing' | 'evaluating' | 'recommending' | 'complete'>('initializing');
    const [currentAiMessage, setCurrentAiMessage] = useState('');
    const [processingSymbol, setProcessingSymbol] = useState<string>('');
    const [isAutoTradingBest, setIsAutoTradingBest] = useState(false);
    const [currentAutoTradeSettings, setCurrentAutoTradeSettings] = useState<TradeSettings | null>(null);
    const [activeToken, setActiveToken] = useState<string | null>(null);
    const [autoTradeCount, setAutoTradeCount] = useState(0);
    const [maxAutoTrades] = useState(5); // Maximum number of auto trades before switching
    const [autoTradeStake, setAutoTradeStake] = useState(0.5); // Default initial stake
    const [autoTradeMartingale, setAutoTradeMartingale] = useState(1); // Default martingale multiplier

    const [scannerError, setScannerError] = useState(null);
    const [bestOpportunity, setBestOpportunity] = useState(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const [autoTradeSettings, setAutoTradeSettings] = useState({
        isEnabled: false,
        stake: 1,
        maxStake: 100
    });

    const { run_panel: store } = useStore();
    const apiRef = useRef<any>(null);

    // Enhanced protection for trading hub
    useEffect(() => {
        const protectTradingHub = () => {
            // Disable dev tools detection
            let devtools = false;
            const interval = setInterval(() => {
                if (window.outerHeight - window.innerHeight > 200 || window.outerWidth - window.innerWidth > 200) {
                    if (!devtools) {
                        devtools = true;
                        // Hide sensitive content
                        const tradingElements = document.querySelectorAll('.trading-hub-scanner, .best-recommendation-highlight, .volatility-card');
                        tradingElements.forEach(el => {
                            if (el instanceof HTMLElement) {
                                el.style.visibility = 'hidden';
                            }
                        });
                    }
                } else {
                    if (devtools) {
                        devtools = false;
                        // Show content again
                        const tradingElements = document.querySelectorAll('.trading-hub-scanner, .best-recommendation-highlight, .volatility-card');
                        tradingElements.forEach(el => {
                            if (el instanceof HTMLElement) {
                                el.style.visibility = 'visible';
                            }
                        });
                    }
                }
            }, 1000);

            return () => clearInterval(interval);
        };

        const cleanup = protectTradingHub();
        return cleanup;
    }, []);

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
                setStatusMessage('Connecting to Deriv WebSocket API...');

                // Get active token for API instance
                const token = await V2GetActiveToken();
                setActiveToken(token);
                if (!token) {
                    throw new Error('No active token found');
                }
                const derivAPI = await generateDerivApiInstance(token);

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

                    // Enhanced AI scanning phases - Load interface after 5 markets
                    const progressPercentage = (readySymbolsCount / totalSymbols) * 100;

                    if (readySymbolsCount === 0) {
                        setAiScanningPhase('initializing');
                        setCurrentAiMessage(aiScanningMessages.initializing[0]);
                        setStatusMessage('🤖 AI initializing market analysis...');
                    } else if (readySymbolsCount < 5) {
                        // Keep scanning state until 5 markets are analyzed
                        setAiScanningPhase('analyzing');
                        const msgIndex = Math.floor((readySymbolsCount / 5) * aiScanningMessages.analyzing.length);
                        setCurrentAiMessage(aiScanningMessages.analyzing[Math.min(msgIndex, aiScanningMessages.analyzing.length - 1)]);
                        setStatusMessage(`🧠 AI analyzing patterns... ${readySymbolsCount}/5 markets ready`);
                        setConnectionStatus('scanning');

                        // Show which symbol is being processed
                        const symbols = Object.keys(currentStats);
                        if (symbols[readySymbolsCount - 1]) {
                            const currentSymbol = symbols[readySymbolsCount - 1];
                            const displayName = symbolMap[currentSymbol] || currentSymbol;
                            setProcessingSymbol(displayName);
                        }
                    } else if (readySymbolsCount === 5) {
                        // Switch to ready state after 5 markets are analyzed
                        setAiScanningPhase('complete');
                        setCurrentAiMessage('✅ AI analysis ready - 5 markets analyzed, loading interface...');
                        setStatusMessage('🚀 AI has identified trading opportunities - Interface loading...');
                        setConnectionStatus('ready');
                        setIsScanning(false);
                        setProcessingSymbol('');
                    } else if (progressPercentage < 40) {
                        setAiScanningPhase('analyzing');
                        const msgIndex = Math.floor((progressPercentage / 40) * aiScanningMessages.analyzing.length);
                        setCurrentAiMessage(aiScanningMessages.analyzing[Math.min(msgIndex, aiScanningMessages.analyzing.length - 1)]);
                        setStatusMessage(`🧠 AI analyzing patterns... ${readySymbolsCount}/${totalSymbols} markets`);
                        setConnectionStatus('scanning');

                        // Show which symbol is being processed
                        const symbols = Object.keys(currentStats);
                        if (symbols[readySymbolsCount - 1]) {
                            const currentSymbol = symbols[readySymbolsCount - 1];
                            const displayName = symbolMap[currentSymbol] || currentSymbol;
                            setProcessingSymbol(displayName);
                        }
                    } else if (progressPercentage < 80) {
                        setAiScanningPhase('evaluating');
                        const msgIndex = Math.floor(((progressPercentage - 40) / 40) * aiScanningMessages.evaluating.length);
                        setCurrentAiMessage(aiScanningMessages.evaluating[Math.min(msgIndex, aiScanningMessages.evaluating.length - 1)]);
                        setStatusMessage(`🤖 AI evaluating opportunities... ${readySymbolsCount}/${totalSymbols} complete`);
                    } else if (progressPercentage < 100) {
                        setAiScanningPhase('recommending');
                        setCurrentAiMessage(aiScanningMessages.recommending[0]);
                        setStatusMessage(`🎯 AI preparing recommendations... ${readySymbolsCount}/${totalSymbols} analyzed`);
                    } else {
                        setAiScanningPhase('complete');
                        setCurrentAiMessage('✅ AI analysis complete - Ready to trade!');
                        setStatusMessage('🚀 AI has identified the best trading opportunities');
                        setConnectionStatus('ready');
                        setIsScanning(false);
                        setProcessingSymbol('');
                    }
                });

                // Add error event listener
                const errorUnsubscribe = marketAnalyzer.onError((error) => {
                    console.error('Market analyzer error:', error);
                    setConnectionStatus('error');
                    setScannerError(error.message || 'Failed to connect to market data.');
                    setStatusMessage('Market data connection error. Attempting to reconnect...');
                });

                // Start the market analyzer
                marketAnalyzer.start();
                setIsScanning(true);
                setConnectionStatus('scanning');

                return () => {
                    unsubscribe();
                    errorUnsubscribe();
                    marketAnalyzer.stop();
                };

            } catch (error: any) {
                console.error('Failed to initialize market scanner:', error);
                setConnectionStatus('error');
                setScannerError(error.message || 'Failed to connect to market data. Please try again.');
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

    // Update scan results when data changes
    useEffect(() => {
        if (connectionStatus === 'ready') {
            setScanResults(generateScanResults());
        }
    }, [connectionStatus, generateScanResults]);

    // Monitor best recommendation changes for auto trading
    useEffect(() => {
        if (bestRecommendation && isAutoTradingBest && activeToken) {
            console.log("New recommendation detected, purchasing contract directly:", bestRecommendation);

            // Purchase contract directly without Smart Trader modal
            purchaseContractDirectly(bestRecommendation);
        }
    }, [bestRecommendation, isAutoTradingBest]);

    // Function to purchase contract directly based on recommendation
    const purchaseContractDirectly = async (recommendation: TradeRecommendation) => {
        if (!recommendation || !activeToken) return;

        try {
            console.log(`[${new Date().toISOString()}] Purchasing contract for recommendation:`, recommendation);

            // Set up run panel if not already running
            if (store) {
                if (!store.is_running) {
                    store.toggleDrawer(true);
                    store.setActiveTabIndex(1);
                    store.run_id = `auto-trade-${Date.now()}`;
                    store.setIsRunning(true);
                    store.setContractStage(contract_stages.STARTING);
                }
            }

            // Create API instance if needed
            if (!apiRef.current) {
                const { generateDerivApiInstance } = await import('@/external/bot-skeleton/services/api/appId');
                apiRef.current = await generateDerivApiInstance(activeToken);
            }

            // Authorize if needed
            const { authorize, error: authError } = await apiRef.current.authorize(activeToken);
            if (authError) {
                throw new Error(`Authorization failed: ${authError.message}`);
            }

            // Prepare trade parameters
            const tradeType = getTradeTypeForStrategy(recommendation.strategy);

            // Calculate stake based on auto trade count and martingale
            let currentStake = autoTradeStake;
            if (autoTradeCount > 0) {
                currentStake = autoTradeStake * Math.pow(autoTradeMartingale, autoTradeCount);
            }

            const trade_option: any = {
                amount: currentStake,
                basis: 'stake',
                contractTypes: [tradeType],
                currency: authorize?.currency || 'USD',
                duration: 1, // Default 1 tick
                duration_unit: 't',
                symbol: recommendation.symbol,
            };

            // Set prediction/barrier based on strategy
            if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
                trade_option.prediction = Number(recommendation.barrier);
            } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
                trade_option.prediction = Number(recommendation.barrier);
            }

            // Helper function to convert trade option to buy request
            const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
                const buy = {
                    buy: '1',
                    price: trade_option.amount,
                    parameters: {
                        amount: trade_option.amount,
                        basis: trade_option.basis,
                        contract_type,
                        currency: trade_option.currency,
                        duration: trade_option.duration,
                        duration_unit: trade_option.duration_unit,
                        symbol: trade_option.symbol,
                    },
                };
                if (trade_option.prediction !== undefined) {
                    buy.parameters.selected_tick = trade_option.prediction;
                }
                if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
                    buy.parameters.barrier = trade_option.prediction;
                }
                return buy;
            };

            const buy_req = tradeOptionToBuy(tradeType, trade_option);
            console.log('Sending purchase request:', buy_req);

            const { buy, error } = await apiRef.current.buy(buy_req);
            if (error) {
                throw new Error(`Purchase failed: ${error.message}`);
            }

            console.log(`✅ Contract purchased successfully:`, {
                contractId: buy?.contract_id,
                longcode: buy?.longcode,
                price: buy?.buy_price,
                recommendation: {
                    symbol: recommendation.symbol,
                    strategy: recommendation.strategy,
                    barrier: recommendation.barrier,
                    confidence: recommendation.confidence
                }
            });

            // Update transactions store
            if (store?.root_store?.transactions) {
                const symbol_display = symbolMap[recommendation.symbol] || recommendation.symbol;
                store.root_store.transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: authorize?.currency || 'USD',
                    contract_type: tradeType as any,
                    underlying: recommendation.symbol,
                    display_name: symbol_display,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            }

            // Update run panel
            if (store) {
                store.setHasOpenContract(true);
                store.setContractStage(contract_stages.PURCHASE_SENT);
            }

            // Monitor contract outcome
            monitorContract(buy?.contract_id, recommendation);

        } catch (error: any) {
            console.error('Direct contract purchase failed:', error);

            // Update status in UI
            setStatusMessage(`Purchase failed: ${error.message || 'Unknown error'}`);

            if (store) {
                store.setContractStage(contract_stages.NOT_RUNNING);
            }
        }
    };

    // Function to monitor contract outcome
    const monitorContract = async (contractId: string, recommendation: TradeRecommendation) => {
        if (!contractId || !apiRef.current) return;

        try {
            const res = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            });

            const { error, subscription } = res || {};
            if (error) throw error;

            const pocSubId = subscription?.id;
            const targetId = String(contractId);

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'proposal_open_contract') {
                        const poc = data.proposal_open_contract;

                        if (String(poc?.contract_id || '') === targetId) {
                            // Update transactions
                            if (store?.root_store?.transactions) {
                                store.root_store.transactions.onBotContractEvent(poc);
                            }

                            // Check if contract is finished
                            if (poc?.is_sold || poc?.status === 'sold') {
                                console.log(`Contract ${contractId} completed:`, {
                                    profit: poc?.profit,
                                    payout: poc?.payout,
                                    recommendation: {
                                        symbol: recommendation.symbol,
                                        strategy: recommendation.strategy,
                                        confidence: recommendation.confidence
                                    }
                                });

                                // Update auto trade count
                                setAutoTradeCount(prev => prev + 1);

                                // Cleanup subscription
                                if (pocSubId) {
                                    apiRef.current?.forget?.({ forget: pocSubId });
                                }
                                apiRef.current?.connection?.removeEventListener('message', onMsg);

                                // Update run panel
                                if (store) {
                                    store.setContractStage(contract_stages.CONTRACT_CLOSED);
                                    store.setHasOpenContract(false);
                                }

                                // Check if we should stop auto trading
                                if (autoTradeCount >= maxAutoTrades - 1) {
                                    console.log(`Reached max trades (${maxAutoTrades}), stopping auto trading`);
                                    stopAutoTradeBest();
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error processing contract update:', e);
                }
            };

            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (error) {
            console.error('Contract monitoring failed:', error);
        }
    };

    // Load trade settings to Smart Trader
    const loadTradeSettings = (recommendation: TradeRecommendation) => {
        const settings = {
            symbol: recommendation.symbol,
            tradeType: getTradeTypeForStrategy(recommendation.strategy),
            stake: 0.5,
            duration: 1,
            durationType: 't'
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

    // Helper function to map strategy to trade type
    const getTradeTypeForStrategy = (strategy: string): string => {
        const mapping: Record<string, string> = {
            'over': 'DIGITOVER',
            'under': 'DIGITUNDER',
            'even': 'DIGITEVEN',
            'odd': 'DIGITODD',
            'matches': 'DIGITMATCH',
            'differs': 'DIGITDIFF'
        };
        return mapping[strategy] || 'DIGITOVER';
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

    const renderVolatilityCard = (result: ScanResult) => {
        const bestRec = result.recommendations.reduce((best, current) =>
            current.confidence > (best?.confidence || 0) ? current : best, null);

        return (
            <div key={result.symbol} className="volatility-card">
                <div className="volatility-card-header">
                    <div className="volatility-symbol-info">
                        <div className="symbol-main">
                            <div className="symbol-icon">📊</div>
                            <div className="symbol-details">
                                <Text size="s" weight="bold" color="prominent">{result.displayName}</Text>
                                <div className="symbol-code">{result.symbol}</div>
                            </div>
                        </div>
                        <div className="market-status">
                            <div className="live-indicator">
                                <div className="pulse-dot"></div>
                                <span className="live-text">LIVE</span>
                            </div>
                            <div className="tick-counter">
                                <div className="tick-count-badge">
                                    <span className="tick-number">{result.stats.tickCount}</span>
                                    <span className="tick-label">ticks</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {bestRec && (
                        <div className="best-recommendation-banner">
                            <div className="crown-badge">👑</div>
                            <div className="best-rec-info">
                                <span className="best-rec-strategy">{bestRec.strategy.toUpperCase()} {bestRec.barrier}</span>
                                <span className="best-rec-confidence">{bestRec.confidence.toFixed(1)}%</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="volatility-recommendations-section">
                    <div className="recommendations-header">
                        <h4>🎯 Trading Opportunities</h4>
                        <div className="opportunities-count">{result.recommendations.length} found</div>
                    </div>

                    <div className="recommendations-grid">
                        {result.recommendations.map((rec, index) => (
                            <div key={index} className={`recommendation-card ${rec === bestRec ? 'best-recommendation' : ''}`}>
                                <div className="rec-card-header">
                                    <div className={`strategy-badge strategy-${rec.strategy}`}>
                                        <span className="strategy-icon">
                                            {rec.strategy === 'over' ? '↗️' : 
                                             rec.strategy === 'under' ? '↘️' : 
                                             rec.strategy === 'even' ? '🔢' : 
                                             rec.strategy === 'odd' ? '🎲' : 
                                             rec.strategy === 'matches' ? '🎯' : '↔️'}
                                        </span>
                                        <span className="strategy-text">{rec.strategy.toUpperCase()}</span>
                                        <span className="strategy-barrier">{rec.barrier}</span>
                                    </div>
                                    {rec === bestRec && (
                                        <div className="best-badge">
                                            <span>BEST</span>
                                        </div>
                                    )}
                                </div>

                                <div className="confidence-display">
                                    <div className="confidence-circle">
                                        <div className="confidence-inner">
                                            <span className="confidence-percent">{rec.confidence.toFixed(0)}%</span>
                                            <span className="confidence-text">confidence</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="market-breakdown">
                                    <div className="breakdown-stats">
                                        <div className="stat-item positive">
                                            <div className="stat-label">Over/Win</div>
                                            <div className="stat-value">{rec.overPercentage.toFixed(1)}%</div>
                                        </div>
                                        <div className="stat-item negative">
                                            <div className="stat-label">Under/Loss</div>
                                            <div className="stat-value">{rec.underPercentage.toFixed(1)}%</div>
                                        </div>
                                        <div className="stat-item difference">
                                            <div className="stat-label">Edge</div>
                                            <div className="stat-value">+{Math.abs(rec.overPercentage - rec.underPercentage).toFixed(1)}%</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="recommendation-reason">
                                    <div className="reason-text">{rec.reason}</div>
                                </div>

                                <div className="rec-card-actions">
                                    <button
                                        className={`load-trade-btn ${rec === bestRec ? 'primary' : 'secondary'}`}
                                        onClick={() => loadTradeSettings(rec)}
                                    >
                                        <span className="btn-icon">🚀</span>
                                        <span className="btn-text">Load Trade</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {result.o5u4Data && result.o5u4Data.conditionsMetCount >= 3 && (
                    <div className="special-strategy-banner">
                        <div className="special-strategy-content">
                            <div className="special-icon">🎯</div>
                            <div className="special-info">
                                <div className="special-title">O5U4 Advanced Strategy</div>
                                <div className="special-details">
                                    {result.o5u4Data.conditionsMetCount}/3 conditions • {result.o5u4Data.score.toFixed(0)} points
                                </div>
                            </div>
                            <div className="special-score">{result.o5u4Data.score.toFixed(0)}</div>
                        </div>
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
        setIsSmartTraderModalOpen(false);
        setSelectedTradeSettings(null);
    };

    // Auto trade best recommendation function
    const startAutoTradeBest = async () => {
        if (!activeToken) {
            setStatusMessage('No active token found. Please ensure you are logged in.');
            return;
        }

        console.log('Starting direct auto trading mode...');
        setIsAutoTradingBest(true);
        setAutoTradeCount(0); // Reset counter
        setStatusMessage('🤖 Auto trading started - purchasing contracts directly per recommendation');

        // Set up API connection
        try {
            apiRef.current = await generateDerivApiInstance(activeToken);
            console.log('API connection established for direct trading');
        } catch (error) {
            console.error('Failed to establish API connection:', error);
            setStatusMessage('Failed to connect to trading API');
            setIsAutoTradingBest(false);
        }
    };

    // Stop auto trading function
    const stopAutoTradeBest = () => {
        setIsAutoTradingBest(false);
        setCurrentAutoTradeSettings(null);
        setAutoTradeCount(0);
        setIsSmartTraderModalOpen(false);

        // Stop the run panel activity
        if (store) {
            store.setIsRunning(false);
            store.setHasOpenContract(false);
            store.setContractStage(contract_stages.NOT_RUNNING);
        }

        console.log("Auto trading stopped.");
    };

    const handleRetryConnection = useCallback(async () => {
        setIsRetrying(true);
        setScannerError(null);
        setConnectionStatus('connecting');
        setStatusMessage('Retrying connection...');

        try {
            // Check network connectivity first
            if (!navigator.onLine) {
                throw new Error('No internet connection. Please check your network settings.');
            }

            // Clear previous analyzer instance
            marketAnalyzer.stop();
            
            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Restart the analyzer
            marketAnalyzer.start();
            
            // Reset states
            setSymbolsAnalyzed(0);
            setScanProgress(0);
            setScanResults([]);
            setBestRecommendation(null);
            setO5u4Opportunities([]);
            
        } catch (error: any) {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const mobileHint = isMobile ? ' Try switching between WiFi and mobile data.' : '';
            setScannerError(`Connection failed: ${error.message}${mobileHint}`);
            setConnectionStatus('error');
            setStatusMessage('Connection failed. Please try again.');
        } finally {
            setIsRetrying(false);
        }
    }, []);

    const startScanning = useCallback(async () => {
        if (isScanning) return;

        setIsScanning(true);
        setScanResults([]);
        setScannerError(null);
        setScanProgress(0); // Use setScanProgress instead of setProgress

        try {
            // Simulate scanning process with better mobile handling
            setStatusMessage('Connecting to market data...');
            setProcessingSymbol('Connecting to market data...');

            // Check network connectivity first
            if (!navigator.onLine) {
                throw new Error('No internet connection detected');
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Mock scanning results
            const mockResults = generateMockScanResults(); // Assuming this function exists and is needed for the mock
            setScanResults(mockResults);

            // Find best opportunity
            const best = findBestOpportunity(mockResults); // Assuming this function exists and is needed for the mock
            setBestOpportunity(best);

        } catch (error: any) {
            setScannerError(error.message || 'Failed to scan markets');
            setStatusMessage('Market data connection error.');
        } finally {
            setIsScanning(false);
            setScanProgress(100); // Use setScanProgress instead of setProgress
        }
    }, [isScanning]);


    return (
        <div 
            className="trading-hub-scanner protected-content"
            onContextMenu={(e) => e.preventDefault()}
            onSelectStart={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
        >
            {/* Smart Trader Modal - Only show for manual trading */}
            <Modal
                is_open={isSmartTraderModalOpen && !isAutoTradingBest}
                title={`Smart Trader - ${selectedTradeSettings ? symbolMap[selectedTradeSettings.symbol] || selectedTradeSettings.symbol : ''}`}
                toggleModal={handleCloseModal}
                width="900px"
                height="auto"
            >
                {selectedTradeSettings && (
                    <SmartTraderWrapper
                        initialSettings={selectedTradeSettings}
                        onClose={handleCloseModal}
                        isAutoTrading={false}
                        onStopAutoTrade={stopAutoTradeBest}
                        onTradeComplete={(tradeCount) => {
                            setAutoTradeCount(tradeCount);
                            if (tradeCount >= maxAutoTrades) {
                                stopAutoTradeBest();
                            }
                        }}
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
                {connectionStatus === 'error' && (
                    <div className="scanner-error">
                        <div className="error-icon">⚠️</div>
                        <h3>Connection Error</h3>
                        <p>Failed to connect to market data. Please try again.</p>
                        <div className="error-details">
                            <p className="error-message">{scannerError}</p>
                            <p className="mobile-tip">
                                📱 On mobile? Try switching between WiFi and mobile data, or check your network signal.
                            </p>
                        </div>
                        <div className="retry-actions">
                            <button 
                                className="retry-btn primary"
                                onClick={handleRetryConnection}
                                disabled={isRetrying}
                            >
                                {isRetrying ? '🔄 Retrying...' : '🔄 Retry Connection'}
                            </button>
                            <button 
                                className="retry-btn secondary"
                                onClick={() => window.location.reload()}
                            >
                                🔄 Refresh Page
                            </button>
                        </div>
                    </div>
                )}

                {(connectionStatus === 'connecting' || connectionStatus === 'scanning') && (
                    <div className="scanner-loading">
                        <div className="loading-container">
                            <div className="loading-header">
                                <div className="brain-icon">🧠</div>
                                <Text size="l" weight="bold" color="prominent">
                                    AI Market Scanner Active
                                </Text>
                            </div>

                            <div className="loading-content">
                                <div className="scanner-icon">🔍</div>
                                <Text size="s" color="prominent" className="scanning-text">
                                    {currentAiMessage || `AI Analysis: ${symbolsAnalyzed}/${totalSymbols} volatility indices processed`}
                                </Text>

                                {processingSymbol && (
                                    <div className="processing-symbol">
                                        <Text size="s" color="general">Processing: {processingSymbol}</Text>
                                    </div>
                                )}

                                <div className="progress-section">
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

                                <div className="capabilities-list">
                                    <div className="capability-item">🎯 Pattern Recognition</div>
                                    <div className="capability-item">📊 Statistical Analysis</div>
                                    <div className="capability-item">⚡ Real-time Processing</div>
                                    <div className="capability-item">🛡️ Risk Assessment</div>
                                </div>

                                <div className="trading-principles">
                                    <Text size="s" weight="bold" color="prominent">
                                        📚 5 Fundamental Truths of Trading
                                    </Text>
                                    <div className="principles-list">
                                        <div className="principle">1. Anything can happen</div>
                                        <div className="principle">2. You don't need to know what happens next to profit</div>
                                        <div className="principle">3. Random distribution between wins and losses</div>
                                        <div className="principle">4. An edge = higher probability indication</div>
                                        <div className="principle">5. Every moment in the market is unique</div>
                                    </div>
                                </div>

                                <Text size="xs" color="general" className="disclaimer">
                                    🤖 AI is analyzing market patterns using these fundamental trading principles
                                </Text>
                            </div>
                        </div>
                    </div>
                )}

                {connectionStatus === 'ready' && scanResults.length === 0 && (
                    <div className="no-opportunities">
                        <div className="no-opportunities-icon">🔍</div>
                        <Text size="s" color="general">No trading opportunities found</Text>
                        <Text size="xs" color="general">
                            Market conditions don't meet our criteria for high-confidence trades.
                            The scanner will continue monitoring for new opportunities.
                        </Text>
                    </div>
                )}

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
                                    <div className="crown-section">
                                        <span className="crown-icon">👑</span>
                                        <Text size="s" weight="bold">Best Opportunity</Text>
                                    </div>
                                    <div className="ai-confidence-badge">
                                        <span className="ai-label">AI CONFIDENCE</span>
                                        <span className="confidence-value">{bestRecommendation.confidence.toFixed(1)}%</span>
                                    </div>
                                </div>
                                <div className="highlight-content">
                                    <div className="highlight-trade-section">
                                        <div className="highlight-trade">
                                            <div className="trade-symbol">
                                                <span className="symbol-name">{symbolMap[bestRecommendation.symbol]}</span>
                                                <span className="symbol-code">{bestRecommendation.symbol}</span>
                                            </div>
                                            <div className={`highlight-strategy strategy-badge--${bestRecommendation.strategy}`}>
                                                <span className="strategy-text">{bestRecommendation.strategy.toUpperCase()}</span>
                                                <span className="strategy-barrier">{bestRecommendation.barrier}</span>
                                            </div>
                                        </div>

                                        <div className="auto-trade-settings">
                                            <div className="settings-header">
                                                <span className="settings-icon">⚙️</span>
                                                <span className="settings-title">Auto Trade Settings</span>
                                            </div>
                                            <div className="settings-controls">
                                                <div className="control-group">
                                                    <label className="control-label">Initial Stake (USD)</label>
                                                    <input
                                                        type="number"
                                                        min="0.35"
                                                        step="0.01"
                                                        value={autoTradeStake}
                                                        onChange={(e) => setAutoTradeStake(Number(e.target.value))}
                                                        className="control-input"
                                                        disabled={isAutoTradingBest}
                                                        placeholder="0.50"
                                                    />
                                                </div>
                                                <div className="control-group">
                                                    <label className="control-label">Martingale Multiplier</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        step="0.1"
                                                        value={autoTradeMartingale}
                                                        onChange={(e) => setAutoTradeMartingale(Number(e.target.value))}
                                                        className="control-input"
                                                        disabled={isAutoTradingBest}
                                                        placeholder="1.0"
                                                    />
                                                </div>
                                            </div>
                                            <div className="current-stake-section">
                                                <label className="current-stake-label">Current Stake</label>
                                                <div className="current-stake-display">
                                                    ${autoTradeCount > 0 ? (autoTradeStake * Math.pow(autoTradeMartingale, autoTradeCount)).toFixed(2) : autoTradeStake.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="highlight-actions">
                                        <button
                                            className="highlight-load-btn"
                                            onClick={() => loadTradeSettings(bestRecommendation)}
                                        >
                                            <span className="btn-icon">🚀</span>
                                            <span className="btn-text">Load Best Trade</span>
                                        </button>
                                        <button
                                            className={`auto-trade-best-btn ${isAutoTradingBest ? 'auto-trading-active' : ''}`}
                                            onClick={() => isAutoTradingBest ? stopAutoTradeBest() : startAutoTradeBest()}
                                            disabled={!bestRecommendation}
                                        >
                                            <span className="btn-icon">{isAutoTradingBest ? '🛑' : '⚡'}</span>
                                            <span className="btn-text">
                                                {isAutoTradingBest ? `Stop Auto (${autoTradeCount}/${maxAutoTrades})` : 'Auto Trade Best'}
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {connectionStatus === 'ready' && scanResults.length > 0 && (
                    <div className="scanner-results">
                        <div className="volatility-cards-grid">
                            {scanResults.map(renderVolatilityCard)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

export default TradingHubDisplay;