
import { TickData } from './tick-stream-manager';
import { TrendAnalysis } from './trend-analysis-engine';

export interface ScalpingSignal {
    symbol: string;
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    entryPrice: number;
    targetPrice: number;
    stopLoss: number;
    duration: number; // in seconds
    reasoning: string;
    timestamp: number;
    riskReward: number;
    tickMomentum: number;
    volatility: number;
}

export interface ScalpingConfig {
    minConfidence: number;
    maxRiskPerTrade: number;
    targetTickProfit: number; // in ticks
    stopLossDistance: number; // in ticks
    maxPositionDuration: number; // in seconds
    enabledSymbols: string[];
    minimumVolatility: number;
    maximumVolatility: number;
}

export interface ScalpingStats {
    totalSignals: number;
    successfulTrades: number;
    failedTrades: number;
    winRate: number;
    averageProfit: number;
    currentPositions: number;
    lastSignalTime: Date;
}

export class TickScalpingEngine {
    private tickHistory: Map<string, TickData[]> = new Map();
    private activeSignals: Map<string, ScalpingSignal> = new Map();
    private scalpingCallbacks: Set<(signal: ScalpingSignal) => void> = new Set();
    private statsCallbacks: Set<(stats: ScalpingStats) => void> = new Set();
    private stats: ScalpingStats;
    private readonly MAX_TICK_HISTORY = 100;
    private readonly TICK_SIZE = 0.00001; // Standard pip size

    private config: ScalpingConfig = {
        minConfidence: 75,
        maxRiskPerTrade: 1.0,
        targetTickProfit: 5,
        stopLossDistance: 3,
        maxPositionDuration: 300, // 5 minutes
        enabledSymbols: ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'],
        minimumVolatility: 0.0001,
        maximumVolatility: 0.01
    };

    constructor() {
        this.stats = {
            totalSignals: 0,
            successfulTrades: 0,
            failedTrades: 0,
            winRate: 0,
            averageProfit: 0,
            currentPositions: 0,
            lastSignalTime: new Date()
        };

        // Clean up expired signals every 30 seconds
        setInterval(() => this.cleanupExpiredSignals(), 30000);
    }

    /**
     * Process incoming tick data for scalping analysis
     */
    processTick(tick: TickData): void {
        if (!this.config.enabledSymbols.includes(tick.symbol)) {
            return;
        }

        // Store tick history
        if (!this.tickHistory.has(tick.symbol)) {
            this.tickHistory.set(tick.symbol, []);
        }

        const history = this.tickHistory.get(tick.symbol)!;
        history.push(tick);

        // Keep only recent ticks
        if (history.length > this.MAX_TICK_HISTORY) {
            history.shift();
        }

        // Analyze for scalping opportunities
        if (history.length >= 20) { // Need minimum history
            this.analyzeScalpingOpportunity(tick.symbol, history);
        }
    }

    /**
     * Analyze tick data for scalping opportunities
     */
    private analyzeScalpingOpportunity(symbol: string, ticks: TickData[]): void {
        // Skip if we already have an active signal for this symbol
        if (this.activeSignals.has(symbol)) {
            return;
        }

        const analysis = this.calculateTickMetrics(ticks);
        if (!analysis) return;

        const signal = this.generateScalpingSignal(symbol, ticks, analysis);
        if (signal && signal.confidence >= this.config.minConfidence) {
            this.activeSignals.set(symbol, signal);
            this.stats.totalSignals++;
            this.stats.currentPositions++;
            this.stats.lastSignalTime = new Date();

            console.log(`🎯 TICK SCALPING SIGNAL: ${symbol} - ${signal.action} at ${signal.entryPrice} (Confidence: ${signal.confidence}%)`);
            
            // Notify callbacks
            this.scalpingCallbacks.forEach(callback => {
                try {
                    callback(signal);
                } catch (error) {
                    console.error('Error in scalping callback:', error);
                }
            });

            this.updateStats();
        }
    }

    /**
     * Calculate tick-level metrics for scalping analysis
     */
    private calculateTickMetrics(ticks: TickData[]): {
        tickMomentum: number;
        volatility: number;
        priceDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
        momentumStrength: number;
        tickVelocity: number;
        priceAcceleration: number;
    } | null {
        if (ticks.length < 20) return null;

        const recent10 = ticks.slice(-10);
        const recent5 = ticks.slice(-5);
        const recent3 = ticks.slice(-3);

        // Calculate price changes
        const changes = recent10.map((tick, i) => 
            i > 0 ? tick.quote - recent10[i-1].quote : 0
        ).slice(1);

        // Tick momentum (rate of price change)
        const totalChange = recent10[recent10.length - 1].quote - recent10[0].quote;
        const tickMomentum = totalChange / recent10.length;

        // Volatility (standard deviation of changes)
        const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
        const variance = changes.reduce((acc, change) => acc + Math.pow(change - avgChange, 2), 0) / changes.length;
        const volatility = Math.sqrt(variance);

        // Price direction analysis
        const upTicks = changes.filter(c => c > 0).length;
        const downTicks = changes.filter(c => c < 0).length;
        const directionBias = upTicks > downTicks ? 'UP' : downTicks > upTicks ? 'DOWN' : 'SIDEWAYS';

        // Momentum strength (consistency of direction)
        const momentumStrength = Math.abs(upTicks - downTicks) / changes.length * 100;

        // Tick velocity (speed of recent price changes)
        const recent5Changes = recent5.map((tick, i) => 
            i > 0 ? Math.abs(tick.quote - recent5[i-1].quote) : 0
        ).slice(1);
        const tickVelocity = recent5Changes.reduce((a, b) => a + b, 0) / recent5Changes.length;

        // Price acceleration (change in velocity)
        const recent3Changes = recent3.map((tick, i) => 
            i > 0 ? Math.abs(tick.quote - recent3[i-1].quote) : 0
        ).slice(1);
        const recentVelocity = recent3Changes.reduce((a, b) => a + b, 0) / recent3Changes.length;
        const priceAcceleration = recentVelocity - tickVelocity;

        return {
            tickMomentum,
            volatility,
            priceDirection: directionBias,
            momentumStrength,
            tickVelocity,
            priceAcceleration
        };
    }

    /**
     * Generate scalping signal based on tick analysis
     */
    private generateScalpingSignal(symbol: string, ticks: TickData[], analysis: any): ScalpingSignal | null {
        const currentTick = ticks[ticks.length - 1];
        const currentPrice = currentTick.quote;

        // Check volatility bounds
        if (analysis.volatility < this.config.minimumVolatility || 
            analysis.volatility > this.config.maximumVolatility) {
            return null;
        }

        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let confidence = 0;
        let reasoning = '';

        // BULLISH SCALPING CONDITIONS
        if (analysis.priceDirection === 'UP' && 
            analysis.momentumStrength > 60 && 
            analysis.tickMomentum > 0 &&
            analysis.priceAcceleration > 0) {
            
            action = 'BUY';
            confidence = Math.min(95, 60 + analysis.momentumStrength * 0.5);
            reasoning = `Strong upward tick momentum: ${analysis.momentumStrength.toFixed(1)}% consistency, acceleration: ${(analysis.priceAcceleration * 10000).toFixed(2)} pips`;
        }
        // BEARISH SCALPING CONDITIONS
        else if (analysis.priceDirection === 'DOWN' && 
                 analysis.momentumStrength > 60 && 
                 analysis.tickMomentum < 0 &&
                 analysis.priceAcceleration > 0) {
            
            action = 'SELL';
            confidence = Math.min(95, 60 + analysis.momentumStrength * 0.5);
            reasoning = `Strong downward tick momentum: ${analysis.momentumStrength.toFixed(1)}% consistency, acceleration: ${(analysis.priceAcceleration * 10000).toFixed(2)} pips`;
        }
        // BREAKOUT SCALPING
        else if (analysis.tickVelocity > analysis.volatility * 2 && 
                 analysis.momentumStrength > 70) {
            
            action = analysis.priceDirection === 'UP' ? 'BUY' : 'SELL';
            confidence = Math.min(90, 50 + analysis.momentumStrength * 0.6);
            reasoning = `Breakout detected: High velocity (${(analysis.tickVelocity * 10000).toFixed(2)} pips/tick) with ${analysis.momentumStrength.toFixed(1)}% momentum`;
        }

        if (action === 'HOLD') return null;

        // Calculate target and stop loss
        const tickSize = this.TICK_SIZE;
        const targetDistance = this.config.targetTickProfit * tickSize;
        const stopDistance = this.config.stopLossDistance * tickSize;

        const targetPrice = action === 'BUY' ? 
            currentPrice + targetDistance : 
            currentPrice - targetDistance;

        const stopLoss = action === 'BUY' ? 
            currentPrice - stopDistance : 
            currentPrice + stopDistance;

        const riskReward = targetDistance / stopDistance;

        return {
            symbol,
            action,
            confidence,
            entryPrice: currentPrice,
            targetPrice,
            stopLoss,
            duration: this.config.maxPositionDuration,
            reasoning,
            timestamp: Date.now(),
            riskReward,
            tickMomentum: analysis.tickMomentum,
            volatility: analysis.volatility
        };
    }

    /**
     * Update signal based on new tick data
     */
    updateSignal(symbol: string, tick: TickData): void {
        const signal = this.activeSignals.get(symbol);
        if (!signal) return;

        const currentPrice = tick.quote;
        const timeElapsed = Date.now() - signal.timestamp;

        // Check if target hit
        if ((signal.action === 'BUY' && currentPrice >= signal.targetPrice) ||
            (signal.action === 'SELL' && currentPrice <= signal.targetPrice)) {
            
            console.log(`✅ SCALPING TARGET HIT: ${symbol} - Profit achieved at ${currentPrice}`);
            this.closeSignal(symbol, true);
            return;
        }

        // Check if stop loss hit
        if ((signal.action === 'BUY' && currentPrice <= signal.stopLoss) ||
            (signal.action === 'SELL' && currentPrice >= signal.stopLoss)) {
            
            console.log(`❌ SCALPING STOP LOSS: ${symbol} - Stop loss hit at ${currentPrice}`);
            this.closeSignal(symbol, false);
            return;
        }

        // Check if duration expired
        if (timeElapsed > signal.duration * 1000) {
            console.log(`⏰ SCALPING TIMEOUT: ${symbol} - Duration expired`);
            this.closeSignal(symbol, false);
            return;
        }
    }

    /**
     * Close an active signal
     */
    private closeSignal(symbol: string, successful: boolean): void {
        this.activeSignals.delete(symbol);
        this.stats.currentPositions--;
        
        if (successful) {
            this.stats.successfulTrades++;
        } else {
            this.stats.failedTrades++;
        }
        
        this.updateStats();
    }

    /**
     * Clean up expired signals
     */
    private cleanupExpiredSignals(): void {
        const now = Date.now();
        for (const [symbol, signal] of this.activeSignals.entries()) {
            if (now - signal.timestamp > signal.duration * 1000) {
                console.log(`🧹 Cleaning up expired signal: ${symbol}`);
                this.closeSignal(symbol, false);
            }
        }
    }

    /**
     * Update statistics
     */
    private updateStats(): void {
        const totalTrades = this.stats.successfulTrades + this.stats.failedTrades;
        this.stats.winRate = totalTrades > 0 ? (this.stats.successfulTrades / totalTrades) * 100 : 0;
        
        // Notify stats callbacks
        this.statsCallbacks.forEach(callback => {
            try {
                callback(this.stats);
            } catch (error) {
                console.error('Error in stats callback:', error);
            }
        });
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<ScalpingConfig>): void {
        this.config = { ...this.config, ...newConfig };
        console.log('Scalping configuration updated:', this.config);
    }

    /**
     * Add callback for scalping signals
     */
    onScalpingSignal(callback: (signal: ScalpingSignal) => void): () => void {
        this.scalpingCallbacks.add(callback);
        return () => this.scalpingCallbacks.delete(callback);
    }

    /**
     * Add callback for statistics updates
     */
    onStatsUpdate(callback: (stats: ScalpingStats) => void): () => void {
        this.statsCallbacks.add(callback);
        return () => this.statsCallbacks.delete(callback);
    }

    /**
     * Get current active signals
     */
    getActiveSignals(): ScalpingSignal[] {
        return Array.from(this.activeSignals.values());
    }

    /**
     * Get current statistics
     */
    getStats(): ScalpingStats {
        return { ...this.stats };
    }

    /**
     * Get current configuration
     */
    getConfig(): ScalpingConfig {
        return { ...this.config };
    }

    /**
     * Force close all active signals
     */
    closeAllSignals(): void {
        console.log(`Closing ${this.activeSignals.size} active scalping signals`);
        this.activeSignals.clear();
        this.stats.currentPositions = 0;
        this.updateStats();
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats = {
            totalSignals: 0,
            successfulTrades: 0,
            failedTrades: 0,
            winRate: 0,
            averageProfit: 0,
            currentPositions: this.activeSignals.size,
            lastSignalTime: new Date()
        };
        this.updateStats();
    }
}

// Create singleton instance
export const tickScalpingEngine = new TickScalpingEngine();
