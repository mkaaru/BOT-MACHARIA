import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useStore } from '@/hooks/useStore';
import { Loader } from '@deriv-com/ui';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading } = blockly_store;

    // Add timeout for blockly loading
    useEffect(() => {
        if (is_loading) {
            const timeout = setTimeout(() => {
                console.warn('⚠️ Blockly loading timeout - forcing completion');
                // Force stop loading if it takes too long
                if (blockly_store.setLoading) {
                    blockly_store.setLoading(false);
                }
            }, 15000); // 15 second timeout

            return () => clearTimeout(timeout);
        }
    }, [is_loading, blockly_store]);

    useEffect(() => {
        console.log(`🔧 Blockly loading state: ${is_loading}`);
    }, [is_loading]);

    return (
        <>
            {is_loading && (
                <div className='bot__loading' data-testid='blockly-loader'>
                    <Loader />
                    <div>Loading Blockly...</div>
                </div>
            )}
        </>
    );
});

export default BlocklyLoading;
