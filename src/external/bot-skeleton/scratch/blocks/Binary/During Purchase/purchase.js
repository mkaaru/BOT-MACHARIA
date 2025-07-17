
import { localize } from '@deriv-com/translations';

const definition = () => ({
    message0: localize('Purchase'),
    args0: [
        {
            type: 'field_dropdown',
            name: 'PURCHASE_LIST',
            options: [
                [localize('Call'), 'CALL'],
                [localize('Put'), 'PUT'],
                [localize('Both'), 'BOTH']
            ]
        }
    ],
    colour: '#2a3052',
    previousStatement: null,
    nextStatement: null,
    tooltip: localize('Purchase a contract'),
});

const generator = () => {
    const purchaseType = Blockly.JavaScript.quote_(
        Blockly.JavaScript.getFieldValue(this, 'PURCHASE_LIST') || 'BOTH'
    );
    
    const code = `Bot.purchase(${purchaseType});\n`;
    return code;
};

export default {
    definition,
    generator
};
