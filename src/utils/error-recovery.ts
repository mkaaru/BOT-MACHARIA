
export const ErrorRecoveryUtils = {
    // Clear application state that might be causing errors
    clearApplicationState: () => {
        try {
            // Clear bot-related storage
            const botKeys = [
                'dbot_workspace',
                'dbot_strategy', 
                'dbot_recent_strategies',
                'dbot_settings',
                'blockly_workspace',
                'pythonTradingScripts'
            ];
            
            botKeys.forEach(key => {
                try {
                    localStorage.removeItem(key);
                } catch (e) {
                    console.warn(`Failed to remove ${key}:`, e);
                }
            });

            // Clear session storage
            try {
                sessionStorage.clear();
            } catch (e) {
                console.warn('Failed to clear session storage:', e);
            }

            console.log('Application state cleared for error recovery');
            return true;
        } catch (error) {
            console.error('Failed to clear application state:', error);
            return false;
        }
    },

    // Reload page with clean state
    reloadWithCleanState: () => {
        ErrorRecoveryUtils.clearApplicationState();
        
        // Add a flag to indicate this is a recovery reload
        try {
            sessionStorage.setItem('recovery_reload', 'true');
        } catch (e) {
            // Ignore if can't set session storage
        }
        
        window.location.reload();
    },

    // Navigate to safe state (dashboard)
    navigateToSafeState: () => {
        try {
            // Clear any problematic hash
            window.location.hash = '#dashboard';
            
            // Trigger a re-render by reloading if hash doesn't change navigation
            setTimeout(() => {
                if (window.location.hash !== '#dashboard') {
                    window.location.hash = '#dashboard';
                }
            }, 100);
            
            return true;
        } catch (error) {
            console.error('Failed to navigate to safe state:', error);
            return false;
        }
    },

    // Check if this is a recovery reload
    isRecoveryReload: () => {
        try {
            const isRecovery = sessionStorage.getItem('recovery_reload') === 'true';
            if (isRecovery) {
                sessionStorage.removeItem('recovery_reload');
            }
            return isRecovery;
        } catch (e) {
            return false;
        }
    },

    // Log error for debugging
    logError: (error: Error, context?: string) => {
        console.error(`Error${context ? ` in ${context}` : ''}:`, error);
        
        // Send to analytics if available
        if (window.rudderanalytics) {
            window.rudderanalytics.track('Application Error', {
                error_message: error.message,
                error_stack: error.stack,
                context: context || 'unknown',
                timestamp: new Date().toISOString(),
                user_agent: navigator.userAgent,
                url: window.location.href
            });
        }
        
        // Send to TrackJS if available
        if (window.TrackJS) {
            window.TrackJS.track(error);
        }
    }
};

export default ErrorRecoveryUtils;
