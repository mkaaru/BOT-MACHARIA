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
    private updateTimer: NodeJS.Timeout;
    private signalCache: Map<string, {
        signal: 'BULLISH' | 'BEARISH' | null;
        timestamp: number;
        confirmationCount: number;
    }> = new Map();
    private readonly SIGNAL_PERSISTENCE_MS = 10 * 60 * 1000; // 10 minutes (increased from 5)
    private readonly MIN_CONFIRMATION_COUNT = 5; // Require 5 confirmations before changing signal (increased from 3)

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
     * Update trend analysis for a specific symbol
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

        // Analyze HMA alignment
        const alignment = this.analyzeHMAAlignment(hmaData);
        
        // Determine trend direction based on HMA alignment
        const direction = this.determineTrendDirectionByAlignment(alignment);
        
        // Calculate trend strength based on alignment score
        const strength = this.calculateTrendStrengthByAlignment(alignment);
        
        // Calculate confidence based on alignment consistency
        const confidence = this.calculateConfidenceByAlignment(alignment);
        
        // Long-term trend from longest HMA (105 period)
        const longTermHMA = hmaData.find(h => h.period === 105);
        const longTermTrend = longTermHMA?.color === 'green' ? 'bullish' : 
                             longTermHMA?.color === 'red' ? 'bearish' : 'neutral';
        
        // Calculate long-term trend strength
        const longTermStrength = this.calculateLongTermTrendStrengthMultiHMA(hmaData, currentPrice, symbol);

        // Get SMA-based signal validation with persistence
        const rawSmaSignal = this.validateSMABasedSignal(symbol);
        const persistentSmaSignal = this.getPersistedSignal(symbol, rawSmaSignal);
        
        // Override direction based on persistent SMA signal validation
        let finalDirection = direction;
        if (persistentSmaSignal === 'BULLISH') {
            finalDirection = 'bullish';
        } else if (persistentSmaSignal === 'BEARISH') {
            finalDirection = 'bearish';
        } else {
            finalDirection = 'neutral'; // No valid signal
        }

        // Generate recommendation based on persistent SMA validation
        const recommendation = this.generateRecommendationByAlignment(finalDirection, strength, confidence, alignment, symbol);
        
        // Calculate overall score based on alignment and SMA validation
        let score = this.calculateTradingScoreByAlignment(finalDirection, strength, confidence, alignment);
        
        // Boost score significantly for valid SMA signals
        if (persistentSmaSignal === 'BULLISH' || persistentSmaSignal === 'BEARISH') {
            score = Math.min(95, score + 25); // Add 25 points for valid SMA signal
        }

        // Get Ehlers-based recommendations
        const ehlersRecommendation = ehlersProcessor.generateEhlersRecommendation(symbol);
        const cycleTrading = ehlersProcessor.isGoodForCycleTrading(symbol);

        // Combine traditional and Ehlers recommendations with priority for early signals
        let finalRecommendation = recommendation;
        let enhancedScore = score;

        if (ehlersSignals) {
            // Prioritize strong anticipatory signals regardless of cycle conditions
            if (ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'strong') {
                finalRecommendation = ehlersRecommendation.action;
                enhancedScore = Math.min(98, score + 25); // High bonus for strong pullback signals
            } 
            // Medium priority for medium strength anticipatory signals
            else if (ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'medium') {
                finalRecommendation = ehlersRecommendation.action;
                enhancedScore = Math.min(90, score + 18); // Good bonus for medium anticipatory signals
            }
            // Consider weak anticipatory signals only in good cycle conditions
            else if (ehlersRecommendation.anticipatory && ehlersRecommendation.signalStrength === 'weak' && cycleTrading.suitable) {
                finalRecommendation = ehlersRecommendation.action;
                enhancedScore = Math.min(80, score + 10); // Small bonus for weak anticipatory signals
            }
            // Standard Ehlers signals as backup
            else if (cycleTrading.suitable && ehlersRecommendation.confidence > confidence) {
                finalRecommendation = ehlersRecommendation.action;
                enhancedScore = Math.max(score, ehlersRecommendation.confidence);
            }
        }

        const analysis: TrendAnalysis = {
            symbol,
            direction: finalDirection,
            strength,
            confidence,
            hma5: hmaData.find(h => h.period === 5)?.value || null,
            hma200: hmaData.find(h => h.period === 105)?.value || null, // Use 105 as long-term instead of 200
            hma5Slope: hmaData.find(h => h.period === 5)?.slope || null,
            hma200Slope: hmaData.find(h => h.period === 105)?.slope || null,
            hma5Color: hmaData.find(h => h.period === 5)?.color,
            hma200Color: hmaData.find(h => h.period === 105)?.color,
            colorAlignment: alignment.isAligned,
            longTermTrend,
            longTermTrendStrength: longTermStrength,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation: finalRecommendation,
            score: enhancedScore,
            ehlers: ehlersSignals,
            ehlersRecommendation,
            cycleTrading,
        };

        this.trendData.set(symbol, analysis);
        
        console.log(`SMA-Based Trend Analysis for ${symbol}: ${finalDirection.toUpperCase()} (${strength}) - SMA Signal: ${persistentSmaSignal || 'NONE'} (Raw: ${rawSmaSignal || 'NONE'}) - Score: ${score.toFixed(1)} - Recommendation: ${recommendation}`);
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
        const shortTermAlignment = (shortTermAligned / shortTermHMAs.length) * 100;

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

        // Get specific signal validation using SMA and candle patterns
        const signalValidation = this.validateSMABasedSignal(symbol);
        
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
     * Validate SMA-based trading signals with enhanced long-term trend alignment and reduced noise
     */
    private validateSMABasedSignal(symbol: string): 'BULLISH' | 'BEARISH' | null {
        // Import candle reconstruction engine
        const { candleReconstructionEngine } = require('./candle-reconstruction-engine');
        
        // Get more candles for enhanced long-term analysis (need at least 51 for SMA-50 calculation)
        const recentCandles = candleReconstructionEngine.getCandles(symbol, 55);
        
        if (recentCandles.length < 51) {
            console.log(`${symbol}: Insufficient candle data for enhanced SMA analysis (need 51, have ${recentCandles.length})`);
            return null;
        }
        
        // Get last five candles for stronger pattern confirmation
        const lastCandle = recentCandles[recentCandles.length - 1];
        const previousCandle = recentCandles[recentCandles.length - 2];
        const thirdCandle = recentCandles[recentCandles.length - 3];
        const fourthCandle = recentCandles[recentCandles.length - 4];
        const fifthCandle = recentCandles[recentCandles.length - 5];
        
        // Calculate multiple SMAs for comprehensive trend confirmation
        const last10Candles = recentCandles.slice(-10);
        const last20Candles = recentCandles.slice(-20);
        const last30Candles = recentCandles.slice(-30);
        const last50Candles = recentCandles.slice(-50);
        
        const sma10 = last10Candles.reduce((sum, candle) => sum + candle.close, 0) / 10;
        const sma20 = last20Candles.reduce((sum, candle) => sum + candle.close, 0) / 20;
        const sma30 = last30Candles.reduce((sum, candle) => sum + candle.close, 0) / 30;
        const sma50 = last50Candles.reduce((sum, candle) => sum + candle.close, 0) / 50;
        
        // STRONGER long-term trend requirements (must have all SMAs aligned)
        const strongLongTermBullish = sma10 > sma20 && sma20 > sma30 && sma30 > sma50;
        const strongLongTermBearish = sma10 < sma20 && sma20 < sma30 && sma30 < sma50;
        
        // Additional trend strength validation - check SMA separations are significant
        const smaSpread1020 = Math.abs((sma10 - sma20) / sma20) * 100;
        const smaSpread2030 = Math.abs((sma20 - sma30) / sma30) * 100;
        const smaSpread3050 = Math.abs((sma30 - sma50) / sma50) * 100;
        
        const hasSignificantSeparation = smaSpread1020 > 0.02 && smaSpread2030 > 0.02 && smaSpread3050 > 0.02;
        
        // Only proceed if we have STRONG long-term trend alignment
        if (!strongLongTermBullish && !strongLongTermBearish) {
            console.log(`${symbol}: ❌ No strong long-term trend alignment - SMA10: ${sma10.toFixed(5)}, SMA20: ${sma20.toFixed(5)}, SMA30: ${sma30.toFixed(5)}, SMA50: ${sma50.toFixed(5)}`);
            return null;
        }
        
        if (!hasSignificantSeparation) {
            console.log(`${symbol}: ❌ Insufficient SMA separation - spreads: ${smaSpread1020.toFixed(3)}%, ${smaSpread2030.toFixed(3)}%, ${smaSpread3050.toFixed(3)}%`);
            return null;
        }
        
        // Extract candle data
        const { open: lastOpen, close: lastClose, high: lastHigh, low: lastLow } = lastCandle;
        const { high: prevHigh, low: prevLow, close: prevClose } = previousCandle;
        const { close: thirdClose } = thirdCandle;
        const { close: fourthClose } = fourthCandle;
        const { close: fifthClose } = fifthCandle;
        
        // Enhanced momentum confirmation (require 3+ candles moving in same direction)
        const strongUpwardMomentum = lastClose > prevClose && prevClose > thirdClose && thirdClose > fourthClose;
        const strongDownwardMomentum = lastClose < prevClose && prevClose < thirdClose && thirdClose < fourthClose;
        
        // Determine candle colors
        const isLastCandleGreen = lastClose > lastOpen;
        const isLastCandleRed = lastClose < lastOpen;
        
        // Calculate price distance from SMAs (higher thresholds for stronger signals)
        const priceAboveSMA10 = ((lastClose - sma10) / sma10) * 100;
        const priceAboveSMA20 = ((lastClose - sma20) / sma20) * 100;
        const priceAboveSMA50 = ((lastClose - sma50) / sma50) * 100;
        
        // ULTRA-STRICT BULLISH SIGNAL CONDITIONS:
        // 1. STRONG long-term bullish trend (all SMAs aligned with significant separation)
        // 2. Last candle is green and closes above previous high
        // 3. Price is significantly above multiple SMAs
        // 4. STRONG upward momentum (3+ consecutive higher closes)
        // 5. Price must be above long-term SMA-50 by meaningful margin
        if (strongLongTermBullish && 
            hasSignificantSeparation &&
            isLastCandleGreen && 
            lastClose > prevHigh && 
            priceAboveSMA10 > 0.03 && // Increased from 0.01%
            priceAboveSMA20 > 0.02 &&
            priceAboveSMA50 > 0.01 &&
            strongUpwardMomentum) { // Require strong momentum
            
            console.log(`${symbol}: ✅ ULTRA-STRICT BULLISH signal confirmed:
                - Strong long-term bullish trend: SMA10(${sma10.toFixed(5)}) > SMA20(${sma20.toFixed(5)}) > SMA30(${sma30.toFixed(5)}) > SMA50(${sma50.toFixed(5)})
                - SMA separations: ${smaSpread1020.toFixed(3)}%, ${smaSpread2030.toFixed(3)}%, ${smaSpread3050.toFixed(3)}%
                - Last candle GREEN: ${lastOpen.toFixed(5)} → ${lastClose.toFixed(5)}
                - Closes above prev high: ${lastClose.toFixed(5)} > ${prevHigh.toFixed(5)}
                - Price above SMAs: SMA10(${priceAboveSMA10.toFixed(3)}%), SMA20(${priceAboveSMA20.toFixed(3)}%), SMA50(${priceAboveSMA50.toFixed(3)}%)
                - Strong upward momentum confirmed (3+ candles)`);
            return 'BULLISH';
        }
        
        // ULTRA-STRICT BEARISH SIGNAL CONDITIONS:
        // 1. STRONG long-term bearish trend (all SMAs aligned with significant separation)
        // 2. Last candle is red and closes below previous low
        // 3. Price is significantly below multiple SMAs
        // 4. STRONG downward momentum (3+ consecutive lower closes)
        // 5. Price must be below long-term SMA-50 by meaningful margin
        if (strongLongTermBearish && 
            hasSignificantSeparation &&
            isLastCandleRed && 
            lastClose < prevLow && 
            priceAboveSMA10 < -0.03 && // Increased from -0.01%
            priceAboveSMA20 < -0.02 &&
            priceAboveSMA50 < -0.01 &&
            strongDownwardMomentum) { // Require strong momentum
            
            console.log(`${symbol}: ✅ ULTRA-STRICT BEARISH signal confirmed:
                - Strong long-term bearish trend: SMA10(${sma10.toFixed(5)}) < SMA20(${sma20.toFixed(5)}) < SMA30(${sma30.toFixed(5)}) < SMA50(${sma50.toFixed(5)})
                - SMA separations: ${smaSpread1020.toFixed(3)}%, ${smaSpread2030.toFixed(3)}%, ${smaSpread3050.toFixed(3)}%
                - Last candle RED: ${lastOpen.toFixed(5)} → ${lastClose.toFixed(5)}
                - Closes below prev low: ${lastClose.toFixed(5)} < ${prevLow.toFixed(5)}
                - Price below SMAs: SMA10(${priceAboveSMA10.toFixed(3)}%), SMA20(${priceAboveSMA20.toFixed(3)}%), SMA50(${priceAboveSMA50.toFixed(3)}%)
                - Strong downward momentum confirmed (3+ candles)`);
            return 'BEARISH';
        }
        
        // Log why signal was not generated (detailed debugging)
        if (isLastCandleGreen && lastClose > prevHigh) {
            if (!strongLongTermBullish) {
                console.log(`${symbol}: ❌ Bullish signal blocked - no strong long-term bullish trend`);
            } else if (!hasSignificantSeparation) {
                console.log(`${symbol}: ❌ Bullish signal blocked - insufficient SMA separation`);
            } else if (!strongUpwardMomentum) {
                console.log(`${symbol}: ❌ Bullish signal blocked - insufficient momentum (need 3+ consecutive higher closes)`);
            } else {
                console.log(`${symbol}: ❌ Bullish signal blocked - insufficient price separation from SMAs`);
            }
        } else if (isLastCandleRed && lastClose < prevLow) {
            if (!strongLongTermBearish) {
                console.log(`${symbol}: ❌ Bearish signal blocked - no strong long-term bearish trend`);
            } else if (!hasSignificantSeparation) {
                console.log(`${symbol}: ❌ Bearish signal blocked - insufficient SMA separation`);
            } else if (!strongDownwardMomentum) {
                console.log(`${symbol}: ❌ Bearish signal blocked - insufficient momentum (need 3+ consecutive lower closes)`);
            } else {
                console.log(`${symbol}: ❌ Bearish signal blocked - insufficient price separation from SMAs`);
            }
        }
        
        return null;
    }

    /**
     * Legacy method - kept for compatibility but now calls SMA-based validation
     */
    private validateCandleColor(symbol: string, direction: TrendDirection): boolean {
        const smaSignal = this.validateSMABasedSignal(symbol);
        
        if (direction === 'bullish' && smaSignal === 'BULLISH') {
            return true;
        } else if (direction === 'bearish' && smaSignal === 'BEARISH') {
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
     * Get persisted signal to reduce frequent changes
     */
    private getPersistedSignal(symbol: string, newSignal: 'BULLISH' | 'BEARISH' | null): 'BULLISH' | 'BEARISH' | null {
        const now = Date.now();
        const cached = this.signalCache.get(symbol);
        
        // If no cache entry, create one
        if (!cached) {
            this.signalCache.set(symbol, {
                signal: newSignal,
                timestamp: now,
                confirmationCount: newSignal ? 1 : 0
            });
            return newSignal;
        }
        
        // Check if cache is expired
        if (now - cached.timestamp > this.SIGNAL_PERSISTENCE_MS) {
            // Cache expired, reset
            this.signalCache.set(symbol, {
                signal: newSignal,
                timestamp: now,
                confirmationCount: newSignal ? 1 : 0
            });
            return newSignal;
        }
        
        // If new signal matches cached signal, increment confirmation
        if (newSignal === cached.signal && newSignal !== null) {
            cached.confirmationCount++;
            cached.timestamp = now;
            return cached.signal;
        }
        
        // If new signal is different from cached signal
        if (newSignal !== cached.signal) {
            // If cached signal has enough confirmations, stick with it unless new signal is strong
            if (cached.confirmationCount >= this.MIN_CONFIRMATION_COUNT && cached.signal !== null) {
                // Only change if new signal persists for multiple confirmations
                if (newSignal !== null) {
                    cached.confirmationCount = Math.max(0, cached.confirmationCount - 1);
                    console.log(`${symbol}: Signal persistence - keeping ${cached.signal} (confirmations: ${cached.confirmationCount}, new signal: ${newSignal})`);
                }
                return cached.signal;
            } else {
                // Not enough confirmations yet, switch to new signal
                this.signalCache.set(symbol, {
                    signal: newSignal,
                    timestamp: now,
                    confirmationCount: newSignal ? 1 : 0
                });
                return newSignal;
            }
        }
        
        // Default: return cached signal
        return cached.signal;
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
    public getSignalCacheStatus(): Array<{symbol: string; signal: string | null; confirmations: number; age: number}> {
        const now = Date.now();
        return Array.from(this.signalCache.entries()).map(([symbol, data]) => ({
            symbol,
            signal: data.signal,
            confirmations: data.confirmationCount,
            age: Math.round((now - data.timestamp) / 1000) // age in seconds
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