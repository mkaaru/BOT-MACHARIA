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

export type RecommendationType = 'TREND_FOLLOWING' | 'MEAN_REVERSION';

export interface TrendAnalysis {
    symbol: string;
    timestamp: number;
    direction: TrendDirection;
    strength: TrendStrength;
    confidence: number;
    score: number;
    price: number;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    recommendationType: RecommendationType;
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

    // Sustained momentum analysis for Higher/Lower trades
    sustainedMomentum?: {
        hasSustainedMomentum: boolean;
        direction: 'HIGHER' | 'LOWER' | 'NEUTRAL';
        strength: number;
        confidence: number;
        duration: number;
        factors: string[];
    };

    // Alternative recommendations for both strategies
    alternativeRecommendations?: {
        trendFollowing: {
            recommendation: 'BUY' | 'SELL' | 'HOLD';
            score: number;
            reason: string;
        };
        meanReversion: {
            recommendation: 'BUY' | 'SELL' | 'HOLD';
            score: number;
            reason: string;
        };
    };

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

        // Detect sustained momentum for Higher/Lower trades
        const sustainedMomentum = this.detectSustainedMomentum(symbol, recentCandles, ehlersSignals);

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

        // Determine recommendation type based on signal source
        let recommendationType: RecommendationType = 'TREND_FOLLOWING';
        let finalRecommendation = recommendation;
        let enhancedScore = score;
        let finalReason = 'ROC Trend Following Signal';

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

        // DUAL RECOMMENDATION SYSTEM: Generate both trend following and mean reversion signals

        // === TREND FOLLOWING SIGNALS ===
        let trendFollowingRec = 'HOLD';
        let trendFollowingScore = score;
        let trendFollowingReason = 'ROC Trend Following Signal';

        // Priority 1: Strong ROC signals (TREND FOLLOWING)
        if (persistentROCSignal && confidence >= 75) {
            trendFollowingRec = persistentROCSignal === 'BULLISH' ? 'BUY' : 'SELL';
            trendFollowingScore = Math.min(98, confidence + 25);
            trendFollowingReason = `Strong ${persistentROCSignal} ROC trend signal (${confidence.toFixed(1)}%)`;
            console.log(`🎯 TREND FOLLOWING: ${persistentROCSignal} signal with high confidence (${trendFollowingScore.toFixed(1)}%)`);
        }
        // Strong Ehlers trend signals
        else if (ehlersSignals && !ehlersRecommendation.anticipatory && ehlersRecommendation.confidence >= 70) {
            trendFollowingRec = ehlersRecommendation.action;
            trendFollowingScore = Math.min(95, ehlersRecommendation.confidence + 15);
            trendFollowingReason = `Ehlers trend signal: ${ehlersRecommendation.reason}`;
        }

        // === MEAN REVERSION SIGNALS ===
        let meanReversionRec = 'HOLD';
        let meanReversionScore = 0;
        let meanReversionReason = 'Mean Reversion Signal';

        // Priority 1: Pullback analysis with Ehlers Decycler (MEAN REVERSION)
        if (pullbackAnalysis.isPullback && pullbackAnalysis.confidence >= 70) {
            meanReversionRec = pullbackAnalysis.recommendation;
            meanReversionScore = Math.min(98, pullbackAnalysis.confidence);
            meanReversionReason = `Mean reversion ${pullbackAnalysis.pullbackType} (${pullbackAnalysis.pullbackStrength})`;

            // Add bonus for strong pullbacks
            if (pullbackAnalysis.pullbackStrength === 'strong') {
                meanReversionScore = Math.min(98, meanReversionScore + 10);
                console.log(`🔄 MEAN REVERSION: ${pullbackAnalysis.pullbackType.toUpperCase()} - ${pullbackAnalysis.pullbackStrength.toUpperCase()} (${meanReversionScore.toFixed(1)}%)`);
            }
        }
        // Strong Ehlers anticipatory signals (MEAN REVERSION)
        else if (ehlersSignals && ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'strong') {
            meanReversionRec = ehlersRecommendation.action;
            meanReversionScore = Math.min(95, ehlersRecommendation.confidence + 20);
            meanReversionReason = `Strong anticipatory signal: ${ehlersRecommendation.reason}`;
            console.log(`⚡ MEAN REVERSION: Strong anticipatory signal (${meanReversionScore.toFixed(1)}%)`);
        }
        // Medium Ehlers anticipatory signals
        else if (ehlersSignals && ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'medium') {
            meanReversionRec = ehlersRecommendation.action;
            meanReversionScore = Math.min(90, ehlersRecommendation.confidence + 15);
            meanReversionReason = `Medium anticipatory signal: ${ehlersRecommendation.reason}`;
        }

        // VALIDATE ROC ALIGNMENT WITH RECOMMENDATION DIRECTION
        const validateROCAlignment = (rec: string, rocAlign: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): boolean => {
            // For valid signals, ROC alignment must match recommendation direction
            if (rec === 'BUY' && rocAlign !== 'BULLISH') {
                console.log(`❌ ${symbol}: BUY recommendation rejected - ROC alignment is ${rocAlign}, expected BULLISH`);
                return false;
            }
            if (rec === 'SELL' && rocAlign !== 'BEARISH') {
                console.log(`❌ ${symbol}: SELL recommendation rejected - ROC alignment is ${rocAlign}, expected BEARISH`);
                return false;
            }
            return true;
        };

        // CHOOSE THE BEST SIGNAL FOR PRIMARY RECOMMENDATION WITH ROC VALIDATION
        if (trendFollowingScore >= meanReversionScore && trendFollowingRec !== 'HOLD') {
            // Validate trend following recommendation with ROC alignment
            if (validateROCAlignment(trendFollowingRec, rocAlignment)) {
                finalRecommendation = trendFollowingRec;
                enhancedScore = trendFollowingScore;
                finalReason = trendFollowingReason;
                recommendationType = 'TREND_FOLLOWING';
            } else {
                // ROC alignment mismatch - invalidate trend following
                finalRecommendation = 'HOLD';
                enhancedScore = 0;
                finalReason = `ROC alignment mismatch: ${rocAlignment} vs ${trendFollowingRec}`;
                recommendationType = 'TREND_FOLLOWING';
            }
        } else if (meanReversionScore > 0 && meanReversionRec !== 'HOLD') {
            // For mean reversion, we use contrarian logic - ROC alignment should be OPPOSITE
            const isValidMeanReversion = (rec: string, rocAlign: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): boolean => {
                // Mean reversion: Buy when ROC is bearish (oversold), Sell when ROC is bullish (overbought)
                if (rec === 'BUY' && rocAlign === 'BEARISH') {
                    console.log(`✅ ${symbol}: Mean reversion BUY valid - ROC is BEARISH (oversold condition)`);
                    return true;
                }
                if (rec === 'SELL' && rocAlign === 'BULLISH') {
                    console.log(`✅ ${symbol}: Mean reversion SELL valid - ROC is BULLISH (overbought condition)`);
                    return true;
                }
                console.log(`❌ ${symbol}: Mean reversion ${rec} rejected - ROC alignment is ${rocAlign}`);
                return false;
            };

            if (isValidMeanReversion(meanReversionRec, rocAlignment)) {
                finalRecommendation = meanReversionRec;
                enhancedScore = meanReversionScore;
                finalReason = meanReversionReason;
                recommendationType = 'MEAN_REVERSION';
            } else {
                // Invalid mean reversion signal
                finalRecommendation = 'HOLD';
                enhancedScore = 0;
                finalReason = `Mean reversion validation failed: ${rocAlignment} vs ${meanReversionRec}`;
                recommendationType = 'MEAN_REVERSION';
            }
        } else {
            // No valid signals or fallback - ensure ROC alignment validation
            if (validateROCAlignment(recommendation, rocAlignment)) {
                finalRecommendation = recommendation;
                enhancedScore = score;
                finalReason = 'ROC Trend Following Signal';
                recommendationType = 'TREND_FOLLOWING';
            } else {
                // All signals fail ROC validation
                finalRecommendation = 'HOLD';
                enhancedScore = 0;
                finalReason = 'No valid signals - ROC alignment mismatch';
                recommendationType = 'TREND_FOLLOWING';
            }
        }

        const analysis: TrendAnalysis = {
            symbol,
            direction: finalDirection,
            strength,
            confidence,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation: finalRecommendation,
            recommendationType,
            reason: finalReason,
            score: enhancedScore,
            timestamp: Date.now(),
            longTermROC,
            shortTermROC,
            rocAlignment,
            ehlers: ehlersSignals,
            ehlersRecommendation,
            cycleTrading,
            derivSignals,
            pullbackAnalysis,
            sustainedMomentum,
            // Store both recommendation types for UI display with ROC validation
            alternativeRecommendations: {
                trendFollowing: {
                    recommendation: validateROCAlignment(trendFollowingRec, rocAlignment) ? trendFollowingRec : 'HOLD',
                    score: validateROCAlignment(trendFollowingRec, rocAlignment) ? trendFollowingScore : 0,
                    reason: validateROCAlignment(trendFollowingRec, rocAlignment) ? trendFollowingReason : 'ROC alignment mismatch'
                },
                meanReversion: {
                    recommendation: ((meanReversionRec === 'BUY' && rocAlignment === 'BEARISH') || 
                                   (meanReversionRec === 'SELL' && rocAlignment === 'BULLISH') || 
                                   meanReversionRec === 'HOLD') ? meanReversionRec : 'HOLD',
                    score: ((meanReversionRec === 'BUY' && rocAlignment === 'BEARISH') || 
                           (meanReversionRec === 'SELL' && rocAlignment === 'BULLISH') || 
                           meanReversionRec === 'HOLD') ? meanReversionScore : 0,
                    reason: ((meanReversionRec === 'BUY' && rocAlignment === 'BEARISH') || 
                            (meanReversionRec === 'SELL' && rocAlignment === 'BULLISH') || 
                            meanReversionRec === 'HOLD') ? meanReversionReason : 'Mean reversion ROC mismatch'
                }
            }
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
     * Get ROC periods based on sensitivity setting
     */
    private getROCPeriods(sensitive: boolean = false): { longTerm: number; shortTerm: number } {
        if (sensitive) {
            return {
                longTerm: 10, // Half of default 20
                shortTerm: 3   // Half of default 5 (rounded)
            };
        }
        return {
            longTerm: 20, // Default long-term period
            shortTerm: 5   // Default short-term period
        };
    }

    /**
     * Determine ROC alignment status
     */
    private determineROCAlignment(longTermROC: number, shortTermROC: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        const longTermThreshold = 0.05; // 0.05%
        const shortTermThreshold = 0.1;  // 0.1%

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
     * Calculate confidence based on ROC alignment and strength
     */
    private calculateConfidenceByROC(longTermROC: number, shortTermROC: number, rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): number {
        let confidence = 40; // Base confidence

        // ROC alignment bonus - INCREASED WEIGHT
        if (rocAlignment !== 'NEUTRAL') {
            confidence += 40; // Increased from 30 to 40 points for aligned ROC
        }

        // ROC magnitude bonus - ENHANCED
        const rocMagnitude = Math.abs(longTermROC) + Math.abs(shortTermROC);
        confidence += Math.min(25, rocMagnitude * 12); // Increased multiplier and cap

        // Acceleration bonus (short-term momentum stronger than long-term) - ENHANCED
        const acceleration = Math.abs(shortTermROC - longTermROC);
        confidence += Math.min(15, acceleration * 25); // Increased multiplier and cap

        return Math.min(100, Math.max(0, confidence));
    }

    /**
     * Validate ROC alignment for trading signals with enhanced confluence
     */
    private validateROCAlignment(symbol: string, longTermROC: number, shortTermROC: number): 'BULLISH' | 'BEARISH' | null {
        // Import candle reconstruction engine
        const { candleReconstructionEngine } = require('./candle-reconstruction-engine');

        // Get recent candles for comprehensive pattern validation
        const recentCandles = candleReconstructionEngine.getCandles(symbol, 10);

        if (recentCandles.length < 5) {
            console.log(`${symbol}: Insufficient candle data for pattern validation`);
            return null;
        }

        const lastCandle = recentCandles[recentCandles.length - 1];
        const previousCandle = recentCandles[recentCandles.length - 2];
        const last5Candles = recentCandles.slice(-5);

        // Enhanced multi-timeframe validation
        const confluenceFactors = this.calculateConfluenceFactors(symbol, longTermROC, shortTermROC, last5Candles);
        
        // Require minimum confluence score for signal validation
        if (confluenceFactors.score < 0.65) {
            console.log(`${symbol}: Confluence score too low: ${confluenceFactors.score.toFixed(2)}`);
            return null;
        }

        // Determine candle colors
        const isLastCandleGreen = lastCandle.close > lastCandle.open;
        const isLastCandleRed = lastCandle.close < lastCandle.open;

        // BULLISHSIGNAL CONDITIONS:
        // 1. Long-term ROC positive (upward trend)
        // 2. Short-term ROC stronger positive (acceleration)
        // 3. Last candle is green and closes above previous high
        if (longTermROC > 0.05 && // Long-term positive momentum (> 0.05%)
            shortTermROC > 0.1 && // Short-term positive momentum (> 0.1%)
            shortTermROC > longTermROC && // Short-term stronger than long-term (acceleration)
            isLastCandleGreen &&
            lastCandle.close > previousCandle.high) {

            console.log(`${symbol}: ✅ ROCBULLISH signal confirmed:
                - Long-term ROC (20): ${longTermROC.toFixed(3)}% (positive trend)
                - Short-term ROC (5): ${shortTermROC.toFixed(3)}% (accelerating upward)
                - ROC alignment: SHORT > LONG (${shortTermROC.toFixed(3)}% > ${longTermROC.toFixed(3)}%)
                - Last candle GREEN: ${lastCandle.open.toFixed(5)} → ${lastCandle.close.toFixed(5)}
                - Closes above prev high: ${lastCandle.close.toFixed(5)} > ${previousCandle.high.toFixed(5)}`);
            return 'BULLISH';
        }

        // BEARISH SIGNAL CONDITIONS:
        // 1. Long-term ROC negative (downward trend)
        // 2. Short-term ROC stronger negative (acceleration)
        // 3. Last candle is red and closes below previous low
        if (longTermROC < -0.05 && // Long-term negative momentum (< -0.05%)
            shortTermROC < -0.1 && // Short-term negative momentum (< -0.1%)
            shortTermROC < longTermROC && // Short-term more negative than long-term (acceleration)
            isLastCandleRed &&
            lastCandle.close < previousCandle.low) {

            console.log(`${symbol}: ✅ ROC BEARISH signal confirmed:
                - Long-term ROC (20): ${longTermROC.toFixed(3)}% (negative trend)
                - Short-term ROC (5): ${shortTermROC.toFixed(3)}% (accelerating downward)
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
     * Generate recommendation based on ROC alignment with adaptive thresholds
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

        // Dynamic threshold based on market conditions
        const adaptiveThreshold = this.calculateAdaptiveThreshold(strength, direction);
        
        // Apply the validated ROC signal with adaptive thresholds
        if (rocSignal === 'BULLISH' && confidence > adaptiveThreshold.bullish) {
            return 'BUY';
        } else if (rocSignal === 'BEARISH' && confidence > adaptiveThreshold.bearish) {
            return 'SELL';
        }

        return 'HOLD';
    }

    /**
     * Calculate adaptive thresholds based on market strength and volatility
     */
    private calculateAdaptiveThreshold(strength: TrendStrength, direction: TrendDirection): {
        bullish: number;
        bearish: number;
    } {
        let baseThreshold = 65; // Conservative base

        // Adjust based on trend strength
        switch (strength) {
            case 'strong':
                baseThreshold = 55; // Lower threshold for strong trends
                break;
            case 'moderate':
                baseThreshold = 65; // Standard threshold
                break;
            case 'weak':
                baseThreshold = 75; // Higher threshold for weak trends
                break;
        }

        // Further adjustment based on recent performance
        const recentPerformance = this.getRecentSignalPerformance();
        if (recentPerformance.winRate > 0.7) {
            baseThreshold -= 5; // More aggressive when performing well
        } else if (recentPerformance.winRate < 0.4) {
            baseThreshold += 10; // More conservative when performing poorly
        }

        return {
            bullish: baseThreshold,
            bearish: baseThreshold
        };
    }

    /**
     * Track recent signal performance for adaptive learning
     */
    private getRecentSignalPerformance(): { winRate: number; totalSignals: number } {
        // This would integrate with your transaction store to track win/loss
        // For now, return neutral performance
        return { winRate: 0.5, totalSignals: 0 };
    }

    /**
     * Analyze mean reversion opportunities using Ehlers Decycler and at least 5 candles
     */
    private analyzePullbackWithDecycler(candles: any[], ehlersSignals?: EhlersSignals): PullbackAnalysis {
        if (candles.length < 5) {
            return {
                isPullback: false,
                pullbackStrength: 'weak',
                longerTermTrend: 'neutral',
                pullbackType: 'none',
                confidence: 0,
                recommendation: 'HOLD',
            };
        }

        const last5Candles = candles.slice(-5);
        const last10Candles = candles.slice(-10);

        // Calculate recent price action for mean reversion analysis
        const recentHighs = last5Candles.map(c => c.high);
        const recentLows = last5Candles.map(c => c.low);
        const recentCloses = last5Candles.map(c => c.close);

        const longerHighs = last10Candles.map(c => c.high);
        const longerLows = last10Candles.map(c => c.low);
        const longerCloses = last10Candles.map(c => c.close);

        const currentPrice = recentCloses[recentCloses.length - 1];
        const recentHigh = Math.max(...recentHighs);
        const recentLow = Math.min(...recentLows);
        const longerHigh = Math.max(...longerHighs);
        const longerLow = Math.min(...longerLows);

        // Calculate mean/midpoint for reversion analysis
        const recentMidpoint = (recentHigh + recentLow) / 2;
        const longerMidpoint = (longerHigh + longerLow) / 2;

        // Determine market regime using Decycler
        let marketRegime: 'trending' | 'ranging' | 'neutral' = 'neutral';
        let regimeStrength = 0;

        if (ehlersSignals?.decycler !== undefined && ehlersSignals?.instantaneousTrendline !== undefined) {
            const decyclerValue = ehlersSignals.decycler;
            const instantValue = ehlersSignals.instantaneousTrendline;
            const trendDivergence = Math.abs(instantValue - decyclerValue) / decyclerValue;

            regimeStrength = trendDivergence * 100;

            // Mean reversion works best in ranging markets
            if (trendDivergence < 0.005) { // Less than 0.5% divergence suggests ranging
                marketRegime = 'ranging';
            } else {
                marketRegime = 'trending';
            }

            console.log(`📊 MEAN REVERSION ANALYSIS ${candles[0]?.symbol || 'SYMBOL'}: Decycler=${decyclerValue.toFixed(5)}, Instant=${instantValue.toFixed(5)}, Regime=${marketRegime}, Divergence=${(trendDivergence*100).toFixed(2)}%`);
        } else {
            // Fallback: use price volatility to determine regime
            const priceRange = (recentHigh - recentLow) / recentMidpoint;
            if (priceRange > 0.01) { // > 1% range suggests trending
                marketRegime = 'trending';
                regimeStrength = priceRange * 100;
            } else {
                marketRegime = 'ranging';
                regimeStrength = (1 - priceRange) * 100;
            }
        }

        // Mean reversion signal detection
        let pullbackType: 'none' | 'bullish_pullback' | 'bearish_pullback' = 'none';
        let pullbackStrength: 'weak' | 'medium' | 'strong' = 'weak';
        let confidence = 0;

        // MEAN REVERSION BUY SIGNAL: Price oversold, expecting bounce
        const distanceFromHigh = (recentHigh - currentPrice) / recentHigh;
        const distanceFromMidpoint = (currentPrice - recentMidpoint) / recentMidpoint;
        const isOversold = currentPrice <= recentLow * 1.005; // Within 0.5% of recent low
        const hasBottomTail = last5Candles.some(c => (c.close - c.low) / (c.high - c.low) > 0.7); // Candle with long bottom wick

        if (distanceFromHigh > 0.005 && // At least 0.5% down from high
            distanceFromMidpoint < -0.002 && // Below midpoint
            isOversold &&
            hasBottomTail) {

            pullbackType = 'bullish_pullback'; // INVERTED: Buy when oversold
            confidence = 60;

            // Strength based on how oversold
            if (distanceFromHigh > 0.015 && marketRegime === 'ranging') { // >1.5% down in ranging market
                pullbackStrength = 'strong';
                confidence = 85;
                console.log(`🔄 STRONG MEAN REVERSION BUY: Oversold ${(distanceFromHigh*100).toFixed(2)}% from high in ranging market`);
            } else if (distanceFromHigh > 0.008) { // >0.8% down
                pullbackStrength = 'medium';
                confidence = 72;
                console.log(`🔄 MEDIUM MEAN REVERSION BUY: Oversold ${(distanceFromHigh*100).toFixed(2)}% from high`);
            } else {
                pullbackStrength = 'weak';
                confidence = 65;
            }
        }

        // MEAN REVERSION SELL SIGNAL: Price overbought, expecting pullback  
        const distanceFromLow = (currentPrice - recentLow) / recentLow;
        const isOverbought = currentPrice >= recentHigh * 0.995; // Within 0.5% of recent high
        const hasTopTail = last5Candles.some(c => (c.high - c.close) / (c.high - c.low) > 0.7); // Candle with long top wick

        if (distanceFromLow > 0.005 && // At least 0.5% up from low
            distanceFromMidpoint > 0.002 && // Above midpoint
            isOverbought &&
            hasTopTail) {

            pullbackType = 'bearish_pullback'; // INVERTED: Sell when overbought
            confidence = 60;

            // Strength based on how overbought
            if (distanceFromLow > 0.015 && marketRegime === 'ranging') { // >1.5% up in ranging market
                pullbackStrength = 'strong';
                confidence = 85;
                console.log(`🔄 STRONG MEAN REVERSION SELL: Overbought ${(distanceFromLow*100).toFixed(2)}% from low in ranging market`);
            } else if (distanceFromLow > 0.008) { // >0.8% up
                pullbackStrength = 'medium';
                confidence = 72;
                console.log(`🔄 MEDIUM MEAN REVERSION SELL: Overbought ${(distanceFromLow*100).toFixed(2)}% from low`);
            } else {
                pullbackStrength = 'weak';
                confidence = 65;
            }
        }

        // Generate INVERTED recommendation for mean reversion
        let recommendation: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

        if (pullbackType === 'bullish_pullback' && confidence >= 70) {
            recommendation = 'BUY'; // Buy oversold conditions
        } else if (pullbackType === 'bearish_pullback' && confidence >= 70) {
            recommendation = 'SELL'; // Sell overbought conditions
        }

        // Enhance confidence with Ehlers signals for mean reversion
        if (ehlersSignals && pullbackType !== 'none') {
            // In mean reversion, we want contrarian signals
            if (ehlersSignals.anticipatorySignal < -1.0 && pullbackType === 'bullish_pullback') {
                confidence = Math.min(95, confidence + 15); // Negative signal + oversold = strong buy
            } else if (ehlersSignals.anticipatorySignal > 1.0 && pullbackType === 'bearish_pullback') {
                confidence = Math.min(95, confidence + 15); // Positive signal + overbought = strong sell
            }

            // Bonus for ranging markets (better for mean reversion)
            if (marketRegime === 'ranging') {
                confidence = Math.min(95, confidence + 10);
            }
        }
        
        return {
            isPullback: pullbackType !== 'none',
            pullbackStrength,
            longerTermTrend: marketRegime === 'ranging' ? 'neutral' : marketRegime === 'trending' ? 'bullish' : 'neutral', // Simplified for mean reversion
            pullbackType,
            confidence,
            recommendation
        };
    }

    /**
     * Detect sustained momentum for Higher/Lower trades
     */
    private detectSustainedMomentum(symbol: string, candles: any[], ehlersSignals?: EhlersSignals): {
        hasSustainedMomentum: boolean;
        direction: 'HIGHER' | 'LOWER' | 'NEUTRAL';
        strength: number;
        confidence: number;
        duration: number;
        factors: string[];
    } {
        if (candles.length < 15) {
            return {
                hasSustainedMomentum: false,
                direction: 'NEUTRAL',
                strength: 0,
                confidence: 0,
                duration: 0,
                factors: []
            };
        }

        const prices = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const volumes = candles.map(c => c.tickCount || 1); // Use tick count as volume proxy

        const factors: string[] = [];
        let strength = 0;
        let confidence = 0;
        let direction: 'HIGHER' | 'LOWER' | 'NEUTRAL' = 'NEUTRAL';

        // 1. Multi-timeframe ROC momentum alignment
        const shortROC = this.calculateROC(prices, 3);
        const mediumROC = this.calculateROC(prices, 7);
        const longROC = this.calculateROC(prices, 14);

        if (shortROC && mediumROC && longROC) {
            // Bullish momentum alignment
            if (shortROC > 0.1 && mediumROC > 0.05 && longROC > 0.02 && 
                shortROC > mediumROC && mediumROC > longROC) {
                direction = 'HIGHER';
                strength += 25;
                confidence += 20;
                factors.push('multi_timeframe_bullish_momentum');
            }
            // Bearish momentum alignment
            else if (shortROC < -0.1 && mediumROC < -0.05 && longROC < -0.02 && 
                     shortROC < mediumROC && mediumROC < longROC) {
                direction = 'LOWER';
                strength += 25;
                confidence += 20;
                factors.push('multi_timeframe_bearish_momentum');
            }
        }

        // 2. Consecutive candle direction (momentum persistence)
        const last5Candles = candles.slice(-5);
        const bullishCandles = last5Candles.filter(c => c.close > c.open).length;
        const bearishCandles = last5Candles.filter(c => c.close < c.open).length;

        if (bullishCandles >= 4) {
            if (direction === 'HIGHER') strength += 20;
            confidence += 15;
            factors.push('consecutive_bullish_candles');
        } else if (bearishCandles >= 4) {
            if (direction === 'LOWER') strength += 20;
            confidence += 15;
            factors.push('consecutive_bearish_candles');
        }

        // 3. Volume-weighted momentum (using tick count)
        const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0);
        const olderVolume = volumes.slice(-10, -5).reduce((a, b) => a + b, 0);
        const volumeIncrease = (recentVolume - olderVolume) / olderVolume;

        if (volumeIncrease > 0.2) { // 20% volume increase
            strength += 15;
            confidence += 10;
            factors.push('increasing_volume');
        }

        // 4. Higher highs / Lower lows pattern
        const recentHighs = highs.slice(-5);
        const recentLows = lows.slice(-5);
        const olderHighs = highs.slice(-10, -5);
        const olderLows = lows.slice(-10, -5);

        const higherHighs = Math.max(...recentHighs) > Math.max(...olderHighs);
        const higherLows = Math.min(...recentLows) > Math.min(...olderLows);
        const lowerHighs = Math.max(...recentHighs) < Math.max(...olderHighs);
        const lowerLows = Math.min(...recentLows) < Math.min(...olderLows);

        if (higherHighs && higherLows && direction === 'HIGHER') {
            strength += 20;
            confidence += 15;
            factors.push('higher_highs_higher_lows');
        } else if (lowerHighs && lowerLows && direction === 'LOWER') {
            strength += 20;
            confidence += 15;
            factors.push('lower_highs_lower_lows');
        }

        // 5. Ehlers momentum indicators
        if (ehlersSignals) {
            const { anticipatorySignal, netValue, trend, instantaneousTrendline, decycler } = ehlersSignals;

            // Strong anticipatory signals
            if (Math.abs(anticipatorySignal) > 1.5) {
                if (anticipatorySignal > 0 && direction === 'HIGHER') {
                    strength += 15;
                    confidence += 12;
                    factors.push('ehlers_bullish_anticipatory');
                } else if (anticipatorySignal < 0 && direction === 'LOWER') {
                    strength += 15;
                    confidence += 12;
                    factors.push('ehlers_bearish_anticipatory');
                }
            }

            // Trend alignment with instantaneous vs longer-term
            if (instantaneousTrendline && decycler) {
                const trendDivergence = (instantaneousTrendline - decycler) / decycler;
                if (Math.abs(trendDivergence) > 0.001) { // 0.1% divergence
                    if (trendDivergence > 0 && direction === 'HIGHER') {
                        strength += 10;
                        confidence += 8;
                        factors.push('instant_above_decycler');
                    } else if (trendDivergence < 0 && direction === 'LOWER') {
                        strength += 10;
                        confidence += 8;
                        factors.push('instant_below_decycler');
                    }
                }
            }
        }

        // 6. Price acceleration (rate of change of ROC)
        if (shortROC && mediumROC) {
            const acceleration = shortROC - mediumROC;
            if (Math.abs(acceleration) > 0.05) {
                if (acceleration > 0 && direction === 'HIGHER') {
                    strength += 10;
                    confidence += 8;
                    factors.push('positive_acceleration');
                } else if (acceleration < 0 && direction === 'LOWER') {
                    strength += 10;
                    confidence += 8;
                    factors.push('negative_acceleration');
                }
            }
        }

        // 7. Momentum duration estimation
        let duration = 0;
        const currentPrice = prices[prices.length - 1];
        
        // Count consecutive periods in same direction
        for (let i = prices.length - 2; i >= 0; i--) {
            if (direction === 'HIGHER' && prices[i] < currentPrice) {
                duration++;
            } else if (direction === 'LOWER' && prices[i] > currentPrice) {
                duration++;
            } else {
                break;
            }
        }

        // Bonus for sustained duration
        if (duration >= 5) {
            strength += 10;
            confidence += 5;
            factors.push('sustained_duration');
        }

        // Final validation - require minimum thresholds
        const hasSustainedMomentum = strength >= 50 && confidence >= 40 && factors.length >= 3;

        return {
            hasSustainedMomentum,
            direction: hasSustainedMomentum ? direction : 'NEUTRAL',
            strength: Math.min(100, strength),
            confidence: Math.min(100, confidence),
            duration,
            factors
        };
    }

    /**
     * Calculate confluence factors for signal validation
     */
    private calculateConfluenceFactors(symbol: string, longTermROC: number, shortTermROC: number, candles: any[]): {
        score: number;
        factors: string[];
    } {
        const factors: string[] = [];
        let score = 0;

        // Factor 1: ROC Momentum Alignment (25% weight)
        const rocMomentum = Math.abs(shortTermROC) > Math.abs(longTermROC) * 1.2;
        if (rocMomentum) {
            score += 0.25;
            factors.push('ROC_MOMENTUM');
        }

        // Factor 2: Volume Confirmation (using candle size as proxy) (20% weight)
        const avgCandleSize = candles.slice(0, -1).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / (candles.length - 1);
        const lastCandleSize = Math.abs(candles[candles.length - 1].close - candles[candles.length - 1].open);
        if (lastCandleSize > avgCandleSize * 1.3) {
            score += 0.20;
            factors.push('VOLUME_CONFIRM');
        }

        // Factor 3: Price Pattern Validation (20% weight)
        const pricePattern = this.validatePricePattern(candles);
        if (pricePattern.isValid) {
            score += 0.20;
            factors.push(`PATTERN_${pricePattern.type}`);
        }

        // Factor 4: Support/Resistance Respect (15% weight)
        const srLevel = this.checkSupportResistance(candles);
        if (srLevel.respected) {
            score += 0.15;
            factors.push('SR_RESPECT');
        }

        // Factor 5: Time-based Filter (10% weight)
        const timeFilter = this.checkTimeBasedFilter();
        if (timeFilter) {
            score += 0.10;
            factors.push('TIME_FILTER');
        }

        // Factor 6: Volatility Filter (10% weight)
        const volatilityOk = this.checkVolatilityFilter(candles);
        if (volatilityOk) {
            score += 0.10;
            factors.push('VOLATILITY_OK');
        }

        return { score, factors };
    }

    /**
     * Validate price patterns for better entry timing
     */
    private validatePricePattern(candles: any[]): { isValid: boolean; type: string } {
        if (candles.length < 3) return { isValid: false, type: 'INSUFFICIENT_DATA' };

        const last3 = candles.slice(-3);
        const closes = last3.map(c => c.close);
        const highs = last3.map(c => c.high);
        const lows = last3.map(c => c.low);

        // Higher highs and higher lows pattern
        if (closes[2] > closes[1] && closes[1] > closes[0] && 
            lows[2] > lows[1] && lows[1] > lows[0]) {
            return { isValid: true, type: 'UPTREND' };
        }

        // Lower highs and lower lows pattern
        if (closes[2] < closes[1] && closes[1] < closes[0] && 
            highs[2] < highs[1] && highs[1] < highs[0]) {
            return { isValid: true, type: 'DOWNTREND' };
        }

        // Consolidation with breakout
        const range = Math.max(...highs) - Math.min(...lows);
        const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
        if (range / avgPrice < 0.003) { // Less than 0.3% range
            return { isValid: true, type: 'CONSOLIDATION' };
        }

        return { isValid: false, type: 'NO_PATTERN' };
    }

    /**
     * Check support/resistance level respect
     */
    private checkSupportResistance(candles: any[]): { respected: boolean; level?: number } {
        if (candles.length < 5) return { respected: false };

        const recent5 = candles.slice(-5);
        const highs = recent5.map(c => c.high);
        const lows = recent5.map(c => c.low);
        const currentPrice = recent5[recent5.length - 1].close;

        // Find potential resistance (recent high that was touched multiple times)
        const recentHigh = Math.max(...highs);
        const touchesHigh = highs.filter(h => Math.abs(h - recentHigh) / recentHigh < 0.001).length;

        // Find potential support (recent low that was touched multiple times)
        const recentLow = Math.min(...lows);
        const touchesLow = lows.filter(l => Math.abs(l - recentLow) / recentLow < 0.001).length;

        // If price respects support/resistance (bounces off)
        if (touchesHigh >= 2 && currentPrice < recentHigh * 0.995) {
            return { respected: true, level: recentHigh };
        }

        if (touchesLow >= 2 && currentPrice > recentLow * 1.005) {
            return { respected: true, level: recentLow };
        }

        return { respected: false };
    }

    /**
     * Time-based filter to avoid low-probability periods
     */
    private checkTimeBasedFilter(): boolean {
        const now = new Date();
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();

        // Avoid first 5 minutes of each hour (news/volatility spikes)
        if (minute < 5) return false;

        // Focus on high-activity periods for synthetic indices
        // Best times: 8-12 UTC, 13-17 UTC (overlapping sessions)
        return (hour >= 8 && hour <= 12) || (hour >= 13 && hour <= 17);
    }

    /**
     * Volatility filter to ensure adequate price movement
     */
    private checkVolatilityFilter(candles: any[]): boolean {
        if (candles.length < 5) return false;

        const recent5 = candles.slice(-5);
        const ranges = recent5.map(c => (c.high - c.low) / c.close);
        const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;

        // Require minimum volatility for clear signals (0.1% to 1%)
        return avgRange >= 0.001 && avgRange <= 0.01;
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