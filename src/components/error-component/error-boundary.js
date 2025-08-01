import React from 'react';
import { handleChunkError, resetChunkErrorCount } from '../../utils/chunk-error-handler';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { 
            hasError: false, 
            error: null,
            isChunkError: false
        };
    }

    static getDerivedStateFromError(error) {
        const isChunkError = error.name === 'ChunkLoadError' || 
                            error.message?.includes('Loading chunk') ||
                            error.message?.includes('Failed to import');

        return { 
            hasError: true, 
            error,
            isChunkError
        };
    }

    componentDidCatch(error, errorInfo) {
        console.error('Error boundary caught an error:', error, errorInfo);

        // For chunk errors, try the automatic handler first
        if (this.state.isChunkError && handleChunkError(error)) {
            // Reset the error state since we're handling it
            setTimeout(() => {
                this.setState({ hasError: false, error: null, isChunkError: false });
            }, 100);
            return;
        }
    }

    handleRefresh = () => {
        resetChunkErrorCount();
        window.location.reload();
    }

    handleRetry = () => {
        // Reset error state and try to re-render
        this.setState({ hasError: false, error: null, isChunkError: false });
        resetChunkErrorCount();
    }

    render() {
        if (this.state.hasError) {
            const { isChunkError, error } = this.state;

            return (
                <div style={{ 
                    padding: '40px', 
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '300px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '8px',
                    margin: '20px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                }}>
                    <div style={{ marginBottom: '20px' }}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="#ff6b6b">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                    </div>

                    <h2 style={{ color: '#333', marginBottom: '10px' }}>
                        {isChunkError ? 'Loading Error' : 'Something went wrong'}
                    </h2>

                    <p style={{ color: '#666', marginBottom: '20px', maxWidth: '400px' }}>
                        {isChunkError 
                            ? 'There was an issue loading part of the application. This usually resolves with a refresh.'
                            : 'Sorry for the interruption. Please try refreshing the page.'
                        }
                    </p>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        {isChunkError && (
                            <button 
                                onClick={this.handleRetry}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: '500'
                                }}
                            >
                                Try Again
                            </button>
                        )}

                        <button 
                            onClick={this.handleRefresh}
                            style={{
                                padding: '12px 24px',
                                backgroundColor: '#4a90e2',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '500'
                            }}
                        >
                            Refresh Page
                        </button>
                    </div>

                    {process.env.NODE_ENV === 'development' && error && (
                        <details style={{ marginTop: '20px', textAlign: 'left', width: '100%' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: '500' }}>
                                Error Details (Development)
                            </summary>
                            <pre style={{ 
                                backgroundColor: '#f1f1f1', 
                                padding: '10px', 
                                borderRadius: '4px',
                                overflow: 'auto',
                                fontSize: '12px',
                                marginTop: '10px'
                            }}>
                                {error.toString()}
                            </pre>
                        </details>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;