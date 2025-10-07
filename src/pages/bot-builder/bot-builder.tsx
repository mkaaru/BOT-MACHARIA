import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { botNotification } from '@/components/bot-notification/bot-notification';
import { notification_message } from '@/components/bot-notification/bot-notification-utils';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { TBlocklyEvents } from 'Types';
import LoadModal from '../../components/load-modal';
import SaveModal from '../dashboard/bot-list/save-modal';
import BotBuilderTourHandler from '../tutorials/dbot-tours/bot-builder-tour';
import QuickStrategy from './quick-strategy';
import WorkspaceWrapper from './workspace-wrapper';

const BotBuilder = observer(() => {
    const { dashboard, app, run_panel, toolbar, quick_strategy, blockly_store } = useStore();
    const { active_tab, active_tour, is_preview_on_popup } = dashboard;
    const { is_open } = quick_strategy;
    const { is_running } = run_panel;
    const { is_loading } = blockly_store;
    const is_blockly_listener_registered = React.useRef(false);
    const is_blockly_delete_listener_registered = React.useRef(false);
    const { isDesktop } = useDevice();
    const { onMount, onUnmount } = app;
    const el_ref = React.useRef<HTMLInputElement | null>(null);

    let deleted_block_id: null | string = null;

    React.useEffect(() => {
        onMount();
        return () => onUnmount();
    }, [onMount, onUnmount]);

    React.useEffect(() => {
        const workspace = window.Blockly?.derivWorkspace;
        if (workspace && is_running && !is_blockly_listener_registered.current) {
            is_blockly_listener_registered.current = true;
            workspace.addChangeListener(handleBlockChangeOnBotRun);
        } else {
            removeBlockChangeListener();
        }

        return () => {
            if (workspace && is_blockly_listener_registered.current) {
                removeBlockChangeListener();
            }
        };
    }, [is_running]);

    const handleBlockChangeOnBotRun = (e: Event) => {
        const { is_reset_button_clicked } = toolbar;
        if (e.type !== 'selected' && !is_reset_button_clicked) {
            botNotification(notification_message().workspace_change);
            removeBlockChangeListener();
        } else if (is_reset_button_clicked) {
            removeBlockChangeListener();
        }
    };

    const removeBlockChangeListener = () => {
        is_blockly_listener_registered.current = false;
        window.Blockly?.derivWorkspace?.removeChangeListener(handleBlockChangeOnBotRun);
    };

    React.useEffect(() => {
        const workspace = window.Blockly?.derivWorkspace;
        if (workspace && !is_blockly_delete_listener_registered.current) {
            is_blockly_delete_listener_registered.current = true;
            workspace.addChangeListener(handleBlockDelete);
        }
    }, [is_loading]);

    const handleBlockDelete = (e: TBlocklyEvents) => {
        const { is_reset_button_clicked, setResetButtonState } = toolbar;
        if (e.type === 'delete' && !is_reset_button_clicked) {
            deleted_block_id = e.blockId;
        }
        if (e.type === 'selected' && deleted_block_id === e.oldElementId) {
            handleBlockDeleteNotification();
        }
        if (
            e.type === 'change' &&
            e.name === 'AMOUNT_LIMITS' &&
            e.newValue === '(min: 0.35 - max: 50000)' &&
            is_reset_button_clicked
        ) {
            setResetButtonState(false);
        }
    };

    const handleBlockDeleteNotification = () => {
        botNotification(notification_message().block_delete, {
            label: localize('Undo'),
            onClick: closeToast => {
                window.Blockly.derivWorkspace.undo();
                closeToast?.();
            },
        });
    };

    // Error boundary component for Bot Builder
    class ErrorBoundary extends React.Component {
        constructor(props: { children: React.ReactNode }) {
            super(props);
            this.state = { hasError: false, errorMessage: '' };
        }

        static getDerivedStateFromError(error: Error) {
            return { hasError: true, errorMessage: error.message };
        }

        componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
            console.error('Error caught by boundary:', error, errorInfo);
            const { setBlocklyErrorMessage } = blockly_store;
            setBlocklyErrorMessage(error.message);
        }

        render() {
            const { hasError, errorMessage } = this.state as { hasError: boolean; errorMessage: string };
            const { is_blockly_error } = blockly_store;

            if (hasError || is_blockly_error) {
                return (
                    <div className='bot-builder-error'>
                        <p>{localize('Sorry for the interruption')}</p>
                        <p>{errorMessage || localize('An unexpected error occurred. Please refresh the page.')}</p>
                        <button onClick={() => window.location.reload()}>{localize('Refresh')}</button>
                    </div>
                );
            }

            return this.props.children;
        }
    }

    return (
        <>
            <ErrorBoundary>
                <div
                    className={classNames('bot-builder', {
                        'bot-builder--active': active_tab === 1 && !is_preview_on_popup,
                        'bot-builder--inactive': is_preview_on_popup,
                        'bot-builder--tour-active': active_tour,
                    })}
                >
                    <div id='scratch_div' ref={el_ref}>
                        <WorkspaceWrapper />
                    </div>
                </div>
            </ErrorBoundary>
            {active_tab === 1 && <BotBuilderTourHandler is_mobile={!isDesktop} />}
            <LoadModal />
            <SaveModal />
            {is_open && <QuickStrategy />}
        </>
    );
});

export default BotBuilder;