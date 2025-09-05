
interface TickData {
    epoch: number;
    quote: number;
    symbol: string;
    last_digit: number;
    timestamp: number;
}

interface SymbolData {
    ticks: TickData[];
    digitFrequency: { [key: number]: number };
    lastAnalysis: number;
}

interface AutoDifferRecommendation {
    symbol: string;
    barrier: number;
    confidence: number;
    reason: string;
}

interface OverUnderRecommendation {
    symbol: string;
    contract_type: 'DIGITOVER' | 'DIGITUNDER';
    barrier: number;
    confidence: number;
    reason: string;
}

interface O5U4Recommendation {
    symbol: string;
    contract_type: 'DIGITOVER' | 'DIGITUNDER';
    barrier: number;
    confidence: number;
    reason: string;
}

class MarketAnalyzer {
    private ws: WebSocket | null = null;
    private isConnected = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private subscriptions = new Set<string>();
    
    public symbolData = new Map<string, SymbolData>();
    public isMarketAnalysisReady = false;

    private readonly VOLATILITY_SYMBOLS = [
        'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
        '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
    ];

    constructor() {
        this.initializeSymbolData();
    }

    private initializeSymbolData() {
        this.VOLATILITY_SYMBOLS.forEach(symbol => {
            this.symbolData.set(symbol, {
                ticks: [],
                digitFrequency: {},
                lastAnalysis: 0
            });
        });
    }

    connect() {
        if (this.isConnected || this.ws?.readyState === WebSocket.CONNECTING) {
            return;
        }

        try {
            this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
            
            this.ws.onopen = () => {
                console.log('Market Analyzer connected');
                this.isConnected = true;
                this.subscribeToTicks();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onclose = () => {
                console.log('Market Analyzer disconnected');
                this.isConnected = false;
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('Market Analyzer WebSocket error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('Failed to connect Market Analyzer:', error);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        this.reconnectTimeout = setTimeout(() => {
            console.log('Reconnecting Market Analyzer...');
            this.connect();
        }, 3000);
    }

    private subscribeToTicks() {
        if (!this.isConnected || !this.ws) return;

        this.VOLATILITY_SYMBOLS.forEach(symbol => {
            const ticksRequest = {
                ticks: symbol,
                subscribe: 1
            };

            this.ws!.send(JSON.stringify(ticksRequest));
            this.subscriptions.add(symbol);
        });

        // Set analysis ready after initial subscription
        setTimeout(() => {
            this.isMarketAnalysisReady = true;
        }, 2000);
    }

    private handleMessage(data: any) {
        if (data.msg_type === 'tick' && data.tick) {
            this.processTick(data.tick);
        }
    }

    private processTick(tick: any) {
        const symbol = tick.symbol;
        const symbolData = this.symbolData.get(symbol);
        
        if (!symbolData) return;

        const tickData: TickData = {
            epoch: tick.epoch,
            quote: tick.quote,
            symbol: symbol,
            last_digit: this.getLastDigit(tick.quote),
            timestamp: Date.now()
        };

        // Add tick to history
        symbolData.ticks.push(tickData);
        
        // Keep only last 200 ticks
        if (symbolData.ticks.length > 200) {
            symbolData.ticks.shift();
        }

        // Update digit frequency
        this.updateDigitFrequency(symbolData, tickData.last_digit);
        
        // Update last analysis time
        symbolData.lastAnalysis = Date.now();
    }

    private getLastDigit(quote: number): number {
        const quoteStr = quote.toFixed(5);
        return parseInt(quoteStr.slice(-1));
    }

    private updateDigitFrequency(symbolData: SymbolData, digit: number) {
        if (!symbolData.digitFrequency[digit]) {
            symbolData.digitFrequency[digit] = 0;
        }
        symbolData.digitFrequency[digit]++;
    }

    getAutoDifferRecommendation(): AutoDifferRecommendation | null {
        // Analyze all symbols and find best AutoDiffer opportunity
        let bestRecommendation: AutoDifferRecommendation | null = null;
        let bestConfidence = 0;

        for (const [symbol, data] of this.symbolData.entries()) {
            if (data.ticks.length < 50) continue;

            const recentTicks = data.ticks.slice(-50);
            const digitCounts = this.analyzeDigitDistribution(recentTicks);
            
            // Find most frequent digit
            let mostFrequentDigit = 0;
            let maxCount = 0;
            
            for (let digit = 0; digit <= 9; digit++) {
                if (digitCounts[digit] > maxCount) {
                    maxCount = digitCounts[digit];
                    mostFrequentDigit = digit;
                }
            }

            // Calculate confidence based on frequency deviation
            const avgCount = recentTicks.length / 10;
            const confidence = Math.min(90, ((maxCount - avgCount) / avgCount) * 100 + 50);

            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestRecommendation = {
                    symbol,
                    barrier: mostFrequentDigit,
                    confidence,
                    reason: `Digit ${mostFrequentDigit} appeared ${maxCount} times in last 50 ticks`
                };
            }
        }

        return bestRecommendation;
    }

    getOverUnderRecommendation(): OverUnderRecommendation | null {
        // Analyze patterns for Over/Under recommendations
        let bestRecommendation: OverUnderRecommendation | null = null;
        let bestConfidence = 0;

        for (const [symbol, data] of this.symbolData.entries()) {
            if (data.ticks.length < 30) continue;

            const recentTicks = data.ticks.slice(-30);
            const analysis = this.analyzeOverUnderPattern(recentTicks);

            if (analysis.confidence > bestConfidence) {
                bestConfidence = analysis.confidence;
                bestRecommendation = {
                    symbol,
                    contract_type: analysis.type,
                    barrier: analysis.barrier,
                    confidence: analysis.confidence,
                    reason: analysis.reason
                };
            }
        }

        return bestRecommendation;
    }

    getO5U4Recommendation(): O5U4Recommendation | null {
        // Specialized analysis for Over 5, Under 4 strategy
        let bestRecommendation: O5U4Recommendation | null = null;
        let bestConfidence = 0;

        for (const [symbol, data] of this.symbolData.entries()) {
            if (data.ticks.length < 60) continue;

            const recentTicks = data.ticks.slice(-60);
            const over5Count = recentTicks.filter(tick => tick.last_digit > 5).length;
            const under4Count = recentTicks.filter(tick => tick.last_digit < 4).length;

            const over5Ratio = over5Count / recentTicks.length;
            const under4Ratio = under4Count / recentTicks.length;

            let recommendation: O5U4Recommendation | null = null;

            if (over5Ratio < 0.3) {
                // Over 5 digits are rare, recommend Over 5
                const confidence = Math.min(85, (0.4 - over5Ratio) * 200);
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    recommendation = {
                        symbol,
                        contract_type: 'DIGITOVER',
                        barrier: 5,
                        confidence,
                        reason: `Only ${(over5Ratio * 100).toFixed(1)}% over 5 in last 60 ticks`
                    };
                }
            } else if (under4Ratio < 0.3) {
                // Under 4 digits are rare, recommend Under 4
                const confidence = Math.min(85, (0.4 - under4Ratio) * 200);
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    recommendation = {
                        symbol,
                        contract_type: 'DIGITUNDER',
                        barrier: 4,
                        confidence,
                        reason: `Only ${(under4Ratio * 100).toFixed(1)}% under 4 in last 60 ticks`
                    };
                }
            }

            if (recommendation) {
                bestRecommendation = recommendation;
            }
        }

        return bestRecommendation;
    }

    private analyzeDigitDistribution(ticks: TickData[]): { [key: number]: number } {
        const distribution: { [key: number]: number } = {};
        
        for (let digit = 0; digit <= 9; digit++) {
            distribution[digit] = 0;
        }

        ticks.forEach(tick => {
            distribution[tick.last_digit]++;
        });

        return distribution;
    }

    private analyzeOverUnderPattern(ticks: TickData[]): {
        type: 'DIGITOVER' | 'DIGITUNDER';
        barrier: number;
        confidence: number;
        reason: string;
    } {
        // Analyze for patterns in different barrier levels
        const barriers = [4, 5, 6];
        let bestAnalysis = {
            type: 'DIGITOVER' as const,
            barrier: 5,
            confidence: 0,
            reason: 'Default recommendation'
        };

        for (const barrier of barriers) {
            const overCount = ticks.filter(tick => tick.last_digit > barrier).length;
            const underCount = ticks.filter(tick => tick.last_digit <= barrier).length;
            
            const overRatio = overCount / ticks.length;
            const underRatio = underCount / ticks.length;

            // Look for imbalance
            if (overRatio < 0.35) {
                const confidence = Math.min(80, (0.5 - overRatio) * 160);
                if (confidence > bestAnalysis.confidence) {
                    bestAnalysis = {
                        type: 'DIGITOVER',
                        barrier,
                        confidence,
                        reason: `Only ${(overRatio * 100).toFixed(1)}% over ${barrier} recently`
                    };
                }
            } else if (underRatio < 0.35) {
                const confidence = Math.min(80, (0.5 - underRatio) * 160);
                if (confidence > bestAnalysis.confidence) {
                    bestAnalysis = {
                        type: 'DIGITUNDER',
                        barrier,
                        confidence,
                        reason: `Only ${(underRatio * 100).toFixed(1)}% under/equal ${barrier} recently`
                    };
                }
            }
        }

        return bestAnalysis;
    }

    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.isMarketAnalysisReady = false;
        this.subscriptions.clear();
    }
}

export const marketAnalyzer = new MarketAnalyzer();
