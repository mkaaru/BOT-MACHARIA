import { ScannerRecommendation } from './deriv-volatility-scanner';

export interface AutoTradeConfig {
    enabled: boolean;
    stake_amount: number;
    min_confidence: number;
    max_trades_per_hour: number;
    stop_loss_threshold: number;
    take_profit_threshold: number;
    cooldown_period_seconds: number;
}

export type DerivContractType = 'CALL' | 'PUT' | 'CALLE' | 'PUTE';
export type ContractMode = 'EQUALS' | 'PLAIN';

export interface ContractStrategyState {
    mode: ContractMode;
    consecutive_losses: number;
}

export interface ContractConfig {
    deriv_contract_type: DerivContractType;
    display_label: string;
    mode: ContractMode;
}

export interface AutoTradeResult {
    contract_id: string;
    symbol: string;
    contract_type: 'CALL' | 'PUT';
    deriv_contract_type: DerivContractType;
    entry_price: number;
    stake: number;
    payout: number;
    profit: number;
    status: 'open' | 'won' | 'lost';
    timestamp: number;
    recommendation: ScannerRecommendation;
    contract_mode: ContractMode;
}

export interface AutoTradeStats {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    active_trades: number;
    total_profit: number;
    win_rate: number;
    avg_profit: number;
    trades_this_hour: number;
    last_trade_time: number;
}

class MLAutoTrader {
    private config: AutoTradeConfig = {
        enabled: false,
        stake_amount: 1.0,
        min_confidence: 75,
        max_trades_per_hour: 20,
        stop_loss_threshold: -50,
        take_profit_threshold: 100,
        cooldown_period_seconds: 30
    };

    private stats: AutoTradeStats = {
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        active_trades: 0,
        total_profit: 0,
        win_rate: 0,
        avg_profit: 0,
        trades_this_hour: 0,
        last_trade_time: 0
    };

    private trade_history: AutoTradeResult[] = [];
    private active_contracts: Map<string, AutoTradeResult> = new Map();
    private last_recommendation: ScannerRecommendation | null = null;
    private last_traded_symbols: Set<string> = new Set();
    private symbol_rotation_index: number = 0;
    
    // Contract strategy state per direction
    private strategy_state: {
        RISE: ContractStrategyState;
        FALL: ContractStrategyState;
    } = {
        RISE: { mode: 'EQUALS', consecutive_losses: 0 },
        FALL: { mode: 'EQUALS', consecutive_losses: 0 }
    };
    
    private status_callback: ((status: string) => void) | null = null;
    private stats_callback: ((stats: AutoTradeStats) => void) | null = null;
    private trade_callback: ((trade: AutoTradeResult) => void) | null = null;

    constructor() {
        this.resetHourlyTradeCount();
    }

    private resetHourlyTradeCount() {
        setInterval(() => {
            this.stats.trades_this_hour = 0;
        }, 3600000);
    }

    public configure(config: Partial<AutoTradeConfig>) {
        this.config = { ...this.config, ...config };
    }

    public getConfig(): AutoTradeConfig {
        return { ...this.config };
    }

    public getStats(): AutoTradeStats {
        return { ...this.stats };
    }

    public getTradeHistory(): AutoTradeResult[] {
        return [...this.trade_history];
    }

    public getActiveContracts(): AutoTradeResult[] {
        return Array.from(this.active_contracts.values());
    }

    public getStrategyState(): { RISE: ContractStrategyState; FALL: ContractStrategyState } {
        return { ...this.strategy_state };
    }

    public getNextContractConfig(recommendation: ScannerRecommendation): ContractConfig {
        const direction = recommendation.action as 'RISE' | 'FALL';
        const state = this.strategy_state[direction];
        
        let deriv_contract_type: DerivContractType;
        let display_label: string;
        
        if (state.mode === 'EQUALS') {
            // Equals mode: RISE → PUTE, FALL → CALLE
            if (direction === 'RISE') {
                deriv_contract_type = 'PUTE';
                display_label = 'Rise Equals';
            } else {
                deriv_contract_type = 'CALLE';
                display_label = 'Fall Equals';
            }
        } else {
            // Plain mode: RISE → PUT, FALL → CALL
            if (direction === 'RISE') {
                deriv_contract_type = 'PUT';
                display_label = 'Rise';
            } else {
                deriv_contract_type = 'CALL';
                display_label = 'Fall';
            }
        }
        
        return {
            deriv_contract_type,
            display_label,
            mode: state.mode
        };
    }

    public onStatusUpdate(callback: (status: string) => void) {
        this.status_callback = callback;
    }

    public onStatsUpdate(callback: (stats: AutoTradeStats) => void) {
        this.stats_callback = callback;
    }

    public onTradeComplete(callback: (trade: AutoTradeResult) => void) {
        this.trade_callback = callback;
    }

    private updateStatus(status: string) {
        console.log('[ML Auto Trader]', status);
        if (this.status_callback) {
            this.status_callback(status);
        }
    }

    private updateStats() {
        this.stats.win_rate = this.stats.total_trades > 0 
            ? (this.stats.winning_trades / this.stats.total_trades) * 100 
            : 0;
        this.stats.avg_profit = this.stats.total_trades > 0 
            ? this.stats.total_profit / this.stats.total_trades 
            : 0;
        
        if (this.stats_callback) {
            this.stats_callback(this.getStats());
        }
    }

    public shouldExecuteTrade(recommendation: ScannerRecommendation): boolean {
        if (!this.config.enabled) {
            return false;
        }

        if (recommendation.confidence < this.config.min_confidence) {
            this.updateStatus(`❌ Skipping trade: Confidence ${recommendation.confidence}% below threshold ${this.config.min_confidence}%`);
            return false;
        }

        if (this.stats.trades_this_hour >= this.config.max_trades_per_hour) {
            this.updateStatus(`⏸️ Max trades per hour reached (${this.config.max_trades_per_hour})`);
            return false;
        }

        const now = Date.now();
        const timeSinceLastTrade = (now - this.stats.last_trade_time) / 1000;
        if (timeSinceLastTrade < this.config.cooldown_period_seconds) {
            const remaining = Math.ceil(this.config.cooldown_period_seconds - timeSinceLastTrade);
            this.updateStatus(`⏳ Cooldown: ${remaining}s remaining`);
            return false;
        }

        if (this.stats.total_profit <= this.config.stop_loss_threshold) {
            this.updateStatus(`🛑 Stop loss triggered: Total P/L ${this.stats.total_profit.toFixed(2)}`);
            this.config.enabled = false;
            return false;
        }

        if (this.config.take_profit_threshold > 0 && this.stats.total_profit >= this.config.take_profit_threshold) {
            this.updateStatus(`🎯 Take profit triggered: Total P/L ${this.stats.total_profit.toFixed(2)}`);
            this.config.enabled = false;
            return false;
        }

        // Only prevent duplicate trades if we have an active contract on this symbol/direction
        for (const [_, contract] of this.active_contracts) {
            if (contract.symbol === recommendation.symbol && 
                contract.contract_type === (recommendation.action === 'RISE' ? 'PUT' : 'CALL') &&
                contract.status === 'open') {
                this.updateStatus(`↻ Active contract already exists for ${recommendation.symbol} ${recommendation.action}, skipping`);
                return false;
            }
        }

        // Symbol rotation: If recently traded this symbol, prefer different ones
        if (this.last_traded_symbols.has(recommendation.symbol) && this.last_traded_symbols.size < 5) {
            this.updateStatus(`🔄 Recently traded ${recommendation.symbol}, waiting for symbol rotation`);
            return false;
        }

        return true;
    }

    public registerTrade(recommendation: ScannerRecommendation, contract_id: string, entry_price: number, payout: number, deriv_contract_type: DerivContractType, contract_mode: ContractMode) {
        // Track traded symbol for rotation
        this.last_traded_symbols.add(recommendation.symbol);
        
        // Clear old symbols after 5 trades
        if (this.last_traded_symbols.size > 3) {
            const oldestSymbol = Array.from(this.last_traded_symbols)[0];
            this.last_traded_symbols.delete(oldestSymbol);
        }

        const trade: AutoTradeResult = {
            contract_id,
            symbol: recommendation.symbol,
            contract_type: recommendation.action === 'RISE' ? 'CALL' : 'PUT',
            deriv_contract_type,
            entry_price,
            stake: this.config.stake_amount,
            payout,
            profit: 0,
            status: 'open',
            timestamp: Date.now(),
            recommendation,
            contract_mode
        };

        this.active_contracts.set(contract_id, trade);
        this.last_recommendation = recommendation;
        this.stats.last_trade_time = Date.now();
        this.stats.trades_this_hour++;
        this.stats.active_trades++;
        this.stats.total_trades++;

        const modeLabel = contract_mode === 'EQUALS' ? '(Equals)' : '(Plain)';
        this.updateStatus(`✅ Trade opened: ${deriv_contract_type} ${modeLabel} on ${recommendation.displayName} | Stake: ${this.config.stake_amount}`);
        this.updateStats();
    }

    public updateTradeResult(contract_id: string, profit: number, status: 'won' | 'lost') {
        const trade = this.active_contracts.get(contract_id);
        if (!trade) return;

        trade.profit = profit;
        trade.status = status;

        const direction = trade.recommendation.action as 'RISE' | 'FALL';
        const state = this.strategy_state[direction];

        this.active_contracts.delete(contract_id);
        this.trade_history.unshift(trade);
        
        if (this.trade_history.length > 100) {
            this.trade_history.pop();
        }

        this.stats.active_trades--;
        this.stats.total_profit += profit;

        if (status === 'won') {
            this.stats.winning_trades++;
            this.updateStatus(`🎉 Trade WON: ${trade.symbol} ${trade.deriv_contract_type} | Profit: +${profit.toFixed(2)}`);
            
            // On win: Reset to EQUALS mode
            state.mode = 'EQUALS';
            state.consecutive_losses = 0;
            this.updateStatus(`🔄 ${direction} strategy reset to EQUALS mode after win`);
        } else {
            this.stats.losing_trades++;
            this.updateStatus(`😞 Trade LOST: ${trade.symbol} ${trade.deriv_contract_type} | Loss: ${profit.toFixed(2)}`);
            
            // On loss: Increment streak and flip mode
            state.consecutive_losses++;
            const oldMode = state.mode;
            state.mode = state.mode === 'EQUALS' ? 'PLAIN' : 'EQUALS';
            this.updateStatus(`🔀 ${direction} strategy switched from ${oldMode} to ${state.mode} mode (Loss #${state.consecutive_losses})`);
        }

        this.updateStats();

        if (this.trade_callback) {
            this.trade_callback(trade);
        }
    }

    public enable() {
        this.config.enabled = true;
        this.updateStatus('🤖 Auto-trading ENABLED');
    }

    public disable() {
        this.config.enabled = false;
        this.updateStatus('⏸️ Auto-trading DISABLED');
    }

    public reset() {
        this.stats = {
            total_trades: 0,
            winning_trades: 0,
            losing_trades: 0,
            active_trades: 0,
            total_profit: 0,
            win_rate: 0,
            avg_profit: 0,
            trades_this_hour: 0,
            last_trade_time: 0
        };
        this.trade_history = [];
        this.active_contracts.clear();
        this.last_recommendation = null;
        this.updateStats();
        this.updateStatus('🔄 Auto-trader reset');
    }
}

export const mlAutoTrader = new MLAutoTrader();
