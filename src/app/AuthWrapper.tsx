import React, { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { APIProvider } from '@deriv/api';
import { observer } from 'mobx-react-lite';
import MatrixLoading from '@/components/matrix-loading';
import { useStore } from '@/hooks/useStore';
import { getToken, removeToken } from '@/components/shared/utils/login';
import { getOauthUrl } from '@/components/shared/utils/url';
import { localize } from '@deriv-com/translations';
import './app.scss';

const AuthWrapper = observer(({ children }: { children: React.ReactNode }) => {
    const { client } = useStore();
    const [is_authorizing, setIsAuthorizing] = useState(true);

    useEffect(() => {
        const initAuth = async () => {
            const token = getToken();

            if (!token) {
                // No token, redirect to login
                const oauth_url = getOauthUrl();
                window.location.href = oauth_url;
                return;
            }

            try {
                await client.init();
                setIsAuthorizing(false);
            } catch (error) {
                console.error('Auth error:', error);
                removeToken();
                const oauth_url = getOauthUrl();
                window.location.href = oauth_url;
            }
        };

        initAuth();
    }, [client]);

    if (is_authorizing) {
        return <MatrixLoading message={localize('Authenticating...')} show={true} />;
    }

    return (
        <APIProvider>
            <BrowserRouter>
                {children}
            </BrowserRouter>
        </APIProvider>
    );
});

export default AuthWrapper;