window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_again = () => [
    `
    // Ensure contract is closed before next trade (no timing delays)
    if (Bot.isWaitingForContractClose && Bot.isWaitingForContractClose()) {
        console.log('⏳ TRADE AGAIN: Waiting for current contract to close...');
        // Wait for contract to close
        return new Promise((resolve) => {
            const observer = Bot.observer || window.globalObserver;
            const listener = (contract) => {
                console.log('✅ TRADE AGAIN: Contract closed, proceeding with next trade');
                observer.unregister('contract.closed', listener);
                resolve();
            };
            observer.register('contract.closed', listener);
            
            // Also listen for ready signal
            const readyListener = () => {
                observer.unregister('ready.for.next.trade', readyListener);
                resolve();
            };
            observer.register('ready.for.next.trade', readyListener);
        }).then(() => {
            Bot.isTradeAgain(true);
        });
    } else {
        console.log('✅ TRADE AGAIN: Ready to trade immediately');
        Bot.isTradeAgain(true);
    }
    `,
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];