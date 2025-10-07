
import { localize } from '@deriv-com/translations';

window.Blockly.Blocks.roc_trade_signal = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('ROC Trade Signal (Period: %1)', 'ROC Trade Signal (Period: %1)'),
            args0: [
                {
                    type: 'input_value',
                    name: 'PERIOD',
                    check: 'Number',
                },
            ],
            output: 'String',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns CALL or PUT based on ROC direction. Stops when ROC changes direction.'),
            category: window.Blockly.Categories.Indicators,
        };
    },
    meta() {
        return {
            display_name: localize('ROC Trade Signal'),
            description: localize('Generates trade signals based on Rate of Change indicator direction'),
        };
    },
    onchange(event) {
        if (!this.workspace || this.isInFlyout || this.workspace.isDragging()) {
            return;
        }

        if (event.type === window.Blockly.Events.BLOCK_CREATE || event.type === window.Blockly.Events.END_DRAG) {
            // Validation logic if needed
        }
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.roc_trade_signal = block => {
    const period = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'PERIOD',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '2';

    const code = `
(function() {
    var ticks = Bot.getTicks(false);
    if (ticks.length < ${period} + 1) {
        return '';
    }
    
    var currentPrice = ticks[ticks.length - 1];
    var previousPrice = ticks[ticks.length - 1 - ${period}];
    
    if (previousPrice === 0) {
        return '';
    }
    
    var roc = ((currentPrice - previousPrice) / previousPrice) * 100;
    
    return roc > 0 ? 'CALL' : 'PUT';
})()`;

    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};
