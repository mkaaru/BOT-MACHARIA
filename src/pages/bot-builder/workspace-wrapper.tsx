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

    React.useEffect(() => {
        console.log('🔄 WorkspaceWrapper mounting...');
        onMount();
        return () => {
            onUnmount();
        };
    }, [onMount, onUnmount]);

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
            color: '#999',
            textAlign: 'center',
            padding: '20px'
        }}>
            <div>Bot Builder Initialization</div>
            <div style={{ fontSize: '14px', marginTop: '10px' }}>
                Failed to load. Please refresh the page.
            </div>
            <button 
                onClick={() => window.location.reload()} 
                style={{
                    marginTop: '15px',
                    padding: '10px 20px',
                    backgroundColor: '#ff444f',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                }}
            >
                Refresh Page
            </button>
        </div>
    );
});

export default WorkspaceWrapper;
