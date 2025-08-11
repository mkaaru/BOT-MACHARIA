import { config } from '../constants/config';

export const hasAllRequiredBlocks = () => {
    const blocks_in_workspace = window.Blockly.derivWorkspace.getAllBlocks();
    const { mandatoryMainBlocks } = config();
    const required_block_types = ['trade_definition_tradeoptions', ...mandatoryMainBlocks];
    const all_block_types = blocks_in_workspace.map(block => block.type);
    const has_all_required_blocks = required_block_types.every(required_block_type =>
        all_block_types.includes(required_block_type)
    );

    return has_all_required_blocks;
};

export const onWorkspaceResize = () => {
    const workspace = window.Blockly.derivWorkspace;
    if (workspace) {
        // kept this commented to fix slow rendering issue
        //workspace.getAllFields().forEach(field => field.forceRerender());

        const el_scratch_div = document.getElementById('scratch_div');
        if (el_scratch_div) {
            window.Blockly.svgResize(workspace);
        }
    }
};

export const removeLimitedBlocks = (workspace, block_types) => {
    const types = Array.isArray(block_types) ? block_types : [block_types];

    types.forEach(block_type => {
        if (config().single_instance_blocks.includes(block_type)) {
            workspace.getAllBlocks().forEach(ws_block => {
                if (ws_block.type === block_type) {
                    ws_block.dispose();
                }
            });
        }
    });
};

export const isDbotRTL = () => {
    const htmlElement = document.documentElement;
    const dirValue = htmlElement.getAttribute('dir');
    return dirValue === 'rtl';
};
// Workspace utility for loading and managing bot strategies
const workspace = {
    load: async ({ block_string, file_name, workspace, from, drop_event, strategy_id, showIncompatibleStrategyDialog }) => {
        try {
            console.log(`Loading strategy: ${file_name}`);
            
            if (!block_string) {
                throw new Error('No block string provided');
            }

            // Parse the XML block string
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(block_string, 'text/xml');
            
            if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
                throw new Error('Invalid XML format');
            }

            // Clear existing workspace if it exists
            if (workspace) {
                workspace.clear();
                
                // Load the new blocks into workspace
                if (window.Blockly && window.Blockly.Xml) {
                    window.Blockly.Xml.domToWorkspace(xmlDoc, workspace);
                }
            }

            console.log('Strategy loaded successfully');
            return Promise.resolve();
        } catch (error) {
            console.error('Failed to load strategy:', error);
            return Promise.reject(error);
        }
    },

    save: (workspace) => {
        if (workspace && window.Blockly && window.Blockly.Xml) {
            const xml = window.Blockly.Xml.workspaceToDom(workspace);
            return window.Blockly.Xml.domToText(xml);
        }
        return '';
    }
};

export default workspace;
export const load = workspace.load;
