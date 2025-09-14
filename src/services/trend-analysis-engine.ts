import { CandleData } from './candle-reconstruction-engine';
import { EfficientHMACalculator, EfficientHMAResult } from './efficient-hma-calculator';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';

export interface TrendAnalysis {
    symbol: string;
    direction: TrendDirection;
    strength: TrendStrength;
    confidence: number; // 0-100
    hma5: number | null;
    hma40: number | null;
    hma5Slope: number | null;
    hma40Slope: number | null;
    crossover: number; // 1 = bullish crossover, -1 = bearish crossover, 0 = no crossover
    price: number | null;
    lastUpdate: Date;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    score: number; // Overall trading score (0-100)
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

    constructor(hmaCalculator: EfficientHMACalculator) {
        this.hmaCalculator = hmaCalculator;
        
        // Update trend analysis periodically
        this.updateTimer = setInterval(() => this.updateAllTrends(), 30 * 1000); // Every 30 seconds
    }

    /**
     * Add candle data and update trend analysis
     */
    addCandleData(candle: CandleData): void {
        const { symbol, close } = candle;

        // Use efficient HMA calculator with both periods
        this.hmaCalculator.addCandleData(candle, [5, 40]);
        
        // Update trend analysis for this symbol if HMA is ready
        if (this.hmaCalculator.isReady(symbol, 5) && this.hmaCalculator.isReady(symbol, 40)) {
            this.updateTrendAnalysis(symbol, close);
        }
    }

    /**
     * Update trend analysis for a specific symbol
     */
    private updateTrendAnalysis(symbol: string, currentPrice: number): void {
        const hma5 = this.hmaCalculator.getLatestHMA(symbol, 5);
        const hma40 = this.hmaCalculator.getLatestHMA(symbol, 40);
        
        if (!hma5 || !hma40) {
            // Not enough data yet
            return;
        }

        const hma5Slope = this.hmaCalculator.getHMASlope(symbol, 5, 3);
        const hma40Slope = this.hmaCalculator.getHMASlope(symbol, 40, 3);
        const crossover = this.hmaCalculator.getHMACrossover(symbol, 5, 40);

        // Determine trend direction
        const direction = this.determineTrendDirection(hma5.value, hma40.value, hma5Slope, hma40Slope);
        
        // Calculate trend strength
        const strength = this.calculateTrendStrength(hma5.value, hma40.value, hma5Slope, hma40Slope, currentPrice);
        
        // Calculate confidence
        const confidence = this.calculateConfidence(hma5.value, hma40.value, hma5Slope, hma40Slope, crossover);
        
        // Generate recommendation
        const recommendation = this.generateRecommendation(direction, strength, confidence, crossover);
        
        // Calculate overall score
        const score = this.calculateTradingScore(direction, strength, confidence, crossover);

        const analysis: TrendAnalysis = {
            symbol,
            direction,
            strength,
            confidence,
            hma5: hma5.value,
            hma40: hma40.value,
            hma5Slope,
            hma40Slope,
            crossover,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation,
            score,
        };

        this.trendData.set(symbol, analysis);
        
        console.log(`Trend Analysis for ${symbol}: ${direction.toUpperCase()} (${strength}) - Score: ${score.toFixed(1)} - Recommendation: ${recommendation}`);
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
        
        symbols.forEach(symbol => {
            if (this.hmaCalculator.isReady(symbol, 5) && this.hmaCalculator.isReady(symbol, 40)) {
                const latestHMA5 = this.hmaCalculator.getLatestHMA(symbol, 5);
                const latestHMA40 = this.hmaCalculator.getLatestHMA(symbol, 40);
                
                if (latestHMA5 && latestHMA40) {
                    // Use the close price from price history service or estimate from HMA
                    const estimatedPrice = (latestHMA5.value + latestHMA40.value) / 2;
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
     * Destroy the engine and clean up resources
     */
    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.trendData.clear();
    }
}

// Create singleton instance
import { efficientHMACalculator } from './efficient-hma-calculator';
export const trendAnalysisEngine = new TrendAnalysisEngine(efficientHMACalculator);