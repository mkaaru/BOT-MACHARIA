
import { TickData } from './tick-stream-manager';

export interface MicroCandleData {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    startEpoch: number;
    endEpoch: number;
    timestamp: Date;
    tickCount: number;
    direction: 'bullish' | 'bearish' | 'neutral';
}

export interface MicroCandleBuffer {
    symbol: string;
    startTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    tickCount: number;
    lastUpdate: number;
}

export class MicroCandleEngine {
    private candleBuffers: Map<string, MicroCandleBuffer> = new Map();
    private completedCandles: Map<string, MicroCandleData[]> = new Map();
    private candleCallbacks: Map<string, Set<(candle: MicroCandleData) => void>> = new Map();
    private readonly MICRO_CANDLE_INTERVAL_MS = 5 * 1000; // 5 seconds
    private readonly MAX_CANDLES_PER_SYMBOL = 200; // Keep last 200 micro candles
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor() {
        // Cleanup old data periodically
        this.cleanupTimer = setInterval(() => this.cleanupOldCandles(), 2 * 60 * 1000); // Every 2 minutes
    }

    processTick(tick: TickData): void {
        const { symbol, epoch, quote } = tick;
        const candleStartTime = this.getMicroCandleStartTime(epoch);
        
        let buffer = this.candleBuffers.get(symbol);
        
        // If no buffer exists or we're in a new candle period
        if (!buffer || buffer.startTime !== candleStartTime) {
            // Complete the previous candle if it exists
            if (buffer && buffer.tickCount > 0) {
                this.completeMicroCandle(buffer);
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

    private getMicroCandleStartTime(epoch: number): number {
        // Round down to the nearest 5-second interval
        return Math.floor(epoch / 5) * 5;
    }

    private completeMicroCandle(buffer: MicroCandleBuffer): void {
        const direction = this.determineCandleDirection(buffer);
        
        const candle: MicroCandleData = {
            symbol: buffer.symbol,
            open: buffer.open,
            high: buffer.high,
            low: buffer.low,
            close: buffer.close,
            startEpoch: buffer.startTime,
            endEpoch: buffer.lastUpdate,
            timestamp: new Date(buffer.startTime * 1000),
            tickCount: buffer.tickCount,
            direction,
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
        this.notifyMicroCandleCallbacks(candle);
        
        console.log(`Completed 5s micro candle for ${buffer.symbol}: ${direction.toUpperCase()} OHLC(${candle.open.toFixed(5)}, ${candle.high.toFixed(5)}, ${candle.low.toFixed(5)}, ${candle.close.toFixed(5)}) with ${buffer.tickCount} ticks`);
    }

    private determineCandleDirection(buffer: MicroCandleBuffer): 'bullish' | 'bearish' | 'neutral' {
        const changePercent = ((buffer.close - buffer.open) / buffer.open) * 100;
        const threshold = 0.001; // 0.001% threshold for neutrality
        
        if (changePercent > threshold) return 'bullish';
        if (changePercent < -threshold) return 'bearish';
        return 'neutral';
    }

    private notifyMicroCandleCallbacks(candle: MicroCandleData): void {
        const callbacks = this.candleCallbacks.get(candle.symbol);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(candle);
                } catch (error) {
                    console.error(`Error in micro candle callback for ${candle.symbol}:`, error);
                }
            });
        }
    }

    addMicroCandleCallback(symbol: string, callback: (candle: MicroCandleData) => void): void {
        if (!this.candleCallbacks.has(symbol)) {
            this.candleCallbacks.set(symbol, new Set());
        }
        this.candleCallbacks.get(symbol)!.add(callback);
    }

    removeMicroCandleCallback(symbol: string, callback: (candle: MicroCandleData) => void): void {
        const callbacks = this.candleCallbacks.get(symbol);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.candleCallbacks.delete(symbol);
            }
        }
    }

    getMicroCandles(symbol: string, count?: number): MicroCandleData[] {
        const candles = this.completedCandles.get(symbol) || [];
        if (count && count > 0) {
            return candles.slice(-count);
        }
        return [...candles];
    }

    getCurrentMicroCandle(symbol: string): MicroCandleBuffer | null {
        return this.candleBuffers.get(symbol) || null;
    }

    hasData(symbol: string): boolean {
        return this.candleBuffers.has(symbol) || 
               (this.completedCandles.has(symbol) && this.completedCandles.get(symbol)!.length > 0);
    }

    getConsecutiveDirection(symbol: string, lookback: number = 3): {
        direction: 'bullish' | 'bearish' | 'neutral';
        count: number;
        strength: number; // 0-100
    } {
        const candles = this.getMicroCandles(symbol, lookback);
        if (candles.length < lookback) {
            return { direction: 'neutral', count: 0, strength: 0 };
        }

        const recent = candles.slice(-lookback);
        const bullishCount = recent.filter(c => c.direction === 'bullish').length;
        const bearishCount = recent.filter(c => c.direction === 'bearish').length;
        
        if (bullishCount === lookback) {
            return { direction: 'bullish', count: bullishCount, strength: 100 };
        } else if (bearishCount === lookback) {
            return { direction: 'bearish', count: bearishCount, strength: 100 };
        } else if (bullishCount > bearishCount) {
            return { direction: 'bullish', count: bullishCount, strength: (bullishCount / lookback) * 100 };
        } else if (bearishCount > bullishCount) {
            return { direction: 'bearish', count: bearishCount, strength: (bearishCount / lookback) * 100 };
        }
        
        return { direction: 'neutral', count: 0, strength: 0 };
    }

    calculateROC(symbol: string, lookbackTicks: number = 20): number {
        const candles = this.getMicroCandles(symbol, Math.ceil(lookbackTicks / 5)); // Approximate ticks to candles
        if (candles.length < 2) return 0;
        
        const currentPrice = candles[candles.length - 1].close;
        const pastPrice = candles[0].close;
        
        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }

    private cleanupOldCandles(): void {
        const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60); // 10 minutes ago
        
        this.completedCandles.forEach((candles, symbol) => {
            const filteredCandles = candles.filter(candle => candle.startEpoch > tenMinutesAgo);
            if (filteredCandles.length !== candles.length) {
                this.completedCandles.set(symbol, filteredCandles);
                console.log(`Cleaned up old micro candles for ${symbol}: ${candles.length - filteredCandles.length} removed`);
            }
        });

        // Clean up buffers for inactive symbols
        this.candleBuffers.forEach((buffer, symbol) => {
            if (buffer.lastUpdate < tenMinutesAgo) {
                this.candleBuffers.delete(symbol);
                console.log(`Removed inactive micro candle buffer for ${symbol}`);
            }
        });
    }

    getStats(): {
        activeBuffers: number;
        totalMicroCandles: number;
        symbolsWithData: number;
    } {
        let totalCandles = 0;
        this.completedCandles.forEach(candles => {
            totalCandles += candles.length;
        });

        return {
            activeBuffers: this.candleBuffers.size,
            totalMicroCandles: totalCandles,
            symbolsWithData: this.completedCandles.size,
        };
    }

    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        
        this.candleBuffers.clear();
        this.completedCandles.clear();
        this.candleCallbacks.clear();
        
        console.log('MicroCandleEngine destroyed and cleaned up');
    }
}

// Create singleton instance
export const microCandleEngine = new MicroCandleEngine();
