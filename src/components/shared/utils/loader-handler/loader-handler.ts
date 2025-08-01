export const moduleLoader = (lazyComponent: () => Promise<unknown>, attempts = 3, interval = 2000) => {
    return new Promise((resolve, reject) => {
        lazyComponent()
            .then(resolve)
            .catch((error: unknown) => {
                console.warn(`Chunk loading failed, retrying... (${attempts} attempts left)`, error);
                
                // Check if it's a ChunkLoadError
                const isChunkLoadError = error instanceof Error && 
                    (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk'));
                
                if (isChunkLoadError && attempts > 1) {
                    // For chunk load errors, try refreshing the page after max retries
                    if (attempts === 1) {
                        console.error('All chunk loading attempts failed, refreshing page...');
                        window.location.reload();
                        return;
                    }
                }
                
                if (attempts === 1) {
                    reject(error);
                    return;
                }
                
                setTimeout(() => {
                    moduleLoader(lazyComponent, attempts - 1, interval).then(resolve, reject);
                }, interval);
            });
    });
};
