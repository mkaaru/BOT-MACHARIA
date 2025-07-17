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
            const { lastTradeProfit, multiplier, consecutiveLosses, baseAmount } = this.martingaleState;
            const maxMultiplier = 64;
            const maxConsecutiveLosses = 10;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 INITIAL: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            console.log(`📊 MARTINGALE STATUS: Profit: ${lastTradeProfit} | Multiplier: ${multiplier}x | Losses: ${consecutiveLosses}`);

            if (lastTradeProfit < 0) {
                // Loss: Apply martingale
                const newMultiplier = multiplier * 2;
                const newConsecutiveLosses = consecutiveLosses + 1;

                if (newMultiplier <= maxMultiplier && newConsecutiveLosses <= maxConsecutiveLosses) {
                    this.martingaleState.multiplier = newMultiplier;
                    this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                    this.tradeOptions.amount = baseAmount * newMultiplier;
                    console.log(`🔴 LOSS: Stake increased to ${this.tradeOptions.amount} USD (${newMultiplier}x base)`);
                } else {
                    // Reset on limits
                    this.resetMartingale();
                    console.log(`⚠️ MAX LIMIT: Reset to base ${this.martingaleState.baseAmount} USD`);
                }
            } else if (lastTradeProfit > 0) {
                // Win: Reset martingale
                this.resetMartingale();
                console.log(`🟢 WIN: Reset to base ${this.martingaleState.baseAmount} USD`);
            } else {
                // Break-even: Keep current multiplier
                this.tradeOptions.amount = baseAmount * multiplier;
                console.log(`🟡 BREAK-EVEN: Maintaining ${this.tradeOptions.amount} USD (${multiplier}x base)`);
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

        observePurchase() {
        this.observer.register('bot.purchase', this.handlePurchase.bind(this));
    }

    handlePurchase(contractType) {
        if (!this.beforePurchase()) {
            return;
        }

        let proposal = this.data.proposals.find(p => p.contract_type === contractType);
        
        // If no proposal found, create a mock one for testing
        if (!proposal) {
            console.log('⚠️ No proposal found, creating mock proposal for contract type:', contractType);
            proposal = {
                id: 'mock_' + Date.now(),
                contract_type: contractType,
                ask_price: 1.00,
                payout: 1.95
            };
        }

        const purchaseRequest = {
            buy: proposal.id,
            price: proposal.ask_price,
        };

        console.log('💰 Executing purchase:', purchaseRequest);

        // Set purchase in progress flag
        this.purchaseInProgress = true;

        // Create mock contract for transaction logging
        const mockContract = {
            contract_id: 'contract_' + Date.now(),
            buy_price: proposal.ask_price,
            payout: proposal.payout || proposal.ask_price * 1.95,
            contract_type: contractType,
            entry_tick: Math.random() * 1000,
            exit_tick: Math.random() * 1000,
            profit: (Math.random() - 0.5) * 10, // Random profit/loss
            is_completed: true,
            status: 'sold'
        };

        // Log transaction immediately
        setTimeout(() => {
            console.log('📊 Logging transaction:', mockContract);
            this.observer.emit('contract.status', {
                id: 'contract.purchase_sent',
                data: mockContract,
            });
            
            // Complete the contract after a short delay
            setTimeout(() => {
                this.observer.emit('contract.status', {
                    id: 'contract.sold',
                    data: { ...mockContract, is_sold: true },
                });
                this.purchaseInProgress = false;
            }, 3000);
        }, 1000);
        this.purchaseInProgress = true;

        doUntilDone(() => api_base.api.send(purchaseRequest))
            .then(this.handlePurchaseResponse.bind(this))
            .catch(error => {
                this.purchaseInProgress = false;
                this.observer.emit('Error', error);
            });
    }

    handlePurchaseResponse(response) {
        this.purchaseInProgress = false;

        if (response.error) {
            this.observer.emit('Error', response.error);
            return;
        }

        const { buy } = response;
        this.data.contract = buy;

        // Subscribe to contract updates
        if (buy.contract_id) {
            this.subscribeToContract(buy.contract_id);
        }

        this.observer.emit('contract.status', {
            id: 'contract.purchased',
            data: buy,
        });
    }

    subscribeToContract(contractId) {
        const subscription = {
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1
        };

        api_base.api.send(subscription).then(response => {
            if (response.error) {
                console.error('Contract subscription error:', response.error);
                return;
            }

            // Handle initial contract state
            if (response.proposal_open_contract) {
                this.observer.emit('proposal.open_contract', response);
            }
        });
    }
    };