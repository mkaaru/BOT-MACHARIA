// Console Protection - Makes it harder to view console logs
// Disables console methods in production and obfuscates output

const isProduction = process.env.NODE_ENV === 'production';

// Save original console methods
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
};

// Disable console in production
export const disableConsole = () => {
    if (isProduction) {
        console.log = () => {};
        console.warn = () => {};
        console.info = () => {};
        console.debug = () => {};
        // Keep error for critical issues only
        console.error = (...args: any[]) => {
            // Only log errors in production, but obfuscated
            if (Math.random() > 0.5) {
                originalConsole.error('[App Error]');
            }
        };
    }
};

// Detect DevTools opening
export const detectDevTools = () => {
    const threshold = 160;
    const devtools = {
        isOpen: false,
        orientation: undefined as 'vertical' | 'horizontal' | undefined
    };

    const emitEvent = (isOpen: boolean, orientation?: 'vertical' | 'horizontal') => {
        globalThis.dispatchEvent(new CustomEvent('devtoolschange', {
            detail: { isOpen, orientation }
        }));
    };

    setInterval(() => {
        const widthThreshold = globalThis.outerWidth - globalThis.innerWidth > threshold;
        const heightThreshold = globalThis.outerHeight - globalThis.innerHeight > threshold;
        const orientation = widthThreshold ? 'vertical' : 'horizontal';

        if (!(heightThreshold && widthThreshold) &&
            ((globalThis.Firebug && globalThis.Firebug.chrome && globalThis.Firebug.chrome.isInitialized) || widthThreshold || heightThreshold)) {
            if (!devtools.isOpen || devtools.orientation !== orientation) {
                emitEvent(true, orientation);
            }
            devtools.isOpen = true;
            devtools.orientation = orientation;
        } else {
            if (devtools.isOpen) {
                emitEvent(false);
            }
            devtools.isOpen = false;
            devtools.orientation = undefined;
        }
    }, 500);
};

// Initialize console protection
export const initConsoleProtection = () => {
    disableConsole();
    detectDevTools();
    
    // Clear console periodically in production
    if (isProduction) {
        setInterval(() => {
            console.clear();
        }, 5000);
    }
};
