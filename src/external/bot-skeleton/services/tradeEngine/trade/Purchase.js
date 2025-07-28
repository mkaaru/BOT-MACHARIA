import { localize } from '@deriv-com/translations';

// Located at: src/external/bot-skeleton/scratch/blocks/Binary/During Purchase/during_purchase.js
window.Blockly.Blocks.during_purchase = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: '%1 %2 %3',
            message1: '%1',
            message2: '%1',
            args0: [
                {
                    type: 'field_image',
                    src: 'image/sellContract.png',
                    width: 25,
                    height: 25,
                    alt: 'S',
                },
                {
                    type: 'field_label',
                    text: localize('3. Sell conditions'),
                    class: 'blocklyTextRootBlockHeader',
                },
                {
                    type: 'input_dummy',
                },
            ],
            args1: [
                {
                    type: 'input_statement',
                    name: 'DURING_PURCHASE_STACK',
                    check: 'SellAtMarket',
                },
            ],
            args2: [
                {
                    type: 'field_image',
                    src: ' ',
                    width: 380,
                    height: 10,
                },
            ],
            colour: window.Blockly.Colours.RootBlock.colour,
            colourSecondary: window.Blockly.Colours.RootBlock.colourSecondary,
            colourTertiary: window.Blockly.Colours.RootBlock.colourTertiary,
            tooltip: localize('Sell your active contract if needed (optional)'),
        };
    },
};

// Located at: src/external/bot-skeleton/scratch/blocks/Binary/Before Purchase/purchase.js
window.Blockly.Blocks.purchase = {
    init() {
        this.jsonInit(this.definition());
        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('This block purchases contract of a specified type.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Purchase'),
            description: localize(
                'Use this block to purchase the specific contract you want. You may add multiple Purchase blocks together with conditional blocks to define your purchase conditions. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }
        // Additional validation logic would go here
    },
};

// JavaScript generators for the blocks
window.Blockly.JavaScript.javascriptGenerator.forBlock.during_purchase = block => {
    const stack = window.Blockly.JavaScript.javascriptGenerator.statementToCode(block, 'DURING_PURCHASE_STACK');

    const code = `BinaryBotPrivateDuringPurchase = function BinaryBotPrivateDuringPurchase() {
        Bot.highlightBlock('${block.id}');
        ${stack}
    };\n`;
    return code;
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');

    const code = `
        Bot.purchase('${purchaseList}');
    `;

    return code;
};

// Export as default for the trade engine
export default function Purchase(Base) {
    return class extends Base {
        purchase(contractType) {
            console.log(`Purchasing contract: ${contractType}`);

            // Execute the purchase
            if (this.api && this.api.buy) {
                return this.api.buy({
                    contract_type: contractType,
                    amount: this.getStake ? this.getStake() : 1,
                });
            }
        }
    };
}