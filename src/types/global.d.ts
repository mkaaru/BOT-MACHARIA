declare global {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let google: any;
    interface Window {
        Blockly: any;
        ga: any;
        gtag: any;
        rudderanalytics: any;
        google: any;
        gapi: any;
        LiveChatWidget: any;
        LC_API: any;
        trackJs: any;
        Intercom: any;
        dataLayer: any;
        hj: any;
        DD_RUM: any;
        DBot: any;
        startTrading: any;
        stopTrading: any;
        DerivAPI: any;
    }
}

export {};