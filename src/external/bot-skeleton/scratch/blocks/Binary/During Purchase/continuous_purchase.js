
import { translate } from '../../../../utils/lang/i18n';

Blockly.Blocks.continuous_purchase = {
    init() {
        this.appendDummyInput()
            .appendField(translate('Set continuous purchase mode'))
            .appendField(new Blockly.FieldDropdown([
                [translate('Continuous (immediate next trade)'), 'true'],
                [translate('Sequential (wait for contract close)'), 'false']
            ]), 'CONTINUOUS_MODE');
        
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#f2f2f2');
        this.setTooltip(translate('Set whether to purchase continuously or wait for each contract to close'));
        this.setHelpUrl('https://github.com/binary-com/binary-bot/wiki');
    },
    onchange: Blockly.Blocks.input.onchange,
};

Blockly.JavaScript.continuous_purchase = block => {
    const continuousMode = block.getFieldValue('CONTINUOUS_MODE');
    
    const code = `
        // Set continuous purchase mode
        if (typeof Bot !== 'undefined' && Bot.purchase && typeof Bot.purchase.setContinuousMode === 'function') {
            Bot.purchase.setContinuousMode(${continuousMode});
            console.log('Continuous purchase mode set to: ${continuousMode === 'true' ? 'Continuous' : 'Sequential'}');
        }
    `;
    
    return code;
};

export default {
    definition: Blockly.Blocks.continuous_purchase,
    generator: Blockly.JavaScript.continuous_purchase,
};
