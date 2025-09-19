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

const useStore = () => {
    const store = useContext(StoreContext);

    if (!store) {
        // Create a fallback empty store structure to prevent destructuring errors
        const fallbackStore = {
            ui: {
                is_desktop: true,
                is_mobile: false,
            },
            run_panel: {
                is_running: false,
                setIsRunning: () => {},
            },
            transactions: {
                transactions: [],
                statistics: {
                    lost_contracts: 0,
                    won_contracts: 0,
                    total_profit: 0,
                    total_stake: 0,
                    total_payout: 0,
                    number_of_runs: 0,
                },
            },
            client: {
                loginid: '',
                currency: 'USD',
                is_logged_in: false,
            },
        };

        console.warn('useStore: Store not found in context, using fallback store. Make sure components are wrapped in StoreProvider.');
        return fallbackStore as RootStore;
    }
    return store;
};

export { StoreProvider, useStore };

export const mockStore = (ws: TWebSocket) => new RootStore(Bot, ws);