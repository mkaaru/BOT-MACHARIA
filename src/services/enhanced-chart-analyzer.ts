
import { TickData, CandleData } from './tick-stream-manager';
import { TrendAnalysis, TrendAnalysisEngine } from './trend-analysis-engine';
import { efficientHMACalculator } from './efficient-hma-calculator';
import { ehlersProcessor } from './ehlers-signal-processing';

export interface ChartAnalysis {
    symbol: string;
    timeframe: '1m' | '5m' | '15m' | '1h';
    indicators: {
        hma: {
            hma5: number;
            hma21: number;
            hma50: number;
            crossover: 'bullish' | 'bearish' | 'neutral';
        };
        rsi: number;
        macd: {
            macd: number;
            signal: number;
            histogram: number;
        };
        ehlers: {
            cycle: number;
            trend: number;
            signal: 'buy' | 'sell' | 'hold';
        };
    };
    priceAction: {
        support: number;
        resistance: number;
        trend: 'uptrend' | 'downtrend' | 'sideways';
        strength: number; // 0-100
    };
    recommendation: {
        action: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
        confidence: number; // 0-100
        reason: string;
        targets: {
            entry: number;
            stopLoss: number;
            takeProfit: number[];
        };
    };
}

export interface VolatilityAnalysis {
    symbol: string;
    displayName: string;
    analysis: ChartAnalysis;
    score: number;
    rank: number;
}

export class EnhancedChartAnalyzer {
    private trendEngine: TrendAnalysisEngine;
    private candleHistory: Map<string, Map<string, CandleData[]>> = new Map();
    private analysisCache: Map<string, ChartAnalysis> = new Map();

    constructor() {
        this.trendEngine = new TrendAnalysisEngine(efficientHMACalculator);
    }

    /**
     * Process candle data for multiple timeframes
     */
    processCandleData(candle: CandleData): void {
        const { symbol } = candle;
        
        // Store 1-minute candles
        this.storeCandleData(symbol, '1m', candle);
        
        // Generate higher timeframes
        this.generateHigherTimeframes(symbol, candle);
        
        // Update analysis for all timeframes
        this.updateAnalysis(symbol);
    }

    private storeCandleData(symbol: string, timeframe: string, candle: CandleData): void {
        if (!this.candleHistory.has(symbol)) {
            this.candleHistory.set(symbol, new Map());
        }
        
        const symbolData = this.candleHistory.get(symbol)!;
        if (!symbolData.has(timeframe)) {
            symbolData.set(timeframe, []);
        }
        
        const candles = symbolData.get(timeframe)!;
        candles.push(candle);
        
        // Keep last 500 candles
        if (candles.length > 500) {
            candles.shift();
        }
    }

    private generateHigherTimeframes(symbol: string, candle: CandleData): void {
        // Generate 5m, 15m, 1h candles from 1m data
        const timeframes = [
            { name: '5m', minutes: 5 },
            { name: '15m', minutes: 15 },
            { name: '1h', minutes: 60 }
        ];

        timeframes.forEach(tf => {
            const higherTfCandle = this.aggregateCandle(symbol, tf.minutes, candle);
            if (higherTfCandle) {
                this.storeCandleData(symbol, tf.name, higherTfCandle);
            }
        });
    }

    private aggregateCandle(symbol: string, minutes: number, newCandle: CandleData): CandleData | null {
        const symbolData = this.candleHistory.get(symbol);
        if (!symbolData) return null;

        const oneMinCandles = symbolData.get('1m') || [];
        if (oneMinCandles.length < minutes) return null;

        // Get last N minutes of 1m candles
        const periodCandles = oneMinCandles.slice(-minutes);
        
        return {
            symbol,
            open: periodCandles[0].open,
            high: Math.max(...periodCandles.map(c => c.high)),
            low: Math.min(...periodCandles.map(c => c.low)),
            close: periodCandles[periodCandles.length - 1].close,
            epoch: Math.floor(newCandle.epoch / (minutes * 60)) * (minutes * 60),
            timestamp: new Date(Math.floor(newCandle.epoch / (minutes * 60)) * (minutes * 60) * 1000)
        };
    }

    private updateAnalysis(symbol: string): void {
        const timeframes: Array<'1m' | '5m' | '15m' | '1h'> = ['1m', '5m', '15m', '1h'];
        
        timeframes.forEach(tf => {
            const analysis = this.analyzeTimeframe(symbol, tf);
            if (analysis) {
                this.analysisCache.set(`${symbol}_${tf}`, analysis);
            }
        });
    }

    private analyzeTimeframe(symbol: string, timeframe: '1m' | '5m' | '15m' | '1h'): ChartAnalysis | null {
        const symbolData = this.candleHistory.get(symbol);
        if (!symbolData) return null;

        const candles = symbolData.get(timeframe);
        if (!candles || candles.length < 50) return null;

        const latest = candles[candles.length - 1];
        
        // Calculate indicators
        const hmaValues = this.calculateHMA(candles);
        const rsi = this.calculateRSI(candles);
        const macd = this.calculateMACD(candles);
        const ehlers = ehlersProcessor.processPrice(symbol, latest.close, latest.timestamp);
        
        // Price action analysis
        const priceAction = this.analyzePriceAction(candles);
        
        // Generate recommendation
        const recommendation = this.generateRecommendation(
            hmaValues, rsi, macd, ehlers, priceAction, latest.close
        );

        return {
            symbol,
            timeframe,
            indicators: {
                hma: hmaValues,
                rsi,
                macd,
                ehlers: {
                    cycle: ehlers?.cycle || 0,
                    trend: ehlers?.trend || 0,
                    signal: this.getEhlersSignal(ehlers)
                }
            },
            priceAction,
            recommendation
        };
    }

    private calculateHMA(candles: CandleData[]): any {
        const closes = candles.map(c => c.close);
        
        // Simple HMA calculation for demo
        const hma5 = this.simpleHMA(closes, 5);
        const hma21 = this.simpleHMA(closes, 21);
        const hma50 = this.simpleHMA(closes, 50);
        
        let crossover: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (hma5 > hma21 && hma21 > hma50) crossover = 'bullish';
        else if (hma5 < hma21 && hma21 < hma50) crossover = 'bearish';

        return { hma5, hma21, hma50, crossover };
    }

    private simpleHMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];
        
        const wma = (data: number[], length: number) => {
            const weights = Array.from({length}, (_, i) => i + 1);
            const weightSum = weights.reduce((a, b) => a + b, 0);
            return data.slice(-length).reduce((sum, price, i) => 
                sum + price * weights[i], 0
            ) / weightSum;
        };

        const halfPeriod = Math.floor(period / 2);
        const sqrtPeriod = Math.floor(Math.sqrt(period));
        
        const wma1 = wma(prices, halfPeriod);
        const wma2 = wma(prices, period);
        const rawHMA = 2 * wma1 - wma2;
        
        // For simplicity, return the raw HMA value
        return rawHMA;
    }

    private calculateRSI(candles: CandleData[]): number {
        if (candles.length < 14) return 50;
        
        const closes = candles.map(c => c.close);
        const gains: number[] = [];
        const losses: number[] = [];
        
        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }
        
        const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
        const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    private calculateMACD(candles: CandleData[]): any {
        const closes = candles.map(c => c.close);
        if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
        
        const ema12 = this.calculateEMA(closes, 12);
        const ema26 = this.calculateEMA(closes, 26);
        const macd = ema12 - ema26;
        
        // Simple signal line (9-period EMA of MACD)
        const signal = macd; // Simplified
        const histogram = macd - signal;
        
        return { macd, signal, histogram };
    }

    private calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];
        
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    private analyzePriceAction(candles: CandleData[]): any {
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const recent = candles.slice(-20);
        const resistance = Math.max(...recent.map(c => c.high));
        const support = Math.min(...recent.map(c => c.low));
        
        // Simple trend detection
        const firstPrice = closes[Math.max(0, closes.length - 20)];
        const lastPrice = closes[closes.length - 1];
        const priceChange = (lastPrice - firstPrice) / firstPrice;
        
        let trend: 'uptrend' | 'downtrend' | 'sideways' = 'sideways';
        if (priceChange > 0.02) trend = 'uptrend';
        else if (priceChange < -0.02) trend = 'downtrend';
        
        const strength = Math.min(100, Math.abs(priceChange) * 1000);
        
        return { support, resistance, trend, strength };
    }

    private generateRecommendation(hma: any, rsi: number, macd: any, ehlers: any, priceAction: any, currentPrice: number): any {
        let score = 0;
        const signals: string[] = [];
        
        // HMA signals
        if (hma.crossover === 'bullish') {
            score += 25;
            signals.push('HMA bullish crossover');
        } else if (hma.crossover === 'bearish') {
            score -= 25;
            signals.push('HMA bearish crossover');
        }
        
        // RSI signals
        if (rsi < 30) {
            score += 15;
            signals.push('RSI oversold');
        } else if (rsi > 70) {
            score -= 15;
            signals.push('RSI overbought');
        }
        
        // MACD signals
        if (macd.macd > macd.signal && macd.histogram > 0) {
            score += 20;
            signals.push('MACD bullish');
        } else if (macd.macd < macd.signal && macd.histogram < 0) {
            score -= 20;
            signals.push('MACD bearish');
        }
        
        // Price action
        if (priceAction.trend === 'uptrend') {
            score += priceAction.strength * 0.3;
            signals.push(`${priceAction.trend} detected`);
        } else if (priceAction.trend === 'downtrend') {
            score -= priceAction.strength * 0.3;
            signals.push(`${priceAction.trend} detected`);
        }
        
        // Determine action
        let action: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
        if (score >= 50) action = 'STRONG_BUY';
        else if (score >= 20) action = 'BUY';
        else if (score <= -50) action = 'STRONG_SELL';
        else if (score <= -20) action = 'SELL';
        else action = 'HOLD';
        
        const confidence = Math.min(100, Math.abs(score));
        const reason = signals.join(', ') || 'Mixed signals';
        
        // Calculate targets
        const atr = (priceAction.resistance - priceAction.support) / 2;
        const targets = {
            entry: currentPrice,
            stopLoss: score > 0 ? currentPrice - atr : currentPrice + atr,
            takeProfit: score > 0 ? 
                [currentPrice + atr, currentPrice + atr * 2] : 
                [currentPrice - atr, currentPrice - atr * 2]
        };
        
        return { action, confidence, reason, targets };
    }

    private getEhlersSignal(ehlers: any): 'buy' | 'sell' | 'hold' {
        if (!ehlers) return 'hold';
        
        if (ehlers.trend > 0.6 && ehlers.cycle > 0) return 'buy';
        if (ehlers.trend < -0.6 && ehlers.cycle < 0) return 'sell';
        return 'hold';
    }

    /**
     * Get analysis for all volatility indices
     */
    getAllVolatilityAnalysis(): VolatilityAnalysis[] {
        const volatilities = [
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
        ];

        const analyses: VolatilityAnalysis[] = [];
        
        volatilities.forEach(vol => {
            // Get the best timeframe analysis
            const timeframes: Array<'1m' | '5m' | '15m' | '1h'> = ['1h', '15m', '5m', '1m'];
            let bestAnalysis: ChartAnalysis | null = null;
            
            for (const tf of timeframes) {
                const analysis = this.analysisCache.get(`${vol.symbol}_${tf}`);
                if (analysis) {
                    bestAnalysis = analysis;
                    break;
                }
            }
            
            if (bestAnalysis) {
                const score = this.calculateOverallScore(bestAnalysis);
                analyses.push({
                    symbol: vol.symbol,
                    displayName: vol.displayName,
                    analysis: bestAnalysis,
                    score,
                    rank: 0 // Will be set after sorting
                });
            }
        });
        
        // Sort by score and set ranks
        analyses.sort((a, b) => b.score - a.score);
        analyses.forEach((analysis, index) => {
            analysis.rank = index + 1;
        });
        
        return analyses;
    }

    private calculateOverallScore(analysis: ChartAnalysis): number {
        let score = analysis.recommendation.confidence;
        
        // Bonus for strong signals
        if (analysis.recommendation.action === 'STRONG_BUY' || analysis.recommendation.action === 'STRONG_SELL') {
            score += 20;
        }
        
        // Bonus for trend alignment
        if (analysis.indicators.hma.crossover !== 'neutral') {
            score += 10;
        }
        
        // Bonus for extreme RSI
        if (analysis.indicators.rsi < 30 || analysis.indicators.rsi > 70) {
            score += 15;
        }
        
        return Math.min(100, score);
    }

    /**
     * Get chart data for visualization
     */
    getChartData(symbol: string, timeframe: '1m' | '5m' | '15m' | '1h', count: number = 100): CandleData[] {
        const symbolData = this.candleHistory.get(symbol);
        if (!symbolData) return [];
        
        const candles = symbolData.get(timeframe) || [];
        return candles.slice(-count);
    }
}

// Export singleton instance
export const enhancedChartAnalyzer = new EnhancedChartAnalyzer();
