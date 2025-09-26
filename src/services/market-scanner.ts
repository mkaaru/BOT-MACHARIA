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

export interface ScannerStatus {
    isScanning: boolean;
    connectedSymbols: number;
    totalSymbols: number;
    candlesGenerated: number;
    trendsAnalyzed: number;
    lastUpdate: Date;
    errors: string[];
}

export interface TradingRecommendation {
    symbol: string;
    displayName: string;
    direction: 'CALL' | 'PUT';
    confidence: number;
    score: number;
    currentPrice: number;
    reason: string;
    hma5: number;
    hma40: number;
    suggestedStake: number;
    suggestedDuration: number;
    suggestedDurationUnit: 't' | 's' | 'm';
    // Long-term trend alignment fields
    longTermTrend?: 'bullish' | 'bearish' | 'neutral';
    longTermStrength?: number;
    trendAlignment?: boolean;
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
            .slice(0, count)
            .map(opp => this.convertToTradingRecommendation(opp));
    }

    /**
     * Convert market scan result to trading recommendation
     */
    private convertToTradingRecommendation(scanResult: MarketScanResult): TradingRecommendation {
        const { trend } = scanResult;

        // Determine direction based on recommendation and quality
        let direction: 'CALL' | 'PUT' | 'HOLD' = 'HOLD';
        
        if (trend.recommendation === 'BUY' && trend.score >= 70 && trend.confidence >= 65) {
            direction = 'CALL';
        } else if (trend.recommendation === 'SELL' && trend.score >= 70 && trend.confidence >= 65) {
            direction = 'PUT';
        }

        // Generate reason based on direction
        const reason = this.generateQualityBasedReason(trend, direction);

        // Suggest optimal trading parameters
        const suggestedStake = direction === 'HOLD' ? 0 : this.calculateOptimalStake(trend.confidence, trend.strength);
        const { duration, durationUnit } = this.calculateOptimalDuration(trend.strength, scanResult.symbol);

        return {
            symbol: scanResult.symbol,
            displayName: scanResult.displayName,
            direction,
            confidence: trend.confidence,
            score: trend.score,
            reason,
            hma5: trend.hma5 || 0,
            hma40: trend.hma40 || 0,
            currentPrice: trend.price || 0,
            trendStrength: trend.strength,
            suggestedStake,
            suggestedDuration: duration,
            suggestedDurationUnit: durationUnit,
            // Long-term trend alignment fields
            longTermTrend: trend.longTermTrend,
            longTermStrength: trend.longTermTrendStrength,
            trendAlignment: trend.colorAlignment === true // Assuming colorAlignment implies trend alignment for this context
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
        if (trend.cycleTrading?.suitable) {
            reasons.push('Ranging Market - Ideal for Mean Reversion');
        }

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
     * Generate quality-based recommendation reason
     */
    private generateQualityBasedReason(trend: TrendAnalysis, direction: 'CALL' | 'PUT' | 'HOLD'): string {
        if (direction === 'HOLD') {
            const reasons: string[] = ['⚠️ HOLD - Poor Trading Conditions'];
            
            if (trend.score < 70) {
                reasons.push(`Low Signal Quality (${trend.score.toFixed(1)}%)`);
            }
            if (trend.confidence < 65) {
                reasons.push(`Low Confidence (${trend.confidence.toFixed(1)}%)`);
            }
            if (trend.longTermTrendStrength !== undefined && trend.longTermTrendStrength < 60) {
                reasons.push(`Weak Trend Alignment (${trend.longTermTrendStrength.toFixed(1)}%)`);
            }
            if (trend.cycleTrading && !trend.cycleTrading.suitable) {
                reasons.push('Poor Cycle Conditions');
            }
            if (trend.ehlers && trend.ehlers.snr < 3) {
                reasons.push(`Low Signal-to-Noise Ratio (${trend.ehlers.snr.toFixed(1)}dB)`);
            }
            
            return reasons.join(' | ');
        }
        
        // For BUY/SELL recommendations, use mean reversion logic
        return this.generateMeanReversionReason(trend);
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

        // Add cycle trading suitability
        if (trend.cycleTrading?.suitable) {
            reasons.push('✅ Good cycle conditions');
        } else if (trend.cycleTrading) {
            reasons.push(`⚠️ ${trend.cycleTrading.reason}`);
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
            if (trend) { // Accept all trends, including HOLD
                // Determine direction including HOLD for poor conditions
                let direction: 'CALL' | 'PUT' | 'HOLD' = 'HOLD';
                
                if (trend.recommendation === 'BUY' && trend.score >= 70 && trend.confidence >= 65) {
                    direction = 'CALL';
                } else if (trend.recommendation === 'SELL' && trend.score >= 70 && trend.confidence >= 65) {
                    direction = 'PUT';
                } else {
                    // Poor quality conditions - recommend HOLD
                    direction = 'HOLD';
                }

                const recommendation: TradingRecommendation = {
                    symbol,
                    displayName: symbolInfo.display_name,
                    direction,
                    confidence: trend.confidence,
                    score: trend.score,
                    reason: this.generateQualityBasedReason(trend, direction),
                    timestamp: now,
                    currentPrice: trend.price || 0,
                    suggestedStake: direction === 'HOLD' ? 0 : this.calculateOptimalStake(trend.confidence, trend.strength),
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
     * Generate trading recommendations based on trend analysis with ultra-strict long-term alignment
     */
    private generateRecommendations(): TradingRecommendation[] {
        const recommendations: TradingRecommendation[] = [];

        VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const trend = this.trendAnalysisEngine.getTrendAnalysis(symbolInfo.symbol);
            if (!trend || trend.recommendation === 'HOLD') return;

            // ULTRA-STRICT filtering for maximum long-term alignment

            // 1. Require VERY high score and confidence
            if (trend.score < 85 || trend.confidence < 80) return; // Increased thresholds

            // 2. Require VERY strong long-term trend alignment
            if (!trend.longTermTrendStrength || trend.longTermTrendStrength < 75) return; // Increased from 60

            // 3. Ensure short-term and long-term trends align perfectly
            const shortTermDirection = trend.direction;
            const longTermDirection = trend.longTermTrend;
            if (shortTermDirection !== longTermDirection || longTermDirection === 'neutral') return;

            // 4. Require PERFECT color alignment for HMA consistency
            if (trend.colorAlignment !== true) return;

            // 5. Only allow STRONG trends (no moderate or weak)
            if (trend.strength !== 'strong') return; // Only strong trends allowed

            // 6. Stricter Ehlers signal quality requirements
            if (trend.ehlers && trend.ehlers.snr < 6) return; // Increased from 3 to 6 dB

            // 7. Additional validation: require very recent signal confirmation
            const signalAge = Date.now() - trend.lastUpdate.getTime();
            if (signalAge > 2 * 60 * 1000) return; // Signal must be less than 2 minutes old

            // 8. Ensure HMA slopes are significantly strong
            if (trend.hma5Slope && Math.abs(trend.hma5Slope) < 0.0005) return; // Require meaningful slope
            if (trend.hma200Slope && Math.abs(trend.hma200Slope) < 0.0002) return; // Require meaningful long-term slope

            const recommendation: TradingRecommendation = {
                symbol: symbolInfo.symbol,
                displayName: symbolInfo.display_name,
                direction: trend.recommendation === 'BUY' ? 'CALL' : 'PUT', // Keep mapping same (BUY->CALL, SELL->PUT)
                confidence: trend.confidence,
                score: trend.score,
                currentPrice: trend.price || 0,
                reason: this.generateMeanReversionReason(trend),
                timestamp: Date.now(),
                suggestedStake: this.calculateSuggestedStake(trend),
                suggestedDuration: this.calculateMeanReversionDuration(trend), // Shorter duration for mean reversion
                suggestedDurationUnit: 's',
                // Mean reversion metadata
                longTermTrend: longTermDirection,
                longTermStrength: trend.longTermTrendStrength,
                trendAlignment: true
            };

            recommendations.push(recommendation);
        });

        // Sort by combined score with heavy weighting on long-term alignment
        return recommendations
            .sort((a, b) => {
                // Heavy weighting on long-term strength (50% vs previous 20%)
                const scoreA = a.score + (a.longTermStrength || 0) * 0.5;
                const scoreB = b.score + (b.longTermStrength || 0) * 0.5;
                return scoreB - scoreA;
            })
            .slice(0, Math.min(3, recommendations.length)); // Reduced from 5 to 3 for highest quality only
    }

    // Placeholder methods - these should be implemented based on your logic for calculating stake and duration
    private calculateSuggestedStake(trend: TrendAnalysis): number {
        return this.calculateOptimalStake(trend.confidence, trend.strength);
    }

    private calculateSuggestedDuration(trend: TrendAnalysis): number {
        const { duration } = this.calculateOptimalDuration(trend.strength, trend.symbol);
        return duration;
    }
}

// Create singleton instance
export const marketScanner = new MarketScanner();