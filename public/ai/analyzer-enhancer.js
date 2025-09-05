
/**
 * Analyzer Enhancer for Smart Trading Display
 * Extends the functionality of volatility-analyzer.js to provide data for:
 * - Even/Odd percentages and E/O pattern display
 * - Over/Under percentages with configurable barrier and O/U pattern display
 */

// Default barrier value for over/under analysis
let overUnderBarrier = 5;
let selectedSymbol = 'R_10';
let requestedTickCount = 120;
let enhancerConnected = false;

// Wait for the volatility analyzer to be loaded
(function () {
    let attemptCount = 0;
    const maxAttempts = 20; // Try for about 10 seconds

    console.log('🔍 Analyzer enhancer starting, looking for volatility analyzer...');

    const checkInterval = setInterval(() => {
        attemptCount++;

        // Check for both the new volatility analyzer and the older implementation
        if (window.volatilityAnalyzer) {
            console.log('✅ Analyzer enhancer connected to volatility-analyzer.js');
            clearInterval(checkInterval);
            enhancerConnected = true;
            initEnhancer();
            return;
        }

        // Check if we have access to functions from the older implementation
        if (window.getLastDigit && window.tickHistory) {
            console.log('✅ Analyzer enhancer connected to existing analyzer');
            clearInterval(checkInterval);
            enhancerConnected = true;
            initEnhancer();
            return;
        }

        // Give up after max attempts
        if (attemptCount >= maxAttempts) {
            console.error('❌ Analyzer enhancer could not connect - volatility analyzer not found');
            clearInterval(checkInterval);
        }
    }, 500);

    function initEnhancer() {
        console.log('🔧 Initializing analyzer enhancer');
        
        // Listen for messages from the React app
        window.addEventListener('message', function (event) {
            if (!event.data || typeof event.data !== 'object') return;

            const { type } = event.data;

            switch (type) {
                // Handle barrier update for over/under
                case 'UPDATE_BARRIER':
                    overUnderBarrier = parseInt(event.data.barrier, 10);
                    console.log(`Barrier value updated to: ${overUnderBarrier}`);
                    sendAnalysisData();
                    break;

                // Handle symbol update - Forward to main analyzer if possible
                case 'UPDATE_SYMBOL':
                    selectedSymbol = event.data.symbol;
                    console.log(`Enhancer received symbol update: ${selectedSymbol}`);

                    // Try both direct window function and volatilityAnalyzer object
                    try {
                        if (window.volatilityAnalyzer && typeof window.volatilityAnalyzer.updateSymbol === 'function') {
                            window.volatilityAnalyzer.updateSymbol(selectedSymbol);
                        } else if (typeof window.updateSymbol === 'function') {
                            window.updateSymbol(selectedSymbol);
                        } else {
                            console.error('No updateSymbol function found on window or volatilityAnalyzer');
                        }
                    } catch (e) {
                        console.error('Error updating symbol:', e);
                    }
                    break;

                // Handle tick count update - Forward to main analyzer if possible
                case 'UPDATE_TICK_COUNT':
                    const newCount = event.data.tickCount || event.data.count;
                    if (newCount && !isNaN(newCount)) {
                        requestedTickCount = parseInt(newCount, 10);
                        console.log(`Enhancer received tick count update: ${requestedTickCount}`);

                        try {
                            if (
                                window.volatilityAnalyzer &&
                                typeof window.volatilityAnalyzer.updateTickCount === 'function'
                            ) {
                                window.volatilityAnalyzer.updateTickCount(requestedTickCount);
                            } else if (typeof window.updateTickCount === 'function') {
                                window.updateTickCount(requestedTickCount);
                            } else {
                                console.error('No updateTickCount function found on window or volatilityAnalyzer');
                            }
                        } catch (e) {
                            console.error('Error updating tick count:', e);
                        }
                    }
                    break;

                // Handle analysis data request
                case 'REQUEST_ANALYSIS':
                    sendAnalysisData(event.data.strategyId);
                    break;
            }
        });

        // Enhance the original updateUI function to also send data to the React app
        const originalUpdateUI = window.updateUI;
        if (originalUpdateUI) {
            window.updateUI = function () {
                originalUpdateUI.apply(this, arguments);

                // Send current price as well
                if (window.tickHistory && window.tickHistory.length > 0) {
                    const currentPrice = window.tickHistory[window.tickHistory.length - 1].quote.toFixed(
                        window.decimalPlaces
                    );
                    window.postMessage(
                        {
                            type: 'PRICE_UPDATE',
                            price: currentPrice,
                            symbol: window.currentSymbol,
                        },
                        '*'
                    );
                }

                // Send analysis data to React app
                sendAnalysisData();
            };
        }
        
        // Send periodic status updates
        setInterval(() => {
            if (window.tickHistory && window.tickHistory.length > 0) {
                sendAnalysisData();
            }
        }, 2000); // Send updates every 2 seconds
    }

    function sendAnalysisData(specificStrategy = null) {
        if (!window.tickHistory || window.tickHistory.length === 0) return;

        // Calculate base statistics needed for all analyses
        const digitCounts = new Array(10).fill(0);
        window.tickHistory.forEach(tick => {
            const lastDigit = window.getLastDigit(tick.quote);
            digitCounts[lastDigit]++;
        });

        const totalTicks = window.tickHistory.length;
        const digitPercentages = digitCounts.map(count => ((count / totalTicks) * 100).toFixed(2));

        // Calculate even/odd statistics
        const evenCount = digitCounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
        const oddCount = digitCounts.filter((_, i) => i % 2 !== 0).reduce((a, b) => a + b, 0);
        const evenPercentage = ((evenCount / totalTicks) * 100).toFixed(2);
        const oddPercentage = ((oddCount / totalTicks) * 100).toFixed(2);

        // Calculate over/under statistics based on barrier
        let overCount = 0,
            underCount = 0;
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
        const recent10Ticks = window.tickHistory.slice(-10);
        const recentDigits = recent10Ticks.map(tick => window.getLastDigit(tick.quote));

        // Create E/O pattern
        const eoPattern = recentDigits.map(digit => (digit % 2 === 0 ? 'E' : 'O'));

        // Create O/U pattern based on barrier
        const ouPattern = recentDigits.map(digit => {
            return digit >= overUnderBarrier ? 'O' : 'U';
        });

        // Check for streaks in even/odd
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

        // Send data for rise/fall analysis
        if (!specificStrategy || specificStrategy === 'rise-fall') {
            let riseCount = 0,
                fallCount = 0;
            for (let i = 1; i < window.tickHistory.length; i++) {
                if (window.tickHistory[i].quote > window.tickHistory[i - 1].quote) riseCount++;
                else if (window.tickHistory[i].quote < window.tickHistory[i - 1].quote) fallCount++;
            }
            const riseRatio = ((riseCount / (totalTicks - 1)) * 100).toFixed(2);
            const fallRatio = ((fallCount / (totalTicks - 1)) * 100).toFixed(2);

            window.postMessage(
                {
                    type: 'ANALYSIS_DATA',
                    strategyId: 'rise-fall',
                    data: {
                        recommendation:
                            parseFloat(riseRatio) > 55 ? 'Rise' : parseFloat(fallRatio) > 55 ? 'Fall' : null,
                        confidence: Math.max(parseFloat(riseRatio), parseFloat(fallRatio)).toFixed(2),
                        riseRatio,
                        fallRatio,
                    },
                },
                '*'
            );
        }

        // Send data for even/odd analysis - percentages display
        if (!specificStrategy || specificStrategy === 'even-odd') {
            window.postMessage(
                {
                    type: 'ANALYSIS_DATA',
                    strategyId: 'even-odd',
                    data: {
                        recommendation:
                            parseFloat(evenPercentage) > 55 ? 'Even' : parseFloat(oddPercentage) > 55 ? 'Odd' : null,
                        confidence: Math.max(parseFloat(evenPercentage), parseFloat(oddPercentage)).toFixed(2),
                        evenProbability: evenPercentage,
                        oddProbability: oddPercentage,
                    },
                },
                '*'
            );
        }

        // Send data for even/odd analysis - E/O pattern display
        if (!specificStrategy || specificStrategy === 'even-odd-2') {
            window.postMessage(
                {
                    type: 'ANALYSIS_DATA',
                    strategyId: 'even-odd-2',
                    data: {
                        evenProbability: evenPercentage,
                        oddProbability: oddPercentage,
                        actualDigits: recentDigits,
                        evenOddPattern: eoPattern,
                        streak: currentStreak,
                        streakType,
                    },
                },
                '*'
            );
        }

        // Send data for over/under analysis - percentages display
        if (!specificStrategy || specificStrategy === 'over-under') {
            window.postMessage(
                {
                    type: 'ANALYSIS_DATA',
                    strategyId: 'over-under',
                    data: {
                        recommendation: parseFloat(overPercentage) > 55 ? 'Over' : parseFloat(underPercentage) > 55 ? 'Under' : null,
                        confidence: Math.max(parseFloat(overPercentage), parseFloat(underPercentage)),
                        overProbability: overPercentage,
                        underProbability: underPercentage,
                        barrier: overUnderBarrier,
                    },
                },
                '*'
            );
        }

        // Send data for over/under analysis - O/U pattern display
        if (!specificStrategy || specificStrategy === 'over-under-2') {
            window.postMessage(
                {
                    type: 'ANALYSIS_DATA',
                    strategyId: 'over-under-2',
                    data: {
                        overProbability: overPercentage,
                        underProbability: underPercentage,
                        actualDigits: recentDigits,
                        overUnderPattern: ouPattern,
                        barrier: overUnderBarrier,
                    },
                },
                '*'
            );
        }

        // Send data for matches/differs analysis
        if (!specificStrategy || specificStrategy === 'matches-differs') {
            const targetDigit = 5; // Default target digit
            const matchCount = digitCounts[targetDigit];
            const differCount = totalTicks - matchCount;
            const matchPercentage = ((matchCount / totalTicks) * 100).toFixed(2);
            const differPercentage = ((differCount / totalTicks) * 100).toFixed(2);

            window.postMessage(
                {
                    type: 'ANALYSIS_DATA',
                    strategyId: 'matches-differs',
                    data: {
                        recommendation: parseFloat(matchPercentage) > 55 ? 'Matches' : parseFloat(differPercentage) > 55 ? 'Differs' : null,
                        confidence: Math.max(parseFloat(matchPercentage), parseFloat(differPercentage)),
                        matchProbability: matchPercentage,
                        differProbability: differPercentage,
                        targetDigit: targetDigit,
                    },
                },
                '*'
            );
        }
    }
})();
/**
 * Analyzer Enhancer - Enhanced pattern recognition for trading strategies
 */
class AnalyzerEnhancer {
    constructor() {
        this.patterns = {
            evenOdd: [],
            overUnder: [],
            digitSequence: [],
            volatilityTrends: []
        };
        this.confidence = {
            high: 0.8,
            medium: 0.6,
            low: 0.4
        };
    }
    
    analyzeEvenOddPattern(digits) {
        if (digits.length < 10) return { pattern: 'INSUFFICIENT_DATA', confidence: 0 };
        
        const recent = digits.slice(-10);
        const evenCount = recent.filter(d => d % 2 === 0).length;
        const oddCount = recent.length - evenCount;
        
        const evenPercentage = evenCount / recent.length;
        
        let pattern = 'BALANCED';
        let confidence = 0;
        
        if (evenPercentage >= 0.7) {
            pattern = 'EVEN_DOMINANT';
            confidence = this.confidence.high;
        } else if (evenPercentage <= 0.3) {
            pattern = 'ODD_DOMINANT';
            confidence = this.confidence.high;
        } else if (evenPercentage >= 0.6) {
            pattern = 'EVEN_TRENDING';
            confidence = this.confidence.medium;
        } else if (evenPercentage <= 0.4) {
            pattern = 'ODD_TRENDING';
            confidence = this.confidence.medium;
        }
        
        return { pattern, confidence, evenPercentage };
    }
    
    analyzeOverUnderPattern(digits, barrier = 5) {
        if (digits.length < 10) return { pattern: 'INSUFFICIENT_DATA', confidence: 0 };
        
        const recent = digits.slice(-10);
        const overCount = recent.filter(d => d >= barrier).length;
        const underCount = recent.length - overCount;
        
        const overPercentage = overCount / recent.length;
        
        let pattern = 'BALANCED';
        let confidence = 0;
        
        if (overPercentage >= 0.7) {
            pattern = 'OVER_DOMINANT';
            confidence = this.confidence.high;
        } else if (overPercentage <= 0.3) {
            pattern = 'UNDER_DOMINANT';
            confidence = this.confidence.high;
        } else if (overPercentage >= 0.6) {
            pattern = 'OVER_TRENDING';
            confidence = this.confidence.medium;
        } else if (overPercentage <= 0.4) {
            pattern = 'UNDER_TRENDING';
            confidence = this.confidence.medium;
        }
        
        return { pattern, confidence, overPercentage };
    }
    
    detectStreaks(digits) {
        if (digits.length === 0) return { type: null, length: 0 };
        
        let currentStreak = 1;
        let maxStreak = 1;
        let streakType = null;
        
        const lastDigit = digits[digits.length - 1];
        const lastType = lastDigit % 2 === 0 ? 'even' : 'odd';
        
        // Count current streak
        for (let i = digits.length - 2; i >= 0; i--) {
            const currentType = digits[i] % 2 === 0 ? 'even' : 'odd';
            if (currentType === lastType) {
                currentStreak++;
            } else {
                break;
            }
        }
        
        return {
            type: lastType,
            length: currentStreak,
            isSignificant: currentStreak >= 5
        };
    }
    
    analyzeDigitFrequency(digits) {
        if (digits.length < 20) return { analysis: 'INSUFFICIENT_DATA', hotDigits: [], coldDigits: [] };
        
        const frequency = new Array(10).fill(0);
        digits.forEach(digit => {
            frequency[digit]++;
        });
        
        const avgFreq = digits.length / 10;
        const hotDigits = [];
        const coldDigits = [];
        
        frequency.forEach((count, digit) => {
            const ratio = count / avgFreq;
            if (ratio >= 1.3) {
                hotDigits.push({ digit, frequency: count, ratio });
            } else if (ratio <= 0.7) {
                coldDigits.push({ digit, frequency: count, ratio });
            }
        });
        
        return {
            analysis: 'COMPLETE',
            hotDigits: hotDigits.sort((a, b) => b.ratio - a.ratio),
            coldDigits: coldDigits.sort((a, b) => a.ratio - b.ratio),
            avgFrequency: avgFreq
        };
    }
    
    generateTradingSignal(digits, symbol = 'R_100') {
        const evenOdd = this.analyzeEvenOddPattern(digits);
        const overUnder = this.analyzeOverUnderPattern(digits);
        const streaks = this.detectStreaks(digits);
        const frequency = this.analyzeDigitFrequency(digits);
        
        let signals = [];
        
        // Even/Odd signals
        if (evenOdd.confidence >= this.confidence.medium) {
            if (evenOdd.pattern === 'ODD_DOMINANT' || evenOdd.pattern === 'ODD_TRENDING') {
                signals.push({
                    type: 'EVEN',
                    reason: 'Odd streak detected, expect even reversion',
                    confidence: evenOdd.confidence,
                    contract: 'DIGITEVEN'
                });
            } else if (evenOdd.pattern === 'EVEN_DOMINANT' || evenOdd.pattern === 'EVEN_TRENDING') {
                signals.push({
                    type: 'ODD',
                    reason: 'Even streak detected, expect odd reversion',
                    confidence: evenOdd.confidence,
                    contract: 'DIGITODD'
                });
            }
        }
        
        // Over/Under signals
        if (overUnder.confidence >= this.confidence.medium) {
            if (overUnder.pattern === 'OVER_DOMINANT' || overUnder.pattern === 'OVER_TRENDING') {
                signals.push({
                    type: 'UNDER',
                    reason: 'Over pattern detected, expect under reversion',
                    confidence: overUnder.confidence,
                    contract: 'DIGITUNDER',
                    barrier: '4'
                });
            } else if (overUnder.pattern === 'UNDER_DOMINANT' || overUnder.pattern === 'UNDER_TRENDING') {
                signals.push({
                    type: 'OVER',
                    reason: 'Under pattern detected, expect over reversion',
                    confidence: overUnder.confidence,
                    contract: 'DIGITOVER',
                    barrier: '5'
                });
            }
        }
        
        // Streak-based signals
        if (streaks.isSignificant) {
            const oppositeType = streaks.type === 'even' ? 'ODD' : 'EVEN';
            signals.push({
                type: oppositeType,
                reason: `${streaks.type} streak of ${streaks.length}, expect reversal`,
                confidence: Math.min(this.confidence.high, streaks.length * 0.1),
                contract: streaks.type === 'even' ? 'DIGITODD' : 'DIGITEVEN'
            });
        }
        
        // Find best signal
        const bestSignal = signals.reduce((best, current) => {
            return current.confidence > best.confidence ? current : best;
        }, { confidence: 0 });
        
        return {
            symbol,
            bestSignal: bestSignal.confidence > 0 ? bestSignal : null,
            allSignals: signals,
            analysis: {
                evenOdd,
                overUnder,
                streaks,
                frequency
            }
        };
    }
}

// Global instance
window.AnalyzerEnhancer = AnalyzerEnhancer;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalyzerEnhancer;
}
