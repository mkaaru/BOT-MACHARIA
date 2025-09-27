
import { TickBasedCandleEngine, TickData, TickCandleData } from './tick-based-candle-engine';
import { TrendAnalysisEngine, TrendAnalysis } from './trend-analysis-engine';

export interface TickFlowConfig {
  ticksPerCandle: number;
  enableLogging: boolean;
  bufferSize: number;
}

export interface TickFlowStats {
  totalTicksProcessed: number;
  totalCandlesGenerated: number;
  activeSymbols: string[];
  averageProcessingTime: number;
  lastUpdate: Date;
}

export interface TickFlowCallback {
  onTickProcessed?: (tick: TickData) => void;
  onCandleCompleted?: (candle: TickCandleData) => void;
  onTrendAnalysisUpdated?: (analysis: TrendAnalysis) => void;
  onError?: (error: Error) => void;
}

export class TickFlowIntegration {
  private tickEngine: TickBasedCandleEngine;
  private trendEngine: TrendAnalysisEngine;
  private config: TickFlowConfig;
  private callbacks: TickFlowCallback = {};
  private stats: TickFlowStats;
  private processingTimes: number[] = [];
  private activeSymbols: Set<string> = new Set();

  constructor(config: TickFlowConfig = { ticksPerCandle: 5, enableLogging: true, bufferSize: 1000 }) {
    this.config = config;
    
    // Initialize engines
    this.tickEngine = new TickBasedCandleEngine(config.ticksPerCandle);
    this.trendEngine = new TrendAnalysisEngine();
    
    // Initialize stats
    this.stats = {
      totalTicksProcessed: 0,
      totalCandlesGenerated: 0,
      activeSymbols: [],
      averageProcessingTime: 0,
      lastUpdate: new Date()
    };

    this.log('🚀 TickFlowIntegration initialized with configuration:', config);
  }

  /**
   * Register callbacks for flow events
   */
  setCallbacks(callbacks: TickFlowCallback): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
    this.log('📝 Callbacks registered');
  }

  /**
   * Register a symbol for processing
   */
  registerSymbol(symbol: string): void {
    if (this.activeSymbols.has(symbol)) {
      this.log(`⚠️ Symbol ${symbol} already registered`);
      return;
    }

    this.activeSymbols.add(symbol);
    
    // Set up candle completion callback for this symbol
    this.tickEngine.subscribeToCandles(symbol, (candle: TickCandleData) => {
      this.handleCandleCompleted(candle);
    });

    this.log(`✅ Symbol ${symbol} registered for tick-based processing`);
    this.updateStats();
  }

  /**
   * Process a raw tick through the complete flow
   */
  processTick(tick: TickData): void {
    const startTime = performance.now();
    
    try {
      // Ensure symbol is registered
      if (!this.activeSymbols.has(tick.symbol)) {
        this.registerSymbol(tick.symbol);
      }

      // Process tick through tick-based candle engine
      this.tickEngine.processTick(tick);
      
      // Update processing stats
      const processingTime = performance.now() - startTime;
      this.updateProcessingStats(processingTime);
      
      // Trigger callback
      if (this.callbacks.onTickProcessed) {
        this.callbacks.onTickProcessed(tick);
      }

      this.log(`📊 Processed tick for ${tick.symbol}: ${tick.quote.toFixed(5)} at ${new Date(tick.epoch * 1000).toISOString()}`);

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Handle completed candle and send to trend analysis
   */
  private handleCandleCompleted(candle: TickCandleData): void {
    try {
      this.log(`🕯️ Candle completed for ${candle.symbol}: OHLC(${candle.open.toFixed(5)}, ${candle.high.toFixed(5)}, ${candle.low.toFixed(5)}, ${candle.close.toFixed(5)}) with ${candle.tickCount} ticks`);
      
      // Send candle to trend analysis engine
      this.trendEngine.addTickCandleData(candle);
      
      // Update stats
      this.stats.totalCandlesGenerated++;
      this.updateStats();
      
      // Get updated trend analysis
      const trendAnalysis = this.trendEngine.getTrendAnalysis(candle.symbol);
      
      if (trendAnalysis) {
        this.log(`📈 Trend analysis updated for ${candle.symbol}: ${trendAnalysis.direction} (${trendAnalysis.confidence.toFixed(1)}% confidence) - ${trendAnalysis.recommendation}`);
        
        // Trigger trend analysis callback
        if (this.callbacks.onTrendAnalysisUpdated) {
          this.callbacks.onTrendAnalysisUpdated(trendAnalysis);
        }
      }
      
      // Trigger candle completion callback
      if (this.callbacks.onCandleCompleted) {
        this.callbacks.onCandleCompleted(candle);
      }

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Process multiple ticks in batch
   */
  processBatchTicks(ticks: TickData[]): void {
    this.log(`🔄 Processing batch of ${ticks.length} ticks`);
    
    // Sort ticks by timestamp to ensure chronological order
    const sortedTicks = ticks.sort((a, b) => a.epoch - b.epoch);
    
    sortedTicks.forEach(tick => {
      this.processTick(tick);
    });
    
    this.log(`✅ Batch processing completed`);
  }

  /**
   * Get current processing statistics
   */
  getStats(): TickFlowStats {
    return { ...this.stats };
  }

  /**
   * Get trend analysis for a specific symbol
   */
  getTrendAnalysis(symbol: string): TrendAnalysis | null {
    return this.trendEngine.getTrendAnalysis(symbol);
  }

  /**
   * Get all trend analyses
   */
  getAllTrendAnalyses(): TrendAnalysis[] {
    return this.trendEngine.getAllTrendAnalyses();
  }

  /**
   * Get candle statistics for a symbol
   */
  getCandleStats(symbol: string) {
    return this.tickEngine.getCandleStats(symbol);
  }

  /**
   * Get completed candles for a symbol
   */
  getCompletedCandles(symbol: string, count?: number): TickCandleData[] {
    return this.tickEngine.getCompletedCandles(symbol, count);
  }

  /**
   * Get current buffer state for a symbol
   */
  getCurrentBuffer(symbol: string) {
    return this.tickEngine.getCurrentBuffer(symbol);
  }

  /**
   * Force complete any pending candles
   */
  forceCompletePendingCandles(symbol?: string): void {
    if (symbol) {
      this.tickEngine.forceCompleteCandle(symbol);
      this.log(`🔧 Forced completion of pending candle for ${symbol}`);
    } else {
      // Force complete for all symbols
      this.activeSymbols.forEach(sym => {
        this.tickEngine.forceCompleteCandle(sym);
      });
      this.log(`🔧 Forced completion of all pending candles`);
    }
  }

  /**
   * Update processing statistics
   */
  private updateProcessingStats(processingTime: number): void {
    this.stats.totalTicksProcessed++;
    this.stats.lastUpdate = new Date();
    
    // Track processing times for average calculation
    this.processingTimes.push(processingTime);
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift(); // Keep only last 100 measurements
    }
    
    // Calculate average processing time
    this.stats.averageProcessingTime = this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
  }

  /**
   * Update general statistics
   */
  private updateStats(): void {
    this.stats.activeSymbols = Array.from(this.activeSymbols);
    this.stats.lastUpdate = new Date();
  }

  /**
   * Handle errors in the flow
   */
  private handleError(error: Error): void {
    this.log(`❌ Error in tick flow: ${error.message}`);
    
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  /**
   * Logging utility
   */
  private log(message: string, data?: any): void {
    if (this.config.enableLogging) {
      const timestamp = new Date().toISOString();
      console.log(`[TickFlow ${timestamp}] ${message}`, data || '');
    }
  }

  /**
   * Get system overview
   */
  getSystemOverview() {
    return {
      config: this.config,
      stats: this.stats,
      tickEngineStats: this.tickEngine.getSystemStats(),
      activeSymbols: Array.from(this.activeSymbols),
      trendAnalyses: this.getAllTrendAnalyses()
    };
  }

  /**
   * Clear all data for a symbol
   */
  clearSymbolData(symbol: string): void {
    this.tickEngine.clearSymbolData(symbol);
    this.activeSymbols.delete(symbol);
    this.updateStats();
    this.log(`🧹 Cleared all data for ${symbol}`);
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    this.log('🧹 Destroying TickFlowIntegration...');
    
    // Force complete any pending candles
    this.forceCompletePendingCandles();
    
    // Destroy engines
    this.tickEngine.destroy();
    this.trendEngine.destroy();
    
    // Clear data
    this.activeSymbols.clear();
    this.processingTimes = [];
    
    this.log('✅ TickFlowIntegration destroyed');
  }
}

// Create a singleton instance for easy use
export const tickFlowIntegration = new TickFlowIntegration({
  ticksPerCandle: 5,
  enableLogging: true,
  bufferSize: 1000
});
