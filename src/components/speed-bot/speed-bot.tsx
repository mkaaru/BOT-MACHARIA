```
```tool_code
Here's the complete modified code with the fixes for balance synchronization and trade counting:

```replit_final_file
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
  const [balance, setBalance] = useState<number>(0); // Will be updated from client balance


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
      // Build proposal request following Deriv API specification for DIGITEVEN
      const proposalRequest: any = {
        proposal: 1,
        amount: currentStake,
        basis: 'stake',
        contract_type: selectedContractType,
        currency: client?.currency || 'USD',
        symbol: selectedSymbol,
        duration: 1,
        duration_unit: 't',
        req_id: Date.now()
      };

      // Add barrier/prediction for digit contracts that require it
      if (['DIGITOVER', 'DIGITUNDER'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      } else if (['DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      }
      // DIGITEVEN and DIGITODD don't need barriers - they're based on last digit even/odd

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

        // Small delay to ensure connection is stable
        setTimeout(() => {
          // Authorize if user is logged in
          const authToken = getAuthToken();
          if (authToken) {
            const accountType = client?.is_virtual ? 'Demo' : 'Real';
            console.log(`🔐 BREAKPOINT CONN-4: Authorizing with ${accountType} account token...`, authToken.substring(0, 10) + '...');
            try {
              const authRequest = {
                authorize: authToken,
                req_id: Date.now() + 1000
              };
              ws.send(JSON.stringify(authRequest));
            } catch (error) {
              console.error('❌ BREAKPOINT CONN-5: Error sending authorization request:', error);
              setError('Failed to send authorization request');
            }
          } else {
            console.log('⚠️ BREAKPOINT CONN-6: No token available for authorization');
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
              console.log('📊 BREAKPOINT CONN-7: Requesting tick history for', selectedSymbol);
            } catch (error) {
              console.error('❌ BREAKPOINT CONN-8: Error requesting tick history:', error);
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

            // Request balance updates
            try {
              const balanceRequest = {
                balance: 1,
                subscribe: 1,
                req_id: Date.now() + 4000
              };
              ws.send(JSON.stringify(balanceRequest));
              console.log('📊 Subscribed to balance updates');
            } catch (error) {
              console.error('❌ Error subscribing to balance:', error);
            }

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

            // Only add trade to history and increment counter if still trading
            if (isTrading) {
              setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
              setTotalTrades(prev => {
                const newTotal = prev + 1;
                console.log(`📊 Total trades incremented to: ${newTotal}`);
                return newTotal;
              });
            } else {
              console.log('🛑 Trade completed but bot stopped - not counting');
            }
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
            if (isTrading && isDirectTrading) {
              setTimeout(() => {
                if (isTrading && isDirectTrading && !isExecutingTrade) {
                  console.log('🔄 Getting next proposal for continuous trading...');
                  getPriceProposal();
                } else {
                  console.log('🛑 Not getting next proposal - trading stopped or executing');
                }
              }, 500); // Reduced delay for faster trading
            } else {
              console.log('🛑 Not getting next proposal - trading or direct trading stopped');
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

          // Handle balance updates
          if (data.balance) {
            const newBalance = parseFloat(data.balance.balance);
            console.log('💰 Balance updated:', newBalance);
            setBalance(newBalance);
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
                // Update local balance immediately based on trade result
                setBalance(prev => {
                  const newBalance = prev + profit;
                  console.log(`💰 Balance updated after trade: ${prev} + ${profit} = ${newBalance}`);
                  return newBalance;
                });

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

      // Only add trade to history and increment counter if still trading
      if (isTrading) {
        setTradeHistory(prev => [pendingTrade, ...prev.slice(0, 19)]);
        setTotalTrades(prev => {
          const newTotal = prev + 1;
          console.log(`📊 BREAKPOINT 32: Total trades incremented to: ${newTotal}`);
          return newTotal;
        });
      } else {
        console.log('🛑 Trade completed but bot stopped - not counting');
      }

      // Get proposal first, then buy immediately
      console.log('💳 BREAKPOINT 33: Getting proposal for direct trade...');
      getPriceProposal();

    } catch (error) {
      console.error('❌ BREAKPOINT 34: Direct trade execution failed:', error);
      console.error('  - Error type:', typeof error);
      console.error('  - Error message:', error.message);
      console.error('  - WebSocket state during error:', websocket?.readyState);
      setError(`Direct trade execution failed: ${error.message}`);

      // Update the latest pending trade to show error
      setTradeHistory(prev => {
        const updated = [...prev];
        if (updated[0] && updated[0].result === 'pending') {
          updated[0].result = 'loss';
          updated[0].profit = -updated[0].stake;
          console.log('🔄 BREAKPOINT 35: Updated pending trade to show error');
        }
        return updated;
      });

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
      console.log('💰 BREAKPOINT 18: Balance check - balance:', balance, 'currentStake:', currentStake);
      if (balance < currentStake) {
        console.log('❌ BREAKPOINT 19: Insufficient balance, stopping trading');
        setError(`Insufficient balance: ${balance.toFixed(2)} ${client?.currency || 'USD'}`);
        setIsTrading(false);
        return;
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

const addTradeToHistory = useCallback((trade: Trade) => {
    setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
    setTotalTrades(prev => prev + 1);

    // Update balance based on trade result
    if (trade.result === 'win') {
      setWins(prev => prev + 1);
    // The client balance will be updated in the onmessage handler by
    // using the trade profit value
    } else if (trade.result === 'loss') {
      setLosses(prev => prev + 1);
    // The client balance will be updated in the onmessage handler by
    // using the trade stake value
    }
  }, []);

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

  // Initialize balance from client store
  useEffect(() => {
    if (client?.balance !== undefined) {
      setBalance(parseFloat(client.balance));
    }
  }, [client?.balance]);

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
            <span>{client?.currency || 'USD'} {balance.toFixed(2)}</span>
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