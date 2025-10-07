
/**
 * ROC-based Trade Executor
 * Executes trades based on 2-period Rate of Change indicator
 * Trades continue while ROC direction matches, stops when ROC changes direction
 */

export interface ROCTradeConfig {
    symbol: string;
    stake: number;
    duration: number;
    duration_unit: string;
    roc_period: number;
}

export class ROCTradeExecutor {
    private previousROC: number | null = null;
    private currentDirection: 'CALL' | 'PUT' | null = null;
    private isActive: boolean = false;
    private tickHistory: number[] = [];

    constructor(private config: ROCTradeConfig) {}

    /**
     * Calculate Rate of Change
     */
    private calculateROC(prices: number[], period: number = 2): number | null {
        if (prices.length < period + 1) return null;
        
        const currentPrice = prices[prices.length - 1];
        const previousPrice = prices[prices.length - 1 - period];
        
        if (previousPrice === 0) return null;
        
        const roc = ((currentPrice - previousPrice) / previousPrice) * 100;
        return roc;
    }

    /**
     * Get ROC direction
     */
    private getROCDirection(roc: number): 'CALL' | 'PUT' {
        return roc > 0 ? 'CALL' : 'PUT';
    }

    /**
     * Check if ROC direction has changed
     */
    private hasROCDirectionChanged(currentROC: number): boolean {
        if (this.previousROC === null) return false;
        
        const previousDirection = this.getROCDirection(this.previousROC);
        const currentDirection = this.getROCDirection(currentROC);
        
        return previousDirection !== currentDirection;
    }

    /**
     * Process new tick and determine trade action
     */
    processTick(tickValue: number): {
        shouldTrade: boolean;
        shouldStop: boolean;
        direction: 'CALL' | 'PUT' | null;
        roc: number | null;
    } {
        this.tickHistory.push(tickValue);
        
        // Keep only necessary history
        if (this.tickHistory.length > 20) {
            this.tickHistory.shift();
        }

        const roc = this.calculateROC(this.tickHistory, this.config.roc_period);

        if (roc === null) {
            return { shouldTrade: false, shouldStop: false, direction: null, roc: null };
        }

        const rocDirection = this.getROCDirection(roc);
        
        // Check if ROC direction has changed
        if (this.previousROC !== null && this.hasROCDirectionChanged(roc)) {
            this.isActive = false;
            this.currentDirection = null;
            this.previousROC = roc;
            return { 
                shouldTrade: false, 
                shouldStop: true, 
                direction: null, 
                roc 
            };
        }

        // Update state
        this.previousROC = roc;
        this.currentDirection = rocDirection;

        return {
            shouldTrade: true,
            shouldStop: false,
            direction: rocDirection,
            roc
        };
    }

    /**
     * Start ROC-based trading
     */
    start() {
        this.isActive = true;
        this.tickHistory = [];
        this.previousROC = null;
        this.currentDirection = null;
    }

    /**
     * Stop trading
     */
    stop() {
        this.isActive = false;
        this.currentDirection = null;
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            currentDirection: this.currentDirection,
            previousROC: this.previousROC
        };
    }

    /**
     * Reset executor
     */
    reset() {
        this.tickHistory = [];
        this.previousROC = null;
        this.currentDirection = null;
        this.isActive = false;
    }
}

export default ROCTradeExecutor;
