/**
 * John Ehlers Technical Indicators for Market Analysis
 * These indicators smooth noise, identify trends, and detect cycles in real-time tick data
 */

export interface EhlersSignals {
    supersmoother: number;
    trendline: number;
    cycle: number;
    trendStrength: number;
    direction: 'RISE' | 'FALL' | 'NEUTRAL';
    confidence: number;
}

/**
 * Supersmoother Filter - Removes high-frequency noise while preserving signal integrity
 * Uses a 2-pole Butterworth filter with minimal lag
 * @param prices - Array of price values (tick quotes)
 * @param period - Smoothing period (default: 10)
 */
export function calculateSupersmoother(prices: number[], period: number = 10): number[] {
    const result: number[] = [];
    const a1 = Math.exp(-Math.sqrt(2) * Math.PI / period);
    const b1 = 2 * a1 * Math.cos(Math.sqrt(2) * Math.PI / period);
    const c2 = b1;
    const c3 = -a1 * a1;
    const c1 = 1 - c2 - c3;

    for (let i = 0; i < prices.length; i++) {
        if (i < 2) {
            result[i] = prices[i];
        } else {
            const smoothed = c1 * (prices[i] + prices[i - 1]) / 2 + c2 * result[i - 1] + c3 * result[i - 2];
            result[i] = smoothed;
        }
    }

    return result;
}

/**
 * Instantaneous Trendline - Identifies the underlying trend with minimal lag
 * Hilbert Transform-based trend calculation
 * @param prices - Array of price values
 */
export function calculateInstantaneousTrendline(prices: number[]): number[] {
    const result: number[] = [];
    const smooth = calculateSupersmoother(prices, 7);

    for (let i = 0; i < smooth.length; i++) {
        if (i < 4) {
            result[i] = smooth[i];
        } else {
            const iTrend = (4 * smooth[i] + 3 * smooth[i - 1] + 2 * smooth[i - 2] + smooth[i - 3]) / 10;
            result[i] = iTrend;
        }
    }

    return result;
}

/**
 * Cyber Cycle - Detects cyclical patterns in the market
 * Measures the dominant cycle in the price data
 * @param prices - Array of price values
 * @param alpha - Smoothing factor (default: 0.07)
 */
export function calculateCyberCycle(prices: number[], alpha: number = 0.07): number[] {
    const result: number[] = [];
    const smooth = calculateSupersmoother(prices, 7);

    for (let i = 0; i < smooth.length; i++) {
        if (i < 3) {
            result[i] = 0;
        } else {
            const cycle = ((1 - 0.5 * alpha) * (1 - 0.5 * alpha) * (smooth[i] - 2 * smooth[i - 1] + smooth[i - 2])) +
                         (2 * (1 - alpha) * (result[i - 1] || 0)) -
                         ((1 - alpha) * (1 - alpha) * (result[i - 2] || 0));
            result[i] = cycle;
        }
    }

    return result;
}

/**
 * Calculate all Ehlers signals and determine market direction with confidence
 * @param prices - Array of recent tick prices (rolling window)
 * @param minConfidence - Minimum confidence threshold (default: 70)
 */
export function analyzeMarketDirection(prices: number[], minConfidence: number = 70): EhlersSignals {
    if (prices.length < 10) {
        return {
            supersmoother: prices[prices.length - 1] || 0,
            trendline: prices[prices.length - 1] || 0,
            cycle: 0,
            trendStrength: 0,
            direction: 'NEUTRAL',
            confidence: 0
        };
    }

    const smoothed = calculateSupersmoother(prices);
    const trendline = calculateInstantaneousTrendline(prices);
    const cycle = calculateCyberCycle(prices);

    const currentPrice = prices[prices.length - 1];
    const currentSmooth = smoothed[smoothed.length - 1];
    const currentTrend = trendline[trendline.length - 1];
    const currentCycle = cycle[cycle.length - 1];

    // Signal 1: Price vs Trendline position
    const priceAboveTrend = currentPrice > currentTrend;
    const priceTrendDiff = Math.abs(currentPrice - currentTrend);

    // Signal 2: Trend slope direction
    const trendSlope = trendline[trendline.length - 1] - trendline[trendline.length - 2];
    const trendRising = trendSlope > 0;

    // Signal 3: Momentum alignment (cycle phase)
    const cycleRising = currentCycle > (cycle[cycle.length - 2] || 0);

    // Calculate trend strength (0-100)
    const recentPrices = prices.slice(-10);
    const priceRange = Math.max(...recentPrices) - Math.min(...recentPrices);
    const trendStrength = priceRange > 0 ? Math.min(100, (Math.abs(trendSlope) / priceRange) * 1000) : 0;

    // Determine direction based on signal alignment
    let direction: 'RISE' | 'FALL' | 'NEUTRAL' = 'NEUTRAL';
    
    // Count bullish and bearish signals
    let bullishCount = 0;
    let bearishCount = 0;

    if (priceAboveTrend) bullishCount++;
    else bearishCount++;
    
    if (trendRising) bullishCount++;
    else bearishCount++;
    
    if (cycleRising) bullishCount++;
    else bearishCount++;

    // Determine direction and alignment strength
    let alignmentStrength = 0;
    if (bullishCount === 3) {
        direction = 'RISE';
        alignmentStrength = 3; // Perfect bullish alignment
    } else if (bearishCount === 3) {
        direction = 'FALL';
        alignmentStrength = 3; // Perfect bearish alignment
    } else if (bullishCount >= 2) {
        direction = 'RISE';
        alignmentStrength = bullishCount; // Partial bullish alignment
    } else if (bearishCount >= 2) {
        direction = 'FALL';
        alignmentStrength = bearishCount; // Partial bearish alignment
    } else {
        direction = 'NEUTRAL';
        alignmentStrength = 0; // Mixed signals
    }

    // Calculate confidence (0-100)
    // High confidence when all 3 signals align (either RISE or FALL)
    const baseConfidence = (alignmentStrength / 3) * 100;
    const trendBonus = Math.min(20, trendStrength);
    const confidence = Math.min(100, baseConfidence + trendBonus);

    return {
        supersmoother: currentSmooth,
        trendline: currentTrend,
        cycle: currentCycle,
        trendStrength,
        direction,
        confidence
    };
}

/**
 * Rolling window buffer for tick data management
 * Maintains fixed-size array of recent ticks to prevent memory bloat
 */
export class TickBuffer {
    private buffer: number[] = [];
    private readonly maxSize: number;

    constructor(maxSize: number = 150) {
        this.maxSize = maxSize;
    }

    add(tick: number): void {
        this.buffer.push(tick);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    getBuffer(): number[] {
        return [...this.buffer];
    }

    size(): number {
        return this.buffer.length;
    }

    clear(): void {
        this.buffer = [];
    }

    isFull(): boolean {
        return this.buffer.length >= this.maxSize;
    }
}
