
import { EfficientHMACalculator } from './efficient-hma-calculator';

export interface EhlersSignals {
    roofingFilter: number;
    netValue: number;
    volatility: number; // AM component
    timing: number; // FM component
    anticipatorySignal: number;
    snr: number; // Signal to noise ratio
    trendStrength: number;
    // Enhanced Ehlers signals
    trend: number;
    cycle: number;
    noise: number;
    phase: number;
    amplitude: number;
    power: number;
    signalQuality: number;
    dominantCycle: number;
    instantaneousTrendline: number;
    decycler: number;
}

export interface DerivMarketConfig {
    market: 'rise_fall' | 'higher_lower';
    duration: number; // Duration in ticks (1-10 for rise/fall, 15+ for higher/lower)
    contractType: 'RISE' | 'FALL' | 'HIGHER' | 'LOWER';
    minConfidence: number;
    maxDrawdown: number;
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

export interface HilbertState {
    prices: number[];
    smoothPrices: number[];
    detrender: number[];
    q1: number[];
    i1: number[];
    jI: number[];
    jQ: number[];
    i2: number[];
    q2: number[];
    re: number[];
    im: number[];
    period: number[];
    smoothPeriod: number[];
    phase: number[];
    deltaPhase: number[];
    instTrendline: number[];
    trendline: number[];
    decycler: number[];
}

/**
 * Enhanced Ehlers Signal Processing Engine with Advanced Market Analysis
 * Implements John Ehlers' complete signal processing suite optimized for Deriv markets
 */
export class EhlersSignalProcessor {
    private roofingStates: Map<string, RoofingFilterState> = new Map();
    private netStates: Map<string, NETState> = new Map();
    private amfmStates: Map<string, AMFMState> = new Map();
    private hilbertStates: Map<string, HilbertState> = new Map();
    private signals: Map<string, EhlersSignals[]> = new Map();
    
    private readonly ROOFING_PERIOD = 20;
    private readonly NET_LENGTH = 14;
    private readonly MAX_HISTORY = 200;
    
    // Adaptive thresholds based on market volatility
    private adaptiveThresholds = {
        trendStrength: 0.0001,  // Very sensitive for short-term markets
        phaseChange: 0.1,
        signalQuality: 60,
        noiseThreshold: 0.0005
    };

    /**
     * Process price data through enhanced Ehlers signal processing pipeline
     */
    processPrice(symbol: string, price: number, timestamp: Date): EhlersSignals {
        // Initialize states if needed
        if (!this.roofingStates.has(symbol)) {
            this.initializeStates(symbol);
        }

        const roofingState = this.roofingStates.get(symbol)!;
        const netState = this.netStates.get(symbol)!;
        const amfmState = this.amfmStates.get(symbol)!;
        const hilbertState = this.hilbertStates.get(symbol)!;

        // Add price to history
        hilbertState.prices.push(price);
        if (hilbertState.prices.length > this.MAX_HISTORY) {
            hilbertState.prices.shift();
        }

        // Step 1: Apply Roofing Filter to remove spectral dilation
        const roofingValue = this.applyRoofingFilter(price, roofingState);

        // Step 2: Apply NET (Noise Elimination Technology)
        const netValue = this.applyNET(roofingValue, netState);

        // Step 3: AM/FM Decomposition
        const { volatility, timing } = this.performAMFMDecomposition(price, amfmState);

        // Step 4: Enhanced Hilbert Transform Analysis
        let enhancedSignals: Partial<EhlersSignals> = {};
        if (hilbertState.prices.length >= 50) {
            enhancedSignals = this.calculateHilbertTransform(hilbertState);
        }

        // Step 5: Calculate anticipatory signals
        const anticipatorySignal = this.calculateAnticipatory(netValue, netState, enhancedSignals);

        // Step 6: Calculate signal quality metrics
        const snr = this.calculateSNR(netState.values);
        const trendStrength = this.calculateTrendStrength(netState.values);

        // Adjust adaptive thresholds
        this.adjustAdaptiveThresholds(symbol);

        const signals: EhlersSignals = {
            roofingFilter: roofingValue,
            netValue,
            volatility,
            timing,
            anticipatorySignal,
            snr,
            trendStrength,
            // Enhanced signals from Hilbert Transform
            trend: enhancedSignals.trend || 0,
            cycle: enhancedSignals.cycle || 0,
            noise: enhancedSignals.noise || 0,
            phase: enhancedSignals.phase || 0,
            amplitude: enhancedSignals.amplitude || 0,
            power: enhancedSignals.power || 0,
            signalQuality: enhancedSignals.signalQuality || 0,
            dominantCycle: enhancedSignals.dominantCycle || 20,
            instantaneousTrendline: enhancedSignals.instantaneousTrendline || price,
            decycler: enhancedSignals.decycler || price
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

        console.log(`🔬 Enhanced Ehlers Processing ${symbol}: NET=${netValue.toFixed(4)}, Trend=${signals.trend.toFixed(4)}, Cycle=${signals.cycle.toFixed(4)}, Quality=${signals.signalQuality.toFixed(1)}`);

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

        this.hilbertStates.set(symbol, {
            prices: [],
            smoothPrices: [],
            detrender: [],
            q1: [],
            i1: [],
            jI: [],
            jQ: [],
            i2: [],
            q2: [],
            re: [],
            im: [],
            period: [],
            smoothPeriod: [],
            phase: [],
            deltaPhase: [],
            instTrendline: [],
            trendline: [],
            decycler: []
        });
    }

    /**
     * Enhanced Roofing Filter with configurable parameters
     */
    private applyRoofingFilter(price: number, state: RoofingFilterState, highpass: number = 40, lowpass: number = 10): number {
        // 2nd Order HighPass Filter
        const alpha1 = (Math.cos(0.25 * Math.PI / highpass) + Math.sin(0.25 * Math.PI / highpass) - 1) / Math.cos(0.25 * Math.PI / highpass);
        const hp = (1 - alpha1 / 2) * (1 - alpha1 / 2) * (price - 2 * (state.hp1 || price) + (state.hp2 || price)) + 
                   2 * (1 - alpha1) * (state.hp1 || 0) - (1 - alpha1) * (1 - alpha1) * (state.hp2 || 0);
        
        state.hp2 = state.hp1 || 0;
        state.hp1 = hp;

        // SuperSmoother (removes aliasing noise)
        const a1 = Math.exp(-1.414 * Math.PI / lowpass);
        const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / lowpass);
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
     * Advanced Hilbert Transform Discriminator for comprehensive cycle analysis
     */
    private calculateHilbertTransform(hilbertState: HilbertState): Partial<EhlersSignals> {
        const prices = hilbertState.prices;
        const n = prices.length;
        
        if (n < 50) {
            return {};
        }

        // Apply roofing filter first
        const roofed = this.calculateRoofingFilterArray(prices, 40, 10);
        
        // Calculate Hilbert Transform components
        for (let i = 6; i < n; i++) {
            // Detrend
            hilbertState.detrender[i] = 0.0962 * roofed[i] + 0.5769 * roofed[i - 2] - 
                              0.5769 * roofed[i - 4] - 0.0962 * roofed[i - 6];
            
            // Compute InPhase and Quadrature components
            hilbertState.q1[i] = 0.0962 * hilbertState.detrender[i] + 0.5769 * hilbertState.detrender[i - 2] - 
                       0.5769 * hilbertState.detrender[i - 4] - 0.0962 * hilbertState.detrender[i - 6];
            hilbertState.i1[i] = hilbertState.detrender[i - 3];
            
            // Advance the phase of I1 and Q1 by 90 degrees
            hilbertState.jI[i] = 0.0962 * hilbertState.i1[i] + 0.5769 * hilbertState.i1[i - 2] - 
                       0.5769 * hilbertState.i1[i - 4] - 0.0962 * hilbertState.i1[i - 6];
            hilbertState.jQ[i] = 0.0962 * hilbertState.q1[i] + 0.5769 * hilbertState.q1[i - 2] - 
                       0.5769 * hilbertState.q1[i - 4] - 0.0962 * hilbertState.q1[i - 6];
            
            // Phasor addition for 3 bar averaging
            hilbertState.i2[i] = hilbertState.i1[i] - hilbertState.jQ[i];
            hilbertState.q2[i] = hilbertState.q1[i] + hilbertState.jI[i];
            
            // Smooth the I and Q components
            hilbertState.i2[i] = 0.2 * hilbertState.i2[i] + 0.8 * (hilbertState.i2[i - 1] || 0);
            hilbertState.q2[i] = 0.2 * hilbertState.q2[i] + 0.8 * (hilbertState.q2[i - 1] || 0);
            
            // Homodyne Discriminator
            hilbertState.re[i] = hilbertState.i2[i] * (hilbertState.i2[i - 1] || 0) + hilbertState.q2[i] * (hilbertState.q2[i - 1] || 0);
            hilbertState.im[i] = hilbertState.i2[i] * (hilbertState.q2[i - 1] || 0) - hilbertState.q2[i] * (hilbertState.i2[i - 1] || 0);
            
            hilbertState.re[i] = 0.2 * hilbertState.re[i] + 0.8 * (hilbertState.re[i - 1] || 0);
            hilbertState.im[i] = 0.2 * hilbertState.im[i] + 0.8 * (hilbertState.im[i - 1] || 0);
            
            // Calculate period
            if (hilbertState.im[i] !== 0 && hilbertState.re[i] !== 0) {
                hilbertState.period[i] = 360 / Math.atan(hilbertState.im[i] / hilbertState.re[i]);
            }
            
            // Constrain period to reasonable range
            if (hilbertState.period[i] > 50) hilbertState.period[i] = 50;
            if (hilbertState.period[i] < 10) hilbertState.period[i] = 10;
            
            // Smooth period
            hilbertState.smoothPeriod[i] = 0.2 * hilbertState.period[i] + 0.8 * (hilbertState.smoothPeriod[i - 1] || 20);
            
            // Calculate phase
            if (hilbertState.i1[i] !== 0) {
                hilbertState.phase[i] = Math.atan(hilbertState.q1[i] / hilbertState.i1[i]);
            }
            
            // Calculate instantaneous trendline
            hilbertState.instTrendline[i] = (roofed[i] + 2 * (roofed[i - 1] || 0) + 
                                   2 * (roofed[i - 2] || 0) + (roofed[i - 3] || 0)) / 6;
            
            hilbertState.trendline[i] = 0.25 * hilbertState.instTrendline[i] + 0.75 * (hilbertState.trendline[i - 1] || roofed[i]);
        }

        // Calculate decycler
        hilbertState.decycler = this.calculateDecycler(prices, 20);
        
        const lastIndex = n - 1;
        const amplitude = Math.sqrt(Math.pow(hilbertState.i2[lastIndex] || 0, 2) + Math.pow(hilbertState.q2[lastIndex] || 0, 2));
        const power = Math.pow(amplitude, 2);
        
        // Signal quality assessment
        const signalQuality = this.calculateSignalQuality(roofed, hilbertState.smoothPeriod[lastIndex] || 20);
        
        return {
            trend: hilbertState.trendline[lastIndex] || 0,
            cycle: roofed[lastIndex] - (hilbertState.trendline[lastIndex] || 0),
            noise: roofed[lastIndex] - (hilbertState.instTrendline[lastIndex] || 0),
            phase: hilbertState.phase[lastIndex] || 0,
            amplitude: amplitude,
            power: power,
            signalQuality: signalQuality,
            dominantCycle: hilbertState.smoothPeriod[lastIndex] || 20,
            instantaneousTrendline: hilbertState.instTrendline[lastIndex] || 0,
            decycler: hilbertState.decycler[lastIndex] || 0
        };
    }

    /**
     * Decycler - removes cycle components, keeps trend
     */
    private calculateDecycler(prices: number[], highpass: number = 20): number[] {
        const decycler: number[] = [];
        const alpha = 1 / (highpass * Math.sqrt(2) + 1);
        
        for (let i = 0; i < prices.length; i++) {
            if (i < 2) {
                decycler[i] = prices[i];
                continue;
            }
            
            decycler[i] = alpha * (prices[i] + prices[i - 1]) / 2 + 
                          (1 - alpha) * decycler[i - 1];
        }
        
        return decycler;
    }

    /**
     * Calculate roofing filter for array of prices
     */
    private calculateRoofingFilterArray(prices: number[], highpass: number = 40, lowpass: number = 10): number[] {
        const roofed: number[] = [];
        
        // First apply high-pass filter
        const alpha1 = (Math.cos(0.25 * Math.PI / highpass) + Math.sin(0.25 * Math.PI / highpass) - 1) /
                       Math.cos(0.25 * Math.PI / highpass);
        
        const hp: number[] = [];
        for (let i = 0; i < prices.length; i++) {
            if (i < 2) {
                hp[i] = 0;
                continue;
            }
            
            hp[i] = 0.5 * (1 + alpha1) * (prices[i] - prices[i - 1]) + 
                    alpha1 * hp[i - 1];
        }
        
        // Then apply Super Smoother (low-pass)
        const a1 = Math.exp(-1.414 * Math.PI / lowpass);
        const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / lowpass);
        const c2 = b1;
        const c3 = -a1 * a1;
        const c1 = 1 - c2 - c3;
        
        for (let i = 0; i < hp.length; i++) {
            if (i < 2) {
                roofed[i] = hp[i];
                continue;
            }
            
            roofed[i] = c1 * (hp[i] + hp[i - 1]) / 2 + 
                        c2 * roofed[i - 1] + 
                        c3 * roofed[i - 2];
        }
        
        return roofed;
    }

    /**
     * Enhanced anticipatory signal calculation with Hilbert Transform data
     */
    private calculateAnticipatory(currentValue: number, state: NETState, enhancedSignals: Partial<EhlersSignals>): number {
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

        // Enhanced anticipatory conditions using Hilbert Transform data
        let anticipatorySignal = 0;

        // Use cycle and phase information if available
        if (enhancedSignals.cycle !== undefined && enhancedSignals.phase !== undefined) {
            const cycleStrength = Math.abs(enhancedSignals.cycle);
            const normalizedPhase = ((enhancedSignals.phase + Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
            
            // Cycle-based anticipatory signals
            if (cycleStrength > 0.0001) {
                if (normalizedPhase < 0.25 && longerTrend > 0.01) {
                    anticipatorySignal += 1.0; // Bottom of cycle in uptrend
                } else if (normalizedPhase > 0.75 && longerTrend < -0.01) {
                    anticipatorySignal -= 1.0; // Top of cycle in downtrend
                }
            }
        }

        // Original logic enhanced
        // Early bullish pullback signal (buy at the dip)
        if (longerTrend > 0.01 && // Overall uptrend
            mediumMomentum < -0.005 && // Recent pullback
            shortMomentum > 0.002 && // Starting to recover
            acceleration > 0.001 && // Accelerating upward
            currentValue < -0.2) { // Still in oversold territory
            anticipatorySignal += 1.5; // Strong bullish anticipatory signal
        }

        // Early bearish pullback signal (sell at the peak)
        if (longerTrend < -0.01 && // Overall downtrend
            mediumMomentum > 0.005 && // Recent bounce
            shortMomentum < -0.002 && // Starting to decline
            acceleration < -0.001 && // Accelerating downward
            currentValue > 0.2) { // Still in overbought territory
            anticipatorySignal -= 1.5; // Strong bearish anticipatory signal
        }

        // Medium strength signals for less clear setups
        if (mediumMomentum > 0.003 && shortMomentum < -0.001 && acceleration < -0.0005) {
            anticipatorySignal -= 0.8; // Medium bearish anticipation
        }

        if (mediumMomentum < -0.003 && shortMomentum > 0.001 && acceleration > 0.0005) {
            anticipatorySignal += 0.8; // Medium bullish anticipation
        }

        // Standard momentum divergence (original logic)
        const trend = recent[recent.length - 1] - recent[0];
        const momentum = recent[recent.length - 1] - recent[recent.length - 2];

        if (trend > 0 && momentum < -0.002) {
            anticipatorySignal -= 0.5; // Standard bearish divergence
        } else if (trend < 0 && momentum > 0.002) {
            anticipatorySignal += 0.5; // Standard bullish divergence
        }

        return anticipatorySignal;
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
     * Enhanced signal quality calculation
     */
    private calculateSignalQuality(prices: number[], period: number): number {
        const n = Math.floor(period);
        if (prices.length < n) return 0;
        
        const recent = prices.slice(-n);
        const variance = this.calculateVariance(recent);
        const trend = this.calculateLinearRegression(recent);
        
        // Higher quality when trend is strong and variance is low relative to trend
        const trendStrength = Math.abs(trend.slope * n);
        const relativeNoise = variance > 0 ? trendStrength / Math.sqrt(variance) : 0;
        
        return Math.min(100, Math.max(0, relativeNoise * 20));
    }

    private calculateVariance(values: number[]): number {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    }

    private calculateLinearRegression(values: number[]): { slope: number, intercept: number } {
        const n = values.length;
        const sumX = (n * (n - 1)) / 2;
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = values.reduce((acc, val, idx) => acc + idx * val, 0);
        const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        return { slope, intercept };
    }

    /**
     * Adjust adaptive thresholds based on market volatility
     */
    private adjustAdaptiveThresholds(symbol: string): void {
        const hilbertState = this.hilbertStates.get(symbol);
        if (!hilbertState || hilbertState.prices.length < 20) return;
        
        // Calculate recent volatility
        const recentPrices = hilbertState.prices.slice(-20);
        const returns = recentPrices.slice(1).map((price, idx) => 
            (price - recentPrices[idx]) / recentPrices[idx]
        );
        
        const volatility = Math.sqrt(
            returns.reduce((acc, ret) => acc + ret * ret, 0) / returns.length
        );
        
        // Adjust thresholds based on volatility
        this.adaptiveThresholds.trendStrength = Math.max(0.00005, volatility * 0.1);
        this.adaptiveThresholds.noiseThreshold = volatility * 0.5;
        this.adaptiveThresholds.signalQuality = Math.max(40, 60 - volatility * 1000);
    }

    /**
     * Generate Deriv-optimized trading signal
     */
    generateDerivSignal(symbol: string, config: DerivMarketConfig): {
        action: 'RISE' | 'FALL' | 'HIGHER' | 'LOWER' | 'WAIT';
        confidence: number;
        reasoning: string;
        expectedDirection: number; // -1 to 1
        timeframe: number;
    } {
        const signals = this.getLatestSignals(symbol);
        const signalHistory = this.getSignalHistory(symbol, 10);
        
        if (!signals || signalHistory.length < 5) {
            return {
                action: 'WAIT',
                confidence: 0,
                reasoning: 'Insufficient data for analysis',
                expectedDirection: 0,
                timeframe: config.duration
            };
        }

        const previousSignals = signalHistory[signalHistory.length - 2];
        
        // Multi-factor analysis
        const trendAnalysis = this.analyzeTrend(signals, previousSignals);
        const cycleAnalysis = this.analyzeCycle(signals);
        const phaseAnalysis = this.analyzePhase(signals, previousSignals);
        const noiseAnalysis = this.analyzeNoise(signals);
        
        // Combine all factors
        let confidence = 0;
        let expectedDirection = 0;
        let reasoning = '';
        
        // Trend component (40% weight)
        if (Math.abs(trendAnalysis.strength) > this.adaptiveThresholds.trendStrength) {
            confidence += Math.min(40, Math.abs(trendAnalysis.strength) * 100000) * 0.4;
            expectedDirection += trendAnalysis.direction * 0.4;
            reasoning += `Trend: ${trendAnalysis.direction > 0 ? 'Bullish' : 'Bearish'} (${(trendAnalysis.strength * 100).toFixed(4)}%). `;
        }
        
        // Cycle component (25% weight)
        if (cycleAnalysis.isSignificant) {
            confidence += cycleAnalysis.confidence * 0.25;
            expectedDirection += cycleAnalysis.direction * 0.25;
            reasoning += `Cycle: ${cycleAnalysis.phase} phase. `;
        }
        
        // Phase analysis (25% weight)
        if (phaseAnalysis.isSignificant) {
            confidence += phaseAnalysis.confidence * 0.25;
            expectedDirection += phaseAnalysis.direction * 0.25;
            reasoning += `Phase: ${phaseAnalysis.momentum}. `;
        }
        
        // Noise filter (10% weight - reduces confidence if noise is high)
        const noiseReduction = (100 - noiseAnalysis.level) * 0.1;
        confidence = Math.max(0, confidence - (100 - noiseReduction));
        
        // Signal quality filter
        if (signals.signalQuality < this.adaptiveThresholds.signalQuality) {
            confidence *= (signals.signalQuality / this.adaptiveThresholds.signalQuality);
            reasoning += `Signal quality: ${signals.signalQuality.toFixed(1)}%. `;
        }
        
        // Market-specific adjustments
        if (config.market === 'rise_fall') {
            // More aggressive for short-term markets
            confidence *= 1.2;
            expectedDirection *= 1.1;
        }
        
        // Determine action based on expected direction and confidence
        let action: 'RISE' | 'FALL' | 'HIGHER' | 'LOWER' | 'WAIT' = 'WAIT';
        
        if (confidence >= config.minConfidence) {
            if (config.market === 'rise_fall') {
                action = expectedDirection > 0.1 ? 'RISE' : expectedDirection < -0.1 ? 'FALL' : 'WAIT';
            } else {
                action = expectedDirection > 0.15 ? 'HIGHER' : expectedDirection < -0.15 ? 'LOWER' : 'WAIT';
            }
        }
        
        return {
            action,
            confidence: Math.min(100, confidence),
            reasoning: reasoning.trim() || 'Neutral market conditions',
            expectedDirection: Math.max(-1, Math.min(1, expectedDirection)),
            timeframe: config.duration
        };
    }

    private analyzeTrend(current: EhlersSignals, previous: EhlersSignals): {
        strength: number;
        direction: number;
    } {
        const trendChange = current.trend - previous.trend;
        const decyclerTrend = current.decycler - previous.decycler;
        
        // Combine instantaneous trend with decycler trend
        const combinedTrend = (trendChange + decyclerTrend) / 2;
        
        return {
            strength: Math.abs(combinedTrend),
            direction: combinedTrend > 0 ? 1 : -1
        };
    }

    private analyzeCycle(current: EhlersSignals): {
        isSignificant: boolean;
        direction: number;
        phase: string;
        confidence: number;
    } {
        const cycleStrength = Math.abs(current.cycle);
        const isSignificant = cycleStrength > this.adaptiveThresholds.trendStrength * 2;
        
        // Determine cycle phase
        let phase = 'neutral';
        let direction = 0;
        
        if (isSignificant) {
            const normalizedPhase = ((current.phase + Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
            
            if (normalizedPhase < 0.25) {
                phase = 'bottom';
                direction = 1; // Expect rise
            } else if (normalizedPhase < 0.75) {
                phase = 'top';
                direction = -1; // Expect fall
            }
        }
        
        return {
            isSignificant,
            direction,
            phase,
            confidence: isSignificant ? Math.min(100, cycleStrength * 200000) : 0
        };
    }

    private analyzePhase(current: EhlersSignals, previous: EhlersSignals): {
        isSignificant: boolean;
        direction: number;
        momentum: string;
        confidence: number;
    } {
        const phaseChange = current.phase - previous.phase;
        const isSignificant = Math.abs(phaseChange) > this.adaptiveThresholds.phaseChange;
        
        let momentum = 'stable';
        let direction = 0;
        
        if (isSignificant) {
            if (phaseChange > 0) {
                momentum = 'accelerating';
                direction = 1;
            } else {
                momentum = 'decelerating';
                direction = -1;
            }
        }
        
        return {
            isSignificant,
            direction,
            momentum,
            confidence: isSignificant ? Math.min(100, Math.abs(phaseChange) * 100) : 0
        };
    }

    private analyzeNoise(current: EhlersSignals): { level: number } {
        const noiseLevel = Math.abs(current.noise);
        return {
            level: Math.min(100, noiseLevel * 500000) // Convert to percentage
        };
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

        // Check signal quality
        if (signals.signalQuality < 50) {
            return { suitable: false, reason: `Signal quality too low: ${signals.signalQuality.toFixed(1)}% < 50%` };
        }

        return { suitable: true, reason: `Good conditions: SNR=${signals.snr.toFixed(1)}dB, Trend=${signals.trendStrength.toFixed(2)}, Quality=${signals.signalQuality.toFixed(1)}%` };
    }

    /**
     * Generate enhanced trading recommendation with Deriv market optimization
     */
    generateEhlersRecommendation(symbol: string, config?: DerivMarketConfig): {
        action: 'BUY' | 'SELL' | 'HOLD';
        confidence: number;
        reason: string;
        anticipatory: boolean;
        signalStrength: 'weak' | 'medium' | 'strong';
    } {
        if (config) {
            const derivSignal = this.generateDerivSignal(symbol, config);
            return {
                action: derivSignal.action === 'RISE' || derivSignal.action === 'HIGHER' ? 'BUY' :
                        derivSignal.action === 'FALL' || derivSignal.action === 'LOWER' ? 'SELL' : 'HOLD',
                confidence: derivSignal.confidence,
                reason: derivSignal.reasoning,
                anticipatory: Math.abs(derivSignal.expectedDirection) > 0.5,
                signalStrength: derivSignal.confidence > 80 ? 'strong' : derivSignal.confidence > 60 ? 'medium' : 'weak'
            };
        }

        // Fallback to original logic
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
        this.hilbertStates.clear();
        this.signals.clear();
    }
}

// Create singleton instance
export const ehlersProcessor = new EhlersSignalProcessor();
