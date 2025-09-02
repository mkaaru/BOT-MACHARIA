
class MLTradingEngine {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private messageHandlers = new Map<string, (data: any) => void>();
  private token: string | null = null;
  private isAuthorized = false;
  private subscriptions = new Set<string>();

  constructor() {
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      this.ws.onopen = () => {
        console.log('ML Trading engine WebSocket connected');
        this.isConnected = true;
        // Re-authorize if we have a token
        if (this.token) {
          this.authorize(this.token);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle subscription responses
          if (data.subscription && data.subscription.id) {
            this.subscriptions.add(data.subscription.id);
          }

          if (data.req_id && this.messageHandlers.has(data.req_id)) {
            const handler = this.messageHandlers.get(data.req_id);
            if (handler) {
              handler(data);
              this.messageHandlers.delete(data.req_id);
            }
          }
        } catch (error) {
          console.error('Error parsing ML trading engine message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('ML Trading engine WebSocket disconnected');
        this.isConnected = false;
        this.isAuthorized = false;
        this.subscriptions.clear();
        // Clear pending handlers
        this.messageHandlers.clear();
        // Reconnect after 3 seconds
        setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (error) => {
        console.error('ML Trading engine WebSocket error:', error);
        this.isConnected = false;
        this.isAuthorized = false;
      };

    } catch (error) {
      console.error('Failed to create ML trading engine WebSocket:', error);
    }
  }

  async authorize(token: string): Promise<any> {
    this.token = token;
    
    if (!this.isConnected || !this.ws) {
      throw new Error('ML Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        authorize: token,
        req_id: requestId
      };

      console.log('Authorizing ML trading engine...');

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          console.error('Authorization error:', data.error);
          this.isAuthorized = false;
          reject(new Error(data.error.message || 'Authorization failed'));
        } else {
          console.log('ML Trading engine authorized successfully');
          this.isAuthorized = true;
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Authorization timeout'));
        }
      }, 10000);
    });
  }

  async getProposal(params: any): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('ML Trading engine not connected');
    }

    if (!this.isAuthorized) {
      throw new Error('ML Trading engine not authorized');
    }

    return new Promise((resolve, reject) => {
      const requestId = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        proposal: 1,
        req_id: requestId,
        ...params
      };

      console.log('ML Trading engine sending proposal request:', request);

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          console.error('ML Trading proposal error:', data.error);
          reject(new Error(data.error.message || 'Proposal failed'));
        } else {
          console.log('ML Trading proposal response:', data);
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

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
      throw new Error('ML Trading engine not connected');
    }

    if (!this.isAuthorized) {
      throw new Error('ML Trading engine not authorized');
    }

    return new Promise((resolve, reject) => {
      const requestId = `buy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        buy: proposalId,
        price: price,
        req_id: requestId
      };

      console.log('ML Trading engine buying contract:', request);

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          console.error('ML Trading buy error:', data.error);
          reject(new Error(data.error.message || 'Buy contract failed'));
        } else {
          console.log('ML Trading buy response:', data);
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Buy request timeout'));
        }
      }, 10000);
    });
  }

  async subscribeToTicks(symbol: string): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('ML Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `ticks_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        ticks: symbol,
        subscribe: 1,
        req_id: requestId
      };

      console.log('ML Trading engine subscribing to ticks:', request);

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          console.error('ML Trading ticks subscription error:', data.error);
          reject(new Error(data.error.message || 'Ticks subscription failed'));
        } else {
          console.log('ML Trading ticks subscription response:', data);
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Ticks subscription timeout'));
        }
      }, 10000);
    });
  }

  async subscribeToContract(contractId: string): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('ML Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `contract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        proposal_open_contract: 1,
        contract_id: contractId,
        subscribe: 1,
        req_id: requestId
      };

      console.log('ML Trading engine subscribing to contract:', request);

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          console.error('ML Trading contract subscription error:', data.error);
          reject(data.error);
        } else {
          console.log('ML Trading contract subscription response:', data);
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Contract subscription timeout'));
        }
      }, 10000);
    });
  }

  async getActiveSymbols(): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('ML Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `symbols_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        active_symbols: 'brief',
        req_id: requestId
      };

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(new Error(data.error.message || 'Failed to get active symbols'));
        } else {
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Active symbols request timeout'));
        }
      }, 10000);
    });
  }

  async getTicksHistory(symbol: string, count: number = 4000): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('ML Trading engine not connected');
    }

    return new Promise((resolve, reject) => {
      const requestId = `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const request = {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: count,
        end: "latest",
        start: 1,
        style: "ticks",
        req_id: requestId
      };

      // Set up message handler
      this.messageHandlers.set(requestId, (data) => {
        if (data.error) {
          reject(new Error(data.error.message || 'Failed to get ticks history'));
        } else {
          resolve(data);
        }
      });

      // Send request
      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }

      // Timeout after 15 seconds (longer for history)
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Ticks history request timeout'));
        }
      }, 15000);
    });
  }

  async forgetSubscription(subscriptionId: string): Promise<void> {
    if (!this.isConnected || !this.ws || !this.subscriptions.has(subscriptionId)) {
      return;
    }

    try {
      const request = {
        forget: subscriptionId
      };

      this.ws.send(JSON.stringify(request));
      this.subscriptions.delete(subscriptionId);
      console.log(`ML Trading engine forgot subscription: ${subscriptionId}`);
    } catch (error) {
      console.error('Error forgetting subscription:', error);
    }
  }

  // Add message event listener for real-time updates
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    if (this.ws) {
      this.ws.addEventListener(type, listener);
    }
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    if (this.ws) {
      this.ws.removeEventListener(type, listener);
    }
  }

  isEngineConnected(): boolean {
    return this.isConnected && this.isAuthorized;
  }

  getConnectionStatus(): { connected: boolean; authorized: boolean } {
    return {
      connected: this.isConnected,
      authorized: this.isAuthorized
    };
  }

  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  getAllSubscriptions(): Set<string> {
    return new Set(this.subscriptions);
  }

  async forgetAllSubscriptions(): Promise<void> {
    const promises = Array.from(this.subscriptions).map(id => this.forgetSubscription(id));
    await Promise.all(promises);
  }

  disconnect() {
    if (this.ws) {
      // Clean up all subscriptions first
      this.forgetAllSubscriptions();
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.isAuthorized = false;
      this.messageHandlers.clear();
      this.subscriptions.clear();
    }
  }
}

export const mlTradingEngine = new MLTradingEngine();
