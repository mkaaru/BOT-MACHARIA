
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import './volatility-scanner.scss';

// All volatility symbols to scan
const VOLATILITY_SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10 (1s)' },
  { symbol: 'R_25', name: 'Volatility 25 (1s)' },
  { symbol: 'R_50', name: 'Volatility 50 (1s)' },
  { symbol: 'R_75', name: 'Volatility 75 (1s)' },
  { symbol: 'R_100', name: 'Volatility 100 (1s)' },
  { symbol: 'BOOM500', name: 'Boom 500' },
  { symbol: 'BOOM1000', name: 'Boom 1000' },
  { symbol: 'CRASH500', name: 'Crash 500' },
  { symbol: 'CRASH1000', name: 'Crash 1000' },
  { symbol: 'stpRNG', name: 'Step Index' }
];

interface TrendData {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  value: number;
  strength: number;
  lastUpdate: number;
}

interface SymbolTrends {
  '1000': TrendData;
  '2000': TrendData;
  '3000': TrendData;
  '4000': TrendData;
}

interface SymbolData {
  symbol: string;
  name: string;
  currentPrice: number;
  trends: SymbolTrends;
  tickData: Array<{ time: number, price: number }>;
  recommendation: 'HIGHER' | 'LOWER' | 'NEUTRAL';
  confidence: number;
  alignedTrends: number;
  lastTickTime: number;
}

const VolatilityScanner = observer(() => {
  const apiRef = useRef<any>(null);
  const tickStreamsRef = useRef<Map<string, string>>(new Map());
  const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [symbolsData, setSymbolsData] = useState<Map<string, SymbolData>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [bestRecommendations, setBestRecommendations] = useState<SymbolData[]>([]);

  // Hull Moving Average calculation
  const calculateHMA = (data: number[], period: number) => {
    if (data.length < period) return null;

    const calculateWMA = (values: number[], periods: number) => {
      if (values.length < periods) return null;
      const weights = Array.from({length: periods}, (_, i) => i + 1);
      const weightSum = weights.reduce((sum, w) => sum + w, 0);
      const recentValues = values.slice(-periods);
      const weightedSum = recentValues.reduce((sum, val, i) => sum + val * weights[i], 0);
      return weightedSum / weightSum;
    };

    const halfPeriod = Math.floor(period / 2);
    const sqrtPeriod = Math.floor(Math.sqrt(period));

    const wmaHalf = calculateWMA(data, halfPeriod);
    const wmaFull = calculateWMA(data, period);

    if (wmaHalf === null || wmaFull === null) return null;

    const rawHMA = 2 * wmaHalf - wmaFull;
    return rawHMA;
  };

  // Ehlers Super Smoother Filter
  const applySuperSmoother = (prices: number[], period: number = 10) => {
    if (prices.length < period) return prices;
    
    const smoothed = [...prices];
    const a1 = Math.exp(-1.414 * Math.PI / period);
    const b1 = 2 * a1 * Math.cos(1.414 * Math.PI / period);
    const c2 = b1;
    const c3 = -a1 * a1;
    const c1 = 1 - c2 - c3;

    for (let i = 2; i < prices.length; i++) {
      smoothed[i] = c1 * (prices[i] + prices[i - 1]) / 2 + c2 * smoothed[i - 1] + c3 * smoothed[i - 2];
    }

    return smoothed;
  };

  // Ehlers Decycler
  const applyDecycler = (prices: number[], period: number = 20) => {
    if (prices.length < 3) return prices;
    
    const decycled = [...prices];
    const alpha = (Math.cos(0.707 * 2 * Math.PI / period) + Math.sin(0.707 * 2 * Math.PI / period) - 1) /
                  Math.cos(0.707 * 2 * Math.PI / period);

    for (let i = 2; i < prices.length; i++) {
      decycled[i] = (alpha / 2) * (prices[i] + prices[i - 1]) + (1 - alpha) * decycled[i - 1];
    }

    return decycled;
  };

  // Calculate trends for a symbol
  const calculateTrends = (tickData: Array<{ time: number, price: number }>, symbol: string): SymbolTrends => {
    const timeframeConfigs = {
      '1000': { requiredTicks: 1000, smoothingPeriod: 20 },
      '2000': { requiredTicks: 2000, smoothingPeriod: 25 },
      '3000': { requiredTicks: 3000, smoothingPeriod: 30 },
      '4000': { requiredTicks: 4000, smoothingPeriod: 35 }
    };

    const trends: SymbolTrends = {
      '1000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() },
      '2000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() },
      '3000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() },
      '4000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() }
    };

    Object.entries(timeframeConfigs).forEach(([tickCountStr, config]) => {
      const recentTicks = tickData.slice(-config.requiredTicks);

      if (recentTicks.length >= Math.min(15, config.requiredTicks)) {
        const tickPrices = recentTicks.map(tick => tick.price);

        // Apply Ehlers noise reduction
        const smoothedPrices = applySuperSmoother(tickPrices, config.smoothingPeriod);
        const decycledPrices = applyDecycler(smoothedPrices, Math.max(10, config.smoothingPeriod));

        const hmaPeriod = Math.max(8, Math.min(Math.floor(decycledPrices.length * 0.3), 25));
        const hmaValue = calculateHMA(decycledPrices, hmaPeriod);

        if (hmaValue !== null) {
          const hmaSlopeLookback = Math.max(3, Math.floor(hmaPeriod / 4));
          const prevHMA = calculateHMA(decycledPrices.slice(0, -hmaSlopeLookback), hmaPeriod);
          const hmaSlope = prevHMA !== null ? hmaValue - prevHMA : 0;

          const currentPrice = decycledPrices[decycledPrices.length - 1];
          const priceAboveHMA = currentPrice > hmaValue;

          // Calculate adaptive thresholds
          const priceRange = Math.max(...decycledPrices.slice(-Math.min(50, decycledPrices.length))) - 
                           Math.min(...decycledPrices.slice(-Math.min(50, decycledPrices.length)));
          
          const timeframeMultiplier = config.requiredTicks / 1000;
          const adaptiveThreshold = priceRange * (0.05 + timeframeMultiplier * 0.02);
          const slopeThreshold = Math.max(0.000005, adaptiveThreshold * 0.2);

          const trendStrength = Math.abs(hmaSlope) / slopeThreshold;
          const strength = Math.min(100, trendStrength * 50);

          let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

          if (trendStrength > 1.2) {
            if (hmaSlope > slopeThreshold && priceAboveHMA) {
              trend = 'BULLISH';
            } else if (hmaSlope < -slopeThreshold && !priceAboveHMA) {
              trend = 'BEARISH';
            }
          }

          trends[tickCountStr as keyof SymbolTrends] = {
            trend,
            value: Number(hmaValue.toFixed(5)),
            strength,
            lastUpdate: Date.now()
          };
        }
      }
    });

    return trends;
  };

  // Get trading recommendation for a symbol
  const getSymbolRecommendation = (trends: SymbolTrends) => {
    const trendValues = Object.values(trends);
    const bullishCount = trendValues.filter(data => data.trend === 'BULLISH').length;
    const bearishCount = trendValues.filter(data => data.trend === 'BEARISH').length;
    const totalTrends = trendValues.length;

    const minAlignedTrends = 3;

    let recommendation: 'HIGHER' | 'LOWER' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0;
    let alignedTrends = 0;

    if (bullishCount >= minAlignedTrends) {
      recommendation = 'HIGHER';
      confidence = bullishCount / totalTrends;
      alignedTrends = bullishCount;
    } else if (bearishCount >= minAlignedTrends) {
      recommendation = 'LOWER';
      confidence = bearishCount / totalTrends;
      alignedTrends = bearishCount;
    } else {
      alignedTrends = Math.max(bullishCount, bearishCount);
    }

    return { recommendation, confidence, alignedTrends };
  };

  // Initialize API and start scanning
  useEffect(() => {
    const api = generateDerivApiInstance();
    apiRef.current = api;

    const init = async () => {
      try {
        setIsConnected(true);
        
        // Initialize symbol data
        const initialData = new Map();
        VOLATILITY_SYMBOLS.forEach(vol => {
          initialData.set(vol.symbol, {
            symbol: vol.symbol,
            name: vol.name,
            currentPrice: 0,
            trends: {
              '1000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() },
              '2000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() },
              '3000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() },
              '4000': { trend: 'NEUTRAL', value: 0, strength: 0, lastUpdate: Date.now() }
            },
            tickData: [],
            recommendation: 'NEUTRAL',
            confidence: 0,
            alignedTrends: 0,
            lastTickTime: 0
          } as SymbolData);
        });
        setSymbolsData(initialData);

        // Fetch historical data for all symbols
        await fetchHistoricalDataForAll(api);
        
        // Start live tick streaming
        await startTickStreaming(api);
        
        setIsScanning(true);
        
      } catch (error) {
        console.error('Scanner initialization error:', error);
        setIsConnected(false);
      }
    };

    init();

    return () => {
      stopAllStreams();
      api?.disconnect?.();
    };
  }, []);

  // Fetch historical data for all symbols
  const fetchHistoricalDataForAll = async (api: any) => {
    const promises = VOLATILITY_SYMBOLS.map(async (vol) => {
      try {
        const request = {
          ticks_history: vol.symbol,
          adjust_start_time: 1,
          count: 4000,
          end: "latest",
          start: 1,
          style: "ticks"
        };

        const response = await api.send(request);

        if (response.error) {
          console.warn(`Error fetching data for ${vol.symbol}:`, response.error);
          return;
        }

        if (response.history && response.history.prices && response.history.times) {
          const historicalData = response.history.prices.map((price: string, index: number) => ({
            time: response.history.times[index] * 1000,
            price: parseFloat(price)
          }));

          setSymbolsData(prev => {
            const newData = new Map(prev);
            const symbolData = newData.get(vol.symbol);
            if (symbolData) {
              symbolData.tickData = historicalData;
              symbolData.currentPrice = historicalData[historicalData.length - 1]?.price || 0;
              
              // Calculate trends
              const trends = calculateTrends(historicalData, vol.symbol);
              symbolData.trends = trends;
              
              // Get recommendation
              const { recommendation, confidence, alignedTrends } = getSymbolRecommendation(trends);
              symbolData.recommendation = recommendation;
              symbolData.confidence = confidence;
              symbolData.alignedTrends = alignedTrends;
              
              newData.set(vol.symbol, symbolData);
            }
            return newData;
          });
        }
      } catch (error) {
        console.warn(`Failed to fetch data for ${vol.symbol}:`, error);
      }
    });

    await Promise.all(promises);
  };

  // Start tick streaming for all symbols
  const startTickStreaming = async (api: any) => {
    // Set up message handler
    const onMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data as any);
        if (data?.msg_type === 'tick' && data?.tick) {
          const symbol = data.tick.symbol;
          const quote = data.tick.quote;
          const tickTime = data.tick.epoch * 1000;

          setSymbolsData(prev => {
            const newData = new Map(prev);
            const symbolData = newData.get(symbol);
            if (symbolData) {
              // Update current price
              symbolData.currentPrice = quote;
              symbolData.lastTickTime = tickTime;

              // Add new tick data
              const newTickData = [...symbolData.tickData, { time: tickTime, price: quote }];
              const trimmedData = newTickData.slice(-4000); // Keep only recent 4000 ticks
              symbolData.tickData = trimmedData;

              // Recalculate trends
              const trends = calculateTrends(trimmedData, symbol);
              symbolData.trends = trends;

              // Update recommendation
              const { recommendation, confidence, alignedTrends } = getSymbolRecommendation(trends);
              symbolData.recommendation = recommendation;
              symbolData.confidence = confidence;
              symbolData.alignedTrends = alignedTrends;

              newData.set(symbol, symbolData);
            }
            return newData;
          });

          setLastUpdate(Date.now());
        }
      } catch (error) {
        console.error('Error processing tick:', error);
      }
    };

    messageHandlerRef.current = onMsg;
    api?.connection?.addEventListener('message', onMsg);

    // Subscribe to all symbols
    for (const vol of VOLATILITY_SYMBOLS) {
      try {
        const { subscription, error } = await api.send({ ticks: vol.symbol, subscribe: 1 });
        if (error) {
          console.warn(`Error subscribing to ${vol.symbol}:`, error);
        } else if (subscription?.id) {
          tickStreamsRef.current.set(vol.symbol, subscription.id);
        }
      } catch (error) {
        console.warn(`Failed to subscribe to ${vol.symbol}:`, error);
      }
    }
  };

  // Stop all streams
  const stopAllStreams = () => {
    try {
      tickStreamsRef.current.forEach((streamId) => {
        apiRef.current?.forget({ forget: streamId });
      });
      tickStreamsRef.current.clear();

      if (messageHandlerRef.current) {
        apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
    } catch (error) {
      console.error('Error stopping streams:', error);
    }
  };

  // Update best recommendations
  useEffect(() => {
    const symbols = Array.from(symbolsData.values());
    const withRecommendations = symbols.filter(s => s.recommendation !== 'NEUTRAL' && s.alignedTrends >= 3);
    const sorted = withRecommendations.sort((a, b) => b.confidence - a.confidence);
    setBestRecommendations(sorted.slice(0, 5)); // Top 5 recommendations
  }, [symbolsData]);

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'BULLISH': return <TrendingUp className="trend-icon bullish" size={16} />;
      case 'BEARISH': return <TrendingDown className="trend-icon bearish" size={16} />;
      default: return <Minus className="trend-icon neutral" size={16} />;
    }
  };

  const getRecommendationColor = (recommendation: string, alignedTrends: number) => {
    if (alignedTrends < 3) return 'neutral';
    return recommendation === 'HIGHER' ? 'bullish' : recommendation === 'LOWER' ? 'bearish' : 'neutral';
  };

  return (
    <div className="volatility-scanner">
      <div className="scanner-header">
        <h2>{localize('Volatility Market Scanner')}</h2>
        <div className="scanner-status">
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></div>
          <span>{isConnected ? localize('Connected') : localize('Disconnected')}</span>
          {isScanning && <span className="scanning-text">{localize('Scanning...')}</span>}
        </div>
      </div>

      {/* Best Recommendations */}
      <div className="best-recommendations">
        <h3>{localize('Best Trading Opportunities')}</h3>
        {bestRecommendations.length > 0 ? (
          <div className="recommendations-grid">
            {bestRecommendations.map((symbol) => (
              <div key={symbol.symbol} className={`recommendation-card ${getRecommendationColor(symbol.recommendation, symbol.alignedTrends)}`}>
                <div className="symbol-info">
                  <span className="symbol-name">{symbol.name}</span>
                  <span className="symbol-price">{symbol.currentPrice.toFixed(5)}</span>
                </div>
                <div className="recommendation-info">
                  <span className="recommendation">{symbol.recommendation}</span>
                  <span className="confidence">{(symbol.confidence * 100).toFixed(0)}%</span>
                  <span className="alignment">{symbol.alignedTrends}/4 trends aligned</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-recommendations">
            <AlertCircle size={24} />
            <p>{localize('No strong trading signals detected. Waiting for 3+ aligned trends...')}</p>
          </div>
        )}
      </div>

      {/* All Symbols Overview */}
      <div className="symbols-overview">
        <h3>{localize('All Volatility Symbols')}</h3>
        <div className="symbols-grid">
          {Array.from(symbolsData.values()).map((symbolData) => (
            <div key={symbolData.symbol} className="symbol-card">
              <div className="symbol-header">
                <span className="symbol-name">{symbolData.name}</span>
                <span className="symbol-price">{symbolData.currentPrice.toFixed(5)}</span>
              </div>
              
              <div className="trends-display">
                {Object.entries(symbolData.trends).map(([timeframe, trendData]) => (
                  <div key={timeframe} className="trend-item">
                    <span className="timeframe">{timeframe}</span>
                    {getTrendIcon(trendData.trend)}
                    <span className="strength">{Math.round(trendData.strength)}%</span>
                  </div>
                ))}
              </div>

              <div className={`symbol-recommendation ${getRecommendationColor(symbolData.recommendation, symbolData.alignedTrends)}`}>
                <span className="rec-text">{symbolData.recommendation}</span>
                <span className="alignment-info">
                  {symbolData.alignedTrends}/4 aligned
                  {symbolData.alignedTrends >= 3 && <span className="strong-signal">🔥</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="scanner-footer">
        <Text size="xs">
          {localize('Last update')}: {lastUpdate > 0 ? new Date(lastUpdate).toLocaleTimeString() : localize('Never')}
        </Text>
      </div>
    </div>
  );
});

export default VolatilityScanner;
