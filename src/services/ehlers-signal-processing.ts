
import { EfficientHMACalculator } from './efficient-hma-calculator';

export interface EhlersSignals {
    roofingFilter: number;
    netValue: number;
    volatility: number; // AM component
    timing: number; // FM component
    anticipatorySignal: number;
    snr: number; // Signal to noise ratio
    trendStrength: number;
}

export interface RoofingFilterState {
    hp1: number;
    hp2: number;
    ss1: number;
    ss2: number;
}

export interface NETState {
    values: number[];
    kendallBuffer: number[];
}

export interface AMFMState {
    derivHistory: number[];
    envelHistory: number[];
    limitedHistory: number[];
    volatilityHistory: number[];
}

/**
 * Ehlers Signal Processing Engine
 * Implements advanced signal processing techniques from John Ehlers
 */
export class EhlersSignalProcessor {
    private roofingStates: Map<string, RoofingFilterState> = new Map();
    private netStates: Map<string, NETState> = new Map();
    private amfmStates: Map<string, AMFMState> = new Map();
    private signals: Map<string, EhlersSignals[]> = new Map();
    
    private readonly ROOFING_PERIOD = 20;
    private readonly NET_LENGTH = 14;
    private readonly MAX_HISTORY = 100;

    /**
     * Process price data through Ehlers signal processing pipeline
     */
    processPrice(symbol: string, price: number, timestamp: Date): EhlersSignals {
        // Initialize states if needed
        if (!this.roofingStates.has(symbol)) {
            this.initializeStates(symbol);
        }

        const roofingState = this.roofingStates.get(symbol)!;
        const netState = this.netStates.get(symbol)!;
        const amfmState = this.amfmStates.get(symbol)!;

        // Step 1: Apply Roofing Filter to remove spectral dilation
        const roofingValue = this.applyRoofingFilter(price, roofingState);

        // Step 2: Apply NET (Noise Elimination Technology)
        const netValue = this.applyNET(roofingValue, netState);

        // Step 3: AM/FM Decomposition
        const { volatility, timing } = this.performAMFMDecomposition(price, amfmState);

        // Step 4: Calculate anticipatory signals
        const anticipatorySignal = this.calculateAnticipatory(netValue, netState);

        // Step 5: Calculate signal quality metrics
        const snr = this.calculateSNR(netState.values);
        const trendStrength = this.calculateTrendStrength(netState.values);

        const signals: EhlersSignals = {
            roofingFilter: roofingValue,
            netValue,
            volatility,
            timing,
            anticipatorySignal,
            snr,
            trendStrength
        };

        // Store signals history
        if (!this.signals.has(symbol)) {
            this.signals.set(symbol, []);
        }
        const symbolSignals = this.signals.get(symbol)!;
        symbolSignals.push(signals);
        
        // Maintain history size
        if (symbolSignals.length > this.MAX_HISTORY) {
            symbolSignals.shift();
        }

        console.log(`🔬 Ehlers Processing ${symbol}: NET=${netValue.toFixed(4)}, Vol=${volatility.toFixed(4)}, SNR=${snr.toFixed(2)}dB`);

        return signals;
    }

    /**
     * Initialize processing states for a symbol
     */
    private initializeStates(symbol: string): void {
        this.roofingStates.set(symbol, {
            hp1: 0,
            hp2: 0,
            ss1: 0,
            ss2: 0
        });

        this.netStates.set(symbol, {
            values: [],
            kendallBuffer: []
        });

        this.amfmStates.set(symbol, {
            derivHistory: [],
            envelHistory: [],
            limitedHistory: [],
            volatilityHistory: []
        });
    }

    /**
     * Roofing Filter - Removes spectral dilation effects
     * Combination of 2nd order HighPass + SuperSmoother
     */
    private applyRoofingFilter(price: number, state: RoofingFilterState): number {
        const period = this.ROOFING_PERIOD;
        
        // 2nd Order HighPass Filter (removes trend and spectral dilation)
        const alpha1 = (Math.cos(2 * Math.PI / period) + Math.sin(2 * Math.PI / period) - 1) / Math.cos(2 * Math.PI / period);
        const hp = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (price - 2 * (state.hp1 || price) + (state.hp2 || price)) + 
                   2 * (1 - alpha1) * (state.hp1 || 0) - (1 - alpha1) * (1 - alpha1) * (state.hp2 || 0);
        
        state.hp2 = state.hp1 || 0;
        state.hp1 = hp;

        // SuperSmoother (removes aliasing noise)
        const a1 = Math.exp(-Math.sqrt(2) * Math.PI / period);
        const b1 = 2 * a1 * Math.cos(Math.sqrt(2) * Math.PI / period);
        const c2 = b1;
        const c3 = -a1 * a1;
        const c1 = 1 - c2 - c3;
        
        const ss = c1 * (hp + (state.ss1 || hp)) / 2 + c2 * (state.ss1 || 0) + c3 * (state.ss2 || 0);
        
        state.ss2 = state.ss1 || 0;
        state.ss1 = ss;

        return ss;
    }

    /**
     * NET - Noise Elimination Technology using Kendall Correlation
     */
    private applyNET(value: number, state: NETState): number {
        state.values.push(value);
        
        // Maintain buffer size
        if (state.values.length > this.NET_LENGTH) {
            state.values.shift();
        }

        if (state.values.length < this.NET_LENGTH) {
            return value; // Not enough data yet
        }

        // Create straight line with positive slope for Kendall correlation
        const X = [...state.values];
        const Y = Array.from({ length: this.NET_LENGTH }, (_, i) => -(i + 1));

        // Calculate Kendall correlation numerator
        let numerator = 0;
        for (let i = 1; i < this.NET_LENGTH; i++) {
            for (let j = 0; j < i; j++) {
                numerator -= Math.sign(X[i] - X[j]);
            }
        }

        // Calculate denominator
        const denominator = 0.5 * this.NET_LENGTH * (this.NET_LENGTH - 1);

        // NET value
        const net = numerator / denominator;

        return net;
    }

    /**
     * AM/FM Decomposition - Separate volatility and timing components
     */
    private performAMFMDecomposition(price: number, state: AMFMState): { volatility: number; timing: number } {
        // Calculate derivative (whitens pink noise spectrum)
        const deriv = state.derivHistory.length > 0 ? price - state.derivHistory[state.derivHistory.length - 1] : 0;
        state.derivHistory.push(deriv);

        if (state.derivHistory.length > 20) {
            state.derivHistory.shift();
        }

        // AM Detection - Extract volatility
        const rectified = Math.abs(deriv);
        state.envelHistory.push(rectified);

        if (state.envelHistory.length > 4) {
            state.envelHistory.shift();
        }

        const envelope = Math.max(...state.envelHistory);
        state.volatilityHistory.push(envelope);

        if (state.volatilityHistory.length > 8) {
            state.volatilityHistory.shift();
        }

        const volatility = state.volatilityHistory.reduce((a, b) => a + b, 0) / state.volatilityHistory.length;

        // FM Detection - Extract timing
        let limited = 10 * deriv;
        if (limited > 1) limited = 1;
        if (limited < -1) limited = -1;

        state.limitedHistory.push(limited);
        if (state.limitedHistory.length > 10) {
            state.limitedHistory.shift();
        }

        // Simple integration for timing signal
        const timing = state.limitedHistory.reduce((a, b) => a + b, 0) / state.limitedHistory.length;

        return { volatility, timing };
    }

    /**
     * Calculate anticipatory signal for turning point prediction
     * Enhanced for early pullback detection
     */
    private calculateAnticipatory(currentValue: number, state: NETState): number {
        if (state.values.length < 8) return 0;

        const recent = state.values.slice(-8);
        const short = recent.slice(-3); // Last 3 values
        const medium = recent.slice(-6, -3); // Previous 3 values
        const longer = recent.slice(-8, -6); // Earlier 2 values

        // Calculate multi-timeframe momentum
        const shortMomentum = short[2] - short[0];
        const mediumMomentum = medium[2] - medium[0];
        const longerTrend = longer[1] - longer[0];

        // Calculate rate of change acceleration
        const recentROC = short[2] - short[1];
        const previousROC = short[1] - short[0];
        const acceleration = recentROC - previousROC;

        // Enhanced anticipatory conditions for pullback detection
        
        // Early bullish pullback signal (buy at the dip)
        if (longerTrend > 0.01 && // Overall uptrend
            mediumMomentum < -0.005 && // Recent pullback
            shortMomentum > 0.002 && // Starting to recover
            acceleration > 0.001 && // Accelerating upward
            currentValue < -0.2) { // Still in oversold territory
            return 1.5; // Strong bullish anticipatory signal
        }

        // Early bearish pullback signal (sell at the peak)
        if (longerTrend < -0.01 && // Overall downtrend
            mediumMomentum > 0.005 && // Recent bounce
            shortMomentum < -0.002 && // Starting to decline
            acceleration < -0.001 && // Accelerating downward
            currentValue > 0.2) { // Still in overbought territory
            return -1.5; // Strong bearish anticipatory signal
        }

        // Medium strength signals for less clear setups
        if (mediumMomentum > 0.003 && shortMomentum < -0.001 && acceleration < -0.0005) {
            return -0.8; // Medium bearish anticipation
        }

        if (mediumMomentum < -0.003 && shortMomentum > 0.001 && acceleration > 0.0005) {
            return 0.8; // Medium bullish anticipation
        }

        // Standard momentum divergence (original logic)
        const trend = recent[recent.length - 1] - recent[0];
        const momentum = recent[recent.length - 1] - recent[recent.length - 2];

        if (trend > 0 && momentum < -0.002) {
            return -0.5; // Standard bearish divergence
        } else if (trend < 0 && momentum > 0.002) {
            return 0.5; // Standard bullish divergence
        }

        return 0; // No clear anticipation
    }

    /**
     * Calculate Signal-to-Noise Ratio
     */
    private calculateSNR(values: number[]): number {
        if (values.length < 10) return 0;

        const signal = this.calculateSignalPower(values);
        const noise = this.calculateNoisePower(values);

        if (noise === 0) return 100; // Perfect signal
        return 10 * Math.log10(signal / noise);
    }

    /**
     * Calculate signal power (cycle component)
     */
    private calculateSignalPower(values: number[]): number {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    }

    /**
     * Calculate noise power (high frequency component)
     */
    private calculateNoisePower(values: number[]): number {
        let noiseSum = 0;
        for (let i = 1; i < values.length; i++) {
            noiseSum += Math.pow(values[i] - values[i - 1], 2);
        }
        return noiseSum / (values.length - 1);
    }

    /**
     * Calculate trend strength
     */
    private calculateTrendStrength(values: number[]): number {
        if (values.length < 10) return 0;

        const recent = values.slice(-10);
        const slope = (recent[recent.length - 1] - recent[0]) / recent.length;
        const avgDeviation = recent.reduce((sum, val, i) => {
            const expected = recent[0] + (slope * i);
            return sum + Math.abs(val - expected);
        }, 0) / recent.length;

        return Math.abs(slope) / (avgDeviation + 0.001); // Avoid division by zero
    }

    /**
     * Get latest signals for a symbol
     */
    getLatestSignals(symbol: string): EhlersSignals | null {
        const symbolSignals = this.signals.get(symbol);
        return symbolSignals ? symbolSignals[symbolSignals.length - 1] : null;
    }

    /**
     * Get signal history for a symbol
     */
    getSignalHistory(symbol: string, count?: number): EhlersSignals[] {
        const symbolSignals = this.signals.get(symbol) || [];
        return count ? symbolSignals.slice(-count) : [...symbolSignals];
    }

    /**
     * Check if market conditions are suitable for cycle trading
     */
    isGoodForCycleTrading(symbol: string): { suitable: boolean; reason: string } {
        const signals = this.getLatestSignals(symbol);
        if (!signals) {
            return { suitable: false, reason: 'No signal data available' };
        }

        // Check SNR threshold (6dB minimum as per Ehlers)
        if (signals.snr < 6) {
            return { suitable: false, reason: `SNR too low: ${signals.snr.toFixed(1)}dB < 6dB` };
        }

        // Check trend strength (avoid trend swamping)
        if (signals.trendStrength > 2) {
            return { suitable: false, reason: `Trend too strong: ${signals.trendStrength.toFixed(2)} > 2.0` };
        }

        return { suitable: true, reason: `Good conditions: SNR=${signals.snr.toFixed(1)}dB, Trend=${signals.trendStrength.toFixed(2)}` };
    }

    /**
     * Generate enhanced trading recommendation with early pullback detection
     */
    generateEhlersRecommendation(symbol: string): {
        action: 'BUY' | 'SELL' | 'HOLD';
        confidence: number;
        reason: string;
        anticipatory: boolean;
        signalStrength: 'weak' | 'medium' | 'strong';
    } {
        const signals = this.getLatestSignals(symbol);
        if (!signals) {
            return { action: 'HOLD', confidence: 0, reason: 'No signal data', anticipatory: false, signalStrength: 'weak' };
        }

        const cycleConditions = this.isGoodForCycleTrading(symbol);
        
        // Enhanced anticipatory signals with multiple strength levels
        if (Math.abs(signals.anticipatorySignal) > 1.2) {
            // Very strong anticipatory signals (pullback detection)
            const action = signals.anticipatorySignal > 0 ? 'BUY' : 'SELL';
            const confidence = Math.min(95, 70 + signals.snr * 4);
            return {
                action,
                confidence,
                reason: `Strong ${action.toLowerCase()} pullback opportunity detected`,
                anticipatory: true,
                signalStrength: 'strong'
            };
        } else if (Math.abs(signals.anticipatorySignal) > 0.7) {
            // Medium strength anticipatory signals
            const action = signals.anticipatorySignal > 0 ? 'BUY' : 'SELL';
            const confidence = Math.min(85, 60 + signals.snr * 3);
            return {
                action,
                confidence,
                reason: `Early ${action.toLowerCase()} momentum shift detected`,
                anticipatory: true,
                signalStrength: 'medium'
            };
        } else if (Math.abs(signals.anticipatorySignal) > 0.4) {
            // Weaker anticipatory signals
            const action = signals.anticipatorySignal > 0 ? 'BUY' : 'SELL';
            const confidence = Math.min(75, 50 + signals.snr * 2);
            return {
                action,
                confidence,
                reason: `Potential ${action.toLowerCase()} setup forming`,
                anticipatory: true,
                signalStrength: 'weak'
            };
        }

        // Fall back to standard signals only if no anticipatory signals
        if (!cycleConditions.suitable) {
            return { action: 'HOLD', confidence: 30, reason: cycleConditions.reason, anticipatory: false, signalStrength: 'weak' };
        }

        // Standard NET signals (delayed but more reliable)
        if (signals.netValue > 0.3) {
            return {
                action: 'BUY',
                confidence: Math.min(75, 40 + signals.snr * 2),
                reason: 'NET bullish confirmation',
                anticipatory: false,
                signalStrength: 'medium'
            };
        } else if (signals.netValue < -0.3) {
            return {
                action: 'SELL',
                confidence: Math.min(75, 40 + signals.snr * 2),
                reason: 'NET bearish confirmation',
                anticipatory: false,
                signalStrength: 'medium'
            };
        }

        return { action: 'HOLD', confidence: 50, reason: 'Neutral signals', anticipatory: false, signalStrength: 'weak' };
    }

    /**
     * Reset all states and history
     */
    reset(): void {
        this.roofingStates.clear();
        this.netStates.clear();
        this.amfmStates.clear();
        this.signals.clear();
    }
}

// Create singleton instance
export const ehlersProcessor = new EhlersSignalProcessor();
