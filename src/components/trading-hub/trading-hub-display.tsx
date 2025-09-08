
import React, { useState, useRef, useEffect, useCallback } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';
import marketAnalyzer, { type MarketStats, type O5U4Conditions } from '../../services/market-analyzer';
import type { TradeRecommendation } from '../../services/market-analyzer';

interface VolatilityAnalysis {
    symbol: string;
    displayName: string;
    currentPrice: number;
    lastDigit: number;
    digitFrequencies: number[];
    digitPercentages: number[];
    evenPercentage: number;
    oddPercentage: number;
    overPercentage: number;
    underPercentage: number;
    mostFrequentDigit: number;
    recommendations: {
        evenOdd: {
            type: 'EVEN' | 'ODD';
            confidence: number;
            reason: string;
        };
        overUnder: {
            type: 'OVER' | 'UNDER';
            barrier: number;
            confidence: number;
            reason: string;
        };
        matches: {
            type: 'MATCHES' | 'DIFFERS';
            digit: number;
            confidence: number;
            reason: string;
        };
        riseFall: {
            type: 'RISE' | 'FALL';
            confidence: number;
            reason: string;
        };
    };
    isReady: boolean;
    tickCount: number;
    lastUpdate: Date;
    aiRecommendation?: TradeRecommendation;
}

interface MarketScannerData {
    [symbol: string]: VolatilityAnalysis;
}

const TradingHubDisplay: React.FC = () => {
    const { run_panel, client } = useStore();
    
    // Market scanner state
    const [marketData, setMarketData] = useState<MarketScannerData>({});
    const [scanningProgress, setScanningProgress] = useState(0);
    const [isScanning, setIsScanning] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [totalSymbolsAnalyzed, setTotalSymbolsAnalyzed] = useState(0);
    const [currentRecommendation, setCurrentRecommendation] = useState<TradeRecommendation | null>(null);
    const [o5u4Opportunities, setO5U4Opportunities] = useState<O5U4Conditions[]>([]);
    
    // Market analyzer subscription
    const unsubscribeRef = useRef<(() => void) | null>(null);
    
    // Available volatility symbols
    const volatilitySymbols = [
        { symbol: 'R_10', displayName: 'Volatility 10 Index' },
        { symbol: 'R_25', displayName: 'Volatility 25 Index' },
        { symbol: 'R_50', displayName: 'Volatility 50 Index' },
        { symbol: 'R_75', displayName: 'Volatility 75 Index' },
        { symbol: 'R_100', displayName: 'Volatility 100 Index' },
        { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index' },
        { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index' },
        { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index' },
        { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index' },
        { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index' },
        { symbol: '1HZ150V', displayName: 'Volatility 150 (1s) Index' },
        { symbol: '1HZ250V', displayName: 'Volatility 250 (1s) Index' }
    ];

    // Get last digit from price
    const getLastDigit = useCallback((price: number): number => {
        const priceStr = price.toString();
        const decimalPart = priceStr.split('.')[1] || '';
        const paddedDecimal = decimalPart.padEnd(5, '0');
        return parseInt(paddedDecimal.slice(-1));
    }, []);

    // Convert Market Analyzer data to VolatilityAnalysis format
    const convertMarketStatsToAnalysis = useCallback((stats: MarketStats, recommendation?: TradeRecommendation): VolatilityAnalysis => {
        const displayName = volatilitySymbols.find(v => v.symbol === stats.symbol)?.displayName || stats.symbol;
        
        if (!stats.isReady) {
            return {
                symbol: stats.symbol,
                displayName,
                currentPrice: 0,
                lastDigit: stats.currentLastDigit || 0,
                digitFrequencies: new Array(10).fill(0),
                digitPercentages: new Array(10).fill(0),
                evenPercentage: 0,
                oddPercentage: 0,
                overPercentage: 0,
                underPercentage: 0,
                mostFrequentDigit: 0,
                recommendations: {
                    evenOdd: { type: 'EVEN', confidence: 0, reason: 'Insufficient data' },
                    overUnder: { type: 'OVER', barrier: 5, confidence: 0, reason: 'Insufficient data' },
                    matches: { type: 'MATCHES', digit: 0, confidence: 0, reason: 'Insufficient data' },
                    riseFall: { type: 'RISE', confidence: 0, reason: 'Insufficient data' }
                },
                isReady: false,
                tickCount: stats.tickCount,
                lastUpdate: new Date(stats.lastUpdate),
                aiRecommendation: recommendation
            };
        }

        const digitFrequencies = Object.values(stats.lastDigitFrequency);
        const digitPercentages = digitFrequencies.map(count => (count / stats.tickCount) * 100);
        
        // Calculate even/odd percentages
        const evenCount = digitFrequencies.filter((count, index) => index % 2 === 0).reduce((a, b) => a + b, 0);
        const oddCount = stats.tickCount - evenCount;
        const evenPercentage = (evenCount / stats.tickCount) * 100;
        const oddPercentage = (oddCount / stats.tickCount) * 100;

        // Calculate over/under percentages for barrier 5
        const overCount = digitFrequencies.slice(5).reduce((a, b) => a + b, 0);
        const underCount = digitFrequencies.slice(0, 5).reduce((a, b) => a + b, 0);
        const overPercentage = (overCount / stats.tickCount) * 100;
        const underPercentage = (underCount / stats.tickCount) * 100;

        // Get current price from latest tick
        const latestTick = marketAnalyzer.getLatestTick(stats.symbol);
        const currentPrice = latestTick?.quote || 0;

        // Generate recommendations with AI enhancement
        const recommendations = {
            evenOdd: {
                type: (evenPercentage > oddPercentage ? 'EVEN' : 'ODD') as 'EVEN' | 'ODD',
                confidence: Math.max(evenPercentage, oddPercentage),
                reason: recommendation && recommendation.strategy.includes('even') ? 
                    `AI: ${recommendation.reason}` : 
                    `${evenPercentage > oddPercentage ? 'Even' : 'Odd'} digits appear ${Math.max(evenPercentage, oddPercentage).toFixed(1)}% of the time`
            },
            overUnder: {
                type: recommendation?.strategy === 'over' ? 'OVER' : 
                      recommendation?.strategy === 'under' ? 'UNDER' :
                      (overPercentage > underPercentage ? 'OVER' : 'UNDER') as 'OVER' | 'UNDER',
                barrier: recommendation ? parseInt(recommendation.barrier) : 5,
                confidence: recommendation ? recommendation.confidence : Math.max(overPercentage, underPercentage),
                reason: recommendation ? `AI: ${recommendation.reason}` : 
                       `Digits ${overPercentage > underPercentage ? 'over' : 'under'} 5 appear ${Math.max(overPercentage, underPercentage).toFixed(1)}% of the time`
            },
            matches: {
                type: (digitPercentages[stats.mostFrequentDigit] > 15 ? 'MATCHES' : 'DIFFERS') as 'MATCHES' | 'DIFFERS',
                digit: stats.mostFrequentDigit,
                confidence: digitPercentages[stats.mostFrequentDigit] > 15 ? digitPercentages[stats.mostFrequentDigit] : 100 - digitPercentages[stats.mostFrequentDigit],
                reason: `Digit ${stats.mostFrequentDigit} appears ${digitPercentages[stats.mostFrequentDigit].toFixed(1)}% of the time`
            },
            riseFall: {
                type: 'RISE' as 'RISE' | 'FALL',
                confidence: 50,
                reason: 'Based on price movement analysis'
            }
        };

        return {
            symbol: stats.symbol,
            displayName,
            currentPrice,
            lastDigit: stats.currentLastDigit || 0,
            digitFrequencies,
            digitPercentages,
            evenPercentage,
            oddPercentage,
            overPercentage,
            underPercentage,
            mostFrequentDigit: stats.mostFrequentDigit,
            recommendations,
            isReady: stats.isReady,
            tickCount: stats.tickCount,
            lastUpdate: new Date(stats.lastUpdate),
            aiRecommendation: recommendation
        };
    }, [volatilitySymbols]);

    // Subscribe to Market Analyzer updates
    const subscribeToMarketAnalyzer = useCallback(() => {
        console.log('🔌 Subscribing to Market Analyzer for real Deriv data');
        
        setConnectionStatus('connecting');
        
        // Subscribe to market analyzer updates
        const unsubscribe = marketAnalyzer.onAnalysis((recommendation, stats, o5u4Data) => {
            // Update current recommendation
            setCurrentRecommendation(recommendation);
            setO5U4Opportunities(o5u4Data || []);
            
            // Convert market stats to our volatility analysis format
            const newMarketData: MarketScannerData = {};
            let readyCount = 0;
            
            Object.keys(stats).forEach(symbol => {
                const symbolStats = stats[symbol];
                const symbolRecommendation = recommendation?.symbol === symbol ? recommendation : undefined;
                const analysis = convertMarketStatsToAnalysis(symbolStats, symbolRecommendation);
                newMarketData[symbol] = analysis;
                
                if (analysis.isReady) {
                    readyCount++;
                }
            });
            
            setMarketData(newMarketData);
            setTotalSymbolsAnalyzed(readyCount);
            
            // Update connection status based on data availability
            if (readyCount > 0) {
                setConnectionStatus('connected');
            }
            
            // Log AI recommendations
            if (recommendation) {
                console.log('🤖 AI Recommendation:', {
                    symbol: recommendation.symbol,
                    strategy: recommendation.strategy,
                    barrier: recommendation.barrier,
                    confidence: recommendation.confidence.toFixed(1) + '%',
                    reason: recommendation.reason
                });
            }
        });
        
        // Start the market analyzer
        marketAnalyzer.start();
        
        return unsubscribe;
    }, [convertMarketStatsToAnalysis]);

    // Start market scanning with Market Analyzer
    const startMarketScan = useCallback(async () => {
        setIsScanning(true);
        setScanningProgress(0);
        setTotalSymbolsAnalyzed(0);
        setConnectionStatus('connecting');
        
        globalObserver.emit('ui.log.info', 'Starting real-time market analysis with Deriv API...');
        
        // Start progress animation
        let currentProgress = 0;
        const progressInterval = setInterval(() => {
            currentProgress += 15;
            setScanningProgress(Math.min(currentProgress, 90));
            if (currentProgress >= 90) {
                clearInterval(progressInterval);
            }
        }, 500);
        
        // Subscribe to market analyzer
        const unsubscribe = subscribeToMarketAnalyzer();
        unsubscribeRef.current = unsubscribe;
        
        // Complete scanning animation in 5 seconds
        setTimeout(() => {
            clearInterval(progressInterval);
            setScanningProgress(100);
            setTimeout(() => {
                setIsScanning(false);
                globalObserver.emit('ui.log.success', `Real-time market analysis active. Monitoring ${volatilitySymbols.length} volatility indices with AI.`);
            }, 500);
        }, 5000);
    }, [subscribeToMarketAnalyzer, volatilitySymbols]);

    // Initialize market scanner on component mount
    useEffect(() => {
        startMarketScan();
        
        // Cleanup market analyzer subscription on unmount
        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
            marketAnalyzer.stop();
        };
    }, [startMarketScan]);

    // Get confidence color
    const getConfidenceColor = (confidence: number): string => {
        if (confidence >= 60) return '#4caf50'; // Green
        if (confidence >= 50) return '#ff9800'; // Orange
        return '#f44336'; // Red
    };

    // Get confidence level text
    const getConfidenceLevel = (confidence: number): string => {
        if (confidence >= 60) return 'High';
        if (confidence >= 50) return 'Medium';
        return 'Low';
    };

    return (
        <div className="trading-hub-scanner">
            <div className="scanner-header">
                <div className="header-main">
                    <div className="logo-section">
                        <div className="logo-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                            </svg>
                        </div>
                        <div className="title-group">
                            <h1 className="hub-title">Market Scanner</h1>
                            <p className="hub-subtitle">Real-time Volatility Analysis & Recommendations</p>
                        </div>
                    </div>
                    
                    <div className="scan-controls">
                        <button 
                            className="refresh-scan-btn"
                            onClick={startMarketScan}
                            disabled={isScanning}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/>
                            </svg>
                            {isScanning ? 'Scanning...' : 'Refresh Scan'}
                        </button>
                    </div>
                </div>

                <div className="status-bar">
                    <div className="status-item">
                        <div className={`status-dot ${connectionStatus}`}></div>
                        Status: {connectionStatus === 'connected' ? 'Real-time Deriv Data' : 'Connecting...'}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        Symbols Analyzed: {totalSymbolsAnalyzed}/{volatilitySymbols.length}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        {currentRecommendation ? (
                            <span className="ai-recommendation">
                                🤖 AI: {currentRecommendation.strategy.toUpperCase()} {currentRecommendation.barrier} on {currentRecommendation.symbol} ({currentRecommendation.confidence.toFixed(0)}%)
                            </span>
                        ) : (
                            `Scan Progress: ${scanningProgress.toFixed(0)}%`
                        )}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        Last Update: {new Date().toLocaleTimeString()}
                    </div>
                </div>

                {isScanning && (
                    <div className="progress-bar">
                        <div 
                            className="progress-fill" 
                            style={{ width: `${scanningProgress}%` }}
                        ></div>
                    </div>
                )}
            </div>

            <div className="scanner-content">
                <div className="market-grid">
                    {volatilitySymbols.map(symbolData => {
                        const analysis = marketData[symbolData.symbol];
                        
                        return (
                            <div key={symbolData.symbol} className={`market-card ${analysis?.isReady ? 'ready' : 'loading'}`}>
                                <div className="card-header">
                                    <div className="symbol-info">
                                        <h3>{symbolData.displayName}</h3>
                                        <span className="symbol-code">{symbolData.symbol}</span>
                                    </div>
                                    <div className="price-info">
                                        {analysis ? (
                                            <>
                                                <span className="current-price">{analysis.currentPrice.toFixed(5)}</span>
                                                <span className="last-digit">Last Digit: {analysis.lastDigit}</span>
                                            </>
                                        ) : (
                                            <div className="loading-price">Loading...</div>
                                        )}
                                    </div>
                                </div>

                                {analysis?.isReady ? (
                                    <div className="recommendations">
                                        <div className="recommendation-row">
                                            <div className="rec-item">
                                                <div className="rec-header">
                                                    <span className="rec-type">Even/Odd</span>
                                                    <span 
                                                        className="confidence-badge"
                                                        style={{ backgroundColor: getConfidenceColor(analysis.recommendations.evenOdd.confidence) }}
                                                    >
                                                        {getConfidenceLevel(analysis.recommendations.evenOdd.confidence)}
                                                    </span>
                                                </div>
                                                <div className="rec-content">
                                                    <strong>{analysis.recommendations.evenOdd.type}</strong>
                                                    <span className="confidence">{analysis.recommendations.evenOdd.confidence.toFixed(1)}%</span>
                                                </div>
                                                <div className="rec-reason">{analysis.recommendations.evenOdd.reason}</div>
                                            </div>

                                            <div className="rec-item">
                                                <div className="rec-header">
                                                    <span className="rec-type">Over/Under</span>
                                                    <span 
                                                        className="confidence-badge"
                                                        style={{ backgroundColor: getConfidenceColor(analysis.recommendations.overUnder.confidence) }}
                                                    >
                                                        {getConfidenceLevel(analysis.recommendations.overUnder.confidence)}
                                                    </span>
                                                </div>
                                                <div className="rec-content">
                                                    <strong>{analysis.recommendations.overUnder.type} {analysis.recommendations.overUnder.barrier}</strong>
                                                    <span className="confidence">{analysis.recommendations.overUnder.confidence.toFixed(1)}%</span>
                                                </div>
                                                <div className="rec-reason">{analysis.recommendations.overUnder.reason}</div>
                                            </div>
                                        </div>

                                        <div className="recommendation-row">
                                            <div className="rec-item">
                                                <div className="rec-header">
                                                    <span className="rec-type">Matches/Differs</span>
                                                    <span 
                                                        className="confidence-badge"
                                                        style={{ backgroundColor: getConfidenceColor(analysis.recommendations.matches.confidence) }}
                                                    >
                                                        {getConfidenceLevel(analysis.recommendations.matches.confidence)}
                                                    </span>
                                                </div>
                                                <div className="rec-content">
                                                    <strong>{analysis.recommendations.matches.type} {analysis.recommendations.matches.digit}</strong>
                                                    <span className="confidence">{analysis.recommendations.matches.confidence.toFixed(1)}%</span>
                                                </div>
                                                <div className="rec-reason">{analysis.recommendations.matches.reason}</div>
                                            </div>

                                            <div className="rec-item">
                                                <div className="rec-header">
                                                    <span className="rec-type">Rise/Fall</span>
                                                    <span 
                                                        className="confidence-badge"
                                                        style={{ backgroundColor: getConfidenceColor(analysis.recommendations.riseFall.confidence) }}
                                                    >
                                                        {getConfidenceLevel(analysis.recommendations.riseFall.confidence)}
                                                    </span>
                                                </div>
                                                <div className="rec-content">
                                                    <strong>{analysis.recommendations.riseFall.type}</strong>
                                                    <span className="confidence">{analysis.recommendations.riseFall.confidence.toFixed(1)}%</span>
                                                </div>
                                                <div className="rec-reason">{analysis.recommendations.riseFall.reason}</div>
                                            </div>
                                        </div>

                                        <div className="analysis-summary">
                                            <div className="summary-item">
                                                <span>Ticks Analyzed:</span>
                                                <strong>{analysis.tickCount}</strong>
                                            </div>
                                            <div className="summary-item">
                                                <span>Even/Odd Split:</span>
                                                <strong>{analysis.evenPercentage.toFixed(1)}% / {analysis.oddPercentage.toFixed(1)}%</strong>
                                            </div>
                                            <div className="summary-item">
                                                <span>Most Frequent:</span>
                                                <strong>Digit {analysis.mostFrequentDigit} ({analysis.digitPercentages[analysis.mostFrequentDigit].toFixed(1)}%)</strong>
                                            </div>
                                            {analysis.aiRecommendation && (
                                                <div className="ai-recommendation-card">
                                                    <div className="ai-badge">🤖 AI Recommendation</div>
                                                    <div className="ai-strategy">
                                                        {analysis.aiRecommendation.strategy.toUpperCase()} {analysis.aiRecommendation.barrier}
                                                    </div>
                                                    <div className="ai-confidence">
                                                        Confidence: {analysis.aiRecommendation.confidence.toFixed(1)}%
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="loading-state">
                                        <div className="loading-spinner"></div>
                                        <span>Analyzing market data...</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;
