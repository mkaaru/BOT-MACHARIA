// Volatility Analyzer for Trading Hub
class VolatilityAnalyzer {
    constructor() {
        this.symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
        this.analysisData = new Map();
        this.isRunning = false;
        this.analysisInterval = null;
        this.eventListeners = new Map();

        this.initializeAnalysis();
    }

    initializeAnalysis() {
        this.symbols.forEach(symbol => {
            this.analysisData.set(symbol, {
                symbol,
                volatility: Math.random() * 100,
                trend: this.getRandomTrend(),
                strength: Math.random() * 10,
                riseProb: Math.random() * 100,
                fallProb: Math.random() * 100,
                evenProb: Math.random() * 100,
                oddProb: Math.random() * 100,
                overProb: Math.random() * 100,
                underProb: Math.random() * 100,
                lastUpdate: Date.now()
            });
        });
    }

    getRandomTrend() {
        const trends = ['BULLISH', 'BEARISH', 'SIDEWAYS'];
        return trends[Math.floor(Math.random() * trends.length)];
    }

    startAnalysis() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.analysisInterval = setInterval(() => {
            this.updateAnalysis();
            this.emitAnalysisUpdate();
        }, 2000);

        console.log('Volatility Analyzer started');
    }

    stopAnalysis() {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }

        console.log('Volatility Analyzer stopped');
    }

    updateAnalysis() {
        this.symbols.forEach(symbol => {
            const currentData = this.analysisData.get(symbol);
            const volatilityChange = (Math.random() - 0.5) * 20;

            const updatedData = {
                ...currentData,
                volatility: Math.max(0, Math.min(100, currentData.volatility + volatilityChange)),
                trend: Math.random() > 0.8 ? this.getRandomTrend() : currentData.trend,
                strength: Math.max(0, Math.min(10, currentData.strength + (Math.random() - 0.5) * 2)),
                riseProb: Math.max(0, Math.min(100, currentData.riseProb + (Math.random() - 0.5) * 10)),
                fallProb: Math.max(0, Math.min(100, currentData.fallProb + (Math.random() - 0.5) * 10)),
                evenProb: Math.max(0, Math.min(100, currentData.evenProb + (Math.random() - 0.5) * 8)),
                oddProb: Math.max(0, Math.min(100, currentData.oddProb + (Math.random() - 0.5) * 8)),
                overProb: Math.max(0, Math.min(100, currentData.overProb + (Math.random() - 0.5) * 12)),
                underProb: Math.max(0, Math.min(100, currentData.underProb + (Math.random() - 0.5) * 12)),
                lastUpdate: Date.now()
            };

            this.analysisData.set(symbol, updatedData);
        });
    }

    emitAnalysisUpdate() {
        const analysisUpdate = {
            timestamp: Date.now(),
            symbols: Array.from(this.analysisData.values()),
            marketCondition: this.getMarketCondition(),
            topOpportunities: this.getTopOpportunities()
        };

        this.emit('analysisUpdate', analysisUpdate);

        // Send analysis to console for debugging
        console.log('Volatility Analysis Update:', {
            time: new Date().toLocaleTimeString(),
            symbols: analysisUpdate.symbols.length,
            condition: analysisUpdate.marketCondition
        });
    }

    getMarketCondition() {
        const avgVolatility = Array.from(this.analysisData.values())
            .reduce((sum, data) => sum + data.volatility, 0) / this.symbols.length;

        if (avgVolatility > 70) return 'HIGH_VOLATILITY';
        if (avgVolatility > 40) return 'MEDIUM_VOLATILITY';
        return 'LOW_VOLATILITY';
    }

    getTopOpportunities() {
        return Array.from(this.analysisData.values())
            .map(data => ({
                symbol: data.symbol,
                score: this.calculateOpportunityScore(data),
                recommendation: this.generateRecommendation(data)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }

    calculateOpportunityScore(data) {
        // Higher volatility and clear trend = higher score
        let score = data.volatility;

        if (data.trend !== 'SIDEWAYS') {
            score += 20;
        }

        score += data.strength * 5;

        // Boost score for extreme probabilities
        const probabilities = [data.riseProb, data.fallProb, data.evenProb, data.oddProb, data.overProb, data.underProb];
        const maxProb = Math.max(...probabilities);
        const minProb = Math.min(...probabilities);

        if (maxProb - minProb > 30) {
            score += 15;
        }

        return Math.min(100, score);
    }

    generateRecommendation(data) {
        const recommendations = [];

        // Rise/Fall analysis
        if (data.riseProb > data.fallProb + 15) {
            recommendations.push({
                type: 'RISE',
                confidence: data.riseProb,
                symbol: data.symbol
            });
        } else if (data.fallProb > data.riseProb + 15) {
            recommendations.push({
                type: 'FALL',
                confidence: data.fallProb,
                symbol: data.symbol
            });
        }

        // Even/Odd analysis
        if (data.evenProb > data.oddProb + 10) {
            recommendations.push({
                type: 'EVEN',
                confidence: data.evenProb,
                symbol: data.symbol
            });
        } else if (data.oddProb > data.evenProb + 10) {
            recommendations.push({
                type: 'ODD',
                confidence: data.oddProb,
                symbol: data.symbol
            });
        }

        // Over/Under analysis
        if (data.overProb > data.underProb + 12) {
            recommendations.push({
                type: 'OVER',
                confidence: data.overProb,
                symbol: data.symbol,
                target: 5
            });
        } else if (data.underProb > data.overProb + 12) {
            recommendations.push({
                type: 'UNDER',
                confidence: data.underProb,
                symbol: data.symbol,
                target: 5
            });
        }

        // Return highest confidence recommendation
        return recommendations.reduce((best, current) => 
            current.confidence > best.confidence ? current : best, 
            { type: 'HOLD', confidence: 50, symbol: data.symbol }
        );
    }

    getAnalysisData(symbol = null) {
        if (symbol) {
            return this.analysisData.get(symbol);
        }
        return Array.from(this.analysisData.values());
    }

    // Event system
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Error in event listener:', error);
                }
            });
        }
    }

    // Pattern recognition
    identifyPatterns(symbol) {
        const data = this.analysisData.get(symbol);
        if (!data) return [];

        const patterns = [];

        // High volatility breakout pattern
        if (data.volatility > 80 && data.strength > 7) {
            patterns.push({
                type: 'BREAKOUT',
                strength: data.strength,
                probability: 85,
                timeframe: '5-15 minutes'
            });
        }

        // Consolidation pattern
        if (data.volatility < 30 && data.trend === 'SIDEWAYS') {
            patterns.push({
                type: 'CONSOLIDATION',
                strength: 10 - data.volatility / 10,
                probability: 70,
                timeframe: '10-30 minutes'
            });
        }

        // Trend continuation
        if ((data.trend === 'BULLISH' && data.riseProb > 70) || 
            (data.trend === 'BEARISH' && data.fallProb > 70)) {
            patterns.push({
                type: 'TREND_CONTINUATION',
                strength: data.strength,
                probability: Math.max(data.riseProb, data.fallProb),
                timeframe: '15-45 minutes'
            });
        }

        return patterns;
    }

    // Risk assessment
    assessRisk(symbol) {
        const data = this.analysisData.get(symbol);
        if (!data) return 'UNKNOWN';

        if (data.volatility > 75) return 'HIGH';
        if (data.volatility > 40) return 'MEDIUM';
        return 'LOW';
    }

    // Get market sentiment
    getMarketSentiment() {
        const allData = Array.from(this.analysisData.values());

        const avgRise = allData.reduce((sum, data) => sum + data.riseProb, 0) / allData.length;
        const avgFall = allData.reduce((sum, data) => sum + data.fallProb, 0) / allData.length;

        if (avgRise > avgFall + 10) return 'BULLISH';
        if (avgFall > avgRise + 10) return 'BEARISH';
        return 'NEUTRAL';
    }
}

// Global instance
window.volatilityAnalyzer = new VolatilityAnalyzer();

// Auto-start analysis
document.addEventListener('DOMContentLoaded', () => {
    window.volatilityAnalyzer.startAnalysis();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolatilityAnalyzer;
}