let derivWs;
let tickHistory = [];
let currentSymbol = "R_100";  // Default symbol
let tickCount = 120;          // Default tick count
let decimalPlaces = 2;

let digitChart, evenOddChart, riseFallChart;

// Function to start WebSocket
function startWebSocket() {
    if (derivWs) {
        derivWs.close();
    }

    derivWs = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');

    derivWs.onopen = function () {
        requestTickHistory();
    };

    derivWs.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.history) {
            tickHistory = data.history.prices.map((price, index) => ({
                time: data.history.times[index],
                quote: parseFloat(price)
            }));

            detectDecimalPlaces();
            updateUI();
        } else if (data.tick) {
            let tickQuote = parseFloat(data.tick.quote);
            tickHistory.push({ time: data.tick.epoch, quote: tickQuote });

            if (tickHistory.length > tickCount) tickHistory.shift();

            updateUI();
        }
    };
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
    derivWs.send(JSON.stringify(request));
}

// Function to update symbol
function updateSymbol(newSymbol) {
    currentSymbol = newSymbol;
    tickHistory = [];
    startWebSocket();
}

// Function to update tick count
function updateTickCount(newTickCount) {
    tickCount = newTickCount;
    tickHistory = [];
    startWebSocket();
}

// Add event listeners for symbol and tick count inputs
document.getElementById("symbol-select").addEventListener("change", function (event) {
    updateSymbol(event.target.value);
});

document.getElementById("tick-count-input").addEventListener("change", function (event) {
    const newTickCount = parseInt(event.target.value, 10);
    if (newTickCount > 0) {
        updateTickCount(newTickCount);
    } else {
        console.warn("⚠️ Tick count must be greater than 0.");
    }
});

// Function to detect the number of decimal places dynamically
function detectDecimalPlaces() {
    if (tickHistory.length === 0) return;

    let decimalCounts = tickHistory.map(tick => {
        let decimalPart = tick.quote.toString().split(".")[1] || "";
        return decimalPart.length;
    });

    decimalPlaces = Math.max(...decimalCounts, 2);
}

// Function to extract the last digit
function getLastDigit(price) {
    let priceStr = price.toString();
    let priceParts = priceStr.split(".");
    let decimals = priceParts[1] || "";

    while (decimals.length < decimalPlaces) {
        decimals += "0";
    }

    return Number(decimals.slice(-1));
}

// Function to update the UI
function updateUI() {
    const currentPriceElement = document.getElementById("current-price");
    if (tickHistory.length > 0) {
        const currentPrice = tickHistory[tickHistory.length - 1].quote.toFixed(decimalPlaces);
        currentPriceElement.textContent = `${currentPrice}`;
    } else {
        currentPriceElement.textContent = "N/A";
    }
    updateDigitDisplay();
    updateCharts();
    updateLast50OE();
}

// Function to update the digit display
function updateDigitDisplay() {
    const digitCounts = new Array(10).fill(0);
    tickHistory.forEach(tick => {
        const lastDigit = getLastDigit(tick.quote);
        digitCounts[lastDigit]++;
    });

    const digitPercentages = digitCounts.map(count => (count / tickHistory.length) * 100);
    const maxPercentage = Math.max(...digitPercentages);
    const minPercentage = Math.min(...digitPercentages);

    const currentDigit = tickHistory.length > 0 ? getLastDigit(tickHistory[tickHistory.length - 1].quote) : null;

    const digitDisplayContainer = document.getElementById("digit-display-container");
    digitDisplayContainer.innerHTML = ""; // Clear existing content

    digitPercentages.forEach((percentage, digit) => {
        const digitContainer = document.createElement("div");
        digitContainer.classList.add("digit-container");

        // Add the yellow arrow and apply the current class for the current digit
        if (digit === currentDigit) {
            digitContainer.classList.add("current");
            const arrow = document.createElement("div");
            arrow.classList.add("arrow");
            digitContainer.appendChild(arrow);
        }

        const digitBox = document.createElement("div");
        digitBox.classList.add("digit-box");

        // Apply the highest and lowest styles to only one digit each
        if (percentage === maxPercentage && digitPercentages.indexOf(maxPercentage) === digit) {
            digitBox.classList.add("highest");
        } else if (percentage === minPercentage && digitPercentages.indexOf(minPercentage) === digit) {
            digitBox.classList.add("lowest");
        }

        digitBox.textContent = digit;

        const percentageText = document.createElement("div");
        percentageText.classList.add("digit-percentage");
        percentageText.textContent = `${percentage.toFixed(2)}`;

        digitContainer.appendChild(digitBox);
        digitContainer.appendChild(percentageText);
        digitDisplayContainer.appendChild(digitContainer);
    });
}

// Function to initialize charts
function initializeCharts() {
    const ctxDigit = document.getElementById('digit-chart').getContext('2d');
    digitChart = new Chart(ctxDigit, {
        type: 'bar',
        data: {
            labels: Array.from({ length: 10 }, (_, i) => i.toString()),
            datasets: [{
                label: 'Digit Distribution (%)',
                data: Array(10).fill(0),
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: Array(10).fill('rgba(54, 162, 235, 1)'),
                borderWidth: 2,
                borderRadius: 10,
                barPercentage: 0.80, // Bars span full width
                categoryPercentage: 0.8 // No spacing between bars
            }]
        },
        options: {
            indexAxis: 'x', // Vertical bars
            plugins: {
                legend: { display: false }, // Hide legend
                tooltip: { enabled: true } // Enable tooltips
            },
            scales: {
                x: { display: true }, // Show x-axis
                y: { display: true }  // Show y-axis
            }
        }
    });

    const ctxEvenOdd = document.getElementById('even-odd-chart').getContext('2d');
    evenOddChart = new Chart(ctxEvenOdd, {
        type: 'bar',
        data: {
            labels: ['Even', 'Odd'],
            datasets: [{
                label: 'Even/Odd Distribution',
                data: [0, 0],
                backgroundColor: ['#8BEDA6', '#FF7F7F'],
                borderColor: ['#8BEDA6', '#FF7F7F'],
                borderWidth: 1,
                barPercentage: 0.9, // Bars span full width
                categoryPercentage: 0.9 // No spacing between bars
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bars
            plugins: {
                legend: { display: false }, // Hide legend
                tooltip: { enabled: true } // Enable tooltips
            },
            scales: {
                x: { display: false }, // Hide x-axis
                y: { display: false }  // Hide y-axis
            }
        }
    });

    const ctxRiseFall = document.getElementById('rise-fall-chart').getContext('2d');
    riseFallChart = new Chart(ctxRiseFall, {
        type: 'bar',
        data: {
            labels: ['Rise', 'Fall'],
            datasets: [{
                label: 'Rise/Fall Distribution',
                data: [0, 0],
                backgroundColor: ['#8BEDA6', '#FF7F7F'],
                borderColor: ['#8BEDA6', '#FF7F7F'],
                borderWidth: 1,
                barPercentage: 0.9, // Bars span full width
                categoryPercentage: 0.9 // No spacing between bars
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bars
            plugins: {
                legend: { display: false }, // Hide legend
                tooltip: { enabled: true } // Enable tooltips
            },
            scales: {
                x: { display: false }, // Hide x-axis
                y: { display: false }  // Hide y-axis
            }
        }
    });
}

// Function to update charts
function updateCharts() {
    const digitCounts = new Array(10).fill(0);
    tickHistory.forEach(tick => {
        const lastDigit = getLastDigit(tick.quote);
        digitCounts[lastDigit]++;
    });
    const digitPercentages = digitCounts.map(count => (count / tickHistory.length) * 100);

    // Update digit chart
    digitChart.data.datasets[0].data = digitPercentages;
    digitChart.update();

    // Display highest and lowest percentages
    const maxPercentage = Math.max(...digitPercentages).toFixed(2);
    const minPercentage = Math.min(...digitPercentages).toFixed(2);
    document.getElementById("digit-percentage").textContent = `Highest: ${maxPercentage}%, Lowest: ${minPercentage}%`;

    // Update even/odd chart
    const evenCount = digitCounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    const oddCount = digitCounts.filter((_, i) => i % 2 !== 0).reduce((a, b) => a + b, 0);
    const evenPercentage = ((evenCount / tickHistory.length) * 100).toFixed(2);
    const oddPercentage = ((oddCount / tickHistory.length) * 100).toFixed(2);

    evenOddChart.data.datasets[0].data = [evenPercentage, oddPercentage];
    evenOddChart.update();

    // Display even and odd percentages
    document.getElementById("even-odd-percentage").textContent = `Even: ${evenPercentage}%, Odd: ${oddPercentage}%`;

    // Update rise/fall chart
    let riseCount = 0, fallCount = 0;
    for (let i = 1; i < tickHistory.length; i++) {
        if (tickHistory[i].quote > tickHistory[i - 1].quote) riseCount++;
        else if (tickHistory[i].quote < tickHistory[i - 1].quote) fallCount++;
    }
    const risePercentage = ((riseCount / (tickHistory.length - 1)) * 100).toFixed(2);
    const fallPercentage = ((fallCount / (tickHistory.length - 1)) * 100).toFixed(2);

    riseFallChart.data.datasets[0].data = [risePercentage, fallPercentage];
    riseFallChart.update();

    // Display rise and fall percentages
    document.getElementById("rise-fall-percentage").textContent = `Rise: ${risePercentage}%, Fall: ${fallPercentage}%`;
}

// Function to update the last 50 digits as "E" (Even) or "O" (Odd)
function updateLast50OE() {
    const last50Digits = tickHistory.slice(-50).map(tick => getLastDigit(tick.quote));
    const oeValues = last50Digits.map(digit => ({
        value: digit % 2 === 0 ? "E" : "O",
        class: digit % 2 === 0 ? "even" : "odd"
    }));

    const last50OEContainer = document.getElementById("last-50-oe-container");
    last50OEContainer.innerHTML = ""; // Clear existing content

    oeValues.forEach(({ value, class: oeClass }) => {
        const oeBox = document.createElement("div");
        oeBox.classList.add("oe-box", oeClass);
        oeBox.textContent = value;
        last50OEContainer.appendChild(oeBox);
    });
}

// Start WebSocket on page load
startWebSocket();
initializeCharts();
/**
 * Core AI Analysis Engine
 */
class AIAnalysisEngine {
    constructor() {
        this.models = {
            patternRecognition: new PatternRecognitionModel(),
            volatilityPrediction: new VolatilityPredictionModel(),
            digitAnalysis: new DigitAnalysisModel()
        };
        this.config = {
            minSampleSize: 30,
            confidenceThreshold: 0.6,
            analysisInterval: 2000
        };
        this.isRunning = false;
    }
    
    async initialize() {
        console.log('Initializing AI Analysis Engine...');
        
        // Initialize all models
        await Promise.all([
            this.models.patternRecognition.initialize(),
            this.models.volatilityPrediction.initialize(),
            this.models.digitAnalysis.initialize()
        ]);
        
        console.log('AI Analysis Engine initialized successfully');
        return true;
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log('AI Analysis Engine started');
        
        // Start analysis loop
        this.analysisLoop();
    }
    
    stop() {
        this.isRunning = false;
        console.log('AI Analysis Engine stopped');
    }
    
    async analysisLoop() {
        while (this.isRunning) {
            try {
                await this.runFullAnalysis();
            } catch (error) {
                console.error('Analysis error:', error);
            }
            
            // Wait before next analysis
            await new Promise(resolve => setTimeout(resolve, this.config.analysisInterval));
        }
    }
    
    async runFullAnalysis() {
        const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
        const results = {};
        
        for (const symbol of symbols) {
            const data = this.getMarketData(symbol);
            if (data && data.length >= this.config.minSampleSize) {
                results[symbol] = await this.analyzeSymbol(symbol, data);
            }
        }
        
        // Emit results
        if (window.aiAnalysisCallback) {
            window.aiAnalysisCallback(results);
        }
        
        return results;
    }
    
    async analyzeSymbol(symbol, data) {
        const [patternResult, volatilityResult, digitResult] = await Promise.all([
            this.models.patternRecognition.analyze(data),
            this.models.volatilityPrediction.predict(data),
            this.models.digitAnalysis.analyze(data)
        ]);
        
        return {
            symbol,
            timestamp: Date.now(),
            patterns: patternResult,
            volatility: volatilityResult,
            digits: digitResult,
            recommendation: this.generateRecommendation(patternResult, volatilityResult, digitResult)
        };
    }
    
    generateRecommendation(patterns, volatility, digits) {
        const signals = [];
        let totalConfidence = 0;
        let signalCount = 0;
        
        // Pattern-based signals
        if (patterns.confidence > this.config.confidenceThreshold) {
            signals.push({
                type: patterns.predictedDirection,
                reason: patterns.description,
                confidence: patterns.confidence,
                source: 'pattern'
            });
            totalConfidence += patterns.confidence;
            signalCount++;
        }
        
        // Volatility-based signals
        if (volatility.confidence > this.config.confidenceThreshold) {
            signals.push({
                type: volatility.trend,
                reason: volatility.description,
                confidence: volatility.confidence,
                source: 'volatility'
            });
            totalConfidence += volatility.confidence;
            signalCount++;
        }
        
        // Digit-based signals
        if (digits.confidence > this.config.confidenceThreshold) {
            signals.push({
                type: digits.recommendation,
                reason: digits.description,
                confidence: digits.confidence,
                source: 'digits'
            });
            totalConfidence += digits.confidence;
            signalCount++;
        }
        
        if (signalCount === 0) {
            return {
                action: 'HOLD',
                confidence: 0,
                reason: 'No strong signals detected',
                signals: []
            };
        }
        
        const avgConfidence = totalConfidence / signalCount;
        const dominantSignal = signals.reduce((max, signal) => 
            signal.confidence > max.confidence ? signal : max
        );
        
        return {
            action: dominantSignal.type,
            confidence: avgConfidence,
            reason: dominantSignal.reason,
            signals: signals
        };
    }
    
    getMarketData(symbol) {
        // This would connect to your market data source
        // For now, return mock data
        return window.marketData && window.marketData[symbol] || [];
    }
}

// Pattern Recognition Model
class PatternRecognitionModel {
    constructor() {
        this.patterns = {
            ascending: [],
            descending: [],
            sideways: [],
            reversal: []
        };
    }
    
    async initialize() {
        // Initialize pattern templates
        console.log('Pattern Recognition Model initialized');
        return true;
    }
    
    async analyze(data) {
        if (data.length < 10) {
            return { confidence: 0, predictedDirection: 'HOLD', description: 'Insufficient data' };
        }
        
        const recentData = data.slice(-10);
        const trend = this.detectTrend(recentData);
        const patterns = this.detectPatterns(recentData);
        
        return {
            confidence: Math.max(trend.confidence, patterns.confidence),
            predictedDirection: trend.confidence > patterns.confidence ? trend.direction : patterns.direction,
            description: trend.confidence > patterns.confidence ? trend.description : patterns.description,
            details: { trend, patterns }
        };
    }
    
    detectTrend(data) {
        const prices = data.map(d => d.quote || d.price || d);
        let upMoves = 0;
        let downMoves = 0;
        
        for (let i = 1; i < prices.length; i++) {
            if (prices[i] > prices[i-1]) upMoves++;
            else if (prices[i] < prices[i-1]) downMoves++;
        }
        
        const totalMoves = upMoves + downMoves;
        if (totalMoves === 0) {
            return { confidence: 0, direction: 'HOLD', description: 'No price movement' };
        }
        
        const upRatio = upMoves / totalMoves;
        
        if (upRatio >= 0.7) {
            return { 
                confidence: upRatio, 
                direction: 'UP', 
                description: `Strong uptrend detected (${Math.round(upRatio * 100)}% up moves)` 
            };
        } else if (upRatio <= 0.3) {
            return { 
                confidence: 1 - upRatio, 
                direction: 'DOWN', 
                description: `Strong downtrend detected (${Math.round((1-upRatio) * 100)}% down moves)` 
            };
        }
        
        return { confidence: 0.3, direction: 'SIDEWAYS', description: 'Sideways movement detected' };
    }
    
    detectPatterns(data) {
        // Simplified pattern detection
        const prices = data.map(d => d.quote || d.price || d);
        const highs = [];
        const lows = [];
        
        // Find local highs and lows
        for (let i = 1; i < prices.length - 1; i++) {
            if (prices[i] > prices[i-1] && prices[i] > prices[i+1]) {
                highs.push({ index: i, price: prices[i] });
            }
            if (prices[i] < prices[i-1] && prices[i] < prices[i+1]) {
                lows.push({ index: i, price: prices[i] });
            }
        }
        
        if (highs.length >= 2 && lows.length >= 2) {
            return {
                confidence: 0.6,
                direction: 'REVERSAL',
                description: 'Double top/bottom pattern detected'
            };
        }
        
        return { confidence: 0.2, direction: 'HOLD', description: 'No clear pattern' };
    }
}

// Volatility Prediction Model
class VolatilityPredictionModel {
    async initialize() {
        console.log('Volatility Prediction Model initialized');
        return true;
    }
    
    async predict(data) {
        if (data.length < 20) {
            return { confidence: 0, trend: 'UNKNOWN', description: 'Insufficient data for volatility analysis' };
        }
        
        const prices = data.map(d => d.quote || d.price || d);
        const volatility = this.calculateVolatility(prices);
        const trend = this.predictVolatilityTrend(prices);
        
        return {
            confidence: 0.7,
            trend: trend > 0 ? 'INCREASING' : trend < 0 ? 'DECREASING' : 'STABLE',
            volatilityScore: volatility,
            description: `Volatility ${trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable'} (score: ${volatility.toFixed(2)})`
        };
    }
    
    calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        
        const mean = returns.reduce((a, b) => a + b) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized volatility
    }
    
    predictVolatilityTrend(prices) {
        const windowSize = 5;
        const recent = prices.slice(-windowSize);
        const earlier = prices.slice(-windowSize * 2, -windowSize);
        
        const recentVol = this.calculateVolatility(recent);
        const earlierVol = this.calculateVolatility(earlier);
        
        return recentVol - earlierVol;
    }
}

// Digit Analysis Model
class DigitAnalysisModel {
    async initialize() {
        console.log('Digit Analysis Model initialized');
        return true;
    }
    
    async analyze(data) {
        if (data.length < 10) {
            return { confidence: 0, recommendation: 'HOLD', description: 'Insufficient data' };
        }
        
        const digits = data.map(d => d.last_digit || this.getLastDigit(d.quote || d.price || d));
        const analysis = this.analyzeDigitPatterns(digits);
        
        return {
            confidence: analysis.confidence,
            recommendation: analysis.recommendation,
            description: analysis.description,
            details: analysis
        };
    }
    
    getLastDigit(price) {
        const str = price.toString();
        const parts = str.split('.');
        const decimal = parts[1] || '0';
        return parseInt(decimal.charAt(decimal.length - 1));
    }
    
    analyzeDigitPatterns(digits) {
        const recent = digits.slice(-10);
        const evenCount = recent.filter(d => d % 2 === 0).length;
        const oddCount = recent.length - evenCount;
        
        const evenRatio = evenCount / recent.length;
        
        if (evenRatio >= 0.8) {
            return {
                confidence: 0.8,
                recommendation: 'ODD',
                description: 'Strong even digit dominance, expect odd reversal'
            };
        } else if (evenRatio <= 0.2) {
            return {
                confidence: 0.8,
                recommendation: 'EVEN',
                description: 'Strong odd digit dominance, expect even reversal'
            };
        } else if (evenRatio >= 0.7) {
            return {
                confidence: 0.6,
                recommendation: 'ODD',
                description: 'Even digit trend, moderate odd reversal expected'
            };
        } else if (evenRatio <= 0.3) {
            return {
                confidence: 0.6,
                recommendation: 'EVEN',
                description: 'Odd digit trend, moderate even reversal expected'
            };
        }
        
        return {
            confidence: 0.3,
            recommendation: 'HOLD',
            description: 'Balanced digit distribution'
        };
    }
}

// Global instance
window.AIAnalysisEngine = AIAnalysisEngine;

// Initialize and start
const aiEngine = new AIAnalysisEngine();
window.aiEngine = aiEngine;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIAnalysisEngine;
}
