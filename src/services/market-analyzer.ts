
interface TickData {
    time: number;
    quote: number;
    last_digit: number;
}

export interface TradeRecommendation {
    symbol: string;
    strategy: 'over' | 'under' | 'differ';
    barrier: string;
    confidence: number;
    overPercentage: number;
    underPercentage: number;
    reason: string;
    timestamp: number;
}

interface MarketStats {
    symbol: string;
    lastDigitFrequency: Record<number, number>;
    overUnderStats: Record<string, { over: number; under: number }>;
    confidence: number;
    tickCount: number;
    lastUpdate: number;
}

class MarketAnalyzer {
    private tickHistory: Map<string, TickData[]> = new Map();
    private subscribers: ((recommendation: TradeRecommendation | null, stats: Record<string, MarketStats>) => void)[] = [];
    private analysisInterval: NodeJS.Timeout | null = null;
    private isRunning = false;
    private analyticsInfo = {
        analysisCount: 0,
        lastAnalysisTime: 0
    };

    private readonly SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
    private readonly MAX_TICK_HISTORY = 200;
    private readonly MIN_TICKS_FOR_ANALYSIS = 50;

    constructor() {
        // Initialize tick history for all symbols
        this.SYMBOLS.forEach(symbol => {
            this.tickHistory.set(symbol, []);
        });
    }

    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('Market Analyzer started');

        // Start analysis interval
        this.analysisInterval = setInterval(() => {
            this.performAnalysis();
        }, 3000); // Analyze every 3 seconds

        // Simulate tick data for demo purposes
        this.startTickSimulation();
    }

    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }

        console.log('Market Analyzer stopped');
    }

    private startTickSimulation() {
        // Simulate tick data for all symbols
        this.SYMBOLS.forEach(symbol => {
            this.simulateTicksForSymbol(symbol);
        });
    }

    private simulateTicksForSymbol(symbol: string) {
        const generateTick = () => {
            if (!this.isRunning) return;

            const now = Date.now();
            const basePrice = this.getBasePrice(symbol);
            const volatility = this.getVolatility(symbol);
            
            // Generate random price movement
            const randomChange = (Math.random() - 0.5) * volatility;
            const quote = basePrice + randomChange;
            const last_digit = Math.floor((quote * 10000) % 10);

            const tick: TickData = {
                time: now,
                quote,
                last_digit
            };

            this.addTick(symbol, tick);

            // Schedule next tick (1-3 seconds)
            const nextTickDelay = 1000 + Math.random() * 2000;
            setTimeout(generateTick, nextTickDelay);
        };

        generateTick();
    }

    private getBasePrice(symbol: string): number {
        const basePrices = {
            'R_10': 1000.5,
            'R_25': 2500.75,
            'R_50': 5000.25,
            'R_75': 7500.5,
            'R_100': 10000.0
        };
        return basePrices[symbol] || 1000.0;
    }

    private getVolatility(symbol: string): number {
        const volatilities = {
            'R_10': 0.1,
            'R_25': 0.25,
            'R_50': 0.5,
            'R_75': 0.75,
            'R_100': 1.0
        };
        return volatilities[symbol] || 0.5;
    }

    private addTick(symbol: string, tick: TickData) {
        const ticks = this.tickHistory.get(symbol) || [];
        ticks.push(tick);

        // Maintain max history
        if (ticks.length > this.MAX_TICK_HISTORY) {
            ticks.shift();
        }

        this.tickHistory.set(symbol, ticks);
    }

    private performAnalysis() {
        if (!this.isRunning) return;

        this.analyticsInfo.analysisCount++;
        this.analyticsInfo.lastAnalysisTime = Date.now();

        const stats: Record<string, MarketStats> = {};
        let bestRecommendation: TradeRecommendation | null = null;
        let bestConfidence = 0;

        // Analyze each symbol
        this.SYMBOLS.forEach(symbol => {
            const ticks = this.tickHistory.get(symbol) || [];
            
            if (ticks.length < this.MIN_TICKS_FOR_ANALYSIS) return;

            const symbolStats = this.analyzeSymbol(symbol, ticks);
            stats[symbol] = symbolStats;

            // Generate recommendations
            const recommendations = this.generateRecommendations(symbol, symbolStats);
            
            // Find best recommendation
            recommendations.forEach(rec => {
                if (rec.confidence > bestConfidence) {
                    bestConfidence = rec.confidence;
                    bestRecommendation = rec;
                }
            });
        });

        // Notify subscribers
        this.subscribers.forEach(callback => {
            callback(bestRecommendation, stats);
        });
    }

    private analyzeSymbol(symbol: string, ticks: TickData[]): MarketStats {
        const lastDigitFrequency: Record<number, number> = {};
        const overUnderStats: Record<string, { over: number; under: number }> = {};

        // Initialize frequency counters
        for (let i = 0; i <= 9; i++) {
            lastDigitFrequency[i] = 0;
        }

        // Initialize over/under stats for barriers 0-9
        for (let barrier = 0; barrier <= 9; barrier++) {
            overUnderStats[barrier.toString()] = { over: 0, under: 0 };
        }

        // Analyze last 100 ticks
        const recentTicks = ticks.slice(-100);
        
        recentTicks.forEach(tick => {
            const digit = tick.last_digit;
            lastDigitFrequency[digit]++;

            // Calculate over/under for each barrier
            for (let barrier = 0; barrier <= 9; barrier++) {
                if (digit > barrier) {
                    overUnderStats[barrier.toString()].over++;
                } else if (digit < barrier) {
                    overUnderStats[barrier.toString()].under++;
                }
            }
        });

        // Calculate confidence based on data variance
        const frequencies = Object.values(lastDigitFrequency);
        const average = frequencies.reduce((a, b) => a + b, 0) / frequencies.length;
        const variance = frequencies.reduce((acc, freq) => acc + Math.pow(freq - average, 2), 0) / frequencies.length;
        const confidence = Math.min(variance / 10, 1) * 100; // Convert to percentage

        return {
            symbol,
            lastDigitFrequency,
            overUnderStats,
            confidence,
            tickCount: recentTicks.length,
            lastUpdate: Date.now()
        };
    }

    private generateRecommendations(symbol: string, stats: MarketStats): TradeRecommendation[] {
        const recommendations: TradeRecommendation[] = [];

        // Generate over/under recommendations for barriers 3-7
        for (let barrier = 3; barrier <= 7; barrier++) {
            const barrierStats = stats.overUnderStats[barrier.toString()];
            const total = barrierStats.over + barrierStats.under;
            
            if (total < 20) continue; // Need sufficient data

            const overPercentage = (barrierStats.over / total) * 100;
            const underPercentage = (barrierStats.under / total) * 100;

            // Look for significant bias (>60% in one direction)
            if (overPercentage > 60) {
                recommendations.push({
                    symbol,
                    strategy: 'over',
                    barrier: barrier.toString(),
                    confidence: overPercentage,
                    overPercentage,
                    underPercentage,
                    reason: `${overPercentage.toFixed(1)}% over barrier ${barrier} bias detected`,
                    timestamp: Date.now()
                });
            } else if (underPercentage > 60) {
                recommendations.push({
                    symbol,
                    strategy: 'under',
                    barrier: barrier.toString(),
                    confidence: underPercentage,
                    overPercentage,
                    underPercentage,
                    reason: `${underPercentage.toFixed(1)}% under barrier ${barrier} bias detected`,
                    timestamp: Date.now()
                });
            }
        }

        // Generate differ recommendations based on digit frequency patterns
        const digitFreqs = Object.values(stats.lastDigitFrequency);
        const maxFreq = Math.max(...digitFreqs);
        const minFreq = Math.min(...digitFreqs);
        
        if (maxFreq > minFreq * 2) { // Significant imbalance
            const confidence = Math.min(((maxFreq - minFreq) / maxFreq) * 100, 95);
            
            if (confidence > 65) {
                recommendations.push({
                    symbol,
                    strategy: 'differ',
                    barrier: '0',
                    confidence,
                    overPercentage: 0,
                    underPercentage: 0,
                    reason: `Strong digit imbalance detected (${confidence.toFixed(1)}% confidence)`,
                    timestamp: Date.now()
                });
            }
        }

        return recommendations;
    }

    onAnalysis(callback: (recommendation: TradeRecommendation | null, stats: Record<string, MarketStats>) => void) {
        this.subscribers.push(callback);
        
        // Return unsubscribe function
        return () => {
            const index = this.subscribers.indexOf(callback);
            if (index > -1) {
                this.subscribers.splice(index, 1);
            }
        };
    }

    isReadyForTrading(): boolean {
        // Check if we have sufficient data for at least one symbol
        for (const symbol of this.SYMBOLS) {
            const ticks = this.tickHistory.get(symbol) || [];
            if (ticks.length >= this.MIN_TICKS_FOR_ANALYSIS) {
                return true;
            }
        }
        return false;
    }

    getAnalyticsInfo() {
        return { ...this.analyticsInfo };
    }

    // Get current market data for a symbol
    getSymbolData(symbol: string) {
        return this.tickHistory.get(symbol) || [];
    }

    // Get latest tick for a symbol
    getLatestTick(symbol: string): TickData | null {
        const ticks = this.tickHistory.get(symbol) || [];
        return ticks.length > 0 ? ticks[ticks.length - 1] : null;
    }
}

// Create a singleton instance
const marketAnalyzer = new MarketAnalyzer();

export default marketAnalyzer;
