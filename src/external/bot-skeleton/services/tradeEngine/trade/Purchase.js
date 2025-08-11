
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
            this.lastPurchaseTime = 0;
            this.isProcessingTrade = false;
            this.contractCompletionRequired = true;
            this.minimumTradeDelay = 1000; // 1 second minimum between trades
            
            // Enhanced martingale state management
            this.martingaleState = {
                isEnabled: false,
                baseAmount: null,
                originalStake: null,
                consecutiveLosses: 0,
                maxConsecutiveLosses: 10,
                martingaleMultiplier: 2,
                maxStake: null,
                totalLosses: 0,
                totalProfitLoss: 0,
                successfulRecoveries: 0,
                targetRecovery: false
            };
            
            console.log('🟦 PURCHASE ENGINE: Enhanced version initialized with improved execution control');
            this.configureMartingaleFromBot();
        }

        purchase(contract_type) {
            // Enhanced execution control with multiple safety checks
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                console.log('⏸️ PURCHASE BLOCKED: Invalid scope state');
                return Promise.resolve();
            }

            // CRITICAL: Multiple layers of execution prevention
            if (this.isProcessingTrade) {
                console.log('⏸️ PURCHASE BLOCKED: Previous trade still processing');
                return Promise.resolve();
            }

            // Enhanced timing control - prevent rapid successive calls
            const now = Date.now();
            const timeSinceLastPurchase = now - (this.lastPurchaseTime || 0);
            const minimumInterval = this.minimumTradeDelay || 1000;

            if (timeSinceLastPurchase < minimumInterval) {
                console.log(`⏸️ PURCHASE BLOCKED: Too soon (${timeSinceLastPurchase}ms < ${minimumInterval}ms)`);
                return Promise.resolve();
            }

            // Check for active contracts with enhanced validation
            const openContract = this.getOpenContract();
            const contractData = this.data?.contract;
            
            if (openContract && !openContract.is_sold) {
                console.log('⏸️ PURCHASE BLOCKED: Contract still active, waiting for completion');
                return Promise.resolve();
            }

            if (contractData && !contractData.is_sold && contractData.contract_id) {
                console.log('⏸️ PURCHASE BLOCKED: Contract data indicates active contract');
                return Promise.resolve();
            }

            // Set processing flags and timestamps
            this.lastPurchaseTime = now;
            this.isProcessingTrade = true;

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
                    
                    // Enhanced completion waiting
                    if (this.contractCompletionRequired) {
                        this.waitForContractCompletion(() => {
                            this.isProcessingTrade = false;
                            resolve();
                        });
                    } else {
                        this.isProcessingTrade = false;
                        resolve();
                    }
                };

                const executeWithProposal = () => {
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
                        return doUntilDone(action).then(onSuccess).catch(error => {
                            console.error('Purchase failed:', error);
                            this.isProcessingTrade = false;
                            resolve();
                        });
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
                    ).then(onSuccess).catch(error => {
                        console.error('Purchase with recovery failed:', error);
                        this.isProcessingTrade = false;
                        resolve();
                    });
                };

                const executeWithoutProposal = () => {
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
                        return doUntilDone(action).then(onSuccess).catch(error => {
                            console.error('Direct purchase failed:', error);
                            this.isProcessingTrade = false;
                            resolve();
                        });
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
                    ).then(onSuccess).catch(error => {
                        console.error('Direct purchase with recovery failed:', error);
                        this.isProcessingTrade = false;
                        resolve();
                    });
                };

                // Execute purchase based on subscription requirement
                if (this.is_proposal_subscription_required) {
                    executeWithProposal();
                } else {
                    executeWithoutProposal();
                }
            });
        }

        getPurchaseReference = () => purchase_reference;
        
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };

        // Enhanced martingale configuration
        configureMartingaleFromBot() {
            const botConfig = this.getBotConfiguration();
            
            if (botConfig) {
                this.martingaleState.isEnabled = botConfig.martingale_enabled || false;
                this.martingaleState.martingaleMultiplier = botConfig.size || botConfig.martingale_multiplier || 2;
                this.martingaleState.maxStake = botConfig.max_stake || null;
                this.martingaleState.maxConsecutiveLosses = botConfig.max_consecutive_losses || 10;
                
                console.log('🔧 MARTINGALE: Configured from bot settings:', {
                    enabled: this.martingaleState.isEnabled,
                    multiplier: this.martingaleState.martingaleMultiplier,
                    maxStake: this.martingaleState.maxStake,
                    maxLosses: this.martingaleState.maxConsecutiveLosses
                });
            } else {
                console.log('🔧 MARTINGALE: Using XML-based strategy configuration');
            }

            this.contractCompletionRequired = true;
            this.removePerTickListeners();
        }

        // Get bot configuration from various sources
        getBotConfiguration() {
            // Try tradeOptions first
            if (this.tradeOptions && this.tradeOptions.botConfig) {
                return this.tradeOptions.botConfig;
            }
            
            // Try options
            if (this.options && this.options.strategyConfig) {
                return this.options.strategyConfig;
            }
            
            // Try store (for bot builder)
            if (this.store && this.store.getState) {
                const state = this.store.getState();
                if (state.quickStrategy && state.quickStrategy.formValues) {
                    const formValues = state.quickStrategy.formValues;
                    return {
                        martingale_enabled: true,
                        size: formValues.size || formValues.martingale_size || formValues.multiplier,
                        profit_threshold: formValues.profit_threshold,
                        loss_threshold: formValues.loss_threshold,
                        max_stake: formValues.max_stake,
                        max_consecutive_losses: formValues.max_consecutive_losses || 10
                    };
                }
            }
            
            return null;
        }

        // Remove per-tick execution listeners
        removePerTickListeners() {
            if (this.tickListener) {
                this.tickListener.unsubscribe();
                this.tickListener = null;
            }
            console.log('🔧 MARTINGALE: Removed per-tick listeners to prevent rapid execution');
        }

        // Enhanced contract completion waiting
        waitForContractCompletion(callback) {
            if (this.isProcessingTrade) {
                console.log('⏳ ENHANCED: Waiting for current contract to complete...');
                return;
            }

            this.isProcessingTrade = true;
            const startTime = Date.now();
            const timeoutDuration = this.getContractTimeout();
            
            const completionTimeout = setTimeout(() => {
                const elapsed = Date.now() - startTime;
                console.log(`⚠️ ENHANCED: Contract completion timeout after ${elapsed}ms, proceeding`);
                this.isProcessingTrade = false;
                this.forceContractRelease();
                if (callback) callback();
            }, timeoutDuration);

            const checkCompletion = setInterval(() => {
                const openContract = this.getOpenContract();
                const contractData = this.data?.contract;
                
                const isContractClosed = !openContract || openContract.is_sold;
                const isContractDataComplete = contractData && contractData.is_sold;
                const hasValidResult = contractData && (contractData.profit !== undefined);
                
                if (isContractClosed && (isContractDataComplete || hasValidResult)) {
                    clearInterval(checkCompletion);
                    clearTimeout(completionTimeout);
                    
                    const elapsed = Date.now() - startTime;
                    console.log(`✅ ENHANCED: Contract completed in ${elapsed}ms, ready for next trade`);
                    
                    setTimeout(() => {
                        this.isProcessingTrade = false;
                        if (callback) callback();
                    }, 100);
                }
            }, 250);
        }

        getContractTimeout() {
            const baseTimeout = 30000;
            const contractDuration = this.tradeOptions?.duration || 1;
            
            if (contractDuration <= 5) return baseTimeout;
            if (contractDuration <= 60) return baseTimeout * 1.5;
            return baseTimeout * 2;
        }

        forceContractRelease() {
            this.isProcessingTrade = false;
            this.waitingForContractClose = false;
            console.log('🔧 ENHANCED: Forced contract release');
        }

        getOpenContract() {
            try {
                return window.Blockly.derivWorkspace.getAllBlocks()
                    .find(block => block.type === 'open_contract')?.contract;
            } catch (error) {
                return null;
            }
        }

        // Enhanced martingale logic with improved recovery calculation
        applyMartingaleLogicImmediate(profit) {
            if (!this.martingaleState.isEnabled) {
                console.log('🔴 MARTINGALE DISABLED: Using fixed stake');
                return;
            }

            const { baseAmount, consecutiveLosses, maxConsecutiveLosses } = this.martingaleState;
            const userMultiplier = this.martingaleState.martingaleMultiplier || 2;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                this.martingaleState.originalStake = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            console.log(`⚡ ENHANCED MARTINGALE: Processing result P&L: ${profit} USD`);
            console.log(`⚡ Current consecutive losses: ${consecutiveLosses}`);
            console.log(`⚡ Current stake: ${this.tradeOptions.amount} USD, Base: ${baseAmount} USD`);
            console.log(`⚡ Multiplier: ${userMultiplier}x`);

            // Track total profit/loss for recovery calculation
            this.martingaleState.totalProfitLoss = (this.martingaleState.totalProfitLoss || 0) + profit;

            if (profit < 0) {
                // Loss: Calculate new stake with enhanced recovery logic
                const newConsecutiveLosses = consecutiveLosses + 1;
                this.martingaleState.totalLosses = (this.martingaleState.totalLosses || 0) + Math.abs(profit);

                if (newConsecutiveLosses <= maxConsecutiveLosses) {
                    this.martingaleState.consecutiveLosses = newConsecutiveLosses;

                    // Enhanced calculation for optimal recovery
                    const recoveryAmount = Math.abs(this.martingaleState.totalLosses || 0);
                    let newStake = baseAmount * Math.pow(userMultiplier, newConsecutiveLosses);
                    
                    // Optional recovery adjustment
                    if (this.martingaleState.targetRecovery && recoveryAmount > 0) {
                        const targetStake = recoveryAmount * 1.1; // 10% profit target
                        newStake = Math.max(newStake, targetStake);
                    }

                    // Apply max stake limit
                    if (this.martingaleState.maxStake && newStake > this.martingaleState.maxStake) {
                        console.log(`⚠️ MAX STAKE EXCEEDED: Would be ${newStake}, limited to ${this.martingaleState.maxStake}`);
                        newStake = this.martingaleState.maxStake;
                        
                        if (newStake < recoveryAmount * 0.8) {
                            this.resetMartingale();
                            console.log(`⚠️ INSUFFICIENT MAX STAKE: Reset to base ${this.martingaleState.baseAmount} USD`);
                            return;
                        }
                    }

                    // Ensure minimum stake and proper rounding
                    this.tradeOptions.amount = Math.max(0.35, Math.round(newStake * 100) / 100);

                    console.log(`🔴 LOSS ${newConsecutiveLosses}: Enhanced calculation`);
                    console.log(`   - Formula: ${baseAmount} * ${userMultiplier}^${newConsecutiveLosses} = ${baseAmount * Math.pow(userMultiplier, newConsecutiveLosses)}`);
                    console.log(`   - Recovery needed: ${recoveryAmount} USD`);
                    console.log(`   - Final stake: ${this.tradeOptions.amount} USD`);
                } else {
                    this.resetMartingale();
                    console.log(`⚠️ MAX LOSSES REACHED: Reset to base ${this.martingaleState.baseAmount} USD`);
                }
            } else if (profit > 0) {
                // Win: Reset martingale and track recovery
                const previousStake = this.tradeOptions.amount;
                const recoveredAmount = this.martingaleState.totalLosses || 0;
                
                this.martingaleState.consecutiveLosses = 0;
                this.martingaleState.totalLosses = 0;
                this.tradeOptions.amount = this.martingaleState.baseAmount;
                
                console.log(`🟢 WIN: Enhanced martingale reset!`);
                console.log(`🟢 Stake: ${previousStake} USD → ${this.martingaleState.baseAmount} USD`);
                console.log(`🟢 Recovery: ${recoveredAmount} USD + ${profit} USD profit`);
                
                this.martingaleState.successfulRecoveries = (this.martingaleState.successfulRecoveries || 0) + 1;
            } else {
                // Break-even handling
                if (consecutiveLosses > 0) {
                    console.log(`🟡 BREAK-EVEN: Maintaining state (losses: ${consecutiveLosses}, recovery needed: ${this.martingaleState.totalLosses || 0})`);
                } else {
                    this.tradeOptions.amount = baseAmount;
                    console.log(`🟡 BREAK-EVEN: Using base stake ${this.tradeOptions.amount} USD`);
                }
            }

            // Enhanced statistics logging
            console.log(`📊 MARTINGALE STATS: Recoveries: ${this.martingaleState.successfulRecoveries || 0}, Total P&L: ${this.martingaleState.totalProfitLoss || 0}`);
        }

        resetMartingale() {
            this.martingaleState.consecutiveLosses = 0;
            this.martingaleState.totalLosses = 0;
            this.tradeOptions.amount = this.martingaleState.baseAmount;
            console.log(`🔄 MARTINGALE RESET: Stake reset to ${this.tradeOptions.amount} USD`);
        }
    };
