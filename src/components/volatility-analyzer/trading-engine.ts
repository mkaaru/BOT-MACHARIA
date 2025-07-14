class TradingEngine {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private messageHandlers = new Map<string, (data: any) => void>();

  constructor() {
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      this.ws.onopen = () => {
        console.log('Trading engine WebSocket connected');
        this.isConnected = true;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.req_id && this.messageHandlers.has(data.req_id)) {
            const handler = this.messageHandlers.get(data.req_id);
            if (handler) {
              handler(data);
              this.messageHandlers.delete(data.req_id);
            }
          }
        } catch (error) {
          console.error('Error parsing trading engine message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Trading engine WebSocket disconnected');
        this.isConnected = false;
        // Clear pending handlers
        this.messageHandlers.clear();
        // Reconnect after 3 seconds
        setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (error) => {
        console.error('Trading engine WebSocket error:', error);
        this.isConnected = false;
      };

    } catch (error) {
      console.error('Failed to create trading engine WebSocket:', error);
    }
  }

  async getProposal(params: any): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        proposal: 1,
        ...params,
        req_id: requestId
      };

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      // Send request
      this.ws!.send(JSON.stringify(request));

      // Timeout after 10 seconds
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
      throw new Error('Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `buy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        buy: proposalId,
        price: price,
        req_id: requestId
      };

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      // Send request
      this.ws!.send(JSON.stringify(request));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Buy request timeout'));
        }
      }, 10000);
    });
  }

  isEngineConnected(): boolean {
    return this.isConnected;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.messageHandlers.clear();
    }
  }
}

export const tradingEngine = new TradingEngine();