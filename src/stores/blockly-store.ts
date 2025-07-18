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
        
        // Initialize Blockly workspace if not already present
        if (!window.Blockly?.derivWorkspace) {
            console.log('🚀 Initializing Blockly workspace...');
            // Set a timeout to allow Blockly to initialize
            setTimeout(() => {
                if (window.Blockly?.derivWorkspace) {
                    console.log('✅ Blockly workspace initialized successfully');
                    this.setLoading(false);
                } else {
                    console.warn('⚠️ Blockly workspace not found, retrying...');
                    // Retry after a longer delay
                    setTimeout(() => {
                        this.setLoading(false);
                    }, 2000);
                }
            }, 1000);
        } else {
            console.log('✅ Blockly workspace already exists');
            this.setLoading(false);
        }
        
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
