
export interface HistoricalTickData {
    symbol: string;
    prices: number[];
    times: number[];
    lastUpdate: number;
    isComplete: boolean;
}

/**
 * Historical data cache for faster Trading Hub loading
 */
export class HistoricalDataCache {
    private cache: Map<string, HistoricalTickData> = new Map();
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private readonly MAX_TICKS = 500;

    /**
     * Check if we have recent cached data for a symbol
     */
    hasValidCache(symbol: string): boolean {
        const cached = this.cache.get(symbol);
        if (!cached) return false;
        
        const isRecent = (Date.now() - cached.lastUpdate) < this.CACHE_DURATION;
        return isRecent && cached.isComplete && cached.prices.length >= 200;
    }

    /**
     * Get cached historical data
     */
    getCachedData(symbol: string): HistoricalTickData | null {
        const cached = this.cache.get(symbol);
        if (!cached || !this.hasValidCache(symbol)) {
            return null;
        }
        return cached;
    }

    /**
     * Store historical data in cache
     */
    setCachedData(symbol: string, prices: number[], times: number[]): void {
        this.cache.set(symbol, {
            symbol,
            prices: prices.slice(-this.MAX_TICKS), // Keep last 500 ticks
            times: times.slice(-this.MAX_TICKS),
            lastUpdate: Date.now(),
            isComplete: true
        });
        
        console.log(`💾 Cached ${prices.length} ticks for ${symbol}`);
    }

    /**
     * Update cache with new tick
     */
    addTick(symbol: string, price: number, time: number): void {
        const cached = this.cache.get(symbol);
        if (!cached) return;

        cached.prices.push(price);
        cached.times.push(time);
        
        // Keep only last MAX_TICKS
        if (cached.prices.length > this.MAX_TICKS) {
            cached.prices.shift();
            cached.times.shift();
        }
        
        cached.lastUpdate = Date.now();
    }

    /**
     * Clear expired cache entries
     */
    cleanupExpiredCache(): void {
        const now = Date.now();
        for (const [symbol, data] of this.cache.entries()) {
            if ((now - data.lastUpdate) > this.CACHE_DURATION) {
                this.cache.delete(symbol);
                console.log(`🧹 Cleared expired cache for ${symbol}`);
            }
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { symbols: number; totalTicks: number; avgAge: number } {
        const symbols = this.cache.size;
        let totalTicks = 0;
        let totalAge = 0;
        const now = Date.now();

        for (const data of this.cache.values()) {
            totalTicks += data.prices.length;
            totalAge += (now - data.lastUpdate);
        }

        return {
            symbols,
            totalTicks,
            avgAge: symbols > 0 ? totalAge / symbols : 0
        };
    }
}

// Create singleton instance
export const historicalDataCache = new HistoricalDataCache();

// Cleanup expired cache every 10 minutes
setInterval(() => {
    historicalDataCache.cleanupExpiredCache();
}, 10 * 60 * 1000);
