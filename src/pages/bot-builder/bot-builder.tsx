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

    // Track current ML recommendation and auto-update contracts
    const [currentRecommendation, setCurrentRecommendation] = React.useState<any>(null);
    const [isAutoUpdateEnabled, setIsAutoUpdateEnabled] = React.useState(false);

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

    // Placeholder for logic to fetch and update ML recommendations
    React.useEffect(() => {
        // Simulate fetching ML recommendations
        const fetchRecommendations = async () => {
            // Replace with actual API call to fetch ML recommendations
            const recommendations = await new Promise(resolve =>
                setTimeout(() => resolve([{ contract_type: 'CALL', duration: 1, expiry: 10 }]), 2000)
            );
            if (recommendations && recommendations.length > 0) {
                setCurrentRecommendation(recommendations[0]);
            }
        };

        fetchRecommendations();

        // Set up interval to periodically check for new recommendations
        const intervalId = setInterval(fetchRecommendations, 15000); // Check every 15 seconds

        return () => clearInterval(intervalId); // Cleanup interval on unmount
    }, []);

    // Effect to update contracts when a new recommendation appears and auto-update is enabled
    React.useEffect(() => {
        if (currentRecommendation && isAutoUpdateEnabled) {
            const workspace = window.Blockly?.derivWorkspace;
            if (workspace) {
                // Logic to find and update the contract block
                // This is a simplified example; actual implementation may need to traverse blocks
                const contractBlocks = workspace.getBlocksByType('contract'); // Assuming 'contract' is the type of block for contracts
                if (contractBlocks.length > 0) {
                    const contractBlock = contractBlocks[0]; // Assuming we want to update the first contract block
                    // Example: Update contract type and expiry based on recommendation
                    // The actual block manipulation will depend on the Blockly schema
                    contractBlock.setFieldValue(currentRecommendation.contract_type, 'CONTRACT_TYPE');
                    contractBlock.setFieldValue(currentRecommendation.expiry, 'EXPIRY');
                    // You might also need to update other properties like duration, amount, etc.
                    botNotification(notification_message().new_recommendation_applied, {
                        message: `Applied new recommendation: ${currentRecommendation.contract_type}`,
                    });
                } else {
                    // Handle case where no contract block is found
                    console.warn('No contract block found to update.');
                }
            }
        }
    }, [currentRecommendation, isAutoUpdateEnabled]);

    return (
        <>
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
            {active_tab === 1 && <BotBuilderTourHandler is_mobile={!isDesktop} />}
            <LoadModal />
            <SaveModal />
            {is_open && <QuickStrategy />}
        </>
    );
});

export default BotBuilder;