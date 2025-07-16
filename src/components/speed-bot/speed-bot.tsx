import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
import './speed-bot.scss';

interface Trade {
  id: string;
  timestamp: string;
  symbol: string;
  contractType: string;
  result: 'win' | 'loss' | 'pending';
  stake: number;
  profit: number;
}

const SpeedBot: React.FC = observer(() => {
  const store = useStore();
  const run_panel = store?.run_panel;
  const client = store?.client;

  // State management
  const [isConnected, setIsConnected] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string>('---');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trading configuration
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [selectedContractType, setSelectedContractType] = useState('DIGITEVEN');
  const [stake, setStake] = useState(1.0);
  const [overUnderValue, setOverUnderValue] = useState(5);
  const [isTrading, setIsTrading] = useState(false);

  // Trading state
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [isExecutingTrade, setIsExecutingTrade] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);

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
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITDIFF', label: 'Differs' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
  ];

  // Get authentication token
  const getAuthToken = useCallback(() => {
    try {
      if (!client?.is_logged_in) {
        return null;
      }

      // Try multiple token sources
      if (client.getToken && typeof client.getToken === 'function') {
        try {
          const token = client.getToken();
          if (token && token.length > 20) return token;
        } catch (e) {
          console.log('Error getting token from client.getToken:', e);
        }
      }

      if (client.token && client.token.length > 20) {
        return client.token;
      }

      // Try localStorage
      try {
        const stored = localStorage.getItem('client.tokens');
        if (stored) {
          const parsed = JSON.parse(stored);
          const loginid = client.loginid || Object.keys(parsed)[0];
          if (loginid && parsed[loginid]) {
            return parsed[loginid];
          }
        }
      } catch (e) {
        console.log('Error reading from localStorage:', e);
      }

      return null;
    } catch (error) {
      console.error('Error in getAuthToken:', error);
      return null;
    }
  }, [client]);

  // WebSocket connection
  const connectToAPI = useCallback(() => {
    try {
      if (websocket?.readyState === WebSocket.OPEN) {
        return; // Already connected
      }

      if (websocket) {
        websocket.close();
      }

      setError(null);
      setIsConnected(false);
      setIsAuthorized(false);

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setWebsocket(ws);

        // Try to authorize
        const authToken = getAuthToken();
        if (authToken) {
          try {
            ws.send(JSON.stringify({
              authorize: authToken,
              req_id: Date.now()
            }));
          } catch (error) {
            console.error('Error sending auth:', error);
          }
        }

        // Subscribe to ticks
        try {
          ws.send(JSON.stringify({
            ticks: selectedSymbol,
            subscribe: 1,
            req_id: Date.now() + 1000
          }));
        } catch (error) {
          console.error('Error subscribing to ticks:', error);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            console.error('WebSocket error:', data.error);
            setError(data.error.message);
            return;
          }

          // Handle authorization
          if (data.authorize) {
            console.log('Authorized');
            setIsAuthorized(true);
            setError(null);
          }

          // Handle ticks
          if (data.tick) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));
          }

          // Handle proposal
          if (data.proposal && data.proposal.id) {
            console.log('Proposal received:', data.proposal.id);
            setProposalId(data.proposal.id);

            // Auto-buy if trading
            if (isTrading && !isExecutingTrade) {
              setIsExecutingTrade(true);
              buyContract(data.proposal.id, ws);
            }
          }

          // Handle buy response
          if (data.buy) {
            console.log('Contract purchased:', data.buy.contract_id);
            setIsExecutingTrade(false);
            setProposalId(null);

            const trade: Trade = {
              id: data.buy.contract_id || `trade_${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              symbol: selectedSymbol,
              contractType: selectedContractType,
              result: 'pending',
              stake: parseFloat(data.buy.buy_price || stake),
              profit: 0,
            };

            setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
            setTotalTrades(prev => prev + 1);

            // Subscribe to contract updates
            if (data.buy.contract_id) {
              try {
                ws.send(JSON.stringify({
                  proposal_open_contract: 1,
                  contract_id: data.buy.contract_id,
                  subscribe: 1,
                  req_id: Date.now() + 2000
                }));
              } catch (error) {
                console.error('Error subscribing to contract:', error);
              }
            }

            // Get next proposal
            if (isTrading) {
              setTimeout(() => {
                if (isTrading && !isExecutingTrade) {
                  getPriceProposal(ws);
                }
              }, 1000);
            }
          }

          // Handle contract updates
          if (data.proposal_open_contract) {
            const contract = data.proposal_open_contract;
            if (contract.is_sold || contract.status === 'sold') {
              const profit = parseFloat(contract.profit || 0);
              const isWin = profit > 0;

              setTradeHistory(prev => {
                const updated = [...prev];
                if (updated[0] && updated[0].result === 'pending') {
                  updated[0].result = isWin ? 'win' : 'loss';
                  updated[0].profit = profit;
                }
                return updated;
              });

              if (isWin) {
                setWins(prev => prev + 1);
              } else {
                setLosses(prev => prev + 1);
              }
            }
          }

        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        setIsAuthorized(false);
        setWebsocket(null);

        // Auto-reconnect if trading
        if (isTrading) {
          setTimeout(connectToAPI, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Connection failed');
      };

    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setError('Failed to create connection');
    }
  }, [selectedSymbol, isTrading, getAuthToken]);

  // Get price proposal
  const getPriceProposal = useCallback((ws: WebSocket) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isAuthorized || isExecutingTrade) {
      return;
    }

    try {
      const proposalRequest = {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: selectedContractType,
        currency: 'USD',
        symbol: selectedSymbol,
        duration: 1,
        duration_unit: 't',
        req_id: Date.now()
      };

      // Add barrier if needed
      if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      }

      ws.send(JSON.stringify(proposalRequest));
    } catch (error) {
      console.error('Error sending proposal:', error);
    }
  }, [stake, selectedContractType, selectedSymbol, overUnderValue, isAuthorized, isExecutingTrade]);

  // Buy contract
  const buyContract = useCallback((proposalId: string, ws: WebSocket) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !proposalId) {
      setIsExecutingTrade(false);
      return;
    }

    try {
      ws.send(JSON.stringify({
        buy: proposalId,
        req_id: Date.now()
      }));
    } catch (error) {
      console.error('Error buying contract:', error);
      setIsExecutingTrade(false);
    }
  }, []);

  // Start trading
  const startTrading = useCallback(() => {
    const authToken = getAuthToken();
    if (!authToken) {
      setError('Please log in to Deriv first');
      return;
    }

    if (!isConnected || !isAuthorized) {
      setError('Please wait for connection to be established');
      return;
    }

    setIsTrading(true);
    setError(null);

    // Start with first proposal
    if (websocket) {
      setTimeout(() => {
        getPriceProposal(websocket);
      }, 1000);
    }
  }, [getAuthToken, isConnected, isAuthorized, websocket, getPriceProposal]);

  // Stop trading
  const stopTrading = useCallback(() => {
    setIsTrading(false);
    setIsExecutingTrade(false);
    setProposalId(null);
  }, []);

  // Reset stats
  const resetStats = useCallback(() => {
    setTradeHistory([]);
    setTotalTrades(0);
    setWins(0);
    setLosses(0);
    setError(null);
  }, []);

  // Initialize connection
  useEffect(() => {
    try {
      connectToAPI();
    } catch (error) {
      console.error('Error initializing connection:', error);
      setError('Failed to initialize');
    }

    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [connectToAPI]);

  // Remove the undefined setCurrentStake function call

  // Error boundary fallback
  if (!run_panel) {
    return (
      <div className="speed-bot">
        <div className="speed-bot__error">
          <h3>Speed Bot Loading...</h3>
          <p>Please wait while the Speed Bot initializes...</p>
        </div>
      </div>
    );
  }

  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';

  return (
    <div className="speed-bot">
      <div className="speed-bot__header">
        <div className="speed-bot__title">
          <span className="speed-bot__icon">⚡</span>
          <span>Speed Bot</span>
        </div>
        <div className="speed-bot__nav">
          <button className="speed-bot__nav-item active">Signals</button>
          <button className="speed-bot__nav-item">Automated</button>
        </div>
      </div>

      <div className="speed-bot__subtitle">
        DIRECT WEBSOCKET TRADING
      </div>

      <div className="speed-bot__description">
        <strong>Engine Used:</strong> { 'Direct WebSocket API' }
        <br />
        Uses direct WebSocket connection to Deriv API for fast trade execution.
        <br />
        <strong>This uses real money!</strong>
        { <span style={{ color: 'green' }}> 🌐 Direct Trading Active</span>}
      </div>

      {error && (
        <div className="speed-bot__error-message">
          <p style={{ color: 'red', padding: '10px', backgroundColor: '#ffe6e6', borderRadius: '4px', margin: '10px 0' }}>
            <strong>Error:</strong> {error}
          </p>
        </div>
      )}

      {!client?.is_logged_in && (
        <div className="speed-bot__login-warning">
          <p style={{ color: 'orange', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '4px', margin: '10px 0' }}>
            <strong>⚠️ Not Logged In:</strong> Please go to <a href="https://deriv.com" target="_blank" rel="noopener noreferrer">deriv.com</a> and sign in to your account first, then refresh this page.
          </p>
        </div>
      )}

      {client?.is_logged_in && (
        <div className="speed-bot__account-info">
          <p style={{ color: client?.is_virtual ? 'blue' : 'green', padding: '10px', backgroundColor: client?.is_virtual ? '#e3f2fd' : '#e8f5e8', borderRadius: '4px', margin: '10px 0' }}>
            <strong>🔗 Account Type:</strong> {client?.is_virtual ? 'Demo Account (Virtual Money)' : 'Real Account (Real Money)'} 
            {!client?.is_virtual && <span style={{ color: 'red', fontWeight: 'bold' }}> - Trades will use real money!</span>}
          </p>
        </div>
      )}

      {isConnected && !isAuthorized && client?.is_logged_in && (
        <div className="speed-bot__auth-warning">
          <p style={{ color: 'blue', padding: '10px', backgroundColor: '#d1ecf1', borderRadius: '4px', margin: '10px 0' }}>
            <strong>🔐 Authorizing:</strong> Please wait while we authorize your connection...
          </p>
        </div>
      )}

      <div className="speed-bot__form">
        <div className="speed-bot__form-row">
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
            <label>Contract Type</label>
            <select 
              value={selectedContractType} 
              onChange={(e) => setSelectedContractType(e.target.value)}
              disabled={isTrading}
            >
              {contractTypes.map(contract => (
                <option key={contract.value} value={contract.value}>
                  {contract.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="speed-bot__form-row">
          <div className="speed-bot__form-group">
            <label>Stake</label>
            <div className="speed-bot__stake-input">
              <input
                type="number"
                value={stake}
                onChange={(e) => setStake(parseFloat(e.target.value))}
                min="0.35"
                step="0.01"
                disabled={isTrading}
              />
              <span className="speed-bot__currency">USD</span>
            </div>
          </div>
          <div className="speed-bot__form-group">
            <label>
              {['DIGITOVER', 'DIGITUNDER'].includes(selectedContractType) ? 'Barrier Value' : 
               ['DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType) ? 'Match Value' : 
               'Prediction Value'}
            </label>
            <input
              type="number"
              value={overUnderValue}
              onChange={(e) => setOverUnderValue(parseInt(e.target.value))}
              min="0"
              max="9"
              disabled={isTrading || ['DIGITEVEN', 'DIGITODD'].includes(selectedContractType)}
              placeholder={['DIGITEVEN', 'DIGITODD'].includes(selectedContractType) ? 'N/A' : '0-9'}
            />
          </div>
        </div>

        <div className="speed-bot__form-row">
          <div className="speed-bot__form-group">
            <label>Ticks</label>
            <input type="number" value="1" readOnly />
          </div>
          <div className="speed-bot__form-group">
            <label>Duration</label>
            <input type="number" value="1" readOnly />
          </div>
        </div>

        <div className="speed-bot__form-row">
          <div className="speed-bot__form-group">
            <label>Run Profit %</label>
            <input type="number" defaultValue="2" />
          </div>
        </div>

        <div className="speed-bot__control-buttons">
          {!isTrading ? (
            <button 
              className="speed-bot__start-btn"
              onClick={startTrading}
              disabled={!!error || !client?.is_logged_in}
            >
              START DIRECT TRADING
            </button>
          ) : (
            <button 
              className="speed-bot__stop-btn"
              onClick={stopTrading}
            >
              STOP TRADING
            </button>
          )}
          <button 
            className="speed-bot__reset-btn"
            onClick={resetStats}
            disabled={isTrading}
          >
            Reset Stats
          </button>
        </div>
      </div>

      <div className="speed-bot__stats">
        <div className="speed-bot__stats-grid">
          <div className="speed-bot__stat">
            <label>Connection</label>
            <span className={isConnected ? 'connected' : 'disconnected'}>
              {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
          </div>
          <div className="speed-bot__stat">
            <label>Current Price</label>
            <span>{currentPrice}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Balance</label>
            <span>{client?.currency || 'USD'} {client?.balance ? parseFloat(client.balance).toFixed(2) : '0.00'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Auth Status</label>
            <span>{isAuthorized ? '✅ Authorized' : '❌ Not Authorized'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Total Trades</label>
            <span>{totalTrades}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Win Rate</label>
            <span>{winRate}%</span>
          </div>
        </div>
      </div>

      <div className="speed-bot__history">
        <h3>Recent Trades & Transactions</h3>
        <div className="speed-bot__trades">
          {tradeHistory.length === 0 ? (
            <div className="speed-bot__no-trades">No trades yet - Start trading to see buy transactions</div>
          ) : (
            tradeHistory.map((trade) => (
              <div key={trade.id} className={`speed-bot__trade ${trade.result}`}>
                <div className="speed-bot__trade-row">
                  <span className="speed-bot__trade-time">{trade.timestamp}</span>
                  <span className="speed-bot__trade-id">ID: {trade.id.substring(0, 8)}...</span>
                </div>
                <div className="speed-bot__trade-row">
                  <span className="speed-bot__trade-symbol">{trade.symbol}</span>
                  <span className="speed-bot__trade-type">{trade.contractType}</span>
                  <span className="speed-bot__trade-stake">${trade.stake.toFixed(2)}</span>
                </div>
                <div className="speed-bot__trade-row">
                  <span className="speed-bot__trade-status">
                    {trade.result === 'win' ? '✅ WIN' : trade.result === 'loss' ? '❌ LOSS' : '⏳ PENDING'}
                  </span>
                  <span className="speed-bot__trade-profit">
                    {trade.profit !== 0 ? (trade.profit >= 0 ? '+$' : '-$') + Math.abs(trade.profit).toFixed(2) : '---'}
                  </span>
                </div>
                {trade.result === 'pending' && (
                  <div className="speed-bot__trade-pending">
                    🔄 Processing buy transaction...
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export default SpeedBot;