import { symbolAnalyzer, SymbolAnalysis } from './symbol-analyzer';

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

            // Find best recommendation
            const bestRecommendation = recommendations.reduce((best, current) => 
                current.confidence > (best?.confidence || 0) ? current : best, null);

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

        // Over/Under analysis
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

            if (overPercent > 55) {
                recommendations.push({
                    symbol,
                    strategy: 'over',
                    barrier: barrier.toString(),
                    confidence: overPercent,
                    overPercentage: overPercent,
                    underPercentage: underPercent,
                    reason: `OVER ${barrier} dominance: ${overPercent.toFixed(1)}%`,
                    timestamp: Date.now()
                });
            }

            if (underPercent > 55) {
                recommendations.push({
                    symbol,
                    strategy: 'under',
                    barrier: barrier.toString(),
                    confidence: underPercent,
                    overPercentage: overPercent,
                    underPercentage: underPercent,
                    reason: `UNDER ${barrier} dominance: ${underPercent.toFixed(1)}%`,
                    timestamp: Date.now()
                });
            }
        });

        // Even/Odd analysis - Higher threshold for better accuracy
        const evenCount = [0, 2, 4, 6, 8].reduce((sum, digit) => sum + (digitFreq[digit] || 0), 0);
        const oddCount = [1, 3, 5, 7, 9].reduce((sum, digit) => sum + (digitFreq[digit] || 0), 0);
        const evenPercent = (evenCount / totalTicks) * 100;
        const oddPercent = (oddCount / totalTicks) * 100;

        if (evenPercent > 60) {
            recommendations.push({
                symbol,
                strategy: 'even',
                barrier: 'even',
                confidence: evenPercent,
                overPercentage: evenPercent,
                underPercentage: oddPercent,
                reason: `STRONG EVEN dominance: ${evenPercent.toFixed(1)}% vs ${oddPercent.toFixed(1)}%`,
                timestamp: Date.now()
            });
        }

        if (oddPercent > 60) {
            recommendations.push({
                symbol,
                strategy: 'odd',
                barrier: 'odd',
                confidence: oddPercent,
                overPercentage: evenPercent,
                underPercentage: oddPercent,
                reason: `STRONG ODD dominance: ${oddPercent.toFixed(1)}% vs ${evenPercent.toFixed(1)}%`,
                timestamp: Date.now()
            });
        }

        return recommendations;
    }

    private handleError(message: string) {
        this.errorCallbacks.forEach(callback => callback(message));
    }
}

// Create a singleton instance with proper error handling
let marketAnalyzer: MarketAnalyzer;
try {
    marketAnalyzer = new MarketAnalyzer();
} catch (error) {
    console.error('Failed to initialize MarketAnalyzer:', error);
    marketAnalyzer = {} as MarketAnalyzer; // Fallback to prevent app crash
}

export default marketAnalyzer;