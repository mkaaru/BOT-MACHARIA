
/**
 * ROC (Rate of Change) Calculator
 * Calculates the rate of change over a specified period
 */

export class ROCCalculator {
    private prices: number[] = [];
    private period: number;

    constructor(period: number = 2) {
        this.period = period;
    }

    /**
     * Add a new price and calculate ROC
     */
    addPrice(price: number): { roc: number; direction: 'UP' | 'DOWN' | 'NEUTRAL' } {
        this.prices.push(price);

        // Keep only the prices we need
        if (this.prices.length > this.period + 1) {
            this.prices.shift();
        }

        // Need at least period + 1 prices to calculate ROC
        if (this.prices.length < this.period + 1) {
            return { roc: 0, direction: 'NEUTRAL' };
        }

        const currentPrice = this.prices[this.prices.length - 1];
        const previousPrice = this.prices[this.prices.length - 1 - this.period];

        // ROC formula: ((Current - Previous) / Previous) * 100
        const roc = ((currentPrice - previousPrice) / previousPrice) * 100;

        let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
        if (roc > 0.001) {
            direction = 'UP';
        } else if (roc < -0.001) {
            direction = 'DOWN';
        }

        return { roc, direction };
    }

    /**
     * Get current ROC value and direction
     */
    getCurrentROC(): { roc: number; direction: 'UP' | 'DOWN' | 'NEUTRAL' } {
        if (this.prices.length < this.period + 1) {
            return { roc: 0, direction: 'NEUTRAL' };
        }

        const currentPrice = this.prices[this.prices.length - 1];
        const previousPrice = this.prices[this.prices.length - 1 - this.period];

        const roc = ((currentPrice - previousPrice) / previousPrice) * 100;

        let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
        if (roc > 0.001) {
            direction = 'UP';
        } else if (roc < -0.001) {
            direction = 'DOWN';
        }

        return { roc, direction };
    }

    /**
     * Reset the calculator
     */
    reset(): void {
        this.prices = [];
    }

    /**
     * Set the period
     */
    setPeriod(period: number): void {
        this.period = period;
        this.reset();
    }
}

// Singleton instance for each symbol
const rocCalculators = new Map<string, ROCCalculator>();

export const getROCCalculator = (symbol: string, period: number = 2): ROCCalculator => {
    const key = `${symbol}_${period}`;
    if (!rocCalculators.has(key)) {
        rocCalculators.set(key, new ROCCalculator(period));
    }
    return rocCalculators.get(key)!;
};
