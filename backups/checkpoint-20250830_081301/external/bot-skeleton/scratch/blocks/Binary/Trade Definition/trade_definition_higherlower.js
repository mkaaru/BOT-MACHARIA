
import { localize } from '@deriv-com/translations';

const generateCode = (type, symbol, amount, duration, barrier) => {
    const contractType = type === 'Higher' ? 'CALL' : 'PUT';
    const barrierValue = type === 'Higher' ? `+${barrier}` : `-${barrier}`;
    
    const code = `
        Bot.start({
            limitations        : BinaryBotPrivateLimitations,
            symbol             : '${symbol}',
            currency           : Bot.getBalance('currency'),
            amount             : ${amount},
            basis              : 'stake',
            contract_type      : '${contractType}',
            duration           : ${duration},
            duration_unit      : 's',
            barrier            : '${barrierValue}',
        });
        BinaryBotPrivateHasCalledTradeOptions = true;
    `;

    return code;
};

window.Blockly.Blocks.trade_definition_higherlower = {
    init() {
        this.jsonInit({
            message0: localize('Higher/Lower: %1 %2 %3 %4'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'TYPE_LIST',
                    options: [
                        [localize('Higher'), 'Higher'],
                        [localize('Lower'), 'Lower'],
                    ],
                },
                {
                    type: 'field_dropdown', 
                    name: 'SYMBOL_LIST',
                    options: [
                        ['Volatility 10 (1s) Index', 'R_10'],
                        ['Volatility 25 (1s) Index', 'R_25'],
                        ['Volatility 50 (1s) Index', 'R_50'],
                        ['Volatility 75 (1s) Index', 'R_75'],
                        ['Volatility 100 (1s) Index', 'R_100'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'AMOUNT',
                },
                {
                    type: 'input_value', 
                    name: 'BARRIER',
                },
            ],
            colour: '#2A3052',
            colourSecondary: '#2A3052',
            colourTertiary: '#2A3052',
            previousStatement: null,
            nextStatement: null,
        });

        this.setMovable(false);
        this.setDeletable(false);
    },
    onchange: window.Blockly.Blocks.trade_definition.onchange,
    allowed_parents: ['trade_definition_tradeoptions'],
    getRequiredValueInputs() {
        return {
            AMOUNT: localize('Stake'),
            BARRIER: localize('Barrier'),
        };
    },
};

window.Blockly.JavaScript.trade_definition_higherlower = block => {
    const type = block.getFieldValue('TYPE_LIST');
    const symbol = block.getFieldValue('SYMBOL_LIST');
    const amount = window.Blockly.JavaScript.valueToCode(block, 'AMOUNT', window.Blockly.JavaScript.ORDER_ATOMIC) || '1';
    const barrier = window.Blockly.JavaScript.valueToCode(block, 'BARRIER', window.Blockly.JavaScript.ORDER_ATOMIC) || '0.5';
    const duration = '60'; // Default duration in seconds

    const code = generateCode(type, symbol, amount, duration, barrier);
    return code;
};
