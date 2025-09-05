
// Volatility Analyzer for Smart Trading Display

// Global variables
let derivWs;
let tickHistory = [];
let currentSymbol = "R_10";  // Default symbol
let tickCount = 120;          // Default tick count
let decimalPlaces = 2;
let overUnderBarrier = 5;    // Default barrier value for over/under
let isInitialized = false;
let reconnectTimeout;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Initialize the analyzer
window.initVolatilityAnalyzer = function() {
    if (isInitialized) return;
    isInitialized = true;
    
    console.log("🚀 Initializing volatility analyzer");
    startWebSocket();
    
    // Setup communication with React component
    window.addEventListener('message', handleMessages);
    
    // Expose key functions to window object
    window.volatilityAnalyzer = {
        updateSymbol: updateSymbol,
        updateTickCount: updateTickCount,
        updateBarrier: updateBarrier,
        getStatus: getStatus,
        reconnect: startWebSocket
    };
    
    // Make functions available for enhancer script
    window.derivWs = derivWs;
    window.tickHistory = tickHistory;
    window.getLastDigit = getLastDigit;
    window.updateUI = updateUI;
    window.updateSymbol = updateSymbol;
    window.updateTickCount = updateTickCount;
    window.decimalPlaces = decimalPlaces;
    window.currentSymbol = currentSymbol;
};

// Function to start WebSocket
function startWebSocket() {
    console.log("🔌 Connecting to WebSocket API");
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    if (derivWs) {
        try {
            derivWs.onclose = null; // Remove onclose handler to prevent reconnection loop
            derivWs.close();
            console.log("Closed existing connection");
        } catch (e) {
            console.error("Error closing existing connection:", e);
        }
        derivWs = null;
    }

    try {
        // Use consistent app_id (70827 was in your original code)
        derivWs = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=70827');
        
        derivWs.onopen = function() {
            console.log("✅ WebSocket connection established");
            // Reset reconnect attempts on successful connection
            reconnectAttempts = 0;
            notifyConnectionStatus('connected');
            
            // Send immediate tick history request
            setTimeout(() => {
                try {
                    if (derivWs && derivWs.readyState === WebSocket.OPEN) {
                        console.log("Sending tick history request for", currentSymbol);
                        requestTickHistory();
                    }
                } catch (e) {
                    console.error("Error during init requests:", e);
                }
            }, 100); // Reduced delay
        };

        derivWs.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                
                if (data.error) {
                    console.error("❌ WebSocket API error:", data.error);
                    notifyConnectionStatus('error', data.error.message);
                    return;
                }

                if (data.history) {
                    console.log(`📊 Received history for ${currentSymbol}: ${data.history.prices.length} ticks`);
                    tickHistory = data.history.prices.map((price, index) => ({
                        time: data.history.times[index],
                        quote: parseFloat(price)
                    }));

                    detectDecimalPlaces();
                    
                    // Immediately send analysis data after receiving history
                    setTimeout(() => {
                        updateUI();
                        sendAnalysisData();
                    }, 100);
                    
                } else if (data.tick) {
                    const tickQuote = parseFloat(data.tick.quote);
                    tickHistory.push({ time: data.tick.epoch, quote: tickQuote });

                    if (tickHistory.length > tickCount) tickHistory.shift();
                    
                    // Send updates for live ticks
                    updateUI();
                    sendAnalysisData();
                    
                } else if (data.ping) {
                    // Respond to ping with pong to keep connection alive
                    derivWs.send(JSON.stringify({pong: 1}));
                }
            } catch (e) {
                console.error("Error processing message:", e);
            }
        };

        derivWs.onerror = function(error) {
            console.error("❌ WebSocket error:", error);
            notifyConnectionStatus('error', 'Connection error');
            scheduleReconnect();
        };

        derivWs.onclose = function(event) {
            console.log("🔄 WebSocket connection closed", event.code, event.reason);
            notifyConnectionStatus('disconnected');
            scheduleReconnect();
        };
        
        // Expose for analyzer enhancer
        window.derivWs = derivWs;
        
    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        notifyConnectionStatus('error', error.message);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.log(`⚠️ Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping attempts.`);
        notifyConnectionStatus('error', 'Maximum reconnection attempts reached');
        return;
    }
    
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
    console.log(`🔄 Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`);
    
    reconnectTimeout = setTimeout(() => {
        console.log(`🔄 Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        startWebSocket();
    }, delay);
}

// Function to request tick history
function requestTickHistory() {
    const request = {
        ticks_history: currentSymbol,
        count: tickCount,
        end: "latest",
        style: "ticks",
        subscribe: 1
    };
    
    if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        console.log(`📡 Requesting tick history for ${currentSymbol} (${tickCount} ticks)`);
        try {
            derivWs.send(JSON.stringify(request));
        } catch (e) {
            console.error("Error sending tick history request:", e);
            scheduleReconnect();
        }
    } else {
        console.error("❌ WebSocket not ready to request history, readyState:", derivWs ? derivWs.readyState : "undefined");
        scheduleReconnect();
    }
}

// Function to update symbol - Fix race conditions and ensure proper reconnection
function updateSymbol(newSymbol) {
    console.log(`🔄 Updating symbol: ${currentSymbol} -> ${newSymbol}`);
    
    // Only update if it's actually changed
    if (currentSymbol === newSymbol && derivWs && derivWs.readyState === WebSocket.OPEN) {
        console.log("Symbol unchanged, skipping reconnection");
        return;
    }
    
    currentSymbol = newSymbol;
    tickHistory = []; // Clear history when symbol changes
    
    // Unsubscribe from current tick first if connected
    if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        try {
            console.log("Unsubscribing from current tick before changing symbol...");
            derivWs.send(JSON.stringify({
                "forget_all": "ticks"
            }));
            
            // Short delay before requesting new history to ensure server processes unsubscribe
            setTimeout(() => requestTickHistory(), 300);
        } catch (e) {
            console.error("Error unsubscribing:", e);
            startWebSocket(); // Restart connection on error
        }
    } else {
        startWebSocket(); // Start new connection if not connected
    }
}

// Function to update tick count - Fix race conditions
function updateTickCount(newTickCount) {
    console.log(`🔄 Updating tick count: ${tickCount} -> ${newTickCount}`);
    
    // Validate input
    if (isNaN(newTickCount) || newTickCount <= 0) {
        console.error("Invalid tick count:", newTickCount);
        return;
    }
    
    tickCount = newTickCount;
    tickHistory = []; // Clear history when count changes
    
    // Unsubscribe from current tick first if connected
    if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        try {
            console.log("Unsubscribing before changing tick count...");
            derivWs.send(JSON.stringify({
                "forget_all": "ticks"
            }));
            
            // Short delay before requesting new history
            setTimeout(() => requestTickHistory(), 300);
        } catch (e) {
            console.error("Error unsubscribing:", e);
            startWebSocket(); // Restart connection on error
        }
    } else {
        startWebSocket(); // Start new connection if not connected
    }
}

// Function to update barrier value for over/under
function updateBarrier(newBarrier) {
    console.log(`🔄 Updating barrier: ${overUnderBarrier} -> ${newBarrier}`);
    overUnderBarrier = newBarrier;
    updateUI(); // Recalculate with new barrier
}

// Function to detect the number of decimal places dynamically
function detectDecimalPlaces() {
    if (tickHistory.length === 0) return;

    const decimalCounts = tickHistory.map(tick => {
        const decimalPart = tick.quote.toString().split(".")[1] || "";
        return decimalPart.length;
    });

    decimalPlaces = Math.max(...decimalCounts, 2);
}

// Function to extract the last digit
function getLastDigit(price) {
    const priceStr = price.toString();
    const priceParts = priceStr.split(".");
    let decimals = priceParts[1] || "";

    while (decimals.length < decimalPlaces) {
        decimals += "0";
    }

    return Number(decimals.slice(-1));
}

// Function to get analyzer status
function getStatus() {
    return {
        connected: derivWs && derivWs.readyState === WebSocket.OPEN,
        symbol: currentSymbol,
        tickCount: tickCount,
        dataAvailable: tickHistory.length > 0,
        lastUpdate: Date.now()
    };
}

// Function to notify connection status
function notifyConnectionStatus(status, error = null) {
    window.postMessage({
        type: 'ANALYZER_CONNECTION_STATUS',
        status: status,
        error: error
    }, '*');
}

// Function to send analysis data
function sendAnalysisData(specificStrategy = null) {
    if (!tickHistory || tickHistory.length === 0) {
        console.log("No tick history available for analysis");
        return;
    }
    
    console.log(`Sending analysis data for ${tickHistory.length} ticks`);

    // Calculate base statistics needed for all analyses
    const digitCounts = new Array(10).fill(0);
    tickHistory.forEach(tick => {
        const lastDigit = getLastDigit(tick.quote);
        digitCounts[lastDigit]++;
    });

    const totalTicks = tickHistory.length;
    const digitPercentages = digitCounts.map(count => ((count / totalTicks) * 100).toFixed(2));

    // Calculate even/odd statistics
    const evenCount = digitCounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    const oddCount = digitCounts.filter((_, i) => i % 2 !== 0).reduce((a, b) => a + b, 0);
    const evenPercentage = ((evenCount / totalTicks) * 100).toFixed(2);
    const oddPercentage = ((oddCount / totalTicks) * 100).toFixed(2);

    // Calculate over/under statistics based on barrier
    let overCount = 0, underCount = 0;
    for (let i = 0; i < 10; i++) {
        if (i >= overUnderBarrier) {
            overCount += digitCounts[i];
        } else {
            underCount += digitCounts[i];
        }
    }
    const overPercentage = ((overCount / totalTicks) * 100).toFixed(2);
    const underPercentage = ((underCount / totalTicks) * 100).toFixed(2);

    // Extract recent digits for pattern analysis
    const recent10Ticks = tickHistory.slice(-10);
    const recentDigits = recent10Ticks.map(tick => getLastDigit(tick.quote));

    // Create E/O pattern
    const eoPattern = recentDigits.map(digit => (digit % 2 === 0 ? 'E' : 'O'));

    // Create O/U pattern based on barrier
    const ouPattern = recentDigits.map(digit => {
        return digit >= overUnderBarrier ? 'O' : 'U';
    });

    // Send data for rise/fall analysis
    if (!specificStrategy || specificStrategy === 'rise-fall') {
        let riseCount = 0, fallCount = 0;
        for (let i = 1; i < tickHistory.length; i++) {
            if (tickHistory[i].quote > tickHistory[i - 1].quote) riseCount++;
            else if (tickHistory[i].quote < tickHistory[i - 1].quote) fallCount++;
        }
        const riseRatio = ((riseCount / (totalTicks - 1)) * 100).toFixed(2);
        const fallRatio = ((fallCount / (totalTicks - 1)) * 100).toFixed(2);

        window.postMessage({
            type: 'ANALYSIS_DATA',
            strategyId: 'rise-fall',
            data: {
                recommendation: parseFloat(riseRatio) > 55 ? 'Rise' : parseFloat(fallRatio) > 55 ? 'Fall' : null,
                confidence: Math.max(parseFloat(riseRatio), parseFloat(fallRatio)).toFixed(2),
                riseRatio,
                fallRatio,
                actualDigits: recentDigits,
                pattern: recentDigits.slice(-5).join(', ')
            }
        }, '*');
    }

    // Send data for even/odd analysis - percentages display
    if (!specificStrategy || specificStrategy === 'even-odd') {
        window.postMessage({
            type: 'ANALYSIS_DATA',
            strategyId: 'even-odd',
            data: {
                recommendation: parseFloat(evenPercentage) > 55 ? 'Even' : parseFloat(oddPercentage) > 55 ? 'Odd' : null,
                confidence: Math.max(parseFloat(evenPercentage), parseFloat(oddPercentage)).toFixed(2),
                evenProbability: evenPercentage,
                oddProbability: oddPercentage,
                actualDigits: recentDigits,
                evenOddPattern: eoPattern,
                pattern: eoPattern.slice(-5).join('')
            }
        }, '*');
    }

    // Send data for even/odd analysis - E/O pattern display
    if (!specificStrategy || specificStrategy === 'even-odd-2') {
        let currentStreak = 1;
        let streakType = recentDigits.length > 0 && recentDigits[recentDigits.length - 1] % 2 === 0 ? 'even' : 'odd';

        // Count streak backwards from the end
        for (let i = recentDigits.length - 2; i >= 0; i--) {
            const isEven = recentDigits[i] % 2 === 0;
            const prevIsEven = recentDigits[i + 1] % 2 === 0;

            if (isEven === prevIsEven) {
                currentStreak++;
            } else {
                break;
            }
        }

        window.postMessage({
            type: 'ANALYSIS_DATA',
            strategyId: 'even-odd-2',
            data: {
                evenProbability: evenPercentage,
                oddProbability: oddPercentage,
                actualDigits: recentDigits,
                evenOddPattern: eoPattern,
                streak: currentStreak,
                streakType,
                pattern: eoPattern.slice(-5).join('')
            }
        }, '*');
    }

    // Send data for over/under analysis - percentages display
    if (!specificStrategy || specificStrategy === 'over-under') {
        window.postMessage({
            type: 'ANALYSIS_DATA',
            strategyId: 'over-under',
            data: {
                recommendation: parseFloat(overPercentage) > 55 ? 'Over' : parseFloat(underPercentage) > 55 ? 'Under' : null,
                confidence: Math.max(parseFloat(overPercentage), parseFloat(underPercentage)),
                overProbability: overPercentage,
                underProbability: underPercentage,
                barrier: overUnderBarrier,
                actualDigits: recentDigits,
                pattern: recentDigits.slice(-5).join(', ')
            }
        }, '*');
    }

    // Send data for over/under analysis - O/U pattern display
    if (!specificStrategy || specificStrategy === 'over-under-2') {
        window.postMessage({
            type: 'ANALYSIS_DATA',
            strategyId: 'over-under-2',
            data: {
                overProbability: overPercentage,
                underProbability: underPercentage,
                actualDigits: recentDigits,
                overUnderPattern: ouPattern,
                barrier: overUnderBarrier,
                pattern: ouPattern.slice(-5).join('')
            }
        }, '*');
    }

    // Send data for matches/differs analysis
    if (!specificStrategy || specificStrategy === 'matches-differs') {
        const targetDigit = 5; // Default target digit
        const matchCount = digitCounts[targetDigit];
        const differCount = totalTicks - matchCount;
        const matchPercentage = ((matchCount / totalTicks) * 100).toFixed(2);
        const differPercentage = ((differCount / totalTicks) * 100).toFixed(2);

        window.postMessage({
            type: 'ANALYSIS_DATA',
            strategyId: 'matches-differs',
            data: {
                recommendation: parseFloat(matchPercentage) > 55 ? 'Matches' : parseFloat(differPercentage) > 55 ? 'Differs' : null,
                confidence: Math.max(parseFloat(matchPercentage), parseFloat(differPercentage)),
                matchProbability: matchPercentage,
                differProbability: differPercentage,
                targetDigit: targetDigit,
                actualDigits: recentDigits,
                pattern: recentDigits.slice(-5).join(', ')
            }
        }, '*');
    }
}

// Function to update the UI and send analysis data
function updateUI() {
    if (tickHistory.length === 0) {
        console.warn("⚠️ No tick history available for analysis");
        return;
    }
    
    // Send current price
    const currentPrice = tickHistory[tickHistory.length - 1].quote.toFixed(decimalPlaces);
    window.postMessage({
        type: 'PRICE_UPDATE',
        price: currentPrice,
        symbol: currentSymbol
    }, '*');
    
    // Calculate and send analysis data
    sendAnalysisData();
}

// Function to handle messages from React component
function handleMessages(event) {
    if (!event.data || typeof event.data !== 'object') return;
    
    const { type } = event.data;
    
    switch (type) {
        case 'UPDATE_SYMBOL':
            if (event.data.symbol) {
                console.log("Received symbol update request:", event.data.symbol);
                updateSymbol(event.data.symbol);
            }
            break;
            
        case 'UPDATE_TICK_COUNT':
            const newCount = event.data.tickCount || event.data.count;
            if (newCount && !isNaN(newCount)) {
                console.log("Received tick count update request:", newCount);
                updateTickCount(parseInt(newCount, 10));
            }
            break;
            
        case 'UPDATE_BARRIER':
            if (event.data.barrier && !isNaN(event.data.barrier)) {
                updateBarrier(parseInt(event.data.barrier, 10));
            }
            break;
            
        case 'REQUEST_ANALYSIS':
            sendAnalysisData(event.data.strategyId);
            break;

        case 'REQUEST_STATUS':
            window.postMessage({
                type: 'ANALYZER_STATUS',
                status: getStatus()
            }, '*');
            break;
    }
}
/**
 * Volatility Analyzer - AI-powered market volatility analysis
 */
class VolatilityAnalyzer {
    constructor() {
        this.symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
        this.tickData = {};
        this.volatilityScores = {};
        this.analysisInterval = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        
        console.log('Starting volatility analysis...');
        this.isRunning = true;
        
        // Initialize data structures
        this.symbols.forEach(symbol => {
            this.tickData[symbol] = [];
            this.volatilityScores[symbol] = 0;
        });
        
        // Start analysis loop
        this.analysisInterval = setInterval(() => {
            this.analyzeVolatility();
        }, 2000);
    }
    
    stop() {
        if (!this.isRunning) return;
        
        console.log('Stopping volatility analysis...');
        this.isRunning = false;
        
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
    }
    
    addTick(symbol, tick) {
        if (!this.tickData[symbol]) {
            this.tickData[symbol] = [];
        }
        
        this.tickData[symbol].push(tick);
        
        // Keep only last 100 ticks
        if (this.tickData[symbol].length > 100) {
            this.tickData[symbol].shift();
        }
    }
    
    analyzeVolatility() {
        this.symbols.forEach(symbol => {
            const ticks = this.tickData[symbol];
            if (ticks && ticks.length >= 10) {
                const score = this.calculateVolatilityScore(ticks);
                this.volatilityScores[symbol] = score;
            }
        });
        
        // Emit analysis update
        if (window.volatilityAnalysisCallback) {
            window.volatilityAnalysisCallback(this.volatilityScores);
        }
    }
    
    calculateVolatilityScore(ticks) {
        if (ticks.length < 2) return 0;
        
        let totalVariance = 0;
        let priceChanges = [];
        
        // Calculate price changes
        for (let i = 1; i < ticks.length; i++) {
            const change = Math.abs(ticks[i].quote - ticks[i-1].quote);
            priceChanges.push(change);
            totalVariance += change;
        }
        
        // Calculate average change
        const avgChange = totalVariance / priceChanges.length;
        
        // Calculate standard deviation
        let sumSquares = 0;
        priceChanges.forEach(change => {
            sumSquares += Math.pow(change - avgChange, 2);
        });
        
        const stdDev = Math.sqrt(sumSquares / priceChanges.length);
        
        // Normalize to 0-100 scale
        const volatilityScore = Math.min(100, (stdDev * 10000));
        
        return volatilityScore;
    }
    
    getVolatilityRecommendation() {
        let bestSymbol = '';
        let bestScore = 0;
        
        Object.keys(this.volatilityScores).forEach(symbol => {
            const score = this.volatilityScores[symbol];
            if (score > bestScore) {
                bestScore = score;
                bestSymbol = symbol;
            }
        });
        
        return {
            symbol: bestSymbol,
            score: bestScore,
            recommendation: bestScore > 50 ? 'HIGH_VOLATILITY' : bestScore > 25 ? 'MEDIUM_VOLATILITY' : 'LOW_VOLATILITY'
        };
    }
    
    getSymbolVolatility(symbol) {
        return this.volatilityScores[symbol] || 0;
    }
}

// Global instance
window.VolatilityAnalyzer = VolatilityAnalyzer;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolatilityAnalyzer;
}
