import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { 
    DerivAPIInstance, 
    TickResponse,
    isTickResponse,
    hasAPIError
} from '@/types/deriv-api-types';
import { tenSecondCandleEngine, ehlersTradingBot } from './ehlers-predictive-system';

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
                    
                    const symbolInfo = VOLATILITY_SYMBOLS.find(s => s.symbol === symbol);
                    const is1sVolatility = symbolInfo?.is_1s_volatility || false;
                    
                    console.log(`📈 Received history for ${symbol} (${is1sVolatility ? '1s' : 'regular'}): ${prices.length} ticks`);
                    
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
                    
                    console.log(`✅ Processed ${prices.length} historical ticks for ${symbol}`);
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
                    
                    const symbolInfo = VOLATILITY_SYMBOLS.find(s => s.symbol === tickData.symbol);
                    const is1sVolatility = symbolInfo?.is_1s_volatility || false;
                    
                    // Log 1-second volatility ticks for debugging
                    if (is1sVolatility) {
                        console.log(`🔄 Real-time tick for ${tickData.symbol}: ${tickData.quote.toFixed(5)}`);
                    }
                    
                    this.notifyTickCallbacks(tickData);
                } else if (hasAPIError(rawData)) {
                    console.error(`❌ TickStreamManager API Error - ${rawData.error.code}: ${rawData.error.message}`);
                    
                    // Log additional context for debugging
                    if (rawData.echo_req?.ticks_history) {
                        console.error(`❌ Error was for symbol: ${rawData.echo_req.ticks_history}`);
                    }
                }
            } catch (error) {
                console.error('❌ TickStreamManager: Error parsing message:', error);
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
        // Process tick through Ehlers 10-second candle system
        try {
            tenSecondCandleEngine.processTick(tick);
            ehlersTradingBot.processTick(tick);
        } catch (error) {
            console.error(`Error processing tick through Ehlers system for ${tick.symbol}:`, error);
        }

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
            // Determine if this is a 1-second volatility
            const symbolInfo = VOLATILITY_SYMBOLS.find(s => s.symbol === symbol);
            const is1sVolatility = symbolInfo?.is_1s_volatility || false;
            
            console.log(`📊 Subscribing to ${symbol} (${is1sVolatility ? '1-second' : 'regular'} volatility)...`);

            // First, get historical ticks without subscription to ensure we get the data
            const historyRequest = {
                ticks_history: symbol,
                count: 5000,
                end: 'latest',
                style: 'ticks'
            };

            console.log(`Requesting historical data for ${symbol}:`, historyRequest);
            const historyResponse = await this.api.send(historyRequest);

            if (historyResponse.error) {
                console.error(`❌ API Error for ${symbol}:`, historyResponse.error);
                throw new Error(`Failed to get history for ${symbol}: ${historyResponse.error.message} (Code: ${historyResponse.error.code})`);
            }

            // Process historical ticks immediately
            if (historyResponse.history && historyResponse.history.prices) {
                const times = historyResponse.history.times;
                const prices = historyResponse.history.prices;
                
                console.log(`✅ Processing ${prices.length} historical ticks for ${symbol} (${is1sVolatility ? '1s' : 'regular'})`);
                
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

                console.log(`🎯 ${symbol}: Historical data loaded (${prices.length} ticks), ready for 500-period ROC analysis`);
            } else {
                console.warn(`⚠️ No historical data received for ${symbol}`);
            }

            // Now subscribe for real-time updates
            const subscribeRequest = {
                ticks: symbol,
                subscribe: 1
            };

            console.log(`Subscribing to real-time ticks for ${symbol}:`, subscribeRequest);
            const subscribeResponse = await this.api.send(subscribeRequest);

            if (subscribeResponse.error) {
                console.error(`❌ Subscription API Error for ${symbol}:`, subscribeResponse.error);
                throw new Error(`Failed to subscribe to ${symbol}: ${subscribeResponse.error.message} (Code: ${subscribeResponse.error.code})`);
            }

            // Store subscription ID for real-time updates
            if (subscribeResponse.subscription?.id) {
                this.subscriptions.set(symbol, subscribeResponse.subscription.id);
                console.log(`🔄 Successfully subscribed to ${symbol} with ID: ${subscribeResponse.subscription.id}`);
            } else {
                console.warn(`⚠️ No subscription ID received for ${symbol}`);
            }
        } catch (error) {
            console.error(`❌ Error subscribing to ${symbol}:`, error);
            // Don't throw the error to prevent stopping other subscriptions
            console.log(`🔄 Retrying ${symbol} subscription in 2 seconds...`);
            setTimeout(() => {
                this.subscribeToSymbol(symbol).catch(retryError => {
                    console.error(`❌ Retry failed for ${symbol}:`, retryError);
                });
            }, 2000);
        }
    }

    async subscribeToAllVolatilities(): Promise<void> {
        console.log('Subscribing to all volatility indices...');
        
        // Wait for connection to be ready
        if (!this.isConnected) {
            console.log('Waiting for WebSocket connection...');
            await this.waitForConnection();
        }

        // Process regular volatilities first, then 1-second volatilities
        const regularVolatilities = VOLATILITY_SYMBOLS.filter(s => !s.is_1s_volatility);
        const oneSecondVolatilities = VOLATILITY_SYMBOLS.filter(s => s.is_1s_volatility);

        console.log(`Subscribing to ${regularVolatilities.length} regular volatilities and ${oneSecondVolatilities.length} 1-second volatilities`);

        // Subscribe to regular volatilities first
        const regularPromises = regularVolatilities.map(async (symbolInfo, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 100));
            
            return this.subscribeToSymbol(symbolInfo.symbol).catch(error => {
                console.warn(`Failed to subscribe to regular volatility ${symbolInfo.symbol}:`, error);
                return null;
            });
        });

        await Promise.allSettled(regularPromises);
        console.log(`Completed subscription to regular volatilities`);

        // Then subscribe to 1-second volatilities with additional delay
        const oneSecondPromises = oneSecondVolatilities.map(async (symbolInfo, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 150 + 500)); // Extra delay for 1s volatilities
            
            console.log(`Subscribing to 1-second volatility: ${symbolInfo.symbol}`);
            return this.subscribeToSymbol(symbolInfo.symbol).catch(error => {
                console.warn(`Failed to subscribe to 1-second volatility ${symbolInfo.symbol}:`, error);
                return null;
            });
        });

        await Promise.allSettled(oneSecondPromises);
        console.log(`Subscribed to ${this.subscriptions.size} total volatility indices`);
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

    /**
     * Get exactly 500 historical ticks for ROC analysis
     */
    async get500HistoricalTicks(symbol: string): Promise<TickData[]> {
        try {
            const historyResponse = await this.api.send({
                ticks_history: symbol,
                count: 500,
                end: 'latest',
                style: 'ticks'
            });

            if (historyResponse.error) {
                throw new Error(`Failed to get 500 ticks for ${symbol}: ${historyResponse.error.message}`);
            }

            if (historyResponse.history && historyResponse.history.prices) {
                const times = historyResponse.history.times;
                const prices = historyResponse.history.prices;
                
                const ticks: TickData[] = [];
                for (let i = 0; i < prices.length; i++) {
                    ticks.push({
                        symbol,
                        epoch: times[i],
                        quote: parseFloat(prices[i]),
                        timestamp: new Date(times[i] * 1000),
                    });
                }
                
                console.log(`Retrieved exactly ${ticks.length} historical ticks for ${symbol}`);
                return ticks;
            }

            return [];
        } catch (error) {
            console.error(`Error getting 500 ticks for ${symbol}:`, error);
            return [];
        }
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