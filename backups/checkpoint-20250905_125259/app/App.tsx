import { initSurvicate } from '../public-path';
import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { StoreProvider } from '@/hooks/useStore';
import CallbackPage from '@/pages/callback';
import Endpoint from '@/pages/endpoint';
import { TAuthData } from '@/types/api-types';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import './app-root.scss';
import { connectionMonitor } from '../services/connection-monitor';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));
const RiskReward = lazy(() => import('../components/risk-reward'));
const HigherLowerTrader = lazy(() => import('../components/higher-lower-trader'));

const { TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, CROWDIN_BRANCH_NAME } = process.env;
const i18nInstance = initializeI18n({
    cdnUrl: `${TRANSLATIONS_CDN_URL}/${R2_PROJECT_NAME}/${CROWDIN_BRANCH_NAME}`,
});

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}>
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <StoreProvider>
                            <RoutePromptDialog />
                            <CoreStoreProvider>
                                <Layout />
                            </CoreStoreProvider>
                        </StoreProvider>
                    </TranslationProvider>
                </Suspense>
            }
        >
            <Route index element={<AppRoot />} />
            <Route path='risk-reward' element={<RiskReward />} />
            <Route path='higher-lower' element={<HigherLowerTrader />} />
            <Route path='endpoint' element={<Endpoint />} />
            <Route path='callback' element={<CallbackPage />} />
        </Route>
    )
);

function App() {
    useEffect(() => {
        initSurvicate();
        window?.dataLayer?.push({ event: 'page_load' });

        return () => {
            const survicateBox = document.getElementById('survicate-box');
            if (survicateBox) {
                survicateBox.style.display = 'none';
            }
        };
    }, []);

    useEffect(() => {
        const accountsList = localStorage.getItem('accountsList');
        const clientAccounts = localStorage.getItem('clientAccounts');
        const activeLoginid = localStorage.getItem('active_loginid');
        const urlParams = new URLSearchParams(window.location.search);
        const accountCurrency = urlParams.get('account');

        if (!accountsList || !clientAccounts) return;

        try {
            const parsedAccounts = JSON.parse(accountsList);
            const parsedClientAccounts = JSON.parse(clientAccounts) as TAuthData['account_list'];
            const isValidCurrency = accountCurrency
                ? Object.values(parsedClientAccounts).some(
                      (account) => account.currency.toUpperCase() === accountCurrency.toUpperCase()
                  )
                : false;

            const updateLocalStorage = (token: string, loginid: string) => {
                localStorage.setItem('authToken', token);
                localStorage.setItem('active_loginid', loginid);
            };

            // Handle demo account
            if (accountCurrency?.toUpperCase() === 'DEMO') {
                const demoAccount = Object.entries(parsedAccounts).find(([key]) => key.startsWith('VR'));

                if (demoAccount) {
                    const [loginid, token] = demoAccount;
                    updateLocalStorage(String(token), loginid);
                    return;
                }
            }

            // Handle real account with valid currency
            if (accountCurrency?.toUpperCase() !== 'DEMO' && isValidCurrency) {
                const realAccount = Object.entries(parsedClientAccounts).find(
                    ([loginid, account]) =>
                        !loginid.startsWith('VR') && account.currency.toUpperCase() === accountCurrency?.toUpperCase()
                );

                if (realAccount) {
                    const [loginid, account] = realAccount;
                    if ('token' in account) {
                        updateLocalStorage(String(account?.token), loginid);
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('Error parsing accounts:', e);
        }
    }, []);

    // ✅ Register the service worker (for PWA support)
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker
                    .register('/service-worker.js')
                    .then((registration) => {
                        console.log('Service Worker registered with scope:', registration.scope);
                    })
                    .catch((error) => {
                        console.log('Service Worker registration failed:', error);
                    });
            });
        }
    }, []);

    useEffect(() => {
        // Initialize analytics with placeholder values as the actual values are not provided.
        // These should be replaced with actual environment variables or configuration.
        // The TrackJS token is missing, so we'll use an empty string for now.
        // In a real scenario, you would fetch or configure this token properly.
        const growthbookKey = process.env.GROWTHBOOK_KEY || '';
        const growthbookDecryptionKey = process.env.GROWTHBOOK_DECRYPTION_KEY || '';
        const rudderstackKey = process.env.RUDDERSTACK_KEY || '';

        // Placeholder for actual analytics initialization logic
        // Analytics.initialise({
        //     growthbookKey: growthbookKey,
        //     growthbookDecryptionKey: growthbookDecryptionKey,
        //     rudderstackKey: rudderstackKey,
        // });

        // Start connection monitor to handle memory cleanup and reconnections
        connectionMonitor.start();

        // Cleanup on unmount
        return () => {
            connectionMonitor.stop();
        };
    }, []);


    return <RouterProvider router={router} />;
}

export default App;