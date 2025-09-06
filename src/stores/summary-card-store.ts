
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
    getIndicativePrice,
    isAccumulatorContract,
    isEqualObject,
    isMultiplierContract,
    Validator,
} from '@/components/shared';
import { TContractInfo } from '@/components/summary/summary-card.types';
import { getValidationRules, TValidationRuleIndex, TValidationRules } from '@/constants/contract';
import { contract_stages } from '@/constants/contract-stage';
import { api_base } from '@/external/bot-skeleton';
import { getContractUpdateConfig } from '@/utils/multiplier';
import { ProposalOpenContract, UpdateContractResponse } from '@deriv/api-types';
import { TStores } from '@deriv/stores/types';
import RootStore from './root-store';

type TLimitOrder = {
    take_profit?: number;
    stop_loss?: number;
};

type TMovements = {
    profit?: number;
    indicative?: number;
};

export default class SummaryCardStore {
    
    // Method to update balance from trading hub
    updateBalance = (newBalance: number) => {
        // This will trigger balance updates in the UI
        if (this.root_store?.client?.accounts) {
            const currentAccount = this.root_store.client.accounts.find(
                acc => acc.loginid === this.root_store.client.loginid
            );
            if (currentAccount) {
                currentAccount.balance = newBalance;
            }
        }
    };

    // Method to update trading hub specific stats
    updateTradingHubStats = (stats: {
        total_trades: number;
        wins: number;
        losses: number;
        profit_loss: number;
        last_trade_result: string;
        current_stake?: string;
    }) => {
        // Update local stats that can be displayed in summary
        this.total_runs = stats.total_trades;
        // Additional stats can be stored here for display
    };
    root_store: RootStore;
    core: TStores;
    disposeReactionsFn: () => void | null;
    disposeSwitchAcountListener: (() => void | null) | undefined;
    contract_info: ProposalOpenContract | null = null;
    is_loading = false;
    indicative_movement = '';
    profit_movement = '';

    validation_errors = {};
    validation_rules: TValidationRules = getValidationRules();

    // Multiplier contract update config
    contract_update_take_profit?: number | string | null = null;
    contract_update_stop_loss?: number | string | null = null;
    has_contract_update_take_profit = false;
    has_contract_update_stop_loss = false;
    contract_update_config = {};
    profit_loss?: number = 0;
    contract_id?: string | null = null;
    profit?: number = 0;
    indicative?: number = 0;
    is_bot_running?: boolean = false;
    
    // Trading Hub Integration
    is_trading_hub_active = false;
    trading_hub_stats = {
        total_trades: 0,
        wins: 0,
        losses: 0,
        profit_loss: 0,
        current_strategy: '',
        last_trade_result: ''
    };

    constructor(root_store: RootStore, core: TStores) {
        makeObservable(this, {
            contract_info: observable,
            indicative_movement: observable,
            profit_movement: observable,
            validation_errors: observable,
            validation_rules: observable,
            contract_update_take_profit: observable,
            contract_update_stop_loss: observable,
            has_contract_update_take_profit: observable,
            has_contract_update_stop_loss: observable,
            is_bot_running: observable,
            contract_update_config: observable,
            contract_id: observable,
            profit: observable,
            indicative: observable,
            is_trading_hub_active: observable,
            trading_hub_stats: observable,
            is_contract_completed: computed,
            is_contract_loading: computed,
            is_contract_inactive: computed,
            is_multiplier: computed,
            clear: action.bound,
            clearContractUpdateConfigValues: action.bound,
            getLimitOrder: action.bound,
            onBotContractEvent: action.bound,
            onTradingHubContractEvent: action.bound,
            onChange: action.bound,
            populateContractUpdateConfig: action.bound,
            setContractUpdateConfig: action.bound,
            setIsBotRunning: action.bound,
            setTradingHubActive: action.bound,
            updateTradingHubStats: action.bound,
            updateLimitOrder: action.bound,
            setValidationErrorMessages: action,
            validateProperty: action,
            registerReactions: action.bound,
        });

        this.root_store = root_store;
        this.core = core;
        this.disposeReactionsFn = this.registerReactions();
    }

    get is_contract_completed() {
        return (
            !!this.contract_info?.is_sold &&
            this.root_store.run_panel.contract_stage !== contract_stages.PURCHASE_RECEIVED
        );
    }

    get is_contract_loading() {
        return (
            (this.root_store.run_panel.is_running && this.contract_info === null) ||
            this.root_store.run_panel.contract_stage === contract_stages.PURCHASE_SENT ||
            this.root_store.run_panel.contract_stage === contract_stages.STARTING
        );
    }

    get is_contract_inactive() {
        return !this.contract_info && !this.is_loading;
    }

    get is_multiplier() {
        return isMultiplierContract(this.contract_info?.contract_type);
    }

    get is_accumulator() {
        return isAccumulatorContract(this.contract_info?.contract_type);
    }

    clear(should_unset_contract = true) {
        if (should_unset_contract) {
            this.contract_info = null;
        }

        this.profit = 0;
        this.profit_loss = 0;
        this.indicative = 0;
        this.indicative_movement = '';
        this.profit_movement = '';
    }

    clearContractUpdateConfigValues() {
        if (this.contract_info) {
            const {
                contract_update_stop_loss,
                contract_update_take_profit,
                has_contract_update_stop_loss,
                has_contract_update_take_profit,
            } = getContractUpdateConfig(this.contract_info.limit_order);

            this.contract_update_stop_loss = contract_update_stop_loss;
            this.contract_update_take_profit = contract_update_take_profit;
            this.has_contract_update_stop_loss = has_contract_update_stop_loss;
            this.has_contract_update_take_profit = has_contract_update_take_profit;
        }
    }

    getLimitOrder() {
        const limit_order: TLimitOrder = {};
        // send positive take_profit to update or null to cancel
        limit_order.take_profit = this.has_contract_update_take_profit ? +(this.contract_update_take_profit ?? 0) : 0;
        // send positive stop_loss to update or null to cancel
        limit_order.stop_loss = this.has_contract_update_stop_loss ? +(this.contract_update_stop_loss ?? 0) : 0;

        return limit_order;
    }

    onBotContractEvent(contract: TContractInfo) {
        const { profit } = contract;
        const indicative = getIndicativePrice(contract as ProposalOpenContract);
        this.profit = profit;

        if (this.contract_id !== contract.id) {
            this.clear(false);
            this.contract_id = contract.id;
            this.indicative = indicative;
        }

        const movements: TMovements = { profit, indicative };

        Object.keys(movements).forEach(name => {
            const movement = movements[name as keyof TMovements];
            const current_movement = this[name as keyof TMovements];

            if (name in this && movement && movement !== current_movement) {
                this[`${name as keyof TMovements}_movement`] =
                    movement && movement > (this[name as keyof TMovements] || 0) ? 'profit' : 'loss';
            } else if (this[`${name as keyof TMovements}_movement`] !== '') {
                this.indicative_movement = '';
            }

            if (name === 'profit') this.profit_loss = movement;
            if (name === 'indicative') this.indicative = movement;
        });

        // TODO only add props that is being used
        this.contract_info = contract;
    }

    onTradingHubContractEvent(contract: TContractInfo) {
        // Handle trading hub specific contract events
        const { profit } = contract;
        const indicative = getIndicativePrice(contract as ProposalOpenContract);
        
        if (this.contract_id !== contract.id) {
            this.clear(false);
            this.contract_id = contract.id;
            this.indicative = indicative;
        }

        this.profit = profit;
        this.profit_loss = profit;
        this.contract_info = contract;

        // Update trading hub specific stats
        if (contract.is_sold) {
            this.updateTradingHubStats({
                total_trades: this.trading_hub_stats.total_trades + 1,
                wins: profit > 0 ? this.trading_hub_stats.wins + 1 : this.trading_hub_stats.wins,
                losses: profit <= 0 ? this.trading_hub_stats.losses + 1 : this.trading_hub_stats.losses,
                profit_loss: this.trading_hub_stats.profit_loss + profit,
                last_trade_result: profit > 0 ? 'WIN' : 'LOSS'
            });
        }
    }

    onChange({ name, value }: { name: TValidationRuleIndex; value: string | boolean }) {
        this[name] = value;
        this.validateProperty(name, value);
    }

    populateContractUpdateConfig(response: UpdateContractResponse) {
        const contract_update_config = getContractUpdateConfig(response?.contract_update);

        if (!isEqualObject(this.contract_update_config, contract_update_config)) {
            Object.assign(this, contract_update_config);
            this.contract_update_config = contract_update_config;

            const { contract_update, error } = response;
            if (this.contract_info && contract_update && !error) {
                this.contract_info.limit_order = Object.assign(this.contract_info?.limit_order || {}, contract_update);
            }
        }
    }

    setContractUpdateConfig(contract_update_take_profit?: number | null, contract_update_stop_loss?: number | null) {
        if (contract_update_take_profit && contract_update_stop_loss) {
            this.has_contract_update_take_profit = !!contract_update_take_profit;
            this.has_contract_update_stop_loss = !!contract_update_stop_loss;
            this.contract_update_take_profit = this.has_contract_update_take_profit
                ? +contract_update_take_profit
                : null;
            this.contract_update_stop_loss = this.has_contract_update_stop_loss ? +contract_update_stop_loss : null;
        }
    }

    /**
     * Sets the bot's running state based on whether the contract is still loading
     */
    setIsBotRunning(is_running: boolean) {
        setTimeout(() => {
            runInAction(() => {
                this.is_bot_running = is_running;
            });
        }, 300);
    }

    /**
     * Sets the trading hub active state
     */
    setTradingHubActive(is_active: boolean) {
        this.is_trading_hub_active = is_active;
        if (!is_active) {
            // Reset stats when deactivating
            this.trading_hub_stats = {
                total_trades: 0,
                wins: 0,
                losses: 0,
                profit_loss: 0,
                current_strategy: '',
                last_trade_result: ''
            };
        }
    }

    /**
     * Updates trading hub statistics
     */
    updateTradingHubStats(stats: Partial<typeof this.trading_hub_stats>) {
        Object.assign(this.trading_hub_stats, stats);
    }

    updateLimitOrder() {
        const limit_order = this.getLimitOrder();

        if (this.contract_info?.contract_id) {
            if (this.contract_info?.contract_id) {
                api_base.api
                    ?.send({
                        contract_update: 1,
                        contract_id: this.contract_info?.contract_id,
                        limit_order,
                    })
                    .then(response => {
                        // Update contract store
                        this.populateContractUpdateConfig(response);
                    })
                    .catch((error: { error: Error }) => {
                        this.root_store.run_panel.showContractUpdateErrorDialog(error?.error?.message);
                    });
            }
        }
    }

    /**
     * Sets validation error messages for an observable property of the store
     *
     * @param {String} propertyName - The observable property's name
     * @param [{String}] messages - An array of strings that contains validation error messages for the particular property.
     *
     */
    setValidationErrorMessages(propertyName: TValidationRuleIndex, messages: string) {
        const is_different = () =>
            !!this.validation_errors[propertyName]
                .filter(x => !messages.includes(x))
                .concat(messages.filter(x => !this.validation_errors[propertyName].includes(x))).length;
        if (!this.validation_errors[propertyName] || is_different()) {
            this.validation_errors[propertyName] = messages;
        }
    }

    /**
     * Validates a particular property of the store
     *
     * @param {String} property - The name of the property in the store
     * @param {object} value    - The value of the property, it can be undefined.
     *
     */
    validateProperty(property: TValidationRuleIndex, value?: string) {
        const trigger = this.validation_rules[property].trigger;
        const inputs = { [property]: value !== undefined ? value : this[property] };
        const validation_rules = { [property]: this.validation_rules[property].rules || [] };

        if (!!trigger && Object.hasOwnProperty.call(this, trigger)) {
            inputs[trigger] = this[trigger];
            validation_rules[trigger] = this.validation_rules[trigger].rules || [];
        }

        const validator = new Validator(inputs, validation_rules, this);

        validator.isPassed();

        Object.keys(inputs).forEach(key => {
            this.setValidationErrorMessages(key, validator.errors.get(key));
        });
    }

    registerReactions() {
        const { client } = this.core;
        this.disposeSwitchAcountListener = reaction(
            () => client.loginid,
            () => this.clear()
        );

        return () => {
            if (typeof this.disposeSwitchAcountListener === 'function') {
                this.disposeSwitchAcountListener();
            }
        };
    }
}
