
// Global chunk loading error handler
export const setupChunkErrorHandler = () => {
    // Handle dynamic import failures globally
    window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason;
        
        if (error?.name === 'ChunkLoadError' || 
            error?.message?.includes('Loading chunk') ||
            error?.message?.includes('ChunkLoadError')) {
            
            console.warn('Chunk loading failed globally, attempting recovery...', error);
            event.preventDefault(); // Prevent the error from being logged
            
            // Show user-friendly message and reload
            const shouldReload = confirm(
                'The application failed to load properly. Would you like to refresh the page?'
            );
            
            if (shouldReload) {
                window.location.reload();
            }
        }
    });
    
    // Handle fetch errors for chunks
    window.addEventListener('error', (event) => {
        const { target } = event;
        
        if (target instanceof HTMLScriptElement && target.src.includes('/static/js/')) {
            console.warn('Script loading failed:', target.src);
            
            // Retry loading the script
            const newScript = document.createElement('script');
            newScript.src = target.src;
            newScript.async = true;
            
            target.parentNode?.replaceChild(newScript, target);
        }
    });
};

export default setupChunkErrorHandler;
