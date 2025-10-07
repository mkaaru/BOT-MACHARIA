
import { localize } from '@deriv-com/translations';

window.Blockly.Blocks.roc_direction_changed = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('ROC Direction Changed (Period: %1)', 'ROC Direction Changed (Period: %1)'),
            args0: [
                {
                    type: 'input_value',
                    name: 'PERIOD',
                    check: 'Number',
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns true when ROC changes direction (positive to negative or vice versa)'),
            category: window.Blockly.Categories.Indicators,
        };
    },
    meta() {
        return {
            display_name: localize('ROC Direction Changed'),
            description: localize('Detects when Rate of Change indicator changes direction'),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.roc_direction_changed = block => {
    const period = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'PERIOD',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '2';

    const code = `
(function() {
    if (typeof BinaryBotPrivateROCHistory === 'undefined') {
        BinaryBotPrivateROCHistory = [];
    }
    
    var ticks = Bot.getTicks(false);
    if (ticks.length < ${period} + 1) {
        return false;
    }
    
    var currentPrice = ticks[ticks.length - 1];
    var previousPrice = ticks[ticks.length - 1 - ${period}];
    
    if (previousPrice === 0) {
        return false;
    }
    
    var currentROC = ((currentPrice - previousPrice) / previousPrice) * 100;
    
    if (BinaryBotPrivateROCHistory.length === 0) {
        BinaryBotPrivateROCHistory.push(currentROC);
        return false;
    }
    
    var lastROC = BinaryBotPrivateROCHistory[BinaryBotPrivateROCHistory.length - 1];
    var directionChanged = (lastROC > 0 && currentROC < 0) || (lastROC < 0 && currentROC > 0);
    
    BinaryBotPrivateROCHistory.push(currentROC);
    if (BinaryBotPrivateROCHistory.length > 10) {
        BinaryBotPrivateROCHistory.shift();
    }
    
    return directionChanged;
})()`;

    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};
