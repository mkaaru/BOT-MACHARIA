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
            
            // Initialize martingale configuration
            setTimeout(() => {
                this.configureMartingaleFromBot();
            }, 100); // Small delay to ensure tradeOptions are available
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
                let checkCount = 0;
                const maxChecks = 60; // Maximum 3 minutes of checking
                
                const intervalId = setInterval(() => {
                    checkCount++;
                    
                    if (checkCount > maxChecks) {
                        console.log(`⏰ CONTRACT TIMEOUT: Stopping checks for ${contractId} after ${maxChecks} attempts`);
                        clearInterval(intervalId);
                        this.clearContractClosureState();
                        resolve();
                        return;
                    }

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

                                // Update trade result with final profit (sound will be played here)
                                this.updateTradeResult(contract.profit);

                                clearInterval(intervalId);
                                this.clearContractClosureState();
                                resolve();
                            } else if (checkCount % 10 === 0) {
                                // Only log every 10th check to reduce spam
                                console.log(`🔍 Contract ${contractId} status: ${contract ? contract.status : 'not found'} (check ${checkCount}/${maxChecks})`);
                            }
                        })
                        .catch(error => {
                            console.error('Error checking contract closure:', error);
                            clearInterval(intervalId);
                            this.clearContractClosureState();
                            resolve();
                        });
                }, 3000); // Poll every 3 seconds
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
                // Loss - increase stake by multiplying by 2 (fixed multiplier)
                this.martingaleState.consecutiveLosses++;
                this.martingaleState.cumulativeLosses += Math.abs(profit);

                if (this.martingaleState.consecutiveLosses < this.martingaleState.maxConsecutiveLosses) {
                    // Always multiply by 2 for consistency across all markets
                    const newStake = this.tradeOptions.amount * 2;
                    
                    // Check max stake limit
                    if (this.martingaleState.maxStake && newStake > this.martingaleState.maxStake) {
                        console.log(`⚠️ MARTINGALE: Calculated stake ${newStake} exceeds max stake ${this.martingaleState.maxStake}, resetting to base`);
                        this.tradeOptions.amount = this.martingaleState.baseAmount;
                        this.martingaleState.consecutiveLosses = 0;
                        this.martingaleState.cumulativeLosses = 0;
                    } else {
                        this.tradeOptions.amount = Math.round(newStake * 100) / 100; // Round to 2 decimal places
                        console.log(`📈 MARTINGALE: Doubled stake to ${this.tradeOptions.amount} after loss (consecutive losses: ${this.martingaleState.consecutiveLosses})`);
                    }
                } else {
                    console.log(`⚠️ MARTINGALE: Max consecutive losses reached, resetting to base stake`);
                    this.tradeOptions.amount = this.martingaleState.baseAmount;
                    this.martingaleState.consecutiveLosses = 0;
                    this.martingaleState.cumulativeLosses = 0;
                }
            } else if (profit > 0) {
                // Win - reset to original stake
                const previousStake = this.tradeOptions.amount;
                this.tradeOptions.amount = this.martingaleState.baseAmount;
                this.martingaleState.consecutiveLosses = 0;
                this.martingaleState.cumulativeLosses = 0;
                console.log(`🎉 MARTINGALE: Win! Reset stake from ${previousStake} to ${this.tradeOptions.amount} (base amount)`);
            }

            // Mark trade as confirmed for next purchase decision
            this.isTradeConfirmed = true;

            console.log(`📊 MARTINGALE STATE: Current stake: ${this.tradeOptions.amount}, Base: ${this.martingaleState.baseAmount}, Consecutive Losses: ${this.martingaleState.consecutiveLosses}, Total Profit: ${this.martingaleState.totalProfit}`);

            // Play sound notification for actual trade execution (not every tick)
            this.playTradeExecutionSound();

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
                this.martingaleState.martingaleMultiplier = 2; // Fixed to 2 for consistency
                this.martingaleState.maxMultiplier = config.maxMultiplier || 64;
                this.martingaleState.maxConsecutiveLosses = config.maxConsecutiveLosses || 10;
                this.martingaleState.profitThreshold = config.profitThreshold || null;
                this.martingaleState.lossThreshold = config.lossThreshold || null;
                this.martingaleState.maxStake = config.maxStake || null;

                console.log(`🔧 MARTINGALE CONFIGURED: Enabled=${this.martingaleState.isEnabled}, Base stake=${this.martingaleState.baseAmount}, Max consecutive losses=${this.martingaleState.maxConsecutiveLosses}`);
            } else {
                // Fallback configuration if no martingale config is provided
                this.martingaleState.isEnabled = true; // Enable by default for consistency
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                this.martingaleState.martingaleMultiplier = 2; // Always 2x
                
                console.log(`🔧 MARTINGALE DEFAULT CONFIG: Base stake=${this.martingaleState.baseAmount}`);
            }
        }

        // Get the current stake amount for martingale
        getMartingaleStake() {
            if (!this.martingaleState.isEnabled || !this.martingaleState.baseAmount) {
                return this.tradeOptions.amount;
            }

            // Return current stake amount (already calculated in updateTradeResult)
            return this.tradeOptions.amount;
        }

        // Play sound only when trade is actually executed
        playTradeExecutionSound() {
            try {
                // Only play sound for actual trade execution, not every tick
                if (typeof Audio !== 'undefined') {
                    const audio = new Audio('/assets/media/coins.mp3');
                    audio.volume = 0.3; // Reasonable volume
                    audio.play().catch(error => {
                        console.log('Audio play failed:', error);
                    });
                }
            } catch (error) {
                console.log('Sound notification error:', error);
            }
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