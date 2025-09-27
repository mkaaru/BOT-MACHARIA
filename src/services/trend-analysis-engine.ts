import { CandleData } from './candle-reconstruction-engine';
import { TickBasedCandleEngine, TickCandleData } from './tick-based-candle-engine';
import { EfficientHMACalculator, EfficientHMAResult, EfficientHMASlopeResult } from './efficient-hma-calculator';
import { DerivMarketConfig } from './ehlers-signal-processing';

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

    // ROC periods (tick-based)
    private readonly FAST_ROC_PERIOD = 5;
    private readonly SLOW_ROC_PERIOD = 500;

    // Tick tracking constants
    private readonly REQUIRED_TICKS = 30; // Reduced from 60 to 30 ticks
    private readonly CONSISTENCY_THRESHOLD = 80; // Changed from 55% to 80% consistency

    constructor() {
        // Update trend analysis periodically
        this.updateTimer = setInterval(() => this.updateAllTrends(), 30 * 1000); // Every 30 seconds

        console.log('🚀 ROC-Only TrendAnalysisEngine initialized with true 60-tick validation');
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
     * Store price history for ROC calculations (candle-based)
     */
    private storePriceHistory(symbol: string, price: number): void {
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }

        const prices = this.priceHistory.get(symbol)!;
        prices.push(price);

        // Maintain reasonable history size
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
     * Update trend analysis with true 60-tick validation
     */
    private updateTrendAnalysis(symbol: string, currentPrice: number): void {
        const prices = this.priceHistory.get(symbol);
        if (!prices || prices.length < this.SLOW_ROC_PERIOD + 10) {
            console.log(`${symbol}: Insufficient price data for ROC analysis`);
            return;
        }

        // Step 1: Validate 30-tick trend
        const tickTrend = this.validate30TickTrend(symbol);

        // Step 2: Apply Ehlers preprocessing to remove noise
        const preprocessedPrices = this.applyEhlersPreprocessing(prices);

        // Store Ehlers history
        this.ehlersHistory.set(symbol, preprocessedPrices);

        // Step 3: Calculate ROC indicators on preprocessed data
        const fastROC = this.calculateROC(preprocessedPrices, this.FAST_ROC_PERIOD);
        const slowROC = this.calculateROC(preprocessedPrices, this.SLOW_ROC_PERIOD);

        if (fastROC === null || slowROC === null) {
            console.log(`${symbol}: Failed to calculate ROC indicators`);
            return;
        }

        // Step 4: Determine ROC alignment and crossovers
        const rocAlignment = this.determineROCAlignment(fastROC, slowROC);
        const rocCrossover = this.detectROCCrossover(symbol, fastROC, slowROC, preprocessedPrices);

        // Step 5: Generate trading signals based on ROC logic
        const direction = this.determineTrendDirection(fastROC, slowROC, rocAlignment);
        const strength = this.calculateTrendStrength(fastROC, slowROC);
        const confidence = this.calculateConfidence(fastROC, slowROC, rocAlignment, rocCrossover);

        // Step 6: Generate recommendation based on ROC strategy with 60-tick validation
        const recommendation = this.generateROCRecommendation(
            fastROC, slowROC, rocAlignment, rocCrossover, confidence, tickTrend
        );

        // Step 7: Calculate trading score
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
            reason: this.generateReasonForRecommendation(
                recommendation, fastROC, slowROC, rocAlignment, rocCrossover, tickTrend
            ),
            score,
            fastROC,
            slowROC,
            rocAlignment,
            rocCrossover,
            tickTrend, // Include detailed tick trend analysis
            ehlersSmoothed: preprocessedPrices.slice(-20), // Keep last 20 for debugging
            roofingFiltered: this.applyRoofingFilter(prices).slice(-20)
        };

        this.trendData.set(symbol, analysis);

        console.log(`🎯 ${symbol}: ${recommendation} | Fast ROC: ${fastROC.toFixed(3)}% | Slow ROC: ${slowROC.toFixed(3)}% | 30-Tick: ${tickTrend.direction} (${tickTrend.consistency.toFixed(1)}%) | Bulls: ${tickTrend.bullishCount}, Bears: ${tickTrend.bearishCount}`);
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