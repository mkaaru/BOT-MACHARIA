import { localize } from '@deriv-com/translations';
import { getContractTypeOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.switcher = {
    init() {
        this.jsonInit(this.definition());

        // Ensure one of this type per statement-stack
        this.setNextStatement(true);

        // Track the market block for registration
        this.market_block = null;
    },
    definition() {
        return {
            message0: localize('Switch to {{ input_symbol }}', { input_symbol: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'SYMBOL_LIST',
                    options: [['', '']],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('This block switches to the selected symbol.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Switcher'),
            description: localize(
                'Use this block to switch to a different symbol. You may add multiple Switcher blocks together with conditional blocks to define your switching conditions. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('switch'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) {
            this.findAndRegisterWithMarketBlock();
            this.updateSymbolList(event);
        } else if (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart && event.blockId === this.id) {
            // Block was moved, check if we need to re-register
            this.findAndRegisterWithMarketBlock();
            this.updateSymbolList(event);
        }
    },
    // Find the market block and register with it
    findAndRegisterWithMarketBlock() {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();
        if (!trade_definition_block) return;

        const market_block = trade_definition_block.getChildByType('trade_definition_market');
        if (!market_block) return;

        // Store reference to market block
        this.market_block = market_block;

        // Register this switcher with market block for change notifications
        if (typeof market_block.registerSwitcherBlock === 'function') {
            market_block.registerSwitcherBlock(this);
        }
    },
    // Update the symbol dropdown with current options
    updateSymbolList(event) {
        if (!this.market_block) {
            this.findAndRegisterWithMarketBlock();
            if (!this.market_block) return;
        }

        const symbol_dropdown = this.market_block.getField('SYMBOL_LIST');
        if (!symbol_dropdown) return;

        const symbol_options = symbol_dropdown.menuGenerator_; // eslint-disable-line
        if (!symbol_options || symbol_options.length === 0) return;

        const current_market_symbol = symbol_dropdown.getValue();

        const switcher_symbol_list = this.getField('SYMBOL_LIST');
        const current_selected_symbol = switcher_symbol_list.getValue();

        // Update with all available symbols
        switcher_symbol_list.updateOptions(symbol_options, {
            default_value: current_selected_symbol || current_market_symbol,
            event_group: event ? event.group : null,
            should_pretend_empty: true,
        });

        // Synchronize the Market block's symbol with the Switcher block
        this.market_block.setFieldValue(switcher_symbol_list.getValue(), 'SYMBOL_LIST');
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.switcher = block => {
    const symbolList = block.getFieldValue('SYMBOL_LIST');

    // Update Bot.tradeOptions.symbol and log the change
    const code = `Bot.purchase('${symbolList}');\n`;
    return code;
};
