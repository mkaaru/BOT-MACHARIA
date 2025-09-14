import { TickData, CandleData } from './tick-stream-manager';

export interface PriceHistoryStats {
    symbolsTracked: number;
    totalTicks: number;
    totalCandles: number;
    memoryUsage: number;
}

export interface SymbolPriceData {
    symbol: string;
    tickHistory: number[];
    candleHistory: number[];
    lastTickEpoch: number;
    lastCandleEpoch: number;
    tickCount: number;
    candleCount: number;
}

/**
 * Centralized price history service for managing historical price data
 * across all ML trader components with optimized memory usage
 */
export class PriceHistoryService {
    private readonly MAX_TICKS_PER_SYMBOL = 500;
    private readonly MAX_CANDLES_PER_SYMBOL = 100;
    
    // Core price storage
    private tickHistory: Map<string, number[]> = new Map();
    private candleHistory: Map<string, number[]> = new Map();
    
    // Metadata for cleanup and stats
    private lastTickEpoch: Map<string, number> = new Map();
    private lastCandleEpoch: Map<string, number> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private candleCounts: Map<string, number> = new Map();
    
    // Cleanup interval
    private cleanupInterval: NodeJS.Timeout;
    
    constructor() {
        // Clean up old data every 10 minutes
        this.cleanupInterval = setInterval(() => this.cleanupOldData(), 10 * 60 * 1000);
    }

    /**
     * Add tick data for a symbol
     */
    addTick(tick: TickData): void {
        const { symbol, quote, epoch } = tick;
        
        if (!this.tickHistory.has(symbol)) {
            this.tickHistory.set(symbol, []);
            this.tickCounts.set(symbol, 0);
        }
        
        const prices = this.tickHistory.get(symbol)!;
        prices.push(quote);
        
        // Maintain size limit
        if (prices.length > this.MAX_TICKS_PER_SYMBOL) {
            prices.shift();
        }
        
        this.lastTickEpoch.set(symbol, epoch);
        this.tickCounts.set(symbol, this.tickCounts.get(symbol)! + 1);
    }

    /**
     * Add candle data for a symbol
     */
    addCandle(candle: CandleData): void {
        const { symbol, close, epoch } = candle;
        
        if (!this.candleHistory.has(symbol)) {
            this.candleHistory.set(symbol, []);
            this.candleCounts.set(symbol, 0);
        }
        
        const candlePrices = this.candleHistory.get(symbol)!;
        candlePrices.push(close);
        
        // Maintain size limit
        if (candlePrices.length > this.MAX_CANDLES_PER_SYMBOL) {
            candlePrices.shift();
        }
        
        this.lastCandleEpoch.set(symbol, epoch);
        this.candleCounts.set(symbol, this.candleCounts.get(symbol)! + 1);
    }

    /**
     * Get tick prices for a symbol (for HMA calculations)
     */
    getTickPrices(symbol: string, count?: number): number[] {
        const prices = this.tickHistory.get(symbol) || [];
        if (count && count > 0) {
            return prices.slice(-count);
        }
        return [...prices];
    }

    /**
     * Get candle prices for a symbol
     */
    getCandlePrices(symbol: string, count?: number): number[] {
        const prices = this.candleHistory.get(symbol) || [];
        if (count && count > 0) {
            return prices.slice(-count);
        }
        return [...prices];
    }

    /**
     * Get the most recent price for a symbol
     */
    getLatestPrice(symbol: string): number | null {
        const tickPrices = this.tickHistory.get(symbol);
        if (tickPrices && tickPrices.length > 0) {
            return tickPrices[tickPrices.length - 1];
        }
        
        const candlePrices = this.candleHistory.get(symbol);
        if (candlePrices && candlePrices.length > 0) {
            return candlePrices[candlePrices.length - 1];
        }
        
        return null;
    }

    /**
     * Check if symbol has sufficient data for analysis
     */
    hasSufficientData(symbol: string, minTicks: number = 40): boolean {
        const tickPrices = this.tickHistory.get(symbol);
        const candlePrices = this.candleHistory.get(symbol);
        
        return (tickPrices && tickPrices.length >= minTicks) ||
               (candlePrices && candlePrices.length >= Math.ceil(minTicks / 5));
    }

    /**
     * Get all symbols with price data
     */
    getTrackedSymbols(): string[] {
        const tickSymbols = Array.from(this.tickHistory.keys());
        const candleSymbols = Array.from(this.candleHistory.keys());
        return [...new Set([...tickSymbols, ...candleSymbols])];
    }

    /**
     * Get detailed data for a specific symbol
     */
    getSymbolData(symbol: string): SymbolPriceData | null {
        const tickHistory = this.tickHistory.get(symbol) || [];
        const candleHistory = this.candleHistory.get(symbol) || [];
        
        if (tickHistory.length === 0 && candleHistory.length === 0) {
            return null;
        }
        
        return {
            symbol,
            tickHistory: [...tickHistory],
            candleHistory: [...candleHistory],
            lastTickEpoch: this.lastTickEpoch.get(symbol) || 0,
            lastCandleEpoch: this.lastCandleEpoch.get(symbol) || 0,
            tickCount: this.tickCounts.get(symbol) || 0,
            candleCount: this.candleCounts.get(symbol) || 0,
        };
    }

    /**
     * Get service statistics
     */
    getStats(): PriceHistoryStats {
        let totalTicks = 0;
        let totalCandles = 0;
        
        this.tickHistory.forEach(prices => totalTicks += prices.length);
        this.candleHistory.forEach(prices => totalCandles += prices.length);
        
        // Rough memory calculation (8 bytes per number + overhead)
        const memoryUsage = (totalTicks + totalCandles) * 8 + 
                           this.getTrackedSymbols().length * 200; // Overhead per symbol
        
        return {
            symbolsTracked: this.getTrackedSymbols().length,
            totalTicks,
            totalCandles,
            memoryUsage,
        };
    }

    /**
     * Clean up old data based on time thresholds
     */
    private cleanupOldData(): void {
        const fourHoursAgo = Math.floor(Date.now() / 1000) - (4 * 60 * 60);
        let cleanedSymbols = 0;
        
        // Clean tick data
        this.lastTickEpoch.forEach((lastEpoch, symbol) => {
            if (lastEpoch < fourHoursAgo) {
                this.tickHistory.delete(symbol);
                this.lastTickEpoch.delete(symbol);
                this.tickCounts.delete(symbol);
                cleanedSymbols++;
            }
        });
        
        // Clean candle data
        this.lastCandleEpoch.forEach((lastEpoch, symbol) => {
            if (lastEpoch < fourHoursAgo) {
                this.candleHistory.delete(symbol);
                this.lastCandleEpoch.delete(symbol);
                this.candleCounts.delete(symbol);
                cleanedSymbols++;
            }
        });
        
        if (cleanedSymbols > 0) {
            console.log(`PriceHistory cleanup: removed data for ${cleanedSymbols} inactive symbols`);
        }
    }

    /**
     * Clear all data for a specific symbol
     */
    clearSymbol(symbol: string): void {
        this.tickHistory.delete(symbol);
        this.candleHistory.delete(symbol);
        this.lastTickEpoch.delete(symbol);
        this.lastCandleEpoch.delete(symbol);
        this.tickCounts.delete(symbol);
        this.candleCounts.delete(symbol);
    }

    /**
     * Reset all price history data
     */
    reset(): void {
        this.tickHistory.clear();
        this.candleHistory.clear();
        this.lastTickEpoch.clear();
        this.lastCandleEpoch.clear();
        this.tickCounts.clear();
        this.candleCounts.clear();
    }

    /**
     * Destroy the service and clean up resources
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.reset();
    }
}

// Create singleton instance
export const priceHistoryService = new PriceHistoryService();