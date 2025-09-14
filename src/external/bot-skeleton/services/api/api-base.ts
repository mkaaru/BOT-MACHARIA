import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;


    async createNewConnection() {
        return new Promise((resolve, reject) => {
            try {
                console.log('🔄 Creating new WebSocket connection...');
                
                // Clear any existing API instance
                if (this.api && typeof this.api.disconnect === 'function') {
                    try {
                        this.api.disconnect();
                    } catch (e) {
                        console.warn('Error disconnecting existing API:', e);
                    }
                }
                
                // Create a direct WebSocket connection
                const websocket = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=16929');
                
                // Set timeout for connection
                const connectionTimeout = setTimeout(() => {
                    if (websocket.readyState !== WebSocket.OPEN) {
                        console.error('❌ Connection timeout after 10 seconds');
                        websocket.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

                websocket.onopen = () => {
                    clearTimeout(connectionTimeout);
                    console.log('✅ WebSocket connection opened successfully');
                    
                    try {
                        // Import DerivAPI dynamically to avoid build issues
                        import('@deriv/deriv-api').then((DerivAPIModule) => {
                            const DerivAPI = DerivAPIModule.default || DerivAPIModule;
                            this.api = new DerivAPI({ connection: websocket });
                            this.onsocketopen();
                            resolve(true);
                        }).catch((importError) => {
                            console.error('❌ Failed to import DerivAPI:', importError);
                            // Fallback: try to create a simple API wrapper
                            this.api = { connection: websocket };
                            this.onsocketopen();
                            resolve(true);
                        });
                    } catch (apiError) {
                        console.error('❌ Failed to create API instance:', apiError);
                        this.api = { connection: websocket };
                        this.onsocketopen();
                        resolve(true);
                    }
                };

                websocket.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    console.error('❌ WebSocket connection error:', error);
                    this.onsocketclose();
                    reject(error);
                };

                websocket.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    console.log('🔌 WebSocket connection closed:', event.code, event.reason);
                    this.onsocketclose();
                };

            } catch (error) {
                console.error('❌ Failed to create WebSocket connection:', error);
                this.onsocketclose();
                reject(error);
            }
        });
    }

    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
    }

    onsocketclose() {
        console.log('🔌 WebSocket connection closed');
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.reconnectIfNotConnected();
    }

    // Add connection health check
    checkConnectionHealth() {
        return new Promise((resolve, reject) => {
            if (!this.api || !this.api.connection || this.api.connection.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket connection not available'));
                return;
            }

            // Send a ping to verify connection
            this.api.send({ ping: 1 })
                .then(response => {
                    if (response.pong) {
                        resolve(true);
                    } else {
                        reject(new Error('Ping failed'));
                    }
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    async init(force_create_connection = false) {
        console.log('🔄 Initializing API connection...');
        this.toggleRunButton(true);

        try {
            // Always create a fresh connection to ensure reliability
            if (this.api) {
                this.unsubscribeAllSubscriptions();
                if (this.api.connection && this.api.disconnect) {
                    this.api.disconnect();
                }
            }

            // Create new connection
            await this.createNewConnection();
            
            // Initialize event listeners
            this.initEventListeners();

            // Clear any existing intervals
            if (this.time_interval) {
                clearInterval(this.time_interval);
                this.time_interval = null;
            }

            // Get active symbols if needed
            if (!this.has_active_symbols && !V2GetActiveToken()) {
                this.active_symbols_promise = this.getActiveSymbols();
            }

            // Authorize if token is available
            if (V2GetActiveToken()) {
                setIsAuthorizing(true);
                await this.authorizeAndSubscribe();
            }

            // Initialize chart API
            chart_api.init(force_create_connection);
            
            console.log('✅ API initialization completed successfully');

        } catch (error) {
            console.error('❌ API initialization failed:', error);
            setConnectionStatus(CONNECTION_STATUS.CLOSED);
            
            // Retry connection after delay
            setTimeout(() => {
                console.log('🔄 Retrying API connection...');
                this.init(true).catch(retryError => {
                    console.error('❌ API retry failed:', retryError);
                });
            }, 3000);
            
            throw error;
        }
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        // eslint-disable-next-line no-console
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = () => {
        // eslint-disable-next-line no-console
        console.log('connection state: ', this.api?.connection?.readyState);
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            // eslint-disable-next-line no-console
            console.log('Info: Connection to the server was closed, trying to reconnect.');
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        const token = V2GetActiveToken();
        if (token) {
            this.token = token;
            this.account_id = V2GetActiveClientId() ?? '';

            if (!this.api) return;

            try {
                const { authorize, error } = await this.api.authorize(this.token);
                if (error) return error;

                if (this.has_active_symbols) {
                    this.toggleRunButton(false);
                } else {
                    this.active_symbols_promise = this.getActiveSymbols();
                }
                this.account_info = authorize;
                setAccountList(authorize.account_list);
                setAuthData(authorize);
                setIsAuthorized(true);
                this.is_authorized = true;
                this.subscribe();
                this.getSelfExclusion();
            } catch (e) {
                this.is_authorized = false;
                setIsAuthorized(false);
                globalObserver.emit('Error', e);
            } finally {
                setIsAuthorizing(false);
            }
        }
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        await this.api.getSelfExclusion();
        // TODO: fix self exclusion
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                        ...(streamName === 'balance' ? { account: 'all' } : {}),
                    });
                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                const pip_sizes = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    (pip_sizes as Record<string, number>)[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                return active_symbols || error;
            }
        );
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        try {
            this.subscriptions.forEach(s => {
                try {
                    s.unsubscribe();
                } catch (e) {
                    console.warn('Error unsubscribing:', e);
                }
            });
            this.subscriptions = [];

            // Resetting timeout resolvers
            const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

            global_timeouts.forEach((_: unknown, i: number) => {
                try {
                    clearTimeout(i);
                } catch (e) {
                    console.warn('Error clearing timeout:', e);
                }
            });
            
            // Clear observer state to prevent memory leaks
            globalObserver.setState('global_timeouts', []);
        } catch (error) {
            console.error('Error in clearSubscriptions:', error);
        }
    }
}

export const api_base = new APIBase();
