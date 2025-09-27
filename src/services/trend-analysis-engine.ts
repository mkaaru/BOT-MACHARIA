import { CandleData } from './candle-reconstruction-engine';
import { TickBasedCandleEngine, TickCandleData } from './tick-based-candle-engine';
import { EfficientHMACalculator, EfficientHMAResult, EfficientHMASlopeResult } from './efficient-hma-calculator';
import { DerivMarketConfig } from './ehlers-signal-processing';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';
export type MarketPhase = 'rising' | 'falling' | 'ranging' | 'transition';
export type TradingCondition = 'favorable' | 'unfavorable' | 'wait';

export interface TrendAnalysis {
    symbol: string;
    timestamp: number;
    direction: TrendDirection;
    strength: TrendStrength;
    confidence: number;
    score: number;
    price: number;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    reason: string;
    lastUpdate: Date;

    // Market phase identification
    marketPhase: MarketPhase;
    phaseStrength: number;
    isTrending: boolean;
    tradingCondition: TradingCondition;
    phaseBasedStrategy: 'buy_dips' | 'sell_rallies' | 'mean_reversion' | 'wait_for_clarity';

    // Multi-timeframe analysis
    shortTermTrend: TrendDirection;
    mediumTermTrend: TrendDirection;
    longTermTrend: TrendDirection;

    // ROC indicators
    fastROC: number;
    slowROC: number;
    rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE';

    // 60-tick trend validation
    tickTrend: {
        direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        consistency: number;
        bullishCount: number;
        bearishCount: number;
        totalTicks: number;
    };

    // Long-term trend indicators
    longTermEMA: number;
    mediumTermEMA: number;
    trendSlope: number;
    trendDuration: number; // in ticks

    // Ehlers preprocessed data
    ehlersSmoothed?: number[];
    roofingFiltered?: number[];
}

export interface MarketScanResult {
    symbol: string;
    displayName: string;
    trend: TrendAnalysis;
    rank: number;
    isRecommended: boolean;
}

export class TrendAnalysisEngine {
    private trendData: Map<string, TrendAnalysis> = new Map();
    private updateTimer: NodeJS.Timeout;
    
    // True tick price tracking (60 consecutive ticks)
    private tickPrices: Map<string, number[]> = new Map();
    private priceHistory: Map<string, number[]> = new Map();
    private ehlersHistory: Map<string, number[]> = new Map();
    
    // Long-term trend tracking
    private longTermTrends: Map<string, {
        direction: TrendDirection;
        startTime: number;
        duration: number;
        slope: number;
        emaValues: number[];
        highLowRange: { high: number; low: number }[];
    }> = new Map();

    private signalCache: Map<string, {
        signal: 'BULLISH' | 'BEARISH' | null;
        timestamp: number;
        confirmationCount: number;
        strength: number;
        lastUpdate: number;
    }> = new Map();

    private readonly SIGNAL_PERSISTENCE_MS = 15 * 60 * 1000; // 15 minutes
    private readonly MIN_CONFIRMATION_COUNT = 3;
    private readonly SIGNAL_STRENGTH_THRESHOLD = 60;
    private readonly MAX_HISTORY = 500; // Increased for long-term analysis

    // ROC periods (tick-based)
    private readonly FAST_ROC_PERIOD = 5;
    private readonly SLOW_ROC_PERIOD = 20;
    
    // Long-term trend periods
    private readonly SHORT_TERM_PERIOD = 50;  // ticks
    private readonly MEDIUM_TERM_PERIOD = 100; // ticks
    private readonly LONG_TERM_PERIOD = 200;   // ticks
    
    // Tick tracking constants
    private readonly REQUIRED_TICKS = 30;
    private readonly CONSISTENCY_THRESHOLD = 55;

    // Market phase detection
    private readonly TREND_STRENGTH_THRESHOLD = 0.001; // Minimum slope for trending market
    private readonly RANGING_THRESHOLD = 0.0005; // Maximum slope for ranging market

    constructor() {
        this.updateTimer = setInterval(() => this.updateAllTrends(), 30 * 1000);
        console.log('🚀 Enhanced TrendAnalysisEngine with Long-term Trend Analysis initialized');
    }

    /**
     * Add candle data and update trend analysis
     */
    addCandleData(candle: CandleData): void {
        const { symbol, close, timestamp } = candle;

        // Store price history
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }

        const prices = this.priceHistory.get(symbol)!;
        prices.push(close);

        // Maintain history size
        if (prices.length > this.MAX_HISTORY) {
            prices.shift();
        }

        // Process with Ehlers filters and calculate ROC
        this.processWithEhlers(symbol, close, timestamp.getTime());

        console.log(`📊 Added candle data for ${symbol}: ${close.toFixed(5)}`);
    }

    /**
     * Add tick-based candle data and update trend analysis
     */
    addTickCandleData(candle: TickCandleData): void {
        const { symbol, close, endTimestamp } = candle;

        // Store price history
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }

        const prices = this.priceHistory.get(symbol)!;
        prices.push(close);

        // Maintain history size
        if (prices.length > this.MAX_HISTORY) {
            prices.shift();
        }

        // Process with Ehlers filters and calculate ROC
        this.processWithEhlers(symbol, close, endTimestamp.getTime());

        console.log(`🎯 Added tick-candle data for ${symbol}: ${close.toFixed(5)} (${candle.tickCount} ticks)`);
    }

    /**
     * Process individual tick data for true 60-tick validation
     */
    processTick(tick: { symbol: string; quote: number; epoch: number }): void {
        const { symbol, quote, epoch } = tick;

        // Store individual tick for 60-tick validation
        this.storeTickPrice(symbol, quote);

        // Also store for price history (candle-based analysis)
        this.storePriceHistory(symbol, quote);

        // Update trend analysis if we have enough data
        if (this.hasSufficientTickData(symbol)) {
            this.updateTrendAnalysis(symbol, quote);
        }
    }

    /**
     * Store individual tick prices for 60-tick trend validation
     */
    private storeTickPrice(symbol: string, price: number): void {
        if (!this.tickPrices.has(symbol)) {
            this.tickPrices.set(symbol, []);
        }

        const ticks = this.tickPrices.get(symbol)!;
        ticks.push(price);

        // Maintain exactly 60 ticks for validation
        if (ticks.length > this.REQUIRED_TICKS) {
            ticks.shift();
        }
    }

    /**
     * Store price history for long-term analysis
     */
    private storePriceHistory(symbol: string, price: number): void {
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
            this.longTermTrends.set(symbol, {
                direction: 'neutral',
                startTime: Date.now(),
                duration: 0,
                slope: 0,
                emaValues: [],
                highLowRange: []
            });
        }

        const prices = this.priceHistory.get(symbol)!;
        prices.push(price);

        if (prices.length > this.MAX_HISTORY) {
            prices.shift();
        }
    }

    /**
     * Check if we have sufficient tick data for validation
     */
    private hasSufficientTickData(symbol: string): boolean {
        const ticks = this.tickPrices.get(symbol);
        return ticks ? ticks.length >= this.REQUIRED_TICKS : false;
    }

    /**
     * Calculate long-term trend components
     */
    private calculateLongTermTrend(symbol: string, currentPrice: number): {
        longTermEMA: number;
        mediumTermEMA: number;
        trendSlope: number;
        trendDuration: number;
        marketPhase: MarketPhase;
        phaseStrength: number;
        shortTermTrend: TrendDirection;
        mediumTermTrend: TrendDirection;
        longTermTrend: TrendDirection;
    } {
        const prices = this.priceHistory.get(symbol);
        if (!prices || prices.length < this.LONG_TERM_PERIOD) {
            return {
                longTermEMA: currentPrice,
                mediumTermEMA: currentPrice,
                trendSlope: 0,
                trendDuration: 0,
                marketPhase: 'ranging',
                phaseStrength: 0,
                shortTermTrend: 'neutral',
                mediumTermTrend: 'neutral',
                longTermTrend: 'neutral'
            };
        }

        // Calculate EMAs for different timeframes
        const shortEMA = this.calculateEMA(prices, this.SHORT_TERM_PERIOD);
        const mediumEMA = this.calculateEMA(prices, this.MEDIUM_TERM_PERIOD);
        const longEMA = this.calculateEMA(prices, this.LONG_TERM_PERIOD);

        // Calculate trend slope (rate of change over longer period)
        const trendSlope = this.calculateTrendSlope(prices, 50);

        // Determine market phase
        const marketPhase = this.determineMarketPhase(shortEMA, mediumEMA, longEMA, trendSlope);
        const phaseStrength = Math.abs(trendSlope);

        // Multi-timeframe trend analysis
        const shortTermTrend = this.getEMATrendDirection(prices, shortEMA, this.SHORT_TERM_PERIOD);
        const mediumTermTrend = this.getEMATrendDirection(prices, mediumEMA, this.MEDIUM_TERM_PERIOD);
        const longTermTrend = this.getEMATrendDirection(prices, longEMA, this.LONG_TERM_PERIOD);

        // Update long-term trend tracking
        this.updateTrendTracking(symbol, longTermTrend, trendSlope, currentPrice);

        return {
            longTermEMA: longEMA,
            mediumTermEMA: mediumEMA,
            trendSlope,
            trendDuration: this.getTrendDuration(symbol),
            marketPhase,
            phaseStrength,
            shortTermTrend,
            mediumTermTrend,
            longTermTrend
        };
    }

    /**
     * Calculate Exponential Moving Average
     */
    private calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];
        
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }
        
        return ema;
    }

    /**
     * Calculate trend slope using linear regression
     */
    private calculateTrendSlope(prices: number[], lookback: number): number {
        if (prices.length < lookback) return 0;
        
        const recentPrices = prices.slice(-lookback);
        const n = recentPrices.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += recentPrices[i];
            sumXY += i * recentPrices[i];
            sumX2 += i * i;
        }
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return slope / recentPrices[0]; // Normalize by initial price
    }

    /**
     * Determine market phase based on EMAs and slope
     */
    private determineMarketPhase(shortEMA: number, mediumEMA: number, longEMA: number, slope: number): MarketPhase {
        const isUptrend = shortEMA > mediumEMA && mediumEMA > longEMA;
        const isDowntrend = shortEMA < mediumEMA && mediumEMA < longEMA;
        
        const absSlope = Math.abs(slope);
        
        if (absSlope < this.RANGING_THRESHOLD) {
            return 'ranging';
        } else if (absSlope > this.TREND_STRENGTH_THRESHOLD) {
            if (isUptrend && slope > 0) return 'rising';
            if (isDowntrend && slope < 0) return 'falling';
        }
        
        return 'transition';
    }

    /**
     * Get trend direction based on EMA position
     */
    private getEMATrendDirection(prices: number[], ema: number, period: number): TrendDirection {
        if (prices.length < period) return 'neutral';
        
        const recentPrices = prices.slice(-period);
        const aboveEMA = recentPrices.filter(p => p > ema).length;
        const belowEMA = recentPrices.filter(p => p < ema).length;
        
        if (aboveEMA > belowEMA * 1.5) return 'bullish';
        if (belowEMA > aboveEMA * 1.5) return 'bearish';
        return 'neutral';
    }

    /**
     * Update long-term trend tracking
     */
    private updateTrendTracking(symbol: string, direction: TrendDirection, slope: number, currentPrice: number): void {
        const trend = this.longTermTrends.get(symbol)!;
        const now = Date.now();
        
        if (trend.direction !== direction) {
            // Trend change detected
            trend.direction = direction;
            trend.startTime = now;
            trend.duration = 0;
        } else {
            trend.duration = now - trend.startTime;
        }
        
        trend.slope = slope;
        trend.emaValues.push(currentPrice);
        if (trend.emaValues.length > 100) trend.emaValues.shift();
        
        // Update high/low range
        trend.highLowRange.push({ high: currentPrice, low: currentPrice });
        if (trend.highLowRange.length > 50) trend.highLowRange.shift();
    }

    /**
     * Get current trend duration in ticks
     */
    private getTrendDuration(symbol: string): number {
        const trend = this.longTermTrends.get(symbol);
        return trend ? Math.floor(trend.duration / 1000) : 0; // Convert to seconds
    }

    private processWithEhlers(symbol: string, price: number, timestamp: number): void {
        // Store price history
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }

        const prices = this.priceHistory.get(symbol)!;
        prices.push(price);

        // Maintain history size - keep more for 500-period ROC
        if (prices.length > 1000) { // Increased from MAX_HISTORY to accommodate 500-period ROC
            prices.shift();
        }

        // Process with Ehlers preprocessing and update analysis
        if (prices.length >= this.SLOW_ROC_PERIOD + 10) { // Need enough data for slow ROC + preprocessing
            this.updateTrendAnalysis(symbol, price);
        } else if (prices.length === 100 || prices.length === 200 || prices.length === 300 || prices.length === 400) {
            console.log(`📊 ${symbol}: Building history... ${prices.length}/500 ticks collected for ROC analysis`);
        }
    }

    /**
     * Get last 500 ticks from historical data for initial ROC calculation
     */
    getLast500Ticks(symbol: string): number[] {
        const prices = this.priceHistory.get(symbol);
        if (!prices) return [];

        // Return last 500 prices, or all available if less than 500
        return prices.slice(-500);
    }

    /**
     * Initialize trend analysis with historical data subset
     */
    initializeWithHistoricalData(symbol: string): boolean {
        const prices = this.priceHistory.get(symbol);
        if (!prices || prices.length < 500) {
            console.log(`${symbol}: Insufficient historical data for 500-period ROC (have ${prices?.length || 0} ticks)`);
            return false;
        }

        // Use exactly 500 ticks for initial calculation
        const last500Ticks = this.getLast500Ticks(symbol);
        console.log(`${symbol}: Initializing with ${last500Ticks.length} historical ticks for 500-period ROC`);

        return true;
    }

    /**
     * Validate 30-tick trend consistency with true tick-by-tick analysis
     */
    private validate30TickTrend(symbol: string): {
        direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        consistency: number;
        bullishCount: number;
        bearishCount: number;
        totalTicks: number;
    } {
        const ticks = this.tickPrices.get(symbol);

        if (!ticks || ticks.length < this.REQUIRED_TICKS) {
            return {
                direction: 'NEUTRAL',
                consistency: 0,
                bullishCount: 0,
                bearishCount: 0,
                totalTicks: ticks?.length || 0
            };
        }

        // Analyze consecutive tick movements
        let bullishCount = 0;
        let bearishCount = 0;
        let totalMovements = 0;

        for (let i = 1; i < ticks.length; i++) {
            const priceChange = ticks[i] - ticks[i - 1];

            if (priceChange > 0) {
                bullishCount++;
                totalMovements++;
            } else if (priceChange < 0) {
                bearishCount++;
                totalMovements++;
            }
            // Zero changes are ignored for consistency calculation
        }

        if (totalMovements === 0) {
            return {
                direction: 'NEUTRAL',
                consistency: 0,
                bullishCount: 0,
                bearishCount: 0,
                totalTicks: ticks.length
            };
        }

        const bullishConsistency = (bullishCount / totalMovements) * 100;
        const bearishConsistency = (bearishCount / totalMovements) * 100;

        let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
        let consistency = 0;

        if (bullishConsistency >= this.CONSISTENCY_THRESHOLD) {
            direction = 'BULLISH';
            consistency = bullishConsistency;
        } else if (bearishConsistency >= this.CONSISTENCY_THRESHOLD) {
            direction = 'BEARISH';
            consistency = bearishConsistency;
        }

        return {
            direction,
            consistency,
            bullishCount,
            bearishCount,
            totalTicks: ticks.length
        };
    }

    /**
     * Enhanced trend analysis with long-term context
     */
    private updateTrendAnalysis(symbol: string, currentPrice: number): void {
        const prices = this.priceHistory.get(symbol);
        if (!prices || prices.length < this.SLOW_ROC_PERIOD + 10) {
            console.log(`${symbol}: Insufficient price data for analysis`);
            return;
        }

        // Step 1: Calculate long-term trend components
        const longTermAnalysis = this.calculateLongTermTrend(symbol, currentPrice);

        // Step 2: Validate 30-tick trend
        const tickTrend = this.validate30TickTrend(symbol);
        
        // Step 3: Apply Ehlers preprocessing
        const preprocessedPrices = this.applyEhlersPreprocessing(prices);
        this.ehlersHistory.set(symbol, preprocessedPrices);

        // Step 4: Calculate ROC indicators
        const fastROC = this.calculateROC(preprocessedPrices, this.FAST_ROC_PERIOD);
        const slowROC = this.calculateROC(preprocessedPrices, this.SLOW_ROC_PERIOD);

        if (fastROC === null || slowROC === null) return;

        // Step 5: Determine ROC alignment and crossovers
        const rocAlignment = this.determineROCAlignment(fastROC, slowROC);
        const rocCrossover = this.detectROCCrossover(symbol, fastROC, slowROC, preprocessedPrices);

        // Step 6: Generate signals with long-term context
        const direction = this.determineTrendDirectionWithContext(
            fastROC, slowROC, rocAlignment, longTermAnalysis
        );
        const strength = this.calculateTrendStrengthWithContext(
            fastROC, slowROC, longTermAnalysis.phaseStrength
        );
        const confidence = this.calculateConfidenceWithContext(
            fastROC, slowROC, rocAlignment, rocCrossover, longTermAnalysis
        );

        // Step 7: Generate recommendation considering market phase
        const recommendation = this.generateMarketPhaseRecommendation(
            fastROC, slowROC, rocAlignment, rocCrossover, 
            confidence, tickTrend, longTermAnalysis
        );

        // Step 8: Calculate comprehensive trading score
        const score = this.calculateComprehensiveScore(
            direction, strength, confidence, rocAlignment, 
            rocCrossover, longTermAnalysis
        );

        // Assess trading conditions
        const tradingCondition = this.assessTradingCondition(longTermAnalysis.marketPhase, confidence, longTermAnalysis);
        const phaseBasedStrategy = this.getPhaseBasedStrategy(longTermAnalysis.marketPhase);

        const analysis: TrendAnalysis = {
            symbol,
            timestamp: Date.now(),
            direction,
            strength,
            confidence,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation,
            reason: this.generateEnhancedReason(
                recommendation, fastROC, slowROC, rocAlignment, 
                rocCrossover, tickTrend, longTermAnalysis, tradingCondition, phaseBasedStrategy
            ),
            score,
            fastROC,
            slowROC,
            rocAlignment,
            rocCrossover,
            tickTrend,
            marketPhase: longTermAnalysis.marketPhase,
            phaseStrength: longTermAnalysis.phaseStrength,
            isTrending: longTermAnalysis.marketPhase === 'rising' || longTermAnalysis.marketPhase === 'falling',
            tradingCondition,
            phaseBasedStrategy,
            shortTermTrend: longTermAnalysis.shortTermTrend,
            mediumTermTrend: longTermAnalysis.mediumTermTrend,
            longTermTrend: longTermAnalysis.longTermTrend,
            longTermEMA: longTermAnalysis.longTermEMA,
            mediumTermEMA: longTermAnalysis.mediumTermEMA,
            trendSlope: longTermAnalysis.trendSlope,
            trendDuration: longTermAnalysis.trendDuration,
            ehlersSmoothed: preprocessedPrices.slice(-20),
            roofingFiltered: this.applyRoofingFilter(prices).slice(-20)
        };

        this.trendData.set(symbol, analysis);

        console.log(`🎯 ${symbol}: ${recommendation} | Phase: ${longTermAnalysis.marketPhase.toUpperCase()} (${tradingCondition}) | ` +
                   `Strategy: ${phaseBasedStrategy.replace('_', ' ').toUpperCase()} | ` +
                   `Fast ROC: ${fastROC.toFixed(3)}% | Slow ROC: ${slowROC.toFixed(3)}% | ` +
                   `30-Tick: ${tickTrend.direction} (${tickTrend.consistency.toFixed(1)}%)`);
    }

    /**
     * Apply Ehlers preprocessing: Roofing Filter + Super Smoother
     */
    private applyEhlersPreprocessing(prices: number[]): number[] {
        // Step 1: Apply Roofing Filter to remove spectral dilation/aliasing
        const roofingFiltered = this.applyRoofingFilter(prices);

        // Step 2: Apply Super Smoother to reduce whipsaws
        const superSmoothed = this.applySuperSmoother(roofingFiltered);

        return superSmoothed;
    }

    /**
     * Ehlers Roofing Filter - removes high frequency noise and spectral dilation
     */
    private applyRoofingFilter(prices: number[], highpass: number = 40, lowpass: number = 10): number[] {
        const result: number[] = [];
        const alpha1 = (Math.cos(0.25 * Math.PI / highpass) + Math.sin(0.25 * Math.PI / highpass) - 1) / Math.cos(0.25 * Math.PI / highpass);

        let hp1 = 0, hp2 = 0;
        let ss1 = 0, ss2 = 0;

        for (let i = 0; i < prices.length; i++) {
            if (i < 2) {
                result[i] = prices[i];
                continue;
            }

            // High-pass filter
            const hp = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (prices[i] - 2 * prices[i - 1] + prices[i - 2]) +
                       2 * (1 - alpha1) * hp1 - (1 - alpha1) * (1 - alpha1) * hp2;

            hp2 = hp1;
            hp1 = hp;

            // Super Smoother (low-pass)
            const a1 = Math.exp(-1.414 * Math.PI / lowpass);
            const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / lowpass);
            const c2 = b1;
            const c3 = -a1 * a1;
            const c1 = 1 - c2 - c3;

            const ss = c1 * (hp + hp1) / 2 + c2 * ss1 + c3 * ss2;

            ss2 = ss1;
            ss1 = ss;

            result[i] = ss;
        }

        return result;
    }

    /**
     * Ehlers Super Smoother - reduces lag while maintaining smoothness
     */
    private applySuperSmoother(prices: number[], period: number = 10): number[] {
        const result: number[] = [];
        const a1 = Math.exp(-1.414 * Math.PI / period);
        const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / period);
        const c2 = b1;
        const c3 = -a1 * a1;
        const c1 = 1 - c2 - c3;

        for (let i = 0; i < prices.length; i++) {
            if (i < 2) {
                result[i] = prices[i];
                continue;
            }

            const value = c1 * (prices[i] + prices[i - 1]) / 2 +
                         c2 * result[i - 1] +
                         c3 * result[i - 2];
            result[i] = value;
        }

        return result;
    }

    /**
     * Calculate Rate of Change (ROC) indicator
     */
    private calculateROC(prices: number[], period: number): number | null {
        if (prices.length < period + 1) return null;

        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - 1 - period];

        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }

    /**
     * Determine ROC alignment status
     */
    private determineROCAlignment(fastROC: number, slowROC: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        // Bullish: Both ROCs positive and fast ROC is stronger
        if (slowROC > 0 && fastROC > 0 && fastROC > slowROC) {
            return 'BULLISH';
        }

        // Bearish: Both ROCs negative and fast ROC is more negative
        if (slowROC < 0 && fastROC < 0 && fastROC < slowROC) {
            return 'BEARISH';
        }

        return 'NEUTRAL';
    }

    /**
     * Determine trend direction with long-term context
     */
    private determineTrendDirectionWithContext(
        fastROC: number, 
        slowROC: number, 
        rocAlignment: string,
        longTermAnalysis: any
    ): TrendDirection {
        // Weight long-term trend more heavily
        const longTermWeight = 0.6;
        const shortTermWeight = 0.4;

        let longTermScore = 0;
        if (longTermAnalysis.longTermTrend === 'bullish') longTermScore = 1;
        else if (longTermAnalysis.longTermTrend === 'bearish') longTermScore = -1;

        let shortTermScore = 0;
        if (rocAlignment === 'BULLISH') shortTermScore = 1;
        else if (rocAlignment === 'BEARISH') shortTermScore = -1;

        const combinedScore = (longTermScore * longTermWeight) + (shortTermScore * shortTermWeight);

        if (combinedScore > 0.3) return 'bullish';
        if (combinedScore < -0.3) return 'bearish';
        return 'neutral';
    }

    /**
     * Calculate trend strength with long-term context
     */
    private calculateTrendStrengthWithContext(
        fastROC: number, 
        slowROC: number, 
        phaseStrength: number
    ): TrendStrength {
        const rocMagnitude = Math.abs(fastROC) + Math.abs(slowROC);
        const momentum = Math.abs(fastROC - slowROC);
        
        // Factor in phase strength from long-term analysis
        const adjustedMagnitude = rocMagnitude + (phaseStrength * 1000);

        if (adjustedMagnitude > 2.0 && momentum > 1.0) {
            return 'strong';
        } else if (adjustedMagnitude > 0.5 || momentum > 0.3) {
            return 'moderate';
        }

        return 'weak';
    }

    /**
     * Calculate confidence with long-term context
     */
    private calculateConfidenceWithContext(
        fastROC: number, 
        slowROC: number, 
        rocAlignment: string, 
        rocCrossover: string, 
        longTermAnalysis: any
    ): number {
        let confidence = 40; // Base confidence

        // ROC alignment bonus
        if (rocAlignment === 'BULLISH' || rocAlignment === 'BEARISH') {
            confidence += 20;
        }

        // ROC crossover bonus
        if (rocCrossover === 'BULLISH_CROSS' || rocCrossover === 'BEARISH_CROSS') {
            confidence += 25;
        }

        // Long-term trend alignment bonus
        const trendAlignment = this.checkTrendAlignment(longTermAnalysis);
        confidence += trendAlignment * 15;

        // Market phase bonus
        if (longTermAnalysis.marketPhase === 'rising' || longTermAnalysis.marketPhase === 'falling') {
            confidence += 10;
        }

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Check alignment across timeframes
     */
    private checkTrendAlignment(longTermAnalysis: any): number {
        const trends = [
            longTermAnalysis.shortTermTrend,
            longTermAnalysis.mediumTermTrend,
            longTermAnalysis.longTermTrend
        ];

        const bullishCount = trends.filter(t => t === 'bullish').length;
        const bearishCount = trends.filter(t => t === 'bearish').length;

        if (bullishCount === 3) return 1;
        if (bearishCount === 3) return 1;
        if (bullishCount === 2 || bearishCount === 2) return 0.67;
        return 0;
    }

    /**
     * Generate recommendations based on market phase with enhanced binary options logic
     */
    private generateMarketPhaseRecommendation(
        fastROC: number, 
        slowROC: number, 
        rocAlignment: string,
        rocCrossover: string,
        confidence: number,
        tickTrend: any,
        longTermAnalysis: any
    ): 'BUY' | 'SELL' | 'HOLD' {
        const { marketPhase, longTermTrend } = longTermAnalysis;

        // Determine trading condition and strategy
        const tradingCondition = this.assessTradingCondition(marketPhase, confidence, longTermAnalysis);
        const phaseBasedStrategy = this.getPhaseBasedStrategy(marketPhase);

        // Conservative approach - only trade in favorable conditions
        if (tradingCondition === 'unfavorable' || tradingCondition === 'wait') {
            return 'HOLD';
        }

        // Enhanced confidence threshold for binary options
        const minConfidence = this.getMinConfidenceForPhase(marketPhase);
        if (confidence < minConfidence) return 'HOLD';

        // Phase-specific trading logic
        switch (marketPhase) {
            case 'rising':
                // Buy dips strategy - wait for temporary weakness in strong uptrend
                if (phaseBasedStrategy === 'buy_dips') {
                    // Look for temporary pullbacks in rising market
                    if (rocAlignment === 'BEARISH' && longTermTrend === 'bullish' && confidence >= 75) {
                        return 'BUY'; // Buy the dip
                    }
                    // Strong momentum continuation
                    if (rocCrossover === 'BULLISH_CROSS' && tickTrend.direction === 'BULLISH' && confidence >= 80) {
                        return 'BUY';
                    }
                }
                break;

            case 'falling':
                // Sell rallies strategy - wait for temporary strength in strong downtrend
                if (phaseBasedStrategy === 'sell_rallies') {
                    // Look for temporary bounces in falling market
                    if (rocAlignment === 'BULLISH' && longTermTrend === 'bearish' && confidence >= 75) {
                        return 'SELL'; // Sell the rally
                    }
                    // Strong momentum continuation
                    if (rocCrossover === 'BEARISH_CROSS' && tickTrend.direction === 'BEARISH' && confidence >= 80) {
                        return 'SELL';
                    }
                }
                break;

            case 'ranging':
                // Mean reversion strategy - trade bounces off support/resistance
                if (phaseBasedStrategy === 'mean_reversion') {
                    // Conservative mean reversion signals
                    if (rocCrossover === 'BULLISH_CROSS' && tickTrend.direction === 'BULLISH' && confidence >= 85) {
                        return 'BUY';
                    }
                    if (rocCrossover === 'BEARISH_CROSS' && tickTrend.direction === 'BEARISH' && confidence >= 85) {
                        return 'SELL';
                    }
                }
                break;

            case 'transition':
                // Wait for clarity - only highest confidence signals
                if (confidence >= 90 && tickTrend.consistency >= 80) {
                    if (rocAlignment === 'BULLISH' && tickTrend.direction === 'BULLISH') {
                        return 'BUY';
                    }
                    if (rocAlignment === 'BEARISH' && tickTrend.direction === 'BEARISH') {
                        return 'SELL';
                    }
                }
                break;
        }

        return 'HOLD';
    }

    /**
     * Assess overall trading condition based on market phase
     */
    private assessTradingCondition(marketPhase: MarketPhase, confidence: number, longTermAnalysis: any): TradingCondition {
        // Check for favorable market conditions
        const trendAlignment = this.checkTrendAlignment(longTermAnalysis);
        const phaseStrength = longTermAnalysis.phaseStrength;

        // Favorable conditions
        if ((marketPhase === 'rising' || marketPhase === 'falling') && 
            trendAlignment >= 0.67 && 
            phaseStrength > this.TREND_STRENGTH_THRESHOLD) {
            return 'favorable';
        }

        // Ranging market with clear boundaries
        if (marketPhase === 'ranging' && confidence >= 80) {
            return 'favorable';
        }

        // Unfavorable conditions - avoid trading
        if (marketPhase === 'transition' || 
            trendAlignment < 0.33 || 
            phaseStrength < this.RANGING_THRESHOLD) {
            return 'unfavorable';
        }

        // Wait for better conditions
        return 'wait';
    }

    /**
     * Get phase-based trading strategy
     */
    private getPhaseBasedStrategy(marketPhase: MarketPhase): 'buy_dips' | 'sell_rallies' | 'mean_reversion' | 'wait_for_clarity' {
        switch (marketPhase) {
            case 'rising': return 'buy_dips';
            case 'falling': return 'sell_rallies';
            case 'ranging': return 'mean_reversion';
            case 'transition': return 'wait_for_clarity';
            default: return 'wait_for_clarity';
        }
    }

    /**
     * Get minimum confidence threshold based on market phase
     */
    private getMinConfidenceForPhase(marketPhase: MarketPhase): number {
        switch (marketPhase) {
            case 'rising': return 70;  // Lower threshold for trending markets
            case 'falling': return 70;
            case 'ranging': return 80; // Higher threshold for ranging markets
            case 'transition': return 90; // Very high threshold for uncertain markets
            default: return 85;
        }
    }

    /**
     * Calculate comprehensive trading score
     */
    private calculateComprehensiveScore(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        rocAlignment: string,
        rocCrossover: string,
        longTermAnalysis: any
    ): number {
        let score = confidence;

        // Direction bonus
        if (direction !== 'neutral') score += 10;

        // Strength bonus
        const strengthBonus = strength === 'strong' ? 15 : strength === 'moderate' ? 10 : 0;
        score += strengthBonus;

        // ROC alignment bonus
        if (rocAlignment !== 'NEUTRAL') score += 10;

        // Crossover bonus
        if (rocCrossover !== 'NONE') score += 15;

        // Market phase bonus
        if (longTermAnalysis.marketPhase === 'rising' || longTermAnalysis.marketPhase === 'falling') {
            score += 10;
        }

        // Trend alignment bonus
        const trendAlignment = this.checkTrendAlignment(longTermAnalysis);
        score += trendAlignment * 20;

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Generate enhanced reasoning with market phase context
     */
    private generateEnhancedReason(
        recommendation: string,
        fastROC: number,
        slowROC: number,
        rocAlignment: string,
        rocCrossover: string,
        tickTrend: any,
        longTermAnalysis: any,
        tradingCondition: TradingCondition,
        phaseBasedStrategy: string
    ): string {
        const { marketPhase, longTermTrend, shortTermTrend, trendDuration } = longTermAnalysis;
        
        let reason = `${recommendation} signal in ${marketPhase.toUpperCase()} market (${tradingCondition}). `;
        
        // Add strategy context
        switch (phaseBasedStrategy) {
            case 'buy_dips':
                reason += `Strategy: Buy dips in rising market. `;
                break;
            case 'sell_rallies':
                reason += `Strategy: Sell rallies in falling market. `;
                break;
            case 'mean_reversion':
                reason += `Strategy: Mean reversion in ranging market. `;
                break;
            case 'wait_for_clarity':
                reason += `Strategy: Wait for market clarity. `;
                break;
        }
        
        reason += `Trends - Long: ${longTermTrend.toUpperCase()}, Short: ${shortTermTrend.toUpperCase()}. `;
        
        if (rocCrossover !== 'NONE') {
            reason += `ROC ${rocCrossover.replace('_', ' ')}. `;
        }
        
        if (trendDuration > 0) {
            reason += `Trend age: ${Math.floor(trendDuration / 60)}min. `;
        }
        
        reason += `30-tick consistency: ${tickTrend.consistency.toFixed(0)}%.`;
        
        // Add trading condition warning
        if (tradingCondition === 'wait' || tradingCondition === 'unfavorable') {
            reason += ` CONDITIONS NOT OPTIMAL FOR TRADING.`;
        }
        
        return reason;
    }

    /**
     * Detect ROC crossovers for entry signals
     */
    private detectROCCrossover(symbol: string, fastROC: number, slowROC: number, prices: number[]): 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE' {
        // We need previous ROC values to detect crossovers
        if (prices.length < this.SLOW_ROC_PERIOD + 2) return 'NONE';

        // Calculate previous ROC values
        const prevPrices = prices.slice(0, -1);
        const prevFastROC = this.calculateROC(prevPrices, this.FAST_ROC_PERIOD);
        const prevSlowROC = this.calculateROC(prevPrices, this.SLOW_ROC_PERIOD);

        if (prevFastROC === null || prevSlowROC === null) return 'NONE';

        // Bullish crossover: Fast ROC crosses above zero while slow ROC is positive
        if (prevFastROC <= 0 && fastROC > 0 && slowROC > 0) {
            return 'BULLISH_CROSS';
        }

        // Bearish crossover: Fast ROC crosses below zero while slow ROC is negative
        if (prevFastROC >= 0 && fastROC < 0 && slowROC < 0) {
            return 'BEARISH_CROSS';
        }

        return 'NONE';
    }

    /**
     * Determine trend direction based on ROC analysis
     */
    private determineTrendDirection(fastROC: number, slowROC: number, rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): TrendDirection {
        if (rocAlignment === 'BULLISH') return 'bullish';
        if (rocAlignment === 'BEARISH') return 'bearish';
        return 'neutral';
    }

    /**
     * Calculate trend strength based on ROC magnitude
     */
    private calculateTrendStrength(fastROC: number, slowROC: number): TrendStrength {
        const rocMagnitude = Math.abs(fastROC) + Math.abs(slowROC);
        const momentum = Math.abs(fastROC - slowROC);

        if (rocMagnitude > 2.0 && momentum > 1.0) {
            return 'strong';
        } else if (rocMagnitude > 0.5 || momentum > 0.3) {
            return 'moderate';
        }

        return 'weak';
    }

    /**
     * Calculate confidence based on ROC alignment and momentum
     */
    private calculateConfidence(fastROC: number, slowROC: number, rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL', rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE'): number {
        let confidence = 40; // Base confidence

        // ROC alignment bonus
        if (rocAlignment !== 'NEUTRAL') {
            confidence += 30;
        }

        // Crossover bonus
        if (rocCrossover !== 'NONE') {
            confidence += 20;
        }

        // ROC momentum strength
        const momentum = Math.abs(fastROC - slowROC);
        confidence += Math.min(15, momentum * 10);

        // ROC magnitude bonus
        const magnitude = Math.abs(fastROC) + Math.abs(slowROC);
        confidence += Math.min(15, magnitude * 5);

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Generate ROC-based recommendation without trend validation - pure ROC signals
     */
    private generateROCRecommendation(
        fastROC: number,
        slowROC: number,
        rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE',
        confidence: number,
        tickTrend: { direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; consistency: number }
    ): 'BUY' | 'SELL' | 'HOLD' {

        // Strong ROC crossover signals - immediate action
        if (rocCrossover === 'BULLISH_CROSS' && confidence > 50) {
            return 'BUY';
        }
        if (rocCrossover === 'BEARISH_CROSS' && confidence > 50) {
            return 'SELL';
        }

        // ROC alignment signals - no trend validation required
        if (rocAlignment === 'BULLISH' && confidence > 60) {
            return 'BUY';
        }
        if (rocAlignment === 'BEARISH' && confidence > 60) {
            return 'SELL';
        }

        // Strong momentum signals based on ROC values alone
        if (fastROC > 0.5 && slowROC > 0 && confidence > 55) {
            return 'BUY';
        }
        if (fastROC < -0.5 && slowROC < 0 && confidence > 55) {
            return 'SELL';
        }

        // High confidence ROC signals regardless of trend validation
        if (confidence >= 80) {
            if (fastROC > 0 && slowROC > 0) {
                return 'BUY';
            }
            if (fastROC < 0 && slowROC < 0) {
                return 'SELL';
            }
        }

        return 'HOLD';
    }

    /**
     * Calculate trading score based on ROC analysis
     */
    private calculateTradingScore(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE'
    ): number {
        let score = confidence * 0.6; // Base score from confidence

        // ROC alignment bonus
        if (rocAlignment !== 'NEUTRAL') {
            score += 25;
        }

        // Crossover signal bonus
        if (rocCrossover !== 'NONE') {
            score += 20;
        }

        // Direction scoring
        if (direction === 'bullish' || direction === 'bearish') {
            score += 15;
        }

        // Strength scoring
        switch (strength) {
            case 'strong':
                score += 20;
                break;
            case 'moderate':
                score += 10;
                break;
            case 'weak':
                score += 2;
                break;
        }

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Generate detailed reason based purely on ROC analysis
     */
    private generateReasonForRecommendation(
        recommendation: 'BUY' | 'SELL' | 'HOLD',
        fastROC: number,
        slowROC: number,
        rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE',
        tickTrend: { direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; consistency: number; bullishCount: number; bearishCount: number }
    ): string {
        const reasons: string[] = [];

        reasons.push(`Fast ROC: ${fastROC.toFixed(3)}%, Slow ROC: ${slowROC.toFixed(3)}%`);
        reasons.push(`ROC Alignment: ${rocAlignment}, Crossover: ${rocCrossover}`);
        reasons.push(`30-Tick Reference: ${tickTrend.direction} (${tickTrend.consistency.toFixed(1)}% consistency)`);

        if (recommendation === 'HOLD') {
            if (rocAlignment === 'NEUTRAL' && rocCrossover === 'NONE') {
                reasons.push('ROC signals neutral - awaiting clear directional momentum');
            } else {
                reasons.push('ROC signals present but confidence insufficient for trade signal');
            }
        } else {
            // Determine the primary signal source
            if (rocCrossover !== 'NONE') {
                reasons.push(`${recommendation} signal triggered by ROC crossover: ${rocCrossover}`);
            } else if (rocAlignment !== 'NEUTRAL') {
                reasons.push(`${recommendation} signal based on ROC alignment: ${rocAlignment}`);
            } else {
                reasons.push(`${recommendation} signal from strong ROC momentum pattern`);
            }
        }

        return reasons.join(' | ');
    }

    /**
     * Update all symbols periodically
     */
    private updateAllTrends(): void {
        // This would normally iterate through all active symbols
        // For now, just a placeholder since individual candles trigger updates
        console.log(`🔄 ROC Trend Engine: Monitoring ${this.trendData.size} symbols with 60-tick validation`);
    }

    /**
     * Get trend analysis for a symbol
     */
    getTrendAnalysis(symbol: string): TrendAnalysis | null {
        return this.trendData.get(symbol) || null;
    }

    /**
     * Get all trend analyses
     */
    getAllTrendAnalyses(): TrendAnalysis[] {
        return Array.from(this.trendData.values());
    }

    /**
     * Get top recommended symbols
     */
    getTopRecommendations(limit: number = 10): MarketScanResult[] {
        const analyses = this.getAllTrendAnalyses()
            .filter(analysis => analysis.recommendation !== 'HOLD')
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return analyses.map((trend, index) => ({
            symbol: trend.symbol,
            displayName: trend.symbol, // Could be enhanced with proper display names
            trend,
            rank: index + 1,
            isRecommended: trend.score > 70
        }));
    }

    /**
     * Get tick data for debugging
     */
    getTickData(symbol: string): number[] {
        return this.tickPrices.get(symbol) || [];
    }

    /**
     * Get comprehensive stats
     */
    getStats(): {
        totalSymbols: number;
        symbolsWithTickData: number;
        symbolsWithSufficientTicks: number;
        avgTickCount: number;
    } {
        const symbolsWithTickData = this.tickPrices.size;
        const symbolsWithSufficientTicks = Array.from(this.tickPrices.values())
            .filter(ticks => ticks.length >= this.REQUIRED_TICKS).length;

        const totalTicks = Array.from(this.tickPrices.values())
            .reduce((sum, ticks) => sum + ticks.length, 0);
        const avgTickCount = symbolsWithTickData > 0 ? totalTicks / symbolsWithTickData : 0;

        return {
            totalSymbols: this.trendData.size,
            symbolsWithTickData,
            symbolsWithSufficientTicks,
            avgTickCount
        };
    }

    /**
     * Cleanup
     */
    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.trendData.clear();
        this.tickPrices.clear();
        this.priceHistory.clear();
        this.ehlersHistory.clear();
        this.signalCache.clear();
    }
}

// Create singleton instance without HMA dependency
export const trendAnalysisEngine = new TrendAnalysisEngine();