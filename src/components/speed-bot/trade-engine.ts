
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

interface TradeOptions {
  symbol: string;
  contract_type: string;
  amount: number;
  currency: string;
  duration: number;
  duration_unit: string;
  barrier?: string;
  prediction?: number;
}

interface ProposalRequest {
  proposal: number;
  amount: number;
  basis: string;
  contract_type: string;
  currency: string;
  symbol: string;
  duration: number;
  duration_unit: string;
  barrier?: string;
  prediction?: number;
  req_id: string;
}

interface BuyRequest {
  buy: string;
  price: number;
  req_id: string;
}

interface SellRequest {
  sell: number;
  price: number;
  req_id: string;
}

class SpeedBotTradeEngine {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private messageHandlers = new Map<string, (data: any) => void>();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private currentProposals = new Map<string, any>();
  private activeContracts = new Map<string, any>();
  private token: string | null = null;
  
  // Trading statistics
  private totalRuns = 0;
  private consecutiveLosses = 0;
  private totalProfit = 0;
  private baseAmount = 0;
  private lastTradeProfit = 0;
  private currentPurchasePrice = 0;

  constructor() {
    this.connect();
  }

  private connect() {
    try {
      // Use the same app_id as the main application
      this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      this.ws.onopen = () => {
        console.log('Speed Bot Trade Engine WebSocket connected');
        this.isConnected = true;
        
        // Authorize if we have a token
        if (this.token) {
          this.authorize(this.token);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle different message types
          if (data.msg_type === 'proposal') {
            this.handleProposal(data);
          } else if (data.msg_type === 'buy') {
            this.handleBuyResponse(data);
          } else if (data.msg_type === 'sell') {
            this.handleSellResponse(data);
          } else if (data.msg_type === 'proposal_open_contract') {
            this.handleContractUpdate(data);
          } else if (data.msg_type === 'transaction') {
            this.handleTransaction(data);
          }

          // Handle responses with request IDs
          if (data.req_id && this.messageHandlers.has(data.req_id)) {
            const handler = this.messageHandlers.get(data.req_id);
            if (handler) {
              handler(data);
              this.messageHandlers.delete(data.req_id);
            }
          }
        } catch (error) {
          console.error('Error parsing trade engine message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Speed Bot Trade Engine WebSocket disconnected');
        this.isConnected = false;
        this.messageHandlers.clear();
        
        // Reconnect after 3 seconds
        this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (error) => {
        console.error('Speed Bot Trade Engine WebSocket error:', error);
        this.isConnected = false;
      };

    } catch (error) {
      console.error('Failed to create Speed Bot Trade Engine WebSocket:', error);
    }
  }

  private handleProposal(data: any) {
    if (data.proposal && data.req_id) {
      this.currentProposals.set(data.req_id, data.proposal);
    }
  }

  private handleBuyResponse(data: any) {
    if (data.buy) {
      const contract = data.buy;
      this.activeContracts.set(contract.contract_id, contract);
      this.currentPurchasePrice = contract.buy_price;
      
      // Subscribe to contract updates
      this.subscribeToContract(contract.contract_id);
      
      console.log('Contract purchased:', contract);
    }
  }

  private handleSellResponse(data: any) {
    if (data.sell) {
      const sellInfo = data.sell;
      console.log('Contract sold:', sellInfo);
    }
  }

  private handleContractUpdate(data: any) {
    if (data.proposal_open_contract) {
      const contract = data.proposal_open_contract;
      this.activeContracts.set(contract.contract_id, contract);
      
      // Check if contract is finished
      if (contract.is_settleable || contract.status === 'sold') {
        this.handleContractEnd(contract);
      }
    }
  }

  private handleTransaction(data: any) {
    if (data.transaction) {
      console.log('Transaction:', data.transaction);
    }
  }

  private handleContractEnd(contract: any) {
    const profit = contract.profit || 0;
    this.lastTradeProfit = profit;
    this.totalProfit += profit;
    this.totalRuns++;

    if (profit < 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }

    // Remove from active contracts
    this.activeContracts.delete(contract.contract_id);

    console.log('Contract ended:', {
      profit,
      totalProfit: this.totalProfit,
      consecutiveLosses: this.consecutiveLosses
    });
  }

  private subscribeToContract(contractId: string) {
    const request = {
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1
    };

    this.sendMessage(request);
  }

  private generateRequestId(): string {
    return `speedbot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private sendMessage(message: any): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('WebSocket not connected');
    }
  }

  async authorize(token: string): Promise<any> {
    this.token = token;
    
    if (!this.isConnected || !this.ws) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      const request = {
        authorize: token,
        req_id: requestId
      };

      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      this.sendMessage(request);

      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Authorization timeout'));
        }
      }, 10000);
    });
  }

  async getProposal(tradeOptions: TradeOptions): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Trade engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      const request: ProposalRequest = {
        proposal: 1,
        amount: tradeOptions.amount,
        basis: 'stake',
        contract_type: tradeOptions.contract_type,
        currency: tradeOptions.currency,
        symbol: tradeOptions.symbol,
        duration: tradeOptions.duration,
        duration_unit: tradeOptions.duration_unit,
        req_id: requestId
      };

      // Add barrier for over/under contracts
      if (tradeOptions.barrier) {
        request.barrier = tradeOptions.barrier;
      }

      // Add prediction for digit contracts
      if (tradeOptions.prediction !== undefined) {
        request.prediction = tradeOptions.prediction;
      }

      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      this.sendMessage(request);

      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Proposal request timeout'));
        }
      }, 10000);
    });
  }

  async buyContract(proposalId: string, price: number): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Trade engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      const request: BuyRequest = {
        buy: proposalId,
        price: price,
        req_id: requestId
      };

      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      this.sendMessage(request);

      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Buy request timeout'));
        }
      }, 10000);
    });
  }

  async sellContract(contractId: number, price: number): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Trade engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      const request: SellRequest = {
        sell: contractId,
        price: price,
        req_id: requestId
      };

      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      this.sendMessage(request);

      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Sell request timeout'));
        }
      }, 10000);
    });
  }

  async executeTrade(tradeOptions: TradeOptions): Promise<any> {
    try {
      // Get proposal first
      const proposalResponse = await this.getProposal(tradeOptions);
      
      if (!proposalResponse.proposal) {
        throw new Error('No proposal received');
      }

      const proposal = proposalResponse.proposal;
      
      // Buy the contract
      const buyResponse = await this.buyContract(proposal.id, proposal.ask_price);
      
      return buyResponse;
    } catch (error) {
      console.error('Error executing trade:', error);
      throw error;
    }
  }

  // Martingale helper methods
  getMartingaleMultiplier(): number {
    // Standard martingale: double after loss
    return Math.pow(2, this.consecutiveLosses);
  }

  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  getBaseAmount(): number {
    return this.baseAmount;
  }

  setBaseAmount(amount: number): void {
    this.baseAmount = amount;
  }

  getLastTradeProfit(): number {
    return this.lastTradeProfit;
  }

  getCurrentPurchasePrice(): number {
    return this.currentPurchasePrice;
  }

  getTotalProfit(): number {
    return this.totalProfit;
  }

  getTotalRuns(): number {
    return this.totalRuns;
  }

  resetStats(): void {
    this.totalRuns = 0;
    this.consecutiveLosses = 0;
    this.totalProfit = 0;
    this.lastTradeProfit = 0;
    this.currentPurchasePrice = 0;
  }

  getActiveContracts(): Map<string, any> {
    return this.activeContracts;
  }

  isEngineConnected(): boolean {
    return this.isConnected;
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.messageHandlers.clear();
      this.currentProposals.clear();
      this.activeContracts.clear();
    }
  }
}

export const speedBotTradeEngine = new SpeedBotTradeEngine();
export default SpeedBotTradeEngine;
