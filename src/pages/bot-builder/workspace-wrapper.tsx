import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import BlocklyLoading from '../../components/blockly-loading';

const WorkspaceWrapper = observer(() => {
    const { blockly_store, dashboard } = useStore();
    const { is_loading } = blockly_store;
    const { active_tab } = dashboard;

    React.useEffect(() => {
        const script_el = document.createElement('script');
        script_el.src = 'js/blockly_bundle.js';
        script_el.onload = () => {
            setTimeout(() => {
                import('../../external/bot-skeleton').then(mod => {
                    blockly_store.setLoading(false);

                    // Ensure workspace is ready after loading
                    if (window.Blockly?.derivWorkspace) {
                        console.log("Blockly workspace initialized");
                    }
                });
            }, 0);
        };

        document.head.appendChild(script_el);

        return () => {
            if (script_el && document.head.contains(script_el)) {
                document.head.removeChild(script_el);
            }
        };
    }, [blockly_store]);

    // Re-render workspace when switching to bot builder tab
    React.useEffect(() => {
        if (!is_loading && active_tab === 1 && window.Blockly?.derivWorkspace) {
            setTimeout(() => {
                try {
                    window.Blockly.derivWorkspace.render();
                    console.log("Workspace rendered for bot builder tab");
                } catch (error) {
                    console.error("Error rendering workspace:", error);
                }
            }, 100);
        }
    }, [is_loading, active_tab]);

    if (is_loading) return <BlocklyLoading />;

    return null;
});

export default WorkspaceWrapper;