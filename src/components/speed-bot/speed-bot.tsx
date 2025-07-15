
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
  const blockly_store = store?.blockly_store;
  const client = store?.client;

  // Early return if required stores are not available
  if (!run_panel || !client) {
    return (
      <div className="speed-bot">
        <div className="speed-bot__error">
          <h3>Speed Bot Unavailable</h3>
          <p>Required services are not available. Please ensure you are logged in and try again.</p>
        </div>
      </div>
    );
  }

  // Get token from client store
  const getAuthToken = () => {
    if (client?.is_logged_in) {
      const token = client.getToken ? client.getToken() : null;
      return token;
    }
    return null;
  };
  
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string>('---');

  // Trading configuration
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [selectedContractType, setSelectedContractType] = useState('DIGITOVER');
  const [stake, setStake] = useState(1.0);
  const [overUnderValue, setOverUnderValue] = useState(5);
  const [isTrading, setIsTrading] = useState(false);

  // Strategy options
  const [alternateOverUnder, setAlternateOverUnder] = useState(false);
  const [alternateOnLoss, setAlternateOnLoss] = useState(false);
  const [useMartingale, setUseMartingale] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.5);

  // Trading state
  const [currentStake, setCurrentStake] = useState(1.0);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [lastTradeTime, setLastTradeTime] = useState(0);
  const [isExecutingTrade, setIsExecutingTrade] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Safe observer pattern implementation
  const createObserver = () => {
    const observers: { [key: string]: Array<(data: any) => void> } = {};
    
    return {
      register: (event: string, callback: (data: any) => void) => {
        if (!observers[event]) {
          observers[event] = [];
        }
        observers[event].push(callback);
      },
      emit: (event: string, data?: any) => {
        if (observers[event]) {
          observers[event].forEach(callback => {
            try {
              callback(data);
            } catch (error) {
              console.error('Observer callback error:', error);
            }
          });
        }
      },
      unregister: (event: string, callback?: (data: any) => void) => {
        if (observers[event]) {
          if (callback) {
            const index = observers[event].indexOf(callback);
            if (index > -1) {
              observers[event].splice(index, 1);
            }
          } else {
            observers[event] = [];
          }
        }
      }
    };
  };

  const localObserver = createObserver();

  // WebSocket connection
  const connectToAPI = useCallback(() => {
    try {
      if (websocket) {
        websocket.close();
        setWebsocket(null);
      }

      setError(null);
      console.log('🚀 Connecting to WebSocket API...');
      setIsConnected(false);

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      ws.onopen = () => {
        console.log('✅ WebSocket connection established');
        setIsConnected(true);
        setWebsocket(ws);

        // Authorize if user is logged in
        const authToken = getAuthToken();
        if (client?.is_logged_in && authToken) {
          console.log('🔐 Authorizing with token...');
          const authRequest = {
            authorize: authToken,
            req_id: Date.now() + 1000
          };
          ws.send(JSON.stringify(authRequest));
        } else {
          console.log('⚠️ No token available for authorization');
          console.log('Login status:', client?.is_logged_in);
          console.log('Token available:', !!authToken);
          setError('Please log in to start trading');
        }

        // Request tick history
        const tickRequest = {
          ticks_history: selectedSymbol,
          count: 120,
          end: 'latest',
          style: 'ticks',
          subscribe: 1,
          req_id: Date.now() + 2000
        };
        ws.send(JSON.stringify(tickRequest));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            console.error('WebSocket API error:', data.error);
            setError(data.error.message || 'API Error');
            return;
          }

          // Handle authorization response
          if (data.req_id && data.req_id >= Date.now() - 10000 && data.req_id <= Date.now() + 10000) {
            if (data.authorize) {
              console.log('✅ WebSocket authorized successfully', data.authorize);
              setError(null);
            } else if (data.error && data.error.code === 'InvalidToken') {
              console.error('❌ Authorization failed:', data.error);
              setError(`Authorization failed: ${data.error.message}`);
            }
          }

          // Handle tick history and other responses
          if (data.history) {
            console.log('📊 Tick history received');
          } else if (data.error && !data.authorize) {
            console.error('❌ API error:', data.error);
            setError(`API error: ${data.error.message}`);
          }

          if (data.tick && data.tick.symbol === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));

            // Execute trade on every tick when trading is active
            if (isTrading) {
              console.log('📈 New tick received:', price, 'Trading active:', isTrading);
              executeTradeOnTick(price);
            }
          }

          if (data.history && data.history.prices) {
            const lastPrice = parseFloat(data.history.prices[data.history.prices.length - 1]);
            setCurrentPrice(lastPrice.toFixed(5));
            console.log('📊 Historical price updated:', lastPrice);
          }
        } catch (error) {
          console.error('Error parsing message:', error);
          setError('Failed to parse server response');
        }
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        setIsConnected(false);
        setWebsocket(null);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        setError('Connection failed');
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setIsConnected(false);
      setError('Failed to create connection');
    }
  }, [selectedSymbol, isTrading]);

  // Generate trading strategy XML for bot builder
  const generateSpeedBotStrategy = useCallback(() => {
    let prediction = overUnderValue;
    let tradeType = selectedContractType;

    // Map contract types and set appropriate predictions
    switch (selectedContractType) {
      case 'DIGITOVER':
        tradeType = 'DIGITOVER';
        prediction = overUnderValue;
        break;
      case 'DIGITUNDER':
        tradeType = 'DIGITUNDER';
        prediction = overUnderValue;
        break;
      case 'DIGITEVEN':
        tradeType = 'DIGITEVEN';
        prediction = undefined; // Even/Odd doesn't use prediction
        break;
      case 'DIGITODD':
        tradeType = 'DIGITODD';
        prediction = undefined; // Even/Odd doesn't use prediction
        break;
      case 'DIGITMATCH':
        tradeType = 'DIGITMATCH';
        prediction = overUnderValue;
        break;
      case 'DIGITDIFF':
        tradeType = 'DIGITDIFF';
        prediction = overUnderValue;
        break;
      case 'CALL':
        tradeType = 'CALL';
        prediction = undefined;
        break;
      default:
        tradeType = 'DIGITOVER';
        prediction = overUnderValue;
    }

    const predictionBlock = prediction !== undefined ? `
    <value name="PREDICTION">
      <block type="math_number">
        <field name="NUM">${prediction}</field>
      </block>
    </value>` : '';

    const xmlStrategy = `
<xml xmlns="http://www.w3.org/1999/xhtml" collection="false">
  <block type="trade_definition_tradeoptions" id="trade_definition" x="0" y="0">
    <field name="MARKET">synthetic_index</field>
    <field name="UNDERLYING">${selectedSymbol}</field>
    <field name="TRADETYPE">${tradeType}</field>
    <field name="TYPE">ticks</field>
    <value name="DURATION">
      <block type="math_number">
        <field name="NUM">1</field>
      </block>
    </value>
    <value name="AMOUNT">
      <block type="math_number">
        <field name="NUM">${currentStake}</field>
      </block>
    </value>${predictionBlock}
  </block>
  <block type="before_purchase" x="0" y="200">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase">
        <field name="PURCHASE_LIST">${tradeType}</field>
      </block>
    </statement>
  </block>
  <block type="after_purchase" x="0" y="300">
    <statement name="AFTERPURCHASE_STACK">
      <block type="trade_again">
        <value name="CONDITION">
          <block type="logic_boolean">
            <field name="BOOL">FALSE</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
</xml>`;

    return xmlStrategy;
  }, [selectedSymbol, selectedContractType, currentStake, overUnderValue]);

  // Execute trade through Bot Builder's trading engine
  const executeTradeOnTick = useCallback(async (tick: number) => {
    if (!isTrading || isExecutingTrade) return;
    
    // Allow trades every 1 second to reduce API load
    const now = Date.now();
    if (now - lastTradeTime < 1000) return;

    // Check if user is still logged in
    const authToken = getAuthToken();
    if (!client?.is_logged_in || !authToken) {
      setError('Please log in to continue trading');
      setIsTrading(false);
      return;
    }

    // Check if blockly store and run panel are available
    if (!blockly_store || !run_panel) {
      setError('Bot Builder services not available');
      setIsTrading(false);
      return;
    }

    setIsExecutingTrade(true);
    setLastTradeTime(now);

    try {
      // Generate the trading strategy XML
      const strategyXML = generateSpeedBotStrategy();
      
      // Load the strategy into blockly workspace
      if (window.Blockly?.derivWorkspace) {
        try {
          // Clear existing workspace
          window.Blockly.derivWorkspace.clear();
          
          // Load the new strategy
          const xml = window.Blockly.Xml?.textToDom(strategyXML);
          if (xml) {
            window.Blockly.Xml?.domToWorkspace(xml, window.Blockly.derivWorkspace);
            console.log('✅ Strategy loaded into workspace');
          }
        } catch (error) {
          console.error('Error loading strategy to workspace:', error);
          throw new Error('Failed to load trading strategy');
        }
      } else {
        throw new Error('Blockly workspace not available');
      }

      // Use the run panel to execute the trade
      if (run_panel.is_running) {
        // Stop current run first
        await run_panel.onStopButtonClick();
        await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay
      }

      // Start the bot with the new strategy
      await run_panel.onRunButtonClick();
      
      // Track trade for UI
      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const trade: Trade = {
        id: tradeId,
        timestamp: new Date().toLocaleTimeString(),
        symbol: selectedSymbol,
        contractType: selectedContractType,
        result: 'pending',
        stake: currentStake,
        profit: 0,
      };

      setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
      setTotalTrades(prev => prev + 1);

      console.log(`🚀 Speed Bot trade initiated: ${selectedContractType} on ${selectedSymbol} - Stake: ${currentStake}`);

      // Listen for trade results from the bot engine
      const handleTradeResult = (result) => {
        if (result && result.contract) {
          const profit = parseFloat(result.profit) || 0;
          const isWin = profit > 0;
          
          setTradeHistory(prev => 
            prev.map(t => 
              t.id === tradeId 
                ? { ...t, result: isWin ? 'win' : 'loss', profit: profit }
                : t
            )
          );

          if (isWin) {
            setWins(prev => prev + 1);
          } else {
            setLosses(prev => prev + 1);
          }

          // Apply martingale strategy if enabled
          if (useMartingale && !isWin) {
            setCurrentStake(prev => prev * martingaleMultiplier);
          } else if (isWin) {
            setCurrentStake(stake); // Reset to original stake on win
          }

          console.log(`Contract ${tradeId} finished:`, isWin ? 'WIN' : 'LOSS', `Profit: ${profit}`);
        }
      };

      // Register for trade completion events
      if (localObserver) {
        localObserver.register('bot.trade_complete', handleTradeResult);
        
        // Clean up listener after some time
        setTimeout(() => {
          localObserver.unregister('bot.trade_complete', handleTradeResult);
        }, 30000); // 30 seconds timeout for trade completion
      }
      
    } catch (error) {
      console.error('Error executing trade through Bot Builder:', error);
      setError(`Trade error: ${error.message}`);
      
      // If it's an authentication error, stop trading
      if (error.message.includes('authorization') || error.message.includes('token')) {
        setIsTrading(false);
      }
      
    } finally {
      setIsExecutingTrade(false);
    }
  }, [selectedSymbol, selectedContractType, currentStake, overUnderValue, useMartingale, martingaleMultiplier, stake, blockly_store, run_panel, isTrading, isExecutingTrade, lastTradeTime, generateSpeedBotStrategy, localObserver]);

  const startTrading = async () => {
    if (!isConnected) {
      setError('Please connect to API first');
      return;
    }

    // Check if user is logged in and has token
    const authToken = getAuthToken();
    if (!client?.is_logged_in || !authToken) {
      setError('Please log in to start trading. Make sure you are authenticated with Deriv.');
      return;
    }

    // Check if user has sufficient balance
    if (client?.balance && parseFloat(client.balance) < stake) {
      setError('Insufficient balance');
      return;
    }

    // Check if Bot Builder services are available
    if (!blockly_store || !run_panel) {
      setError('Bot Builder services not available. Please try refreshing the page.');
      return;
    }

    setCurrentStake(stake);
    setIsTrading(true);
    setError(null);
    
    console.log('🚀 Speed Bot trading started using Bot Builder engine');
    console.log(`Trading ${selectedContractType} on ${selectedSymbol} with stake ${stake}`);
  };

  const stopTrading = () => {
    setIsTrading(false);
    console.log('🛑 Speed Bot trading stopped');
  };

  const resetStats = () => {
    setTradeHistory([]);
    setTotalTrades(0);
    setWins(0);
    setLosses(0);
    setCurrentStake(stake);
    setError(null);
  };

  useEffect(() => {
    try {
      connectToAPI();
    } catch (error) {
      console.error('Error in connectToAPI:', error);
      setError('Failed to initialize connection');
    }
    
    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [connectToAPI]);

  useEffect(() => {
    setCurrentStake(stake);
  }, [stake]);

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
        TRADE EVERY TICK
      </div>

      <div className="speed-bot__description">
        Execute trades on every tick without waiting for previous trades to close.
        <br />
        <strong>This uses real money!</strong>
      </div>

      {error && (
        <div className="speed-bot__error-message">
          <p style={{ color: 'red', padding: '10px', backgroundColor: '#ffe6e6', borderRadius: '4px' }}>
            Error: {error}
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
            <label>Over value (0)</label>
            <input
              type="number"
              value={overUnderValue}
              onChange={(e) => setOverUnderValue(parseInt(e.target.value))}
              min="0"
              max="9"
              disabled={isTrading}
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

        <div className="speed-bot__toggles">
          <div className="speed-bot__toggle-row">
            <label>Alternate Over and Under</label>
            <input
              type="checkbox"
              checked={alternateOverUnder}
              onChange={(e) => setAlternateOverUnder(e.target.checked)}
              disabled={isTrading}
            />
          </div>
          <div className="speed-bot__toggle-row">
            <label>Alternate on Loss</label>
            <input
              type="checkbox"
              checked={alternateOnLoss}
              onChange={(e) => setAlternateOnLoss(e.target.checked)}
              disabled={isTrading}
            />
          </div>
          <div className="speed-bot__toggle-row">
            <label>Use Martingale</label>
            <input
              type="checkbox"
              checked={useMartingale}
              onChange={(e) => setUseMartingale(e.target.checked)}
              disabled={isTrading}
            />
          </div>
        </div>

        <div className="speed-bot__form-row">
          <div className="speed-bot__form-group">
            <label>Martingale</label>
            <input
              type="number"
              value={martingaleMultiplier}
              onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value))}
              min="1.1"
              step="0.1"
              disabled={isTrading || !useMartingale}
            />
          </div>
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
              disabled={!isConnected || !!error || !client?.is_logged_in || !getAuthToken()}
            >
              START TRADING
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
            <label>Current Stake</label>
            <span>${currentStake.toFixed(2)}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Balance</label>
            <span>{client?.currency || 'USD'} {client?.balance ? parseFloat(client.balance).toFixed(2) : '0.00'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Auth Status</label>
            <span>{client?.is_logged_in && getAuthToken() ? '✅ Logged In' : '❌ Not Logged In'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Executing</label>
            <span>{isExecutingTrade ? '⏳ Yes' : '✅ No'}</span>
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
        <h3>Recent Trades</h3>
        <div className="speed-bot__trades">
          {tradeHistory.length === 0 ? (
            <div className="speed-bot__no-trades">No trades yet</div>
          ) : (
            tradeHistory.map((trade) => (
              <div key={trade.id} className={`speed-bot__trade ${trade.result}`}>
                <span className="speed-bot__trade-time">{trade.timestamp}</span>
                <span className="speed-bot__trade-symbol">{trade.symbol}</span>
                <span className="speed-bot__trade-type">{trade.contractType}</span>
                <span className="speed-bot__trade-result">
                  {trade.result === 'win' ? '✅' : trade.result === 'loss' ? '❌' : '⏳'} 
                  {trade.profit !== 0 ? (trade.profit >= 0 ? '+' : '') + trade.profit.toFixed(2) : '---'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export default SpeedBot;
