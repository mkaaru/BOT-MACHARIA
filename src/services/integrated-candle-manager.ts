
import { CandleData, candleReconstructionEngine } from './candle-reconstruction-engine';
import { TickBasedCandleEngine, TickCandleData, TickData } from './tick-based-candle-engine';
import { TrendAnalysisEngine } from './trend-analysis-engine';

export interface CandleManagerConfig {
    useTimeBased: boolean;
    useTickBased: boolean;
    ticksPerCandle: number;
    enableROCAnalysis: boolean;
    rocPeriods: {
        fast: number;
        slow: number;
    };
}

export class IntegratedCandleManager {
    private trendAnalysisEngine: TrendAnalysisEngine;
    private tickBasedEngine: TickBasedCandleEngine;
    private config: CandleManagerConfig;
    private activeSymbols: Set<string> = new Set();

    constructor(config: CandleManagerConfig) {
        this.config = config;
        this.trendAnalysisEngine = new TrendAnalysisEngine();
        this.tickBasedEngine = new TickBasedCandleEngine(config.ticksPerCandle);

        this.initializeEngines();
        console.log(`🎛️ IntegratedCandleManager initialized with config:`, config);
    }

    private initializeEngines(): void {
        // Set up time-based candle callbacks if enabled
        if (this.config.useTimeBased) {
            this.setupTimeBased Callbacks();
        }

        // Set up tick-based candle callbacks if enabled
        if (this.config.useTickBased) {
            this.setupTickBasedCallbacks();
        }
    }

    private setupTimeBasedCallbacks(): void {
        // This would be set up per symbol when symbols are registered
        console.log('⏰ Time-based candle processing enabled');
    }

    private setupTickBasedCallbacks(): void {
        console.log(`🎯 Tick-based candle processing enabled (${this.config.ticksPerCandle} ticks per candle)`);
    }

    /**
     * Register a symbol for candle processing
     */
    registerSymbol(symbol: string): void {
        if (this.activeSymbols.has(symbol)) {
            console.log(`⚠️ Symbol ${symbol} already registered`);
            return;
        }

        this.activeSymbols.add(symbol);

        // Set up time-based candle callback
        if (this.config.useTimeBased) {
            const timeCandleCallback = (candle: CandleData) => {
                if (this.config.enableROCAnalysis) {
                    this.trendAnalysisEngine.addCandleData(candle);
                }
                console.log(`⏰ Time-candle processed for ${symbol}: ${candle.close.toFixed(5)}`);
            };

            candleReconstructionEngine.addCandleCallback(symbol, timeCandleCallback);
        }

        // Set up tick-based candle callback
        if (this.config.useTickBased) {
            const tickCandleCallback = (candle: TickCandleData) => {
                if (this.config.enableROCAnalysis) {
                    this.trendAnalysisEngine.addTickCandleData(candle);
                }
                console.log(`🎯 Tick-candle processed for ${symbol}: ${candle.close.toFixed(5)} (${candle.tickCount} ticks)`);
            };

            this.tickBasedEngine.subscribeToCandles(symbol, tickCandleCallback);
        }

        console.log(`✅ Registered ${symbol} for candle processing`);
    }

    /**
     * Process incoming tick data
     */
    processTick(tick: TickData): void {
        // Process through time-based engine
        if (this.config.useTimeBased) {
            candleReconstructionEngine.processTick(tick);
        }

        // Process through tick-based engine
        if (this.config.useTickBased) {
            this.tickBasedEngine.processTick(tick);
        }
    }

    /**
     * Get trend analysis for a symbol
     */
    getTrendAnalysis(symbol: string) {
        if (!this.config.enableROCAnalysis) {
            console.warn(`ROC analysis not enabled for ${symbol}`);
            return null;
        }

        return this.trendAnalysisEngine.getTrendAnalysis(symbol);
    }

    /**
     * Get time-based candles for a symbol
     */
    getTimeBasedCandles(symbol: string, count?: number): CandleData[] {
        if (!this.config.useTimeBased) {
            return [];
        }
        return candleReconstructionEngine.getCandles(symbol, count);
    }

    /**
     * Get tick-based candles for a symbol
     */
    getTickBasedCandles(symbol: string, count?: number): TickCandleData[] {
        if (!this.config.useTickBased) {
            return [];
        }
        return this.tickBasedEngine.getCompletedCandles(symbol, count);
    }

    /**
     * Get candle statistics for a symbol
     */
    getCandleStatistics(symbol: string): {
        timeBased?: any;
        tickBased?: any;
        trendAnalysis?: any;
    } {
        const stats: any = {};

        if (this.config.useTimeBased) {
            const timeCandles = this.getTimeBasedCandles(symbol);
            stats.timeBased = {
                totalCandles: timeCandles.length,
                latestPrice: timeCandles.length > 0 ? timeCandles[timeCandles.length - 1].close : null,
                hasData: candleReconstructionEngine.hasData(symbol)
            };
        }

        if (this.config.useTickBased) {
            stats.tickBased = this.tickBasedEngine.getCandleStats(symbol);
        }

        if (this.config.enableROCAnalysis) {
            stats.trendAnalysis = this.getTrendAnalysis(symbol);
        }

        return stats;
    }

    /**
     * Force complete all pending candles for a symbol
     */
    forceCompleteCandles(symbol: string): void {
        console.log(`🔧 Force completing candles for ${symbol}`);

        if (this.config.useTimeBased) {
            candleReconstructionEngine.flushCurrentCandles();
        }

        if (this.config.useTickBased) {
            this.tickBasedEngine.forceCompleteCandle(symbol);
        }
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<CandleManagerConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Reinitialize if tick count changed
        if (newConfig.ticksPerCandle && newConfig.ticksPerCandle !== this.tickBasedEngine['TICKS_PER_CANDLE']) {
            this.tickBasedEngine = new TickBasedCandleEngine(newConfig.ticksPerCandle);
            
            // Re-register all active symbols
            const symbols = Array.from(this.activeSymbols);
            this.activeSymbols.clear();
            symbols.forEach(symbol => this.registerSymbol(symbol));
        }

        console.log(`🔄 Configuration updated:`, this.config);
    }

    /**
     * Get system overview
     */
    getSystemOverview(): {
        config: CandleManagerConfig;
        activeSymbols: string[];
        timeBasedStats?: any;
        tickBasedStats?: any;
    } {
        const overview: any = {
            config: this.config,
            activeSymbols: Array.from(this.activeSymbols)
        };

        if (this.config.useTimeBased) {
            overview.timeBasedStats = candleReconstructionEngine.getStats();
        }

        if (this.config.useTickBased) {
            overview.tickBasedStats = this.tickBasedEngine.getSystemStats();
        }

        return overview;
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.activeSymbols.clear();
        
        if (this.config.useTickBased) {
            this.tickBasedEngine.destroy();
        }

        console.log('🧹 IntegratedCandleManager destroyed');
    }
}

// Create default configurations
export const defaultConfig: CandleManagerConfig = {
    useTimeBased: true,
    useTickBased: true,
    ticksPerCandle: 20,
    enableROCAnalysis: true,
    rocPeriods: {
        fast: 1,
        slow: 5
    }
};

// Create singleton instance
export const integratedCandleManager = new IntegratedCandleManager(defaultConfig);
