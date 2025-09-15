import { TickData, CandleData } from './tick-stream-manager';

export interface CandleBuffer {
    symbol: string;
    startTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    tickCount: number;
    lastUpdate: number;
}

export class CandleReconstructionEngine {
    private candleBuffers: Map<string, CandleBuffer> = new Map();
    private completedCandles: Map<string, CandleData[]> = new Map();
    private candleCallbacks: Map<string, Set<(candle: CandleData) => void>> = new Map();
    private readonly CANDLE_INTERVAL_MS = 60 * 1000; // 1 minute
    private readonly MAX_CANDLES_PER_SYMBOL = 100; // Keep last 100 candles per symbol
    private cleanupTimer: NodeJS.Timeout | null = null; // Store timer reference for proper cleanup

    constructor() {
        // Clean up old candle data periodically and store timer reference for cleanup
        this.cleanupTimer = setInterval(() => this.cleanupOldCandles(), 5 * 60 * 1000); // Every 5 minutes
    }

    processTick(tick: TickData): void {
        const { symbol, epoch, quote } = tick;
        const candleStartTime = this.getCandleStartTime(epoch);
        
        let buffer = this.candleBuffers.get(symbol);
        
        // If no buffer exists or we're in a new candle period
        if (!buffer || buffer.startTime !== candleStartTime) {
            // Complete the previous candle if it exists
            if (buffer && buffer.tickCount > 0) {
                this.completeCandle(buffer);
            }
            
            // Create new buffer for this candle period
            buffer = {
                symbol,
                startTime: candleStartTime,
                open: quote,
                high: quote,
                low: quote,
                close: quote,
                tickCount: 1,
                lastUpdate: epoch,
            };
            this.candleBuffers.set(symbol, buffer);
        } else {
            // Update existing buffer
            buffer.high = Math.max(buffer.high, quote);
            buffer.low = Math.min(buffer.low, quote);
            buffer.close = quote;
            buffer.tickCount++;
            buffer.lastUpdate = epoch;
        }
    }

    /**
     * Process historical ticks in batch for faster initialization
     */
    processHistoricalTicks(symbol: string, ticks: TickData[]): void {
        console.log(`Processing ${ticks.length} historical ticks for ${symbol}`);
        
        // Sort ticks by epoch to ensure proper chronological order
        const sortedTicks = ticks.sort((a, b) => a.epoch - b.epoch);
        
        // Process each tick
        sortedTicks.forEach(tick => {
            this.processTick(tick);
        });
        
        // Force completion of any remaining buffer
        const buffer = this.candleBuffers.get(symbol);
        if (buffer && buffer.tickCount > 0) {
            this.completeCandle(buffer);
        }
        
        console.log(`Completed processing historical ticks for ${symbol}, generated ${this.getCandles(symbol).length} candles`);
    }

    private getCandleStartTime(epoch: number): number {
        // Round down to the nearest minute
        return Math.floor(epoch / 60) * 60;
    }

    private completeCandle(buffer: CandleBuffer): void {
        const candle: CandleData = {
            symbol: buffer.symbol,
            open: buffer.open,
            high: buffer.high,
            low: buffer.low,
            close: buffer.close,
            epoch: buffer.startTime,
            timestamp: new Date(buffer.startTime * 1000),
        };

        // Store completed candle
        if (!this.completedCandles.has(buffer.symbol)) {
            this.completedCandles.set(buffer.symbol, []);
        }
        
        const candles = this.completedCandles.get(buffer.symbol)!;
        candles.push(candle);
        
        // Keep only the last MAX_CANDLES_PER_SYMBOL candles
        if (candles.length > this.MAX_CANDLES_PER_SYMBOL) {
            candles.shift();
        }

        // Notify callbacks
        this.notifyCandleCallbacks(candle);
        
        console.log(`Completed 1-min candle for ${buffer.symbol}: OHLC(${candle.open.toFixed(5)}, ${candle.high.toFixed(5)}, ${candle.low.toFixed(5)}, ${candle.close.toFixed(5)}) with ${buffer.tickCount} ticks`);
    }

    private notifyCandleCallbacks(candle: CandleData): void {
        const callbacks = this.candleCallbacks.get(candle.symbol);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(candle);
                } catch (error) {
                    console.error(`Error in candle callback for ${candle.symbol}:`, error);
                }
            });
        }
    }

    addCandleCallback(symbol: string, callback: (candle: CandleData) => void): void {
        if (!this.candleCallbacks.has(symbol)) {
            this.candleCallbacks.set(symbol, new Set());
        }
        this.candleCallbacks.get(symbol)!.add(callback);
    }

    removeCandleCallback(symbol: string, callback: (candle: CandleData) => void): void {
        const callbacks = this.candleCallbacks.get(symbol);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.candleCallbacks.delete(symbol);
            }
        }
    }

    getCandles(symbol: string, count?: number): CandleData[] {
        const candles = this.completedCandles.get(symbol) || [];
        if (count && count > 0) {
            return candles.slice(-count);
        }
        return [...candles];
    }

    getCurrentCandle(symbol: string): CandleBuffer | null {
        return this.candleBuffers.get(symbol) || null;
    }

    getLatestPrice(symbol: string): number | null {
        const buffer = this.candleBuffers.get(symbol);
        if (buffer) {
            return buffer.close;
        }
        
        const candles = this.completedCandles.get(symbol);
        if (candles && candles.length > 0) {
            return candles[candles.length - 1].close;
        }
        
        return null;
    }

    hasData(symbol: string): boolean {
        return this.candleBuffers.has(symbol) || 
               (this.completedCandles.has(symbol) && this.completedCandles.get(symbol)!.length > 0);
    }

    getSymbolsWithData(): string[] {
        const symbols = new Set<string>();
        this.candleBuffers.forEach((_, symbol) => symbols.add(symbol));
        this.completedCandles.forEach((candles, symbol) => {
            if (candles.length > 0) symbols.add(symbol);
        });
        return Array.from(symbols);
    }

    private cleanupOldCandles(): void {
        const oneHourAgo = Math.floor(Date.now() / 1000) - (60 * 60); // 1 hour ago
        
        this.completedCandles.forEach((candles, symbol) => {
            const filteredCandles = candles.filter(candle => candle.epoch > oneHourAgo);
            if (filteredCandles.length !== candles.length) {
                this.completedCandles.set(symbol, filteredCandles);
                console.log(`Cleaned up old candles for ${symbol}: ${candles.length - filteredCandles.length} removed`);
            }
        });

        // Clean up buffers for inactive symbols
        this.candleBuffers.forEach((buffer, symbol) => {
            if (buffer.lastUpdate < oneHourAgo) {
                this.candleBuffers.delete(symbol);
                console.log(`Removed inactive candle buffer for ${symbol}`);
            }
        });
    }

    // Force completion of current candles (useful for testing or when stopping)
    flushCurrentCandles(): void {
        this.candleBuffers.forEach(buffer => {
            if (buffer.tickCount > 0) {
                this.completeCandle(buffer);
            }
        });
        this.candleBuffers.clear();
    }

    // Get statistics about the reconstruction engine
    getStats(): {
        activeBuffers: number;
        totalCandles: number;
        symbolsWithData: number;
    } {
        let totalCandles = 0;
        this.completedCandles.forEach(candles => {
            totalCandles += candles.length;
        });

        return {
            activeBuffers: this.candleBuffers.size,
            totalCandles,
            symbolsWithData: this.getSymbolsWithData().length,
        };
    }

    destroy(): void {
        // Clear the cleanup timer to prevent memory leaks
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        
        // Force completion of any pending candles before cleanup
        this.flushCurrentCandles();
        
        // Clear all data and callbacks
        this.candleBuffers.clear();
        this.completedCandles.clear();
        this.candleCallbacks.clear();
        
        console.log('CandleReconstructionEngine destroyed and cleaned up');
    }
}

// Create singleton instance
export const candleReconstructionEngine = new CandleReconstructionEngine();