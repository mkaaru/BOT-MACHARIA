import { action, makeObservable, observable } from 'mobx';
import { tabs_title } from '@/constants/bot-contents';
import { onWorkspaceResize } from '@/external/bot-skeleton';
import { getSetting, storeSetting } from '@/utils/settings';
import RootStore from './root-store';

export default class BlocklyStore {
    root_store: RootStore;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            is_loading: observable,
            active_tab: observable,
            setLoading: action,
            setActiveTab: action,
        });
        this.root_store = root_store;
    }

    is_loading = false;
    active_tab = tabs_title.WORKSPACE;

    setActiveTab = (tab: string): void => {
        this.active_tab = tab;
        storeSetting('active_tab', this.active_tab);
    };

    setContainerSize = (): void => {
        if (this.active_tab === tabs_title.WORKSPACE) {
            onWorkspaceResize();
        }
    };

    onMount = (): void => {
        console.log('🔧 BlocklyStore onMount called');
        this.setLoading(true);
        
        // Check if Blockly is available at all
        if (typeof window === 'undefined') {
            console.error('❌ Window object not available');
            this.setLoading(false);
            return;
        }

        // Wait for DBot initialization which should create the workspace
        const checkBlocklyInitialization = (retryCount = 0) => {
            console.log(`🔍 Checking Blockly initialization (attempt ${retryCount + 1})`);
            
            if (window.Blockly?.derivWorkspace) {
                console.log('✅ Blockly workspace found and ready');
                this.setLoading(false);
                return;
            }

            if (retryCount < 10) {
                console.log(`⏳ Blockly not ready, waiting... (${retryCount + 1}/10)`);
                setTimeout(() => {
                    checkBlocklyInitialization(retryCount + 1);
                }, 500);
            } else {
                console.error('❌ Blockly failed to initialize after 10 attempts');
                this.setLoading(false);
            }
        };

        // Start checking for initialization
        checkBlocklyInitialization();
        
        window.addEventListener('resize', this.setContainerSize);
    };

    getCachedActiveTab = (): void => {
        if (getSetting('active_tab')) {
            this.active_tab = getSetting('active_tab');
        }
    };

    onUnmount = (): void => {
        window.removeEventListener('resize', this.setContainerSize);
    };

    setLoading = (is_loading: boolean): void => {
        this.is_loading = is_loading;
    };
}
