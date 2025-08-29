import { LocalStorageConstants, LocalStorageUtils, URLUtils } from '@deriv-com/utils';
import { isStaging } from '../url/helpers';

export const APP_IDS = {
    LOCALHOST: 75771,
    TMP_STAGING: 75771,
    STAGING: 75771,
    STAGING_BE: 75771,
    STAGING_ME: 75771,
    PRODUCTION: 75771,
    PRODUCTION_BE: 75771,
    PRODUCTION_ME: 75771,
    LIVE: 75771,
};

export const livechat_license_id = 12049137;
export const livechat_client_id = '66aa088aad5a414484c1fd1fa8a5ace7';

export const domain_app_ids = {
    'master.bot-standalone.pages.dev': APP_IDS.TMP_STAGING,
    'staging-dbot.deriv.com': APP_IDS.STAGING,
    'staging-dbot.deriv.be': APP_IDS.STAGING_BE,
    'staging-dbot.deriv.me': APP_IDS.STAGING_ME,
    'dbot.deriv.com': APP_IDS.PRODUCTION,
    'dbot.deriv.be': APP_IDS.PRODUCTION_BE,
    'dbot.deriv.me': APP_IDS.PRODUCTION_ME,
    'www.tradecortex.site': APP_IDS.LIVE, // ✅ Updated to use www.tradecortex.site
};

export const getCurrentProductionDomain = () =>
    !/^staging\./.test(window.location.hostname) &&
    Object.keys(domain_app_ids).find(domain => window.location.hostname === domain);

export const isProduction = () => {
    const all_domains = Object.keys(domain_app_ids).map(domain => `(www\\.)?${domain.replace('.', '\\.')}`);
    return new RegExp(`^(${all_domains.join('|')})$`, 'i').test(window.location.hostname);
};

export const isTestLink = () => {
    return (
        window.location.origin?.includes('.binary.sx') ||
        window.location.origin?.includes('bot-65f.pages.dev') ||
        isLocal()
    );
};

export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);

const getDefaultServerURL = () => {
    if (isTestLink()) {
        return 'ws.derivws.com';
    }

    const searchParams = new URLSearchParams(window.location.search);
    const active_loginid_from_url = searchParams.get('acct1');

    const loginid = window.localStorage.getItem('active_loginid') ?? active_loginid_from_url;
    const is_real = loginid && !/^(VRT|VRW)/.test(loginid);

    return `${is_real ? 'green' : 'blue'}.derivws.com`;
};

export const getDefaultAppIdAndUrl = () => {
    const current_domain = getCurrentProductionDomain();
    return {
        app_id: getAppId(),
        server_url: `wss://${current_domain}/websockets/v3?app_id=${getAppId()}&l=${getLanguage()}&brand=deriv`,
    };
};

export const getOAuthCallbackURL = () => {
    const current_domain = getCurrentProductionDomain();
    const protocol = window.location.protocol;
    return `${protocol}//${current_domain}/callback`;
};

export const getAppId = () => {
    let app_id = window.localStorage.getItem('config.app_id');

    if (!app_id || app_id === '69811' || app_id === '75771') {
        console.warn('⚠️ App ID is invalid, forcing correct App ID...');
        app_id = '75771'; // ✅ Corrected App ID for your domain
        window.localStorage.setItem('config.app_id', app_id);
    }

    console.log('🔍 [config.ts] Using App ID:', app_id);
    return app_id;
};

export const getSocketURL = () => window.localStorage.getItem('config.server_url') ?? getDefaultServerURL();

export const checkAndSetEndpointFromUrl = () => {
    if (!isTestLink()) return false;

    const url_params = new URLSearchParams(location.search.slice(1));

    if (url_params.has('qa_server') && url_params.has('app_id')) {
        const qa_server = url_params.get('qa_server') || '';
        const app_id = url_params.get('app_id') || '';

        url_params.delete('qa_server');
        url_params.delete('app_id');

        if (/^(www\.)?qa[0-9]{1,4}\.deriv.dev|(.*)\.derivws\.com$/.test(qa_server) && /^[0-9]+$/.test(app_id)) {
            localStorage.setItem('config.app_id', app_id);
            localStorage.setItem('config.server_url', qa_server.replace(/"/g, ''));
        }

        const params = url_params.toString();
        location.href = `${location.origin}${location.pathname}${params ? `?${params}` : ''}${location.hash || ''}`;

        return true;
    }

    return false;
};

export const getDebugServiceWorker = () => !!parseInt(window.localStorage.getItem('debug_service_worker') || '0');

export const generateOAuthURL = () => {
    const { getOauthURL } = URLUtils;
    const app_id = getAppId();
    const oauth_url = getOauthURL();
    const original_url = new URL(oauth_url);

    // Ensure we're using the correct app ID
    original_url.searchParams.set('app_id', app_id);

    const configured_server_url =
        LocalStorageUtils.getValue(LocalStorageConstants.configServerURL) ||
        localStorage.getItem('config.server_url') ||
        original_url.hostname;

    const valid_server_urls = ['green.derivws.com', 'red.derivws.com', 'blue.derivws.com'];
    if (!valid_server_urls.includes(configured_server_url)) {
        original_url.hostname = configured_server_url;
    }

    return original_url.toString();
};

// Dummy getLanguage function to avoid build errors
const getLanguage = () => 'en';