
import { TickData } from './tick-stream-manager';

export interface ScalpingSignal {
    symbol: string;
    action: 'BUY' | 'SELL' | 'HOLD';
    entryPrice: number;
    targetPrice: number;
    stopLoss: number;
    confidence: number;
    reasoning: string;
    timestamp: number;
    duration: number;
    riskReward: number;
    tickMomentum: number;
    volatility: number;
}

export interface ScalpingStats {
    totalSignals: number;
    successfulSignals: number;
    failedSignals: number;
    activeSignals: number;
    winRate: number;
    averageRiskReward: number;
    totalProfit: number;
    averageHoldTime: number;
}

export interface ScalpingConfig {
    minConfidence: number;
    maxRiskReward: number;
    maxHoldTime: number;
    volatilityThreshold: number;
    momentumThreshold: number;
}

class TickScalpingEngine {
    private signals: Map<string, ScalpingSignal[]> = new Map();
    private activeSignals: Map<string, ScalpingSignal> = new Map();
    private stats: ScalpingStats = {
        totalSignals: 0,
        successfulSignals: 0,
        failedSignals: 0,
        activeSignals: 0,
        winRate: 0,
        averageRiskReward: 0,
        totalProfit: 0,
        averageHoldTime: 0
    };
    private config: ScalpingConfig = {
        minConfidence: 70,
        maxRiskReward: 3.0,
        maxHoldTime: 60000, // 60 seconds
        volatilityThreshold: 0.5,
        momentumThreshold: 0.3
    };
    private callbacks: Set<(signal: ScalpingSignal) => void> = new Set();
    private tickHistory: Map<string, TickData[]> = new Map();
    private readonly MAX_TICK_HISTORY = 100;

    constructor() {
        // Initialize engine
        console.log('Tick Scalping Engine initialized');
    }

    /**
     * Process incoming tick data for scalping analysis
     */
    processTick(tick: TickData): void {
        try {
            // Store tick in history
            if (!this.tickHistory.has(tick.symbol)) {
                this.tickHistory.set(tick.symbol, []);
            }
            
            const history = this.tickHistory.get(tick.symbol)!;
            history.push(tick);
            
            // Keep only recent history
            if (history.length > this.MAX_TICK_HISTORY) {
                history.shift();
            }

            // Analyze for scalping opportunities
            this.analyzeScalpingOpportunity(tick);
        } catch (error) {
            console.error('Error processing tick for scalping:', error);
        }
    }

    /**
     * Analyze tick for scalping opportunities
     */
    private analyzeScalpingOpportunity(tick: TickData): void {
        const history = this.tickHistory.get(tick.symbol);
        if (!history || history.length < 10) {
            return; // Need sufficient history
        }

        // Calculate momentum and volatility
        const momentum = this.calculateTickMomentum(history);
        const volatility = this.calculateVolatility(history);
        
        // Check if conditions are met for scalping
        if (Math.abs(momentum) < this.config.momentumThreshold || volatility < this.config.volatilityThreshold) {
            return;
        }

        // Determine signal direction and confidence
        const { action, confidence, reasoning } = this.generateScalpingSignal(history, momentum, volatility);
        
        if (action === 'HOLD' || confidence < this.config.minConfidence) {
            return;
        }

        // Calculate entry, target, and stop loss
        const entryPrice = tick.quote;
        const { targetPrice, stopLoss, riskReward } = this.calculateScalpingLevels(entryPrice, action, volatility);

        // Create scalping signal
        const signal: ScalpingSignal = {
            symbol: tick.symbol,
            action,
            entryPrice,
            targetPrice,
            stopLoss,
            confidence,
            reasoning,
            timestamp: tick.epoch * 1000,
            duration: Math.min(30000, volatility * 100000), // Dynamic duration based on volatility
            riskReward,
            tickMomentum: momentum,
            volatility
        };

        // Store and emit signal
        this.addSignal(signal);
        this.emitSignal(signal);
    }

    /**
     * Calculate tick momentum
     */
    private calculateTickMomentum(history: TickData[]): number {
        if (history.length < 5) return 0;
        
        const recent = history.slice(-5);
        const older = history.slice(-10, -5);
        
        const recentAvg = recent.reduce((sum, tick) => sum + tick.quote, 0) / recent.length;
        const olderAvg = older.reduce((sum, tick) => sum + tick.quote, 0) / older.length;
        
        return (recentAvg - olderAvg) / olderAvg;
    }

    /**
     * Calculate volatility
     */
    private calculateVolatility(history: TickData[]): number {
        if (history.length < 10) return 0;
        
        const prices = history.slice(-10).map(tick => tick.quote);
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        
        return Math.sqrt(variance) / mean;
    }

    /**
     * Generate scalping signal based on analysis
     */
    private generateScalpingSignal(history: TickData[], momentum: number, volatility: number): {
        action: 'BUY' | 'SELL' | 'HOLD';
        confidence: number;
        reasoning: string;
    } {
        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let confidence = 0;
        let reasoning = '';

        // Strong momentum-based signals
        if (momentum > 0.002) {
            action = 'BUY';
            confidence = Math.min(95, 60 + (momentum * 10000));
            reasoning = `Strong upward momentum (${(momentum * 100).toFixed(3)}%) with high volatility`;
        } else if (momentum < -0.002) {
            action = 'SELL';
            confidence = Math.min(95, 60 + (Math.abs(momentum) * 10000));
            reasoning = `Strong downward momentum (${(momentum * 100).toFixed(3)}%) with high volatility`;
        }

        // Volatility confirmation
        if (volatility > 0.001) {
            confidence += 10;
            reasoning += ` - High volatility environment favorable for scalping`;
        }

        // Recent price action confirmation
        const recent5 = history.slice(-5);
        const priceDirection = recent5[recent5.length - 1].quote - recent5[0].quote;
        
        if ((action === 'BUY' && priceDirection > 0) || (action === 'SELL' && priceDirection < 0)) {
            confidence += 5;
            reasoning += ` - Recent price action confirms signal`;
        }

        return { action, confidence: Math.min(95, confidence), reasoning };
    }

    /**
     * Calculate scalping entry, target, and stop loss levels
     */
    private calculateScalpingLevels(entryPrice: number, action: 'BUY' | 'SELL', volatility: number): {
        targetPrice: number;
        stopLoss: number;
        riskReward: number;
    } {
        // Dynamic levels based on volatility
        const baseMove = entryPrice * volatility * 2;
        const targetMove = baseMove * 1.5;
        const stopMove = baseMove * 0.8;

        let targetPrice: number;
        let stopLoss: number;

        if (action === 'BUY') {
            targetPrice = entryPrice + targetMove;
            stopLoss = entryPrice - stopMove;
        } else {
            targetPrice = entryPrice - targetMove;
            stopLoss = entryPrice + stopMove;
        }

        const riskReward = Math.abs(targetPrice - entryPrice) / Math.abs(entryPrice - stopLoss);

        return { targetPrice, stopLoss, riskReward };
    }

    /**
     * Add signal to storage
     */
    private addSignal(signal: ScalpingSignal): void {
        if (!this.signals.has(signal.symbol)) {
            this.signals.set(signal.symbol, []);
        }
        
        const symbolSignals = this.signals.get(signal.symbol)!;
        symbolSignals.push(signal);
        
        // Keep only recent signals
        if (symbolSignals.length > 50) {
            symbolSignals.shift();
        }
        
        // Add to active signals
        this.activeSignals.set(signal.symbol, signal);
        
        // Update stats
        this.stats.totalSignals++;
        this.stats.activeSignals = this.activeSignals.size;
    }

    /**
     * Emit signal to callbacks
     */
    private emitSignal(signal: ScalpingSignal): void {
        this.callbacks.forEach(callback => {
            try {
                callback(signal);
            } catch (error) {
                console.error('Error in scalping signal callback:', error);
            }
        });
    }

    /**
     * Update existing signal with new tick data
     */
    updateSignal(symbol: string, tick: TickData): void {
        const activeSignal = this.activeSignals.get(symbol);
        if (!activeSignal) return;

        const currentTime = tick.epoch * 1000;
        const signalAge = currentTime - activeSignal.timestamp;
        
        // Check if signal has expired
        if (signalAge > activeSignal.duration) {
            this.closeSignal(symbol, 'EXPIRED');
            return;
        }

        // Check if target or stop loss is hit
        const currentPrice = tick.quote;
        
        if (activeSignal.action === 'BUY') {
            if (currentPrice >= activeSignal.targetPrice) {
                this.closeSignal(symbol, 'TARGET_HIT');
                return;
            }
            if (currentPrice <= activeSignal.stopLoss) {
                this.closeSignal(symbol, 'STOP_LOSS');
                return;
            }
        } else if (activeSignal.action === 'SELL') {
            if (currentPrice <= activeSignal.targetPrice) {
                this.closeSignal(symbol, 'TARGET_HIT');
                return;
            }
            if (currentPrice >= activeSignal.stopLoss) {
                this.closeSignal(symbol, 'STOP_LOSS');
                return;
            }
        }
    }

    /**
     * Close active signal
     */
    private closeSignal(symbol: string, reason: 'TARGET_HIT' | 'STOP_LOSS' | 'EXPIRED'): void {
        const signal = this.activeSignals.get(symbol);
        if (!signal) return;

        this.activeSignals.delete(symbol);
        
        // Update stats
        if (reason === 'TARGET_HIT') {
            this.stats.successfulSignals++;
        } else {
            this.stats.failedSignals++;
        }
        
        this.stats.activeSignals = this.activeSignals.size;
        this.stats.winRate = (this.stats.successfulSignals / (this.stats.successfulSignals + this.stats.failedSignals)) * 100;
        
        console.log(`🔄 Scalping signal closed: ${symbol} ${reason}`);
    }

    /**
     * Subscribe to scalping signals
     */
    onScalpingSignal(callback: (signal: ScalpingSignal) => void): () => void {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    /**
     * Get current statistics
     */
    getStats(): ScalpingStats {
        return { ...this.stats };
    }

    /**
     * Get active signals
     */
    getActiveSignals(): ScalpingSignal[] {
        return Array.from(this.activeSignals.values());
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<ScalpingConfig>): void {
        this.config = { ...this.config, ...newConfig };
        console.log('Scalping engine config updated:', this.config);
    }

    /**
     * Close all active signals
     */
    closeAllSignals(): void {
        this.activeSignals.clear();
        this.stats.activeSignals = 0;
        console.log('All scalping signals closed');
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats = {
            totalSignals: 0,
            successfulSignals: 0,
            failedSignals: 0,
            activeSignals: this.activeSignals.size,
            winRate: 0,
            averageRiskReward: 0,
            totalProfit: 0,
            averageHoldTime: 0
        };
        console.log('Scalping engine stats reset');
    }

    /**
     * Get signals for a specific symbol
     */
    getSignals(symbol: string): ScalpingSignal[] {
        return this.signals.get(symbol) || [];
    }

    /**
     * Destroy the engine
     */
    destroy(): void {
        this.callbacks.clear();
        this.signals.clear();
        this.activeSignals.clear();
        this.tickHistory.clear();
        console.log('Tick Scalping Engine destroyed');
    }
}

// Create singleton instance
export const tickScalpingEngine = new TickScalpingEngine();
