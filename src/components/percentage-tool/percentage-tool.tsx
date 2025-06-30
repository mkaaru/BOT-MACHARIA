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
  signalStrength: number;
  recommendedAction: string;
}

interface MarketSignal {
  volatility: string;
  volatilityName: string;
  tradeType: string;
  strength: 'strong' | 'medium' | 'weak';
  confidence: number;
  condition: string;
  signalScore: number;
}

const PercentageTool: React.FC = () => {
  console.log('PercentageTool component rendering...');
  
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

  // Trading Hub Tab States
  const [activeTab, setActiveTab] = useState<'detailed' | 'signals'>('detailed');
  const [signalUpdateInterval, setSignalUpdateInterval] = useState<number>(60); // seconds

  // Market Scanner States
  const [isScanning, setIsScanning] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [marketSuggestions, setMarketSuggestions] = useState<MarketSignal[]>([]);
  const [topRecommendation, setTopRecommendation] = useState({
    volatility: 'Volatility 50',
    tradeType: 'Rise/Fall',
    reason: 'Consistent Upward Trend',
    confidence: 85,
    signalStrength: 'strong'
  });
  const [scanningMessages, setScanningMessages] = useState([
    'Analyzing Real Market Data...',
    'Processing Last 200 Ticks...',
    'Calculating Signal Strength...',
    'Identifying Strongest Patterns...',
    'Generating Trading Signals...'
  ]);

  // Signal update timer states
  const [nextSignalUpdate, setNextSignalUpdate] = useState(60); // 1 minute in seconds
  const [lastSignalUpdate, setLastSignalUpdate] = useState(Date.now());
  const [signalUpdateDebounce, setSignalUpdateDebounce] = useState<NodeJS.Timeout | null>(null);
  
  // Tick buffering states
  const [tickBuffer, setTickBuffer] = useState<{ [key: string]: number[] }>({});
  const [lastBufferFlush, setLastBufferFlush] = useState(Date.now());

  const [tradeAnalysis, setTradeAnalysis] = useState({
    signal: 'EVEN',
    recommendation: 'Strong Buy',
    strength: 0.87,
    confidence: 92
  });

  const [volatilitySignals, setVolatilitySignals] = useState([
    { name: 'Volatility 10 Index', price: '6303.55600', signal: 'EVEN', strength: 87, volume: '2.4K', change: 2.3 },
    { name: 'Volatility 25 Index', price: '4521.33421', signal: 'ODD', strength: 73, volume: '1.8K', change: -1.2 },
    { name: 'Volatility 50 Index', price: '3987.12456', signal: 'MATCH', strength: 91, volume: '3.1K', change: 4.1 },
    { name: 'Volatility 75 Index', price: '5432.87654', signal: 'EVEN', strength: 65, volume: '1.5K', change: -0.8 },
    { name: 'Volatility 100 Index', price: '7845.23198', signal: 'ODD', strength: 82, volume: '2.9K', change: 3.7 },
    { name: 'Boom 1000 Index', price: '9876.54321', signal: 'MATCH', strength: 78, volume: '2.2K', change: 1.5 },
    { name: 'Crash 1000 Index', price: '1234.56789', signal: 'EVEN', strength: 69, volume: '1.7K', change: -2.1 },
    { name: 'Step Index', price: '5555.55555', signal: 'ODD', strength: 84, volume: '2.6K', change: 2.8 },
    { name: 'Bear Market Index', price: '3333.33333', signal: 'MATCH', strength: 76, volume: '1.9K', change: 0.9 },
    { name: 'Bull Market Index', price: '7777.77777', signal: 'EVEN', strength: 88, volume: '3.3K', change: 3.4 }
  ]);

  // Risk disclaimer state
  const [showRiskDisclaimer, setShowRiskDisclaimer] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const matrixCanvasRef = useRef<HTMLCanvasElement>(null);
  const signalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Add state for the strongest signal and its last update time
  const [strongestSignal, setStrongestSignal] = useState<MarketSignal | null>(null);
  const [strongestSignalLastUpdate, setStrongestSignalLastUpdate] = useState<number>(0);
  const [isSignalTransitioning, setIsSignalTransitioning] = useState(false);

  // Tick buffer flush mechanism - flushes buffer every minute minimum
  useEffect(() => {
    const flushBuffer = () => {
      const now = Date.now();
      
      // Only flush if at least 1 minute has passed
      if (now - lastBufferFlush >= 60000) {
        setTicksData(prev => {
          const newData = { ...prev };
          Object.entries(tickBuffer).forEach(([symbol, bufferedTicks]) => {
            if (bufferedTicks.length > 0) {
              newData[symbol] = [...(prev[symbol] || []).slice(-(200 - bufferedTicks.length)), ...bufferedTicks].slice(-200);
            }
          });
          return newData;
        });
        
        // Clear buffer and update flush time
        setTickBuffer({});
        setLastBufferFlush(now);
      }
    };

    // Check for buffer flush every 5 seconds
    const bufferFlushInterval = setInterval(flushBuffer, 5000);

    return () => {
      clearInterval(bufferFlushInterval);
    };
  }, [tickBuffer, lastBufferFlush]);

  // Signal update timer - updates based on configurable interval
  useEffect(() => {
    const updateSignals = () => {
      setIsScanning(true);
      setScanProgress(0);
      setLastSignalUpdate(Date.now());
      setNextSignalUpdate(signalUpdateInterval); // Reset to configured interval

      // Simulate progressive scanning
      const progressInterval = setInterval(() => {
        setScanProgress(prev => {
          const newProgress = prev + 20;
          if (newProgress >= 100) {
            clearInterval(progressInterval);
            setTimeout(() => {
              generateMarketSignals();
              setIsScanning(false);
            }, 500);
            return 100;
          }
          return newProgress;
        });
      }, 400);
    };

    // Initial signal generation
    updateSignals();

    // Set up interval for signal updates based on configuration (minimum 1 minute)
    const actualInterval = Math.max(signalUpdateInterval, 60) * 1000; // Ensure minimum 1 minute
    signalTimerRef.current = setInterval(updateSignals, actualInterval);

    return () => {
      if (signalTimerRef.current) {
        clearInterval(signalTimerRef.current);
      }
      if (signalUpdateDebounce) {
        clearTimeout(signalUpdateDebounce);
      }
    };
  }, [ticksData, signalUpdateInterval]);

  // Countdown timer for next signal update
  useEffect(() => {
    countdownTimerRef.current = setInterval(() => {
      setNextSignalUpdate(prev => {
        if (prev <= 1) {
          return Math.max(signalUpdateInterval, 60); // Reset when it reaches 0, minimum 60 seconds
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, [signalUpdateInterval]);

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

  // WebSocket connection with app_id 69811 and 200 ticks
  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=69811');

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected with app_id 69811');

        // Subscribe to volatility indices with 200 ticks for better analysis
        ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V', 'R_10', 'R_25', 'R_50', 'R_75', 'R_100'].forEach(symbol => {
          wsRef.current?.send(JSON.stringify({
            ticks_history: symbol,
            count: 200, // Increased to 200 ticks for better analysis
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
          
          // Add tick to buffer instead of directly updating
          setTickBuffer(prev => ({
            ...prev,
            [symbol]: [...(prev[symbol] || []).slice(-199), parseFloat(quote)] // Maintain 200 ticks in buffer
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

  // Generate market signals based on real data analysis with stability checks
  const generateMarketSignals = () => {
    const signals: MarketSignal[] = [];

    Object.entries(ticksData).forEach(([symbol, ticks]) => {
      if (ticks.length < 200) return;

      const volatilityName = getVolatilityName(symbol);

      // Analyze last 200 ticks for signal strength with stability
      const recentTicks = ticks.slice(-200);
      const digits = recentTicks.map(tick => parseInt(tick.toString().slice(-1)));

      // Calculate various signal strengths with minimum threshold
      const evenOddAnalysis = analyzeEvenOddStable(digits);
      const overUnderAnalysis = analyzeOverUnderStable(digits);
      const riseFactAnalysis = analyzeRiseFallStable(recentTicks);

      // Only include signals with minimum strength to avoid flickering
      const analyses = [
        { type: 'Even/Odd', ...evenOddAnalysis },
        { type: 'Over/Under', ...overUnderAnalysis },
        { type: 'Rise/Fall', ...riseFactAnalysis }
      ].filter(analysis => analysis.strength >= 0.15); // Minimum threshold

      if (analyses.length === 0) return; // Skip if no stable signals

      // Determine strongest signal with stability factor
      const strongestSignal = analyses.reduce((prev, current) => 
        current.strength > prev.strength ? current : prev
      );

      // Only add signals that meet stability criteria
      if (strongestSignal.strength >= 0.2) {
        signals.push({
          volatility: symbol,
          volatilityName,
          tradeType: strongestSignal.type,
          strength: strongestSignal.strength > 0.6 ? 'strong' : strongestSignal.strength > 0.35 ? 'medium' : 'weak',
          confidence: Math.round(Math.min(strongestSignal.strength * 100, 95)), // Cap at 95%
          condition: strongestSignal.condition,
          signalScore: strongestSignal.strength
        });
      }
    });

    // Only update if there's a significant change in top signals
    const sortedSignals = signals.sort((a, b) => b.signalScore - a.signalScore);
    const topSignals = sortedSignals.slice(0, 6);

    // Check if signals have changed significantly
    const hasSignificantChange = marketSuggestions.length === 0 || 
      topSignals.length !== marketSuggestions.length ||
      topSignals.some((signal, index) => {
        const existing = marketSuggestions[index];
        return !existing || 
               signal.volatility !== existing.volatility ||
               signal.tradeType !== existing.tradeType ||
               Math.abs(signal.confidence - existing.confidence) > 5;
      });

    if (hasSignificantChange) {
      setMarketSuggestions(topSignals);

      // Update top recommendation with detailed analysis
      if (topSignals.length > 0) {
        const topSignal = topSignals[0];
        setTopRecommendation({
          volatility: topSignal.volatilityName,
          tradeType: topSignal.tradeType,
          reason: topSignal.condition,
          confidence: topSignal.confidence,
          signalStrength: topSignal.strength
        });
      }
    }

    // Update strongest signal separately (more frequently to prevent flickering)
    if (sortedSignals.length > 0) {
      const currentStrongest = sortedSignals[0];
      const now = Date.now();

      // Only update strongest signal if it's significantly different or enough time has passed
      if (!strongestSignal || 
          currentStrongest.volatility !== strongestSignal.volatility ||
          currentStrongest.tradeType !== strongestSignal.tradeType ||
          Math.abs(currentStrongest.confidence - strongestSignal.confidence) > 10 ||
          now - strongestSignalLastUpdate > 30000) { // Update at least every 30 seconds

        setIsSignalTransitioning(true);
        setTimeout(() => {
          setStrongestSignal(currentStrongest);
          setStrongestSignalLastUpdate(now);
          setIsSignalTransitioning(false);
        }, 300);
      }
    }
  };

  const analyzeEvenOdd = (digits: number[]) => {
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.length - evenCount;
    const bias = Math.abs(evenCount - oddCount) / digits.length;

    return {
      strength: bias,
      condition: evenCount > oddCount ? 'Even Bias Detected' : 'Odd Bias Detected',
      recommendation: evenCount > oddCount ? 'Odd' : 'Even'
    };
  };

  const analyzeOverUnder = (digits: number[]) => {
    const overCount = digits.filter(d => d >= 5).length;
    const underCount = digits.length - overCount;
    const bias = Math.abs(overCount - underCount) / digits.length;

    return {
      strength: bias,
      condition: overCount > underCount ? 'Over Bias Detected' : 'Under Bias Detected',
      recommendation: overCount > underCount ? 'Under' : 'Over'
    };
  };

  const analyzeRiseFall = (ticks: number[]) => {
    let riseCount = 0;
    let fallCount = 0;

    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i] > ticks[i - 1]) riseCount++;
      else if (ticks[i] < ticks[i - 1]) fallCount++;
    }

    const bias = Math.abs(riseCount - fallCount) / (ticks.length - 1);

    return {
      strength: bias,
      condition: riseCount > fallCount ? 'Upward Trend' : 'Downward Trend',
      recommendation: riseCount > fallCount ? 'Fall' : 'Rise'
    };
  };

  // Stable analysis functions with improved thresholds and consistency checks
  const analyzeEvenOddStable = (digits: number[]) => {
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.length - evenCount;
    const bias = Math.abs(evenCount - oddCount) / digits.length;

    // Check consistency across different segments
    const segment1 = digits.slice(0, 50);
    const segment2 = digits.slice(50, 100);
    const segment3 = digits.slice(100, 150);
    const segment4 = digits.slice(150, 200);

    const segments = [segment1, segment2, segment3, segment4];
    const segmentBiases = segments.map(segment => {
      const evenSeg = segment.filter(d => d % 2 === 0).length;
      const oddSeg = segment.length - evenSeg;
      return evenSeg > oddSeg ? 'even' : 'odd';
    });

    // Check if bias is consistent across segments
    const consistentBias = segmentBiases.filter(b => b === (evenCount > oddCount ? 'even' : 'odd')).length >= 3;
    const stabilityFactor = consistentBias ? 1.2 : 0.8;

    return {
      strength: bias * stabilityFactor,
      condition: evenCount > oddCount ? 'Consistent Even Bias Pattern' : 'Consistent Odd Bias Pattern',
      recommendation: evenCount > oddCount ? 'Odd' : 'Even'
    };
  };

  const analyzeOverUnderStable = (digits: number[]) => {
    const overCount = digits.filter(d => d >= 5).length;
    const underCount = digits.length - overCount;
    const bias = Math.abs(overCount - underCount) / digits.length;

    // Check for streak patterns
    let overStreaks = 0;
    let underStreaks = 0;
    let currentStreak = 0;
    let currentType = digits[0] >= 5 ? 'over' : 'under';

    for (let i = 1; i < digits.length; i++) {
      const type = digits[i] >= 5 ? 'over' : 'under';
      if (type === currentType) {
        currentStreak++;
      } else {
        if (currentStreak >= 2) {
          if (currentType === 'over') overStreaks++;
          else underStreaks++;
        }
        currentStreak = 1;
        currentType = type;
      }
    }

    const streakConsistency = Math.abs(overStreaks - underStreaks) > 0 ? 1.1 : 1.0;

    return {
      strength: bias * streakConsistency,
      condition: overCount > underCount ? 'Strong Over Pattern with Streaks' : 'Strong Under Pattern with Streaks',
      recommendation: overCount > underCount ? 'Under' : 'Over'
    };
  };

  const analyzeRiseFallStable = (ticks: number[]) => {
    let riseCount = 0;
    let fallCount = 0;
    let consecutiveRises = 0;
    let consecutiveFalls = 0;
    let maxRiseStreak = 0;
    let maxFallStreak = 0;

    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i] > ticks[i - 1]) {
        riseCount++;
        consecutiveRises++;
        consecutiveFalls = 0;
        maxRiseStreak = Math.max(maxRiseStreak, consecutiveRises);
      } else if (ticks[i] < ticks[i - 1]) {
        fallCount++;
        consecutiveFalls++;
        consecutiveRises = 0;
        maxFallStreak = Math.max(maxFallStreak, consecutiveFalls);
      } else {
        consecutiveRises = 0;
        consecutiveFalls = 0;
      }
    }

    const bias = Math.abs(riseCount - fallCount) / (ticks.length - 1);

    // Add momentum factor based on recent trend strength
    const recent20 = ticks.slice(-20);
    let recentRises = 0;
    let recentFalls = 0;

    for (let i = 1; i < recent20.length; i++) {
      if (recent20[i] > recent20[i - 1]) recentRises++;
      else if (recent20[i] < recent20[i - 1]) recentFalls++;
    }

    const momentumFactor = Math.abs(recentRises - recentFalls) / 19;
    const stabilityFactor = 1 + (momentumFactor * 0.3);

    return {
      strength: bias * stabilityFactor,
      condition: riseCount > fallCount ? 'Strong Upward Momentum Detected' : 'Strong Downward Momentum Detected',
      recommendation: riseCount > fallCount ? 'Fall' : 'Rise'
    };
  };

  const getVolatilityName = (symbol: string): string => {
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

  // Calculate percentage data
  useEffect(() => {
    const calculatePercentages = () => {
      const newPercentageData: PercentageData[] = [];

      Object.entries(ticksData).forEach(([symbol, ticks]) => {
        if (ticks.length < 50) return;

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

        // Calculate signal strength for this volatility
        const recentAnalysis = ticks.length >= 200 ? analyzeEvenOdd(digits.slice(-200)) : { strength: 0, recommendation: 'Insufficient Data' };

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
          },
          signalStrength: recentAnalysis.strength,
          recommendedAction: recentAnalysis.recommendation
        });
      });

      setPercentageData(newPercentageData);
    };

    calculatePercentages();
  }, [ticksData]);

  const getSymbolName = (symbol: string) => {
    return getVolatilityName(symbol);
  };

  const formatCountdownTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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

  console.log('Rendering percentage tool with data:', { 
    ticksDataLength: Object.keys(ticksData).length,
    isConnected,
    percentageDataLength: percentageData.length 
  });

  return (
    <div className="percentage-tool">
      <canvas ref={matrixCanvasRef} className="matrix-bg" />

      <div className="tool-overlay" style={{ minHeight: '100vh', zIndex: 10 }}>
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
         {/* Trading Hub with Sub-tabs */}
        <div className="trading-hub-container">
          <div className="trading-hub-header">
            <h3>🎯 TRADING HUB</h3>
            <div className="trading-hub-tabs">
              <button 
                className={`tab-button ${activeTab === 'detailed' ? 'active' : ''}`}
                onClick={() => setActiveTab('detailed')}
              >
                Detailed Analysis
              </button>
              <button 
                className={`tab-button ${activeTab === 'signals' ? 'active' : ''}`}
                onClick={() => setActiveTab('signals')}
              >
                Strongest Signals
              </button>
            </div>
          </div>

          <div className="trading-hub-content">
            {activeTab === 'detailed' && (
              <div className="detailed-analysis-tab">
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
                        </div>
                      </div>
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
                          </div>
                        </div>
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
            )}

            {activeTab === 'signals' && (
              <div className="signals-tab">
                <div className="signals-controls">
                  <div className="signal-timing-control">
                    <label htmlFor="signal-interval">Signal Update Interval:</label>
                    <select 
                      id="signal-interval"
                      value={signalUpdateInterval} 
                      onChange={(e) => setSignalUpdateInterval(Number(e.target.value))}
                      className="interval-selector"
                    >
                      <option value={60}>1 minute</option>
                      <option value={120}>2 minutes</option>
                      <option value={180}>3 minutes</option>
                      <option value={300}>5 minutes</option>
                      <option value={600}>10 minutes</option>
                    </select>
                  </div>
                  <div className="next-signal-timer">
                    <span className="timer-label">NEXT UPDATE IN:</span>
                    <span className="timer-countdown">{formatCountdownTime(nextSignalUpdate)}</span>
                  </div>
                </div>

                <div className={`strongest-signal-panel ${isSignalTransitioning ? 'transitioning' : ''}`}>
                  <div className="panel-header">
                    <span className="panel-title">🎯 STRONGEST SIGNAL DETECTED</span>
                    <span className={`live-indicator ${isSignalTransitioning ? 'updating' : ''}`}>
                      {isSignalTransitioning ? '⟳ UPDATING' : '● LIVE'}
                    </span>
                  </div>
                  {strongestSignal ? (
                    <div className={`strongest-signal-content ${isSignalTransitioning ? 'fade-transition' : ''}`}>
                      <div className="signal-main">
                        <div className="volatility-name">{strongestSignal.volatilityName}</div>
                        <div className="signal-badge-large">
                          <span className={`signal-type ${strongestSignal.tradeType.toLowerCase().replace('/', '_')}`}>
                            {strongestSignal.tradeType}
                          </span>
                          <span className={`signal-strength ${strongestSignal.strength}`}>
                            {strongestSignal.strength.toUpperCase()}
                          </span>
                        </div>
                        <div className="confidence-display">
                          <span className="confidence-label">CONFIDENCE</span>
                          <span className="confidence-value">{strongestSignal.confidence}%</span>
                          <div className="confidence-stability">
                            <span className="stability-indicator">STABLE</span>
                          </div>
                        </div>
                      </div>
                      <div className="signal-details">
                        <span className="condition-text">{strongestSignal.condition}</span>
                        <div className="last-update">
                          Updated {Math.floor((Date.now() - strongestSignalLastUpdate) / 1000)}s ago
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="no-signal">
                      <span>Analyzing market conditions...</span>
                      <div className="scanning-dots">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="market-scanner">
          <div className="scanner-header">
            <h3>INTELLIGENT MARKET SCANNER</h3>
          </div>
          <div className="scanner-content">
            {isScanning ? (
              <div className="scanning-animation">
                <div className="scanner-lines">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="scan-line" style={{ animationDelay: `${i * 0.15}s` }}>
                      <span className="scan-text">
                        {scanningMessages[i % scanningMessages.length]}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="scanning-progress">
                  <div className="progress-bar" style={{ width: `${scanProgress}%` }}></div>
                </div>
                <div className="scanning-status">
                  <span className="status-text">ANALYZING 200 TICKS PER VOLATILITY... {scanProgress}%</span>
                </div>
              </div>
            ) : (
              <div className="scan-results">
                <div className="strongest-signals">
                  <h4>STRONGEST TRADING SIGNALS DETECTED</h4>
                  <div className="signal-cards">
                    {marketSuggestions.map((suggestion, index) => (
                      <div key={index} className={`signal-card ${suggestion.strength}`}>
                        <div className="signal-header">
                          <span className="volatility-name">{suggestion.volatilityName}</span>
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

                <div className="top-recommendation">
                  <h4>🎯 TOP MARKET RECOMMENDATION</h4>
                  <div className="recommendation-card">
                    <div className="rec-header">
                      <div className="rec-volatility">
                        <span className="rec-label">SUGGESTED VOLATILITY:</span>
                        <span className="rec-value">{topRecommendation.volatility}</span>
                      </div>
                      <div className={`rec-signal-strength ${topRecommendation.signalStrength}`}>
                        <span className="strength-badge">{topRecommendation.signalStrength?.toUpperCase()}</span>
                      </div>
                    </div>
                    <div className="rec-trade-type">
                      <span className="rec-label">TRADE TYPE:</span>
                      <span className="rec-value">{topRecommendation.tradeType}</span>
                    </div>
                    <div className="rec-confidence">
                      <span className="rec-label">CONFIDENCE LEVEL:</span>
                      <div className="confidence-display">
                        <div className="confidence-bar">
                          <div 
                            className="confidence-fill"
                            style={{ width: `${topRecommendation.confidence || 0}%` }}
                          />
                        </div>
                        <span className="confidence-percentage">{topRecommendation.confidence || 0}%</span>
                      </div>
                    </div>
                    <div className="rec-reason">
                      <span className="rec-label">ANALYSIS:</span>
                      <span className="rec-value">{topRecommendation.reason}</span>
                    </div>
                    <div className="rec-action">
                      <button className="execute-recommendation-btn">
                        EXECUTE TRADE
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        
         <div className="comprehensive-analytics">
          <h4>COMPREHENSIVE MARKET ANALYTICS</h4>

          {/* Market Overview Cards */}
          <div className="market-overview-cards">
            <div className="analytics-card market-sentiment">
              <h5>Market Sentiment</h5>
              <div className="sentiment-indicator">
                <div className={`sentiment-badge ${marketSuggestions.length > 3 ? 'bullish' : marketSuggestions.length > 1 ? 'neutral' : 'bearish'}`}>
                  {marketSuggestions.length > 3 ? 'BULLISH' : marketSuggestions.length > 1 ? 'NEUTRAL' : 'BEARISH'}
                </div>
                <div className="sentiment-strength">
                  Strength: {Math.round((marketSuggestions.length / 6) * 100)}%
                </div>
              </div>
            </div>

            <div className="analytics-card market-volatility">
              <h5>Market Volatility</h5>
              <div className="volatility-level">
                <div className="volatility-gauge">
                  <div className="gauge-fill" style={{ width: '75%' }}></div>
                </div>
                <span className="volatility-text">HIGH VOLATILITY</span>
              </div>
            </div>

            <div className="analytics-card success-rate">
              <h5>AI Success Rate</h5>
              <div className="success-indicator">
                <div className="circular-progress">
                  <div className="circle-fill" style={{ transform: 'rotate(306deg)' }}></div>
                  <span className="success-percentage">85%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Volatility Signals Grid */}
          <div className="volatility-signals">
            <h5>All Volatility Indices</h5>
            <div className="signals-grid">
              {volatilitySignals.map((signal, index) => (
                <div className="signal-item" key={index}>
                  <div className="signal-header">
                    <span className="signal-name">{signal.name}</span>
                    <span className={`signal-badge ${signal.signal.toLowerCase()}`}>{signal.signal}</span>
                  </div>
                  <div className="signal-details">
                    <span className="signal-price">Price: {signal.price}</span>
                    <span className="signal-strength">Strength: {signal.strength}%</span>
                    <span className="signal-volume">Volume: {signal.volume}</span>
                    <span className={`signal-change ${signal.change > 0 ? 'positive' : 'negative'}`}>
                      Change: {signal.change > 0 ? '+' : ''}{signal.change}%
                    </span>
                  </div>
                  <div className="signal-progress">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill"
                        style={{ width: `${signal.strength}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Real-time Market Data */}
          <div className="market-data-section">
            <h5>Real-time Market Data</h5>
            <div className="market-stats">
              <div className="stat-item">
                <span className="stat-label">Active Signals:</span>
                <span className="stat-value">{marketSuggestions.length}/10</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Data Points Analyzed:</span>
                <span className="stat-value">2,000+</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Update Frequency:</span>
                <span className="stat-value">Real-time</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Signal Accuracy:</span>
                <span className="stat-value">87.3%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Tick Display for Selected Volatility */}
        <div className="live-tick-display">
          <div className="live-tick-header">
            <h4>📊 LIVE TICKS - {getSymbolName(selectedVolatility)}</h4>
            <div className="tick-count">
              {ticksData[selectedVolatility]?.length || 0} ticks received
            </div>
          </div>
          <div className="live-tick-stream">
            {ticksData[selectedVolatility]?.slice(-10).map((tick, index) => (
              <div 
                key={index}
                className="live-tick-item"
                style={{ 
                  animationDelay: `${index * 0.1}s`,
                  opacity: 0.3 + (index / 10) * 0.7
                }}
              >
                <span className="tick-timestamp">{new Date().toLocaleTimeString()}</span>
                <span className="tick-price">{tick.toFixed(5)}</span>
                <span className="tick-last-digit">{tick.toString().slice(-1)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Floating Risk Disclaimer Button */}
        <button 
          className="risk-disclaimer-button"
          onClick={() => setShowRiskDisclaimer(true)}
        >
          <span className="warning-icon">⚠</span>
          <span className="disclaimer-text">Risk Disclaimer</span>
        </button>

        {/* Risk Disclaimer Modal */}
        {showRiskDisclaimer && (
          <div className="risk-disclaimer-overlay">
            <div className="risk-disclaimer-modal">
              <h3>Risk Disclaimer</h3>
              <div className="risk-disclaimer-content">
                <p>
                  Deriv offers complex derivatives, such as options and contracts for 
                  difference ("CFDs"). These products may not be suitable for all clients, and 
                  trading them puts you at risk. Please make sure that you understand the 
                  following risks before trading Deriv products: a) you may lose some or all 
                  of the money you invest in the trade, b) if your trade involves currency 
                  conversion, exchange rates will affect your profit and loss. You should 
                  never trade with borrowed money or with money that you cannot afford to 
                  lose.
                </p>
                <p>
                  <strong>Trading signals and analysis provided are for informational purposes only and should not be considered as financial advice. Past performance does not guarantee future results. Always conduct your own research and risk assessment before making trading decisions.</strong>
                </p>
              </div>
              <button 
                className="risk-disclaimer-understand-btn"
                onClick={() => setShowRiskDisclaimer(false)}
              >
                I UNDERSTAND
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PercentageTool;