
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

interface TrendData {
  timeframe: string;
  granularity: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  lastUpdate: number;
}

interface DecyclerAnalysis {
  symbol: string;
  trends: TrendData[];
  alignment: 'all_bullish' | 'all_bearish' | 'mixed' | 'neutral';
  confidence: number;
  lastScan: number;
  recommendation?: {
    action: 'BUY_RISE' | 'BUY_FALL' | 'HOLD';
    contractType: 'CALL' | 'PUT' | 'CALLE' | 'PUTE';
    reason: string;
  };
}

interface ContractMonitoring {
  contractId: string;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  breakeven: boolean;
  trailingStop: number;
  maxProfit: number;
  entryTrend: string[];
}

class DecyclerAnalyzerService {
  private analysisSubject = new BehaviorSubject<DecyclerAnalysis | null>(null);
  private contractSubject = new BehaviorSubject<ContractMonitoring | null>(null);
  private isRunning = false;
  private monitorInterval?: NodeJS.Timeout;
  private contractInterval?: NodeJS.Timeout;

  private readonly timeframes = [
    { name: '1m', granularity: 60 },
    { name: '5m', granularity: 300 },
    { name: '15m', granularity: 900 },
    { name: '30m', granularity: 1800 },
    { name: '1h', granularity: 3600 },
    { name: '4h', granularity: 14400 }
  ];

  private config = {
    monitorInterval: 10000, // 10 seconds
    decyclerAlpha: 0.07,
    minConfidence: 0.7,
    use10sConfirmation: true,
    useTrailingStop: true,
    trailingStep: 0.5,
    useBreakeven: true,
    breakevenTrigger: 2.0
  };

  public getAnalysis(): Observable<DecyclerAnalysis | null> {
    return this.analysisSubject.asObservable();
  }

  public getContractMonitoring(): Observable<ContractMonitoring | null> {
    return this.contractSubject.asObservable();
  }

  public async start(symbol: string = 'R_100'): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`🔄 Starting Decycler analysis for ${symbol}`);

    this.monitorInterval = setInterval(async () => {
      try {
        const analysis = await this.performAnalysis(symbol);
        this.analysisSubject.next(analysis);
      } catch (error) {
        console.error('Decycler analysis error:', error);
      }
    }, this.config.monitorInterval);

    // Initial analysis
    const initialAnalysis = await this.performAnalysis(symbol);
    this.analysisSubject.next(initialAnalysis);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
    if (this.contractInterval) {
      clearInterval(this.contractInterval);
      this.contractInterval = undefined;
    }
    console.log('🛑 Decycler analysis stopped');
  }

  private async performAnalysis(symbol: string): Promise<DecyclerAnalysis> {
    const trends: TrendData[] = [];
    
    // Analyze each timeframe
    for (const tf of this.timeframes) {
      try {
        const candles = await this.getCandleData(symbol, tf.granularity, 100);
        const trend = this.calculateDecyclerTrend(candles);
        
        trends.push({
          timeframe: tf.name,
          granularity: tf.granularity,
          trend: trend.direction,
          strength: trend.strength,
          lastUpdate: Date.now()
        });
      } catch (error) {
        console.warn(`Failed to analyze ${tf.name}:`, error);
        trends.push({
          timeframe: tf.name,
          granularity: tf.granularity,
          trend: 'neutral',
          strength: 0,
          lastUpdate: Date.now()
        });
      }
    }

    // Determine overall alignment
    const bullishCount = trends.filter(t => t.trend === 'bullish').length;
    const bearishCount = trends.filter(t => t.trend === 'bearish').length;
    const neutralCount = trends.filter(t => t.trend === 'neutral').length;

    let alignment: DecyclerAnalysis['alignment'];
    let confidence = 0;

    if (bullishCount === trends.length) {
      alignment = 'all_bullish';
      confidence = trends.reduce((sum, t) => sum + t.strength, 0) / trends.length;
    } else if (bearishCount === trends.length) {
      alignment = 'all_bearish';
      confidence = trends.reduce((sum, t) => sum + t.strength, 0) / trends.length;
    } else if (neutralCount === trends.length) {
      alignment = 'neutral';
      confidence = 0;
    } else {
      alignment = 'mixed';
      confidence = Math.max(bullishCount, bearishCount) / trends.length * 0.5;
    }

    // Generate recommendation
    let recommendation: DecyclerAnalysis['recommendation'];
    
    if (alignment === 'all_bullish' && confidence >= this.config.minConfidence) {
      if (this.config.use10sConfirmation) {
        const shortTermTrend = await this.check10sTrend(symbol);
        if (shortTermTrend === 'bullish') {
          recommendation = {
            action: 'BUY_RISE',
            contractType: 'CALL', // or CALLE for Higher/Lower
            reason: `All timeframes bullish (${(confidence * 100).toFixed(1)}% confidence), 10s confirmation: ${shortTermTrend}`
          };
        } else {
          recommendation = {
            action: 'HOLD',
            contractType: 'CALL',
            reason: `All timeframes bullish but 10s trend is ${shortTermTrend}`
          };
        }
      } else {
        recommendation = {
          action: 'BUY_RISE',
          contractType: 'CALL',
          reason: `All timeframes bullish (${(confidence * 100).toFixed(1)}% confidence)`
        };
      }
    } else if (alignment === 'all_bearish' && confidence >= this.config.minConfidence) {
      if (this.config.use10sConfirmation) {
        const shortTermTrend = await this.check10sTrend(symbol);
        if (shortTermTrend === 'bearish') {
          recommendation = {
            action: 'BUY_FALL',
            contractType: 'PUT', // or PUTE for Higher/Lower
            reason: `All timeframes bearish (${(confidence * 100).toFixed(1)}% confidence), 10s confirmation: ${shortTermTrend}`
          };
        } else {
          recommendation = {
            action: 'HOLD',
            contractType: 'PUT',
            reason: `All timeframes bearish but 10s trend is ${shortTermTrend}`
          };
        }
      } else {
        recommendation = {
          action: 'BUY_FALL',
          contractType: 'PUT',
          reason: `All timeframes bearish (${(confidence * 100).toFixed(1)}% confidence)`
        };
      }
    } else {
      recommendation = {
        action: 'HOLD',
        contractType: 'CALL',
        reason: `Mixed signals: ${bullishCount} bullish, ${bearishCount} bearish, ${neutralCount} neutral`
      };
    }

    return {
      symbol,
      trends,
      alignment,
      confidence,
      lastScan: Date.now(),
      recommendation
    };
  }

  private async getCandleData(symbol: string, granularity: number, count: number): Promise<number[]> {
    if (!api_base.api) {
      throw new Error('API not connected');
    }

    const request = {
      ticks_history: symbol,
      style: 'candles',
      count,
      end: 'latest',
      granularity,
      adjust_start_time: 1
    };

    const response = await api_base.api.send(request);
    
    if (response.error) {
      throw new Error(`Candle data error: ${response.error.message}`);
    }

    return (response.candles || []).map((candle: any) => parseFloat(candle.close));
  }

  private async check10sTrend(symbol: string): Promise<'bullish' | 'bearish' | 'neutral'> {
    try {
      if (!api_base.api) return 'neutral';

      const request = {
        ticks_history: symbol,
        style: 'ticks',
        count: 30,
        end: 'latest'
      };

      const response = await api_base.api.send(request);
      
      if (response.error || !response.history?.prices) {
        return 'neutral';
      }

      const prices = response.history.prices.map((p: any) => parseFloat(p));
      const trend = this.calculateDecyclerTrend(prices);
      return trend.direction;
    } catch (error) {
      console.warn('10s trend check failed:', error);
      return 'neutral';
    }
  }

  private calculateDecyclerTrend(prices: number[]): { direction: 'bullish' | 'bearish' | 'neutral'; strength: number } {
    if (prices.length < 2) {
      return { direction: 'neutral', strength: 0 };
    }

    // John Ehlers' Decycler implementation
    const alpha = this.config.decyclerAlpha;
    const decycler: number[] = [prices[0]];

    for (let i = 1; i < prices.length; i++) {
      const newVal = decycler[i - 1] + alpha * (prices[i] - decycler[i - 1]);
      decycler.push(newVal);
    }

    // Calculate trend direction and strength
    const last = decycler[decycler.length - 1];
    const prev = decycler[decycler.length - 2];
    const diff = last - prev;
    const percentChange = Math.abs(diff / prev) * 100;

    let direction: 'bullish' | 'bearish' | 'neutral';
    let strength = Math.min(percentChange * 10, 1); // Normalize to 0-1

    if (diff > 0.0001) {
      direction = 'bullish';
    } else if (diff < -0.0001) {
      direction = 'bearish';
    } else {
      direction = 'neutral';
      strength = 0;
    }

    return { direction, strength };
  }

  public async startContractMonitoring(contractId: string, entryPrice: number, entryTrends: string[]): Promise<void> {
    const monitoring: ContractMonitoring = {
      contractId,
      entryPrice,
      currentPrice: entryPrice,
      pnl: 0,
      breakeven: false,
      trailingStop: entryPrice,
      maxProfit: 0,
      entryTrend: entryTrends
    };

    this.contractSubject.next(monitoring);

    this.contractInterval = setInterval(async () => {
      try {
        await this.updateContractMonitoring(monitoring);
      } catch (error) {
        console.error('Contract monitoring error:', error);
      }
    }, 1000); // Update every second
  }

  private async updateContractMonitoring(monitoring: ContractMonitoring): Promise<void> {
    if (!api_base.api) return;

    try {
      const request = {
        proposal_open_contract: 1,
        contract_id: monitoring.contractId
      };

      const response = await api_base.api.send(request);
      
      if (response.error) {
        console.error('Contract monitoring error:', response.error.message);
        return;
      }

      const contract = response.proposal_open_contract;
      const currentPnl = parseFloat(contract.profit || '0');
      
      monitoring.currentPrice = parseFloat(contract.current_spot || monitoring.entryPrice);
      monitoring.pnl = currentPnl;

      // Update max profit for trailing stop
      if (currentPnl > monitoring.maxProfit) {
        monitoring.maxProfit = currentPnl;
        
        // Update trailing stop
        if (this.config.useTrailingStop && currentPnl > this.config.trailingStep) {
          monitoring.trailingStop = monitoring.maxProfit - this.config.trailingStep;
        }
      }

      // Check breakeven
      if (this.config.useBreakeven && currentPnl >= this.config.breakevenTrigger && !monitoring.breakeven) {
        monitoring.breakeven = true;
        monitoring.trailingStop = Math.max(monitoring.trailingStop, 0);
        console.log('📈 Breakeven activated');
      }

      this.contractSubject.next(monitoring);

      // Auto-sell conditions
      if (contract.is_sold) {
        this.stopContractMonitoring();
        return;
      }

      // Check if trailing stop hit
      if (this.config.useTrailingStop && currentPnl <= monitoring.trailingStop) {
        console.log('🔻 Trailing stop hit, selling contract');
        await this.sellContract(monitoring.contractId);
        return;
      }

      // Check if trends have changed
      const currentAnalysis = this.analysisSubject.getValue();
      if (currentAnalysis && currentAnalysis.alignment === 'mixed') {
        console.log('⚠️ Trend alignment changed, selling contract');
        await this.sellContract(monitoring.contractId);
        return;
      }

    } catch (error) {
      console.error('Contract update error:', error);
    }
  }

  private async sellContract(contractId: string): Promise<void> {
    if (!api_base.api) return;

    try {
      const request = {
        sell: contractId,
        price: 0
      };

      const response = await api_base.api.send(request);
      
      if (response.error) {
        console.error('Sell error:', response.error.message);
      } else {
        console.log('✅ Contract sold successfully');
        this.stopContractMonitoring();
      }
    } catch (error) {
      console.error('Sell contract error:', error);
    }
  }

  public stopContractMonitoring(): void {
    if (this.contractInterval) {
      clearInterval(this.contractInterval);
      this.contractInterval = undefined;
    }
    this.contractSubject.next(null);
  }

  public updateConfig(newConfig: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): typeof this.config {
    return { ...this.config };
  }
}

export const decyclerAnalyzer = new DecyclerAnalyzerService();
export type { DecyclerAnalysis, TrendData, ContractMonitoring };
