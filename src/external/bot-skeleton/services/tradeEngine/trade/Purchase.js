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

            console.log('🟦 PURCHASE ENGINE: Initialized - Using XML-based martingale strategies');
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

        // Configure martingale from bot parameters - ensure proper contract completion
        configureMartingaleFromBot() {
            console.log('🔧 MARTINGALE: Configuration handled by XML strategy files');
            console.log('📁 Available XML strategies: martingale.xml, martingale-pro.xml, martingale_max-stake.xml');
            
            // Ensure we wait for contract completion before next trade
            this.contractCompletionRequired = true;
            this.isProcessingTrade = false;
            
            // Remove any per-tick listeners that might cause rapid execution
            this.removePerTickListeners();
        }

        // Remove per-tick execution listeners
        removePerTickListeners() {
            if (this.tickListener) {
                this.tickListener.unsubscribe();
                this.tickListener = null;
            }
            console.log('🔧 MARTINGALE: Removed per-tick listeners to prevent rapid execution');
        }

        // Ensure contract completion before next trade
        waitForContractCompletion(callback) {
            if (this.isProcessingTrade) {
                console.log('⏳ MARTINGALE: Waiting for current contract to complete...');
                return;
            }
            
            this.isProcessingTrade = true;
            
            // Set a timeout to ensure we don't wait indefinitely
            const completionTimeout = setTimeout(() => {
                console.log('⚠️ MARTINGALE: Contract completion timeout, proceeding with next trade');
                this.isProcessingTrade = false;
                if (callback) callback();
            }, 30000); // 30 second timeout
            
            // Wait for actual contract completion
            const checkCompletion = setInterval(() => {
                const openContract = this.getOpenContract();
                if (!openContract || openContract.is_sold) {
                    clearInterval(checkCompletion);
                    clearTimeout(completionTimeout);
                    this.isProcessingTrade = false;
                    console.log('✅ MARTINGALE: Contract completed, ready for next trade');
                    if (callback) callback();
                }
            }, 1000);
        }

        // Get current open contract
        getOpenContract() {
            try {
                return window.Blockly.derivWorkspace.getAllBlocks()
                    .find(block => block.type === 'open_contract')?.contract;
            } catch (error) {
                return null; here
        }
    };