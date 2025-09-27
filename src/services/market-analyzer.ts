
import { symbolAnalyzer, SymbolAnalysis } from './symbol-analyzer';
import { mlTickPredictor, MLPrediction } from './ml-tick-predictor';

export interface TradeRecommendation {
    symbol: string;
    strategy: 'over' | 'under' | 'even' | 'odd' | 'matches' | 'differs';
    barrier: string;
    confidence: number;
    overPercentage: number;
    underPercentage: number;
    reason: string;
    timestamp: number;
    score?: number;
    mlPrediction?: MLPrediction;
    mlWeight?: number; // Weight given to ML prediction (0-1)
}

export interface MarketStats {
    symbol: string;
    tickCount: number;
    lastDigitFrequency: Record<number, number>;
    currentLastDigit: number;
    mostFrequentDigit: number;
    leastFrequentDigit: number;
    isReady: boolean;
    lastUpdate: number;
}

export interface O5U4Conditions {
    symbol: string;
    conditionsMetCount: number;
    score: number;
    details: {
        sampleSize: number;
        conditions: string[];
    };
}

type AnalysisCallback = (
    recommendation: TradeRecommendation | null,
    stats: Record<string, MarketStats> | null,
    o5u4Data: O5U4Conditions[] | null
) => void;

type ErrorCallback = (error: string) => void;

class MarketAnalyzer {
    private ws: WebSocket | null = null;
    private isRunning = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 5000;
    private analysisInterval: NodeJS.Timeout | null = null;
    private analysisCallbacks: AnalysisCallback[] = [];
    private errorCallbacks: ErrorCallback[] = [];
    private tickHistory: Record<string, any[]> = {};
    private subscriptionIds: Record<string, string> = {};

    private symbols = [
        'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
        'RDBEAR', 'RDBULL',
        '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
    ];

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.connectToDerivAPI();
        this.startAnalysis();
    }

    stop() {
        this.isRunning = false;
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
        
        this.reconnectAttempts = 0;
        symbolAnalyzer.clearAll();
        this.tickHistory = {};
        this.subscriptionIds = {};
    }

    onAnalysis(callback: AnalysisCallback): () => void {
        this.analysisCallbacks.push(callback);
        return () => {
            const index = this.analysisCallbacks.indexOf(callback);
            if (index > -1) {
                this.analysisCallbacks.splice(index, 1);
            }
        };
    }

    onError(callback: ErrorCallback): () => void {
        this.errorCallbacks.push(callback);
        return () => {
            const index = this.errorCallbacks.indexOf(callback);
            if (index > -1) {
                this.errorCallbacks.splice(index, 1);
            }
        };
    }

    private connectToDerivAPI() {
        if (this.ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.ws.readyState)) {
            return;
        }

        try {
            this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
            
            this.ws.onopen = () => {
                console.log('✅ Connected to Deriv WebSocket API');
                this.reconnectAttempts = 0;
                this.subscribeToSymbols();
            };

            this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(event);
            };

            this.ws.onerror = (error) => {
                console.error('❌ Deriv WebSocket error:', error);
                this.handleError('WebSocket connection error');
            };

            this.ws.onclose = (event) => {
                console.log('🔌 Deriv WebSocket disconnected:', event.code, event.reason);
                if (this.isRunning && !event.wasClean) {
                    this.scheduleReconnect();
                }
            };

            // Connection timeout
            setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                    console.log('⌛ WebSocket connection timeout');
                    this.ws.close();
                    this.scheduleReconnect();
                }
            }, 10000);

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.handleError('Failed to establish connection to market data');
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (!this.isRunning || this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.handleError('Maximum reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
        
        setTimeout(() => {
            if (this.isRunning) {
                this.connectToDerivAPI();
            }
        }, this.reconnectDelay);
    }

    private subscribeToSymbols() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.symbols.forEach(symbol => {
            const subscribeMsg = {
                ticks: symbol,
                subscribe: 1
            };
            
            try {
                this.ws!.send(JSON.stringify(subscribeMsg));
                console.log(`📊 Subscribed to ${symbol}`);
            } catch (error) {
                console.error(`Failed to subscribe to ${symbol}:`, error);
            }
        });
    }

    private handleWebSocketMessage(event: MessageEvent) {
        try {
            const data = JSON.parse(event.data);
            
            if (data.error) {
                console.error('WebSocket error response:', data.error);
                this.handleError(`API Error: ${data.error.message}`);
                return;
            }

            if (data.tick) {
                this.processTick(data.tick);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }

    private processTick(tick: any) {
        const { symbol, quote, epoch } = tick;
        
        if (!this.symbols.includes(symbol)) {
            return;
        }

        const tickData = {
            symbol,
            epoch: epoch,
            quote: parseFloat(quote),
            timestamp: new Date(epoch * 1000)
        };

        // Process through ML predictor first for pattern learning
        mlTickPredictor.addTick(tickData);

        // Store tick in symbol analyzer
        symbolAnalyzer.addTick(symbol, {
            time: epoch * 1000,
            quote: parseFloat(quote)
        });

        // Store in local history
        if (!this.tickHistory[symbol]) {
            this.tickHistory[symbol] = [];
        }
        
        this.tickHistory[symbol].push({
            time: epoch * 1000,
            quote: parseFloat(quote),
            last_digit: this.getLastDigit(parseFloat(quote))
        });

        // Keep only last 200 ticks
        if (this.tickHistory[symbol].length > 200) {
            this.tickHistory[symbol] = this.tickHistory[symbol].slice(-200);
        }
    }

    private getLastDigit(price: number): number {
        const priceStr = price.toString();
        const decimalPart = priceStr.split('.')[1] || '0';
        return parseInt(decimalPart.slice(-1)) || 0;
    }

    private startAnalysis() {
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
        }

        this.analysisInterval = setInterval(() => {
            this.performAnalysis();
        }, 1500); // Every 1.5 seconds
    }

    private performAnalysis() {
        try {
            const marketStats: Record<string, MarketStats> = {};
            const recommendations: TradeRecommendation[] = [];
            const o5u4Opportunities: O5U4Conditions[] = [];

            this.symbols.forEach(symbol => {
                const ticks = this.tickHistory[symbol];
                if (!ticks || ticks.length < 50) {
                    marketStats[symbol] = {
                        symbol,
                        tickCount: ticks?.length || 0,
                        lastDigitFrequency: {},
                        currentLastDigit: 0,
                        mostFrequentDigit: 0,
                        leastFrequentDigit: 0,
                        isReady: false,
                        lastUpdate: Date.now()
                    };
                    return;
                }

                // Calculate digit frequencies
                const digitFreq: Record<number, number> = {};
                for (let i = 0; i <= 9; i++) {
                    digitFreq[i] = 0;
                }

                ticks.forEach(tick => {
                    const digit = tick.last_digit;
                    digitFreq[digit] = (digitFreq[digit] || 0) + 1;
                });

                const mostFreqDigit = Object.entries(digitFreq)
                    .reduce((a, b) => digitFreq[parseInt(a[0])] > digitFreq[parseInt(b[0])] ? a : b)[0];
                
                const leastFreqDigit = Object.entries(digitFreq)
                    .reduce((a, b) => digitFreq[parseInt(a[0])] < digitFreq[parseInt(b[0])] ? a : b)[0];

                marketStats[symbol] = {
                    symbol,
                    tickCount: ticks.length,
                    lastDigitFrequency: digitFreq,
                    currentLastDigit: ticks[ticks.length - 1].last_digit,
                    mostFrequentDigit: parseInt(mostFreqDigit),
                    leastFrequentDigit: parseInt(leastFreqDigit),
                    isReady: true,
                    lastUpdate: Date.now()
                };

                // Generate recommendations
                const symbolRecs = this.generateRecommendations(symbol, digitFreq, ticks);
                recommendations.push(...symbolRecs);
            });

            // Find best recommendation with ML-enhanced scoring
            const bestRecommendation = recommendations.reduce((best, current) => {
                const currentScore = current.score || current.confidence;
                const bestScore = best?.score || best?.confidence || 0;
                return currentScore > bestScore ? current : best;
            }, null);

            // Log ML enhancement details
            if (bestRecommendation?.mlPrediction) {
                console.log(`🤖 ML-Enhanced Recommendation for ${bestRecommendation.symbol}:`);
                console.log(`   Traditional: ${bestRecommendation.strategy.toUpperCase()} ${bestRecommendation.barrier}`);
                console.log(`   ML Direction: ${bestRecommendation.mlPrediction.direction} (${bestRecommendation.mlPrediction.confidence.toFixed(1)}%)`);
                console.log(`   Combined Score: ${bestRecommendation.score?.toFixed(1)} (ML Weight: ${((bestRecommendation.mlWeight || 0) * 100).toFixed(0)}%)`);
                console.log(`   ML Features: Momentum=${(bestRecommendation.mlPrediction.features.momentum * 100).toFixed(1)}%, Volatility=${(bestRecommendation.mlPrediction.features.volatility * 100).toFixed(1)}%`);
            }

            // Notify all callbacks
            this.analysisCallbacks.forEach(callback => {
                callback(bestRecommendation, marketStats, o5u4Opportunities);
            });

        } catch (error) {
            console.error('Analysis error:', error);
            this.handleError('Analysis processing error');
        }
    }

    private generateRecommendations(symbol: string, digitFreq: Record<number, number>, ticks: any[]): TradeRecommendation[] {
        const recommendations: TradeRecommendation[] = [];
        const totalTicks = Object.values(digitFreq).reduce((a, b) => a + b, 0);

        if (totalTicks < 50) return recommendations;

        // Get ML prediction for this symbol
        const mlPrediction = mlTickPredictor.getPrediction(symbol);
        
        // Over/Under analysis with ML enhancement
        const barriers = [3, 4, 5, 6, 7];
        barriers.forEach(barrier => {
            let overCount = 0;
            let underCount = 0;
            
            for (let digit = 0; digit <= 9; digit++) {
                const count = digitFreq[digit] || 0;
                if (digit > barrier) {
                    overCount += count;
                } else if (digit < barrier) {
                    underCount += count;
                }
            }

            const overPercent = (overCount / totalTicks) * 100;
            const underPercent = (underCount / totalTicks) * 100;

            // Apply ML weighting - ML predictions get 70% weight, traditional analysis 30%
            const mlWeight = mlPrediction ? 0.7 : 0;
            const traditionalWeight = 1 - mlWeight;

            if (overPercent > 55) {
                let enhancedConfidence = overPercent * traditionalWeight;
                let enhancedReason = `OVER ${barrier} dominance: ${overPercent.toFixed(1)}%`;
                
                if (mlPrediction && mlPrediction.direction === 'RISE') {
                    enhancedConfidence += mlPrediction.confidence * mlWeight;
                    enhancedReason += ` + ML ${mlPrediction.direction} (${mlPrediction.confidence.toFixed(1)}%)`;
                }

                recommendations.push({
                    symbol,
                    strategy: 'over',
                    barrier: barrier.toString(),
                    confidence: Math.min(95, enhancedConfidence),
                    overPercentage: overPercent,
                    underPercentage: underPercent,
                    reason: enhancedReason,
                    timestamp: Date.now(),
                    mlPrediction,
                    mlWeight,
                    score: this.calculateMLEnhancedScore('over', overPercent, mlPrediction)
                });
            }

            if (underPercent > 55) {
                let enhancedConfidence = underPercent * traditionalWeight;
                let enhancedReason = `UNDER ${barrier} dominance: ${underPercent.toFixed(1)}%`;
                
                if (mlPrediction && mlPrediction.direction === 'FALL') {
                    enhancedConfidence += mlPrediction.confidence * mlWeight;
                    enhancedReason += ` + ML ${mlPrediction.direction} (${mlPrediction.confidence.toFixed(1)}%)`;
                }

                recommendations.push({
                    symbol,
                    strategy: 'under',
                    barrier: barrier.toString(),
                    confidence: Math.min(95, enhancedConfidence),
                    overPercentage: overPercent,
                    underPercentage: underPercent,
                    reason: enhancedReason,
                    timestamp: Date.now(),
                    mlPrediction,
                    mlWeight,
                    score: this.calculateMLEnhancedScore('under', underPercent, mlPrediction)
                });
            }
        });

        // Even/Odd analysis with ML enhancement
        const evenCount = [0, 2, 4, 6, 8].reduce((sum, digit) => sum + (digitFreq[digit] || 0), 0);
        const oddCount = [1, 3, 5, 7, 9].reduce((sum, digit) => sum + (digitFreq[digit] || 0), 0);
        const evenPercent = (evenCount / totalTicks) * 100;
        const oddPercent = (oddCount / totalTicks) * 100;

        const mlWeight = mlPrediction ? 0.7 : 0;
        const traditionalWeight = 1 - mlWeight;

        if (evenPercent > 60) {
            let enhancedConfidence = evenPercent * traditionalWeight;
            let enhancedReason = `STRONG EVEN dominance: ${evenPercent.toFixed(1)}% vs ${oddPercent.toFixed(1)}%`;
            
            if (mlPrediction && this.predictsFavorableForEven(mlPrediction)) {
                enhancedConfidence += mlPrediction.confidence * mlWeight;
                enhancedReason += ` + ML supports EVEN (${mlPrediction.confidence.toFixed(1)}%)`;
            }

            recommendations.push({
                symbol,
                strategy: 'even',
                barrier: 'even',
                confidence: Math.min(95, enhancedConfidence),
                overPercentage: evenPercent,
                underPercentage: oddPercent,
                reason: enhancedReason,
                timestamp: Date.now(),
                mlPrediction,
                mlWeight,
                score: this.calculateMLEnhancedScore('even', evenPercent, mlPrediction)
            });
        }

        if (oddPercent > 60) {
            let enhancedConfidence = oddPercent * traditionalWeight;
            let enhancedReason = `STRONG ODD dominance: ${oddPercent.toFixed(1)}% vs ${evenPercent.toFixed(1)}%`;
            
            if (mlPrediction && this.predictsFavorableForOdd(mlPrediction)) {
                enhancedConfidence += mlPrediction.confidence * mlWeight;
                enhancedReason += ` + ML supports ODD (${mlPrediction.confidence.toFixed(1)}%)`;
            }

            recommendations.push({
                symbol,
                strategy: 'odd',
                barrier: 'odd',
                confidence: oddPercent,
                overPercentage: evenPercent,
                underPercentage: oddPercent,
                reason: enhancedReason,
                timestamp: Date.now(),
                mlPrediction,
                mlWeight,
                score: this.calculateMLEnhancedScore('odd', oddPercent, mlPrediction)
            });
        }

        return recommendations;
    }

    private calculateMLEnhancedScore(strategy: string, traditionalConfidence: number, mlPrediction: MLPrediction | null): number {
        let score = traditionalConfidence * 0.3; // Traditional analysis gets 30% weight
        
        if (mlPrediction) {
            // ML prediction gets 70% weight
            let mlContribution = mlPrediction.prediction_score * 0.7;
            
            // Bonus for directional alignment
            if ((strategy === 'over' && mlPrediction.direction === 'RISE') ||
                (strategy === 'under' && mlPrediction.direction === 'FALL')) {
                mlContribution += 10; // 10 point bonus for alignment
            }
            
            // Strength bonus
            if (mlPrediction.strength === 'strong') {
                mlContribution += 5;
            } else if (mlPrediction.strength === 'moderate') {
                mlContribution += 2;
            }
            
            score += mlContribution;
        }
        
        return Math.min(98, Math.max(0, score));
    }

    private predictsFavorableForEven(mlPrediction: MLPrediction): boolean {
        // ML predictions that favor even outcomes
        return mlPrediction.features.cyclical > 0.5 && mlPrediction.features.volatility < 0.6;
    }

    private predictsFavorableForOdd(mlPrediction: MLPrediction): boolean {
        // ML predictions that favor odd outcomes  
        return mlPrediction.features.momentum > 0.3 && mlPrediction.features.volatility > 0.4;
    }

    private handleError(message: string) {
        this.errorCallbacks.forEach(callback => callback(message));
    }
}

// Create singleton instance
const marketAnalyzer = new MarketAnalyzer();
export default marketAnalyzer;
