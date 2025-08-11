import React, { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import MatrixLoading from '@/components/matrix-loading';
import { useStore } from '@/hooks/useStore';
import { redirectToLogin } from '@/components/shared/utils/login';
import { urlFor } from '@/components/shared/utils/url';
import { localize } from '@deriv-com/translations';
import './app.scss';

const AuthWrapper = observer(({ children }: { children: React.ReactNode }) => {
    const { client } = useStore();
    const [is_authorizing, setIsAuthorizing] = useState(true);

    useEffect(() => {
        const initAuth = async () => {
            const token = localStorage.getItem('token');

            if (!token) {
                // No token, redirect to login
                redirectToLogin();
                return;
            }

            try {
                await client.init();
                setIsAuthorizing(false);
            } catch (error) {
                console.error('Auth error:', error);
                localStorage.removeItem('token');
                redirectToLogin();
            }
        };

        initAuth();
    }, [client]);

    if (is_authorizing) {
        return <MatrixLoading message={localize('Authenticating...')} show={true} />;
    }

    return (
        <BrowserRouter>
            {children}
        </BrowserRouter>
    );
});

export default AuthWrapper;