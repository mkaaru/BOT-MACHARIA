
import { localize } from '@deriv-com/translations';
import { finishSign } from '../../../utils';

export default Blockly => {
    Blockly.Blocks.trade_definition_multi = {
        init() {
            this.appendDummyInput().appendField(localize('Multi Trade'));
            this.appendValueInput('MARKET').setCheck('String').appendField(localize('Market'));
            this.appendValueInput('TRADETYPE').setCheck('String').appendField(localize('Trade Type'));
            this.appendValueInput('CONTRACTTYPE').setCheck('String').appendField(localize('Contract Type'));
            this.appendValueInput('DURATION').setCheck('Number').appendField(localize('Duration'));
            this.appendValueInput('DURATIONUNIT').setCheck('String').appendField(localize('Duration Unit'));
            this.appendValueInput('AMOUNT').setCheck('Number').appendField(localize('Stake'));
            this.appendValueInput('PREDICTION').setCheck('Number').appendField(localize('Prediction'));
            this.appendValueInput('BARRIEROFFSET').setCheck('String').appendField(localize('Barrier Offset'));
            this.appendValueInput('SECONDBARRIEROFFSET').setCheck('String').appendField(localize('Second Barrier Offset'));
            this.appendValueInput('TRADE_COUNT').setCheck('Number').appendField(localize('Number of Trades'));
            this.setColour('#2a3052');
            this.setPreviousStatement(true, 'TradeTypes');
            this.setTooltip(localize('Execute multiple trades simultaneously with the same parameters'));
        },
        onchange: Blockly.Blocks.trade_definition.onchange,
        allowed_parents: Blockly.Blocks.trade_definition.allowed_parents,
        getRequiredValueInputs: Blockly.Blocks.trade_definition.getRequiredValueInputs,
    };

    Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_multi = block => {
        const market = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'MARKET', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '""';
        const trade_type = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'TRADETYPE', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '""';
        const contract_type = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'CONTRACTTYPE', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '""';
        const duration = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'DURATION', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '1';
        const duration_unit = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'DURATIONUNIT', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '"t"';
        const stake_amount = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'AMOUNT', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '1';
        const prediction = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'PREDICTION', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '';
        const barrier_offset = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'BARRIEROFFSET', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '';
        const second_barrier_offset = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'SECONDBARRIEROFFSET', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '';
        const trade_count = Blockly.JavaScript.javascriptGenerator.valueToCode(block, 'TRADE_COUNT', Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC) || '5';

        const code = `
        const tradeOptions = {
            amount: ${stake_amount},
            basis: 'stake',
            contract_type: ${contract_type},
            currency: BinaryBotPrivateInit.currency,
            duration: ${duration},
            duration_unit: ${duration_unit},
            symbol: ${market},
            ${prediction ? `prediction: ${prediction},` : ''}
            ${barrier_offset ? `barrier: ${barrier_offset},` : ''}
            ${second_barrier_offset ? `barrier2: ${second_barrier_offset},` : ''}
        };
        
        // Execute multiple trades simultaneously
        const tradePromises = [];
        for (let i = 0; i < ${trade_count}; i++) {
            tradePromises.push(Bot.start(tradeOptions));
        }
        
        // Wait for all trades to complete
        Promise.all(tradePromises).then(results => {
            console.log('All trades completed:', results);
        }).catch(error => {
            console.error('Error in multi-trade execution:', error);
        });
        
        BinaryBotPrivateHasCalledTradeOptions = true;
    `;

        return code;
    };
};
