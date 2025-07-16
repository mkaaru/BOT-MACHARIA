import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
// Direct WebSocket trading - no bot engine dependencies
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

  // Get token from client store with comprehensive fallback methods
  const getAuthToken = () => {
    console.log('🔍 BREAKPOINT AUTH-1: Checking authentication...');
    
    if (!client?.is_logged_in) {
      console.log('❌ BREAKPOINT AUTH-2: User not logged in');
      return null;
    }

    // Try multiple token sources in order of preference
    let token = null;

    // Method 1: Client getToken function
    if (client.getToken && typeof client.getToken === 'function') {
      try {
        token = client.getToken();
        console.log('🔑 BREAKPOINT AUTH-3: Token from getToken():', token ? `${token.substring(0, 10)}...` : 'Null');
      } catch (e) {
        console.log('⚠️ BREAKPOINT AUTH-4: Error with getToken():', e);
      }
    }

    // Method 2: Direct token property
    if (!token && client.token) {
      token = client.token;
      console.log('🔑 BREAKPOINT AUTH-5: Token from client.token:', token ? `${token.substring(0, 10)}...` : 'Null');
    }

    // Method 3: Check various localStorage keys
    if (!token) {
      const tokenKeys = ['client.tokens', 'accountsList', 'authToken'];
      for (const key of tokenKeys) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            if (key === 'client.tokens' || key === 'accountsList') {
              const parsed = JSON.parse(stored);
              if (parsed && typeof parsed === 'object') {
                const loginid = client.loginid || Object.keys(parsed)[0];
                if (loginid && parsed[loginid]) {
                  token = parsed[loginid];
                  console.log(`🔑 BREAKPOINT AUTH-6: Token from ${key}[${loginid}]:`, token ? `${token.substring(0, 10)}...` : 'Null');
                  break;
                }
              }
            } else {
              token = stored;
              console.log(`🔑 BREAKPOINT AUTH-7: Token from ${key}:`, token ? `${token.substring(0, 10)}...` : 'Null');
              break;
            }
          }
        } catch (e) {
          console.log(`⚠️ Error reading ${key}:`, e);
        }
      }
    }

    // Method 4: Check cookie if available
    if (!token && document.cookie) {
      try {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=');
          if (name === 'authToken' || name === 'token') {
            token = value;
            console.log('🔑 BREAKPOINT AUTH-8: Token from cookie:', token ? `${token.substring(0, 10)}...` : 'Null');
            break;
          }
        }
      } catch (e) {
        console.log('⚠️ Error reading cookies:', e);
      }
    }

    if (token && token.length > 20) {
      console.log('✅ BREAKPOINT AUTH-9: Valid authentication token found');
      return token;
    } else {
      console.log('❌ BREAKPOINT AUTH-10: No valid authentication token found');
      return null;
    }
  };

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string>('---');

  // Trading configuration
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [selectedContractType, setSelectedContractType] = useState('DIGITEVEN');
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

  // Direct WebSocket trading state
  const [isDirectTrading, setIsDirectTrading] = useState(false);

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

  // Direct WebSocket trading - no observer pattern needed

  // State for tracking authorization
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);

  // Buy contract function with enhanced error handling and validation
  const buyContract = useCallback(async (proposalId: string) => {
    console.log('🛒 BREAKPOINT BUY-1: BUY CONTRACT ATTEMPT');
    console.log('🛒 BREAKPOINT BUY-1.1: WebSocket state:', websocket?.readyState, '(1=OPEN, 2=CLOSING, 3=CLOSED)');
    console.log('🛒 BREAKPOINT BUY-1.2: Is authorized:', isAuthorized);
    console.log('🛒 BREAKPOINT BUY-1.3: Proposal ID:', proposalId);
    console.log('🛒 BREAKPOINT BUY-1.4: Account:', client?.loginid, client?.is_virtual ? 'Virtual' : 'Real');
    console.log('🛒 BREAKPOINT BUY-1.5: Balance:', client?.balance, client?.currency);

    // Strict validation checks
    if (!websocket) {
      console.error('❌ BREAKPOINT BUY-2: WebSocket is null');
      setError('WebSocket connection is null');
      setIsExecutingTrade(false);
      return;
    }

    if (websocket.readyState !== WebSocket.OPEN) {
      console.error('❌ BREAKPOINT BUY-3: WebSocket not open, state:', websocket.readyState);
      setError('WebSocket connection not open');
      setIsExecutingTrade(false);
      return;
    }

    if (!isAuthorized) {
      console.error('❌ BREAKPOINT BUY-4: Not authorized');
      setError('Not authorized for trading');
      setIsExecutingTrade(false);
      return;
    }

    if (!proposalId || proposalId.length < 10) {
      console.error('❌ BREAKPOINT BUY-5: Invalid proposal ID:', proposalId);
      setError('Invalid proposal ID');
      setIsExecutingTrade(false);
      return;
    }

    try {
      // Create buy request with unique req_id
      const buyRequest = {
        buy: proposalId,
        req_id: `buy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      console.log('📈 BREAKPOINT BUY-6: SENDING BUY REQUEST:', {
        buy: proposalId,
        req_id: buyRequest.req_id
      });

      // Send the buy request
      websocket.send(JSON.stringify(buyRequest));
      console.log('📈 BREAKPOINT BUY-7: BUY REQUEST SENT TO DERIV API');

      // Set a timeout to handle no response scenarios
      setTimeout(() => {
        if (isExecutingTrade) {
          console.log('⏰ BREAKPOINT BUY-8: Buy request timeout after 10 seconds');
          setIsExecutingTrade(false);
          setError('Buy request timed out - proposal may have expired');
          
          // Try to get a new proposal
          if (isTrading) {
            setTimeout(() => {
              console.log('🔄 BREAKPOINT BUY-9: Getting new proposal after timeout...');
              getPriceProposal();
            }, 1000);
          }
        }
      }, 10000); // 10 second timeout

    } catch (error) {
      console.error('❌ BREAKPOINT BUY-10: Exception during buy request:', error);
      setError(`Buy request failed: ${error.message}`);
      setIsExecutingTrade(false);
      
      // Try again after error
      if (isTrading) {
        setTimeout(() => {
          console.log('🔄 BREAKPOINT BUY-11: Retrying after exception...');
          getPriceProposal();
        }, 2000);
      }
    }
  }, [websocket, isAuthorized, isExecutingTrade, client, isTrading, getPriceProposal]);

  // Get price proposal with enhanced validation and error handling
  const getPriceProposal = useCallback(() => {
    console.log('📊 BREAKPOINT PROP-REQ-1: Getting price proposal...');
    
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.log('❌ BREAKPOINT PROP-REQ-2: WebSocket not available');
      setError('WebSocket connection lost');
      return;
    }

    if (!isAuthorized) {
      console.log('❌ BREAKPOINT PROP-REQ-3: Not authorized');
      setError('Not authorized for proposals');
      return;
    }

    if (isExecutingTrade) {
      console.log('⏳ BREAKPOINT PROP-REQ-4: Trade executing, skipping proposal');
      return;
    }

    try {
      // Validate stake amount
      const stakeAmount = Math.max(currentStake, 0.35);
      
      // Build comprehensive proposal request
      const proposalRequest: any = {
        proposal: 1,
        amount: stakeAmount,
        basis: 'stake',
        contract_type: selectedContractType,
        currency: client?.currency || 'USD',
        symbol: selectedSymbol,
        duration: 1,
        duration_unit: 't',
        req_id: `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
      };

      // Add barriers for digit contracts that require them
      if (['DIGITOVER', 'DIGITUNDER'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
        console.log('📊 BREAKPOINT PROP-REQ-5: Added barrier for OVER/UNDER:', overUnderValue);
      } else if (['DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
        console.log('📊 BREAKPOINT PROP-REQ-6: Added barrier for MATCH/DIFF:', overUnderValue);
      }

      console.log('📊 BREAKPOINT PROP-REQ-7: Sending proposal request:', {
        ...proposalRequest,
        req_id: proposalRequest.req_id
      });

      websocket.send(JSON.stringify(proposalRequest));
      console.log('📊 BREAKPOINT PROP-REQ-8: Proposal request sent to Deriv API');

      // Set timeout for proposal response
      setTimeout(() => {
        if (!proposalId && isTrading && !isExecutingTrade) {
          console.log('⏰ BREAKPOINT PROP-REQ-9: Proposal timeout, retrying...');
          getPriceProposal();
        }
      }, 5000);

    } catch (error) {
      console.error('❌ BREAKPOINT PROP-REQ-10: Error in proposal request:', error);
      setError(`Proposal request failed: ${error.message}`);

      // Retry after error with backoff
      if (isTrading) {
        setTimeout(() => {
          console.log('🔄 BREAKPOINT PROP-REQ-11: Retrying after error...');
          getPriceProposal();
        }, 3000);
      }
    }
  }, [websocket, isAuthorized, currentStake, selectedContractType, selectedSymbol, overUnderValue, isExecutingTrade, isTrading, client, proposalId]);

  // WebSocket connection
  const connectToAPI = useCallback(() => {
    try {
      console.log('🔗 BREAKPOINT CONN-1: connectToAPI called');
      console.log('🔗 BREAKPOINT CONN-1.1: Current WebSocket state:', websocket?.readyState);
      console.log('🔗 BREAKPOINT CONN-1.2: isTrading:', isTrading);
      
      // Don't close existing connection if it's working and we're trading
      if (websocket && websocket.readyState === WebSocket.OPEN && isTrading) {
        console.log('🔗 BREAKPOINT CONN-1.3: Keeping existing connection during trading');
        return;
      }

      if (websocket) {
        console.log('🔗 BREAKPOINT CONN-1.4: Closing existing WebSocket');
        websocket.close();
        setWebsocket(null);
      }

      setError(null);
      console.log('🚀 BREAKPOINT CONN-2: Connecting to WebSocket API with app_id 75771...');
      setIsConnected(false);
      setIsAuthorized(false);

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      ws.onopen = () => {
        console.log('✅ BREAKPOINT CONN-3: WebSocket connection established');
        setIsConnected(true);
        setWebsocket(ws);
        setError(null); // Clear any previous errors

        // Immediate authorization attempt with proper sequencing
        setTimeout(() => {
          const authToken = getAuthToken();
          if (authToken) {
            const accountType = client?.is_virtual ? 'Demo' : 'Real';
            console.log(`🔐 BREAKPOINT CONN-4: Authorizing with ${accountType} account...`);
            
            try {
              const authRequest = {
                authorize: authToken,
                req_id: `auth_${Date.now()}`
              };
              console.log('📤 BREAKPOINT CONN-4.1: Sending auth request:', { ...authRequest, authorize: authRequest.authorize.substring(0, 10) + '...' });
              ws.send(JSON.stringify(authRequest));
            } catch (error) {
              console.error('❌ BREAKPOINT CONN-5: Error sending authorization:', error);
              setError('Failed to authorize connection');
              setIsAuthorized(false);
            }
          } else {
            console.log('⚠️ BREAKPOINT CONN-6: No auth token - unauthorized mode');
            setError('Please ensure you are logged in to Deriv first');
            setIsAuthorized(false);
            
            // Still get ticks for price display even without auth
            setTimeout(() => {
              try {
                const tickRequest = {
                  ticks_history: selectedSymbol,
                  count: 20,
                  end: 'latest',
                  style: 'ticks',
                  subscribe: 1,
                  req_id: `ticks_unauth_${Date.now()}`
                };
                ws.send(JSON.stringify(tickRequest));
                console.log('📊 BREAKPOINT CONN-6.1: Getting ticks (unauthorized)');
              } catch (error) {
                console.error('❌ Error getting unauthorized ticks:', error);
              }
            }, 500);
          }
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Log ALL messages for debugging
          console.log('📨 WebSocket Message Received:', data.msg_type || 'unknown', data);

          if (data.error) {
            console.error('❌ WebSocket API error:', data.error);
            console.error('❌ Error details:', {
              code: data.error.code,
              message: data.error.message,
              details: data.error.details
            });
            setError(data.error.message || 'API Error');
            
            // If it's a buy error, reset trade execution state
            if (data.msg_type === 'buy') {
              setIsExecutingTrade(false);
              setProposalId(null);
            }
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
            console.log('💰 BREAKPOINT PROP-1: Proposal received:', {
              id: data.proposal.id,
              ask_price: data.proposal.ask_price,
              error: data.proposal.error,
              req_id: data.req_id
            });

            if (data.proposal.error) {
              console.error('❌ BREAKPOINT PROP-2: Proposal error:', data.proposal.error);
              setError(`Proposal failed: ${data.proposal.error.message}`);
              setIsExecutingTrade(false);

              // More aggressive retry on proposal errors
              if (isTrading) {
                setTimeout(() => {
                  console.log('🔄 BREAKPOINT PROP-3: Retrying proposal after error...');
                  getPriceProposal();
                }, 1000); // Reduced from 2000ms
              }
              return;
            }

            if (data.proposal.id && data.proposal.ask_price) {
              console.log('✅ BREAKPOINT PROP-4: Valid proposal - ID:', data.proposal.id, 'Price:', data.proposal.ask_price);
              setProposalId(data.proposal.id);
              setError(null); // Clear any previous errors

              // IMMEDIATE buy attempt to prevent proposal expiry
              if (isTrading && !isExecutingTrade) {
                console.log('🚀 BREAKPOINT PROP-5: IMMEDIATE buy attempt with proposal:', data.proposal.id);
                setIsExecutingTrade(true); // Set this BEFORE the buy call
                
                // Buy with NO delay to prevent expiry
                try {
                  buyContract(data.proposal.id);
                } catch (error) {
                  console.error('❌ BREAKPOINT PROP-6: Immediate buy failed:', error);
                  setIsExecutingTrade(false);
                  if (isTrading) {
                    setTimeout(() => getPriceProposal(), 500);
                  }
                }
              }
            } else {
              console.log('⚠️ BREAKPOINT PROP-7: Invalid proposal structure:', data.proposal);
              if (isTrading && !isExecutingTrade) {
                setTimeout(() => {
                  console.log('🔄 BREAKPOINT PROP-8: Retrying after invalid proposal...');
                  getPriceProposal();
                }, 500);
              }
            }
          }

          // Handle buy response
          if (data.buy) {
            console.log('✅ REAL CONTRACT PURCHASED SUCCESSFULLY:', data.buy);
            console.log('💰 Contract ID:', data.buy.contract_id);
            console.log('💰 Buy Price:', data.buy.buy_price);
            console.log('💰 Payout:', data.buy.payout);
            console.log('💰 Transaction ID:', data.buy.transaction_id);
            setIsExecutingTrade(false);
            setProposalId(null); // Reset proposal ID
            setError(null); // Clear any previous errors

            const tradeId = `real_${data.buy.contract_id || Date.now()}`;
            const trade: Trade = {
              id: tradeId,
              timestamp: new Date().toLocaleTimeString(),
              symbol: selectedSymbol,
              contractType: selectedContractType,
              result: 'pending',
              stake: parseFloat(data.buy.buy_price || currentStake),
              profit: 0,
            };

            // Add trade to history and increment total trades counter
            setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
            setTotalTrades(prev => {
              const newTotal = prev + 1;
              console.log(`📊 REAL TRADE COUNT: ${newTotal}`);
              return newTotal;
            });
            setLastTradeTime(Date.now());

            // Subscribe to contract updates to monitor outcome using proper format
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
        console.log(`🔗 BREAKPOINT CONN-9: WebSocket connection closed - Code: ${event.code}, Reason: ${event.reason}`);
        console.log(`🔗 BREAKPOINT CONN-9.1: wasClean: ${event.wasClean}, isTrading: ${isTrading}`);
        setIsConnected(false);
        setIsAuthorized(false);
        setWebsocket(null);
        setIsExecutingTrade(false);

        // Auto-reconnect if trading was active
        if (isTrading && !event.wasClean) {
          console.log('🔄 BREAKPOINT CONN-10: Auto-reconnecting in 3 seconds...');
          setTimeout(() => {
            if (isTrading) {
              console.log('🔄 BREAKPOINT CONN-11: Reconnecting...');
              connectToAPI();
            }
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('🔗 BREAKPOINT CONN-12: WebSocket error:', error);
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

  // Direct WebSocket trading initialization
  const initializeDirectTrading = useCallback(() => {
    console.log('🚀 BREAKPOINT 42: Initializing direct WebSocket trading...');
    console.log('🔍 BREAKPOINT 42.1: WebSocket state - isConnected:', isConnected, 'readyState:', websocket?.readyState);

    const authToken = getAuthToken();
    console.log('🔍 BREAKPOINT 43: Auth token for direct trading:', authToken ? 'Available' : 'Missing');
    
    if (!authToken) {
      console.log('❌ BREAKPOINT 44: No auth token for direct trading');
      setError('Please log in to Deriv first. Go to deriv.com and sign in, then try again.');
      return false;
    }

    if (!isConnected || !isAuthorized) {
      console.log('❌ BREAKPOINT 45: WebSocket not ready for direct trading');
      setError('WebSocket connection not ready. Please wait and try again.');
      return false;
    }

    console.log('✅ BREAKPOINT 46: Direct WebSocket trading ready');
    setIsDirectTrading(true);
    return true;
  }, [isConnected, isAuthorized, websocket]);

  // Execute a single trade using direct WebSocket
  const executeDirectTrade = useCallback(async () => {
    console.log('🚀 BREAKPOINT 27: executeDirectTrade called');
    console.log('🔍 BREAKPOINT 28: Direct trading status - isDirectTrading:', isDirectTrading);
    console.log('🔍 BREAKPOINT 28.1: WebSocket status - isConnected:', isConnected, 'isAuthorized:', isAuthorized, 'readyState:', websocket?.readyState);
    
    if (!isDirectTrading || !isConnected || !isAuthorized || !websocket) {
      console.error('❌ BREAKPOINT 29: Direct trading not available');
      console.error('  - isDirectTrading:', isDirectTrading);
      console.error('  - isConnected:', isConnected);
      console.error('  - isAuthorized:', isAuthorized);
      console.error('  - websocket:', !!websocket);
      return;
    }

    if (isExecutingTrade) {
      console.log('⏳ BREAKPOINT 30: Trade already executing, skipping');
      return;
    }

    try {
      console.log('🚀 BREAKPOINT 31: Executing direct WebSocket trade...');
      console.log('🔍 BREAKPOINT 31.1: Current trading state - currentStake:', currentStake, 'selectedContractType:', selectedContractType);

      // DON'T add fake trades to history - only add them when buy succeeds
      console.log('💳 BREAKPOINT 33: Getting proposal for direct trade...');
      getPriceProposal();

    } catch (error) {
      console.error('❌ BREAKPOINT 34: Direct trade execution failed:', error);
      console.error('  - Error type:', typeof error);
      console.error('  - Error message:', error.message);
      console.error('  - WebSocket state during error:', websocket?.readyState);
      setError(`Direct trade execution failed: ${error.message}`);
      throw error;
    }
  }, [isDirectTrading, isConnected, isAuthorized, websocket, isExecutingTrade, currentStake, selectedContractType, selectedSymbol, getPriceProposal]);

  // Handle direct WebSocket trading events
  const handleDirectTradingEvents = useCallback(() => {
    console.log('🔄 Setting up direct trading event handlers...');
    // All events are already handled in the WebSocket onmessage handler
    // This function is kept for consistency with the previous pattern
    return () => {
      console.log('🔄 Cleaning up direct trading event handlers...');
    };
  }, []);

  const startTrading = async () => {
    console.log('🚀 BREAKPOINT 1: Attempting to start Speed Bot in direct WebSocket mode...');
    console.log('🔍 BREAKPOINT 1.1: Current connection state - isConnected:', isConnected, 'isAuthorized:', isAuthorized);
    console.log('🔍 BREAKPOINT 1.2: WebSocket state:', websocket?.readyState, 'Expected OPEN:', WebSocket.OPEN);

    // Reset any previous errors
    setError(null);

    // Check if user is logged in and has token
    const authToken = getAuthToken();
    console.log('🔍 BREAKPOINT 2: Auth token check result:', authToken ? 'Token found' : 'No token');
    if (!authToken) {
      console.log('❌ BREAKPOINT 3: No auth token - stopping execution');
      setError('Please log in to Deriv first. Go to deriv.com and sign in, then try again.');
      return;
    }

    // Validate trading parameters
    if (stake < 0.35) {
      console.log('❌ BREAKPOINT 3.1: Stake validation failed - minimum 0.35');
      setError('Minimum stake is 0.35 USD');
      return;
    }

    // Check account details if available
    if (client) {
      const accountType = client?.is_virtual ? 'Demo' : 'Real';
      console.log(`📊 BREAKPOINT 3.2: Account type: ${accountType}`);

      if (client?.balance !== undefined) {
        const balance = parseFloat(client.balance);
        console.log(`💰 BREAKPOINT 3.3: Account balance: ${balance} ${client.currency || 'USD'}`);

        if (balance < stake) {
          console.log('❌ BREAKPOINT 3.4: Insufficient balance');
          setError(`Insufficient balance. Current: ${balance} ${client.currency || 'USD'}, Required: ${stake}`);
          return;
        }
      }
    }

    try {
      console.log('🔧 BREAKPOINT 4: Setting up trading state...');
      
      setCurrentStake(stake);
      setIsTrading(true);
      setIsExecutingTrade(false);

      console.log('🌐 BREAKPOINT 5: Starting Speed Bot in direct WebSocket mode...');
      console.log(`📊 BREAKPOINT 6: Configuration: ${selectedContractType} on ${selectedSymbol} with stake ${stake}`);

      // Initialize direct trading
      console.log('🔧 BREAKPOINT 7: Calling initializeDirectTrading...');
      const success = initializeDirectTrading();
      if (!success) {
        console.log('❌ BREAKPOINT 8: Direct trading initialization failed');
        setIsTrading(false);
        return;
      }
      console.log('✅ BREAKPOINT 8: Direct trading initialization completed');

      console.log('✅ BREAKPOINT 9: Speed Bot direct trading started successfully');

      // Start the trading loop
      console.log('⏰ BREAKPOINT 10: Setting timeout for trading loop...');
      setTimeout(() => {
        console.log('🔄 BREAKPOINT 11: Timeout triggered, checking if still trading:', isTrading);
        if (isTrading) {
          console.log('🚀 BREAKPOINT 12: Calling executeTradingLoop...');
          executeTradingLoop();
        } else {
          console.log('🛑 BREAKPOINT 13: Not trading anymore, skipping loop');
        }
      }, 1000);

    } catch (error) {
      console.error('❌ BREAKPOINT 14: Error starting Speed Bot direct mode:', error);
      console.error('❌ BREAKPOINT 14.1: Error details:', error.message, error.stack);
      setError(`Failed to start Speed Bot: ${error.message}`);
      setIsTrading(false);
      setIsDirectTrading(false);
    }
  };

  // Trading loop for continuous trading
  const executeTradingLoop = useCallback(async () => {
    console.log('🔄 BREAKPOINT 14: executeTradingLoop called');
    console.log('🔍 BREAKPOINT 15: Current state - isTrading:', isTrading, 'isDirectTrading:', isDirectTrading);
    
    if (!isTrading || !isDirectTrading) {
      console.log('🛑 BREAKPOINT 16: Trading loop stopped - not trading or direct trading not available');
      console.log('  - isTrading:', isTrading);
      console.log('  - isDirectTrading:', isDirectTrading);
      return;
    }

    try {
      console.log('🔄 BREAKPOINT 17: Executing trading loop...');

      // Check if we have sufficient balance before trading
      if (client?.balance !== undefined) {
        const balance = parseFloat(client.balance);
        console.log('💰 BREAKPOINT 18: Balance check - balance:', balance, 'currentStake:', currentStake);
        if (balance < currentStake) {
          console.log('❌ BREAKPOINT 19: Insufficient balance, stopping trading');
          setError(`Insufficient balance: ${balance} ${client.currency || 'USD'}`);
          setIsTrading(false);
          return;
        }
      } else {
        console.log('⚠️ BREAKPOINT 20: No balance information available');
      }

      // Execute a single trade
      console.log('🚀 BREAKPOINT 21: Calling executeDirectTrade...');
      await executeDirectTrade();
      console.log('✅ BREAKPOINT 22: executeDirectTrade completed');

      // Wait before next trade (2-5 seconds interval)
      const nextTradeDelay = Math.random() * 3000 + 2000; // 2-5 seconds
      console.log(`⏱️ BREAKPOINT 23: Next trade in ${(nextTradeDelay / 1000).toFixed(1)} seconds`);

      setTimeout(() => {
        console.log('⏰ BREAKPOINT 24: Next trade timeout triggered, checking if still trading:', isTrading);
        if (isTrading) {
          console.log('🔄 BREAKPOINT 25: Recursively calling executeTradingLoop');
          executeTradingLoop();
        } else {
          console.log('🛑 BREAKPOINT 26: Not trading anymore, stopping loop');
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
  }, [isTrading, isDirectTrading, currentStake, client, executeDirectTrade]);

  const stopTrading = async () => {
    try {
      setIsTrading(false);
      setProposalId(null);
      setIsDirectTrading(false);

      console.log('🛑 Speed Bot direct trading stopped');
    } catch (error) {
      console.error('Error stopping Speed Bot:', error);
      setError(`Error stopping Speed Bot: ${error.message}`);
      setIsTrading(false);
      setIsDirectTrading(false);
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

  // Set up direct trading event handling when trading starts
  useEffect(() => {
    if (isTrading && isDirectTrading) {
      const cleanup = handleDirectTradingEvents();
      return cleanup;
    }
  }, [isTrading, isDirectTrading, handleDirectTradingEvents]);

  // Start trading loop when direct trading is ready
  useEffect(() => {
    if (isTrading && isDirectTrading && !isExecutingTrade) {
      const timer = setTimeout(() => {
        executeTradingLoop();
      }, 2000); // Start after 2 seconds

      return () => clearTimeout(timer);
    }
  }, [isTrading, isDirectTrading, isExecutingTrade, executeTradingLoop]);

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
        DIRECT WEBSOCKET MODE
      </div>

      <div className="speed-bot__description">
        <strong>Engine Used:</strong> {isDirectTrading ? 'Direct WebSocket API' : 'WebSocket Connection'}
        <br />
        Uses direct WebSocket connection to Deriv API for fast trade execution.
        <br />
        <strong>This uses real money!</strong>
        {isDirectTrading && <span style={{ color: 'green' }}> 🌐 Direct Trading Active</span>}
        {!isDirectTrading && isTrading && <span style={{ color: 'orange' }}> 🔄 Initializing Direct Trading...</span>}
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
            <label>Direct Trading</label>
            <span>{isDirectTrading ? '🌐 Active' : '❌ Inactive'}</span>
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