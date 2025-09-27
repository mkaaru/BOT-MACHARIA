
export interface TickData {
    symbol: string;
    epoch: number;
    quote: number;
    volume?: number;
}

export interface TickCandleData {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    startEpoch: number;
    endEpoch: number;
    startTimestamp: Date;
    endTimestamp: Date;
    tickCount: number;
    totalVolume: number;
    candleNumber: number; // Sequential candle number for this symbol
}

interface TickCandleBuffer {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    startEpoch: number;
    endEpoch: number;
    tickCount: number;
    totalVolume: number;
    candleNumber: number;
}

export class TickBasedCandleEngine {
    private candleBuffers: Map<string, TickCandleBuffer> = new Map();
    private completedCandles: Map<string, TickCandleData[]> = new Map();
    private candleCallbacks: Map<string, Set<(candle: TickCandleData) => void>> = new Map();
    private candleCounters: Map<string, number> = new Map(); // Track candle numbers per symbol
    
    private readonly TICKS_PER_CANDLE: number;
    private readonly MAX_CANDLES_PER_SYMBOL = 1000;

    constructor(ticksPerCandle: number = 5) {
        this.TICKS_PER_CANDLE = ticksPerCandle;
        console.log(`🎯 TickBasedCandleEngine initialized with ${ticksPerCandle} ticks per candle`);
    }

    processTick(tick: TickData): void {
        const { symbol, epoch, quote, volume = 1 } = tick;
        
        // Validate tick data
        if (!this.isValidTick(tick)) {
            console.warn(`⚠️ Invalid tick data for ${symbol}:`, tick);
            return;
        }

        let buffer = this.candleBuffers.get(symbol);

        // Create new buffer if none exists
        if (!buffer) {
            buffer = this.createNewBuffer(symbol, tick);
            this.candleBuffers.set(symbol, buffer);
        } else {
            // Update existing buffer
            this.updateBuffer(buffer, tick);
        }

        // Check if candle should be completed
        if (buffer.tickCount >= this.TICKS_PER_CANDLE) {
            this.completeCandle(buffer);
            // Start new candle immediately with next tick
            if (buffer.tickCount > this.TICKS_PER_CANDLE) {
                // This shouldn't happen with proper logic, but handle overflow
                const newBuffer = this.createNewBuffer(symbol, tick, true);
                this.candleBuffers.set(symbol, newBuffer);
            } else {
                // Remove completed buffer, next tick will create new one
                this.candleBuffers.delete(symbol);
            }
        }
    }

    private createNewBuffer(symbol: string, tick: TickData, isNewCandle: boolean = false): TickCandleBuffer {
        const candleNumber = isNewCandle 
            ? (this.candleCounters.get(symbol) || 0) + 1
            : (this.candleCounters.get(symbol) || 0) + 1;
        
        this.candleCounters.set(symbol, candleNumber);

        return {
            symbol,
            open: tick.quote,
            high: tick.quote,
            low: tick.quote,
            close: tick.quote,
            startEpoch: tick.epoch,
            endEpoch: tick.epoch,
            tickCount: 1,
            totalVolume: tick.volume || 1,
            candleNumber
        };
    }

    private updateBuffer(buffer: TickCandleBuffer, tick: TickData): void {
        buffer.high = Math.max(buffer.high, tick.quote);
        buffer.low = Math.min(buffer.low, tick.quote);
        buffer.close = tick.quote;
        buffer.endEpoch = tick.epoch;
        buffer.tickCount++;
        buffer.totalVolume += (tick.volume || 1);
    }

    private completeCandle(buffer: TickCandleBuffer): void {
        const candle: TickCandleData = {
            symbol: buffer.symbol,
            open: buffer.open,
            high: buffer.high,
            low: buffer.low,
            close: buffer.close,
            startEpoch: buffer.startEpoch,
            endEpoch: buffer.endEpoch,
            startTimestamp: new Date(buffer.startEpoch * 1000),
            endTimestamp: new Date(buffer.endEpoch * 1000),
            tickCount: buffer.tickCount,
            totalVolume: buffer.totalVolume,
            candleNumber: buffer.candleNumber
        };

        // Store completed candle
        if (!this.completedCandles.has(buffer.symbol)) {
            this.completedCandles.set(buffer.symbol, []);
        }

        const candles = this.completedCandles.get(buffer.symbol)!;
        candles.push(candle);

        // Maintain memory limits
        if (candles.length > this.MAX_CANDLES_PER_SYMBOL) {
            candles.shift();
        }

        // Notify callbacks
        this.notifyCandleCallbacks(candle);

        const duration = (candle.endEpoch - candle.startEpoch).toFixed(1);
        const priceChange = ((candle.close - candle.open) / candle.open * 100).toFixed(4);
        console.log(`📊 Completed ${this.TICKS_PER_CANDLE}-tick candle #${candle.candleNumber} for ${buffer.symbol}: ` +
                   `OHLC(${candle.open.toFixed(5)}, ${candle.high.toFixed(5)}, ${candle.low.toFixed(5)}, ${candle.close.toFixed(5)}) ` +
                   `Change: ${priceChange}%, Duration: ${duration}s, Volume: ${candle.totalVolume}`);
    }

    private isValidTick(tick: TickData): boolean {
        return !!(tick.symbol && 
               typeof tick.epoch === 'number' && 
               typeof tick.quote === 'number' && 
               tick.quote > 0 &&
               tick.epoch > 0);
    }

    private notifyCandleCallbacks(candle: TickCandleData): void {
        const callbacks = this.candleCallbacks.get(candle.symbol);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(candle);
                } catch (error) {
                    console.error(`❌ Error in tick-candle callback for ${candle.symbol}:`, error);
                }
            });
        }
    }

    // Public API methods
    subscribeToCandles(symbol: string, callback: (candle: TickCandleData) => void): void {
        if (!this.candleCallbacks.has(symbol)) {
            this.candleCallbacks.set(symbol, new Set());
        }
        this.candleCallbacks.get(symbol)!.add(callback);
        console.log(`🔔 Subscribed to ${this.TICKS_PER_CANDLE}-tick candles for ${symbol}`);
    }

    unsubscribeFromCandles(symbol: string, callback: (candle: TickCandleData) => void): void {
        const callbacks = this.candleCallbacks.get(symbol);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.candleCallbacks.delete(symbol);
            }
        }
    }

    getCompletedCandles(symbol: string, count?: number): TickCandleData[] {
        const candles = this.completedCandles.get(symbol) || [];
        if (count && count > 0) {
            return candles.slice(-count);
        }
        return [...candles];
    }

    getCurrentBuffer(symbol: string): TickCandleBuffer | undefined {
        return this.candleBuffers.get(symbol);
    }

    // Force complete current candle (useful for end of session)
    forceCompleteCandle(symbol: string): TickCandleData | null {
        const buffer = this.candleBuffers.get(symbol);
        if (buffer && buffer.tickCount > 0) {
            console.log(`🔧 Force completing ${symbol} candle with ${buffer.tickCount} ticks`);
            this.completeCandle(buffer);
            this.candleBuffers.delete(symbol);
            const candles = this.completedCandles.get(symbol);
            return candles ? candles[candles.length - 1] : null;
        }
        return null;
    }

    // Get candle statistics
    getCandleStats(symbol: string): {
        totalCandles: number;
        currentTicks: number;
        ticksUntilNextCandle: number;
        averageCandleDuration: number;
    } {
        const completedCandles = this.completedCandles.get(symbol) || [];
        const currentBuffer = this.candleBuffers.get(symbol);
        
        // Calculate average candle duration
        let averageDuration = 0;
        if (completedCandles.length > 0) {
            const totalDuration = completedCandles.reduce((sum, candle) => 
                sum + (candle.endEpoch - candle.startEpoch), 0);
            averageDuration = totalDuration / completedCandles.length;
        }
        
        return {
            totalCandles: completedCandles.length,
            currentTicks: currentBuffer?.tickCount || 0,
            ticksUntilNextCandle: currentBuffer 
                ? this.TICKS_PER_CANDLE - currentBuffer.tickCount 
                : this.TICKS_PER_CANDLE,
            averageCandleDuration: averageDuration
        };
    }

    // Process multiple ticks in batch
    processBatchTicks(ticks: TickData[]): Map<string, number> {
        const completedCandlesCount = new Map<string, number>();
        
        // Sort by epoch to ensure chronological order
        const sortedTicks = ticks.sort((a, b) => a.epoch - b.epoch);
        
        sortedTicks.forEach(tick => {
            const beforeCount = this.completedCandles.get(tick.symbol)?.length || 0;
            this.processTick(tick);
            const afterCount = this.completedCandles.get(tick.symbol)?.length || 0;
            
            if (afterCount > beforeCount) {
                completedCandlesCount.set(tick.symbol, 
                    (completedCandlesCount.get(tick.symbol) || 0) + (afterCount - beforeCount));
            }
        });
        
        return completedCandlesCount;
    }

    // Clear data for symbol
    clearSymbolData(symbol: string): void {
        this.candleBuffers.delete(symbol);
        this.completedCandles.delete(symbol);
        this.candleCallbacks.delete(symbol);
        this.candleCounters.delete(symbol);
        console.log(`🧹 Cleared all data for ${symbol}`);
    }

    // Get all active symbols
    getActiveSymbols(): string[] {
        return Array.from(new Set([
            ...this.candleBuffers.keys(),
            ...this.completedCandles.keys()
        ]));
    }

    // Get comprehensive system stats
    getSystemStats(): {
        activeBuffers: number;
        totalCompletedCandles: number;
        symbolsWithData: number;
        ticksPerCandle: number;
        memoryUsage: {
            buffersCount: number;
            candlesCount: number;
            callbacksCount: number;
        };
    } {
        let totalCandles = 0;
        this.completedCandles.forEach(candles => {
            totalCandles += candles.length;
        });

        let totalCallbacks = 0;
        this.candleCallbacks.forEach(callbacks => {
            totalCallbacks += callbacks.size;
        });

        return {
            activeBuffers: this.candleBuffers.size,
            totalCompletedCandles: totalCandles,
            symbolsWithData: this.getActiveSymbols().length,
            ticksPerCandle: this.TICKS_PER_CANDLE,
            memoryUsage: {
                buffersCount: this.candleBuffers.size,
                candlesCount: totalCandles,
                callbacksCount: totalCallbacks
            }
        };
    }

    // Cleanup method
    destroy(): void {
        // Force complete any pending candles
        this.candleBuffers.forEach((buffer, symbol) => {
            if (buffer.tickCount > 0) {
                console.log(`🔚 Final completion of ${symbol} with ${buffer.tickCount} ticks`);
                this.completeCandle(buffer);
            }
        });

        // Clear all data
        this.candleBuffers.clear();
        this.completedCandles.clear();
        this.candleCallbacks.clear();
        this.candleCounters.clear();
        
        console.log('🚀 TickBasedCandleEngine destroyed and cleaned up');
    }
}

// Create configurable instances
export const tickBasedCandleEngine5 = new TickBasedCandleEngine(5);
export const tickBasedCandleEngine1 = new TickBasedCandleEngine(1);
