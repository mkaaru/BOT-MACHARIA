import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { 
    DerivAPIInstance, 
    TickResponse,
    isTickResponse,
    hasAPIError
} from '@/types/deriv-api-types';

export interface TickData {
    symbol: string;
    epoch: number;
    quote: number;
    timestamp: Date;
}

export interface CandleData {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    epoch: number;
    timestamp: Date;
}

export interface SymbolInfo {
    symbol: string;
    display_name: string;
    is_1s_volatility: boolean;
}

// Comprehensive list of volatility indices including all 1-second variants
export const VOLATILITY_SYMBOLS: SymbolInfo[] = [
    // 1-second volatilities
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ15V', display_name: 'Volatility 15 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ30V', display_name: 'Volatility 30 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ90V', display_name: 'Volatility 90 (1s) Index', is_1s_volatility: true },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', is_1s_volatility: true },
    
    // Regular volatilities
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s_volatility: false },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s_volatility: false },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s_volatility: false },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s_volatility: false },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s_volatility: false },
];

export class TickStreamManager {
    private api: DerivAPIInstance;
    private subscriptions: Map<string, string> = new Map(); // symbol -> subscription_id
    private tickCallbacks: Map<string, Set<(tick: TickData) => void>> = new Map();
    private messageHandler: ((evt: MessageEvent) => void) | null = null;
    private isConnected: boolean = false;

    constructor() {
        this.api = generateDerivApiInstance();
        this.setupMessageHandler();
    }

    private setupMessageHandler(): void {
        this.messageHandler = (evt: MessageEvent) => {
            try {
                const rawData = JSON.parse(evt.data);
                
                // Handle tick history response
                if (rawData.msg_type === 'history' && rawData.history) {
                    const symbol = rawData.echo_req.ticks_history;
                    const times = rawData.history.times;
                    const prices = rawData.history.prices;
                    
                    console.log(`Received history for ${symbol}: ${prices.length} ticks`);
                    
                    // Process historical ticks
                    for (let i = 0; i < prices.length; i++) {
                        const tickData: TickData = {
                            symbol,
                            epoch: times[i],
                            quote: parseFloat(prices[i]),
                            timestamp: new Date(times[i] * 1000),
                        };
                        this.notifyTickCallbacks(tickData);
                    }
                    return;
                }
                
                // Handle real-time tick updates
                if (isTickResponse(rawData)) {
                    const tickData: TickData = {
                        symbol: rawData.tick.symbol,
                        epoch: rawData.tick.epoch,
                        quote: rawData.tick.quote,
                        timestamp: new Date(rawData.tick.epoch * 1000),
                    };
                    this.notifyTickCallbacks(tickData);
                } else if (hasAPIError(rawData)) {
                    console.error(`TickStreamManager API Error - ${rawData.error.code}: ${rawData.error.message}`);
                }
            } catch (error) {
                console.error('TickStreamManager: Error parsing message:', error);
            }
        };

        if (this.api?.connection) {
            this.api.connection.addEventListener('message', this.messageHandler);
            this.api.connection.addEventListener('open', () => {
                this.isConnected = true;
                console.log('TickStreamManager connected to WebSocket');
            });
            this.api.connection.addEventListener('close', () => {
                this.isConnected = false;
                console.log('TickStreamManager disconnected from WebSocket');
            });
        }
    }

    private notifyTickCallbacks(tick: TickData): void {
        // Process tick through micro candle engine first
        import('./micro-candle-engine').then(({ microCandleEngine }) => {
            microCandleEngine.processTick(tick);
        });
        
        const callbacks = this.tickCallbacks.get(tick.symbol);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(tick);
                } catch (error) {
                    console.error(`Error in tick callback for ${tick.symbol}:`, error);
                }
            });
        }
    }

    async subscribeToSymbol(symbol: string): Promise<void> {
        if (this.subscriptions.has(symbol)) {
            console.log(`Already subscribed to ${symbol}`);
            return;
        }

        try {
            // First, get historical ticks (last 5000 ticks) for immediate trend analysis
            const historyResponse = await this.api.send({
                ticks_history: symbol,
                count: 5000,
                end: 'latest',
                style: 'ticks',
                subscribe: 1
            });

            if (historyResponse.error) {
                throw new Error(`Failed to get history for ${symbol}: ${historyResponse.error.message}`);
            }

            // Process historical ticks immediately
            if (historyResponse.history && historyResponse.history.prices) {
                const times = historyResponse.history.times;
                const prices = historyResponse.history.prices;
                
                console.log(`Processing ${prices.length} historical ticks for ${symbol}`);
                
                // Process each historical tick
                for (let i = 0; i < prices.length; i++) {
                    const tickData: TickData = {
                        symbol,
                        epoch: times[i],
                        quote: parseFloat(prices[i]),
                        timestamp: new Date(times[i] * 1000),
                    };
                    this.notifyTickCallbacks(tickData);
                }
            }

            // Store subscription ID for real-time updates
            if (historyResponse.subscription?.id) {
                this.subscriptions.set(symbol, historyResponse.subscription.id);
                console.log(`Successfully subscribed to ${symbol} with ID: ${historyResponse.subscription.id} and processed ${historyResponse.history?.prices?.length || 0} historical ticks`);
            }
        } catch (error) {
            console.error(`Error subscribing to ${symbol}:`, error);
            throw error;
        }
    }

    async subscribeToAllVolatilities(): Promise<void> {
        console.log('Subscribing to all volatility indices...');
        
        // Wait for connection to be ready
        if (!this.isConnected) {
            console.log('Waiting for WebSocket connection...');
            await this.waitForConnection();
        }

        const subscriptionPromises = VOLATILITY_SYMBOLS.map(async (symbolInfo, index) => {
            // Add small delay between subscriptions to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, index * 100));
            
            return this.subscribeToSymbol(symbolInfo.symbol).catch(error => {
                console.warn(`Failed to subscribe to ${symbolInfo.symbol}:`, error);
                return null;
            });
        });

        await Promise.allSettled(subscriptionPromises);
        console.log(`Subscribed to ${this.subscriptions.size} volatility indices`);
    }

    private async waitForConnection(timeout: number = 10000): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve();
                return;
            }

            const checkConnection = () => {
                if (this.isConnected) {
                    resolve();
                } else {
                    setTimeout(checkConnection, 100);
                }
            };

            setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, timeout);

            checkConnection();
        });
    }

    addTickCallback(symbol: string, callback: (tick: TickData) => void): void {
        if (!this.tickCallbacks.has(symbol)) {
            this.tickCallbacks.set(symbol, new Set());
        }
        this.tickCallbacks.get(symbol)!.add(callback);
    }

    removeTickCallback(symbol: string, callback: (tick: TickData) => void): void {
        const callbacks = this.tickCallbacks.get(symbol);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.tickCallbacks.delete(symbol);
            }
        }
    }

    async unsubscribeFromSymbol(symbol: string): Promise<void> {
        const subscriptionId = this.subscriptions.get(symbol);
        if (!subscriptionId) {
            return;
        }

        try {
            await this.api.send({ forget: subscriptionId });
            this.subscriptions.delete(symbol);
            this.tickCallbacks.delete(symbol);
            console.log(`Unsubscribed from ${symbol}`);
        } catch (error) {
            console.error(`Error unsubscribing from ${symbol}:`, error);
        }
    }

    async unsubscribeFromAll(): Promise<void> {
        const unsubscribePromises = Array.from(this.subscriptions.keys()).map(symbol =>
            this.unsubscribeFromSymbol(symbol)
        );
        await Promise.allSettled(unsubscribePromises);
    }

    getSubscribedSymbols(): string[] {
        return Array.from(this.subscriptions.keys());
    }

    isSubscribedTo(symbol: string): boolean {
        return this.subscriptions.has(symbol);
    }

    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    destroy(): void {
        this.unsubscribeFromAll();
        if (this.messageHandler && this.api?.connection) {
            this.api.connection.removeEventListener('message', this.messageHandler);
        }
        this.tickCallbacks.clear();
        this.subscriptions.clear();
    }
}

// Create singleton instance
export const tickStreamManager = new TickStreamManager();