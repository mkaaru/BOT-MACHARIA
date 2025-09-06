import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, tradeOptionToBuy, tradeCopyOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        constructor(...args) {
            super(...args);
            this.tradeListeners = [];
        }

        validateTokens(tokens) {
            if (!Array.isArray(tokens)) return false;
            const tokenPattern = /^[\w\s-]+$/;
            return tokens.every(token => typeof token === 'string' && tokenPattern.test(token));
        }

        // This is the main purchase method that will be called from TradingHubDisplay
        purchase(contract_type) {
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const trades = [];

            // Standard option for current account
            const standard_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            trades.push(doUntilDone(() => {
                if (['MULTUP', 'MULTDOWN'].includes(contract_type)) {
                    console.warn(`Trade type ${contract_type} is not supported.`);
                    return Promise.resolve();
                }
                return api_base.api.send(standard_option);
            }).catch(e => console.warn(e)));

            const savedTokens = localStorage.getItem(`extratokens_${this.accountInfo.loginid}`);
            const tokens = savedTokens ? JSON.parse(savedTokens) : [];
            const copyTradeEnabled = localStorage.getItem(`copytradeenabled_${this.accountInfo.loginid}`) === 'true';
            const copyToReal = this.accountInfo.loginid?.startsWith('VR') &&
                localStorage.getItem(`copytoreal_${this.accountInfo.loginid}`) === 'true';

            // Copy trading logic for multiple accounts
            if (copyTradeEnabled && tokens.length > 0) {
                const copy_option = {
                    buy_contract_for_multiple_accounts: '1',
                    price: this.tradeOptions.amount,
                    tokens,
                    parameters: {
                        amount: this.tradeOptions.amount,
                        basis: this.tradeOptions.basis,
                        contract_type,
                        currency: this.tradeOptions.currency,
                        duration: this.tradeOptions.duration,
                        duration_unit: this.tradeOptions.duration_unit,
                        symbol: this.tradeOptions.symbol
                    }
                };

                if (this.tradeOptions.prediction !== undefined) {
                    copy_option.parameters.barrier = this.tradeOptions.prediction;
                }
                if (this.tradeOptions.barrierOffset !== undefined) {
                    copy_option.parameters.barrier = this.tradeOptions.barrierOffset;
                }
                if (this.tradeOptions.secondBarrierOffset !== undefined) {
                    copy_option.parameters.barrier2 = this.tradeOptions.secondBarrierOffset;
                }

                trades.push(doUntilDone(() => api_base.api.send(copy_option)));
            }

            // Copy trading logic for real accounts
            if (copyToReal) {
                try {
                    const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
                    const realAccountToken = Object.entries(accountsList).find(([id]) => id.startsWith('CR'))?.[1];
                    if (realAccountToken) {
                        const real_option = {
                            buy_contract_for_multiple_accounts: '1',
                            price: this.tradeOptions.amount,
                            tokens: [realAccountToken],
                            parameters: {
                                amount: this.tradeOptions.amount,
                                basis: this.tradeOptions.basis,
                                contract_type,
                                currency: this.tradeOptions.currency,
                                duration: this.tradeOptions.duration,
                                duration_unit: this.tradeOptions.duration_unit,
                                symbol: this.tradeOptions.symbol
                            }
                        };

                        if (this.tradeOptions.prediction !== undefined) {
                            real_option.parameters.barrier = this.tradeOptions.prediction;
                        }
                        if (this.tradeOptions.barrierOffset !== undefined) {
                            real_option.parameters.barrier = this.tradeOptions.barrierOffset;
                        }
                        if (this.tradeOptions.secondBarrierOffset !== undefined) {
                            real_option.parameters.barrier2 = this.tradeOptions.secondBarrierOffset;
                        }

                        trades.push(doUntilDone(() => api_base.api.send(real_option)));
                    }
                } catch (e) {
                    console.error('Error copying to real account:', e);
                }
            }

            if (trades.length === 0) {
                return Promise.resolve();
            }

            return Promise.all(trades)
                .then(responses => {
                    const successfulTrades = responses.filter(response => response && response.buy);
                    if (successfulTrades.length > 0) {
                        return Promise.all(
                            successfulTrades.map(response =>
                                this.handlePurchaseSuccess(response, contract_type, this.tradeOptions.amount)
                            )
                        );
                    }
                    return responses;
                });
        }

        handlePurchaseSuccess(response, contract_type, stake) {
            if (!response || !response.buy) return;

            const buy = response.buy;

            // Validate contract ID for demo accounts
           // if (this.accountInfo.is_virtual) {
                //const contractIdStr = buy.contract_id.toString();
                // Demo contract IDs should be valid numbers and match expected format
                //if (!contractIdStr || contractIdStr === 'undefined' || isNaN(buy.contract_id)) {
                   // console.error('Invalid demo contract ID received:', buy.contract_id);
                   // return;
                //}
                
                // Additional validation for demo accounts
              //  console.log(`Demo contract validated - ID: ${buy.contract_id}, Transaction: ${buy.transaction_id}`);
            //}

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

            // Notify all trade listeners
            this.notifyTradeListeners({
                type: 'purchase',
                contract_id: buy.contract_id,
                transaction_id: buy.transaction_id,
                contract_type,
                buy_price: buy.buy_price,
                timestamp: new Date(),
            });

            return response;
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };

        // New methods for trade listening
        listenToTrades(callback) {
            if (typeof callback !== 'function') {
                throw new Error('Trade listener callback must be a function');
            }
            const listenerId = getUUID();
            this.tradeListeners.push({ id: listenerId, callback });
            return listenerId;
        }

        stopListeningToTrades(listenerId) {
            this.tradeListeners = this.tradeListeners.filter(listener => listener.id !== listenerId);
            return true;
        }

        notifyTradeListeners(tradeData) {
            this.tradeListeners.forEach(listener => {
                try {
                    listener.callback(tradeData);
                } catch (error) {
                    console.error('Error in trade listener callback:', error);
                }
            });
        }
    };