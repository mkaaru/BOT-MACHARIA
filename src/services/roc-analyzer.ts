
/**
 * ROC (Rate of Change) Analyzer
 * Uses tick data to calculate ROC across multiple timeframes
 * Provides recommendations only when all timeframes align
 */

export interface ROCAnalysis {
    roc_5min: number;      // 300 ticks
    roc_3min: number;      // 180 ticks
    roc_1min: number;      // 60 ticks
    direction: 'RISE' | 'FALL' | 'NEUTRAL';
    alignment: boolean;
    confidence: number;
    strength: number;
}

export interface ROCRecommendation {
    symbol: string;
    displayName: string;
    action: 'RISE' | 'FALL';
    confidence: number;
    entryScore: number;
    roc_5min: number;
    roc_3min: number;
    roc_1min: number;
    alignment: 'FULL' | 'NONE';
}

export class ROCAnalyzer {
    private tickHistory: Map<string, number[]> = new Map();
    private readonly TICK_WINDOW = 300; // Keep last 300 ticks
    
    /**
     * Process a single tick
     */
    processTick(symbol: string, price: number): void {
        if (!this.tickHistory.has(symbol)) {
            this.tickHistory.set(symbol, []);
        }
        
        const history = this.tickHistory.get(symbol)!;
        history.push(price);
        
        // Keep only last 300 ticks
        if (history.length > this.TICK_WINDOW) {
            history.shift();
        }
    }
    
    /**
     * Process bulk historical tick data
     */
    processBulkTicks(symbol: string, ticks: Array<{ price: number; timestamp: number }>): void {
        const prices = ticks.map(t => t.price);
        this.tickHistory.set(symbol, prices.slice(-this.TICK_WINDOW));
        
        console.log(`📊 ROC Analyzer: Loaded ${prices.length} ticks for ${symbol}`);
    }
    
    /**
     * Calculate ROC for a given period
     */
    private calculateROC(prices: number[], period: number): number {
        if (prices.length < period + 1) {
            return 0;
        }
        
        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - period - 1];
        
        if (pastPrice === 0) return 0;
        
        // ROC = ((Current - Past) / Past) * 100
        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }
    
    /**
     * Analyze symbol and return ROC analysis
     */
    analyze(symbol: string): ROCAnalysis | null {
        const history = this.tickHistory.get(symbol);
        
        if (!history || history.length < 300) {
            return null;
        }
        
        // Calculate ROC for each timeframe
        const roc_5min = this.calculateROC(history, 300); // 300 ticks = ~5 minutes
        const roc_3min = this.calculateROC(history, 180); // 180 ticks = ~3 minutes
        const roc_1min = this.calculateROC(history, 60);  // 60 ticks = ~1 minute
        
        // Determine direction based on ROC values
        const roc_5min_dir = roc_5min > 0 ? 'RISE' : roc_5min < 0 ? 'FALL' : 'NEUTRAL';
        const roc_3min_dir = roc_3min > 0 ? 'RISE' : roc_3min < 0 ? 'FALL' : 'NEUTRAL';
        const roc_1min_dir = roc_1min > 0 ? 'RISE' : roc_1min < 0 ? 'FALL' : 'NEUTRAL';
        
        // Check for alignment - all must point in same direction
        const alignment = 
            roc_5min_dir !== 'NEUTRAL' &&
            roc_5min_dir === roc_3min_dir && 
            roc_3min_dir === roc_1min_dir;
        
        // Determine overall direction
        let direction: 'RISE' | 'FALL' | 'NEUTRAL' = 'NEUTRAL';
        if (alignment) {
            direction = roc_5min_dir as 'RISE' | 'FALL';
        }
        
        // Calculate confidence based on ROC magnitude and alignment
        const avgROC = (Math.abs(roc_5min) + Math.abs(roc_3min) + Math.abs(roc_1min)) / 3;
        const confidence = alignment ? Math.min(50 + avgROC * 100, 100) : 0;
        
        // Calculate strength
        const strength = Math.abs(roc_5min) * 100;
        
        return {
            roc_5min,
            roc_3min,
            roc_1min,
            direction,
            alignment,
            confidence,
            strength
        };
    }
    
    /**
     * Get recommendation if ROC aligns
     */
    getRecommendation(symbol: string, displayName: string): ROCRecommendation | null {
        const analysis = this.analyze(symbol);
        
        if (!analysis || !analysis.alignment || analysis.direction === 'NEUTRAL') {
            return null;
        }
        
        return {
            symbol,
            displayName,
            action: analysis.direction,
            confidence: analysis.confidence,
            entryScore: analysis.confidence,
            roc_5min: analysis.roc_5min,
            roc_3min: analysis.roc_3min,
            roc_1min: analysis.roc_1min,
            alignment: 'FULL'
        };
    }
    
    /**
     * Get all aligned recommendations
     */
    getAllRecommendations(symbols: Array<{ symbol: string; display_name: string }>): ROCRecommendation[] {
        const recommendations: ROCRecommendation[] = [];
        
        for (const symbolInfo of symbols) {
            const rec = this.getRecommendation(symbolInfo.symbol, symbolInfo.display_name);
            if (rec) {
                recommendations.push(rec);
            }
        }
        
        // Sort by confidence descending
        return recommendations.sort((a, b) => b.confidence - a.confidence);
    }
    
    /**
     * Check if symbol has enough data
     */
    hasData(symbol: string): boolean {
        const history = this.tickHistory.get(symbol);
        return history ? history.length >= 300 : false;
    }
    
    /**
     * Get statistics
     */
    getStats(symbol: string): { tickCount: number; hasEnoughData: boolean } | null {
        const history = this.tickHistory.get(symbol);
        if (!history) return null;
        
        return {
            tickCount: history.length,
            hasEnoughData: history.length >= 300
        };
    }
    
    /**
     * Clear data for symbol
     */
    clearSymbol(symbol: string): void {
        this.tickHistory.delete(symbol);
    }
    
    /**
     * Clear all data
     */
    clearAll(): void {
        this.tickHistory.clear();
    }
}

// Create singleton instance
export const rocAnalyzer = new ROCAnalyzer();
