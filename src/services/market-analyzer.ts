
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
    score?: number;
}

interface MarketStats {
    symbol: string;
    lastDigitFrequency: Record<number, number>;
    overUnderStats: Record<string, { over: number; under: number }>;
    confidence: number;
    tickCount: number;
    lastUpdate: number;
    mostFrequentDigit: number;
    leastFrequentDigit: number;
    currentLastDigit: number;
    isReady: boolean;
}

interface O5U4Conditions {
    symbol: string;
    conditionsMetCount: number;
    score: number;
    details: {
        condition1: boolean; // Current last digit is 4 or 5
        condition2: boolean; // Least appearing digit is 4 or 5
        condition3: boolean; // Most appearing digit is >5 or <4
        sampleSize: number;
        frequencyDifference: number;
    };
}

class MarketAnalyzer {
    private tickHistory: Map<string, TickData[]> = new Map();
    private subscribers: ((recommendation: TradeRecommendation | null, stats: Record<string, MarketStats>, o5u4Data?: O5U4Conditions[]) => void)[] = [];
    private analysisInterval: NodeJS.Timeout | null = null;
    private isRunning = false;
    private analyticsInfo = {
        analysisCount: 0,
        lastAnalysisTime: 0
    };

    // Extended symbol list including all volatility indices
    private readonly SYMBOLS = [
        'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
        'RDBEAR', 'RDBULL',
        '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
    ];
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
        console.log('Enhanced Market Analyzer started with multi-symbol analysis');

        // Start analysis interval - more frequent for real-time analysis
        this.analysisInterval = setInterval(() => {
            this.performAdvancedAnalysis();
        }, 1500); // Analyze every 1.5 seconds for faster recommendations

        // Simulate tick data for all symbols
        this.startTickSimulation();
    }

    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }

        console.log('Enhanced Market Analyzer stopped');
    }

    private startTickSimulation() {
        // Simulate tick data for all symbols with different characteristics
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
            
            // Generate realistic price movement with volatility characteristics
            const randomChange = (Math.random() - 0.5) * volatility;
            const quote = basePrice + randomChange;
            
            // Calculate last digit more realistically for different symbols
            const multiplier = this.getDigitMultiplier(symbol);
            const last_digit = Math.floor((quote * multiplier) % 10);

            const tick: TickData = {
                time: now,
                quote,
                last_digit
            };

            this.addTick(symbol, tick);

            // Different tick frequencies for different symbols
            const nextTickDelay = this.getTickDelay(symbol);
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
            'R_100': 10000.0,
            'RDBEAR': 8500.0,
            'RDBULL': 9500.0,
            '1HZ10V': 1100.0,
            '1HZ25V': 2600.0,
            '1HZ50V': 5100.0,
            '1HZ75V': 7600.0,
            '1HZ100V': 10100.0
        };
        return basePrices[symbol] || 1000.0;
    }

    private getVolatility(symbol: string): number {
        const volatilities = {
            'R_10': 0.1,
            'R_25': 0.25,
            'R_50': 0.5,
            'R_75': 0.75,
            'R_100': 1.0,
            'RDBEAR': 0.8,
            'RDBULL': 0.9,
            '1HZ10V': 0.15,
            '1HZ25V': 0.3,
            '1HZ50V': 0.6,
            '1HZ75V': 0.8,
            '1HZ100V': 1.1
        };
        return volatilities[symbol] || 0.5;
    }

    private getDigitMultiplier(symbol: string): number {
        // Different multipliers to get realistic digit distributions
        const multipliers = {
            'R_10': 10000,
            'R_25': 10000,
            'R_50': 10000,
            'R_75': 10000,
            'R_100': 10000,
            'RDBEAR': 10000,
            'RDBULL': 10000,
            '1HZ10V': 100000,
            '1HZ25V': 100000,
            '1HZ50V': 100000,
            '1HZ75V': 100000,
            '1HZ100V': 100000
        };
        return multipliers[symbol] || 10000;
    }

    private getTickDelay(symbol: string): number {
        // High-frequency symbols tick faster for better pattern detection
        const baseDelay = symbol.includes('1HZ') ? 600 : 1000;
        return baseDelay + Math.random() * 800;
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

    private performAdvancedAnalysis() {
        if (!this.isRunning) return;

        this.analyticsInfo.analysisCount++;
        this.analyticsInfo.lastAnalysisTime = Date.now();

        const stats: Record<string, MarketStats> = {};
        const o5u4Opportunities: O5U4Conditions[] = [];
        
        let bestOverUnderRecommendation: TradeRecommendation | null = null;
        let bestOverUnderConfidence = 0;

        // Analyze each symbol
        this.SYMBOLS.forEach(symbol => {
            const ticks = this.tickHistory.get(symbol) || [];
            
            if (ticks.length < this.MIN_TICKS_FOR_ANALYSIS) {
                stats[symbol] = this.createEmptyStats(symbol);
                return;
            }

            const symbolStats = this.analyzeSymbolAdvanced(symbol, ticks);
            stats[symbol] = symbolStats;

            // Generate Over/Under recommendations
            const overUnderRecs = this.generateAdvancedOverUnderRecommendations(symbol, symbolStats);
            overUnderRecs.forEach(rec => {
                if (rec.confidence > bestOverUnderConfidence) {
                    bestOverUnderConfidence = rec.confidence;
                    bestOverUnderRecommendation = rec;
                }
            });

            // Check O5U4 conditions
            const o5u4Condition = this.checkO5U4Conditions(symbol, symbolStats);
            if (o5u4Condition.conditionsMetCount >= 3) {
                o5u4Opportunities.push(o5u4Condition);
            }
        });

        // Sort O5U4 opportunities by score
        o5u4Opportunities.sort((a, b) => b.score - a.score);

        // Debug logging for recommendation generation
        if (bestOverUnderRecommendation) {
            console.log('🤖 AI Generated Over/Under Recommendation:', {
                symbol: bestOverUnderRecommendation.symbol,
                strategy: bestOverUnderRecommendation.strategy,
                barrier: bestOverUnderRecommendation.barrier,
                confidence: bestOverUnderRecommendation.confidence.toFixed(1) + '%',
                reason: bestOverUnderRecommendation.reason
            });
        } else {
            const readySymbols = Object.keys(stats).filter(symbol => stats[symbol].isReady);
            console.log('🔍 AI Analysis Complete - No recommendations generated', {
                readySymbols: readySymbols.length,
                symbolsAnalyzed: Object.keys(stats).length
            });
        }

        // Notify subscribers with enhanced data
        this.subscribers.forEach(callback => {
            callback(bestOverUnderRecommendation, stats, o5u4Opportunities);
        });
    }

    private analyzeSymbolAdvanced(symbol: string, ticks: TickData[]): MarketStats {
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

        // Analyze recent ticks (last 100 for better real-time analysis)
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

        // Find most and least frequent digits
        let mostFrequentDigit = 0;
        let leastFrequentDigit = 0;
        let maxCount = lastDigitFrequency[0];
        let minCount = lastDigitFrequency[0];

        for (let i = 1; i < 10; i++) {
            if (lastDigitFrequency[i] > maxCount) {
                maxCount = lastDigitFrequency[i];
                mostFrequentDigit = i;
            }
            if (lastDigitFrequency[i] < minCount) {
                minCount = lastDigitFrequency[i];
                leastFrequentDigit = i;
            }
        }

        // Calculate confidence based on data variance and sample size
        const frequencies = Object.values(lastDigitFrequency);
        const average = frequencies.reduce((a, b) => a + b, 0) / frequencies.length;
        const variance = frequencies.reduce((acc, freq) => acc + Math.pow(freq - average, 2), 0) / frequencies.length;
        const confidence = Math.min((variance / 10) * (recentTicks.length / 100), 1) * 100;

        const currentLastDigit = recentTicks.length > 0 ? recentTicks[recentTicks.length - 1].last_digit : 0;

        return {
            symbol,
            lastDigitFrequency,
            overUnderStats,
            confidence,
            tickCount: recentTicks.length,
            lastUpdate: Date.now(),
            mostFrequentDigit,
            leastFrequentDigit,
            currentLastDigit,
            isReady: recentTicks.length >= this.MIN_TICKS_FOR_ANALYSIS
        };
    }

    private generateAdvancedOverUnderRecommendations(symbol: string, stats: MarketStats): TradeRecommendation[] {
        const recommendations: TradeRecommendation[] = [];

        // Enhanced AI pattern recognition logic
        const { mostFrequentDigit, leastFrequentDigit, currentLastDigit, lastDigitFrequency, confidence: baseConfidence } = stats;
        
        // Calculate frequency percentages and patterns
        const totalTicks = Object.values(lastDigitFrequency).reduce((a, b) => a + b, 0);
        const mostFreqPercent = (lastDigitFrequency[mostFrequentDigit] / totalTicks) * 100;
        const currentDigitFreq = (lastDigitFrequency[currentLastDigit] / totalTicks) * 100;
        
        // Calculate frequency variance for pattern strength
        const avgFrequency = totalTicks / 10;
        const variance = Object.values(lastDigitFrequency).reduce((acc, freq) => 
            acc + Math.pow(freq - avgFrequency, 2), 0) / 10;
        const patternStrength = Math.min(variance / avgFrequency, 1);

        // UNDER 7 Logic: Advanced AI Pattern Recognition
        // Condition: Most frequent digit is low (0,1,2) AND current digit is high (7,8,9)
        if ([0, 1, 2].includes(mostFrequentDigit) && [7, 8, 9].includes(currentLastDigit)) {
            // Enhanced confidence calculation
            let aiConfidence = 65; // Base AI confidence
            
            // Pattern matching bonuses
            aiConfidence += Math.min(mostFreqPercent - 15, 20); // Up to 20 points for frequency dominance
            aiConfidence += patternStrength * 15; // Up to 15 points for pattern strength
            
            // Additional AI logic bonuses
            if (currentDigitFreq < 8) aiConfidence += 10; // Current digit is rare
            if ([8, 9].includes(currentLastDigit)) aiConfidence += 5; // Extra high current digit
            if (mostFrequentDigit <= 1) aiConfidence += 8; // Very low most frequent
            
            // Sample size bonus
            const sampleBonus = Math.min((totalTicks - 50) / 50 * 5, 10);
            aiConfidence += sampleBonus;
            
            aiConfidence = Math.min(aiConfidence, 95); // Cap at 95%
            
            if (aiConfidence > 72) {
                recommendations.push({
                    symbol,
                    strategy: 'under',
                    barrier: '7',
                    confidence: aiConfidence,
                    overPercentage: 0,
                    underPercentage: aiConfidence,
                    reason: `AI Pattern Recognition: Most frequent digit ${mostFrequentDigit} (${mostFreqPercent.toFixed(1)}%), current ${currentLastDigit} (high) - Pattern strength: ${(patternStrength * 100).toFixed(1)}%`,
                    timestamp: Date.now(),
                    score: aiConfidence
                });
            }
        }

        // OVER 2 Logic: Advanced AI Pattern Recognition  
        // Condition: Most frequent digit is high (7,8,9) AND current digit is low (0,1,2)
        if ([7, 8, 9].includes(mostFrequentDigit) && [0, 1, 2].includes(currentLastDigit)) {
            // Enhanced confidence calculation
            let aiConfidence = 65; // Base AI confidence
            
            // Pattern matching bonuses
            aiConfidence += Math.min(mostFreqPercent - 15, 20); // Up to 20 points for frequency dominance
            aiConfidence += patternStrength * 15; // Up to 15 points for pattern strength
            
            // Additional AI logic bonuses
            if (currentDigitFreq < 8) aiConfidence += 10; // Current digit is rare
            if ([0, 1].includes(currentLastDigit)) aiConfidence += 5; // Extra low current digit
            if (mostFrequentDigit >= 8) aiConfidence += 8; // Very high most frequent
            
            // Sample size bonus
            const sampleBonus = Math.min((totalTicks - 50) / 50 * 5, 10);
            aiConfidence += sampleBonus;
            
            aiConfidence = Math.min(aiConfidence, 95); // Cap at 95%
            
            if (aiConfidence > 72) {
                recommendations.push({
                    symbol,
                    strategy: 'over',
                    barrier: '2',
                    confidence: aiConfidence,
                    overPercentage: aiConfidence,
                    underPercentage: 0,
                    reason: `AI Pattern Recognition: Most frequent digit ${mostFrequentDigit} (${mostFreqPercent.toFixed(1)}%), current ${currentLastDigit} (low) - Pattern strength: ${(patternStrength * 100).toFixed(1)}%`,
                    timestamp: Date.now(),
                    score: aiConfidence
                });
            }
        }

        // Secondary patterns for additional opportunities
        // UNDER 6 Logic: When there's a strong bias towards lower digits
        const lowDigitCount = [0,1,2,3,4].reduce((sum, digit) => sum + lastDigitFrequency[digit], 0);
        const lowDigitPercent = (lowDigitCount / totalTicks) * 100;
        
        if (lowDigitPercent > 65 && [7, 8, 9].includes(currentLastDigit) && recommendations.length === 0) {
            const confidence = Math.min(60 + (lowDigitPercent - 65) * 2, 85);
            if (confidence > 70) {
                recommendations.push({
                    symbol,
                    strategy: 'under',
                    barrier: '6',
                    confidence,
                    overPercentage: 0,
                    underPercentage: confidence,
                    reason: `AI Secondary Pattern: Strong low digit bias (${lowDigitPercent.toFixed(1)}%), current ${currentLastDigit} (high)`,
                    timestamp: Date.now(),
                    score: confidence
                });
            }
        }

        // OVER 3 Logic: When there's a strong bias towards higher digits  
        const highDigitCount = [5,6,7,8,9].reduce((sum, digit) => sum + lastDigitFrequency[digit], 0);
        const highDigitPercent = (highDigitCount / totalTicks) * 100;
        
        if (highDigitPercent > 65 && [0, 1, 2].includes(currentLastDigit) && recommendations.length === 0) {
            const confidence = Math.min(60 + (highDigitPercent - 65) * 2, 85);
            if (confidence > 70) {
                recommendations.push({
                    symbol,
                    strategy: 'over',
                    barrier: '3',
                    confidence,
                    overPercentage: confidence,
                    underPercentage: 0,
                    reason: `AI Secondary Pattern: Strong high digit bias (${highDigitPercent.toFixed(1)}%), current ${currentLastDigit} (low)`,
                    timestamp: Date.now(),
                    score: confidence
                });
            }
        }

        return recommendations;
    }

    private checkO5U4Conditions(symbol: string, stats: MarketStats): O5U4Conditions {
        const { currentLastDigit, mostFrequentDigit, leastFrequentDigit, lastDigitFrequency } = stats;
        
        // Condition 1: Current last digit is 4 or 5
        const condition1 = [4, 5].includes(currentLastDigit);
        
        // Condition 2: Least appearing digit is 4 or 5
        const condition2 = [4, 5].includes(leastFrequentDigit);
        
        // Condition 3: Most appearing digit is >5 (6,7,8,9) or <4 (0,1,2,3)
        const condition3 = mostFrequentDigit > 5 || mostFrequentDigit < 4;
        
        const conditionsMetCount = [condition1, condition2, condition3].filter(Boolean).length;
        
        // Calculate score based on frequency difference and sample size
        const totalTicks = Object.values(lastDigitFrequency).reduce((a, b) => a + b, 0);
        const mostFreqCount = lastDigitFrequency[mostFrequentDigit];
        const leastFreqCount = lastDigitFrequency[leastFrequentDigit];
        const frequencyDifference = mostFreqCount - leastFreqCount;
        
        // Score calculation: conditions met (30 points each) + frequency difference (up to 40 points)
        let score = conditionsMetCount * 30;
        score += Math.min((frequencyDifference / totalTicks) * 100 * 4, 40); // Frequency difference bonus
        score += Math.min(totalTicks / 100 * 10, 10); // Sample size bonus

        return {
            symbol,
            conditionsMetCount,
            score,
            details: {
                condition1,
                condition2,
                condition3,
                sampleSize: totalTicks,
                frequencyDifference
            }
        };
    }

    private createEmptyStats(symbol: string): MarketStats {
        return {
            symbol,
            lastDigitFrequency: {},
            overUnderStats: {},
            confidence: 0,
            tickCount: 0,
            lastUpdate: Date.now(),
            mostFrequentDigit: 0,
            leastFrequentDigit: 0,
            currentLastDigit: 0,
            isReady: false
        };
    }

    onAnalysis(callback: (recommendation: TradeRecommendation | null, stats: Record<string, MarketStats>, o5u4Data?: O5U4Conditions[]) => void) {
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
        // Check if we have sufficient data for at least 3 symbols
        let readyCount = 0;
        for (const symbol of this.SYMBOLS) {
            const ticks = this.tickHistory.get(symbol) || [];
            if (ticks.length >= this.MIN_TICKS_FOR_ANALYSIS) {
                readyCount++;
            }
        }
        return readyCount >= 3;
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

    // Get ready symbols count
    getReadySymbolsCount(): number {
        let count = 0;
        this.SYMBOLS.forEach(symbol => {
            const ticks = this.tickHistory.get(symbol) || [];
            if (ticks.length >= this.MIN_TICKS_FOR_ANALYSIS) {
                count++;
            }
        });
        return count;
    }

    // Get best O5U4 opportunity
    getBestO5U4Opportunity(o5u4Data: O5U4Conditions[]): O5U4Conditions | null {
        return o5u4Data.length > 0 ? o5u4Data[0] : null;
    }
}

// Create a singleton instance
const marketAnalyzer = new MarketAnalyzer();

export default marketAnalyzer;
export type { O5U4Conditions, MarketStats };
