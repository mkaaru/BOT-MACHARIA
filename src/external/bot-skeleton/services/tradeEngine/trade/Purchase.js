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

            console.log('🟦 MARTINGALE ENGINE: Initialized with optimized sequential trading mode (200ms delay)');

            // Configure martingale from bot parameters
            this.configureMartingaleFromBot();

            // Listen for contract completion events from the bot's observer system
            if (typeof observer !== 'undefined') {
                observer.register('bot.contract', this.handleBotContractEvent.bind(this));
                observer.register('contract.closed', this.handleContractClosed.bind(this));
                observer.register('contract.sold', this.handleContractClosed.bind(this));
            }
        }

        // Handle bot contract events to catch contract completion
        handleBotContractEvent(contract_data) {
            if (contract_data && contract_data.is_sold && contract_data.profit !== undefined) {
                console.log(`🎯 BOT CONTRACT EVENT: Contract sold with profit ${contract_data.profit} USD`);

                // Apply martingale logic based on the closed contract
                this.applyMartingaleLogicImmediate(parseFloat(contract_data.profit));

                // Update total profit tracking
                this.martingaleState.lastTradeProfit = parseFloat(contract_data.profit);
                this.martingaleState.totalProfit = (this.martingaleState.totalProfit || 0) + parseFloat(contract_data.profit);

                console.log(`💰 UPDATED TOTALS: P&L: ${contract_data.profit} USD | Total P&L: ${this.martingaleState.totalProfit.toFixed(2)} USD`);
                console.log(`📊 MARTINGALE STATE: Consecutive losses: ${this.martingaleState.consecutiveLosses}, Next stake: ${this.tradeOptions.amount} USD`);
            }
        }

        // Handle contract closed/sold events for immediate martingale application
        handleContractClosed(contract_data) {
            if (contract_data && contract_data.profit !== undefined) {
                console.log(`🎯 CONTRACT CLOSED/SOLD EVENT: Contract ID ${contract_data.contract_id || 'N/A'} with profit ${contract_data.profit} USD`);

                // Apply martingale logic immediately based on the closed contract's profit
                this.applyMartingaleLogicImmediate(parseFloat(contract_data.profit));

                // Update total profit tracking
                this.martingaleState.lastTradeProfit = parseFloat(contract_data.profit);
                this.martingaleState.totalProfit = (this.martingaleState.totalProfit || 0) + parseFloat(contract_data.profit);

                console.log(`💰 UPDATED TOTALS: P&L: ${contract_data.profit} USD | Total P&L: ${this.martingaleState.totalProfit.toFixed(2)} USD`);
                console.log(`📊 MARTINGALE STATE: Consecutive losses: ${this.martingaleState.consecutiveLosses}, Next stake: ${this.tradeOptions.amount} USD`);

                // Update trade result and check readiness for the next trade
                this.updateTradeResult(contract_data.profit);
            } else {
                console.warn('Received contract closed/sold event without profit data:', contract_data);
            }
        }

        // Configure martingale parameters from bot builder settings
        configureMartingaleFromBot() {
            try {
                // Access bot configuration from various possible sources
                const botConfig = this.getBotConfiguration();

                if (botConfig) {
                    // Set martingale parameters from bot configuration
                    this.martingaleState.isEnabled = botConfig.martingale_enabled !== false; // Enable by default unless explicitly disabled

                    // Try multiple possible keys for the martingale multiplier from bot builder
                    const multiplierValue = parseFloat(botConfig.size) || 
                                          parseFloat(botConfig.martingale_size) || 
                                          parseFloat(botConfig.martingale_multiplier) || 
                                          parseFloat(botConfig.multiplier) || 
                                          2; // Default to 2 if not found

                    this.martingaleState.martingaleMultiplier = multiplierValue;
                    this.martingaleState.profitThreshold = parseFloat(botConfig.profit) || null;
                    this.martingaleState.lossThreshold = parseFloat(botConfig.loss) || null;
                    this.martingaleState.maxStake = parseFloat(botConfig.max_stake) || null;

                    // Calculate max consecutive losses based on max stake and user's multiplier
                    if (this.martingaleState.maxStake && this.tradeOptions.amount) {
                        const baseAmount = this.tradeOptions.amount;
                        const userMultiplier = this.martingaleState.martingaleMultiplier;
                        let consecutiveLosses = 0;
                        let currentStake = baseAmount;

                        while (currentStake <= this.martingaleState.maxStake) {
                            consecutiveLosses++;
                            currentStake = baseAmount * Math.pow(userMultiplier, consecutiveLosses);
                        }

                        this.martingaleState.maxConsecutiveLosses = Math.max(1, consecutiveLosses - 1);
                    }

                    console.log('🔧 MARTINGALE CONFIGURED:');
                    console.log(`   - Enabled: ${this.martingaleState.isEnabled}`);
                    console.log(`   - Multiplier: ${this.martingaleState.martingaleMultiplier}x (user configurable)`);
                    console.log(`   - Profit Threshold: ${this.martingaleState.profitThreshold || 'None'}`);
                    console.log(`   - Loss Threshold: ${this.martingaleState.lossThreshold || 'None'}`);
                    console.log(`   - Max Stake: ${this.martingaleState.maxStake || 'None'}`);
                    console.log(`   - Max Consecutive Losses: ${this.martingaleState.maxConsecutiveLosses}`);
                } else {
                    // Default configuration
                    this.martingaleState.isEnabled = true;
                    this.martingaleState.martingaleMultiplier = 2;
                    console.log('⚠️ MARTINGALE: Using default 2x multiplier');
                }
            } catch (error) {
                console.error('❌ MARTINGALE CONFIG ERROR:', error);
                // Use safe defaults
                this.martingaleState.isEnabled = true;
                this.martingaleState.martingaleMultiplier = 2;
            }
        }

        // Get bot configuration from various possible sources
        getBotConfiguration() {
            // Try to get configuration from different possible sources

            // 1. From tradeOptions if it contains bot config
            if (this.tradeOptions && this.tradeOptions.botConfig) {
                console.log('🔧 Found bot config in tradeOptions:', this.tradeOptions.botConfig);
                return this.tradeOptions.botConfig;
            }

            // 2. From options if it contains strategy config
            if (this.options && this.options.strategyConfig) {
                console.log('🔧 Found strategy config in options:', this.options.strategyConfig);
                return this.options.strategyConfig;
            }

            // 3. From store if available (most common for bot builder)
            if (this.store && this.store.getState) {
                const state = this.store.getState();

                // Try quick strategy store first
                if (state.quickStrategy && state.quickStrategy.formValues) {
                    const formValues = state.quickStrategy.formValues;
                    console.log('🔧 Found quick strategy form values:', formValues);
                    return {
                        martingale_enabled: true,
                        size: formValues.size || formValues.martingale_size || formValues.multiplier,
                        profit: formValues.profit,
                        loss: formValues.loss,
                        max_stake: formValues.max_stake,
                        initial_stake: formValues.stake || formValues.amount
                    };
                }

                // Try bot builder store
                if (state.botBuilder || state.quickStrategy) {
                    const builderState = state.botBuilder || state.quickStrategy;
                    console.log('🔧 Found bot builder state:', builderState);
                    return {
                        martingale_enabled: true,
                        size: builderState.size || builderState.martingale_size || builderState.multiplier,
                        profit: builderState.profit,
                        loss: builderState.loss,
                        max_stake: builderState.max_stake,
                        initial_stake: builderState.stake || builderState.amount
                    };
                }
            }

            // 4. From global bot store/workspace
            if (typeof window !== 'undefined' && window.Blockly && window.Blockly.derivWorkspace) {
                try {
                    const workspace = window.Blockly.derivWorkspace;
                    const xml = workspace.getXmlDom();

                    // Extract martingale parameters from XML
                    const config = this.extractMartingaleFromXML(xml);
                    if (config) {
                        console.log('🔧 Found config from Blockly XML:', config);
                        return config;
                    }
                } catch (e) {
                    console.warn('Could not extract config from Blockly workspace:', e);
                }
            }

            // 5. Check global variables that might contain bot configuration
            if (typeof window !== 'undefined') {
                if (window.bot_config) {
                    console.log('🔧 Found global bot_config:', window.bot_config);
                    return window.bot_config;
                }

                if (window.strategy_config) {
                    console.log('🔧 Found global strategy_config:', window.strategy_config);
                    return window.strategy_config;
                }
            }

            console.warn('⚠️ No bot configuration found, using defaults');
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

            // Apply martingale logic before purchase (based on previous closed trade results)
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

            const { baseAmount, consecutiveLosses, maxConsecutiveLosses } = this.martingaleState;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                console.log(`🟦 MARTINGALE LIMITS: Max consecutive losses: ${maxConsecutiveLosses}`);
                console.log(`🟦 MARTINGALE FACTOR: 2x per loss (fixed)`);
                return;
            }

            // Calculate current stake based on consecutive losses using user-defined multiplier
            const userMultiplier = this.martingaleState.martingaleMultiplier;
            const currentStake = baseAmount * Math.pow(userMultiplier, consecutiveLosses);

            // Check max stake limit if configured
            if (this.martingaleState.maxStake && currentStake > this.martingaleState.maxStake) {
                console.log(`⚠️ STAKE LIMIT: Calculated ${currentStake} exceeds max ${this.martingaleState.maxStake}, using base`);
                this.tradeOptions.amount = baseAmount;
            } else {
                this.tradeOptions.amount = Math.round(currentStake * 100) / 100;
            }

            console.log(`💰 MARTINGALE STAKE: ${this.tradeOptions.amount} USD (base: ${baseAmount}, losses: ${consecutiveLosses}, multiplier: ${userMultiplier}x)`);
        }

        // IMMEDIATE martingale application - called directly after trade result
        applyMartingaleLogicImmediate(profit) {
            if (!this.martingaleState.isEnabled) {
                console.log('🔴 MARTINGALE DISABLED: Using fixed stake');
                return;
            }

            const { baseAmount, consecutiveLosses, maxConsecutiveLosses } = this.martingaleState;

            // Initialize base amount on first run
            if (!baseAmount) {
                this.martingaleState.baseAmount = this.tradeOptions.amount;
                console.log(`🟦 MARTINGALE INIT: Base amount set to ${this.martingaleState.baseAmount} USD`);
                return;
            }

            console.log(`⚡ IMMEDIATE MARTINGALE: Processing trade result P&L: ${profit} USD`);
            console.log(`⚡ Current consecutive losses: ${consecutiveLosses}`);

            if (profit < 0) {
                // Loss: Multiply stake by user-defined multiplier
                const newConsecutiveLosses = consecutiveLosses + 1;
                const userMultiplier = this.martingaleState.martingaleMultiplier;

                if (newConsecutiveLosses <= maxConsecutiveLosses) {
                    this.martingaleState.consecutiveLosses = newConsecutiveLosses;

                    // Multiply by user-defined multiplier for each consecutive loss
                    const newStake = baseAmount * Math.pow(userMultiplier, newConsecutiveLosses);

                    // Check max stake limit if configured
                    if (this.martingaleState.maxStake && newStake > this.martingaleState.maxStake) {
                        console.log(`⚠️ STAKE LIMIT: Calculated ${newStake} exceeds max ${this.martingaleState.maxStake}, resetting to base`);
                        this.resetMartingale();
                        return;
                    }

                    this.tradeOptions.amount = Math.round(newStake * 100) / 100;

                    console.log(`🔴 LOSS: Multiplying stake by ${userMultiplier}x`);
                    console.log(`🔴 Stake: ${baseAmount} * ${userMultiplier}^${newConsecutiveLosses} = ${this.tradeOptions.amount} USD`);
                    console.log(`🔴 Consecutive losses: ${newConsecutiveLosses}/${maxConsecutiveLosses}`);
                } else {
                    // Reset on max consecutive losses
                    this.resetMartingale();
                    console.log(`⚠️ MAX LOSSES REACHED: Reset to base ${this.martingaleState.baseAmount} USD`);
                }
            } else if (profit > 0) {
                // Win: Reset martingale sequence to base amount
                const previousStake = this.tradeOptions.amount;
                this.resetMartingale();
                console.log(`🟢 WIN: Martingale sequence reset!`);
                console.log(`🟢 Stake reset: ${previousStake} USD → ${this.martingaleState.baseAmount} USD`);
            } else {
                // Break-even: Keep current state
                if (consecutiveLosses > 0) {
                    console.log(`🟡 BREAK-EVEN: Maintaining current martingale state`);
                } else {
                    this.tradeOptions.amount = baseAmount;
                    console.log(`🟡 BREAK-EVEN: Using base stake ${this.tradeOptions.amount} USD`);
                }
            }

            console.log(`⚡ NEXT TRADE STAKE: ${this.tradeOptions.amount} USD`);
        }

        resetMartingale() {
            this.martingaleState.consecutiveLosses = 0;
            this.martingaleState.totalProfit = 0;
            this.martingaleState.lastTradeProfit = null;
            this.martingaleState.currentPurchasePrice = 0;

            if (this.martingaleState.baseAmount) {
                this.tradeOptions.amount = this.martingaleState.baseAmount;
            }

            // Clear any pending contract closure state
            this.clearContractClosureState();

            console.log(`🔄 MARTINGALE RESET: Complete reset - Back to base amount ${this.tradeOptions.amount} USD`);
            console.log(`🔄 All martingale statistics cleared`);
        }

        // Method to update profit after trade result
        updateTradeResult(profit) {
            this.martingaleState.lastTradeProfit = profit;
            this.martingaleState.totalProfit = (this.martingaleState.totalProfit || 0) + profit;

            // Update engine configuration
            setTimeout(() => {
                this.configureMartingaleFromBot();
            }, 100);

            // Clear the waiting flags
            this.isWaitingForContractClosure = false;
            this.setWaitingForContractClose(false);

            // Update last trade time
            this.lastTradeTime = Date.now();

            console.log(`💰 TRADE RESULT: P&L: ${profit} USD | Total P&L: ${this.martingaleState.totalProfit.toFixed(2)} USD`);
            console.log(`📊 MARTINGALE STATE: Consecutive losses: ${this.martingaleState.consecutiveLosses}, Next stake: ${this.tradeOptions.amount} USD, Multiplier: ${this.martingaleState.martingaleMultiplier}x`);

            // Trigger readiness check for next trade
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

        // Set custom martingale multiplier
        setMartingaleMultiplier(multiplier) {
            if (multiplier && multiplier > 1) {
                this.martingaleState.martingaleMultiplier = parseFloat(multiplier);
                console.log(`🔧 MARTINGALE MULTIPLIER: Set to ${this.martingaleState.martingaleMultiplier}x`);
            } else {
                console.warn('⚠️ Invalid martingale multiplier. Must be greater than 1.');
            }
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
                            if (contract && contract.is_sold && contract.status === 'sold') {
                                console.log(`✅ CONTRACT CLOSED: ID ${contractId}, Final profit: ${contract.profit} USD`);

                                // Apply martingale logic AFTER contract is closed with final profit
                                this.applyMartingaleLogicImmediate(parseFloat(contract.profit));

                                // Update trade result with final profit
                                this.updateTradeResult(contract.profit);

                                clearInterval(intervalId);
                                this.clearContractClosureState();
                                resolve();
                            } else if (contract && contract.status === 'open') {
                                console.log(`🔍 Contract ${contractId} still open, profit: ${contract.profit || 'N/A'} USD`);
                            } else {
                                console.log(`🔍 Checking contract status: ${contractId} - ${contract ? contract.status : 'not found'}`);
                            }
                        })
                        .catch(error => {
                            console.error('Error checking contract closure:', error);
                            clearInterval(intervalId);
                            this.clearContractClosureState();
                            resolve();
                        });
                }, 2000); // Poll every 2 seconds for faster response
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