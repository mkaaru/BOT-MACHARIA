window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_again = () => [
    `
    // Enhanced sequential trading - wait for contract closure with timeout
    if (Bot.isWaitingForContractClosure) {
        console.log('⏳ TRADE_AGAIN: Waiting for previous contract to close...');
        
        // Wait for contract closure with proper promise handling
        return new Promise((resolve) => {
            const observer = Bot.observer || window.globalObserver;
            let isResolved = false;
            
            const closeListener = (contract) => {
                if (!isResolved) {
                    isResolved = true;
                    observer.unregister('contract.closed', closeListener);
                    observer.unregister('contract.force_released', forceListener);
                    console.log('✅ TRADE_AGAIN: Contract closed, continuing...');
                    Bot.isTradeAgain(true);
                    resolve();
                }
            };
            
            const forceListener = () => {
                if (!isResolved) {
                    isResolved = true;
                    observer.unregister('contract.closed', closeListener);
                    observer.unregister('contract.force_released', forceListener);
                    console.log('🚨 TRADE_AGAIN: Force released, continuing...');
                    Bot.isTradeAgain(true);
                    resolve();
                }
            };
            
            observer.register('contract.closed', closeListener);
            observer.register('contract.force_released', forceListener);
            
            // Safety timeout - auto-continue after 5 minutes
            setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    observer.unregister('contract.closed', closeListener);
                    observer.unregister('contract.force_released', forceListener);
                    console.log('⚠️ TRADE_AGAIN: Timeout reached, forcing continuation...');
                    Bot.forceReleaseContractWait();
                    Bot.isTradeAgain(true);
                    resolve();
                }
            }, 300000); // 5 minutes
        });
    } else {
        console.log('🚀 TRADE_AGAIN: No contract waiting, continuing immediately');
        Bot.isTradeAgain(true);
    }
    `,
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];