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

            // Log tick updates when trading is active
            if (isTrading) {
              console.log('📈 New tick received:', price, 'Trading active:', isTrading);
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

  // Generate trading strategy XML for bot builder with every tick execution
  const generateSpeedBotStrategy = useCallback(() => {
    try {
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
        case 'PUT':
          tradeType = 'PUT';
          prediction = undefined;
          break;
        default:
          tradeType = 'DIGITOVER';
          prediction = overUnderValue;
      }

      const predictionBlock = prediction !== undefined ? `
      <value name="PREDICTION">
        <block type="math_number" id="prediction_${Date.now()}">
          <field name="NUM">${prediction}</field>
        </block>
      </value>` : '';

      // Generate strategy XML with every tick execution mode
      const xmlStrategy = `<xml xmlns="http://www.w3.org/1999/xhtml" collection="false" is_dbot="true">
  <variables></variables>
  <block type="trade_definition_tradeoptions" id="trade_definition_${Date.now()}" x="0" y="0">
    <field name="MARKET">synthetic_index</field>
    <field name="UNDERLYING">${selectedSymbol}</field>
    <field name="TRADETYPE">${tradeType}</field>
    <field name="TYPE">ticks</field>
    <value name="DURATION">
      <block type="math_number" id="duration_${Date.now()}">
        <field name="NUM">1</field>
      </block>
    </value>
    <value name="AMOUNT">
      <block type="math_number" id="amount_${Date.now()}">
        <field name="NUM">${currentStake.toFixed(2)}</field>
      </block>
    </value>${predictionBlock}
  </block>
  <block type="before_purchase" id="before_purchase_${Date.now()}" x="0" y="200">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="purchase_${Date.now()}">
        <field name="PURCHASE_LIST">${tradeType}</field>
        <field name="EXECUTION_MODE">EVERY_TICK</field>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="after_purchase_${Date.now()}" x="0" y="300">
    <statement name="AFTERPURCHASE_STACK">
      <block type="trade_again" id="trade_again_${Date.now()}">
        <value name="CONDITION">
          <block type="logic_boolean" id="condition_${Date.now()}">
            <field name="BOOL">TRUE</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
</xml>`;

      console.log('Generated Speed Bot strategy XML:', xmlStrategy);
      return xmlStrategy;
    } catch (error) {
      console.error('Error generating strategy XML:', error);
      throw new Error('Failed to generate trading strategy');
    }
  }, [selectedSymbol, selectedContractType, currentStake, overUnderValue]);

  // Listen for bot builder events and update trade history
  const handleBotEvents = useCallback(() => {
    if (!run_panel || !isTrading) return;

    // Listen for trade completion events from bot builder
    const handleTradeResult = (result) => {
      if (result && result.contract) {
        const profit = parseFloat(result.profit) || 0;
        const isWin = profit > 0;

        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const trade: Trade = {
          id: tradeId,
          timestamp: new Date().toLocaleTimeString(),
          symbol: selectedSymbol,
          contractType: selectedContractType,
          result: isWin ? 'win' : 'loss',
          stake: currentStake,
          profit: profit,
        };

        setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
        setTotalTrades(prev => prev + 1);

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

        console.log(`Speed Bot trade completed:`, isWin ? 'WIN' : 'LOSS', `Profit: ${profit}`);
      }
    };

    // Register for trade completion events
    if (localObserver) {
      localObserver.register('bot.trade_complete', handleTradeResult);
    }

    return () => {
      if (localObserver) {
        localObserver.unregister('bot.trade_complete', handleTradeResult);
      }
    };
  }, [selectedSymbol, selectedContractType, currentStake, useMartingale, martingaleMultiplier, stake, run_panel, isTrading, localObserver]);

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

    // Wait for Blockly to be fully initialized
    const waitForBlockly = async () => {
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds total wait time

      while (attempts < maxAttempts) {
        if (window.Blockly && 
            window.Blockly.derivWorkspace && 
            window.Blockly.Xml && 
            typeof window.Blockly.Xml.textToDom === 'function') {
          return true;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      return false;
    };

    const isBlocklyReady = await waitForBlockly();

    if (!isBlocklyReady) {
      setError('Blockly is not ready. Please wait a moment and try again, or refresh the page.');
      return;
    }

    if (!window.Blockly.Xml || typeof window.Blockly.Xml.textToDom !== 'function') {
      setError('Blockly XML utilities not available. Please refresh the page and try again.');
      return;
    }

    try {
      setCurrentStake(stake);
      setError(null);

      // Generate the trading strategy XML with Speed Bot values
      const strategyXML = generateSpeedBotStrategy();

      // Validate XML before loading
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(strategyXML, 'application/xml');
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
          throw new Error('Invalid XML generated');
        }
      } catch (xmlError) {
        console.error('XML validation failed:', xmlError);
        throw new Error('Failed to generate valid trading strategy');
      }

      // Stop any running bot first
      if (run_panel?.is_running) {
        await run_panel.onStopButtonClick();
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Clear existing workspace
      window.Blockly.derivWorkspace.clear();

      // Parse the XML using Blockly's textToDom
      const xml = window.Blockly.Xml.textToDom(strategyXML);
      if (!xml) {
        throw new Error('Failed to parse strategy XML with Blockly.Xml.textToDom');
      }

      // Set event group for proper loading
      const eventGroup = `speed_bot_load_${Date.now()}`;
      window.Blockly.Events.setGroup(eventGroup);

      try {
        // Load strategy into workspace using domToWorkspace
        window.Blockly.Xml.domToWorkspace(xml, window.Blockly.derivWorkspace);

        // Update workspace strategy id
        window.Blockly.derivWorkspace.current_strategy_id = `speed_bot_${Date.now()}`;

        console.log('✅ Speed Bot strategy loaded into workspace successfully');

      } finally {
        // Always clear the event group
        window.Blockly.Events.setGroup(false);
      }

      // Brief delay before starting
      await new Promise(resolve => setTimeout(resolve, 300));

      // Start the bot with the loaded strategy
      if (run_panel?.onRunButtonClick) {
        try {
          await run_panel.onRunButtonClick();
          console.log('✅ Speed Bot started successfully with bot builder');
          setIsTrading(true);
        } catch (runError) {
          console.error('Error starting Speed Bot:', runError);
          throw new Error(`Failed to start Speed Bot: ${runError.message}`);
        }
      } else {
        throw new Error('Run panel not available');
      }

      console.log('🚀 Speed Bot trading started using Bot Builder engine');
      console.log(`Trading ${selectedContractType} on ${selectedSymbol} with stake ${stake} - Every Tick Mode`);

    } catch (error) {
      console.error('Error starting Speed Bot:', error);
      setError(`Failed to start Speed Bot: ${error.message}`);
      setIsTrading(false);
    }
  };

  const stopTrading = async () => {
    try {
      // Stop the bot builder if it's running
      if (run_panel?.is_running) {
        await run_panel.onStopButtonClick();
        console.log('🛑 Bot Builder stopped');
      }
      
      setIsTrading(false);
      console.log('🛑 Speed Bot trading stopped');
    } catch (error) {
      console.error('Error stopping Speed Bot:', error);
      setError(`Error stopping Speed Bot: ${error.message}`);
      setIsTrading(false);
    }
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

  // Set up bot event handling when trading starts
  useEffect(() => {
    if (isTrading) {
      const cleanup = handleBotEvents();
      return cleanup;
    }
  }, [isTrading, handleBotEvents]);

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