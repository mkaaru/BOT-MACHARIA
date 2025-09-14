import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { 
    DerivAPIInstance, 
    APIResponse, 
    APIRequest,
    WebSocketMessage,
    isWebSocketMessage,
    validateAPIResponse,
    hasAPIError
} from '@/types/deriv-api-types';

export interface SubscriptionCallback<T = WebSocketMessage> {
    id: string;
    callback: (data: T) => void;
    filters?: Partial<T>;
}

export interface ConnectionStats {
    isConnected: boolean;
    reconnectAttempts: number;
    activeSubscriptions: number;
    totalCallbacks: number;
    lastActivity: Date;
    connectionTime: Date | null;
}

export type MessageType = 'tick' | 'ohlc' | 'proposal_open_contract' | 'buy' | 'sell' | 'authorize' | 'active_symbols' | 'forget';

/**
 * Centralized WebSocket manager for all ML trader components
 * Eliminates duplicate subscriptions and memory leaks
 */
export class CentralizedWebSocketManager {
    private api: DerivAPIInstance | null = null;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 10;
    private readonly RECONNECT_DELAY_BASE = 1000; // Base delay in ms
    private readonly RECONNECT_DELAY_MAX = 30000; // Max delay in ms

    // Subscription management
    private subscriptions: Map<string, string> = new Map(); // symbol -> subscription_id
    private subscriptionRefCounts: Map<string, number> = new Map(); // symbol -> ref_count
    private messageCallbacks: Map<MessageType, Set<SubscriptionCallback>> = new Map();
    
    // Reconnection and cleanup
    private reconnectTimer: NodeJS.Timeout | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private connectionTime: Date | null = null;
    private lastActivity: Date = new Date();
    
    // Connection state management
    private connectionPromise: Promise<void> | null = null;
    private connectionCallbacks: Set<() => void> = new Set();
    private disconnectionCallbacks: Set<() => void> = new Set();

    constructor() {
        this.initializeMessageCallbackMaps();
        this.setupHeartbeat();
    }

    private initializeMessageCallbackMaps(): void {
        const messageTypes: MessageType[] = ['tick', 'ohlc', 'proposal_open_contract', 'buy', 'sell', 'authorize', 'active_symbols', 'forget'];
        messageTypes.forEach(type => {
            this.messageCallbacks.set(type, new Set());
        });
    }

    /**
     * Connect to WebSocket with auto-reconnection logic
     */
    async connect(): Promise<void> {
        if (this.isConnected) {
            return Promise.resolve();
        }

        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this.performConnection();
        return this.connectionPromise;
    }

    private async performConnection(): Promise<void> {
        if (this.isConnecting) return;
        
        this.isConnecting = true;
        
        try {
            console.log(`WebSocket Manager: Attempting connection (attempt ${this.reconnectAttempts + 1})`);
            
            this.api = generateDerivApiInstance();
            
            if (!this.api?.connection) {
                throw new Error('Failed to generate API instance');
            }

            // Setup event listeners
            this.setupConnectionHandlers();
            
            // Wait for connection to be established
            await this.waitForConnection();
            
            this.isConnected = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            this.connectionTime = new Date();
            this.connectionPromise = null;
            
            console.log('WebSocket Manager: Successfully connected');
            this.notifyConnectionCallbacks();
            
            // Resubscribe to all existing subscriptions
            await this.resubscribeAll();
            
        } catch (error) {
            this.isConnecting = false;
            this.connectionPromise = null;
            console.error('WebSocket Manager: Connection failed:', error);
            
            this.scheduleReconnect();
            throw error;
        }
    }

    private setupConnectionHandlers(): void {
        if (!this.api?.connection) return;

        this.api.connection.addEventListener('message', this.handleMessage.bind(this));
        
        this.api.connection.addEventListener('open', () => {
            console.log('WebSocket Manager: Connection opened');
            this.isConnected = true;
            this.lastActivity = new Date();
        });
        
        this.api.connection.addEventListener('close', () => {
            console.log('WebSocket Manager: Connection closed');
            this.handleDisconnection();
        });
        
        this.api.connection.addEventListener('error', (error: Event) => {
            console.error('WebSocket Manager: Connection error:', error);
            this.handleDisconnection();
        });
    }

    private waitForConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.api?.connection) {
                reject(new Error('No connection available'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 10000); // 10 second timeout

            if (this.api.connection.readyState === WebSocket.OPEN) {
                clearTimeout(timeout);
                resolve();
                return;
            }

            const onOpen = () => {
                clearTimeout(timeout);
                this.api.connection.removeEventListener('open', onOpen);
                this.api.connection.removeEventListener('error', onError);
                resolve();
            };

            const onError = (error: Event) => {
                clearTimeout(timeout);
                this.api.connection.removeEventListener('open', onOpen);
                this.api.connection.removeEventListener('error', onError);
                reject(new Error('Connection failed'));
            };

            this.api.connection.addEventListener('open', onOpen);
            this.api.connection.addEventListener('error', onError);
        });
    }

    private handleMessage(event: MessageEvent): void {
        this.lastActivity = new Date();
        
        try {
            const rawData = JSON.parse(event.data);
            
            // Validate message structure
            if (!isWebSocketMessage(rawData)) {
                console.warn('WebSocket Manager: Invalid message structure:', rawData);
                return;
            }
            
            const data = rawData as WebSocketMessage;
            const msgType = data.msg_type as MessageType;
            
            // Check for API errors
            if (hasAPIError(data)) {
                console.error(`WebSocket Manager: API Error - ${data.error.code}: ${data.error.message}`);
                // Still process the callback for error handling
            }
            
            const callbacks = this.messageCallbacks.get(msgType);
            if (!callbacks) return;
            
            callbacks.forEach(callbackInfo => {
                try {
                    // Apply filters if specified
                    if (callbackInfo.filters) {
                        const shouldProcess = Object.entries(callbackInfo.filters).every(([key, value]) => {
                            return data[key] === value || (data[key] && data[key][key] === value);
                        });
                        
                        if (!shouldProcess) return;
                    }
                    
                    callbackInfo.callback(data);
                } catch (error) {
                    console.error(`WebSocket Manager: Error in callback ${callbackInfo.id}:`, error);
                }
            });
            
        } catch (error) {
            console.error('WebSocket Manager: Error parsing message:', error);
        }
    }

    private handleDisconnection(): void {
        if (!this.isConnected) return;
        
        this.isConnected = false;
        this.connectionTime = null;
        
        console.log('WebSocket Manager: Handling disconnection');
        this.notifyDisconnectionCallbacks();
        
        // Schedule reconnection
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            console.error('WebSocket Manager: Max reconnection attempts reached');
            return;
        }
        
        // Exponential backoff with jitter
        const delay = Math.min(
            this.RECONNECT_DELAY_BASE * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
            this.RECONNECT_DELAY_MAX
        );
        
        this.reconnectAttempts++;
        console.log(`WebSocket Manager: Scheduling reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(error => {
                console.error('WebSocket Manager: Reconnection failed:', error);
            });
        }, delay);
    }

    /**
     * Subscribe to a symbol with reference counting
     */
    async subscribe(symbol: string): Promise<string | null> {
        await this.connect();
        
        // Increment reference count
        const currentRefs = this.subscriptionRefCounts.get(symbol) || 0;
        this.subscriptionRefCounts.set(symbol, currentRefs + 1);
        
        // If already subscribed, return existing subscription ID
        if (this.subscriptions.has(symbol)) {
            const subscriptionId = this.subscriptions.get(symbol);
            console.log(`WebSocket Manager: Using existing subscription for ${symbol} (refs: ${currentRefs + 1})`);
            return subscriptionId || null;
        }
        
        try {
            const response = await this.api.send({ ticks: symbol, subscribe: 1 });
            
            if (response.error) {
                throw new Error(`Failed to subscribe to ${symbol}: ${response.error.message}`);
            }
            
            if (response.subscription?.id) {
                this.subscriptions.set(symbol, response.subscription.id);
                console.log(`WebSocket Manager: Successfully subscribed to ${symbol} with ID: ${response.subscription.id}`);
                return response.subscription.id;
            }
            
            return null;
            
        } catch (error) {
            // Decrement reference count on error
            const refs = this.subscriptionRefCounts.get(symbol) || 1;
            if (refs <= 1) {
                this.subscriptionRefCounts.delete(symbol);
            } else {
                this.subscriptionRefCounts.set(symbol, refs - 1);
            }
            
            console.error(`WebSocket Manager: Error subscribing to ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * Unsubscribe from a symbol with reference counting
     */
    async unsubscribe(symbol: string): Promise<void> {
        const currentRefs = this.subscriptionRefCounts.get(symbol) || 0;
        
        if (currentRefs <= 1) {
            // Last reference, actually unsubscribe
            const subscriptionId = this.subscriptions.get(symbol);
            
            if (subscriptionId) {
                try {
                    if (this.isConnected) {
                        await this.api.send({ forget: subscriptionId });
                    }
                    console.log(`WebSocket Manager: Unsubscribed from ${symbol}`);
                } catch (error) {
                    console.error(`WebSocket Manager: Error unsubscribing from ${symbol}:`, error);
                }
                
                this.subscriptions.delete(symbol);
            }
            
            this.subscriptionRefCounts.delete(symbol);
        } else {
            // Decrement reference count
            this.subscriptionRefCounts.set(symbol, currentRefs - 1);
            console.log(`WebSocket Manager: Decremented reference count for ${symbol} (refs: ${currentRefs - 1})`);
        }
    }

    /**
     * Add message callback for specific message type
     */
    addMessageCallback<T extends WebSocketMessage = WebSocketMessage>(
        messageType: MessageType,
        id: string,
        callback: (data: T) => void,
        filters?: Partial<T>
    ): () => void {
        const callbackInfo: SubscriptionCallback<T> = {
            id,
            callback,
            filters,
        };
        
        const callbacks = this.messageCallbacks.get(messageType);
        if (callbacks) {
            callbacks.add(callbackInfo as SubscriptionCallback);
        }
        
        console.log(`WebSocket Manager: Added ${messageType} callback: ${id}`);
        
        // Return cleanup function
        return () => {
            this.removeMessageCallback(messageType, id);
        };
    }

    /**
     * Remove message callback
     */
    removeMessageCallback(messageType: MessageType, id: string): void {
        const callbacks = this.messageCallbacks.get(messageType);
        if (callbacks) {
            const toRemove = Array.from(callbacks).find(cb => cb.id === id);
            if (toRemove) {
                callbacks.delete(toRemove);
                console.log(`WebSocket Manager: Removed ${messageType} callback: ${id}`);
            }
        }
    }

    /**
     * Resubscribe to all symbols after reconnection
     */
    private async resubscribeAll(): Promise<void> {
        const symbols = Array.from(this.subscriptions.keys());
        
        if (symbols.length === 0) return;
        
        console.log(`WebSocket Manager: Resubscribing to ${symbols.length} symbols`);
        
        // Clear existing subscriptions
        this.subscriptions.clear();
        
        // Resubscribe to all symbols
        for (const symbol of symbols) {
            try {
                const response = await this.api.send({ ticks: symbol, subscribe: 1 });
                
                if (response.subscription?.id) {
                    this.subscriptions.set(symbol, response.subscription.id);
                    console.log(`WebSocket Manager: Resubscribed to ${symbol}`);
                }
            } catch (error) {
                console.error(`WebSocket Manager: Failed to resubscribe to ${symbol}:`, error);
            }
        }
    }

    /**
     * Setup heartbeat to detect stale connections
     */
    private setupHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            const timeSinceActivity = Date.now() - this.lastActivity.getTime();
            const STALE_THRESHOLD = 60000; // 1 minute
            
            if (this.isConnected && timeSinceActivity > STALE_THRESHOLD) {
                console.warn('WebSocket Manager: Connection appears stale, forcing reconnection');
                this.handleDisconnection();
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Subscribe to connection events
     */
    onConnection(callback: () => void): () => void {
        this.connectionCallbacks.add(callback);
        return () => this.connectionCallbacks.delete(callback);
    }

    onDisconnection(callback: () => void): () => void {
        this.disconnectionCallbacks.add(callback);
        return () => this.disconnectionCallbacks.delete(callback);
    }

    private notifyConnectionCallbacks(): void {
        this.connectionCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error('WebSocket Manager: Error in connection callback:', error);
            }
        });
    }

    private notifyDisconnectionCallbacks(): void {
        this.disconnectionCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error('WebSocket Manager: Error in disconnection callback:', error);
            }
        });
    }

    /**
     * Get connection statistics
     */
    getStats(): ConnectionStats {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            activeSubscriptions: this.subscriptions.size,
            totalCallbacks: Array.from(this.messageCallbacks.values())
                .reduce((total, callbacks) => total + callbacks.size, 0),
            lastActivity: this.lastActivity,
            connectionTime: this.connectionTime,
        };
    }

    /**
     * Send API request with proper typing
     */
    async send(request: APIRequest): Promise<APIResponse> {
        await this.connect();
        
        if (!this.api) {
            throw new Error('WebSocket Manager: API not connected');
        }
        
        const response = await this.api.send(request);
        
        // Validate response structure
        if (!validateAPIResponse(response)) {
            throw new Error('WebSocket Manager: Invalid API response structure');
        }
        
        // Check for API errors
        if (hasAPIError(response)) {
            throw new Error(`API Error - ${response.error.code}: ${response.error.message}`);
        }
        
        return response;
    }

    /**
     * Get subscribed symbols
     */
    getSubscribedSymbols(): string[] {
        return Array.from(this.subscriptions.keys());
    }

    /**
     * Check if connected
     */
    isWebSocketConnected(): boolean {
        return this.isConnected;
    }

    /**
     * Force reconnection
     */
    async forceReconnect(): Promise<void> {
        console.log('WebSocket Manager: Forcing reconnection');
        this.handleDisconnection();
        return this.connect();
    }

    /**
     * Clean shutdown
     */
    async shutdown(): Promise<void> {
        console.log('WebSocket Manager: Shutting down');
        
        // Clear timers
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        
        // Unsubscribe from all symbols
        const symbols = Array.from(this.subscriptions.keys());
        for (const symbol of symbols) {
            try {
                await this.unsubscribe(symbol);
            } catch (error) {
                console.error(`WebSocket Manager: Error unsubscribing from ${symbol} during shutdown:`, error);
            }
        }
        
        // Clear callbacks
        this.messageCallbacks.clear();
        this.connectionCallbacks.clear();
        this.disconnectionCallbacks.clear();
        
        // Disconnect
        if (this.api?.disconnect) {
            this.api.disconnect();
        }
        
        this.isConnected = false;
        this.api = null;
    }
}

// Create singleton instance
export const centralizedWebSocketManager = new CentralizedWebSocketManager();