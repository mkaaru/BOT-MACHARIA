
import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import { tradingEngine } from '../volatility-analyzer/trading-engine';
import './speed-bot.scss';

interface TradeResult {
  id: string;
  timestamp: string;
  symbol: string;
  contractType: string;
  prediction: string;
  actual: string;
  result: 'win' | 'loss' | 'pending';
  stake: number;
  payout: number;
  profit: number;
  contractId?: string;
  tickValue?: number;
}

const SpeedBot: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');
  const [contractType, setContractType] = useState('DIGITEVEN');
  const [stakeAmount, setStakeAmount] = useState(1.0);
  const [isTrading, setIsTrading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<string>('---');
  const [currentTick, setCurrentTick] = useState<number | null>(null);
  const [totalTrades, setTotalTrades] = useState(0);
  const [winRate, setWinRate] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [tradeHistory, setTradeHistory] = useState<TradeResult[]>([]);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [pendingTrades, setPendingTrades] = useState<Set<string>>(new Set());
  
  // Enhanced features
  const [alternateEvenOdd, setAlternateEvenOdd] = useState(false);
  const [alternateOnLoss, setAlternateOnLoss] = useState(false);
  const [useMartingale, setUseMartingale] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2);
  const [totalProfitTarget, setTotalProfitTarget] = useState(10);
  const [lossThreshold, setLossThreshold] = useState(-10);
  const [overUnderBarrier, setOverUnderBarrier] = useState(5);
  const [matchDifferDigit, setMatchDifferDigit] = useState(5);
  
  // State management
  const [currentStake, setCurrentStake] = useState(1.0);
  const [lastTradeResult, setLastTradeResult] = useState<'win' | 'loss' | null>(null);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [currentEvenOddChoice, setCurrentEvenOddChoice] = useState<'DIGITEVEN' | 'DIGITODD'>('DIGITEVEN');

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

  const contractTypes = [
    { value: 'DIGITEVEN', label: 'Even', category: 'evenodd' },
    { value: 'DIGITODD', label: 'Odd', category: 'evenodd' },
    { value: 'DIGITOVER', label: 'Over', category: 'overunder' },
    { value: 'DIGITUNDER', label: 'Under', category: 'overunder' },
    { value: 'DIGITMATCH', label: 'Matches', category: 'matchdiffer' },
    { value: 'DIGITDIFF', label: 'Differs', category: 'matchdiffer' },
    { value: 'CALL', label: 'Rise', category: 'risefall' },
    { value: 'PUT', label: 'Fall', category: 'risefall' },
  ];

  const getContractCategory = (type: string) => {
    const contract = contractTypes.find(c => c.value === type);
    return contract?.category || 'other';
  };

  const getAlternateContract = (currentContract: string): string => {
    const alternates: { [key: string]: string } = {
      'DIGITEVEN': 'DIGITODD',
      'DIGITODD': 'DIGITEVEN',
      'DIGITOVER': 'DIGITUNDER',
      'DIGITUNDER': 'DIGITOVER',
      'DIGITMATCH': 'DIGITDIFF',
      'DIGITDIFF': 'DIGITMATCH',
      'CALL': 'PUT',
      'PUT': 'CALL',
    };
    return alternates[currentContract] || currentContract;
  };

  const connectToAPI = useCallback(async () => {
    try {
      if (websocket) {
        websocket.close();
        setWebsocket(null);
      }

      setCurrentPrice('Connecting...');
      setIsConnected(false);
      setIsAuthorized(false);

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      ws.onopen = () => {
        console.log('Speed Bot WebSocket connected');
        setIsConnected(true);
        setWebsocket(ws);
        setCurrentPrice('Connected - Checking authorization...');

        const apiToken = localStorage.getItem('dbot_api_token') || localStorage.getItem('authToken');
        if (apiToken) {
          console.log('🔑 Authorizing Speed Bot with API token for real trading');
          ws.send(JSON.stringify({
            authorize: apiToken,
            req_id: 'speed_bot_auth'
          }));
        } else {
          console.log('⚠️ No API token found - Speed Bot will run in simulation mode');
          setCurrentPrice('No authorization - Simulation mode');
          
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              const tickRequest = {
                ticks: selectedSymbol,
                subscribe: 1,
                req_id: 'speed_bot_ticks',
              };
              ws.send(JSON.stringify(tickRequest));
            }
          }, 500);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            console.error('Speed Bot API error:', data.error);
            setCurrentPrice(`Error: ${data.error.message}`);
            return;
          }

          if (data.authorize && data.req_id === 'speed_bot_auth') {
            console.log('✅ Speed Bot authorized for real trading');
            setIsAuthorized(true);
            setCurrentPrice('Authorized - Waiting for ticks...');
            
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                const tickRequest = {
                  ticks: selectedSymbol,
                  subscribe: 1,
                  req_id: 'speed_bot_ticks',
                };
                ws.send(JSON.stringify(tickRequest));
              }
            }, 500);
          }

          if (data.tick && data.tick.symbol === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));
            setCurrentTick(price);

            if (isTrading) {
              executeTradeOnTick(price);
            }
          }

          if (data.proposal_open_contract) {
            handleContractUpdate(data.proposal_open_contract);
          }

        } catch (error) {
          console.error('Error parsing Speed Bot message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Speed Bot WebSocket closed');
        setIsConnected(false);
        setIsAuthorized(false);
        setWebsocket(null);
        setCurrentPrice('Disconnected');
      };

      ws.onerror = (error) => {
        console.error('Speed Bot WebSocket error:', error);
        setIsConnected(false);
        setIsAuthorized(false);
        setCurrentPrice('Connection Error');
      };
    } catch (error) {
      console.error('Speed Bot connection failed:', error);
      setIsConnected(false);
      setIsAuthorized(false);
      setCurrentPrice('Failed to connect');
    }
  }, [selectedSymbol, isTrading]);

  const executeTradeOnTick = useCallback(async (tick: number) => {
    const lastDigit = Math.floor(Math.abs(tick * 100000)) % 10;
    
    // Determine which contract to use based on alternating settings
    let actualContractType = contractType;
    
    if (alternateEvenOdd && getContractCategory(contractType) === 'evenodd') {
      actualContractType = currentEvenOddChoice;
    } else if (alternateOnLoss && lastTradeResult === 'loss') {
      actualContractType = getAlternateContract(contractType);
    }

    let prediction: string;
    let shouldTrade = false;
    let actualResult: string;
    let barrier = overUnderBarrier;

    // Determine prediction and result based on contract type
    switch (actualContractType) {
      case 'DIGITEVEN':
        prediction = 'EVEN';
        actualResult = lastDigit % 2 === 0 ? 'EVEN' : 'ODD';
        shouldTrade = true;
        break;
      case 'DIGITODD':
        prediction = 'ODD';
        actualResult = lastDigit % 2 === 1 ? 'ODD' : 'EVEN';
        shouldTrade = true;
        break;
      case 'DIGITOVER':
        prediction = `OVER ${barrier}`;
        actualResult = lastDigit > barrier ? `OVER ${barrier}` : `UNDER ${barrier}`;
        shouldTrade = true;
        break;
      case 'DIGITUNDER':
        prediction = `UNDER ${barrier}`;
        actualResult = lastDigit < barrier ? `UNDER ${barrier}` : `OVER ${barrier}`;
        shouldTrade = true;
        break;
      case 'DIGITMATCH':
        prediction = `MATCHES ${matchDifferDigit}`;
        actualResult = lastDigit === matchDifferDigit ? `MATCHES ${matchDifferDigit}` : `DIFFERS ${matchDifferDigit}`;
        shouldTrade = true;
        break;
      case 'DIGITDIFF':
        prediction = `DIFFERS ${matchDifferDigit}`;
        actualResult = lastDigit !== matchDifferDigit ? `DIFFERS ${matchDifferDigit}` : `MATCHES ${matchDifferDigit}`;
        shouldTrade = true;
        break;
      case 'CALL':
        prediction = 'RISE';
        // For rise/fall, we'll compare with previous tick (simplified)
        actualResult = Math.random() > 0.5 ? 'RISE' : 'FALL'; // Simplified for demo
        shouldTrade = true;
        break;
      case 'PUT':
        prediction = 'FALL';
        actualResult = Math.random() > 0.5 ? 'FALL' : 'RISE'; // Simplified for demo
        shouldTrade = true;
        break;
      default:
        return;
    }

    if (shouldTrade && !pendingTrades.has(actualContractType)) {
      if (isAuthorized && tradingEngine.isEngineConnected()) {
        // Execute real trade through trading engine
        try {
          setPendingTrades(prev => new Set(prev).add(actualContractType));
          
          console.log(`🚀 Executing real ${actualContractType} trade on ${selectedSymbol} with stake ${currentStake}`);
          
          const proposalRequest: any = {
            amount: currentStake,
            basis: 'stake',
            contract_type: actualContractType,
            currency: 'USD',
            symbol: selectedSymbol,
            duration: 1,
            duration_unit: 't'
          };

          // Add barriers for specific contract types
          if (actualContractType === 'DIGITOVER' || actualContractType === 'DIGITUNDER') {
            proposalRequest.barrier = barrier;
          } else if (actualContractType === 'DIGITMATCH' || actualContractType === 'DIGITDIFF') {
            proposalRequest.barrier = matchDifferDigit;
          }

          const proposalResponse = await tradingEngine.getProposal(proposalRequest);
          
          if (proposalResponse.proposal) {
            const purchaseResponse = await tradingEngine.buyContract(
              proposalResponse.proposal.id,
              proposalResponse.proposal.ask_price
            );

            if (purchaseResponse.buy) {
              const trade: TradeResult = {
                id: `real_trade_${Date.now()}`,
                timestamp: new Date().toLocaleTimeString(),
                symbol: selectedSymbol,
                contractType: actualContractType,
                prediction,
                actual: 'PENDING',
                result: 'pending',
                stake: currentStake,
                payout: 0,
                profit: 0,
                contractId: purchaseResponse.buy.contract_id,
                tickValue: lastDigit,
              };

              setTradeHistory(prev => [trade, ...prev.slice(0, 49)]);
              setTotalTrades(prev => prev + 1);
              
              console.log(`✅ Real trade executed - Contract ID: ${purchaseResponse.buy.contract_id}`);
            }
          }
        } catch (error) {
          console.error('❌ Real trade failed:', error);
          executeSimulatedTrade(actualContractType, prediction, actualResult, lastDigit);
        } finally {
          setPendingTrades(prev => {
            const newSet = new Set(prev);
            newSet.delete(actualContractType);
            return newSet;
          });
        }
      } else {
        // Execute simulated trade
        executeSimulatedTrade(actualContractType, prediction, actualResult, lastDigit);
      }

      // Update alternating logic for even/odd
      if (alternateEvenOdd && getContractCategory(contractType) === 'evenodd') {
        setCurrentEvenOddChoice(prev => prev === 'DIGITEVEN' ? 'DIGITODD' : 'DIGITEVEN');
      }
    }
  }, [contractType, selectedSymbol, currentStake, isAuthorized, pendingTrades, alternateEvenOdd, alternateOnLoss, lastTradeResult, currentEvenOddChoice, overUnderBarrier, matchDifferDigit]);

  const executeSimulatedTrade = useCallback((actualContractType: string, prediction: string, actualResult: string, tickValue: number) => {
    const isWin = prediction === actualResult;
    const payout = isWin ? currentStake * 1.95 : 0;
    const profit = payout - currentStake;

    const trade: TradeResult = {
      id: `sim_trade_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      symbol: selectedSymbol,
      contractType: actualContractType,
      prediction,
      actual: actualResult,
      result: isWin ? 'win' : 'loss',
      stake: currentStake,
      payout,
      profit,
      tickValue,
    };

    setTradeHistory(prev => [trade, ...prev.slice(0, 49)]);
    setTotalTrades(prev => prev + 1);
    setTotalProfit(prev => prev + profit);
    setLastTradeResult(isWin ? 'win' : 'loss');

    // Handle martingale strategy
    if (useMartingale) {
      if (isWin) {
        setCurrentStake(stakeAmount); // Reset to original stake
        setConsecutiveLosses(0);
      } else {
        setConsecutiveLosses(prev => prev + 1);
        setCurrentStake(prev => prev * martingaleMultiplier);
      }
    }

    // Update win rate
    setWinRate(prev => {
      const newTotal = totalTrades + 1;
      const wins = tradeHistory.filter(t => t.result === 'win').length + (isWin ? 1 : 0);
      return (wins / newTotal) * 100;
    });

    // Check profit/loss thresholds
    const newTotalProfit = totalProfit + profit;
    if (newTotalProfit >= totalProfitTarget || newTotalProfit <= lossThreshold) {
      console.log(`🛑 Stopping trading - Profit threshold reached: ${newTotalProfit}`);
      setIsTrading(false);
    }
  }, [selectedSymbol, currentStake, totalTrades, tradeHistory, totalProfit, useMartingale, stakeAmount, martingaleMultiplier, totalProfitTarget, lossThreshold]);

  const handleContractUpdate = useCallback((contract: any) => {
    if (contract.contract_id) {
      setTradeHistory(prev => prev.map(trade => {
        if (trade.contractId === contract.contract_id) {
          const isWin = contract.status === 'won';
          const payout = contract.payout || 0;
          const profit = payout - trade.stake;
          
          // Update martingale based on real trade result
          if (useMartingale) {
            if (isWin) {
              setCurrentStake(stakeAmount);
              setConsecutiveLosses(0);
            } else {
              setConsecutiveLosses(prev => prev + 1);
              setCurrentStake(prev => prev * martingaleMultiplier);
            }
          }
          
          setLastTradeResult(isWin ? 'win' : 'loss');
          
          return {
            ...trade,
            actual: contract.status === 'won' ? trade.prediction : getOppositeResult(trade.prediction),
            result: isWin ? 'win' : 'loss',
            payout,
            profit,
          };
        }
        return trade;
      }));

      const updatedTrade = tradeHistory.find(t => t.contractId === contract.contract_id);
      if (updatedTrade && contract.status) {
        const profit = (contract.payout || 0) - updatedTrade.stake;
        setTotalProfit(prev => prev + profit);
        
        const isWin = contract.status === 'won';
        setWinRate(prev => {
          const wins = tradeHistory.filter(t => t.result === 'win').length + (isWin ? 1 : 0);
          return (wins / totalTrades) * 100;
        });

        // Check thresholds
        const newTotalProfit = totalProfit + profit;
        if (newTotalProfit >= totalProfitTarget || newTotalProfit <= lossThreshold) {
          console.log(`🛑 Stopping trading - Threshold reached: ${newTotalProfit}`);
          setIsTrading(false);
        }
      }
    }
  }, [tradeHistory, totalTrades, totalProfit, useMartingale, stakeAmount, martingaleMultiplier, totalProfitTarget, lossThreshold]);

  const getOppositeResult = (prediction: string): string => {
    const opposites: { [key: string]: string } = {
      'EVEN': 'ODD',
      'ODD': 'EVEN',
      'RISE': 'FALL',
      'FALL': 'RISE',
    };
    
    if (prediction.includes('OVER')) return prediction.replace('OVER', 'UNDER');
    if (prediction.includes('UNDER')) return prediction.replace('UNDER', 'OVER');
    if (prediction.includes('MATCHES')) return prediction.replace('MATCHES', 'DIFFERS');
    if (prediction.includes('DIFFERS')) return prediction.replace('DIFFERS', 'MATCHES');
    
    return opposites[prediction] || prediction;
  };

  const startTrading = () => {
    if (!isConnected) {
      alert('Please connect to the API first');
      return;
    }
    
    if (!isAuthorized) {
      const confirmSimulation = window.confirm(
        'You are not authorized for real trading. Do you want to continue in simulation mode?'
      );
      if (!confirmSimulation) return;
    }
    
    // Reset martingale state
    setCurrentStake(stakeAmount);
    setConsecutiveLosses(0);
    setLastTradeResult(null);
    
    setIsTrading(true);
  };

  const stopTrading = () => {
    setIsTrading(false);
    setPendingTrades(new Set());
  };

  const resetStats = () => {
    setTotalTrades(0);
    setWinRate(0);
    setTotalProfit(0);
    setTradeHistory([]);
    setCurrentStake(stakeAmount);
    setConsecutiveLosses(0);
    setLastTradeResult(null);
  };

  useEffect(() => {
    connectToAPI();
    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [selectedSymbol]);

  useEffect(() => {
    setCurrentStake(stakeAmount);
  }, [stakeAmount]);

  return (
    <div className="speed-bot">
      <div className="speed-bot__header">
        <h2 className="speed-bot__title">
          <Localize i18n_default_text="Speed Bot - Enhanced Real Money Trading" />
        </h2>
        <div className="speed-bot__status-group">
          <div className={`speed-bot__status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
          <div className={`speed-bot__status ${isAuthorized ? 'authorized' : 'unauthorized'}`}>
            {isAuthorized ? '🔑 Real Trading' : '⚠️ Simulation Mode'}
          </div>
        </div>
      </div>

      <div className="speed-bot__controls">
        <div className="speed-bot__control-row">
          <div className="speed-bot__control-group">
            <label>
              <Localize i18n_default_text="Symbol:" />
            </label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              disabled={isTrading}
              className="speed-bot__select"
            >
              {volatilitySymbols.map((symbol) => (
                <option key={symbol.value} value={symbol.value}>
                  {symbol.label}
                </option>
              ))}
            </select>
          </div>

          <div className="speed-bot__control-group">
            <label>
              <Localize i18n_default_text="Contract Type:" />
            </label>
            <select
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              disabled={isTrading}
              className="speed-bot__select"
            >
              {contractTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div className="speed-bot__control-group">
            <label>
              <Localize i18n_default_text="Initial Stake:" />
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(parseFloat(e.target.value))}
              disabled={isTrading}
              className="speed-bot__input"
            />
          </div>
        </div>

        {/* Contract-specific controls */}
        {(contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') && (
          <div className="speed-bot__control-row">
            <div className="speed-bot__control-group">
              <label>
                <Localize i18n_default_text="Barrier:" />
              </label>
              <input
                type="number"
                min="0"
                max="9"
                value={overUnderBarrier}
                onChange={(e) => setOverUnderBarrier(parseInt(e.target.value))}
                disabled={isTrading}
                className="speed-bot__input"
              />
            </div>
          </div>
        )}

        {(contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') && (
          <div className="speed-bot__control-row">
            <div className="speed-bot__control-group">
              <label>
                <Localize i18n_default_text="Target Digit:" />
              </label>
              <input
                type="number"
                min="0"
                max="9"
                value={matchDifferDigit}
                onChange={(e) => setMatchDifferDigit(parseInt(e.target.value))}
                disabled={isTrading}
                className="speed-bot__input"
              />
            </div>
          </div>
        )}

        {/* Strategy controls */}
        <div className="speed-bot__strategy-controls">
          <div className="speed-bot__control-row">
            <div className="speed-bot__control-group">
              <label className="speed-bot__checkbox-label">
                <input
                  type="checkbox"
                  checked={alternateEvenOdd}
                  onChange={(e) => setAlternateEvenOdd(e.target.checked)}
                  disabled={isTrading || getContractCategory(contractType) !== 'evenodd'}
                />
                <Localize i18n_default_text="Alternate Even/Odd" />
              </label>
            </div>

            <div className="speed-bot__control-group">
              <label className="speed-bot__checkbox-label">
                <input
                  type="checkbox"
                  checked={alternateOnLoss}
                  onChange={(e) => setAlternateOnLoss(e.target.checked)}
                  disabled={isTrading}
                />
                <Localize i18n_default_text="Alternate on Loss" />
              </label>
            </div>

            <div className="speed-bot__control-group">
              <label className="speed-bot__checkbox-label">
                <input
                  type="checkbox"
                  checked={useMartingale}
                  onChange={(e) => setUseMartingale(e.target.checked)}
                  disabled={isTrading}
                />
                <Localize i18n_default_text="Use Martingale" />
              </label>
            </div>
          </div>

          {useMartingale && (
            <div className="speed-bot__control-row">
              <div className="speed-bot__control-group">
                <label>
                  <Localize i18n_default_text="Martingale Multiplier:" />
                </label>
                <input
                  type="number"
                  min="1.1"
                  step="0.1"
                  value={martingaleMultiplier}
                  onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value))}
                  disabled={isTrading}
                  className="speed-bot__input"
                />
              </div>
            </div>
          )}

          <div className="speed-bot__control-row">
            <div className="speed-bot__control-group">
              <label>
                <Localize i18n_default_text="Profit Target:" />
              </label>
              <input
                type="number"
                step="0.01"
                value={totalProfitTarget}
                onChange={(e) => setTotalProfitTarget(parseFloat(e.target.value))}
                disabled={isTrading}
                className="speed-bot__input"
              />
            </div>

            <div className="speed-bot__control-group">
              <label>
                <Localize i18n_default_text="Loss Threshold:" />
              </label>
              <input
                type="number"
                step="0.01"
                value={lossThreshold}
                onChange={(e) => setLossThreshold(parseFloat(e.target.value))}
                disabled={isTrading}
                className="speed-bot__input"
              />
            </div>
          </div>
        </div>

        <div className="speed-bot__action-buttons">
          {!isTrading ? (
            <button
              onClick={startTrading}
              disabled={!isConnected}
              className="speed-bot__button speed-bot__button--start"
            >
              <Localize i18n_default_text="Start Trading" />
            </button>
          ) : (
            <button
              onClick={stopTrading}
              className="speed-bot__button speed-bot__button--stop"
            >
              <Localize i18n_default_text="Stop Trading" />
            </button>
          )}
          <button
            onClick={resetStats}
            disabled={isTrading}
            className="speed-bot__button speed-bot__button--reset"
          >
            <Localize i18n_default_text="Reset Stats" />
          </button>
        </div>
      </div>

      <div className="speed-bot__stats">
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Current Price</div>
          <div className="speed-bot__stat-value">{currentPrice}</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Current Stake</div>
          <div className="speed-bot__stat-value">{currentStake.toFixed(2)}</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Total Trades</div>
          <div className="speed-bot__stat-value">{totalTrades}</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Win Rate</div>
          <div className="speed-bot__stat-value">{winRate.toFixed(1)}%</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Total P&L</div>
          <div className={`speed-bot__stat-value ${totalProfit >= 0 ? 'profit' : 'loss'}`}>
            {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
          </div>
        </div>
        {useMartingale && (
          <div className="speed-bot__stat-card">
            <div className="speed-bot__stat-label">Consecutive Losses</div>
            <div className="speed-bot__stat-value">{consecutiveLosses}</div>
          </div>
        )}
      </div>

      {!isAuthorized && (
        <div className="speed-bot__warning">
          <p>⚠️ <strong>Running in simulation mode.</strong> Log in via OAuth to enable real money trading.</p>
        </div>
      )}

      <div className="speed-bot__history">
        <h3 className="speed-bot__history-title">
          <Localize i18n_default_text="Recent Trades" />
        </h3>
        <div className="speed-bot__history-list">
          {tradeHistory.length === 0 ? (
            <div className="speed-bot__no-trades">
              <Localize i18n_default_text="No trades yet" />
            </div>
          ) : (
            tradeHistory.slice(0, 10).map((trade) => (
              <div key={trade.id} className={`speed-bot__trade-item ${trade.result}`}>
                <div className="speed-bot__trade-time">{trade.timestamp}</div>
                <div className="speed-bot__trade-details">
                  {trade.contractType} - {trade.prediction} vs {trade.actual}
                  {trade.tickValue !== undefined && <span className="speed-bot__tick-value"> (Tick: {trade.tickValue})</span>}
                  {trade.contractId && <span className="speed-bot__real-trade"> (REAL)</span>}
                  <span className="speed-bot__stake"> Stake: {trade.stake.toFixed(2)}</span>
                </div>
                <div className={`speed-bot__trade-result ${trade.result}`}>
                  {trade.result === 'win' ? '✅' : trade.result === 'loss' ? '❌' : '⏳'} {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SpeedBot;
