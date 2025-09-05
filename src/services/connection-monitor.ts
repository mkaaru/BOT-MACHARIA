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

    private lastMarketActivity = 0; // Track last activity for market analyzer
    private lastTradingActivity = 0; // Track last activity for trading engine
    private activityTimeout = 60000; // Timeout for activity

    // Mock properties to satisfy the type checker based on the provided changes
    private marketAnalyzer: any = marketAnalyzer;
    private tradingEngine: any = tradingEngine;


    private status: ConnectionStatus = {
        marketAnalyzer: false,
        tradingEngine: false,
        lastMarketUpdate: 0,
        lastTradingUpdate: 0
    };

    start() {
        console.log('Starting connection monitor...');
        
        // Initialize connection status immediately
        this.updateConnectionStatus();
        
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.HEALTH_CHECK_INTERVAL);
        this.updateLastActivity();
    }

    private updateConnectionStatus() {
        // Update connection statuses based on current state
        this.status.marketAnalyzer = this.marketAnalyzer?.isConnected || false;
        this.status.tradingEngine = this.tradingEngine?.isEngineConnected() || false;
        this.status.lastMarketUpdate = this.lastMarketActivity || Date.now();
        this.status.lastTradingUpdate = this.lastTradingActivity || Date.now();
        
        console.log('Connection status updated:', this.status);
    }

    stop() {
        console.log('Stopping connection monitor...');
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    private performHealthCheck() {
        // Update connection statuses first
        this.updateConnectionStatus();
        
        // Check market analyzer
        const marketAnalyzerConnected = this.marketAnalyzer?.isConnected || false;
        const marketStale = this.lastMarketActivity > 0 && 
                           Date.now() - this.lastMarketActivity > this.activityTimeout;
        
        if (!marketAnalyzerConnected || marketStale) {
            console.log('📊 Market analyzer connection health check failed');
            this.reconnectMarketAnalyzer();
        }

        // Check trading engine
        const tradingEngineConnected = this.tradingEngine?.isEngineConnected() || false;
        const tradingStale = this.lastTradingActivity > 0 && 
                           Date.now() - this.lastTradingActivity > this.activityTimeout;
        
        if (!tradingEngineConnected || tradingStale) {
            console.log('🔧 Trading engine connection health check failed');
            this.reconnectTradingEngine();
        }

        // Clear old data from memory to prevent content limit issues
        this.performMemoryCleanup();

        this.lastHealthCheck = Date.now();
        
        // Log current status for debugging
        console.log('Health check completed:', {
            marketAnalyzer: marketAnalyzerConnected,
            tradingEngine: tradingEngineConnected,
            isHealthy: this.isHealthy()
        });
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
        this.lastMarketActivity = Date.now();
        console.log('📊 Market analyzer activity updated');
    }

    updateTradingActivity() {
        this.lastTradingActivity = Date.now();
        console.log('🔧 Trading engine activity updated');
    }

    getConnectionStatus(): ConnectionStatus {
        return { ...this.status };
    }

    isHealthy(): boolean {
        return this.status.marketAnalyzer && this.status.tradingEngine;
    }
}

export const connectionMonitor = new ConnectionMonitor();