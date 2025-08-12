import React from 'react';

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
    errorInfo?: React.ErrorInfo;
}

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ComponentType<{ error?: Error; retry: () => void }>;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        console.error('ErrorBoundary caught error:', error);

        // Check if this is a workspace disposal error and handle it gracefully
        if (error.message?.includes('Cannot unsubscribe a workspace that hasn\'t been subscribed')) {
            console.warn('Workspace subscription error caught by ErrorBoundary - continuing operation');
            // Don't show error UI for this specific error, just log it
            return { hasError: false };
        }

        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary componentDidCatch:', error, errorInfo);

        // Special handling for workspace errors
        if (error.message?.includes('Cannot unsubscribe a workspace')) {
            console.warn('Workspace disposal error handled gracefully');
        }

        // Log to any error reporting service if available
        if (window.Sentry) {
            window.Sentry.captureException(error);
        }
        this.setState({ error, errorInfo });
    }

    retry = () => {
        this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    };

    render() {
        if (this.state.hasError) {
            const FallbackComponent = this.props.fallback;
            if (FallbackComponent) {
                return <FallbackComponent error={this.state.error} retry={this.retry} />;
            }

            return (
                <div style={{ 
                    padding: '20px', 
                    textAlign: 'center', 
                    background: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    margin: '20px'
                }}>
                    <h2 style={{ color: '#dc3545', marginBottom: '16px' }}>
                        Something went wrong
                    </h2>
                    <p style={{ marginBottom: '16px', color: '#6c757d' }}>
                        The application encountered an unexpected error. You can try refreshing the page or contact support if the problem persists.
                    </p>
                    <button 
                        onClick={this.retry}
                        style={{
                            background: '#007bff',
                            color: 'white',
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            marginRight: '8px'
                        }}
                    >
                        Try Again
                    </button>
                    <button 
                        onClick={() => window.location.reload()}
                        style={{
                            background: '#6c757d',
                            color: 'white',
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Reload Page
                    </button>
                    {this.state.error && (
                        <details style={{ marginTop: '16px', textAlign: 'left' }}>
                            <summary style={{ cursor: 'pointer', color: '#6c757d' }}>
                                Error Details
                            </summary>
                            <pre style={{ 
                                background: '#f8f9fa', 
                                padding: '8px', 
                                marginTop: '8px',
                                fontSize: '12px',
                                overflow: 'auto'
                            }}>
                                {this.state.error.stack}
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