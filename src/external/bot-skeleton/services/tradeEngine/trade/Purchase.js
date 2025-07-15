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
        purchase(contract_type) {
        // Apply martingale logic before purchase
        const botInterface = this.getBotInterface?.();
        if (botInterface) {
            const lastTradeProfit = botInterface.getLastTradeProfit?.() || 0;
            const martingaleMultiplier = botInterface.getMartingaleMultiplier?.() || 1;
            const consecutiveLosses = botInterface.getConsecutiveLosses?.() || 0;

            // Store base amount if not already stored (only on first trade)
            if (!botInterface.getBaseAmount?.()) {
                const baseAmount = this.tradeOptions.amount;
                botInterface.setBaseAmount?.(baseAmount);
                console.log(`Base amount set to: ${baseAmount}`);
            }

            const baseAmount = botInterface.getBaseAmount?.() || this.tradeOptions.amount;
            
            console.log(`Current state: LastProfit=${lastTradeProfit}, Multiplier=${martingaleMultiplier}, BaseAmount=${baseAmount}, CurrentAmount=${this.tradeOptions.amount}`);

            // Handle trade results (including break-even as neutral)
            if (lastTradeProfit < 0) {
                // Loss - apply martingale
                const newMultiplier = martingaleMultiplier * 2;
                const newConsecutiveLosses = consecutiveLosses + 1;
                const maxMultiplier = 64;
                const maxConsecutiveLosses = 10; // Reset after 10 consecutive losses

                if (newMultiplier <= maxMultiplier && newConsecutiveLosses <= maxConsecutiveLosses) {
                    botInterface.setMartingaleMultiplier(newMultiplier);
                    botInterface.setConsecutiveLosses(newConsecutiveLosses);
                    const newAmount = baseAmount * newMultiplier;
                    this.tradeOptions.amount = newAmount;

                    console.log(`🔴 LOSS: Martingale applied - Base: ${baseAmount} * Multiplier: ${newMultiplier} = ${newAmount}, Consecutive losses: ${newConsecutiveLosses}`);
                } else {
                    console.log('⚠️ Maximum martingale limit reached, resetting to base amount');
                    botInterface.setMartingaleMultiplier(1);
                    botInterface.setConsecutiveLosses(0);
                    this.tradeOptions.amount = baseAmount;
                }
            } else if (lastTradeProfit > 0) {
                // Win - reset martingale
                botInterface.setMartingaleMultiplier(1);
                botInterface.setConsecutiveLosses(0);
                this.tradeOptions.amount = baseAmount;
                console.log(`🟢 WIN: Martingale reset to base amount: ${baseAmount}`);
            } else {
                // Break-even (lastTradeProfit === 0) - keep current multiplier
                const currentAmount = baseAmount * martingaleMultiplier;
                this.tradeOptions.amount = currentAmount;
                console.log(`🟡 BREAK-EVEN: Maintaining multiplier ${martingaleMultiplier}, amount: ${currentAmount}`);
            }
            
            console.log(`Final trade amount for this purchase: ${this.tradeOptions.amount}`);
        }

        // Allow continuous purchases without blocking
        return new Promise((resolve) => {
            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
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

                // Resolve immediately to allow continuous purchases
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
                            // if disconnected no need to resubscription (handled by live-api)
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
        shouldContinueTrading() {
            const botInterface = this.getBotInterface?.();
            if (!botInterface) return false;

            const totalProfit = botInterface.getTotalProfit?.() || 0;
            const profitThreshold = botInterface.getProfitThreshold?.() || Infinity;
            const lossThreshold = botInterface.getLossThreshold?.() || -Infinity;
            const martingaleMultiplier = botInterface.getMartingaleMultiplier?.() || 1;

            // Stop if profit/loss thresholds are reached
            if (totalProfit >= profitThreshold || totalProfit <= -Math.abs(lossThreshold)) {
                console.log('Stopping due to profit/loss threshold reached');
                return false;
            }

            // Stop if martingale multiplier gets too high (risk management)
            if (martingaleMultiplier >= 64) {
                console.log('Stopping due to maximum martingale multiplier reached');
                return false;
            }

            return true;
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };