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

  // Get token from client store with better error handling
  const getAuthToken = () => {
    console.log('🔍 Checking authentication...');
    console.log('Client object:', client);
    console.log('Is logged in:', client?.is_logged_in);

    if (!client) {
      console.log('❌ Client store not available');
      return null;
    }

    if (!client.is_logged_in) {
      console.log('❌ User not logged in');
      return null;
    }

    // Try multiple ways to get the token
    let token = null;

    // Check various possible token locations
    if (client.getToken && typeof client.getToken === 'function') {
      token = client.getToken();
      console.log('🔑 Token from getToken():', token ? 'Available' : 'Null');
    }

    if (!token && client.token) {
      token = client.token;
      console.log('🔑 Token from client.token:', token ? 'Available' : 'Null');
    }

    if (!token && client.authentication?.token) {
      token = client.authentication.token;
      console.log('🔑 Token from client.authentication.token:', token ? 'Available' : 'Null');
    }

    // Check localStorage as fallback
    if (!token) {
      try {
        const storedTokens = localStorage.getItem('client.tokens');
        if (storedTokens) {
          const parsedTokens = JSON.parse(storedTokens);
          if (parsedTokens && Object.keys(parsedTokens).length > 0) {
            token = Object.values(parsedTokens)[0];
            console.log('🔑 Token from localStorage:', token ? 'Available' : 'Null');
          }
        }
      } catch (e) {
        console.log('⚠️ Error reading tokens from localStorage:', e);
      }
    }

    if (token) {
      console.log('✅ Authentication token found');
      return token;
    } else {
      console.log('❌ No authentication token found');
      return null;
    }
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

  // Bot engine state
  const [tradeEngine, setTradeEngine] = useState<any>(null);
  const [botInterface, setBotInterface] = useState<any>(null);
  const [isUsingBotEngine, setIsUsingBotEngine] = useState(false);

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

  // State for tracking authorization
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);

  // Buy contract function using proper Deriv API sequence
  const buyContract = useCallback(async (proposalId: string) => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot buy contract: WebSocket not connected');
      setError('WebSocket connection lost');
      return;
    }

    if (!isAuthorized) {
      console.error('❌ Cannot buy contract: Not authorized');
      setError('Not authorized - please check your login');
      return;
    }

    if (!proposalId) {
      console.error('❌ Cannot buy contract: No proposal ID');
      setError('No proposal ID available');
      return;
    }

    try {
      setIsExecutingTrade(true);

      // Simple buy request with just the proposal ID - following Deriv API best practices
      const buyRequest = {
        buy: proposalId,
        req_id: Date.now()
      };

      console.log('📈 Buying contract with proposal ID:', proposalId);
      websocket.send(JSON.stringify(buyRequest));

      // Set timeout to reset executing state if no response
      setTimeout(() => {
        if (isExecutingTrade) {
          console.log('⏰ Buy request timeout - resetting execution state');
          setIsExecutingTrade(false);
          setError('Buy request timed out - trying again...');
        }
      }, 8000);

    } catch (error) {
      console.error('Error buying contract:', error);
      setError(`Failed to buy contract: ${error.message}`);
      setIsExecutingTrade(false);
    }
  }, [websocket, isAuthorized, isExecutingTrade]);

  // Get price proposal using proper Deriv API format
  const getPriceProposal = useCallback(() => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.log('❌ Cannot get proposal: WebSocket not connected');
      setError('WebSocket connection lost. Reconnecting...');
      return;
    }

    if (!isAuthorized) {
      console.log('❌ Cannot get proposal: Not authorized');
      setError('Not authorized. Please ensure you are logged in to Deriv.');
      return;
    }

    if (isExecutingTrade) {
      console.log('⏳ Skipping proposal request - trade already executing');
      return;
    }

    try {
      // Build proposal request following Deriv API specification
      const proposalRequest: any = {
        proposal: 1,
        amount: currentStake,
        basis: 'stake',
        contract_type: selectedContractType,
        currency: client?.currency || 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: selectedSymbol,
        req_id: Date.now()
      };

      // Add barrier/prediction for digit contracts that require it
      if (['DIGITOVER', 'DIGITUNDER'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      } else if (['DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      }

      console.log('📊 Getting price proposal with proper API format:', proposalRequest);
      websocket.send(JSON.stringify(proposalRequest));

    } catch (error) {
      console.error('Error getting proposal:', error);
      setError(`Failed to get proposal: ${error.message}`);

      // Retry after error
      if (isTrading) {
        setTimeout(() => {
          console.log('🔄 Retrying proposal after error...');
          getPriceProposal();
        }, 2000);
      }
    }
  }, [websocket, isAuthorized, currentStake, selectedContractType, selectedSymbol, overUnderValue, isExecutingTrade, isTrading, client]);

  // WebSocket connection
  const connectToAPI = useCallback(() => {
    try {
      if (websocket) {
        websocket.close();
        setWebsocket(null);
      }

      setError(null);
      console.log('🚀 Connecting to WebSocket API with app_id 75771...');
      setIsConnected(false);
      setIsAuthorized(false);

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      ws.onopen = () => {
        console.log('✅ WebSocket connection established');
        setIsConnected(true);
        setWebsocket(ws);

        // Small delay to ensure connection is stable
        setTimeout(() => {
          // Authorize if user is logged in
          const authToken = getAuthToken();
          if (authToken) {
            const accountType = client?.is_virtual ? 'Demo' : 'Real';
            console.log(`🔐 Authorizing with ${accountType} account token...`, authToken.substring(0, 10) + '...');
            try {
              const authRequest = {
                authorize: authToken,
                req_id: Date.now() + 1000
              };
              ws.send(JSON.stringify(authRequest));
            } catch (error) {
              console.error('❌ Error sending authorization request:', error);
              setError('Failed to send authorization request');
            }
          } else {
            console.log('⚠️ No token available for authorization');
            console.log('Login status:', client?.is_logged_in);
            console.log('Client available:', !!client);
            setError('Please log in to start trading. Go to Deriv.com and sign in first.');
            setIsAuthorized(false);
          }

          // Request tick history after auth attempt (with or without auth)
          setTimeout(() => {
            try {
              const tickRequest = {
                ticks_history: selectedSymbol,
                count: 120,
                end: 'latest',
                style: 'ticks',
                subscribe: 1,
                req_id: Date.now() + 2000
              };
              ws.send(JSON.stringify(tickRequest));
              console.log('📊 Requesting tick history for', selectedSymbol);
            } catch (error) {
              console.error('❌ Error requesting tick history:', error);
            }
          }, 1000);
        }, 200);
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
          if (data.authorize) {
            console.log('✅ WebSocket authorized successfully', data.authorize);
            setIsAuthorized(true);
            setError(null);

            // Start getting proposals when authorized and trading
            if (isTrading) {
              getPriceProposal();
            }
          } else if (data.error && data.error.code === 'InvalidToken') {
            console.error('❌ Authorization failed:', data.error);
            setError(`Authorization failed: ${data.error.message}`);
            setIsAuthorized(false);
          }

          // Handle price proposal response
          if (data.proposal) {
            console.log('💰 Proposal received:', data.proposal);

            if (data.proposal.error) {
              console.error('❌ Proposal error:', data.proposal.error);
              setError(`Proposal failed: ${data.proposal.error.message}`);
              setIsExecutingTrade(false);

              // Retry getting proposal after error
              if (isTrading) {
                setTimeout(() => {
                  console.log('🔄 Retrying proposal after error...');
                  getPriceProposal();
                }, 2000);
              }
              return;
            }

            if (data.proposal.id && data.proposal.ask_price) {
              console.log('✅ Valid proposal received - ID:', data.proposal.id, 'Price:', data.proposal.ask_price);
              setProposalId(data.proposal.id);

              // Auto-buy immediately if trading is active
              if (isTrading && !isExecutingTrade) {
                console.log('🚀 Attempting to buy contract with proposal ID:', data.proposal.id);
                console.log('💰 Proposal price:', data.proposal.ask_price);
                // Buy immediately with minimal delay to prevent proposal expiry
                setTimeout(() => {
                  buyContract(data.proposal.id);
                }, 100);
              }
            } else {
              console.log('⚠️ Invalid proposal received:', data.proposal);
              if (isTrading) {
                setTimeout(() => {
                  getPriceProposal();
                }, 1000);
              }
            }
          }

          // Handle buy response
          if (data.buy) {
            console.log('✅ Contract purchased successfully:', data.buy);
            setIsExecutingTrade(false);
            setProposalId(null); // Reset proposal ID
            setError(null); // Clear any previous errors

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

            // Add trade to history and increment total trades counter
            setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
            setTotalTrades(prev => {
              const newTotal = prev + 1;
              console.log(`📊 Total trades incremented to: ${newTotal}`);
              return newTotal;
            });
            setLastTradeTime(Date.now());

            // Subscribe to contract updates to monitor outcome
            if (data.buy.contract_id) {
              try {
                const contractRequest = {
                  proposal_open_contract: 1,
                  contract_id: data.buy.contract_id,
                  subscribe: 1,
                  req_id: Date.now() + 3000
                };
                ws.send(JSON.stringify(contractRequest));
                console.log('📈 Subscribed to contract updates for contract:', data.buy.contract_id);
              } catch (error) {
                console.error('❌ Error subscribing to contract:', error);
              }
            }

            // Get next proposal for continuous trading immediately
            if (isTrading) {
              setTimeout(() => {
                if (isTrading && !isExecutingTrade) {
                  console.log('🔄 Getting next proposal for continuous trading...');
                  getPriceProposal();
                }
              }, 500); // Reduced delay for faster trading
            }
          }

          // Handle buy errors
          if (data.error && data.msg_type === 'buy') {
            console.error('❌ Buy contract error:', data.error);
            setIsExecutingTrade(false);
            setProposalId(null);

            if (data.error.code === 'InvalidContractProposal') {
              setError('Proposal expired - getting new proposal...');
              // Immediately get a new proposal
              if (isTrading) {
                setTimeout(() => {
                  console.log('🔄 Getting new proposal after InvalidContractProposal error...');
                  getPriceProposal();
                }, 500);
              }
            } else {
              setError(`Buy failed: ${data.error.message}`);
              // Retry after other errors
              if (isTrading) {
                setTimeout(() => {
                  console.log('🔄 Retrying after buy error...');
                  getPriceProposal();
                }, 2000);
              }
            }
          }

          // Handle contract update (profit/loss)
          if (data.proposal_open_contract) {
            const contract = data.proposal_open_contract;
            if (contract.is_sold || contract.status === 'sold') {
              const profit = parseFloat(contract.profit || 0);
              const isWin = profit > 0;

              // Update the most recent trade with result
              let tradeWasUpdated = false;
              setTradeHistory(prev => {
                const updated = [...prev];
                if (updated[0] && updated[0].result === 'pending') {
                  updated[0].result = isWin ? 'win' : 'loss';
                  updated[0].profit = profit;
                  tradeWasUpdated = true;
                }
                return updated;
              });

              // Only increment counters if we actually updated a trade
              if (tradeWasUpdated) {
                if (isWin) {
                  setWins(prev => prev + 1);
                  setCurrentStake(stake); // Reset to original stake on win
                } else {
                  setLosses(prev => prev + 1);
                  // Apply martingale if enabled
                  if (useMartingale) {
                    setCurrentStake(prev => prev * martingaleMultiplier);
                  }
                }
              }

              console.log(`Contract completed:`, isWin ? 'WIN' : 'LOSS', `Profit: ${profit}`, `Trade counted: ${tradeWasUpdated}`);
            }
          }

          // Handle tick history and other responses
          if (data.history) {
            console.log('📊 Tick history received');
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

      ws.onclose = (event) => {
        console.log(`WebSocket connection closed - Code: ${event.code}, Reason: ${event.reason}`);
        setIsConnected(false);
        setIsAuthorized(false);
        setWebsocket(null);
        setIsExecutingTrade(false);

        // Auto-reconnect if trading was active
        if (isTrading && !event.wasClean) {
          console.log('🔄 Auto-reconnecting in 3 seconds...');
          setTimeout(() => {
            if (isTrading) {
              connectToAPI();
            }
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        setIsAuthorized(false);
        setError('WebSocket connection failed - reconnecting...');
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setIsConnected(false);
      setError('Failed to create connection');
    }
  }, [selectedSymbol, isTrading]);

  // Initialize bot engine for hybrid approach
  const initializeBotEngine = useCallback(async () => {
    try {
      console.log('🤖 Initializing bot engine for Speed Bot...');

      const authToken = getAuthToken();
      if (!authToken) {
        throw new Error('No authentication token available');
      }

      // Create bot engine scope
      const engineScope = {
        observer: globalObserver || localObserver
      };

      // Initialize trade engine
      const engine = new TradeEngine(engineScope);

      // Initialize with token and options
      const initOptions = {
        symbol: selectedSymbol,
        currency: client?.currency || 'USD'
      };

      console.log('🔧 Initializing trade engine with:', initOptions);
      await engine.init(authToken, initOptions);

      // Create bot interface
      const botIface = getBotInterface(engine);

      setTradeEngine(engine);
      setBotInterface(botIface);
      setIsUsingBotEngine(true);

      console.log('✅ Bot engine initialized successfully');
      return { engine, botIface };

    } catch (error) {
      console.error('❌ Failed to initialize bot engine:', error);
      setError(`Bot engine initialization failed: ${error.message}`);
      setIsUsingBotEngine(false);
      throw error;
    }
  }, [selectedSymbol, client]);

  // Execute a single trade using bot engine
  const executeBotTrade = useCallback(async () => {
    if (!tradeEngine || !botInterface || !isUsingBotEngine) {
      console.error('❌ Bot engine not available for trading');
      return;
    }

    try {
      console.log('🚀 Executing bot engine trade...');

      // Configure trade options for bot engine
      const tradeOptions = {
        amount: currentStake,
        basis: 'stake',
        contract_type: selectedContractType,
        currency: client?.currency || 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: selectedSymbol,
      };

      // Add prediction/barrier for digit contracts
      if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
        tradeOptions.barrier = overUnderValue.toString();
      }

      console.log('📊 Trade options:', tradeOptions);

      // Create a unique trade ID for tracking
      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Add pending trade to history immediately
      const pendingTrade: Trade = {
        id: tradeId,
        timestamp: new Date().toLocaleTimeString(),
        symbol: selectedSymbol,
        contractType: selectedContractType,
        result: 'pending',
        stake: currentStake,
        profit: 0,
      };

      setTradeHistory(prev => [pendingTrade, ...prev.slice(0, 19)]);
      setTotalTrades(prev => {
        const newTotal = prev + 1;
        console.log(`📊 Total trades incremented to: ${newTotal}`);
        return newTotal;
      });

      // Use bot interface to purchase
      const purchaseResult = await botInterface.purchase(tradeOptions);

      console.log('✅ Purchase executed:', purchaseResult);

      // Update the pending trade with contract details if available
      if (purchaseResult && purchaseResult.contract_id) {
        setTradeHistory(prev => {
          const updated = [...prev];
          const tradeIndex = updated.findIndex(t => t.id === tradeId);
          if (tradeIndex >= 0) {
            updated[tradeIndex] = {
              ...updated[tradeIndex],
              id: purchaseResult.contract_id || tradeId, // Use contract ID if available
            };
          }
          return updated;
        });
      }

      return purchaseResult;

    } catch (error) {
      console.error('❌ Bot engine trade execution failed:', error);
      setError(`Trade execution failed: ${error.message}`);

      // Update the latest pending trade to show error
      setTradeHistory(prev => {
        const updated = [...prev];
        if (updated[0] && updated[0].result === 'pending') {
          updated[0].result = 'loss';
          updated[0].profit = -updated[0].stake;
        }
        return updated;
      });

      throw error;
    }
  }, [tradeEngine, botInterface, isUsingBotEngine, currentStake, selectedContractType, selectedSymbol, overUnderValue, client]);

  // Handle bot engine trade events for hybrid approach
  const handleBotEngineEvents = useCallback(() => {
    if (!isTrading || !isUsingBotEngine) return;

    const handleBuyContract = (data) => {
      console.log('💰 Bot engine buy contract:', data);

      if (data && data.buy) {
        const buyData = data.buy;
        console.log('✅ Contract purchased successfully:', buyData);

        // Update the most recent pending trade with buy details
        setTradeHistory(prev => {
          const updated = [...prev];
          const pendingTrade = updated.find(trade => trade.result === 'pending');
          if (pendingTrade && buyData.contract_id) {
            pendingTrade.id = buyData.contract_id;
          }
          return updated;
        });
      }
    };

    const handleTradeComplete = (data) => {
      console.log('✅ Bot engine trade complete:', data);

      if (data && data.proposal_open_contract) {
        const contract = data.proposal_open_contract;

        if (contract.is_sold || contract.status === 'sold') {
          const profit = parseFloat(contract.profit || 0);
          const isWin = profit > 0;

          // Update the trade with matching contract ID
          setTradeHistory(prev => {
            const updated = [...prev];
            const tradeIndex = updated.findIndex(trade => 
              trade.id === contract.contract_id || 
              (trade.result === 'pending' && !updated.some(t => t.id === contract.contract_id))
            );

            if (tradeIndex >= 0) {
              updated[tradeIndex] = {
                ...updated[tradeIndex],
                id: contract.contract_id,
                result: isWin ? 'win' : 'loss',
                profit: profit,
              };
            }
            return updated;
          });

          // Update win/loss counters
          if (isWin) {
            setWins(prev => prev + 1);
            setCurrentStake(stake); // Reset to original stake on win
          } else {
            setLosses(prev => prev + 1);
            // Apply martingale if enabled
            if (useMartingale) {
              setCurrentStake(prev => prev * martingaleMultiplier);
            }
          }

          console.log(`🎯 Speed Bot trade result:`, isWin ? 'WIN' : 'LOSS', `Profit: ${profit}`);
        }
      }
    };

    const handleTickUpdate = (data) => {
      if (data && data.tick && data.tick.symbol === selectedSymbol) {
        const price = parseFloat(data.tick.quote);
        setCurrentPrice(price.toFixed(5));
      }
    };

    const handleError = (data) => {
      console.error('❌ Bot engine error:', data);
      if (data && data.error) {
        setError(`Bot error: ${data.error.message}`);
      }
    };

    // Register for bot engine events
    const observer = globalObserver || localObserver;
    if (observer) {
      observer.register('bot.buy', handleBuyContract);
      observer.register('bot.contract', handleTradeComplete);
      observer.register('bot.tick', handleTickUpdate);
      observer.register('bot.error', handleError);
    }

    return () => {
      const observer = globalObserver || localObserver;
      if (observer) {
        observer.unregister('bot.buy', handleBuyContract);
        observer.unregister('bot.contract', handleTradeComplete);
        observer.unregister('bot.tick', handleTickUpdate);
        observer.unregister('bot.error', handleError);
      }
    };
  }, [selectedSymbol, selectedContractType, currentStake, useMartingale, martingaleMultiplier, stake, isTrading, isUsingBotEngine]);

  const startTrading = async () => {
    console.log('🚀 Attempting to start Speed Bot in hybrid mode...');

    // Reset any previous errors
    setError(null);

    // Check if user is logged in and has token
    const authToken = getAuthToken();
    if (!authToken) {
      setError('Please log in to Deriv first. Go to deriv.com and sign in, then try again.');
      return;
    }

    // Validate trading parameters
    if (stake < 0.35) {
      setError('Minimum stake is 0.35 USD');
      return;
    }

    // Check account details if available
    if (client) {
      const accountType = client?.is_virtual ? 'Demo' : 'Real';
      console.log(`📊 Account type: ${accountType}`);

      if (client?.balance !== undefined) {
        const balance = parseFloat(client.balance);
        console.log(`💰 Account balance: ${balance} ${client.currency || 'USD'}`);

        if (balance < stake) {
          setError(`Insufficient balance. Current: ${balance} ${client.currency || 'USD'}, Required: ${stake}`);
          return;
        }
      }
    }

    try {
      setCurrentStake(stake);
      setIsTrading(true);
      setIsExecutingTrade(false);

      console.log('🤖 Starting Speed Bot in hybrid mode using bot engine...');
      console.log(`📊 Configuration: ${selectedContractType} on ${selectedSymbol} with stake ${stake}`);

      // Initialize bot engine
      await initializeBotEngine();

      console.log('✅ Speed Bot hybrid trading started successfully');

      // Start the trading loop
      setTimeout(() => {
        if (isTrading) {
          executeTradingLoop();
        }
      }, 1000);

    } catch (error) {
      console.error('❌ Error starting Speed Bot hybrid mode:', error);
      setError(`Failed to start Speed Bot: ${error.message}`);
      setIsTrading(false);
      setIsUsingBotEngine(false);
    }
  };

  // Trading loop for continuous trading
  const executeTradingLoop = useCallback(async () => {
    if (!isTrading || !isUsingBotEngine) {
      console.log('🛑 Trading loop stopped - not trading or bot engine not available');
      return;
    }

    try {
      console.log('🔄 Executing trading loop...');

      // Check if we have sufficient balance before trading
      if (client?.balance !== undefined) {
        const balance = parseFloat(client.balance);
        if (balance < currentStake) {
          console.log('❌ Insufficient balance, stopping trading');
          setError(`Insufficient balance: ${balance} ${client.currency || 'USD'}`);
          setIsTrading(false);
          return;
        }
      }

      // Execute a single trade
      await executeBotTrade();

      // Wait before next trade (2-5 seconds interval)
      const nextTradeDelay = Math.random() * 3000 + 2000; // 2-5 seconds
      console.log(`⏱️ Next trade in ${(nextTradeDelay / 1000).toFixed(1)} seconds`);

      setTimeout(() => {
        if (isTrading) {
          executeTradingLoop();
        }
      }, nextTradeDelay);

    } catch (error) {
      console.error('❌ Trading loop error:', error);

      // Retry after error with longer delay
      setTimeout(() => {
        if (isTrading) {
          console.log('🔄 Retrying trading loop after error...');
          executeTradingLoop();
        }
      }, 5000);
    }
  }, [isTrading, isUsingBotEngine, currentStake, client, executeBotTrade]);

  const stopTrading = async () => {
    try {
      setIsTrading(false);
      setProposalId(null);

      // Stop bot engine if using hybrid mode
      if (isUsingBotEngine && tradeEngine) {
        console.log('🛑 Stopping bot engine...');
        await tradeEngine.stop();
        setIsUsingBotEngine(false);
        setTradeEngine(null);
        setBotInterface(null);
      }

      console.log('🛑 Speed Bot trading stopped');
    } catch (error) {
      console.error('Error stopping Speed Bot:', error);
      setError(`Error stopping Speed Bot: ${error.message}`);
      setIsTrading(false);
      setIsUsingBotEngine(false);
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

  // Set up hybrid bot event handling when trading starts
  useEffect(() => {
    if (isTrading && isUsingBotEngine) {
      const cleanup = handleBotEngineEvents();
      return cleanup;
    }
  }, [isTrading, isUsingBotEngine, handleBotEngineEvents]);

  // Start trading loop when bot engine is ready
  useEffect(() => {
    if (isTrading && isUsingBotEngine && tradeEngine && !isExecutingTrade) {
      const timer = setTimeout(() => {
        executeTradingLoop();
      }, 2000); // Start after 2 seconds

      return () => clearTimeout(timer);
    }
  }, [isTrading, isUsingBotEngine, tradeEngine, isExecutingTrade, executeTradingLoop]);

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
        HYBRID BOT ENGINE MODE
      </div>

      <div className="speed-bot__description">
        Uses the bot builder engine for reliable trade execution with Speed Bot configuration.
        <br />
        <strong>This uses real money!</strong>
        {isUsingBotEngine && <span style={{ color: 'green' }}> 🤖 Bot Engine Active</span>}
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
              disabled={!!error || !client?.is_logged_in}
            >
              START HYBRID TRADING
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
            <span>{isAuthorized ? '✅ Authorized' : '❌ Not Authorized'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Bot Engine</label>
            <span>{isUsingBotEngine ? '🤖 Active' : '❌ Inactive'}</span>
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