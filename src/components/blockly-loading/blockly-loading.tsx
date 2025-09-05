import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { Loader } from '@deriv-com/ui';

const BlocklyLoading = observer(() => {
    // Disabled loading block as requested
    return null;
});

export default BlocklyLoading;
