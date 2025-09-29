import { CandleData } from './candle-reconstruction-engine';
import { TickBasedCandleEngine, TickCandleData } from './tick-based-candle-engine';
import { EfficientHMACalculator, EfficientHMAResult, EfficientHMASlopeResult } from './efficient-hma-calculator';
import { DerivMarketConfig } from './ehlers-signal-processing';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';
export type MarketPhase = 'rising' | 'falling' | 'ranging' | 'transition';
export type TradingCondition = 'favorable' | 'unfavorable' | 'wait';
export type SignalState = 'STABLE' | 'PENDING_CHANGE' | 'LOCKED';

export interface MomentumTrend {
    fast: number;           // 10-period momentum
    medium: number;         // 30-period momentum  
    slow: number;           // 60-period momentum
    acceleration: number;   // Rate of momentum change
    consistency: number;    // Momentum consistency (0-100)
    strength: number;       // Overall momentum strength (0-100)
    direction: 'INCREASING' | 'DECREASING' | 'FLAT';
}

export interface TimeframeTrend {
    direction: TrendDirection;
    strength: number;       // 0-100
    confidence: number;     // 0-100
    roc: number;           // Rate of change
    duration: number;      // Trend duration in periods
    quality: number;       // Trend quality score (0-100)
}

export interface MultiTimeframeAnalysis {
    m5: TimeframeTrend;    // 5-minute trend (300 ticks)
    m3: TimeframeTrend;    // 3-minute trend (180 ticks)
    m1: TimeframeTrend;    // 1-minute trend (60 ticks)
    s30: TimeframeTrend;   // 30-second trend (30 ticks)

    alignment: {
        score: number;      // 0-100 alignment across timeframes
        consensus: TrendDirection;
        strength: number;   // Strength of consensus
    };

    momentum: {
        cascade: number;    // Momentum cascade strength (0-100)
        flow: 'UP' | 'DOWN' | 'MIXED';
        acceleration: number;
    };
}

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

    // Multi-timeframe analysis (primary focus)
    multiTimeframe: MultiTimeframeAnalysis;

    // Momentum analysis (heavily weighted)
    momentum: MomentumTrend;

    // Market phase and conditions
    marketPhase: MarketPhase;
    phaseStrength: number;
    isTrending: boolean;
    tradingCondition: TradingCondition;

    // Signal management
    signalState: SignalState;
    signalAge: number;
    timeUntilNextChange: number;
    confirmationStreak: number;

    // Entry and exit criteria
    entryScore: number;     // Combined entry score (0-100)
    entryPrice: number;
    targetDuration: '30s' | '1m' | '2m' | '3m' | '5m';

    // Risk assessment
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    volatilityIndex: number;

    // Data quality
    tickCount: number;
    dataQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';

    // Trading signals
    signals: {
        momentumBreakout: boolean;
        trendConfirmation: boolean;
        multiTimeframeAlignment: boolean;
        volumeConfirmation: boolean;
    };

    // Legacy fields (for compatibility)
    longTermROC?: number;
    mediumTermROC?: number;
    shortTermROC?: number;
    rocAlignment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rocCrossover?: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE';
}

export interface MarketScanResult {
    symbol: string;
    displayName: string;
    trend: TrendAnalysis;
    rank: number;
    isRecommended: boolean;
    momentumScore: number;
    alignmentScore: number;
}

export interface DerivTradingSignal {
    symbol: string;
    action: 'RISE' | 'FALL' | 'WAIT';
    confidence: number;
    timeframe: '30s' | '1m' | '2m' | '3m' | '5m';
    entryPrice: number;
    signalStrength: number;
    holdUntil: Date;
    nextCheckTime: Date;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reason: string;
}

export class TrendAnalysisEngine {
    private trendData: Map<string, TrendAnalysis> = new Map();
    private tickPrices: Map<string, Array<{ price: number; timestamp: number }>> = new Map();
    private momentumHistory: Map<string, number[]> = new Map();
    private signalLocks: Map<string, number> = new Map();
    private hmaCalculator: EfficientHMACalculator;

    // Timeframe periods (in ticks/data points)
    private readonly TIMEFRAMES = {
        M5: 300,    // 5 minutes
        M3: 180,    // 3 minutes
        M1: 60,     // 1 minute
        S30: 30     // 30 seconds
    };

    // Momentum periods
    private readonly MOMENTUM_FAST = 10;
    private readonly MOMENTUM_MEDIUM = 30;
    private readonly MOMENTUM_SLOW = 60;

    // Trading thresholds (conservative)
    private readonly MIN_CONFIDENCE = 75;
    private readonly MIN_MOMENTUM_STRENGTH = 60;
    private readonly MIN_ALIGNMENT_SCORE = 70;
    private readonly MIN_DATA_POINTS = 350;

    // Weighting factors (momentum-heavy)
    private readonly MOMENTUM_WEIGHT = 0.70;    // 70% momentum
    private readonly TREND_WEIGHT = 0.30;       // 30% trend direction

    private readonly MAX_HISTORY = 600;
    private readonly UPDATE_INTERVAL = 10000;   // 10 seconds

    constructor(hmaCalculator: EfficientHMACalculator) {
        this.hmaCalculator = hmaCalculator;

        console.log('🚀 Multi-Timeframe Trend Analysis Engine Initialized');
        console.log('📊 Timeframes: 5m → 3m → 1m → 30s (momentum cascade)');
        console.log('⚡ Weighting: 70% Momentum | 30% Trend Direction');
        console.log('🎯 Thresholds: 75% min confidence, 60% min momentum');
    }

    /**
     * Add candle data
     */
    addCandleData(candle: CandleData): void {
        this.processPriceData(candle.symbol, candle.close, candle.timestamp.getTime());
    }

    /**
     * Add tick-based candle data
     */
    addTickCandleData(candle: TickCandleData): void {
        this.processPriceData(candle.symbol, candle.close, candle.endTimestamp.getTime());
    }

    /**
     * Process individual tick
     */
    processTick(tick: { symbol: string; quote: number; epoch: number }): void {
        this.processPriceData(tick.symbol, tick.quote, tick.epoch * 1000);
    }

    /**
     * Process price data (unified method)
     */
    private processPriceData(symbol: string, price: number, timestamp: number): void {
        // Initialize data structures
        if (!this.tickPrices.has(symbol)) {
            this.tickPrices.set(symbol, []);
            this.momentumHistory.set(symbol, []);
        }

        const priceHistory = this.tickPrices.get(symbol)!;
        const momentumData = this.momentumHistory.get(symbol)!;

        // Store price data
        priceHistory.push({ price, timestamp });

        // Calculate momentum if we have previous data
        if (priceHistory.length >= 2) {
            const prevPrice = priceHistory[priceHistory.length - 2].price;
            const momentum = price - prevPrice;
            momentumData.push(momentum);
        }

        // Maintain history size
        if (priceHistory.length > this.MAX_HISTORY) {
            priceHistory.shift();
        }
        if (momentumData.length > this.MAX_HISTORY) {
            momentumData.shift();
        }

        // Perform analysis if we have sufficient data
        if (priceHistory.length >= this.MIN_DATA_POINTS && this.canUpdateSignal(symbol)) {
            this.performAnalysis(symbol, price, timestamp);
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
     * Perform comprehensive trend analysis
     */
    private performAnalysis(symbol: string, currentPrice: number, timestamp: number): void {
        const priceHistory = this.tickPrices.get(symbol);
        const momentumData = this.momentumHistory.get(symbol);

        if (!priceHistory || !momentumData || priceHistory.length < this.MIN_DATA_POINTS) {
            return;
        }

        // Multi-timeframe analysis
        const multiTimeframe = this.analyzeMultipleTimeframes(priceHistory);

        // Momentum analysis
        const momentum = this.analyzeMomentum(momentumData, priceHistory);

        // Determine overall trend direction and strength
        const { direction, strength, confidence } = this.synthesizeTrend(multiTimeframe, momentum);

        // Generate recommendation
        const recommendation = this.generateRecommendation(multiTimeframe, momentum, confidence);

        // Calculate entry score
        const entryScore = this.calculateEntryScore(multiTimeframe, momentum, confidence);

        // Determine market phase
        const marketPhase = this.determineMarketPhase(multiTimeframe, momentum);

        // Assess risk
        const riskLevel = this.assessRisk(multiTimeframe, momentum);

        // Generate trading signals
        const signals = this.generateTradingSignals(multiTimeframe, momentum);

        // Determine target duration
        const targetDuration = this.determineTargetDuration(multiTimeframe, momentum, strength);

        // Create comprehensive analysis
        const analysis: TrendAnalysis = {
            symbol,
            timestamp,
            direction,
            strength,
            confidence,
            score: entryScore,
            price: currentPrice,
            recommendation,
            reason: this.generateReason(recommendation, multiTimeframe, momentum),
            lastUpdate: new Date(),

            multiTimeframe,
            momentum,

            marketPhase,
            phaseStrength: this.calculatePhaseStrength(multiTimeframe, momentum),
            isTrending: marketPhase === 'rising' || marketPhase === 'falling',
            tradingCondition: this.assessTradingCondition(multiTimeframe, momentum),

            signalState: 'STABLE',
            signalAge: 0,
            timeUntilNextChange: 2, // 2 minutes
            confirmationStreak: 1,

            entryScore,
            entryPrice: currentPrice,
            targetDuration,

            riskLevel,
            volatilityIndex: this.calculateVolatilityIndex(momentumData),

            tickCount: priceHistory.length,
            dataQuality: this.assessDataQuality(priceHistory.length),

            signals
        };

        // Lock signal for stability
        this.signalLocks.set(symbol, Date.now() + 120000); // 2 minutes

        this.trendData.set(symbol, analysis);

        console.log(`🔄 ${symbol}: ${recommendation} | Confidence: ${confidence.toFixed(1)}% | Momentum: ${momentum.strength.toFixed(1)}% | Alignment: ${multiTimeframe.alignment.score.toFixed(1)}%`);
    }

    /**
     * Analyze multiple timeframes
     */
    private analyzeMultipleTimeframes(priceHistory: Array<{ price: number; timestamp: number }>): MultiTimeframeAnalysis {
        const m5 = this.analyzeTimeframe(priceHistory, this.TIMEFRAMES.M5);
        const m3 = this.analyzeTimeframe(priceHistory, this.TIMEFRAMES.M3);
        const m1 = this.analyzeTimeframe(priceHistory, this.TIMEFRAMES.M1);
        const s30 = this.analyzeTimeframe(priceHistory, this.TIMEFRAMES.S30);

        // Calculate alignment
        const alignment = this.calculateTimeframeAlignment([m5, m3, m1, s30]);

        // Calculate momentum cascade
        const momentum = this.calculateMomentumCascade([m5, m3, m1, s30]);

        return {
            m5, m3, m1, s30,
            alignment,
            momentum
        };
    }

    /**
     * Analyze single timeframe
     */
    private analyzeTimeframe(priceHistory: Array<{ price: number; timestamp: number }>, period: number): TimeframeTrend {
        if (priceHistory.length < period + 10) {
            return {
                direction: 'neutral',
                strength: 0,
                confidence: 0,
                roc: 0,
                duration: 0,
                quality: 0
            };
        }

        const currentPrice = priceHistory[priceHistory.length - 1].price;
        const pastPrice = priceHistory[priceHistory.length - period].price;

        // Calculate ROC
        const roc = ((currentPrice - pastPrice) / pastPrice) * 100;

        // Determine direction with dynamic thresholds
        const threshold = period >= 180 ? 0.015 : 0.025; // Lower threshold for longer timeframes
        let direction: TrendDirection = 'neutral';

        if (roc > threshold) direction = 'bullish';
        else if (roc < -threshold) direction = 'bearish';

        // Calculate trend metrics
        const timeframeData = priceHistory.slice(-period);
        const { strength, confidence, quality, duration } = this.calculateTrendMetrics(timeframeData, direction);

        return {
            direction,
            strength,
            confidence,
            roc,
            duration,
            quality
        };
    }

    /**
     * Calculate trend metrics for timeframe
     */
    private calculateTrendMetrics(
        data: Array<{ price: number; timestamp: number }>,
        direction: TrendDirection
    ): { strength: number; confidence: number; quality: number; duration: number } {
        if (data.length < 10) {
            return { strength: 0, confidence: 0, quality: 0, duration: 0 };
        }

        let upMoves = 0;
        let downMoves = 0;
        let trendDuration = 0;
        let lastDirection = '';

        // Analyze price movements
        for (let i = 1; i < data.length; i++) {
            const move = data[i].price - data[i - 1].price;

            if (move > 0) {
                upMoves++;
                if (lastDirection === 'up') trendDuration++;
                else { trendDuration = 1; lastDirection = 'up'; }
            } else if (move < 0) {
                downMoves++;
                if (lastDirection === 'down') trendDuration++;
                else { trendDuration = 1; lastDirection = 'down'; }
            }
        }

        const totalMoves = upMoves + downMoves;
        if (totalMoves === 0) return { strength: 0, confidence: 0, quality: 0, duration: 0 };

        // Calculate strength (dominance of direction)
        const dominantMoves = direction === 'bullish' ? upMoves : 
                             direction === 'bearish' ? downMoves : 
                             Math.max(upMoves, downMoves);
        const strength = (dominantMoves / totalMoves) * 100;

        // Calculate confidence (consistency)
        const expectedDirection = direction === 'bullish' ? upMoves : downMoves;
        const confidence = (expectedDirection / totalMoves) * 100;

        // Calculate quality (smoothness)
        const volatility = this.calculateDataVolatility(data);
        const quality = Math.max(0, 100 - (volatility * 1000));

        return { strength, confidence, quality, duration: trendDuration };
    }

    /**
     * Calculate data volatility
     */
    private calculateDataVolatility(data: Array<{ price: number; timestamp: number }>): number {
        if (data.length < 2) return 0;

        const returns = [];
        for (let i = 1; i < data.length; i++) {
            returns.push((data[i].price - data[i - 1].price) / data[i - 1].price);
        }

        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - mean, 2), 0) / returns.length;

        return Math.sqrt(variance);
    }

    /**
     * Calculate timeframe alignment
     */
    private calculateTimeframeAlignment(timeframes: TimeframeTrend[]): MultiTimeframeAnalysis['alignment'] {
        const directions = timeframes.map(tf => tf.direction);
        const bullishCount = directions.filter(d => d === 'bullish').length;
        const bearishCount = directions.filter(d => d === 'bearish').length;

        let consensus: TrendDirection = 'neutral';
        let score = 0;
        let strength = 0;

        if (bullishCount >= 3) {
            consensus = 'bullish';
            score = (bullishCount / 4) * 100;
            strength = timeframes.filter(tf => tf.direction === 'bullish')
                                 .reduce((sum, tf) => sum + tf.strength, 0) / bullishCount;
        } else if (bearishCount >= 3) {
            consensus = 'bearish';
            score = (bearishCount / 4) * 100;
            strength = timeframes.filter(tf => tf.direction === 'bearish')
                                 .reduce((sum, tf) => sum + tf.strength, 0) / bearishCount;
        } else {
            score = 25; // Mixed signals
            strength = timeframes.reduce((sum, tf) => sum + tf.strength, 0) / timeframes.length;
        }

        return { score, consensus, strength };
    }

    /**
     * Calculate momentum cascade
     */
    private calculateMomentumCascade(timeframes: TimeframeTrend[]): MultiTimeframeAnalysis['momentum'] {
        // Check if momentum flows from longer to shorter timeframes
        let cascadeStrength = 0;
        let flowDirection: 'UP' | 'DOWN' | 'MIXED' = 'MIXED';

        // Compare consecutive timeframes
        for (let i = 0; i < timeframes.length - 1; i++) {
            const longer = timeframes[i];
            const shorter = timeframes[i + 1];

            if (longer.direction === shorter.direction && longer.direction !== 'neutral') {
                cascadeStrength += 25; // Each alignment adds 25%
            }
        }

        // Determine flow direction
        const m5 = timeframes[0]; // 5-minute is primary
        if (m5.direction === 'bullish' && m5.strength >= 60) {
            flowDirection = 'UP';
        } else if (m5.direction === 'bearish' && m5.strength >= 60) {
            flowDirection = 'DOWN';
        }

        // Calculate average acceleration across timeframes
        const acceleration = timeframes.reduce((sum, tf) => sum + Math.abs(tf.roc), 0) / timeframes.length;

        return {
            cascade: cascadeStrength,
            flow: flowDirection,
            acceleration
        };
    }

    /**
     * Analyze momentum
     */
    private analyzeMomentum(momentumData: number[], priceHistory: Array<{ price: number; timestamp: number }>): MomentumTrend {
        if (momentumData.length < this.MOMENTUM_SLOW) {
            return {
                fast: 0,
                medium: 0,
                slow: 0,
                acceleration: 0,
                consistency: 0,
                strength: 0,
                direction: 'FLAT'
            };
        }

        // Calculate momentum for different periods
        const fast = this.calculateMomentumAverage(momentumData, this.MOMENTUM_FAST);
        const medium = this.calculateMomentumAverage(momentumData, this.MOMENTUM_MEDIUM);
        const slow = this.calculateMomentumAverage(momentumData, this.MOMENTUM_SLOW);

        // Calculate acceleration (change in fast momentum)
        const acceleration = this.calculateMomentumAcceleration(momentumData);

        // Calculate consistency
        const consistency = this.calculateMomentumConsistency(momentumData);

        // Calculate overall strength
        const strength = Math.min(100, Math.abs(fast) * 10000 + consistency * 0.5);

        // Determine direction
        let direction: 'INCREASING' | 'DECREASING' | 'FLAT' = 'FLAT';
        if (fast > 0.0001 && medium > 0) direction = 'INCREASING';
        else if (fast < -0.0001 && medium < 0) direction = 'DECREASING';

        return {
            fast,
            medium,
            slow,
            acceleration,
            consistency,
            strength,
            direction
        };
    }

    /**
     * Calculate momentum average for period
     */
    private calculateMomentumAverage(momentumData: number[], period: number): number {
        if (momentumData.length < period) return 0;

        const recent = momentumData.slice(-period);
        return recent.reduce((sum, m) => sum + m, 0) / recent.length;
    }

    /**
     * Calculate momentum acceleration
     */
    private calculateMomentumAcceleration(momentumData: number[]): number {
        if (momentumData.length < 20) return 0;

        const recent = momentumData.slice(-10);
        const previous = momentumData.slice(-20, -10);

        const recentAvg = recent.reduce((sum, m) => sum + m, 0) / recent.length;
        const previousAvg = previous.reduce((sum, m) => sum + m, 0) / previous.length;

        return recentAvg - previousAvg;
    }

    /**
     * Calculate momentum consistency
     */
    private calculateMomentumConsistency(momentumData: number[]): number {
        if (momentumData.length < 30) return 0;

        const recent = momentumData.slice(-30);
        const positiveCount = recent.filter(m => m > 0).length;
        const negativeCount = recent.filter(m => m < 0).length;

        const dominantCount = Math.max(positiveCount, negativeCount);
        return (dominantCount / recent.length) * 100;
    }

    /**
     * Synthesize overall trend from multi-timeframe and momentum analysis
     */
    private synthesizeTrend(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): { direction: TrendDirection; strength: TrendStrength; confidence: number } {

        // Weight 5-minute trend heavily (50%), momentum (30%), alignment (20%)
        const m5Weight = 0.50;
        const momentumWeight = 0.30;
        const alignmentWeight = 0.20;

        let direction: TrendDirection = 'neutral';
        let strengthScore = 0;
        let confidence = 0;

        // Primary direction from 5-minute and momentum
        if (multiTimeframe.m5.direction === 'bullish' && 
            (momentum.direction === 'INCREASING' || momentum.fast > 0)) {
            direction = 'bullish';
        } else if (multiTimeframe.m5.direction === 'bearish' && 
                  (momentum.direction === 'DECREASING' || momentum.fast < 0)) {
            direction = 'bearish';
        } else if (multiTimeframe.alignment.consensus !== 'neutral') {
            direction = multiTimeframe.alignment.consensus;
        }

        // Calculate weighted strength
        strengthScore = 
            (multiTimeframe.m5.strength * m5Weight) +
            (momentum.strength * momentumWeight) +
            (multiTimeframe.alignment.score * alignmentWeight);

        // Calculate confidence
        confidence = Math.min(100, 
            (multiTimeframe.m5.confidence * 0.4) +
            (momentum.consistency * 0.3) +
            (multiTimeframe.alignment.score * 0.3)
        );

        // Determine strength category
        let strength: TrendStrength = 'weak';
        if (strengthScore >= 75) strength = 'strong';
        else if (strengthScore >= 50) strength = 'moderate';

        return { direction, strength, confidence };
    }

    /**
     * Generate trading recommendation
     */
    private generateRecommendation(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend,
        confidence: number
    ): 'BUY' | 'SELL' | 'HOLD' {

        // Check minimum requirements
        if (confidence < this.MIN_CONFIDENCE ||
            momentum.strength < this.MIN_MOMENTUM_STRENGTH ||
            multiTimeframe.alignment.score < this.MIN_ALIGNMENT_SCORE) {
            return 'HOLD';
        }

        // 5-minute trend must be strong and aligned with momentum
        const m5Strong = multiTimeframe.m5.strength >= 60 && multiTimeframe.m5.confidence >= 65;
        const momentumAligned = 
            (multiTimeframe.m5.direction === 'bullish' && momentum.direction === 'INCREASING') ||
            (multiTimeframe.m5.direction === 'bearish' && momentum.direction === 'DECREASING');

        if (!m5Strong || !momentumAligned) {
            return 'HOLD';
        }

        // Generate recommendation based on alignment and momentum
        if (multiTimeframe.alignment.consensus === 'bullish' && 
            momentum.direction === 'INCREASING' &&
            multiTimeframe.momentum.flow === 'UP') {
            return 'BUY';
        } else if (multiTimeframe.alignment.consensus === 'bearish' && 
                  momentum.direction === 'DECREASING' &&
                  multiTimeframe.momentum.flow === 'DOWN') {
            return 'SELL';
        }

        return 'HOLD';
    }

    /**
     * Calculate entry score
     */
    private calculateEntryScore(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend,
        confidence: number
    ): number {
        const alignmentScore = multiTimeframe.alignment.score * 0.25;
        const momentumScore = momentum.strength * 0.35;
        const cascadeScore = multiTimeframe.momentum.cascade * 0.20;
        const confidenceScore = confidence * 0.20;

        return Math.min(100, alignmentScore + momentumScore + cascadeScore + confidenceScore);
    }

    /**
     * Determine market phase
     */
    private determineMarketPhase(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): MarketPhase {
        const m5 = multiTimeframe.m5;

        if (m5.direction === 'bullish' && momentum.direction === 'INCREASING' && momentum.strength >= 60) {
            return 'rising';
        } else if (m5.direction === 'bearish' && momentum.direction === 'DECREASING' && momentum.strength >= 60) {
            return 'falling';
        } else if (multiTimeframe.alignment.score < 50) {
            return 'transition';
        } else {
            return 'ranging';
        }
    }

    /**
     * Calculate phase strength
     */
    private calculatePhaseStrength(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): number {
        return Math.min(100, 
            (multiTimeframe.alignment.score * 0.4) +
            (momentum.strength * 0.4) +
            (multiTimeframe.momentum.cascade * 0.2)
        );
    }

    /**
     * Assess trading condition
     */
    private assessTradingCondition(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): TradingCondition {
        const isAligned = multiTimeframe.alignment.score >= this.MIN_ALIGNMENT_SCORE;
        const hasStrong5Min = multiTimeframe.m5.strength >= 60 && multiTimeframe.m5.confidence >= 65;
        const hasStrongMomentum = momentum.strength >= this.MIN_MOMENTUM_STRENGTH;

        if (isAligned && hasStrong5Min && hasStrongMomentum) {
            return 'favorable';
        } else if (isAligned || hasStrong5Min) {
            return 'wait';
        } else {
            return 'unfavorable';
        }
    }

    /**
     * Assess risk level
     */
    private assessRisk(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): 'LOW' | 'MEDIUM' | 'HIGH' {
        let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

        // Low risk conditions
        if (multiTimeframe.alignment.score >= 85 && 
            momentum.consistency >= 75 &&
            multiTimeframe.momentum.cascade >= 75) {
            risk = 'LOW';
        }
        // High risk conditions
        else if (multiTimeframe.alignment.score < 60 ||
                momentum.consistency < 50 ||
                multiTimeframe.momentum.cascade < 50) {
            risk = 'HIGH';
        }

        return risk;
    }

    /**
     * Generate trading signals
     */
    private generateTradingSignals(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): TrendAnalysis['signals'] {
        return {
            momentumBreakout: momentum.strength >= 75 && momentum.acceleration > 0,
            trendConfirmation: multiTimeframe.alignment.score >= 75,
            multiTimeframeAlignment: multiTimeframe.momentum.cascade >= 70,
            volumeConfirmation: momentum.consistency >= 70
        };
    }

    /**
     * Determine target duration
     */
    private determineTargetDuration(
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend,
        strength: TrendStrength
    ): '30s' | '1m' | '2m' | '3m' | '5m' {
        // Base duration on trend strength and momentum
        if (strength === 'strong' && momentum.strength >= 80 && multiTimeframe.alignment.score >= 85) {
            return '5m'; // Strong trends can hold longer
        } else if (strength === 'strong' || momentum.strength >= 70) {
            return '3m';
        } else if (strength === 'moderate' || momentum.strength >= 60) {
            return '2m';
        } else if (momentum.strength >= 50) {
            return '1m';
        } else {
            return '30s';
        }
    }

    /**
     * Calculate volatility index
     */
    private calculateVolatilityIndex(momentumData: number[]): number {
        if (momentumData.length < 30) return 0;

        const recent = momentumData.slice(-30);
        const variance = this.calculateVariance(recent);

        return Math.min(100, variance * 100000);
    }

    /**
     * Calculate variance
     */
    private calculateVariance(data: number[]): number {
        const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
        return variance;
    }

    /**
     * Assess data quality
     */
    private assessDataQuality(dataPoints: number): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' {
        if (dataPoints >= 500) return 'EXCELLENT';
        if (dataPoints >= 400) return 'GOOD';
        if (dataPoints >= 300) return 'FAIR';
        return 'POOR';
    }

    /**
     * Generate reason string
     */
    private generateReason(
        recommendation: 'BUY' | 'SELL' | 'HOLD',
        multiTimeframe: MultiTimeframeAnalysis,
        momentum: MomentumTrend
    ): string {
        if (recommendation === 'HOLD') {
            return 'Insufficient signal strength or alignment for reliable trade';
        }

        const reasons = [];

        if (recommendation === 'BUY') {
            reasons.push(`5-min bullish trend (${multiTimeframe.m5.roc.toFixed(3)}% ROC)`);
            reasons.push(`Positive momentum cascade (${multiTimeframe.momentum.cascade.toFixed(0)}%)`);
        } else {
            reasons.push(`5-min bearish trend (${multiTimeframe.m5.roc.toFixed(3)}% ROC)`);
            reasons.push(`Negative momentum cascade (${multiTimeframe.momentum.cascade.toFixed(0)}%)`);
        }

        reasons.push(`${multiTimeframe.alignment.score.toFixed(0)}% timeframe alignment`);
        reasons.push(`Momentum: ${momentum.strength.toFixed(0)}% strength`);

        return reasons.join(' | ');
    }

    /**
     * Get trend analysis for symbol
     */
    getTrendAnalysis(symbol: string): TrendAnalysis | null {
        return this.trendData.get(symbol) || null;
    }

    /**
     * Scan market for opportunities
     */
    scanMarket(symbols: Array<{ symbol: string; display_name: string }>): MarketScanResult[] {
        const results: MarketScanResult[] = [];

        symbols.forEach(symbolInfo => {
            const trend = this.getTrendAnalysis(symbolInfo.symbol);
            if (trend && trend.recommendation !== 'HOLD') {
                results.push({
                    symbol: symbolInfo.symbol,
                    displayName: symbolInfo.display_name,
                    trend,
                    rank: 0, // Will be set after sorting
                    isRecommended: trend.confidence >= this.MIN_CONFIDENCE,
                    momentumScore: trend.momentum.strength,
                    alignmentScore: trend.multiTimeframe.alignment.score
                });
            }
        });

        // Sort by entry score and set ranks
        results.sort((a, b) => b.trend.entryScore - a.trend.entryScore);
        results.forEach((result, index) => {
            result.rank = index + 1;
        });

        return results;
    }

    /**
     * Get top opportunities
     */
    getTopOpportunities(count: number = 5): MarketScanResult[] {
        const allResults: MarketScanResult[] = [];

        this.trendData.forEach((trend, symbol) => {
            if (trend.recommendation !== 'HOLD' && trend.confidence >= this.MIN_CONFIDENCE) {
                allResults.push({
                    symbol,
                    displayName: symbol, // You might want to map this properly
                    trend,
                    rank: 0,
                    isRecommended: true,
                    momentumScore: trend.momentum.strength,
                    alignmentScore: trend.multiTimeframe.alignment.score
                });
            }
        });

        return allResults
            .sort((a, b) => b.trend.entryScore - a.trend.entryScore)
            .slice(0, count)
            .map((result, index) => ({ ...result, rank: index + 1 }));
    }

    /**
     * Generate Deriv trading signal
     */
    generateDerivSignal(symbol: string): DerivTradingSignal | null {
        const analysis = this.getTrendAnalysis(symbol);
        if (!analysis || analysis.recommendation === 'HOLD') {
            return null;
        }

        const action = analysis.recommendation === 'BUY' ? 'RISE' : 'FALL';
        const holdDuration = this.getHoldDurationMs(analysis.targetDuration);

        return {
            symbol,
            action,
            confidence: analysis.confidence,
            timeframe: analysis.targetDuration,
            entryPrice: analysis.entryPrice,
            signalStrength: analysis.entryScore,
            holdUntil: new Date(Date.now() + holdDuration),
            nextCheckTime: new Date(Date.now() + 120000), // Check again in 2 minutes
            riskLevel: analysis.riskLevel,
            reason: analysis.reason
        };
    }

    /**
     * Get hold duration in milliseconds
     */
    private getHoldDurationMs(duration: '30s' | '1m' | '2m' | '3m' | '5m'): number {
        const durations = {
            '30s': 30 * 1000,
            '1m': 60 * 1000,
            '2m': 120 * 1000,
            '3m': 180 * 1000,
            '5m': 300 * 1000
        };
        return durations[duration];
    }

    /**
     * Update all trends (periodic maintenance)
     */
    updateAllTrends(): void {
        console.log(`🔄 Updating ${this.trendData.size} trend analyses...`);

        // This would be called periodically if needed
        // Most updates happen in real-time via processTick/addCandleData
    }

    /**
     * Reset engine
     */
    reset(): void {
        this.trendData.clear();
        this.tickPrices.clear();
        this.momentumHistory.clear();
        this.signalLocks.clear();

        console.log('🔄 Trend Analysis Engine reset');
    }

    /**
     * Get engine statistics
     */
    getStats(): {
        symbolsTracked: number;
        averageConfidence: number;
        strongSignals: number;
        totalRecommendations: number;
    } {
        const analyses = Array.from(this.trendData.values());
        const recommendations = analyses.filter(a => a.recommendation !== 'HOLD');

        return {
            symbolsTracked: this.trendData.size,
            averageConfidence: analyses.length > 0 ? 
                analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length : 0,
            strongSignals: analyses.filter(a => a.strength === 'strong').length,
            totalRecommendations: recommendations.length
        };
    }
}