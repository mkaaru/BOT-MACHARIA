
export interface SymbolPattern {
    symbol: string;
    pattern: 'ASCENDING' | 'DESCENDING' | 'CONSOLIDATION' | 'BREAKOUT';
    strength: number;
    duration: number;
    confidence: number;
}

export interface DigitFrequency {
    digit: number;
    frequency: number;
    trend: 'INCREASING' | 'DECREASING' | 'STABLE';
    lastSeen: Date;
}

export interface SymbolAnalysis {
    symbol: string;
    patterns: SymbolPattern[];
    digitFrequencies: DigitFrequency[];
    overUnderRatio: {
        over: number;
        under: number;
        threshold: number;
    };
    recommendation: {
        action: 'OVER' | 'UNDER' | 'EXACT' | 'DIFFERS';
        target: number;
        confidence: number;
    };
}

class SymbolAnalyzer {
    private digitHistory: Map<string, number[]> = new Map();
    private patternCache: Map<string, SymbolPattern[]> = new Map();
    private analysisInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.initializeHistoryData();
        this.startContinuousAnalysis();
    }

    private initializeHistoryData(): void {
        const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
        
        symbols.forEach(symbol => {
            // Generate random historical digit data
            const history = Array.from({ length: 100 }, () => Math.floor(Math.random() * 10));
            this.digitHistory.set(symbol, history);
        });
    }

    private startContinuousAnalysis(): void {
        this.analysisInterval = setInterval(() => {
            this.updateDigitHistory();
            this.updatePatternAnalysis();
        }, 2000);
    }

    private updateDigitHistory(): void {
        this.digitHistory.forEach((history, symbol) => {
            // Add new random digit
            const newDigit = Math.floor(Math.random() * 10);
            history.push(newDigit);
            
            // Keep only last 200 digits
            if (history.length > 200) {
                history.shift();
            }
            
            this.digitHistory.set(symbol, history);
        });
    }

    private updatePatternAnalysis(): void {
        this.digitHistory.forEach((history, symbol) => {
            const patterns = this.identifyPatterns(history);
            this.patternCache.set(symbol, patterns);
        });
    }

    private identifyPatterns(digits: number[]): SymbolPattern[] {
        const patterns: SymbolPattern[] = [];
        
        if (digits.length < 20) return patterns;

        // Analyze recent 50 digits for patterns
        const recentDigits = digits.slice(-50);
        
        // Check for ascending pattern
        const ascendingStrength = this.calculateAscendingPattern(recentDigits);
        if (ascendingStrength > 0.3) {
            patterns.push({
                symbol: '',
                pattern: 'ASCENDING',
                strength: ascendingStrength,
                duration: this.calculatePatternDuration(recentDigits, 'ASCENDING'),
                confidence: ascendingStrength * 100
            });
        }

        // Check for descending pattern
        const descendingStrength = this.calculateDescendingPattern(recentDigits);
        if (descendingStrength > 0.3) {
            patterns.push({
                symbol: '',
                pattern: 'DESCENDING',
                strength: descendingStrength,
                duration: this.calculatePatternDuration(recentDigits, 'DESCENDING'),
                confidence: descendingStrength * 100
            });
        }

        // Check for consolidation
        const consolidationStrength = this.calculateConsolidation(recentDigits);
        if (consolidationStrength > 0.4) {
            patterns.push({
                symbol: '',
                pattern: 'CONSOLIDATION',
                strength: consolidationStrength,
                duration: this.calculatePatternDuration(recentDigits, 'CONSOLIDATION'),
                confidence: consolidationStrength * 100
            });
        }

        // Check for breakout potential
        const breakoutStrength = this.calculateBreakoutPotential(recentDigits);
        if (breakoutStrength > 0.5) {
            patterns.push({
                symbol: '',
                pattern: 'BREAKOUT',
                strength: breakoutStrength,
                duration: 5, // Breakouts are typically short-term
                confidence: breakoutStrength * 100
            });
        }

        return patterns;
    }

    private calculateAscendingPattern(digits: number[]): number {
        let ascendingCount = 0;
        for (let i = 1; i < digits.length; i++) {
            if (digits[i] > digits[i - 1]) {
                ascendingCount++;
            }
        }
        return ascendingCount / (digits.length - 1);
    }

    private calculateDescendingPattern(digits: number[]): number {
        let descendingCount = 0;
        for (let i = 1; i < digits.length; i++) {
            if (digits[i] < digits[i - 1]) {
                descendingCount++;
            }
        }
        return descendingCount / (digits.length - 1);
    }

    private calculateConsolidation(digits: number[]): number {
        const average = digits.reduce((sum, digit) => sum + digit, 0) / digits.length;
        const variance = digits.reduce((sum, digit) => sum + Math.pow(digit - average, 2), 0) / digits.length;
        const standardDeviation = Math.sqrt(variance);
        
        // Lower standard deviation indicates consolidation
        return Math.max(0, 1 - (standardDeviation / 3));
    }

    private calculateBreakoutPotential(digits: number[]): number {
        const recent10 = digits.slice(-10);
        const previous10 = digits.slice(-20, -10);
        
        const recentAvg = recent10.reduce((sum, digit) => sum + digit, 0) / recent10.length;
        const previousAvg = previous10.reduce((sum, digit) => sum + digit, 0) / previous10.length;
        
        const difference = Math.abs(recentAvg - previousAvg);
        return Math.min(1, difference / 5); // Normalize to 0-1 range
    }

    private calculatePatternDuration(digits: number[], pattern: string): number {
        // Simplified duration calculation
        return Math.floor(Math.random() * 15) + 5;
    }

    public analyzeSymbol(symbol: string): SymbolAnalysis {
        const history = this.digitHistory.get(symbol) || [];
        const patterns = this.patternCache.get(symbol) || [];
        
        const digitFrequencies = this.calculateDigitFrequencies(history);
        const overUnderRatio = this.calculateOverUnderRatio(history);
        const recommendation = this.generateRecommendation(history, patterns);

        return {
            symbol,
            patterns: patterns.map(p => ({ ...p, symbol })),
            digitFrequencies,
            overUnderRatio,
            recommendation
        };
    }

    private calculateDigitFrequencies(history: number[]): DigitFrequency[] {
        const frequencies: Record<number, number> = {};
        
        // Count frequency of each digit
        for (let i = 0; i <= 9; i++) {
            frequencies[i] = 0;
        }
        
        history.forEach(digit => {
            frequencies[digit]++;
        });

        // Convert to frequency array with trends
        return Object.entries(frequencies).map(([digit, count]) => {
            const digitNum = parseInt(digit);
            const frequency = history.length > 0 ? count / history.length : 0;
            
            // Simple trend calculation based on recent vs older data
            const recentHistory = history.slice(-20);
            const olderHistory = history.slice(-40, -20);
            
            const recentFreq = recentHistory.filter(d => d === digitNum).length / recentHistory.length;
            const olderFreq = olderHistory.filter(d => d === digitNum).length / olderHistory.length;
            
            let trend: 'INCREASING' | 'DECREASING' | 'STABLE' = 'STABLE';
            if (recentFreq > olderFreq * 1.2) {
                trend = 'INCREASING';
            } else if (recentFreq < olderFreq * 0.8) {
                trend = 'DECREASING';
            }

            return {
                digit: digitNum,
                frequency,
                trend,
                lastSeen: new Date()
            };
        });
    }

    private calculateOverUnderRatio(history: number[], threshold: number = 5): {
        over: number;
        under: number;
        threshold: number;
    } {
        const overCount = history.filter(digit => digit > threshold).length;
        const underCount = history.filter(digit => digit < threshold).length;
        const exactCount = history.filter(digit => digit === threshold).length;
        
        const total = history.length;
        
        return {
            over: total > 0 ? overCount / total : 0,
            under: total > 0 ? underCount / total : 0,
            threshold
        };
    }

    private generateRecommendation(history: number[], patterns: SymbolPattern[]): {
        action: 'OVER' | 'UNDER' | 'EXACT' | 'DIFFERS';
        target: number;
        confidence: number;
    } {
        if (history.length < 10) {
            return {
                action: 'OVER',
                target: 5,
                confidence: 50
            };
        }

        const recentDigits = history.slice(-10);
        const average = recentDigits.reduce((sum, digit) => sum + digit, 0) / recentDigits.length;
        
        // Find the strongest pattern
        const strongestPattern = patterns.reduce((strongest, current) => 
            current.strength > strongest.strength ? current : strongest, 
            { strength: 0, pattern: 'CONSOLIDATION', confidence: 0 } as SymbolPattern
        );

        let action: 'OVER' | 'UNDER' | 'EXACT' | 'DIFFERS' = 'OVER';
        let target = Math.round(average);
        let confidence = 60;

        // Base recommendation on patterns and averages
        if (strongestPattern.pattern === 'ASCENDING') {
            action = 'OVER';
            target = Math.min(9, Math.round(average) + 1);
            confidence = Math.min(90, 60 + strongestPattern.confidence * 0.3);
        } else if (strongestPattern.pattern === 'DESCENDING') {
            action = 'UNDER';
            target = Math.max(0, Math.round(average) - 1);
            confidence = Math.min(90, 60 + strongestPattern.confidence * 0.3);
        } else if (strongestPattern.pattern === 'CONSOLIDATION') {
            action = 'EXACT';
            target = Math.round(average);
            confidence = Math.min(85, 55 + strongestPattern.confidence * 0.3);
        } else if (strongestPattern.pattern === 'BREAKOUT') {
            action = 'DIFFERS';
            target = Math.round(average);
            confidence = Math.min(95, 70 + strongestPattern.confidence * 0.25);
        }

        // Add some randomness to simulate real market unpredictability
        confidence += (Math.random() - 0.5) * 20;
        confidence = Math.max(30, Math.min(95, confidence));

        return {
            action,
            target,
            confidence
        };
    }

    public getDigitFrequencyAnalysis(symbol: string): DigitFrequency[] {
        const analysis = this.analyzeSymbol(symbol);
        return analysis.digitFrequencies;
    }

    public getPatternAnalysis(symbol: string): SymbolPattern[] {
        return this.patternCache.get(symbol) || [];
    }

    public getBestTradingOpportunity(symbols: string[]): {
        symbol: string;
        opportunity: SymbolAnalysis;
        score: number;
    } | null {
        let bestOpportunity: { symbol: string; opportunity: SymbolAnalysis; score: number } | null = null;
        
        symbols.forEach(symbol => {
            const analysis = this.analyzeSymbol(symbol);
            
            // Calculate opportunity score based on confidence and pattern strength
            let score = analysis.recommendation.confidence;
            
            // Boost score for strong patterns
            const strongestPattern = analysis.patterns.reduce((strongest, current) => 
                current.strength > strongest.strength ? current : strongest, 
                { strength: 0 } as SymbolPattern
            );
            
            score += strongestPattern.strength * 20;
            
            // Boost score for clear over/under bias
            const overUnderBias = Math.abs(analysis.overUnderRatio.over - analysis.overUnderRatio.under);
            score += overUnderBias * 30;

            if (!bestOpportunity || score > bestOpportunity.score) {
                bestOpportunity = {
                    symbol,
                    opportunity: analysis,
                    score
                };
            }
        });

        return bestOpportunity;
    }

    public cleanup(): void {
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
    }
}

// Create singleton instance
const symbolAnalyzer = new SymbolAnalyzer();
export default symbolAnalyzer;

// Export types
export type { SymbolPattern, DigitFrequency, SymbolAnalysis };
