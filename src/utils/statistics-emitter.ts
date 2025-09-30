
export interface TradeResult {
    buy_price?: number;
    sell_price?: number;
    profit?: number;
    currency?: string;
    is_win?: boolean;
    contract_id?: string;
    contract_type?: string;
    symbol?: string;
    stake?: number;
}

export class StatisticsEmitter {
    private static instance: StatisticsEmitter;
    private globalObserver: any;

    constructor() {
        // Get the global observer from the bot skeleton
        this.globalObserver = (window as any).globalObserver || 
                             require('@/external/bot-skeleton/utils/observer').observer;
    }

    static getInstance(): StatisticsEmitter {
        if (!StatisticsEmitter.instance) {
            StatisticsEmitter.instance = new StatisticsEmitter();
        }
        return StatisticsEmitter.instance;
    }

    // Emit trade result to centralized statistics system
    emitTradeResult(tradeResult: TradeResult): void {
        if (this.globalObserver) {
            this.globalObserver.emit('external.trade.result', tradeResult);
        }
    }

    // Emit trade run count
    emitTradeRun(): void {
        if (this.globalObserver) {
            this.globalObserver.emit('external.trade.run');
        }
    }

    // Clear statistics
    clearStatistics(): void {
        if (this.globalObserver) {
            this.globalObserver.emit('statistics.clear');
        }
    }
}

// Export singleton instance
export const statisticsEmitter = StatisticsEmitter.getInstance();
