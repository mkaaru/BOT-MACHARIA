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
        // Enhanced retry mechanism if Blockly doesn't load
        if (!is_loading && !window.Blockly?.derivWorkspace && retryCount < 5) {
            console.log(`🔄 Retrying Blockly initialization (attempt ${retryCount + 1}/5)`);
            setTimeout(() => {
                setRetryCount(prev => prev + 1);
                onMount();
            }, 2000);
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
            color: '#999',
            textAlign: 'center',
            padding: '20px'
        }}>
            <div>Bot Builder Initialization</div>
            <div style={{ fontSize: '14px', marginTop: '10px' }}>
                {retryCount < 5 ? `Attempting to load... (${retryCount + 1}/5)` : 'Failed to load. Please refresh the page.'}
            </div>
            {retryCount >= 5 && (
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
            )}
        </div>
    );
});

export default WorkspaceWrapper;
