import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import './volatility-analyzer.scss';

interface AnalysisData {
  data?: {
    recommendation?: string;
    confidence?: string;
    riseRatio?: string;
    fallRatio?: string;
    evenProbability?: string;
    oddProbability?: string;
    overProbability?: string;
    underProbability?: string;
    barrier?: number;
    actualDigits?: number[];
    evenOddPattern?: string[];
    overUnderPattern?: string[];
    streak?: number;
    streakType?: string;
    digitFrequencies?: any[];
    digitPercentages?: string[];
    target?: number;
    mostFrequentProbability?: string;
    currentLastDigit?: number;
    totalTicks?: number;
  };
}

// Mock run_panel and contract_stages for demonstration purposes
// In a real application, these would be imported from your UI library or state management
const run_panel = {
  setIsRunning: (isRunning: boolean) => console.log(`Run panel running state: ${isRunning}`),
  setContractStage: (stage: string) => console.log(`Run panel stage: ${stage}`),
};

const contract_stages = {
  NOT_RUNNING: 'NOT_RUNNING',
  STARTING: 'STARTING',
  PURCHASE_SENT: 'PURCHASE_SENT',
  CONTRACT_CLOSED: 'CONTRACT_CLOSED',
};

const VolatilityAnalyzer: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');
  const [tickCount, setTickCount] = useState(120);
  const [barrier, setBarrier] = useState(5);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [currentPrice, setCurrentPrice] = useState('---');

  // Analysis data for each strategy
  const [analysisData, setAnalysisData] = useState<{[key: string]: AnalysisData}>({
    'rise-fall': {},
    'even-odd': {},
    'even-odd-2': {},
    'over-under': {},
    'over-under-2': {},
    'matches-differs': {}
  });

  useEffect(() => {
    // Initialize WebSocket with correct app ID
    let derivWs: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let tickHistory: Array<{time: number, quote: number}> = [];
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let decimalPlaces = 2;

    function startWebSocket() {
      console.log('🔌 Connecting to WebSocket API');

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      if (derivWs) {
        try {
          derivWs.onclose = null;
          derivWs.close();
          console.log('Closed existing connection');
        } catch (error) {
          console.error('Error closing existing connection:', error);
        }
        derivWs = null;
      }

      try {
        derivWs = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

        derivWs.onopen = function() {
          console.log('✅ WebSocket connection established');
          reconnectAttempts = 0;
          setConnectionStatus('connected');

          setTimeout(() => {
            try {
              if (derivWs && derivWs.readyState === WebSocket.OPEN) {
                console.log('Sending authorization request');
                derivWs.send(JSON.stringify({ app_id: 75771 }));
                requestTickHistory();
              }
            } catch (error) {
              console.error('Error during init requests:', error);
              // Don't set error status here, keep trying
            }
          }, 500);
        };

        derivWs.onmessage = function(event) {
          try {
            const data = JSON.parse(event.data);

            if (data.error) {
              console.error('❌ WebSocket API error:', data.error);
              // Don't set error status for API errors, keep connection status as connected
              // Only set error if it's a critical connection issue
              if (data.error.code === 'DisconnectByUser' || data.error.code === 'InvalidToken') {
                setConnectionStatus('error');
              }
              return;
            }

            // Ensure we're showing connected status when receiving data
            if (connectionStatus !== 'connected') {
              setConnectionStatus('connected');
            }

            if (data.history) {
              console.log(`📊 Received history for ${selectedSymbol}: ${data.history.prices.length} ticks`);
              tickHistory = data.history.prices.map((price: string, index: number) => ({
                time: data.history.times[index],
                quote: parseFloat(price)
              }));
              detectDecimalPlaces();
              updateUI();
            } else if (data.tick) {
              const quote = parseFloat(data.tick.quote);
              tickHistory.push({
                time: data.tick.epoch,
                quote: quote
              });

              if (tickHistory.length > tickCount) {
                tickHistory.shift();
              }
              updateUI();
            } else if (data.ping) {
              derivWs?.send(JSON.stringify({ pong: 1 }));
            }
          } catch (error) {
            console.error('Error processing message:', error);
          }
        };

        derivWs.onerror = function(error) {
          console.error('❌ WebSocket error:', error);
          // Only set error status if we can't recover quickly
          if (reconnectAttempts >= 2) {
            setConnectionStatus('error');
          }
          scheduleReconnect();
        };

        derivWs.onclose = function(event) {
          console.log('🔄 WebSocket connection closed', event.code, event.reason);
          setConnectionStatus('disconnected');
          scheduleReconnect();
        };

      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        setConnectionStatus('error');
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      reconnectAttempts++;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.log(`⚠️ Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping attempts.`);
        setConnectionStatus('error');
        return;
      }

      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
      console.log(`🔄 Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`);

      // Set status to disconnected during reconnection, not error
      if (reconnectAttempts <= 3) {
        setConnectionStatus('disconnected');
      }

      reconnectTimeout = setTimeout(() => {
        console.log(`🔄 Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        startWebSocket();
      }, delay);
    }

    function requestTickHistory() {
      const request = {
        ticks_history: selectedSymbol,
        count: tickCount,
        end: 'latest',
        style: 'ticks',
        subscribe: 1
      };

      if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        console.log(`📡 Requesting tick history for ${selectedSymbol} (${tickCount} ticks)`);
        try {
          derivWs.send(JSON.stringify(request));
        } catch (error) {
          console.error('Error sending tick history request:', error);
          scheduleReconnect();
        }
      } else {
        console.error('❌ WebSocket not ready to request history, readyState:', derivWs ? derivWs.readyState : 'undefined');
        scheduleReconnect();
      }
    }

    function detectDecimalPlaces() {
      if (tickHistory.length === 0) return;
      decimalPlaces = Math.max(
        ...tickHistory.map(tick => (tick.quote.toString().split('.')[1] || '').length),
        2
      );
    }

    function getLastDigit(quote: number): number {
      let decimalPart = quote.toString().split('.')[1] || '';
      while (decimalPart.length < decimalPlaces) {
        decimalPart += '0';
      }
      return Number(decimalPart.slice(-1));
    }

    function updateUI() {
      if (tickHistory.length === 0) {
        console.warn('⚠️ No tick history available for analysis');
        return;
      }

      const currentPrice = tickHistory[tickHistory.length - 1].quote.toFixed(decimalPlaces);
      setCurrentPrice(currentPrice);
      sendAnalysisData();
    }

    function sendAnalysisData() {
      if (!tickHistory || tickHistory.length === 0) {
        console.warn('⚠️ No data available for analysis');
        return;
      }

      try {
        // Count digit frequencies
        const digitCounts = Array(10).fill(0);
        tickHistory.forEach(tick => {
          const lastDigit = getLastDigit(tick.quote);
          digitCounts[lastDigit]++;
        });

        const totalTicks = tickHistory.length;
        const digitPercentages = digitCounts.map(count => ((count / totalTicks) * 100).toFixed(2));

        // Even/Odd analysis
        const evenCount = digitCounts.filter((count, index) => index % 2 === 0).reduce((a, b) => a + b, 0);
        const oddCount = digitCounts.filter((count, index) => index % 2 !== 0).reduce((a, b) => a + b, 0);
        const evenProbability = ((evenCount / totalTicks) * 100).toFixed(2);
        const oddProbability = ((oddCount / totalTicks) * 100).toFixed(2);

        // Over/Under analysis
        let overCount = 0;
        let underCount = 0;
        for (let i = 0; i < 10; i++) {
          if (i >= barrier) {
            overCount += digitCounts[i];
          } else {
            underCount += digitCounts[i];
          }
        }
        const overProbability = ((overCount / totalTicks) * 100).toFixed(2);
        const underProbability = ((underCount / totalTicks) * 100).toFixed(2);

        // Last 10 digits pattern
        const lastDigits = tickHistory.slice(-10).map(tick => getLastDigit(tick.quote));
        const evenOddPattern = lastDigits.map(digit => digit % 2 === 0 ? 'E' : 'O');
        const overUnderPattern = lastDigits.map(digit => digit >= barrier ? 'O' : 'U');

        // Current streak calculation
        let currentStreak = 1;
        let streakType = lastDigits.length > 0 && lastDigits[lastDigits.length - 1] % 2 === 0 ? 'even' : 'odd';

        for (let i = lastDigits.length - 2; i >= 0; i--) {
          const isEven = lastDigits[i] % 2 === 0;
          const prevIsEven = lastDigits[i + 1] % 2 === 0;
          if (isEven === prevIsEven) {
            currentStreak++;
          } else {
            break;
          }
        }

        // Rise/Fall analysis
        let riseCount = 0;
        let fallCount = 0;
        for (let i = 1; i < tickHistory.length; i++) {
          if (tickHistory[i].quote > tickHistory[i - 1].quote) {
            riseCount++;
          } else if (tickHistory[i].quote < tickHistory[i - 1].quote) {
            fallCount++;
          }
        }
        const riseRatio = ((riseCount / (totalTicks - 1)) * 100).toFixed(2);
        const fallRatio = ((fallCount / (totalTicks - 1)) * 100).toFixed(2);

        // Matches/Differs analysis
        let maxCount = 0;
        let mostFrequentDigit = 0;
        digitCounts.forEach((count, index) => {
          if (count > maxCount) {
            maxCount = count;
            mostFrequentDigit = index;
          }
        });
        const mostFrequentProbability = ((maxCount / totalTicks) * 100).toFixed(2);
        const digitFrequencies = digitCounts.map((count, index) => ({
          digit: index,
          percentage: ((count / totalTicks) * 100).toFixed(2),
          count: count
        }));
        const currentLastDigit = tickHistory.length > 0 ? getLastDigit(tickHistory[tickHistory.length - 1].quote) : undefined;

        // Update analysis data
        setAnalysisData({
          'rise-fall': {
            data: {
              recommendation: parseFloat(riseRatio) > 55 ? 'Rise' : parseFloat(fallRatio) > 55 ? 'Fall' : undefined,
              confidence: Math.max(parseFloat(riseRatio), parseFloat(fallRatio)).toFixed(2),
              riseRatio,
              fallRatio
            }
          },
          'even-odd': {
            data: {
              recommendation: parseFloat(evenProbability) > 55 ? 'Even' : parseFloat(oddProbability) > 55 ? 'Odd' : undefined,
              confidence: Math.max(parseFloat(evenProbability), parseFloat(oddProbability)).toFixed(2),
              evenProbability,
              oddProbability
            }
          },
          'even-odd-2': {
            data: {
              evenProbability,
              oddProbability,
              actualDigits: lastDigits,
              evenOddPattern,
              streak: currentStreak,
              streakType
            }
          },
          'over-under': {
            data: {
              recommendation: parseFloat(overProbability) > 55 ? 'Over' : parseFloat(underProbability) > 55 ? 'Under' : undefined,
              confidence: Math.max(parseFloat(overProbability), parseFloat(underProbability)).toFixed(2),
              overProbability,
              underProbability,
              barrier
            }
          },
          'over-under-2': {
            data: {
              overProbability,
              underProbability,
              actualDigits: lastDigits,
              overUnderPattern,
              barrier,
              digitPercentages,
              digitFrequencies
            }
          },
          'matches-differs': {
            data: {
              recommendation: parseFloat(mostFrequentProbability) > 15 ? 'Matches' : 'Differs',
              confidence: (parseFloat(mostFrequentProbability) > 15 ? parseFloat(mostFrequentProbability) : 100 - parseFloat(mostFrequentProbability)).toFixed(2),
              target: mostFrequentDigit,
              mostFrequentProbability,
              digitFrequencies,
              currentLastDigit,
              totalTicks
            }
          }
        });

      } catch (error) {
        console.error('❌ Error in analysis:', error);
      }
    }

    // Start the connection
    startWebSocket();

    // Cleanup function
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (derivWs) {
        derivWs.onclose = null;
        derivWs.close();
      }

      // Clear all trading intervals
      Object.values(tradingIntervals).forEach(interval => {
        if (interval) {
          clearInterval(interval);
        }
      });

      // Reset trading intervals
      setTradingIntervals({
        'rise-fall': null,
        'even-odd': null,
        'even-odd-2': null,
        'over-under': null,
        'over-under-2': null,
        'matches-differs': null,
      });

      // Reset auto trading status
      setAutoTradingStatus({
        'rise-fall': false,
        'even-odd': false,
        'even-odd-2': false,
        'over-under': false,
        'over-under-2': false,
        'matches-differs': false,
      });
    };
  }, [selectedSymbol, tickCount, barrier]);

  const updateSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    // This will trigger useEffect to restart connection with new symbol
  }, []);

  const updateTickCount = useCallback((count: number) => {
    setTickCount(count);
    // This will trigger useEffect to restart connection with new count
  }, []);

  const updateBarrier = useCallback((newBarrier: number) => {
    setBarrier(newBarrier);
    // This will trigger recalculation in useEffect
  }, []);

  const volatilitySymbols = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
  ];

  const [isConnected, setIsConnected] = useState(false);
  // Auto trading status for each strategy
  const [autoTradingStatus, setAutoTradingStatus] = useState<{[key: string]: boolean}>({
    'rise-fall': false,
    'even-odd': false,
    'even-odd-2': false,
    'over-under': false,
    'over-under-2': false,
    'matches-differs': false
  });

  // Trading state management
  const [activeTrades, setActiveTrades] = useState<Array<{
    id: string;
    strategy: string;
    symbol: string;
    tradeType: string;
    stake: number;
    timestamp: number;
    status: 'pending' | 'won' | 'lost';
    prediction?: any;
  }>>([]);

  // Auto trading intervals for each strategy
  const [tradingIntervals, setTradingIntervals] = useState<Record<string, NodeJS.Timeout | null>>({
    'rise-fall': null,
    'even-odd': null,
    'even-odd-2': null,
    'over-under': null,
    'over-under-2': null,
    'matches-differs': null,
  });

  // Trading state
  const [stakeAmount, setStakeAmount] = useState(0.5);
  const [ticksAmount, setTicksAmount] = useState(1);
  const [martingaleAmount, setMartingaleAmount] = useState(1);
  const [tradingConditions, setTradingConditions] = useState<Record<string, any>>({
    'rise-fall': { condition: 'Rise Prob', operator: '>', value: 55 },
    'even-odd': { condition: 'Even Prob', operator: '>', value: 55 },
    'even-odd-2': { condition: 'Even Prob', operator: '>', value: 55 },
    'over-under': { condition: 'Over Prob', operator: '>', value: 55 },
    'over-under-2': { condition: 'Over Prob', operator: '>', value: 55 },
    'matches-differs': { condition: 'Matches Prob', operator: '>', value: 55 },
  });

  // Enhanced trading logic with Smart Trader patterns
  const [lastOutcomeWasLoss, setLastOutcomeWasLoss] = useState<Record<string, boolean>>({});
  const [lossStreaks, setLossStreaks] = useState<Record<string, number>>({});
  const [baseStakes, setBaseStakes] = useState<Record<string, number>>({});

  // Safe version of tradeOptionToBuy without Blockly dependencies
  const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy = {
      buy: '1',
      price: trade_option.amount,
      parameters: {
        amount: trade_option.amount,
        basis: trade_option.basis,
        contract_type,
        currency: trade_option.currency,
        duration: trade_option.duration,
        duration_unit: trade_option.duration_unit,
        symbol: trade_option.symbol,
      },
    };
    if (trade_option.prediction !== undefined) {
      buy.parameters.selected_tick = trade_option.prediction;
    }
    if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
      buy.parameters.barrier = trade_option.prediction;
    }
    return buy;
  };

  // Add API instance for proper trading
  const [tradingApi, setTradingApi] = useState<any>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Initialize trading API
  useEffect(() => {
    const initTradingApi = async () => {
      try {
        const { generateDerivApiInstance, V2GetActiveToken } = await import('@/external/bot-skeleton/services/api/appId');
        const api = generateDerivApiInstance();
        setTradingApi(api);

        // Try to authorize if token is available
        const token = V2GetActiveToken();
        if (token) {
          try {
            const { authorize, error } = await api.authorize(token);
            if (!error && authorize) {
              setIsAuthorized(true);
              console.log('✅ Trading API authorized successfully');
            }
          } catch (authError) {
            console.log('Trading API not authorized yet, will authorize on first trade');
          }
        }
      } catch (error) {
        console.error('Failed to initialize trading API:', error);
      }
    };

    initTradingApi();
  }, []);

  const authorizeIfNeeded = async () => {
    if (isAuthorized || !tradingApi) return;

    const { V2GetActiveToken } = await import('@/external/bot-skeleton/services/api/appId');
    const token = V2GetActiveToken();
    if (!token) {
      throw new Error('No token found. Please log in and select an account.');
    }

    const { authorize, error } = await tradingApi.authorize(token);
    if (error) {
      throw new Error(`Authorization error: ${error.message || error.code}`);
    }

    setIsAuthorized(true);
    console.log('✅ Trading API authorized successfully');
  };

  const executeTrade = async (strategyId: string, type: 'auto' | 'manual') => {
    const tradeId = `${strategyId}_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      strategy: strategyId,
      symbol: selectedSymbol,
      tradeType: getTradeTypeForStrategy(strategyId),
      stake: 1, // Default stake, can be made configurable
      timestamp: Date.now(),
      status: 'pending' as const,
      prediction: getAnalysisForStrategy(strategyId)
    };

    setActiveTrades(prev => [...prev, newTrade]);

    if (type === 'manual') {
      run_panel.setIsRunning(true);
      run_panel.setContractStage(contract_stages.PURCHASE_SENT);
    }

    console.log(`Executing ${type} trade for ${strategyId}:`, newTrade);

    // Simulate trade completion after 30 seconds
    setTimeout(() => {
      setActiveTrades(prev => 
        prev.map(trade => 
          trade.id === tradeId 
            ? { ...trade, status: Math.random() > 0.5 ? 'won' : 'lost' }
            : trade
        )
      );

      if (type === 'manual') {
        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
        setTimeout(() => {
          run_panel.setIsRunning(false);
          run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }, 1000);
      }
    }, 30000);
  };

  const getTradeTypeForStrategy = (strategyId: string): string => {
    switch (strategyId) {
      case 'rise-fall': return 'CALL/PUT';
      case 'even-odd': return 'DIGITEVEN/DIGITODD';
      case 'even-odd-2': return 'DIGITEVEN/DIGITODD';
      case 'over-under': return 'DIGITOVER/DIGITUNDER';
      case 'over-under-2': return 'DIGITOVER/DIGITUNDER';
      case 'matches-differs': return 'DIGITMATCH/DIGITDIFF';
      default: return 'UNKNOWN';
    }
  };

  const getAnalysisForStrategy = (strategyId: string) => {
    // Return relevant analysis data for the strategy
    return analysisData[strategyId] || {};
  };

  const startAutoTrading = (strategyId: string) => {
    setAutoTradingStatus(prev => ({ ...prev, [strategyId]: true }));
    run_panel.setIsRunning(true);
    run_panel.setContractStage(contract_stages.STARTING);
    console.log(`Starting auto trading for ${strategyId}`);
  };

  const stopAutoTrading = (strategyId: string) => {
    setAutoTradingStatus(prev => ({ ...prev, [strategyId]: false }));

    // Check if any strategy is still running
    const hasRunningStrategy = Object.entries(autoTradingStatus)
      .filter(([key]) => key !== strategyId)
      .some(([, isRunning]) => isRunning);

    if (!hasRunningStrategy) {
      run_panel.setIsRunning(false);
      run_panel.setContractStage(contract_stages.NOT_RUNNING);
    }

    console.log(`Stopping auto trading for ${strategyId}`);
  };

  const checkTradingConditions = (strategyId: string, data: any, condition: any) => {
    let currentValue = 0;

    // More detailed logging for debugging
    const timestamp = new Date().toLocaleTimeString();

    switch (condition.condition) {
      case 'Rise Prob':
        currentValue = parseFloat(data.riseRatio || '0');
        break;
      case 'Fall Prob':
        currentValue = parseFloat(data.fallRatio || '0');
        break;
      case 'Even Prob':
        currentValue = parseFloat(data.evenProbability || '0');
        break;
      case 'Odd Prob':
        currentValue = parseFloat(data.oddProbability || '0');
        break;
      case 'Over Prob':
        currentValue = parseFloat(data.overProbability || '0');
        break;
      case 'Under Prob':
        currentValue = parseFloat(data.underProbability || '0');
        break;
      case 'Matches Prob':
        currentValue = parseFloat(data.mostFrequentProbability || '0');
        break;
      case 'Differs Prob':
        currentValue = 100 - parseFloat(data.mostFrequentProbability || '0');
        break;
      default:
        console.warn(`[${timestamp}] Unknown condition type for ${strategyId}:`, condition.condition);
        return false;
    }

    // Validate that we have meaningful data - but be less strict about zero values for some conditions
    if (isNaN(currentValue)) {
      console.warn(`[${timestamp}] Invalid value for ${strategyId} ${condition.condition}:`, currentValue);
      return false;
    }

    // Allow zero values but log them
    if (currentValue === 0) {
      console.log(`[${timestamp}] Zero value for ${strategyId} ${condition.condition} - this might be normal for some conditions`);
    }

    const result = (() => {
      switch (condition.operator) {
        case '>':
          return currentValue > condition.value;
        case '<':
          return currentValue < condition.value;
        case '=':
          return Math.abs(currentValue - condition.value) < 0.1;
        default:
          console.warn(`[${timestamp}] Unknown operator for ${strategyId}:`, condition.operator);
          return false;
      }
    })();

    // Enhanced logging with color coding
    const logStyle = result ? '🟢' : '🔴';
    console.log(`[${timestamp}] ${logStyle} Condition check for ${strategyId}:`, {
      condition: condition.condition,
      currentValue: currentValue.toFixed(2),
      operator: condition.operator,
      threshold: condition.value,
      result: result ? 'MET ✅' : 'NOT MET ❌',
      formula: `${currentValue.toFixed(2)} ${condition.operator} ${condition.value}`
    });

    return result;
  };

  const renderProgressBar = (label: string, percentage: number, color: string) => {
    const validPercentage = isNaN(percentage) ? 0 : Math.min(Math.max(percentage, 0), 100);
    return (
      <div className="progress-item">
        <div className="progress-label">
          <span>{label}</span>
          <span className="progress-percentage">{validPercentage.toFixed(1)}%</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${validPercentage}%`, backgroundColor: color }}
          />
        </div>
      </div>
    );
  };

  const renderDigitPattern = (digits: number[], type: string = 'even-odd', barrier?: number) => {
    if (!digits || !Array.isArray(digits) || digits.length === 0) return null;

    const getPatternClass = (digit: number) => {
      if (type === 'even-odd') {
        return digit % 2 === 0 ? 'even' : 'odd';
      } else if (type === 'over-under' && barrier !== undefined) {
        return digit >= barrier ? 'over' : 'under';
      }
      return 'neutral';
    };

    const getPatternText = (digit: number) => {
      if (type === 'even-odd') {
        return digit % 2 === 0 ? 'E' : 'O';
      } else if (type === 'over-under' && barrier !== undefined) {
        return digit >= barrier ? 'O' : 'U';
      }
      return digit.toString();
    };

    const displayDigits = digits.slice(-10);
    const patternDigits = digits.slice(-5);

    return (
      <div className="digit-pattern">
        <div className="pattern-label">Last {displayDigits.length} Digits Pattern:</div>
        <div className="pattern-grid">
          {displayDigits.map((digit, index) => (
            <div key={index} className={`digit-item ${getPatternClass(digit)}`}>
              {digit}
            </div>
          ))}
        </div>
        <div className="pattern-info">
          Recent pattern: {patternDigits.map(digit => getPatternText(digit)).join('')}
        </div>
      </div>
    );
  };

  const renderDigitFrequencies = (frequencies: any[]) => {
    if (!frequencies || !Array.isArray(frequencies)) return null;

    return (
      <div className="digit-frequencies">
        <div className="frequency-label">Digit Frequency Distribution</div>
        <div className="frequency-grid">
          {frequencies.map((freq, index) => {
            const percentage = parseFloat(freq.percentage) || 0;
            return (
              <div key={index} className="frequency-item">
                <div className="frequency-digit">{freq.digit}</div>
                <div className="frequency-bar">
                  <div 
                    className="frequency-fill" 
                    style={{ height: `${Math.min(percentage * 2.5, 100)}%` }}
                  />
                </div>
                <div className="frequency-percent">{percentage.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTradingCard = (title: string, strategyId: string) => {
    const data = analysisData[strategyId];
    const condition = tradingConditions[strategyId];

    const getConditionOptions = (strategyId: string) => {
      switch (strategyId) {
        case 'rise-fall':
          return [
            { value: 'Rise Prob', label: 'Rise Prob' },
            { value: 'Fall Prob', label: 'Fall Prob' }
          ];
        case 'even-odd':
        case 'even-odd-2':
          return [
            { value: 'Even Prob', label: 'Even Prob' },
            { value: 'Odd Prob', label: 'Odd Prob' }
          ];
        case 'over-under':
        case 'over-under-2':
          return [
            { value: 'Over Prob', label: 'Over Prob' },
            { value: 'Under Prob', label: 'Under Prob' }
          ];
        case 'matches-differs':
          return [
            { value: 'Matches Prob', label: 'Matches Prob' },
            { value: 'Differs Prob', label: 'Differs Prob' }
          ];
        default:
          return [{ value: 'Even Prob', label: 'Even Prob' }];
      }
    };

    const getTradeOptions = (strategyId: string) => {
      switch (strategyId) {
        case 'rise-fall':
          return [
            { value: 'Buy Rise', label: 'Buy Rise' },
            { value: 'Buy Fall', label: 'Buy Fall' }
          ];
        case 'even-odd':
        case 'even-odd-2':
          return [
            { value: 'Buy Even', label: 'Buy Even' },
            { value: 'Buy Odd', label: 'Buy Odd' }
          ];
        case 'over-under':
        case 'over-under-2':
          return [
            { value: 'Buy Over', label: 'Buy Over' },
            { value: 'Buy Under', label: 'Buy Under' }
          ];
        case 'matches-differs':
          return [
            { value: 'Buy Matches', label: 'Buy Matches' },
            { value: 'Buy Differs', label: 'Buy Differs' }
          ];
        default:
          return [{ value: 'Buy Even', label: 'Buy Even' }];
      }
    };

    const conditionOptions = getConditionOptions(strategyId);
    const tradeOptions = getTradeOptions(strategyId);

    return (
      <div className="trading-card" key={strategyId} data-strategy={strategyId}>
        <div className="card-header">
          <h3>{title}</h3>
        </div>

        <div className="card-content">
          {/* Rise/Fall Card */}
          {strategyId === 'rise-fall' && data?.data && (
            <>
              {renderProgressBar('Rise', parseFloat(data.data.riseRatio || '0'), '#4CAF50')}
              {renderProgressBar('Fall', parseFloat(data.data.fallRatio || '0'), '#F44336')}
            </>
          )}

          {/* Even/Odd Card */}
          {strategyId === 'even-odd' && data?.data && (
            <>
              {renderProgressBar('Even', parseFloat(data.data.evenProbability || '0'), '#4CAF50')}
              {renderProgressBar('Odd', parseFloat(data.data.oddProbability || '0'), '#F44336')}
            </>
          )}

          {/* Even/Odd 2 Card with Pattern */}
          {strategyId === 'even-odd-2' && data?.data && (
            <>
              {renderProgressBar('Even', parseFloat(data.data.evenProbability || '0'), '#4CAF50')}
              {renderProgressBar('Odd', parseFloat(data.data.oddProbability || '0'), '#F44336')}
              {data.data.actualDigits && renderDigitPattern(data.data.actualDigits, 'even-odd')}
              {data.data.streak && (
                <div className="streak-info">
                  Current streak: {data.data.streak} {data.data.streakType}
                </div>
              )}
            </>
          )}

          {/* Over/Under Card */}
          {strategyId === 'over-under' && data?.data && (
            <>
              <div className="barrier-info">Barrier: {data.data.barrier}</div>
              {renderProgressBar('Over', parseFloat(data.data.overProbability || '0'), '#2196F3')}
              {renderProgressBar('Under', parseFloat(data.data.underProbability || '0'), '#FF9800')}
            </>
          )}

          {/* Over/Under 2 Card with Pattern */}
          {strategyId === 'over-under-2' && data?.data && (
            <>
              <div className="barrier-info">Barrier: {data.data.barrier}</div>
              {renderProgressBar('Over', parseFloat(data.data.overProbability || '0'), '#2196F3')}
              {renderProgressBar('Under', parseFloat(data.data.underProbability || '0'), '#FF9800')}
              {data.data.actualDigits && renderDigitPattern(data.data.actualDigits, 'over-under', data.data.barrier)}
              {data.data.digitFrequencies && renderDigitFrequencies(data.data.digitFrequencies)}
            </>
          )}

          {/* Matches/Differs Card */}
          {strategyId === 'matches-differs' && data?.data && (
            <>
              <div className="most-frequent">Most frequent: {data.data.target} ({data.data.mostFrequentProbability}%)</div>
              {renderProgressBar('Matches', parseFloat(data.data.mostFrequentProbability || '0'), '#4CAF50')}
              {renderProgressBar('Differs', (100 - parseFloat(data.data.mostFrequentProbability || '0')), '#F44336')}
              <div className="barrier-note">Barrier digit {data.data.target} appears {data.data.mostFrequentProbability}% of the time</div>
              {data.data.digitFrequencies && renderDigitFrequencies(data.data.digitFrequencies)}
            </>
          )}

          {/* Trading Condition */}
          <div className="trading-condition">
            <div className="condition-header">Trading Condition</div>
            <div className="condition-row">
              <span>If</span>
              <select 
                value={condition.condition}
                onChange={(e) => setTradingConditions(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], condition: e.target.value }
                }))}
              >
                {conditionOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select 
                value={condition.operator}
                onChange={(e) => setTradingConditions(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], operator: e.target.value }
                }))}
              >
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value="=">=</option>
              </select>
              <input 
                type="number" 
                value={condition.value}
                onChange={(e) => setTradingConditions(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], value: parseFloat(e.target.value) }
                }))}
              />
              <span>%</span>
            </div>
            <div className="condition-row">
              <span>Then</span>
              <select defaultValue={tradeOptions[0].value}>
                {tradeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Enhanced Trading Controls with Smart Trader Logic */}
          <div className="trading-controls">
            <div className="control-group">
              <label>Base Stake</label>
              <input 
                type="number" 
                value={stakeAmount}
                onChange={(e) => {
                  const newStake = parseFloat(e.target.value);
                  setStakeAmount(newStake);
                  // Update base stake for this strategy
                  setBaseStakes(prev => ({ ...prev, [strategyId]: newStake }));
                }}
                step="0.01"
                min="0.35"
              />
            </div>
            <div className="control-group">
              <label>Ticks</label>
              <input 
                type="number" 
                value={ticksAmount}
                onChange={(e) => setTicksAmount(parseInt(e.target.value))}
                min="1"
                max="10"
              />
            </div>
            <div className="control-group">
              <label>Martingale</label>
              <input 
                type="number" 
                value={martingaleAmount}
                onChange={(e) => setMartingaleAmount(parseFloat(e.target.value))}
                step="0.1"
                min="1"
                max="5"
              />
            </div>
          </div>

          {/* Strategy Status Display */}
          <div className="strategy-status">
            <div className="status-item">
              <span>Loss Streak: {lossStreaks[strategyId] || 0}</span>
            </div>
            <div className="status-item">
              <span>Current Stake: {
                (lossStreaks[strategyId] || 0) > 0 ? 
                Number(((baseStakes[strategyId] || stakeAmount) * Math.pow(martingaleAmount, lossStreaks[strategyId] || 0)).toFixed(2)) :
                (baseStakes[strategyId] || stakeAmount)
              }</span>
            </div>
            <div className="status-item">
              <span>Last Outcome: {lastOutcomeWasLoss[strategyId] ? '❌ Loss' : '✅ Win/None'}</span>
            </div>
          </div>
        </div>

        <div className="card-footer">
          <button 
            className={`start-trading-btn ${autoTradingStatus[strategyId] ? 'trading-active' : ''}`}
            onClick={() => {
              if (autoTradingStatus[strategyId]) {
                stopAutoTrading(strategyId);
              } else {
                startAutoTrading(strategyId);
              }
            }}
            disabled={connectionStatus !== 'connected'}
          >
            {autoTradingStatus[strategyId] ? 'Stop Auto Trading' : 'Start Auto Trading'}
          </button>
          <button 
            className="manual-trade-btn"
            onClick={() => executeTrade(strategyId, 'manual')}
            disabled={connectionStatus !== 'connected' || autoTradingStatus[strategyId]}
          >
            Execute Manual Trade
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="volatility-analyzer">
      <div className="analyzer-header">
        <h2>Smart Trading Analytics</h2>
        <div className={`connection-status ${connectionStatus}`}>
          {connectionStatus === 'connected' && '🟢 Connected'}
          {connectionStatus === 'disconnected' && '🔴 Disconnected'}
          {connectionStatus === 'error' && '⚠️ Error'}
        </div>
      </div>

      <div className="analyzer-controls">
        <div className="control-group">
          <label>Symbol:</label>
          <select
            value={selectedSymbol}
            onChange={(e) => updateSymbol(e.target.value)}
          >
            {volatilitySymbols.map((symbol) => (
              <option key={symbol.value} value={symbol.value}>
                {symbol.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Tick Count:</label>
          <input
            type="number"
            min="10"
            max="1000"
            value={tickCount}
            onChange={(e) => updateTickCount(parseInt(e.target.value))}
          />
        </div>

        <div className="control-group">
          <label>Barrier:</label>
          <input
            type="number"
            value={barrier}
            onChange={(e) => updateBarrier(parseInt(e.target.value))}
          />
        </div>
      </div>

      {/* Run Panel Integration */}
      <div className="run-panel">
        <h3>Run Panel</h3>
        <div className="run-panel-content">
          {activeTrades.length === 0 && (
            <p>No active trades.</p>
          )}
          {activeTrades.map(trade => (
            <div key={trade.id} className={`trade-item ${trade.status}`}>
              <span>{trade.strategy}: {trade.tradeType}</span>
              <span>Stake: {trade.stake}</span>
              <span>Status: {trade.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="trading-cards-grid">
        {renderTradingCard('Rise/Fall', 'rise-fall')}
        {renderTradingCard('Even/Odd', 'even-odd')}
        {renderTradingCard('Even/Odd Pattern', 'even-odd-2')}
        {renderTradingCard('Over/Under', 'over-under')}
        {renderTradingCard('Over/Under Pattern', 'over-under-2')}
        {renderTradingCard('Matches/Differs', 'matches-differs')}
      </div>
    </div>
  );
};

export default VolatilityAnalyzer;