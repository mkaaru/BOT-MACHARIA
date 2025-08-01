let retryCount = 0;
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

export const handleChunkError = (error: Error) => {
    console.error('Chunk loading error:', error);

    // Check if it's actually a chunk loading error
    const isChunkError = error.name === 'ChunkLoadError' || 
                        error.message?.includes('Loading chunk') ||
                        error.message?.includes('Failed to import');

    if (isChunkError && retryCount < MAX_RETRIES) {
        retryCount++;
        console.log(`Chunk load retry ${retryCount}/${MAX_RETRIES}`);

        // Try to reload the specific chunk instead of full page reload
        setTimeout(() => {
            try {
                // Force a soft reload by updating the URL slightly
                const url = new URL(window.location.href);
                url.searchParams.set('retry', retryCount.toString());
                window.history.replaceState({}, '', url.toString());

                // Try to re-import the failed chunk
                if (window.__webpack_require__ && window.__webpack_require__.cache) {
                    // Clear webpack cache for failed chunks
                    Object.keys(window.__webpack_require__.cache).forEach(key => {
                        if (key.includes('vendors-node_modules') || key.includes('async')) {
                            delete window.__webpack_require__.cache[key];
                        }
                    });
                }

                // Reload the page as last resort
                window.location.reload();
            } catch (reloadError) {
                console.error('Error during chunk reload:', reloadError);
                window.location.reload();
            }
        }, RETRY_DELAY);

        return true;
    } else if (retryCount >= MAX_RETRIES) {
        console.error('Max chunk load retries reached');
        // Reset for future attempts
        retryCount = 0;
        return false;
    }

    return false;
};

// Reset retry count on successful navigation
export const resetChunkErrorCount = () => {
    retryCount = 0;
};

// Initialize chunk error handling
export const initChunkErrorHandling = () => {
    // Reset count on successful page loads
    window.addEventListener('load', resetChunkErrorCount);

    // Handle unhandled promise rejections (often chunk errors)
    window.addEventListener('unhandledrejection', (event) => {
        if (event.reason && handleChunkError(event.reason)) {
            event.preventDefault();
        }
    });
};