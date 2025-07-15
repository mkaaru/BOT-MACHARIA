
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
  result: 'win' | 'loss';
  stake: number;
  payout: number;
  profit: number;
  contractId?: string;
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
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
  ];

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

        // Check for OAuth token and authorize if available
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
          
          // Still subscribe to ticks for simulation
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

          // Handle authorization response
          if (data.authorize && data.req_id === 'speed_bot_auth') {
            console.log('✅ Speed Bot authorized for real trading');
            setIsAuthorized(true);
            setCurrentPrice('Authorized - Waiting for ticks...');
            
            // Subscribe to ticks after authorization
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

          // Handle tick data
          if (data.tick && data.tick.symbol === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));
            setCurrentTick(price);

            if (isTrading) {
              executeTradeOnTick(price);
            }
          }

          // Handle contract updates
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
    let prediction: string;
    let shouldTrade = false;
    let actualResult: string;

    // Determine prediction based on contract type
    switch (contractType) {
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
        prediction = 'OVER';
        actualResult = lastDigit >= 5 ? 'OVER' : 'UNDER';
        shouldTrade = true;
        break;
      case 'DIGITUNDER':
        prediction = 'UNDER';
        actualResult = lastDigit < 5 ? 'UNDER' : 'OVER';
        shouldTrade = true;
        break;
      default:
        return;
    }

    if (shouldTrade && !pendingTrades.has(contractType)) {
      if (isAuthorized && tradingEngine.isEngineConnected()) {
        // Execute real trade through trading engine
        try {
          setPendingTrades(prev => new Set(prev).add(contractType));
          
          console.log(`🚀 Executing real ${contractType} trade on ${selectedSymbol}`);
          
          const proposalRequest = {
            amount: stakeAmount,
            basis: 'stake',
            contract_type: contractType,
            currency: 'USD',
            symbol: selectedSymbol,
            duration: 1,
            duration_unit: 't'
          };

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
                contractType,
                prediction,
                actual: 'PENDING',
                result: 'win', // Will be updated when contract settles
                stake: stakeAmount,
                payout: 0, // Will be updated when contract settles
                profit: 0, // Will be updated when contract settles
                contractId: purchaseResponse.buy.contract_id,
              };

              setTradeHistory(prev => [trade, ...prev.slice(0, 49)]);
              setTotalTrades(prev => prev + 1);
              
              console.log(`✅ Real trade executed - Contract ID: ${purchaseResponse.buy.contract_id}`);
            }
          }
        } catch (error) {
          console.error('❌ Real trade failed:', error);
          
          // Fallback to simulation for this trade
          executeSimulatedTrade(prediction, actualResult);
        } finally {
          setPendingTrades(prev => {
            const newSet = new Set(prev);
            newSet.delete(contractType);
            return newSet;
          });
        }
      } else {
        // Execute simulated trade
        executeSimulatedTrade(prediction, actualResult);
      }
    }
  }, [contractType, selectedSymbol, stakeAmount, isAuthorized, pendingTrades]);

  const executeSimulatedTrade = useCallback((prediction: string, actualResult: string) => {
    const isWin = prediction === actualResult;
    const payout = isWin ? stakeAmount * 1.95 : 0; // 95% payout for wins
    const profit = payout - stakeAmount;

    const trade: TradeResult = {
      id: `sim_trade_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      symbol: selectedSymbol,
      contractType,
      prediction,
      actual: actualResult,
      result: isWin ? 'win' : 'loss',
      stake: stakeAmount,
      payout,
      profit,
    };

    setTradeHistory(prev => [trade, ...prev.slice(0, 49)]);
    setTotalTrades(prev => prev + 1);
    setTotalProfit(prev => prev + profit);

    // Update win rate
    setWinRate(prev => {
      const newTotal = totalTrades + 1;
      const wins = tradeHistory.filter(t => t.result === 'win').length + (isWin ? 1 : 0);
      return (wins / newTotal) * 100;
    });
  }, [contractType, selectedSymbol, stakeAmount, totalTrades, tradeHistory]);

  const handleContractUpdate = useCallback((contract: any) => {
    if (contract.contract_id) {
      setTradeHistory(prev => prev.map(trade => {
        if (trade.contractId === contract.contract_id) {
          const isWin = contract.status === 'won';
          const payout = contract.payout || 0;
          const profit = payout - trade.stake;
          
          return {
            ...trade,
            actual: contract.status === 'won' ? trade.prediction : (trade.prediction === 'EVEN' ? 'ODD' : 'EVEN'),
            result: isWin ? 'win' : 'loss',
            payout,
            profit,
          };
        }
        return trade;
      }));

      // Update total profit for real trades
      const updatedTrade = tradeHistory.find(t => t.contractId === contract.contract_id);
      if (updatedTrade && contract.status) {
        const profit = (contract.payout || 0) - updatedTrade.stake;
        setTotalProfit(prev => prev + profit);
        
        // Update win rate
        const isWin = contract.status === 'won';
        setWinRate(prev => {
          const wins = tradeHistory.filter(t => t.result === 'win').length + (isWin ? 1 : 0);
          return (wins / totalTrades) * 100;
        });
      }
    }
  }, [tradeHistory, totalTrades]);

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
  };

  useEffect(() => {
    connectToAPI();
    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [selectedSymbol]);

  return (
    <div className="speed-bot">
      <div className="speed-bot__header">
        <h2 className="speed-bot__title">
          <Localize i18n_default_text="Speed Bot - Real Money Trading" />
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
              <Localize i18n_default_text="Stake Amount:" />
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
                  {trade.contractId && <span className="speed-bot__real-trade"> (REAL)</span>}
                </div>
                <div className={`speed-bot__trade-result ${trade.result}`}>
                  {trade.result === 'win' ? '✅' : '❌'} {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
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
