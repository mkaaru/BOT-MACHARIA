
import React, { Component, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
    private retryCount = 0;
    private maxRetries = 3;

    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('Error caught by ErrorBoundary:', error, errorInfo);
        
        // Send error to logging service if available
        if (window.TrackJS) {
            window.TrackJS.track(error);
        }

        // Track error in analytics
        if (window.rudderanalytics) {
            window.rudderanalytics.track('Application Error', {
                error_message: error.message,
                error_stack: error.stack,
                component_stack: errorInfo.componentStack,
                retry_count: this.retryCount
            });
        }
    }

    handleRetry = () => {
        this.retryCount++;
        this.setState({ hasError: false, error: undefined });
    };

    handleRefresh = () => {
        // Clear any stored state that might be causing issues
        try {
            localStorage.removeItem('dbot_workspace');
            localStorage.removeItem('dbot_strategy');
            sessionStorage.clear();
        } catch (e) {
            console.warn('Failed to clear storage:', e);
        }
        
        window.location.reload();
    };

    handleGoToDashboard = () => {
        // Navigate to dashboard to recover
        if (window.location.hash !== '#dashboard') {
            window.location.hash = '#dashboard';
            this.setState({ hasError: false, error: undefined });
        } else {
            this.handleRefresh();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                this.props.fallback || (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '60vh',
                        padding: '20px',
                        textAlign: 'center',
                        backgroundColor: 'var(--general-main-1)',
                        color: 'var(--text-general)'
                    }}>
                        <div style={{
                            fontSize: '48px',
                            marginBottom: '20px'
                        }}>
                            ⚠️
                        </div>
                        <h3 style={{
                            marginBottom: '16px',
                            fontSize: '24px',
                            fontWeight: 'bold'
                        }}>
                            Something went wrong
                        </h3>
                        <p style={{
                            marginBottom: '24px',
                            maxWidth: '400px',
                            lineHeight: '1.5',
                            color: 'var(--text-less-prominent)'
                        }}>
                            We encountered an unexpected error. You can try to recover or refresh the page.
                        </p>
                        
                        {this.state.error && (
                            <details style={{
                                marginBottom: '24px',
                                padding: '12px',
                                backgroundColor: 'var(--general-section-1)',
                                borderRadius: '4px',
                                maxWidth: '500px',
                                textAlign: 'left'
                            }}>
                                <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
                                    Error Details
                                </summary>
                                <code style={{
                                    fontSize: '12px',
                                    color: 'var(--text-general)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word'
                                }}>
                                    {this.state.error.message}
                                </code>
                            </details>
                        )}

                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            flexWrap: 'wrap',
                            justifyContent: 'center'
                        }}>
                            {this.retryCount < this.maxRetries && (
                                <button 
                                    onClick={this.handleRetry}
                                    style={{
                                        padding: '12px 24px',
                                        backgroundColor: 'var(--brand-secondary)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    Try Again
                                </button>
                            )}
                            
                            <button 
                                onClick={this.handleGoToDashboard}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: 'var(--general-section-1)',
                                    color: 'var(--text-general)',
                                    border: '1px solid var(--border-normal)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                Go to Dashboard
                            </button>
                            
                            <button 
                                onClick={this.handleRefresh}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: 'var(--general-section-1)',
                                    color: 'var(--text-general)',
                                    border: '1px solid var(--border-normal)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                Refresh Page
                            </button>
                        </div>

                        <p style={{
                            marginTop: '24px',
                            fontSize: '12px',
                            color: 'var(--text-less-prominent)'
                        }}>
                            If the problem persists, please contact support.
                        </p>
                    </div>
                )
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
