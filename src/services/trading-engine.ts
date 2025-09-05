
interface ContractRequest {
    contract_type: string;
    symbol: string;
    barrier?: number;
    amount: number;
    duration: number;
    duration_unit: string;
    currency: string;
}

interface TradeResult {
    contract_id?: string;
    profit: number;
    payout?: number;
    status: 'won' | 'lost' | 'active' | 'error';
    buy_price?: number;
    sell_price?: number;
    error?: string;
}

type TradeCallback = (result: TradeResult) => void;

class TradingEngine {
    private ws: WebSocket | null = null;
    private isConnected = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private activeContracts = new Map<string, any>();
    private pendingTrades = new Map<string, TradeCallback>();
    private isAuthorized = false;
    private balance = 0;

    constructor() {
        this.connect();
    }

    connect() {
        if (this.isConnected || this.ws?.readyState === WebSocket.CONNECTING) {
            return;
        }

        try {
            this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
            
            this.ws.onopen = () => {
                console.log('Trading Engine connected');
                this.isConnected = true;
                this.requestBalance();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onclose = () => {
                console.log('Trading Engine disconnected');
                this.isConnected = false;
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('Trading Engine WebSocket error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('Failed to connect Trading Engine:', error);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        this.reconnectTimeout = setTimeout(() => {
            console.log('Reconnecting Trading Engine...');
            this.connect();
        }, 3000);
    }

    private requestBalance() {
        if (!this.isConnected || !this.ws) return;

        // Request balance for demo account
        const balanceRequest = {
            balance: 1,
            account: 'all'
        };

        this.ws.send(JSON.stringify(balanceRequest));
    }

    private handleMessage(data: any) {
        switch (data.msg_type) {
            case 'balance':
                this.balance = data.balance?.balance || 0;
                this.isAuthorized = true;
                break;

            case 'buy':
                this.handleBuyResponse(data);
                break;

            case 'proposal':
                this.handleProposalResponse(data);
                break;

            case 'proposal_open_contract':
                this.handleContractUpdate(data);
                break;

            case 'sell':
                this.handleSellResponse(data);
                break;

            case 'error':
                this.handleErrorResponse(data);
                break;
        }
    }

    private handleBuyResponse(data: any) {
        if (data.buy) {
            const contractId = data.buy.contract_id;
            this.activeContracts.set(contractId, {
                ...data.buy,
                start_time: Date.now()
            });

            // Subscribe to contract updates
            this.subscribeToContract(contractId);
        }
    }

    private handleProposalResponse(data: any) {
        // Handle proposal responses for price quotes
        if (data.proposal && data.echo_req) {
            console.log('Proposal received:', data.proposal);
        }
    }

    private handleContractUpdate(data: any) {
        if (data.proposal_open_contract) {
            const contract = data.proposal_open_contract;
            const contractId = contract.contract_id;
            
            if (this.activeContracts.has(contractId)) {
                this.activeContracts.set(contractId, contract);

                // Check if contract is finished
                if (contract.is_settleable || contract.status === 'sold') {
                    this.finalizeContract(contractId, contract);
                }
            }
        }
    }

    private handleSellResponse(data: any) {
        if (data.sell) {
            console.log('Contract sold:', data.sell);
        }
    }

    private handleErrorResponse(data: any) {
        console.error('Trading Engine error:', data.error);
        
        if (data.echo_req && data.echo_req.req_id) {
            const callback = this.pendingTrades.get(data.echo_req.req_id);
            if (callback) {
                callback({
                    profit: 0,
                    status: 'error',
                    error: data.error.message
                });
                this.pendingTrades.delete(data.echo_req.req_id);
            }
        }
    }

    private subscribeToContract(contractId: string) {
        if (!this.ws || !this.isConnected) return;

        const subscribeRequest = {
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1
        };

        this.ws.send(JSON.stringify(subscribeRequest));
    }

    private finalizeContract(contractId: string, contract: any) {
        const reqId = this.findReqIdForContract(contractId);
        const callback = reqId ? this.pendingTrades.get(reqId) : null;

        if (callback) {
            const buyPrice = contract.buy_price || 0;
            const sellPrice = contract.sell_price || 0;
            const profit = sellPrice - buyPrice;

            const result: TradeResult = {
                contract_id: contractId,
                profit,
                payout: sellPrice,
                buy_price: buyPrice,
                sell_price: sellPrice,
                status: profit > 0 ? 'won' : 'lost'
            };

            callback(result);
            this.pendingTrades.delete(reqId);
        }

        this.activeContracts.delete(contractId);
    }

    private findReqIdForContract(contractId: string): string | null {
        // This would ideally track req_id to contract_id mapping
        // For simplicity, we'll return the contract_id as req_id
        return contractId;
    }

    async executeTrade(contractRequest: ContractRequest, callback: TradeCallback): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.ws) {
                const error = { error: 'Trading engine not connected' };
                callback({
                    profit: 0,
                    status: 'error',
                    error: 'Not connected'
                });
                reject(error);
                return;
            }

            if (!this.isAuthorized) {
                const error = { error: 'Trading engine not authorized' };
                callback({
                    profit: 0,
                    status: 'error',
                    error: 'Not authorized'
                });
                reject(error);
                return;
            }

            const reqId = this.generateReqId();
            
            // Store callback for later
            this.pendingTrades.set(reqId, callback);

            // First get proposal
            const proposalRequest = {
                proposal: 1,
                req_id: reqId,
                ...contractRequest
            };

            this.ws.send(JSON.stringify(proposalRequest));

            // Simulate buy after proposal (in real implementation, you'd wait for proposal response)
            setTimeout(() => {
                this.executeBuy(contractRequest, reqId);
            }, 500);

            resolve({ req_id: reqId });
        });
    }

    private executeBuy(contractRequest: ContractRequest, reqId: string) {
        if (!this.ws || !this.isConnected) return;

        const buyRequest = {
            buy: reqId,
            price: contractRequest.amount,
            req_id: reqId
        };

        this.ws.send(JSON.stringify(buyRequest));
    }

    private generateReqId(): string {
        return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    sellContract(contractId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || !this.isConnected) {
                reject({ error: 'Trading engine not connected' });
                return;
            }

            const sellRequest = {
                sell: contractId,
                price: 0 // Sell at market price
            };

            this.ws.send(JSON.stringify(sellRequest));
            resolve({ message: 'Sell request sent' });
        });
    }

    getBalance(): number {
        return this.balance;
    }

    isEngineConnected(): boolean {
        return this.isConnected && this.isAuthorized;
    }

    getActiveContracts(): Map<string, any> {
        return this.activeContracts;
    }

    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.isAuthorized = false;
        this.activeContracts.clear();
        this.pendingTrades.clear();
    }
}

export const tradingEngine = new TradingEngine();
