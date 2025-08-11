import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { Callback } from '@deriv-com/auth-client';
import { Button } from '@deriv-com/ui';

const CallbackPage = () => {
    return (
        <Callback
            onSignInSuccess={async (tokens: Record<string, string>) => {
                console.log('🔑 OAuth callback received tokens:', Object.keys(tokens));
                
                // Clear any existing auth data
                localStorage.removeItem('authToken');
                localStorage.removeItem('active_loginid');
                localStorage.removeItem('accountsList');
                localStorage.removeItem('clientAccounts');

                const accountsList: Record<string, string> = {};
                const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

                for (const [key, value] of Object.entries(tokens)) {
                    if (key.startsWith('acct')) {
                        const tokenKey = key.replace('acct', 'token');
                        if (tokens[tokenKey]) {
                            accountsList[value] = tokens[tokenKey];
                            clientAccounts[value] = {
                                loginid: value,
                                token: tokens[tokenKey],
                                currency: '',
                            };
                        }
                    } else if (key.startsWith('cur')) {
                        const accKey = key.replace('cur', 'acct');
                        if (tokens[accKey]) {
                            clientAccounts[tokens[accKey]].currency = value;
                        }
                    }
                }

                localStorage.setItem('accountsList', JSON.stringify(accountsList));
                localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

                let is_token_set = false;
                try {
                    const api = await generateDerivApiInstance();
                    if (api && tokens.token1) {
                        console.log('🔍 Testing token authorization...');
                        const { authorize, error } = await api.authorize(tokens.token1);
                        api.disconnect();
                        
                        if (!error && authorize) {
                            console.log('✅ Token authorization successful');
                            const clientAccountsArray = Object.values(clientAccounts);
                            const firstId = authorize?.account_list[0]?.loginid;
                            const filteredTokens = clientAccountsArray.filter(account => account.loginid === firstId);
                            if (filteredTokens.length) {
                                localStorage.setItem('authToken', filteredTokens[0].token);
                                localStorage.setItem('active_loginid', filteredTokens[0].loginid);
                                is_token_set = true;
                                console.log('🎯 Set primary token for account:', firstId);
                            }
                        } else {
                            console.warn('⚠️ Token authorization failed:', error);
                        }
                    }
                } catch (authError) {
                    console.error('❌ Auth API error:', authError);
                }
                
                if (!is_token_set && tokens.token1 && tokens.acct1) {
                    localStorage.setItem('authToken', tokens.token1);
                    localStorage.setItem('active_loginid', tokens.acct1);
                    is_token_set = true;
                    console.log('🔧 Set fallback token for account:', tokens.acct1);
                }

                if (is_token_set) {
                    const query_param_currency = sessionStorage.getItem('query_param_currency');
                    const redirectUrl = query_param_currency ? `/?account=${query_param_currency}` : '/';
                    console.log('🚀 Redirecting to:', redirectUrl);
                    window.location.assign(redirectUrl);
                } else {
                    console.error('❌ Failed to set auth token, redirecting to home');
                    window.location.assign('/');
                }
            }}
            renderReturnButton={() => {
                return (
                    <Button
                        className='callback-return-button'
                        onClick={() => {
                            window.location.href = '/';
                        }}
                    >
                        {'Return to Bot'}
                    </Button>
                );
            }}
        />
    );
};

export default CallbackPage;
