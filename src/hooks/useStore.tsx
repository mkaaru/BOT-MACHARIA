import { createContext, useContext, useEffect, useRef, useState } from 'react';
import RootStore from '@/stores/root-store';
import { TWebSocket } from '@/Types';
import Bot from '../external/bot-skeleton/scratch/dbot';

const StoreContext = createContext<null | RootStore>(null);

type TStoreProvider = {
    children: React.ReactNode;
    mockStore?: RootStore;
};

const StoreProvider: React.FC<TStoreProvider> = ({ children, mockStore }) => {
    const [store, setStore] = useState<RootStore | null>(null);
    const initializingStore = useRef(false);

    useEffect(() => {
        const initializeStore = async () => {
            const rootStore = new RootStore(Bot);
            setStore(rootStore);
        };

        if (!store && !initializingStore.current) {
            initializingStore.current = true;
            // If the store is mocked for testing purposes, then return the mocked value.
            if (mockStore) {
                setStore(mockStore);
            } else {
                initializeStore();
            }
        }
    }, [store, mockStore]);

    if (!store && mockStore) return null;

    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
};

export const useStore = () => {
    const store = useContext(StoreContext);
    if (!store) {
        throw new Error('useStore must be used within a StoreProvider');
    }
    return store;
};

// Safe version that returns null if store is not available
export const useStoreOptional = () => {
    return useContext(StoreContext);
};

// Safe UI store access with fallback
export const useUIStore = () => {
    const store = useStoreOptional();
    return store?.ui || null;
};

export { StoreProvider };

export const mockStore = (ws: TWebSocket) => new RootStore(Bot, ws);