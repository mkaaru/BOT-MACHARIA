/**
 * Real-Time Trend Monitor
 * 
 * Continuously monitors tick stream and detects trend changes in real-time
 * Analyzes 12-tick candles to determine if market is trending UP or DOWN
 * Emits trend change events when direction reverses
 */

import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface TrendAnalysis {
    direction: TrendDirection;
    strength: number; // 0-100
    confidence: number; // 0-100
    recentTicks: number[];
    priceChange: number;
    timestamp: number;
}

type TrendChangeCallback = (analysis: TrendAnalysis) => void;

class RealTimeTrendMonitor {
    private api: any = null;
    private subscriptions: Map<string, any> = new Map();
    private tickBuffers: Map<string, number[]> = new Map();
    private currentTrends: Map<string, TrendAnalysis> = new Map();
    private callbacks: TrendChangeCallback[] = [];
    
    private readonly TICK_WINDOW = 12; // Analyze 12-tick candles
    private readonly TREND_THRESHOLD = 0.0001; // Minimum price change to confirm trend

    /**
     * Start monitoring a symbol for trend changes
     */
    async startMonitoring(symbol: string): Promise<void> {
        // Stop existing monitoring for this symbol
        this.stopMonitoring(symbol);

        console.log(`📈 Starting real-time trend monitoring for ${symbol}`);

        if (!this.api) {
            this.api = generateDerivApiInstance();
        }

        // Initialize tick buffer
        this.tickBuffers.set(symbol, []);

        // Subscribe to tick stream
        const subscription = this.api.subscribe({
            ticks: symbol,
            subscribe: 1
        });

        subscription.subscribe(
            (response: any) => {
                if (response.tick) {
                    this.processTick(symbol, response.tick.quote);
                }
            },
            (error: any) => {
                console.error(`❌ Tick subscription error for ${symbol}:`, error);
            }
        );

        this.subscriptions.set(symbol, subscription);
    }

    /**
     * Stop monitoring a symbol
     */
    stopMonitoring(symbol: string): void {
        const subscription = this.subscriptions.get(symbol);
        if (subscription) {
            subscription.unsubscribe();
            this.subscriptions.delete(symbol);
            console.log(`⏹️ Stopped trend monitoring for ${symbol}`);
        }
        
        this.tickBuffers.delete(symbol);
        this.currentTrends.delete(symbol);
    }

    /**
     * Stop all monitoring
     */
    stopAll(): void {
        for (const symbol of this.subscriptions.keys()) {
            this.stopMonitoring(symbol);
        }
    }

    /**
     * Process incoming tick and analyze trend
     */
    private processTick(symbol: string, price: number): void {
        const buffer = this.tickBuffers.get(symbol) || [];
        
        // Add new tick to buffer
        buffer.push(price);

        // Keep only last N ticks for analysis
        if (buffer.length > this.TICK_WINDOW) {
            buffer.shift();
        }

        this.tickBuffers.set(symbol, buffer);

        // Only analyze when we have enough ticks
        if (buffer.length >= this.TICK_WINDOW) {
            const analysis = this.analyzeTrend(symbol, buffer);
            
            // Check if trend changed
            const previousTrend = this.currentTrends.get(symbol);
            if (!previousTrend || previousTrend.direction !== analysis.direction) {
                console.log(`🔄 Trend change detected for ${symbol}: ${previousTrend?.direction || 'UNKNOWN'} → ${analysis.direction}`);
                
                // Emit trend change to callbacks
                this.callbacks.forEach(cb => cb(analysis));
            }

            this.currentTrends.set(symbol, analysis);
        }
    }

    /**
     * Analyze trend from tick buffer
     */
    private analyzeTrend(symbol: string, ticks: number[]): TrendAnalysis {
        const firstPrice = ticks[0];
        const lastPrice = ticks[ticks.length - 1];
        const priceChange = lastPrice - firstPrice;
        const percentChange = (priceChange / firstPrice) * 100;

        // Calculate trend strength using linear regression
        const strength = this.calculateTrendStrength(ticks);
        
        // Determine direction
        let direction: TrendDirection = 'NEUTRAL';
        if (Math.abs(priceChange) > this.TREND_THRESHOLD) {
            direction = priceChange > 0 ? 'BULLISH' : 'BEARISH';
        }

        // Calculate confidence based on consistency
        const confidence = this.calculateConfidence(ticks, direction);

        return {
            direction,
            strength,
            confidence,
            recentTicks: [...ticks],
            priceChange: percentChange,
            timestamp: Date.now()
        };
    }

    /**
     * Calculate trend strength using price momentum
     */
    private calculateTrendStrength(ticks: number[]): number {
        if (ticks.length < 2) return 0;

        let upMoves = 0;
        let downMoves = 0;
        let totalMoves = 0;

        for (let i = 1; i < ticks.length; i++) {
            const change = ticks[i] - ticks[i - 1];
            if (change > 0) upMoves++;
            else if (change < 0) downMoves++;
            totalMoves++;
        }

        // Strength is how consistent the moves are in one direction
        const dominantMoves = Math.max(upMoves, downMoves);
        return Math.min(100, (dominantMoves / totalMoves) * 100);
    }

    /**
     * Calculate confidence based on trend consistency
     */
    private calculateConfidence(ticks: number[], direction: TrendDirection): number {
        if (direction === 'NEUTRAL') return 50;

        let consistentMoves = 0;
        let totalMoves = 0;

        for (let i = 1; i < ticks.length; i++) {
            const change = ticks[i] - ticks[i - 1];
            totalMoves++;

            if (direction === 'BULLISH' && change > 0) consistentMoves++;
            else if (direction === 'BEARISH' && change < 0) consistentMoves++;
        }

        return Math.min(100, (consistentMoves / totalMoves) * 100);
    }

    /**
     * Get current trend for a symbol
     */
    getCurrentTrend(symbol: string): TrendAnalysis | null {
        return this.currentTrends.get(symbol) || null;
    }

    /**
     * Subscribe to trend changes
     */
    onTrendChange(callback: TrendChangeCallback): () => void {
        this.callbacks.push(callback);
        
        // Return unsubscribe function
        return () => {
            const index = this.callbacks.indexOf(callback);
            if (index > -1) {
                this.callbacks.splice(index, 1);
            }
        };
    }

    /**
     * Get recommended action based on current trend
     */
    getRecommendedAction(symbol: string): 'RISE' | 'FALL' | null {
        const trend = this.getCurrentTrend(symbol);
        if (!trend || trend.confidence < 60) return null;

        return trend.direction === 'BULLISH' ? 'RISE' : 'FALL';
    }
}

export const realTimeTrendMonitor = new RealTimeTrendMonitor();
