import React from 'react';

export const DummyComponent: React.FC = () => {
    return <div>This is a dummy component</div>;
};

// Global observer for bot engine events
export const globalObserver = {
    observers: {} as { [key: string]: Array<(data: any) => void> },

    register: function(event: string, callback: (data: any) => void) {
        if (!this.observers[event]) {
            this.observers[event] = [];
        }
        this.observers[event].push(callback);
    },

    emit: function(event: string, data?: any) {
        if (this.observers[event]) {
            this.observers[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Observer callback error:', error);
                }
            });
        }
    },

    unregister: function(event: string, callback?: (data: any) => void) {
        if (this.observers[event]) {
            if (callback) {
                const index = this.observers[event].indexOf(callback);
                if (index > -1) {
                    this.observers[event].splice(index, 1);
                }
            } else {
                this.observers[event] = [];
            }
        }
    }
};