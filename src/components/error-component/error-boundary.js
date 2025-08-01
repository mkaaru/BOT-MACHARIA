import React from 'react';
import PropTypes from 'prop-types';
import ErrorComponent from './index';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, chunkError: false };
    }

    static getDerivedStateFromError(error) {
        const isChunkLoadError = error?.name === 'ChunkLoadError' || 
            error?.message?.includes('Loading chunk') ||
            error?.message?.includes('ChunkLoadError');
            
        return {
            hasError: true,
            chunkError: isChunkLoadError
        };
    }

    componentDidCatch = (error, info) => {
        if (window.TrackJS) window.TrackJS.console.log(this.props.root_store);
        
        const isChunkLoadError = error?.name === 'ChunkLoadError' || 
            error?.message?.includes('Loading chunk') ||
            error?.message?.includes('ChunkLoadError');

        console.error('Error caught by boundary:', error, info);

        this.setState({
            hasError: true,
            chunkError: isChunkLoadError,
            error,
            info,
        });

        // Auto-reload for chunk errors after a short delay
        if (isChunkLoadError) {
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        }
    };
    
    render = () => {
        if (this.state.hasError) {
            const errorProps = {
                should_show_refresh: true,
                header: this.state.chunkError ? 'Loading Error' : undefined,
                message: this.state.chunkError ? 
                    'The application failed to load properly. The page will refresh automatically in a moment.' : 
                    undefined
            };
            return <ErrorComponent {...errorProps} />;
        }
        return this.props.children;
    };
}

ErrorBoundary.propTypes = {
    root_store: PropTypes.object,
    children: PropTypes.oneOfType([PropTypes.string, PropTypes.arrayOf(PropTypes.node), PropTypes.node]),
};

export default ErrorBoundary;
