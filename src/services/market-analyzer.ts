
interface TickData {
    time: number;
    quote: number;
    last_digit?: number;
}

interface MarketStats {
    digitCounts: number[];
    digitPercentages: number[];
    overTwoPercentage: number;
    underSevenPercentage: number;
    sampleSize: number;
    recommendation: 'over' | 'under' | 'neutral';
    lastUpdated: number;
    mostFrequentDigit: number;
    currentLastDigit: number;
}

interface SymbolAnalysis {
    symbol: string;
    stats: MarketStats;
    tradingOpportunity: 'under7' | 'over2' | 'none';
    signalStrength: number;
}

export interface TradeRecommendation {
    symbol: string;
    strategy: 'over' | 'under';
    barrier: string;
    overPercentage: number;
    underPercentage: number;
    mostFrequentDigit: number;
    currentLastDigit: number;
    reason: string;
}

type AnalysisCallback = (recommendation: TradeRecommendation, allAnalyses: Record<string, MarketStats>) => void;

class MarketAnalyzer {
    private tickHistories: Record<string, TickData[]> = {};
    private websockets: Record<string, WebSocket> = {};
    private decimalPlaces: Record<string, number> = {};
    private symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'RDBEAR', 'RDBULL', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
    private marketStats: Record<string, MarketStats> = {};
    private tickCount = 100;
    private analysisCallbacks: AnalysisCallback[] = [];
    private isRunning = false;
    private analysisInterval: NodeJS.Timeout | null = null;
    private currentRecommendation: TradeRecommendation | null = null;
    private marketReadiness: Record<string, boolean> = {};
    private isAnalysisReady = false;
    private minSampleSize = 30;
    private analysisStartTime = 0;
    private minAnalysisPeriodMs = 5000;
    private historyLoadedCount = 0;
    private initialHistoryLoaded = false;
    private lastAnalysisTime = 0;
    private analysisCount = 0;

    constructor() {
        this.initializeAnalysis();
    }

    private initializeAnalysis() {
        this.symbols.forEach(symbol => {
            this.tickHistories[symbol] = [];
            this.decimalPlaces[symbol] = 2;
            this.marketStats[symbol] = this.createEmptyStats();
            this.marketReadiness[symbol] = false;
        });
        this.isAnalysisReady = false;
    }

    private createEmptyStats(): MarketStats {
        return {
            digitCounts: new Array(10).fill(0),
            digitPercentages: new Array(10).fill(0),
            overTwoPercentage: 0,
            underSevenPercentage: 0,
            sampleSize: 0,
            recommendation: 'neutral',
            lastUpdated: Date.now(),
            mostFrequentDigit: -1,
            currentLastDigit: -1,
        };
    }

    public start(): void {
        if (this.isRunning) return;

        console.log('Market analyzer starting...');
        this.isRunning = true;
        this.isAnalysisReady = false;
        this.analysisStartTime = Date.now();
        this.historyLoadedCount = 0;
        this.initialHistoryLoaded = false;

        this.symbols.forEach(symbol => {
            this.marketReadiness[symbol] = false;
        });

        this.symbols.forEach(symbol => {
            this.startWebSocket(symbol);
        });

        console.log(`Starting analysis with ${this.tickCount} ticks of historical data per symbol`);

        this.analysisInterval = setInterval(() => {
            if (this.initialHistoryLoaded) {
                this.runAnalysis();
            }
            this.checkAnalysisReadiness();
        }, 1000);
    }

    public stop(): void {
        console.log('Market analyzer stopping...');
        this.isRunning = false;

        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }

        Object.values(this.websockets).forEach(ws => {
            try {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            }
        });

        this.websockets = {};
    }

    public onAnalysis(callback: AnalysisCallback): () => void {
        this.analysisCallbacks.push(callback);

        if (this.currentRecommendation) {
            callback(this.currentRecommendation, { ...this.marketStats });
        }

        return () => {
            this.analysisCallbacks = this.analysisCallbacks.filter(cb => cb !== callback);
        };
    }

    public getCurrentRecommendation(): TradeRecommendation | null {
        return this.currentRecommendation;
    }

    public isReadyForTrading(): boolean {
        return this.isAnalysisReady;
    }

    public waitForAnalysisReady(): Promise<void> {
        return new Promise(resolve => {
            if (this.isAnalysisReady) {
                resolve();
                return;
            }

            const checkReadiness = setInterval(() => {
                if (this.isAnalysisReady) {
                    clearInterval(checkReadiness);
                    resolve();
                }
            }, 500);
        });
    }

    private checkAnalysisReadiness(): void {
        if (this.isAnalysisReady) return;

        let allMarketsReady = true;
        let readyCount = 0;

        for (const symbol of this.symbols) {
            const hasMinimumData = this.tickHistories[symbol].length >= this.minSampleSize;
            this.marketReadiness[symbol] = hasMinimumData;

            if (hasMinimumData) {
                readyCount++;
            } else {
                allMarketsReady = false;
            }
        }

        const hasMinAnalysisTime = Date.now() - this.analysisStartTime >= this.minAnalysisPeriodMs;

        if (!this.isAnalysisReady && this.isRunning) {
            console.log(
                `Analysis readiness check - Markets ready: ${readyCount}/${this.symbols.length}, Time condition: ${hasMinAnalysisTime}`
            );
        }

        if (allMarketsReady && hasMinAnalysisTime) {
            console.log('Market analysis ready - all markets have sufficient data');
            this.isAnalysisReady = true;
            this.runAnalysis();
        }
    }

    private startWebSocket(symbol: string): void {
        if (this.websockets[symbol]) {
            try {
                this.websockets[symbol].close();
            } catch (e) {
                console.error(`Error closing WebSocket for ${symbol}:`, e);
            }
        }

        const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=70827');
        this.websockets[symbol] = ws;

        ws.onopen = () => {
            console.log(`WebSocket connected for ${symbol}, requesting ${this.tickCount} historical ticks...`);
            this.requestTickHistory(symbol, ws);
        };

        ws.onmessage = event => {
            const data = JSON.parse(event.data);

            if (data.history) {
                this.historyLoadedCount++;
                const tickCount = data.history.prices.length;
                console.log(
                    `Received ${tickCount} historical ticks for ${symbol} (${this.historyLoadedCount}/${this.symbols.length})`
                );

                this.tickHistories[symbol] = data.history.prices.map((price: string, index: number) => ({
                    time: data.history.times[index],
                    quote: parseFloat(price),
                }));

                this.detectDecimalPlaces(symbol);
                this.processLastDigits(symbol);

                if (this.historyLoadedCount === this.symbols.length && !this.initialHistoryLoaded) {
                    this.initialHistoryLoaded = true;
                    console.log('Historical data loaded for all symbols, starting full analysis');
                    this.runAnalysis();
                    this.checkAnalysisReadiness();
                }
            } else if (data.tick) {
                const tickQuote = parseFloat(data.tick.quote);
                this.tickHistories[symbol].push({
                    time: data.tick.epoch,
                    quote: tickQuote,
                });

                if (this.tickHistories[symbol].length > this.tickCount) {
                    this.tickHistories[symbol].shift();
                }

                this.detectDecimalPlaces(symbol);
                this.processLastDigits(symbol);
            }
        };

        ws.onerror = error => {
            console.error(`WebSocket error for ${symbol}:`, error);
        };

        ws.onclose = () => {
            if (this.isRunning) {
                setTimeout(() => {
                    if (this.isRunning) {
                        this.startWebSocket(symbol);
                    }
                }, 5000);
            }
        };
    }

    private requestTickHistory(symbol: string, ws: WebSocket): void {
        const request = {
            ticks_history: symbol,
            count: this.tickCount,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
        };
        console.log(`Requesting ${this.tickCount} ticks of history for ${symbol}`);
        ws.send(JSON.stringify(request));
    }

    private detectDecimalPlaces(symbol: string): void {
        const tickHistory = this.tickHistories[symbol];
        if (tickHistory.length === 0) return;

        const decimalCounts = tickHistory.map(tick => {
            const decimalPart = tick.quote.toString().split('.')[1] || '';
            return decimalPart.length;
        });

        this.decimalPlaces[symbol] = Math.max(...decimalCounts, 2);
    }

    private processLastDigits(symbol: string): void {
        const tickHistory = this.tickHistories[symbol];

        tickHistory.forEach(tick => {
            if (tick.last_digit === undefined) {
                tick.last_digit = this.getLastDigit(tick.quote, symbol);
            }
        });
    }

    private getLastDigit(price: number, symbol: string): number {
        const priceStr = price.toString();
        const priceParts = priceStr.split('.');
        let decimals = priceParts[1] || '';

        while (decimals.length < this.decimalPlaces[symbol]) {
            decimals += '0';
        }

        return Number(decimals.slice(-1));
    }

    private runAnalysis(): void {
        if (!this.isRunning) return;

        if (!this.initialHistoryLoaded) {
            console.log('Waiting for historical data to load for all symbols...');
            return;
        }

        this.analysisCount++;
        this.lastAnalysisTime = Date.now();

        let bestSymbol = '';
        let bestOpportunity: SymbolAnalysis | null = null;
        let highestSignalStrength = 0;

        for (const symbol of this.symbols) {
            const tickHistory = this.tickHistories[symbol];
            if (!tickHistory || tickHistory.length < this.minSampleSize) continue;

            const analysis = this.analyzeSymbolForOpportunity(symbol, tickHistory);
            if (analysis.signalStrength > highestSignalStrength) {
                highestSignalStrength = analysis.signalStrength;
                bestSymbol = symbol;
                bestOpportunity = analysis;
            }
        }

        if (bestOpportunity && highestSignalStrength > 0.7) {
            const recommendation: TradeRecommendation = {
                symbol: bestSymbol,
                strategy: bestOpportunity.tradingOpportunity === 'under7' ? 'under' : 'over',
                barrier: bestOpportunity.tradingOpportunity === 'under7' ? '6' : '3',
                overPercentage: bestOpportunity.stats.overTwoPercentage,
                underPercentage: bestOpportunity.stats.underSevenPercentage,
                mostFrequentDigit: bestOpportunity.stats.mostFrequentDigit,
                currentLastDigit: bestOpportunity.stats.currentLastDigit,
                reason: `Strong ${bestOpportunity.tradingOpportunity} signal with ${(highestSignalStrength * 100).toFixed(1)}% confidence on ${bestSymbol}`
            };

            this.currentRecommendation = recommendation;
            this.analysisCallbacks.forEach(callback => {
                callback(recommendation, { ...this.marketStats });
            });
        }
    }

    private analyzeSymbolForOpportunity(symbol: string, tickHistory: TickData[]): SymbolAnalysis {
        const digitCounts = new Array(10).fill(0);
        tickHistory.forEach(tick => {
            const digit = tick.last_digit || 0;
            digitCounts[digit]++;
        });

        const totalTicks = tickHistory.length;
        const digitPercentages = digitCounts.map(count => (count / totalTicks) * 100);

        const underSevenCount = digitCounts.slice(0, 7).reduce((a, b) => a + b, 0);
        const overTwoCount = digitCounts.slice(3).reduce((a, b) => a + b, 0);

        const underSevenPercentage = (underSevenCount / totalTicks) * 100;
        const overTwoPercentage = (overTwoCount / totalTicks) * 100;

        const mostFrequentDigit = digitCounts.indexOf(Math.max(...digitCounts));
        const currentLastDigit = tickHistory[tickHistory.length - 1]?.last_digit || 0;

        const stats: MarketStats = {
            digitCounts,
            digitPercentages,
            overTwoPercentage,
            underSevenPercentage,
            sampleSize: totalTicks,
            recommendation: underSevenPercentage > 65 ? 'under' : overTwoPercentage > 65 ? 'over' : 'neutral',
            lastUpdated: Date.now(),
            mostFrequentDigit,
            currentLastDigit,
        };

        this.marketStats[symbol] = stats;

        let tradingOpportunity: 'under7' | 'over2' | 'none' = 'none';
        let signalStrength = 0;

        if (underSevenPercentage > 65) {
            tradingOpportunity = 'under7';
            signalStrength = Math.min((underSevenPercentage - 60) / 20, 1);
        } else if (overTwoPercentage > 65) {
            tradingOpportunity = 'over2';
            signalStrength = Math.min((overTwoPercentage - 60) / 20, 1);
        }

        return {
            symbol,
            stats,
            tradingOpportunity,
            signalStrength,
        };
    }
}

export const marketAnalyzer = new MarketAnalyzer();
