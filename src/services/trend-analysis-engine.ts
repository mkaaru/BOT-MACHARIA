import { CandleData } from './candle-reconstruction-engine';
import { EfficientHMACalculator, EfficientHMAResult, EfficientHMASlopeResult } from './efficient-hma-calculator';
import { DerivMarketConfig } from './ehlers-signal-processing';
import { 
    EhlersPredictiveSystem, 
    EhlersTradingBot, 
    TenSecondCandleEngine,
    EhlersAnalysis,
    TrendSignal as EhlersTrendSignal,
    tenSecondCandleEngine,
    ehlersTradingBot
} from './ehlers-predictive-system';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type TrendStrength = 'strong' | 'moderate' | 'weak';

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

    // ROC indicators only
    fastROC: number;
    slowROC: number;
    rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE';

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
    private priceHistory: Map<string, number[]> = new Map();
    private ehlersHistory: Map<string, number[]> = new Map();
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
    private readonly MAX_HISTORY = 200;

    // ROC periods
    private readonly FAST_ROC_PERIOD = 1;
    private readonly SLOW_ROC_PERIOD = 5;

    constructor() {
        // Update trend analysis periodically
        this.updateTimer = setInterval(() => this.updateAllTrends(), 30 * 1000); // Every 30 seconds

        console.log('🚀 ROC-Only TrendAnalysisEngine initialized with Ehlers preprocessing');
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

        // Process with Ehlers preprocessing and update analysis
        if (prices.length >= this.SLOW_ROC_PERIOD + 10) { // Need enough data for slow ROC + preprocessing
            this.updateTrendAnalysis(symbol, close);
        }
    }

    /**
     * Update trend analysis for a specific symbol using ROC-only approach
     */
    private updateTrendAnalysis(symbol: string, currentPrice: number): void {
        const prices = this.priceHistory.get(symbol);
        if (!prices || prices.length < this.SLOW_ROC_PERIOD + 10) {
            console.log(`${symbol}: Insufficient price data for ROC analysis`);
            return;
        }

        // Step 1: Apply Ehlers preprocessing to remove noise
        const preprocessedPrices = this.applyEhlersPreprocessing(prices);

        // Store Ehlers history
        this.ehlersHistory.set(symbol, preprocessedPrices);

        // Step 2: Calculate ROC indicators on preprocessed data
        const fastROC = this.calculateROC(preprocessedPrices, this.FAST_ROC_PERIOD);
        const slowROC = this.calculateROC(preprocessedPrices, this.SLOW_ROC_PERIOD);

        if (fastROC === null || slowROC === null) {
            console.log(`${symbol}: Failed to calculate ROC indicators`);
            return;
        }

        // Step 3: Determine ROC alignment and crossovers
        const rocAlignment = this.determineROCAlignment(fastROC, slowROC);
        const rocCrossover = this.detectROCCrossover(symbol, fastROC, slowROC, preprocessedPrices);

        // Step 4: Generate trading signals based on ROC logic
        const direction = this.determineTrendDirection(fastROC, slowROC, rocAlignment);
        const strength = this.calculateTrendStrength(fastROC, slowROC);
        const confidence = this.calculateConfidence(fastROC, slowROC, rocAlignment, rocCrossover);

        // Step 5: Generate recommendation based on ROC strategy
        const recommendation = this.generateROCRecommendation(fastROC, slowROC, rocAlignment, rocCrossover, confidence);

        // Step 6: Calculate trading score
        const score = this.calculateTradingScore(direction, strength, confidence, rocAlignment, rocCrossover);

        const analysis: TrendAnalysis = {
            symbol,
            timestamp: Date.now(),
            direction,
            strength,
            confidence,
            price: currentPrice,
            lastUpdate: new Date(),
            recommendation,
            reason: this.generateReasonForRecommendation(recommendation, fastROC, slowROC, rocAlignment, rocCrossover),
            score,
            fastROC,
            slowROC,
            rocAlignment,
            rocCrossover,
            ehlersSmoothed: preprocessedPrices.slice(-20), // Keep last 20 for debugging
            roofingFiltered: this.applyRoofingFilter(prices).slice(-20)
        };

        this.trendData.set(symbol, analysis);

        console.log(`ROC Analysis for ${symbol}: Fast ROC(${this.FAST_ROC_PERIOD}): ${fastROC.toFixed(4)}%, Slow ROC(${this.SLOW_ROC_PERIOD}): ${slowROC.toFixed(4)}% - Alignment: ${rocAlignment} - Crossover: ${rocCrossover} - Recommendation: ${recommendation} (${confidence.toFixed(1)}%)`);
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
     * Generate ROC-based recommendation
     */
    private generateROCRecommendation(
        fastROC: number, 
        slowROC: number, 
        rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE',
        confidence: number
    ): 'BUY' | 'SELL' | 'HOLD' {
        // High confidence crossover signals
        if (confidence > 70 && rocCrossover === 'BULLISH_CROSS') {
            return 'BUY';
        }

        if (confidence > 70 && rocCrossover === 'BEARISH_CROSS') {
            return 'SELL';
        }

        // Strong alignment signals
        if (confidence > 75 && rocAlignment === 'BULLISH') {
            return 'BUY';
        }

        if (confidence > 75 && rocAlignment === 'BEARISH') {
            return 'SELL';
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
     * Generate reason for recommendation
     */
    private generateReasonForRecommendation(
        recommendation: 'BUY' | 'SELL' | 'HOLD',
        fastROC: number,
        slowROC: number,
        rocAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        rocCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE'
    ): string {
        if (recommendation === 'BUY') {
            if (rocCrossover === 'BULLISH_CROSS') {
                return `BUY: Fast ROC(${this.FAST_ROC_PERIOD}) crossed above zero while Slow ROC(${this.SLOW_ROC_PERIOD}) is positive - Strong bullish momentum`;
            }
            return `BUY: Both ROCs aligned bullish - Fast ROC: ${fastROC.toFixed(2)}%, Slow ROC: ${slowROC.toFixed(2)}%`;
        }

        if (recommendation === 'SELL') {
            if (rocCrossover === 'BEARISH_CROSS') {
                return `SELL: Fast ROC(${this.FAST_ROC_PERIOD}) crossed below zero while Slow ROC(${this.SLOW_ROC_PERIOD}) is negative - Strong bearish momentum`;
            }
            return `SELL: Both ROCs aligned bearish - Fast ROC: ${fastROC.toFixed(2)}%, Slow ROC: ${slowROC.toFixed(2)}%`;
        }

        return `HOLD: ROCs not aligned or insufficient momentum - Fast: ${fastROC.toFixed(2)}%, Slow: ${slowROC.toFixed(2)}%`;
    }

    /**
     * Update all symbols periodically
     */
    private updateAllTrends(): void {
        // This would normally iterate through all active symbols
        // For now, just a placeholder since individual candles trigger updates
        console.log(`🔄 ROC Trend Engine: Monitoring ${this.trendData.size} symbols`);
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
     * Cleanup
     */
    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.trendData.clear();
        this.priceHistory.clear();
        this.ehlersHistory.clear();
        this.signalCache.clear();
    }
}

// Remove the old singleton instance and create a new one without HMA dependency
// No longer need HMA calculator, so it's removed from the constructor.
//export const trendAnalysisEngine = new TrendAnalysisEngine(efficientHMACalculator);
export const trendAnalysisEngine = new TrendAnalysisEngine();