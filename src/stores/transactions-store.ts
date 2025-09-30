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
            statistics: computed,
            onBotContractEvent: action.bound,
            onExternalTradeEvent: action.bound,
            pushTransaction: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            recoverPendingContracts: action.bound,
            updateResultsCompletedContract: action.bound,
            sortOutPositionsBeforeAction: action.bound,
            recoverPendingContractsById: action.bound,
            updateStatistics: action.bound,
        });

        // Register for external trade events from trading engines
        if (typeof window !== 'undefined' && window.observer) {
            window.observer.register('external.trade.result', this.onExternalTradeEvent);
            window.observer.register('statistics.update', (stats: any) => {
                this.updateStatistics(stats);
            });
        }
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
                const { profit = 0, is_completed = false, buy_price = 0, payout, bid_price, status } = data as TContractInfo;
                if (is_completed) {
                    // Check multiple conditions to determine if it's a win
                    const isWin = profit > 0 || status === 'won' || (payout && payout > buy_price);

                    if (isWin) {
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

    onBotContractEvent(data: TContractInfo) {
        console.log('📝 Transaction store received contract event:', data);
        this.pushTransaction(data);
    }

    pushTransaction(data: TContractInfo) {
        const is_completed = isEnded(data as ProposalOpenContract);
        const { run_id } = this.root_store.run_panel;
        const current_account = this.core?.client?.loginid as string;

        const contract: TContractInfo = {
            ...data,
            is_completed,
            run_id,
            date_start: formatDate(data.date_start, 'YYYY-M-D HH:mm:ss [GMT]'),
            entry_tick: data.entry_tick_display_value,
            entry_tick_time: data.entry_tick_time && formatDate(data.entry_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            exit_tick: data.exit_tick_display_value,
            exit_tick_time: data.exit_tick_time && formatDate(data.exit_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            profit: is_completed ? data.profit : 0,
        };

        if (!this.elements[current_account]) {
            this.elements = {
                ...this.elements,
                [current_account]: [],
            };
        }

        const same_contract_index = this.elements[current_account]?.findIndex(c => {
            if (typeof c.data === 'string') return false;
            return (
                c.type === transaction_elements.CONTRACT &&
                c.data?.transaction_ids &&
                c.data.transaction_ids.buy === data.transaction_ids?.buy
            );
        });

        if (same_contract_index === -1) {
            // Render a divider if the "run_id" for this contract is different.
            if (this.elements[current_account]?.length > 0) {
                const temp_contract = this.elements[current_account]?.[0];
                const is_contract = temp_contract.type === transaction_elements.CONTRACT;
                const is_new_run =
                    is_contract &&
                    typeof temp_contract.data === 'object' &&
                    contract.run_id !== temp_contract?.data?.run_id;

                if (is_new_run) {
                    this.elements[current_account]?.unshift({
                        type: transaction_elements.DIVIDER,
                        data: contract.run_id,
                    });
                }
            }

            this.elements[current_account]?.unshift({
                type: transaction_elements.CONTRACT,
                data: contract,
            });
        } else {
            // If data belongs to existing contract in memory, update it.
            this.elements[current_account]?.splice(same_contract_index, 1, {
                type: transaction_elements.CONTRACT,
                data: contract,
            });
        }

        this.elements = { ...this.elements }; // force update
    }

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
            this.onBotContractEvent(contract);

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

    // Handle external trade events from Smart Trader, ML Trader, etc.
    onExternalTradeEvent = (tradeData: any) => {
        console.log('🔄 External trade event received:', tradeData);
        
        const { 
            contract_id, 
            buy_price, 
            sell_price, 
            profit, 
            is_completed, 
            contract_type,
            underlying,
            currency 
        } = tradeData;

        // Create contract info compatible with our transaction format
        const contractInfo: TContractInfo = {
            contract_id: contract_id || Date.now(),
            buy_price: Number(buy_price) || 0,
            sell_price: Number(sell_price) || 0,
            profit: Number(profit) || 0,
            is_completed: is_completed || false,
            contract_type: contract_type || 'CALL',
            underlying: underlying || 'R_50',
            currency: currency || 'USD',
            date_start: new Date().toISOString(),
            transaction_ids: {
                buy: contract_id || Date.now(),
                sell: sell_price ? contract_id + 1 : null
            },
            ...tradeData
        };

        this.pushTransaction(contractInfo);
    };

    updateStatistics(externalStats?: any) {
        // If external stats are provided, use them directly
        if (externalStats) {
            console.log('📊 Using external statistics:', externalStats);
            this.statistics = {
                total_stake: externalStats.totalStake || externalStats.total_stake || 0,
                total_payout: externalStats.totalPayout || externalStats.total_payout || 0,
                total_profit: externalStats.totalProfit || externalStats.total_profit || 0,
                won_contracts: externalStats.totalWins || externalStats.won_contracts || 0,
                lost_contracts: externalStats.totalLosses || externalStats.lost_contracts || 0,
                number_of_runs: externalStats.totalRuns || externalStats.number_of_runs || 0,
            };
            return;
        }

        const transactions = this.transactions;

        const totalStake = transactions.reduce((sum, transaction) => {
            return sum + (Number(transaction.buy_price) || 0);
        }, 0);

        const totalPayout = transactions.reduce((sum, transaction) => {
            return sum + (Number(transaction.sell_price) || 0);
        }, 0);

        const totalProfit = transactions.reduce((sum, transaction) => {
            return sum + (Number(transaction.profit) || 0);
        }, 0);

        // Count winning and losing contracts - only count closed/completed transactions
        const completedTransactions = transactions.filter(transaction => {
            return transaction.is_completed || transaction.status === 'sold' || transaction.profit !== undefined;
        });

        const wonContracts = completedTransactions.filter(transaction => {
            const profit = Number(transaction.profit || 0);
            return profit > 0;
        }).length;

        const lostContracts = completedTransactions.filter(transaction => {
            const profit = Number(transaction.profit || 0);
            return profit <= 0; // Include break-even as losses for accurate counting
        }).length;

        console.log('📊 Statistics update:', {
            totalTransactions: transactions.length,
            completedTransactions: completedTransactions.length,
            wonContracts,
            lostContracts,
            totalProfit: totalProfit
        });

        this.statistics = {
            total_stake: totalStake,
            total_payout: totalPayout,
            total_profit: totalProfit,
            won_contracts: wonContracts,
            lost_contracts: lostContracts,
            number_of_runs: completedTransactions.length, // Use completed transactions for accurate run count
        };
    }

    onBotContractEvent = (contract: ProposalOpenContract) => {
        const { loginid } = this.core.client;
        const same_contract = this.transactions.find(c => String(c.contract_id) === String(contract.contract_id));

        if (same_contract) {
            // Update existing contract
            const wasCompleted = same_contract.is_completed;
            Object.assign(same_contract, {
                ...contract,
                currency: this.currency,
                is_completed: contract.is_sold || contract.status === 'sold',
                profit: contract.profit || same_contract.profit,
                sell_price: contract.sell_price || same_contract.sell_price,
            });

            // Log when contract completion status changes
            if (!wasCompleted && same_contract.is_completed) {
                console.log('🏁 Contract completed:', {
                    contract_id: contract.contract_id,
                    profit: same_contract.profit,
                    status: same_contract.status
                });
            }
        } else {
            // Add new contract
            const newContract = {
                ...contract,
                currency: this.currency,
                is_completed: contract.is_sold || contract.status === 'sold',
            };
            this.transactions.unshift(newContract);

            console.log('➕ New contract added:', {
                contract_id: contract.contract_id,
                is_completed: newContract.is_completed,
                profit: newContract.profit
            });
        }

        // Always update statistics when contract events occur
        this.updateStatistics();

        // Store in localStorage with account-specific key
        if (loginid) {
            localStorage.setItem(`dbot-transactions-${loginid}`, JSON.stringify(this.transactions));
        }
    };
}