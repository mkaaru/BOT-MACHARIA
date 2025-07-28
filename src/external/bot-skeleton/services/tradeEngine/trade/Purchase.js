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
                martingaleMultiplier: 2, // The multiplier from bot builder (default 2)
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

            console.log('🟦 MARTINGALE ENGINE: Initialized with optimized sequential trading mode (200ms delay)');
            
            // Configure martingale from bot parameters
            this.configureMartingaleFromBot();
        }

        // Configure martingale parameters from bot builder settings
        configureMartingaleFromBot() {
            try {
                // Access bot configuration from various possible sources
                const botConfig = this.getBotConfiguration();
                
                if (botConfig) {
                    // Set martingale parameters from bot configuration
                    this.martingaleState.isEnabled = botConfig.martingale_enabled || false;
                    this.martingaleState.martingaleMultiplier = parseFloat(botConfig.size) || parseFloat(botConfig.martingale_size) || 2;
                    this.martingaleState.profitThreshold = parseFloat(botConfig.profit) || null;
                    this.martingaleState.lossThreshold = parseFloat(botConfig.loss) || null;
                    this.martingaleState.maxStake = parseFloat(botConfig.max_stake) || null;
                    
                    // Calculate max consecutive losses based on max stake
                    if (this.martingaleState.maxStake && this.tradeOptions.amount) {
                        const baseAmount = this.tradeOptions.amount;
                        let consecutiveLosses = 0;
                        let currentStake = baseAmount;
                        
                        while (currentStake <= this.martingaleState.maxStake) {
                            consecutiveLosses++;
                            currentStake = baseAmount * Math.pow(this.martingaleState.martingaleMultiplier, consecutiveLosses);
                        }
                        
                        this.martingaleState.maxConsecutiveLosses = Math.max(1, consecutiveLosses - 1);
                    }
                    
                    console.log('🔧 MARTINGALE CONFIGURED FROM BOT:');
                    console.log(`   - Enabled: ${this.martingaleState.isEnabled}`);
                    console.log(`   - Multiplier: ${this.martingaleState.martingaleMultiplier}x`);
                    console.log(`   - Profit Threshold: ${this.martingaleState.profitThreshold || 'None'}`);
                    console.log(`   - Loss Threshold: ${this.martingaleState.lossThreshold || 'None'}`);
                    console.log(`   - Max Stake: ${this.martingaleState.maxStake || 'None'}`);
                    console.log(`   - Max Consecutive Losses: ${this.martingaleState.maxConsecutiveLosses}`);
                } else {
                    console.log('⚠️ MARTINGALE: No bot configuration found, using defaults');
                }
            } catch (error) {
                console.error('❌ MARTINGALE CONFIG ERROR:', error);
                // Keep defaults if configuration fails
            }
        }

        // Get bot configuration from various possible sources
        getBotConfiguration() {
            // Try to get configuration from different possible sources
            
            // 1. From tradeOptions if it contains bot config
            if (this.tradeOptions && this.tradeOptions.botConfig) {
                return this.tradeOptions.botConfig;
            }
            
            // 2. From options if it contains strategy config
            if (this.options && this.options.strategyConfig) {
                return this.options.strategyConfig;
            }
            
            // 3. From global bot store/workspace
            if (typeof window !== 'undefined' && window.Blockly && window.Blockly.derivWorkspace) {
                try {
                    const workspace = window.Blockly.derivWorkspace;
                    const xml = workspace.getXmlDom();
                    
                    // Extract martingale parameters from XML
                    const config = this.extractMartingaleFromXML(xml);
                    if (config) return config;
                } catch (e) {
                    console.warn('Could not extract config from Blockly workspace:', e);
                }
            }
            
            // 4. From store if available
            if (this.store && this.store.getState) {
                const state = this.store.getState();
                if (state.quickStrategy || state.botBuilder) {
                    const quickStrategy = state.quickStrategy || state.botBuilder;
                    return {
                        martingale_enabled: true, // Assume enabled if using quick strategy
                        size: quickStrategy.size || quickStrategy.martingale_size,
                        profit: quickStrategy.profit,
                        loss: quickStrategy.loss,
                        max_stake: quickStrategy.max_stake
                    };
                }
            }
            
            return null;
        }

        // Extract martingale parameters from Blockly XML
        extractMartingaleFromXML(xml) {
            try {
                const config = {};
                
                // Look for martingale-related blocks in the XML
                const blocks = xml.querySelectorAll('block');
                
                blocks.forEach(block => {
                    const type = block.getAttribute('type');
                    
                    // Look for trade parameters and martingale settings
                    if (type && type.includes('trade_definition')) {
                        const fields = block.querySelectorAll('field');
                        fields.forEach(field => {
                            const name = field.getAttribute('name');
                            const value = field.textContent;
                            
                            if (name === 'STAKE' || name === 'AMOUNT') {
                                config.initial_stake = parseFloat(value);
                            }
                        });
                    }
                    
                    // Look for martingale multiplier
                    if (type && (type.includes('martingale') || type.includes('size'))) {
                        const fields = block.querySelectorAll('field');
                        fields.forEach(field => {
                            const name = field.getAttribute('name');
                            const value = field.textContent;
                            
                            if (name === 'SIZE' || name === 'MULTIPLIER') {
                                config.size = parseFloat(value);
                            }
                        });
                    }
                });
                
                return Object.keys(config).length > 0 ? config : null;
            } catch (error) {
                console.warn('Error extracting config from XML:', error);
                return null;
            }
        }

        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            // Check if we're waiting for previous contract to close
            if (this.isWaitingForContractClosure) {
                console.log('⏳ SEQUENTIAL TRADING: Waiting for previous contract to close before next purchase');
                return this.contractClosurePromise || Promise.resolve();
            }

            // Enforce minimum delay between trades
            const currentTime = Date.now();
            const timeSinceLastTrade = currentTime - this.lastTradeTime;
            if (this.lastTradeTime > 0 && timeSinceLastTrade < this.minimumTradeDelay) {
                const remainingDelay = this.minimumTradeDelay - timeSinceLastTrade;
                console.log(`⏱️ TRADE DELAY: Waiting ${remainingDelay}ms before next purchase`);
                return new Promise(resolve => {
                    setTimeout(() => {
                        this.purchase(contract_type).then(resolve);
                    }, remainingDelay);
                });
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
                    // Don't unnecessarily send a forget request for a purchased contract.
                    const { buy } = response;

                    contractStatus({
                        id: 'contract.purchase_received',
                        data: buy.transaction_id,
                        buy,
                    });

                    this.contractId = buy.contract_id;
                    this.lastContractId = buy.contract_id;
                    this.lastTradeTime = Date.now();

                    // Set up contract closure waiting
                    this.isWaitingForContractClosure = true;
                    this.setupContractClosureWatcher(buy.contract_id);

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

                    console.log(`📦 CONTRACT PURCHASED: ID ${buy.contract_id}, Price: ${buy.buy_price} USD`);
                    console.log(`⏳ SEQUENTIAL MODE: Now waiting for contract closure before next trade`);

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
                console.log(`🟦 MARTINGALE FACTOR: ${this.martingaleState.martingaleMultiplier}x per loss`);
                return;
            }

            // Only apply martingale if we have a confirmed closed trade result
            if (this.isTradeConfirmed && lastTradeProfit !== null) {
                console.log(`📊 MARTINGALE ANALYSIS: Last confirmed trade P&L: ${lastTradeProfit} USD`);
                console.log(`📊 Current state - Multiplier: ${multiplier}x, Consecutive losses: ${consecutiveLosses}`);

                if (lastTradeProfit < 0) {
                    // Loss: Apply martingale using configured multiplier
                    const newConsecutiveLosses = consecutiveLosses + 1;
                    const configuredMultiplier = this.martingaleState.martingaleMultiplier;

                    if (newConsecutiveLosses <= maxConsecutiveLosses) {
                        // Continue multiplying: current_multiplier * configured_factor
                        const newMultiplier = Math.min(multiplier * configuredMultiplier, maxMultiplier);
                        this.martingaleState.multiplier = newMultiplier;
                        this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                        
                        let newStake = baseAmount * newMultiplier;
                        
                        // Check max stake limit if configured
                        if (this.martingaleState.maxStake && newStake > this.martingaleState.maxStake) {
                            console.log(`⚠️ STAKE LIMIT: Calculated ${newStake} exceeds max ${this.martingaleState.maxStake}, resetting to base`);
                            this.resetMartingale();
                            return;
                        }
                        
                        this.tradeOptions.amount = Math.round(newStake * 100) / 100;

                        console.log(`🔴 LOSS DETECTED: Applying martingale strategy`);
                        console.log(`🔴 Multiplying current stake by factor: ${configuredMultiplier}x`);
                        console.log(`🔴 Stake progression: ${baseAmount} USD → ${this.tradeOptions.amount} USD (${newMultiplier}x from base)`);
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

            const { baseAmount, consecutiveLosses, maxConsecutiveLosses, multiplier } = this.martingaleState;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            console.log(`⚡ IMMEDIATE MARTINGALE: Processing trade result P&L: ${profit} USD`);
            console.log(`⚡ Current stake before adjustment: ${this.tradeOptions.amount} USD`);
            console.log(`⚡ Current multiplier: ${multiplier}x, Consecutive losses: ${consecutiveLosses}`);

            if (profit < 0) {
                // Loss: Continue martingale progression
                const newConsecutiveLosses = consecutiveLosses + 1;

                if (newConsecutiveLosses <= maxConsecutiveLosses) {
                    const configuredMultiplier = this.martingaleState.martingaleMultiplier;
                    
                    // Calculate new stake: base * (multiplier ^ consecutive_losses)
                    // This ensures proper progression: base → base*2 → base*4 → base*8, etc.
                    const newStake = baseAmount * Math.pow(configuredMultiplier, newConsecutiveLosses);
                    
                    // Check max stake limit if configured
                    if (this.martingaleState.maxStake && newStake > this.martingaleState.maxStake) {
                        console.log(`⚠️ IMMEDIATE STAKE LIMIT: Calculated ${newStake} exceeds max ${this.martingaleState.maxStake}, resetting to base`);
                        this.resetMartingale();
                        return;
                    }
                    
                    this.tradeOptions.amount = Math.round(newStake * 100) / 100;
                    this.martingaleState.consecutiveLosses = newConsecutiveLosses;
                    this.martingaleState.multiplier = Math.pow(configuredMultiplier, newConsecutiveLosses);

                    // Track cumulative losses for sequence recovery calculation
                    this.martingaleState.cumulativeLosses = (this.martingaleState.cumulativeLosses || 0) + Math.abs(profit);

                    console.log(`🔴 IMMEDIATE LOSS: Continuing martingale progression`);
                    console.log(`🔴 Stake calculation: ${baseAmount} * ${configuredMultiplier}^${newConsecutiveLosses} = ${this.tradeOptions.amount} USD`);
                    console.log(`🔴 Total multiplier from base: ${this.martingaleState.multiplier}x`);
                    console.log(`🔴 Consecutive losses: ${newConsecutiveLosses}/${maxConsecutiveLosses}`);
                    console.log(`🔴 Cumulative losses in sequence: ${this.martingaleState.cumulativeLosses} USD`);
                } else {
                    // Reset on max consecutive losses
                    this.resetMartingale();
                    console.log(`⚠️ MAX LOSSES: Reset to base ${this.martingaleState.baseAmount} USD`);
                }
            } else if (profit > 0) {
                // Win: Check if this win recovers the losses from the martingale sequence
                if (consecutiveLosses > 0) {
                    const cumulativeLosses = this.martingaleState.cumulativeLosses || 0;
                    const netRecovery = profit - cumulativeLosses;

                    console.log(`🟢 WIN DURING MARTINGALE: Profit ${profit} USD vs Cumulative losses ${cumulativeLosses} USD`);
                    console.log(`🟢 Net recovery: ${netRecovery} USD`);

                    if (netRecovery >= 0) {
                        // Full recovery achieved - reset martingale
                        const previousStake = this.tradeOptions.amount;
                        this.resetMartingale();
                        console.log(`🟢 SEQUENCE RECOVERED: Martingale completed after ${consecutiveLosses} losses!`);
                        console.log(`🟢 Stake reset: ${previousStake} USD → ${this.martingaleState.baseAmount} USD`);
                        console.log(`🟢 Total recovery: ${netRecovery.toFixed(2)} USD profit`);
                    } else {
                        // Partial recovery - continue with current stake until full recovery
                        this.martingaleState.cumulativeLosses = Math.abs(netRecovery);
                        console.log(`🟡 PARTIAL RECOVERY: Continue with ${this.tradeOptions.amount} USD stake`);
                        console.log(`🟡 Remaining to recover: ${this.martingaleState.cumulativeLosses} USD`);
                        console.log(`🟡 Maintaining consecutive losses at: ${consecutiveLosses}`);
                    }
                } else {
                    // Normal win with no active martingale - keep base stake
                    this.tradeOptions.amount = baseAmount;
                    console.log(`🟢 NORMAL WIN: Maintaining base stake ${this.tradeOptions.amount} USD`);
                }
            } else {
                // Break-even: Keep current progression if in martingale sequence
                if (consecutiveLosses > 0) {
                    console.log(`🟡 BREAK-EVEN: Maintaining martingale progression ${this.tradeOptions.amount} USD (${consecutiveLosses} losses)`);
                    console.log(`🟡 Still need to recover: ${this.martingaleState.cumulativeLosses || 0} USD`);
                } else {
                    this.tradeOptions.amount = baseAmount;
                    console.log(`🟡 BREAK-EVEN: Using base stake ${this.tradeOptions.amount} USD`);
                }
            }

            console.log(`⚡ IMMEDIATE MARTINGALE COMPLETE: Next trade will use ${this.tradeOptions.amount} USD`);
        }

        resetMartingale() {
            this.martingaleState.multiplier = 1;
            this.martingaleState.consecutiveLosses = 0;
            this.martingaleState.cumulativeLosses = 0;
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
            this.isWaitingForContractClosure = false;

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
            const profitThreshold = this.martingaleState.profitThreshold;
            const lossThreshold = this.martingaleState.lossThreshold;
            const multiplier = this.martingaleState.multiplier;

            // Stop trading conditions using configured thresholds
            if (profitThreshold && totalProfit >= profitThreshold) {
                console.log(`🛑 STOPPING: Profit threshold reached (${totalProfit} >= ${profitThreshold})`);
                return false;
            }

            if (lossThreshold && totalProfit <= -Math.abs(lossThreshold)) {
                console.log(`🛑 STOPPING: Loss threshold reached (${totalProfit} <= ${-Math.abs(lossThreshold)})`);
                return false;
            }

            if (multiplier >= this.martingaleState.maxMultiplier) {
                console.log(`🛑 STOPPING: Maximum martingale multiplier reached (${multiplier})`);
                return false;
            }

            return true;
        }

        // Check if ready to purchase (optimized sequential mode)
        canPurchase() {
            const currentTime = Date.now();
            const timeSinceLastTrade = currentTime - this.lastTradeTime;
            const minimumDelay = 200; // Optimized delay

            // Check optimized delay requirement
            if (this.lastTradeTime > 0 && timeSinceLastTrade < minimumDelay) {
                return false;
            }

            // Check if waiting for contract close
            return !this.waitingForContractClose;
        }

        // New method to check trade readiness and emit signal if ready
        checkTradeReadiness() {
            setTimeout(() => {
                if (this.canPurchase()) {
                    console.log('⚡ READY FOR NEXT TRADE: Optimized timing allows immediate execution');
                    // Emit readiness signal for UI or trade engine
                    if (this.observer) {
                        this.observer.emit('TRADE_READY');
                    }
                }
            }, 50); // Small buffer to ensure state is fully updated
        }

        // Enhanced timing for tick-based strategies
        getOptimalEntryTiming() {
            const currentTime = Date.now();
            const timeSinceLastTrade = currentTime - this.lastTradeTime;
            const minimumDelay = 200;

            if (timeSinceLastTrade >= minimumDelay) {
                return 0; // Ready immediately
            }

            return minimumDelay - timeSinceLastTrade; // Time to wait
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
    };