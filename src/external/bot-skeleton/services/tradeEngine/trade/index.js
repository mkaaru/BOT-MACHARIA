import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { localize } from '@deriv-com/translations';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { checkBlocksForProposalRequest, doUntilDone } from '../utils/helpers';
import { expectInitArg } from '../utils/sanitize';
import { proposalsReady, start } from './state/actions';
import *as constants from './state/constants';
import rootReducer from './state/reducers';
import Balance from './Balance';
import OpenContract from './OpenContract';
import Proposal from './Proposal';
import Purchase from './Purchase';
import Sell from './Sell';
import Ticks from './Ticks';
import Total from './Total';

const watchBefore = store =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
    });

const watchDuring = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
    });

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;
const watchScope = ({ store, stopScope, passScope, passFlag }) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (newState.newTick === prevTick) return;
            prevTick = newState.newTick;

            if (newState.scope === passScope && newState[passFlag]) {
                unsubscribe();
                resolve(true);
            }

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
            }
        });
    });
};

export default class TradeEngine extends Balance(Purchase(Sell(OpenContract(Proposal(Ticks(Total(class {}))))))) {
    constructor($scope) {
        super();
        this.observer = $scope.observer;
        this.$scope = $scope;
        this.observe();
        this.data = {
            contract: {},
            proposals: [],
        };
        this.subscription_id_for_accumulators = null;
        this.is_proposal_requested_for_accumulators = false;
        this.store = createStore(rootReducer, applyMiddleware(thunk));
        this.continuousTrading = true; // Default to continuous trading
        this.contractTimeoutId = null;
        this.purchaseInProgress = false;
    }

    // Method to check if contract is stuck and force completion
    checkContractStatus() {
        if (this.data.contract && this.data.contract.contract_id && !this.data.contract.is_sold) {
            console.log('🔍 Checking stuck contract status:', this.data.contract.contract_id);
            // Force request contract update
            if (api_base.api) {
                api_base.api.send({
                    proposal_open_contract: 1,
                    contract_id: this.data.contract.contract_id
                }).then(response => {
                    if (response.proposal_open_contract) {
                        console.log('📄 Contract status response:', response.proposal_open_contract);
                        this.observer.emit('proposal.open_contract', response);
                    }
                }).catch(error => {
                    console.error('❌ Contract status check failed:', error);
                });
            }
        }
    }

    // Add method to check bot state
    getBotState() {
        const state = this.store.getState();
        console.log('🤖 Bot State:', {
            scope: state.scope,
            proposalsReady: state.proposalsReady,
            hasContract: !!this.data.contract?.contract_id,
            contractSold: this.data.contract?.is_sold,
            continuousTrading: this.continuousTrading
        });
        return state;
    }

    // Add method to force next trade cycle
    forceNextTrade() {
        console.log('🔄 Forcing next trade cycle...');

        // Clear any stuck contract
        if (this.data.contract?.contract_id && !this.data.contract?.is_sold) {
            console.log('🧹 Clearing stuck contract:', this.data.contract.contract_id);
            this.data.contract.is_sold = true;
        }

        // Reset to before purchase state
        this.store.dispatch({ type: 'START' });

        // Emit signal to continue trading
        setTimeout(() => {
            this.observer.emit('REVERT', 'before');
        }, 1000);
    }

    // Method to force complete stuck contracts
    forceCompleteContract() {
        if (this.data.contract && this.data.contract.contract_id) {
            // Mark contract as sold to unblock the bot
            this.data.contract.is_sold = true;
            this.observer.emit('contract.status', {
                id: 'contract.sold',
                data: this.data.contract,
            });
        }
    }

    init(...args) {
        const [token, options] = expectInitArg(args);
        const { symbol } = options;

        this.initArgs = args;
        this.options = options;

        // Ensure loginAndGetBalance always returns a promise
        try {
            this.startPromise = this.loginAndGetBalance(token);
            if (!this.startPromise || typeof this.startPromise.then !== 'function') {
                this.startPromise = Promise.resolve();
            }
        } catch (error) {
            this.startPromise = Promise.reject(error);
        }

        if (!this.checkTicksPromiseExists()) this.watchTicks(symbol);
    }

    start(tradeOptions) {
        if (!this.options) {
            const errorMessage = 'Bot.init is not called. Please ensure the bot is properly initialized with a valid token and symbol before starting trades.';
            globalObserver.emit('Error', { message: errorMessage });
            globalObserver.emit('ui.log.error', errorMessage);
            throw createError('NotInitialized', localize('Bot.init is not called'));
        }

        // Ensure startPromise exists and is a promise
        if (!this.startPromise || typeof this.startPromise.then !== 'function') {
            this.startPromise = Promise.resolve();
        }

        globalObserver.emit('bot.running');

        const validated_trade_options = this.validateTradeOptions(tradeOptions);

        this.tradeOptions = { ...validated_trade_options, symbol: this.options.symbol };
        this.store.dispatch(start());
        this.checkLimits(validated_trade_options);

        this.makeDirectPurchaseDecision();
    }

    loginAndGetBalance(token) {
        if (this.token === token) {
            return Promise.resolve();
        }
        // for strategies using total runs, GetTotalRuns function is trying to get loginid and it gets called before Proposals calls.
        // the below required loginid to be set in Proposal calls where loginAndGetBalance gets resolved.
        // Earlier this used to happen as soon as we get ticks_history response and by the time GetTotalRuns gets called we have required info.
        this.accountInfo = api_base.account_info;
        this.token = api_base.token;

        // Ensure we have a valid API connection
        if (!api_base.api) {
            return Promise.reject(new Error('API not initialized'));
        }

        return new Promise((resolve, reject) => {
            // Try to recover from a situation where API doesn't give us a correct response on
            // "proposal_open_contract" which would make the bot run forever. When there's a "sell"
            // event, wait a couple seconds for the API to give us the correct "proposal_open_contract"
            // response, if there's none after x seconds. Send an explicit request, which _should_
            // solve the issue. This is a backup!
            try {
                if (!api_base.api || !api_base.api.onMessage) {
                    return reject(new Error('API not initialized'));
                }

                const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                    if (!data || !data.msg_type) return;

                    if (data.msg_type === 'transaction' && data.transaction && data.transaction.action === 'sell') {
                        this.transaction_recovery_timeout = setTimeout(() => {
                            const { contract } = this.data || {};
                            const is_same_contract = contract.contract_id === data.transaction.contract_id;
                            const is_open_contract = contract.status === 'open';
                            if (is_same_contract && is_open_contract) {
                                doUntilDone(() => {
                                    api_base.api.send({ proposal_open_contract: 1, contract_id: contract.contract_id });
                                }, ['PriceMoved']);
                            }
                        }, 1500);
                    }
                });

                if (subscription) {
                    api_base.pushSubscription(subscription);
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    observe() {
        this.observeOpenContract();
        this.observeBalance();
        this.observeProposals();
    }

    watch(watchName) {
        if (watchName === 'before') {
            return watchBefore(this.store);
        }
        return watchDuring(this.store);
    }

    makeDirectPurchaseDecision() {
        const { has_payout_block, is_basis_payout } = checkBlocksForProposalRequest();
        this.is_proposal_subscription_required = has_payout_block || is_basis_payout;

        if (this.is_proposal_subscription_required) {
            this.makeProposals({ ...this.options, ...this.tradeOptions });
            this.checkProposalReady();
        } else {
            this.store.dispatch(proposalsReady());
            
            // Force execute a simple trade if proposals aren't required
            setTimeout(() => {
                if (this.data.proposals && this.data.proposals.length === 0) {
                    console.log('🔧 No proposals found, creating default proposal for trade execution');
                    this.executeDirectTrade();
                }
            }, 2000);
        }
    }

    executeDirectTrade() {
        try {
            // Create a simple trade request for testing
            const tradeParams = {
                contract_type: 'CALL',
                symbol: this.options.symbol || 'R_10',
                amount: 1,
                duration: 5,
                duration_unit: 't',
                basis: 'stake'
            };
            
            console.log('🚀 Executing direct trade:', tradeParams);
            
            // Use the observer to trigger a purchase
            this.observer.emit('bot.purchase', tradeParams.contract_type);
        } catch (error) {
            console.error('❌ Direct trade execution failed:', error);
        }
    }
}