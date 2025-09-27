
import { CandleData } from './candle-reconstruction-engine';
import { TickBasedCandleEngine, TickCandleData } from './tick-based-candle-engine';
import { EfficientHMACalculator, EfficientHMAResult, EfficientHMASlopeResult } from './efficient-hma-calculator';
import { DerivMarketConfig } from './ehlers-signal-processing';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';
export type MarketPhase = 'rising' | 'falling' | 'ranging' | 'transition';
export type TradingCondition = 'favorable' | 'unfavorable' | 'wait';
export type SignalState = 'STABLE' | 'PENDING_CHANGE' | 'LOCKED';

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

    // Signal stability management
    signalState: SignalState;
    signalAge: number; // minutes since signal started
    timeUntilNextChange: number; // minutes until signal can change
    confirmationStreak: number; // consecutive confirmations of current signal
    
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

    // Stable ROC indicators (longer periods)
    longTermROC: number;      // 200-tick ROC
    mediumTermROC: number;    // 100-tick ROC
    shortTermROC: number;     // 50-tick ROC
    rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE';

    // Trend consistency over time
    trendConsistency: {
        last5Minutes: TrendDirection;
        last10Minutes: TrendDirection;
        last15Minutes: TrendDirection;
        alignmentScore: number; // 0-100, how aligned all timeframes are
    };
    
    // Market momentum (helps filter noise)
    momentum: {
        current: number;
        smoothed: number;    // EMA smoothed momentum
        direction: 'INCREASING' | 'DECREASING' | 'STABLE';
        strength: number;    // 0-100
    };

    // Signal lock mechanism
    signalLock: {
        isLocked: boolean;
        lockUntil: number;   // timestamp
        lockReason: string;
        minHoldTime: number; // minutes
    };

    // 30-tick trend validation
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

export interface DerivTradingSignal {
    symbol: string;
    action: 'RISE' | 'FALL' | 'WAIT';
    confidence: number;
    timeframe: '3m' | '5m';
    entryPrice: number;
    signalStrength: number;
    holdUntil: Date;         // When this signal expires
    nextCheckTime: Date;     // When to check for next signal
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class TrendAnalysisEngine {
    private trendData: Map<string, TrendAnalysis> = new Map();
    private updateTimer: NodeJS.Timeout;
    
    // True tick price tracking (30 consecutive ticks)
    private tickPrices: Map<string, number[]> = new Map();
    private priceHistory: Map<string, number[]> = new Map();
    private momentumHistory: Map<string, number[]> = new Map();
    private ehlersHistory: Map<string, number[]> = new Map();
    private signalLocks: Map<string, number> = new Map(); // symbol -> unlock timestamp
    
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

    // Conservative parameters for stable signals
    private readonly MIN_SIGNAL_HOLD_TIME = 5 * 60 * 1000;      // 5 minutes minimum hold
    private readonly SIGNAL_COOL_DOWN = 3 * 60 * 1000;          // 3 minutes between changes  
    private readonly TREND_CONFIRMATION_PERIOD = 2 * 60 * 1000; // 2 minutes to confirm new trend
    private readonly MAX_HISTORY_SIZE = 1000;                   // Large history for stability

    // Long-term ROC periods (much longer than original)
    private readonly SHORT_ROC_PERIOD = 50;   // ~5-7 minutes of ticks
    private readonly MEDIUM_ROC_PERIOD = 100; // ~10-12 minutes of ticks  
    private readonly LONG_ROC_PERIOD = 200;   // ~20-25 minutes of ticks
    
    // Tick tracking constants
    private readonly REQUIRED_TICKS = 30;
    private readonly CONSISTENCY_THRESHOLD = 55;

    // Market phase detection
    private readonly TREND_STRENGTH_THRESHOLD = 0.001; // Minimum slope for trending market
    private readonly RANGING_THRESHOLD = 0.0005; // Maximum slope for ranging market

    // Strict thresholds for signal changes
    private readonly MIN_CONFIDENCE_FOR_TRADE = 75;        // High confidence required
    private readonly MIN_ALIGNMENT_SCORE = 70;             // All timeframes must align
    private readonly MIN_MOMENTUM_STRENGTH = 60;           // Strong momentum required
    private readonly MIN_CONFIRMATION_STREAK = 3;          // 3 consecutive confirmations needed

    // Update frequency (much less frequent)
    private readonly UPDATE_INTERVAL = 2 * 60 * 1000;      // Every 2 minutes

    constructor() {
        // Much less frequent updates for stability
        this.updateTimer = setInterval(() => this.updateAllTrends(), this.UPDATE_INTERVAL);
        
        console.log('🚀 Stable Deriv Trend Engine Initialized');
        console.log('⏱️  Signal Hold Time: 5 minutes minimum');
        console.log('🔒 Cool Down Period: 3 minutes between changes');
        console.log('📊 Update Frequency: Every 2 minutes');
    }

    /**
     * Add candle data and update trend analysis
     */
    addCandleData(candle: CandleData): void {
        const { symbol, close, timestamp } = candle;

        // Store price with timestamp for long-term analysis
        this.storePriceData(symbol, close, timestamp.getTime());

        console.log(`📊 Added candle data for ${symbol}: ${close.toFixed(5)}`);
    }

    /**
     * Add tick-based candle data and update trend analysis
     */
    addTickCandleData(candle: TickCandleData): void {
        const { symbol, close, endTimestamp } = candle;

        // Store price with timestamp for long-term analysis
        this.storePriceData(symbol, close, endTimestamp.getTime());

        console.log(`🎯 Added tick-candle data for ${symbol}: ${close.toFixed(5)} (${candle.tickCount} ticks)`);
    }

    /**
     * Process individual tick data with stability focus
     */
    processTick(tick: { symbol: string; quote: number; epoch: number }): void {
        const { symbol, quote, epoch } = tick;

        // Store individual tick for 30-tick validation
        this.storeTickPrice(symbol, quote);

        // Store price with timestamp for long-term analysis
        this.storePriceData(symbol, quote, epoch);

        // Only update if not in cool-down period and we have enough data
        if (this.canUpdateSignal(symbol) && this.hasSufficientData(symbol)) {
            this.evaluateTrendStability(symbol, quote, epoch);
        }
    }

    /**
     * Store individual tick prices for 30-tick trend validation
     */
    private storeTickPrice(symbol: string, price: number): void {
        if (!this.tickPrices.has(symbol)) {
            this.tickPrices.set(symbol, []);
        }

        const ticks = this.tickPrices.get(symbol)!;
        ticks.push(price);

        // Maintain exactly 30 ticks for validation
        if (ticks.length > this.REQUIRED_TICKS) {
            ticks.shift();
        }
    }

    /**
     * Store price data for long-term analysis
     */
    private storePriceData(symbol: string, price: number, timestamp: number): void {
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
            this.momentumHistory.set(symbol, []);
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

        // Calculate and store momentum
        if (prices.length > 1) {
            const momentum = ((price - prices[prices.length - 2]) / prices[prices.length - 2]) * 10000;
            const momentumData = this.momentumHistory.get(symbol)!;
            momentumData.push(momentum);
            
            // Maintain momentum history size
            if (momentumData.length > this.MAX_HISTORY_SIZE) {
                momentumData.shift();
            }
        }

        // Maintain price history size
        if (prices.length > this.MAX_HISTORY_SIZE) {
            prices.shift();
        }
    }

    /**
     * Check if signal can be updated (respects cool-down)
     */
    private canUpdateSignal(symbol: string): boolean {
        const lockUntil = this.signalLocks.get(symbol);
        if (!lockUntil) return true;
        
        return Date.now() >= lockUntil;
    }

    /**
     * Check if we have sufficient data for stable analysis
     */
    private hasSufficientData(symbol: string): boolean {
        const prices = this.priceHistory.get(symbol);
        const ticks = this.tickPrices.get(symbol);
        
        return (prices && prices.length >= this.LONG_ROC_PERIOD + 50) &&
               (ticks && ticks.length >= this.REQUIRED_TICKS);
    }

    /**
     * Evaluate trend stability with conservative approach
     */
    private evaluateTrendStability(symbol: string, currentPrice: number, timestamp: number): void {
        const prices = this.priceHistory.get(symbol);
        if (!prices || prices.length < this.LONG_ROC_PERIOD + 50) {
            console.log(`${symbol}: Insufficient data for stable analysis`);
            return;
        }

        // Calculate stable long-term ROC indicators
        const longROC = this.calculateStableROC(prices, this.LONG_ROC_PERIOD);
        const mediumROC = this.calculateStableROC(prices, this.MEDIUM_ROC_PERIOD);
        const shortROC = this.calculateStableROC(prices, this.SHORT_ROC_PERIOD);

        if (longROC === null || mediumROC === null || shortROC === null) {
            return;
        }

        // Calculate smoothed momentum
        const momentum = this.calculateSmoothedMomentum(symbol);
        
        // Analyze trend consistency across multiple timeframes
        const trendConsistency = this.analyzeTrendConsistency(symbol, prices);
        
        // Validate 30-tick trend
        const tickTrend = this.validate30TickTrend(symbol);
        
        // Calculate long-term trend components
        const longTermAnalysis = this.calculateLongTermTrend(symbol, currentPrice);
        
        // Determine stable trend direction (requires alignment)
        const stableTrend = this.determineStableTrend(longROC, mediumROC, shortROC, trendConsistency);
        
        // Calculate ROC alignment and crossovers
        const rocAlignment = this.determineROCAlignment(shortROC, mediumROC);
        const rocCrossover = this.detectROCCrossover(symbol, shortROC, mediumROC, prices);
        
        // Calculate confidence with conservative bias
        const confidence = this.calculateConservativeConfidence(
            stableTrend, longROC, mediumROC, shortROC, trendConsistency, momentum
        );

        // Get current analysis or create new one
        const currentAnalysis = this.trendData.get(symbol);
        const signalAge = currentAnalysis ? 
            (Date.now() - currentAnalysis.timestamp) / (1000 * 60) : 0;

        // Check if we should change the signal
        const shouldChange = this.shouldChangeSignal(
            currentAnalysis, stableTrend, confidence, trendConsistency
        );

        if (!shouldChange && currentAnalysis) {
            // Update existing analysis without changing recommendation
            this.updateExistingAnalysis(currentAnalysis, currentPrice, confidence, momentum);
            return;
        }

        // Generate new stable recommendation
        const recommendation = this.generateStableRecommendation(
            stableTrend, confidence, trendConsistency, momentum, rocAlignment, rocCrossover
        );

        // Assess trading conditions
        const tradingCondition = this.assessTradingCondition(longTermAnalysis.marketPhase, confidence, longTermAnalysis);
        const phaseBasedStrategy = this.getPhaseBasedStrategy(longTermAnalysis.marketPhase);

        // Calculate comprehensive trading score
        const score = this.calculateComprehensiveScore(
            stableTrend, this.calculateTrendStrength(longROC, mediumROC, shortROC), 
            confidence, rocAlignment, rocCrossover, longTermAnalysis
        );

        // Create comprehensive analysis
        const analysis: TrendAnalysis = {
            symbol,
            timestamp: Date.now(),
            direction: stableTrend,
            strength: this.calculateTrendStrength(longROC, mediumROC, shortROC),
            confidence,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation,
            reason: this.generateDetailedReason(recommendation, longROC, mediumROC, shortROC, trendConsistency),
            score,
            
            signalState: 'STABLE',
            signalAge: 0, // New signal
            timeUntilNextChange: this.MIN_SIGNAL_HOLD_TIME / (1000 * 60), // minutes
            confirmationStreak: 1,
            
            marketPhase: longTermAnalysis.marketPhase,
            phaseStrength: longTermAnalysis.phaseStrength,
            isTrending: longTermAnalysis.marketPhase === 'rising' || longTermAnalysis.marketPhase === 'falling',
            tradingCondition,
            phaseBasedStrategy,
            
            shortTermTrend: longTermAnalysis.shortTermTrend,
            mediumTermTrend: longTermAnalysis.mediumTermTrend,
            longTermTrend: longTermAnalysis.longTermTrend,
            
            longTermROC: longROC,
            mediumTermROC: mediumROC,
            shortTermROC: shortROC,
            rocAlignment,
            rocCrossover,
            
            trendConsistency,
            momentum,
            tickTrend,
            
            longTermEMA: longTermAnalysis.longTermEMA,
            mediumTermEMA: longTermAnalysis.mediumTermEMA,
            trendSlope: longTermAnalysis.trendSlope,
            trendDuration: longTermAnalysis.trendDuration,
            
            signalLock: {
                isLocked: true,
                lockUntil: Date.now() + this.MIN_SIGNAL_HOLD_TIME,
                lockReason: 'New signal hold period',
                minHoldTime: this.MIN_SIGNAL_HOLD_TIME / (1000 * 60)
            },
            
            ehlersSmoothed: this.applyEhlersPreprocessing(prices).slice(-20),
            roofingFiltered: this.applyRoofingFilter(prices).slice(-20)
        };

        // Lock the signal to prevent immediate changes
        this.signalLocks.set(symbol, Date.now() + this.MIN_SIGNAL_HOLD_TIME);
        
        this.trendData.set(symbol, analysis);

        console.log(`🔄 ${symbol}: NEW SIGNAL - ${recommendation} | Confidence: ${confidence.toFixed(1)}% | Hold for: ${(this.MIN_SIGNAL_HOLD_TIME / 60000).toFixed(1)}m | Alignment: ${trendConsistency.alignmentScore.toFixed(1)}%`);
    }

    /**
     * Calculate stable ROC with smoothing
     */
    private calculateStableROC(prices: number[], period: number): number | null {
        if (prices.length < period + 10) return null;

        // Apply light smoothing before ROC calculation
        const smoothedPrices = this.applySmoothingFilter(prices.slice(-period - 10));
        
        const currentPrice = smoothedPrices[smoothedPrices.length - 1];
        const pastPrice = smoothedPrices[smoothedPrices.length - period - 1];
        
        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }

    /**
     * Apply light smoothing to reduce noise
     */
    private applySmoothingFilter(prices: number[]): number[] {
        const smoothed: number[] = [];
        const smoothingPeriod = 5;

        for (let i = 0; i < prices.length; i++) {
            if (i < smoothingPeriod - 1) {
                smoothed.push(prices[i]);
            } else {
                const sum = prices.slice(i - smoothingPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
                smoothed.push(sum / smoothingPeriod);
            }
        }

        return smoothed;
    }

    /**
     * Calculate smoothed momentum
     */
    private calculateSmoothedMomentum(symbol: string): TrendAnalysis['momentum'] {
        const momentumData = this.momentumHistory.get(symbol);
        if (!momentumData || momentumData.length < 20) {
            return {
                current: 0,
                smoothed: 0,
                direction: 'STABLE',
                strength: 0
            };
        }

        const recent = momentumData.slice(-20);
        const current = recent[recent.length - 1];
        const smoothed = recent.reduce((a, b) => a + b, 0) / recent.length;
        
        let direction: 'INCREASING' | 'DECREASING' | 'STABLE' = 'STABLE';
        if (smoothed > 0.1) direction = 'INCREASING';
        else if (smoothed < -0.1) direction = 'DECREASING';
        
        const strength = Math.min(100, Math.abs(smoothed) * 50);

        return { current, smoothed, direction, strength };
    }

    /**
     * Analyze trend consistency across multiple timeframes
     */
    private analyzeTrendConsistency(symbol: string, prices: number[]): TrendAnalysis['trendConsistency'] {
        const last5MinROC = this.calculateStableROC(prices, 40);   // ~5 min
        const last10MinROC = this.calculateStableROC(prices, 80);  // ~10 min
        const last15MinROC = this.calculateStableROC(prices, 120); // ~15 min

        const getTrendFromROC = (roc: number | null): TrendDirection => {
            if (roc === null) return 'neutral';
            if (roc > 0.05) return 'bullish';
            if (roc < -0.05) return 'bearish';
            return 'neutral';
        };

        const last5Minutes = getTrendFromROC(last5MinROC);
        const last10Minutes = getTrendFromROC(last10MinROC);
        const last15Minutes = getTrendFromROC(last15MinROC);

        // Calculate alignment score
        let alignmentScore = 0;
        if (last5Minutes === last10Minutes) alignmentScore += 33;
        if (last10Minutes === last15Minutes) alignmentScore += 33;
        if (last5Minutes === last15Minutes) alignmentScore += 34;

        return {
            last5Minutes,
            last10Minutes,
            last15Minutes,
            alignmentScore
        };
    }

    /**
     * Validate 30-tick trend consistency
     */
    private validate30TickTrend(symbol: string): TrendAnalysis['tickTrend'] {
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
        if (!prices || prices.length < this.LONG_ROC_PERIOD) {
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
        const shortEMA = this.calculateEMA(prices, this.SHORT_ROC_PERIOD);
        const mediumEMA = this.calculateEMA(prices, this.MEDIUM_ROC_PERIOD);
        const longEMA = this.calculateEMA(prices, this.LONG_ROC_PERIOD);

        // Calculate trend slope (rate of change over longer period)
        const trendSlope = this.calculateTrendSlope(prices, 50);

        // Determine market phase
        const marketPhase = this.determineMarketPhase(shortEMA, mediumEMA, longEMA, trendSlope);
        const phaseStrength = Math.abs(trendSlope);

        // Multi-timeframe trend analysis
        const shortTermTrend = this.getEMATrendDirection(prices, shortEMA, this.SHORT_ROC_PERIOD);
        const mediumTermTrend = this.getEMATrendDirection(prices, mediumEMA, this.MEDIUM_ROC_PERIOD);
        const longTermTrend = this.getEMATrendDirection(prices, longEMA, this.LONG_ROC_PERIOD);

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

    /**
     * Determine stable trend direction (requires strong alignment)
     */
    private determineStableTrend(
        longROC: number,
        mediumROC: number, 
        shortROC: number,
        consistency: TrendAnalysis['trendConsistency']
    ): TrendDirection {
        // Require high alignment score for directional bias
        if (consistency.alignmentScore < this.MIN_ALIGNMENT_SCORE) {
            return 'neutral';
        }

        // All ROC periods must generally agree
        const bullishCount = [longROC, mediumROC, shortROC].filter(roc => roc > 0.03).length;
        const bearishCount = [longROC, mediumROC, shortROC].filter(roc => roc < -0.03).length;

        if (bullishCount >= 2 && bearishCount === 0) return 'bullish';
        if (bearishCount >= 2 && bullishCount === 0) return 'bearish';
        
        return 'neutral';
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
     * Detect ROC crossovers for entry signals
     */
    private detectROCCrossover(symbol: string, fastROC: number, slowROC: number, prices: number[]): 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE' {
        // We need previous ROC values to detect crossovers
        if (prices.length < this.MEDIUM_ROC_PERIOD + 2) return 'NONE';

        // Calculate previous ROC values
        const prevPrices = prices.slice(0, -1);
        const prevFastROC = this.calculateStableROC(prevPrices, this.SHORT_ROC_PERIOD);
        const prevSlowROC = this.calculateStableROC(prevPrices, this.MEDIUM_ROC_PERIOD);

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
     * Calculate conservative confidence score
     */
    private calculateConservativeConfidence(
        trend: TrendDirection,
        longROC: number,
        mediumROC: number,
        shortROC: number,
        consistency: TrendAnalysis['trendConsistency'],
        momentum: TrendAnalysis['momentum']
    ): number {
        if (trend === 'neutral') return 30;

        let confidence = 40; // Conservative base

        // Alignment bonus
        confidence += consistency.alignmentScore * 0.4;

        // ROC strength bonus
        const avgROC = Math.abs((longROC + mediumROC + shortROC) / 3);
        confidence += Math.min(avgROC * 200, 20);

        // Momentum confirmation bonus
        if ((trend === 'bullish' && momentum.direction === 'INCREASING') ||
            (trend === 'bearish' && momentum.direction === 'DECREASING')) {
            confidence += momentum.strength * 0.3;
        }

        return Math.min(100, Math.max(30, confidence));
    }

    /**
     * Determine if signal should change (very conservative)
     */
    private shouldChangeSignal(
        current: TrendAnalysis | undefined,
        newTrend: TrendDirection,
        newConfidence: number,
        consistency: TrendAnalysis['trendConsistency']
    ): boolean {
        if (!current) return true;

        // Never change during lock period
        if (current.signalLock.isLocked && Date.now() < current.signalLock.lockUntil) {
            return false;
        }

        // Only change with very high confidence in new direction
        if (newConfidence < this.MIN_CONFIDENCE_FOR_TRADE) {
            return false;
        }

        // Only change if new trend is significantly different
        const currentDirection = current.direction;
        if (currentDirection === newTrend) {
            return false; // Same direction, just update confidence
        }

        // Require strong alignment for direction change
        if (consistency.alignmentScore < this.MIN_ALIGNMENT_SCORE) {
            return false;
        }

        // Must wait minimum hold time since last signal
        const timeSinceSignal = Date.now() - current.timestamp;
        if (timeSinceSignal < this.MIN_SIGNAL_HOLD_TIME) {
            return false;
        }

        return true;
    }

    /**
     * Generate stable recommendation (very conservative)
     */
    private generateStableRecommendation(
        trend: TrendDirection,
        confidence: number,
        consistency: TrendAnalysis['trendConsistency'],
        momentum: TrendAnalysis['momentum'],
        rocAlignment: string,
        rocCrossover: string
    ): 'BUY' | 'SELL' | 'HOLD' {
        // Require very high confidence
        if (confidence < this.MIN_CONFIDENCE_FOR_TRADE) {
            return 'HOLD';
        }

        // Require high alignment
        if (consistency.alignmentScore < this.MIN_ALIGNMENT_SCORE) {
            return 'HOLD';
        }

        // Require strong momentum confirmation
        if (momentum.strength < this.MIN_MOMENTUM_STRENGTH) {
            return 'HOLD';
        }

        // Generate recommendation with momentum confirmation
        if (trend === 'bullish' && momentum.direction === 'INCREASING') {
            return 'BUY';
        } else if (trend === 'bearish' && momentum.direction === 'DECREASING') {
            return 'SELL';
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
     * Calculate trend strength
     */
    private calculateTrendStrength(longROC: number, mediumROC: number, shortROC: number): TrendStrength {
        const avgStrength = Math.abs((longROC + mediumROC + shortROC) / 3);
        if (avgStrength >= 0.15) return 'strong';
        if (avgStrength >= 0.08) return 'moderate';
        return 'weak';
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
     * Generate detailed reason
     */
    private generateDetailedReason(
        recommendation: 'BUY' | 'SELL' | 'HOLD',
        longROC: number,
        mediumROC: number,
        shortROC: number,
        consistency: TrendAnalysis['trendConsistency']
    ): string {
        if (recommendation === 'HOLD') {
            return `Insufficient trend alignment (${consistency.alignmentScore.toFixed(1)}%) - waiting for clearer direction`;
        }

        const direction = recommendation === 'BUY' ? 'upward' : 'downward';
        return `Strong ${direction} trend confirmed across all timeframes. Long-term ROC: ${longROC.toFixed(2)}%, Medium-term: ${mediumROC.toFixed(2)}%, Short-term: ${shortROC.toFixed(2)}%. Alignment: ${consistency.alignmentScore.toFixed(1)}%`;
    }

    /**
     * Update existing analysis without changing recommendation
     */
    private updateExistingAnalysis(
        analysis: TrendAnalysis,
        currentPrice: number,
        confidence: number,
        momentum: TrendAnalysis['momentum']
    ): void {
        analysis.price = currentPrice;
        analysis.confidence = confidence;
        analysis.momentum = momentum;
        analysis.lastUpdate = new Date();
        analysis.signalAge = (Date.now() - analysis.timestamp) / (1000 * 60);
        analysis.timeUntilNextChange = Math.max(0, (analysis.signalLock.lockUntil - Date.now()) / (1000 * 60));
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
     * Get current trading signal for Deriv bot
     */
    getDerivSignal(symbol: string): DerivTradingSignal | null {
        const analysis = this.trendData.get(symbol);
        if (!analysis || analysis.recommendation === 'HOLD') {
            return null;
        }

        // Don't trade if signal is too new or too old
        const signalAge = Date.now() - analysis.timestamp;
        if (signalAge < 60000 || signalAge > this.SIGNAL_COOL_DOWN * 3) { // 1 minute minimum, 9 minutes maximum
            return null;
        }

        const action = analysis.recommendation === 'BUY' ? 'RISE' : 'FALL';

        return {
            symbol,
            action,
            confidence: analysis.confidence,
            timeframe: analysis.confidence >= 85 ? '5m' : '3m',
            entryPrice: analysis.price,
            signalStrength: analysis.momentum.strength,
            holdUntil: new Date(analysis.signalLock.lockUntil),
            nextCheckTime: new Date(Date.now() + this.UPDATE_INTERVAL),
            riskLevel: analysis.confidence >= 85 ? 'LOW' : 'MEDIUM'
        };
    }

    /**
     * Update all symbols (called every 2 minutes)
     */
    private updateAllTrends(): void {
        console.log(`🔄 Checking signals for ${this.trendData.size} symbols...`);
        
        for (const [symbol, analysis] of this.trendData) {
            // Update signal age and lock status
            analysis.signalAge = (Date.now() - analysis.timestamp) / (1000 * 60);
            analysis.signalLock.isLocked = Date.now() < analysis.signalLock.lockUntil;
            analysis.timeUntilNextChange = Math.max(0, 
                (analysis.signalLock.lockUntil - Date.now()) / (1000 * 60)
            );

            if (analysis.signalLock.isLocked) {
                console.log(`🔒 ${symbol}: Signal locked for ${analysis.timeUntilNextChange.toFixed(1)} more minutes`);
            }
        }
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
            displayName: trend.symbol,
            trend,
            rank: index + 1,
            isRecommended: trend.score > 80 // Higher threshold for stable signals
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
        lockedSignals: number;
    } {
        const symbolsWithTickData = this.tickPrices.size;
        const symbolsWithSufficientTicks = Array.from(this.tickPrices.values())
            .filter(ticks => ticks.length >= this.REQUIRED_TICKS).length;

        const totalTicks = Array.from(this.tickPrices.values())
            .reduce((sum, ticks) => sum + ticks.length, 0);
        const avgTickCount = symbolsWithTickData > 0 ? totalTicks / symbolsWithTickData : 0;

        const lockedSignals = Array.from(this.trendData.values())
            .filter(analysis => analysis.signalLock.isLocked).length;

        return {
            totalSymbols: this.trendData.size,
            symbolsWithTickData,
            symbolsWithSufficientTicks,
            avgTickCount,
            lockedSignals
        };
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.trendData.clear();
        this.tickPrices.clear();
        this.priceHistory.clear();
        this.momentumHistory.clear();
        this.ehlersHistory.clear();
        this.signalLocks.clear();
    }
}

// Create singleton instance
export const trendAnalysisEngine = new TrendAnalysisEngine();
