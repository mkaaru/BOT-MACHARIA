window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_again = () => [
    `
    // Continue trading without single contract limits
    if (BinaryBotPrivateContinuousTrading) {
        console.log('🔄 TRADE AGAIN: Continuing with next trade (Contract #' + BinaryBotPrivateContractCount + ')');
        
        // Reset trade options flag for next iteration
        BinaryBotPrivateHasCalledTradeOptions = false;
        
        // Brief delay to prevent rapid-fire trading
        sleep(1);
        
        // Signal ready for next trade
        Bot.isTradeAgain(true);
    } else {
        console.log('🛑 TRADE AGAIN: Continuous trading disabled, stopping');
        Bot.isTradeAgain(false);
    }
    `,
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];