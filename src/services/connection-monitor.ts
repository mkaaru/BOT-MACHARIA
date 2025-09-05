
import { marketAnalyzer } from './market-analyzer';
import { tradingEngine } from './trading-engine';

interface ConnectionStatus {
    marketAnalyzer: boolean;
    tradingEngine: boolean;
    lastMarketUpdate: number;
    lastTradingUpdate: number;
}

class ConnectionMonitor {
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private lastHealthCheck = 0;
    private readonly HEALTH_CHECK_INTERVAL = 45000; // 45 seconds
    private readonly CONNECTION_TIMEOUT = 60000; // 1 minute
    private reconnectionAttempts = 0;
    private readonly MAX_RECONNECTION_ATTEMPTS = 5;
    private status: ConnectionStatus = {
        marketAnalyzer: false,
        tradingEngine: false,
        lastMarketUpdate: 0,
        lastTradingUpdate: 0
    };

    start() {
        console.log('Starting connection monitor...');
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.HEALTH_CHECK_INTERVAL);
        this.updateLastActivity();
    }

    stop() {
        console.log('Stopping connection monitor...');
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    private performHealthCheck() {
        const now = Date.now();
        
        // Update connection statuses
        this.status.marketAnalyzer = marketAnalyzer.isConnected;
        this.status.tradingEngine = tradingEngine.isEngineConnected();
        
        // Check market analyzer health
        const marketStale = now - this.status.lastMarketUpdate > this.CONNECTION_TIMEOUT;
        const tradingStale = now - this.status.lastTradingUpdate > this.CONNECTION_TIMEOUT;
        
        if (marketStale || !this.status.marketAnalyzer) {
            console.warn('Market analyzer connection health check failed');
            this.reconnectMarketAnalyzer();
        }
        
        if (tradingStale || !this.status.tradingEngine) {
            console.warn('Trading engine connection health check failed');
            this.reconnectTradingEngine();
        }
        
        // Clear old data from memory to prevent content limit issues
        this.performMemoryCleanup();
        
        this.lastHealthCheck = now;
    }

    private performMemoryCleanup() {
        // Clear browser console logs more frequently to prevent content limit issues
        if (this.reconnectionAttempts % 3 === 0) {
            console.clear();
        }
        
        // Clean up market analyzer old data
        try {
            marketAnalyzer.symbolData.forEach(symbolData => {
                if (symbolData.ticks.length > 20) {
                    symbolData.ticks.splice(0, symbolData.ticks.length - 20);
                }
            });
        } catch (error) {
            // Ignore cleanup errors
        }
        
        // Force garbage collection if available
        if (typeof window !== 'undefined' && (window as any).gc) {
            try {
                (window as any).gc();
            } catch (e) {
                // Ignore if gc is not available
            }
        }
    }

    private reconnectMarketAnalyzer() {
        if (this.reconnectionAttempts < this.MAX_RECONNECTION_ATTEMPTS) {
            console.log(`Reconnecting market analyzer... (${this.reconnectionAttempts + 1}/${this.MAX_RECONNECTION_ATTEMPTS})`);
            try {
                marketAnalyzer.disconnect();
                setTimeout(() => {
                    marketAnalyzer.connect();
                }, 2000 * (this.reconnectionAttempts + 1));
                this.reconnectionAttempts++;
            } catch (error) {
                console.error('Failed to reconnect market analyzer:', error);
            }
        }
    }

    private reconnectTradingEngine() {
        if (this.reconnectionAttempts < this.MAX_RECONNECTION_ATTEMPTS) {
            console.log(`Reconnecting trading engine... (${this.reconnectionAttempts + 1}/${this.MAX_RECONNECTION_ATTEMPTS})`);
            try {
                tradingEngine.disconnect();
                setTimeout(() => {
                    // Trading engine will auto-reconnect via its constructor
                }, 2000 * (this.reconnectionAttempts + 1));
                this.reconnectionAttempts++;
            } catch (error) {
                console.error('Failed to reconnect trading engine:', error);
            }
        }
    }

    updateLastActivity() {
        this.lastHealthCheck = Date.now();
    }

    updateMarketActivity() {
        this.status.lastMarketUpdate = Date.now();
        this.reconnectionAttempts = 0; // Reset on successful activity
    }

    updateTradingActivity() {
        this.status.lastTradingUpdate = Date.now();
        this.reconnectionAttempts = 0; // Reset on successful activity
    }

    getConnectionStatus(): ConnectionStatus {
        return { ...this.status };
    }

    isHealthy(): boolean {
        return this.status.marketAnalyzer && this.status.tradingEngine;
    }
}

export const connectionMonitor = new ConnectionMonitor();
