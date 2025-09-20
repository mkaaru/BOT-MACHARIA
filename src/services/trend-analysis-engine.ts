import { CandleData } from './candle-reconstruction-engine';
import { EfficientHMACalculator, EfficientHMAResult } from './efficient-hma-calculator';
import { ehlersProcessor, EhlersSignals } from './ehlers-signal-processing';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';

export interface TrendAnalysis {
    symbol: string;
    direction: TrendDirection;
    strength: TrendStrength;
    confidence: number; // 0-100
    hma5: number | null;
    hma40?: number | null; // Optional since we're not using HMA40 anymore
    hma200: number | null; // Long-term trend filter
    hma5Slope: number | null;
    hma40Slope?: number | null; // Optional since we're not using HMA40 anymore
    hma200Slope: number | null;
    hma5Color?: 'green' | 'red' | 'neutral'; // Color coding for HMA5
    hma200Color?: 'green' | 'red' | 'neutral'; // Color coding for HMA200
    colorAlignment?: boolean; // Whether both HMAs have the same color
    crossover?: number; // Optional since we're using color alignment instead
    longTermTrend: TrendDirection; // HMA200 trend direction for filtering
    longTermTrendStrength?: number; // 0-100, strength of long-term trend
    price: number | null;
    lastUpdate: Date;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    score: number; // Overall trading score (0-100)

    // Enhanced fields for better trend analysis
    trendHierarchy?: {
        shortTerm: TrendDirection;
        mediumTerm: TrendDirection;
        longTerm: TrendDirection;
        alignment: number; // 0-100, how well timeframes align
    };
    marketStructure?: 'uptrend' | 'downtrend' | 'sideways';
    trendConfirmation?: boolean;
    signalQuality?: 'excellent' | 'good' | 'fair' | 'poor';

    // Enhanced Ehlers signals
    ehlers?: EhlersSignals;
    ehlersRecommendation?: {
        action: 'BUY' | 'SELL' | 'HOLD';
        confidence: number;
        reason: string;
        anticipatory: boolean;
    };
    cycleTrading?: {
        suitable: boolean;
        reason: string;
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
    private priceHistory: Map<string, Array<{price: number, timestamp: Date}>> = new Map();
    private updateTimer: NodeJS.Timeout;

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

        // Store price history for market structure analysis
        this.storePriceHistory(symbol, close, new Date(timestamp));

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
     * Store price history for market structure analysis
     */
    private storePriceHistory(symbol: string, price: number, timestamp: Date): void {
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }

        const history = this.priceHistory.get(symbol)!;
        history.push({ price, timestamp });

        // Keep only last 200 price points for analysis
        if (history.length > 200) {
            history.shift();
        }
    }

    /**
     * Update trend analysis for a specific symbol with enhanced hierarchy
     */
    private updateTrendAnalysis(symbol: string, currentPrice: number, ehlersSignals?: EhlersSignals): void {
        // Multiple HMA periods for comprehensive analysis
        const hmaPeriods = [5, 6, 7, 10, 14, 15, 21, 30, 35, 42, 70, 105];

        // Get all HMA values and slopes
        const hmaData: Array<{
            period: number;
            value: number;
            slope: number | null;
            color: 'green' | 'red' | 'neutral';
        }> = [];

        for (const period of hmaPeriods) {
            const hma = this.hmaCalculator.getLatestHMA(symbol, period);
            if (!hma) return; // Not ready yet

            const slope = this.hmaCalculator.getHMASlope(symbol, period, Math.min(5, Math.floor(period / 10) + 2));
            const color = this.getHMAColor(slope);

            hmaData.push({
                period,
                value: hma.value,
                slope,
                color
            });
        }

        // Enhanced trend hierarchy analysis
        const trendHierarchy = this.analyzeTrendHierarchy(hmaData);

        // Market structure analysis
        const marketStructure = this.analyzeMarketStructure(symbol, currentPrice);

        // Trend confirmation check
        const trendConfirmation = this.requireTrendConfirmation(hmaData, trendHierarchy);

        // Enhanced trend direction using hierarchical weighting
        const direction = this.calculateTrendWithHierarchy(hmaData);

        // Calculate strength and confidence with new factors
        const strength = this.calculateEnhancedTrendStrength(trendHierarchy, marketStructure, trendConfirmation);
        const confidence = this.calculateEnhancedConfidence(trendHierarchy, marketStructure, trendConfirmation);

        // Long-term trend from longest HMA (105 period)
        const longTermHMA = hmaData.find(h => h.period === 105);
        const longTermTrend = longTermHMA?.color === 'green' ? 'bullish' : 
                             longTermHMA?.color === 'red' ? 'bearish' : 'neutral';

        // Calculate long-term trend strength
        const longTermStrength = this.calculateLongTermTrendStrengthMultiHMA(hmaData, currentPrice, symbol);

        // Generate base recommendation with strong trend filtering
        const baseRecommendation = this.generateTrendAlignedRecommendation(
            direction, strength, confidence, longTermTrend, longTermStrength, trendHierarchy, symbol
        );

        // Calculate base score
        const baseScore = this.calculateEnhancedTradingScore(
            direction, strength, confidence, trendHierarchy, marketStructure
        );

        // Apply Ehlers signals with trend context filtering
        const { finalRecommendation, enhancedScore } = this.applyEhlersWithTrendContext(
            baseRecommendation, baseScore, ehlersSignals, longTermTrend, longTermStrength, symbol
        );

        // Determine signal quality
        const signalQuality = this.assessSignalQuality(
            trendHierarchy, marketStructure, trendConfirmation, confidence
        );

        // Get Ehlers-based recommendations
        const ehlersRecommendation = ehlersProcessor.generateEhlersRecommendation(symbol);
        const cycleTrading = ehlersProcessor.isGoodForCycleTrading(symbol);

        const analysis: TrendAnalysis = {
            symbol,
            direction,
            strength,
            confidence,
            hma5: hmaData.find(h => h.period === 5)?.value || null,
            hma200: hmaData.find(h => h.period === 105)?.value || null, // Use 105 as long-term instead of 200
            hma5Slope: hmaData.find(h => h.period === 5)?.slope || null,
            hma200Slope: hmaData.find(h => h.period === 105)?.slope || null,
            hma5Color: hmaData.find(h => h.period === 5)?.color,
            hma200Color: hmaData.find(h => h.period === 105)?.color,
            colorAlignment: trendHierarchy.alignment > 70,
            longTermTrend,
            longTermTrendStrength: longTermStrength,
            trendHierarchy,
            marketStructure,
            trendConfirmation,
            signalQuality,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation: finalRecommendation,
            score: enhancedScore,
            ehlers: ehlersSignals,
            ehlersRecommendation,
            cycleTrading,
        };

        this.trendData.set(symbol, analysis);

        console.log(`Enhanced Trend Analysis for ${symbol}: ${direction.toUpperCase()} (${strength}) - ` +
                   `Hierarchy: ${trendHierarchy.alignment.toFixed(1)}% - Structure: ${marketStructure} - ` +
                   `Quality: ${signalQuality} - Score: ${enhancedScore.toFixed(1)} - Recommendation: ${finalRecommendation}`);
    }

    /**
     * Analyze trend hierarchy across different timeframes
     */
    private analyzeTrendHierarchy(hmaData: Array<{period: number, color: string}>): {
        shortTerm: TrendDirection;
        mediumTerm: TrendDirection;
        longTerm: TrendDirection;
        alignment: number;
    } {
        const shortTerm = hmaData.filter(h => h.period <= 15);
        const mediumTerm = hmaData.filter(h => h.period > 15 && h.period <= 42);
        const longTerm = hmaData.filter(h => h.period > 42);

        const getTimeframeTrend = (timeframe: typeof shortTerm): TrendDirection => {
            if (timeframe.length === 0) return 'neutral';
            const bullish = timeframe.filter(h => h.color === 'green').length / timeframe.length;
            if (bullish > 0.6) return 'bullish';
            if (bullish < 0.4) return 'bearish';
            return 'neutral';
        };

        const shortTrendDir = getTimeframeTrend(shortTerm);
        const mediumTrendDir = getTimeframeTrend(mediumTerm);
        const longTrendDir = getTimeframeTrend(longTerm);

        // Calculate alignment score - higher weight for longer-term agreement
        let alignmentScore = 0;
        if (shortTrendDir === mediumTrendDir && shortTrendDir !== 'neutral') alignmentScore += 30;
        if (mediumTrendDir === longTrendDir && mediumTrendDir !== 'neutral') alignmentScore += 50; // Higher weight for medium-long agreement
        if (shortTrendDir === longTrendDir && shortTrendDir !== 'neutral') alignmentScore += 20;

        // Adjust score based on overall consensus across all three
        if (shortTrendDir !== 'neutral' && mediumTrendDir !== 'neutral' && longTrendDir !== 'neutral') {
            if (shortTrendDir === mediumTrendDir && mediumTrendDir === longTrendDir) {
                alignmentScore = 100; // Perfect alignment
            } else if (shortTrendDir === mediumTrendDir || mediumTrendDir === longTrendDir || shortTrendDir === longTrendDir) {
                alignmentScore = Math.max(alignmentScore, 75); // Good alignment if two agree
            } else {
                alignmentScore = Math.max(alignmentScore, 50); // Fair alignment if none agree perfectly
            }
        } else if (shortTrendDir !== 'neutral' && mediumTrendDir !== 'neutral') {
            alignmentScore = Math.max(alignmentScore, 60);
        } else if (mediumTrendDir !== 'neutral' && longTrendDir !== 'neutral') {
            alignmentScore = Math.max(alignmentScore, 70);
        } else if (shortTrendDir !== 'neutral' && longTrendDir !== 'neutral') {
            alignmentScore = Math.max(alignmentScore, 65);
        }


        return {
            shortTerm: shortTrendDir,
            mediumTerm: mediumTrendDir,
            longTerm: longTrendDir,
            alignment: Math.min(100, alignmentScore) // Ensure alignment doesn't exceed 100
        };
    }

    /**
     * Calculate trend direction with hierarchical weighting (longer periods get more weight)
     */
    private calculateTrendWithHierarchy(hmaData: Array<{period: number, color: string}>): TrendDirection {
        let bullishScore = 0;
        let bearishScore = 0;

        for (const hma of hmaData) {
            // Longer periods get exponentially higher weights
            const weight = Math.pow(Math.log(hma.period + 1), 1.5);

            if (hma.color === 'green') bullishScore += weight;
            if (hma.color === 'red') bearishScore += weight;
        }

        // Require 25% edge for trend confirmation (stronger than before)
        if (bullishScore > bearishScore * 1.25) return 'bullish';
        if (bearishScore > bullishScore * 1.25) return 'bearish';
        return 'neutral';
    }

    /**
     * Analyze market structure based on swing highs and lows
     */
    private analyzeMarketStructure(symbol: string, currentPrice: number): 'uptrend' | 'downtrend' | 'sideways' {
        const history = this.priceHistory.get(symbol);
        if (!history || history.length < 20) return 'sideways';

        // Find recent swing highs and lows within the last ~50 data points
        const lookback = Math.min(50, history.length);
        const recentHistory = history.slice(-lookback);
        let higherHighs = 0;
        let lowerLows = 0;
        let higherLows = 0;
        let lowerHighs = 0;

        // Iterate through potential pivot points
        for (let i = 5; i < recentHistory.length - 5; i++) {
            const currentPricePoint = recentHistory[i];
            const current = currentPricePoint.price;
            const isPivotHigh = recentHistory.slice(i - 5, i + 6).every((p, idx) => 
                idx === 5 || p.price <= current
            );
            const isPivotLow = recentHistory.slice(i - 5, i + 6).every((p, idx) => 
                idx === 5 || p.price >= current
            );

            if (isPivotHigh) {
                // Find previous pivot high
                let previousPivotHighPrice = -1;
                for (let j = i - 1; j >= 0; j--) {
                    const prevPricePoint = recentHistory[j];
                    const isPrevPivotHigh = recentHistory.slice(j - 5, j + 6).every((p, idx) => 
                        idx === 5 || p.price <= prevPricePoint.price
                    );
                    if (isPrevPivotHigh) {
                        previousPivotHighPrice = prevPricePoint.price;
                        break;
                    }
                }

                if (previousPivotHighPrice !== -1) {
                    if (current > previousPivotHighPrice) {
                        higherHighs++;
                    } else {
                        lowerHighs++;
                    }
                }
            }

            if (isPivotLow) {
                // Find previous pivot low
                let previousPivotLowPrice = -1;
                for (let j = i - 1; j >= 0; j--) {
                    const prevPricePoint = recentHistory[j];
                    const isPrevPivotLow = recentHistory.slice(j - 5, j + 6).every((p, idx) => 
                        idx === 5 || p.price >= prevPricePoint.price
                    );
                    if (isPrevPivotLow) {
                        previousPivotLowPrice = prevPricePoint.price;
                        break;
                    }
                }

                if (previousPivotLowPrice !== -1) {
                    if (current > previousPivotLowPrice) {
                        higherLows++;
                    } else {
                        lowerLows++;
                    }
                }
            }
        }

        // Determine market structure based on pivot counts
        const uptrendConfirmation = higherHighs >= 1 && higherLows >= 1;
        const downtrendConfirmation = lowerHighs >= 1 && lowerLows >= 1;

        if (uptrendConfirmation && !downtrendConfirmation) return 'uptrend';
        if (downtrendConfirmation && !uptrendConfirmation) return 'downtrend';
        
        // If both or neither are confirmed, it's likely sideways or consolidating
        return 'sideways';
    }

    /**
     * Require trend confirmation across multiple timeframes
     */
    private requireTrendConfirmation(
        hmaData: Array<{period: number, color: string}>, 
        hierarchy: {shortTerm: TrendDirection, mediumTerm: TrendDirection, longTerm: TrendDirection}
    ): boolean {
        // Check if at least 2 out of 3 timeframes agree
        const directions = [hierarchy.shortTerm, hierarchy.mediumTerm, hierarchy.longTerm];
        const bullishCount = directions.filter(d => d === 'bullish').length;
        const bearishCount = directions.filter(d => d === 'bearish').length;

        return Math.max(bullishCount, bearishCount) >= 2;
    }

    /**
     * Calculate enhanced trend strength
     */
    private calculateEnhancedTrendStrength(
        hierarchy: any, 
        marketStructure: 'uptrend' | 'downtrend' | 'sideways',
        confirmation: boolean
    ): TrendStrength {
        let strengthScore = 0;

        // Hierarchy alignment contributes 40 points
        strengthScore += (hierarchy.alignment / 100) * 40;

        // Market structure contributes 30 points
        if (marketStructure !== 'sideways') strengthScore += 30;

        // Confirmation contributes 30 points
        if (confirmation) strengthScore += 30;

        if (strengthScore >= 70) return 'strong';
        if (strengthScore >= 40) return 'moderate';
        return 'weak';
    }

    /**
     * Calculate enhanced confidence
     */
    private calculateEnhancedConfidence(
        hierarchy: any,
        marketStructure: 'uptrend' | 'downtrend' | 'sideways',
        confirmation: boolean
    ): number {
        let confidence = 40; // Lower base confidence

        // Add confidence based on hierarchy alignment (more weight to longer-term)
        confidence += (hierarchy.alignment / 100) * 35;

        // Market structure adds confidence
        if (marketStructure !== 'sideways') confidence += 15;

        // Trend confirmation adds significant confidence
        if (confirmation) confidence += 20;

        return Math.min(95, Math.max(10, confidence));
    }

    /**
     * Generate trend-aligned recommendations with strong filtering
     */
    private generateTrendAlignedRecommendation(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        longTermTrend: TrendDirection,
        longTermStrength: number,
        hierarchy: any,
        symbol?: string
    ): 'BUY' | 'SELL' | 'HOLD' {
        // STRONG long-term trend filtering - this is the key change
        if (longTermStrength > 70) {
            // Strong long-term trend - only allow aligned signals
            if (direction === 'bullish' && longTermTrend === 'bearish') {
                console.log(`${symbol}: Blocking BUY signal - strong bearish long-term trend (${longTermStrength.toFixed(1)}%)`);
                return 'HOLD';
            }
            if (direction === 'bearish' && longTermTrend === 'bullish') {
                console.log(`${symbol}: Blocking SELL signal - strong bullish long-term trend (${longTermStrength.toFixed(1)}%)`);
                return 'HOLD';
            }
        }

        // Medium strength long-term trend filtering
        if (longTermStrength > 50) {
            if (direction === 'bullish' && longTermTrend === 'bearish' && hierarchy.alignment < 80) {
                console.log(`${symbol}: Blocking BUY signal - medium bearish long-term trend without strong short-term alignment`);
                return 'HOLD';
            }
            if (direction === 'bearish' && longTermTrend === 'bullish' && hierarchy.alignment < 80) {
                console.log(`${symbol}: Blocking SELL signal - medium bullish long-term trend without strong short-term alignment`);
                return 'HOLD';
            }
        }

        // Require higher minimum confidence and alignment for signals
        if (confidence < 65 || hierarchy.alignment < 60) {
            console.log(`${symbol}: Signal quality too low - confidence: ${confidence.toFixed(1)}, alignment: ${hierarchy.alignment.toFixed(1)}`);
            return 'HOLD';
        }

        // Check candle color validation if symbol is provided
        if (symbol) {
            const candleColorValid = this.validateCandleColor(symbol, direction);
            if (!candleColorValid) {
                console.log(`${symbol}: Candle color validation failed for ${direction} signal - waiting for aligned candle`);
                return 'HOLD';
            }
        }

        // Generate recommendation based on aligned direction and strength
        if (direction === 'bullish' && strength !== 'weak') {
            console.log(`${symbol}: ✅ BUY signal approved - aligned with trend hierarchy`);
            return 'BUY';
        }
        if (direction === 'bearish' && strength !== 'weak') {
            console.log(`${symbol}: ✅ SELL signal approved - aligned with trend hierarchy`);
            return 'SELL';
        }

        return 'HOLD';
    }

    /**
     * Apply Ehlers signals with strong trend context filtering
     */
    private applyEhlersWithTrendContext(
        baseRecommendation: 'BUY' | 'SELL' | 'HOLD',
        baseScore: number,
        ehlersSignals: EhlersSignals | undefined,
        longTermTrend: TrendDirection,
        longTermStrength: number,
        symbol: string
    ): { finalRecommendation: 'BUY' | 'SELL' | 'HOLD', enhancedScore: number } {
        const ehlersRecommendation = ehlersProcessor.generateEhlersRecommendation(symbol);
        const cycleTrading = ehlersProcessor.isGoodForCycleTrading(symbol);

        let finalRecommendation = baseRecommendation;
        let enhancedScore = baseScore;

        if (ehlersSignals && ehlersRecommendation) {
            const isCounterTrend = 
                (ehlersRecommendation.action === 'BUY' && longTermTrend === 'bearish') ||
                (ehlersRecommendation.action === 'SELL' && longTermTrend === 'bullish');

            // Strong anticipatory signals with trend context
            if (ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'strong') {
                if (isCounterTrend && longTermStrength > 60) {
                    // Strong opposing trend - significantly reduce signal or block
                    console.log(`${symbol}: Ehlers strong signal blocked by opposing long-term trend (${longTermStrength.toFixed(1)}%)`);
                    enhancedScore = Math.min(75, baseScore + 5); // Minimal bonus
                } else if (isCounterTrend && longTermStrength > 40) {
                    // Medium opposing trend - allow but reduce bonus
                    console.log(`${symbol}: Ehlers strong signal reduced due to opposing trend`);
                    finalRecommendation = ehlersRecommendation.action;
                    enhancedScore = Math.min(80, baseScore + 10);
                } else {
                    // Signal aligns with trend or weak opposing trend - full bonus
                    console.log(`${symbol}: ✅ Ehlers strong signal approved - trend aligned`);
                    finalRecommendation = ehlersRecommendation.action;
                    enhancedScore = Math.min(98, baseScore + 25);
                }
            }
            // Medium strength anticipatory signals
            else if (ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'medium') {
                if (!isCounterTrend || longTermStrength < 50) {
                    console.log(`${symbol}: ✅ Ehlers medium signal approved`);
                    finalRecommendation = ehlersRecommendation.action;
                    enhancedScore = Math.min(90, baseScore + 15);
                } else {
                    console.log(`${symbol}: Ehlers medium signal blocked by trend context`);
                }
            }
            // Weak signals only if cycle conditions are good and trend allows
            else if (ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'weak' && 
                     cycleTrading.suitable && (!isCounterTrend || longTermStrength < 40)) {
                console.log(`${symbol}: ✅ Ehlers weak signal approved in good cycle conditions`);
                finalRecommendation = ehlersRecommendation.action;
                enhancedScore = Math.min(80, baseScore + 8);
            }
        }

        return { finalRecommendation, enhancedScore };
    }

    /**
     * Calculate enhanced trading score with hierarchy weighting
     */
    private calculateEnhancedTradingScore(
        direction: TrendDirection,
        strength: TrendStrength,
        confidence: number,
        hierarchy: any,
        marketStructure: 'uptrend' | 'downtrend' | 'sideways'
    ): number {
        let score = confidence * 0.5; // Start with confidence base (reduced weight)

        // Add strength bonuses
        if (strength === 'strong') score += 20;
        else if (strength === 'moderate') score += 12;
        else score += 5;

        // Add hierarchy alignment bonus (increased importance)
        score += (hierarchy.alignment / 100) * 25;

        // Market structure bonus
        if (marketStructure !== 'sideways') score += 12;

        // Direction clarity bonus
        if (direction !== 'neutral') score += 8;

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Assess overall signal quality
     */
    private assessSignalQuality(
        hierarchy: any,
        marketStructure: 'uptrend' | 'downtrend' | 'sideways',
        confirmation: boolean,
        confidence: number
    ): 'excellent' | 'good' | 'fair' | 'poor' {
        let qualityScore = 0;

        // Hierarchy alignment is most important
        if (hierarchy.alignment > 80) qualityScore += 30;
        else if (hierarchy.alignment > 60) qualityScore += 20;
        else if (hierarchy.alignment > 40) qualityScore += 10;

        // Market structure
        if (marketStructure !== 'sideways') qualityScore += 25;

        // Trend confirmation
        if (confirmation) qualityScore += 25;

        // Confidence level
        if (confidence > 75) qualityScore += 20;
        else if (confidence > 60) qualityScore += 15;
        else if (confidence > 45) qualityScore += 8;

        if (qualityScore >= 80) return 'excellent';
        if (qualityScore >= 60) return 'good';
        if (qualityScore >= 40) return 'fair';
        return 'poor';
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

        // Calculate consistency in long-term HMAs with exponential weighting
        let totalWeight = 0;
        let weightedColorScore = 0;

        longTermHMAs.forEach(hma => {
            const weight = Math.log(hma.period + 1); // Longer periods get more weight
            totalWeight += weight;

            if (hma.color === 'green') weightedColorScore += weight;
            else if (hma.color === 'red') weightedColorScore -= weight;
        });

        const normalizedColorScore = totalWeight > 0 ? Math.abs(weightedColorScore) / totalWeight : 0;
        const consistency = normalizedColorScore * 100;

        // Calculate average slope magnitude with weighting
        const validSlopes = longTermHMAs.filter(h => h.slope !== null);
        let weightedSlopeSum = 0;
        let slopeWeightSum = 0;

        validSlopes.forEach(hma => {
            const weight = Math.log(hma.period + 1);
            weightedSlopeSum += Math.abs(hma.slope!) * weight;
            slopeWeightSum += weight;
        });

        const avgSlopeMagnitude = slopeWeightSum > 0 ? weightedSlopeSum / slopeWeightSum : 0;

        // Combine consistency and slope strength
        const strengthScore = consistency * 0.7 + (avgSlopeMagnitude * 1000 * 30);

        return Math.min(100, Math.max(0, strengthScore));
    }

    /**
     * Get HMA color based on slope with enhanced thresholds
     */
    private getHMAColor(slope: number | null): 'green' | 'red' | 'neutral' {
        if (!slope) return 'neutral';

        const slopeThreshold = 0.0001; // Threshold for color determination

        if (slope > slopeThreshold) return 'green';
        if (slope < -slopeThreshold) return 'red';
        return 'neutral';
    }

    /**
     * Validate that the last 1-minute candle color aligns with the signal direction
     */
    private validateCandleColor(symbol: string, direction: TrendDirection): boolean {
        // Import candle reconstruction engine
        const { candleReconstructionEngine } = require('./candle-reconstruction-engine');

        // Get the latest completed candle for this symbol
        const recentCandles = candleReconstructionEngine.getCandles(symbol, 1);

        if (recentCandles.length === 0) {
            console.log(`${symbol}: No candle data available for validation`);
            return false; // No candle data available
        }

        const lastCandle = recentCandles[recentCandles.length - 1];
        const { open, close } = lastCandle;

        // Determine candle color
        const isBullishCandle = close > open;  // Green/bullish candle
        const isBearishCandle = close < open;  // Red/bearish candle

        // Validate alignment
        if (direction === 'bullish' && isBullishCandle) {
            console.log(`${symbol}: ✅ Bullish signal validated - last candle was GREEN (${open.toFixed(5)} → ${close.toFixed(5)})`);
            return true;
        }

        if (direction === 'bearish' && isBearishCandle) {
            console.log(`${symbol}: ✅ Bearish signal validated - last candle was RED (${open.toFixed(5)} → ${close.toFixed(5)})`);
            return true;
        }

        // Signal doesn't align with candle color
        const candleType = isBullishCandle ? 'GREEN' : isBearishCandle ? 'RED' : 'DOJI';
        console.log(`${symbol}: ❌ ${direction.toUpperCase()} signal blocked - last candle was ${candleType} (${open.toFixed(5)} → ${close.toFixed(5)})`);

        return false;
    }

    /**
     * Update all trends periodically
     */
    private updateAllTrends(): void {
        console.log('📊 Updating all trends with enhanced hierarchy analysis...');
        // Re-calculate trend analysis for all currently tracked symbols
        this.trendData.forEach((_, symbol) => {
            const trend = this.getTrendAnalysis(symbol);
            if (trend) {
                // Re-trigger updateTrendAnalysis with existing data to re-evaluate
                // We need to fetch the latest price and Ehlers signals if available
                // For simplicity, we might just re-run analysis if data is present
                // A more robust solution would involve fetching latest data explicitly
                // For now, assume updateCandleData would have been called and data is fresh
                const currentPrice = trend.price; // Use the last known price
                if (currentPrice !== null) {
                    // Re-process Ehlers signals if possible (requires access to Ehlers state or re-computation)
                    // For now, we'll pass undefined and rely on existing HMA data
                    this.updateTrendAnalysis(symbol, currentPrice, undefined); 
                }
            }
        });
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
                // Enhanced filtering - only recommend excellent or good quality signals
                const isRecommended = trend.score > 75 && 
                                    ['BUY', 'SELL'].includes(trend.recommendation) &&
                                    (trend.signalQuality === 'excellent' || trend.signalQuality === 'good') &&
                                    trend.trendConfirmation === true;

                results.push({
                    symbol: symbolInfo.symbol,
                    displayName: symbolInfo.display_name,
                    trend,
                    rank: 0, // Will be set after sorting
                    isRecommended,
                });
            }
        });

        // Sort by trading score (descending) with quality weighting
        results.sort((a, b) => {
            const aQualityBonus = a.trend.signalQuality === 'excellent' ? 10 : 
                                 a.trend.signalQuality === 'good' ? 5 : 0;
            const bQualityBonus = b.trend.signalQuality === 'excellent' ? 10 : 
                                 b.trend.signalQuality === 'good' ? 5 : 0;

            return (b.trend.score + bQualityBonus) - (a.trend.score + aQualityBonus);
        });

        // Set ranks
        results.forEach((result, index) => {
            result.rank = index + 1;
        });

        return results;
    }

    /**
     * Get top trading opportunities with enhanced filtering
     */
    getTopOpportunities(count: number = 5): MarketScanResult[] {
        const all = this.getAllTrendAnalyses();
        const opportunities = all
            .filter(trend => 
                trend.score > 70 && 
                ['BUY', 'SELL'].includes(trend.recommendation) &&
                (trend.signalQuality === 'excellent' || trend.signalQuality === 'good') &&
                trend.trendConfirmation === true
            )
            .sort((a, b) => b.score - a.score)
            .slice(0, count)
            .map((trend, index) => ({
                symbol: trend.symbol,
                displayName: trend.symbol, // Would need display name mapping
                trend,
                rank: index + 1,
                isRecommended: true,
            }));

        return opportunities;
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.trendData.clear();
        this.priceHistory.clear();
    }
}

// Create singleton instance
import { efficientHMACalculator } from './efficient-hma-calculator';
export const trendAnalysisEngine = new TrendAnalysisEngine(efficientHMACalculator);