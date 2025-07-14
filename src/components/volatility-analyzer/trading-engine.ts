
export class TradingEngine {
  private ws: WebSocket | null = null;
  private requestId = 1;
  private callbacks: Map<string, (response: any) => void> = new Map();

  constructor() {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');
    
    this.ws.onopen = () => {
      console.log('Trading WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      const response = JSON.parse(event.data);
      if (response.req_id && this.callbacks.has(response.req_id)) {
        const callback = this.callbacks.get(response.req_id);
        if (callback) {
          callback(response);
          this.callbacks.delete(response.req_id);
        }
      }
    };

    this.ws.onerror = (error) => {
      console.error('Trading WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('Trading WebSocket closed');
      // Reconnect after 5 seconds
      setTimeout(() => this.connect(), 5000);
    };
  }

  private send(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const reqId = `req_${this.requestId++}`;
      request.req_id = reqId;

      this.callbacks.set(reqId, (response) => {
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response);
        }
      });

      this.ws.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.callbacks.has(reqId)) {
          this.callbacks.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async authorize(token: string) {
    try {
      const response = await this.send({
        authorize: token
      });
      return response;
    } catch (error) {
      console.error('Authorization failed:', error);
      throw error;
    }
  }

  async getProposal(params: any) {
    try {
      const response = await this.send({
        proposal: 1,
        ...params
      });
      return response;
    } catch (error) {
      console.error('Proposal failed:', error);
      throw error;
    }
  }

  async buyContract(proposalId: string, price: number) {
    try {
      const response = await this.send({
        buy: proposalId,
        price: price
      });
      return response;
    } catch (error) {
      console.error('Purchase failed:', error);
      throw error;
    }
  }

  async getBalance() {
    try {
      const response = await this.send({
        balance: 1,
        subscribe: 1
      });
      return response;
    } catch (error) {
      console.error('Balance request failed:', error);
      throw error;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export const tradingEngine = new TradingEngine();
