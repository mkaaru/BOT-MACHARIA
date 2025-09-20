
import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { enhancedChartAnalyzer, VolatilityAnalysis, ChartAnalysis } from '@/services/enhanced-chart-analyzer';
import { tickStreamManager } from '@/services/tick-stream-manager';
import { candleReconstructionEngine } from '@/services/candle-reconstruction-engine';
import './chart-analyzer.scss';

interface TechnicalIndicatorProps {
    label: string;
    value: number | string;
    signal?: 'bullish' | 'bearish' | 'neutral';
    suffix?: string;
}

const TechnicalIndicator: React.FC<TechnicalIndicatorProps> = ({ label, value, signal, suffix = '' }) => (
    <div className={`technical-indicator ${signal || ''}`}>
        <div className="indicator-label">{label}</div>
        <div className="indicator-value">
            {typeof value === 'number' ? value.toFixed(4) : value}{suffix}
        </div>
    </div>
);

const RecommendationCard: React.FC<{ analysis: ChartAnalysis }> = ({ analysis }) => {
    const getActionColor = (action: string) => {
        switch (action) {
            case 'STRONG_BUY': return 'strong-buy';
            case 'BUY': return 'buy';
            case 'STRONG_SELL': return 'strong-sell';
            case 'SELL': return 'sell';
            default: return 'hold';
        }
    };

    return (
        <div className={`recommendation-card ${getActionColor(analysis.recommendation.action)}`}>
            <div className="recommendation-header">
                <div className="action">{analysis.recommendation.action.replace('_', ' ')}</div>
                <div className="confidence">{analysis.recommendation.confidence.toFixed(0)}%</div>
            </div>
            <div className="recommendation-reason">{analysis.recommendation.reason}</div>
            <div className="targets">
                <div className="target-item">
                    <span>Entry:</span> {analysis.recommendation.targets.entry.toFixed(5)}
                </div>
                <div className="target-item">
                    <span>Stop Loss:</span> {analysis.recommendation.targets.stopLoss.toFixed(5)}
                </div>
                <div className="target-item">
                    <span>Take Profit:</span> {analysis.recommendation.targets.takeProfit[0].toFixed(5)}
                </div>
            </div>
        </div>
    );
};

const ChartAnalyzer = observer(() => {
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [selectedTimeframe, setSelectedTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('15m');
    const [volatilityAnalyses, setVolatilityAnalyses] = useState<VolatilityAnalysis[]>([]);
    const [currentAnalysis, setCurrentAnalysis] = useState<ChartAnalysis | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [status, setStatus] = useState<string>('Initializing...');

    const initializeAnalyzer = useCallback(async () => {
        try {
            setStatus('Connecting to market data...');
            
            // Initialize tick stream manager
            await tickStreamManager.subscribeToAllVolatilities();
            
            // Set up candle reconstruction callbacks
            const volatilitySymbols = [
                'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
                '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
            ];
            
            volatilitySymbols.forEach(symbol => {
                // Add tick callback for real-time processing
                tickStreamManager.addTickCallback(symbol, (tick) => {
                    candleReconstructionEngine.processTick(tick);
                });
                
                // Add candle callback for analysis
                candleReconstructionEngine.addCandleCallback(symbol, (candle) => {
                    enhancedChartAnalyzer.processCandleData(candle);
                });
            });
            
            setStatus('Market data connected. Building analysis...');
            
            // Wait for initial data
            setTimeout(() => {
                setIsInitialized(true);
                setStatus('Analysis ready');
            }, 10000);
            
        } catch (error) {
            console.error('Failed to initialize chart analyzer:', error);
            setStatus(`Initialization failed: ${error}`);
        }
    }, []);

    const updateAnalyses = useCallback(() => {
        if (!isInitialized) return;
        
        try {
            const analyses = enhancedChartAnalyzer.getAllVolatilityAnalysis();
            setVolatilityAnalyses(analyses);
            
            // Update current analysis for selected symbol
            const currentSymbolAnalysis = analyses.find(a => a.symbol === selectedSymbol);
            if (currentSymbolAnalysis) {
                setCurrentAnalysis(currentSymbolAnalysis.analysis);
            }
        } catch (error) {
            console.error('Failed to update analyses:', error);
        }
    }, [isInitialized, selectedSymbol]);

    useEffect(() => {
        initializeAnalyzer();
        
        return () => {
            // Cleanup
            tickStreamManager.unsubscribeFromAll();
        };
    }, [initializeAnalyzer]);

    useEffect(() => {
        if (isInitialized) {
            updateAnalyses();
            
            // Update every 30 seconds
            const interval = setInterval(updateAnalyses, 30000);
            return () => clearInterval(interval);
        }
    }, [updateAnalyses, isInitialized]);

    const handleSymbolChange = (symbol: string) => {
        setSelectedSymbol(symbol);
        const analysis = volatilityAnalyses.find(a => a.symbol === symbol);
        if (analysis) {
            setCurrentAnalysis(analysis.analysis);
        }
    };

    return (
        <div className="chart-analyzer">
            <div className="analyzer-header">
                <Text size="lg" weight="bold">
                    {localize('Deriv Technical Analysis & Chart Analyzer')}
                </Text>
                <div className="status">{status}</div>
            </div>

            {!isInitialized ? (
                <div className="loading-state">
                    <Text size="sm">{localize('Initializing market data and technical analysis...')}</Text>
                    <div className="progress-bar">
                        <div className="progress-fill"></div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Symbol and Timeframe Selectors */}
                    <div className="controls">
                        <div className="control-group">
                            <label>{localize('Volatility Index')}</label>
                            <select 
                                value={selectedSymbol} 
                                onChange={(e) => handleSymbolChange(e.target.value)}
                                className="symbol-selector"
                            >
                                <optgroup label="Regular Volatilities">
                                    <option value="R_10">Volatility 10 Index</option>
                                    <option value="R_25">Volatility 25 Index</option>
                                    <option value="R_50">Volatility 50 Index</option>
                                    <option value="R_75">Volatility 75 Index</option>
                                    <option value="R_100">Volatility 100 Index</option>
                                </optgroup>
                                <optgroup label="1-Second Volatilities">
                                    <option value="1HZ10V">Volatility 10 (1s) Index</option>
                                    <option value="1HZ25V">Volatility 25 (1s) Index</option>
                                    <option value="1HZ50V">Volatility 50 (1s) Index</option>
                                    <option value="1HZ75V">Volatility 75 (1s) Index</option>
                                    <option value="1HZ100V">Volatility 100 (1s) Index</option>
                                </optgroup>
                            </select>
                        </div>
                        
                        <div className="control-group">
                            <label>{localize('Timeframe')}</label>
                            <select 
                                value={selectedTimeframe} 
                                onChange={(e) => setSelectedTimeframe(e.target.value as any)}
                                className="timeframe-selector"
                            >
                                <option value="1m">1 Minute</option>
                                <option value="5m">5 Minutes</option>
                                <option value="15m">15 Minutes</option>
                                <option value="1h">1 Hour</option>
                            </select>
                        </div>
                    </div>

                    {/* Current Symbol Analysis */}
                    {currentAnalysis && (
                        <div className="current-analysis">
                            <div className="analysis-header">
                                <Text size="md" weight="bold">
                                    {selectedSymbol} - {selectedTimeframe} Analysis
                                </Text>
                            </div>
                            
                            <div className="analysis-grid">
                                {/* Technical Indicators */}
                                <div className="indicators-panel">
                                    <Text size="sm" weight="bold">{localize('Technical Indicators')}</Text>
                                    
                                    <div className="indicators-grid">
                                        <TechnicalIndicator
                                            label="HMA 5"
                                            value={currentAnalysis.indicators.hma.hma5}
                                            signal={currentAnalysis.indicators.hma.crossover}
                                        />
                                        <TechnicalIndicator
                                            label="HMA 21"
                                            value={currentAnalysis.indicators.hma.hma21}
                                            signal={currentAnalysis.indicators.hma.crossover}
                                        />
                                        <TechnicalIndicator
                                            label="HMA 50"
                                            value={currentAnalysis.indicators.hma.hma50}
                                            signal={currentAnalysis.indicators.hma.crossover}
                                        />
                                        <TechnicalIndicator
                                            label="RSI (14)"
                                            value={currentAnalysis.indicators.rsi}
                                            signal={
                                                currentAnalysis.indicators.rsi < 30 ? 'bullish' :
                                                currentAnalysis.indicators.rsi > 70 ? 'bearish' : 'neutral'
                                            }
                                        />
                                        <TechnicalIndicator
                                            label="MACD"
                                            value={currentAnalysis.indicators.macd.macd}
                                            signal={
                                                currentAnalysis.indicators.macd.histogram > 0 ? 'bullish' :
                                                currentAnalysis.indicators.macd.histogram < 0 ? 'bearish' : 'neutral'
                                            }
                                        />
                                        <TechnicalIndicator
                                            label="MACD Signal"
                                            value={currentAnalysis.indicators.macd.signal}
                                        />
                                    </div>
                                </div>
                                
                                {/* Price Action */}
                                <div className="price-action-panel">
                                    <Text size="sm" weight="bold">{localize('Price Action')}</Text>
                                    
                                    <div className="price-levels">
                                        <div className="level resistance">
                                            <span>Resistance:</span>
                                            <span>{currentAnalysis.priceAction.resistance.toFixed(5)}</span>
                                        </div>
                                        <div className="level support">
                                            <span>Support:</span>
                                            <span>{currentAnalysis.priceAction.support.toFixed(5)}</span>
                                        </div>
                                        <div className="trend-info">
                                            <span>Trend:</span>
                                            <span className={`trend ${currentAnalysis.priceAction.trend}`}>
                                                {currentAnalysis.priceAction.trend.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="strength">
                                            <span>Strength:</span>
                                            <span>{currentAnalysis.priceAction.strength.toFixed(0)}%</span>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Recommendation */}
                                <div className="recommendation-panel">
                                    <Text size="sm" weight="bold">{localize('Trading Recommendation')}</Text>
                                    <RecommendationCard analysis={currentAnalysis} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* All Volatilities Overview */}
                    <div className="volatilities-overview">
                        <Text size="md" weight="bold">
                            {localize('All Volatilities - Ranked by Signal Strength')}
                        </Text>
                        
                        <div className="volatilities-grid">
                            {volatilityAnalyses.map((volAnalysis) => (
                                <div 
                                    key={volAnalysis.symbol}
                                    className={`volatility-card ${volAnalysis.symbol === selectedSymbol ? 'selected' : ''}`}
                                    onClick={() => handleSymbolChange(volAnalysis.symbol)}
                                >
                                    <div className="card-header">
                                        <Text size="xs" weight="bold">{volAnalysis.displayName}</Text>
                                        <div className="rank">#{volAnalysis.rank}</div>
                                    </div>
                                    
                                    <div className={`action ${volAnalysis.analysis.recommendation.action.toLowerCase().replace('_', '-')}`}>
                                        {volAnalysis.analysis.recommendation.action.replace('_', ' ')}
                                    </div>
                                    
                                    <div className="confidence">
                                        {volAnalysis.analysis.recommendation.confidence.toFixed(0)}% confidence
                                    </div>
                                    
                                    <div className="quick-indicators">
                                        <span className={`rsi ${
                                            volAnalysis.analysis.indicators.rsi < 30 ? 'oversold' :
                                            volAnalysis.analysis.indicators.rsi > 70 ? 'overbought' : 'neutral'
                                        }`}>
                                            RSI: {volAnalysis.analysis.indicators.rsi.toFixed(0)}
                                        </span>
                                        <span className={`trend ${volAnalysis.analysis.priceAction.trend}`}>
                                            {volAnalysis.analysis.priceAction.trend}
                                        </span>
                                    </div>
                                    
                                    <div className="score">Score: {volAnalysis.score.toFixed(0)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

export default ChartAnalyzer;
