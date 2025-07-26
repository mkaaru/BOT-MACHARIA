// Comprehensive Bot Execution Debugging Tool
// Add this code to your browser console when running your bot

window.BotExecutionDebugger = {
    originalPurchaseFunction: null,
    executionLog: [],
    
    init() {
        console.log('🔍 Bot Execution Debugger initialized');
        this.interceptPurchaseConditions();
        this.monitorBotState();
        this.checkTickData();
    },
    
    interceptPurchaseConditions() {
        // Intercept the BinaryBotPrivateBeforePurchase function
        const originalFunction = window.BinaryBotPrivateBeforePurchase;
        if (originalFunction) {
            window.BinaryBotPrivateBeforePurchase = () => {
                console.log('🎯 Purchase conditions function called!');
                this.executionLog.push({
                    timestamp: new Date(),
                    action: 'purchase_conditions_called'
                });
                try {
                    return originalFunction();
                } catch (error) {
                    console.error('❌ Error in purchase conditions:', error);
                    this.executionLog.push({
                        timestamp: new Date(),
                        action: 'purchase_conditions_error',
                        error: error.message
                    });
                }
            };
            console.log('✅ Purchase conditions function intercepted');
        } else {
            console.log('❌ BinaryBotPrivateBeforePurchase function not found');
        }
    },
    
    monitorBotState() {
        // Check bot running state
        const runPanelStore = window.DBotStores?.run_panel;
        if (runPanelStore) {
            console.log('🤖 Bot State:', {
                isRunning: runPanelStore.is_running,
                contractStage: runPanelStore.contract_stage,
                hasOpenContract: runPanelStore.has_open_contract,
                errorType: runPanelStore.error_type
            });
        }
        
        // Check if Bot object exists and has the method
        if (window.Bot && window.Bot.getEvenOddPercentage) {
            console.log('✅ Bot.getEvenOddPercentage method is available');
            
            // Test the method
            try {
                const testResult = window.Bot.getEvenOddPercentage('Even', 10);
                console.log('🧪 Test call result:', testResult);
                if (testResult && typeof testResult.then === 'function') {
                    testResult.then(result => {
                        console.log('🎯 Even/Odd percentage result:', result);
                    }).catch(error => {
                        console.error('❌ Even/Odd percentage error:', error);
                    });
                }
            } catch (error) {
                console.error('❌ Error testing getEvenOddPercentage:', error);
            }
        } else {
            console.log('❌ Bot.getEvenOddPercentage method not available');
            if (window.Bot) {
                console.log('Available Bot methods:', Object.keys(window.Bot));
            }
        }
    },
    
    checkTickData() {
        // Check if tick data is flowing
        const ticksService = window.ticksService;
        if (ticksService) {
            console.log('📊 Ticks service available');
            
            // Check recent ticks
            try {
                const recentTicks = ticksService.ticks_history;
                if (recentTicks && recentTicks.length > 0) {
                    console.log('✅ Tick data available, last 5 ticks:', 
                        recentTicks.slice(-5).map(tick => ({
                            time: new Date(tick.epoch * 1000),
                            price: tick.quote
                        }))
                    );
                } else {
                    console.log('❌ No tick data available');
                }
            } catch (error) {
                console.error('❌ Error checking tick data:', error);
            }
        } else {
            console.log('❌ Ticks service not available');
        }
    },
    
    simulateConditionCheck() {
        console.log('🧪 Simulating condition check...');
        
        if (window.Bot && window.Bot.getEvenOddPercentage) {
            return window.Bot.getEvenOddPercentage('Even', 10).then(percentage => {
                console.log('📊 Current Even percentage:', percentage);
                
                // Simulate condition: if even percentage > 60%
                if (percentage > 60) {
                    console.log('✅ Condition MET: Even percentage > 60%');
                    console.log('🔍 Checking why purchase is not happening...');
                    
                    // Check if purchase function exists
                    if (window.Bot.purchase) {
                        console.log('💡 Bot.purchase method available - testing call...');
                        try {
                            window.Bot.purchase('CALL');
                            console.log('✅ Purchase call executed');
                        } catch (error) {
                            console.error('❌ Purchase call failed:', error);
                        }
                    } else {
                        console.log('❌ Bot.purchase method not available');
                    }
                } else {
                    console.log('❌ Condition NOT met: Even percentage is', percentage, '%, need > 60%');
                }
                
                return percentage;
            }).catch(error => {
                console.error('❌ Error getting even/odd percentage:', error);
            });
        } else {
            console.log('❌ Cannot simulate - Bot.getEvenOddPercentage not available');
        }
    },
    
    startPeriodicCheck() {
        console.log('🔄 Starting periodic condition checks...');
        this.checkInterval = setInterval(() => {
            console.log('⏰ Periodic check at', new Date().toLocaleTimeString());
            this.simulateConditionCheck();
        }, 5000); // Check every 5 seconds
    },
    
    stopPeriodicCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            console.log('⏹️ Periodic checks stopped');
        }
    },
    
    getExecutionLog() {
        return this.executionLog;
    }
};

// Initialize the debugger
window.BotExecutionDebugger.init();

console.log(`
🔍 Bot Execution Debugger Commands:
- BotExecutionDebugger.simulateConditionCheck() - Test your condition manually
- BotExecutionDebugger.startPeriodicCheck() - Start automated checking
- BotExecutionDebugger.stopPeriodicCheck() - Stop automated checking  
- BotExecutionDebugger.getExecutionLog() - View execution history
`);
