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
            // Initialize martingale state
            this.martingaleState = {
                baseAmount: null,
                multiplier: 1,
                consecutiveLosses: 0,
                lastTradeProfit: 0,
                currentPurchasePrice: 0
            };

        // Track if trade result is confirmed and ready for martingale processing
        this.isTradeConfirmed = false;
        }

        purchase(contract_type) {
            // Apply martingale logic before purchase
            this.applyMartingaleLogic();

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
                    log(LogTypes.PURCHASE, { longcode: buy.longcode, transaction_id: buy.transaction_id });
                    info({
                        accountID: this.accountInfo.loginid,
                        totalRuns: this.updateAndReturnTotalRuns(),
                        transaction_ids: { buy: buy.transaction_id },
                        contract_type,
                        buy_price: buy.buy_price,
                    });

                    // Store purchase details for profit calculation
                    this.martingaleState.currentPurchasePrice = buy.buy_price;
                    console.log(`🔵 PURCHASE: ${buy.buy_price} USD, Contract ID: ${buy.contract_id}, Stake: ${this.tradeOptions.amount}`);

                    resolve();
                };

                if (this.is_proposal_subscription_required) {
                    const { id, askPrice } = this.selectProposal(contract_type);
                    const action = () => api_base.api.send({ buy: id, price: askPrice });

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
                const action = () => api_base.api.send(trade_option);

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

        applyMartingaleLogic() {
            // Apply martingale logic based on last confirmed closed trade result
        const { baseAmount, multiplier, consecutiveLosses, lastTradeProfit } = this.martingaleState;
            const maxMultiplier = 64;
            const maxConsecutiveLosses = 10;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 INITIAL: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }
            // Only apply martingale if we have a confirmed closed trade result
            if (lastTradeProfit !== null && this.isTradeConfirmed) {
                console.log(`📊 MARTINGALE ANALYSIS: Last confirmed trade P&L: ${lastTradeProfit} USD`);

                if (lastTradeProfit < 0) {
                    // Loss: Apply martingale
                    const newMultiplier = multiplier * 2;
                    const newConsecutiveLosses = consecutiveLosses + 1;

                    if (newMultiplier <= maxMultiplier && newConsecutiveLosses <= maxConsecutiveLosses) {
                        this.martingaleState.multiplier = newMultiplier;
                        this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                        this.tradeOptions.amount = baseAmount * newMultiplier;
                        console.log(`🔴 CONFIRMED LOSS: Stake increased to ${this.tradeOptions.amount} USD (${newMultiplier}x base)`);
                    } else {
                        // Reset on limits
                        this.resetMartingale();
                        console.log(`⚠️ MAX LIMIT REACHED: Reset to base ${this.martingaleState.baseAmount} USD`);
                    }
                } else if (lastTradeProfit > 0) {
                    // Win: Reset martingale
                    this.resetMartingale();
                    console.log(`🟢 CONFIRMED WIN: Reset to base ${this.martingaleState.baseAmount} USD (Recovery achieved!)`);
                } else {
                    // Break-even: Keep current multiplier
                    this.tradeOptions.amount = baseAmount * multiplier;
                    console.log(`🟡 BREAK-EVEN: Maintaining ${this.tradeOptions.amount} USD (${multiplier}x base)`);
                }

                // Mark trade as processed
                this.isTradeConfirmed = false;
            }
        }

        resetMartingale() {
            this.martingaleState.multiplier = 1;
            this.martingaleState.consecutiveLosses = 0;
            this.tradeOptions.amount = this.martingaleState.baseAmount;
        }

        // Method to update profit after trade result
        updateTradeResult(profit) {
            this.martingaleState.lastTradeProfit = profit;
            this.martingaleState.totalProfit += profit;
            console.log(`💰 TRADE RESULT: P&L: ${profit} USD | Total P&L: ${this.martingaleState.totalProfit} USD`);
        }

        // Getters for accessing martingale state
        getMartingaleMultiplier() {
            return this.martingaleState.multiplier;
        }

        getConsecutiveLosses() {
            return this.martingaleState.consecutiveLosses;
        }

        getBaseAmount() {
            return this.martingaleState.baseAmount;
        }

        getLastTradeProfit() {
            return this.martingaleState.lastTradeProfit;
        }

        getTotalProfit() {
            return this.martingaleState.totalProfit;
        }

        getCurrentPurchasePrice() {
            return this.martingaleState.currentPurchasePrice;
        }

        shouldContinueTrading() {
            const totalProfit = this.martingaleState.totalProfit;
            const profitThreshold = 1000; // Example threshold
            const lossThreshold = -500; // Example threshold
            const multiplier = this.martingaleState.multiplier;

            // Stop trading conditions
            if (totalProfit >= profitThreshold) {
                console.log('🛑 STOPPING: Profit threshold reached');
                return false;
            }

            if (totalProfit <= lossThreshold) {
                console.log('🛑 STOPPING: Loss threshold reached');
                return false;
            }

            if (multiplier >= 64) {
                console.log('🛑 STOPPING: Maximum martingale multiplier reached');
                return false;
            }

            return true;
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };