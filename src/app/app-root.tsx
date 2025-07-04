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
    const [appContentError, setAppContentError] = useState(null);

    useEffect(() => {
        const initializeApi = async () => {
            if (!api_base_initialized.current) {
                try {
                    await api_base.init();
                    api_base_initialized.current = true;
                    setIsApiInitialized(true);
                } catch (error) {
                    console.error("Failed to initialize API:", error);
                    store.common.setError({
                        header: localize("API Initialization Error"),
                        message: localize("Failed to initialize the API. Please refresh the page."),
                    });
                    setIsApiInitialized(false);
                }
            }
        };

        initializeApi();
    }, [store.common]);

    if (!store || !is_api_initialized) return <AppRootLoader />;

    return (
        <Suspense fallback={<AppRootLoader />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                {appContentError ? (
                    <ErrorComponent
                        header={localize("App Content Error")}
                        message={appContentError.message || localize("Failed to load application content.")}
                        setError={setAppContentError}
                    />
                ) : (
                    <ErrorBoundary>
                        <Suspense fallback={<ChunkLoader />}>
                            <AppContent />
                        </Suspense>
                    </ErrorBoundary>
                )}
                <TradingAssesmentModal />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;