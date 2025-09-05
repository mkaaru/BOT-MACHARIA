
interface ConnectionStatus {
    market: boolean;
    trading: boolean;
    lastUpdate: number;
}

interface HealthMetrics {
    uptime: number;
    reconnections: number;
    lastReconnect: number;
    memoryUsage: number;
    activeConnections: number;
}

class ConnectionMonitor {
    private isRunning = false;
    private monitorInterval: NodeJS.Timeout | null = null;
    private metrics: HealthMetrics = {
        uptime: 0,
        reconnections: 0,
        lastReconnect: 0,
        memoryUsage: 0,
        activeConnections: 0
    };
    
    private status: ConnectionStatus = {
        market: false,
        trading: false,
        lastUpdate: 0
    };

    private startTime = Date.now();
    private callbacks = new Set<(status: ConnectionStatus, metrics: HealthMetrics) => void>();

    start() {
        if (this.isRunning) return;

        console.log('Connection Monitor started');
        this.isRunning = true;
        this.startTime = Date.now();

        this.monitorInterval = setInterval(() => {
            this.checkConnections();
            this.updateMetrics();
            this.notifyCallbacks();
        }, 2000);
    }

    stop() {
        if (!this.isRunning) return;

        console.log('Connection Monitor stopped');
        this.isRunning = false;

        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        this.callbacks.clear();
    }

    private checkConnections() {
        // Check market analyzer connection
        try {
            // Import here to avoid circular dependency
            const { marketAnalyzer } = require('./market-analyzer');
            this.status.market = marketAnalyzer.isMarketAnalysisReady || false;
        } catch (error) {
            this.status.market = false;
        }

        // Check trading engine connection
        try {
            const { tradingEngine } = require('./trading-engine');
            this.status.trading = tradingEngine.isEngineConnected() || false;
        } catch (error) {
            this.status.trading = false;
        }

        this.status.lastUpdate = Date.now();
    }

    private updateMetrics() {
        this.metrics.uptime = Date.now() - this.startTime;
        this.metrics.activeConnections = 0;

        if (this.status.market) this.metrics.activeConnections++;
        if (this.status.trading) this.metrics.activeConnections++;

        // Simulate memory usage tracking
        if (typeof window !== 'undefined' && 'performance' in window) {
            try {
                const memory = (performance as any).memory;
                if (memory) {
                    this.metrics.memoryUsage = memory.usedJSHeapSize / (1024 * 1024); // MB
                }
            } catch (error) {
                // Fallback for environments without memory API
                this.metrics.memoryUsage = 0;
            }
        }
    }

    private notifyCallbacks() {
        this.callbacks.forEach(callback => {
            try {
                callback(this.status, this.metrics);
            } catch (error) {
                console.error('Error in connection monitor callback:', error);
            }
        });
    }

    onStatusChange(callback: (status: ConnectionStatus, metrics: HealthMetrics) => void) {
        this.callbacks.add(callback);
        
        // Immediately notify with current status
        callback(this.status, this.metrics);

        // Return unsubscribe function
        return () => {
            this.callbacks.delete(callback);
        };
    }

    getStatus(): ConnectionStatus {
        return { ...this.status };
    }

    getMetrics(): HealthMetrics {
        return { ...this.metrics };
    }

    isHealthy(): boolean {
        return this.status.market && this.status.trading;
    }

    recordReconnection() {
        this.metrics.reconnections++;
        this.metrics.lastReconnect = Date.now();
    }

    // Utility methods for connection health
    getUptimeString(): string {
        const uptime = this.metrics.uptime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    getLastUpdateAge(): number {
        return Date.now() - this.status.lastUpdate;
    }

    isStale(): boolean {
        return this.getLastUpdateAge() > 10000; // 10 seconds
    }

    // Performance monitoring
    trackActivity(activity: string) {
        console.log(`[ConnectionMonitor] Activity: ${activity} at ${new Date().toISOString()}`);
    }

    // Memory cleanup
    cleanup() {
        this.callbacks.clear();
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        
        this.isRunning = false;
    }

    // Get diagnostic info
    getDiagnostics() {
        return {
            status: this.status,
            metrics: this.metrics,
            isRunning: this.isRunning,
            uptimeString: this.getUptimeString(),
            isHealthy: this.isHealthy(),
            isStale: this.isStale(),
            callbackCount: this.callbacks.size
        };
    }

    // Force status update
    forceUpdate() {
        if (this.isRunning) {
            this.checkConnections();
            this.updateMetrics();
            this.notifyCallbacks();
        }
    }

    // Health check with detailed information
    healthCheck() {
        const diagnostics = this.getDiagnostics();
        const issues = [];

        if (!this.status.market) {
            issues.push('Market analyzer not connected');
        }

        if (!this.status.trading) {
            issues.push('Trading engine not connected');
        }

        if (this.isStale()) {
            issues.push('Status information is stale');
        }

        if (this.metrics.memoryUsage > 100) { // 100MB threshold
            issues.push(`High memory usage: ${this.metrics.memoryUsage.toFixed(1)}MB`);
        }

        return {
            healthy: issues.length === 0,
            issues,
            diagnostics
        };
    }
}

export const connectionMonitor = new ConnectionMonitor();
