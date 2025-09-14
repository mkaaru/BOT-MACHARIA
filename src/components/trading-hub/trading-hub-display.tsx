import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Modal from '@/components/shared_ui/modal';
import { localize } from '@deriv-com/translations';
import marketAnalyzer from '@/services/market-analyzer';
import SmartTraderWrapper from './smart-trader-wrapper';
import type { TradeRecommendation, MarketStats, O5U4Conditions } from '@/services/market-analyzer';
import { useStore } from '@/hooks/useStore';
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
    const { run_panel } = useStore();
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
    
    // Auto Trade Best states
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [autoTradeCount, setAutoTradeCount] = useState(0);
    const [maxAutoTrades] = useState(10);
    const [currentAutoContract, setCurrentAutoContract] = useState<any>(null);
    const [lastTradedRecommendation, setLastTradedRecommendation] = useState<string>('');
    const [autoTradeStake, setAutoTradeStake] = useState(0.5);
    const [tradingSocket, setTradingSocket] = useState<WebSocket | null>(null);

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

    // Cleanup auto trading on unmount
    useEffect(() => {
        return () => {
            if (isAutoTrading) {
                stopAutoTrading();
            }
        };
    }, [isAutoTrading, stopAutoTrading]);

    // Auto Trade Best functionality
    const initializeTradingSocket = useCallback(() => {
        if (tradingSocket) return tradingSocket;

        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
        
        ws.onopen = () => {
            console.log('✅ Trading WebSocket connected');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleTradingMessage(data);
        };

        ws.onerror = (error) => {
            console.error('❌ Trading WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('🔌 Trading WebSocket disconnected');
            setTradingSocket(null);
        };

        setTradingSocket(ws);
        return ws;
    }, [tradingSocket]);

    const handleTradingMessage = useCallback((data: any) => {
        if (data.error) {
            console.error('Trading API error:', data.error);
            return;
        }

        if (data.buy) {
            console.log('✅ Contract purchased:', data.buy);
            setCurrentAutoContract(data.buy);
            run_panel.setHasOpenContract(true);
            
            // Subscribe to contract updates
            const ws = tradingSocket;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: data.buy.contract_id,
                    subscribe: 1
                }));
            }
        }

        if (data.proposal_open_contract) {
            const contract = data.proposal_open_contract;
            console.log('📊 Contract update:', contract);
            
            if (contract.is_sold) {
                const profit = parseFloat(contract.profit || '0');
                const isWin = profit > 0;
                
                console.log(`🎯 Contract completed: ${isWin ? 'WIN' : 'LOSS'} - Profit: $${profit}`);
                
                setCurrentAutoContract(null);
                run_panel.setHasOpenContract(false);
                setAutoTradeCount(prev => prev + 1);
                
                // Check if should continue auto trading
                if (autoTradeCount + 1 >= maxAutoTrades) {
                    stopAutoTrading();
                } else {
                    // Wait a bit before next trade
                    setTimeout(() => {
                        if (isAutoTrading && bestRecommendation) {
                            executeAutoTrade(bestRecommendation);
                        }
                    }, 2000);
                }
            }
        }
    }, [tradingSocket, autoTradeCount, maxAutoTrades, isAutoTrading, bestRecommendation]);

    const executeAutoTrade = useCallback(async (recommendation: TradeRecommendation) => {
        if (!recommendation || !isAutoTrading) return;

        const ws = initializeTradingSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('❌ Trading socket not ready');
            return;
        }

        // Create unique identifier for this recommendation
        const recId = `${recommendation.symbol}-${recommendation.strategy}-${recommendation.barrier}-${recommendation.timestamp}`;
        
        // Skip if we already traded this exact recommendation
        if (recId === lastTradedRecommendation) {
            return;
        }

        const tradeTypeMap: Record<string, string> = {
            'over': 'DIGITOVER',
            'under': 'DIGITUNDER',
            'even': 'DIGITEVEN',
            'odd': 'DIGITODD',
            'matches': 'DIGITMATCH',
            'differs': 'DIGITDIFF'
        };

        const contractType = tradeTypeMap[recommendation.strategy];
        if (!contractType) {
            console.error('❌ Unknown strategy:', recommendation.strategy);
            return;
        }

        // Prepare purchase parameters
        const purchaseParams: any = {
            buy: 1,
            price: autoTradeStake,
            subscribe: 1,
            parameters: {
                contract_type: contractType,
                symbol: recommendation.symbol,
                duration: 1,
                duration_unit: 't'
            }
        };

        // Add barrier/prediction based on strategy
        if (recommendation.strategy === 'over' || recommendation.strategy === 'under') {
            purchaseParams.parameters.barrier = recommendation.barrier;
        } else if (recommendation.strategy === 'matches' || recommendation.strategy === 'differs') {
            purchaseParams.parameters.prediction = parseInt(recommendation.barrier);
        }

        try {
            console.log(`🚀 Auto trading: ${recommendation.strategy.toUpperCase()} ${recommendation.barrier} on ${symbolMap[recommendation.symbol]} (${recommendation.confidence.toFixed(1)}% confidence)`);
            
            ws.send(JSON.stringify(purchaseParams));
            setLastTradedRecommendation(recId);
            
        } catch (error) {
            console.error('❌ Failed to execute auto trade:', error);
        }
    }, [isAutoTrading, autoTradeStake, lastTradedRecommendation, initializeTradingSocket, symbolMap]);

    const startAutoTrading = useCallback(() => {
        if (isAutoTrading) return;
        
        setIsAutoTrading(true);
        setAutoTradeCount(0);
        setLastTradedRecommendation('');
        
        // Set run panel to indicate auto trading is active
        run_panel.setIsRunning(true);
        run_panel.run_id = `auto-trade-best-${Date.now()}`;
        
        console.log('🎯 Auto Trade Best started');
        
        // Execute first trade if best recommendation exists
        if (bestRecommendation) {
            executeAutoTrade(bestRecommendation);
        }
    }, [isAutoTrading, bestRecommendation, executeAutoTrade, run_panel]);

    const stopAutoTrading = useCallback(() => {
        if (!isAutoTrading) return;
        
        setIsAutoTrading(false);
        setCurrentAutoContract(null);
        setLastTradedRecommendation('');
        
        // Update run panel
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        
        if (tradingSocket) {
            tradingSocket.close();
            setTradingSocket(null);
        }
        
        console.log('🛑 Auto Trade Best stopped');
    }, [isAutoTrading, tradingSocket, run_panel]);

    // Auto execute trades when best recommendation changes
    useEffect(() => {
        if (isAutoTrading && bestRecommendation && !currentAutoContract) {
            const recId = `${bestRecommendation.symbol}-${bestRecommendation.strategy}-${bestRecommendation.barrier}-${bestRecommendation.timestamp}`;
            
            // Only trade if this is a new recommendation
            if (recId !== lastTradedRecommendation) {
                setTimeout(() => {
                    executeAutoTrade(bestRecommendation);
                }, 1000);
            }
        }
    }, [bestRecommendation, isAutoTrading, currentAutoContract, lastTradedRecommendation, executeAutoTrade]);

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
                                        {rec.strategy.toUpperCase()} {rec.barrier}
                                    </span>
                                    <span className={`confidence-badge confidence-${getConfidenceLevel(rec.confidence)}`}>
                                        {rec.confidence.toFixed(1)}%
                                    </span>
                                </div>
                                <Text size="xs" color="general" className="recommendation-reason">
                                    {rec.reason}
                                </Text>
                                <div className="recommendation-stats">
                                    <span className="stat-item">Over: {rec.overPercentage.toFixed(1)}%</span>
                                    <span className="stat-item">Under: {rec.underPercentage.toFixed(1)}%</span>
                                    <span className="stat-item">Diff: {Math.abs(rec.overPercentage - rec.underPercentage).toFixed(1)}%</span>
                                </div>
                            </div>
                            <button
                                className="load-trade-btn"
                                onClick={() => loadTradeSettings(rec)}
                                title="Load these settings into Smart Trader"
                            >
                                ⚡ Load
                            </button>
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
        setIsSmartTraderModalOpen(false);
        setSelectedTradeSettings(null);
    };

    return (
        <div className="trading-hub-scanner">
            {/* Smart Trader Modal */}
            <Modal
                is_open={isSmartTraderModalOpen}
                title={`Smart Trader - ${selectedTradeSettings ? symbolMap[selectedTradeSettings.symbol] || selectedTradeSettings.symbol : ''}`}
                toggleModal={handleCloseModal}
                width="900px"
                height="auto"
            >
                {selectedTradeSettings && (
                    <SmartTraderWrapper
                        initialSettings={selectedTradeSettings}
                        onClose={handleCloseModal}
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
                                    {isAutoTrading && (
                                        <div className="auto-trading-indicator">
                                            <span className="auto-trade-pulse"></span>
                                            <Text size="xs" color="prominent">Auto Trading Active ({autoTradeCount}/{maxAutoTrades})</Text>
                                        </div>
                                    )}
                                </div>
                                <div className="highlight-content">
                                    <div className="highlight-trade">
                                        <span className="highlight-symbol">{symbolMap[bestRecommendation.symbol]}</span>
                                        <span className={`highlight-strategy strategy-label--${bestRecommendation.strategy}`}>
                                            {bestRecommendation.strategy.toUpperCase()} {bestRecommendation.barrier}
                                        </span>
                                        <span className="highlight-confidence">
                                            {bestRecommendation.confidence.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="highlight-buttons">
                                        <button
                                            className="highlight-load-btn"
                                            onClick={() => loadTradeSettings(bestRecommendation)}
                                            disabled={isAutoTrading}
                                        >
                                            🚀 Load Best Trade
                                        </button>
                                        <button
                                            className={`auto-trade-btn ${isAutoTrading ? 'auto-trading-active' : ''}`}
                                            onClick={isAutoTrading ? stopAutoTrading : startAutoTrading}
                                            disabled={connectionStatus !== 'ready' || autoTradeCount >= maxAutoTrades}
                                        >
                                            {isAutoTrading ? (
                                                <>
                                                    🛑 Stop Auto Trade
                                                    {currentAutoContract && (
                                                        <span className="contract-status">
                                                            📊 Trading...
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                `⚡ Auto Trade Best`
                                            )}
                                        </button>
                                    </div>
                                    {isAutoTrading && (
                                        <div className="auto-trade-status">
                                            <Text size="xs" color="general">
                                                Stake: ${autoTradeStake} • {currentAutoContract ? 'Contract Active' : 'Monitoring for next opportunity'}
                                            </Text>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="scanner-results">
                    {connectionStatus === 'error' && (
                        <div className="scanner-error">
                            <div className="error-icon">⚠️</div>
                            <Text size="s" color="prominent">Connection Error</Text>
                            <Text size="xs" color="general">{statusMessage}</Text>
                            <button
                                className="retry-btn"
                                onClick={() => window.location.reload()}
                            >
                                Retry Connection
                            </button>
                        </div>
                    )}

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
                                            <div className="truth-item">2. You don't need to know what's next to profit</div>
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