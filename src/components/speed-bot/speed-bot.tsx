import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
import getBotInterface from '@/external/bot-skeleton/services/tradeEngine/Interface/BotInterface';
import TradeEngine from '@/external/bot-skeleton/services/tradeEngine/trade';
import { globalObserver } from '@/utils/tmp/dummy';
import './speed-bot.scss';

interface Trade {
  id: string;
  timestamp: string;
  symbol: string;
  contractType: string;
  result: 'win' | 'loss' | 'pending';
  stake: number;
  profit: number;
  prediction?: string;
}

interface TradingConditions {
  winStake: number;
  lossStake: number;
  winAction: 'increase' | 'decrease' | 'reset';
  lossAction: 'increase' | 'decrease' | 'reset';
  stopLoss: number;
  takeProfit: number;
  maxConsecutiveLosses: number;
}

const SpeedBot: React.FC = observer(() => {
  const store = useStore();
  const run_panel = store?.run_panel;
  const blockly_store = store?.blockly_store;
  const client = store?.client;

  // Trading Configuration
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [tradeType, setTradeType] = useState('digits');
  const [contractType, setSelectedContractType] = useState('DIGITEVEN');
  const [stake, setStake] = useState(1.0);
  const [barrier, setBarrier] = useState(5);
  const [duration, setDuration] = useState(1);
  const [durationType, setDurationType] = useState('t');

  // Trading Conditions
  const [tradingConditions, setTradingConditions] = useState<TradingConditions>({
    winStake: 1.0,
    lossStake: 1.0,
    winAction: 'reset',
    lossAction: 'increase',
    stopLoss: 100,
    takeProfit: 100,
    maxConsecutiveLosses: 5
  });

  // Advanced Options
  const [useMartingale, setUseMartingale] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.0);
  const [useAdvancedConditions, setUseAdvancedConditions] = useState(false);
  const [restartConditions, setRestartConditions] = useState({
    onProfit: false,
    onLoss: false,
    profitAmount: 10,
    lossAmount: 10
  });

  // Trading State
  const [isTrading, setIsTrading] = useState(false);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [currentStake, setCurrentStake] = useState(1.0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Bot Engine State
  const [tradeEngine, setTradeEngine] = useState<any>(null);
  const [botInterface, setBotInterface] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);

  // ML Prediction State
  const [useMlPrediction, setUseMlPrediction] = useState(false);
  const [mlConfidenceThreshold, setMlConfidenceThreshold] = useState(0.7);
  const [mlPrediction, setMlPrediction] = useState<any>(null);

  const [isRunning, setIsRunning] = useState(false);

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

  const tradeTypes = [
    { value: 'digits', label: 'Digits' },
    { value: 'even_odd', label: 'Even/Odd' },
    { value: 'over_under', label: 'Over/Under' },
    { value: 'matches_differs', label: 'Matches/Differs' },
    { value: 'rise_fall', label: 'Rise/Fall' }
  ];

  const getContractTypes = () => {
    try {
      switch (tradeType) {
        case 'digits':
          return [
            { value: 'DIGITEVEN', label: 'Even' },
            { value: 'DIGITODD', label: 'Odd' }
          ];
        case 'even_odd':
          return [
            { value: 'DIGITEVEN', label: 'Even' },
            { value: 'DIGITODD', label: 'Odd' }
          ];
        case 'over_under':
          return [
            { value: 'DIGITOVER', label: 'Over' },
            { value: 'DIGITUNDER', label: 'Under' }
          ];
        case 'matches_differs':
          return [
            { value: 'DIGITMATCH', label: 'Matches' },
            { value: 'DIGITDIFF', label: 'Differs' }
          ];
        case 'rise_fall':
          return [
            { value: 'CALL', label: 'Rise' },
            { value: 'PUT', label: 'Fall' }
          ];
        default:
          return [
            { value: 'DIGITEVEN', label: 'Even' },
            { value: 'DIGITODD', label: 'Odd' }
          ];
      }
    } catch (error) {
      console.error('Error in getContractTypes:', error);
      return [
        { value: 'DIGITEVEN', label: 'Even' },
        { value: 'DIGITODD', label: 'Odd' }
      ];
    }
  };

  // Get auth token
  const getAuthToken = () => {
    if (!client?.is_logged_in) return null;

    let token = null;
    if (client.getToken && typeof client.getToken === 'function') {
      token = client.getToken();
    }
    if (!token && client.token) {
      token = client.token;
    }
    if (!token) {
      try {
        const storedTokens = localStorage.getItem('client.tokens');
        if (storedTokens) {
          const parsedTokens = JSON.parse(storedTokens);
          if (parsedTokens && Object.keys(parsedTokens).length > 0) {
            token = Object.values(parsedTokens)[0];
          }
        }
      } catch (e) {
        console.error('Error reading tokens from localStorage:', e);
      }
    }
    return token;
  };

  // Initialize bot engine
  const initializeBotEngine = useCallback(async () => {
    try {
      console.log('🤖 Initializing Speed Bot engine...');

      const authToken = getAuthToken();
      if (!authToken) {
        throw new Error('No authentication token available');
      }

      // Create engine scope
      const engineScope = {
        observer: globalObserver
      };

      // Initialize trade engine
      const engine = new TradeEngine(engineScope);

      // Initialize with token and options
      const initOptions = {
        symbol: selectedSymbol,
        currency: client?.currency || 'USD'
      };

      await engine.init(authToken, initOptions);

      // Create bot interface
      const botIface = getBotInterface(engine);

      setTradeEngine(engine);
      setBotInterface(botIface);
      setIsConnected(true);
      setError(null);

      console.log('✅ Speed Bot engine initialized successfully');
      return { engine, botIface };

    } catch (error) {
      console.error('❌ Failed to initialize Speed Bot engine:', error);
      setError(`Bot engine initialization failed: ${error.message}`);
      setIsConnected(false);
      throw error;
    }
  }, [selectedSymbol, client]);

  // Execute trade
  const executeTrade = useCallback(async () => {
    if (!tradeEngine || !botInterface || !isConnected) {
      setError('Bot not properly initialized or not connected');
      return;
    }

    try {
      setError(null);
      setIsTrading(true);

      // Determine contract type
      let predictedContractType = contractType;
      if (useMlPrediction && mlPrediction && mlPrediction.confidence >= mlConfidenceThreshold) {
        predictedContractType = mlPrediction.prediction === 'even' ? 'DIGITEVEN' : 'DIGITODD';
      }

      // Prepare trade options
      const tradeOptions: any = {
        amount: currentStake,
        basis: 'stake',
        contract_type: predictedContractType,
        currency: client?.currency || 'USD',
        duration: duration,
        duration_unit: durationType,
        symbol: selectedSymbol,
      };

      // Add barrier/prediction for specific contract types
      if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType)) {
        tradeOptions.barrier = barrier.toString();
      }

      console.log('🚀 Executing trade with options:', tradeOptions);

      // Create pending trade
      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const pendingTrade: Trade = {
        id: tradeId,
        timestamp: new Date().toLocaleTimeString(),
        symbol: selectedSymbol,
        contractType: predictedContractType,
        result: 'pending',
        stake: currentStake,
        profit: 0,
        prediction: ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType) ? barrier.toString() : undefined
      };

      setTradeHistory(prev => [pendingTrade, ...prev.slice(0, 19)]);
      setTotalTrades(prev => prev + 1);

      // Execute purchase through bot interface
      const purchaseResult = await botInterface.purchase(tradeOptions);
      console.log('✅ Purchase result:', purchaseResult);

      // The bot skeleton will handle continuous trading automatically
      // No need to manually wait for contract closure
      return purchaseResult;

    } catch (error) {
      console.error('❌ Trade execution failed:', error);
      setError(`Trade execution failed: ${error.message}`);

      // Update pending trade to show error
      setTradeHistory(prev => {
        const updated = [...prev];
        if (updated[0] && updated[0].result === 'pending') {
          updated[0].result = 'loss';
          updated[0].profit = -updated[0].stake;
        }
        return updated;
      });
    }
  }, [tradeEngine, botInterface, isConnected, currentStake, contractType, selectedSymbol, duration, durationType, barrier, client, useMlPrediction, mlPrediction, mlConfidenceThreshold, singleContractMode, totalTrades]);

  // Handle trade result
  const handleTradeResult = useCallback((profit: number) => {
    const isWin = profit > 0;

    // Update trade history
    setTradeHistory(prev => {
      const updated = [...prev];
      if (updated[0] && updated[0].result === 'pending') {
        updated[0].result = isWin ? 'win' : 'loss';
        updated[0].profit = profit;
      }
      return updated;
    });

    // Update counters
    if (isWin) {
      setWins(prev => prev + 1);
      setConsecutiveLosses(0);

      // Handle win action
      if (tradingConditions.winAction === 'reset') {
        setCurrentStake(stake);
      } else if (tradingConditions.winAction === 'increase') {
        setCurrentStake(prev => prev + tradingConditions.winStake);
      } else if (tradingConditions.winAction === 'decrease') {
        setCurrentStake(prev => Math.max(0.35, prev - tradingConditions.winStake));
      }
    } else {
      setLosses(prev => prev + 1);
      setConsecutiveLosses(prev => {
        const newConsecutive = prev + 1;

        // Handle loss action
        if (useMartingale) {
          setCurrentStake(prevStake => prevStake * martingaleMultiplier);
        } else if (tradingConditions.lossAction === 'increase') {
          setCurrentStake(prev => prev + tradingConditions.lossStake);
        } else if (tradingConditions.lossAction === 'decrease') {
          setCurrentStake(prev => Math.max(0.35, prev - tradingConditions.lossStake));
        } else if (tradingConditions.lossAction === 'reset') {
          setCurrentStake(stake);
        }

        // Check max consecutive losses
        if (newConsecutive >= tradingConditions.maxConsecutiveLosses) {
          console.log('🛑 Max consecutive losses reached, stopping trading');
          setIsTrading(false);
        }

        return newConsecutive;
      });
    }

    setTotalProfit(prev => prev + profit);

    // Check stop loss and take profit
    setTotalProfit(currentProfit => {
      if (currentProfit <= -tradingConditions.stopLoss) {
        console.log('🛑 Stop loss reached, stopping trading');
        setIsTrading(false);
      } else if (currentProfit >= tradingConditions.takeProfit) {
        console.log('🎯 Take profit reached, stopping trading');
        setIsTrading(false);
      }
      return currentProfit;
    });

  }, [stake, tradingConditions, useMartingale, martingaleMultiplier]);

  // Start trading
  const startTrading = async () => {
    try {
      setError(null);

      // Check authentication
      const authToken = getAuthToken();
      if (!authToken) {
        setError('Please log in to Deriv first.');
        return;
      }

      // Validate parameters
      if (stake < 0.35) {
        setError('Minimum stake is 0.35 USD');
        return;
      }

      // Validate contract types
      const contracts = getContractTypes();
      if (!contracts || !Array.isArray(contracts) || contracts.length === 0) {
        setError('Invalid trade type configuration');
        return;
      }

      // Validate selected contract type
      if (!contractType || !contracts.find(c => c && c.value === contractType)) {
        setError('Invalid contract type selected');
        return;
      }

      // Initialize bot engine if not connected
      if (!isConnected) {
        await initializeBotEngine();
      }

      // Reset state
      setCurrentStake(stake);
      setConsecutiveLosses(0);
      setTotalProfit(0);
      setIsTrading(true);
      setIsRunning(true);

      console.log('✅ Speed Bot trading started');

      // Simulate ML Prediction (Replace with actual ML integration)
      if (useMlPrediction) {
        simulateMLPrediction();
      }

      // Start first trade
      setTimeout(() => {
        if (isTrading) {
          executeTrade();
        }
      }, 1000);

    } catch (error) {
      console.error('❌ Error starting trading:', error);
      setError(`Failed to start trading: ${error.message}`);
    }
  };

  // Simulate ML Prediction - Replace with actual ML integration
  const simulateMLPrediction = () => {
    // Simulate prediction data
    const simulatedPrediction = {
      prediction: Math.random() > 0.5 ? 'even' : 'odd',
      evenProbability: Math.random(),
      oddProbability: Math.random(),
      confidence: Math.random(),
    };
    setMlPrediction(simulatedPrediction);

    console.log('🔮 Simulated ML Prediction:', simulatedPrediction);
  };

  // Stop trading
  const stopTrading = () => {
    setIsTrading(false);
    setIsRunning(false);
    console.log('🛑 Speed Bot trading stopped');
  };

  // Reset statistics
  const resetStats = () => {
    setTradeHistory([]);
    setTotalTrades(0);
    setWins(0);
    setLosses(0);
    setTotalProfit(0);
    setCurrentStake(stake);
    setConsecutiveLosses(0);
    setError(null);
  };

  // Handle bot events
  useEffect(() => {
    if (!isTrading || !isConnected) return;

    const handleTradeComplete = (data: any) => {
      if (data && data.proposal_open_contract) {
        const contract = data.proposal_open_contract;
        if (contract.is_sold) {
          const profit = parseFloat(contract.profit || 0);
          handleTradeResult(profit);

          // Bot skeleton handles continuous trading automatically
          // Speed Bot just needs to monitor for stop conditions
        }
      }
    };

    const handleError = (data: any) => {
      console.error('❌ Bot engine error:', data);
      if (data && data.error) {
        setError(`Bot error: ${data.error.message}`);
      }
    };

    if (globalObserver) {
      globalObserver.register('bot.contract', handleTradeComplete);
      globalObserver.register('bot.error', handleError);

      return () => {
        globalObserver.unregister('bot.contract', handleTradeComplete);
        globalObserver.unregister('bot.error', handleError);
      };
    }
  }, [isTrading, isConnected, handleTradeResult, executeTrade]);

  // Update current stake when base stake changes
  useEffect(() => {
    if (!isTrading) {
      setCurrentStake(stake);
    }
  }, [stake, isTrading]);

  // Initialize contract type when trade type changes
  useEffect(() => {
    try {
      const contracts = getContractTypes();
      if (contracts && Array.isArray(contracts) && contracts.length > 0) {
        const currentContractExists = contracts.find(c => c && c.value === contractType);
        if (!currentContractExists && contracts[0] && contracts[0].value) {
          setSelectedContractType(contracts[0].value);
        }
      }
    } catch (error) {
      console.error('Error initializing contract type:', error);
      setSelectedContractType('DIGITEVEN');
    }
  }, [tradeType, contractType]);

  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';

  return (
    <div className="speed-bot">
      <div className="speed-bot__header">
        <h2>Speed Bot Pro</h2>
        <div className="speed-bot__status">
          <span className={`speed-bot__connection ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </span>
        </div>
      </div>

      {error && (
        <div className="speed-bot__error">
          {error}
        </div>
      )}

      {!client?.is_logged_in && (
        <div className="speed-bot__login-warning">
          <p>⚠️ Please log in to Deriv to start trading</p>
        </div>
      )}

      <div className="speed-bot__content">
        {/* Trade Parameters */}
        <div className="speed-bot__section">
          <h3>1. Trade Parameters</h3>
          <div className="speed-bot__form-grid">
            <div className="speed-bot__form-group">
              <label>Market</label>
              <select value="derived" disabled>
                <option value="derived">Derived</option>
              </select>
            </div>
            <div className="speed-bot__form-group">
              <label>Symbol</label>
              <select 
                value={selectedSymbol} 
                onChange={(e) => setSelectedSymbol(e.target.value)}
                disabled={isTrading}
              >
                {volatilitySymbols.map(symbol => (
                  <option key={symbol.value} value={symbol.value}>
                    {symbol.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="speed-bot__form-group">
              <label>Trade Type</label>
              <select 
                value={tradeType} 
                onChange={(e) => {
                  setTradeType(e.target.value);
                  const contracts = getContractTypes();
                  if (contracts && contracts.length > 0) {
                    setSelectedContractType(contracts[0].value);
                  }
                }}
                disabled={isTrading}
              >
                {tradeTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="speed-bot__form-group">
              <label>Contract Type</label>
              <select 
                value={contractType} 
                onChange={(e) => setSelectedContractType(e.target.value)}
                disabled={isTrading}
              >
                {getContractTypes()?.map((contract, index) => 
                  contract ? (
                    <option key={contract.value || index} value={contract.value}>
                      {contract.label}
                    </option>
                  ) : null
                ) || []}
              </select>
            </div>
            {['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType) && (
              <div className="speed-bot__form-group">
                <label>Prediction</label>
                <input
                  type="number"
                  value={barrier}
                  onChange={(e) => setBarrier(parseInt(e.target.value))}
                  min="0"
                  max="9"
                  disabled={isTrading}
                />
              </div>
            )}
            <div className="speed-bot__form-group">
              <label>Duration</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                min="1"
                disabled={isTrading}
              />
            </div>
            <div className="speed-bot__form-group">
              <label>Duration Unit</label>
              <select 
                value={durationType} 
                onChange={(e) => setDurationType(e.target.value)}
                disabled={isTrading}
              >
                <option value="t">Ticks</option>
                <option value="s">Seconds</option>
                <option value="m">Minutes</option>
              </select>
            </div>
            <div className="speed-bot__form-group">
              <label>Stake (USD)</label>
              <input
                type="number"
                value={stake}
                onChange={(e) => setStake(parseFloat(e.target.value))}
                min="0.35"
                step="0.01"
                disabled={isTrading}
              />
            </div>
          </div>
        </div>

        {/* Purchase Conditions */}
        <div className="speed-bot__section">
          <h3>2. Purchase Conditions</h3>
          <div className="speed-bot__form-grid">
            <div className="speed-bot__checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={useMartingale}
                  onChange={(e) => setUseMartingale(e.target.checked)}
                  disabled={isTrading}
                />
                Use Martingale
              </label>
            </div>
            {useMartingale && (
              <div className="speed-bot__form-group">
                <label>Martingale Multiplier</label>
                <input
                  type="number"
                  value={martingaleMultiplier}
                  onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value))}
                  min="1.1"
                  step="0.1"
                  disabled={isTrading}
                />
              </div>
            )}
            <div className="speed-bot__checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={useMlPrediction}
                  onChange={(e) => setUseMlPrediction(e.target.checked)}
                  disabled={isTrading}
                />
                Use ML Prediction
              </label>
            </div>
            {useMlPrediction && (
              <div className="speed-bot__form-group">
                <label>ML Confidence Threshold</label>
                <input
                  type="number"
                  value={mlConfidenceThreshold}
                  onChange={(e) => setMlConfidenceThreshold(parseFloat(e.target.value))}
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  disabled={isTrading}
                />
              </div>
            )}
          </div>
        </div>

        {/* ML Prediction Display */}
        {useMlPrediction && mlPrediction && (
          <div className="speed-bot__section">
            <h3>3. ML Prediction</h3>
            <div className="speed-bot__ml-prediction">
              <div className={`prediction-badge ${mlPrediction.prediction}`}>
                {mlPrediction.prediction.toUpperCase()}
              </div>
              <div className="prediction-stats">
                <div className="stat">
                  <label>Even:</label>
                  <span>{(mlPrediction.evenProbability * 100).toFixed(1)}%</span>
                </div>
                <div className="stat">
                  <label>Odd:</label>
                  <span>Женско{(mlPrediction.oddProbability * 100).toFixed(1)}%</span>
                </div>
                <div className="stat">
                  <label>Confidence:</label>
                  <span>{(mlPrediction.confidence * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Restart Trading Conditions */}
        <div className="speed-bot__section">
          <h3>4. Restart Trading Conditions</h3>
          <div className="speed-bot__form-grid">
            <div className="speed-bot__form-group">
              <label>Stop Loss (USD)</label>
              <input
                type="number"
                value={tradingConditions.stopLoss}
                onChange={(e) => setTradingConditions(prev => ({ ...prev, stopLoss: parseFloat(e.target.value) }))}
                min="1"
                disabled={isTrading}
              />
            </div>
            <div className="speed-bot__form-group">
              <label>Take Profit (USD)</label>
              <input
                type="number"
                value={tradingConditions.takeProfit}
                onChange={(e) => setTradingConditions(prev => ({ ...prev, takeProfit: parseFloat(e.target.value) }))}
                min="1"
                disabled={isTrading}
              />
            </div>
            <div className="speed-bot__form-group">
              <label>Max Consecutive Losses</label>
              <input
                type="number"
                value={tradingConditions.maxConsecutiveLosses}
                onChange={(e) => setTradingConditions(prev => ({ ...prev, maxConsecutiveLosses: parseInt(e.target.value) }))}
                min="1"
                disabled={isTrading}
              />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="speed-bot__controls">
          <div className="speed-bot__control-buttons">
            {!isTrading ? (
              <button 
                className="speed-bot__start-btn"
                onClick={startTrading}
                disabled={!client?.is_logged_in}
              >
                🚀 Start Trading
              </button>
            ) : (
              <button 
                className="speed-bot__stop-btn"
                onClick={stopTrading}
              >
                🛑 Stop Trading
              </button>
            )}
            <button 
              className="speed-bot__reset-btn"
              onClick={resetStats}
              disabled={isTrading}
            >
              🔄 Reset Stats
            </button>
          </div>
        </div>

        {/* Statistics */}
        <div className="speed-bot__stats">
          <h3>Statistics</h3>
          <div className="speed-bot__stats-grid">
            <div className="speed-bot__stat">
              <label>Current Stake</label>
              <span>${currentStake.toFixed(2)}</span>
            </div>
            <div className="speed-bot__stat">
              <label>Total Trades</label>
              <span>{totalTrades}</span>
            </div>
            <div className="speed-bot__stat">
              <label>Win Rate</label>
              <span>{winRate}%</span>
            </div>
            <div className="speed-bot__stat">
              <label>Total Profit</label>
              <span className={totalProfit >= 0 ? 'profit' : 'loss'}>
                ${totalProfit.toFixed(2)}
              </span>
            </div>
            <div className="speed-bot__stat">
              <label>Consecutive Losses</label>
              <span>{consecutiveLosses}</span>
            </div>
            <div className="speed-bot__stat">
              <label>Balance</label>
              <span>{client?.currency || 'USD'} {client?.balance ? parseFloat(client.balance).toFixed(2) : '0.00'}</span>
            </div>
          </div>
        </div>

        {/* Trade History */}
        <div className="speed-bot__history">
          <h3>Trade History</h3>
          <div className="speed-bot__trades">
            {tradeHistory.length === 0 ? (
              <div className="speed-bot__no-trades">No trades yet</div>
            ) : (
              tradeHistory.map((trade) => (
                <div key={trade.id} className={`speed-bot__trade ${trade.result}`}>
                  <div className="speed-bot__trade-info">
                    <span className="speed-bot__trade-time">{trade.timestamp}</span>
                    <span className="speed-bot__trade-symbol">{trade.symbol}</span>
                    <span className="speed-bot__trade-type">{trade.contractType}</span>
                    {trade.prediction && (
                      <span className="speed-bot__trade-prediction">Prediction: {trade.prediction}</span>
                    )}
                  </div>
                  <div className="speed-bot__trade-result">
                    <span className="speed-bot__trade-stake">${trade.stake.toFixed(2)}</span>
                    <span className="speed-bot__trade-status">
                      {trade.result === 'win' ? '✅ WIN' : trade.result === 'loss' ? '❌ LOSS' : '⏳ PENDING'}
                    </span>
                    <span className="speed-bot__trade-profit">
                      {trade.profit !== 0 ? (trade.profit >= 0 ? '+$' : '-$') + Math.abs(trade.profit).toFixed(2) : '---'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default SpeedBot;