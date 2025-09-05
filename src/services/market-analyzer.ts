
interface MarketData {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
  lastDigit: number;
}

interface AnalysisResult {
  symbol: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  volatility: number;
  confidence: number;
  recommendation: 'buy' | 'sell' | 'hold';
  supportLevel?: number;
  resistanceLevel?: number;
}

interface DigitAnalysis {
  digit: number;
  frequency: number;
  lastSeen: number;
  pattern: 'hot' | 'cold' | 'normal';
}

class MarketAnalyzer {
  private historicalData: Map<string, MarketData[]> = new Map();
  private digitFrequency: Map<string, Map<number, number>> = new Map();
  private readonly maxHistoryLength = 1000;

  addMarketData(data: MarketData): void {
    const symbol = data.symbol;
    
    if (!this.historicalData.has(symbol)) {
      this.historicalData.set(symbol, []);
    }
    
    const history = this.historicalData.get(symbol)!;
    history.push(data);
    
    // Keep only the last maxHistoryLength entries
    if (history.length > this.maxHistoryLength) {
      history.shift();
    }
    
    // Update digit frequency
    this.updateDigitFrequency(symbol, data.lastDigit);
  }

  private updateDigitFrequency(symbol: string, digit: number): void {
    if (!this.digitFrequency.has(symbol)) {
      this.digitFrequency.set(symbol, new Map());
    }
    
    const frequencies = this.digitFrequency.get(symbol)!;
    const currentFreq = frequencies.get(digit) || 0;
    frequencies.set(digit, currentFreq + 1);
  }

  analyzeSymbol(symbol: string): AnalysisResult | null {
    const history = this.historicalData.get(symbol);
    if (!history || history.length < 10) {
      return null;
    }

    const recentData = history.slice(-50); // Analyze last 50 data points
    const prices = recentData.map(d => d.price);
    
    // Calculate trend
    const trend = this.calculateTrend(prices);
    
    // Calculate volatility
    const volatility = this.calculateVolatility(prices);
    
    // Calculate support and resistance
    const { support, resistance } = this.calculateSupportResistance(prices);
    
    // Generate confidence score
    const confidence = this.calculateConfidence(recentData);
    
    // Generate recommendation
    const recommendation = this.generateRecommendation(trend, volatility, confidence);

    return {
      symbol,
      trend,
      volatility,
      confidence,
      recommendation,
      supportLevel: support,
      resistanceLevel: resistance
    };
  }

  private calculateTrend(prices: number[]): 'bullish' | 'bearish' | 'neutral' {
    if (prices.length < 2) return 'neutral';
    
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, price) => sum + price, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, price) => sum + price, 0) / secondHalf.length;
    
    const trendStrength = Math.abs(secondAvg - firstAvg) / firstAvg;
    
    if (trendStrength < 0.001) return 'neutral';
    return secondAvg > firstAvg ? 'bullish' : 'bearish';
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    
    const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * 100; // Convert to percentage
  }

  private calculateSupportResistance(prices: number[]): { support: number; resistance: number } {
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    // Simple support/resistance calculation
    const support = minPrice + (maxPrice - minPrice) * 0.2;
    const resistance = maxPrice - (maxPrice - minPrice) * 0.2;
    
    return { support, resistance };
  }

  private calculateConfidence(data: MarketData[]): number {
    if (data.length < 5) return 0.3;
    
    // Base confidence on data consistency and volume
    const volumes = data.map(d => d.volume);
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    
    // Higher volume generally means higher confidence
    const volumeScore = Math.min(avgVolume / 1000, 1); // Normalize to 0-1
    
    // Recent data gets higher confidence
    const timeScore = data.length / 50; // More data points = higher confidence
    
    return Math.min((volumeScore + timeScore) / 2, 1);
  }

  private generateRecommendation(
    trend: 'bullish' | 'bearish' | 'neutral',
    volatility: number,
    confidence: number
  ): 'buy' | 'sell' | 'hold' {
    if (confidence < 0.5) return 'hold';
    
    if (trend === 'bullish' && volatility < 2) return 'buy';
    if (trend === 'bearish' && volatility < 2) return 'sell';
    
    return 'hold';
  }

  analyzeDigitPatterns(symbol: string): DigitAnalysis[] {
    const frequencies = this.digitFrequency.get(symbol);
    if (!frequencies) return [];
    
    const totalCount = Array.from(frequencies.values()).reduce((sum, count) => sum + count, 0);
    const results: DigitAnalysis[] = [];
    
    for (let digit = 0; digit <= 9; digit++) {
      const count = frequencies.get(digit) || 0;
      const frequency = count / totalCount;
      
      let pattern: 'hot' | 'cold' | 'normal' = 'normal';
      if (frequency > 0.12) pattern = 'hot';
      else if (frequency < 0.08) pattern = 'cold';
      
      results.push({
        digit,
        frequency: frequency * 100, // Convert to percentage
        lastSeen: this.getLastSeenDigit(symbol, digit),
        pattern
      });
    }
    
    return results.sort((a, b) => b.frequency - a.frequency);
  }

  private getLastSeenDigit(symbol: string, digit: number): number {
    const history = this.historicalData.get(symbol);
    if (!history) return -1;
    
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].lastDigit === digit) {
        return history.length - 1 - i; // Ticks ago
      }
    }
    
    return -1; // Never seen
  }

  generateTradeSignal(symbol: string, strategy: 'differ' | 'overunder' | 'o5u4'): {
    signal: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
  } {
    const analysis = this.analyzeSymbol(symbol);
    const digitAnalysis = this.analyzeDigitPatterns(symbol);
    
    if (!analysis) {
      return {
        signal: 'wait',
        confidence: 0,
        reasoning: 'Insufficient data for analysis'
      };
    }

    switch (strategy) {
      case 'differ':
        return this.generateDifferSignal(digitAnalysis);
      
      case 'overunder':
        return this.generateOverUnderSignal(analysis, digitAnalysis);
      
      case 'o5u4':
        return this.generateO5U4Signal(digitAnalysis);
      
      default:
        return {
          signal: 'wait',
          confidence: 0,
          reasoning: 'Unknown strategy'
        };
    }
  }

  private generateDifferSignal(digitAnalysis: DigitAnalysis[]): {
    signal: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
  } {
    const evenSum = digitAnalysis.filter(d => d.digit % 2 === 0).reduce((sum, d) => sum + d.frequency, 0);
    const oddSum = digitAnalysis.filter(d => d.digit % 2 === 1).reduce((sum, d) => sum + d.frequency, 0);
    
    const difference = Math.abs(evenSum - oddSum);
    
    if (difference > 10) {
      const signal = evenSum > oddSum ? 'sell' : 'buy'; // Bet against the trend
      return {
        signal,
        confidence: Math.min(difference / 20, 0.9),
        reasoning: `Strong ${evenSum > oddSum ? 'even' : 'odd'} bias detected (${difference.toFixed(1)}% difference)`
      };
    }
    
    return {
      signal: 'wait',
      confidence: 0.5,
      reasoning: 'Balanced even/odd distribution, waiting for better opportunity'
    };
  }

  private generateOverUnderSignal(
    analysis: AnalysisResult,
    digitAnalysis: DigitAnalysis[]
  ): {
    signal: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
  } {
    const overSum = digitAnalysis.filter(d => d.digit > 4).reduce((sum, d) => sum + d.frequency, 0);
    const underSum = digitAnalysis.filter(d => d.digit < 5).reduce((sum, d) => sum + d.frequency, 0);
    
    const bias = overSum - underSum;
    const confidence = Math.min(Math.abs(bias) / 15 + analysis.confidence / 2, 0.9);
    
    if (Math.abs(bias) > 8) {
      return {
        signal: bias > 0 ? 'sell' : 'buy', // Bet against the bias
        confidence,
        reasoning: `${bias > 0 ? 'Over' : 'Under'} bias detected (${Math.abs(bias).toFixed(1)}%)`
      };
    }
    
    return {
      signal: 'wait',
      confidence: 0.4,
      reasoning: 'Balanced over/under distribution'
    };
  }

  private generateO5U4Signal(digitAnalysis: DigitAnalysis[]): {
    signal: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
  } {
    const over5Freq = digitAnalysis.filter(d => d.digit > 5).reduce((sum, d) => sum + d.frequency, 0);
    const under4Freq = digitAnalysis.filter(d => d.digit < 4).reduce((sum, d) => sum + d.frequency, 0);
    
    const totalTargetFreq = over5Freq + under4Freq;
    const expectedFreq = 60; // Expected frequency for digits 0,1,2,3,6,7,8,9
    
    const deviation = Math.abs(totalTargetFreq - expectedFreq);
    
    if (deviation > 10) {
      return {
        signal: totalTargetFreq < expectedFreq ? 'buy' : 'sell',
        confidence: Math.min(deviation / 20, 0.8),
        reasoning: `O5U4 pattern deviation: ${deviation.toFixed(1)}% from expected`
      };
    }
    
    return {
      signal: 'wait',
      confidence: 0.5,
      reasoning: 'O5U4 pattern within normal range'
    };
  }

  getSymbolStatistics(symbol: string): {
    totalTicks: number;
    averagePrice: number;
    priceRange: { min: number; max: number };
    digitDistribution: Map<number, number>;
  } | null {
    const history = this.historicalData.get(symbol);
    const frequencies = this.digitFrequency.get(symbol);
    
    if (!history || !frequencies) return null;
    
    const prices = history.map(d => d.price);
    
    return {
      totalTicks: history.length,
      averagePrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      priceRange: {
        min: Math.min(...prices),
        max: Math.max(...prices)
      },
      digitDistribution: new Map(frequencies)
    };
  }
}

export const marketAnalyzer = new MarketAnalyzer();
export type { MarketData, AnalysisResult, DigitAnalysis };
