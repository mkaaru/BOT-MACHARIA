export interface TradeRecommendation {
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    symbol: string;
    strategy: string;
    reasoning: string;
    timestamp: Date;
}

export interface MarketData {
    symbol: string;
    price: number;
    volatility: number;
    trend: 'UP' | 'DOWN' | 'SIDEWAYS';
    volume: number;
    lastUpdate: Date;
}

export interface AnalysisResult {
    recommendation: TradeRecommendation;
    marketData: MarketData;
    confidence: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

class MarketAnalyzer {
    private marketData: Map<string, MarketData> = new Map();
    private analysisHistory: TradeRecommendation[] = [];
    private strategies = ['AutoDiffer', 'Auto Over/Under', 'Auto O5U4'];

    constructor() {
        this.initializeMarketData();
        this.startRealTimeAnalysis();
    }

    private initializeMarketData(): void {
        const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

        symbols.forEach(symbol => {
            this.marketData.set(symbol, {
                symbol,
                price: Math.random() * 1000 + 100,
                volatility: Math.random() * 100,
                trend: this.getRandomTrend(),
                volume: Math.random() * 10000,
                lastUpdate: new Date()
            });
        });
    }

    private getRandomTrend(): 'UP' | 'DOWN' | 'SIDEWAYS' {
        const trends: ('UP' | 'DOWN' | 'SIDEWAYS')[] = ['UP', 'DOWN', 'SIDEWAYS'];
        return trends[Math.floor(Math.random() * trends.length)];
    }

    private startRealTimeAnalysis(): void {
        setInterval(() => {
            this.updateMarketData();
        }, 5000);
    }

    private updateMarketData(): void {
        this.marketData.forEach((data, symbol) => {
            const priceChange = (Math.random() - 0.5) * 10;
            const newPrice = Math.max(50, data.price + priceChange);

            this.marketData.set(symbol, {
                ...data,
                price: newPrice,
                volatility: Math.random() * 100,
                trend: this.getRandomTrend(),
                volume: Math.random() * 10000,
                lastUpdate: new Date()
            });
        });
    }

    public analyzeSymbol(symbol: string): AnalysisResult {
        const marketData = this.marketData.get(symbol);
        if (!marketData) {
            throw new Error(`No market data available for symbol: ${symbol}`);
        }

        const recommendation = this.generateRecommendation(symbol, marketData);
        const confidence = this.calculateConfidence(marketData);
        const riskLevel = this.assessRisk(marketData);

        return {
            recommendation,
            marketData,
            confidence,
            riskLevel
        };
    }

    private generateRecommendation(symbol: string, marketData: MarketData): TradeRecommendation {
        const actions: ('BUY' | 'SELL' | 'HOLD')[] = ['BUY', 'SELL', 'HOLD'];
        const strategy = this.strategies[Math.floor(Math.random() * this.strategies.length)];

        // Simple analysis logic
        let recommendedAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let reasoning = '';

        if (marketData.volatility > 70) {
            recommendedAction = marketData.trend === 'UP' ? 'BUY' : 'SELL';
            reasoning = `High volatility (${marketData.volatility.toFixed(1)}%) with ${marketData.trend} trend indicates strong ${recommendedAction.toLowerCase()} signal`;
        } else if (marketData.volatility < 30) {
            recommendedAction = 'HOLD';
            reasoning = `Low volatility (${marketData.volatility.toFixed(1)}%) suggests waiting for clearer market direction`;
        } else {
            recommendedAction = marketData.trend === 'UP' ? 'BUY' : marketData.trend === 'DOWN' ? 'SELL' : 'HOLD';
            reasoning = `Moderate volatility (${marketData.volatility.toFixed(1)}%) with ${marketData.trend} trend suggests ${recommendedAction.toLowerCase()} position`;
        }

        const recommendation: TradeRecommendation = {
            action: recommendedAction,
            confidence: this.calculateConfidence(marketData),
            symbol,
            strategy,
            reasoning,
            timestamp: new Date()
        };

        this.analysisHistory.push(recommendation);
        if (this.analysisHistory.length > 100) {
            this.analysisHistory.shift();
        }

        return recommendation;
    }

    private calculateConfidence(marketData: MarketData): number {
        let confidence = 50; // Base confidence

        // Adjust based on volatility
        if (marketData.volatility > 80) {
            confidence += 20;
        } else if (marketData.volatility < 20) {
            confidence -= 15;
        }

        // Adjust based on trend clarity
        if (marketData.trend !== 'SIDEWAYS') {
            confidence += 15;
        } else {
            confidence -= 10;
        }

        // Adjust based on volume
        if (marketData.volume > 7500) {
            confidence += 10;
        }

        return Math.max(0, Math.min(100, confidence + (Math.random() - 0.5) * 20));
    }

    private assessRisk(marketData: MarketData): 'LOW' | 'MEDIUM' | 'HIGH' {
        if (marketData.volatility > 75) {
            return 'HIGH';
        } else if (marketData.volatility > 40) {
            return 'MEDIUM';
        } else {
            return 'LOW';
        }
    }

    public getRecommendationForStrategy(strategy: string, symbol: string): TradeRecommendation | null {
        try {
            const analysis = this.analyzeSymbol(symbol);
            return {
                ...analysis.recommendation,
                strategy
            };
        } catch (error) {
            console.error('Error generating recommendation:', error);
            return null;
        }
    }

    public getMarketStats(symbol: string): MarketData | null {
        return this.marketData.get(symbol) || null;
    }

    public getAllMarketData(): Map<string, MarketData> {
        return new Map(this.marketData);
    }

    public getAnalysisHistory(): TradeRecommendation[] {
        return [...this.analysisHistory];
    }

    public performVolatilityAnalysis(symbols: string[]): Record<string, number> {
        const analysis: Record<string, number> = {};

        symbols.forEach(symbol => {
            const data = this.marketData.get(symbol);
            if (data) {
                analysis[symbol] = data.volatility;
            }
        });

        return analysis;
    }

    public identifyTradingOpportunities(): TradeRecommendation[] {
        const opportunities: TradeRecommendation[] = [];

        this.marketData.forEach((data, symbol) => {
            if (data.volatility > 60 && data.trend !== 'SIDEWAYS') {
                const recommendation = this.generateRecommendation(symbol, data);
                if (recommendation.confidence > 70) {
                    opportunities.push(recommendation);
                }
            }
        });

        return opportunities.sort((a, b) => b.confidence - a.confidence);
    }
}

// Create singleton instance
const marketAnalyzer = new MarketAnalyzer();
export default marketAnalyzer;

// Export types
export type { MarketData, AnalysisResult };