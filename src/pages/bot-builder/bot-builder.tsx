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
import QuickStrategy1 from './quick-strategy';
import WorkspaceWrapper from './workspace-wrapper';

const BotBuilder = observer(() => {
    const { dashboard, app, run_panel, toolbar, quick_strategy, blockly_store } = useStore();
    const { active_tab, active_tour, is_preview_on_popup } = dashboard;
    const { is_open } = quick_strategy;
    const { is_running } = run_panel;
    const { is_loading } = blockly_store;
    const is_blockly_listener_registered = React.useRef(false);
    const is_blockly_delete_listener_registered = React.useRef(false);
    const is_mounted = React.useRef(false);
    const instance_id = React.useRef(`bot-builder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    const cleanup_ref = React.useRef(false);
    const { isDesktop } = useDevice();
    const { onMount, onUnmount } = app;
    const el_ref = React.useRef<HTMLInputElement | null>(null);

    // TODO: fix
    // const isMounted = useIsMounted();
    // const { data: remote_config_data } = useRemoteConfig(isMounted());
    let deleted_block_id: null | string = null;

    React.useEffect(() => {
        if (!is_mounted.current && !cleanup_ref.current) {
            console.log(`Bot Builder mounting with instance ID: ${instance_id.current}`);
            is_mounted.current = true;
            
            // Ensure only one instance exists
            const existingBotBuilders = document.querySelectorAll('.bot-builder');
            if (existingBotBuilders.length > 1) {
                console.warn(`Found ${existingBotBuilders.length} Bot Builder instances, cleaning up old ones`);
                Array.from(existingBotBuilders).slice(0, -1).forEach((el, index) => {
                    console.log(`Removing old Bot Builder instance ${index}`);
                    el.remove();
                });
            }
            
            onMount();
        }
        
        return () => {
            if (is_mounted.current && !cleanup_ref.current) {
                console.log(`Bot Builder unmounting instance: ${instance_id.current}`);
                cleanup_ref.current = true;
                is_mounted.current = false;
                
                // Clean up any workspace references safely
                if (window.Blockly?.derivWorkspace) {
                    const workspace = window.Blockly.derivWorkspace;
                    
                    // Mark workspace as being disposed to prevent subscription errors
                    workspace.isDisposing = true;
                    
                    if (workspace.bot_builder_instance === instance_id.current) {
                        workspace.bot_builder_instance = null;
                    }
                    
                    // Safely dispose workspace subscriptions
                    try {
                        if (workspace.themeManager_ && workspace.themeManager_.unsubscribeWorkspace) {
                            workspace.themeManager_.unsubscribeWorkspace(workspace);
                        }
                    } catch (error) {
                        console.warn('Error unsubscribing workspace theme:', error);
                    }
                }
                
                onUnmount();
            }
        };
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Set workspace instance tracking
    React.useEffect(() => {
        if (is_mounted.current && window.Blockly?.derivWorkspace) {
            const workspace = window.Blockly.derivWorkspace;
            workspace.bot_builder_instance = instance_id.current;
            console.log(`Workspace assigned to Bot Builder instance: ${instance_id.current}`);
        }
    }, [is_mounted.current, is_loading]);

    // Only render if component is properly mounted and not cleaned up
    if (!is_mounted.current || cleanup_ref.current) {
        console.log(`Bot Builder render blocked - mounted: ${is_mounted.current}, cleanup: ${cleanup_ref.current}`);
        return null;
    }

    return (
        <>
            <div
                key={instance_id.current}
                data-instance-id={instance_id.current}
                className={classNames('bot-builder', {
                    'bot-builder--active': active_tab === 1 && !is_preview_on_popup,
                    'bot-builder--inactive': is_preview_on_popup,
                    'bot-builder--tour-active': active_tour,
                })}
                style={{ position: 'relative', zIndex: 1 }}
            >
                <div id='scratch_div' ref={el_ref} key={`scratch-workspace-${instance_id.current}`}>
                    <WorkspaceWrapper key={`workspace-wrapper-${instance_id.current}`} />
                </div>
            </div>
            {active_tab === 1 && <BotBuilderTourHandler key={`tour-handler-${instance_id.current}`} is_mobile={!isDesktop} />}
            {/* removed this outside from toolbar because it needs to loaded separately without dependency */}
            <LoadModal key={`load-modal-${instance_id.current}`} />
            <SaveModal key={`save-modal-${instance_id.current}`} />
            {is_open && <QuickStrategy1 key={`quick-strategy-${instance_id.current}`} />}
        </>
    );
});

export default BotBuilder;
