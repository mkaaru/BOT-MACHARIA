// Over/Under Percentage Block Debugging Tool
// Run this in browser console while bot is running

class OverUnderBlockDebugger {
    constructor() {
        this.testResults = [];
        console.log('🎯 Over/Under Percentage Block Debugger Initialized');
    }

    // Check if the method is available
    checkMethodAvailability() {
        console.log('🔍 Checking method availability...');
        
        if (window.Bot && window.Bot.getOverUnderPercentage) {
            console.log('✅ Bot.getOverUnderPercentage method is available');
            
            // Test method signature
            try {
                const testResult = window.Bot.getOverUnderPercentage('over', 5, 10);
                if (testResult && typeof testResult.then === 'function') {
                    console.log('✅ Method returns a Promise');
                    testResult.then(result => {
                        console.log(`✅ Test call successful: ${result}%`);
                    }).catch(error => {
                        console.log(`❌ Test call failed: ${error.message}`);
                    });
                } else {
                    console.log('⚠️ Method does not return a Promise');
                }
            } catch (error) {
                console.error('❌ Error testing getOverUnderPercentage:', error);
            }
        } else {
            console.log('❌ Bot.getOverUnderPercentage method not available');
            console.log('Available Bot methods:', Object.keys(window.Bot || {}));
        }
    }

    // Generate test data
    generateTestData(count = 20) {
        console.log(`📊 Generating ${count} test ticks...`);
        const digits = [];
        for (let i = 0; i < count; i++) {
            digits.push(Math.floor(Math.random() * 10));
        }
        console.log('Generated digits:', digits);
        return digits;
    }

    // Simulate condition checking
    simulateConditionCheck() {
        console.log('🧪 Simulating condition check...');
        
        if (window.Bot && window.Bot.getOverUnderPercentage) {
            return window.Bot.getOverUnderPercentage('over', 5, 10).then(percentage => {
                console.log(`📈 Current over 5 percentage: ${percentage}%`);
                
                // Simulate trading decision
                const threshold = 60; // 60% threshold
                const signal = percentage > threshold ? 'TRADE' : 'WAIT';
                console.log(`🎯 Trading signal: ${signal} (threshold: ${threshold}%)`);
                
                return { percentage, signal, threshold };
            }).catch(error => {
                console.error('❌ Error in condition check:', error);
                return null;
            });
        } else {
            console.log('❌ Cannot simulate - Bot.getOverUnderPercentage not available');
            return Promise.resolve(null);
        }
    }

    // Run comprehensive tests
    async runTests() {
        console.log('🚀 Starting comprehensive over/under tests...');
        
        const testCases = [
            { condition: 'over', digit: 5, count: 10, description: 'Basic over 5 test' },
            { condition: 'under', digit: 5, count: 10, description: 'Basic under 5 test' },
            { condition: 'over', digit: 7, count: 15, description: 'High digits (8,9) in 15 ticks' },
            { condition: 'under', digit: 3, count: 20, description: 'Low digits (0,1,2) in 20 ticks' },
            { condition: 'over', digit: 0, count: 5, description: 'All digits (1-9) in 5 ticks' },
            { condition: 'under', digit: 9, count: 5, description: 'Almost no digits (0-8) in 5 ticks' }
        ];

        for (let i = 0; i < testCases.length; i++) {
            const { condition, digit, count, description } = testCases[i];
            console.log(`\nTest ${i + 1}/6: ${description}`);
            console.log(`Parameters: ${condition} ${digit}, count: ${count}`);
            
            try {
                if (window.Bot && window.Bot.getOverUnderPercentage) {
                    const result = await window.Bot.getOverUnderPercentage(condition, digit, count);
                    console.log(`✅ Result: ${result.toFixed(2)}%`);
                    this.testResults.push({ 
                        test: description, 
                        parameters: { condition, digit, count },
                        result: result,
                        status: 'success' 
                    });
                } else {
                    // Use mock calculation
                    const mockResult = this.calculateMockPercentage(condition, digit, count);
                    console.log(`📝 Mock result: ${mockResult.toFixed(2)}%`);
                    this.testResults.push({ 
                        test: description, 
                        parameters: { condition, digit, count },
                        result: mockResult,
                        status: 'mock' 
                    });
                }
            } catch (error) {
                console.error(`❌ Test failed: ${error.message}`);
                this.testResults.push({ 
                    test: description, 
                    parameters: { condition, digit, count },
                    error: error.message,
                    status: 'error' 
                });
            }
            
            // Small delay between tests
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log('\n📊 Test Summary:');
        console.table(this.testResults);
    }

    // Mock calculation for testing
    calculateMockPercentage(condition, digit, count) {
        const digits = this.generateTestData(count);
        let matches = 0;
        
        digits.forEach(d => {
            if (condition === 'over' && d > digit) matches++;
            if (condition === 'under' && d < digit) matches++;
        });
        
        return (matches / digits.length) * 100;
    }

    // Monitor live data
    startMonitoring(interval = 5000) {
        console.log(`📡 Starting live monitoring (${interval}ms intervals)...`);
        
        this.monitoringInterval = setInterval(() => {
            if (window.Bot && window.Bot.getOverUnderPercentage) {
                Promise.all([
                    window.Bot.getOverUnderPercentage('over', 5, 10),
                    window.Bot.getOverUnderPercentage('under', 5, 10)
                ]).then(([overResult, underResult]) => {
                    console.log(`📊 Live Data - Over 5: ${overResult.toFixed(1)}%, Under 5: ${underResult.toFixed(1)}%`);
                }).catch(error => {
                    console.error('❌ Monitoring error:', error);
                });
            }
        }, interval);
        
        console.log('✅ Monitoring started. Call stopMonitoring() to stop.');
    }

    // Stop monitoring
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            console.log('⏹️ Monitoring stopped');
        }
    }

    // Get current block state
    getCurrentState() {
        console.log('📋 Current Block State:');
        console.log('- Method Available:', !!(window.Bot && window.Bot.getOverUnderPercentage));
        console.log('- Bot Object:', !!window.Bot);
        console.log('- Available Methods:', Object.keys(window.Bot || {}));
        
        if (window.Bot && window.Bot.getOverUnderPercentage) {
            console.log('🔗 Testing live connection...');
            return window.Bot.getOverUnderPercentage('over', 5, 5).then(result => {
                console.log(`✅ Live test successful: ${result}%`);
                return result;
            });
        }
        
        return Promise.resolve(null);
    }
}

// Auto-initialize debugger
const overUnderDebugger = new OverUnderBlockDebugger();

// Convenience functions
window.checkOverUnder = () => overUnderDebugger.checkMethodAvailability();
window.testOverUnder = () => overUnderDebugger.runTests();
window.monitorOverUnder = (interval) => overUnderDebugger.startMonitoring(interval);
window.stopOverUnderMonitor = () => overUnderDebugger.stopMonitoring();
window.overUnderState = () => overUnderDebugger.getCurrentState();

console.log('🎯 Over/Under Block Debug Functions Available:');
console.log('- checkOverUnder() - Check method availability');
console.log('- testOverUnder() - Run comprehensive tests');
console.log('- monitorOverUnder(interval) - Start live monitoring');
console.log('- stopOverUnderMonitor() - Stop monitoring');
console.log('- overUnderState() - Get current state');

// Auto-run initial check
overUnderDebugger.checkMethodAvailability();
