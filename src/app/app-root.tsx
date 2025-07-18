import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import MatrixLoading from '@/components/matrix-loading';
import TradingAssesmentModal from '@/components/trading-assesment-modal';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = () => {
    return <MatrixLoading message={localize('Initializing Deriv Bot...')} show={true} />;
};

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    const api_base_initialized = useRef(false);
    const [is_api_initialized, setIsApiInitialized] = useState(false);

    useEffect(() => {
        const initializeApi = async () => {
            if (!api_base_initialized.current) {
                try {
                    // Add timeout for API initialization
                    const initPromise = api_base.init();
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('API initialization timeout')), 30000)
                    );
                    
                    await Promise.race([initPromise, timeoutPromise]);
                    api_base_initialized.current = true;
                    setIsApiInitialized(true);
                    console.log('✅ API initialized successfully');
                } catch (error) {
                    console.error('❌ API initialization failed:', error);
                    // Still set as initialized to prevent infinite loading
                    api_base_initialized.current = true;
                    setIsApiInitialized(true);
                }
            }
        };

        initializeApi();
    }, []);

    // Temporary bypass - remove this after debugging
    const shouldBypassLoading = window.location.search.includes('bypass=true');
    
    if (!store || (!is_api_initialized && !shouldBypassLoading)) return <AppRootLoader />;

    return (
        <Suspense fallback={<AppRootLoader />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
                <TradingAssesmentModal />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;