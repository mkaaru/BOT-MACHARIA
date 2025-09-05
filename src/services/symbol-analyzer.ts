
interface SymbolConfig {
  symbol: string;
  tickInterval: number; // in milliseconds
  volatilityThreshold: number;
  digitPatterns: {
    hot: number[];
    cold: number[];
  };
}

interface SymbolMetrics {
  symbol: string;
  currentPrice: number;
  lastTick: number;
  tickCount: number;
  volatilityIndex: number;
  trendDirection: 'up' | 'down' | 'sideways';
  digitFrequency: number[];
  lastDigits: number[];
  patterns: {
    consecutive: number;
    alternating: number;
    clustering: number;
  };
}

class SymbolAnalyzer {
  private symbolConfigs: Map<string, SymbolConfig> = new Map();
  private symbolMetrics: Map<string, SymbolMetrics> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private digitHistory: Map<string, number[]> = new Map();
  
  private readonly maxHistoryLength = 500;

  constructor() {
    this.initializeDefaultConfigs();
  }

  private initializeDefaultConfigs(): void {
    const defaultSymbols = [
      'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
      'RDBEAR', 'RDBULL',
      '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
    ];

    defaultSymbols.forEach(symbol => {
      this.symbolConfigs.set(symbol, {
        symbol,
        tickInterval: 1000, // 1 second
        volatilityThreshold: 0.5,
        digitPatterns: {
          hot: [],
          cold: []
        }
      });

      this.symbolMetrics.set(symbol, {
        symbol,
        currentPrice: 0,
        lastTick: Date.now(),
        tickCount: 0,
        volatilityIndex: 0,
        trendDirection: 'sideways',
        digitFrequency: new Array(10).fill(0),
        lastDigits: [],
        patterns: {
          consecutive: 0,
          alternating: 0,
          clustering: 0
        }
      });

      this.priceHistory.set(symbol, []);
      this.digitHistory.set(symbol, []);
    });
  }

  updateSymbolData(symbol: string, price: number): void {
    const metrics = this.symbolMetrics.get(symbol);
    if (!metrics) return;

    const lastDigit = Math.floor((price * 100) % 10);
    
    // Update price history
    const priceHistory = this.priceHistory.get(symbol)!;
    priceHistory.push(price);
    if (priceHistory.length > this.maxHistoryLength) {
      priceHistory.shift();
    }

    // Update digit history
    const digitHistory = this.digitHistory.get(symbol)!;
    digitHistory.push(lastDigit);
    if (digitHistory.length > this.maxHistoryLength) {
      digitHistory.shift();
    }

    // Update metrics
    metrics.currentPrice = price;
    metrics.lastTick = Date.now();
    metrics.tickCount++;
    metrics.lastDigits = digitHistory.slice(-10);
    
    // Update digit frequency
    metrics.digitFrequency[lastDigit]++;
    
    // Calculate volatility
    metrics.volatilityIndex = this.calculateVolatility(priceHistory);
    
    // Determine trend
    metrics.trendDirection = this.calculateTrend(priceHistory);
    
    // Update patterns
    metrics.patterns = this.analyzePatterns(digitHistory);
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const return_ = (prices[i] - prices[i-1]) / prices[i-1];
      returns.push(return_);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * 100; // Convert to percentage
  }

  private calculateTrend(prices: number[]): 'up' | 'down' | 'sideways' {
    if (prices.length < 10) return 'sideways';

    const recentPrices = prices.slice(-10);
    const oldPrices = prices.slice(-20, -10);
    
    if (oldPrices.length === 0) return 'sideways';

    const recentAvg = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
    const oldAvg = oldPrices.reduce((sum, p) => sum + p, 0) / oldPrices.length;
    
    const changePercent = ((recentAvg - oldAvg) / oldAvg) * 100;
    
    if (changePercent > 0.1) return 'up';
    if (changePercent < -0.1) return 'down';
    return 'sideways';
  }

  private analyzePatterns(digits: number[]): {
    consecutive: number;
    alternating: number;
    clustering: number;
  } {
    if (digits.length < 3) {
      return { consecutive: 0, alternating: 0, clustering: 0 };
    }

    let consecutive = 0;
    let alternating = 0;
    let clustering = 0;

    // Analyze consecutive patterns
    let currentStreak = 1;
    let maxStreak = 1;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] === digits[i-1]) {
        currentStreak++;
      } else {
        maxStreak = Math.max(maxStreak, currentStreak);
        currentStreak = 1;
      }
    }
    consecutive = Math.max(maxStreak, currentStreak);

    // Analyze alternating patterns
    let alternatingCount = 0;
    for (let i = 2; i < digits.length; i++) {
      if (digits[i] === digits[i-2] && digits[i] !== digits[i-1]) {
        alternatingCount++;
      }
    }
    alternating = alternatingCount;

    // Analyze clustering (digits appearing in groups)
    const recentDigits = digits.slice(-20);
    const digitCounts = new Array(10).fill(0);
    recentDigits.forEach(digit => digitCounts[digit]++);
    
    const maxCount = Math.max(...digitCounts);
    const expectedCount = recentDigits.length / 10;
    clustering = Math.max(0, maxCount - expectedCount);

    return { consecutive, alternating, clustering };
  }

  getSymbolMetrics(symbol: string): SymbolMetrics | null {
    return this.symbolMetrics.get(symbol) || null;
  }

  getAllSymbolMetrics(): SymbolMetrics[] {
    return Array.from(this.symbolMetrics.values());
  }

  analyzeDigitBias(symbol: string): {
    evenBias: number;
    oddBias: number;
    overBias: number;
    underBias: number;
    hotDigits: number[];
    coldDigits: number[];
  } {
    const metrics = this.symbolMetrics.get(symbol);
    if (!metrics) {
      return {
        evenBias: 0, oddBias: 0, overBias: 0, underBias: 0,
        hotDigits: [], coldDigits: []
      };
    }

    const totalCount = metrics.digitFrequency.reduce((sum, count) => sum + count, 0);
    if (totalCount === 0) {
      return {
        evenBias: 0, oddBias: 0, overBias: 0, underBias: 0,
        hotDigits: [], coldDigits: []
      };
    }

    // Calculate biases
    const evenCount = [0, 2, 4, 6, 8].reduce((sum, digit) => sum + metrics.digitFrequency[digit], 0);
    const oddCount = [1, 3, 5, 7, 9].reduce((sum, digit) => sum + metrics.digitFrequency[digit], 0);
    const overCount = [5, 6, 7, 8, 9].reduce((sum, digit) => sum + metrics.digitFrequency[digit], 0);
    const underCount = [0, 1, 2, 3, 4].reduce((sum, digit) => sum + metrics.digitFrequency[digit], 0);

    const evenBias = (evenCount / totalCount) * 100 - 50;
    const oddBias = (oddCount / totalCount) * 100 - 50;
    const overBias = (overCount / totalCount) * 100 - 50;
    const underBias = (underCount / totalCount) * 100 - 50;

    // Identify hot and cold digits
    const expectedFreq = totalCount / 10;
    const hotDigits: number[] = [];
    const coldDigits: number[] = [];

    metrics.digitFrequency.forEach((count, digit) => {
      const frequency = count / totalCount * 100;
      if (frequency > 12) hotDigits.push(digit);
      if (frequency < 8) coldDigits.push(digit);
    });

    return {
      evenBias,
      oddBias,
      overBias,
      underBias,
      hotDigits,
      coldDigits
    };
  }

  predictNextDigit(symbol: string): {
    mostLikely: number[];
    leastLikely: number[];
    confidence: number;
  } {
    const metrics = this.symbolMetrics.get(symbol);
    if (!metrics || metrics.lastDigits.length < 5) {
      return {
        mostLikely: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        leastLikely: [],
        confidence: 0
      };
    }

    const bias = this.analyzeDigitBias(symbol);
    const patterns = metrics.patterns;
    
    // Score each digit based on various factors
    const digitScores = new Array(10).fill(0);
    
    // Factor 1: Frequency bias
    const totalCount = metrics.digitFrequency.reduce((sum, count) => sum + count, 0);
    if (totalCount > 0) {
      for (let i = 0; i < 10; i++) {
        const frequency = metrics.digitFrequency[i] / totalCount;
        // Slight preference for less frequent digits (mean reversion)
        digitScores[i] += (0.1 - frequency) * 10;
      }
    }

    // Factor 2: Recent pattern analysis
    const lastDigit = metrics.lastDigits[metrics.lastDigits.length - 1];
    if (patterns.consecutive > 2) {
      // If we have consecutive patterns, slightly reduce chance of same digit
      digitScores[lastDigit] -= 1;
    }
    
    // Factor 3: Even/Odd bias compensation
    if (Math.abs(bias.evenBias) > 5) {
      const favorBias = bias.evenBias > 0 ? 'odd' : 'even';
      for (let i = 0; i < 10; i++) {
        if (favorBias === 'even' && i % 2 === 0) digitScores[i] += 0.5;
        if (favorBias === 'odd' && i % 2 === 1) digitScores[i] += 0.5;
      }
    }

    // Factor 4: Over/Under bias compensation
    if (Math.abs(bias.overBias) > 5) {
      const favorBias = bias.overBias > 0 ? 'under' : 'over';
      for (let i = 0; i < 10; i++) {
        if (favorBias === 'under' && i < 5) digitScores[i] += 0.5;
        if (favorBias === 'over' && i >= 5) digitScores[i] += 0.5;
      }
    }

    // Sort digits by score
    const sortedDigits = Array.from({ length: 10 }, (_, i) => ({ digit: i, score: digitScores[i] }))
      .sort((a, b) => b.score - a.score);

    const mostLikely = sortedDigits.slice(0, 4).map(d => d.digit);
    const leastLikely = sortedDigits.slice(-3).map(d => d.digit);
    
    // Calculate confidence based on pattern strength and data quality
    const confidence = Math.min(
      (totalCount / 100) * 0.3 + // More data = higher confidence
      (Math.max(Math.abs(bias.evenBias), Math.abs(bias.overBias)) / 20) * 0.4 + // Stronger bias = higher confidence
      (patterns.consecutive > 2 ? 0.2 : 0) + // Pattern detection
      0.1, // Base confidence
      0.9 // Maximum confidence
    );

    return {
      mostLikely,
      leastLikely,
      confidence
    };
  }

  generateTradingSignal(symbol: string, strategy: 'differ' | 'overunder' | 'o5u4'): {
    action: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
    parameters?: any;
  } {
    const metrics = this.symbolMetrics.get(symbol);
    if (!metrics || metrics.tickCount < 20) {
      return {
        action: 'wait',
        confidence: 0,
        reasoning: 'Insufficient data for signal generation'
      };
    }

    const bias = this.analyzeDigitBias(symbol);
    const prediction = this.predictNextDigit(symbol);

    switch (strategy) {
      case 'differ':
        return this.generateDifferSignal(bias, prediction);
      
      case 'overunder':
        return this.generateOverUnderSignal(bias, prediction, metrics);
      
      case 'o5u4':
        return this.generateO5U4Signal(bias, prediction);
      
      default:
        return {
          action: 'wait',
          confidence: 0,
          reasoning: 'Unknown strategy'
        };
    }
  }

  private generateDifferSignal(
    bias: any,
    prediction: any
  ): {
    action: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
    parameters?: any;
  } {
    const evenOddBias = Math.abs(bias.evenBias);
    
    if (evenOddBias > 8) {
      const action = bias.evenBias > 0 ? 'sell' : 'buy'; // Bet against the bias
      return {
        action,
        confidence: Math.min(evenOddBias / 20 + prediction.confidence / 2, 0.9),
        reasoning: `Strong ${bias.evenBias > 0 ? 'even' : 'odd'} bias detected (${evenOddBias.toFixed(1)}%)`,
        parameters: {
          contractType: bias.evenBias > 0 ? 'DIGITODD' : 'DIGITEVEN'
        }
      };
    }

    return {
      action: 'wait',
      confidence: 0.3,
      reasoning: 'Even/Odd bias not significant enough for trading'
    };
  }

  private generateOverUnderSignal(
    bias: any,
    prediction: any,
    metrics: SymbolMetrics
  ): {
    action: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
    parameters?: any;
  } {
    const overUnderBias = Math.abs(bias.overBias);
    
    if (overUnderBias > 6) {
      const action = bias.overBias > 0 ? 'sell' : 'buy'; // Bet against the bias
      const barrier = metrics.currentPrice + (bias.overBias > 0 ? -0.001 : 0.001);
      
      return {
        action,
        confidence: Math.min(overUnderBias / 15 + prediction.confidence / 2, 0.85),
        reasoning: `${bias.overBias > 0 ? 'Over' : 'Under'} bias detected (${overUnderBias.toFixed(1)}%)`,
        parameters: {
          contractType: bias.overBias > 0 ? 'CALL' : 'PUT',
          barrier: barrier.toFixed(5)
        }
      };
    }

    return {
      action: 'wait',
      confidence: 0.4,
      reasoning: 'Over/Under bias not significant enough for trading'
    };
  }

  private generateO5U4Signal(
    bias: any,
    prediction: any
  ): {
    action: 'buy' | 'sell' | 'wait';
    confidence: number;
    reasoning: string;
    parameters?: any;
  } {
    // O5U4 targets digits 0,1,2,3,6,7,8,9 (excluding 4,5)
    const targetDigits = [0, 1, 2, 3, 6, 7, 8, 9];
    const targetInMostLikely = prediction.mostLikely.filter(d => targetDigits.includes(d)).length;
    const targetInLeastLikely = prediction.leastLikely.filter(d => targetDigits.includes(d)).length;
    
    const signalStrength = targetInMostLikely - targetInLeastLikely;
    
    if (Math.abs(signalStrength) > 1) {
      return {
        action: signalStrength > 0 ? 'buy' : 'sell',
        confidence: Math.min(Math.abs(signalStrength) / 4 + prediction.confidence / 2, 0.8),
        reasoning: `O5U4 pattern suggests ${signalStrength > 0 ? 'favorable' : 'unfavorable'} conditions`,
        parameters: {
          over5: { contractType: 'DIGITOVER', barrier: '5' },
          under4: { contractType: 'DIGITUNDER', barrier: '4' }
        }
      };
    }

    return {
      action: 'wait',
      confidence: 0.5,
      reasoning: 'O5U4 pattern not clear enough for trading'
    };
  }

  resetSymbolData(symbol: string): void {
    const metrics = this.symbolMetrics.get(symbol);
    if (metrics) {
      metrics.tickCount = 0;
      metrics.digitFrequency = new Array(10).fill(0);
      metrics.lastDigits = [];
      metrics.patterns = { consecutive: 0, alternating: 0, clustering: 0 };
    }
    
    this.priceHistory.set(symbol, []);
    this.digitHistory.set(symbol, []);
  }
}

export const symbolAnalyzer = new SymbolAnalyzer();
export type { SymbolConfig, SymbolMetrics };
