
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import BotBuilder from '@/pages/bot-builder';
import Chart from '@/pages/chart';
import Dashboard from '@/pages/dashboard';
import Tutorials from '@/pages/tutorials';
import TradingHubDisplay from '@/components/higher-lower-trader/trading-hub-display';

interface MainProps {
    // Component props
}

const Main: React.FC<MainProps> = observer(() => {
    const { ui } = useStore();
    
    const getActiveComponent = () => {
        switch (ui.active_tab) {
            case 'dashboard':
                return <Dashboard />;
            case 'bot_builder':
                return <BotBuilder />;
            case 'chart':
                return <Chart />;
            case 'tutorials':
                return <Tutorials />;
            case 'trading_hub':
            case 'auto':
                return <TradingHubDisplay />;
            default:
                return <Dashboard />;
        }
    };

    return (
        <div className="main-container">
            {getActiveComponent()}
        </div>
    );
});

export default Main;
