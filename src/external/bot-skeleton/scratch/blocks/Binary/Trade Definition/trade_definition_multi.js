
import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.trade_definition_multi = {
    init() {
        this.jsonInit({
            message0: localize('Multi Trade: Execute %1 trades simultaneously', {
                count: '%1',
            }),
            args0: [
                {
                    type: 'field_number',
                    name: 'TRADE_COUNT',
                    value: 5,
                    min: 1,
                    max: 10,
                },
            ],
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            previousStatement: null,
            nextStatement: null,
        });
        this.setMovable(false);
        this.setDeletable(false);
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    enforceLimitations: window.Blockly.Blocks.trade_definition_market.enforceLimitations,
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_multi = block => {
    const trade_count = block.getFieldValue('TRADE_COUNT') || 5;
    return `Bot.setMultiTradeCount(${trade_count});`;
};

export default (Blockly) => {
    // Block is already registered above
    console.log('Multi trade definition loaded');
};
