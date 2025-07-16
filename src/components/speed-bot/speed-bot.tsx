
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  try {
    const store = useStore();
    const run_panel = store?.run_panel;
    const client = store?.client;

    // Early return if required stores are not available
    if (!store) {
      return (
        <div className="speed-bot">
          <div className="speed-bot__error">
            <h3>Speed Bot Loading...</h3>
            <p>Initializing Speed Bot services...</p>
          </div>
        </div>
      );
    }

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
  const [useMartingale, setUseMartingale] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.5);

  // Trading state
  const [currentStake, setCurrentStake] = useState(1.0);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [isExecutingTrade, setIsExecutingTrade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [isRequestingProposal, setIsRequestingProposal] = useState(false);
  const [lastTradeTime, setLastTradeTime] = useState(0);

  // Direct WebSocket trading state
  const [isDirectTrading, setIsDirectTrading] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [activeContracts, setActiveContracts] = useState<Map<string, any>>(new Map());

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

  // Validation for contract combinations
  const isValidCombination = useMemo(() => {
    const validSymbols = volatilitySymbols.map(s => s.value);
    if (!validSymbols.includes(selectedSymbol)) {
      console.log('❌ Invalid symbol:', selectedSymbol);
      return false;
    }
    
    if (currentStake < 0.35) {
      console.log('❌ Stake too low:', currentStake);
      return false;
    }
    
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
      if (overUnderValue < 0 || overUnderValue > 9) {
        console.log('❌ Invalid barrier value:', overUnderValue);
        return false;
      }
    }
    
    return true;
  }, [selectedSymbol, selectedContractType, overUnderValue, currentStake]);

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

  // Buy contract function using proper Deriv API sequence
  const buyContract = useCallback(async (proposalId: string) => {
    console.log('📈 Buy contract attempt debug:', {
      websocketReady: websocket?.readyState === WebSocket.OPEN,
      isAuthorized,
      proposalId,
      isExecutingTrade,
      isTrading,
      isDirectTrading,
      currentStake,
      balance
    });

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

    if (isExecutingTrade) {
      console.log('⚠️ Already executing trade - skipping');
      return;
    }

    try {
      setIsExecutingTrade(true);
      setLastTradeTime(Date.now());

      const buyRequest = {
        buy: proposalId,
        req_id: Date.now()
      };

      console.log('📈 Sending buy request:', JSON.stringify(buyRequest, null, 2));
      websocket.send(JSON.stringify(buyRequest));

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (isExecutingTrade) {
          console.log('⏰ Buy request timeout - resetting execution state');
          setIsExecutingTrade(false);
          setError('Buy request timed out - trying again...');
          
          // Retry if still trading
          if (isTrading && isDirectTrading) {
            setTimeout(() => {
              console.log('🔄 Retrying after timeout...');
              getPriceProposal();
            }, 1000);
          }
        }
      }, 10000);

      // Store timeout ID to clear it if buy succeeds
      (window as any).buyTimeoutId = timeoutId;

    } catch (error) {
      console.error('❌ Error buying contract:', error);
      setError(`Failed to buy contract: ${error.message}`);
      setIsExecutingTrade(false);
      
      // Retry if still trading
      if (isTrading && isDirectTrading) {
        setTimeout(() => {
          console.log('🔄 Retrying after error...');
          getPriceProposal();
        }, 2000);
      }
    }
  }, [websocket, isAuthorized, isExecutingTrade, isTrading, isDirectTrading, currentStake, balance]);

  // Sell contract function
  const sellContract = useCallback(async (contractId: string) => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot sell contract: WebSocket not connected');
      return;
    }

    if (!isAuthorized) {
      console.error('❌ Cannot sell contract: Not authorized');
      return;
    }

    try {
      const sellRequest = {
        sell: contractId,
        price: 0, // Sell at market price
        req_id: Date.now()
      };

      console.log('📤 Selling contract:', contractId);
      websocket.send(JSON.stringify(sellRequest));

    } catch (error) {
      console.error('Error selling contract:', error);
      setError(`Failed to sell contract: ${error.message}`);
    }
  }, [websocket, isAuthorized]);

  // Strategy condition check (similar to your reference code)
  const isGoodCondition = useCallback((lastDigit: number, contractType: string) => {
    console.log(`🎯 Condition check: lastDigit=${lastDigit}, contractType=${contractType}, overUnderValue=${overUnderValue}`);
    
    if (isNaN(lastDigit) || lastDigit < 0 || lastDigit > 9) {
      console.error('❌ Invalid last digit:', lastDigit);
      return false;
    }
    
    let result = false;
    
    // For immediate execution strategy - trade on every tick that meets condition
    switch (contractType) {
      case 'DIGITEVEN':
        result = lastDigit % 2 === 0; // 0, 2, 4, 6, 8
        break;
      case 'DIGITODD':
        result = lastDigit % 2 === 1; // 1, 3, 5, 7, 9
        break;
      case 'DIGITOVER':
        result = lastDigit > overUnderValue;
        console.log(`🎯 DIGITOVER check: ${lastDigit} > ${overUnderValue} = ${result}`);
        break;
      case 'DIGITUNDER':
        result = lastDigit < overUnderValue;
        console.log(`🎯 DIGITUNDER check: ${lastDigit} < ${overUnderValue} = ${result}`);
        break;
      case 'DIGITMATCH':
        result = lastDigit === overUnderValue;
        console.log(`🎯 DIGITMATCH check: ${lastDigit} === ${overUnderValue} = ${result}`);
        break;
      case 'DIGITDIFF':
        result = lastDigit !== overUnderValue;
        console.log(`🎯 DIGITDIFF check: ${lastDigit} !== ${overUnderValue} = ${result}`);
        break;
      case 'CALL':
      case 'PUT':
        result = true; // For rise/fall, trade on every tick
        break;
      default:
        result = false;
    }
    
    console.log(`🎯 Final condition result: ${result ? '✅ TRADE' : '❌ SKIP'} (${contractType}: digit=${lastDigit}, barrier=${overUnderValue})`);
    return result;
  }, [overUnderValue]);

  // Get price proposal using proper Deriv API format
  const getPriceProposal = useCallback(() => {
    console.log('📊 Proposal request debug:', {
      websocketReady: websocket?.readyState === WebSocket.OPEN,
      isAuthorized,
      isExecutingTrade,
      isRequestingProposal,
      isTrading,
      isDirectTrading,
      currentStake,
      selectedContractType,
      selectedSymbol,
      timeSinceLastTrade: Date.now() - lastTradeTime
    });

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

    if (isRequestingProposal) {
      console.log('⏳ Skipping proposal request - already requesting');
      return;
    }

    // Rate limiting: minimum 1 second between trades
    const timeSinceLastTrade = Date.now() - lastTradeTime;
    if (timeSinceLastTrade < 1000) {
      console.log(`⏳ Rate limit: waiting ${1000 - timeSinceLastTrade}ms`);
      setTimeout(() => getPriceProposal(), 1000 - timeSinceLastTrade);
      return;
    }

    try {
      setIsRequestingProposal(true);
      
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

      if (['DIGITOVER', 'DIGITUNDER'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      } else if (['DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      }

      console.log('📊 Sending proposal request:', JSON.stringify(proposalRequest, null, 2));
      websocket.send(JSON.stringify(proposalRequest));

      // Clear request flag after timeout
      const proposalTimeoutId = setTimeout(() => {
        console.log('⏰ Proposal request timeout - clearing flag');
        setIsRequestingProposal(false);
        
        // Retry if still trading
        if (isTrading && isDirectTrading) {
          setTimeout(() => {
            console.log('🔄 Retrying proposal request after timeout...');
            getPriceProposal();
          }, 1000);
        }
      }, 3000); // Reduced timeout to 3 seconds
      
      // Store timeout ID to clear it if proposal succeeds
      (window as any).proposalTimeoutId = proposalTimeoutId;

    } catch (error) {
      console.error('❌ Error getting proposal:', error);
      setError(`Failed to get proposal: ${error.message}`);
      setIsRequestingProposal(false);

      if (isTrading) {
        setTimeout(() => {
          console.log('🔄 Retrying proposal after error...');
          getPriceProposal();
        }, 2000);
      }
    }
  }, [websocket, isAuthorized, currentStake, selectedContractType, selectedSymbol, overUnderValue, isExecutingTrade, isRequestingProposal, isTrading, isDirectTrading, client, lastTradeTime]);

  // WebSocket connection
  const connectToAPI = useCallback(() => {
    try {
      if (websocket && websocket.readyState === WebSocket.OPEN && isTrading) {
        return;
      }

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

        setTimeout(() => {
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
            setError('Please log in to start trading. Go to Deriv.com and sign in first.');
            setIsAuthorized(false);
          }

          // Request tick subscription immediately after authorization
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
              console.log('📊 Sending tick request:', JSON.stringify(tickRequest, null, 2));
              ws.send(JSON.stringify(tickRequest));
              console.log('📊 Tick subscription requested for', selectedSymbol);
              
              // Also request live ticks separately to ensure we get real-time data
              setTimeout(() => {
                const liveTickRequest = {
                  ticks: selectedSymbol,
                  subscribe: 1,
                  req_id: Date.now() + 3000
                };
                console.log('📊 Sending live tick request:', JSON.stringify(liveTickRequest, null, 2));
                ws.send(JSON.stringify(liveTickRequest));
                console.log('📊 Live tick subscription requested for', selectedSymbol);
              }, 500);
            } catch (error) {
              console.error('❌ Error requesting tick subscription:', error);
            }
          }, 800);
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
            console.log('💰 Raw proposal data:', JSON.stringify(data.proposal, null, 2));
            
            // Clear proposal timeout
            if ((window as any).proposalTimeoutId) {
              clearTimeout((window as any).proposalTimeoutId);
              (window as any).proposalTimeoutId = null;
            }
            
            setIsRequestingProposal(false);

            if (data.proposal.error) {
              console.error('❌ Proposal error:', JSON.stringify(data.proposal.error, null, 2));
              setError(`Proposal failed: ${data.proposal.error.message}`);
              setIsExecutingTrade(false);

              if (isTrading && isDirectTrading) {
                setTimeout(() => {
                  console.log('🔄 Retrying proposal after error...');
                  getPriceProposal();
                }, 2000);
              }
              return;
            }

            if (data.proposal.id && data.proposal.ask_price) {
              console.log('✅ Valid proposal received:');
              console.log(`   - ID: ${data.proposal.id}`);
              console.log(`   - Price: ${data.proposal.ask_price}`);
              console.log(`   - Payout: ${data.proposal.payout}`);
              console.log(`   - Display value: ${data.proposal.display_value}`);
              
              setProposalId(data.proposal.id);

              if (isTrading && isDirectTrading && !isExecutingTrade) {
                console.log('🚀 All conditions met - buying contract immediately');
                console.log('Buy conditions check:', {
                  isTrading,
                  isDirectTrading,
                  isExecutingTrade,
                  proposalId: data.proposal.id
                });
                
                // Buy immediately without delay
                buyContract(data.proposal.id);
              } else {
                console.log('⚠️ Cannot buy - conditions not met:', {
                  isTrading,
                  isDirectTrading,
                  isExecutingTrade
                });
              }
            } else {
              console.log('⚠️ Invalid proposal received - missing required fields:');
              console.log(`   - Has ID: ${!!data.proposal.id}`);
              console.log(`   - Has ask_price: ${!!data.proposal.ask_price}`);
              console.log('   - Full proposal:', data.proposal);
              
              if (isTrading && isDirectTrading) {
                setTimeout(() => {
                  console.log('🔄 Retrying due to invalid proposal...');
                  getPriceProposal();
                }, 1000);
              }
            }
          }

          // Handle buy response
          if (data.buy) {
            console.log('✅ Contract purchased successfully:', JSON.stringify(data.buy, null, 2));
            
            // Clear any pending timeout
            if ((window as any).buyTimeoutId) {
              clearTimeout((window as any).buyTimeoutId);
              (window as any).buyTimeoutId = null;
            }
            
            setIsExecutingTrade(false);
            setIsRequestingProposal(false);
            setProposalId(null);
            setError(null);

            const contractId = data.buy.contract_id;
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

            if (isTrading && isDirectTrading) {
              setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
              setTotalTrades(prev => {
                const newTotal = prev + 1;
                console.log(`📊 Total trades incremented to: ${newTotal}`);
                return newTotal;
              });

              // Store active contract for potential selling
              if (contractId) {
                setActiveContracts(prev => {
                  const newMap = new Map(prev);
                  newMap.set(contractId, {
                    ...trade,
                    contractId,
                    buyPrice: data.buy.buy_price,
                    startTime: Date.now()
                  });
                  console.log(`📊 Active contracts: ${newMap.size}`);
                  return newMap;
                });
              }
            }

            if (contractId) {
              try {
                const contractRequest = {
                  proposal_open_contract: 1,
                  contract_id: contractId,
                  subscribe: 1,
                  req_id: Date.now() + 3000
                };
                ws.send(JSON.stringify(contractRequest));
                console.log('📈 Subscribed to contract updates for contract:', contractId);
              } catch (error) {
                console.error('❌ Error subscribing to contract:', error);
              }
            }

            console.log('✅ Trade completed successfully - ready for next condition');
          }

          // Handle sell response
          if (data.sell) {
            console.log('✅ Contract sold successfully:', data.sell);
            const contractId = data.sell.contract_id;
            
            // Remove from active contracts
            setActiveContracts(prev => {
              const newMap = new Map(prev);
              newMap.delete(contractId);
              return newMap;
            });

            // Update trade history
            const sellPrice = parseFloat(data.sell.sell_price || 0);
            const buyPrice = parseFloat(data.sell.buy_price || 0);
            const profit = sellPrice - buyPrice;

            setTradeHistory(prev => {
              const updated = [...prev];
              const tradeIndex = updated.findIndex(t => t.result === 'pending');
              if (tradeIndex !== -1) {
                updated[tradeIndex] = {
                  ...updated[tradeIndex],
                  result: profit > 0 ? 'win' : 'loss',
                  profit: profit
                };
              }
              return updated;
            });

            if (profit > 0) {
              setWins(prev => prev + 1);
              setCurrentStake(stake);
            } else {
              setLosses(prev => prev + 1);
              if (useMartingale) {
                setCurrentStake(prev => prev * martingaleMultiplier);
              }
            }

            console.log(`📊 Contract sold: ${profit > 0 ? 'WIN' : 'LOSS'} Profit: ${profit}`);
          }

          // Handle buy errors
          if (data.error && (data.msg_type === 'buy' || data.error.details?.field === 'buy')) {
            console.error('❌ Buy contract error:', JSON.stringify(data.error, null, 2));
            
            // Clear any pending timeout
            if ((window as any).buyTimeoutId) {
              clearTimeout((window as any).buyTimeoutId);
              (window as any).buyTimeoutId = null;
            }
            
            setIsExecutingTrade(false);
            setIsRequestingProposal(false);
            setProposalId(null);

            if (data.error.code === 'InvalidContractProposal') {
              setError('Proposal expired - getting new proposal...');
              if (isTrading && isDirectTrading) {
                setTimeout(() => {
                  console.log('🔄 Getting new proposal after InvalidContractProposal error...');
                  getPriceProposal();
                }, 500);
              }
            } else if (data.error.code === 'InsufficientBalance') {
              setError(`Insufficient balance: ${data.error.message}`);
              setIsTrading(false);
              setIsDirectTrading(false);
            } else if (data.error.code === 'InvalidCurrency') {
              setError(`Invalid currency: ${data.error.message}`);
              setIsTrading(false);
              setIsDirectTrading(false);
            } else {
              setError(`Buy failed: ${data.error.message} (Code: ${data.error.code})`);
              if (isTrading && isDirectTrading) {
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
            const contractId = contract.contract_id;
            
            // Update active contract info
            if (contractId && activeContracts.has(contractId)) {
              setActiveContracts(prev => {
                const newMap = new Map(prev);
                const existingContract = newMap.get(contractId);
                if (existingContract) {
                  newMap.set(contractId, {
                    ...existingContract,
                    currentProfit: parseFloat(contract.profit || 0),
                    currentPrice: parseFloat(contract.bid_price || 0),
                    status: contract.status
                  });
                }
                return newMap;
              });
            }

            // Auto-sell logic: sell if profit reaches certain threshold or after certain time
            if (contract.status === 'open' && contractId && activeContracts.has(contractId)) {
              const currentProfit = parseFloat(contract.profit || 0);
              const activeContract = activeContracts.get(contractId);
              
              if (activeContract) {
                const timeElapsed = Date.now() - activeContract.startTime;
                const profitThreshold = currentStake * 0.8; // 80% profit threshold
                const maxHoldTime = 45000; // 45 seconds max hold time
                
                // Sell conditions: good profit or max time reached
                if (currentProfit >= profitThreshold || timeElapsed >= maxHoldTime) {
                  console.log(`🎯 Auto-selling contract ${contractId}: Profit=${currentProfit}, Time=${timeElapsed}ms`);
                  sellContract(contractId);
                }
              }
            }

            // Handle natural contract completion
            if (contract.is_sold || contract.status === 'sold') {
              const profit = parseFloat(contract.profit || 0);
              const isWin = profit > 0;

              // Remove from active contracts
              if (contractId) {
                setActiveContracts(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(contractId);
                  return newMap;
                });
              }

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

              if (tradeWasUpdated) {
                if (isWin) {
                  setWins(prev => prev + 1);
                  setCurrentStake(stake);
                } else {
                  setLosses(prev => prev + 1);
                  if (useMartingale) {
                    setCurrentStake(prev => prev * martingaleMultiplier);
                  }
                }
              }

              console.log(`📊 Contract completed:`, isWin ? 'WIN' : 'LOSS', `Profit: ${profit}`, `Trade counted: ${tradeWasUpdated}`);
            }
          }

          if (data.tick && data.tick.symbol === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));
            
            console.log(`🎯 TICK RECEIVED: ${data.tick.quote} for ${data.tick.symbol}`);
            console.log(`🎯 Current states:`, {
              isTrading,
              isDirectTrading,
              isExecutingTrade,
              isRequestingProposal,
              selectedContractType,
              overUnderValue
            });
            
            // Enhanced tick processing with validation
            if (isTrading && isDirectTrading && !isExecutingTrade && !isRequestingProposal) {
              // Get the last digit from the price - handle decimal places properly
              const priceStr = price.toString();
              const digits = priceStr.replace('.', ''); // Remove decimal point
              const lastDigit = parseInt(digits[digits.length - 1]);
              
              console.log(`📊 Processing tick: ${data.tick.quote}`);
              console.log(`   - Price: ${price}`);
              console.log(`   - Price string: "${priceStr}"`);
              console.log(`   - Digits: "${digits}"`);
              console.log(`   - Last digit: ${lastDigit}`);
              console.log(`   - Contract type: ${selectedContractType}`);
              console.log(`   - Over/Under value: ${overUnderValue}`);
              
              if (isNaN(lastDigit)) {
                console.error('❌ Invalid last digit from tick:', data.tick.quote);
                return;
              }
              
              // Check condition based on contract type
              const conditionMet = isGoodCondition(lastDigit, selectedContractType);
              console.log(`🎲 Condition check: digit=${lastDigit}, type=${selectedContractType}, barrier=${overUnderValue}, result=${conditionMet}`);
              
              if (conditionMet) {
                console.log('✅ CONDITION MET - requesting proposal immediately!');
                console.log(`🚀 Trading: ${selectedContractType} with digit ${lastDigit} ${selectedContractType === 'DIGITOVER' ? '>' : selectedContractType === 'DIGITUNDER' ? '<' : selectedContractType === 'DIGITMATCH' ? '===' : selectedContractType === 'DIGITDIFF' ? '!==' : 'vs'} ${overUnderValue}`);
                // Request proposal immediately without delay
                getPriceProposal();
              } else {
                console.log(`⏳ Condition not met - waiting for right condition... (current digit: ${lastDigit})`);
                if (selectedContractType === 'DIGITOVER') {
                  console.log(`   Need digit > ${overUnderValue}, got ${lastDigit}`);
                } else if (selectedContractType === 'DIGITUNDER') {
                  console.log(`   Need digit < ${overUnderValue}, got ${lastDigit}`);
                } else if (selectedContractType === 'DIGITMATCH') {
                  console.log(`   Need digit === ${overUnderValue}, got ${lastDigit}`);
                } else if (selectedContractType === 'DIGITDIFF') {
                  console.log(`   Need digit !== ${overUnderValue}, got ${lastDigit}`);
                }
              }
            } else {
              const reasons = [];
              if (!isTrading) reasons.push('not trading');
              if (!isDirectTrading) reasons.push('not direct trading');
              if (isExecutingTrade) reasons.push('executing trade');
              if (isRequestingProposal) reasons.push('requesting proposal');
              
              console.log(`⏸️ Skipping tick processing: ${reasons.join(', ')}`);
            }
          }

          if (data.history && data.history.prices) {
            const lastPrice = parseFloat(data.history.prices[data.history.prices.length - 1]);
            setCurrentPrice(lastPrice.toFixed(5));
          }
        } catch (error) {
          console.error('Error parsing message:', error);
          setError('Failed to parse server response');
        }
      };

      ws.onclose = (event) => {
        console.log(`🔗 WebSocket connection closed - Code: ${event.code}, Reason: ${event.reason}`);
        setIsConnected(false);
        setIsAuthorized(false);
        setWebsocket(null);
        setIsExecutingTrade(false);

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
        console.error('🔗 WebSocket error:', error);
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

  const startTrading = async () => {
    console.log('🚀 Starting Speed Bot with validation...');
    
    const authToken = getAuthToken();
    if (!authToken) {
      setError('Please log in to Deriv first. Go to deriv.com and sign in, then try again.');
      return;
    }

    if (!isValidCombination) {
      setError('Invalid trading configuration. Please check your settings.');
      return;
    }

    if (stake < 0.35) {
      setError('Minimum stake is 0.35 USD');
      return;
    }

    if (client?.balance !== undefined) {
      const balance = parseFloat(client.balance);
      if (balance < stake) {
        setError(`Insufficient balance. Current: ${balance} ${client.currency || 'USD'}, Required: ${stake}`);
        return;
      }
    }

    if (!isConnected || !isAuthorized) {
      setError('Please wait for connection and authorization before starting.');
      return;
    }

    try {
      setCurrentStake(stake);
      setIsTrading(true);
      setIsDirectTrading(true);
      setIsExecutingTrade(false);
      setIsRequestingProposal(false);
      setError(null);
      setLastTradeTime(0);

      console.log('✅ Speed Bot started successfully');
      console.log('🎯 Configuration:', {
        symbol: selectedSymbol,
        contractType: selectedContractType,
        stake: currentStake,
        overUnderValue,
        useMartingale,
        martingaleMultiplier
      });
    } catch (error) {
      console.error('❌ Error starting Speed Bot:', error);
      setError(`Failed to start Speed Bot: ${error.message}`);
      setIsTrading(false);
      setIsDirectTrading(false);
    }
  };

  const stopTrading = async () => {
    try {
      setIsTrading(false);
      setProposalId(null);
      setIsDirectTrading(false);
      setIsExecutingTrade(false);
      console.log('🛑 Speed Bot stopped');
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
    setActiveContracts(new Map());
  };

  useEffect(() => {
    connectToAPI();
    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [connectToAPI]);

  useEffect(() => {
    setCurrentStake(stake);
  }, [stake]);

  useEffect(() => {
    if (client?.balance !== undefined) {
      setBalance(parseFloat(client.balance));
    }
  }, [client?.balance]);

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

        <div className="speed-bot__toggles">
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
        </div>

        <div className="speed-bot__control-buttons">
          {!isTrading ? (
            <button 
              className="speed-bot__start-btn"
              onClick={startTrading}
              disabled={!!error || !client?.is_logged_in}
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
          {isTrading && isAuthorized && (
            <button 
              className="speed-bot__test-btn"
              onClick={getPriceProposal}
              disabled={isExecutingTrade || isRequestingProposal}
              style={{ backgroundColor: '#007cba', color: 'white', marginLeft: '10px' }}
            >
              Test Proposal
            </button>
          )}
        </div>

        {/* Active Contracts Section */}
        {activeContracts.size > 0 && (
          <div className="speed-bot__active-contracts">
            <h3>Active Contracts ({activeContracts.size})</h3>
            <div className="speed-bot__contracts-list">
              {Array.from(activeContracts.entries()).map(([contractId, contract]) => (
                <div key={contractId} className="speed-bot__contract-item">
                  <div className="speed-bot__contract-info">
                    <span className="speed-bot__contract-id">
                      {contractId.substring(0, 8)}...
                    </span>
                    <span className="speed-bot__contract-symbol">
                      {contract.symbol} - {contract.contractType}
                    </span>
                    <span className="speed-bot__contract-profit">
                      Profit: {contract.currentProfit ? `$${contract.currentProfit.toFixed(2)}` : 'Calculating...'}
                    </span>
                  </div>
                  <button 
                    className="speed-bot__sell-btn"
                    onClick={() => sellContract(contractId)}
                    disabled={!isAuthorized}
                  >
                    Sell Now
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
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
          <div className="speed-bot__stat">
            <label>Execution State</label>
            <span>{isExecutingTrade ? '🔄 Executing' : '✅ Ready'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Proposal State</label>
            <span>{isRequestingProposal ? '📊 Requesting' : '✅ Ready'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Config Valid</label>
            <span>{isValidCombination ? '✅ Valid' : '❌ Invalid'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Active Contracts</label>
            <span>{activeContracts.size}</span>
          </div>
        </div>
        
        {/* Debug Information Panel - Remove after testing */}
        {isTrading && (
          <div className="speed-bot__debug" style={{ 
            background: '#f0f0f0', 
            padding: '10px', 
            margin: '10px 0', 
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            <h4>Debug Info (Remove in production)</h4>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify({
                websocketState: websocket?.readyState,
                isConnected,
                isAuthorized,
                isTrading,
                isDirectTrading,
                isExecutingTrade,
                isRequestingProposal,
                proposalId,
                currentStake,
                selectedSymbol,
                selectedContractType,
                overUnderValue,
                isValidCombination,
                lastTradeTime: lastTradeTime ? new Date(lastTradeTime).toLocaleTimeString() : 'Never'
              }, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="speed-bot__history">
        <h3>Recent Trades & Transactions</h3>
        <div className="speed-bot__trades">
          {tradeHistory.length === 0 ? (
            <div className="speed-bot__no-trades">No trades yet - Start trading to see transactions</div>
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
                    🔄 Processing transaction...
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
  } catch (error) {
    console.error('Speed Bot error:', error);
    return (
      <div className="speed-bot">
        <div className="speed-bot__error">
          <h3>Speed Bot Error</h3>
          <p>An error occurred while loading the Speed Bot. Please refresh the page and try again.</p>
          <p style={{ color: 'red', fontSize: '12px' }}>Error: {error.message}</p>
        </div>
      </div>
    );
  }
});

export default SpeedBot;
