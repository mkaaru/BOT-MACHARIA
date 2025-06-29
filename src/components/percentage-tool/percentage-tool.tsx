
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
  
  const [percentageData, setPercentageData] = useState<PercentageData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedVolatility, setSelectedVolatility] = useState<string>('R_10');
  const [selectedTradeType, setSelectedTradeType] = useState<string>('even_odd');
  const wsRef = useRef<WebSocket | null>(null);
  const matrixCanvasRef = useRef<HTMLCanvasElement>(null);

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

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');
      
      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
        
        // Subscribe to volatility indices
        ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V', 'R_10', 'R_25', 'R_50', 'R_75', 'R_100'].forEach(symbol => {
          wsRef.current?.send(JSON.stringify({
            ticks_history: symbol,
            count: 100,
            end: 'latest',
            style: 'ticks',
            subscribe: 1
          }));
        });
      };

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.history && data.history.prices) {
          const symbol = data.echo_req.ticks_history;
          const prices = data.history.prices.map((price: string) => parseFloat(price));
          setTicksData(prev => ({
            ...prev,
            [symbol]: prices
          }));
        } else if (data.tick) {
          const { symbol, quote } = data.tick;
          setTicksData(prev => ({
            ...prev,
            [symbol]: [...(prev[symbol] || []).slice(-99), parseFloat(quote)]
          }));
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };
    };

    connectWebSocket();

    return () => {
      wsRef.current?.close();
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

  const getTradeTypeAnalysis = (data: PercentageData, tradeType: string) => {
    const recentTicks = data.digits.slice(-20);
    
    switch (tradeType) {
      case 'even_odd':
        const evenCount = recentTicks.filter(d => d % 2 === 0).length;
        const oddCount = recentTicks.length - evenCount;
        return {
          signal: evenCount > oddCount ? 'ODD' : 'EVEN',
          strength: Math.abs(evenCount - oddCount) / recentTicks.length,
          recommendation: evenCount > oddCount * 1.2 ? 'STRONG ODD' : oddCount > evenCount * 1.2 ? 'STRONG EVEN' : 'NEUTRAL'
        };
      
      case 'over_under':
        const overCount = recentTicks.filter(d => d >= 5).length;
        const underCount = recentTicks.length - overCount;
        return {
          signal: overCount > underCount ? 'UNDER' : 'OVER',
          strength: Math.abs(overCount - underCount) / recentTicks.length,
          recommendation: overCount > underCount * 1.2 ? 'STRONG UNDER' : underCount > overCount * 1.2 ? 'STRONG OVER' : 'NEUTRAL'
        };
      
      case 'rise_fall':
        const riseCount = recentTicks.slice(1).filter((tick, i) => tick > recentTicks[i]).length;
        const fallCount = recentTicks.length - 1 - riseCount;
        return {
          signal: riseCount > fallCount ? 'FALL' : 'RISE',
          strength: Math.abs(riseCount - fallCount) / (recentTicks.length - 1),
          recommendation: riseCount > fallCount * 1.2 ? 'STRONG FALL' : fallCount > riseCount * 1.2 ? 'STRONG RISE' : 'NEUTRAL'
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

        <div className="analysis-grid">
          {percentageData.filter(data => data.symbol === selectedVolatility).map((data) => {
            const tradeAnalysis = getTradeTypeAnalysis(data, selectedTradeType);
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
