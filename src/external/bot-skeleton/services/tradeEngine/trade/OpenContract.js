import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            this.observer.register('proposal.open_contract', this.handleOpenContract.bind(this));
            this.observer.register('contract.status', this.handleContractStatus.bind(this));
        }

        handleOpenContract(proposal) {
            if (!proposal.open_contract) {
                return;
            }

            const { open_contract } = proposal;
            this.data.contract = open_contract;

            // Check if contract is already sold
            if (open_contract.is_sold) {
                this.observer.emit('contract.status', {
                    id: 'contract.sold',
                    data: open_contract,
                });
                return;
            }

            // Monitor contract status
            this.observer.emit('contract.status', {
                id: 'contract.open',
                data: open_contract,
            });

            // Set up timeout for stuck contracts
            if (this.contractTimeoutId) {
                clearTimeout(this.contractTimeoutId);
            }

            this.contractTimeoutId = setTimeout(() => {
                if (this.data.contract && this.data.contract.contract_id === open_contract.contract_id) {
                    // Force contract completion if stuck
                    this.observer.emit('contract.status', {
                        id: 'contract.sold',
                        data: this.data.contract,
                    });
                }
            }, 30000); // 30 second timeout
        }

        handleContractStatus(contract) {
            if (!contract.data) {
                return;
            }

            const contractData = contract.data;

            // Update contract data
            if (contractData.contract_id === this.data.contract?.contract_id) {
                this.data.contract = { ...this.data.contract, ...contractData };
            }

            // Check various sold conditions
            if (contractData.is_sold || 
                contractData.contract_status === 'sold' || 
                contractData.status === 'sold' ||
                contractData.is_settleable) {

                if (this.contractTimeoutId) {
                    clearTimeout(this.contractTimeoutId);
                    this.contractTimeoutId = null;
                }

                this.observer.emit('contract.status', {
                    id: 'contract.sold',
                    data: contractData,
                });
            }
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };