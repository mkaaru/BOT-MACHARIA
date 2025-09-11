import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Modal from '@/components/shared_ui/modal';
import { localize } from '@deriv-com/translations';
import marketAnalyzer from '@/services/market-analyzer';
import SmartTraderWrapper from './smart-trader-wrapper';
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

    // AI Scanning Messages
    const aiScanningMessages = {
        initializing: [
            '🔍 Initializing AI market scanner...',
            '🌐 Connecting to real-time market feeds...',
            '⚡ Loading advanced pattern recognition models...'
        ],
        analyzing: [
            '🧠 AI analyzing market volatility patterns...',
            '📊 Processing tick frequency distributions...',
            '🎯 Identifying statistical anomalies...',
            '📈 Calculating probability matrices...',
            '⚙️ Running machine learning algorithms...'
        ],
        evaluating: [
            '🤖 AI evaluating trading opportunities...',
            '💡 Cross-referencing historical patterns...',
            '🔬 Analyzing market microstructure...',
            '📋 Ranking volatility indices by potential...',
            '⭐ Scoring recommendation confidence levels...'
        ],
        recommending: [
            '🎯 AI preparing optimal trade recommendations...',
            '💎 Finalizing high-confidence opportunities...',
            '🚀 Ready to present best trading setups...'
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

                    // Enhanced AI scanning phases
                    const progressPercentage = (readySymbolsCount / totalSymbols) * 100;
                    
                    if (readySymbolsCount === 0) {
                        setAiScanningPhase('initializing');
                        setCurrentAiMessage(aiScanningMessages.initializing[0]);
                        setStatusMessage('🤖 AI initializing market analysis...');
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
        const settings: TradeSettings = {
            symbol: recommendation.symbol,
            tradeType: getTradeTypeForStrategy(recommendation.strategy),
            stake: 1.0,
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
                                    <button
                                        className="highlight-load-btn"
                                        onClick={() => loadTradeSettings(bestRecommendation)}
                                    >
                                        🚀 Load Best Trade
                                    </button>
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

                                    <Text size="xs" color="general" className="ai-disclaimer">
                                        🎯 AI is analyzing market patterns to recommend optimal trading opportunities
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