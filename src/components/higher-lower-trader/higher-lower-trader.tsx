import React, { useState, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import './higher-lower-trader.scss';

// Volatility indices for Higher/Lower trading
const VOLATILITY_INDICES = [
  { value: 'R_10', label: 'Volatility 10 (1s) Index' },
  { value: 'R_25', label: 'Volatility 25 (1s) Index' },
  { value: 'R_50', label: 'Volatility 50 (1s) Index' },
  { value: 'R_75', label: 'Volatility 75 (1s) Index' },
  { value: 'R_100', label: 'Volatility 100 (1s) Index' },
  { value: 'BOOM500', label: 'Boom 500 Index' },
  { value: 'BOOM1000', label: 'Boom 1000 Index' },
  { value: 'CRASH500', label: 'Crash 500 Index' },
  { value: 'CRASH1000', label: 'Crash 1000 Index' },
  { value: 'stpRNG', label: 'Step Index' },
];

const HigherLowerTrader = observer(() => {
  const store = useStore();
  const { run_panel, transactions, client } = store;

  const apiRef = useRef<any>(null);
  const tickStreamIdRef = useRef<string | null>(null);
  const contractStreamIdRef = useRef<string | null>(null);
  const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

  // API and auth state
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accountCurrency, setAccountCurrency] = useState('USD');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [availableSymbols, setAvailableSymbols] = useState([]);
  
  // Trading parameters
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [stake, setStake] = useState(1.5);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [barrier, setBarrier] = useState('+0.37');
  const [contractType, setContractType] = useState('CALL'); // CALL for Higher, PUT for Lower
  const [stopOnProfit, setStopOnProfit] = useState(false);
  const [targetProfit, setTargetProfit] = useState(5.0);

  // Trading state
  const [isTrading, setIsTrading] = useState(false);
  const [currentContract, setCurrentContract] = useState(null);
  const [contractProgress, setContractProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);

  // Trading statistics
  const [totalStake, setTotalStake] = useState(0);
  const [totalPayout, setTotalPayout] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [contractsWon, setContractsWon] = useState(0);
  const [contractsLost, setContractsLost] = useState(0);
  const [totalProfitLoss, setTotalProfitLoss] = useState(0);

  // Current market data
  const [currentPrice, setCurrentPrice] = useState(0);
  const [priceHistory, setPriceHistory] = useState([]);
  const [trend, setTrend] = useState('neutral');

  const contractTimerRef = useRef(null);
  const stopFlagRef = useRef(false);

  // Initialize API connection and fetch symbols
  useEffect(() => {
    const api = generateDerivApiInstance();
    apiRef.current = api;
    
    const initializeApi = async () => {
      try {
        setConnectionStatus('connecting');
        
        // Wait for connection
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15000);
          
          api.connection.addEventListener('open', () => {
            clearTimeout(timeout);
            setConnectionStatus('connected');
            console.log('API connection established');
            resolve(null);
          });
          
          api.connection.addEventListener('error', (error) => {
            clearTimeout(timeout);
            setConnectionStatus('error');
            console.error('API connection error:', error);
            reject(error);
          });

          api.connection.addEventListener('close', (event) => {
            console.log('API connection closed:', event.code, event.reason);
            setConnectionStatus('disconnected');
            
            // Auto-reconnect if not manually closed
            if (!stopFlagRef.current && event.code !== 1000) {
              setTimeout(() => {
                console.log('Attempting to reconnect...');
                initializeApi();
              }, 3000);
            }
          });
        });

        // Set up global message handler for contract updates
        const globalMessageHandler = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle tick updates
            if (data.msg_type === 'tick' && data.tick?.symbol === selectedSymbol) {
              const newPrice = parseFloat(data.tick.quote);
              setCurrentPrice(newPrice);
              
              setPriceHistory(prev => {
                const newHistory = [...prev.slice(-49), newPrice];
                
                // Calculate trend
                if (newHistory.length >= 5) {
                  const recent = newHistory.slice(-5);
                  const avg = recent.reduce((sum, price) => sum + price, 0) / recent.length;
                  const currentTrend = newPrice > avg ? 'bullish' : newPrice < avg ? 'bearish' : 'neutral';
                  setTrend(currentTrend);
                }
                
                return newHistory;
              });
            }

            // Handle contract updates
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
              handleContractUpdate(data.proposal_open_contract);
            }
          } catch (error) {
            console.error('Error processing message:', error);
          }
        };

        api.connection.addEventListener('message', globalMessageHandler);

        // Fetch available symbols
        const symbolsResponse = await api.send({ active_symbols: 'brief' });
        if (symbolsResponse.error) {
          throw symbolsResponse.error;
        }

        const filteredSymbols = (symbolsResponse.active_symbols || [])
          .filter(symbol => 
            symbol.market === 'synthetic_index' && 
            (symbol.symbol.startsWith('R_') || 
             symbol.symbol.startsWith('BOOM') || 
             symbol.symbol.startsWith('CRASH') ||
             symbol.symbol === 'stpRNG')
          )
          .map(symbol => ({
            value: symbol.symbol,
            label: symbol.display_name
          }));

        setAvailableSymbols(filteredSymbols);
        
        if (filteredSymbols.length > 0) {
          setSelectedSymbol(filteredSymbols[0].value);
          startTickStream(filteredSymbols[0].value);
        }

        // Try to authorize if token exists
        const token = V2GetActiveToken();
        if (token) {
          await authorizeAccount();
        }

      } catch (error) {
        console.error('API initialization failed:', error);
        setConnectionStatus('error');
      }
    };

    initializeApi();

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    try {
      if (tickStreamIdRef.current) {
        apiRef.current?.forget({ forget: tickStreamIdRef.current });
        tickStreamIdRef.current = null;
      }
      if (contractStreamIdRef.current) {
        apiRef.current?.forget({ forget: contractStreamIdRef.current });
        contractStreamIdRef.current = null;
      }
      if (messageHandlerRef.current) {
        apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
      apiRef.current?.disconnect();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  const authorizeAccount = async () => {
    try {
      const token = V2GetActiveToken();
      if (!token) {
        throw new Error('No authorization token found. Please log in.');
      }

      const response = await apiRef.current.authorize(token);
      if (response.error) {
        throw response.error;
      }

      setIsAuthorized(true);
      setAccountCurrency(response.authorize?.currency || 'USD');
      
      // Update client store
      const loginid = response.authorize?.loginid || V2GetActiveClientId();
      client?.setLoginId(loginid);
      client?.setCurrency(response.authorize?.currency || 'USD');
      client?.setIsLoggedIn(true);

    } catch (error) {
      console.error('Authorization failed:', error);
      setIsAuthorized(false);
      throw error;
    }
  };

  const startTickStream = async (symbol) => {
    try {
      // Stop existing stream
      if (tickStreamIdRef.current) {
        await apiRef.current.forget({ forget: tickStreamIdRef.current });
        tickStreamIdRef.current = null;
      }

      // Remove existing message handler
      if (messageHandlerRef.current) {
        apiRef.current.connection.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }

      // Start new tick stream
      const response = await apiRef.current.send({ 
        ticks: symbol, 
        subscribe: 1 
      });
      
      if (response.error) {
        throw response.error;
      }

      if (response.subscription?.id) {
        tickStreamIdRef.current = response.subscription.id;
      }

      // Set up message handler for tick updates
      const messageHandler = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.msg_type === 'tick' && data.tick?.symbol === symbol) {
            const newPrice = parseFloat(data.tick.quote);
            setCurrentPrice(newPrice);
            
            setPriceHistory(prev => {
              const newHistory = [...prev.slice(-49), newPrice];
              
              // Calculate trend
              if (newHistory.length >= 5) {
                const recent = newHistory.slice(-5);
                const avg = recent.reduce((sum, price) => sum + price, 0) / recent.length;
                const currentTrend = newPrice > avg ? 'bullish' : newPrice < avg ? 'bearish' : 'neutral';
                setTrend(currentTrend);
              }
              
              return newHistory;
            });
          }
        } catch (error) {
          console.error('Error processing tick data:', error);
        }
      };

      messageHandlerRef.current = messageHandler;
      apiRef.current.connection.addEventListener('message', messageHandler);

    } catch (error) {
      console.error('Failed to start tick stream:', error);
    }
  };

  const startTrading = async () => {
    try {
      // Verify connection before starting
      if (connectionStatus !== 'connected') {
        throw new Error('Not connected to API. Please check your connection and try again.');
      }

      if (!isAuthorized) {
        await authorizeAccount();
      }

      setIsTrading(true);
      stopFlagRef.current = false;
      
      run_panel.toggleDrawer(true);
      run_panel.setActiveTabIndex(1);
      run_panel.run_id = `higher-lower-${Date.now()}`;
      run_panel.setIsRunning(true);

      while (!stopFlagRef.current) {
        try {
          await executeTrade();
          
          if (stopOnProfit && totalProfitLoss >= targetProfit) {
            console.log('Target profit reached, stopping trading');
            break;
          }
          
          // Wait before next trade
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (tradeError) {
          console.error('Individual trade error:', tradeError);
          
          // If it's a critical error, stop trading
          if (tradeError.message.includes('connection') || 
              tradeError.message.includes('Authorization') ||
              tradeError.message.includes('refresh')) {
            console.log('Critical error detected, stopping trading');
            break;
          }
          
          // For other errors, wait and continue
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
    } catch (error) {
      console.error('Trading initialization error:', error);
      alert(`Trading failed to start: ${error.message}`);
    } finally {
      setIsTrading(false);
      run_panel.setIsRunning(false);
    }
  };

  const executeTrade = async () => {
    try {
      // Ensure we're still connected before executing trade
      if (connectionStatus !== 'connected' || !apiRef.current) {
        throw new Error('API connection lost. Please reconnect before trading.');
      }

      // Validate current price exists
      if (!currentPrice || currentPrice <= 0) {
        throw new Error('No valid current price available. Please wait for market data.');
      }

      // Calculate and validate barrier
      const duration = durationMinutes * 60 + durationSeconds;
      let calculatedBarrier;
      
      try {
        const barrierOffset = parseFloat(barrier.replace(/[+\-]/, ''));
        const isPositive = barrier.startsWith('+');
        
        if (isNaN(barrierOffset)) {
          throw new Error('Invalid barrier format');
        }
        
        calculatedBarrier = isPositive ? 
          (currentPrice + barrierOffset).toFixed(5) : 
          (currentPrice - barrierOffset).toFixed(5);
          
        // Validate barrier is reasonable
        const barrierValue = parseFloat(calculatedBarrier);
        if (barrierValue <= 0) {
          throw new Error('Barrier calculation resulted in invalid value');
        }
        
      } catch (error) {
        console.error('Barrier calculation error:', error);
        throw new Error(`Invalid barrier: ${barrier}. Please use format like +0.37 or -0.25`);
      }

      const proposalRequest = {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: contractType, // 'CALL' for Higher, 'PUT' for Lower
        currency: accountCurrency,
        duration: duration,
        duration_unit: 's',
        symbol: selectedSymbol,
        barrier: calculatedBarrier
      };

      console.log('Sending proposal request:', proposalRequest);
      
      const proposalResponse = await Promise.race([
        apiRef.current.send(proposalRequest),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Proposal request timeout')), 15000)
        )
      ]);

      if (proposalResponse.error) {
        console.error('Proposal error:', proposalResponse.error);
        
        // Handle specific error cases
        if (proposalResponse.error.code === 'InvalidBarrier') {
          throw new Error(`Invalid barrier for current market conditions. Try adjusting the barrier value.`);
        } else if (proposalResponse.error.code === 'InvalidContract') {
          throw new Error(`Contract not available for ${selectedSymbol}. Try a different symbol or parameters.`);
        } else if (proposalResponse.error.code === 'PricesMoved') {
          console.log('Prices moved, retrying with current price...');
          // Wait a moment and retry once
          await new Promise(resolve => setTimeout(resolve, 1000));
          return executeTrade();
        }
        
        throw new Error(`Proposal failed: ${proposalResponse.error.message}`);
      }

      const proposal = proposalResponse.proposal;
      
      if (!proposal || !proposal.id) {
        throw new Error('Invalid proposal response received');
      }
      
      // Validate proposal has required fields
      if (!proposal.ask_price || proposal.ask_price <= 0) {
        throw new Error('Invalid proposal price received');
      }
      
      console.log('Proposal received:', proposal);
      
      // Buy the contract with timeout
      const buyRequest = {
        buy: proposal.id,
        price: proposal.ask_price
      };

      console.log('Sending buy request:', buyRequest);

      const buyResponse = await Promise.race([
        apiRef.current.send(buyRequest),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Buy request timeout')), 15000)
        )
      ]);

      if (buyResponse.error) {
        console.error('Buy error:', buyResponse.error);
        throw new Error(`Trade execution failed: ${buyResponse.error.message}`);
      }

      const contract = buyResponse.buy;
      const contractId = contract.contract_id;
      
      console.log('Trade executed successfully:', contract);

      // Update statistics
      setTotalStake(prev => prev + stake);
      setTotalRuns(prev => prev + 1);

      // Create contract object
      const contractData = {
        id: contractId,
        type: contractType,
        stake: stake,
        barrier: parseFloat(barrier.replace(/[+\-]/, '')),
        barrierValue: currentPrice + parseFloat(barrier),
        entryPrice: currentPrice,
        startTime: Date.now(),
        duration: duration,
        status: 'active',
        longcode: contract.longcode
      };

      setCurrentContract(contractData);
      setTimeRemaining(duration);
      setContractProgress(0);

      // Add to transactions
      try {
        const symbolDisplay = availableSymbols.find(s => s.value === selectedSymbol)?.label || selectedSymbol;
        transactions.onBotContractEvent({
          contract_id: contractId,
          transaction_ids: { buy: contract.transaction_id },
          buy_price: contract.buy_price,
          currency: accountCurrency,
          contract_type: contractType,
          underlying: selectedSymbol,
          display_name: symbolDisplay,
          date_start: Math.floor(Date.now() / 1000),
          status: 'open',
          longcode: contract.longcode
        });
      } catch (error) {
        console.error('Error adding to transactions:', error);
      }

      // Subscribe to contract updates
      await subscribeToContract(contractId);

      // Start countdown timer
      startContractTimer(duration);

    } catch (error) {
      console.error('Trade execution error:', error);
      
      // Check if it's a connection issue
      if (error.message.includes('connection') || error.message.includes('timeout')) {
        setConnectionStatus('error');
        
        // Try to reconnect
        try {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await authorizeAccount();
          setConnectionStatus('connected');
        } catch (reconnectError) {
          console.error('Reconnection failed:', reconnectError);
          throw new Error('Connection lost during trade execution. Please refresh and try again.');
        }
      }
      
      throw error;
    }
  };

  const subscribeToContract = async (contractId) => {
    try {
      const response = await apiRef.current.send({
        proposal_open_contract: 1,
        contract_id: contractId,
        subscribe: 1
      });

      if (response.error) {
        throw response.error;
      }

      if (response.subscription?.id) {
        contractStreamIdRef.current = response.subscription.id;
      }

      // Handle initial contract state if present
      if (response.proposal_open_contract) {
        handleContractUpdate(response.proposal_open_contract);
      }

    } catch (error) {
      console.error('Contract subscription error:', error);
    }
  };

  const handleContractUpdate = (contractData) => {
    try {
      // Update transactions store
      transactions.onBotContractEvent(contractData);

      // Check if contract is finished
      if (contractData.is_sold || contractData.status === 'sold') {
        finishContract(contractData);
      }
    } catch (error) {
      console.error('Contract update error:', error);
    }
  };

  const startContractTimer = (duration) => {
    setTimeRemaining(duration);
    setContractProgress(0);

    contractTimerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(contractTimerRef.current);
          return 0;
        }
        const newRemaining = prev - 1;
        setContractProgress(((duration - newRemaining) / duration) * 100);
        return newRemaining;
      });
    }, 1000);
  };

  const finishContract = (contractData) => {
    const profit = parseFloat(contractData.profit || 0);
    const payout = parseFloat(contractData.sell_price || 0);

    setTotalPayout(prev => prev + payout);
    setTotalProfitLoss(prev => prev + profit);

    if (profit > 0) {
      setContractsWon(prev => prev + 1);
    } else {
      setContractsLost(prev => prev + 1);
    }

    // Clear contract state
    setCurrentContract(null);
    setContractProgress(0);
    setTimeRemaining(0);

    if (contractTimerRef.current) {
      clearInterval(contractTimerRef.current);
      contractTimerRef.current = null;
    }

    // Cleanup contract subscription
    if (contractStreamIdRef.current) {
      apiRef.current.forget({ forget: contractStreamIdRef.current });
      contractStreamIdRef.current = null;
    }
  };

  const stopTrading = () => {
    stopFlagRef.current = true;
    setIsTrading(false);
    setCurrentContract(null);
    setContractProgress(0);
    setTimeRemaining(0);

    if (contractTimerRef.current) {
      clearInterval(contractTimerRef.current);
      contractTimerRef.current = null;
    }

    run_panel.setIsRunning(false);
  };

  const sellContract = async () => {
    if (!currentContract) return;

    try {
      const sellResponse = await apiRef.current.send({
        sell: currentContract.id,
        price: 0 // Market price
      });

      if (sellResponse.error) {
        throw sellResponse.error;
      }

      // Contract will be updated via the subscription
    } catch (error) {
      console.error('Sell contract error:', error);
    }
  };

  const resetStats = () => {
    setTotalStake(0);
    setTotalPayout(0);
    setTotalRuns(0);
    setContractsWon(0);
    setContractsLost(0);
    setTotalProfitLoss(0);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = () => durationMinutes * 60 + durationSeconds;

  return (
    <div className="higher-lower-trader">
      {/* Header */}
      <div className="trader-header">
        <h2>Higher/Lower Trading</h2>
      </div>

      {/* Active Contract View */}
      {isTrading && currentContract && (
        <div className="active-contract">
          <div className="contract-controls">
            <button
              onClick={stopTrading}
              className="btn-stop"
            >
              Stop
            </button>
            <span className="contract-status">Contract bought</span>
          </div>

          <div className="contract-info">
            <div className="contract-icon">
              {contractType === 'CALL' ? (
                <TrendingUp className="icon-higher" />
              ) : (
                <TrendingDown className="icon-lower" />
              )}
            </div>
            <span className="contract-name">Volatility 10 (1s) Index</span>
            <span className="contract-type">
              {contractType === 'CALL' ? 'Higher' : 'Lower'}
            </span>
          </div>

          <div className="contract-timer">
            <div className="timer-text">{formatTime(timeRemaining)}</div>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${contractProgress}%` }}
              ></div>
            </div>
          </div>

          <div className="contract-stats">
            <div className="stat-item">
              <div className="stat-label">Total profit/loss:</div>
              <div className={`stat-value ${totalProfitLoss >= 0 ? 'profit' : 'loss'}`}>
                {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Contract value:</div>
              <div className="stat-value">{currentPrice.toFixed(2)}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Stake:</div>
              <div className="stat-value">{stake.toFixed(2)} USD</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Potential payout:</div>
              <div className="stat-value profit">{(stake * 1.8).toFixed(2)} USD</div>
            </div>
          </div>

          <button
            onClick={sellContract}
            className="btn-sell"
          >
            Sell
          </button>
        </div>
      )}

      {/* Setup Form */}
      {!isTrading && (
        <div className="setup-form">
          <div className="form-content">
            {/* Connection Status */}
            <div className="form-group">
              <div className="connection-status">
                <span className={`status-indicator ${connectionStatus}`}></span>
                <span className="status-text">
                  {connectionStatus === 'connected' ? 'Connected' : 
                   connectionStatus === 'connecting' ? 'Connecting...' : 
                   connectionStatus === 'error' ? 'Connection Error' : 'Disconnected'}
                </span>
                {isAuthorized && (
                  <span className="auth-status">• Authorized ({accountCurrency})</span>
                )}
                {connectionStatus === 'error' && (
                  <button
                    onClick={() => window.location.reload()}
                    className="btn-reconnect"
                    style={{ marginLeft: '10px', padding: '4px 8px', fontSize: '12px' }}
                  >
                    Refresh Page
                  </button>
                )}
              </div>
            </div>

            {/* Volatility Selection */}
            <div className="form-group">
              <label htmlFor="volatility-select" className="form-label">
                Volatility Index
              </label>
              <select
                id="volatility-select"
                className="form-select"
                value={selectedSymbol}
                onChange={(e) => {
                  setSelectedSymbol(e.target.value);
                  startTickStream(e.target.value);
                }}
                disabled={isTrading}
              >
                {availableSymbols.map(symbol => (
                  <option key={symbol.value} value={symbol.value}>
                    {symbol.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Trend Indicator */}
            <div className="trend-indicator-section">
              <div className="trend-placeholder">
                <div className="trend-info">
                  <span className="trend-label">Market Trend:</span>
                  <span className={`trend-status ${trend}`}>
                    {trend === 'bullish' ? 'Bullish 📈' : 
                     trend === 'bearish' ? 'Bearish 📉' : 
                     'Neutral ➡️'}
                  </span>
                </div>
                <div className="trend-chart-placeholder">
                  <div className="chart-line"></div>
                  <div className="chart-dots">
                    {priceHistory.slice(-3).map((_, index) => (
                      <span key={index} className="dot active"></span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Contract Type */}
            <div className="form-group">
              <label className="form-label">
                Contract Type
              </label>
              <div className="button-group">
                <button
                  onClick={() => setContractType('CALL')}
                  className={`btn-type ${contractType === 'CALL' ? 'btn-higher active' : 'btn-higher'}`}
                >
                  <TrendingUp className="icon" />
                  Higher
                </button>
                <button
                  onClick={() => setContractType('PUT')}
                  className={`btn-type ${contractType === 'PUT' ? 'btn-lower active' : 'btn-lower'}`}
                >
                  <TrendingDown className="icon" />
                  Lower
                </button>
              </div>
            </div>

            {/* Stake */}
            <div className="form-group">
              <label htmlFor="stake" className="form-label">
                <DollarSign className="icon" />
                Stake (USD)
              </label>
              <input
                id="stake"
                type="number"
                step="0.01"
                min="0.35"
                value={stake}
                onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>

            {/* Duration */}
            <div className="form-group">
              <label className="form-label">
                <Clock className="icon" />
                Duration
              </label>
              <div className="input-group">
                <div className="input-wrapper">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
                    className="form-input"
                    placeholder="Minutes"
                  />
                  <div className="input-hint">Minutes</div>
                </div>
                <div className="input-wrapper">
                  <input
                    type="number"
                    min="15"
                    max="3600"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 15)}
                    className="form-input"
                    placeholder="Seconds"
                  />
                  <div className="input-hint">Seconds</div>
                </div>
              </div>
              <div className="duration-total">
                Total: {formatTime(getTotalDuration())}
              </div>
            </div>

            {/* Barrier */}
            <div className="form-group">
              <label htmlFor="barrier" className="form-label">
                Barrier
              </label>
              <input
                id="barrier"
                type="text"
                value={barrier}
                onChange={(e) => setBarrier(e.target.value)}
                className="form-input"
                placeholder="+0.37"
              />
              <div className="input-hint">
                Use + or - followed by the offset (e.g., +0.37, -0.25)
                {currentPrice > 0 && barrier && (
                  <div className="barrier-preview">
                    {(() => {
                      try {
                        const barrierOffset = parseFloat(barrier.replace(/[+\-]/, ''));
                        const isPositive = barrier.startsWith('+');
                        if (!isNaN(barrierOffset)) {
                          const targetPrice = isPositive ? 
                            (currentPrice + barrierOffset).toFixed(5) : 
                            (currentPrice - barrierOffset).toFixed(5);
                          return `Target: ${targetPrice}`;
                        }
                      } catch (error) {
                        return 'Invalid barrier format';
                      }
                      return '';
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Stop on Profit */}
            <div className="form-option">
              <div className="checkbox-group">
                <input
                  id="stopOnProfit"
                  type="checkbox"
                  checked={stopOnProfit}
                  onChange={(e) => setStopOnProfit(e.target.checked)}
                  className="checkbox"
                />
                <label htmlFor="stopOnProfit" className="checkbox-label">
                  Stop when in profit
                </label>
              </div>
              {stopOnProfit && (
                <div className="option-detail">
                  <label htmlFor="targetProfit" className="option-label">
                    Target Profit (USD)
                  </label>
                  <input
                    id="targetProfit"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={targetProfit}
                    onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                    className="form-input small"
                  />
                </div>
              )}
            </div>

            {/* Authorization Check */}
            {!isAuthorized && (
              <div className="auth-warning">
                <p>⚠️ Please log in to start trading</p>
                <button
                  onClick={authorizeAccount}
                  className="btn-auth"
                  disabled={connectionStatus !== 'connected'}
                >
                  Authorize Account
                </button>
              </div>
            )}

            {/* Start/Stop Button */}
            <button
              onClick={startTrading}
              disabled={
                getTotalDuration() < 15 || 
                !isAuthorized || 
                isTrading || 
                connectionStatus !== 'connected' ||
                availableSymbols.length === 0 ||
                !barrier ||
                !barrier.match(/^[+\-]\d+(\.\d+)?$/) ||
                currentPrice <= 0 ||
                stake < 0.35
              }
              className="btn-start"
            >
              <Play className="icon" />
              <span>
                {isTrading ? 'Trading...' : 'Start Trading'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="stats-panel">
        <div className="stats-grid">
          <div className="stat">
            <div className="stat-title">Total stake</div>
            <div className="stat-value">{totalStake.toFixed(2)} USD</div>
          </div>
          <div className="stat">
            <div className="stat-title">Total payout</div>
            <div className="stat-value">{totalPayout.toFixed(2)} USD</div>
          </div>
          <div className="stat">
            <div className="stat-title">No. of runs</div>
            <div className="stat-value">{totalRuns}</div>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat">
            <div className="stat-title">Contracts lost</div>
            <div className="stat-value loss">{contractsLost}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Contracts won</div>
            <div className="stat-value profit">{contractsWon}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Total profit/loss</div>
            <div className={`stat-value ${totalProfitLoss >= 0 ? 'profit' : 'loss'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
            </div>
          </div>
        </div>

        <button
          onClick={resetStats}
          className="btn-reset"
        >
          Reset
        </button>
      </div>

      {/* Current Price Display */}
      <div className="price-display">
        <div className="price-content">
          <div className="price-label">Current Price ({selectedSymbol})</div>
          <div className="price-value">
            {currentPrice ? currentPrice.toFixed(5) : '-.-----'}
          </div>
          {currentContract && (
            <div className="barrier-info">
              Entry: {currentContract.entryPrice.toFixed(5)} | 
              Barrier: {barrier} | 
              Target: {currentContract.barrierValue.toFixed(5)}
            </div>
          )}
          <div className="price-history">
            {priceHistory.slice(-10).map((price, index) => (
              <span key={index} className="history-price">
                {price.toFixed(3)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Trading Controls */}
      {isTrading && (
        <div className="trading-controls">
          <div className="controls-group">
            <button
              onClick={stopTrading}
              className="btn-stop-bot"
            >
              <Square className="icon" />
              <span>Stop Bot</span>
            </button>
            {currentContract && (
              <button
                onClick={sellContract}
                className="btn-sell-early"
              >
                Sell Early
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default HigherLowerTrader;