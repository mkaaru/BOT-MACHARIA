import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        constructor(...args) {
            super(...args);
            // Add sequential trading state management
            this.isWaitingForContractClosure = false;
            this.lastContractId = null;
            this.contractClosurePromise = null;
            this.minimumTradeDelay = 1000; // 1 second minimum between trades
            this.lastTradeTime = 0;
            // Initialize martingale state - will be configured from bot builder
            this.martingaleState = {
                baseAmount: null,
                multiplier: 1,
                consecutiveLosses: 0,
                cumulativeLosses: 0, // Track total losses in current martingale sequence
                lastTradeProfit: null, // Start with null to indicate no previous trade
                currentPurchasePrice: 0,
                totalProfit: 0,
                isEnabled: false, // Will be set based on bot configuration
                maxMultiplier: 64, // Will be overridden by bot config
                maxConsecutiveLosses: 10, // Will be overridden by bot config
                martingaleMultiplier: 2, // User configurable multiplier from bot builder (default 2)
                profitThreshold: null, // From bot builder
                lossThreshold: null, // From bot builder
                maxStake: null // From bot builder
            };

            // Track if trade result is confirmed and ready for martingale processing
            this.isTradeConfirmed = false;

            // Trading mode configuration - optimized sequential with 200ms delay
            this.waitingForContractClose = false;
            this.isWaitingForContractClosure = false;
            this.lastTradeTime = 0; // Track last trade time for optimized delay
            this.minimumTradeDelay = 200; // Configurable minimum delay between trades

            console.log('🟦 PURCHASE ENGINE: Initialized with sequential trading support');
    }

        purchase(contract_type) {
        // Prevent calling purchase twice
        if (this.store.getState().scope !== BEFORE_PURCHASE) {
            return Promise.resolve();
        }

        const { currency, is_sold } = this.data.contract;
        const is_same_symbol = this.data.contract.underlying === this.options.symbol;
        const should_forget_proposal = is_sold && is_same_symbol;

        if (should_forget_proposal) {
            this.forgetProposals();
        }

        return new Promise((resolve) => {
            const onSuccess = response => {
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { 
                    longcode: buy.longcode, 
                    transaction_id: buy.transaction_id,
                    contract_id: buy.contract_id 
                });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });

                console.log(`📦 CONTRACT PURCHASED: ID ${buy.contract_id}, Price: ${buy.buy_price}`);
                resolve();
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => {
                    console.log('🔄 Purchasing contract with proposal...');
                    return api_base.api.send({ buy: id, price: askPrice });
                };

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

            const action = () => {
                console.log('🔄 Purchasing contract directly...');
                console.log('📋 Trade options:', trade_option);
                return api_base.api.send(trade_option);
            };

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        });
    }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };

        // Method to set up a watcher for contract closure
        setupContractClosureWatcher(contractId) {
            if (this.contractClosurePromise) {
                console.warn('⚠️ Overwriting existing contract closure promise');
            }

            this.contractClosurePromise = new Promise(resolve => {
                const intervalId = setInterval(() => {
                    api_base.api.send({ proposal_open_contract: contractId })
                        .then(response => {
                            if (response.error) {
                                console.error('API Error during contract closure check:', response.error);
                                clearInterval(intervalId);
                                this.clearContractClosureState();
                                resolve();
                                return;
                            }

                            const contract = response.proposal_open_contract;
                            if (contract && contract.status === 'closed') {
                                console.log(`✅ CONTRACT CLOSED: ID ${contractId}, Final profit: ${contract.profit} USD`);

                                // Update trade result with final profit
                                this.updateTradeResult(contract.profit);

                                clearInterval(intervalId);
                                this.clearContractClosureState();
                                resolve();
                            } else {
                                console.log(`🔍 Checking contract status: ${contractId} still ${contract ? contract.status : 'not found'}`);
                            }
                        })
                        .catch(error => {
                            console.error('Error checking contract closure:', error);
                            clearInterval(intervalId);
                            this.clearContractClosureState();
                            resolve();
                        });
                }, 3000); // Poll every 3 seconds - adjust as necessary
            });
        }

        // Method to clear contract closure state
        clearContractClosureState() {
            this.isWaitingForContractClosure = false;
            this.contractClosurePromise = null;
            this.lastContractId = null;
        }

        // Method to forget proposals - inherited from Proposal functionality
        forgetProposals() {
            if (this.proposal_templates && this.proposal_templates.length > 0) {
                this.proposal_templates.forEach(template => {
                    if (template.id) {
                        api_base.api.send({ forget: template.id }).catch(error => {
                            console.warn('Failed to forget proposal:', error);
                        });
                    }
                });
            }

            // Clear proposals from store if available
            if (this.store && this.store.dispatch) {
                const { clearProposals } = require('./state/actions');
                this.store.dispatch(clearProposals());
            }

            console.log('🗑️ PROPOSALS: Cleared existing proposals');
        }

        // Method to clear proposals data
        clearProposals() {
            this.proposal_templates = [];
            if (this.data && this.data.proposals) {
                this.data.proposals = [];
            }

            if (this.store && this.store.dispatch) {
                const { clearProposals } = require('./state/actions');
                this.store.dispatch(clearProposals());
            }
        }

        // Method to update trade results
        updateTradeResult(profit) {
            if (!this.martingaleState.isEnabled) return;

            console.log(`🔄 UPDATING TRADE RESULT: Profit = ${profit}`);

            this.martingaleState.lastTradeProfit = profit;
            this.martingaleState.totalProfit += profit;
            this.martingaleState.currentPurchasePrice = 0; // Reset for next trade

            if (profit < 0) {
                // Loss - increase multiplier
                this.martingaleState.consecutiveLosses++;
                this.martingaleState.cumulativeLosses += Math.abs(profit);

                if (this.martingaleState.consecutiveLosses < this.martingaleState.maxConsecutiveLosses && 
                    this.martingaleState.multiplier < this.martingaleState.maxMultiplier) {
                    this.martingaleState.multiplier *= this.martingaleState.martingaleMultiplier;
                    console.log(`📈 MARTINGALE: Increased multiplier to ${this.martingaleState.multiplier}x after loss`);
                } else {
                    console.log(`⚠️ MARTINGALE: Reached limits, resetting multiplier`);
                    this.martingaleState.multiplier = 1;
                    this.martingaleState.consecutiveLosses = 0;
                    this.martingaleState.cumulativeLosses = 0;
                }
            } else if (profit > 0) {
                // Win - reset multiplier
                console.log(`🎉 MARTINGALE: Win! Resetting multiplier (was ${this.martingaleState.multiplier}x)`);
                this.martingaleState.multiplier = 1;
                this.martingaleState.consecutiveLosses = 0;
                this.martingaleState.cumulativeLosses = 0;
            }

            // Mark trade as confirmed for next purchase decision
            this.isTradeConfirmed = true;

            console.log(`📊 MARTINGALE STATE: Multiplier=${this.martingaleState.multiplier}x, Consecutive Losses=${this.martingaleState.consecutiveLosses}, Total Profit=${this.martingaleState.totalProfit}`);

            // Trigger readiness check for next trade
            this.checkTradeReadiness();
        }

        // Configure martingale from bot parameters
        configureMartingaleFromBot() {
            // This will be called when bot is initialized with martingale parameters
            // Get parameters from bot configuration or trade options
            if (this.tradeOptions && this.tradeOptions.martingale) {
                const config = this.tradeOptions.martingale;
                this.martingaleState.isEnabled = config.enabled || false;
                this.martingaleState.baseAmount = config.initialStake || this.tradeOptions.amount;
                this.martingaleState.martingaleMultiplier = config.multiplier || 2;
                this.martingaleState.maxMultiplier = config.maxMultiplier || 64;
                this.martingaleState.maxConsecutiveLosses = config.maxConsecutiveLosses || 10;
                this.martingaleState.profitThreshold = config.profitThreshold || null;
                this.martingaleState.lossThreshold = config.lossThreshold || null;
                this.martingaleState.maxStake = config.maxStake || null;

                console.log(`🔧 MARTINGALE CONFIGURED: Enabled=${this.martingaleState.isEnabled}, Multiplier=${this.martingaleState.martingaleMultiplier}x, Max=${this.martingaleState.maxMultiplier}x`);
            }
        }

        // Get the current stake amount for martingale
        getMartingaleStake() {
            if (!this.martingaleState.isEnabled || !this.martingaleState.baseAmount) {
                return this.tradeOptions.amount;
            }

            const calculatedStake = this.martingaleState.baseAmount * this.martingaleState.multiplier;

            // Apply max stake limit if set
            if (this.martingaleState.maxStake && calculatedStake > this.martingaleState.maxStake) {
                console.log(`⚠️ MARTINGALE: Calculated stake ${calculatedStake} exceeds max stake ${this.martingaleState.maxStake}, resetting to base`);
                this.martingaleState.multiplier = 1;
                this.martingaleState.consecutiveLosses = 0;
                return this.martingaleState.baseAmount;
            }

            return calculatedStake;
        }

        // Check if trading should continue based on thresholds
        shouldContinueTrading() {
            if (!this.martingaleState.isEnabled) return true;

            const totalProfit = this.martingaleState.totalProfit;
            const profitThreshold = this.martingaleState.profitThreshold;
            const lossThreshold = this.martingaleState.lossThreshold;

            // Stop trading conditions using configured thresholds
            if (profitThreshold && totalProfit >= profitThreshold) {
                console.log(`🛑 STOPPING: Profit threshold reached (${totalProfit} >= ${profitThreshold})`);
                return false;
            }

            if (lossThreshold && totalProfit <= -Math.abs(lossThreshold)) {
                console.log(`🛑 STOPPING: Loss threshold reached (${totalProfit} <= ${-Math.abs(lossThreshold)})`);
                return false;
            }

            return true;
        }
    };