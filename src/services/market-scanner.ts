import {
    tickStreamManager,
    VOLATILITY_SYMBOLS,
    TickData,
    SymbolInfo
} from './tick-stream-manager';
import {
    candleReconstructionEngine,
    CandleData
} from './candle-reconstruction-engine';
import {
    efficientHMACalculator,
    EfficientHMACalculator
} from './efficient-hma-calculator';
import {
    TrendAnalysisEngine,
    TrendAnalysis,
    MarketScanResult
} from './trend-analysis-engine';

// Placeholder for DerivMarketConfig if it's used elsewhere and needs to be defined
interface DerivMarketConfig {
    // Define properties if necessary
}

export interface ScannerStatus {
    isScanning: boolean;
    connectedSymbols: number;
    totalSymbols: number;
    candlesGenerated: number;
    trendsAnalyzed: number;
    lastUpdate: Date;
    errors: string[];
}

// Updated TradingRecommendation interface with recommendation types
export interface TradingRecommendation {
    symbol: string;
    displayName: string;
    direction: 'CALL' | 'PUT';
    confidence: number;
    score: number;
    currentPrice: number;
    reason: string;
    recommendationType: 'TREND_FOLLOWING' | 'MEAN_REVERSION';
    hma5: number;
    hma40: number;
    suggestedStake: number;
    suggestedDuration: number;
    suggestedDurationUnit: 't' | 's' | 'm';
    // Long-term trend alignment fields
    longTermTrend?: 'bullish' | 'bearish' | 'neutral';
    longTermStrength?: number;
    trendAlignment?: boolean;
    // Added fields for Deriv-specific signals
    strategy?: string;
    barrier?: string;
    timestamp: number;
    validUntil?: number;
    contractType?: 'rise_fall' | 'higher_lower';
    momentumAnalysis?: {
        strength: number;
        duration: number;
        factors: string[];
        barrierDistance?: number;
        expectedDuration?: number;
    };
    // Alternative recommendation for the other strategy type
    alternativeRecommendation?: {
        direction: 'CALL' | 'PUT' | 'HOLD';
        confidence: number;
        reason: string;
        recommendationType: 'TREND_FOLLOWING' | 'MEAN_REVERSION';
    };
}


export class MarketScanner {
    private trendAnalysisEngine: TrendAnalysisEngine;
    private isInitialized: boolean = false;
    private scannerStatus: ScannerStatus;
    private tickCallbacks: Map<string, (tick: TickData) => void> = new Map();
    private candleCallbacks: Map<string, (candle: CandleData) => void> = new Map();
    private statusCallbacks: Set<(status: ScannerStatus) => void> = new Set();
    private recommendationCallbacks: Set<(recommendations: TradingRecommendation[]) => void> = new Set();
    private recommendations: TradingRecommendation[] = [];
    private persistentRecommendations: Map<string, {
        recommendation: TradingRecommendation;
        timestamp: number;
        confirmations: number;
    }> = new Map();
    private readonly RECOMMENDATION_PERSISTENCE_MS = 20 * 60 * 1000; // 20 minutes

    constructor() {
        this.trendAnalysisEngine = new TrendAnalysisEngine(efficientHMACalculator);
        this.scannerStatus = {
            isScanning: false,
            connectedSymbols: 0,
            totalSymbols: VOLATILITY_SYMBOLS.length,
            candlesGenerated: 0,
            trendsAnalyzed: 0,
            lastUpdate: new Date(),
            errors: [],
        };

        // Update recommendations periodically
        setInterval(() => this.updateRecommendations(), 60 * 1000); // Every minute

        // Update status periodically
        setInterval(() => this.updateStatus(), 10 * 1000); // Every 10 seconds
    }

    /**
     * Initialize the market scanner
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log('Market scanner already initialized');
            return;
        }

        try {
            console.log('Initializing Market Scanner...');
            this.scannerStatus.isScanning = true;
            this.notifyStatusChange();

            // Setup tick processing pipeline
            this.setupTickProcessingPipeline();

            // Subscribe to all volatility indices with retry logic
            let retries = 3;
            let subscribed = false;

            while (retries > 0 && !subscribed) {
                try {
                    await tickStreamManager.subscribeToAllVolatilities();
                    subscribed = true;
                    console.log('Successfully subscribed to volatility symbols');
                } catch (error) {
                    console.warn(`Subscription attempt failed, retries left: ${retries - 1}`, error);
                    retries--;
                    if (retries > 0) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            if (!subscribed) {
                throw new Error('Failed to subscribe to volatility symbols after retries');
            }

            // Start periodic status updates immediately
            this.startStatusUpdates();

            // Wait for initial data processing (reduced time since we get 5000 ticks immediately)
            await new Promise(resolve => setTimeout(resolve, 2000));

            this.isInitialized = true;
            this.updateStatus();

            console.log('Market Scanner initialized successfully with historical data');

        } catch (error) {
            console.error('Failed to initialize Market Scanner:', error);
            this.scannerStatus.errors.push(`Initialization failed: ${error}`);
            this.scannerStatus.isScanning = false;
            this.notifyStatusChange();
            throw error;
        }
    }

    /**
     * Start periodic status updates
     */
    private startStatusUpdates(): void {
        // Update status every 5 seconds
        setInterval(() => {
            this.updateStatus();
            this.updateRecommendations();
        }, 5000);
    }

    /**
     * Setup the tick processing pipeline
     */
    private setupTickProcessingPipeline(): void {
        VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const symbol = symbolInfo.symbol;

            // Create tick callback for this symbol
            const tickCallback = (tick: TickData) => {
                try {
                    // Process tick through candle reconstruction
                    candleReconstructionEngine.processTick(tick);
                } catch (error) {
                    console.error(`Error processing tick for ${symbol}:`, error);
                    this.addError(`Tick processing error for ${symbol}: ${error}`);
                }
            };

            // Create candle callback for this symbol
            const candleCallback = (candle: CandleData) => {
                try {
                    // Process candle through trend analysis
                    this.trendAnalysisEngine.addCandleData(candle);
                    this.scannerStatus.candlesGenerated++;
                    this.scannerStatus.trendsAnalyzed++;
                } catch (error) {
                    console.error(`Error processing candle for ${symbol}:`, error);
                    this.addError(`Candle processing error for ${symbol}: ${error}`);
                }
            };

            // Register callbacks
            tickStreamManager.addTickCallback(symbol, tickCallback);
            candleReconstructionEngine.addCandleCallback(symbol, candleCallback);

            // Store callbacks for cleanup
            this.tickCallbacks.set(symbol, tickCallback);
            this.candleCallbacks.set(symbol, candleCallback);
        });
    }

    /**
     * Get current scanner status
     */
    getStatus(): ScannerStatus {
        return { ...this.scannerStatus };
    }

    /**
     * Get market scan results
     */
    getMarketScanResults(): MarketScanResult[] {
        if (!this.isInitialized) {
            return [];
        }

        return this.trendAnalysisEngine.scanMarket(VOLATILITY_SYMBOLS);
    }

    /**
     * Get trading recommendations
     */
    getTradingRecommendations(count: number = 5): TradingRecommendation[] {
        if (!this.isInitialized) {
            return [];
        }

        const opportunities = this.trendAnalysisEngine.getTopOpportunities(count * 2);

        return opportunities
            .filter(opp => opp.trend.recommendation !== 'HOLD')
            .slice(0, count)
            .map(opp => this.convertToTradingRecommendation(opp));
    }

    /**
     * Convert market scan result to trading recommendation
     */
    private convertToTradingRecommendation(scanResult: MarketScanResult): TradingRecommendation {
        const { trend } = scanResult;

        // Determine direction based on recommendation
        const direction: 'CALL' | 'PUT' = trend.recommendation === 'BUY' ? 'CALL' : 'PUT';

        // Generate reason
        const reason = this.generateRecommendationReason(trend);

        // Suggest optimal trading parameters
        const suggestedStake = this.calculateOptimalStake(trend.confidence, trend.strength);
        const { duration, durationUnit } = this.calculateOptimalDuration(trend.strength, scanResult.symbol);

        // Get alternative recommendation from the other strategy type
        let alternativeRecommendation = undefined;
        if (trend.alternativeRecommendations) {
            const altType = trend.recommendationType === 'TREND_FOLLOWING' ? 'meanReversion' : 'trendFollowing';
            const altRec = trend.alternativeRecommendations[altType];
            
            if (altRec.recommendation !== 'HOLD') {
                alternativeRecommendation = {
                    direction: altRec.recommendation === 'BUY' ? 'CALL' as const : 'PUT' as const,
                    confidence: altRec.score,
                    reason: altRec.reason,
                    recommendationType: altType === 'meanReversion' ? 'MEAN_REVERSION' as const : 'TREND_FOLLOWING' as const
                };
            }
        }

        return {
            symbol: scanResult.symbol,
            displayName: scanResult.displayName,
            direction,
            confidence: trend.confidence,
            score: trend.score,
            reason,
            recommendationType: trend.recommendationType,
            hma5: trend.hma5 || 0,
            hma40: trend.hma40 || 0,
            currentPrice: trend.price || 0,
            suggestedStake,
            suggestedDuration: duration,
            suggestedDurationUnit: durationUnit,
            timestamp: trend.timestamp,
            // Long-term trend alignment fields
            longTermTrend: trend.longTermTrend,
            longTermStrength: trend.longTermTrendStrength,
            trendAlignment: trend.colorAlignment === true,
            alternativeRecommendation
        };
    }

    /**
     * Generate mean reversion recommendation reason
     */
    private generateMeanReversionReason(trend: TrendAnalysis): string {
        const reasons: string[] = [];

        // Add mean reversion specific reasons
        if (trend.recommendation === 'BUY') {
            reasons.push('OVERSOLD - Mean Reversion Buy Signal');
            if (trend.pullbackAnalysis?.pullbackStrength === 'strong') {
                reasons.push('Strong Oversold Condition');
            }
            if (trend.pullbackAnalysis?.pullbackType === 'bullish_pullback') {
                reasons.push('Price Below Mean - Bounce Expected');
            }
        } else if (trend.recommendation === 'SELL') {
            reasons.push('OVERBOUGHT - Mean Reversion Sell Signal');
            if (trend.pullbackAnalysis?.pullbackStrength === 'strong') {
                reasons.push('Strong Overbought Condition');
            }
            if (trend.pullbackAnalysis?.pullbackType === 'bearish_pullback') {
                reasons.push('Price Above Mean - Pullback Expected');
            }
        }

        // Add Ehlers signal context for mean reversion
        if (trend.ehlersRecommendation?.anticipatory) {
            if (trend.recommendation === 'BUY' && trend.ehlers?.anticipatorySignal && trend.ehlers.anticipatorySignal < -1) {
                reasons.push('Strong Contrarian Signal (Oversold)');
            } else if (trend.recommendation === 'SELL' && trend.ehlers?.anticipatorySignal && trend.ehlers.anticipatorySignal > 1) {
                reasons.push('Strong Contrarian Signal (Overbought)');
            }
        }

        // Add market regime context
        return reasons.length > 0 ? reasons.join(' | ') : 'Mean Reversion Signal';
    }

    /**
     * Calculate duration optimized for mean reversion trades
     */
    private calculateMeanReversionDuration(trend: TrendAnalysis): number {
        // Mean reversion trades typically need less time than trend following
        const baselineStrength = trend.strength === 'strong' ? 15 : trend.strength === 'moderate' ? 20 : 25;

        // Shorter durations for mean reversion
        if (trend.pullbackAnalysis?.pullbackStrength === 'strong') {
            return 10; // Very short for strong reversals
        } else if (trend.pullbackAnalysis?.pullbackStrength === 'medium') {
            return 15; // Medium duration
        }

        return Math.max(10, baselineStrength - 5); // Generally shorter than trend following
    }

    /**
     * Generate recommendation reason (kept for compatibility)
     */
    private generateRecommendationReason(trend: TrendAnalysis): string {
        return this.generateMeanReversionReason(trend); // Delegate to mean reversion logic
    }

    /**
     * Original recommendation reason method
     */
    private generateOriginalRecommendationReason(trend: TrendAnalysis): string {
        const reasons: string[] = [];

        // Prioritize Ehlers signals
        if (trend.ehlersRecommendation?.anticipatory) {
            reasons.push(`🎯 ${trend.ehlersRecommendation.reason}`);
            if (trend.ehlers?.snr && trend.ehlers.snr > 6) {
                reasons.push(`High SNR: ${trend.ehlers.snr.toFixed(1)}dB`);
            }
        } else if (trend.ehlersRecommendation) {
            reasons.push(trend.ehlersRecommendation.reason);
        }

        // Add traditional signals
        if (trend.crossover === 1) {
            reasons.push('Bullish HMA crossover detected');
        } else if (trend.crossover === -1) {
            reasons.push('Bearish HMA crossover detected');
        }

        if (trend.direction === 'bullish' && trend.hma5Slope && trend.hma5Slope > 0) {
            reasons.push('Strong upward momentum');
        } else if (trend.direction === 'bearish' && trend.hma5Slope && trend.hma5Slope < 0) {
            reasons.push('Strong downward momentum');
        }

        if (trend.strength === 'strong') {
            reasons.push(`${trend.strength} trend strength`);
        }

        // Add Ehlers signal context for mean reversion
        if (trend.ehlersRecommendation?.anticipatory) {
            if (trend.recommendation === 'BUY' && trend.ehlers?.anticipatorySignal && trend.ehlers.anticipatorySignal < -1) {
                reasons.push('Strong Contrarian Signal (Oversold)');
            } else if (trend.recommendation === 'SELL' && trend.ehlers?.anticipatorySignal && trend.ehlers.anticipatorySignal > 1) {
                reasons.push('Strong Contrarian Signal (Overbought)');
            }
        }


        if (trend.confidence > 80) {
            reasons.push('High confidence signal');
        } else if (trend.confidence > 70) {
            reasons.push('Good confidence signal');
        }

        return reasons.length > 0 ? reasons.join(', ') : `${trend.direction} trend with ${trend.confidence.toFixed(0)}% confidence`;
    }

    /**
     * Calculate optimal stake based on confidence and strength
     */
    private calculateOptimalStake(confidence: number, strength: string): number {
        let baseStake = 1.0;

        // Adjust based on confidence
        if (confidence > 80) {
            baseStake = 2.0;
        } else if (confidence > 70) {
            baseStake = 1.5;
        } else if (confidence < 60) {
            baseStake = 0.5;
        }

        // Adjust based on strength
        if (strength === 'strong') {
            baseStake *= 1.2;
        } else if (strength === 'weak') {
            baseStake *= 0.8;
        }

        return Math.round(baseStake * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Calculate optimal duration based on trend strength and symbol type
     */
    private calculateOptimalDuration(strength: string, symbol: string): { duration: number; durationUnit: 't' | 's' | 'm' } {
        const is1sVolatility = symbol.startsWith('1HZ');

        if (is1sVolatility) {
            // For 1-second volatilities, use shorter durations
            switch (strength) {
                case 'strong':
                    return { duration: 5, durationUnit: 't' };
                case 'moderate':
                    return { duration: 7, durationUnit: 't' };
                case 'weak':
                    return { duration: 10, durationUnit: 't' };
                default:
                    return { duration: 5, durationUnit: 't' };
            }
        } else {
            // For regular volatilities, use slightly longer durations
            switch (strength) {
                case 'strong':
                    return { duration: 3, durationUnit: 't' };
                case 'moderate':
                    return { duration: 5, durationUnit: 't' };
                case 'weak':
                    return { duration: 7, durationUnit: 't' };
                default:
                    return { duration: 5, durationUnit: 't' };
            }
        }
    }

    /**
     * Get trend analysis for a specific symbol
     */
    getTrendAnalysis(symbol: string): TrendAnalysis | null {
        return this.trendAnalysisEngine.getTrendAnalysis(symbol);
    }

    /**
     * Update scanner status
     */
    private updateStatus(): void {
        this.scannerStatus.connectedSymbols = tickStreamManager.getSubscribedSymbols().length;
        this.scannerStatus.lastUpdate = new Date();

        // Clean old errors (keep last 10)
        if (this.scannerStatus.errors.length > 10) {
            this.scannerStatus.errors = this.scannerStatus.errors.slice(-10);
        }

        this.notifyStatusChange();
    }

    /**
     * Update recommendations and notify callbacks
     */
    private updateRecommendations(): void {
        const newRecommendations: TradingRecommendation[] = [];
        const now = Date.now();

        VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const symbol = symbolInfo.symbol;
            const trend = this.trendAnalysisEngine.getTrendAnalysis(symbol);
            if (trend && trend.score >= 65) { // Lowered threshold for better capture
                const recommendation: TradingRecommendation = {
                    symbol,
                    displayName: symbolInfo.display_name,
                    direction: trend.recommendation === 'BUY' ? 'CALL' : trend.recommendation === 'SELL' ? 'PUT' : 'HOLD',
                    confidence: trend.confidence,
                    score: trend.score,
                    reason: this.generateRecommendationReason(trend),
                    timestamp: now,
                    currentPrice: trend.price || 0,
                    suggestedStake: this.calculateOptimalStake(trend.confidence, trend.strength),
                    suggestedDuration: this.calculateOptimalDuration(trend.strength, symbol).duration,
                    suggestedDurationUnit: this.calculateOptimalDuration(trend.strength, symbol).durationUnit,
                    longTermTrend: trend.longTermTrend,
                    longTermStrength: trend.longTermTrendStrength,
                    trendAlignment: trend.colorAlignment === true
                };

                // Check for persistent recommendation
                const existing = this.persistentRecommendations.get(symbol);
                if (existing) {
                    // Check if same direction
                    if (existing.recommendation.direction === recommendation.direction) {
                        existing.confirmations++;
                        existing.timestamp = now;
                        existing.recommendation.confidence = Math.max(existing.recommendation.confidence, recommendation.confidence);
                        console.log(`${symbol}: Recommendation confirmed (${existing.confirmations} times) - ${recommendation.direction} ${recommendation.confidence.toFixed(1)}%`);
                    } else if (recommendation.confidence > existing.recommendation.confidence + 10) {
                        // Only change if significantly stronger
                        console.log(`${symbol}: Recommendation changed from ${existing.recommendation.direction} to ${recommendation.direction} (stronger signal)`);
                        this.persistentRecommendations.set(symbol, {
                            recommendation,
                            timestamp: now,
                            confirmations: 1
                        });
                    }
                } else {
                    this.persistentRecommendations.set(symbol, {
                        recommendation,
                        timestamp: now,
                        confirmations: 1
                    });
                }

                newRecommendations.push(recommendation);
            }
        });

        // Add persistent recommendations that haven't expired
        this.persistentRecommendations.forEach((persistent, symbol) => {
            if (now - persistent.timestamp < this.RECOMMENDATION_PERSISTENCE_MS) {
                // Check if not already in new recommendations
                const exists = newRecommendations.find(r => r.symbol === symbol);
                if (!exists && persistent.confirmations >= 2) {
                    console.log(`${symbol}: Adding persistent ${persistent.recommendation.direction} recommendation (${persistent.confirmations} confirmations)`);
                    newRecommendations.push({
                        ...persistent.recommendation,
                        reason: `${persistent.recommendation.reason} [PERSISTENT x${persistent.confirmations}]`
                    });
                }
            } else {
                // Remove expired recommendations
                this.persistentRecommendations.delete(symbol);
                console.log(`${symbol}: Removed expired recommendation`);
            }
        });

        // Sort by confidence/score descending
        newRecommendations.sort((a, b) => b.confidence - a.confidence);

        this.recommendations = newRecommendations.slice(0, 8); // Increased to 8 recommendations

        // Notify callbacks
        this.recommendationCallbacks.forEach(callback => {
            try {
                callback(this.recommendations);
            } catch (error) {
                console.error('Error in recommendation callback:', error);
            }
        });
    }

    /**
     * Add error to status
     */
    private addError(error: string): void {
        this.scannerStatus.errors.push(`${new Date().toISOString()}: ${error}`);
        this.updateStatus();
    }

    /**
     * Subscribe to status changes
     */
    onStatusChange(callback: (status: ScannerStatus) => void): () => void {
        this.statusCallbacks.add(callback);
        return () => this.statusCallbacks.delete(callback);
    }

    /**
     * Subscribe to recommendation changes
     */
    onRecommendationChange(callback: (recommendations: TradingRecommendation[]) => void): () => void {
        this.recommendationCallbacks.add(callback);
        return () => this.recommendationCallbacks.delete(callback);
    }

    /**
     * Notify status change
     */
    private notifyStatusChange(): void {
        this.statusCallbacks.forEach(callback => {
            try {
                callback(this.getStatus());
            } catch (error) {
                console.error('Error in status callback:', error);
            }
        });
    }

    /**
     * Notify recommendation change
     */
    private notifyRecommendationChange(recommendations: TradingRecommendation[]): void {
        this.recommendationCallbacks.forEach(callback => {
            try {
                callback(recommendations);
            } catch (error) {
                console.error('Error in recommendation callback:', error);
            }
        });
    }

    /**
     * Get scanner statistics
     */
    getStatistics(): {
        scanner: ScannerStatus;
        tickStream: any;
        candles: any;
        hma: any;
        trends: any;
    } {
        return {
            scanner: this.getStatus(),
            tickStream: {
                connectedSymbols: tickStreamManager.getSubscribedSymbols().length,
                connectionStatus: tickStreamManager.getConnectionStatus(),
            },
            candles: candleReconstructionEngine.getStats(),
            hma: efficientHMACalculator.getStats(),
            trends: this.trendAnalysisEngine.getStats(),
        };
    }

    /**
     * Force refresh of all data
     */
    async refresh(): Promise<void> {
        console.log('Refreshing market scanner...');

        try {
            // Re-subscribe to any missing symbols
            await tickStreamManager.subscribeToAllVolatilities();

            // Update status
            this.updateStatus();

            // Update recommendations
            this.updateRecommendations();

            console.log('Market scanner refreshed successfully');

        } catch (error) {
            console.error('Error refreshing market scanner:', error);
            this.addError(`Refresh error: ${error}`);
            throw error;
        }
    }

    /**
     * Stop the market scanner
     */
    async stop(): Promise<void> {
        console.log('Stopping market scanner...');

        this.scannerStatus.isScanning = false;

        // Remove all callbacks
        this.tickCallbacks.forEach((callback, symbol) => {
            tickStreamManager.removeTickCallback(symbol, callback);
        });

        this.candleCallbacks.forEach((callback, symbol) => {
            candleReconstructionEngine.removeCandleCallback(symbol, callback);
        });

        // Unsubscribe from all symbols
        await tickStreamManager.unsubscribeFromAll();

        this.isInitialized = false;
        this.updateStatus();

        console.log('Market scanner stopped');
    }

    /**
     * Destroy the market scanner
     */
    destroy(): void {
        this.stop();
        this.statusCallbacks.clear();
        this.recommendationCallbacks.clear();
        this.tickCallbacks.clear();
        this.candleCallbacks.clear();
        this.trendAnalysisEngine.destroy();
    }

    /**
     * Generate Higher/Lower recommendations based on sustained momentum
     */
    generateHigherLowerRecommendation(symbol: string): TradingRecommendation | null {
        const trend = this.getTrendAnalysis(symbol);
        if (!trend || !trend.sustainedMomentum) {
            return null;
        }

        const { sustainedMomentum } = trend;

        if (!sustainedMomentum.hasSustainedMomentum || sustainedMomentum.direction === 'NEUTRAL') {
            return null;
        }

        // Higher confidence threshold for Higher/Lower due to better payouts but higher difficulty
        if (sustainedMomentum.confidence < 70) {
            return null;
        }

        const currentPrice = trend.price;
        const direction = sustainedMomentum.direction === 'HIGHER' ? 'CALL' : 'PUT';

        // Calculate dynamic barrier based on momentum strength and duration
        const baseBarrierDistance = currentPrice * 0.001; // 0.1% base
        const momentumMultiplier = 1 + (sustainedMomentum.strength / 100);
        const durationMultiplier = 1 + (sustainedMomentum.duration * 0.1);
        const barrierDistance = baseBarrierDistance * momentumMultiplier * durationMultiplier;

        const barrier = direction === 'CALL'
            ? currentPrice + barrierDistance
            : currentPrice - barrierDistance;

        // Dynamic duration based on momentum persistence
        const baseDuration = 60; // 60 seconds base
        const suggestedDuration = Math.min(300, baseDuration + (sustainedMomentum.duration * 10)); // Max 5 minutes

        const factorsText = sustainedMomentum.factors.join(', ');
        const reason = `SUSTAINED ${sustainedMomentum.direction} MOMENTUM: ${sustainedMomentum.strength.toFixed(0)}% strength, ${sustainedMomentum.duration} periods duration. Factors: ${factorsText}`;

        return {
            symbol,
            strategy: sustainedMomentum.direction.toLowerCase(),
            direction,
            barrier: barrier.toFixed(5),
            confidence: sustainedMomentum.confidence,
            currentPrice,
            timestamp: Date.now(),
            reason,
            suggestedDuration,
            suggestedDurationUnit: 's',
            suggestedStake: 1.0,
            score: sustainedMomentum.strength,
            validUntil: Date.now() + (5 * 60 * 1000), // Valid for 5 minutes
            contractType: 'higher_lower',
            momentumAnalysis: {
                strength: sustainedMomentum.strength,
                duration: sustainedMomentum.duration,
                factors: sustainedMomentum.factors,
                barrierDistance: barrierDistance,
                expectedDuration: suggestedDuration
            }
        };
    }

    /**
     * Generate Enhanced Deriv-specific signals with momentum and pullback analysis
     */
    generateDerivSignal(symbol: string, config: DerivMarketConfig): {
        action: string;
        confidence: number;
        reasoning: string;
        barrier?: number;
        duration?: number;
    } {
        // This method seems to be for a different type of signal generation.
        // For now, it's kept as is, but it might need to be refactored or integrated
        // with the new Higher/Lower signal generation if there's overlap in purpose.
        // Based on the user's request, the focus is on improving Higher/Lower detection.
        // If this method is intended to also produce Higher/Lower signals, its logic would need to be adapted.
        console.warn("generateDerivSignal is called but may not be fully integrated with new momentum logic.");
        return { action: 'HOLD', confidence: 0, reasoning: 'Not implemented for this signal type' };
    }


    /**
     * Generate trading recommendations based on trend analysis with ultra-strict long-term alignment
     */
    private generateRecommendations(): TradingRecommendation[] {
        const recommendations: TradingRecommendation[] = [];
        const symbolsWithTrends = this.trendAnalysisEngine.getAllTrends(); // Assuming trendEngine is TrendAnalysisEngine

        symbolsWithTrends.forEach(trend => {
            // Generate rise/fall recommendations
            const riseFallRec = this.generateRiseFallRecommendation(trend);
            if (riseFallRec) {
                recommendations.push(riseFallRec);
            }

            // Generate Higher/Lower momentum recommendations (NEW)
            const higherLowerRec = this.generateHigherLowerRecommendation(trend.symbol);
            if (higherLowerRec) {
                recommendations.push(higherLowerRec);
            }

            // Generate pullback recommendations
            const pullbackRec = this.generatePullbackRecommendation(trend);
            if (pullbackRec) {
                recommendations.push(pullbackRec);
            }

            // Generate Ehlers-based recommendations
            const ehlersRec = this.generateEhlersRecommendation(trend.symbol);
            if (ehlersRec) {
                recommendations.push(ehlersRec);
            }
        });

        // Sort by confidence/score descending
        return recommendations
            .sort((a, b) => b.confidence - a.confidence);
    }

    // Placeholder methods - these should be implemented based on your logic
    // For now, they are stubs to allow the code to compile and demonstrate the structure.

    private generateRiseFallRecommendation(trend: TrendAnalysis): TradingRecommendation | null {
        // This is a placeholder. Implement logic to generate Rise/Fall recommendations.
        // For example, based on trend direction, strength, and confidence.
        if (trend.recommendation === 'HOLD' || trend.score < 70) return null;
        return {
            symbol: trend.symbol,
            displayName: trend.symbol, // Placeholder
            direction: trend.recommendation === 'BUY' ? 'CALL' : 'PUT',
            confidence: trend.confidence,
            score: trend.score,
            reason: `Rise/Fall signal: ${trend.recommendation} with ${trend.confidence.toFixed(1)}% confidence`,
            hma5: trend.hma5 || 0,
            hma40: trend.hma40 || 0,
            currentPrice: trend.price || 0,
            suggestedStake: this.calculateOptimalStake(trend.confidence, trend.strength),
            suggestedDuration: this.calculateOptimalDuration(trend.strength, trend.symbol).duration,
            suggestedDurationUnit: this.calculateOptimalDuration(trend.strength, trend.symbol).durationUnit,
            longTermTrend: trend.longTermTrend,
            longTermStrength: trend.longTermTrendStrength,
            trendAlignment: trend.colorAlignment === true,
            timestamp: Date.now(),
            contractType: 'rise_fall',
        };
    }

    private generatePullbackRecommendation(trend: TrendAnalysis): TradingRecommendation | null {
        // This is a placeholder. Implement logic for pullback recommendations.
        // Consider factors like oversold/overbought conditions, divergence, etc.
        if (!trend.pullbackAnalysis || trend.pullbackAnalysis.pullbackType === 'none') return null;

        const direction: 'CALL' | 'PUT' = trend.recommendation === 'BUY' ? 'CALL' : 'PUT';
        const confidence = trend.confidence * (trend.pullbackAnalysis.pullbackStrength === 'strong' ? 1.2 : 1.0); // Boost confidence for strong pullbacks
        const reason = `Pullback signal: ${trend.recommendation} based on ${trend.pullbackAnalysis.pullbackType} (${trend.pullbackAnalysis.pullbackStrength} strength)`;

        return {
            symbol: trend.symbol,
            displayName: trend.symbol, // Placeholder
            direction,
            confidence: Math.min(100, confidence),
            score: trend.score * 0.8, // Slightly lower score for pullback signals
            reason,
            hma5: trend.hma5 || 0,
            hma40: trend.hma40 || 0,
            currentPrice: trend.price || 0,
            suggestedStake: this.calculateOptimalStake(Math.min(100, confidence), trend.strength),
            suggestedDuration: this.calculateMeanReversionDuration(trend), // Use mean reversion duration logic
            suggestedDurationUnit: 's',
            longTermTrend: trend.longTermTrend,
            longTermStrength: trend.longTermTrendStrength,
            trendAlignment: trend.colorAlignment === true,
            timestamp: Date.now(),
            contractType: 'rise_fall', // Assuming pullback is for rise/fall
        };
    }

    private generateEhlersRecommendation(symbol: string): TradingRecommendation | null {
        // This is a placeholder. Implement logic for Ehlers indicator recommendations.
        const trend = this.getTrendAnalysis(symbol);
        if (!trend || !trend.ehlersRecommendation || trend.ehlersRecommendation.recommendation === 'HOLD') {
            return null;
        }

        const direction: 'CALL' | 'PUT' = trend.ehlersRecommendation.recommendation === 'BUY' ? 'CALL' : 'PUT';
        const confidence = trend.ehlersRecommendation.confidence || trend.confidence;
        const reason = `Ehlers signal: ${trend.ehlersRecommendation.reason}`;

        return {
            symbol,
            displayName: symbol, // Placeholder
            direction,
            confidence: confidence,
            score: trend.score * 0.9, // Adjust score based on Ehlers
            reason,
            hma5: trend.hma5 || 0,
            hma40: trend.hma40 || 0,
            currentPrice: trend.price || 0,
            suggestedStake: this.calculateOptimalStake(confidence, trend.strength),
            suggestedDuration: this.calculateOptimalDuration(trend.strength, symbol).duration,
            suggestedDurationUnit: this.calculateOptimalDuration(trend.strength, symbol).durationUnit,
            longTermTrend: trend.longTermTrend,
            longTermStrength: trend.longTermTrendStrength,
            trendAlignment: trend.colorAlignment === true,
            timestamp: Date.now(),
            contractType: 'rise_fall', // Assuming Ehlers is for rise/fall
        };
    }


    /**
     * Placeholder for generating rise/fall recommendations
     */
    // private generateRiseFallRecommendation(trend: TrendAnalysis): TradingRecommendation | null {
    //     // Implement logic here
    //     return null;
    // }

    /**
     * Placeholder for generating pullback recommendations
     */
    // private generatePullbackRecommendation(trend: TrendAnalysis): TradingRecommendation | null {
    //     // Implement logic here
    //     return null;
    // }

    /**
     * Placeholder for generating Ehlers-based recommendations
     */
    // private generateEhlersRecommendation(symbol: string): TradingRecommendation | null {
    //     // Implement logic here
    //     return null;
    // }


    /**
     * Placeholder for calculating suggested stake
     */
    // private calculateSuggestedStake(trend: TrendAnalysis): number {
    //     // Implement logic here
    //     return 1.0;
    // }

    /**
     * Placeholder for calculating suggested duration
     */
    // private calculateSuggestedDuration(trend: TrendAnalysis): number {
    //     // Implement logic here
    //     return 5;
    // }

    /**
     * Placeholder method for calculating suggested stake (used by generateRecommendations)
     */
    private calculateSuggestedStake(trend: TrendAnalysis): number {
        return this.calculateOptimalStake(trend.confidence, trend.strength);
    }

    /**
     * Placeholder method for calculating suggested duration (used by generateRecommendations)
     */
    private calculateSuggestedDuration(trend: TrendAnalysis): number {
        const { duration } = this.calculateOptimalDuration(trend.strength, trend.symbol);
        return duration;
    }
}

// Create singleton instance
export const marketScanner = new MarketScanner();