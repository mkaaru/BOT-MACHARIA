
if (trade_definition_block) {
    const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
    const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
    const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
    const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
    const purchase_type_list = this.getField('PURCHASE_LIST');
    const purchase_type = purchase_type_list.getValue();
    const contract_type_options = getContractTypeOptions(contract_type, trade_type);

    purchase_type_list.updateOptions(contract_type_options, {
        default_value: purchase_type,
        event_group: event.group,
        should_pretend_empty: true,
    });
}
},
customContextMenu(menu) {
    const menu_items = [localize('Enable Block'), localize('Disable Block')];
    excludeOptionFromContextMenu(menu, menu_items);
    modifyContextMenu(menu);
},
restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');

    const code = `Bot.purchase('${purchaseList}');\n`;
    return code;
};
