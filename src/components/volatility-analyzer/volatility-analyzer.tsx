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
  const [autoTradingStatus, setAutoTradingStatus] = useState<Record<string, boolean>>({
    'rise-fall': false,
    'even-odd': false,
    'even-odd-2': false,
    'over-under': false,
    'over-under-2': false,
    'matches-differs': false,
  });

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
        
        // Wait for API to be ready
        if (api.connection && api.connection.readyState === WebSocket.OPEN) {
          await authorizeApi(api);
        } else {
          // Wait for connection to open
          api.connection.addEventListener('open', () => {
            authorizeApi(api);
          });
        }
      } catch (error) {
        console.error('Failed to initialize trading API:', error);
        alert('Failed to initialize trading API. Please refresh the page and try again.');
      }
    };

    const authorizeApi = async (api: any) => {
      try {
        const { V2GetActiveToken } = await import('@/external/bot-skeleton/services/api/appId');
        const token = V2GetActiveToken();
        console.log('🔑 Attempting to authorize with token:', token ? 'Available' : 'Missing');
        
        if (token) {
          const { authorize, error } = await api.authorize(token);
          if (error) {
            console.error('❌ Authorization failed:', error);
            alert(`Authorization failed: ${error.message || error.code}. Please ensure you're logged in.`);
          } else if (authorize) {
            setIsAuthorized(true);
            console.log('✅ Trading API authorized successfully');
            console.log('Account info:', authorize);
          }
        } else {
          console.error('❌ No authentication token found');
          alert('No authentication token found. Please log in to your Deriv account.');
        }
      } catch (authError) {
        console.error('❌ Authorization error:', authError);
        alert(`Authorization error: ${authError.message}. Please log in and try again.`);
      }
    };

    initTradingApi();
  }, []);

  const authorizeIfNeeded = async () => {
    if (isAuthorized && tradingApi) {
      console.log('✅ Already authorized');
      return;
    }
    
    if (!tradingApi) {
      throw new Error('Trading API not initialized. Please refresh the page.');
    }
    
    const { V2GetActiveToken } = await import('@/external/bot-skeleton/services/api/appId');
    const token = V2GetActiveToken();
    
    console.log('🔑 Checking authorization - Token available:', !!token);
    console.log('🔗 API connection state:', tradingApi.connection?.readyState);
    
    if (!token) {
      throw new Error('No authentication token found. Please log in to your Deriv account and select a trading account.');
    }
    
    if (tradingApi.connection?.readyState !== WebSocket.OPEN) {
      throw new Error('API connection not ready. Please wait for connection to establish.');
    }
    
    try {
      const { authorize, error } = await tradingApi.authorize(token);
      if (error) {
        console.error('❌ Authorization failed:', error);
        throw new Error(`Authorization failed: ${error.message || error.code}. Please ensure you're logged in with a valid account.`);
      }
      
      if (authorize) {
        setIsAuthorized(true);
        console.log('✅ Trading API authorized successfully');
        console.log('📊 Account details:', {
          loginid: authorize.loginid,
          currency: authorize.currency,
          balance: authorize.balance
        });
      } else {
        throw new Error('Authorization response empty. Please try logging in again.');
      }
    } catch (authError) {
      console.error('❌ Authorization error:', authError);
      throw new Error(`Authorization error: ${authError.message || 'Unknown error'}. Please log in and try again.`);
    }
  };

  const executeTrade = async (strategyId: string, tradeType: string) => {
    console.log(`🚀 Starting ${tradeType} trade execution for ${strategyId}`);
    
    // Pre-flight checks
    if (connectionStatus !== 'connected') {
      const errorMsg = 'Cannot trade: Not connected to market data API';
      console.error('❌', errorMsg);
      alert(errorMsg);
      return;
    }

    if (!tradingApi) {
      const errorMsg = 'Trading API not initialized. Please refresh the page and try again.';
      console.error('❌', errorMsg);
      alert(errorMsg);
      return;
    }

    if (!isAuthorized) {
      console.log('🔑 Not authorized yet, attempting authorization...');
    }

    try {
      // Authorize if needed
      console.log('🔐 Checking authorization...');
      await authorizeIfNeeded();
      console.log('✅ Authorization check complete');

      const data = analysisData[strategyId];
      const condition = tradingConditions[strategyId];
      
      if (!data?.data) {
        console.error('No analysis data available for trading');
        alert('No analysis data available for trading');
        return;
      }

      // Initialize base stake for this strategy if not set
      if (!baseStakes[strategyId]) {
        setBaseStakes(prev => ({ ...prev, [strategyId]: stakeAmount }));
      }

      // Calculate effective stake with martingale progression
      const currentStreak = lossStreaks[strategyId] || 0;
      const baseStake = baseStakes[strategyId] || stakeAmount;
      const effectiveStake = currentStreak > 0 ? 
        Number((baseStake * Math.pow(martingaleAmount, currentStreak)).toFixed(2)) : 
        baseStake;

      // Determine contract type and prediction based on strategy and manual/auto mode
      let contractType = '';
      let prediction: number | undefined;
      
      if (tradeType === 'manual') {
        // For manual trades, use trading conditions to determine trade direction
        const conditionMet = checkTradingConditions(strategyId, data.data, condition);
        if (!conditionMet) {
          console.log(`Trading conditions not met for ${strategyId}`);
          alert(`Trading conditions not met for ${strategyId}. Check your condition settings.`);
          return;
        }
        
        console.log(`✅ Trading conditions met for ${strategyId}, proceeding with manual trade`);
        
        // Determine trade based on the condition that was met
        switch (strategyId) {
          case 'rise-fall':
            if (condition.condition === 'Rise Prob') {
              contractType = 'CALL';
            } else if (condition.condition === 'Fall Prob') {
              contractType = 'PUT';
            } else {
              // Default based on current analysis
              contractType = parseFloat(data.data.riseRatio || '0') > parseFloat(data.data.fallRatio || '0') ? 'CALL' : 'PUT';
            }
            break;
            
          case 'even-odd':
          case 'even-odd-2':
            if (condition.condition === 'Even Prob') {
              contractType = 'DIGITEVEN';
            } else if (condition.condition === 'Odd Prob') {
              contractType = 'DIGITODD';
            } else {
              // Default based on current analysis
              const evenProb = parseFloat(data.data.evenProbability || '0');
              const oddProb = parseFloat(data.data.oddProbability || '0');
              contractType = evenProb > oddProb ? 'DIGITEVEN' : 'DIGITODD';
            }
            break;
            
          case 'over-under':
          case 'over-under-2':
            const baseBarrier = data.data.barrier || 5;
            prediction = baseBarrier;
            
            if (condition.condition === 'Over Prob') {
              contractType = 'DIGITOVER';
            } else if (condition.condition === 'Under Prob') {
              contractType = 'DIGITUNDER';
            } else {
              // Default based on current analysis
              const overProb = parseFloat(data.data.overProbability || '0');
              const underProb = parseFloat(data.data.underProbability || '0');
              contractType = overProb > underProb ? 'DIGITOVER' : 'DIGITUNDER';
            }
            break;
            
          case 'matches-differs':
            prediction = data.data.target;
            
            if (condition.condition === 'Matches Prob') {
              contractType = 'DIGITMATCH';
            } else if (condition.condition === 'Differs Prob') {
              contractType = 'DIGITDIFF';
            } else {
              // Default based on current analysis
              const matchProb = parseFloat(data.data.mostFrequentProbability || '0');
              contractType = matchProb > 15 ? 'DIGITMATCH' : 'DIGITDIFF';
            }
            break;
            
          default:
            console.error('Unknown strategy type for manual trade');
            return;
        }
      } else {
        // For auto trades, use existing logic based on analysis
        switch (strategyId) {
          case 'rise-fall':
            contractType = parseFloat(data.data.riseRatio || '0') > parseFloat(data.data.fallRatio || '0') ? 'CALL' : 'PUT';
            break;
          case 'even-odd':
          case 'even-odd-2':
            const evenProb = parseFloat(data.data.evenProbability || '0');
            const oddProb = parseFloat(data.data.oddProbability || '0');
            if (lastOutcomeWasLoss[strategyId] && Math.abs(evenProb - oddProb) < 5) {
              contractType = evenProb > oddProb ? 'DIGITODD' : 'DIGITEVEN';
            } else {
              contractType = evenProb > oddProb ? 'DIGITEVEN' : 'DIGITODD';
            }
            break;
          case 'over-under':
          case 'over-under-2':
            const overProb = parseFloat(data.data.overProbability || '0');
            const underProb = parseFloat(data.data.underProbability || '0');
            const baseBarrier = data.data.barrier || 5;
            if (lastOutcomeWasLoss[strategyId]) {
              prediction = overProb > underProb ? Math.max(0, baseBarrier - 1) : Math.min(9, baseBarrier + 1);
            } else {
              prediction = baseBarrier;
            }
            contractType = overProb > underProb ? 'DIGITOVER' : 'DIGITUNDER';
            break;
          case 'matches-differs':
            const matchProb = parseFloat(data.data.mostFrequentProbability || '0');
            contractType = matchProb > 15 ? 'DIGITMATCH' : 'DIGITDIFF';
            prediction = data.data.target;
            break;
          default:
            console.error('Unknown strategy type for auto trade');
            return;
        }
      }

      console.log('📋 Trade execution parameters:', {
        strategy: strategyId,
        tradeType,
        contractType,
        effectiveStake,
        prediction,
        lossStreak: currentStreak,
        symbol: selectedSymbol,
        duration: ticksAmount
      });

      // Validate trade parameters
      if (effectiveStake < 0.35) {
        throw new Error(`Stake amount ${effectiveStake} is below minimum of 0.35`);
      }

      if (!selectedSymbol) {
        throw new Error('No trading symbol selected');
      }

      // Create proper trade option
      const trade_option: any = {
        amount: effectiveStake,
        basis: 'stake',
        contractTypes: [contractType],
        currency: 'USD',
        duration: ticksAmount,
        duration_unit: 't',
        symbol: selectedSymbol,
      };

      // Add prediction for digit contracts
      if (prediction !== undefined) {
        trade_option.prediction = prediction;
      }

      console.log('📝 Trade option created:', trade_option);

      // Create buy request with proper structure
      const buy_req = {
        buy: '1',
        price: effectiveStake,
        parameters: {
          amount: effectiveStake,
          basis: 'stake',
          contract_type: contractType,
          currency: 'USD',
          duration: ticksAmount,
          duration_unit: 't',
          symbol: selectedSymbol,
        },
      };

      // Add prediction parameters for digit contracts
      if (prediction !== undefined) {
        if (['DIGITOVER', 'DIGITUNDER'].includes(contractType)) {
          buy_req.parameters.barrier = prediction;
        }
        if (['DIGITMATCH', 'DIGITDIFF'].includes(contractType)) {
          buy_req.parameters.barrier = prediction;
        }
      }

      console.log('📤 Sending buy request to Deriv API:', JSON.stringify(buy_req, null, 2));

      // Execute the trade
      console.log('🎯 Calling tradingApi.buy...');
      const response = await tradingApi.buy(buy_req);
      console.log('📥 Raw API response:', response);
      
      const { buy, error } = response;
      
      if (error) {
        console.error('❌ Purchase failed:', error);
        const errorMsg = `Purchase failed: ${error.message || error.code || 'Unknown error'}`;
        console.error('Error details:', JSON.stringify(error, null, 2));
        alert(errorMsg);
        setLastOutcomeWasLoss(prev => ({ ...prev, [strategyId]: true }));
        return;
      }

      if (!buy) {
        console.error('❌ No buy response received');
        alert('No response received from trading API. Please try again.');
        return;
      }

      console.log('✅ Contract purchased successfully!');
      console.log('📊 Purchase details:', JSON.stringify(buy, null, 2));
      
      const successMsg = `✅ ${contractType} contract purchased!\nID: ${buy.contract_id}\nAmount: $${effectiveStake}\nSymbol: ${selectedSymbol}`;
      console.log(successMsg);
      alert(successMsg);
      
      // Track the contract outcome for martingale logic
      const contractId = buy.contract_id;
        
        // Subscribe to contract updates to track win/loss
        try {
          const { subscription, error: subError } = await tradingApi.send({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1,
          });

          if (subError) {
            console.error('Error subscribing to contract:', subError);
            return;
          }

          // Listen for contract completion
          const handleContractUpdate = (evt: MessageEvent) => {
            try {
              const data = JSON.parse(evt.data);
              if (data.msg_type === 'proposal_open_contract' && 
                  data.proposal_open_contract &&
                  String(data.proposal_open_contract.contract_id) === String(contractId)) {
                
                const contract = data.proposal_open_contract;
                
                if (contract.is_sold || contract.status === 'sold') {
                  const profit = Number(contract.profit || 0);
                  const isWin = profit > 0;
                  
                  if (isWin) {
                    setLastOutcomeWasLoss(prev => ({ ...prev, [strategyId]: false }));
                    setLossStreaks(prev => ({ ...prev, [strategyId]: 0 }));
                    console.log(`✅ Win! Profit: ${profit}`);
                  } else {
                    setLastOutcomeWasLoss(prev => ({ ...prev, [strategyId]: true }));
                    setLossStreaks(prev => ({ 
                      ...prev, 
                      [strategyId]: Math.min((prev[strategyId] || 0) + 1, 10)
                    }));
                    console.log(`❌ Loss! Profit: ${profit}`);
                  }
                  
                  // Clean up listener
                  tradingApi?.connection?.removeEventListener('message', handleContractUpdate);
                }
              }
            } catch (error) {
              console.error('Error parsing contract update:', error);
            }
          };

          // Add listener for contract updates
          tradingApi?.connection?.addEventListener('message', handleContractUpdate);
          
          // Clean up listener after 5 minutes
          setTimeout(() => {
            tradingApi?.connection?.removeEventListener('message', handleContractUpdate);
          }, 300000);

        } catch (error) {
          console.error('Error subscribing to contract updates:', error);
        }
      }

    } catch (error) {
      console.error('❌ Critical error executing trade:', error);
      console.error('Error stack:', error.stack);
      
      let errorMessage = 'Trade execution failed: ';
      if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Unknown error occurred';
      }
      
      console.error('Final error message:', errorMessage);
      alert(errorMessage);
      setLastOutcomeWasLoss(prev => ({ ...prev, [strategyId]: true }));
    }
  };

  const startAutoTrading = (strategyId: string) => {
    if (connectionStatus !== 'connected') {
      console.error('Cannot start auto trading: Not connected to API');
      alert('Cannot start auto trading: Not connected to API');
      return;
    }

    // Clear existing interval if any
    if (tradingIntervals[strategyId]) {
      clearInterval(tradingIntervals[strategyId]);
    }

    // Set auto trading status to active
    setAutoTradingStatus(prev => ({
      ...prev,
      [strategyId]: true
    }));

    // Determine interval based on volatility symbol
    let intervalMs = 3000; // Default 3 seconds to avoid too frequent trades
    
    // For 1s volatilities, use slightly faster interval
    if (selectedSymbol.includes('1HZ')) {
      intervalMs = 2000; // 2 seconds for 1s volatilities
    }

    console.log(`Starting auto trading for ${strategyId} with ${intervalMs}ms interval`);

    // Create trading interval that checks conditions continuously
    const interval = setInterval(async () => {
      // Get current auto trading status (since closure might have stale state)
      const currentAutoStatus = autoTradingStatus[strategyId];
      
      // Check if auto trading is still active and connected
      if (!currentAutoStatus || connectionStatus !== 'connected') {
        return;
      }

      const data = analysisData[strategyId];
      const condition = tradingConditions[strategyId];

      if (!data?.data) {
        console.log(`No analysis data available for ${strategyId}`);
        return;
      }

      // Check if trading conditions are met
      const conditionsMet = checkTradingConditions(strategyId, data.data, condition);
      
      if (conditionsMet) {
        console.log(`🎯 Auto trading conditions met for ${strategyId}!`);
        console.log(`🔄 Auth status: ${isAuthorized ? 'Authorized' : 'Not Authorized'}`);
        console.log(`🔗 API status: ${tradingApi ? 'Available' : 'Not Available'}`);
        
        try {
          await executeTrade(strategyId, 'auto');
        } catch (error) {
          console.error(`❌ Auto trade execution failed for ${strategyId}:`, error);
          // Don't alert on auto trading errors to avoid spam
        }
      } else {
        console.log(`⏳ Auto trading conditions not met for ${strategyId}, waiting...`);
        console.log(`📊 Current condition values for debugging:`, {
          strategy: strategyId,
          condition: condition.condition,
          operator: condition.operator,
          threshold: condition.value,
          actualData: data.data
        });
      }
    }, intervalMs);

    // Store the interval
    setTradingIntervals(prev => ({
      ...prev,
      [strategyId]: interval
    }));

    console.log(`Auto trading started for ${strategyId}`);
    alert(`Auto trading started for ${strategyId}. Will trade when conditions are met.`);
  };

  const stopAutoTrading = (strategyId: string) => {
    // Clear the trading interval
    if (tradingIntervals[strategyId]) {
      clearInterval(tradingIntervals[strategyId]);
      setTradingIntervals(prev => ({
        ...prev,
        [strategyId]: null
      }));
    }

    // Set auto trading status to inactive
    setAutoTradingStatus(prev => ({
      ...prev,
      [strategyId]: false
    }));

    console.log(`Auto trading stopped for ${strategyId}`);
    alert(`Auto trading stopped for ${strategyId}`);
  };

  const checkTradingConditions = (strategyId: string, data: any, condition: any) => {
    let currentValue = 0;
    
    console.log('Checking trading conditions:', {
      strategyId,
      condition,
      availableData: {
        riseRatio: data.riseRatio,
        fallRatio: data.fallRatio,
        evenProbability: data.evenProbability,
        oddProbability: data.oddProbability,
        overProbability: data.overProbability,
        underProbability: data.underProbability,
        mostFrequentProbability: data.mostFrequentProbability
      }
    });
    
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
        console.log('Unknown condition type:', condition.condition);
        return false;
    }

    // Validate that we have meaningful data
    if (isNaN(currentValue) || currentValue === 0) {
      console.log(`Invalid or zero value for ${condition.condition}:`, currentValue);
      return false;
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
          return false;
      }
    })();

    console.log('Condition result:', {
      condition: condition.condition,
      currentValue,
      operator: condition.operator,
      threshold: condition.value,
      result,
      strategyId
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
      <div className="trading-card" key={strategyId}>
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
        <div className="connection-status-group">
          <div className={`connection-status ${connectionStatus}`}>
            {connectionStatus === 'connected' && '🟢 Market Data Connected'}
            {connectionStatus === 'disconnected' && '🔴 Market Data Disconnected'}
            {connectionStatus === 'error' && '⚠️ Market Data Error'}
          </div>
          <div className={`trading-api-status ${isAuthorized ? 'authorized' : 'unauthorized'}`}>
            {isAuthorized && tradingApi ? '🟢 Trading API Ready' : '🔴 Trading API Not Ready'}
          </div>
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