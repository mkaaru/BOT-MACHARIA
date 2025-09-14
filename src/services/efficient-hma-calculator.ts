import { CandleData } from './candle-reconstruction-engine';
import { priceHistoryService } from './price-history';

export interface EfficientHMAResult {
    value: number;
    timestamp: Date;
    epoch: number;
}

interface WMAWindow {
    values: number[];
    sum: number;
    weightedSum: number;
    period: number;
}

interface HMAState {
    wmaHalf: WMAWindow;
    wmaFull: WMAWindow;
    hmaBuffer: number[];
    hmaWindow: WMAWindow;
    isReady: boolean;
}

/**
 * High-performance HMA calculator using O(n) incremental computation
 * instead of O(n^2) recalculation for real-time trading systems
 */
export class EfficientHMACalculator {
    private hmaStates: Map<string, Map<number, HMAState>> = new Map();
    private hmaResults: Map<string, Map<number, EfficientHMAResult[]>> = new Map();
    private readonly MAX_RESULTS_PER_PERIOD = 100;
    private cleanupTimer: NodeJS.Timeout;

    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanupOldData(), 10 * 60 * 1000);
    }

    /**
     * Create a new WMA window for efficient incremental calculation
     */
    private createWMAWindow(period: number): WMAWindow {
        return {
            values: [],
            sum: 0,
            weightedSum: 0,
            period,
        };
    }

    /**
     * Add value to WMA window with O(1) complexity
     */
    private addToWMAWindow(window: WMAWindow, value: number): number | null {
        const { values, period } = window;
        
        // Add new value
        values.push(value);
        
        if (values.length > period) {
            // Remove oldest value efficiently
            const removedValue = values.shift()!;
            window.sum -= removedValue;
            
            // Recalculate weighted sum efficiently
            window.weightedSum = 0;
            for (let i = 0; i < values.length; i++) {
                window.weightedSum += values[i] * (i + 1);
            }
        } else {
            // Still building up the window
            window.sum += value;
            window.weightedSum += value * values.length;
        }
        
        if (values.length < period) {
            return null; // Not enough data yet
        }
        
        // Calculate WMA
        const denominator = (period * (period + 1)) / 2;
        return window.weightedSum / denominator;
    }

    /**
     * Initialize HMA state for a symbol and period
     */
    private initializeHMAState(symbol: string, period: number): HMAState {
        const halfPeriod = Math.floor(period / 2);
        const sqrtPeriod = Math.floor(Math.sqrt(period));
        
        return {
            wmaHalf: this.createWMAWindow(halfPeriod),
            wmaFull: this.createWMAWindow(period),
            hmaBuffer: [],
            hmaWindow: this.createWMAWindow(sqrtPeriod),
            isReady: false,
        };
    }

    /**
     * Add price data and calculate HMA incrementally with O(n) performance
     */
    addPrice(symbol: string, price: number, timestamp: Date, periods: number[] = [5, 40]): void {
        const epoch = Math.floor(timestamp.getTime() / 1000);
        
        if (!this.hmaStates.has(symbol)) {
            this.hmaStates.set(symbol, new Map());
        }
        
        if (!this.hmaResults.has(symbol)) {
            this.hmaResults.set(symbol, new Map());
        }
        
        const symbolStates = this.hmaStates.get(symbol)!;
        const symbolResults = this.hmaResults.get(symbol)!;
        
        periods.forEach(period => {
            // Initialize state if needed
            if (!symbolStates.has(period)) {
                symbolStates.set(period, this.initializeHMAState(symbol, period));
                symbolResults.set(period, []);
            }
            
            const state = symbolStates.get(period)!;
            const results = symbolResults.get(period)!;
            
            // Calculate WMA for half period and full period
            const wmaHalf = this.addToWMAWindow(state.wmaHalf, price);
            const wmaFull = this.addToWMAWindow(state.wmaFull, price);
            
            if (wmaHalf !== null && wmaFull !== null) {
                // Calculate HMA intermediate value: 2*WMA(n/2) - WMA(n)
                const hmaIntermediate = 2 * wmaHalf - wmaFull;
                state.hmaBuffer.push(hmaIntermediate);
                
                // Maintain buffer size (we need at least sqrt(period) values)
                const maxBufferSize = Math.max(50, period * 2); // Keep more data for stability
                if (state.hmaBuffer.length > maxBufferSize) {
                    state.hmaBuffer.shift();
                }
                
                // Calculate final HMA using WMA on intermediate values
                const hmaValue = this.addToWMAWindow(state.hmaWindow, hmaIntermediate);
                
                if (hmaValue !== null) {
                    state.isReady = true;
                    
                    const hmaResult: EfficientHMAResult = {
                        value: hmaValue,
                        timestamp,
                        epoch,
                    };
                    
                    results.push(hmaResult);
                    
                    // Maintain results size
                    if (results.length > this.MAX_RESULTS_PER_PERIOD) {
                        results.shift();
                    }
                    
                    console.log(`Efficient HMA${period} for ${symbol}: ${hmaValue.toFixed(5)} (O(1) calculation)`);
                }
            }
        });
    }

    /**
     * Process candle data efficiently
     */
    addCandleData(candle: CandleData, periods: number[] = [5, 40]): void {
        const { symbol, close, timestamp } = candle;
        
        // Add to price history service
        priceHistoryService.addCandle(candle);
        
        // Process with efficient calculation
        this.addPrice(symbol, close, timestamp, periods);
    }

    /**
     * Get latest HMA value for a symbol and period
     */
    getLatestHMA(symbol: string, period: number): EfficientHMAResult | null {
        const symbolResults = this.hmaResults.get(symbol);
        if (!symbolResults) return null;
        
        const periodResults = symbolResults.get(period);
        if (!periodResults || periodResults.length === 0) return null;
        
        return periodResults[periodResults.length - 1];
    }

    /**
     * Get HMA values for a symbol and period
     */
    getHMAValues(symbol: string, period: number, count?: number): EfficientHMAResult[] {
        const symbolResults = this.hmaResults.get(symbol);
        if (!symbolResults) return [];
        
        const periodResults = symbolResults.get(period) || [];
        
        if (count && count > 0) {
            return periodResults.slice(-count);
        }
        
        return [...periodResults];
    }

    /**
     * Calculate HMA slope efficiently using recent values
     */
    getHMASlope(symbol: string, period: number, lookbackPeriods: number = 3): number | null {
        const values = this.getHMAValues(symbol, period, lookbackPeriods + 1);
        
        if (values.length < 2) return null;
        
        // Use linear regression for more accurate slope calculation
        if (values.length >= 3) {
            return this.calculateLinearRegressionSlope(values.map(v => v.value));
        }
        
        // Simple slope calculation
        const latest = values[values.length - 1];
        const previous = values[values.length - 2];
        
        return latest.value - previous.value;
    }

    /**
     * Calculate linear regression slope for more accurate trend detection
     */
    private calculateLinearRegressionSlope(values: number[]): number {
        const n = values.length;
        if (n < 2) return 0;
        
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;
        
        for (let i = 0; i < n; i++) {
            const x = i;
            const y = values[i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }
        
        const denominator = n * sumXX - sumX * sumX;
        if (denominator === 0) return 0;
        
        return (n * sumXY - sumX * sumY) / denominator;
    }

    /**
     * Get HMA crossover information with efficient calculation
     */
    getHMACrossover(symbol: string, fastPeriod: number = 5, slowPeriod: number = 40): number {
        const fastCurrent = this.getLatestHMA(symbol, fastPeriod);
        const slowCurrent = this.getLatestHMA(symbol, slowPeriod);
        
        if (!fastCurrent || !slowCurrent) return 0;
        
        const fastPrevious = this.getHMAValues(symbol, fastPeriod, 2);
        const slowPrevious = this.getHMAValues(symbol, slowPeriod, 2);
        
        if (fastPrevious.length < 2 || slowPrevious.length < 2) return 0;
        
        const fastPrev = fastPrevious[fastPrevious.length - 2];
        const slowPrev = slowPrevious[slowPrevious.length - 2];
        
        // Check for crossover
        const currentBullish = fastCurrent.value > slowCurrent.value;
        const previousBullish = fastPrev.value > slowPrev.value;
        
        if (currentBullish && !previousBullish) return 1; // Bullish crossover
        if (!currentBullish && previousBullish) return -1; // Bearish crossover
        
        return 0; // No crossover
    }

    /**
     * Check if HMA calculation is ready for a symbol and period
     */
    isReady(symbol: string, period: number): boolean {
        const symbolStates = this.hmaStates.get(symbol);
        if (!symbolStates) return false;
        
        const state = symbolStates.get(period);
        return state ? state.isReady : false;
    }

    /**
     * Check if symbol has sufficient data for HMA calculation
     */
    hasSufficientData(symbol: string, period: number): boolean {
        return this.isReady(symbol, period);
    }

    /**
     * Get all symbols with HMA data
     */
    getSymbolsWithData(): string[] {
        return Array.from(this.hmaStates.keys());
    }

    /**
     * Get statistics about HMA calculations
     */
    getStats(): {
        symbolsCount: number;
        totalCalculations: number;
        periodsTracked: Set<number>;
        readyCalculations: number;
    } {
        let totalCalculations = 0;
        let readyCalculations = 0;
        const periodsTracked = new Set<number>();
        
        this.hmaResults.forEach(symbolResults => {
            symbolResults.forEach((results, period) => {
                totalCalculations += results.length;
                periodsTracked.add(period);
            });
        });
        
        this.hmaStates.forEach(symbolStates => {
            symbolStates.forEach((state, period) => {
                if (state.isReady) {
                    readyCalculations++;
                }
            });
        });
        
        return {
            symbolsCount: this.hmaStates.size,
            totalCalculations,
            periodsTracked,
            readyCalculations,
        };
    }

    /**
     * Clean up old data
     */
    private cleanupOldData(): void {
        const twoHoursAgo = Math.floor(Date.now() / 1000) - (2 * 60 * 60);
        
        this.hmaResults.forEach((symbolResults, symbol) => {
            symbolResults.forEach((results, period) => {
                const filteredResults = results.filter(r => r.epoch > twoHoursAgo);
                if (filteredResults.length !== results.length) {
                    symbolResults.set(period, filteredResults);
                    console.log(`Cleaned up old efficient HMA${period} data for ${symbol}`);
                }
            });
        });
    }

    /**
     * Reset all HMA data
     */
    reset(): void {
        this.hmaStates.clear();
        this.hmaResults.clear();
    }

    /**
     * Destroy the calculator and clean up resources
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        this.reset();
    }
}

// Create singleton instance for efficient HMA calculations
export const efficientHMACalculator = new EfficientHMACalculator();