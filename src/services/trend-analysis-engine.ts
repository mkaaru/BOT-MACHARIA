import { CandleData } from './candle-reconstruction-engine';
import { EfficientHMACalculator, EfficientHMAResult, EfficientHMASlopeResult } from './efficient-hma-calculator';
import { ehlersProcessor, EhlersSignals, DerivMarketConfig } from './ehlers-signal-processing';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';

export interface PullbackAnalysis {
    isPullback: boolean;
    pullbackType: 'bullish_pullback' | 'bearish_pullback' | 'none';
    pullbackStrength: 'weak' | 'medium' | 'strong';
    longerTermTrend: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    entrySignal: boolean;
    decyclerValue?: number;
    priceVsDecycler?: number;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
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

    // Technical indicators
    shortTermHMA?: number;
    longTermHMA?: number;
    rocAlignment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    longTermTrend?: TrendDirection;
    longTermTrendStrength?: number;

    // Enhanced Ehlers data
    ehlers?: {
        decycler: number;
        instantaneousTrendline: number;
        snr: number;
        netValue: number;
        anticipatorySignal: number;
        decycler200?: number; // Added for 200-period decycler
        decycler200Slope?: number; // Added for 200-period decycler slope
    };

    ehlersRecommendation?: {
        action: string;
        confidence: number;
        reason: string;
        anticipatory: boolean;
        signalStrength: 'weak' | 'medium' | 'strong';
        isPullbackSignal?: boolean;
    };

    // Enhanced pullback analysis
    pullbackAnalysis?: PullbackAnalysis;

    // Cycle trading assessment
    cycleTrading?: {
        suitable: boolean;
        snrLevel: 'poor' | 'good' | 'excellent';
        recommendation: string;
    };

    // Deriv market specific signals
    derivSignals?: {
        riseFall: {
            action: 'RISE' | 'FALL' | 'WAIT';
            confidence: number;
            reasoning: string;
        };
        higherLower: {
            action: 'HIGHER' | 'LOWER' | 'WAIT';
            confidence: number;
            reasoning: string;
        };
    };
}

export interface MarketScanResult {
    symbol: string;
    displayName: string;
    trend: TrendAnalysis;
    rank: number;
    isRecommended: boolean;
}

export class TrendAnalysisEngine {
    private hmaCalculator: EfficientHMACalculator;
    private trendData: Map<string, TrendAnalysis> = new Map();
    private updateTimer: NodeJS.Timeout;
    private signalCache: Map<string, {
        signal: 'BULLISH' | 'BEARISH' | null;
        timestamp: number;
        confirmationCount: number;
        strength: number; // Store confidence of the cached signal
        lastUpdate: number;
    }> = new Map();
    private readonly SIGNAL_PERSISTENCE_MS = 15 * 60 * 1000; // 15 minutes (increased from 10)
    private readonly MIN_CONFIRMATION_COUNT = 5; // Require 5 confirmations before changing signal
    private readonly SIGNAL_STRENGTH_THRESHOLD = 60; // Minimum confidence to cache a new signal

    constructor(hmaCalculator: EfficientHMACalculator) {
        this.hmaCalculator = hmaCalculator;

        // Update trend analysis periodically
        this.updateTimer = setInterval(() => this.updateAllTrends(), 30 * 1000); // Every 30 seconds
    }

    /**
     * Add candle data and update trend analysis
     */
    addCandleData(candle: CandleData): void {
        const { symbol, close, timestamp } = candle;

        // Use multiple HMA periods that divide evenly into 210 candles
        // 210 = 2×3×5×7, so we use periods: 5, 6, 7, 10, 14, 15, 21, 30, 35, 42, 70, 105
        const hmaPeriods = [5, 6, 7, 10, 14, 15, 21, 30, 35, 42, 70, 105];
        this.hmaCalculator.addCandleData(candle, hmaPeriods);

        // Process through Ehlers signal processing pipeline
        const ehlersSignals = ehlersProcessor.processPrice(symbol, close, timestamp);

        // Update trend analysis when all HMA periods are ready
        const allPeriodsReady = hmaPeriods.every(period =>
            this.hmaCalculator.isReady(symbol, period)
        );

        if (allPeriodsReady) {
            this.updateTrendAnalysis(symbol, close, ehlersSignals);
        }
    }

    /**
     * Update trend analysis for a specific symbol with enhanced pullback detection
     */
    private updateTrendAnalysis(symbol: string, currentPrice: number, ehlersSignals?: EhlersSignals): void {
        // Calculate ROC indicators for trend analysis
        const { candleReconstructionEngine } = require('./candle-reconstruction-engine');
        const recentCandles = candleReconstructionEngine.getCandles(symbol, 30);

        if (!recentCandles || recentCandles.length < 10) {
            console.log(`${symbol}: Insufficient candle data for analysis (need 10, have ${recentCandles?.length || 0})`);
            return;
        }

        const prices = recentCandles.map((candle: any) => candle.close);
        const highs = recentCandles.map((candle: any) => candle.high);
        const lows = recentCandles.map((candle: any) => candle.low);

        // Enhanced pullback detection using at least 5 candles
        const pullbackAnalysis = this.analyzePullbackWithDecycler(recentCandles, ehlersSignals);

        // Use default ROC periods (can be made configurable later)
        const rocPeriods = this.getROCPeriods(false); // Default to non-sensitive
        const longTermROC = this.calculateROC(prices, rocPeriods.longTerm);
        const shortTermROC = this.calculateROC(prices, rocPeriods.shortTerm);

        if (longTermROC === null || shortTermROC === null) {
            console.log(`${symbol}: Failed to calculate ROC indicators`);
            return;
        }

        // Determine ROC alignment and trend direction
        const rocAlignment = this.determineROCAlignment(longTermROC, shortTermROC);
        const direction = this.determineTrendDirectionByROC(rocAlignment);

        // Calculate trend strength based on ROC magnitude
        const strength = this.calculateTrendStrengthByROC(longTermROC, shortTermROC);

        // Calculate confidence based on ROC alignment and strength
        const confidence = this.calculateConfidenceByROC(longTermROC, shortTermROC, rocAlignment);

        // Get ROC-based signal validation with persistence
        const rawROCSignal = this.validateROCAlignment(symbol, longTermROC, shortTermROC);
        const persistentROCSignal = this.getPersistedSignal(symbol, rawROCSignal, confidence);

        // Override direction based on persistent ROC signal validation
        let finalDirection = direction;
        if (persistentROCSignal === 'BULLISH') {
            finalDirection = 'bullish';
        } else if (persistentROCSignal === 'BEARISH') {
            finalDirection = 'bearish';
        } else {
            finalDirection = 'neutral'; // No valid signal
        }

        // Generate recommendation based on persistent ROC signal validation
        const recommendation = this.generateRecommendationByROC(finalDirection, strength, confidence, persistentROCSignal);

        // Calculate overall score based on ROC alignment and validation
        let score = this.calculateTradingScoreByROC(finalDirection, strength, confidence, rocAlignment);

        // Boost score significantly for valid ROC signals - INCREASED WEIGHT
        if (persistentROCSignal === 'BULLISH' || persistentROCSignal === 'BEARISH') {
            score = Math.min(98, score + 45); // Increased from 30 to 45 points for valid ROC signal
        }

        // Additional ROC alignment bonus - NEW ENHANCEMENT
        if (rocAlignment !== 'NEUTRAL') {
            score = Math.min(98, score + 15); // Extra 15 points for any ROC alignment
        }

        // Get Ehlers-based recommendations with Deriv market optimization
        const ehlersRecommendation = ehlersProcessor.generateEhlersRecommendation(symbol);
        const cycleTrading = ehlersProcessor.isGoodForCycleTrading(symbol);

        // Generate Deriv-specific market signals
        const riseFallConfig: DerivMarketConfig = {
            market: 'rise_fall',
            duration: 5, // 5 ticks
            contractType: 'RISE',
            minConfidence: 70,
            maxDrawdown: 20
        };

        const higherLowerConfig: DerivMarketConfig = {
            market: 'higher_lower',
            duration: 60, // 60 seconds
            contractType: 'HIGHER',
            minConfidence: 65,
            maxDrawdown: 15
        };

        const riseFallSignal = ehlersProcessor.generateDerivSignal(symbol, riseFallConfig);
        const higherLowerSignal = ehlersProcessor.generateDerivSignal(symbol, higherLowerConfig);

        const derivSignals = {
            riseFall: {
                action: riseFallSignal.action as 'RISE' | 'FALL' | 'WAIT',
                confidence: riseFallSignal.confidence,
                reasoning: riseFallSignal.reasoning
            },
            higherLower: {
                action: higherLowerSignal.action as 'HIGHER' | 'LOWER' | 'WAIT',
                confidence: higherLowerSignal.confidence,
                reasoning: higherLowerSignal.reasoning
            }
        };

        // Enhanced ROC analysis with mismatch detection
        const rocMismatch = this.detectROCMismatch(longTermROC, shortTermROC, recommendation);

        // Adjust recommendation based on ROC mismatch analysis
        let finalRecommendation = recommendation;
        let enhancedScore = score;

        if (rocMismatch.hasMismatch) {
            console.log(`⚠️ ${symbol}: ROC Mismatch detected (${rocMismatch.severity}) - ${rocMismatch.recommendation}`);
            
            // Reduce confidence for mismatched signals
            if (rocMismatch.severity === 'high') {
                enhancedScore = Math.max(30, score * 0.4); // Significant reduction
                finalRecommendation = 'HOLD'; // Override to HOLD for high severity mismatches
            } else if (rocMismatch.severity === 'medium') {
                enhancedScore = Math.max(40, score * 0.7); // Moderate reduction
            }
        } else if (rocAlignment !== 'NEUTRAL') {
            // Boost confidence for aligned ROC signals
            enhancedScore = Math.min(95, score * 1.15);
        }

        console.log(`📊 ${symbol}: ROC Analysis - Long: ${longTermROC.toFixed(6)}, Short: ${shortTermROC.toFixed(6)}, Alignment: ${rocAlignment}, Mismatch: ${rocMismatch.hasMismatch}`);

        const finalScore = enhancedScorere;

        // Priority 1: ROC signals with increased sensitivity
        if (persistentROCSignal && confidence >= 60) { // Lowered from 75 to 60 for higher sensitivity
            finalRecommendation = persistentROCSignal === 'BULLISH' ? 'BUY' : 'SELL';
            enhancedScore = Math.min(98, confidence + 30); // Increased bonus for ROC signals
            console.log(`🎯 HIGH-SENSITIVITY ROC: ${persistentROCSignal} signal (${enhancedScore.toFixed(1)}%)`);
        }
        // Priority 2: Strong Ehlers trending signals (removed anticipatory focus)
        else if (ehlersSignals && ehlersRecommendation.signalStrength === 'strong' && !ehlersRecommendation.anticipatory) {
            finalRecommendation = ehlersRecommendation.action;
            enhancedScore = Math.min(95, score + 20);
            console.log(`⚡ EHLERS TRENDING: Strong signal (${enhancedScore.toFixed(1)}%)`);
        }
        // Priority 3: Medium Ehlers trending signals
        else if (ehlersSignals && ehlersRecommendation.signalStrength === 'medium' && !ehlersRecommendation.anticipatory) {
            finalRecommendation = ehlersRecommendation.action;
            enhancedScore = Math.min(90, score + 15);
        }
        // Priority 4: Basic momentum from pullback analysis
        else if (pullbackAnalysis.isPullback && pullbackAnalysis.confidence >= 60) {
            finalRecommendation = pullbackAnalysis.recommendation;
            enhancedScore = Math.min(85, pullbackAnalysis.confidence);
        }

        const analysis: TrendAnalysis = {
            symbol,
            direction: finalDirection,
            strength,
            confidence,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation: finalRecommendation,
            score: enhancedScore,
            longTermROC,
            shortTermROC,
            rocAlignment,
            ehlers: ehlersSignals,
            ehlersRecommendation,
            cycleTrading,
            derivSignals,
            pullbackAnalysis, // Add pullback analysis results
        };

        this.trendData.set(symbol, analysis);

        console.log(`ROC-Based Trend Analysis for ${symbol}: ${finalDirection.toUpperCase()} (${strength}) - ROC Signal: ${persistentROCSignal || 'NONE'} (Raw: ${rawROCSignal || 'NONE'}) - LT ROC: ${longTermROC.toFixed(3)}% ST ROC: ${shortTermROC.toFixed(3)}% - Score: ${score.toFixed(1)} - Recommendation: ${recommendation}`);
    }

    /**
     * Analyze HMA alignment across all periods
     */
    private analyzeHMAAlignment(hmaData: Array<{period: number; value: number; slope: number | null; color: 'green' | 'red' | 'neutral'}>): {
        alignedCount: number;
        totalCount: number;
        alignmentPercentage: number;
        dominantColor: 'green' | 'red' | 'neutral';
        isAligned: boolean;
        shortTermAlignment: number; // 0-100
        longTermAlignment: number; // 0-100
    } {
        const totalCount = hmaData.length;
        const colorCounts = {
            green: hmaData.filter(h => h.color === 'green').length,
            red: hmaData.filter(h => h.color === 'red').length,
            neutral: hmaData.filter(h => h.color === 'neutral').length
        };

        const dominantColor = colorCounts.green > colorCounts.red && colorCounts.green > colorCounts.neutral ? 'green' :
                             colorCounts.red > colorCounts.green && colorCounts.red > colorCounts.neutral ? 'red' : 'neutral';

        const alignedCount = colorCounts[dominantColor];
        const alignmentPercentage = (alignedCount / totalCount) * 100;

        // Short-term alignment (periods <= 21)
        const shortTermHMAs = hmaData.filter(h => h.period <= 21);
        const shortTermAligned = shortTermHMAs.filter(h => h.color === dominantColor).length;
        const shortTermAlignment = (shortTermHMAs.length > 0 ? (shortTermAligned / shortTermHMAs.length) * 100 : 0);

        // Long-term alignment (periods > 21)
        const longTermHMAs = hmaData.filter(h => h.period > 21);
        const longTermAligned = longTermHMAs.filter(h => h.color === dominantColor).length;
        const longTermAlignment = longTermHMAs.length > 0 ? (longTermAligned / longTermHMAs.length) * 100 : 0;

        return {
            alignedCount,
            totalCount,
            alignmentPercentage,
            dominantColor,
            isAligned: alignmentPercentage >= 75 && dominantColor !== 'neutral', // Require 75% alignment
            shortTermAlignment,
            longTermAlignment
        };
    }

    /**
     * Determine trend direction based on HMA alignment
     */
    private determineTrendDirectionByAlignment(alignment: any): TrendDirection {
        if (alignment.isAligned) {
            return alignment.dominantColor === 'green' ? 'bullish' : 'bearish';
        }
        return 'neutral';
    }

    /**
     * Calculate trend strength based on alignment score
     */
    private calculateTrendStrengthByAlignment(alignment: any): TrendStrength {
        if (alignment.alignmentPercentage >= 90) {
            return 'strong';
        } else if (alignment.alignmentPercentage >= 75) {
            return 'moderate';
        }
        return 'weak';
    }

    /**
     * Calculate confidence based on alignment consistency
     */
    private calculateConfidenceByAlignment(alignment: any): number {
        let confidence = alignment.alignmentPercentage; // Base confidence from alignment percentage

        // Bonus for strong short-term and long-term alignment
        if (alignment.shortTermAlignment >= 80 && alignment.longTermAlignment >= 80) {
            confidence += 15;
        } else if (alignment.shortTermAlignment >= 70 && alignment.longTermAlignment >= 70) {
            confidence += 10;
        }

        // Penalty for neutral dominant color
        if (alignment.dominantColor === 'neutral') {
            confidence -= 20;
        }

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Generate recommendation based on SMA conditions and candle patterns
     */
    private generateRecommendationByAlignment(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        alignment: any,
        symbol?: string
    ): 'BUY' | 'SELL' | 'HOLD' {
        if (!symbol) {
            return 'HOLD';
        }

        // Get specific signal validation using dual ROC and candle patterns
        const signalValidation = this.validateDualROCSignal(symbol);

        if (!signalValidation) {
            return 'HOLD';
        }

        // Apply the validated signal
        if (signalValidation === 'BULLISH') {
            return 'BUY';
        } else if (signalValidation === 'BEARISH') {
            return 'SELL';
        }

        return 'HOLD';
    }

    /**
     * Calculate trading score based on alignment
     */
    private calculateTradingScoreByAlignment(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        alignment: any
    ): number {
        let score = 0;

        // Base score from alignment percentage
        score += alignment.alignmentPercentage * 0.6;

        // Alignment quality bonus
        if (alignment.isAligned) {
            score += 20;
        }

        // Short-term and long-term alignment bonus
        score += (alignment.shortTermAlignment * 0.15);
        score += (alignment.longTermAlignment * 0.15);

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
     * Calculate long-term trend strength using multiple HMAs
     */
    private calculateLongTermTrendStrengthMultiHMA(
        hmaData: Array<{period: number; value: number; slope: number | null; color: string}>,
        currentPrice: number,
        symbol: string
    ): number {
        const longTermHMAs = hmaData.filter(h => h.period >= 35); // Use longer periods
        if (longTermHMAs.length === 0) return 0;

        // Calculate consistency in long-term HMAs
        const colorCounts = {
            green: longTermHMAs.filter(h => h.color === 'green').length,
            red: longTermHMAs.filter(h => h.color === 'red').length,
            neutral: longTermHMAs.filter(h => h.color === 'neutral').length
        };

        const maxCount = Math.max(colorCounts.green, colorCounts.red, colorCounts.neutral);
        const consistency = (maxCount / longTermHMAs.length) * 100;

        // Calculate average slope magnitude
        const validSlopes = longTermHMAs.filter(h => h.slope !== null).map(h => h.slope!);
        const avgSlopeMagnitude = validSlopes.length > 0 ?
            validSlopes.reduce((sum, slope) => sum + Math.abs(slope), 0) / validSlopes.length : 0;

        return Math.min(100, consistency * 0.7 + (avgSlopeMagnitude * 1000 * 30));
    }

    /**
     * Get HMA color based on slope
     */
    private getHMAColor(slope: number | null): 'green' | 'red' | 'neutral' {
        if (!slope) return 'neutral';

        const slopeThreshold = 0.0001; // Threshold for color determination

        if (slope > slopeThreshold) return 'green';
        if (slope < -slopeThreshold) return 'red';
        return 'neutral';
    }

    /**
     * Calculate Rate of Change (ROC) indicator
     */
    private calculateROC(prices: number[], period: number = 14): number | null {
        if (prices.length < period + 1) return null;

        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - 1 - period];

        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }

    /**
     * Get ROC periods based on sensitivity setting (increased sensitivity)
     */
    private getROCPeriods(sensitive: boolean = true): { longTerm: number; shortTerm: number } {
        if (sensitive) {
            return {
                longTerm: 8,  // Increased sensitivity: reduced from 10
                shortTerm: 2  // Increased sensitivity: reduced from 3
            };
        }
        return {
            longTerm: 15, // Increased sensitivity: reduced from 20
            shortTerm: 4   // Increased sensitivity: reduced from 5
        };
    }

    /**
     * Determine ROC alignment status (increased sensitivity)
     */
    private determineROCAlignment(longTermROC: number, shortTermROC: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        const longTermThreshold = 0.02; // Increased sensitivity: reduced from 0.05% to 0.02%
        const shortTermThreshold = 0.05; // Increased sensitivity: reduced from 0.1% to 0.05%

        // Both ROC positive and short-term accelerating upward
        if (longTermROC > longTermThreshold && shortTermROC > shortTermThreshold && shortTermROC > longTermROC) {
            return 'BULLISH';
        }

        // Both ROC negative and short-term accelerating downward
        if (longTermROC < -longTermThreshold && shortTermROC < -shortTermThreshold && shortTermROC < longTermROC) {
            return 'BEARISH';
        }

        return 'NEUTRAL';
    }

    /**
     * Determine trend direction based on ROC alignment
     */
    private determineTrendDirectionByROC(rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): TrendDirection {
        if (rocAlignment === 'BULLISH') return 'bullish';
        if (rocAlignment === 'BEARISH') return 'bearish';
        return 'neutral';
    }

    /**
     * Calculate trend strength based on ROC magnitude
     */
    private calculateTrendStrengthByROC(longTermROC: number, shortTermROC: number): TrendStrength {
        const rocMagnitude = Math.abs(longTermROC) + Math.abs(shortTermROC);
        const acceleration = Math.abs(shortTermROC - longTermROC);

        if (rocMagnitude > 0.5 && acceleration > 0.2) {
            return 'strong';
        } else if (rocMagnitude > 0.2 || acceleration > 0.1) {
            return 'moderate';
        }

        return 'weak';
    }

    /**
     * Calculate confidence based on ROC alignment and strength with mismatch detection
     */
    private calculateConfidenceByROC(longTermROC: number, shortTermROC: number, rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): number {
        let confidence = 40; // Base confidence

        // Enhanced ROC alignment with stricter thresholds
        const rocStrength = Math.abs(longTermROC) + Math.abs(shortTermROC);
        const rocConsistency = longTermROC * shortTermROC; // Positive if same direction

        // Only award alignment bonus if ROC signals are consistent and strong enough
        if (rocAlignment !== 'NEUTRAL' && rocConsistency > 0 && rocStrength > 0.0002) {
            confidence += 35; // Reduced from 40 to prevent over-confidence on weak signals
        } else if (rocAlignment !== 'NEUTRAL' && rocConsistency <= 0) {
            // Penalty for conflicting ROC signals
            confidence -= 15;
        }

        // ROC magnitude bonus with more conservative scaling
        confidence += Math.min(20, rocStrength * 8000); // Reduced multiplier for more realistic scaling

        // Consistency bonus (both ROCs in same direction)
        if (rocConsistency > 0) {
            confidence += Math.min(10, Math.abs(rocConsistency) * 15000);
        }

        // Acceleration bonus with stricter requirements
        const acceleration = Math.abs(shortTermROC - longTermROC);
        if (acceleration > 0.0001) { // Only if acceleration is meaningful
            confidence += Math.min(10, acceleration * 20000);
        }

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Enhanced ROC alignment validation with mismatch detection
     */
    private validateROCAlignment(symbol: string, longTermROC: number, shortTermROC: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        // Enhanced thresholds for more accurate ROC detection
        const strongThreshold = 0.0003; // Increased threshold for strong signals
        const mediumThreshold = 0.0001; // Medium threshold
        const consistencyThreshold = 0.00005; // Minimum threshold for consistency

        // Check ROC strength and consistency
        const longTermStrong = Math.abs(longTermROC) > strongThreshold;
        const shortTermStrong = Math.abs(shortTermROC) > strongThreshold;
        const bothMedium = Math.abs(longTermROC) > mediumThreshold && Math.abs(shortTermROC) > mediumThreshold;
        const sameDirection = longTermROC * shortTermROC > 0;
        const significantMagnitude = Math.abs(longTermROC) + Math.abs(shortTermROC) > consistencyThreshold;

        // Only declare alignment if signals are consistent and significant
        if (sameDirection && significantMagnitude) {
            if ((longTermStrong && shortTermStrong) || bothMedium) {
                if (longTermROC > 0 && shortTermROC > 0) {
                    return 'BULLISH';
                } else if (longTermROC < 0 && shortTermROC < 0) {
                    return 'BEARISH';
                }
            }
        }

        // Return NEUTRAL for weak, conflicting, or insignificant signals
        return 'NEUTRAL';
    }

    /**
     * Detect and handle ROC alignment mismatches
     */
    private detectROCMismatch(longTermROC: number, shortTermROC: number, overallTrend: string): {
        hasMismatch: boolean;
        severity: 'low' | 'medium' | 'high';
        recommendation: string;
    } {
        const rocAlignment = this.validateROCAlignment('', longTermROC, shortTermROC);
        
        // Check for mismatch between ROC signals and overall trend
        const trendRocMismatch = 
            (rocAlignment === 'BULLISH' && overallTrend === 'BEARISH') ||
            (rocAlignment === 'BEARISH' && overallTrend === 'BULLISH');

        // Check for internal ROC conflicts
        const rocInternalConflict = longTermROC * shortTermROC < 0; // Opposite directions

        let severity: 'low' | 'medium' | 'high' = 'low';
        let recommendation = 'Monitor for clearer signals';

        if (trendRocMismatch || rocInternalConflict) {
            const conflictMagnitude = Math.abs(longTermROC) + Math.abs(shortTermROC);
            
            if (conflictMagnitude > 0.0005) {
                severity = 'high';
                recommendation = 'Wait for trend confirmation - conflicting signals detected';
            } else if (conflictMagnitude > 0.0002) {
                severity = 'medium';
                recommendation = 'Exercise caution - mixed momentum signals';
            } else {
                severity = 'low';
                recommendation = 'Weak signals - consider waiting for stronger momentum';
            }

            return {
                hasMismatch: true,
                severity,
                recommendation
            };
        }

        return {
            hasMismatch: false,
            severity: 'low',
            recommendation: 'ROC alignment consistent with trend analysis'
        };
    }

    /**
     * Validate dual ROC signal with candle pattern confirmation (increased sensitivity)
     */
    private validateDualROCSignal(symbol: string): 'BULLISH' | 'BEARISH' | null {
        // Import candle reconstruction engine
        const { candleReconstructionEngine } = require('./candle-reconstruction-engine');
        const recentCandles = candleReconstructionEngine.getCandles(symbol, 3);

        if (recentCandles.length < 2) {
            console.log(`${symbol}: Insufficient candle data for pattern validation`);
            return null;
        }

        const lastCandle = recentCandles[recentCandles.length - 1];
        const previousCandle = recentCandles[recentCandles.length - 2];

        // Determine candle colors
        const isLastCandleGreen = lastCandle.close > lastCandle.open;
        const isLastCandleRed = lastCandle.close < lastCandle.open;

        // BULLISH SIGNAL CONDITIONS (increased sensitivity):
        // 1. Long-term ROC positive (upward trend)
        // 2. Short-term ROC stronger positive (acceleration)
        // 3. Last candle is green and closes above previous high
        if (longTermROC > 0.02 && // Increased sensitivity: reduced from 0.05% to 0.02%
            shortTermROC > 0.05 && // Increased sensitivity: reduced from 0.1% to 0.05%
            shortTermROC > longTermROC && // Short-term stronger than long-term (acceleration)
            isLastCandleGreen &&
            lastCandle.close > previousCandle.high) {

            console.log(`${symbol}: ✅ ROC BULLISH signal confirmed (HIGH SENSITIVITY):
                - Long-term ROC (8): ${longTermROC.toFixed(3)}% (positive trend)
                - Short-term ROC (2): ${shortTermROC.toFixed(3)}% (accelerating upward)
                - ROC alignment: SHORT > LONG (${shortTermROC.toFixed(3)}% > ${longTermROC.toFixed(3)}%)
                - Last candle GREEN: ${lastCandle.open.toFixed(5)} → ${lastCandle.close.toFixed(5)}
                - Closes above prev high: ${lastCandle.close.toFixed(5)} > ${previousCandle.high.toFixed(5)}`);
            return 'BULLISH';
        }

        // BEARISH SIGNAL CONDITIONS (increased sensitivity):
        // 1. Long-term ROC negative (downward trend)
        // 2. Short-term ROC stronger negative (acceleration)
        // 3. Last candle is red and closes below previous low
        if (longTermROC < -0.02 && // Increased sensitivity: reduced from -0.05% to -0.02%
            shortTermROC < -0.05 && // Increased sensitivity: reduced from -0.1% to -0.05%
            shortTermROC < longTermROC && // Short-term more negative than long-term (acceleration)
            isLastCandleRed &&
            lastCandle.close < previousCandle.low) {

            console.log(`${symbol}: ✅ ROC BEARISH signal confirmed (HIGH SENSITIVITY):
                - Long-term ROC (8): ${longTermROC.toFixed(3)}% (negative trend)
                - Short-term ROC (2): ${shortTermROC.toFixed(3)}% (accelerating downward)
                - ROC alignment: SHORT < LONG (${shortTermROC.toFixed(3)}% < ${longTermROC.toFixed(3)}%)
                - Last candle RED: ${lastCandle.open.toFixed(5)} → ${lastCandle.close.toFixed(5)}
                - Closes below prev low: ${lastCandle.close.toFixed(5)} < ${previousCandle.low.toFixed(5)}`);
            return 'BEARISH';
        }

        // Log why signal was not generated
        console.log(`${symbol}: ❌ ROC signal not generated:
            - Long-term ROC (20): ${longTermROC.toFixed(3)}%
            - Short-term ROC (5): ${shortTermROC.toFixed(3)}%
            - ROC alignment: ${shortTermROC > longTermROC ? 'SHORT > LONG' : shortTermROC < longTermROC ? 'SHORT < LONG' : 'EQUAL'}
            - Candle color: ${isLastCandleGreen ? 'GREEN' : isLastCandleRed ? 'RED' : 'NEUTRAL'}
            - Price action: ${lastCandle.close > previousCandle.high ? 'Above prev high' : lastCandle.close < previousCandle.low ? 'Below prev low' : 'Inside range'}`);

        return null;
    }

    /**
     * Generate recommendation based on ROC alignment
     */
    private generateRecommendationByROC(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        rocSignal: 'BULLISH' | 'BEARISH' | null
    ): 'BUY' | 'SELL' | 'HOLD' {
        // Only generate signals when ROC alignment is confirmed
        if (!rocSignal) {
            return 'HOLD';
        }

        // Apply the validated ROC signal - INCREASED SENSITIVITY
        if (rocSignal === 'BULLISH' && confidence > 45) { // Increased sensitivity: lowered from 55 to 45
            return 'BUY';
        } else if (rocSignal === 'BEARISH' && confidence > 45) { // Increased sensitivity: lowered from 55 to 45
            return 'SELL';
        }

        return 'HOLD';
    }

    /**
     * Analyze basic trend momentum (removed mean reversion logic)
     */
    private analyzePullbackWithDecycler(candles: any[], ehlersSignals?: EhlersSignals): PullbackAnalysis {
        if (candles.length < 5) {
            return {
                isPullback: false,
                pullbackStrength: 'weak',
                longerTermTrend: 'neutral',
                pullbackType: 'none',
                confidence: 0,
                entrySignal: false,
                recommendation: 'HOLD',
            };
        }

        // Basic trend momentum analysis without mean reversion
        const last5Candles = candles.slice(-5);
        const recentCloses = last5Candles.map(c => c.close);
        const currentPrice = recentCloses[recentCloses.length - 1];
        const firstPrice = recentCloses[0];

        // Simple momentum calculation
        const momentum = (currentPrice - firstPrice) / firstPrice;

        let pullbackType: 'none' | 'bullish_pullback' | 'bearish_pullback' = 'none';
        let confidence = 0;

        // Basic trend following (removed mean reversion)
        if (momentum > 0.001) {
            pullbackType = 'bullish_pullback';
            confidence = Math.min(80, momentum * 10000);
        } else if (momentum < -0.001) {
            pullbackType = 'bearish_pullback';
            confidence = Math.min(80, Math.abs(momentum) * 10000);
        }

        const recommendation: 'BUY' | 'SELL' | 'HOLD' =
            pullbackType === 'bullish_pullback' && confidence >= 60 ? 'BUY' :
            pullbackType === 'bearish_pullback' && confidence >= 60 ? 'SELL' : 'HOLD';

        return {
            isPullback: pullbackType !== 'none',
            pullbackStrength: confidence > 70 ? 'strong' : confidence > 50 ? 'medium' : 'weak',
            longerTermTrend: momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral',
            pullbackType,
            confidence,
            entrySignal: confidence >= 60,
            recommendation
        };
    }

    /**
     * Calculate trading score based on ROC analysis
     */
    private calculateTradingScoreByROC(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    ): number {
        let score = 0;

        // Base score from confidence
        score += confidence * 0.6;

        // ROC alignment bonus - INCREASED WEIGHT
        if (rocAlignment !== 'NEUTRAL') {
            score += 40; // Increased from 25 to 40 points for ROC alignment
        }

        // Direction scoring
        if (direction === 'bullish' || direction === 'bearish') {
            score += 20;
        }

        // Strength scoring
        switch (strength) {
            case 'strong':
                score += 25;
                break;
            case 'moderate':
                score += 15;
                break;
            case 'weak':
                score += 5;
                break;
        }

        return Math.min(100, Math.max(0, score));
    }



    /**
     * Legacy method - kept for compatibility but now calls ROC-based validation
     */
    private validateCandleColor(symbol: string, direction: TrendDirection): boolean {
        // Import candle reconstruction engine
        const { candleReconstructionEngine } = require('./candle-reconstruction-engine');
        const recentCandles = candleReconstructionEngine.getCandles(symbol, 30);

        if (!recentCandles || recentCandles.length < 25) {
            return false;
        }

        const prices = recentCandles.map((candle: any) => candle.close);
        const longTermROC = this.calculateROC(prices, 20);
        const shortTermROC = this.calculateROC(prices, 5);

        if (longTermROC === null || shortTermROC === null) {
            return false;
        }

        const rocSignal = this.validateROCAlignment(symbol, longTermROC, shortTermROC);

        if (direction === 'bullish' && rocSignal === 'BULLISH') {
            return true;
        } else if (direction === 'bearish' && rocSignal === 'BEARISH') {
            return true;
        }

        return false;
    }

    /**
     * Determine trend direction based on HMA color alignment
     */
    private determineTrendDirectionByColor(hma5Color: string, hma200Color: string): TrendDirection {
        // Both hulls same color = strong signal
        if (hma5Color === 'green' && hma200Color === 'green') {
            return 'bullish';
        }

        if (hma5Color === 'red' && hma200Color === 'red') {
            return 'bearish';
        }

        // Mixed colors or neutral = no clear trend
        return 'neutral';
    }

    /**
     * Calculate trend strength based on color alignment and slope magnitude
     */
    private calculateTrendStrengthByColor(
        hma5Slope: number | null,
        hma200Slope: number | null,
        hma5Color: string,
        hma200Color: string
    ): TrendStrength {
        // Strong when both colors align and slopes are significant
        const colorsAlign = hma5Color === hma200Color && hma5Color !== 'neutral';
        const slopeMagnitude = Math.abs(hma5Slope || 0) + Math.abs(hma200Slope || 0);

        if (colorsAlign && slopeMagnitude > 0.01) {
            return 'strong';
        } else if (colorsAlign || slopeMagnitude > 0.005) {
            return 'moderate';
        }

        return 'weak';
    }

    /**
     * Calculate confidence based on color alignment and slope strength
     */
    private calculateConfidenceByColor(
        hma5Slope: number | null,
        hma200Slope: number | null,
        hma5Color: string,
        hma200Color: string
    ): number {
        let confidence = 30; // Lower base confidence

        // Color alignment bonus
        if (hma5Color === hma200Color && hma5Color !== 'neutral') {
            confidence += 40; // Major bonus for color alignment
        }

        // Slope strength bonus
        const slopeMagnitude = Math.abs(hma5Slope || 0) + Math.abs(hma200Slope || 0);
        confidence += Math.min(20, slopeMagnitude * 1000);

        // Consistency bonus - same direction slopes
        if (hma5Slope && hma200Slope) {
            const sameDirection = (hma5Slope > 0 && hma200Slope > 0) || (hma5Slope < 0 && hma200Slope < 0);
            if (sameDirection) {
                confidence += 10;
            }
        }

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Generate recommendation based on color alignment
     */
    private generateRecommendationByColor(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        hma5Color: string,
        hma200Color: string
    ): 'BUY' | 'SELL' | 'HOLD' {
        // Strong color alignment with high confidence
        if (hma5Color === hma200Color && confidence > 70) {
            if (hma5Color === 'green') {
                return 'BUY';
            } else if (hma5Color === 'red') {
                return 'SELL';
            }
        }

        // Moderate color alignment with decent confidence
        if (hma5Color === hma200Color && confidence > 60 && strength !== 'weak') {
            if (hma5Color === 'green') {
                return 'BUY';
            } else if (hma5Color === 'red') {
                return 'SELL';
            }
        }

        return 'HOLD';
    }

    /**
     * Calculate trading score based on color alignment
     */
    private calculateTradingScoreByColor(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        hma5Color: string,
        hma200Color: string
    ): number {
        let score = 0;

        // Base score from confidence
        score += confidence * 0.4;

        // Color alignment bonus
        if (hma5Color === hma200Color && hma5Color !== 'neutral') {
            score += 30; // Major bonus for color alignment
        }

        // Direction scoring
        if (direction === 'bullish' || direction === 'bearish') {
            score += 20;
        } else {
            score += 5; // Neutral gets lower score
        }

        // Strength scoring
        switch (strength) {
            case 'strong':
                score += 25;
                break;
            case 'moderate':
                score += 15;
                break;
            case 'weak':
                score += 5;
                break;
        }

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Determine long-term trend from HMA200 with enhanced filtering
     */
    private determineLongTermTrend(hma200: number, currentPrice: number, hma200Slope: number | null): TrendDirection {
        const priceVsHma200 = currentPrice > hma200;
        const slopeThreshold = 0.0002; // Increased threshold for stronger trend confirmation
        const slopeDirection = hma200Slope && hma200Slope > slopeThreshold ? 'up' :
                              hma200Slope && hma200Slope < -slopeThreshold ? 'down' : 'flat';

        // Require both price position AND slope confirmation for stronger filtering
        if (priceVsHma200 && slopeDirection === 'up') return 'bullish';
        if (!priceVsHma200 && slopeDirection === 'down') return 'bearish';
        return 'neutral';
    }

    /**
     * Enhanced long-term trend strength analysis
     */
    private calculateLongTermTrendStrength(
        hma200: number,
        hma200Slope: number | null,
        currentPrice: number,
        symbol: string
    ): number {
        if (!hma200Slope) return 0;

        // Get HMA200 history for trend consistency check
        const hma200History = this.hmaCalculator.getHMAValues(symbol, 200, 10);
        if (hma200History.length < 5) return 0;

        // Calculate trend consistency over last 10 periods
        let consistentPeriods = 0;
        const currentDirection = hma200Slope > 0 ? 1 : -1;

        for (let i = 1; i < hma200History.length; i++) {
            const periodSlope = hma200History[i].value - hma200History[i - 1].value;
            const periodDirection = periodSlope > 0 ? 1 : -1;
            if (periodDirection === currentDirection) {
                consistentPeriods++;
            }
        }

        const consistency = consistentPeriods / (hma200History.length - 1);
        const slopeStrength = Math.abs(hma200Slope) * 1000; // Normalize slope
        const priceDistance = Math.abs(currentPrice - hma200) / hma200;

        // Combine factors for overall trend strength (0-100)
        return Math.min(100, (consistency * 50) + (slopeStrength * 25) + (priceDistance * 100 * 25));
    }

    /**
     * Determine trend direction with long-term filter
     */
    private determineTrendDirectionWithFilter(
        hma5: number,
        hma40: number,
        hma5Slope: number | null,
        hma40Slope: number | null,
        longTermTrend: TrendDirection
    ): TrendDirection {
        // Get short-term signal
        const shortTermDirection = this.determineTrendDirection(hma5, hma40, hma5Slope, hma40Slope);

        // Filter against long-term trend
        if (longTermTrend === 'neutral') {
            return shortTermDirection; // No filtering when long-term is neutral
        }

        // Only allow signals that align with long-term trend
        if (shortTermDirection === longTermTrend) {
            return shortTermDirection;
        }

        // If signals conflict, use neutral to avoid whipsaws
        return 'neutral';
    }

    /**
     * Determine trend direction based on HMA values and slopes
     */
    private determineTrendDirection(hma5: number, hma40: number, hma5Slope: number | null, hma40Slope: number | null): TrendDirection {
        // Primary signal: HMA crossover
        if (hma5 > hma40) {
            // Fast HMA above slow HMA suggests bullish trend
            if (hma5Slope && hma5Slope > 0) {
                return 'bullish';
            } else if (hma5Slope && hma5Slope < -0.001) {
                return 'neutral'; // Weakening bullish trend
            }
            return 'bullish';
        } else if (hma5 < hma40) {
            // Fast HMA below slow HMA suggests bearish trend
            if (hma5Slope && hma5Slope < 0) {
                return 'bearish';
            } else if (hma5Slope && hma5Slope > 0.001) {
                return 'neutral'; // Weakening bearish trend
            }
            return 'bearish';
        }

        // Very close HMAs - use slope analysis
        if (hma5Slope && hma40Slope) {
            if (hma5Slope > 0 && hma40Slope > 0) {
                return 'bullish';
            } else if (hma5Slope < 0 && hma40Slope < 0) {
                return 'bearish';
            }
        }

        return 'neutral';
    }

    /**
     * Calculate trend strength
     */
    private calculateTrendStrength(hma5: number, hma40: number, hma5Slope: number | null, hma40Slope: number | null, price: number): TrendStrength {
        // Calculate HMA divergence as percentage
        const divergence = Math.abs(hma5 - hma40) / price * 100;

        // Slope strength analysis
        const slopeStrength = Math.abs(hma5Slope || 0) + Math.abs(hma40Slope || 0);

        // Combined strength analysis
        if (divergence > 0.05 && slopeStrength > 0.01) {
            return 'strong';
        } else if (divergence > 0.02 || slopeStrength > 0.005) {
            return 'moderate';
        }

        return 'weak';
    }

    /**
     * Calculate confidence level (0-100)
     */
    private calculateConfidence(hma5: number, hma40: number, hma5Slope: number | null, hma40Slope: number | null, crossover: number): number {
        let confidence = 50; // Base confidence

        // HMA alignment bonus
        const alignment = hma5 > hma40 ? 1 : -1;
        const slopeAlignment = (hma5Slope || 0) * alignment > 0 && (hma40Slope || 0) * alignment > 0;

        if (slopeAlignment) {
            confidence += 20;
        }

        // Recent crossover bonus
        if (Math.abs(crossover) === 1) {
            confidence += 15;
        }

        // Slope consistency bonus
        if (hma5Slope && hma40Slope) {
            const slopesInSameDirection = (hma5Slope > 0 && hma40Slope > 0) || (hma5Slope < 0 && hma40Slope < 0);
            if (slopesInSameDirection) {
                confidence += 10;
            }
        }

        // Strong divergence bonus
        const divergence = Math.abs(hma5 - hma40) / Math.max(hma5, hma40);
        if (divergence > 0.001) {
            confidence += Math.min(15, divergence * 1000 * 5);
        }

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Generate trading recommendation
     */
    private generateRecommendation(direction: TrendDirection, strength: TrendStrength, confidence: number, crossover: number): 'BUY' | 'SELL' | 'HOLD' {
        // Strong signals with high confidence
        if (confidence > 70 && strength !== 'weak') {
            if (direction === 'bullish' || crossover === 1) {
                return 'BUY';
            } else if (direction === 'bearish' || crossover === -1) {
                return 'SELL';
            }
        }

        // Recent crossover signals
        if (crossover === 1 && confidence > 60) {
            return 'BUY';
        } else if (crossover === -1 && confidence > 60) {
            return 'SELL';
        }

        // Strong trends with moderate confidence
        if (strength === 'strong' && confidence > 60) {
            if (direction === 'bullish') {
                return 'BUY';
            } else if (direction === 'bearish') {
                return 'SELL';
            }
        }

        return 'HOLD';
    }

    /**
     * Calculate trend strength with trend filter
     */
    private calculateTrendStrengthWithFilter(
        hma5: number, hma40: number, hma200: number,
        hma5Slope: number | null, hma40Slope: number | null, hma200Slope: number | null,
        price: number, longTermTrend: TrendDirection
    ): TrendStrength {
        const baseStrength = this.calculateTrendStrength(hma5, hma40, hma5Slope, hma40Slope, price);

        // Calculate HMA alignment (all moving in same direction)
        const allBullish = hma5 > hma40 && hma40 > hma200 &&
                          (hma5Slope || 0) > 0 && (hma40Slope || 0) > 0 && (hma200Slope || 0) > 0;
        const allBearish = hma5 < hma40 && hma40 < hma200 &&
                          (hma5Slope || 0) < 0 && (hma40Slope || 0) < 0 && (hma200Slope || 0) < 0;

        if (allBullish || allBearish) {
            return baseStrength === 'weak' ? 'moderate' :
                   baseStrength === 'moderate' ? 'strong' : 'strong';
        }

        return baseStrength;
    }

    /**
     * Calculate confidence with trend filter
     */
    private calculateConfidenceWithFilter(
        hma5: number, hma40: number, hma200: number,
        hma5Slope: number | null, hma40Slope: number | null, hma200Slope: number | null,
        crossover: number, longTermTrend: TrendDirection, direction: TrendDirection
    ): number {
        let confidence = this.calculateConfidence(hma5, hma40, hma5Slope, hma40Slope, crossover);

        // Trend alignment bonus
        if (direction === longTermTrend && longTermTrend !== 'neutral') {
            confidence += 15; // Bonus for trend alignment
        }

        // All HMAs aligned bonus
        const priceAboveAll = hma5 > hma40 && hma40 > hma200;
        const priceBelowAll = hma5 < hma40 && hma40 < hma200;

        if (priceAboveAll || priceBelowAll) {
            confidence += 10; // Strong alignment bonus
        }

        // Slope alignment bonus
        const slopesAligned = (hma5Slope || 0) * (hma40Slope || 0) > 0 &&
                             (hma40Slope || 0) * (hma200Slope || 0) > 0;

        if (slopesAligned) {
            confidence += 10;
        }

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Generate recommendation with enhanced trend filter
     */
    private generateRecommendationWithFilter(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        crossover: number,
        longTermTrend: TrendDirection,
        symbol: string,
        hma200: number,
        hma200Slope: number | null,
        currentPrice: number
    ): 'BUY' | 'SELL' | 'HOLD' {
        // Calculate long-term trend strength
        const longTermStrength = this.calculateLongTermTrendStrength(hma200, hma200Slope, currentPrice, symbol);

        // Require minimum long-term trend strength (configurable threshold)
        const minTrendStrength = 60; // Only trade when long-term trend strength > 60%

        if (longTermStrength < minTrendStrength) {
            return 'HOLD'; // Don't trade in weak or unclear long-term trends
        }

        // Only generate signals when aligned with strong long-term trend
        if (longTermTrend === 'neutral' || direction !== longTermTrend) {
            return 'HOLD'; // Avoid counter-trend trades and weak trends
        }

        // Require stronger short-term signals when filtering for long-term trends
        const enhancedConfidenceThreshold = 75; // Increased from default thresholds
        if (confidence < enhancedConfidenceThreshold) {
            return 'HOLD';
        }

        return this.generateRecommendation(direction, strength, confidence, crossover);
    }

    /**
     * Calculate overall trading score with trend filter (0-100)
     */
    private calculateTradingScoreWithFilter(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        crossover: number,
        longTermTrend: TrendDirection
    ): number {
        let score = this.calculateTradingScore(direction, strength, confidence, crossover);

        // Trend alignment bonus
        if (direction === longTermTrend && longTermTrend !== 'neutral') {
            score += 10; // Bonus for following long-term trend
        }

        // Penalty for counter-trend signals
        if (longTermTrend !== 'neutral' && direction !== 'neutral' && direction !== longTermTrend) {
            score -= 20; // Penalty for counter-trend
        }

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Calculate overall trading score (0-100)
     */
    private calculateTradingScore(direction: TrendDirection, strength: TrendStrength, confidence: number, crossover: number): number {
        let score = 0;

        // Base score from confidence
        score += confidence * 0.4;

        // Direction scoring
        if (direction === 'bullish' || direction === 'bearish') {
            score += 20;
        } else {
            score += 5; // Neutral gets lower score
        }

        // Strength scoring
        switch (strength) {
            case 'strong':
                score += 25;
                break;
            case 'moderate':
                score += 15;
                break;
            case 'weak':
                score += 5;
                break;
        }

        // Crossover bonus
        if (Math.abs(crossover) === 1) {
            score += 15;
        }

        return Math.min(100, Math.max(0, score));
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
     * Scan market and rank symbols by trading opportunities
     */
    scanMarket(symbolsInfo: Array<{ symbol: string; display_name: string }>): MarketScanResult[] {
        const results: MarketScanResult[] = [];

        symbolsInfo.forEach(symbolInfo => {
            const trend = this.getTrendAnalysis(symbolInfo.symbol);
            if (trend) {
                results.push({
                    symbol: symbolInfo.symbol,
                    displayName: symbolInfo.display_name,
                    trend,
                    rank: 0, // Will be set after sorting
                    isRecommended: trend.score > 75 && ['BUY', 'SELL'].includes(trend.recommendation),
                });
            }
        });

        // Sort by trading score (descending)
        results.sort((a, b) => b.trend.score - a.trend.score);

        // Set ranks
        results.forEach((result, index) => {
            result.rank = index + 1;
        });

        return results;
    }

    /**
     * Get top trading opportunities
     */
    getTopOpportunities(count: number = 5): MarketScanResult[] {
        const all = this.getAllTrendAnalyses();
        const opportunities = all
            .filter(trend => trend.score > 60 && ['BUY', 'SELL'].includes(trend.recommendation))
            .sort((a, b) => b.score - a.score)
            .slice(0, count)
            .map((trend, index) => ({
                symbol: trend.symbol,
                displayName: trend.symbol, // Would need symbol info mapping
                trend,
                rank: index + 1,
                isRecommended: trend.score > 75,
            }));

        return opportunities;
    }

    /**
     * Update all trend analyses
     */
    private updateAllTrends(): void {
        const symbols = this.hmaCalculator.getSymbolsWithData();
        const hmaPeriods = [5, 6, 7, 10, 14, 15, 21, 30, 35, 42, 70, 105];

        symbols.forEach(symbol => {
            // Check if all HMA periods are ready
            const allPeriodsReady = hmaPeriods.every(period =>
                this.hmaCalculator.isReady(symbol, period)
            );

            if (allPeriodsReady) {
                // Get a few HMA values to estimate current price
                const hma5 = this.hmaCalculator.getLatestHMA(symbol, 5);
                const hma21 = this.hmaCalculator.getLatestHMA(symbol, 21);
                const hma105 = this.hmaCalculator.getLatestHMA(symbol, 105);

                if (hma5 && hma21 && hma105) {
                    // Use the close price from price history service or estimate from HMAs
                    const estimatedPrice = (hma5.value + hma21.value + hma105.value) / 3;
                    this.updateTrendAnalysis(symbol, estimatedPrice);
                }
            }
        });
    }

    /**
     * Check if symbol has trend data
     */
    hasData(symbol: string): boolean {
        return this.trendData.has(symbol);
    }

    /**
     * Get symbols with trend data
     */
    getSymbolsWithData(): string[] {
        return Array.from(this.trendData.keys());
    }

    /**
     * Get statistics
     */
    getStats(): {
        symbolsAnalyzed: number;
        bullishSignals: number;
        bearishSignals: number;
        neutralSignals: number;
        buyRecommendations: number;
        sellRecommendations: number;
        holdRecommendations: number;
    } {
        const analyses = this.getAllTrendAnalyses();

        return {
            symbolsAnalyzed: analyses.length,
            bullishSignals: analyses.filter(a => a.direction === 'bullish').length,
            bearishSignals: analyses.filter(a => a.direction === 'bearish').length,
            neutralSignals: analyses.filter(a => a.direction === 'neutral').length,
            buyRecommendations: analyses.filter(a => a.recommendation === 'BUY').length,
            sellRecommendations: analyses.filter(a => a.recommendation === 'SELL').length,
            holdRecommendations: analyses.filter(a => a.recommendation === 'HOLD').length,
        };
    }

    /**
     * Reset all trend data
     */
    reset(): void {
        this.trendData.clear();
    }

    /**
     * Get persisted signal with enhanced persistence and confirmation count validation
     */
    private getPersistedSignal(symbol: string, rawSignal: 'BULLISH' | 'BEARISH' | null, confidence: number = 0): 'BULLISH' | 'BEARISH' | null {
        const cached = this.signalCache.get(symbol);
        const now = Date.now();

        if (!cached) {
            // First time seeing this symbol
            if (rawSignal && confidence >= this.SIGNAL_STRENGTH_THRESHOLD) {
                this.signalCache.set(symbol, {
                    signal: rawSignal,
                    timestamp: now,
                    confirmationCount: 1,
                    strength: confidence,
                    lastUpdate: now
                });
                console.log(`${symbol}: First ${rawSignal} signal cached (1/${this.MIN_CONFIRMATION_COUNT}) - Strength: ${confidence}%`);
                // Return immediately if confidence is very high
                return confidence >= 85 ? rawSignal : null;
            }
            return null;
        }

        // Check if cached signal has expired
        if (now - cached.timestamp > this.SIGNAL_PERSISTENCE_MS) {
            console.log(`${symbol}: Cached signal expired after ${((now - cached.timestamp) / 60000).toFixed(1)} minutes, resetting`);
            this.signalCache.delete(symbol);
            return this.getPersistedSignal(symbol, rawSignal, confidence);
        }

        // If no new raw signal, return cached signal if it has enough confirmations
        if (!rawSignal) {
            // Extend persistence for strong signals
            if (cached.strength >= 80 && cached.confirmationCount >= this.MIN_CONFIRMATION_COUNT) {
                console.log(`${symbol}: Returning strong cached ${cached.signal} signal (Strength: ${cached.strength}%)`);
                return cached.signal;
            }
            return cached.confirmationCount >= this.MIN_CONFIRMATION_COUNT ? cached.signal : null;
        }

        // If raw signal matches cached signal
        if (rawSignal === cached.signal) {
            cached.confirmationCount++;
            cached.lastUpdate = now;
            cached.strength = Math.max(cached.strength, confidence); // Keep highest confidence

            // Extend persistence timestamp for confirmed signals
            if (cached.confirmationCount >= this.MIN_CONFIRMATION_COUNT) {
                cached.timestamp = now; // Refresh timestamp for confirmed signals
            }

            console.log(`${symbol}: ${rawSignal} signal confirmed (${cached.confirmationCount}/${this.MIN_CONFIRMATION_COUNT}) - Strength: ${cached.strength}%`);

            // Return signal if we have enough confirmations
            return cached.confirmationCount >= this.MIN_CONFIRMATION_COUNT ? cached.signal : null;
        }

        // If raw signal is different from cached signal
        // Only change if new signal is significantly stronger or cached signal is weak
        if (confidence > cached.strength + 15 || cached.strength < 60) {
            console.log(`${symbol}: Signal changed from ${cached.signal} (${cached.strength}%) to ${rawSignal} (${confidence}%), resetting`);
            this.signalCache.set(symbol, {
                signal: rawSignal,
                timestamp: now,
                confirmationCount: 1,
                strength: confidence,
                lastUpdate: now
            });
            return confidence >= 85 ? rawSignal : null; // Return immediately for very strong signals
        } else {
            // Keep existing strong signal
            console.log(`${symbol}: Keeping strong ${cached.signal} signal (${cached.strength}%) over weaker ${rawSignal} (${confidence}%)`);
            return cached.confirmationCount >= this.MIN_CONFIRMATION_COUNT ? cached.signal : null;
        }
    }

    /**
     * Clear signal cache for a symbol (useful for manual resets)
     */
    public clearSignalCache(symbol?: string): void {
        if (symbol) {
            this.signalCache.delete(symbol);
            console.log(`Signal cache cleared for ${symbol}`);
        } else {
            this.signalCache.clear();
            console.log('All signal caches cleared');
        }
    }

    /**
     * Get signal cache status for debugging
     */
    public getSignalCacheStatus(): Array<{symbol: string; signal: string | null; confirmations: number; age: number; strength: number}> {
        const now = Date.now();
        return Array.from(this.signalCache.entries()).map(([symbol, data]) => ({
            symbol,
            signal: data.signal,
            confirmations: data.confirmationCount,
            age: Math.round((now - data.timestamp) / 1000), // age in seconds
            strength: data.strength
        }));
    }

    /**
     * Destroy the engine and clean up resources
     */
    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.trendData.clear();
        this.signalCache.clear();
    }
}

// Create singleton instance
import { efficientHMACalculator } from './efficient-hma-calculator';
export const trendAnalysisEngine = new TrendAnalysisEngine(efficientHMACalculator);