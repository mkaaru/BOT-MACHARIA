import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import { SplashScreen } from '@/components/splash-screen';
import TradingAssesmentModal from '@/components/trading-assesment-modal';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './app-root.scss';
import { BrowserRouter } from 'react-router-dom';
import { AuthWrapper } from './auth-wrapper';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = () => {
    return null;
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

const AppRoot = observer(() => {
    const [showSplash, setShowSplash] = useState(true);
    const store = useStore();
    const { ui, client } = store || {};
    const { is_api_initialized } = store?.common || {};
    const api_base_initialized = useRef(false);

    useEffect(() => {
        const initializeApi = async () => {
            if (!api_base_initialized.current) {
                await api_base.init();
                api_base_initialized.current = true;
                // setIsApiInitialized(true); // This line seems to be missing the setIsApiInitialized function definition
            }
        };

        // Clear any inconsistent auth config on app load
        const currentAppId = localStorage.getItem('config.app_id');
        if (currentAppId && currentAppId !== '75771') {
            console.log('🧹 Clearing inconsistent app config');
            localStorage.removeItem('config.app_id');
            localStorage.removeItem('config.server_url');
        }

         initializeApi();

         // Show splash screen for minimum 3 seconds
        const timer = setTimeout(() => {
            console.log("🚀 Hiding splash screen, showing main app");
            setShowSplash(false);
        }, 3000);

        return () => clearTimeout(timer);
    }, []);

    // Show splash screen immediately on app load
    if (showSplash) {
        return <SplashScreen onComplete={() => setShowSplash(false)} />;
    }

    console.log("🎯 Rendering main app content");

    if (!store || !is_api_initialized) return <AppRootLoader />;

    return (
        <Suspense fallback={<AppRootLoader />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
                <TradingAssesmentModal />
            </ErrorBoundary>
        </Suspense>
    );
});

export default AppRoot;