import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { formatDate, isEnded } from '@/components/shared';
import { LogTypes } from '@/external/bot-skeleton';
import { ProposalOpenContract } from '@deriv/api-types';
import { TPortfolioPosition, TStores } from '@deriv/stores/types';
import { TContractInfo } from '../components/summary/summary-card.types';
import { transaction_elements } from '../constants/transactions';
import { getStoredItemsByKey, getStoredItemsByUser, setStoredItemsByKey } from '../utils/session-storage';
import RootStore from './root-store';

type TTransaction = {
    type: string;
    data?: string | TContractInfo;
};

type TElement = {
    [key: string]: TTransaction[];
};

// Define the TTransactionDataLog interface with ML properties
export type TTransactionDataLog = {
    type: string;
    longcode?: string;
    currency?: string;
    buy_price?: number;
    sell_price?: number;
    profit?: number;
    contract_id?: string;
    reference?: string | number;
    purchase_time?: number;
    sell_time?: number;
    is_ml_trade?: boolean;
    ml_confidence?: number;
    ml_recommendation?: string;
    id?: string;
    timestamp?: number;
};

// Mock TContractState for the purpose of this example, assuming it contains necessary fields
type TContractState = {
    buy?: {
        buy_price: number;
        transaction_id: string;
    };
    contract: TContractInfo & {
        is_sold?: boolean;
        is_ml_trade?: boolean;
        ml_confidence?: number;
        ml_recommendation?: string;
        display_name?: string;
    };
    id: string;
};

const max_items = 5000; // Assuming max_items is defined elsewhere or needs to be defined

export default class TransactionsStore {
    root_store: RootStore;
    core: TStores;
    disposeReactionsFn: () => void;

    constructor(root_store: RootStore, core: TStores) {
        this.root_store = root_store;
        this.core = core;
        this.is_transaction_details_modal_open = false;
        this.disposeReactionsFn = this.registerReactions();

        makeObservable(this, {
            elements: observable,
            active_transaction_id: observable,
            recovered_completed_transactions: observable,
            recovered_transactions: observable,
            is_called_proposal_open_contract: observable,
            is_transaction_details_modal_open: observable,
            transactions: computed,
            onBotContractEvent: action.bound,
            pushTransaction: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            recoverPendingContracts: action.bound,
            updateResultsCompletedContract: action.bound,
            sortOutPositionsBeforeAction: action.bound,
            recoverPendingContractsById: action.bound,
        });
    }
    TRANSACTION_CACHE = 'transaction_cache';

    elements: TElement = getStoredItemsByUser(this.TRANSACTION_CACHE, this.core?.client?.loginid, []);
    active_transaction_id: null | number = null;
    recovered_completed_transactions: number[] = [];
    recovered_transactions: number[] = [];
    is_called_proposal_open_contract = false;
    is_transaction_details_modal_open = false;

    get transactions(): TTransaction[] {
        if (this.core?.client?.loginid) return this.elements[this.core?.client?.loginid] ?? [];
        return [];
    }

    get statistics() {
        let total_runs = 0;
        // Filter out only contract transactions and remove dividers
        const trxs = this.transactions.filter(
            trx => trx.type === transaction_elements.CONTRACT && typeof trx.data === 'object'
        );
        const statistics = trxs.reduce(
            (stats, { data }) => {
                const { profit = 0, is_completed = false, buy_price = 0, payout, bid_price } = data as TContractInfo;
                if (is_completed) {
                    if (profit > 0) {
                        stats.won_contracts += 1;
                        stats.total_payout += payout ?? bid_price ?? 0;
                    } else {
                        stats.lost_contracts += 1;
                    }
                    stats.total_profit += profit;
                    stats.total_stake += buy_price;
                    total_runs += 1;
                }
                return stats;
            },
            {
                lost_contracts: 0,
                number_of_runs: 0,
                total_profit: 0,
                total_payout: 0,
                total_stake: 0,
                won_contracts: 0,
            }
        );
        statistics.number_of_runs = total_runs;
        return statistics;
    }

    toggleTransactionDetailsModal = (is_open: boolean) => {
        this.is_transaction_details_modal_open = is_open;
    };

    onBotContractEvent = (contract: TContractState) => {
        const { buy, contract: contract_info, id } = contract;
        if (buy) {
            const { buy_price, transaction_id } = buy;
            const { contract_id, longcode, currency, purchase_time, is_ml_trade, ml_confidence, ml_recommendation } = contract_info || {};

            // Add ML prefix for ML Trader contracts
            const displayLongcode = is_ml_trade ?
                `ML ${ml_recommendation} (${ml_confidence?.toFixed(1)}%) - ${longcode || contract_info?.display_name || 'ML Trade'}` :
                longcode;

            this.pushTransaction({
                type: localize('Buy'),
                reference: transaction_id,
                contract_id,
                longcode: displayLongcode,
                currency,
                buy_price,
                purchase_time,
                is_ml_trade,
                ml_confidence,
                ml_recommendation
            });
        }

        if (contract_info?.is_sold) {
            const { sell_price, sell_time, profit, contract_id, longcode, currency, is_ml_trade, ml_confidence, ml_recommendation } = contract_info;

            // Add ML prefix for ML Trader contracts
            const displayLongcode = is_ml_trade ?
                `ML ${ml_recommendation} (${ml_confidence?.toFixed(1)}%) - ${longcode || contract_info?.display_name || 'ML Trade'}` :
                longcode;

            this.pushTransaction({
                type: localize('Sell'),
                reference: contract_id,
                contract_id,
                longcode: displayLongcode,
                currency,
                sell_price,
                profit,
                sell_time,
                is_ml_trade,
                ml_confidence,
                ml_recommendation
            });
        }
    };

    pushTransaction = (transaction: TTransactionDataLog) => {
        if (this.transactions.length >= max_items) {
            this.transactions.pop();
        }

        // Add ML trade indicator to transaction data
        const enhancedTransaction = {
            ...transaction,
            id: transaction.reference || transaction.contract_id || Date.now().toString(),
            timestamp: transaction.purchase_time || transaction.sell_time || Date.now() / 1000
        };

        this.transactions.unshift(enhancedTransaction);
    };

    clear() {
        if (this.elements && this.elements[this.core?.client?.loginid as string]?.length > 0) {
            this.elements[this.core?.client?.loginid as string] = [];
        }
        this.recovered_completed_transactions = this.recovered_completed_transactions?.slice(0, 0);
        this.recovered_transactions = this.recovered_transactions?.slice(0, 0);
        this.is_transaction_details_modal_open = false;
    }

    registerReactions() {
        const { client } = this.core;

        // Write transactions to session storage on each change in transaction elements.
        const disposeTransactionElementsListener = reaction(
            () => this.elements[client?.loginid as string],
            elements => {
                const stored_transactions = getStoredItemsByKey(this.TRANSACTION_CACHE, {});
                stored_transactions[client.loginid as string] = elements?.slice(0, 5000) ?? [];
                setStoredItemsByKey(this.TRANSACTION_CACHE, stored_transactions);
            }
        );

        // User could've left the page mid-contract. On initial load, try
        // to recover any pending contracts so we can reflect accurate stats
        // and transactions.
        const disposeRecoverContracts = reaction(
            () => this.transactions.length,
            () => this.recoverPendingContracts()
        );

        return () => {
            disposeTransactionElementsListener();
            disposeRecoverContracts();
        };
    }

    recoverPendingContracts(contract = null) {
        this.transactions.forEach(({ data: trx }) => {
            if (
                typeof trx === 'string' ||
                trx?.is_completed ||
                !trx?.contract_id ||
                this.recovered_transactions.includes(trx?.contract_id)
            )
                return;
            this.recoverPendingContractsById(trx.contract_id, contract);
        });
    }

    updateResultsCompletedContract(contract: ProposalOpenContract) {
        const { journal, summary_card } = this.root_store;
        const { contract_info } = summary_card;
        const { currency, profit } = contract;

        if (contract.contract_id !== contract_info?.contract_id) {
            this.onBotContractEvent(contract as TContractState); // Cast to TContractState for onBotContractEvent

            if (contract.contract_id && !this.recovered_transactions.includes(contract.contract_id)) {
                this.recovered_transactions.push(contract.contract_id);
            }
            if (
                contract.contract_id &&
                !this.recovered_completed_transactions.includes(contract.contract_id) &&
                isEnded(contract)
            ) {
                this.recovered_completed_transactions.push(contract.contract_id);

                journal.onLogSuccess({
                    log_type: profit && profit > 0 ? LogTypes.PROFIT : LogTypes.LOST,
                    extra: { currency, profit },
                });
            }
        }
    }

    sortOutPositionsBeforeAction(positions: TPortfolioPosition[], element_id?: number) {
        positions?.forEach(position => {
            if (!element_id || (element_id && position.id === element_id)) {
                const contract_details = position.contract_info;
                this.updateResultsCompletedContract(contract_details);
            }
        });
    }

    async recoverPendingContractsById(contract_id: number, contract: ProposalOpenContract | null = null) {
        // TODO: need to fix as the portfolio is not available now
        // const positions = this.core.portfolio.positions;
        const positions: unknown[] = [];

        if (contract) {
            this.is_called_proposal_open_contract = true;
            if (contract.contract_id === contract_id) {
                this.updateResultsCompletedContract(contract);
            }
        }

        if (!this.is_called_proposal_open_contract) {
            if (this.core?.client?.loginid) {
                const current_account = this.core?.client?.loginid;
                if (!this.elements[current_account]?.length) {
                    this.sortOutPositionsBeforeAction(positions);
                }

                const elements = this.elements[current_account];
                const [element = null] = elements;
                if (typeof element?.data === 'object' && !element?.data?.profit) {
                    const element_id = element.data.contract_id;
                    this.sortOutPositionsBeforeAction(positions, element_id);
                }
            }
        }
    }
}