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
    reason: string;
    hma5: number;
    hma40: number;
    currentPrice: number;
    trendStrength: string;
    suggestedStake: number;
    suggestedDuration: number;
    suggestedDurationUnit: 't' | 's' | 'm';
}

export class MarketScanner {
    private trendAnalysisEngine: TrendAnalysisEngine;
    private isInitialized: boolean = false;
    private scannerStatus: ScannerStatus;
    private tickCallbacks: Map<string, (tick: TickData) => void> = new Map();
    private candleCallbacks: Map<string, (candle: CandleData) => void> = new Map();
    private statusCallbacks: Set<(status: ScannerStatus) => void> = new Set();
    private recommendationCallbacks: Set<(recommendations: TradingRecommendation[]) => void> = new Set();

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
        };
    }

    /**
     * Generate recommendation reason
     */
    private generateRecommendationReason(trend: TrendAnalysis): string {
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
        if (!this.isInitialized) return;
        
        try {
            const recommendations = this.getTradingRecommendations();
            this.notifyRecommendationChange(recommendations);
        } catch (error) {
            console.error('Error updating recommendations:', error);
            this.addError(`Recommendation update error: ${error}`);
        }
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
}

// Create singleton instance
export const marketScanner = new MarketScanner();