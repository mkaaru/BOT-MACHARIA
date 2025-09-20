
import { TickData } from './tick-stream-manager';
import { microCandleEngine, MicroCandleData } from './micro-candle-engine';
import { enhancedEhlersDecycler } from './enhanced-ehlers-decycler';

export interface TickScalpingSignal {
    symbol: string;
    direction: 'RISE' | 'FALL' | 'NEUTRAL';
    confidence: number; // 0-100
    entryReason: string;
    ticksToProfit: number; // Target profit in ticks
    maxLossTicks: number; // Stop loss in ticks
    timestamp: Date;
    method: 'consecutive' | 'micro-candle' | 'indicator' | 'combined';
}

export interface TickScalpingStats {
    symbol: string;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPips: number;
    winRate: number;
    avgWinTicks: number;
    avgLossTicks: number;
    consecutiveWins: number;
    consecutiveLosses: number;
    lastTradeTime: Date;
}

interface TickBuffer {
    ticks: TickData[];
    prices: number[];
    consecutiveDirection: 'up' | 'down' | 'neutral';
    consecutiveCount: number;
    volatility: number;
    lastUpdate: Date;
}

export class TickScalpingEngine {
    private tickBuffers: Map<string, TickBuffer> = new Map();
    private signals: Map<string, TickScalpingSignal> = new Map();
    private stats: Map<string, TickScalpingStats> = new Map();
    private callbacks: Map<string, Set<(signal: TickScalpingSignal) => void>> = new Map();
    
    // Configuration
    private readonly TICK_BUFFER_SIZE = 20;
    private readonly MIN_CONSECUTIVE_TICKS = 3;
    private readonly MAX_CONSECUTIVE_TICKS = 5;
    private readonly TARGET_PROFIT_TICKS = 2; // Small profit target
    private readonly MAX_LOSS_TICKS = 2; // Quick stop loss
    private readonly MIN_VOLATILITY = 0.0001;
    private readonly MAX_VOLATILITY = 0.01;

    constructor() {
        console.log('🚀 Tick Scalping Engine initialized');
    }

    /**
     * Process incoming tick for scalping analysis
     */
    processTick(tick: TickData): void {
        const { symbol } = tick;
        
        // Initialize buffer if needed
        if (!this.tickBuffers.has(symbol)) {
            this.tickBuffers.set(symbol, {
                ticks: [],
                prices: [],
                consecutiveDirection: 'neutral',
                consecutiveCount: 0,
                volatility: 0,
                lastUpdate: new Date()
            });
        }

        const buffer = this.tickBuffers.get(symbol)!;
        
        // Add tick to buffer
        buffer.ticks.push(tick);
        buffer.prices.push(tick.quote);
        buffer.lastUpdate = new Date();

        // Maintain buffer size
        if (buffer.ticks.length > this.TICK_BUFFER_SIZE) {
            buffer.ticks.shift();
            buffer.prices.shift();
        }

        // Only analyze if we have enough data
        if (buffer.ticks.length >= this.MIN_CONSECUTIVE_TICKS) {
            this.updateConsecutiveDirection(buffer);
            this.updateVolatility(buffer);
            this.generateScalpingSignal(symbol, buffer);
        }
    }

    /**
     * Update consecutive tick direction analysis
     */
    private updateConsecutiveDirection(buffer: TickBuffer): void {
        if (buffer.prices.length < 2) return;

        const lastTicks = buffer.prices.slice(-this.MAX_CONSECUTIVE_TICKS);
        let consecutiveUp = 0;
        let consecutiveDown = 0;
        
        // Count consecutive movements
        for (let i = 1; i < lastTicks.length; i++) {
            const current = lastTicks[i];
            const previous = lastTicks[i - 1];
            
            if (current > previous) {
                consecutiveUp++;
                consecutiveDown = 0;
            } else if (current < previous) {
                consecutiveDown++;
                consecutiveUp = 0;
            } else {
                // Equal prices break the streak
                consecutiveUp = 0;
                consecutiveDown = 0;
            }
        }

        // Update buffer state
        if (consecutiveUp >= this.MIN_CONSECUTIVE_TICKS) {
            buffer.consecutiveDirection = 'up';
            buffer.consecutiveCount = consecutiveUp;
        } else if (consecutiveDown >= this.MIN_CONSECUTIVE_TICKS) {
            buffer.consecutiveDirection = 'down';
            buffer.consecutiveCount = consecutiveDown;
        } else {
            buffer.consecutiveDirection = 'neutral';
            buffer.consecutiveCount = 0;
        }
    }

    /**
     * Calculate tick volatility for filtering
     */
    private updateVolatility(buffer: TickBuffer): void {
        if (buffer.prices.length < 5) return;

        const recentPrices = buffer.prices.slice(-10);
        let totalVariation = 0;
        
        for (let i = 1; i < recentPrices.length; i++) {
            const change = Math.abs((recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1]);
            totalVariation += change;
        }
        
        buffer.volatility = totalVariation / (recentPrices.length - 1);
    }

    /**
     * Generate scalping signal based on multiple methods
     */
    private generateScalpingSignal(symbol: string, buffer: TickBuffer): void {
        // Method 1: Consecutive Tick Logic
        const consecutiveSignal = this.getConsecutiveTickSignal(buffer);
        
        // Method 2: Micro-Candle Analysis
        const microCandleSignal = this.getMicroCandleSignal(symbol);
        
        // Method 3: Indicator-Based (using Ehlers Decycler)
        const indicatorSignal = this.getIndicatorSignal(symbol);
        
        // Combine signals for final decision
        const finalSignal = this.combineSignals(symbol, consecutiveSignal, microCandleSignal, indicatorSignal, buffer);
        
        if (finalSignal && finalSignal.direction !== 'NEUTRAL') {
            this.signals.set(symbol, finalSignal);
            this.notifyCallbacks(symbol, finalSignal);
            
            console.log(`🎯 Tick Scalping Signal ${symbol}: ${finalSignal.direction} (${finalSignal.method}) - Confidence: ${finalSignal.confidence}% - ${finalSignal.entryReason}`);
        }
    }

    /**
     * Method 1: Consecutive tick analysis
     */
    private getConsecutiveTickSignal(buffer: TickBuffer): Partial<TickScalpingSignal> | null {
        // Check volatility filter
        if (buffer.volatility < this.MIN_VOLATILITY || buffer.volatility > this.MAX_VOLATILITY) {
            return null;
        }

        if (buffer.consecutiveDirection === 'up' && buffer.consecutiveCount >= this.MIN_CONSECUTIVE_TICKS) {
            return {
                direction: 'RISE',
                confidence: Math.min(95, 50 + (buffer.consecutiveCount * 10)),
                entryReason: `${buffer.consecutiveCount} consecutive rising ticks`,
                method: 'consecutive'
            };
        }

        if (buffer.consecutiveDirection === 'down' && buffer.consecutiveCount >= this.MIN_CONSECUTIVE_TICKS) {
            return {
                direction: 'FALL',
                confidence: Math.min(95, 50 + (buffer.consecutiveCount * 10)),
                entryReason: `${buffer.consecutiveCount} consecutive falling ticks`,
                method: 'consecutive'
            };
        }

        return null;
    }

    /**
     * Method 2: Micro-candle scalping
     */
    private getMicroCandleSignal(symbol: string): Partial<TickScalpingSignal> | null {
        const recentCandles = microCandleEngine.getMicroCandles(symbol, 3);
        if (recentCandles.length < 2) return null;

        const last2Candles = recentCandles.slice(-2);
        const allBullish = last2Candles.every(c => c.direction === 'bullish');
        const allBearish = last2Candles.every(c => c.direction === 'bearish');

        if (allBullish) {
            return {
                direction: 'RISE',
                confidence: 75,
                entryReason: 'Last 2 micro-candles bullish',
                method: 'micro-candle'
            };
        }

        if (allBearish) {
            return {
                direction: 'FALL',
                confidence: 75,
                entryReason: 'Last 2 micro-candles bearish',
                method: 'micro-candle'
            };
        }

        return null;
    }

    /**
     * Method 3: Indicator-based scalping
     */
    private getIndicatorSignal(symbol: string): Partial<TickScalpingSignal> | null {
        if (!enhancedEhlersDecycler.isReady(symbol)) return null;

        const decyclerResults = enhancedEhlersDecycler.getLatestDecyclerResults(symbol);
        
        if (decyclerResults.short && decyclerResults.long) {
            const shortSlope = decyclerResults.short.slope;
            const longSlope = decyclerResults.long.slope;
            
            // Both slopes must agree for scalping
            if (shortSlope > 0.0001 && longSlope > 0) {
                return {
                    direction: 'RISE',
                    confidence: Math.min(90, decyclerResults.short.strength),
                    entryReason: 'Ehlers decycler slopes bullish',
                    method: 'indicator'
                };
            }
            
            if (shortSlope < -0.0001 && longSlope < 0) {
                return {
                    direction: 'FALL',
                    confidence: Math.min(90, decyclerResults.short.strength),
                    entryReason: 'Ehlers decycler slopes bearish',
                    method: 'indicator'
                };
            }
        }

        return null;
    }

    /**
     * Combine multiple signal methods
     */
    private combineSignals(
        symbol: string,
        consecutive: Partial<TickScalpingSignal> | null,
        microCandle: Partial<TickScalpingSignal> | null,
        indicator: Partial<TickScalpingSignal> | null,
        buffer: TickBuffer
    ): TickScalpingSignal | null {
        
        const signals = [consecutive, microCandle, indicator].filter(s => s !== null);
        if (signals.length === 0) return null;

        // Count votes for each direction
        const riseVotes = signals.filter(s => s?.direction === 'RISE').length;
        const fallVotes = signals.filter(s => s?.direction === 'FALL').length;

        let finalDirection: 'RISE' | 'FALL' | 'NEUTRAL' = 'NEUTRAL';
        let confidence = 0;
        let entryReason = '';
        let method: TickScalpingSignal['method'] = 'combined';

        if (riseVotes > fallVotes) {
            finalDirection = 'RISE';
            confidence = Math.round(signals.filter(s => s?.direction === 'RISE').reduce((sum, s) => sum + (s?.confidence || 0), 0) / riseVotes);
            entryReason = `${riseVotes}/${signals.length} methods agree: RISE`;
        } else if (fallVotes > riseVotes) {
            finalDirection = 'FALL';
            confidence = Math.round(signals.filter(s => s?.direction === 'FALL').reduce((sum, s) => sum + (s?.confidence || 0), 0) / fallVotes);
            entryReason = `${fallVotes}/${signals.length} methods agree: FALL`;
        }

        // If only one signal, use its method
        if (signals.length === 1) {
            method = signals[0]?.method || 'combined';
        }

        // Minimum confidence threshold for scalping
        if (confidence < 60) return null;

        return {
            symbol,
            direction: finalDirection,
            confidence,
            entryReason,
            ticksToProfit: this.TARGET_PROFIT_TICKS,
            maxLossTicks: this.MAX_LOSS_TICKS,
            timestamp: new Date(),
            method
        };
    }

    /**
     * Add callback for scalping signals
     */
    addScalpingCallback(symbol: string, callback: (signal: TickScalpingSignal) => void): void {
        if (!this.callbacks.has(symbol)) {
            this.callbacks.set(symbol, new Set());
        }
        this.callbacks.get(symbol)!.add(callback);
    }

    /**
     * Remove callback
     */
    removeScalpingCallback(symbol: string, callback: (signal: TickScalpingSignal) => void): void {
        const callbacks = this.callbacks.get(symbol);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.callbacks.delete(symbol);
            }
        }
    }

    /**
     * Notify callbacks of new signal
     */
    private notifyCallbacks(symbol: string, signal: TickScalpingSignal): void {
        const callbacks = this.callbacks.get(symbol);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(signal);
                } catch (error) {
                    console.error(`Error in scalping callback for ${symbol}:`, error);
                }
            });
        }
    }

    /**
     * Get latest scalping signal for symbol
     */
    getLatestSignal(symbol: string): TickScalpingSignal | null {
        return this.signals.get(symbol) || null;
    }

    /**
     * Update trading statistics
     */
    updateTradeResult(symbol: string, result: 'win' | 'loss', ticks: number): void {
        if (!this.stats.has(symbol)) {
            this.stats.set(symbol, {
                symbol,
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                totalPips: 0,
                winRate: 0,
                avgWinTicks: 0,
                avgLossTicks: 0,
                consecutiveWins: 0,
                consecutiveLosses: 0,
                lastTradeTime: new Date()
            });
        }

        const stats = this.stats.get(symbol)!;
        stats.totalTrades++;
        stats.totalPips += ticks;
        stats.lastTradeTime = new Date();

        if (result === 'win') {
            stats.winningTrades++;
            stats.consecutiveWins++;
            stats.consecutiveLosses = 0;
            stats.avgWinTicks = (stats.avgWinTicks * (stats.winningTrades - 1) + ticks) / stats.winningTrades;
        } else {
            stats.losingTrades++;
            stats.consecutiveLosses++;
            stats.consecutiveWins = 0;
            stats.avgLossTicks = (stats.avgLossTicks * (stats.losingTrades - 1) + Math.abs(ticks)) / stats.losingTrades;
        }

        stats.winRate = (stats.winningTrades / stats.totalTrades) * 100;
        
        console.log(`📊 Scalping Stats ${symbol}: ${stats.winningTrades}W/${stats.losingTrades}L (${stats.winRate.toFixed(1)}%) - Total: ${stats.totalPips.toFixed(1)} ticks`);
    }

    /**
     * Get trading statistics
     */
    getStats(symbol: string): TickScalpingStats | null {
        return this.stats.get(symbol) || null;
    }

    /**
     * Check if symbol is good for scalping based on recent performance
     */
    isGoodForScalping(symbol: string): boolean {
        const stats = this.stats.get(symbol);
        const buffer = this.tickBuffers.get(symbol);

        if (!stats || !buffer) return true; // Allow if no history

        // Check recent performance
        const hasGoodWinRate = stats.winRate >= 55; // At least 55% win rate
        const hasRecentActivity = (Date.now() - stats.lastTradeTime.getTime()) < 5 * 60 * 1000; // Last 5 minutes
        const hasGoodVolatility = buffer.volatility >= this.MIN_VOLATILITY && buffer.volatility <= this.MAX_VOLATILITY;
        const notInLossStreak = stats.consecutiveLosses < 5;

        return hasGoodVolatility && notInLossStreak && (stats.totalTrades < 10 || hasGoodWinRate);
    }

    /**
     * Reset all data and statistics
     */
    reset(): void {
        this.tickBuffers.clear();
        this.signals.clear();
        this.stats.clear();
        console.log('🔄 Tick Scalping Engine reset');
    }

    /**
     * Get current buffer status for debugging
     */
    getBufferStatus(symbol: string): any {
        const buffer = this.tickBuffers.get(symbol);
        if (!buffer) return null;

        return {
            tickCount: buffer.ticks.length,
            consecutiveDirection: buffer.consecutiveDirection,
            consecutiveCount: buffer.consecutiveCount,
            volatility: buffer.volatility.toFixed(6),
            lastPrice: buffer.prices[buffer.prices.length - 1]?.toFixed(5),
            lastUpdate: buffer.lastUpdate
        };
    }
}

// Create singleton instance
export const tickScalpingEngine = new TickScalpingEngine();
