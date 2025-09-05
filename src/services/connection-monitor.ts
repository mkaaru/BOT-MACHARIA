
class ConnectionMonitor {
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private lastHealthCheck = 0;
    private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

    start() {
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.HEALTH_CHECK_INTERVAL);
    }

    stop() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    private performHealthCheck() {
        const now = Date.now();
        
        // Check if we haven't received data in the last minute
        if (now - this.lastHealthCheck > 60000) {
            console.warn('Connection health check failed - no data received');
            // Trigger reconnection
            this.triggerReconnection();
        }
        
        this.lastHealthCheck = now;
    }

    private triggerReconnection() {
        // Emit an event or call reconnection methods
        console.log('Triggering service reconnections...');
    }

    updateLastActivity() {
        this.lastHealthCheck = Date.now();
    }
}

export const connectionMonitor = new ConnectionMonitor();
