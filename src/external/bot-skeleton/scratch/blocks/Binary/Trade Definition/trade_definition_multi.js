import { localize } from '@deriv-com/translations';

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
            colour: '#f2f2f2',
            previousStatement: null,
            nextStatement: null,
        });
        this.setMovable(false);
        this.setDeletable(false);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_multi = block => {
    const trade_count = block.getFieldValue('TRADE_COUNT') || 5;
    return `Bot.setMultiTradeCount(${trade_count});`;
};

export default (Blockly) => {
    console.log('Multi trade definition loaded');
};