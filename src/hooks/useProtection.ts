
import { useEffect } from 'react';

export const useProtection = () => {
    useEffect(() => {
        // Disable F12 and other dev tool shortcuts
        const handleKeyDown = (e: KeyboardEvent) => {
            // F12
            if (e.keyCode === 123) {
                e.preventDefault();
                return false;
            }
            
            // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
            if (e.ctrlKey && (
                (e.shiftKey && e.keyCode === 73) || // Dev Tools
                (e.shiftKey && e.keyCode === 74) || // Console
                (e.keyCode === 85) || // View Source
                (e.shiftKey && e.keyCode === 67) || // Inspect
                (e.shiftKey && e.keyCode === 75) // Firefox Console
            )) {
                e.preventDefault();
                return false;
            }
        };

        // Disable right-click
        const handleContextMenu = (e: Event) => {
            e.preventDefault();
            return false;
        };

        // Disable text selection
        const handleSelectStart = (e: Event) => {
            e.preventDefault();
            return false;
        };

        // Add event listeners
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('selectstart', handleSelectStart);

        // Console warning
        console.clear();
        console.log('%cSTOP! Unauthorized access is prohibited.', 'color: red; font-size: 20px; font-weight: bold;');

        // Cleanup
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('selectstart', handleSelectStart);
        };
    }, []);
};
