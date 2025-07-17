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
                currentPurchasePrice: 0,
                totalProfit: 0
            };

            // Track if trade result is confirmed and ready for martingale processing
            this.isTradeConfirmed = false;
            
            // Trading mode configuration
            this.continuousMode = true; // Default to continuous mode
            this.waitingForContractClose = false;
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
            const { baseAmount, multiplier, consecutiveLosses, lastTradeProfit } = this.martingaleState;
            const maxMultiplier = 64;
            const maxConsecutiveLosses = 10;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            // Only apply martingale if we have a confirmed closed trade result
            if (this.isTradeConfirmed && lastTradeProfit !== null) {
                console.log(`📊 MARTINGALE ANALYSIS: Last confirmed trade P&L: ${lastTradeProfit} USD`);
                console.log(`📊 Current state - Multiplier: ${multiplier}x, Consecutive losses: ${consecutiveLosses}`);

                if (lastTradeProfit < 0) {
                    // Loss: Apply martingale
                    const newMultiplier = Math.min(multiplier * 2, maxMultiplier);
                    const newConsecutiveLosses = consecutiveLosses + 1;

                    if (newConsecutiveLosses <= maxConsecutiveLosses) {
                        this.martingaleState.multiplier = newMultiplier;
                        this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                        this.tradeOptions.amount = Math.round((baseAmount * newMultiplier) * 100) / 100; // Round to 2 decimals
                        console.log(`🔴 LOSS DETECTED: Stake increased to ${this.tradeOptions.amount} USD (${newMultiplier}x base, ${newConsecutiveLosses} consecutive losses)`);
                    } else {
                        // Reset on max consecutive losses
                        this.resetMartingale();
                        console.log(`⚠️ MAX CONSECUTIVE LOSSES REACHED: Reset to base ${this.martingaleState.baseAmount} USD`);
                    }
                } else if (lastTradeProfit > 0) {
                    // Win: Reset martingale
                    this.resetMartingale();
                    console.log(`🟢 WIN DETECTED: Reset to base ${this.martingaleState.baseAmount} USD (Martingale sequence completed!)`);
                } else {
                    // Break-even: Keep current multiplier
                    this.tradeOptions.amount = Math.round((baseAmount * multiplier) * 100) / 100;
                    console.log(`🟡 BREAK-EVEN: Maintaining ${this.tradeOptions.amount} USD (${multiplier}x base)`);
                }

                // Mark trade as processed
                this.isTradeConfirmed = false;
                console.log(`✅ MARTINGALE UPDATE: Next stake will be ${this.tradeOptions.amount} USD`);
            } else {
                // No confirmed trade yet, use current settings
                this.tradeOptions.amount = Math.round((baseAmount * multiplier) * 100) / 100;
                console.log(`🔄 MARTINGALE PENDING: Using current stake ${this.tradeOptions.amount} USD (${multiplier}x base) - Waiting for trade confirmation`);
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
            this.martingaleState.totalProfit = (this.martingaleState.totalProfit || 0) + profit;
            this.isTradeConfirmed = true; // Mark trade as confirmed for martingale processing
            
            // In sequential mode, mark that contract has closed
            if (!this.continuousMode) {
                this.setWaitingForContractClose(false);
            }
            
            console.log(`💰 TRADE RESULT CONFIRMED: P&L: ${profit} USD | Total P&L: ${this.martingaleState.totalProfit.toFixed(2)} USD`);
            
            // Implement martingale logic immediately if contract is lost
            if (profit < 0) {
                this.implementMartingaleOnLoss();
            } else if (profit > 0) {
                this.resetMartingaleOnWin();
            }
            
            console.log(`🎯 MARTINGALE READY: Trade result confirmed, next purchase will apply martingale logic`);
        }

        // Implement martingale logic when contract is lost
        implementMartingaleOnLoss() {
            const { baseAmount, multiplier, consecutiveLosses } = this.martingaleState;
            const maxMultiplier = 64;
            const maxConsecutiveLosses = 10;

            // Initialize base amount if not set
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            console.log(`🔴 LOSS DETECTED: Implementing martingale strategy`);
            
            // Check if we can increase the multiplier
            const newMultiplier = Math.min(multiplier * 2, maxMultiplier);
            const newConsecutiveLosses = consecutiveLosses + 1;

            if (newConsecutiveLosses <= maxConsecutiveLosses && newMultiplier <= maxMultiplier) {
                // Apply martingale: double the stake
                this.martingaleState.multiplier = newMultiplier;
                this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                this.tradeOptions.amount = Math.round((baseAmount * newMultiplier) * 100) / 100;
                
                console.log(`📈 MARTINGALE APPLIED: Stake increased from ${baseAmount * multiplier} to ${this.tradeOptions.amount} USD`);
                console.log(`📊 Multiplier: ${multiplier}x → ${newMultiplier}x | Consecutive losses: ${consecutiveLosses} → ${newConsecutiveLosses}`);
            } else {
                // Reset if limits exceeded
                this.resetMartingale();
                console.log(`⚠️ MARTINGALE LIMIT REACHED: Reset to base amount ${this.martingaleState.baseAmount} USD`);
            }
        }

        // Reset martingale on win
        resetMartingaleOnWin() {
            console.log(`🟢 WIN DETECTED: Resetting martingale strategy`);
            const previousMultiplier = this.martingaleState.multiplier;
            const previousAmount = this.tradeOptions.amount;
            
            this.resetMartingale();
            
            console.log(`📉 MARTINGALE RESET: Stake reduced from ${previousAmount} USD (${previousMultiplier}x) to ${this.tradeOptions.amount} USD (1x)`);
            console.log(`🎉 MARTINGALE SEQUENCE COMPLETED: Recovery achieved!`);
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

        // Method to set trading mode
        setContinuousMode(continuous) {
            this.continuousMode = continuous;
            console.log(`🔧 TRADING MODE: ${continuous ? 'Continuous' : 'Sequential'} purchase mode activated`);
        }

        // Check if ready to purchase
        canPurchase() {
            if (this.continuousMode) {
                return true; // Always ready in continuous mode
            } else {
                return !this.waitingForContractClose; // Wait for contract close in sequential mode
            }
        }

        // Mark that we're waiting for contract close
        setWaitingForContractClose(waiting) {
            this.waitingForContractClose = waiting;
            if (waiting) {
                console.log('⏳ SEQUENTIAL MODE: Waiting for contract to close before next purchase');
            } else {
                console.log('✅ SEQUENTIAL MODE: Ready for next purchase');
            }
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };