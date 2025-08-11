import React from 'react';
import ChunkLoader from '@/components/loader/chunk-loader';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { localize } from '@deriv-com/translations';
import { URLUtils } from '@deriv-com/utils';
import App from './App';

const setLocalStorageToken = async (loginInfo: URLUtils.LoginInfo[], paramsToDelete: string[]) => {
    if (loginInfo.length) {
        try {
            console.log('🔐 AuthWrapper: Setting up login info for', loginInfo.length, 'accounts');
            const defaultActiveAccount = URLUtils.getDefaultActiveAccount(loginInfo);
            if (!defaultActiveAccount) {
                console.warn('⚠️ No default active account found');
                return;
            }

            const accountsList: Record<string, string> = {};
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

            loginInfo.forEach((account: { loginid: string; token: string; currency: string }) => {
                accountsList[account.loginid] = account.token;
                clientAccounts[account.loginid] = account;
            });

            localStorage.setItem('accountsList', JSON.stringify(accountsList));
            localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

            URLUtils.filterSearchParams(paramsToDelete);

            try {
                const api = await generateDerivApiInstance();
                if (api && loginInfo[0].token) {
                    console.log('🔍 AuthWrapper: Testing API authorization...');
                    const { authorize, error } = await api.authorize(loginInfo[0].token);
                    api.disconnect();
                    if (!error && authorize) {
                        const firstId = authorize?.account_list[0]?.loginid;
                        const filteredTokens = loginInfo.filter(token => token.loginid === firstId);
                        if (filteredTokens.length) {
                            localStorage.setItem('authToken', filteredTokens[0].token);
                            localStorage.setItem('active_loginid', filteredTokens[0].loginid);
                            console.log('✅ AuthWrapper: Set primary token for', firstId);
                            return;
                        }
                    } else {
                        console.warn('⚠️ AuthWrapper: API authorization failed:', error);
                    }
                }
            } catch (apiError) {
                console.error('❌ AuthWrapper: API error:', apiError);
            }

            // Fallback
            localStorage.setItem('authToken', loginInfo[0].token);
            localStorage.setItem('active_loginid', loginInfo[0].loginid);
            console.log('🔧 AuthWrapper: Set fallback token for', loginInfo[0].loginid);
        } catch (error) {
            console.error('❌ AuthWrapper: Error setting up login info:', error);
        }
    } else {
        console.log('🔍 AuthWrapper: No login info to process');
    }
};

export const AuthWrapper = () => {
    const [isAuthComplete, setIsAuthComplete] = React.useState(false);
    const { loginInfo, paramsToDelete } = URLUtils.getLoginInfoFromURL();

    React.useEffect(() => {
        const initializeAuth = async () => {
            await setLocalStorageToken(loginInfo, paramsToDelete);
            URLUtils.filterSearchParams(['lang']);
            setIsAuthComplete(true);
        };

        initializeAuth();
    }, [loginInfo, paramsToDelete]);

    if (!isAuthComplete) {
        return <ChunkLoader message={localize('Initializing...')} />;
    }

    return <App />;
};