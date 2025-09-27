
import { TickFlowIntegration } from './tick-flow-integration';
import { TickData } from './tick-based-candle-engine';

/**
 * Test script demonstrating the complete tick flow:
 * Raw Ticks → TickBasedCandleEngine → N-tick Candles → TrendAnalysisEngine
 */
export class TickFlowTest {
  private tickFlow: TickFlowIntegration;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(ticksPerCandle: number = 5) {
    this.tickFlow = new TickFlowIntegration({
      ticksPerCandle,
      enableLogging: true,
      bufferSize: 1000
    });

    // Set up callbacks to monitor the flow
    this.tickFlow.setCallbacks({
      onTickProcessed: (tick) => {
        console.log(`✅ Tick processed: ${tick.symbol} @ ${tick.quote.toFixed(5)}`);
      },
      onCandleCompleted: (candle) => {
        console.log(`🕯️ Candle #${candle.candleNumber} completed: ${candle.symbol} OHLC(${candle.open.toFixed(5)}, ${candle.high.toFixed(5)}, ${candle.low.toFixed(5)}, ${candle.close.toFixed(5)})`);
      },
      onTrendAnalysisUpdated: (analysis) => {
        console.log(`📈 Trend updated: ${analysis.symbol} - ${analysis.direction} (${analysis.confidence.toFixed(1)}%) - ${analysis.recommendation}`);
        console.log(`   Fast ROC: ${analysis.fastROC.toFixed(4)}%, Slow ROC: ${analysis.slowROC.toFixed(4)}%`);
        console.log(`   Reason: ${analysis.reason}`);
      },
      onError: (error) => {
        console.error(`❌ Flow error:`, error);
      }
    });
  }

  /**
   * Start the test with simulated market data
   */
  startTest(symbol: string = '1HZ100V', intervalMs: number = 500): void {
    if (this.isRunning) {
      console.log('⚠️ Test already running');
      return;
    }

    console.log(`🚀 Starting tick flow test for ${symbol} (interval: ${intervalMs}ms)`);
    
    this.isRunning = true;
    this.tickFlow.registerSymbol(symbol);

    let tickCount = 0;
    let basePrice = 100;
    
    this.intervalId = setInterval(() => {
      // Generate realistic price movement
      const volatility = 0.001;
      const trend = Math.sin(tickCount * 0.05) * 0.002; // Slow trend component
      const randomWalk = (Math.random() - 0.5) * volatility; // Random component
      const newPrice = basePrice + trend + randomWalk;
      
      // Create tick data
      const tick: TickData = {
        symbol,
        epoch: Math.floor(Date.now() / 1000),
        quote: newPrice,
        volume: Math.floor(Math.random() * 100) + 1
      };

      // Process through the complete flow
      this.tickFlow.processTick(tick);
      
      basePrice = newPrice; // Update base price for next tick
      tickCount++;

      // Print stats every 10 ticks
      if (tickCount % 10 === 0) {
        this.printStats();
      }

    }, intervalMs);

    console.log(`✅ Test started. Processing ticks every ${intervalMs}ms...`);
  }

  /**
   * Stop the test
   */
  stopTest(): void {
    if (!this.isRunning) {
      console.log('⚠️ Test not running');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    
    // Force complete any pending candles
    this.tickFlow.forceCompletePendingCandles();
    
    console.log('🛑 Test stopped');
    this.printFinalStats();
  }

  /**
   * Run a batch test with pre-generated data
   */
  runBatchTest(symbol: string = '1HZ100V', tickCount: number = 50): void {
    console.log(`🔄 Running batch test with ${tickCount} ticks for ${symbol}`);
    
    this.tickFlow.registerSymbol(symbol);
    
    const ticks: TickData[] = [];
    let basePrice = 100;
    const baseTime = Math.floor(Date.now() / 1000);
    
    // Generate batch of ticks
    for (let i = 0; i < tickCount; i++) {
      const volatility = 0.001;
      const trend = Math.sin(i * 0.1) * 0.003;
      const randomWalk = (Math.random() - 0.5) * volatility;
      basePrice += trend + randomWalk;
      
      ticks.push({
        symbol,
        epoch: baseTime + i,
        quote: basePrice,
        volume: Math.floor(Math.random() * 100) + 1
      });
    }
    
    // Process batch
    this.tickFlow.processBatchTicks(ticks);
    
    console.log('✅ Batch test completed');
    this.printFinalStats();
  }

  /**
   * Print current statistics
   */
  printStats(): void {
    const stats = this.tickFlow.getStats();
    console.log(`📊 Stats: ${stats.totalTicksProcessed} ticks → ${stats.totalCandlesGenerated} candles | Avg processing: ${stats.averageProcessingTime.toFixed(2)}ms`);
  }

  /**
   * Print detailed final statistics
   */
  printFinalStats(): void {
    const systemOverview = this.tickFlow.getSystemOverview();
    
    console.log('\n📈 FINAL STATISTICS:');
    console.log('==================');
    console.log(`Total Ticks Processed: ${systemOverview.stats.totalTicksProcessed}`);
    console.log(`Total Candles Generated: ${systemOverview.stats.totalCandlesGenerated}`);
    console.log(`Active Symbols: ${systemOverview.activeSymbols.join(', ')}`);
    console.log(`Average Processing Time: ${systemOverview.stats.averageProcessingTime.toFixed(3)}ms`);
    
    console.log('\n🧠 TREND ANALYSES:');
    console.log('==================');
    systemOverview.trendAnalyses.forEach(analysis => {
      console.log(`${analysis.symbol}:`);
      console.log(`  Direction: ${analysis.direction} (${analysis.strength})`);
      console.log(`  Confidence: ${analysis.confidence.toFixed(1)}%`);
      console.log(`  Recommendation: ${analysis.recommendation}`);
      console.log(`  Fast ROC: ${analysis.fastROC.toFixed(4)}%`);
      console.log(`  Slow ROC: ${analysis.slowROC.toFixed(4)}%`);
      console.log(`  Reason: ${analysis.reason}`);
      console.log('');
    });
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopTest();
    this.tickFlow.destroy();
    console.log('🧹 Test cleanup completed');
  }
}

// Export convenience functions for easy testing
export const runTickFlowTest = (symbol?: string, intervalMs?: number) => {
  const test = new TickFlowTest();
  test.startTest(symbol, intervalMs);
  
  // Auto-stop after 30 seconds
  setTimeout(() => {
    test.stopTest();
    test.destroy();
  }, 30000);
  
  return test;
};

export const runBatchTickFlowTest = (symbol?: string, tickCount?: number) => {
  const test = new TickFlowTest();
  test.runBatchTest(symbol, tickCount);
  test.destroy();
  return test;
};

// Example usage in console:
// import { runTickFlowTest, runBatchTickFlowTest } from './services/tick-flow-test';
// runTickFlowTest('1HZ100V', 1000); // Start live test
// runBatchTickFlowTest('1HZ100V', 100); // Run batch test
