import React, { Suspense, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ChunkLoader from '@/components/loader/chunk-loader';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import Main from '../pages/main';

const AppContent = observer(() => {
    const { common, client } = useStore();
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

    useEffect(() => {
        // Mark as loaded once we have the store
        if (common && !hasLoadedOnce) {
            setHasLoadedOnce(true);
        }
    }, [common, hasLoadedOnce]);

    // Don't return null for errors - show the app with error handling inside
    const shouldShowApp = hasLoadedOnce || (common && client);

    if (!shouldShowApp) {
        return (
            <ChunkLoader 
                message={localize('Please wait while we connect to the server...')} 
            />
        );
    }

    return (
        <Suspense fallback={<ChunkLoader message={localize('Loading TradeCortex...')} />}>
            <Main />
        </Suspense>
    );
});

AppContent.displayName = 'AppContent';

export default AppContent;