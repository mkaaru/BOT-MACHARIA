import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import './styles/index.scss';
import { initializeAudioDisabling } from './utils/audio-utils';

AnalyticsInitializer();

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root element not found');
}

const root = createRoot(container);

// Disable all audio globally
initializeAudioDisabling();

root.render(<AuthWrapper />);