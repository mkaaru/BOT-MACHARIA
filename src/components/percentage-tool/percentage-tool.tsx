import React, { useState, useEffect, useRef } from 'react';
import './percentage-tool.scss';

interface TickData {
  symbol: string;
  quote: number;
  pip_size: number;
}

interface PercentageData {
  symbol: string;
  current: number;
  percentage: number;
  trend: 'up' | 'down' | 'neutral';
  digits: number[];
  lastDigitCounts: { [key: number]: number };
  streaks: {
    even: number;
    odd: number;
    over: number;
    under: number;
  };
  predictions: {
    nextDigitProbability: { [key: number]: number };
    evenOddBias: 'even' | 'odd' | 'neutral';
    overUnderBias: 'over' | 'under' | 'neutral';
  };
}

const PercentageTool: React.FC = () => {
  const [ticksData, setTicksData] = useState<{ [key: string]: number[] }>({
    '1HZ10V': [],
    '1HZ25V': [],
    '1HZ50V': [],
    '1HZ75V': [],
    '1HZ100V': [],
    'R_10': [],
    'R_25': [],
    'R_50': [],
    'R_75': [],
    'R_100': []
  });
  const [ticksStorage, setTicksStorage] = useState<{ [key: string]: number[] }>({});
  const [percentageData, setPercentageData] = useState<PercentageData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedVolatility, setSelectedVolatility] = useState<string>('R_10');
  const [selectedTradeType, setSelectedTradeType] = useState<string>('even_odd');

  // Market Scanner States
  const [isScanning, setIsScanning] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [marketSuggestions, setMarketSuggestions] = useState([
    { volatility: 'R_10', tradeType: 'Even/Odd', strength: 'strong', confidence: 85, condition: 'Trending Up' },
    { volatility: '1HZ25V', tradeType: 'Over/Under', strength: 'weak', confidence: 60, condition: 'Sideways' }
  ]);
  const [topRecommendation, setTopRecommendation] = useState({
    volatility: 'R_50',
    tradeType: 'Rise/Fall',
    reason: 'Consistent Upward Trend'
  });
  const [scanningMessages, setScanningMessages] = useState([
    'Analyzing Volatility Patterns...',
    'Identifying Strongest Signals...',
    'Evaluating Market Conditions...',
    'Refining Trade Recommendations...',
    'Finalizing Optimal Strategy...'
  ]);
  const wsRef = useRef<WebSocket | null>(null);
  const matrixCanvasRef = useRef<HTMLCanvasElement>(null);

  const [nextSignalCountdown, setNextSignalCountdown] = useState(180); // Initial countdown value in seconds
  const countdownIntervalRef = useRef<number | null>(null);
  const signalUpdateIntervalRef = useRef<number | null>(null);

  // Matrix rain effect
  useEffect(() => {
    const canvas = matrixCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const matrix = "0123456789ABCDEF";
    const matrixArray = matrix.split("");

    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops: number[] = [];

    for (let x = 0; x < columns; x++) {
      drops[x] = 1;
    }

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#00ff41';
      ctx.font = fontSize + 'px monospace';

      for (let i = 0; i < drops.length; i++) {
        const text = matrixArray[Math.floor(Math.random() * matrixArray.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 35);
    return () => clearInterval(interval);
  }, []);

  // Simulate market scanning
  useEffect(() => {
    if (isScanning) {
      const interval = setInterval(() => {
        setScanProgress((prevProgress) => {
          const newProgress = prevProgress + 10;
          if (newProgress >= 100) {
            clearInterval(interval);
            setIsScanning(false);
            return 100;
          }
          return newProgress;
        });
      }, 500);

      return () => clearInterval(interval);
    }
  }, [isScanning]);

  // Initialize WebSocket connection and signal update logic
  useEffect(() => {
    // Initialize WebSocket for real-time data
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=52152');
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log('WebSocket connected');
      // Subscribe to volatility indices with history
      const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
      symbols.forEach(symbol => {
        ws.send(JSON.stringify({
          ticks_history: symbol,
          count: 200,
          end: 'latest',
          style: 'ticks',
          subscribe: 1
        }));
      });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.history && data.history.prices) {
        const symbol = data.echo_req.ticks_history;
        setTicksStorage(prev => ({
          ...prev,
          [symbol]: data.history.prices.map((price: string) => parseFloat(price))
        }));
      } else if (data.tick) {
        const { symbol, quote } = data.tick;
        setTicksStorage(prev => {
          const currentTicks = prev[symbol] || [];
          const updatedTicks = [...currentTicks, parseFloat(quote)];
          // Keep only last 200 ticks
          return {
            ...prev,
            [symbol]: updatedTicks.slice(-200)
          };
        });
      }
    };

    ws.onerror = (error) => {
      setIsConnected(false);
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('WebSocket disconnected');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  // Signal update and countdown logic
  useEffect(() => {
    const updateSignals = () => {
      const symbols = Object.keys(ticksStorage);
      const tradeTypes = ['rise_fall', 'even_odd', 'over_under'];
      const newSuggestions = [];
      let bestRecommendation = { volatility: '', tradeType: '', reason: '', confidence: 0 };

      symbols.forEach(symbol => {
        if (ticksStorage[symbol]?.length >= 50) {
          tradeTypes.forEach(tradeType => {
            const analysis = calculateAnalysis(symbol, tradeType);
            const confidence = Math.round(analysis.strength * 100);

            if (confidence > 50) {
              newSuggestions.push({
                volatility: getVolatilityDisplayName(symbol),
                tradeType: getTradeTypes().find(t => t.value === tradeType)?.label || tradeType,
                strength: confidence > 70 ? 'strong' : 'moderate',
                confidence,
                condition: analysis.recommendation
              });

              if (confidence > bestRecommendation.confidence) {
                bestRecommendation = {
                  volatility: getVolatilityDisplayName(symbol),
                  tradeType: getTradeTypes().find(t => t.value === tradeType)?.label || tradeType,
                  reason: analysis.recommendation,
                  confidence
                };
              }
            }
          });
        }
      });

      setMarketSuggestions(newSuggestions.slice(0, 5)); // Show top 5 suggestions
      if (bestRecommendation.volatility) {
        setTopRecommendation(bestRecommendation);
      }
    };

    // Update signals every 3 minutes
    signalUpdateIntervalRef.current = setInterval(updateSignals, 180000);

    // Initial update after 5 seconds to allow data collection
    setTimeout(updateSignals, 5000);

    return () => {
      if (signalUpdateIntervalRef.current) {
        clearInterval(signalUpdateIntervalRef.current);
      }
    };
  }, [ticksStorage]);

  // Countdown timer
  useEffect(() => {
    countdownIntervalRef.current = setInterval(() => {
      setNextSignalCountdown(prev => {
        if (prev <= 1) {
          return 180; // Reset to 3 minutes
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Calculate percentage data
  useEffect(() => {
    const calculatePercentages = () => {
      const newPercentageData: PercentageData[] = [];

      Object.entries(ticksData).forEach(([symbol, ticks]) => {
        if (ticks.length < 2) return;

        const current = ticks[ticks.length - 1];
        const previous = ticks[ticks.length - 2];
        const percentage = ((current - previous) / previous) * 100;

        const trend = percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'neutral';

        // Calculate last digit statistics
        const digits = ticks.map(tick => parseInt(tick.toString().slice(-1)));
        const lastDigitCounts: { [key: number]: number } = {};

        for (let i = 0; i <= 9; i++) {
          lastDigitCounts[i] = digits.filter(d => d === i).length;
        }

        // Calculate streaks
        const recentDigits = digits.slice(-20);
        let evenStreak = 0, oddStreak = 0, overStreak = 0, underStreak = 0;

        for (let i = recentDigits.length - 1; i >= 0; i--) {
          const digit = recentDigits[i];
          if (digit % 2 === 0) {
            if (i === recentDigits.length - 1 || recentDigits[i + 1] % 2 === 0) {
              evenStreak++;
            } else break;
          } else {
            if (i === recentDigits.length - 1 || recentDigits[i + 1] % 2 !== 0) {
              oddStreak++;
            } else break;
          }

          if (digit >= 5) {
            if (i === recentDigits.length - 1 || recentDigits[i + 1] >= 5) {
              overStreak++;
            }
          } else {
            if (i === recentDigits.length - 1 || recentDigits[i + 1] < 5) {
              underStreak++;
            }
          }
        }

        // Calculate predictions based on recent patterns
        const nextDigitProbability: { [key: number]: number } = {};
        const totalDigits = digits.length;

        for (let i = 0; i <= 9; i++) {
          const count = lastDigitCounts[i];
          const expectedFreq = totalDigits / 10;
          const deviation = count - expectedFreq;
          // Inverse probability - digits that appeared less are more likely
          nextDigitProbability[i] = Math.max(0.05, (expectedFreq - deviation) / totalDigits);
        }

        // Normalize probabilities
        const totalProb = Object.values(nextDigitProbability).reduce((sum, prob) => sum + prob, 0);
        Object.keys(nextDigitProbability).forEach(digit => {
          nextDigitProbability[parseInt(digit)] /= totalProb;
        });

        // Calculate biases
        const evenCount = digits.filter(d => d % 2 === 0).length;
        const oddCount = digits.length - evenCount;
        const evenOddBias = evenCount > oddCount * 1.1 ? 'odd' : oddCount > evenCount * 1.1 ? 'even' : 'neutral';

        const overCount = digits.filter(d => d >= 5).length;
        const underCount = digits.length - overCount;
        const overUnderBias = overCount > underCount * 1.1 ? 'under' : underCount > overCount * 1.1 ? 'over' : 'neutral';

        newPercentageData.push({
          symbol,
          current,
          percentage,
          trend,
          digits,
          lastDigitCounts,
          streaks: {
            even: evenStreak,
            odd: oddStreak,
            over: overStreak,
            under: underStreak
          },
          predictions: {
            nextDigitProbability,
            evenOddBias,
            overUnderBias
          }
        });
      });

      setPercentageData(newPercentageData);
    };

    calculatePercentages();
  }, [ticksData]);

  const getSymbolName = (symbol: string) => {
    const names: { [key: string]: string } = {
      '1HZ10V': 'Volatility 10 (1s)',
      '1HZ25V': 'Volatility 25 (1s)',
      '1HZ50V': 'Volatility 50 (1s)',
      '1HZ75V': 'Volatility 75 (1s)',
      '1HZ100V': 'Volatility 100 (1s)',
      'R_10': 'Volatility 10',
      'R_25': 'Volatility 25',
      'R_50': 'Volatility 50',
      'R_75': 'Volatility 75',
      'R_100': 'Volatility 100'
    };
    return names[symbol] || symbol;
  };

  const getDigitColor = (count: number, total: number) => {
    const percentage = (count / total) * 100;
    if (percentage < 8) return '#ff4444';
    if (percentage > 12) return '#44ff44';
    return '#ffff44';
  };

  const getDigitHighlightClass = (digit: number, data: PercentageData) => {
    const currentTick = data.digits[data.digits.length - 1];
    const lastDigit = currentTick;

    // Find highest and lowest frequency digits
    const counts = Object.values(data.lastDigitCounts);
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);

    const highestDigits = Object.entries(data.lastDigitCounts)
      .filter(([, count]) => count === maxCount)
      .map(([d]) => parseInt(d));

    const lowestDigits = Object.entries(data.lastDigitCounts)
      .filter(([, count]) => count === minCount)
      .map(([d]) => parseInt(d));

    // Priority: Last digit (yellow) > Highest (green) > Lowest (red)
    if (digit === lastDigit) {
      return 'last-digit';
    } else if (highestDigits.includes(digit)) {
      return 'highest-frequency';
    } else if (lowestDigits.includes(digit)) {
      return 'lowest-frequency';
    }

    return '';
  };

  const calculateAnalysis = (symbol: string, tradeType: string) => {
    const ticks = ticksStorage[symbol];
    if (!ticks?.length || ticks.length < 50) return { signal: 'NO DATA', strength: 0, recommendation: 'INSUFFICIENT DATA' };

    // Use last 200 ticks for analysis, or all available if less than 200
    const analysisLength = Math.min(ticks.length, 200);
    const recentTicks = ticks.slice(-analysisLength);
    const lastDigits = recentTicks.map(t => parseInt(t.toString().slice(-1)));

    switch (tradeType) {
      case 'even_odd':
        const evenCount = lastDigits.filter(d => d % 2 === 0).length;
        const oddCount = lastDigits.length - evenCount;
        const evenPercentage = (evenCount / lastDigits.length) * 100;
        const oddPercentage = (oddCount / lastDigits.length) * 100;
        return {
          signal: evenPercentage > 55 ? 'EVEN' : oddPercentage > 55 ? 'ODD' : 'NEUTRAL',
          strength: Math.abs(evenPercentage - oddPercentage) / 100,
          recommendation: evenPercentage > 60 ? 'STRONG EVEN' : oddPercentage > 60 ? 'STRONG ODD' : 'NEUTRAL'
        };

      case 'over_under':
        const over5Count = lastDigits.filter(d => d > 4).length;
        const under5Count = lastDigits.length - over5Count;
        const overPercentage = (over5Count / lastDigits.length) * 100;
        const underPercentage = (under5Count / lastDigits.length) * 100;
        return {
          signal: overPercentage > 55 ? 'OVER' : underPercentage > 55 ? 'UNDER' : 'NEUTRAL',
          strength: Math.abs(overPercentage - underPercentage) / 100,
          recommendation: overPercentage > 60 ? 'STRONG OVER' : underPercentage > 60 ? 'STRONG UNDER' : 'NEUTRAL'
        };

      case 'rise_fall':
        let riseCount = 0;
        let fallCount = 0;
        for (let i = 1; i < recentTicks.length; i++) {
          if (recentTicks[i] > recentTicks[i - 1]) riseCount++;
          else if (recentTicks[i] < recentTicks[i - 1]) fallCount++;
        }
        const risePercentage = (riseCount / (riseCount + fallCount)) * 100;
        const fallPercentage = (fallCount / (riseCount + fallCount)) * 100;
        return {
          signal: risePercentage > 55 ? 'RISE' : fallPercentage > 55 ? 'FALL' : 'NEUTRAL',
          strength: Math.abs(risePercentage - fallPercentage) / 100,
          recommendation: risePercentage > 60 ? 'STRONG RISE' : fallPercentage > 60 ? 'STRONG FALL' : 'NEUTRAL'
        };

      default:
        return {
          signal: 'N/A',
          strength: 0,
          recommendation: 'SELECT TRADE TYPE'
        };
    }
  };

  const getVolatilityList = () => {
    return [
      { value: '1HZ10V', label: 'Volatility 10 (1s)' },
      { value: '1HZ25V', label: 'Volatility 25 (1s)' },
      { value: '1HZ50V', label: 'Volatility 50 (1s)' },
      { value: '1HZ75V', label: 'Volatility 75 (1s)' },
      { value: '1HZ100V', label: 'Volatility 100 (1s)' },
      { value: 'R_10', label: 'Volatility 10' },
      { value: 'R_25', label: 'Volatility 25' },
      { value: 'R_50', label: 'Volatility 50' },
      { value: 'R_75', label: 'Volatility 75' },
      { value: 'R_100', label: 'Volatility 100' }
    ];
  };

  const getTradeTypes = () => {
    return [
      { value: 'even_odd', label: 'Even/Odd' },
      { value: 'over_under', label: 'Over/Under' },
      { value: 'rise_fall', label: 'Rise/Fall' }
    ];
  };

  const getMarketVolatilities = () => [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' }
  ];

  const getVolatilityDisplayName = (symbol: string) => {
    const mapping: {[key: string]: string} = {
      'R_10': 'Volatility 10 Index',
      'R_25': 'Volatility 25 Index',
      'R_50': 'Volatility 50 Index',
      'R_75': 'Volatility 75 Index',
      'R_100': 'Volatility 100 Index'
    };
    return mapping[symbol] || symbol;
  };

  const formatCountdown = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="percentage-tool">
      <canvas ref={matrixCanvasRef} className="matrix-bg" />

      <div className="tool-overlay">
        <div className="header">
          <div className="title">
            <span className="matrix-text">PERCENTAGE ANALYSIS TOOL</span>
          </div>
          <div className="controls">
            <select 
              value={selectedVolatility} 
              onChange={(e) => setSelectedVolatility(e.target.value)}
              className="volatility-selector"
            >
              {getVolatilityList().map(vol => (
                <option key={vol.value} value={vol.value}>{vol.label}</option>
              ))}
            </select>
            <select 
              value={selectedTradeType} 
              onChange={(e) => setSelectedTradeType(e.target.value)}
              className="trade-type-selector"
            >
              {getTradeTypes().map(trade => (
                <option key={trade.value} value={trade.value}>{trade.label}</option>
              ))}
            </select>
          </div>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="status-dot"></div>
            {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </div>
        </div>
        <div className="market-scanner">
          <h3>INTELLIGENT MARKET SCANNER</h3>
          <div className="scanner-content">
            <div className="scanner-header">
              <h3>🎯 Market Scanner</h3>
              <div className="signal-countdown">
                <span className="countdown-label">Next Signal in:</span>
                <span className="countdown-timer">{formatCountdown(nextSignalCountdown)}</span>
              </div>
              {isScanning && (
                <div className="scanning-status">
                  <div className="scanning-dots">
                    <div className="dot"></div>
                    <div className="dot"></div>
                    <div className="dot"></div>
                  </div>
                  <span>Scanning...</span>
                </div>
              )}
            </div>

            {isScanning ? (
              <div className="scanning-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${scanProgress}%` }}></div>
                </div>
                <div className="scanning-messages">
                  {scanningMessages.map((message, index) => (
                    <div key={index} className="scan-message">{message}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="scan-results">
                <div className="top-recommendation">
                  <h4>🎯 TOP MARKET RECOMMENDATION</h4>
                  <div className="recommendation-card">
                    <div className="rec-volatility">
                      <span className="rec-label">SUGGESTED VOLATILITY:</span>
                      <span className="rec-value">{topRecommendation.volatility}</span>
                    </div>
                    <div className="rec-trade-type">
                      <span className="rec-label">TRADE TYPE:</span>
                      <span className="rec-value">{topRecommendation.tradeType}</span>
                    </div>
                    <div className="rec-reason">
                      <span className="rec-label">ANALYSIS:</span>
                      <span className="rec-value">{topRecommendation.reason}</span>
                    </div>
                  </div>
                </div>

                <div className="strongest-signals">
                  <h4>STRONGEST TRADING SIGNALS DETECTED</h4>
                  <div className="signal-cards">
                    {marketSuggestions.map((suggestion, index) => (
                      <div key={index} className={`signal-card ${suggestion.strength}`}>
                        <div className="signal-header">
                          <span className="volatility-name">{suggestion.volatility}</span>
                          <span className={`signal-strength ${suggestion.strength}`}>
                            {suggestion.strength.toUpperCase()}
                          </span>
                        </div>
                        <div className="signal-details">
                          <div className="trade-type">
                            <span className="label">RECOMMENDED:</span>
                            <span className="value">{suggestion.tradeType}</span>
                          </div>
                          <div className="confidence">
                            <span className="label">CONFIDENCE:</span>
                            <span className="value">{suggestion.confidence}%</span>
                          </div>
                          <div className="market-condition">
                            <span className="label">CONDITION:</span>
                            <span className="value">{suggestion.condition}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="analysis-grid">
          {percentageData.filter(data => data.symbol === selectedVolatility).map((data) => {
            const tradeAnalysis = calculateAnalysis(data.symbol, selectedTradeType);
            return (
              <div key={data.symbol} className="analysis-card main-analysis">
                <div className="card-header">
                  <h3>{getSymbolName(data.symbol)}</h3>
                  <div className={`trend-indicator ${data.trend}`}>
                    <span className="current-price">{data.current.toFixed(5)}</span>
                    <span className="percentage">{data.percentage.toFixed(3)}%</span>
                  </div>
                </div>

                <div className="trade-analysis-section">
                  <h4>Trade Type Analysis: {getTradeTypes().find(t => t.value === selectedTradeType)?.label}</h4>
                  <div className="trade-signal">
                    <div className={`signal-box ${tradeAnalysis.recommendation.toLowerCase().includes('strong') ? 'strong' : 'weak'}`}>
                      <span className="signal-label">Signal:</span>
                      <span className="signal-value">{tradeAnalysis.signal}</span>
                    </div>
                    <div className="recommendation">
                      <span className="rec-label">Recommendation:</span>
                      <span className={`rec-value ${tradeAnalysis.recommendation.toLowerCase().replace(' ', '-')}`}>
                        {tradeAnalysis.recommendation}
                      </span>
                    </div>
                    <div className="strength-meter">
                      <span className="strength-label">Strength:</span>
                      <div className="strength-bar">
                        <div 
                          className="strength-fill"
                          style={{ width: `${tradeAnalysis.strength * 100}%` }}
                        />
                      </div>
                      <span className="strength-value">{(tradeAnalysis.strength * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div></div>
            );
          })}

          <div className="volatility-overview">
            <h4>All Volatilities Overview</h4>
            <div className="mini-cards">
              {percentageData.map((data) => (
                <div 
                  key={data.symbol} 
                  className={`mini-card ${data.symbol === selectedVolatility ? 'active' : ''}`}
                  onClick={() => setSelectedVolatility(data.symbol)}
                >
                  <div className="mini-header">
                    <span className="mini-symbol">{getSymbolName(data.symbol)}</span>
                    <span className={`mini-trend ${data.trend}`}>
                      {data.percentage.toFixed(2)}%
                    </span>
                  </div></div>
              ))}
            </div>
          </div>

          {percentageData.filter(data => data.symbol === selectedVolatility).map((data) => (
            <div key={`${data.symbol}-details`} className="analysis-card">
              <div className="card-header">
                <h3>Detailed Analysis</h3>
              </div>

              <div className="digit-analysis">
                <h4>Last Digit Distribution</h4>
                <div className="digit-legend">
                  <div className="legend-item last-digit">
                    <div className="legend-indicator"></div>
                    <span className="legend-text">Last Tick</span>
                  </div>
                  <div className="legend-item highest">
                    <div className="legend-indicator"></div>
                    <span className="legend-text">Highest %</span>
                  </div>
                  <div className="legend-item lowest">
                    <div className="legend-indicator"></div>
                    <span className="legend-text">Lowest %</span>
                  </div>
                </div>
                <div className="digit-grid">
                  {Object.entries(data.lastDigitCounts).map(([digit, count]) => {
                    const highlightClass = getDigitHighlightClass(parseInt(digit), data);
                    return (
                      <div 
                        key={digit}
                        className={`digit-cell ${highlightClass}`}
                        style={{ 
                          color: getDigitColor(count, data.digits.length),
                          textShadow: `0 0 10px ${getDigitColor(count, data.digits.length)}`
                        }}
                      >
                        <div className="digit">{digit}</div>
                        <div className="count">{count}</div>
                        <div className="percentage">
                          {((count / data.digits.length) * 100).toFixed(1)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="streaks-section">
                <h4>Current Streaks</h4>
                <div className="streaks-grid">
                  <div className="streak-item">
                    <span className="streak-label">Even:</span>
                    <span className={`streak-value ${data.streaks.even >= 3 ? 'hot' : ''}`}>
                      {data.streaks.even}
                    </span>
                  </div>
                  <div className="streak-item">
                    <span className="streak-label">Odd:</span>
                    <span className={`streak-value ${data.streaks.odd >= 3 ? 'hot' : ''}`}>
                      {data.streaks.odd}
                    </span>
                  </div>
                  <div className="streak-item">
                    <span className="streak-label">Over:</span>
                    <span className={`streak-value ${data.streaks.over >= 3 ? 'hot' : ''}`}>
                      {data.streaks.over}
                    </span>
                  </div>
                  <div className="streak-item">
                    <span className="streak-label">Under:</span>
                    <span className={`streak-value ${data.streaks.under >= 3 ? 'hot' : ''}`}>
                      {data.streaks.under}
                    </span>
                  </div>
                </div>
              </div>

              <div className="predictions-section">
                <h4>AI Predictions</h4>
                <div className="bias-indicators">
                  <div className={`bias-item ${data.predictions.evenOddBias}`}>
                    <span>Next: {data.predictions.evenOddBias.toUpperCase()}</span>
                  </div>
                  <div className={`bias-item ${data.predictions.overUnderBias}`}>
                    <span>Next: {data.predictions.overUnderBias.toUpperCase()}</span>
                  </div>
                </div>
                <div className="probability-bars">
                  {Object.entries(data.predictions.nextDigitProbability)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([digit, prob]) => (
                    <div key={digit} className="prob-bar">
                      <span className="digit-label">{digit}</span>
                      <div className="bar-container">
                        <div 
                          className="bar-fill"
                          style={{ width: `${prob * 100}%` }}
                        />
                      </div>
                      <span className="prob-value">{(prob * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="live-ticks">
                <h4>Live Tick Stream</h4>
                <div className="tick-display">
                  {ticksData[data.symbol]?.slice(-10).map((tick, index) => (
                    <span 
                      key={index}
                      className="tick-value"
                      style={{ 
                        animationDelay: `${index * 0.1}s`,
                        opacity: 0.5 + (index / 10) * 0.5
                      }}
                    >
                      {tick.toFixed(5)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PercentageTool;