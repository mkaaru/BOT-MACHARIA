

// Global audio control utility - Enhanced version
export const disableAllAudio = () => {
    // Override HTMLAudioElement.prototype.play to prevent any audio playback
    const originalPlay = HTMLAudioElement.prototype.play;
    HTMLAudioElement.prototype.play = function() {
        // Return a resolved promise to avoid breaking code that expects play() to return a promise
        return Promise.resolve();
    };

    // Override HTMLAudioElement.prototype.load to prevent loading audio
    const originalLoad = HTMLAudioElement.prototype.load;
    HTMLAudioElement.prototype.load = function() {
        // Do nothing
    };

    // Override the pause method as well
    const originalPause = HTMLAudioElement.prototype.pause;
    HTMLAudioElement.prototype.pause = function() {
        // Do nothing
    };

    // Mute all existing audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
        audio.muted = true;
        audio.volume = 0;
        audio.pause();
        // Remove all event listeners
        audio.onplay = null;
        audio.oncanplay = null;
        audio.oncanplaythrough = null;
    });

    // Override Audio constructor to create muted audio by default
    const OriginalAudio = window.Audio;
    window.Audio = function(src) {
        const audio = new OriginalAudio();
        audio.muted = true;
        audio.volume = 0;
        // Override methods on instance level too
        audio.play = () => Promise.resolve();
        audio.load = () => {};
        audio.pause = () => {};
        return audio;
    } as any;

    // Override Web Audio API
    if (window.AudioContext) {
        const OriginalAudioContext = window.AudioContext;
        window.AudioContext = function() {
            const ctx = new OriginalAudioContext();
            // Suspend the context immediately
            ctx.suspend();
            return ctx;
        } as any;
    }

    if (window.webkitAudioContext) {
        const OriginalWebkitAudioContext = window.webkitAudioContext;
        window.webkitAudioContext = function() {
            const ctx = new OriginalWebkitAudioContext();
            ctx.suspend();
            return ctx;
        } as any;
    }

    // Override media elements
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);
        if (tagName.toLowerCase() === 'audio') {
            element.muted = true;
            element.volume = 0;
            element.play = () => Promise.resolve();
            element.load = () => {};
            element.pause = () => {};
        }
        return element;
    };
};

// Enhanced initialization with more comprehensive coverage
export const initializeAudioDisabling = () => {
    // Apply initial disabling
    disableAllAudio();
    
    // Reapply on DOM content loaded
    document.addEventListener('DOMContentLoaded', disableAllAudio);
    
    // Watch for new audio elements being added to the DOM
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const element = node as Element;
                    if (element.tagName === 'AUDIO') {
                        const audio = element as HTMLAudioElement;
                        audio.muted = true;
                        audio.volume = 0;
                        audio.pause();
                        audio.play = () => Promise.resolve();
                        audio.load = () => {};
                        audio.onplay = null;
                    }
                    // Also check for audio elements within added nodes
                    const audioElements = element.querySelectorAll('audio');
                    audioElements.forEach(audio => {
                        audio.muted = true;
                        audio.volume = 0;
                        audio.pause();
                        audio.play = () => Promise.resolve();
                        audio.load = () => {};
                        audio.onplay = null;
                    });
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Additional protection - intercept any getElementById calls for audio elements
    const originalGetElementById = document.getElementById;
    document.getElementById = function(id) {
        const element = originalGetElementById.call(this, id);
        if (element && element.tagName === 'AUDIO') {
            const audio = element as HTMLAudioElement;
            audio.muted = true;
            audio.volume = 0;
            audio.play = () => Promise.resolve();
            audio.load = () => {};
            audio.pause = () => {};
        }
        return element;
    };

    // Override querySelector methods as well
    const originalQuerySelector = document.querySelector;
    document.querySelector = function(selector) {
        const element = originalQuerySelector.call(this, selector);
        if (element && element.tagName === 'AUDIO') {
            const audio = element as HTMLAudioElement;
            audio.muted = true;
            audio.volume = 0;
            audio.play = () => Promise.resolve();
            audio.load = () => {};
            audio.pause = () => {};
        }
        return element;
    };
};

// Additional function to disable sounds in bot notifications
export const disableBotSounds = () => {
    // Override any sound playing functions that might be called by the bot
    if (window.playAudioFile) {
        window.playAudioFile = () => {};
    }
    
    // Override any bot-specific audio functions
    const botSoundFunctions = ['playSound', 'playAudio', 'playNotification', 'playAlertSound'];
    botSoundFunctions.forEach(funcName => {
        if (window[funcName]) {
            window[funcName] = () => {};
        }
    });
};

