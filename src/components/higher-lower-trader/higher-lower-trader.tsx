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
  const { dashboard, blockly_store } = useStore();
  const { client: mainAppClient } = useStore(); // Access main app client store

  const [settings, setSettings] = useState({
    symbol: 'R_10',
    tradeType: 'Higher',
    stake: 0.5,
    barrier: 0.37,
    duration: 60,
    maxTrades: 100,
    profitThreshold: 10,
    lossThreshold: 5,
    martingaleMultiplier: 2.2
  });

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

  const apiRef = useRef<any>(null);
  const tickStreamIdRef = useRef<string | null>(null);
  const contractStreamIdRef = useRef<string | null>(null);
  const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
  const contractTimerRef = useRef(null);
  const stopFlagRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // API and auth state
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accountCurrency, setAccountCurrency] = useState('USD');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [availableSymbols, setAvailableSymbols] = useState([]);
  const [status, setStatus] = useState(''); // For displaying authorization status messages

  // Main app authorization state
  const isMainAppAuthorized = mainAppClient?.isLoggedIn;
  const mainAppCurrency = mainAppClient?.currency;

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

        // Try to authorize if token exists or if main app is already authorized
        authorizeIfNeeded();

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

  // Authorization logic updated to check main app state
  const authorizeIfNeeded = async () => {
      try {
        // Check if main app is already authorized
        if (isMainAppAuthorized) {
          setIsAuthorized(true);
          setAccountCurrency(mainAppCurrency);
          setStatus('Using main app authorization');
          return;
        }

        if (isAuthorized) return;

        const token = localStorage.getItem('authToken');
        if (!token) {
          setStatus('No authentication token found. Please log in.');
          return;
        }

        setStatus('Authorizing...');
        const { authorize, error } = await apiRef.current.authorize(token);

        if (error) {
          setStatus(`Authorization failed: ${error.message}`);
          return;
        }

        setIsAuthorized(true);
        setAccountCurrency(authorize?.currency || 'USD');
        setStatus('Authorized successfully');

        // Sync with main store if available
        if (mainAppClient) {
          mainAppClient.setLoginId(authorize?.loginid || '');
          mainAppClient.setCurrency(authorize?.currency || 'USD');
          mainAppClient.setIsLoggedIn(true);
        }
      } catch (err) {
        setStatus(`Authorization error: ${err.message}`);
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
    if (isTrading) return;

    try {
      // Generate XML for the current settings
      const xmlContent = generateHigherLowerXML();

      // Load the XML into the bot builder workspace
      if (blockly_store?.loadWorkspaceFromXmlString) {
        await blockly_store.loadWorkspaceFromXmlString(xmlContent);

        // Switch to bot builder tab if not already there
        if (dashboard?.setActiveTab) {
          dashboard.setActiveTab(1); // Bot Builder tab
        }

        // Show success notification
        console.log('Higher/Lower strategy loaded into Bot Builder successfully');

        // Start the actual trading through the bot builder's run panel
        setIsTrading(true);
        
        // Try to access run panel from stores
        const { run_panel } = useStore();
        
        // Automatically start the bot execution
        if (run_panel?.onRunButtonClick) {
          // Small delay to ensure workspace is fully loaded
          setTimeout(() => {
            run_panel.onRunButtonClick();
          }, 1000);
        } else {
          // Fallback: try to access run panel through global scope
          setTimeout(() => {
            try {
              if (window.Blockly?.derivWorkspace) {
                window.Blockly.derivWorkspace.run?.();
              }
            } catch (err) {
              console.warn('Could not auto-start bot execution:', err);
            }
          }, 1000);
        }

        // Start a simple countdown timer for UI feedback
        timerRef.current = setInterval(() => {
          setTimeRemaining(prev => {
            if (prev <= 1) {
              return getTotalDuration();
            }
            return prev - 1;
          });
        }, 1000);

      } else {
        throw new Error('Bot builder not available. Please ensure the workspace is loaded.');
      }

    } catch (error) {
      console.error('Failed to load strategy into bot builder:', error);
      alert(`Failed to start trading: ${error.message}`);
      setIsTrading(false);
    }
  };

  const executeTrade = async () => {
    try {
      // Ensure we're still connected before executing trade
      if (connectionStatus !== 'connected' || !apiRef.current) {
        throw new Error('API connection lost. Please reconnect before trading.');
      }

      // Get contract proposal with timeout
      const duration = durationMinutes * 60 + durationSeconds;
      const proposalRequest = {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: contractType, // 'CALL' for Higher, 'PUT' for Lower
        currency: accountCurrency,
        duration: duration,
        duration_unit: 's',
        symbol: selectedSymbol,
        barrier: barrier
      };

      console.log('Sending proposal request:', proposalRequest);

      const proposalResponse = await Promise.race([
        apiRef.current.send(proposalRequest),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Proposal request timeout')), 10000)
        )
      ]);

      if (proposalResponse.error) {
        console.error('Proposal error:', proposalResponse.error);
        throw new Error(`Proposal failed: ${proposalResponse.error.message}`);
      }

      const proposal = proposalResponse.proposal;
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
          await authorizeIfNeeded();
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
    setIsTrading(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setTimeLeft(0);
    setCurrentContract(null);

    // Stop the bot if it's running in bot builder
    try {
      if (run_panel?.onStopButtonClick) {
        run_panel.onStopButtonClick();
      } else if (window.Blockly?.derivWorkspace) {
        // Fallback method
        window.Blockly.derivWorkspace.stop?.();
      }
    } catch (error) {
      console.error('Error stopping bot execution:', error);
    }
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

  // Generate XML for Higher/Lower strategy based on current settings
  const generateHigherLowerXML = () => {
    const currentContractType = contractType === 'CALL' ? 'CALL' : 'PUT';
    const barrierValue = barrier.startsWith('+') || barrier.startsWith('-') ? barrier : `+${barrier}`;

    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="hl:stake">hl:stake</variable>
    <variable id="hl:totalProfit">hl:totalProfit</variable>
    <variable id="hl:tradeCount">hl:tradeCount</variable>
    <variable id="hl:multiplier">hl:multiplier</variable>
    <variable id="hl:profit">hl:profit</variable>
    <variable id="hl:resultIsWin">hl:resultIsWin</variable>
  </variables>
  <block type="trade_definition" id="trade_def_main" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="market_def" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${selectedSymbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="tradetype_def" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">higherlower</field>
            <field name="TRADETYPE_LIST">callput</field>
            <next>
              <block type="trade_definition_contracttype" id="contract_def" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="candle_def" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="restart_def" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="error_def" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="text_print" id="init_print1">
        <value name="TEXT">
          <shadow type="text" id="init_text1">
            <field name="TEXT">Higher/Lower Bot Starting - ${currentContractType} Strategy</field>
          </shadow>
        </value>
        <next>
          <block type="variables_set" id="init_stake">
            <field name="VAR" id="hl:stake">hl:stake</field>
            <value name="VALUE">
              <block type="math_number" id="stake_value">
                <field name="NUM">${stake}</field> {/* Use stake */}
              </block>
            </value>
            <next>
              <block type="variables_set" id="init_total">
                <field name="VAR" id="hl:totalProfit">hl:totalProfit</field>
                <value name="VALUE">
                  <block type="math_number" id="total_value">
                    <field name="NUM">0</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="init_count">
                    <field name="VAR" id="hl:tradeCount">hl:tradeCount</field>
                    <value name="VALUE">
                      <block type="math_number" id="count_value">
                        <field name="NUM">0</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="init_mult">
                        <field name="VAR" id="hl:multiplier">hl:multiplier</field>
                        <value name="VALUE">
                          <block type="math_number" id="mult_value">
                            <field name="NUM">${settings.martingaleMultiplier}</field> {/* Keep original setting for now */}
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="trade_options">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="true" has_second_barrier="false" has_prediction="false"></mutation>
        <field name="DURATIONTYPE_LIST">s</field>
        <value name="DURATION">
          <shadow type="math_number" id="duration_val">
            <field name="NUM">${durationMinutes * 60 + durationSeconds}</field> {/* Calculate total duration */}
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="amount_val">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="get_stake">
            <field name="VAR" id="hl:stake">hl:stake</field>
          </block>
        </value>
        <value name="BARRIEROFFSETVALUE">
          <shadow type="text" id="barrier_val">
            <field name="TEXT">${barrierValue}</field>
          </shadow>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="before_purchase" deletable="false" x="0" y="800">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="check_trade_count">
        <value name="IF0">
          <block type="logic_compare" id="count_compare">
            <field name="OP">LT</field>
            <value name="A">
              <block type="variables_get" id="get_count">
                <field name="VAR" id="hl:tradeCount">hl:tradeCount</field>
              </block>
            </value>
            <value name="B">
              <block type="math_number" id="max_trades">
                <field name="NUM">${settings.maxTrades}</field> {/* Keep original setting for now */}
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="purchase_block">
            <field name="PURCHASE_LIST">${currentContractType}</field>
          </block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="after_purchase" x="600" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="math_change" id="increment_count">
        <field name="VAR" id="hl:tradeCount">hl:tradeCount</field>
        <value name="DELTA">
          <shadow type="math_number" id="delta_one">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <next>
          <block type="variables_set" id="set_profit">
            <field name="VAR" id="hl:profit">hl:profit</field>
            <value name="VALUE">
              <block type="read_details" id="read_profit">
                <field name="DETAIL_INDEX">4</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="set_result">
                <field name="VAR" id="hl:resultIsWin">hl:resultIsWin</field>
                <value name="VALUE">
                  <block type="contract_check_result" id="check_win">
                    <field name="CHECK_RESULT">win</field>
                  </block>
                </value>
                <next>
                  <block type="math_change" id="add_profit">
                    <field name="VAR" id="hl:totalProfit">hl:totalProfit</field>
                    <value name="DELTA">
                      <block type="variables_get" id="get_profit">
                        <field name="VAR" id="hl:profit">hl:profit</field>
                      </block>
                    </value>
                    <next>
                      <block type="controls_if" id="check_result">
                        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                        <value name="IF0">
                          <block type="variables_get" id="get_result">
                            <field name="VAR" id="hl:resultIsWin">hl:resultIsWin</field>
                          </block>
                        </value>
                        <statement name="DO0">
                          <block type="notify" id="win_notify">
                            <field name="NOTIFICATION_TYPE">success</field>
                            <field name="NOTIFICATION_SOUND">silent</field>
                            <value name="MESSAGE">
                              <shadow type="text" id="win_msg">
                                <field name="TEXT">Trade Won! Profit: </field>
                              </shadow>
                            </value>
                            <next>
                              <block type="variables_set" id="reset_stake_win">
                                <field name="VAR" id="hl:stake">hl:stake</field>
                                <value name="VALUE">
                                  <block type="math_number" id="base_stake_win">
                                    <field name="NUM">${stake}</field> {/* Use component state stake */}
                                  </block>
                                </value>
                              </block>
                            </next>
                          </block>
                        </statement>
                        <statement name="ELSE">
                          <block type="notify" id="loss_notify">
                            <field name="NOTIFICATION_TYPE">warn</field>
                            <field name="NOTIFICATION_SOUND">silent</field>
                            <value name="MESSAGE">
                              <shadow type="text" id="loss_msg">
                                <field name="TEXT">Trade Lost! Loss: </field>
                              </shadow>
                            </value>
                            <next>
                              <block type="variables_set" id="increase_stake">
                                <field name="VAR" id="hl:stake">hl:stake</field>
                                <value name="VALUE">
                                  <block type="math_arithmetic" id="multiply_stake">
                                    <field name="OP">MULTIPLY</field>
                                    <value name="A">
                                      <block type="variables_get" id="current_stake">
                                        <field name="VAR" id="hl:stake">hl:stake</field>
                                      </block>
                                    </value>
                                    <value name="B">
                                      <block type="variables_get" id="get_multiplier">
                                        <field name="VAR" id="hl:multiplier">hl:multiplier</field>
                                      </block>
                                    </value>
                                  </block>
                                </value>
                              </block>
                            </next>
                          </block>
                        </statement>
                        <next>
                          <block type="controls_if" id="check_thresholds">
                            <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1"></mutation>
                            <value name="IF0">
                              <block type="logic_compare" id="profit_threshold">
                                <field name="OP">GTE</field>
                                <value name="A">
                                  <block type="variables_get" id="total_profit_check">
                                    <field name="VAR" id="hl:totalProfit">hl:totalProfit</field>
                                  </block>
                                </value>
                                <value name="B">
                                  <block type="math_number" id="profit_limit">
                                    <field name="NUM">${stopOnProfit ? targetProfit : settings.profitThreshold}</field> {/* Use component state */}
                                  </block>
                                </value>
                              </block>
                            </value>
                            <statement name="DO0">
                              <block type="notify" id="profit_reached">
                                <field name="NOTIFICATION_TYPE">success</field>
                                <field name="NOTIFICATION_SOUND">silent</field>
                                <value name="MESSAGE">
                                  <shadow type="text" id="profit_reached_msg">
                                    <field name="TEXT">Profit target reached! Stopping bot.</field>
                                  </shadow>
                                </value>
                              </block>
                            </statement>
                            <value name="IF1">
                              <block type="logic_compare" id="loss_threshold">
                                <field name="OP">LTE</field>
                                <value name="A">
                                  <block type="variables_get" id="total_profit_check2">
                                    <field name="VAR" id="hl:totalProfit">hl:totalProfit</field>
                                  </block>
                                </value>
                                <value name="B">
                                  <block type="math_single" id="neg_loss">
                                    <field name="OP">NEG</field>
                                    <value name="NUM">
                                      <block type="math_number" id="loss_limit">
                                        <field name="NUM">${settings.lossThreshold}</field> {/* Keep original setting for now */}
                                      </block>
                                    </value>
                                  </block>
                                </value>
                              </block>
                            </value>
                            <statement name="DO1">
                              <block type="notify" id="loss_reached">
                                <field name="NOTIFICATION_TYPE">error</field>
                                <field name="NOTIFICATION_SOUND">silent</field>
                                <value name="MESSAGE">
                                  <shadow type="text" id="loss_reached_msg">
                                    <field name="TEXT">Loss limit reached! Stopping bot.</field>
                                  </shadow>
                                </value>
                              </block>
                            </statement>
                            <next>
                              <block type="controls_if" id="should_continue">
                                <value name="IF0">
                                  <block type="logic_operation" id="continue_logic">
                                    <field name="OP">AND</field>
                                    <value name="A">
                                      <block type="logic_compare" id="profit_check">
                                        <field name="OP">LT</field>
                                        <value name="A">
                                          <block type="variables_get" id="total_profit_cont">
                                            <field name="VAR" id="hl:totalProfit">hl:totalProfit</field>
                                          </block>
                                        </value>
                                        <value name="B">
                                          <block type="math_number" id="profit_limit_cont">
                                            <field name="NUM">${stopOnProfit ? targetProfit : settings.profitThreshold}</field> {/* Use component state */}
                                          </block>
                                        </value>
                                      </block>
                                    </value>
                                    <value name="B">
                                      <block type="logic_compare" id="loss_check">
                                        <field name="OP">GT</field>
                                        <value name="A">
                                          <block type="variables_get" id="total_profit_cont2">
                                            <field name="VAR" id="hl:totalProfit">hl:totalProfit</field>
                                          </block>
                                        </value>
                                        <value name="B">
                                          <block type="math_single" id="neg_loss_cont">
                                            <field name="OP">NEG</field>
                                            <value name="NUM">
                                              <block type="math_number" id="loss_limit_cont">
                                                <field name="NUM">${settings.lossThreshold}</field> {/* Keep original setting for now */}
                                              </block>
                                            </value>
                                          </block>
                                        </value>
                                      </block>
                                    </value>
                                  </block>
                                </value>
                                <statement name="DO0">
                                  <block type="trade_again" id="continue_trading"></block>
                                </statement>
                              </block>
                            </next>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`;
  };

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
                {(isAuthorized || isMainAppAuthorized) && (
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
            {connectionStatus === 'connected' && !isAuthorized && !isMainAppAuthorized && (
              <div className="auth-warning">
                <p>⚠️ Please log in to start trading</p>
                <button
                  onClick={authorizeIfNeeded}
                  className="btn-auth"
                  disabled={connectionStatus !== 'connected'}
                >
                  Authorize Account
                </button>
              </div>
            )}

            {/* Start/Stop Button */}
            <button
              onClick={isTrading ? stopTrading : startTrading}
              className={`hl-trader__start-btn ${isTrading ? 'hl-trader__start-btn--running' : ''}`}
              disabled={
                !isTrading && (
                  getTotalDuration() < 15 || 
                  connectionStatus !== 'connected' ||
                  availableSymbols.length === 0 ||
                  !blockly_store
                )
              }
            >
              {isTrading ? (
                <>
                  <Square size={16} />
                  Stop Trading
                </>
              ) : (
                <>
                  <Play size={16} />
                  Start Trading
                </>
              )}
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
      {connectionStatus === 'connected' && (isAuthorized || isMainAppAuthorized) && (
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