
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import './connection-status.scss';

const ConnectionStatus = () => {
    const { common } = useStore();
    const connectionStatus = common.connection_status;

    const getStatusInfo = () => {
        switch (connectionStatus) {
            case CONNECTION_STATUS.OPENED:
                return {
                    icon: '🟢',
                    text: 'Connected',
                    className: 'connected'
                };
            case CONNECTION_STATUS.CLOSED:
                return {
                    icon: '🔴',
                    text: 'Disconnected',
                    className: 'disconnected'
                };
            default:
                return {
                    icon: '🟡',
                    text: 'Connecting...',
                    className: 'connecting'
                };
        }
    };

    const statusInfo = getStatusInfo();

    return (
        <div className={`connection-status ${statusInfo.className}`}>
            <span className="connection-status__icon">{statusInfo.icon}</span>
            <span className="connection-status__text">{statusInfo.text}</span>
        </div>
    );
};

export default observer(ConnectionStatus);
