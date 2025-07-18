import React from 'react';
import { observer } from 'mobx-react-lite';
import Flyout from '@/components/flyout';
import { useStore } from '@/hooks/useStore';
import StopBotModal from '../dashboard/stop-bot-modal';
import Toolbar from './toolbar';
import Toolbox from './toolbox';
import './workspace.scss';

const WorkspaceWrapper = observer(() => {
    const { blockly_store } = useStore();
    const { onMount, onUnmount, is_loading } = blockly_store;
    const [retryCount, setRetryCount] = React.useState(0);

    React.useEffect(() => {
        console.log('🔄 WorkspaceWrapper mounting...');
        onMount();
        return () => {
            onUnmount();
        };
    }, []);

    React.useEffect(() => {
        // Retry mechanism if Blockly doesn't load
        if (!is_loading && !window.Blockly?.derivWorkspace && retryCount < 3) {
            console.log(`🔄 Retrying Blockly initialization (attempt ${retryCount + 1})`);
            setTimeout(() => {
                setRetryCount(prev => prev + 1);
                onMount();
            }, 1000 * (retryCount + 1));
        }
    }, [is_loading, retryCount, onMount]);

    if (is_loading) {
        console.log('⏳ Blockly is loading...');
        return (
            <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center', 
                height: '400px',
                fontSize: '16px',
                color: '#999'
            }}>
                Loading Bot Builder...
            </div>
        );
    }

    if (window.Blockly?.derivWorkspace) {
        console.log('✅ Rendering Blockly workspace components');
        return (
            <React.Fragment>
                <Toolbox />
                <Toolbar />
                <Flyout />
                <StopBotModal />
            </React.Fragment>
        );
    }

    console.warn('❌ Blockly workspace not available');
    return (
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column',
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '400px',
            fontSize: '16px',
            color: '#999'
        }}>
            <div>Bot Builder not available</div>
            <div style={{ fontSize: '14px', marginTop: '10px' }}>
                {retryCount < 3 ? 'Retrying...' : 'Please refresh the page'}
            </div>
        </div>
    );
});

export default WorkspaceWrapper;
