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
  const [activeSubscriptions, setActiveSubscriptions] = useState<Set<string>>(new Set());

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

  // Enhanced validation function with contract-specific rules
  const isValidCombination = useMemo(() => {
    const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType);
    const needsTouch = ['ONETOUCH', 'NOTOUCH'].includes(selectedContractType);
    const needsRange = ['RANGE', 'UPORDOWN'].includes(selectedContractType);
    const isMultiplier = selectedContractType.startsWith('MULT');
    const isLookback = selectedContractType.startsWith('LB');
    const isAsian = selectedContractType.startsWith('ASIAN');

    // Validate barrier for digit contracts
    const validBarrier = needsBarrier ? overUnderValue >= 0 && overUnderValue <= 9 : true;

    // Validate touch/no-touch barriers
    const validTouchBarrier = needsTouch ? overUnderValue > 0 : true;

    // Validate range barriers
    const validRangeBarrier = needsRange ? overUnderValue > 0 && overUnderValue < 10 : true;

    // Validate multiplier parameters
    const validMultiplier = isMultiplier ? currentStake >= 1 && currentStake <= 2000 : true;

    // Validate lookback parameters
    const validLookback = isLookback ? currentStake >= 1 && currentStake <= 500 : true;

    // Validate Asian parameters
    const validAsian = isAsian ? currentStake >= 1 && currentStake <= 1000 : true;

    // General validations
    const validStake = currentStake > 0 && currentStake <= 1000;
    const validSymbol = selectedSymbol && selectedSymbol.length > 0;

    // Contract-specific stake limits
    const stakeLimit = isMultiplier ? 2000 : isLookback ? 500 : 1000;
    const validStakeForContract = currentStake > 0 && currentStake <= stakeLimit;

    return validBarrier && validTouchBarrier && validRangeBarrier && 
           validMultiplier && validLookback && validAsian && 
           validStakeForContract && validSymbol;
  }, [selectedContractType, overUnderValue, currentStake, selectedSymbol]);

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
  const buyContract = useCallback(async (proposalId: string, proposalPrice: number) => {
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
        price: proposalPrice,
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

  // Strategy condition check - PROPER LOGIC FOR TRADING
  const isGoodCondition = useCallback((lastDigit: number, contractType: string) => {
    console.log(`🎯 Condition check: lastDigit=${lastDigit}, contractType=${contractType}, overUnderValue=${overUnderValue}`);

    if (isNaN(lastDigit) || lastDigit < 0 || lastDigit > 9) {
      console.error('❌ Invalid last digit:', lastDigit);
      return false;
    }

    let result = false;

    switch (contractType) {
      case 'DIGITEVEN':
        result = lastDigit % 2 === 0; // 0, 2, 4, 6, 8
        break;
      case 'DIGITODD':
        result = lastDigit % 2 === 1; // 1, 3, 5, 7, 9
        break;
      case 'DIGITOVER':
        result = lastDigit > overUnderValue;
        break;
      case 'DIGITUNDER':
        result = lastDigit < overUnderValue;
        break;
      case 'DIGITMATCH':
        result = lastDigit === overUnderValue;
        break;
      case 'DIGITDIFF':
        result = lastDigit !== overUnderValue;
        break;
      default:
        result = false;
    }

    console.log(`🎯 Final condition result: ${result ? '✅ TRADE NOW' : '❌ SKIP'} (${contractType}: digit=${lastDigit}, barrier=${overUnderValue})`);
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

    // No rate limiting - execute on every tick
    console.log('⚡ No rate limiting - executing immediately on every tick');

    try {
      setIsRequestingProposal(true);

      const requestId = Date.now();
      const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType);

      // Enhanced proposal request with additional parameters
      const proposalRequest = {
        proposal: 1,
        amount: currentStake,
        basis: 'stake',
        contract_type: selectedContractType,
        currency: 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: selectedSymbol,
        req_id: requestId,
        ...(needsBarrier && { barrier: overUnderValue }),
        // Additional contract parameters
        ...(selectedContractType === 'RANGE' && { 
          barrier: overUnderValue,
          barrier2: overUnderValue + 1 
        }),
        ...(selectedContractType === 'UPORDOWN' && { 
          barrier: overUnderValue,
          barrier2: overUnderValue + 1 
        }),
        ...(selectedContractType === 'ONETOUCH' && { barrier: overUnderValue }),
        ...(selectedContractType === 'NOTOUCH' && { barrier: overUnderValue }),
        ...(selectedContractType.startsWith('MULT') && { 
          multiplier: 10,
          amount: currentStake,
          basis: 'stake'
        }),
        ...(selectedContractType.startsWith('LB') && { 
          duration: 5,
          duration_unit: 't'
        }),
        ...(selectedContractType.startsWith('ASIAN') && { 
          duration: 5,
          duration_unit: 't'
        }),
        // Add product type for specific contracts
        ...(selectedContractType.startsWith('MULT') && { product_type: 'basic' }),
        // Trading period parameters
        trading_period_start: Math.floor(Date.now() / 1000),
        // Risk management parameters
        ...(selectedContractType.startsWith('MULT') && { 
          limit_order: {
            stop_loss: currentStake * 2,
            take_profit: currentStake * 3
          }
        })
      };

      console.log('📊 Sending proposal request:', JSON.stringify(proposalRequest, null, 2));
      websocket.send(JSON.stringify(proposalRequest));

      // Clear request flag after timeout
      const proposalTimeoutId = setTimeout(() => {
        console.log('⏰ Proposal request timeout - clearing flags');
        setIsRequestingProposal(false);
        setProposalId(null);

        // Retry if still trading and no active execution
        if (isTrading && isDirectTrading && !isExecutingTrade) {
          console.log('🔄 Retrying proposal request after timeout...');
          // Don't use setTimeout for retry, try immediately
          getPriceProposal();
        }
      }, 5000); // Increased timeout to 5 seconds for better reliability

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

  // Rate limiting for forget_all requests and tick history
  const [lastForgetAllTime, setLastForgetAllTime] = useState(0);
  const [lastTickHistoryTime, setLastTickHistoryTime] = useState(0);
  const [hasRequestedTickHistory, setHasRequestedTickHistory] = useState(false);

  // Function to unsubscribe from all active subscriptions with rate limiting
  const unsubscribeAll = useCallback((ws: WebSocket) => {
    if (ws && ws.readyState === WebSocket.OPEN && activeSubscriptions.size > 0) {
      // Rate limit forget_all requests to maximum once per 2 seconds
      const now = Date.now();
      if (now - lastForgetAllTime < 2000) {
        console.log('⏳ Rate limiting forget_all request - skipping');
        return;
      }

      try {
        const forgetAllRequest = {
          forget_all: 'ticks',
          req_id: Date.now()
        };
        console.log('🔄 Unsubscribing from all active subscriptions:', Array.from(activeSubscriptions));
        ws.send(JSON.stringify(forgetAllRequest));
        setActiveSubscriptions(new Set());
        setLastForgetAllTime(now);
      } catch (error) {
        console.error('❌ Error unsubscribing from all subscriptions:', error);
      }
    }
  }, [activeSubscriptions, lastForgetAllTime]);

  // WebSocket connection
  const connectToAPI = useCallback(() => {
    try {
      if (websocket && websocket.readyState === WebSocket.OPEN && isTrading) {
        return;
      }

      if (websocket) {
        // Unsubscribe from all active subscriptions before closing
        unsubscribeAll(websocket);
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
              // Check if already subscribed to this symbol
              if (!activeSubscriptions.has(selectedSymbol)) {
                // First, subscribe to live ticks for real-time updates
                const liveTickRequest = {
                  ticks: selectedSymbol,
                  subscribe: 1,
                  req_id: Date.now() + 2000
                };
                console.log('📊 Sending live tick request:', JSON.stringify(liveTickRequest, null, 2));
                ws.send(JSON.stringify(liveTickRequest));
                console.log('📊 Live tick subscription requested for', selectedSymbol);
                
                // Add to active subscriptions
                setActiveSubscriptions(prev => new Set(prev).add(selectedSymbol));
              } else {
                console.log('📊 Already subscribed to', selectedSymbol, '- skipping subscription');
              }

              // Rate limit tick history requests - only request once per connection and symbol
              if (!hasRequestedTickHistory) {
                const now = Date.now();
                if (now - lastTickHistoryTime > 10000) { // 10 second rate limit
                  setTimeout(() => {
                    const tickHistoryRequest = {
                      ticks_history: selectedSymbol,
                      count: 5, // Reduced count to minimize rate limit impact
                      end: 'latest',
                      style: 'ticks',
                      req_id: Date.now() + 3000
                    };
                    console.log('📊 Sending tick history request:', JSON.stringify(tickHistoryRequest, null, 2));
                    ws.send(JSON.stringify(tickHistoryRequest));
                    console.log('📊 Tick history requested for', selectedSymbol);
                    setLastTickHistoryTime(now);
                    setHasRequestedTickHistory(true);
                  }, 1000); // Increased delay
                } else {
                  console.log('⏳ Rate limiting tick history request - too soon since last request');
                }
              } else {
                console.log('📊 Tick history already requested for this session - skipping');
              }
            } catch (error) {
              console.error('❌ Error requesting tick subscription:', error);
            }
          }, 500);
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

            // Set initial balance from authorize response if available
            if (data.authorize.balance) {
              const authBalance = parseFloat(data.authorize.balance);
              console.log('💰 Initial balance from auth:', authBalance);
              setBalance(authBalance);
            }

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
              // Add small delay to ensure balance is loaded
              setTimeout(() => {
                console.log('🚀 Starting trading after authorization...');
                getPriceProposal();
              }, 1000);
            }
          } else if (data.error && data.error.code === 'InvalidToken') {
            console.error('❌ Authorization failed:', data.error);
            setError(`Authorization failed: ${data.error.message}`);
            setIsAuthorized(false);
          }

          // Enhanced proposal success handling
          if (data.proposal && !data.error) {
            console.log('✅ Proposal received:', data.proposal);

            // Clear proposal timeout
            if ((window as any).proposalTimeoutId) {
              clearTimeout((window as any).proposalTimeoutId);
              delete (window as any).proposalTimeoutId;
            }

            const proposal = data.proposal;

            // Enhanced proposal validation
            if (!proposal.id) {
              console.error('❌ Invalid proposal: No ID');
              setError('Invalid proposal received. Retrying...');
              setTimeout(() => {
                if (isTrading) getPriceProposal();
              }, 1000);
              return;
            }

            // Price validation
            const proposalPrice = parseFloat(proposal.ask_price || proposal.payout);
            if (isNaN(proposalPrice) || proposalPrice <= 0) {
              console.error('❌ Invalid proposal price:', proposalPrice);
              setError('Invalid proposal price. Retrying...');
              setTimeout(() => {
                if (isTrading) getPriceProposal();
              }, 1000);
              return;
            }

            // Balance check against proposal price with better logging
            console.log('💰 Balance check:', { balance, proposalPrice, currentStake });
            if (balance < proposalPrice && balance > 0) {
              console.error('❌ Insufficient balance for proposal price');
              setError(`Insufficient balance for proposal. Required: ${proposalPrice.toFixed(2)}, Available: ${balance.toFixed(2)}`);
              setIsTrading(false);
              return;
            } else if (balance <= 0) {
              console.log('⚠️ Balance not yet loaded, proceeding with proposal');
            }

            // Contract-specific proposal validation
            if (selectedContractType.startsWith('MULT') && !proposal.multiplier) {
              console.error('❌ Multiplier proposal missing multiplier value');
              setError('Invalid multiplier proposal. Retrying...');
              setTimeout(() => {
                if (isTrading) getPriceProposal();
              }, 1000);
              return;
            }

            setProposalId(proposal.id);
            setIsRequestingProposal(false);
            setError(null);

            // Log proposal details
            console.log('📊 Proposal details:', {
              id: proposal.id,
              price: proposalPrice,
              payout: proposal.payout,
              contract_type: selectedContractType,
              symbol: selectedSymbol,
              spot: proposal.spot,
              ask_price: proposal.ask_price
            });

            // Auto-buy immediately if trading and direct trading enabled
            if (isTrading && isDirectTrading && proposal.id && !isExecutingTrade) {
              console.log('🚀 Auto-buying contract with proposal:', proposal.id);
              // Buy immediately without delay
              buyContract(proposal.id, proposalPrice);
            } else {
              console.log('⚠️ Not auto-buying:', {
                isTrading,
                isDirectTrading,
                hasProposalId: !!proposal.id,
                isExecutingTrade
              });
            }
          }

          // Handle buy response
          if (data.buy) {
            console.log('✅ Contract purchased successfully:', JSON.stringify(data.buy, null, 2));

            // Clear any pending timeouts
            if ((window as any).buyTimeoutId) {
              clearTimeout((window as any).buyTimeoutId);
              (window as any).buyTimeoutId = null;
            }

            if ((window as any).proposalTimeoutId) {
              clearTimeout((window as any).proposalTimeoutId);
              (window as any).proposalTimeoutId = null;
            }

            // Reset all execution states
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

            // Enhanced martingale logic with contract-specific adjustments
            if (profit > 0) {
              setWins(prev => prev + 1);
              if (useMartingale) {
                setCurrentStake(1); // Reset to base stake on win
              }
            } else {
              setLosses(prev => prev + 1);
              if (useMartingale) {
                // Contract-specific martingale adjustments
                const maxStake = selectedContractType.startsWith('MULT') ? 2000 : 
                                selectedContractType.startsWith('LB') ? 500 : 1000;

                const newStake = Math.min(currentStake * martingaleMultiplier, maxStake);

                // Additional safety check for balance
                if (newStake > balance) {
                  console.warn('⚠️ Martingale stake exceeds balance, using maximum available');
                  setCurrentStake(Math.floor(balance * 0.8)); // Use 80% of balance as safety margin
                } else {
                  setCurrentStake(newStake);
                }

                // Log martingale adjustment
                console.log('📈 Martingale adjustment:', {
                  previousStake: currentStake,
                  newStake: newStake,
                  maxStake: maxStake,
                  balance: balance,
                  contractType: selectedContractType
                });
              }
            }

            console.log(`📊 Contract sold: ${profit > 0 ? 'WIN' : 'LOSS'} Profit: ${profit}`);
          }

          // Handle proposal errors
          if (data.error && data.msg_type === 'proposal') {
            console.error('❌ Proposal error:', JSON.stringify(data.error, null, 2));
            
            // Clear proposal timeout
            if ((window as any).proposalTimeoutId) {
              clearTimeout((window as any).proposalTimeoutId);
              (window as any).proposalTimeoutId = null;
            }

            setIsRequestingProposal(false);
            setProposalId(null);

            if (data.error.code === 'InvalidSymbol') {
              setError(`Invalid symbol: ${data.error.message}`);
            } else if (data.error.code === 'InvalidContractType') {
              setError(`Invalid contract type: ${data.error.message}`);
            } else if (data.error.code === 'MarketIsClosed') {
              setError(`Market is closed: ${data.error.message}`);
            } else {
              setError(`Proposal failed: ${data.error.message} (Code: ${data.error.code})`);
            }

            // Retry after error if still trading
            if (isTrading && isDirectTrading) {
              setTimeout(() => {
                console.log('🔄 Retrying proposal after error...');
                getPriceProposal();
              }, 3000);
            }
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

          // Handle subscription confirmation for ticks
          if (data.msg_type === 'tick' && data.subscription) {
            console.log('✅ Tick subscription confirmed for:', data.subscription.id);
            setActiveSubscriptions(prev => new Set(prev).add(data.echo_req?.ticks || selectedSymbol));
          }

          // Handle forget_all response
          if (data.msg_type === 'forget_all') {
            console.log('✅ All subscriptions forgotten successfully');
            setActiveSubscriptions(new Set());
          }

          // Handle live tick updates
          if (data.tick && data.tick.symbol === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            const formattedPrice = price.toFixed(5);
            setCurrentPrice(formattedPrice);

            // Get the last digit from the price - handle decimal places properly
            const priceStr = data.tick.quote.toString();
            const lastDigit = parseInt(priceStr[priceStr.length - 1]);

            console.log(`🎯 LIVE TICK: ${data.tick.quote} | Last Digit: ${lastDigit} | Contract: ${selectedContractType} | Time: ${new Date().toLocaleTimeString()}`);
            console.log(`🎯 States: Trading=${isTrading}, Direct=${isDirectTrading}, Executing=${isExecutingTrade}, Requesting=${isRequestingProposal}, ProposalId=${proposalId}`);

            // Execute trade on EVERY tick - removed rate limiting and conditions
            if (isTrading && isDirectTrading && !isExecutingTrade && !isRequestingProposal && !proposalId) {
              if (isNaN(lastDigit)) {
                console.error('❌ Invalid last digit from tick:', data.tick.quote);
                return;
              }

              // Execute trade immediately on every tick
              console.log(`🚀🚀🚀 EXECUTING TRADE ON EVERY TICK! Contract: ${selectedContractType} | Digit: ${lastDigit} 🚀🚀🚀`);
              setLastTradeTime(Date.now());
              
              // Request proposal immediately on every tick
              getPriceProposal();
            } else {
              const reasons = [];
              if (!isTrading) reasons.push('not trading');
              if (!isDirectTrading) reasons.push('not direct trading');
              if (isExecutingTrade) reasons.push('executing trade');
              if (isRequestingProposal) reasons.push('requesting proposal');
              if (proposalId) reasons.push('has pending proposal');

              console.log(`⏸️ Skipping tick: ${reasons.join(', ')}`);
            }
          }

          // Handle tick history response
          if (data.history && data.history.prices && data.history.times) {
            const prices = data.history.prices;
            const lastPrice = parseFloat(prices[prices.length - 1]);
            setCurrentPrice(lastPrice.toFixed(5));
            console.log(`📊 Tick history received: Latest price ${lastPrice.toFixed(5)}`);
          }

          // Handle rate limit errors specifically
          if (data.error && data.error.code === 'RateLimit') {
            console.warn('⚠️ Rate limit reached:', data.error.message);
            setError(`Rate limit reached: ${data.error.message}. Reducing request frequency...`);
            
            // Don't retry immediately, wait longer
            if (data.msg_type === 'ticks_history') {
              console.log('📊 Tick history rate limited - will not retry');
              setHasRequestedTickHistory(true); // Prevent further requests
            }
            return; // Don't process as a regular error
          }

          // Handle other tick data formats
          if (data.msg_type === 'tick' && data.echo_req?.ticks === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));
            console.log(`📊 Alternative tick format: ${price.toFixed(5)}`);
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
        setActiveSubscriptions(new Set()); // Clear all subscriptions on close
        setHasRequestedTickHistory(false); // Reset tick history flag for new connection

        if (isTrading && !event.wasClean) {
          console.log('🔄 Auto-reconnecting in 5 seconds...');
          setTimeout(() => {
            if (isTrading) {
              connectToAPI();
            }
          }, 5000); // Increased reconnection delay
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

  // Resubscribe to ticks when symbol changes
  useEffect(() => {
    if (websocket && websocket.readyState === WebSocket.OPEN && isAuthorized) {
      try {
        console.log(`🔄 Symbol changed to ${selectedSymbol}, managing subscriptions...`);
        
        // Check if we're already subscribed to this symbol
        if (activeSubscriptions.has(selectedSymbol)) {
          console.log(`📊 Already subscribed to ${selectedSymbol} - skipping`);
          return;
        }

        // Rate limit symbol changes to prevent overwhelming the API
        const now = Date.now();
        if (now - lastForgetAllTime < 3000) { // 3 second minimum between symbol changes
          console.log('⏳ Rate limiting symbol change - too soon since last change');
          return;
        }

        // If we have other subscriptions, clear them first (with rate limiting)
        if (activeSubscriptions.size > 0 && !activeSubscriptions.has(selectedSymbol)) {
          console.log('🔄 Clearing existing subscriptions before subscribing to new symbol...');
          
          // Use forget_all with rate limiting
          unsubscribeAll(websocket);
          
          // Wait longer before subscribing to new symbol
          setTimeout(() => {
            if (websocket.readyState === WebSocket.OPEN) {
              const liveTickRequest = {
                ticks: selectedSymbol,
                subscribe: 1,
                req_id: Date.now()
              };
              websocket.send(JSON.stringify(liveTickRequest));
              console.log(`📊 Live tick subscription updated for ${selectedSymbol}`);
              setActiveSubscriptions(new Set([selectedSymbol]));
            }
          }, 2000); // Increased delay
        } else {
          // No existing subscriptions or already subscribed, subscribe directly
          const liveTickRequest = {
            ticks: selectedSymbol,
            subscribe: 1,
            req_id: Date.now()
          };
          websocket.send(JSON.stringify(liveTickRequest));
          console.log(`📊 Live tick subscription updated for ${selectedSymbol}`);
          setActiveSubscriptions(prev => new Set(prev).add(selectedSymbol));
        }
      } catch (error) {
        console.error('❌ Error resubscribing to ticks:', error);
      }
    }
  }, [selectedSymbol, websocket, isAuthorized, unsubscribeAll, lastForgetAllTime]);

  useEffect(() => {
    setCurrentStake(stake);
  }, [stake]);

  useEffect(() => {
    if (client?.balance !== undefined) {
      const newBalance = parseFloat(client.balance);
      console.log('💰 Balance updated from client store:', newBalance);
      setBalance(newBalance);
    }
  }, [client?.balance]);

  // Additional balance update from WebSocket
  useEffect(() => {
    if (balance > 0) {
      console.log('💰 Balance available:', balance, 'USD');
      setError(null); // Clear any balance-related errors
    }
  }, [balance]);

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
          {isAuthorized && (
            <button 
              className="speed-bot__test-btn"
              onClick={() => {
                console.log('🧪 Manual proposal test triggered');
                setError(null);
                setLastTradeTime(0); // Reset rate limit
                getPriceProposal();
              }}
              disabled={isExecutingTrade || isRequestingProposal}
              style={{ backgroundColor: '#007cba', color: 'white', marginLeft: '10px' }}
            >
              {isRequestingProposal ? 'Requesting...' : 'Test Trade Now'}
            </button>
          )}
          {isTrading && (
            <button 
              className="speed-bot__force-trade-btn"
              onClick={() => {
                console.log('🚀 Force trade triggered');
                setError(null);
                setLastTradeTime(0); // Reset rate limit
                if (!isExecutingTrade && !isRequestingProposal && !proposalId) {
                  getPriceProposal();
                } else {
                  console.log('⚠️ Cannot force trade - another operation in progress');
                }
              }}
              disabled={isExecutingTrade || isRequestingProposal || !!proposalId}
              style={{ backgroundColor: '#ff6b35', color: 'white', marginLeft: '10px' }}
            >
              Force Trade
            </button>
          )}
          {isConnected && !isAuthorized && (
            <button 
              className="speed-bot__reconnect-btn"
              onClick={connectToAPI}
              style={{ backgroundColor: '#ff6b35', color: 'white', marginLeft: '10px' }}
            >
              Reconnect & Auth
            </button>
          )}
          {isAuthorized && (isRequestingProposal || isExecutingTrade) && (
            <button 
              className="speed-bot__force-restart-btn"
              onClick={() => {
                console.log('🔄 Force restarting bot states...');
                setIsRequestingProposal(false);
                setIsExecutingTrade(false);
                setProposalId(null);
                setError(null);
                if (isTrading) {
                  setTimeout(() => {
                    getPriceProposal();
                  }, 500);
                }
              }}
              style={{ backgroundColor: '#e74c3c', color: 'white', marginLeft: '10px' }}
            >
              Force Restart
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
                lastTradeTime: lastTradeTime ? new Date(lastTradeTime).toLocaleTimeString() : 'Never',
                currentPrice,
                timeSinceLastTrade: lastTradeTime ? `${Math.floor((Date.now() - lastTradeTime) / 1000)}s ago` : 'Never'
              }, null, 2)}
            </pre>
            <div style={{ marginTop: '10px', padding: '5px', backgroundColor: '#e8f4fd', borderRadius: '3px' }}>
              <strong>🔧 Quick Actions:</strong>
              <br />
              • Click "Force Trade" to trigger a trade immediately
              <br />
              • Current price: {currentPrice} (last digit: {currentPrice.slice(-1)})
              <br />
              • Rate limit: DISABLED - Trading on every tick
            </div>
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