window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_again = () => [
    `
    // Wait for contract to close before trading again
    if (Bot.isWaitingForContractClose && Bot.isWaitingForContractClose()) {
        // Wait for contract to close
        return new Promise((resolve) => {
            const observer = Bot.observer || window.globalObserver;
            const listener = () => {
                observer.unregister('contract.closed', listener);
                resolve();
            };
            observer.register('contract.closed', listener);
        }).then(() => {
            Bot.isTradeAgain(true);
        });
    } else {
        Bot.isTradeAgain(true);
    }
    `,
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];