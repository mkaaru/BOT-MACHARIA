
import React, { useState, useRef, useEffect, useCallback } from 'react';
import './trading-hub-display.scss';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';

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
    
    // WebSocket connections for each symbol
    const wsConnections = useRef<{ [symbol: string]: WebSocket }>({});
    const tickData = useRef<{ [symbol: string]: number[] }>({});
    
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

    // Analyze volatility data and generate recommendations
    const analyzeVolatility = useCallback((symbol: string, ticks: number[]): VolatilityAnalysis => {
        const displayName = volatilitySymbols.find(v => v.symbol === symbol)?.displayName || symbol;
        
        if (ticks.length < 20) { // Reduced from 50 to 20 for faster readiness
            return {
                symbol,
                displayName,
                currentPrice: ticks[ticks.length - 1] || 0,
                lastDigit: ticks.length > 0 ? getLastDigit(ticks[ticks.length - 1]) : 0,
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
                tickCount: ticks.length,
                lastUpdate: new Date()
            };
        }

        // Get last digits for analysis
        const lastDigits = ticks.map(tick => getLastDigit(tick));
        
        // Calculate digit frequencies
        const digitFrequencies = new Array(10).fill(0);
        lastDigits.forEach(digit => {
            digitFrequencies[digit]++;
        });

        const digitPercentages = digitFrequencies.map(count => (count / lastDigits.length) * 100);
        
        // Even/Odd analysis
        const evenCount = digitFrequencies.filter((count, index) => index % 2 === 0).reduce((a, b) => a + b, 0);
        const oddCount = lastDigits.length - evenCount;
        const evenPercentage = (evenCount / lastDigits.length) * 100;
        const oddPercentage = (oddCount / lastDigits.length) * 100;

        // Over/Under analysis (using barrier 5)
        const overCount = digitFrequencies.slice(5).reduce((a, b) => a + b, 0);
        const underCount = digitFrequencies.slice(0, 5).reduce((a, b) => a + b, 0);
        const overPercentage = (overCount / lastDigits.length) * 100;
        const underPercentage = (underCount / lastDigits.length) * 100;

        // Find most frequent digit
        let mostFrequentDigit = 0;
        let maxCount = digitFrequencies[0];
        for (let i = 1; i < 10; i++) {
            if (digitFrequencies[i] > maxCount) {
                maxCount = digitFrequencies[i];
                mostFrequentDigit = i;
            }
        }

        // Rise/Fall analysis
        let riseCount = 0;
        let fallCount = 0;
        for (let i = 1; i < ticks.length; i++) {
            if (ticks[i] > ticks[i - 1]) riseCount++;
            else if (ticks[i] < ticks[i - 1]) fallCount++;
        }
        const risePercentage = (riseCount / (ticks.length - 1)) * 100;
        const fallPercentage = (fallCount / (ticks.length - 1)) * 100;

        // Generate recommendations
        const recommendations = {
            evenOdd: {
                type: (evenPercentage > oddPercentage ? 'EVEN' : 'ODD') as 'EVEN' | 'ODD',
                confidence: Math.max(evenPercentage, oddPercentage),
                reason: `${evenPercentage > oddPercentage ? 'Even' : 'Odd'} digits appear ${Math.max(evenPercentage, oddPercentage).toFixed(1)}% of the time`
            },
            overUnder: {
                type: (overPercentage > underPercentage ? 'OVER' : 'UNDER') as 'OVER' | 'UNDER',
                barrier: 5,
                confidence: Math.max(overPercentage, underPercentage),
                reason: `Digits ${overPercentage > underPercentage ? 'over' : 'under'} 5 appear ${Math.max(overPercentage, underPercentage).toFixed(1)}% of the time`
            },
            matches: {
                type: (digitPercentages[mostFrequentDigit] > 15 ? 'MATCHES' : 'DIFFERS') as 'MATCHES' | 'DIFFERS',
                digit: mostFrequentDigit,
                confidence: digitPercentages[mostFrequentDigit] > 15 ? digitPercentages[mostFrequentDigit] : 100 - digitPercentages[mostFrequentDigit],
                reason: `Digit ${mostFrequentDigit} appears ${digitPercentages[mostFrequentDigit].toFixed(1)}% of the time`
            },
            riseFall: {
                type: (risePercentage > fallPercentage ? 'RISE' : 'FALL') as 'RISE' | 'FALL',
                confidence: Math.max(risePercentage, fallPercentage),
                reason: `Price ${risePercentage > fallPercentage ? 'rises' : 'falls'} ${Math.max(risePercentage, fallPercentage).toFixed(1)}% of the time`
            }
        };

        return {
            symbol,
            displayName,
            currentPrice: ticks[ticks.length - 1],
            lastDigit: lastDigits[lastDigits.length - 1],
            digitFrequencies,
            digitPercentages,
            evenPercentage,
            oddPercentage,
            overPercentage,
            underPercentage,
            mostFrequentDigit,
            recommendations,
            isReady: true,
            tickCount: ticks.length,
            lastUpdate: new Date()
        };
    }, [getLastDigit, volatilitySymbols]);

    // Connect to WebSocket for a specific symbol
    const connectToSymbol = useCallback((symbol: string) => {
        if (wsConnections.current[symbol]) {
            wsConnections.current[symbol].close();
        }

        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
        wsConnections.current[symbol] = ws;

        ws.onopen = () => {
            console.log(`Connected to ${symbol}`);
            // Request smaller tick history for faster loading
            ws.send(JSON.stringify({
                ticks_history: symbol,
                count: 50, // Reduced from 100 to 50 for faster response
                end: 'latest',
                style: 'ticks',
                subscribe: 1
            }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.history) {
                // Process historical ticks
                const prices = data.history.prices.map((price: string) => parseFloat(price));
                tickData.current[symbol] = prices;
                
                // Analyze and update market data
                const analysis = analyzeVolatility(symbol, prices);
                setMarketData(prev => ({
                    ...prev,
                    [symbol]: analysis
                }));
                
                setTotalSymbolsAnalyzed(prev => {
                    const newCount = prev + 1;
                    // Update progress based on symbols analyzed if still scanning
                    if (newCount <= volatilitySymbols.length) {
                        const progressPercent = Math.max(
                            (newCount / volatilitySymbols.length) * 90, // Cap at 90%
                            currentProgress
                        );
                        setScanningProgress(progressPercent);
                    }
                    return newCount;
                });
                
                // If all symbols are analyzed and ready, complete faster
                if (Object.keys(marketData).length + 1 >= volatilitySymbols.length) {
                    setTimeout(() => {
                        if (isScanning) {
                            setScanningProgress(100);
                            setTimeout(() => {
                                setIsScanning(false);
                                globalObserver.emit('ui.log.success', `Market scan completed. Analyzing ${volatilitySymbols.length} volatility indices.`);
                            }, 300);
                        }
                    }, 500);
                }
            } else if (data.tick && data.tick.symbol === symbol) {
                // Process live tick
                if (!tickData.current[symbol]) {
                    tickData.current[symbol] = [];
                }
                
                tickData.current[symbol].push(parseFloat(data.tick.quote));
                
                // Keep only last 100 ticks
                if (tickData.current[symbol].length > 100) {
                    tickData.current[symbol].shift();
                }
                
                // Re-analyze with new tick
                const analysis = analyzeVolatility(symbol, tickData.current[symbol]);
                setMarketData(prev => ({
                    ...prev,
                    [symbol]: analysis
                }));
            }
        };

        ws.onerror = (error) => {
            console.error(`WebSocket error for ${symbol}:`, error);
        };

        ws.onclose = () => {
            console.log(`Disconnected from ${symbol}`);
        };
    }, [analyzeVolatility]);

    // Start market scanning
    const startMarketScan = useCallback(async () => {
        setIsScanning(true);
        setScanningProgress(0);
        setTotalSymbolsAnalyzed(0);
        setConnectionStatus('connecting');
        
        globalObserver.emit('ui.log.info', 'Starting market scan across all volatilities...');
        
        // Start progress animation immediately
        let currentProgress = 0;
        const progressInterval = setInterval(() => {
            currentProgress += 10;
            setScanningProgress(Math.min(currentProgress, 90));
            if (currentProgress >= 90) {
                clearInterval(progressInterval);
            }
        }, 800); // Update every 800ms to reach 90% in 8 seconds
        
        // Connect to all symbols with reduced delay
        volatilitySymbols.forEach((symbolData, index) => {
            setTimeout(() => {
                connectToSymbol(symbolData.symbol);
            }, index * 100); // Reduced stagger to 100ms instead of 500ms
        });
        
        setConnectionStatus('connected');
        
        // Complete scanning in exactly 9 seconds
        setTimeout(() => {
            clearInterval(progressInterval);
            setScanningProgress(100);
            setTimeout(() => {
                setIsScanning(false);
                globalObserver.emit('ui.log.success', `Market scan completed. Analyzing ${volatilitySymbols.length} volatility indices.`);
            }, 500);
        }, 9000); // Complete in 9 seconds total
    }, [connectToSymbol, volatilitySymbols]);

    // Initialize market scanner on component mount
    useEffect(() => {
        startMarketScan();
        
        // Cleanup WebSocket connections on unmount
        return () => {
            Object.values(wsConnections.current).forEach(ws => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            });
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
                        Status: {connectionStatus === 'connected' ? 'Connected' : 'Connecting...'}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        Symbols Analyzed: {totalSymbolsAnalyzed}/{volatilitySymbols.length}
                    </div>
                    <div className="status-separator"></div>
                    <div className="status-item">
                        Scan Progress: {scanningProgress.toFixed(0)}%
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
