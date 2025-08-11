
// Global audio control utility
export const disableAllAudio = () => {
    // Override HTMLAudioElement.prototype.play to prevent any audio playback
    const originalPlay = HTMLAudioElement.prototype.play;
    HTMLAudioElement.prototype.play = function() {
        // Return a resolved promise to avoid breaking code that expects play() to return a promise
        return Promise.resolve();
    };

    // Mute all existing audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
        audio.muted = true;
        audio.volume = 0;
        audio.pause();
    });

    // Override Audio constructor to create muted audio by default
    const OriginalAudio = window.Audio;
    window.Audio = function(src) {
        const audio = new OriginalAudio(src);
        audio.muted = true;
        audio.volume = 0;
        return audio;
    } as any;
};

// Call this function when the app initializes
export const initializeAudioDisabling = () => {
    disableAllAudio();
    
    // Also disable on DOM content loaded in case some audio is loaded later
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
                    }
                    // Also check for audio elements within added nodes
                    const audioElements = element.querySelectorAll('audio');
                    audioElements.forEach(audio => {
                        audio.muted = true;
                        audio.volume = 0;
                        audio.pause();
                    });
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
};
