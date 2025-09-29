/**
 * Professional Deriv Market Scanner for Rise/Fall Trading
 * Analyzes all volatility indices with momentum-weighted multi-timeframe analysis
 * Focus: 5-minute trends → 3-minute → 1-minute → 30-second cascade
 */

export interface DerivTickData {
    symbol: string;
    quote: number;
    epoch: number;
}

export type TimeframeDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface MomentumAnalysis {
    raw: number;              // Raw momentum value
    ema: number;              // Smoothed momentum
    acceleration: number;     // Rate of change of momentum
    strength: number;         // 0-100 strength score
    direction: 'INCREASING' | 'DECREASING' | 'FLAT';
    score: number;            // Weighted momentum score (0-100)
    velocity: number;         // Price velocity
    consistency: number;      // Trend consistency (0-100)
}

export interface TimeframeMomentum {
    direction: TimeframeDirection;
    roc: number;
    strength: number;
    confidence: number;
    weight: number;
    momentumScore: number;
    trendQuality: number;
}

export interface MultiTimeframeAnalysis {
    m5: TimeframeMomentum;    // 5-minute (40% weight)
    m3: TimeframeMomentum;    // 3-minute (30% weight)
    m1: TimeframeMomentum;    // 1-minute (20% weight)
    s30: TimeframeMomentum;   // 30-second (10% weight)

    alignment: number;        // 0-100 alignment score
    consensus: TimeframeDirection;
    weightedScore: number;    // Momentum-weighted directional score
    cascadeStrength: number;  // Strength of momentum cascade
}

export interface VolatilityAnalysis {
    symbol: string;
    displayName: string;
    currentPrice: number;
    lastUpdate: Date;

    // Multi-timeframe trend analysis
    timeframes: MultiTimeframeAnalysis;

    // Momentum metrics (heavily weighted - 70%)
    momentum: MomentumAnalysis;

    // Trading recommendation
    recommendation: 'STRONG_RISE' | 'RISE' | 'STRONG_FALL' | 'FALL' | 'NO_TRADE';
    confidence: number;       // 0-100
    contractDuration: '30s' | '1m' | '2m' | '3m' | '5m';

    // Risk assessment
    volatility: number;       // Market volatility score
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

    // Entry criteria
    isTradeReady: boolean;
    entryScore: number;       // Combined score (0-100)
    entryReason: string;

    // Market state
    trendStrength: number;    // 0-100
    marketPhase: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE';

    // Tick statistics
    tickCount: number;
    dataQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';

    // Trading signals
    signals: {
        momentumBreakout: boolean;
        trendConfirmation: boolean;
        volatilityExpansion: boolean;
        priceAcceleration: boolean;
    };
}

export interface ScannerRecommendation {
    rank: number;
    symbol: string;
    displayName: string;
    action: 'RISE' | 'FALL';
    confidence: number;
    duration: '30s' | '1m' | '2m' | '3m' | '5m';
    entryPrice: number;
    momentumScore: number;
    trendAlignment: number;
    reason: string;
    urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    expectedPayout: number;
    riskReward: number;
}

export interface ScannerStatus {
    isActive: boolean;
    symbolsTracked: number;
    recommendationsCount: number;
    lastScanTime: Date;
    avgConfidence: number;
    highestMomentum: string;
}

export class DerivVolatilityScanner {
    // Track all Deriv volatility indices
    private readonly VOLATILITY_SYMBOLS = [
        { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', baseVolatility: 10, ticksPerMinute: 60 },
        { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', baseVolatility: 25, ticksPerMinute: 60 },
        { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', baseVolatility: 50, ticksPerMinute: 60 },
        { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', baseVolatility: 75, ticksPerMinute: 60 },
        { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', baseVolatility: 100, ticksPerMinute: 60 },
        { symbol: 'R_10', name: 'Volatility 10 Index', baseVolatility: 10, ticksPerMinute: 1 },
        { symbol: 'R_25', name: 'Volatility 25 Index', baseVolatility: 25, ticksPerMinute: 1 },
        { symbol: 'R_50', name: 'Volatility 50 Index', baseVolatility: 50, ticksPerMinute: 1 },
        { symbol: 'R_75', name: 'Volatility 75 Index', baseVolatility: 75, ticksPerMinute: 1 },
        { symbol: 'R_100', name: 'Volatility 100 Index', baseVolatility: 100, ticksPerMinute: 1 }
    ];

    // Price and momentum storage
    private priceData: Map<string, Array<{ price: number; timestamp: number }>> = new Map();
    private momentumData: Map<string, number[]> = new Map();
    private velocityData: Map<string, number[]> = new Map();

    // Analysis cache
    private analysisCache: Map<string, VolatilityAnalysis> = new Map();
    private recommendations: ScannerRecommendation[] = [];
    private lastScanTime: number = 0;

    // Timeframe configurations (in ticks/data points)
    private readonly TIMEFRAME_CONFIG = {
        M5: { period: 300, weight: 0.40, label: '5min' },   // 5 minutes - HIGHEST WEIGHT
        M3: { period: 180, weight: 0.30, label: '3min' },  // 3 minutes
        M1: { period: 60, weight: 0.20, label: '1min' },   // 1 minute
        S30: { period: 30, weight: 0.10, label: '30sec' }  // 30 seconds
    };

    // Momentum calculation periods
    private readonly MOMENTUM_FAST = 10;      // Fast momentum (10 data points)
    private readonly MOMENTUM_MEDIUM = 30;    // Medium momentum (30 data points)
    private readonly MOMENTUM_SLOW = 60;      // Slow momentum (60 data points)
    private readonly MOMENTUM_EMA_PERIOD = 20;

    // Trading thresholds (conservative for stability)
    private readonly MIN_CONFIDENCE = 75;
    private readonly MIN_MOMENTUM_STRENGTH = 60;
    private readonly MIN_ALIGNMENT_SCORE = 70;
    private readonly MIN_DATA_POINTS = 350;   // Need at least 5+ minutes of data
    private readonly MIN_TREND_QUALITY = 65;

    // Momentum weighting (75% momentum, 25% trend direction)
    private readonly MOMENTUM_WEIGHT = 0.75;
    private readonly DIRECTION_WEIGHT = 0.25;

    private readonly MAX_HISTORY = 600; // ~10 minutes of data

    // Status tracking
    private scannerStatus: ScannerStatus = {
        isActive: false,
        symbolsTracked: 0,
        recommendationsCount: 0,
        lastScanTime: new Date(),
        avgConfidence: 0,
        highestMomentum: ''
    };

    // Callbacks
    private statusCallbacks: Set<(status: ScannerStatus) => void> = new Set();
    private recommendationCallbacks: Set<(recommendations: ScannerRecommendation[]) => void> = new Set();

    constructor() {
        // Initialize data structures
        this.VOLATILITY_SYMBOLS.forEach(sym => {
            this.priceData.set(sym.symbol, []);
            this.momentumData.set(sym.symbol, []);
            this.velocityData.set(sym.symbol, []);
        });

        console.log('🚀 Deriv Volatility Scanner Initialized');
        console.log('📊 Tracking:', this.VOLATILITY_SYMBOLS.length, 'volatility indices');
        console.log('⚡ Momentum Weight: 75% | Direction Weight: 25%');
        console.log('🎯 Focus: 5min → 3min → 1min → 30sec momentum cascade');
        console.log('🔍 Thresholds: Min Confidence 75%, Min Momentum 60%');

        this.scannerStatus.isActive = true;
        this.scannerStatus.symbolsTracked = this.VOLATILITY_SYMBOLS.length;
    }

    /**
     * Process incoming tick from Deriv stream
     */
    processTick(tick: DerivTickData): void {
        const { symbol, quote, epoch } = tick;

        const priceHistory = this.priceData.get(symbol);
        if (!priceHistory) return;

        const timestamp = epoch * 1000;

        // Store price data
        priceHistory.push({ price: quote, timestamp });

        // Maintain history size
        if (priceHistory.length > this.MAX_HISTORY) {
            priceHistory.shift();
        }

        // Calculate momentum if we have enough data
        if (priceHistory.length >= this.MOMENTUM_FAST) {
            this.calculateAndStoreMomentum(symbol, priceHistory);
        }

        // Update analysis cache if we have sufficient data
        if (priceHistory.length >= this.MIN_DATA_POINTS) {
            this.updateAnalysis(symbol);
        }
    }

    /**
     * Calculate and store momentum data
     */
    private calculateAndStoreMomentum(symbol: string, priceHistory: Array<{ price: number; timestamp: number }>): void {
        const momentumHistory = this.momentumData.get(symbol);
        const velocityHistory = this.velocityData.get(symbol);

        if (!momentumHistory || !velocityHistory) return;

        const current = priceHistory[priceHistory.length - 1];
        const previous = priceHistory[priceHistory.length - 2];

        // Calculate raw momentum (price change)
        const rawMomentum = current.price - previous.price;
        momentumHistory.push(rawMomentum);

        // Calculate velocity (rate of price change)
        const timeDiff = (current.timestamp - previous.timestamp) / 1000; // seconds
        const velocity = timeDiff > 0 ? rawMomentum / timeDiff : 0;
        velocityHistory.push(velocity);

        // Maintain history size
        if (momentumHistory.length > this.MAX_HISTORY) {
            momentumHistory.shift();
        }
        if (velocityHistory.length > this.MAX_HISTORY) {
            velocityHistory.shift();
        }
    }

    /**
     * Update analysis for a symbol
     */
    private updateAnalysis(symbol: string): void {
        const symbolInfo = this.VOLATILITY_SYMBOLS.find(s => s.symbol === symbol);
        if (!symbolInfo) return;

        const analysis = this.performFullAnalysis(symbolInfo);
        if (analysis) {
            this.analysisCache.set(symbol, analysis);
        }
    }

    /**
     * Perform comprehensive multi-timeframe analysis
     */
    private performFullAnalysis(symbolInfo: typeof this.VOLATILITY_SYMBOLS[0]): VolatilityAnalysis | null {
        const priceHistory = this.priceData.get(symbolInfo.symbol);
        const momentumHistory = this.momentumData.get(symbolInfo.symbol);
        const velocityHistory = this.velocityData.get(symbolInfo.symbol);

        if (!priceHistory || !momentumHistory || !velocityHistory || 
            priceHistory.length < this.MIN_DATA_POINTS) {
            return null;
        }

        const currentPrice = priceHistory[priceHistory.length - 1].price;

        // Multi-timeframe analysis
        const timeframes = this.analyzeMultipleTimeframes(priceHistory);

        // Momentum analysis (heavily weighted)
        const momentum = this.analyzeMomentum(momentumHistory, velocityHistory, priceHistory);

        // Determine recommendation
        const { recommendation, confidence, duration } = this.generateRecommendation(
            symbolInfo, timeframes, momentum, currentPrice
        );

        // Calculate entry score
        const entryScore = this.calculateEntryScore(timeframes, momentum, confidence);

        // Assess risk
        const { riskLevel, volatility } = this.assessRisk(symbolInfo, timeframes, momentum);

        // Determine market phase
        const marketPhase = this.determineMarketPhase(timeframes, momentum);

        // Calculate trend strength
        const trendStrength = this.calculateTrendStrength(timeframes, momentum);

        // Generate trading signals
        const signals = this.generateTradingSignals(timeframes, momentum, priceHistory);

        // Generate entry reason
        const entryReason = this.generateEntryReason(recommendation, timeframes, momentum);

        return {
            symbol: symbolInfo.symbol,
            displayName: symbolInfo.name,
            currentPrice,
            lastUpdate: new Date(),
            timeframes,
            momentum,
            recommendation,
            confidence,
            contractDuration: duration,
            volatility,
            riskLevel,
            isTradeReady: confidence >= this.MIN_CONFIDENCE && entryScore >= 70,
            entryScore,
            entryReason,
            trendStrength,
            marketPhase,
            tickCount: priceHistory.length,
            dataQuality: this.assessDataQuality(priceHistory.length),
            signals
        };
    }

    /**
     * Analyze multiple timeframes with momentum cascade
     */
    private analyzeMultipleTimeframes(priceHistory: Array<{ price: number; timestamp: number }>): MultiTimeframeAnalysis {
        const m5 = this.analyzeTimeframe(priceHistory, this.TIMEFRAME_CONFIG.M5);
        const m3 = this.analyzeTimeframe(priceHistory, this.TIMEFRAME_CONFIG.M3);
        const m1 = this.analyzeTimeframe(priceHistory, this.TIMEFRAME_CONFIG.M1);
        const s30 = this.analyzeTimeframe(priceHistory, this.TIMEFRAME_CONFIG.S30);

        // Calculate alignment score
        const directions = [m5.direction, m3.direction, m1.direction, s30.direction];
        const bullishCount = directions.filter(d => d === 'BULLISH').length;
        const bearishCount = directions.filter(d => d === 'BEARISH').length;

        let alignment = 0;
        let consensus: TimeframeDirection = 'NEUTRAL';

        if (bullishCount >= 3) {
            alignment = (bullishCount / 4) * 100;
            consensus = 'BULLISH';
        } else if (bearishCount >= 3) {
            alignment = (bearishCount / 4) * 100;
            consensus = 'BEARISH';
        } else {
            alignment = 25; // Mixed signals
        }

        // Calculate weighted score (5-minute gets highest weight)
        const weightedScore = 
            (m5.momentumScore * m5.weight) +
            (m3.momentumScore * m3.weight) +
            (m1.momentumScore * m1.weight) +
            (s30.momentumScore * s30.weight);

        // Calculate cascade strength (how well momentum flows down timeframes)
        const cascadeStrength = this.calculateCascadeStrength(m5, m3, m1, s30);

        return {
            m5, m3, m1, s30,
            alignment,
            consensus,
            weightedScore,
            cascadeStrength
        };
    }

    /**
     * Analyze single timeframe
     */
    private analyzeTimeframe(
        priceHistory: Array<{ price: number; timestamp: number }>,
        config: { period: number; weight: number; label: string }
    ): TimeframeMomentum {
        if (priceHistory.length < config.period + 10) {
            return {
                direction: 'NEUTRAL',
                roc: 0,
                strength: 0,
                confidence: 0,
                weight: config.weight,
                momentumScore: 0,
                trendQuality: 0
            };
        }

        const currentPrice = priceHistory[priceHistory.length - 1].price;
        const pastPrice = priceHistory[priceHistory.length - config.period].price;

        // Calculate ROC
        const roc = ((currentPrice - pastPrice) / pastPrice) * 100;

        // Determine direction with thresholds
        let direction: TimeframeDirection = 'NEUTRAL';
        const rocThreshold = config.period >= 180 ? 0.015 : 0.025; // Lower threshold for longer timeframes

        if (roc > rocThreshold) direction = 'BULLISH';
        else if (roc < -rocThreshold) direction = 'BEARISH';

        // Calculate trend strength and consistency
        const { strength, confidence, trendQuality } = this.calculateTrendMetrics(
            priceHistory.slice(-config.period), direction
        );

        // Calculate momentum score for this timeframe
        const momentumScore = Math.abs(roc) * strength * (confidence / 100);

        return {
            direction,
            roc,
            strength,
            confidence,
            weight: config.weight,
            momentumScore,
            trendQuality
        };
    }

    /**
     * Calculate trend metrics (strength, confidence, quality)
     */
    private calculateTrendMetrics(
        data: Array<{ price: number; timestamp: number }>,
        direction: TimeframeDirection
    ): { strength: number; confidence: number; trendQuality: number } {
        if (data.length < 10) {
            return { strength: 0, confidence: 0, trendQuality: 0 };
        }

        let upMoves = 0;
        let downMoves = 0;
        let totalMove = 0;

        // Count directional moves
        for (let i = 1; i < data.length; i++) {
            const move = data[i].price - data[i - 1].price;
            totalMove += Math.abs(move);

            if (move > 0) upMoves++;
            else if (move < 0) downMoves++;
        }

        const totalMoves = upMoves + downMoves;
        if (totalMoves === 0) return { strength: 0, confidence: 0, trendQuality: 0 };

        // Calculate strength (dominance of direction)
        const dominantMoves = direction === 'BULLISH' ? upMoves : 
                             direction === 'BEARISH' ? downMoves : 
                             Math.max(upMoves, downMoves);
        const strength = (dominantMoves / totalMoves) * 100;

        // Calculate confidence (consistency of trend)
        const segments = 5;
        const segmentSize = Math.floor(data.length / segments);
        let consistentSegments = 0;

        for (let i = 0; i < segments; i++) {
            const start = i * segmentSize;
            const end = Math.min(start + segmentSize, data.length);
            const segment = data.slice(start, end);

            if (segment.length < 2) continue;

            const segmentROC = ((segment[segment.length - 1].price - segment[0].price) / segment[0].price) * 100;

            if ((direction === 'BULLISH' && segmentROC > 0) ||
                (direction === 'BEARISH' && segmentROC < 0) ||
                (direction === 'NEUTRAL' && Math.abs(segmentROC) < 0.01)) {
                consistentSegments++;
            }
        }

        const confidence = (consistentSegments / segments) * 100;

        // Calculate trend quality (smoothness of trend)
        let volatilitySum = 0;
        for (let i = 1; i < data.length; i++) {
            const change = Math.abs(data[i].price - data[i - 1].price);
            volatilitySum += change;
        }
        const avgVolatility = volatilitySum / (data.length - 1);
        const trendQuality = Math.max(0, 100 - (avgVolatility * 10000)); // Normalize

        return { strength, confidence, trendQuality };
    }

    /**
     * Analyze momentum with velocity and acceleration
     */
    private analyzeMomentum(
        momentumHistory: number[],
        velocityHistory: number[],
        priceHistory: Array<{ price: number; timestamp: number }>
    ): MomentumAnalysis {
        if (momentumHistory.length < this.MOMENTUM_MEDIUM) {
            return {
                raw: 0,
                ema: 0,
                acceleration: 0,
                strength: 0,
                direction: 'FLAT',
                score: 0,
                velocity: 0,
                consistency: 0
            };
        }

        // Calculate EMA of momentum
        const ema = this.calculateEMA(momentumHistory, this.MOMENTUM_EMA_PERIOD);

        // Calculate acceleration (change in velocity)
        const currentVelocity = velocityHistory[velocityHistory.length - 1] || 0;
        const pastVelocity = velocityHistory[velocityHistory.length - 10] || 0;
        const acceleration = currentVelocity - pastVelocity;

        // Calculate momentum strength
        const recentMomentum = momentumHistory.slice(-this.MOMENTUM_FAST);
        const avgMomentum = recentMomentum.reduce((a, b) => a + b, 0) / recentMomentum.length;
        const strength = Math.min(100, Math.abs(avgMomentum) * 10000);

        // Determine direction
        let direction: 'INCREASING' | 'DECREASING' | 'FLAT' = 'FLAT';
        if (ema > 0.0001) direction = 'INCREASING';
        else if (ema < -0.0001) direction = 'DECREASING';

        // Calculate momentum score (0-100)
        const score = Math.min(100, strength * (Math.abs(ema) * 5000));

        // Calculate consistency
        const consistency = this.calculateMomentumConsistency(momentumHistory);

        return {
            raw: avgMomentum,
            ema,
            acceleration,
            strength,
            direction,
            score,
            velocity: currentVelocity,
            consistency
        };
    }

    /**
     * Calculate EMA
     */
    private calculateEMA(data: number[], period: number): number {
        if (data.length < period) return 0;

        const multiplier = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < data.length; i++) {
            ema = (data[i] * multiplier) + (ema * (1 - multiplier));
        }

        return ema;
    }

    /**
     * Calculate momentum consistency
     */
    private calculateMomentumConsistency(momentumHistory: number[]): number {
        if (momentumHistory.length < 20) return 0;

        const recent = momentumHistory.slice(-20);
        const positiveCount = recent.filter(m => m > 0).length;
        const negativeCount = recent.filter(m => m < 0).length;

        const dominantCount = Math.max(positiveCount, negativeCount);
        return (dominantCount / recent.length) * 100;
    }

    /**
     * Calculate cascade strength (momentum flow between timeframes)
     */
    private calculateCascadeStrength(
        m5: TimeframeMomentum,
        m3: TimeframeMomentum,
        m1: TimeframeMomentum,
        s30: TimeframeMomentum
    ): number {
        // Check if momentum flows consistently from longer to shorter timeframes
        const timeframes = [m5, m3, m1, s30];
        let alignedTransitions = 0;

        for (let i = 0; i < timeframes.length - 1; i++) {
            const current = timeframes[i];
            const next = timeframes[i + 1];

            // Check if trend direction is consistent and momentum is maintained
            if (current.direction === next.direction && 
                current.direction !== 'NEUTRAL' &&
                next.momentumScore >= current.momentumScore * 0.7) {
                alignedTransitions++;
            }
        }

        return (alignedTransitions / (timeframes.length - 1)) * 100;
    }

    /**
     * Generate trading recommendation
     */
    private generateRecommendation(
        symbolInfo: typeof this.VOLATILITY_SYMBOLS[0],
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis,
        currentPrice: number
    ): { recommendation: VolatilityAnalysis['recommendation']; confidence: number; duration: VolatilityAnalysis['contractDuration'] } {

        // Check minimum requirements
        if (timeframes.alignment < this.MIN_ALIGNMENT_SCORE ||
            momentum.strength < this.MIN_MOMENTUM_STRENGTH ||
            timeframes.m5.confidence < 60) {
            return {
                recommendation: 'NO_TRADE',
                confidence: Math.max(timeframes.alignment, momentum.strength) * 0.5,
                duration: '1m'
            };
        }

        // Determine recommendation based on 5-minute trend (primary) and momentum
        let recommendation: VolatilityAnalysis['recommendation'] = 'NO_TRADE';
        let confidence = 50;
        let duration: VolatilityAnalysis['contractDuration'] = '3m';

        const m5Strong = timeframes.m5.strength >= 70 && timeframes.m5.confidence >= 70;
        const momentumStrong = momentum.strength >= 70 && momentum.score >= 60;
        const cascadeGood = timeframes.cascadeStrength >= 60;

        if (timeframes.consensus === 'BULLISH' && momentum.direction === 'INCREASING') {
            if (m5Strong && momentumStrong && cascadeGood) {
                recommendation = 'STRONG_RISE';
                confidence = Math.min(95, 75 + (timeframes.alignment * 0.2) + (momentum.strength * 0.15));
                duration = symbolInfo.baseVolatility >= 75 ? '2m' : '5m';
            } else if (timeframes.m5.direction === 'BULLISH' && momentum.strength >= 55) {
                recommendation = 'RISE';
                confidence = Math.min(85, 65 + (timeframes.alignment * 0.15) + (momentum.strength * 0.1));
                duration = symbolInfo.baseVolatility >= 50 ? '1m' : '3m';
            }
        } else if (timeframes.consensus === 'BEARISH' && momentum.direction === 'DECREASING') {
            if (m5Strong && momentumStrong && cascadeGood) {
                recommendation = 'STRONG_FALL';
                confidence = Math.min(95, 75 + (timeframes.alignment * 0.2) + (momentum.strength * 0.15));
                duration = symbolInfo.baseVolatility >= 75 ? '2m' : '5m';
            } else if (timeframes.m5.direction === 'BEARISH' && momentum.strength >= 55) {
                recommendation = 'FALL';
                confidence = Math.min(85, 65 + (timeframes.alignment * 0.15) + (momentum.strength * 0.1));
                duration = symbolInfo.baseVolatility >= 50 ? '1m' : '3m';
            }
        }

        return { recommendation, confidence, duration };
    }

    /**
     * Calculate entry score
     */
    private calculateEntryScore(
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis,
        confidence: number
    ): number {
        const alignmentScore = timeframes.alignment * 0.3;
        const momentumScore = momentum.score * 0.4;
        const confidenceScore = confidence * 0.2;
        const cascadeScore = timeframes.cascadeStrength * 0.1;

        return Math.min(100, alignmentScore + momentumScore + confidenceScore + cascadeScore);
    }

    /**
     * Assess risk level
     */
    private assessRisk(
        symbolInfo: typeof this.VOLATILITY_SYMBOLS[0],
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis
    ): { riskLevel: VolatilityAnalysis['riskLevel']; volatility: number } {
        let riskLevel: VolatilityAnalysis['riskLevel'] = 'MEDIUM';
        const volatility = symbolInfo.baseVolatility;

        // Base risk from volatility index
        if (volatility >= 100) riskLevel = 'EXTREME';
        else if (volatility >= 75) riskLevel = 'HIGH';
        else if (volatility <= 25) riskLevel = 'LOW';

        // Adjust for timeframe alignment
        if (timeframes.alignment < 50) {
            riskLevel = riskLevel === 'LOW' ? 'MEDIUM' : 
                       riskLevel === 'MEDIUM' ? 'HIGH' : 'EXTREME';
        }

        // Adjust for momentum consistency
        if (momentum.consistency < 60) {
            riskLevel = riskLevel === 'LOW' ? 'MEDIUM' : 
                       riskLevel === 'MEDIUM' ? 'HIGH' : 'EXTREME';
        }

        return { riskLevel, volatility };
    }

    /**
     * Determine market phase
     */
    private determineMarketPhase(
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis
    ): VolatilityAnalysis['marketPhase'] {
        if (timeframes.consensus === 'BULLISH' && momentum.direction === 'INCREASING' && momentum.strength >= 60) {
            return 'TRENDING_UP';
        } else if (timeframes.consensus === 'BEARISH' && momentum.direction === 'DECREASING' && momentum.strength >= 60) {
            return 'TRENDING_DOWN';
        } else if (momentum.strength >= 70) {
            return 'VOLATILE';
        } else {
            return 'RANGING';
        }
    }

    /**
     * Calculate trend strength
     */
    private calculateTrendStrength(
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis
    ): number {
        const alignmentWeight = 0.3;
        const momentumWeight = 0.4;
        const cascadeWeight = 0.2;
        const m5Weight = 0.1;

        return Math.min(100,
            (timeframes.alignment * alignmentWeight) +
            (momentum.strength * momentumWeight) +
            (timeframes.cascadeStrength * cascadeWeight) +
            (timeframes.m5.strength * m5Weight)
        );
    }

    /**
     * Generate trading signals
     */
    private generateTradingSignals(
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis,
        priceHistory: Array<{ price: number; timestamp: number }>
    ): VolatilityAnalysis['signals'] {
        return {
            momentumBreakout: momentum.strength >= 75 && momentum.acceleration > 0,
            trendConfirmation: timeframes.alignment >= 75 && timeframes.cascadeStrength >= 70,
            volatilityExpansion: this.detectVolatilityExpansion(priceHistory),
            priceAcceleration: momentum.velocity > 0 && momentum.acceleration > 0
        };
    }

    /**
     * Detect volatility expansion
     */
    private detectVolatilityExpansion(priceHistory: Array<{ price: number; timestamp: number }>): boolean {
        if (priceHistory.length < 60) return false;

        const recent = priceHistory.slice(-30);
        const older = priceHistory.slice(-60, -30);

        const recentVolatility = this.calculateVolatility(recent);
        const olderVolatility = this.calculateVolatility(older);

        return recentVolatility > olderVolatility * 1.5;
    }

    /**
     * Calculate volatility
     */
    private calculateVolatility(data: Array<{ price: number; timestamp: number }>): number {
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
     * Generate entry reason
     */
    private generateEntryReason(
        recommendation: VolatilityAnalysis['recommendation'],
        timeframes: MultiTimeframeAnalysis,
        momentum: MomentumAnalysis
    ): string {
        if (recommendation === 'NO_TRADE') {
            return 'Insufficient signal strength or alignment for reliable trade';
        }

        const reasons = [];

        if (recommendation.includes('RISE')) {
            reasons.push(`5-min bullish trend (${timeframes.m5.roc.toFixed(3)}% ROC)`);
            reasons.push(`Positive momentum cascade (${timeframes.cascadeStrength.toFixed(0)}% strength)`);
        } else {
            reasons.push(`5-min bearish trend (${timeframes.m5.roc.toFixed(3)}% ROC)`);
            reasons.push(`Negative momentum cascade (${timeframes.cascadeStrength.toFixed(0)}% strength)`);
        }

        reasons.push(`${timeframes.alignment.toFixed(0)}% timeframe alignment`);
        reasons.push(`Momentum: ${momentum.strength.toFixed(0)}% strength`);

        if (recommendation.includes('STRONG')) {
            reasons.push('Strong signals across all indicators');
        }

        return reasons.join(' | ');
    }

    /**
     * Assess data quality
     */
    private assessDataQuality(dataPoints: number): VolatilityAnalysis['dataQuality'] {
        if (dataPoints >= 500) return 'EXCELLENT';
        if (dataPoints >= 350) return 'GOOD';
        if (dataPoints >= 200) return 'FAIR';
        return 'POOR';
    }

    /**
     * Get current recommendations
     */
    getRecommendations(): ScannerRecommendation[] {
        const recommendations: ScannerRecommendation[] = [];

        this.analysisCache.forEach(analysis => {
            if (analysis.recommendation !== 'NO_TRADE' && analysis.confidence >= this.MIN_CONFIDENCE) {
                const symbolInfo = this.VOLATILITY_SYMBOLS.find(s => s.symbol === analysis.symbol);
                if (!symbolInfo) return;

                const urgency = analysis.confidence >= 90 ? 'CRITICAL' :
                               analysis.confidence >= 80 ? 'HIGH' :
                               analysis.confidence >= 70 ? 'MEDIUM' : 'LOW';

                recommendations.push({
                    rank: 0, // Will be set after sorting
                    symbol: analysis.symbol,
                    displayName: analysis.displayName,
                    action: analysis.recommendation.includes('RISE') ? 'RISE' : 'FALL',
                    confidence: analysis.confidence,
                    duration: analysis.contractDuration,
                    entryPrice: analysis.currentPrice,
                    momentumScore: analysis.momentum.score,
                    trendAlignment: analysis.timeframes.alignment,
                    reason: analysis.entryReason,
                    urgency,
                    expectedPayout: this.calculateExpectedPayout(analysis.confidence),
                    riskReward: this.calculateRiskReward(analysis.confidence, analysis.riskLevel)
                });
            }
        });

        // Sort by confidence and set ranks
        recommendations.sort((a, b) => b.confidence - a.confidence);
        recommendations.forEach((rec, index) => {
            rec.rank = index + 1;
        });

        this.recommendations = recommendations;
        this.updateScannerStatus();

        return recommendations;
    }

    /**
     * Calculate expected payout
     */
    private calculateExpectedPayout(confidence: number): number {
        // Simplified payout calculation (typically 80-95% for binary options)
        const basePayout = 0.85;
        const confidenceBonus = (confidence - 50) / 100 * 0.1;
        return Math.min(0.95, basePayout + confidenceBonus);
    }

    /**
     * Calculate risk-reward ratio
     */
    private calculateRiskReward(confidence: number, riskLevel: VolatilityAnalysis['riskLevel']): number {
        const riskMultiplier = {
            'LOW': 1.2,
            'MEDIUM': 1.0,
            'HIGH': 0.8,
            'EXTREME': 0.6
        };

        const baseRatio = confidence / 100;
        return baseRatio * riskMultiplier[riskLevel];
    }

    /**
     * Update scanner status
     */
    private updateScannerStatus(): void {
        this.scannerStatus.recommendationsCount = this.recommendations.length;
        this.scannerStatus.lastScanTime = new Date();

        if (this.recommendations.length > 0) {
            this.scannerStatus.avgConfidence = 
                this.recommendations.reduce((sum, rec) => sum + rec.confidence, 0) / this.recommendations.length;

            // Find highest momentum symbol
            let highestMomentum = '';
            let maxMomentum = 0;
            this.analysisCache.forEach(analysis => {
                if (analysis.momentum.score > maxMomentum) {
                    maxMomentum = analysis.momentum.score;
                    highestMomentum = analysis.symbol;
                }
            });
            this.scannerStatus.highestMomentum = highestMomentum;
        }

        // Notify status callbacks
        this.statusCallbacks.forEach(callback => callback(this.scannerStatus));
    }

    /**
     * Get analysis for specific symbol
     */
    getSymbolAnalysis(symbol: string): VolatilityAnalysis | null {
        return this.analysisCache.get(symbol) || null;
    }

    /**
     * Get scanner status
     */
    getStatus(): ScannerStatus {
        return { ...this.scannerStatus };
    }

    /**
     * Subscribe to status updates
     */
    onStatusChange(callback: (status: ScannerStatus) => void): () => void {
        this.statusCallbacks.add(callback);
        return () => this.statusCallbacks.delete(callback);
    }

    /**
     * Subscribe to recommendation updates
     */
    onRecommendationChange(callback: (recommendations: ScannerRecommendation[]) => void): () => void {
        this.recommendationCallbacks.add(callback);
        return () => this.recommendationCallbacks.delete(callback);
    }

    /**
     * Perform full scan and update all recommendations
     */
    async performFullScan(): Promise<ScannerRecommendation[]> {
        console.log('🔍 Performing full volatility scan...');

        let readySymbols = 0;
        let totalDataPoints = 0;

        // Update all analyses
        this.VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const priceHistory = this.priceData.get(symbolInfo.symbol);
            if (priceHistory) {
                totalDataPoints += priceHistory.length;
                if (priceHistory.length >= this.MIN_DATA_POINTS) {
                    readySymbols++;
                    this.updateAnalysis(symbolInfo.symbol);
                }
            }
        });

        console.log(`📊 Scan progress: ${readySymbols}/${this.VOLATILITY_SYMBOLS.length} symbols ready (${totalDataPoints} total data points)`);

        // Get fresh recommendations
        const recommendations = this.getRecommendations();

        // Update scanner status
        this.scannerStatus.recommendationsCount = recommendations.length;
        this.scannerStatus.avgConfidence = recommendations.length > 0 ? 
            recommendations.reduce((sum, rec) => sum + rec.confidence, 0) / recommendations.length : 0;

        // Notify callbacks
        this.statusCallbacks.forEach(callback => callback(this.scannerStatus));
        this.recommendationCallbacks.forEach(callback => callback(recommendations));

        console.log(`✅ Scan complete: ${recommendations.length} recommendations generated (avg confidence: ${this.scannerStatus.avgConfidence.toFixed(1)}%)`);

        return recommendations;
    }

    /**
     * Get top opportunities
     */
    getTopOpportunities(count: number = 3): ScannerRecommendation[] {
        return this.recommendations.slice(0, count);
    }

    /**
     * Cleanup and reset
     */
    reset(): void {
        this.priceData.clear();
        this.momentumData.clear();
        this.velocityData.clear();
        this.analysisCache.clear();
        this.recommendations = [];

        // Reinitialize data structures
        this.VOLATILITY_SYMBOLS.forEach(sym => {
            this.priceData.set(sym.symbol, []);
            this.momentumData.set(sym.symbol, []);
            this.velocityData.set(sym.symbol, []);
        });

        console.log('🔄 Deriv Volatility Scanner reset');
    }
}

// Create singleton instance
export const derivVolatilityScanner = new DerivVolatilityScanner();