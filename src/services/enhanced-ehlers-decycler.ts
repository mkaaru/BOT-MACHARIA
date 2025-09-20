
import { MicroCandleData } from './micro-candle-engine';

export interface EhlersDecyclerResult {
    value: number;
    slope: number;
    color: 'green' | 'red' | 'neutral';
    strength: number; // 0-100
}

export interface DecyclerState {
    values: number[];
    hp1: number;
    hp2: number;
}

export class EnhancedEhlersDecycler {
    private shortDecyclers: Map<string, DecyclerState> = new Map(); // 8-period
    private longDecyclers: Map<string, DecyclerState> = new Map();  // 20-period
    private readonly SHORT_PERIOD = 8;
    private readonly LONG_PERIOD = 20;
    private readonly MAX_HISTORY = 100;

    /**
     * Process micro candle through both short and long decyclers
     */
    processMicroCandle(candle: MicroCandleData): {
        short: EhlersDecyclerResult;
        long: EhlersDecyclerResult;
        consensus: {
            direction: 'bullish' | 'bearish' | 'neutral';
            strength: number;
            confirmation: boolean;
        };
    } {
        const { symbol, close } = candle;

        // Initialize states if needed
        if (!this.shortDecyclers.has(symbol)) {
            this.shortDecyclers.set(symbol, { values: [], hp1: close, hp2: close });
        }
        if (!this.longDecyclers.has(symbol)) {
            this.longDecyclers.set(symbol, { values: [], hp1: close, hp2: close });
        }

        // Calculate decyclers
        const shortResult = this.calculateDecycler(symbol, close, this.SHORT_PERIOD, true);
        const longResult = this.calculateDecycler(symbol, close, this.LONG_PERIOD, false);

        // Generate consensus
        const consensus = this.generateConsensus(shortResult, longResult);

        console.log(`Ehlers Decyclers ${symbol}: Short=${shortResult.color}(${shortResult.value.toFixed(5)}) Long=${longResult.color}(${longResult.value.toFixed(5)}) Consensus=${consensus.direction}(${consensus.strength.toFixed(1)}%)`);

        return {
            short: shortResult,
            long: longResult,
            consensus
        };
    }

    /**
     * Calculate Ehlers Decycler (removes cycle components, leaves trend)
     */
    private calculateDecycler(symbol: string, price: number, period: number, isShort: boolean): EhlersDecyclerResult {
        const state = isShort ? this.shortDecyclers.get(symbol)! : this.longDecyclers.get(symbol)!;
        
        // High-pass filter coefficients
        const alpha1 = (Math.cos(2 * Math.PI / period) + Math.sin(2 * Math.PI / period) - 1) / Math.cos(2 * Math.PI / period);
        
        // High-pass filter calculation
        const hp = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (price - 2 * state.hp1 + state.hp2) + 
                   2 * (1 - alpha1) * state.hp1 - (1 - alpha1) * (1 - alpha1) * state.hp2;
        
        // Update state
        state.hp2 = state.hp1;
        state.hp1 = hp;
        
        // Decycler is the original price minus the high-pass filtered component
        const decycler = price - hp;
        
        // Store in history
        state.values.push(decycler);
        if (state.values.length > this.MAX_HISTORY) {
            state.values.shift();
        }

        // Calculate slope and color
        const slope = this.calculateSlope(state.values, Math.min(5, state.values.length));
        const color = this.determineColor(slope);
        const strength = this.calculateStrength(slope, state.values);

        return {
            value: decycler,
            slope,
            color,
            strength
        };
    }

    /**
     * Calculate slope of recent values using linear regression
     */
    private calculateSlope(values: number[], lookback: number): number {
        if (values.length < 2) return 0;
        
        const recentValues = values.slice(-lookback);
        const n = recentValues.length;
        
        if (n < 2) return 0;
        
        // Linear regression slope calculation
        const x = Array.from({ length: n }, (_, i) => i);
        const y = recentValues;
        
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        
        return slope || 0;
    }

    /**
     * Determine color based on slope
     */
    private determineColor(slope: number): 'green' | 'red' | 'neutral' {
        const threshold = 0.0001; // Minimum slope threshold
        
        if (slope > threshold) return 'green';
        if (slope < -threshold) return 'red';
        return 'neutral';
    }

    /**
     * Calculate strength of the trend (0-100)
     */
    private calculateStrength(slope: number, values: number[]): number {
        if (values.length < 3) return 0;
        
        // Normalize slope relative to recent price volatility
        const recentValues = values.slice(-10);
        const volatility = this.calculateVolatility(recentValues);
        
        if (volatility === 0) return 0;
        
        const normalizedSlope = Math.abs(slope) / volatility;
        
        // Convert to 0-100 scale
        return Math.min(100, normalizedSlope * 1000);
    }

    /**
     * Calculate volatility of values
     */
    private calculateVolatility(values: number[]): number {
        if (values.length < 2) return 0;
        
        const returns = values.slice(1).map((val, i) => Math.log(val / values[i]));
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance);
    }

    /**
     * Generate consensus between short and long decyclers
     */
    private generateConsensus(short: EhlersDecyclerResult, long: EhlersDecyclerResult): {
        direction: 'bullish' | 'bearish' | 'neutral';
        strength: number;
        confirmation: boolean;
    } {
        // Check if both decyclers agree on direction
        const agreesDirection = short.color === long.color && short.color !== 'neutral';
        
        // Weight short-term more heavily for quick signals, but require long-term agreement for confirmation
        const shortWeight = 0.7;
        const longWeight = 0.3;
        
        const combinedStrength = (short.strength * shortWeight) + (long.strength * longWeight);
        
        let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let confirmation = false;
        
        if (agreesDirection) {
            direction = short.color === 'green' ? 'bullish' : 'bearish';
            confirmation = true;
        } else if (short.color !== 'neutral' && long.color === 'neutral') {
            // Short-term signal without long-term contradiction
            direction = short.color === 'green' ? 'bullish' : 'bearish';
            confirmation = false;
        } else if (long.color !== 'neutral' && short.color === 'neutral') {
            // Long-term signal without short-term contradiction
            direction = long.color === 'green' ? 'bullish' : 'bearish';
            confirmation = false;
        }
        
        return {
            direction,
            strength: combinedStrength,
            confirmation
        };
    }

    /**
     * Get latest decycler results for a symbol
     */
    getLatestDecyclerResults(symbol: string): {
        short: EhlersDecyclerResult | null;
        long: EhlersDecyclerResult | null;
    } {
        const shortState = this.shortDecyclers.get(symbol);
        const longState = this.longDecyclers.get(symbol);
        
        let shortResult = null;
        let longResult = null;
        
        if (shortState && shortState.values.length > 0) {
            const lastValue = shortState.values[shortState.values.length - 1];
            const slope = this.calculateSlope(shortState.values, Math.min(5, shortState.values.length));
            shortResult = {
                value: lastValue,
                slope,
                color: this.determineColor(slope),
                strength: this.calculateStrength(slope, shortState.values)
            };
        }
        
        if (longState && longState.values.length > 0) {
            const lastValue = longState.values[longState.values.length - 1];
            const slope = this.calculateSlope(longState.values, Math.min(5, longState.values.length));
            longResult = {
                value: lastValue,
                slope,
                color: this.determineColor(slope),
                strength: this.calculateStrength(slope, longState.values)
            };
        }
        
        return { short: shortResult, long: longResult };
    }

    /**
     * Check if symbol has enough data for reliable analysis
     */
    isReady(symbol: string): boolean {
        const shortState = this.shortDecyclers.get(symbol);
        const longState = this.longDecyclers.get(symbol);
        
        return (shortState?.values.length || 0) >= this.SHORT_PERIOD && 
               (longState?.values.length || 0) >= this.LONG_PERIOD;
    }

    /**
     * Reset all states and history
     */
    reset(): void {
        this.shortDecyclers.clear();
        this.longDecyclers.clear();
    }
}

// Create singleton instance
export const enhancedEhlersDecycler = new EnhancedEhlersDecycler();
