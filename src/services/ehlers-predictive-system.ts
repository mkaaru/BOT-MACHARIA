
import { TickData, CandleData } from './tick-stream-manager';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TrendSignal {
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
  confidence: number; // 0-100
  entry: boolean;
  exit: boolean;
  mama: number;
  fama: number;
  rsi: number;
  trend: number;
  cycle: number;
}

export interface EhlersAnalysis {
  signal: TrendSignal;
  currentPrice: number;
  mama: number;
  fama: number;
  rsi: number;
  trend: number;
  cycle: number;
  timestamp: number;
  marketPhase: 'trending' | 'cycling' | 'transitioning';
  noiseLevel: number;
}

interface CandleBuffer {
  symbol: string;
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  lastUpdate: number;
}

export class TenSecondCandleEngine {
  private candleBuffers: Map<string, CandleBuffer> = new Map();
  private completedCandles: Map<string, Candle[]> = new Map();
  private candleCallbacks: Map<string, Set<(candle: Candle) => void>> = new Map();
  private readonly CANDLE_INTERVAL_MS = 10 * 1000; // 10 seconds
  private readonly MAX_CANDLES_PER_SYMBOL = 200; // Keep last 200 candles

  processTick(tick: TickData): void {
    const { symbol, epoch, quote } = tick;
    const candleStartTime = this.getCandleStartTime(epoch);
    
    let buffer = this.candleBuffers.get(symbol);
    
    // If no buffer exists or we're in a new candle period
    if (!buffer || buffer.startTime !== candleStartTime) {
      // Complete the previous candle if it exists
      if (buffer && buffer.tickCount > 0) {
        this.completeCandle(buffer);
      }
      
      // Create new buffer for this candle period
      buffer = {
        symbol,
        startTime: candleStartTime,
        open: quote,
        high: quote,
        low: quote,
        close: quote,
        tickCount: 1,
        lastUpdate: epoch,
      };
      this.candleBuffers.set(symbol, buffer);
    } else {
      // Update existing buffer
      buffer.high = Math.max(buffer.high, quote);
      buffer.low = Math.min(buffer.low, quote);
      buffer.close = quote;
      buffer.tickCount++;
      buffer.lastUpdate = epoch;
    }
  }

  private getCandleStartTime(epoch: number): number {
    // Round down to the nearest 10-second interval
    return Math.floor(epoch / 10) * 10;
  }

  private completeCandle(buffer: CandleBuffer): void {
    const candle: Candle = {
      timestamp: buffer.startTime * 1000, // Convert to milliseconds
      open: buffer.open,
      high: buffer.high,
      low: buffer.low,
      close: buffer.close,
      volume: buffer.tickCount, // Use tick count as volume proxy
    };

    // Store completed candle
    if (!this.completedCandles.has(buffer.symbol)) {
      this.completedCandles.set(buffer.symbol, []);
    }
    
    const candles = this.completedCandles.get(buffer.symbol)!;
    candles.push(candle);
    
    // Keep only the last MAX_CANDLES_PER_SYMBOL candles
    if (candles.length > this.MAX_CANDLES_PER_SYMBOL) {
      candles.shift();
    }

    // Notify callbacks
    this.notifyCandleCallbacks(candle);
    
    console.log(`📊 10s candle for ${buffer.symbol}: OHLC(${candle.open.toFixed(5)}, ${candle.high.toFixed(5)}, ${candle.low.toFixed(5)}, ${candle.close.toFixed(5)}) with ${buffer.tickCount} ticks`);
  }

  private notifyCandleCallbacks(candle: Candle): void {
    const callbacks = this.candleCallbacks.get(candle.symbol);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(candle);
        } catch (error) {
          console.error(`Error in 10s candle callback for ${candle.symbol}:`, error);
        }
      });
    }
  }

  addCandleCallback(symbol: string, callback: (candle: Candle) => void): void {
    if (!this.candleCallbacks.has(symbol)) {
      this.candleCallbacks.set(symbol, new Set());
    }
    this.candleCallbacks.get(symbol)!.add(callback);
  }

  getCandles(symbol: string, count?: number): Candle[] {
    const candles = this.completedCandles.get(symbol) || [];
    if (count && count > 0) {
      return candles.slice(-count);
    }
    return [...candles];
  }

  getCurrentCandle(symbol: string): CandleBuffer | null {
    return this.candleBuffers.get(symbol) || null;
  }
}

export class EhlersPredictiveSystem {
  private data: Candle[] = [];
  private period: number = 20;
  private alpha: number = 0.07; // Smoothing factor
  private symbol: string;
  
  constructor(symbol: string, period: number = 20) {
    this.symbol = symbol;
    this.period = period;
    this.alpha = 2 / (period + 1);
  }

  // Add new candle data
  addCandle(candle: Candle): void {
    this.data.push(candle);
    // Keep only necessary data for calculations (last 100 candles)
    if (this.data.length > 100) {
      this.data.shift();
    }
  }

  // Ehlers Super Smoother Filter
  private superSmoother(prices: number[], period: number = 10): number[] {
    const result: number[] = [];
    const a1 = Math.exp(-1.414 * Math.PI / period);
    const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / period);
    const c2 = b1;
    const c3 = -a1 * a1;
    const c1 = 1 - c2 - c3;

    for (let i = 0; i < prices.length; i++) {
      if (i < 2) {
        result.push(prices[i]);
      } else {
        const value = c1 * (prices[i] + prices[i - 1]) / 2 + 
                     c2 * result[i - 1] + 
                     c3 * result[i - 2];
        result.push(value);
      }
    }
    return result;
  }

  // Ehlers MESA Adaptive Moving Average (MAMA)
  private calculateMAMA(prices: number[]): { mama: number[], fama: number[] } {
    const mama: number[] = [];
    const fama: number[] = [];
    const period: number[] = [];
    const smooth: number[] = [];
    const detrender: number[] = [];
    const i1: number[] = [];
    const q1: number[] = [];
    const ji: number[] = [];
    const jq: number[] = [];
    const i2: number[] = [];
    const q2: number[] = [];
    const re: number[] = [];
    const im: number[] = [];
    const spp: number[] = [];

    for (let i = 0; i < prices.length; i++) {
      // Initialize early values
      if (i < 6) {
        smooth.push(prices[i]);
        detrender.push(0);
        period.push(20);
        mama.push(prices[i]);
        fama.push(prices[i]);
        i1.push(0);
        q1.push(0);
        ji.push(0);
        jq.push(0);
        i2.push(0);
        q2.push(0);
        re.push(0);
        im.push(0);
        spp.push(20);
        continue;
      }

      // Smooth prices
      smooth[i] = (4 * prices[i] + 3 * prices[i - 1] + 2 * prices[i - 2] + prices[i - 3]) / 10;
      
      // Detrend
      detrender[i] = (0.0962 * smooth[i] + 0.5769 * smooth[i - 2] - 
                     0.5769 * smooth[i - 4] - 0.0962 * smooth[i - 6]) * 
                     (0.075 * period[i - 1] + 0.54);

      // Compute InPhase and Quadrature components
      i1[i] = detrender[i - 3];
      q1[i] = (0.0962 * detrender[i] + 0.5769 * detrender[i - 2] - 
              0.5769 * detrender[i - 4] - 0.0962 * detrender[i - 6]) * 
              (0.075 * period[i - 1] + 0.54);

      // Advance the phase of I1 and Q1 by 90 degrees
      ji[i] = (0.0962 * i1[i] + 0.5769 * i1[i - 2] - 
              0.5769 * i1[i - 4] - 0.0962 * i1[i - 6]) * 
              (0.075 * period[i - 1] + 0.54);
      
      jq[i] = (0.0962 * q1[i] + 0.5769 * q1[i - 2] - 
              0.5769 * q1[i - 4] - 0.0962 * q1[i - 6]) * 
              (0.075 * period[i - 1] + 0.54);

      // Phasor addition for 3 bar averaging
      i2[i] = i1[i] - jq[i];
      q2[i] = q1[i] + ji[i];

      // Smooth the I and Q components
      i2[i] = 0.2 * i2[i] + 0.8 * i2[i - 1];
      q2[i] = 0.2 * q2[i] + 0.8 * q2[i - 1];

      // Homodyne Discriminator
      re[i] = i2[i] * i2[i - 1] + q2[i] * q2[i - 1];
      im[i] = i2[i] * q2[i - 1] - q2[i] * i2[i - 1];
      
      re[i] = 0.2 * re[i] + 0.8 * re[i - 1];
      im[i] = 0.2 * im[i] + 0.8 * im[i - 1];

      if (im[i] !== 0 && re[i] !== 0) {
        period[i] = 2 * Math.PI / Math.atan(im[i] / re[i]);
      } else {
        period[i] = period[i - 1];
      }

      // Constrain period
      if (period[i] > 1.5 * period[i - 1]) period[i] = 1.5 * period[i - 1];
      if (period[i] < 0.67 * period[i - 1]) period[i] = 0.67 * period[i - 1];
      if (period[i] < 6) period[i] = 6;
      if (period[i] > 50) period[i] = 50;
      
      period[i] = 0.2 * period[i] + 0.8 * period[i - 1];
      spp[i] = 0.33 * period[i] + 0.67 * spp[i - 1];

      const fastLimit = 0.5 / spp[i];
      const slowLimit = 0.05 / spp[i];

      const mamaVal = fastLimit * prices[i] + (1 - fastLimit) * mama[i - 1];
      const famaVal = slowLimit * mamaVal + (1 - slowLimit) * fama[i - 1];
      mama.push(mamaVal);
      fama.push(famaVal);
    }

    return { mama, fama };
  }

  // Ehlers Hilbert Transform Trend vs Cycle
  private hilbertTransform(prices: number[]): { trend: number[], cycle: number[], signal: number[] } {
    const trend: number[] = [];
    const cycle: number[] = [];
    const signal: number[] = [];
    const smooth: number[] = [];
    const detrender: number[] = [];
    const i1: number[] = [];
    const q1: number[] = [];
    const i2: number[] = [];
    const q2: number[] = [];
    const instTrendline: number[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (i < 7) {
        smooth.push(prices[i]);
        trend.push(prices[i]);
        cycle.push(0);
        signal.push(0);
        instTrendline.push(prices[i]);
        detrender.push(0);
        i1.push(0);
        q1.push(0);
        i2.push(0);
        q2.push(0);
        continue;
      }

      // Smooth the data
      smooth[i] = (4 * prices[i] + 3 * prices[i - 1] + 2 * prices[i - 2] + prices[i - 3]) / 10;

      // Detrend
      detrender[i] = (0.0962 * smooth[i] + 0.5769 * smooth[i - 2] - 
                     0.5769 * smooth[i - 4] - 0.0962 * smooth[i - 6]);

      // Hilbert Transform
      i1[i] = detrender[i - 3];
      q1[i] = (0.0962 * detrender[i] + 0.5769 * detrender[i - 2] - 
              0.5769 * detrender[i - 4] - 0.0962 * detrender[i - 6]);

      // Smooth the Hilbert Transform
      i2[i] = 0.2 * i1[i] + 0.8 * i2[i - 1];
      q2[i] = 0.2 * q1[i] + 0.8 * q2[i - 1];

      // Calculate instantaneous trendline
      instTrendline[i] = (smooth[i] + smooth[i - 1] + smooth[i - 2] + smooth[i - 3]) / 4;

      // Calculate trend (longer-term component)
      const trendValue = 0.25 * instTrendline[i] + 0.75 * trend[i - 1];
      trend.push(trendValue);

      // Calculate cycle component (price - trend)
      const cycleValue = smooth[i] - trend[i];
      cycle.push(cycleValue);

      // Generate signal based on trend direction and cycle position
      const trendSlope = trend[i] - trend[i - 1];
      const cycleSignal = cycleValue > 0 ? 1 : -1;
      const trendSignal = trendSlope > 0 ? 1 : -1;
      
      signal.push((trendSignal + cycleSignal) / 2);
    }

    return { trend, cycle, signal };
  }

  // Ehlers Rocket RSI
  private rocketRSI(prices: number[], period: number = 8): number[] {
    const rsi: number[] = [];
    const momentum: number[] = [];
    const avgUp: number[] = [];
    const avgDown: number[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (i === 0) {
        momentum.push(0);
        avgUp.push(0);
        avgDown.push(0);
        rsi.push(50);
        continue;
      }

      // Calculate momentum
      momentum[i] = prices[i] - prices[i - 1];

      // Separate up and down movements
      const upMove = momentum[i] > 0 ? momentum[i] : 0;
      const downMove = momentum[i] < 0 ? Math.abs(momentum[i]) : 0;

      // Calculate exponential moving averages
      if (i === 1) {
        avgUp[i] = upMove;
        avgDown[i] = downMove;
      } else {
        const alpha = 2 / (period + 1);
        avgUp[i] = alpha * upMove + (1 - alpha) * avgUp[i - 1];
        avgDown[i] = alpha * downMove + (1 - alpha) * avgDown[i - 1];
      }

      // Calculate RSI
      if (avgDown[i] === 0) {
        rsi[i] = 100;
      } else {
        const rs = avgUp[i] / avgDown[i];
        rsi[i] = 100 - (100 / (1 + rs));
      }
    }

    return rsi;
  }

  // Calculate noise level
  private calculateNoiseLevel(prices: number[]): number {
    if (prices.length < 10) return 0;
    
    const recent = prices.slice(-10);
    let noise = 0;
    for (let i = 1; i < recent.length; i++) {
      noise += Math.abs(recent[i] - recent[i - 1]);
    }
    return noise / (recent.length - 1);
  }

  // Determine market phase
  private determineMarketPhase(trend: number[], cycle: number[]): 'trending' | 'cycling' | 'transitioning' {
    if (trend.length < 10 || cycle.length < 10) return 'transitioning';
    
    const recentTrend = trend.slice(-10);
    const recentCycle = cycle.slice(-10);
    
    // Calculate trend strength
    const trendRange = Math.max(...recentTrend) - Math.min(...recentTrend);
    const cycleRange = Math.max(...recentCycle) - Math.min(...recentCycle);
    
    const trendStrength = trendRange / (recentTrend[recentTrend.length - 1] || 1);
    const cycleStrength = cycleRange / (recentTrend[recentTrend.length - 1] || 1);
    
    if (trendStrength > cycleStrength * 2) return 'trending';
    if (cycleStrength > trendStrength * 2) return 'cycling';
    return 'transitioning';
  }

  // Generate comprehensive trend signal
  generateTrendSignal(): TrendSignal | null {
    if (this.data.length < 50) {
      return null; // Need sufficient data
    }

    const closes = this.data.map(candle => candle.close);

    // Calculate Ehlers indicators
    const { mama, fama } = this.calculateMAMA(closes);
    const { trend, cycle, signal } = this.hilbertTransform(closes);
    const rsi = this.rocketRSI(closes);
    const smoothedPrices = this.superSmoother(closes);

    const currentIndex = closes.length - 1;
    const currentClose = closes[currentIndex];
    const currentMAMA = mama[currentIndex];
    const currentFAMA = fama[currentIndex];
    const currentTrend = trend[currentIndex];
    const currentCycle = cycle[currentIndex];
    const currentRSI = rsi[currentIndex];
    const currentSignal = signal[currentIndex];

    // Determine trend direction
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let strength = 0;
    let confidence = 0;

    // MAMA/FAMA trend analysis
    const mamaSignal = currentMAMA > currentFAMA ? 1 : -1;
    const trendSignal = currentSignal;
    const priceVsTrend = currentClose > currentTrend ? 1 : -1;

    // RSI momentum analysis (adjusted for 10-second timeframe)
    let rsiSignal = 0;
    if (currentRSI > 75) rsiSignal = 1; // Stronger overbought for shorter timeframe
    else if (currentRSI < 25) rsiSignal = -1; // Stronger oversold
    else if (currentRSI > 55) rsiSignal = 0.5;
    else if (currentRSI < 45) rsiSignal = -0.5;

    // Cycle analysis
    const cycleSignal = currentCycle > 0 ? 0.5 : -0.5;

    // Combine signals with weights optimized for 10-second trading
    const combinedSignal = (mamaSignal * 0.4 + trendSignal * 0.3 + priceVsTrend * 0.2 + rsiSignal * 0.1);

    if (combinedSignal > 0.3) {
      direction = 'bullish';
      strength = Math.min(100, Math.abs(combinedSignal) * 150); // Amplified for shorter timeframe
    } else if (combinedSignal < -0.3) {
      direction = 'bearish';
      strength = Math.min(100, Math.abs(combinedSignal) * 150);
    }

    // Calculate confidence based on signal alignment
    const signals = [mamaSignal, trendSignal, priceVsTrend, rsiSignal];
    const signalAlignment = signals.filter(s => 
      Math.sign(s) === Math.sign(combinedSignal)
    ).length;
    confidence = (signalAlignment / signals.length) * 100;

    // Entry/Exit signals optimized for 10-second candles
    const prevMAMA = mama[currentIndex - 1] || currentMAMA;
    const prevFAMA = fama[currentIndex - 1] || currentFAMA;
    const prevRSI = rsi[currentIndex - 1] || currentRSI;
    
    const mamaCrossUp = currentMAMA > currentFAMA && prevMAMA <= prevFAMA;
    const mamaCrossDown = currentMAMA < currentFAMA && prevMAMA >= prevFAMA;
    const rsiMomentum = Math.abs(currentRSI - prevRSI) > 2; // RSI moving fast
    
    const entry = (mamaCrossUp && direction === 'bullish' && rsiMomentum) ||
                  (mamaCrossDown && direction === 'bearish' && rsiMomentum);

    const exit = (currentMAMA < currentFAMA && direction === 'bullish') ||
                 (currentMAMA > currentFAMA && direction === 'bearish') ||
                 (currentRSI > 85 || currentRSI < 15); // Extreme RSI levels

    return {
      direction,
      strength,
      confidence,
      entry,
      exit,
      mama: currentMAMA,
      fama: currentFAMA,
      rsi: currentRSI,
      trend: currentTrend,
      cycle: currentCycle
    };
  }

  // Get current market analysis
  getMarketAnalysis(): EhlersAnalysis | null {
    if (this.data.length < 20) return null;

    const signal = this.generateTrendSignal();
    if (!signal) return null;

    const closes = this.data.map(candle => candle.close);
    const { trend, cycle } = this.hilbertTransform(closes);
    const noiseLevel = this.calculateNoiseLevel(closes);
    const marketPhase = this.determineMarketPhase(trend, cycle);

    return {
      signal,
      currentPrice: closes[closes.length - 1],
      mama: signal.mama,
      fama: signal.fama,
      rsi: signal.rsi,
      trend: signal.trend,
      cycle: signal.cycle,
      timestamp: this.data[this.data.length - 1].timestamp,
      marketPhase,
      noiseLevel
    };
  }

  // Reset system for new symbol
  reset(): void {
    this.data = [];
  }
}

// Enhanced Trading Bot with Ehlers Integration
export class EhlersTradingBot {
  private ehlers: Map<string, EhlersPredictiveSystem> = new Map();
  private candleEngine: TenSecondCandleEngine;
  private positions: Map<string, {
    type: 'long' | 'short';
    entryPrice: number;
    entryTime: number;
    signal: TrendSignal;
  }> = new Map();

  constructor() {
    this.candleEngine = new TenSecondCandleEngine();
  }

  // Initialize symbol for trading
  initializeSymbol(symbol: string): void {
    if (!this.ehlers.has(symbol)) {
      const ehlersSystem = new EhlersPredictiveSystem(symbol, 20);
      this.ehlers.set(symbol, ehlersSystem);
      
      // Setup candle callback
      this.candleEngine.addCandleCallback(symbol, (candle) => {
        this.processCandle(symbol, candle);
      });
      
      console.log(`🚀 Initialized Ehlers Predictive System for ${symbol}`);
    }
  }

  // Process tick data
  processTick(tick: TickData): void {
    this.candleEngine.processTick(tick);
  }

  // Process completed 10-second candle
  private processCandle(symbol: string, candle: Candle): void {
    const ehlersSystem = this.ehlers.get(symbol);
    if (!ehlersSystem) return;

    ehlersSystem.addCandle(candle);
    
    const analysis = ehlersSystem.getMarketAnalysis();
    if (!analysis) return;

    const { signal } = analysis;
    
    console.log(`📈 ${symbol} Ehlers Analysis (10s):`);
    console.log(`  Direction: ${signal.direction} (${signal.strength.toFixed(1)}%)`);
    console.log(`  Confidence: ${signal.confidence.toFixed(1)}%`);
    console.log(`  MAMA: ${signal.mama.toFixed(5)} | FAMA: ${signal.fama.toFixed(5)}`);
    console.log(`  RSI: ${signal.rsi.toFixed(1)} | Trend: ${signal.trend.toFixed(5)}`);
    console.log(`  Market Phase: ${analysis.marketPhase} | Noise: ${analysis.noiseLevel.toFixed(5)}`);

    // Trading logic optimized for 10-second timeframe
    this.executeTrading(symbol, candle, analysis);
  }

  private executeTrading(symbol: string, candle: Candle, analysis: EhlersAnalysis): void {
    const { signal } = analysis;
    const currentPosition = this.positions.get(symbol);
    
    // Entry conditions (higher confidence required for 10-second trading)
    if (signal.entry && signal.confidence > 70 && signal.strength > 60) {
      
      // Avoid trading in high noise conditions
      if (analysis.noiseLevel > 0.001) {
        console.log(`🔇 ${symbol}: Skipping trade due to high noise (${analysis.noiseLevel.toFixed(5)})`);
        return;
      }

      if (signal.direction === 'bullish' && !currentPosition) {
        this.positions.set(symbol, {
          type: 'long',
          entryPrice: candle.close,
          entryTime: candle.timestamp,
          signal
        });
        console.log(`🟢 ${symbol} LONG Entry at ${candle.close.toFixed(5)} (Conf: ${signal.confidence.toFixed(1)}%)`);
        
      } else if (signal.direction === 'bearish' && !currentPosition) {
        this.positions.set(symbol, {
          type: 'short',
          entryPrice: candle.close,
          entryTime: candle.timestamp,
          signal
        });
        console.log(`🔴 ${symbol} SHORT Entry at ${candle.close.toFixed(5)} (Conf: ${signal.confidence.toFixed(1)}%)`);
      }
    }

    // Exit conditions
    if (currentPosition) {
      const holdTime = candle.timestamp - currentPosition.entryTime;
      const pnl = currentPosition.type === 'long' ? 
        candle.close - currentPosition.entryPrice : 
        currentPosition.entryPrice - candle.close;
      
      let shouldExit = false;
      let exitReason = '';

      // Signal-based exit
      if (signal.exit) {
        shouldExit = true;
        exitReason = 'Signal Exit';
      }
      
      // Time-based exit (max 5 minutes for 10-second strategy)
      else if (holdTime > 5 * 60 * 1000) {
        shouldExit = true;
        exitReason = 'Time Exit (5min)';
      }
      
      // Profit taking (2% for 10-second strategy)
      else if (Math.abs(pnl / currentPosition.entryPrice) > 0.02) {
        shouldExit = true;
        exitReason = pnl > 0 ? 'Profit Taking (2%)' : 'Stop Loss (2%)';
      }
      
      // Confidence drop
      else if (signal.confidence < 40) {
        shouldExit = true;
        exitReason = 'Confidence Drop';
      }

      if (shouldExit) {
        const pnlPercent = (pnl / currentPosition.entryPrice) * 100;
        console.log(`🔄 ${symbol} Position Closed: ${exitReason}`);
        console.log(`   P&L: ${pnl.toFixed(5)} (${pnlPercent.toFixed(2)}%)`);
        console.log(`   Hold Time: ${(holdTime / 1000).toFixed(1)}s`);
        
        this.positions.delete(symbol);
      }
    }
  }

  // Get system status
  getSystemStatus(): any {
    const status: any = {
      symbols: Array.from(this.ehlers.keys()),
      positions: {},
      totalPositions: this.positions.size
    };

    this.positions.forEach((position, symbol) => {
      status.positions[symbol] = {
        type: position.type,
        entryPrice: position.entryPrice,
        entryTime: new Date(position.entryTime).toISOString(),
        signal: position.signal
      };
    });

    return status;
  }

  // Get latest analysis for symbol
  getLatestAnalysis(symbol: string): EhlersAnalysis | null {
    const ehlersSystem = this.ehlers.get(symbol);
    return ehlersSystem ? ehlersSystem.getMarketAnalysis() : null;
  }
}

// Create singleton instances
export const tenSecondCandleEngine = new TenSecondCandleEngine();
export const ehlersTradingBot = new EhlersTradingBot();

