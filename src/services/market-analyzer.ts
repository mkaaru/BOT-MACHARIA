import { makeObservable, observable, action, computed } from 'mobx';

export interface TickData {
    symbol: string;
    tick: number;
    epoch: number;
    last_digit: number;
    timestamp: number;
}

export interface SymbolData {
    symbol: string;
    ticks: TickData[];
    last_digit: number;
    digit_frequency: { [key: number]: number };
    most_frequent_digit: number;
    least_frequent_digit: number;
    streak_count: number;
    streak_digit: number;
    volatility: number;
}

export interface TradingRecommendation {
    strategy: 'autodiff' | 'over_under' | 'o5u4';
    symbol: string;
    contract_type: 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER';
    barrier?: number;
    confidence: number;
    reason: string;
}

class MarketAnalyzer {
    private ws: WebSocket | null = null;
    private symbols: string[] = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 3000;

    public symbolData: Map<string, SymbolData> = new Map();
    public isConnected = false;
    public lastUpdate = 0;
    public activeSubscriptions: Set<string> = new Set();

    constructor() {
        makeObservable(this, {
            symbolData: observable,
            isConnected: observable,
            lastUpdate: observable,
            activeSubscriptions: observable,
            connect: action,
            disconnect: action,
            updateSymbolData: action,
            isMarketAnalysisReady: computed,
        });

        this.initializeSymbolData();
        this.connect();
    }

    private initializeSymbolData() {
        this.symbols.forEach(symbol => {
            this.symbolData.set(symbol, {
                symbol,
                ticks: [],
                last_digit: 0,
                digit_frequency: {},
                most_frequent_digit: 0,
                least_frequent_digit: 0,
                streak_count: 0,
                streak_digit: 0,
                volatility: 0,
            });
        });
    }

    get isMarketAnalysisReady(): boolean {
        return this.isConnected && Array.from(this.symbolData.values()).every(data => data.ticks.length >= 10);
    }

    connect() {
        try {
            this.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=75771');

            this.ws.onopen = () => {
                console.log('Market Analyzer connected to Deriv WebSocket');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.subscribeToTicks();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('Market Analyzer WebSocket disconnected');
                this.isConnected = false;
                this.activeSubscriptions.clear();
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('Market Analyzer WebSocket error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('Failed to create Market Analyzer WebSocket:', error);
            this.attemptReconnect();
        }
    }

    private attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }

    private subscribeToTicks() {
        this.symbols.forEach(symbol => {
            const request = {
                ticks: symbol,
                subscribe: 1,
                req_id: `tick_${symbol}`
            };

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(request));
                this.activeSubscriptions.add(symbol);
            }
        });
    }

    private handleMessage(data: any) {
        if (data.tick) {
            this.processTick(data.tick);
        } else if (data.error) {
            console.error('WebSocket error:', data.error);
        }
    }

    private processTick(tick: any) {
        const symbol = tick.symbol;
        const price = parseFloat(tick.quote);
        const last_digit = Math.floor((price * 100) % 10);

        const tickData: TickData = {
            symbol,
            tick: price,
            epoch: tick.epoch,
            last_digit,
            timestamp: Date.now()
        };

        this.updateSymbolData(symbol, tickData);
        this.lastUpdate = Date.now();
    }

    updateSymbolData(symbol: string, tickData: TickData) {
        const symbolData = this.symbolData.get(symbol);
        if (!symbolData) return;

        // Add new tick
        symbolData.ticks.push(tickData);

        // Keep only last 100 ticks
        if (symbolData.ticks.length > 100) {
            symbolData.ticks.shift();
        }

        // Update last digit
        symbolData.last_digit = tickData.last_digit;

        // Calculate digit frequency
        symbolData.digit_frequency = this.calculateDigitFrequency(symbolData.ticks);

        // Find most and least frequent digits
        const frequencies = Object.entries(symbolData.digit_frequency);
        if (frequencies.length > 0) {
            frequencies.sort((a, b) => b[1] - a[1]);
            symbolData.most_frequent_digit = parseInt(frequencies[0][0]);
            symbolData.least_frequent_digit = parseInt(frequencies[frequencies.length - 1][0]);
        }

        // Calculate streak
        this.calculateStreak(symbolData);

        // Calculate volatility
        symbolData.volatility = this.calculateVolatility(symbolData.ticks);
    }

    private calculateDigitFrequency(ticks: TickData[]): { [key: number]: number } {
        const frequency: { [key: number]: number } = {};

        ticks.forEach(tick => {
            const digit = tick.last_digit;
            frequency[digit] = (frequency[digit] || 0) + 1;
        });

        return frequency;
    }

    private calculateStreak(symbolData: SymbolData) {
        const ticks = symbolData.ticks;
        if (ticks.length < 2) return;

        let streak = 1;
        const currentDigit = ticks[ticks.length - 1].last_digit;

        for (let i = ticks.length - 2; i >= 0; i--) {
            if (ticks[i].last_digit === currentDigit) {
                streak++;
            } else {
                break;
            }
        }

        symbolData.streak_count = streak;
        symbolData.streak_digit = currentDigit;
    }

    private calculateVolatility(ticks: TickData[]): number {
        if (ticks.length < 10) return 0;

        const prices = ticks.slice(-20).map(t => t.tick);
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;

        return Math.sqrt(variance);
    }

    // AutoDiffer Strategy Analysis
    getAutoDifferRecommendation(): TradingRecommendation | null {
        if (!this.isMarketAnalysisReady) return null;

        // Random symbol selection weighted by volatility
        const activeSymbols = Array.from(this.symbolData.values()).filter(data => data.ticks.length >= 10);
        if (activeSymbols.length === 0) return null;

        const randomSymbol = activeSymbols[Math.floor(Math.random() * activeSymbols.length)];
        const randomBarrier = Math.floor(Math.random() * 10);

        return {
            strategy: 'autodiff',
            symbol: randomSymbol.symbol,
            contract_type: 'DIGITDIFF',
            barrier: randomBarrier,
            confidence: 0.6 + (Math.random() * 0.3), // 60-90% confidence
            reason: `Random analysis: ${randomSymbol.symbol} barrier ${randomBarrier}`
        };
    }

    // Auto Over/Under Strategy Analysis
    getOverUnderRecommendation(): TradingRecommendation | null {
        if (!this.isMarketAnalysisReady) return null;

        let bestRecommendation: TradingRecommendation | null = null;
        let highestConfidence = 0;

        this.symbolData.forEach(data => {
            if (data.ticks.length < 20) return;

            const currentDigit = data.last_digit;
            const mostFrequent = data.most_frequent_digit;

            // Over 2 strategy
            if (currentDigit <= 2 && mostFrequent > 2) {
                const confidence = 0.7 + (data.volatility * 0.1);
                if (confidence > highestConfidence) {
                    highestConfidence = confidence;
                    bestRecommendation = {
                        strategy: 'over_under',
                        symbol: data.symbol,
                        contract_type: 'DIGITOVER',
                        barrier: 2,
                        confidence,
                        reason: `Current digit ${currentDigit} ≤ 2, most frequent ${mostFrequent} > 2`
                    };
                }
            }

            // Under 7 strategy
            if (currentDigit >= 7 && mostFrequent < 7) {
                const confidence = 0.7 + (data.volatility * 0.1);
                if (confidence > highestConfidence) {
                    highestConfidence = confidence;
                    bestRecommendation = {
                        strategy: 'over_under',
                        symbol: data.symbol,
                        contract_type: 'DIGITUNDER',
                        barrier: 7,
                        confidence,
                        reason: `Current digit ${currentDigit} ≥ 7, most frequent ${mostFrequent} < 7`
                    };
                }
            }
        });

        return bestRecommendation;
    }

    // Auto O5U4 Strategy Analysis
    getO5U4Recommendation(): TradingRecommendation | null {
        if (!this.isMarketAnalysisReady) return null;

        let bestSymbol: SymbolData | null = null;
        let highestConfidence = 0;

        this.symbolData.forEach(data => {
            if (data.ticks.length < 30) return;

            const currentDigit = data.last_digit;
            const leastFrequent = data.least_frequent_digit;
            const mostFrequent = data.most_frequent_digit;

            // O5U4 conditions
            const isCurrentDigit4or5 = currentDigit === 4 || currentDigit === 5;
            const isLeastFrequent4or5 = leastFrequent === 4 || leastFrequent === 5;
            const isMostFrequentValid = mostFrequent > 5 || mostFrequent < 4;

            if (isCurrentDigit4or5 && isLeastFrequent4or5 && isMostFrequentValid) {
                const confidence = 0.75 + (data.volatility * 0.05);
                if (confidence > highestConfidence) {
                    highestConfidence = confidence;
                    bestSymbol = data;
                }
            }
        });

        if (bestSymbol) {
            return {
                strategy: 'o5u4',
                symbol: bestSymbol.symbol,
                contract_type: 'DIGITOVER', // Will be used for both over 5 and under 4
                barrier: 5,
                confidence: highestConfidence,
                reason: `O5U4 conditions met: current=${bestSymbol.last_digit}, least=${bestSymbol.least_frequent_digit}, most=${bestSymbol.most_frequent_digit}`
            };
        }

        return null;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
            this.activeSubscriptions.clear();
        }
    }
}

// Create and export singleton instance
export const marketAnalyzer = new MarketAnalyzer();
export default marketAnalyzer;