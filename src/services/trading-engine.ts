
interface ContractRequest {
    contract_type: string;
    symbol: string;
    barrier?: number;
    amount: number;
    duration: number;
    duration_unit: string;
    currency: string;
}

interface ActiveContract {
    id: string;
    symbol: string;
    contract_type: string;
    barrier?: number;
    amount: number;
    buy_price: number;
    payout?: number;
    profit?: number;
    status: 'active' | 'won' | 'lost';
    start_time: number;
    end_time?: number;
}

class TradingEngine {
    private ws: WebSocket | null = null;
    private isConnected = false;
    private messageHandlers = new Map<string, (data: any) => void>();
    private activeContracts = new Map<string, ActiveContract>();
    private contractCallbacks = new Map<string, (result: any) => void>();

    constructor() {
        this.connect();
    }

    private connect() {
        try {
            this.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=75771');

            this.ws.onopen = () => {
                console.log('Trading Engine connected');
                this.isConnected = true;
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing trading message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('Trading Engine disconnected');
                this.isConnected = false;
                this.messageHandlers.clear();
                setTimeout(() => this.connect(), 3000);
            };

            this.ws.onerror = (error) => {
                console.error('Trading Engine error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('Failed to create Trading Engine WebSocket:', error);
        }
    }

    private handleMessage(data: any) {
        if (data.req_id && this.messageHandlers.has(data.req_id)) {
            const handler = this.messageHandlers.get(data.req_id);
            if (handler) {
                handler(data);
                this.messageHandlers.delete(data.req_id);
            }
        }

        // Handle contract updates
        if (data.proposal_open_contract) {
            this.handleContractUpdate(data.proposal_open_contract);
        }
    }

    private handleContractUpdate(contractData: any) {
        const contractId = contractData.contract_id?.toString();
        if (!contractId) return;

        const contract = this.activeContracts.get(contractId);
        if (contract) {
            // Update contract status
            if (contractData.is_sold) {
                contract.status = contractData.profit > 0 ? 'won' : 'lost';
                contract.profit = contractData.profit;
                contract.payout = contractData.payout;
                contract.end_time = Date.now();

                // Notify callback
                const callback = this.contractCallbacks.get(contractId);
                if (callback) {
                    callback({
                        contract_id: contractId,
                        profit: contractData.profit,
                        payout: contractData.payout,
                        status: contract.status
                    });
                    this.contractCallbacks.delete(contractId);
                }
            }
        }
    }

    async getProposal(contractRequest: ContractRequest): Promise<any> {
        if (!this.isConnected || !this.ws) {
            throw new Error('Trading engine not connected');
        }

        return new Promise((resolve, reject) => {
            const requestId = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const request = {
                proposal: 1,
                contract_type: contractRequest.contract_type,
                symbol: contractRequest.symbol,
                barrier: contractRequest.barrier,
                amount: contractRequest.amount,
                duration: contractRequest.duration,
                duration_unit: contractRequest.duration_unit,
                currency: contractRequest.currency,
                req_id: requestId
            };

            this.messageHandlers.set(requestId, (data) => {
                if (data.error) {
                    reject(new Error(data.error.message || 'Proposal failed'));
                } else {
                    resolve(data.proposal);
                }
            });

            try {
                this.ws!.send(JSON.stringify(request));
            } catch (error) {
                this.messageHandlers.delete(requestId);
                reject(error);
            }

            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    reject(new Error('Proposal request timeout'));
                }
            }, 10000);
        });
    }

    async buyContract(proposalId: string, amount: number, onResult?: (result: any) => void): Promise<any> {
        if (!this.isConnected || !this.ws) {
            throw new Error('Trading engine not connected');
        }

        return new Promise((resolve, reject) => {
            const requestId = `buy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const request = {
                buy: proposalId,
                price: amount,
                req_id: requestId
            };

            this.messageHandlers.set(requestId, (data) => {
                if (data.error) {
                    reject(new Error(data.error.message || 'Buy contract failed'));
                } else {
                    const contractId = data.buy.contract_id?.toString();
                    if (contractId && onResult) {
                        this.contractCallbacks.set(contractId, onResult);
                        this.subscribeToContract(contractId);
                    }
                    resolve(data.buy);
                }
            });

            try {
                this.ws!.send(JSON.stringify(request));
            } catch (error) {
                this.messageHandlers.delete(requestId);
                reject(error);
            }

            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    reject(new Error('Buy request timeout'));
                }
            }, 10000);
        });
    }

    private async subscribeToContract(contractId: string) {
        const requestId = `contract_${contractId}`;
        
        const request = {
            proposal_open_contract: 1,
            contract_id: parseInt(contractId),
            subscribe: 1,
            req_id: requestId
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(request));
        }
    }

    async executeTrade(contractRequest: ContractRequest, onResult?: (result: any) => void): Promise<any> {
        try {
            // Get proposal first
            const proposal = await this.getProposal(contractRequest);
            
            // Buy the contract
            const buyResult = await this.buyContract(proposal.id, contractRequest.amount, onResult);
            
            return {
                proposal,
                buy: buyResult,
                contract_id: buyResult.contract_id
            };
        } catch (error) {
            console.error('Trade execution failed:', error);
            throw error;
        }
    }

    isEngineConnected(): boolean {
        return this.isConnected;
    }

    getActiveContracts(): ActiveContract[] {
        return Array.from(this.activeContracts.values());
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
            this.messageHandlers.clear();
            this.activeContracts.clear();
            this.contractCallbacks.clear();
        }
    }
}

export const tradingEngine = new TradingEngine();
export default TradingEngine;
