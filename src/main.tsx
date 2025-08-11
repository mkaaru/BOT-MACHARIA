import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app';
import './public-path';
import './styles/index.scss';

// Add error boundary for debugging
class ErrorBoundary extends React.Component {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error('App Error:', error, errorInfo);
    }

    render() {
        if ((this.state as any).hasError) {
            return <div style={{ padding: '20px', textAlign: 'center' }}>
                <h2>Something went wrong.</h2>
                <p>Check the console for more details.</p>
            </div>;
        }

        return (this.props as any).children;
    }
}

const container = document.getElementById('root');
if (!container) {
    console.error('Failed to find the root element');
    throw new Error('Failed to find the root element');
}

const root = createRoot(container);

console.log('Initializing React app...');

root.render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>
);

console.log('React app rendered');