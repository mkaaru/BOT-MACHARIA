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
                lastTradeProfit: null, // Start with null to indicate no previous trade
                currentPurchasePrice: 0,
                totalProfit: 0,
                isEnabled: true, // Flag to enable/disable martingale
                maxMultiplier: 64, // Maximum multiplier limit
                maxConsecutiveLosses: 10 // Maximum consecutive losses allowed
            };

            // Track if trade result is confirmed and ready for martingale processing
            this.isTradeConfirmed = false;

            // Trading mode configuration - optimized sequential with 200ms delay
            this.waitingForContractClose = false;
            this.isWaitingForContractClose = false;
            this.lastTradeTime = 0; // Track last trade time for optimized delay
            this.minimumTradeDelay = 200; // Configurable minimum delay between trades
            
            console.log('🟦 MARTINGALE ENGINE: Initialized with optimized sequential trading mode (200ms delay)');
        }

        purchase(contract_type) {
            // Optimized timing check - reduce delay to 200ms for faster execution
            const currentTime = Date.now();
            const timeSinceLastTrade = currentTime - this.lastTradeTime;
            const minimumDelay = 200; // Reduced from 1000ms to 200ms for faster execution
            
            if (this.lastTradeTime > 0 && timeSinceLastTrade < minimumDelay) {
                const remainingDelay = minimumDelay - timeSinceLastTrade;
                throw new Error(`Wait ${remainingDelay}ms before next trade (optimized timing)`);
            }

            // Prevent purchase if waiting for previous contract to close
            if (this.isWaitingForContractClose) {
                throw new Error('Cannot purchase: waiting for previous contract to close');
            }

            const { currency, is_sold } = this.data.contract;
            const is_same_symbol = this.data.contract.underlying === this.options.symbol;
            const should_forget_proposal = is_sold && is_same_symbol;

            if (should_forget_proposal) {
                this.forgetProposals();
            }

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
                    this.lastTradeTime = Date.now(); // Record trade time for 1s delay
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
            if (!this.martingaleState.isEnabled) {
                console.log('🔴 MARTINGALE DISABLED: Using fixed stake');
                return;
            }

            const { baseAmount, multiplier, consecutiveLosses, lastTradeProfit, maxMultiplier, maxConsecutiveLosses } = this.martingaleState;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                console.log(`🟦 MARTINGALE LIMITS: Max multiplier: ${maxMultiplier}x, Max consecutive losses: ${maxConsecutiveLosses}`);
                return;
            }

            // Only apply martingale if we have a confirmed closed trade result
            if (this.isTradeConfirmed && lastTradeProfit !== null) {
                console.log(`📊 MARTINGALE ANALYSIS: Last confirmed trade P&L: ${lastTradeProfit} USD`);
                console.log(`📊 Current state - Multiplier: ${multiplier}x, Consecutive losses: ${consecutiveLosses}`);

                if (lastTradeProfit < 0) {
                    // Loss: Apply martingale
                    const newConsecutiveLosses = consecutiveLosses + 1;
                    
                    if (newConsecutiveLosses <= maxConsecutiveLosses) {
                        const newMultiplier = Math.min(multiplier * 2, maxMultiplier);
                        this.martingaleState.multiplier = newMultiplier;
                        this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                        this.tradeOptions.amount = Math.round((baseAmount * newMultiplier) * 100) / 100;
                        
                        console.log(`🔴 LOSS DETECTED: Applying martingale strategy`);
                        console.log(`🔴 Stake increased: ${baseAmount} USD → ${this.tradeOptions.amount} USD (${newMultiplier}x multiplier)`);
                        console.log(`🔴 Consecutive losses: ${newConsecutiveLosses}/${maxConsecutiveLosses}`);
                    } else {
                        // Reset on max consecutive losses
                        this.resetMartingale();
                        console.log(`⚠️ MAX CONSECUTIVE LOSSES REACHED: Reset to base ${this.martingaleState.baseAmount} USD`);
                    }
                } else if (lastTradeProfit > 0) {
                    // Win: Reset martingale
                    const previousStake = this.tradeOptions.amount;
                    this.resetMartingale();
                    console.log(`🟢 WIN DETECTED: Martingale sequence completed!`);
                    console.log(`🟢 Stake reset: ${previousStake} USD → ${this.martingaleState.baseAmount} USD`);
                    console.log(`🟢 Consecutive losses reset to 0`);
                } else {
                    // Break-even: Keep current multiplier
                    this.tradeOptions.amount = Math.round((baseAmount * multiplier) * 100) / 100;
                    console.log(`🟡 BREAK-EVEN: Maintaining ${this.tradeOptions.amount} USD (${multiplier}x base)`);
                }

                // Mark trade as processed
                this.isTradeConfirmed = false;
                console.log(`✅ MARTINGALE UPDATE COMPLETE: Next stake will be ${this.tradeOptions.amount} USD`);
            } else {
                // First trade or no confirmed trade yet
                if (lastTradeProfit === null) {
                    this.tradeOptions.amount = baseAmount;
                    console.log(`🚀 FIRST TRADE: Using base stake ${this.tradeOptions.amount} USD`);
                } else {
                    this.tradeOptions.amount = Math.round((baseAmount * multiplier) * 100) / 100;
                    console.log(`🔄 WAITING FOR CONFIRMATION: Using current stake ${this.tradeOptions.amount} USD (${multiplier}x base)`);
                }
            }
        }

        // IMMEDIATE martingale application - called directly after trade result
        applyMartingaleLogicImmediate(profit) {
            if (!this.martingaleState.isEnabled) {
                console.log('🔴 MARTINGALE DISABLED: Using fixed stake');
                return;
            }

            const { baseAmount, maxMultiplier, maxConsecutiveLosses } = this.martingaleState;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            console.log(`⚡ IMMEDIATE MARTINGALE: Processing trade result P&L: ${profit} USD`);

            if (profit < 0) {
                // Loss: Apply martingale immediately
                const newConsecutiveLosses = this.martingaleState.consecutiveLosses + 1;
                
                if (newConsecutiveLosses <= maxConsecutiveLosses) {
                    const newMultiplier = Math.min(this.martingaleState.multiplier * 2, maxMultiplier);
                    this.martingaleState.multiplier = newMultiplier;
                    this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                    this.tradeOptions.amount = Math.round((baseAmount * newMultiplier) * 100) / 100;
                    
                    console.log(`🔴 IMMEDIATE LOSS: Martingale applied instantly`);
                    console.log(`🔴 Next stake: ${baseAmount} USD → ${this.tradeOptions.amount} USD (${newMultiplier}x multiplier)`);
                    console.log(`🔴 Consecutive losses: ${newConsecutiveLosses}/${maxConsecutiveLosses}`);
                } else {
                    // Reset on max consecutive losses
                    this.resetMartingale();
                    console.log(`⚠️ MAX LOSSES: Reset to base ${this.martingaleState.baseAmount} USD`);
                }
            } else if (profit > 0) {
                // Win: Reset martingale immediately
                const previousStake = this.tradeOptions.amount;
                this.resetMartingale();
                console.log(`🟢 IMMEDIATE WIN: Martingale reset instantly`);
                console.log(`🟢 Next stake: ${previousStake} USD → ${this.martingaleState.baseAmount} USD`);
                console.log(`🟢 Consecutive losses reset to 0`);
            } else {
                // Break-even: Keep current multiplier
                this.tradeOptions.amount = Math.round((baseAmount * this.martingaleState.multiplier) * 100) / 100;
                console.log(`🟡 BREAK-EVEN: Maintaining ${this.tradeOptions.amount} USD`);
            }

            console.log(`⚡ IMMEDIATE MARTINGALE COMPLETE: Next trade will use ${this.tradeOptions.amount} USD`);
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

            // IMMEDIATELY apply martingale logic after trade confirmation
            this.applyMartingaleLogicImmediate(profit);

            // Mark that contract has closed (always sequential mode)
            this.setWaitingForContractClose(false);

            // Clear the waiting flag
            this.isWaitingForContractClose = false;

            // Update last trade time to current time for immediate readiness calculation
            this.lastTradeTime = Date.now();

            console.log(`💰 TRADE RESULT CONFIRMED: P&L: ${profit} USD | Total P&L: ${this.martingaleState.totalProfit.toFixed(2)} USD`);
            console.log(`🎯 MARTINGALE APPLIED: Next stake ready immediately`);
            
            // Log current martingale state
            console.log(`📊 MARTINGALE STATE: Multiplier: ${this.martingaleState.multiplier}x, Consecutive losses: ${this.martingaleState.consecutiveLosses}, Next stake: ${this.tradeOptions.amount} USD`);

            // Trigger immediate readiness check for next trade
            this.checkTradeReadiness();
        }

        // Enable/disable martingale strategy
        setMartingaleEnabled(enabled) {
            this.martingaleState.isEnabled = enabled;
            console.log(`🔧 MARTINGALE: ${enabled ? 'Enabled' : 'Disabled'}`);
        }

        // Set martingale limits
        setMartingaleLimits(maxMultiplier, maxConsecutiveLosses) {
            this.martingaleState.maxMultiplier = maxMultiplier || 64;
            this.martingaleState.maxConsecutiveLosses = maxConsecutiveLosses || 10;
            console.log(`🔧 MARTINGALE LIMITS: Max multiplier: ${this.martingaleState.maxMultiplier}x, Max losses: ${this.martingaleState.maxConsecutiveLosses}`);
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

        // Check if ready to purchase (proper contract closure synchronization)
        canPurchase() {
            // Only allow purchase if not waiting for contract to close
            return !this.waitingForContractClose;
        }

        // New method to check trade readiness and emit signal if ready
        checkTradeReadiness() {
            if (this.canPurchase()) {
                console.log('⚡ READY FOR NEXT TRADE: Contract closed, ready for next purchase');
                // Emit readiness signal for UI or trade engine
                if (this.observer) {
                    this.observer.emit('TRADE_READY');
                }
            } else {
                console.log('⏳ WAITING FOR CONTRACT CLOSURE: Cannot purchase until current contract closes');
            }
        }

        // Check if contract is ready for next trade (no timing delays)
        isReadyForNextTrade() {
            return !this.waitingForContractClose;
        }
            
            // Set waiting for contract close immediately after purchase
            this.setWaitingForContractClose(true);
            console.log('📋 CONTRACT PURCHASED: Now waiting for contract to close before next trade');
        }

        // Check if contract is ready for next trade (no timing delays)
        isReadyForNextTrade() {
            return !this.waitingForContractClose;
        }

        // Mark that we're waiting for contract close
        setWaitingForContractClose(waiting) {
            this.waitingForContractClose = waiting;
            if (waiting) {
                console.log('⏳ SEQUENTIAL MODE: Waiting for contract to close before next purchase (1s delay enforced)');
            } else {
                console.log('✅ SEQUENTIAL MODE: Ready for next purchase (respecting 1s delay)');
            }
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };