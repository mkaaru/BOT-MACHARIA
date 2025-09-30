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
    private observer: any; // Added to match the changes snippet

    constructor() {
        // Get the global observer from the bot skeleton
        this.globalObserver = (window as any).globalObserver || 
                             require('@/external/bot-skeleton/utils/observer').observer;
        this.observer = this.globalObserver; // Assign to observer to match changes snippet
    }

    static getInstance(): StatisticsEmitter {
        if (!StatisticsEmitter.instance) {
            StatisticsEmitter.instance = new StatisticsEmitter();
        }
        return StatisticsEmitter.instance;
    }

    // Emit trade result for statistics tracking
    emitTradeResult(contract: any) {
        const tradeData = {
            contract_id: contract.contract_id || Date.now(),
            sell_price: contract.sell_price,
            buy_price: contract.buy_price,
            profit: contract.profit,
            currency: contract.currency,
            is_win: contract.profit > 0,
            is_completed: true,
            contract_type: contract.contract_type || 'CALL',
            underlying: contract.underlying || 'R_50',
            date_start: contract.date_start || new Date().toISOString(),
            transaction_ids: {
                buy: contract.contract_id || Date.now(),
                sell: contract.contract_id ? contract.contract_id + 1 : Date.now() + 1
            }
        };

        console.log('📊 Emitting trade result with full contract data:', tradeData);
        this.observer.emit('external.trade.result', tradeData);
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