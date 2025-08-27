import React from 'react';
import { observer } from 'mobx-react-lite';
import { tabs_title } from '@/constants/load-modal';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { rudderStackSendSwitchLoadStrategyTabEvent } from '../../analytics/rudderstack-bot-builder';
import { rudderStackSendCloseEvent } from '../../analytics/rudderstack-common-events';
import { LOAD_MODAL_TABS } from '../../analytics/utils';
import MobileFullPageModal from '../shared_ui/mobile-full-page-modal';
import Modal from '../shared_ui/modal';
import Tabs from '../shared_ui/tabs';
import GoogleDrive from './google-drive';
import Local from './local';
import LocalFooter from './local-footer';
import Recent from './recent';
import RecentFooter from './recent-footer';

const LoadModal: React.FC = observer((): JSX.Element => {
    const { load_modal, dashboard } = useStore();
    const {
        active_index,
        is_load_modal_open,
        loaded_local_file,
        onEntered,
        recent_strategies,
        setActiveTabIndex,
        toggleLoadModal,
        tab_name,
    } = load_modal;
    const { setPreviewOnPopup } = dashboard;
    const { isDesktop } = useDevice();
    const header_text: string = localize('Load strategy');

    const handleTabItemClick = (active_index: number): void => {
        setActiveTabIndex(active_index);
        rudderStackSendSwitchLoadStrategyTabEvent({
            load_strategy_tab: LOAD_MODAL_TABS[active_index + (!isDesktop ? 1 : 0)],
        });
    };

    // Register missing block definitions
    const registerMissingBlocks = (missingTypes: string[]) => {
        missingTypes.forEach(blockType => {
            if (!window.Blockly.Blocks[blockType]) {
                console.warn(`Registering fallback definition for missing block type: ${blockType}`);

                // Register basic fallback block definitions
                if (blockType === 'variable_sets') {
                    window.Blockly.Blocks.variable_sets = {
                        init: function() {
                            this.appendValueInput('VALUE')
                                .setCheck(null)
                                .appendField('set')
                                .appendField(new window.Blockly.FieldVariable('item'), 'VAR')
                                .appendField('to');
                            this.setPreviousStatement(true, null);
                            this.setNextStatement(true, null);
                            this.setColour(330);
                            this.setTooltip('Set variable to a value');
                            this.setHelpUrl('');
                        }
                    };

                    // Also register the generator if needed
                    if (window.Blockly.JavaScript && !window.Blockly.JavaScript[blockType]) {
                        window.Blockly.JavaScript.variable_sets = function(block: any) {
                            const varName = window.Blockly.JavaScript.nameDB_.getName(block.getFieldValue('VAR'), window.Blockly.Variables.NAME_TYPE);
                            const value = window.Blockly.JavaScript.valueToCode(block, 'VALUE', window.Blockly.JavaScript.ORDER_ASSIGNMENT) || '0';
                            return `${varName} = ${value};\n`;
                        };
                    }
                } else if (blockType === 'variables_get') {
                    window.Blockly.Blocks.variables_get = {
                        init: function() {
                            this.appendDummyInput()
                                .appendField(new window.Blockly.FieldVariable('item'), 'VAR');
                            this.setOutput(true, null);
                            this.setColour(330);
                            this.setTooltip('Returns the value of this variable');
                            this.setHelpUrl('');
                        }
                    };

                    if (window.Blockly.JavaScript && !window.Blockly.JavaScript[blockType]) {
                        window.Blockly.JavaScript.variables_get = function(block: any) {
                            const varName = window.Blockly.JavaScript.nameDB_.getName(block.getFieldValue('VAR'), window.Blockly.Variables.NAME_TYPE);
                            return [varName, window.Blockly.JavaScript.ORDER_ATOMIC];
                        };
                    }
                } else {
                    // Generic fallback for unknown blocks
                    window.Blockly.Blocks[blockType] = {
                        init: function() {
                            this.appendDummyInput()
                                .appendField(`[${blockType}]`);
                            this.setPreviousStatement(true, null);
                            this.setNextStatement(true, null);
                            this.setColour(160);
                            this.setTooltip(`Fallback block for ${blockType}`);
                            this.setHelpUrl('');
                        }
                    };
                }

                console.log(`Successfully registered fallback for block type: ${blockType}`);
            }
        });
    };

    // Ensure loadFileFromContent is defined on load_modal
    load_modal.loadFileFromContent = async (xmlContent: string) => {
        try {
            console.log('Loading XML content:', xmlContent);
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

            // Identify missing block types from the parsed XML
            const missingTypes: string[] = [];
            const blockElements = xmlDoc.querySelectorAll('block');
            blockElements.forEach(blockElement => {
                const type = blockElement.getAttribute('type');
                if (type && !window.Blockly.Blocks[type]) {
                    missingTypes.push(type);
                }
            });

            // Register any missing blocks
            if (missingTypes.length > 0) {
                registerMissingBlocks(missingTypes);
            }

            // Define the loadParsedXML method
            load_modal.loadParsedXML = (xmlDoc: Document) => {
                // Clear the existing workspace
                const workspace = Blockly.getMainWorkspace();
                workspace.clear();
                // Load the parsed XML into the bot builder
                Blockly.Xml.domToWorkspace(xmlDoc.documentElement, workspace);
                console.log('Parsed XML loaded into workspace');
            };
            load_modal.loadParsedXML(xmlDoc);
        } catch (error) {
            console.error('Error loading XML content:', error);
        }
    };

    if (!isDesktop) {
        return (
            <MobileFullPageModal
                is_modal_open={is_load_modal_open}
                className='load-strategy__wrapper'
                header={header_text}
                onClickClose={() => {
                    setPreviewOnPopup(false);
                    toggleLoadModal();
                    rudderStackSendCloseEvent({
                        subform_name: 'load_strategy',
                        load_strategy_tab: LOAD_MODAL_TABS[active_index + 1],
                    });
                }}
                height_offset='80px'
                page_overlay
            >
                <Tabs active_index={active_index} onTabItemClick={handleTabItemClick} top>
                    <div label={localize('Local')}>
                        <Local />
                    </div>
                    <div label='Google Drive'>
                        <GoogleDrive />
                    </div>
                </Tabs>
            </MobileFullPageModal>
        );
    }

    const is_file_loaded: boolean = !!loaded_local_file && tab_name === tabs_title.TAB_LOCAL;
    const has_recent_strategies: boolean = recent_strategies.length > 0 && tab_name === tabs_title.TAB_RECENT;

    return (
        <Modal
            title={header_text}
            className='load-strategy'
            width='1000px'
            height='80vh'
            is_open={is_load_modal_open}
            toggleModal={() => {
                toggleLoadModal();
                rudderStackSendCloseEvent({
                    subform_name: 'load_strategy',
                    load_strategy_tab: LOAD_MODAL_TABS[active_index + (!isDesktop ? 1 : 0)],
                });
            }}
            onEntered={onEntered}
            elements_to_ignore={[document.querySelector('.injectionDiv') as Element]}
        >
            <Modal.Body>
                <Tabs active_index={active_index} onTabItemClick={handleTabItemClick} top header_fit_content>
                    <div label={localize('Recent')}>
                        <Recent />
                    </div>
                    <div label={localize('Local')}>
                        <Local />
                    </div>
                    <div label='Google Drive'>
                        <GoogleDrive />
                    </div>
                </Tabs>
            </Modal.Body>
            {has_recent_strategies && (
                <Modal.Footer has_separator>
                    <RecentFooter />
                </Modal.Footer>
            )}
            {is_file_loaded && (
                <Modal.Footer has_separator>
                    <LocalFooter />
                </Modal.Footer>
            )}
        </Modal>
    );
});

export default LoadModal;