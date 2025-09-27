
export interface TradeResult {
    symbol: string;
    direction: 'CALL' | 'PUT';
    stake: number;
    profit: number;
    confidence: number;
    timestamp: number;
    duration: number;
    qualityFactors: string[];
    marketConditions: {
        volatility: number;
        trend: string;
        timeOfDay: number;
    };
}

export interface PerformanceMetrics {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    avgProfit: number;
    avgLoss: number;
    maxDrawdown: number;
    bestPerformingConditions: string[];
    worstPerformingConditions: string[];
}

class PerformanceTracker {
    private trades: TradeResult[] = [];
    private readonly MAX_HISTORY = 1000;

    addTrade(trade: TradeResult): void {
        this.trades.push(trade);
        
        // Maintain history limit
        if (this.trades.length > this.MAX_HISTORY) {
            this.trades = this.trades.slice(-this.MAX_HISTORY);
        }

        // Auto-analyze after every 10 trades
        if (this.trades.length % 10 === 0) {
            this.analyzePerformance();
        }
    }

    getMetrics(period: 'today' | 'week' | 'month' | 'all' = 'all'): PerformanceMetrics {
        const filteredTrades = this.filterTradesByPeriod(period);
        
        if (filteredTrades.length === 0) {
            return this.getEmptyMetrics();
        }

        const wins = filteredTrades.filter(t => t.profit > 0);
        const losses = filteredTrades.filter(t => t.profit < 0);

        const totalProfit = wins.reduce((sum, t) => sum + t.profit, 0);
        const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0));

        return {
            totalTrades: filteredTrades.length,
            winRate: wins.length / filteredTrades.length,
            profitFactor: totalLoss > 0 ? totalProfit / totalLoss : 0,
            avgProfit: wins.length > 0 ? totalProfit / wins.length : 0,
            avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
            maxDrawdown: this.calculateMaxDrawdown(filteredTrades),
            bestPerformingConditions: this.findBestConditions(filteredTrades),
            worstPerformingConditions: this.findWorstConditions(filteredTrades)
        };
    }

    private analyzePerformance(): void {
        const recent20 = this.trades.slice(-20);
        const metrics = this.getMetrics('all');

        console.log('📊 Performance Analysis:');
        console.log(`Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`);
        console.log(`Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
        console.log(`Best Conditions: ${metrics.bestPerformingConditions.join(', ')}`);
        
        // Adaptive recommendations
        if (metrics.winRate < 0.4) {
            console.log('⚠️ Low win rate detected - Consider increasing quality thresholds');
        }
        
        if (metrics.profitFactor < 1.2) {
            console.log('⚠️ Poor profit factor - Review risk management');
        }
    }

    private filterTradesByPeriod(period: string): TradeResult[] {
        const now = Date.now();
        let cutoff = 0;

        switch (period) {
            case 'today':
                cutoff = now - (24 * 60 * 60 * 1000);
                break;
            case 'week':
                cutoff = now - (7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                cutoff = now - (30 * 24 * 60 * 60 * 1000);
                break;
            default:
                return this.trades;
        }

        return this.trades.filter(t => t.timestamp > cutoff);
    }

    private calculateMaxDrawdown(trades: TradeResult[]): number {
        let peak = 0;
        let maxDrawdown = 0;
        let runningTotal = 0;

        for (const trade of trades) {
            runningTotal += trade.profit;
            if (runningTotal > peak) {
                peak = runningTotal;
            }
            const drawdown = peak - runningTotal;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        return maxDrawdown;
    }

    private findBestConditions(trades: TradeResult[]): string[] {
        const conditionPerformance = new Map<string, { wins: number; total: number }>();

        trades.forEach(trade => {
            trade.qualityFactors.forEach(factor => {
                if (!conditionPerformance.has(factor)) {
                    conditionPerformance.set(factor, { wins: 0, total: 0 });
                }
                const stats = conditionPerformance.get(factor)!;
                stats.total++;
                if (trade.profit > 0) stats.wins++;
            });
        });

        return Array.from(conditionPerformance.entries())
            .filter(([_, stats]) => stats.total >= 5) // Minimum sample size
            .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))
            .slice(0, 3)
            .map(([condition, _]) => condition);
    }

    private findWorstConditions(trades: TradeResult[]): string[] {
        const conditionPerformance = new Map<string, { wins: number; total: number }>();

        trades.forEach(trade => {
            trade.qualityFactors.forEach(factor => {
                if (!conditionPerformance.has(factor)) {
                    conditionPerformance.set(factor, { wins: 0, total: 0 });
                }
                const stats = conditionPerformance.get(factor)!;
                stats.total++;
                if (trade.profit > 0) stats.wins++;
            });
        });

        return Array.from(conditionPerformance.entries())
            .filter(([_, stats]) => stats.total >= 5)
            .sort((a, b) => (a[1].wins / a[1].total) - (b[1].wins / b[1].total))
            .slice(0, 3)
            .map(([condition, _]) => condition);
    }

    private getEmptyMetrics(): PerformanceMetrics {
        return {
            totalTrades: 0,
            winRate: 0,
            profitFactor: 0,
            avgProfit: 0,
            avgLoss: 0,
            maxDrawdown: 0,
            bestPerformingConditions: [],
            worstPerformingConditions: []
        };
    }
}

export const performanceTracker = new PerformanceTracker();
