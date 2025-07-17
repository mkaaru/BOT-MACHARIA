// Trade verification helper function
const verifyTradeExecution = () => {
  console.log('🔍 TRADE VERIFICATION REPORT:');
  console.log('================================');
  console.log('🔗 WebSocket Status:', {
    connected: websocket?.readyState === WebSocket.OPEN,
    authorized: isAuthorized,
    url: 'wss://ws.derivws.com/websockets/v3?app_id=75771'
  });

  console.log('🔑 Authentication:', {
    clientLoggedIn: client?.is_logged_in,
    tokenAvailable: !!getAuthToken(),
    accountType: client?.is_virtual ? 'Demo' : 'Real',
    currency: client?.currency || 'USD',
    balance: balance
  });

  console.log('🎯 Trading Configuration:', {
    symbol: selectedSymbol,
    contractType: selectedContractType,
    stake: currentStake,
    barrier: overUnderValue,
    validConfig: isValidCombination
  });

  console.log('⚡ Execution States:', {
    isTrading,
    isDirectTrading,
    isExecutingTrade,
    isRequestingProposal,
    proposalId: proposalId ? 'Available' : 'None'
  });

  console.log('📊 Trade Statistics:', {
    totalTrades,
    activeContracts: activeContracts.size,
    totalPL: totalProfitLoss,
    lastTradeTime: lastTradeTime ? new Date(lastTradeTime).toISOString() : 'Never'
  });

  console.log('================================');

  // Check for common issues
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    console.error('❌ ISSUE: WebSocket not connected');
  }
  if (!isAuthorized) {
    console.error('❌ ISSUE: Not authorized');
  }
  if (!getAuthToken()) {
    console.error('❌ ISSUE: No authentication token');
  }
  if (!isValidCombination) {
    console.error('❌ ISSUE: Invalid trading configuration');
  }
  if (balance < currentStake) {
    console.error('❌ ISSUE: Insufficient balance');
  }
};


import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
import { speedBotTradeEngine } from './trade-engine';
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

  // Get token from client store with comprehensive token retrieval
  const getAuthToken = () => {
    console.log('🔍 Checking authentication...');
    console.log('Client object:', client);
    console.log('Is logged in:', client?.is_logged_in);

    if (!client?.is_logged_in) {
      console.log('❌ User not logged in');
      return null;
    }

    // Try multiple token sources in order of preference
    let token = null;

    // Method 1: Client store methods
    if (client.getToken && typeof client.getToken === 'function') {
      try {
        token = client.getToken();
        if (token) console.log('🔑 Token from getToken():', token.substring(0, 20) + '...');
      } catch (e) {
        console.log('⚠️ Error calling getToken():', e);
      }
    }

    // Method 2: Client properties
    if (!token && client.token) {
      token = client.token;
      console.log('🔑 Token from client.token:', token.substring(0, 20) + '...');
    }

    // Method 3: Authentication object
    if (!token && client.accounts) {
      const activeLoginId = client.loginid;
      if (activeLoginId && client.accounts[activeLoginId]?.token) {
        token = client.accounts[activeLoginId].token;
        console.log('🔑 Token from client.accounts:', token.substring(0, 20) + '...');
      }
    }

    // Method 4: Direct localStorage access with multiple key patterns
    if (!token) {
      try {
        // Try different localStorage key patterns
        const tokenSources = [
          'client.tokens',
          'authToken', 
          'accountsList',
          localStorage.getItem('active_loginid')
        ];

        for (const source of tokenSources) {
          if (!token && source) {
            const stored = localStorage.getItem(source);
            if (stored && stored !== 'null') {
              try {
                // Try parsing as JSON first
                const parsed = JSON.parse(stored);
                if (typeof parsed === 'object' && parsed) {
                  // Extract first available token
                  const tokenValue = Object.values(parsed)[0];
                  if (typeof tokenValue === 'string' && tokenValue.length > 10) {
                    token = tokenValue;
                    console.log(`🔑 Token from localStorage.${source}:`, token.substring(0, 20) + '...');
                    break;
                  }
                }
              } catch (e) {
                // Try as direct string
                if (stored.length > 10 && stored.startsWith('a1-')) {
                  token = stored;
                  console.log(`🔑 Token from localStorage.${source} (direct):`, token.substring(0, 20) + '...');
                  break;
                }
              }
            }
          }
        }
      } catch (e) {
        console.log('⚠️ Error reading from localStorage:', e);
      }
    }

    // Method 5: Check URL parameters as last resort
    if (!token) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        if (urlToken && urlToken.length > 10) {
          token = urlToken;
          console.log('🔑 Token from URL params:', token.substring(0, 20) + '...');
        }
      } catch (e) {
        console.log('⚠️ Error reading URL params:', e);
      }
    }

    if (token && token.length > 10) {
      console.log('✅ Authentication token found and validated');
      return token;
    } else {
      console.log('❌ No valid authentication token found');
      return null;
    }
  };

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string>('---');
  const [activeSubscriptions, setActiveSubscriptions] = useState<Set<string>>(new Set());

  // Trading configuration - Set defaults for Trade Every Tick requirements
  const [selectedSymbol, setSelectedSymbol] = useState('R_100'); // Volatility 100 Index
  const [selectedContractType, setSelectedContractType] = useState('DIGITODD'); // Odd prediction
  const [stake, setStake] = useState(0.5); // $0.5 stake
  const [overUnderValue, setOverUnderValue] = useState(5);
  const [isTrading, setIsTrading] = useState(false);

  // Strategy options - Configured for Trade Every Tick
  const [useMartingale, setUseMartingale] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.0); // Martingale Factor: 2

  // Risk Management - Set to specified thresholds
  const [takeProfit, setTakeProfit] = useState(5); // Take Profit: $5
  const [stopLoss, setStopLoss] = useState(30); // Stop Loss: $30
  const [totalProfitLoss, setTotalProfitLoss] = useState(0);
  const [alternateOnLoss, setAlternateOnLoss] = useState(true); // Alternate on Loss enabled
  const [isTradeEveryTick, setIsTradeEveryTick] = useState(true); // Trade Every Tick enabled by default

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
    const isEvenOdd = ['DIGITEVEN', 'DIGITODD'].includes(selectedContractType);
    const needsTouch = ['ONETOUCH', 'NOTOUCH'].includes(selectedContractType);
    const needsRange = ['RANGE', 'UPORDOWN'].includes(selectedContractType);
    const isMultiplier = selectedContractType.startsWith('MULT');
    const isLookback = selectedContractType.startsWith('LB');
    const isAsian = selectedContractType.startsWith('ASIAN');

    // Validate barrier for digit contracts (not needed for Even/Odd)
    const validBarrier = needsBarrier ? overUnderValue >= 0 && overUnderValue <= 9 : true;

    // Even/Odd contracts don't need barrier validation
    const validEvenOdd = isEvenOdd ? true : true;

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

    return validBarrier && validEvenOdd && validTouchBarrier && validRangeBarrier && 
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
      setError('WebSocket connection lost');
      return;
    }

    if (!isAuthorized) {
      console.error('❌ Cannot sell contract: Not authorized');
      setError('Not authorized - please check your login');
      return;
    }

    try {
      // Convert contractId to integer as required by the API schema
      const contractIdInt = parseInt(contractId, 10);
      if (isNaN(contractIdInt)) {
        console.error('❌ Invalid contract ID:', contractId);
        setError('Invalid contract ID format');
        return;
      }

      const sellRequest = {
        sell: contractIdInt, // API requires integer, not string
        price: 0, // Sell at market price (minimum price)
        req_id: Date.now()
      };

      console.log('📤 Selling contract:', JSON.stringify(sellRequest, null, 2));
      websocket.send(JSON.stringify(sellRequest));

      // Set a timeout for sell response
      const sellTimeoutId = setTimeout(() => {
        console.log('⏰ Sell request timeout for contract:', contractId);
        setError('Sell request timed out - contract may have expired');
      }, 10000);

      // Store timeout ID for cleanup
      (window as any)[`sellTimeout_${contractId}`] = sellTimeoutId;

    } catch (error) {
      console.error('❌ Error selling contract:', error);
      setError(`Failed to sell contract: ${error.message}`);
    }
  }, [websocket, isAuthorized]);

  // Enhanced Strategy condition check - TRADE EVERY TICK LOGIC
  const isGoodCondition = useCallback((lastDigit: number, contractType: string) => {
    const barrierText = ['DIGITEVEN', 'DIGITODD'].includes(contractType) ? 'N/A' : overUnderValue;
    console.log(`🎯 Condition check: lastDigit=${lastDigit}, contractType=${contractType}, barrier=${barrierText}`);

    if (isNaN(lastDigit) || lastDigit < 0 || lastDigit > 9) {
      console.error('❌ Invalid last digit:', lastDigit);
      return false;
    }

    // TRADE EVERY TICK MODE: Execute on every tick with predefined logic
    if (isTradeEveryTick) {
      console.log(`🚀 TRADE EVERY TICK: Processing tick with digit=${lastDigit}`);

      // For Trade Every Tick, we use the contract type to determine the trade decision
      switch (contractType) {
        case 'DIGITEVEN':
          // Trade Even on every tick - no barrier needed
          console.log(`🎯 Trade Every Tick: EVEN prediction for digit ${lastDigit}`);
          return true;
        case 'DIGITODD':
          // Trade Odd on every tick - no barrier needed
          console.log(`🎯 Trade Every Tick: ODD prediction for digit ${lastDigit}`);
          return true;
        case 'DIGITOVER':
          // Trade Over with barrier on every tick
          console.log(`🎯 Trade Every Tick: OVER ${overUnderValue} prediction for digit ${lastDigit}`);
          return true;
        case 'DIGITUNDER':
          // Trade Under with barrier on every tick
          console.log(`🎯 Trade Every Tick: UNDER ${overUnderValue} prediction for digit ${lastDigit}`);
          return true;
        case 'DIGITMATCH':
          // Trade Matches with specific digit on every tick
          console.log(`🎯 Trade Every Tick: MATCHES ${overUnderValue} prediction for digit ${lastDigit}`);
          return true;
        case 'DIGITDIFF':
          // Trade Differs from specific digit on every tick
          console.log(`🎯 Trade Every Tick: DIFFERS ${overUnderValue} prediction for digit ${lastDigit}`);
          return true;
        default:
          console.log(`🎯 Trade Every Tick: Unknown contract type ${contractType}, trading anyway`);
          return true;
      }
    }

    // CONDITION-BASED MODE: Traditional logic-based trading
    let result = false;

    switch (contractType) {
      case 'DIGITEVEN':
        // Even contracts: trade when last digit is even (0, 2, 4, 6, 8)
        result = lastDigit % 2 === 0;
        console.log(`🎯 EVEN check: digit ${lastDigit} is ${lastDigit % 2 === 0 ? 'EVEN' : 'ODD'} - ${result ? 'TRADE' : 'SKIP'}`);
        break;
      case 'DIGITODD':
        // Odd contracts: trade when last digit is odd (1, 3, 5, 7, 9)
        result = lastDigit % 2 === 1;
        console.log(`🎯 ODD check: digit ${lastDigit} is ${lastDigit % 2 === 1 ? 'ODD' : 'EVEN'} - ${result ? 'TRADE' : 'SKIP'}`);
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

    console.log(`🎯 Condition-based result: ${result ? '✅ TRADE NOW' : '❌ SKIP'} (${contractType}: digit=${lastDigit}, barrier=${barrierText})`);
    return result;
  }, [overUnderValue, isTradeEveryTick]);

  // Get price proposal using proper Deriv API format according to schema
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

    try {
      setIsRequestingProposal(true);
      setError(null); // Clear any previous errors

      const requestId = Date.now();
      const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType);

      // Build proposal request according to Deriv API schema
      const proposalRequest: any = {
        proposal: 1, // Must be 1 according to schema
        contract_type: selectedContractType, // Required: The proposed contract type
        currency: client?.currency || 'USD', // Required: Account currency
        symbol: selectedSymbol, // Required: Symbol (from active_symbols)
        amount: currentStake, // Stake amount
        basis: 'stake', // Type of amount
        duration: 1, // Duration quantity for 1 tick
        duration_unit: 't', // Duration unit: 't' for ticks
        req_id: requestId // Optional: Used to map request to response
      };

      // Add barrier for specific contract types according to schema (not needed for Even/Odd)
      if (needsBarrier && !['DIGITEVEN', 'DIGITODD'].includes(selectedContractType)) {
        proposalRequest.barrier = overUnderValue.toString();
      }

      // Handle specific contract types according to schema
      switch (selectedContractType) {
        case 'RANGE':
        case 'UPORDOWN':
          proposalRequest.barrier = overUnderValue.toString();
          proposalRequest.barrier2 = (overUnderValue + 1).toString();
          break;

        case 'ONETOUCH':
        case 'NOTOUCH':
          proposalRequest.barrier = overUnderValue.toString();
          break;

        case 'MULTUP':
        case 'MULTDOWN':
          proposalRequest.multiplier = 10;
          proposalRequest.product_type = 'basic';
          proposalRequest.limit_order = {
            stop_loss: currentStake * 2,
            take_profit: currentStake * 3
          };
          break;

        case 'LBHIGHLOW':
        case 'LBFLOATCALL':
        case 'LBFLOATPUT':
        case 'ASIANU':
        case 'ASIAND':
          proposalRequest.duration = 5;
          proposalRequest.duration_unit = 't';
          break;
      }

      console.log('📊 Sending Deriv API proposal request:', JSON.stringify(proposalRequest, null, 2));
      websocket.send(JSON.stringify(proposalRequest));

      // Set timeout for proposal response - longer timeout for stability
      const proposalTimeoutId = setTimeout(() => {
        console.log('⏰ Proposal request timeout - clearing flags and retrying');
        setIsRequestingProposal(false);
        setProposalId(null);
        setError('Proposal timeout - retrying...');

        // Retry if still trading
        if (isTrading && isDirectTrading && !isExecutingTrade) {
          setTimeout(() => {
            console.log('🔄 Retrying proposal after timeout...');
            getPriceProposal();
          }, 1000);
        }
      }, 5000); // Increased timeout for better reliability

      // Store timeout ID for cleanup
      (window as any).proposalTimeoutId = proposalTimeoutId;

    } catch (error) {
      console.error('❌ Error getting proposal:', error);
      setError(`Proposal error: ${error.message}`);
      setIsRequestingProposal(false);

      // Retry on error
      if (isTrading && isDirectTrading) {
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

          // Subscribe to ticks using Deriv API Ticks Stream schema
          setTimeout(() => {
            try {
              // Check if already subscribed to this symbol
              if (!activeSubscriptions.has(selectedSymbol)) {
                // Subscribe to live ticks according to Deriv API schema
                const ticksStreamRequest = {
                  ticks: selectedSymbol, // Required: The short symbol name
                  subscribe: 1, // Optional: Set to 1 for continuous updates
                  req_id: Date.now() + 2000 // Optional: Used to map request to response
                };
                console.log('📊 Sending Deriv API compliant ticks stream request:', JSON.stringify(ticksStreamRequest, null, 2));
                ws.send(JSON.stringify(ticksStreamRequest));
                console.log('📊 Ticks stream subscription requested for', selectedSymbol);

                // Add to active subscriptions
                setActiveSubscriptions(prev => new Set(prev).add(selectedSymbol));
              } else {
                console.log('📊 Already subscribed to', selectedSymbol, '- skipping subscription');
              }

              // Optional: Get initial tick history (rate limited)
              if (!hasRequestedTickHistory) {
                const now = Date.now();
                if (now - lastTickHistoryTime > 10000) { // 10 second rate limit
                  setTimeout(() => {
                    const tickHistoryRequest = {
                      ticks_history: selectedSymbol,
                      count: 5, // Minimal count for initial data
                      end: 'latest',
                      style: 'ticks',
                      req_id: Date.now() + 3000
                    };
                    console.log('📊 Sending tick history request:', JSON.stringify(tickHistoryRequest, null, 2));
                    ws.send(JSON.stringify(tickHistoryRequest));
                    console.log('📊 Tick history requested for', selectedSymbol);
                    setLastTickHistoryTime(now);
                    setHasRequestedTickHistory(true);
                  }, 1000);
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

              // If we have a proposal but not buying, clear it to allow new proposals
              if (proposal.id && !isExecutingTrade) {
                console.log('🔄 Clearing stuck proposal to allow new requests');
                setProposalId(null);
                setIsRequestingProposal(false);
              }
            }
          }

          // Handle buy response with comprehensive logging
          if (data.buy) {
            console.log('🎉 CONTRACT PURCHASED SUCCESSFULLY! 🎉');
            console.log('📋 Purchase Details:', JSON.stringify(data.buy, null, 2));

            // Extract purchase information
            const contractId = data.buy.contract_id?.toString();
            const buyPrice = parseFloat(data.buy.buy_price || currentStake);
            const payout = parseFloat(data.buy.payout || 0);
            const transactionId = data.buy.transaction_id;

            console.log('✅ TRADE EXECUTION CONFIRMED:', {
              contractId,
              buyPrice,
              payout,
              transactionId,
              symbol: selectedSymbol,
              contractType: selectedContractType,
              stake: currentStake,
              timestamp: new Date().toISOString()
            });

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

            // Update trade history and statistics
            setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
            setTotalTrades(prev => {
              const newTotal = prev + 1;
              console.log(`📊 TOTAL TRADES COUNT: ${newTotal}`);
              return newTotal;
            });

            // Store active contract for monitoring with proper contract ID handling
            if (contractId) {
              const contractData = {
                ...trade,
                contractId,
                buyPrice,
                startTime: Date.now(),
                payout,
                currentProfit: 0,
                currentPrice: 0,
                status: 'open'
              };

              setActiveContracts(prev => {
                const newMap = new Map(prev);
                newMap.set(contractId, contractData);
                console.log(`📊 ACTIVE CONTRACTS COUNT: ${newMap.size}`);
                console.log(`📊 Active contract added:`, {
                  contractId,
                  buyPrice,
                  payout,
                  symbol: selectedSymbol,
                  contractType: selectedContractType
                });
                return newMap;
              });

              // Subscribe to contract updates with proper error handling
              try {
                const contractRequest = {
                  proposal_open_contract: 1,
                  contract_id: parseInt(contractId, 10), // API expects integer
                  subscribe: 1,
                  req_id: Date.now() + 3000
                };
                console.log('📈 Subscribing to contract updates:', JSON.stringify(contractRequest, null, 2));
                ws.send(JSON.stringify(contractRequest));
                console.log('📈 Subscribed to contract updates for:', contractId);
              } catch (error) {
                console.error('❌ Error subscribing to contract updates:', error);
              }
            } else {
              console.error('❌ No contract ID received from buy response');
            }

            // Show success message to user
            setError(`✅ Trade executed! Contract ID: ${contractId?.substring(0, 8)}...`);

            console.log('🚀 TRADE EXECUTION COMPLETE - Bot ready for next opportunity');
            console.log('📊 Current Status:', {
              totalTrades: totalTrades + 1,
              activeContracts: activeContracts.size + 1,
              totalPL: totalProfitLoss,
              isTrading: isTrading,
              isDirectTrading: isDirectTrading
            });
          }

          // Handle sell response according to Deriv API schema
          if (data.sell) {
            console.log('✅ Contract sold successfully:', JSON.stringify(data.sell, null, 2));

            // Clear any pending sell timeout
            const contractIdStr = data.sell.contract_id?.toString();
            if (contractIdStr && (window as any)[`sellTimeout_${contractIdStr}`]) {
              clearTimeout((window as any)[`sellTimeout_${contractIdStr}`]);
              delete (window as any)[`sellTimeout_${contractIdStr}`];
            }

            // Extract sell receipt data according to API schema
            const sellReceipt = data.sell;
            const contractId = sellReceipt.contract_id;
            const transactionId = sellReceipt.transaction_id;
            const balanceAfter = parseFloat(sellReceipt.balance_after || 0);
            const sellPrice = parseFloat(sellReceipt.sell_price || 0);
            const buyPrice = parseFloat(sellReceipt.buy_price || 0);
            const profit = sellPrice - buyPrice;

            console.log('📊 Sell Receipt Details:', {
              contractId,
              transactionId,
              sellPrice,
              buyPrice,
              profit,
              balanceAfter
            });

            // Update balance from sell response
            if (balanceAfter > 0) {
              setBalance(balanceAfter);
              console.log('💰 Balance updated from sell response:', balanceAfter);
            }

            // Remove from active contracts
            setActiveContracts(prev => {
              const newMap = new Map(prev);
              newMap.delete(contractId?.toString());
              return newMap;
            });

            // Update trade history with sell results
            setTradeHistory(prev => {
              const updated = [...prev];
              const tradeIndex = updated.findIndex(t => t.result === 'pending');
              if (tradeIndex !== -1) {
                updated[tradeIndex] = {
                  ...updated[tradeIndex],
                  result: profit > 0 ? 'win' : 'loss',
                  profit: profit
                };
                console.log('📊 Trade history updated:', updated[tradeIndex]);
              }
              return updated;
            });

            // Update total profit/loss
            const newTotalProfitLoss = totalProfitLoss + profit;
            setTotalProfitLoss(newTotalProfitLoss);

            // Enhanced trade result processing
            if (profit > 0) {
              setWins(prev => prev + 1);
              console.log('🟢 MANUAL SELL - WIN:', {
                profit: profit.toFixed(2),
                totalPL: newTotalProfitLoss.toFixed(2)
              });

              if (useMartingale) {
                setCurrentStake(stake); // Reset to base stake on win
                console.log('📈 Martingale reset to base stake:', stake);
              }
            } else {
              setLosses(prev => prev + 1);
              console.log('🔴 MANUAL SELL - LOSS:', {
                profit: profit.toFixed(2),
                totalPL: newTotalProfitLoss.toFixed(2)
              });

              // Apply martingale and alternate on loss logic for manual sells too
              if (alternateOnLoss) {
                console.log('🔄 ALTERNATE ON LOSS: Switching contract type due to manual sell loss');
                setSelectedContractType(prev => {
                  const alternates = {
                    'DIGITEVEN': 'DIGITODD',
                    'DIGITODD': 'DIGITEVEN',
                    'DIGITOVER': 'DIGITUNDER',
                    'DIGITUNDER': 'DIGITOVER',
                    'DIGITMATCH': 'DIGITDIFF',
                    'DIGITDIFF': 'DIGITMATCH'
                  };
                  const newType = alternates[prev] || prev;
                  console.log(`🔄 Contract type changed: ${prev} → ${newType}`);
                  return newType;
                });
              }

              if (useMartingale) {
                const maxStake = selectedContractType.startsWith('MULT') ? 2000 : 
                                selectedContractType.startsWith('LB') ? 500 : 1000;

                const newStake = Math.min(currentStake * martingaleMultiplier, maxStake);

                // Additional safety check for balance
                if (balance > 0 && newStake > balance * 0.9) {
                  console.warn('⚠️ Martingale stake exceeds 90% of balance, limiting to safe amount');
                  const safeStake = Math.max(stake, balance * 0.1);
                  setCurrentStake(safeStake);
                  console.log('📈 Martingale limited to safe stake:', safeStake);
                } else {
                  setCurrentStake(newStake);
                  console.log('📈 Martingale applied after manual sell:', {
                    previousStake: currentStake,
                    newStake,
                    multiplier: martingaleMultiplier
                  });
                }
              }
            }

            // Check risk management thresholds
            if (newTotalProfitLoss >= takeProfit) {
              console.log(`🎯 TAKE PROFIT TRIGGERED after manual sell! Total P/L: $${newTotalProfitLoss.toFixed(2)}`);
              setError(`✅ Take Profit reached at $${newTotalProfitLoss.toFixed(2)}! Bot stopped.`);
              setIsTrading(false);
              setIsDirectTrading(false);
            } else if (newTotalProfitLoss <= -Math.abs(stopLoss)) {
              console.log(`🛑 STOP LOSS TRIGGERED after manual sell! Total P/L: $${newTotalProfitLoss.toFixed(2)}`);
              setError(`❌ Stop Loss reached at $${newTotalProfitLoss.toFixed(2)}! Bot stopped.`);
              setIsTrading(false);
              setIsDirectTrading(false);
            }

            console.log(`📊 Manual sell completed: ${profit > 0 ? 'WIN' : 'LOSS'} | Profit: $${profit.toFixed(2)} | Total P/L: $${newTotalProfitLoss.toFixed(2)}`);
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

          // Handle sell errors according to API schema
          if (data.error && data.msg_type === 'sell') {
            console.error('❌ Sell contract error:', JSON.stringify(data.error, null, 2));

            // Clear any pending sell timeout
            if (data.echo_req?.sell) {
              const contractId = data.echo_req.sell.toString();
              if ((window as any)[`sellTimeout_${contractId}`]) {
                clearTimeout((window as any)[`sellTimeout_${contractId}`]);
                delete (window as any)[`sellTimeout_${contractId}`];
              }
            }

            if (data.error.code === 'InvalidContractId') {
              setError(`Invalid contract: ${data.error.message}`);
            } else if (data.error.code === 'ContractSoldAlready') {
              setError(`Contract already sold: ${data.error.message}`);
            } else if (data.error.code === 'ContractExpired') {
              setError(`Contract expired: ${data.error.message}`);
            } else if (data.error.code === 'InvalidSellPrice') {
              setError(`Invalid sell price: ${data.error.message}`);
            } else {
              setError(`Sell failed: ${data.error.message} (Code: ${data.error.code})`);
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
            const contractId = contract.contract_id?.toString();

            console.log('📈 Contract update received:', {
              contractId,
              status: contract.status,
              profit: contract.profit,
              bid_price: contract.bid_price,
              is_sold: contract.is_sold
            });

            // Update active contract info
            if (contractId && activeContracts.has(contractId)) {
              const currentProfit = parseFloat(contract.profit || 0);
              const currentPrice = parseFloat(contract.bid_price || 0);

              setActiveContracts(prev => {
                const newMap = new Map(prev);
                const existingContract = newMap.get(contractId);
                if (existingContract) {
                  const updatedContract = {
                    ...existingContract,
                    currentProfit,
                    currentPrice,
                    status: contract.status
                  };
                  newMap.set(contractId, updatedContract);
                  console.log(`📊 Contract ${contractId} updated: Profit=${currentProfit}, Price=${currentPrice}, Status=${contract.status}`);
                }
                return newMap;
              });

              // Auto-sell logic: sell if profit reaches certain threshold or after certain time
              if (contract.status === 'open') {
                const activeContract = activeContracts.get(contractId);
                if (activeContract) {
                  const timeElapsed = Date.now() - activeContract.startTime;
                  const profitThreshold = currentStake * 0.8; // 80% profit threshold
                  const maxHoldTime = 45000; // 45 seconds max hold time

                  // Sell conditions: good profit or max time reached
                  if (currentProfit >= profitThreshold || timeElapsed >= maxHoldTime) {
                    console.log(`🎯 Auto-selling contract ${contractId}: Profit=${currentProfit.toFixed(2)}, Time=${timeElapsed}ms`);
                    sellContract(contractId);
                  }
                }
              }
            } else if (contractId) {
              console.warn(`⚠️ Received update for unknown contract ID: ${contractId}`);
            }

            // Handle natural contract completion
            if (contract.is_sold || contract.status === 'sold' || contract.status === 'won' || contract.status === 'lost') {
              const profit = parseFloat(contract.profit || 0);
              const isWin = profit > 0;

              console.log(`🏁 Contract ${contractId} completed: ${isWin ? 'WIN' : 'LOSS'} | Profit: $${profit.toFixed(2)}`);

              // Remove from active contracts
              if (contractId) {
                setActiveContracts(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(contractId);
                  console.log(`📊 Contract ${contractId} removed from active contracts. Remaining: ${newMap.size}`);
                  return newMap;
                });
              }

              // Find and update the corresponding trade in history
              let tradeWasUpdated = false;
              setTradeHistory(prev => {
                const updated = [...prev];
                const tradeIndex = updated.findIndex(t => t.result === 'pending');
                if (tradeIndex !== -1) {
                  updated[tradeIndex] = {
                    ...updated[tradeIndex],
                    result: isWin ? 'win' : 'loss',
                    profit: profit
                  };
                  tradeWasUpdated = true;
                  console.log(`📊 Trade history updated for index ${tradeIndex}:`, updated[tradeIndex]);
                }
                return updated;
              });

              if (tradeWasUpdated) {
                // Update total profit/loss
                const newTotalProfitLoss = totalProfitLoss + profit;
                setTotalProfitLoss(newTotalProfitLoss);

                console.log(`📊 TRADE COMPLETED: ${isWin ? '🟢 WIN' : '🔴 LOSS'} | Profit: $${profit.toFixed(2)} | Total P/L: $${newTotalProfitLoss.toFixed(2)} | Mode: ${isTradeEveryTick ? 'EVERY TICK' : 'CONDITION'}`);

                // RISK MANAGEMENT: Check Take Profit and Stop Loss thresholds
                if (newTotalProfitLoss >= takeProfit) {
                  console.log(`🎯 TAKE PROFIT TRIGGERED! Total P/L: $${newTotalProfitLoss.toFixed(2)}. Stopping bot.`);
                  setError(`✅ Take Profit reached at $${newTotalProfitLoss.toFixed(2)}! Bot stopped.`);
                  setIsTrading(false);
                  setIsDirectTrading(false);
                  return;
                }

                if (newTotalProfitLoss <= -Math.abs(stopLoss)) {
                  console.log(`🛑 STOP LOSS TRIGGERED! Total P/L: $${newTotalProfitLoss.toFixed(2)}. Stopping bot.`);
                  setError(`❌ Stop Loss reached at $${newTotalProfitLoss.toFixed(2)}! Bot stopped.`);
                  setIsTrading(false);
                  setIsDirectTrading(false);
                  return;
                }

                // TRADE RESULT PROCESSING
                if (isWin) {
                  setWins(prev => prev + 1);
                  console.log(`🟢 WIN: Resetting stake to base amount $${stake}`);
                  // Reset stake to base amount on win
                  setCurrentStake(stake);
                } else {
                  setLosses(prev => prev + 1);

                  // ALTERNATE ON LOSS: Switch predictions if enabled
                  if (alternateOnLoss) {
                    console.log(`🔄 ALTERNATE ON LOSS: Switching contract type due to loss`);
                    setSelectedContractType(prev => {
                      const alternates = {
                        'DIGITEVEN': 'DIGITODD',
                        'DIGITODD': 'DIGITEVEN',
                        'DIGITOVER': 'DIGITUNDER',
                        'DIGITUNDER': 'DIGITOVER',
                        'DIGITMATCH': 'DIGITDIFF',
                        'DIGITDIFF': 'DIGITMATCH'
                      };
                      const newType = alternates[prev] || prev;
                      console.log(`🔄 Contract type changed: ${prev} → ${newType}`);
                      return newType;
                    });
                  }

                  // MARTINGALE STRATEGY: Apply stake multiplication if enabled
                  if (useMartingale) {
                    const maxStake = selectedContractType.startsWith('MULT') ? 2000 : 
                                    selectedContractType.startsWith('LB') ? 500 : 1000;
                    const newStake = Math.min(currentStake * martingaleMultiplier, maxStake);

                    // Additional safety check for balance
                    if (balance > 0 && newStake > balance * 0.9) {
                      console.warn(`⚠️ Martingale stake ${newStake} exceeds 90% of balance ${balance}, limiting to safe amount`);
                      const safeStake = Math.max(stake, balance * 0.1);
                      setCurrentStake(safeStake);
                      console.log(`📈 Martingale limited: Using safe stake $${safeStake}`);
                    } else {
                      setCurrentStake(newStake);
                      console.log(`📈 Martingale applied: Previous stake $${currentStake} → New stake $${newStake} (${martingaleMultiplier}x)`);
                    }
                  }
                }

                // Log detailed trade summary for Trade Every Tick mode
                if (isTradeEveryTick) {
                  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
                  console.log(`🚀 TRADE EVERY TICK SUMMARY: 
                    Result: ${isWin ? 'WIN' : 'LOSS'}
                    Profit: $${profit.toFixed(2)}
                    Total P/L: $${newTotalProfitLoss.toFixed(2)}
                    Current Stake: $${currentStake}
                    Win Rate: ${winRate}%
                    Trades: ${totalTrades + 1}
                    Contract: ${selectedContractType}
                  `);
                }
              }
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

          // Handle tick updates according to Deriv API Ticks Stream response schema
          if (data.tick && data.tick.symbol === selectedSymbol) {
            // Extract tick data according to schema
            const tickData = data.tick;
            const price = parseFloat(tickData.quote); // Market value at the epoch
            const epoch = tickData.epoch; // Epoch time of the tick
            const pipSize = tickData.pip_size; // Number of decimal points

            const formattedPrice = price.toFixed(Math.max(0, -Math.log10(pipSize)));
            setCurrentPrice(formattedPrice);

            // Get the last digit from the price quote for digit trading
            const priceStr = tickData.quote.toString();
            const lastDigit = parseInt(priceStr[priceStr.length - 1]);

            // Log tick data for high-frequency symbols
            if (selectedSymbol.includes('1HZ') && tickData.symbol === selectedSymbol) {
              console.log(`🔥 HIGH-FREQ TICK: ${selectedSymbol} = ${tickData.quote} | Epoch: ${epoch} | Last Digit: ${lastDigit} | Pip Size: ${pipSize}`);
            }

            console.log(`🎯 TICK RECEIVED: Quote=${tickData.quote} | Last Digit=${lastDigit} | Contract=${selectedContractType} | Time=${new Date(epoch * 1000).toLocaleTimeString()}`);
            console.log(`🎯 Bot States: Trading=${isTrading}, Direct=${isDirectTrading}, Executing=${isExecutingTrade}, Requesting=${isRequestingProposal}, ProposalId=${proposalId}`);

            // Handle existing proposal first
            if (proposalId && !isExecutingTrade) {
              console.log(`🎯 Found existing proposal ${proposalId}, executing buy immediately`);
              const approximatePrice = currentStake;
              buyContract(proposalId, approximatePrice);
              return;
            }

            // TRADE EVERY TICK LOGIC: Execute on every tick or based on conditions
            if (isTrading && isDirectTrading && !isExecutingTrade && !isRequestingProposal && !proposalId) {
              if (isNaN(lastDigit)) {
                console.error('❌ Invalid last digit from tick quote:', tickData.quote);
                return;
              }

              // Determine if we should trade
              const shouldTrade = isTradeEveryTick || isGoodCondition(lastDigit, selectedContractType);

              if (shouldTrade) {
                const tradeMode = isTradeEveryTick ? 'TRADE EVERY TICK' : 'CONDITION-BASED';
                console.log(`🚀🚀🚀 EXECUTING ${tradeMode}! Symbol: ${selectedSymbol} | Contract: ${selectedContractType} | Last Digit: ${lastDigit} | Quote: ${tickData.quote} | Epoch: ${epoch} | Total P/L: ${totalProfitLoss.toFixed(2)} 🚀🚀🚀`);

                setLastTradeTime(Date.now());

                // Request proposal immediately for this tick
                getPriceProposal();
              } else {
                console.log(`⏸️ Skipping tick - condition not met: lastDigit=${lastDigit}, contract=${selectedContractType}, quote=${tickData.quote}`);
              }
            } else {
              const reasons = [];
              if (!isTrading) reasons.push('not trading');
              if (!isDirectTrading) reasons.push('not direct trading');
              if (isExecutingTrade) reasons.push('executing trade');
              if (isRequestingProposal) reasons.push('requesting proposal');
              if (proposalId) reasons.push('has pending proposal');

              console.log(`⏸️ Skipping tick: ${reasons.join(', ')} | Quote: ${tickData.quote}`);
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

  const startTrading = useCallback(async () => {
    try {
      // Reset trade engine stats
      speedBotTradeEngine.resetStats();
      speedBotTradeEngine.setBaseAmount(stake);

      setIsTrading(true);
      setTotalRuns(0);
      setWinCount(0);
      setLossCount(0);
      setTotalProfit(0);
      setConsecutiveLosses(0);

      console.log('Started trading with settings:', {
        symbol: selectedSymbol,
        contractType: selectedContractType,
        stake,
        martingale: useMartingale,
        multiplier: martingaleMultiplier,
        tradeEveryTick: isTradeEveryTick,
        barrier: overUnderBarrier,
        engineConnected: speedBotTradeEngine.isEngineConnected()
      });

      // Check if trade engine is connected
      if (!speedBotTradeEngine.isEngineConnected()) {
        throw new Error('Trade engine not connected. Please check your connection.');
      }

    } catch (error) {
      console.error('Error starting trading:', error);
      setIsTrading(false);
      alert('Error starting trading: ' + error.message);
    }
  }, [selectedSymbol, selectedContractType, stake, useMartingale, martingaleMultiplier, isTradeEveryTick, overUnderBarrier]);

  const stopTrading = useCallback(() => {
    setIsTrading(false);
    setIsExecutingTrade(false);
    console.log('Trading stopped. Final stats:', {
      totalRuns: speedBotTradeEngine.getTotalRuns(),
      totalProfit: speedBotTradeEngine.getTotalProfit(),
      consecutiveLosses: speedBotTradeEngine.getConsecutiveLosses()
    });
  }, []);

  const resetStats = () => {
    setTradeHistory([]);
    setTotalTrades(0);
    setWins(0);
    setLosses(0);
    setCurrentStake(stake);
    setTotalProfitLoss(0);
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

  // Add missing state variables
  const [apiToken, setApiToken] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [totalRuns, setTotalRuns] = useState(0);
  const [winCount, setWinCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [lastTick, setLastTick] = useState(null);

  // Monitor connection status
  useEffect(() => {
    const checkConnection = () => {
      if (speedBotTradeEngine.isEngineConnected()) {
        setConnectionStatus(isAuthorized ? 'Connected & Authorized' : 'Connected');
      } else {
        setConnectionStatus('Disconnected');
        setIsAuthorized(false);
      }
    };

    const interval = setInterval(checkConnection, 1000);
    return () => clearInterval(interval);
  }, [isAuthorized]);

  // Authorization handler
  const handleAuthorization = async () => {
    if (!apiToken.trim()) {
      alert('Please enter your API token');
      return;
    }

    try {
      await speedBotTradeEngine.authorize(apiToken);
      setIsAuthorized(true);
      console.log('Successfully authorized');
    } catch (error) {
      console.error('Authorization failed:', error);
      alert('Authorization failed: ' + error.message);
      setIsAuthorized(false);
    }
  };

  // Monitor trade engine stats
  useEffect(() => {
    const updateStats = () => {
      if (speedBotTradeEngine.isEngineConnected()) {
        const engineStats = {
          totalRuns: speedBotTradeEngine.getTotalRuns(),
          totalProfit: speedBotTradeEngine.getTotalProfit(),
          consecutiveLosses: speedBotTradeEngine.getConsecutiveLosses(),
          lastTradeProfit: speedBotTradeEngine.getLastTradeProfit()
        };

        setTotalRuns(engineStats.totalRuns);
        setTotalProfit(engineStats.totalProfit);
        setConsecutiveLosses(engineStats.consecutiveLosses);

        // Update win/loss counts based on last trade
        if (engineStats.lastTradeProfit > 0) {
          setWinCount(prev => Math.max(prev, engineStats.totalRuns - speedBotTradeEngine.getConsecutiveLosses()));
        } else if (engineStats.lastTradeProfit < 0) {
          setLossCount(prev => Math.max(prev, engineStats.consecutiveLosses));
        }

        // Check stop conditions
        if (engineStats.totalProfit <= -stopLoss) {
          console.log('Stop loss reached');
          stopTrading();
        }

        if (engineStats.totalProfit >= takeProfit) {
          console.log('Take profit reached');
          stopTrading();
        }
      }
    };

    const interval = setInterval(updateStats, 1000);
    return () => clearInterval(interval);
  }, [stopLoss, takeProfit]);

  const executeTrade = useCallback(async () => {
    if (!isTrading || !lastTick) return;

    try {
      setIsExecutingTrade(true);

      // Calculate current stake with martingale if enabled
      let currentStake = stake;
      if (useMartingale && consecutiveLosses > 0) {
        currentStake = stake * Math.pow(martingaleMultiplier, consecutiveLosses);
      }

      // Determine contract type and parameters based on strategy
      let contractType = selectedContractType;
      let prediction;
      let barrier;

      if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
        // For even/odd, determine prediction from contract type
        prediction = contractType === 'DIGITEVEN' ? 0 : 1; // 0 for even, 1 for odd

        if (alternateOnLoss && consecutiveLosses > 0) {
          // Alternate contract type on loss
          contractType = contractType === 'DIGITEVEN' ? 'DIGITODD' : 'DIGITEVEN';
          prediction = contractType === 'DIGITEVEN' ? 0 : 1;
        }
      } else if (contractType === 'CALL' || contractType === 'PUT') {
        // For over/under, use barrier
        barrier = overUnderValue.toString();

        if (alternateOnLoss && consecutiveLosses > 0) {
          // Alternate contract type on loss
          contractType = contractType === 'CALL' ? 'PUT' : 'CALL';
        }
      }

      console.log('Executing trade:', {
        contractType,
        stake: currentStake,
        symbol: selectedSymbol,
        barrier,
        prediction
      });

      // Execute actual trade using the trade engine
      const tradeOptions = {
        symbol: selectedSymbol,
        contract_type: contractType,
        amount: currentStake,
        currency: 'USD', // You may want to make this configurable
        duration: 1,
        duration_unit: 't', // 1 tick
        ...(barrier && { barrier }),
        ...(prediction !== undefined && { prediction })
      };

      const tradeResult = await speedBotTradeEngine.executeTrade(tradeOptions);

      console.log('Trade executed successfully:', tradeResult);

      // The contract result will be handled by the trade engine's contract update handler
      // We'll update stats when the contract is settled

    } catch (error) {
      console.error('Trade execution error:', error);
      // On error, still count as a loss for martingale purposes
      setConsecutiveLosses(prev => prev + 1);
      setLossCount(prev => prev + 1);
      setTotalRuns(prev => prev + 1);
    } finally {
      setIsExecutingTrade(false);
    }
  }, [
    isTrading, 
    lastTick, 
    stake, 
    selectedContractType, 
    overUnderValue,
    useMartingale, 
    martingaleMultiplier, 
    consecutiveLosses,
    alternateOnLoss,
    selectedSymbol
  ]);

  // Auto trading effect
  useEffect(() => {
    if (isTrading && isTradeEveryTick && lastTick && !isExecutingTrade) {
      const tradeTimer = setTimeout(() => {
        executeTrade();
      }, 1000); // Wait 1 second between trades

      return () => clearTimeout(tradeTimer);
    }
  }, [isTrading, isTradeEveryTick, lastTick, isExecutingTrade, executeTrade]);


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

        {/* Trade Every Tick Information Panel */}
        {isTradeEveryTick && (
          <div style={{ 
            marginTop: '10px', 
            padding: '10px', 
            backgroundColor: '#e8f5e8', 
            border: '1px solid #4caf50', 
            borderRadius: '4px' 
          }}>
            <strong>🚀 TRADE EVERY TICK MODE ACTIVE</strong>
            <br />
            <small>
              • Market: {volatilitySymbols.find(s => s.value === selectedSymbol)?.label || selectedSymbol}
              <br />
              • Prediction: {contractTypes.find(c => c.value === selectedContractType)?.label || selectedContractType}
              {['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedContractType) && 
                ` (${overUnderValue})`
              }
              {['DIGITEVEN', 'DIGITODD'].includes(selectedContractType) && 
                ' (No barrier required)'
              }
              <br />
              • Stake: ${currentStake.toFixed(2)} USD
              <br />
              • Take Profit: ${takeProfit.toFixed(2)} USD | Stop Loss: ${stopLoss.toFixed(2)} USD
              <br />
              • Martingale: {useMartingale ? `Enabled (${martingaleMultiplier}x)` : 'Disabled'}
              <br />
              • Alternate on Loss: {alternateOnLoss ? 'Enabled' : 'Disabled'}
              <br />
              <strong>⚡ Trades on EVERY tick without waiting for previous trades to close</strong>
            </small>
          </div>
        )}
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

       <div className="speed-bot__authorization">
          <h3>API Authorization</h3>
          <div className="speed-bot__auth-status">
            <span className={`speed-bot__status ${connectionStatus.includes('Connected') ? 'connected' : 'disconnected'}`}>
              Status: {connectionStatus}
            </span>
          </div>
          <div className="speed-bot__form-row">
            <div className="speed-bot__form-group">
              <label>API Token</label>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Enter your Deriv API token"
                disabled={isAuthorized}
              />
            </div>
            <button
              className={`speed-bot__auth-btn ${isAuthorized ? 'authorized' : ''}`}
              onClick={handleAuthorization}
              disabled={isAuthorized || !speedBotTradeEngine.isEngineConnected()}
            >
              {isAuthorized ? 'Authorized' : 'Authorize'}
            </button>
          </div>
        </div>

        <div className="speed-bot__controls">
          <div className="speed-bot__form-row">
            <div className="speed-bot__form-group">
              <label>Symbol</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                disabled={isTrading}
              >
                <option value="R_10">Volatility 10 Index</option>
                <option value="R_25">Volatility 25 Index</option>
                <option value="R_50">Volatility 50 Index</option>
                <option value="R_75">Volatility 75 Index</option>
                <option value="R_100">Volatility 100 Index</option>
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
              value={['DIGITEVEN', 'DIGITODD'].includes(selectedContractType) ? '' : overUnderValue}
              onChange={(e) => setOverUnderValue(parseInt(e.target.value))}
              min="0"
              max="9"
              disabled={isTrading || ['DIGITEVEN', 'DIGITODD'].includes(selectedContractType)}
              placeholder={['DIGITEVEN', 'DIGITODD'].includes(selectedContractType) ? 'Not Required' : '0-9'}
              style={{
                backgroundColor: ['DIGITEVEN', 'DIGITODD'].includes(selectedContractType) ? '#f5f5f5' : 'white',
                cursor: ['DIGITEVEN', 'DIGITODD'].includes(selectedContractType) ? 'not-allowed' : 'text'
              }}
            />
          </div>
        </div>

        <div className="speed-bot__form-row">
          <div className="speed-bot__form-group">
            <label>Take Profit ($)</label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
              min="1"
              step="0.01"
              disabled={isTrading}
            />
          </div>
          <div className="speed-bot__form-group">
            <label>Stop Loss ($)</label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(parseFloat(e.target.value))}
              min="1"
              step="0.01"
              disabled={isTrading}
            />
          </div>
        </div>

        <div className="speed-bot__toggles">
          <div className="speed-bot__toggle-row">
            <label>Trade Every Tick</label>
            <input
              type="checkbox"
              checked={isTradeEveryTick}
              onChange={(e) => setIsTradeEveryTick(e.target.checked)}
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
          <div className="speed-bot__toggle-row">
            <label>Alternate on Loss</label>
            <input
              type="checkbox"
              checked={alternateOnLoss}
              onChange={(e) => setAlternateOnLoss(e.target.checked)}
              disabled={isTrading}
            />
          </div>
        </div>

        <div className="speed-bot__form-row">
          <div className="speed-bot__form-group">
            <label>Martingale Factor</label>
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
          <button
            className={`speed-bot__main-btn ${isTrading ? 'stop' : 'start'}`}
            onClick={isTrading ? stopTrading : startTrading}
            disabled={isExecutingTrade || !isAuthorized}
            title={!isAuthorized ? 'Please authorize with API token first' : ''}
          >
            {isTrading ? 'Stop Trading' : 'Start Trading'}
          </button>
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
                console.log('🚀 Force trade triggered - bypassing all conditions');
                setError(null);
                setLastTradeTime(0); // Reset rate limit
                if (!isExecutingTrade && !isRequestingProposal && !proposalId) {
                  console.log('💥 FORCE EXECUTING TRADE NOW!');
                  getPriceProposal();
                } else {
                  console.log('⚠️ Cannot force trade - clearing states and retrying...');
                  setIsExecutingTrade(false);
                  setIsRequestingProposal(false);
                  setProposalId(null);
                  setTimeout(() => getPriceProposal(), 100);
                }
              }}
              style={{ backgroundColor: '#ff6b35', color: 'white', marginLeft: '10px' }}
            >
              Force Trade
            </button>
          )}
          {proposalId && !isExecutingTrade && (
            <button 
              className="speed-bot__force-execute-btn"
              onClick={() => {
                console.log('⚡ Force executing with existing proposal:', proposalId);
                const approximatePrice = currentStake;
                buyContract(proposalId, approximatePrice);
              }}
              style={{ backgroundColor: '#28a745', color: 'white', marginLeft: '10px' }}
            >
              Execute Now
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
          <button 
            className="speed-bot__verify-btn"
            onClick={verifyTradeExecution}
            style={{ backgroundColor: '#9c27b0', color: 'white', marginLeft: '10px' }}
          >
            Verify Setup
          </button>
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
            <label>Total P/L</label>
            <span style={{ color: totalProfitLoss >= 0 ? 'green' : 'red' }}>
              ${totalProfitLoss.toFixed(2)}
            </span>
          </div>
          <div className="speed-bot__stat">
            <label>Take Profit</label>
            <span>${takeProfit.toFixed(2)}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Stop Loss</label>
            <span>-${stopLoss.toFixed(2)}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Trade Mode</label>
            <span>{isTradeEveryTick ? '🔥 Every Tick' : '🎯 Condition'}</span>
          </div>
          <div className="speed-bot__stat">
            <label>Execution State</label>
            <span>{isExecutingTrade ? '🔄 Executing' : '✅ Ready'}</span>
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

        {/* Enhanced Debug Information Panel */}
        {(isTrading || isConnected) && (
          <div className="speed-bot__debug" style={{ 
            background: isTrading ? '#e8f5e8' : '#f0f0f0', 
            padding: '15px', 
            margin: '10px 0', 
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            border: isTrading ? '2px solid #4caf50' : '1px solid #ccc'
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: isTrading ? '#2e7d32' : '#333' }}>
              🔍 Real-Time Trade Monitor {isTrading ? '(ACTIVE)' : '(STANDBY)'}
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div>
                <strong>🔗 Connection Status:</strong>
                <br />WebSocket: {websocket?.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}
                <br />Authorized: {isAuthorized ? '✅ Yes' : '❌ No'}
                <br />Token Available: {getAuthToken() ? '✅ Yes' : '❌ No'}

                <br /><br /><strong>🎯 Trading Status:</strong>
                <br />Mode: {isTradeEveryTick ? '🔥 Every Tick' : '🎯 Condition-Based'}
                <br />Executing: {isExecutingTrade ? '⚡ YES' : '✅ Ready'}
                <br />Requesting Proposal: {isRequestingProposal ? '⏳ YES' : '✅ Ready'}
                <br />Proposal ID: {proposalId ? '✅ Ready' : '❌ None'}
              </div>

              <div>
                <strong>📊 Current Trade Config:</strong>
                <br />Symbol: {selectedSymbol}
                <br />Contract: {selectedContractType}
                <br />Stake: ${currentStake}
                <br />Price: {currentPrice} (Last digit: {currentPrice.slice(-1)})
                <br />Barrier: {overUnderValue}

                <br /><br /><strong>📈 Performance:</strong>
                <br />Total Trades: {totalTrades}
                <br />Active Contracts: {activeContracts.size}
                <br />Total P/L: ${totalProfitLoss.toFixed(2)}
                <br />Win Rate: {winRate}%
              </div>
            </div>

            <div style={{ 
              marginTop: '15px', 
              padding: '10px', 
              backgroundColor: isTrading ? '#c8e6c9' : '#e3f2fd', 
              borderRadius: '4px',
              borderLeft: `4px solid ${isTrading ? '#4caf50' : '#2196f3'}`
            }}>
              <strong>🔧 Trade Execution Monitor:</strong>
              <br />Last Trade: {lastTradeTime ? new Date(lastTradeTime).toLocaleTimeString() : 'Never'}
              <br />Time Since: {lastTradeTime ? `${Math.floor((Date.now() - lastTradeTime) / 1000)}s ago` : 'N/A'}
              <br />Config Valid: {isValidCombination ? '✅ Valid' : '❌ Invalid - Check settings'}
              <br />Balance: ${balance.toFixed(2)} {client?.currency || 'USD'}
              {error && (
                <>
                  <br /><span style={{ color: 'red' }}>⚠️ Error: {error}</span>
                </>
              )}
            </div>

            <div style={{ marginTop: '10px', textAlign: 'center' }}>
              <small style={{ color: '#666' }}>
                {isTrading ? '🟢 Bot is actively monitoring for trade opportunities' : '🔴 Bot is stopped'}
              </small>
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