import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import { tradingEngine } from '../volatility-analyzer/trading-engine';
import './speed-bot.scss';

interface TradeResult {
  id: string;
  timestamp: string;
  symbol: string;
  contractType: string;
  prediction: string;
  actual: string;
  result: 'win' | 'loss' | 'pending';
  stake: number;
  payout: number;
  profit: number;
  contractId?: string;
  tickValue?: number;
  isBulkTrade?: boolean;
}

const SpeedBot: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');
  const [contractType, setContractType] = useState('DIGITEVEN');
  const [stakeAmount, setStakeAmount] = useState(1.0);
  const [isTrading, setIsTrading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<string>('---');
  const [currentTick, setCurrentTick] = useState<number | null>(null);
  const [totalTrades, setTotalTrades] = useState(0);
  const [winRate, setWinRate] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [tradeHistory, setTradeHistory] = useState<TradeResult[]>([]);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [pendingTrades, setPendingTrades] = useState<Set<string>>(new Set());

  // Enhanced features
  const [alternateMarketType, setAlternateMarketType] = useState(false);
  const [alternateOnLoss, setAlternateOnLoss] = useState(false);
  const [useMartingale, setUseMartingale] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2);
  const [totalProfitTarget, setTotalProfitTarget] = useState(10);
  const [lossThreshold, setLossThreshold] = useState(-10);
  const [overUnderValue, setOverUnderValue] = useState(5);
  const [matchDifferDigit, setMatchDifferDigit] = useState(5);
  const [useBulkTrading, setUseBulkTrading] = useState(false);

  // State management
  const [currentStake, setCurrentStake] = useState(1.0);
  const [lastTradeResult, setLastTradeResult] = useState<'win' | 'loss' | null>(null);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [currentContractChoice, setCurrentContractChoice] = useState(contractType);

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
    { value: 'DIGITEVEN', label: 'Even', category: 'evenodd' },
    { value: 'DIGITODD', label: 'Odd', category: 'evenodd' },
    { value: 'DIGITOVER', label: 'Over', category: 'overunder' },
    { value: 'DIGITUNDER', label: 'Under', category: 'overunder' },
    { value: 'DIGITMATCH', label: 'Matches', category: 'matchdiffer' },
    { value: 'DIGITDIFF', label: 'Differs', category: 'matchdiffer' },
    { value: 'CALL', label: 'Rise', category: 'risefall' },
    { value: 'PUT', label: 'Fall', category: 'risefall' },
  ];

  const getContractCategory = (type: string) => {
    const contract = contractTypes.find(c => c.value === type);
    return contract?.category || 'other';
  };

  const getAlternateContract = (currentContract: string): string => {
    const alternates: { [key: string]: string } = {
      'DIGITEVEN': 'DIGITODD',
      'DIGITODD': 'DIGITEVEN',
      'DIGITOVER': 'DIGITUNDER',
      'DIGITUNDER': 'DIGITOVER',
      'DIGITMATCH': 'DIGITDIFF',
      'DIGITDIFF': 'DIGITMATCH',
      'CALL': 'PUT',
      'PUT': 'CALL',
    };
    return alternates[currentContract] || currentContract;
  };

  const connectToAPI = useCallback(async () => {
    try {
      if (websocket) {
        websocket.close();
        setWebsocket(null);
      }

      setCurrentPrice('Connecting...');
      setIsConnected(false);
      setIsAuthorized(false);

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      ws.onopen = () => {
        console.log('Speed Bot WebSocket connected');
        setIsConnected(true);
        setWebsocket(ws);
        setCurrentPrice('Connected - Checking authorization...');

        // Try multiple token storage locations
        const accountsList = localStorage.getItem('accountsList');
        let apiToken = localStorage.getItem('dbot_api_token') || 
                      localStorage.getItem('authToken') || 
                      localStorage.getItem('oauth_token') ||
                      localStorage.getItem('deriv_token') ||
                      localStorage.getItem('token');

        // Try to get token from accounts list if available
        if (!apiToken && accountsList) {
          try {
            const accounts = JSON.parse(accountsList);
            const activeLoginId = localStorage.getItem('active_loginid');
            if (activeLoginId && accounts[activeLoginId] && accounts[activeLoginId].token) {
              apiToken = accounts[activeLoginId].token;
            } else if (activeLoginId && accounts[activeLoginId]) {
              apiToken = accounts[activeLoginId];
            } else {
              // Get first available token
              const firstAccount = Object.keys(accounts)[0];
              if (firstAccount && accounts[firstAccount]) {
                apiToken = accounts[firstAccount].token || accounts[firstAccount];
              }
            }
          } catch (error) {
            console.error('Error parsing accounts list:', error);
          }
        }

        // Also check if user is logged in via session/cookies
        const isLoggedIn = localStorage.getItem('active_loginid') || 
                          localStorage.getItem('client_accounts') ||
                          localStorage.getItem('is_logged_in') === 'true';

        console.log('🔍 Auth check:', {
          hasToken: !!apiToken,
          tokenLength: apiToken?.length,
          isLoggedIn,
          activeLoginId: localStorage.getItem('active_loginid')
        });

        if (apiToken && apiToken.length > 10) {
          console.log('🔑 Authorizing Speed Bot with API token for real trading');
          ws.send(JSON.stringify({
            authorize: apiToken,
            req_id: 'speed_bot_auth'
          }));
        } else if (isLoggedIn) {
          console.log('🔑 User appears logged in, trying to authorize without explicit token');
          setIsAuthorized(true);
          setCurrentPrice('Getting price feed...');

          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              const tickRequest = {
                ticks: selectedSymbol,
                subscribe: 1,
                req_id: 'speed_bot_ticks'
              };
              ws.send(JSON.stringify(tickRequest));
            }
          }, 500);
        } else {
          console.log('⚠️ No valid API token found - Starting with tick subscription only');
          setCurrentPrice('Getting price feed...');

          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              const tickRequest = {
                ticks: selectedSymbol,
                subscribe: 1,
                req_id: 'speed_bot_ticks'
              };
              ws.send(JSON.stringify(tickRequest));
            }
          }, 500);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            console.error('Speed Bot API error:', data.error);

            // Handle specific error types
            if (data.error.code === 'AuthorizationRequired') {
              setCurrentPrice('Please log in to start trading');
              setIsAuthorized(false);
            } else if (data.error.code === 'InvalidToken') {
              setCurrentPrice('Invalid token - please log in again');
              setIsAuthorized(false);
            } else {
              setCurrentPrice(`Error: ${data.error.message}`);
            }

            // If authorization fails, try to get tick data without auth
            if (data.req_id === 'speed_bot_auth' && ws.readyState === WebSocket.OPEN) {
              console.log('Authorization failed, trying tick subscription without auth');
              const tickRequest = {
                ticks: selectedSymbol,
                subscribe: 1,
                req_id: 'speed_bot_ticks'
              };
              ws.send(JSON.stringify(tickRequest));
            }
            return;
          }

          if (data.authorize && data.req_id === 'speed_bot_auth') {
            console.log('✅ Speed Bot authorized for real trading');
            setIsAuthorized(true);
            setCurrentPrice('Authorized - Waiting for ticks...');

            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                const tickRequest = {
                  ticks: selectedSymbol,
                  subscribe: 1,
                  req_id: 'speed_bot_ticks',
                };
                ws.send(JSON.stringify(tickRequest));
              }
            }, 500);
          }

          if (data.tick && data.tick.symbol === selectedSymbol) {
            const price = parseFloat(data.tick.quote);
            setCurrentPrice(price.toFixed(5));
            setCurrentTick(price);

            if (isTrading && isAuthorized) {
              executeTradeOnTick(price);
            }
          }

          // Handle tick history response
          if (data.history && data.history.prices && data.req_id === 'speed_bot_ticks') {
            console.log('Received tick history, subscribing to live ticks');
            const lastPrice = parseFloat(data.history.prices[data.history.prices.length - 1]);
            setCurrentPrice(lastPrice.toFixed(5));
            setCurrentTick(lastPrice);
          }

          if (data.proposal_open_contract) {
            handleContractUpdate(data.proposal_open_contract);
          }

        } catch (error) {
          console.error('Error parsing Speed Bot message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Speed Bot WebSocket closed');
        setIsConnected(false);
        setIsAuthorized(false);
        setWebsocket(null);
        setCurrentPrice('Disconnected');
      };

      ws.onerror = (error) => {
        console.error('Speed Bot WebSocket error:', error);
        setIsConnected(false);
        setIsAuthorized(false);
        setCurrentPrice('Connection Error');
      };
    } catch (error) {
      console.error('Speed Bot connection failed:', error);
      setIsConnected(false);
      setIsAuthorized(false);
      setCurrentPrice('Failed to connect');
    }
  }, [selectedSymbol, isTrading]);

  // Advanced speed bot trading logic with comprehensive tick analysis
  const [tickAnalysisHistory, setTickAnalysisHistory] = useState<number[]>([]);
  const [digitPatterns, setDigitPatterns] = useState<{[key: number]: number}>({});
  const [marketCondition, setMarketCondition] = useState<'volatile' | 'stable' | 'trending'>('stable');
  const [tradeSignals, setTradeSignals] = useState<{strength: number, direction: string}>({strength: 0, direction: 'none'});
  const [speedBotActive, setSpeedBotActive] = useState(false);
  const [lastTickTime, setLastTickTime] = useState<number>(0);
  const [executionSpeed, setExecutionSpeed] = useState<number>(100); // ms between analysis
  const [strategyMode, setStrategyMode] = useState<'martingale' | 'dalembert' | 'fibonacci' | 'scalping'>('martingale');

  // Speed bot tick analysis - core engine
  const speedBotTickAnalysis = useCallback((tick: number, tickTime: number) => {
    // Prevent duplicate analysis for same tick
    if (tickTime === lastTickTime) return;
    setLastTickTime(tickTime);

    const lastDigit = Math.floor(Math.abs(tick * 100000)) % 10;

    // Update tick analysis history (keep last 100 ticks)
    setTickAnalysisHistory(prev => {
      const newHistory = [...prev, lastDigit].slice(-100);

      // Analyze digit patterns
      const patterns: {[key: number]: number} = {};
      newHistory.forEach(digit => {
        patterns[digit] = (patterns[digit] || 0) + 1;
      });
      setDigitPatterns(patterns);

      // Determine market condition based on volatility
      if (newHistory.length >= 10) {
        const recentTicks = newHistory.slice(-10);
        const variance = calculateVariance(recentTicks);
        if (variance > 8) setMarketCondition('volatile');
        else if (variance < 3) setMarketCondition('stable');
        else setMarketCondition('trending');
      }

      return newHistory;
    });

    // Generate trade signals based on analysis
    if (tickAnalysisHistory.length >= 20) {
      const signals = generateTradeSignals(tickAnalysisHistory, lastDigit);
      setTradeSignals(signals);

      // Execute trade if conditions are met
      if (speedBotActive && signals.strength > 70) {
        executeSpeedTrade(lastDigit, signals);
      }
    }
  }, [tickAnalysisHistory, lastTickTime, speedBotActive]);

  // Calculate variance for market condition analysis
  const calculateVariance = (data: number[]): number => {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / data.length;
    return variance;
  };

  // Generate trade signals based on multiple factors
  const generateTradeSignals = (history: number[], currentDigit: number) => {
    let strength = 0;
    let direction = 'none';

    const recentHistory = history.slice(-20);
    const evenCount = recentHistory.filter(d => d % 2 === 0).length;
    const oddCount = recentHistory.length - evenCount;

    // Pattern analysis
    const lastFive = recentHistory.slice(-5);
    const streakLength = calculateStreakLength(lastFive);

    // Signal generation based on strategy
    switch (strategyMode) {
      case 'martingale':
        // Bet against long streaks
        if (streakLength >= 3) {
          strength = Math.min(90, 60 + (streakLength * 10));
          direction = lastFive[lastFive.length - 1] % 2 === 0 ? 'ODD' : 'EVEN';
        }
        break;

      case 'dalembert':
        // Moderate progression betting
        if (evenCount > oddCount + 2) {
          strength = 75;
          direction = 'ODD';
        } else if (oddCount > evenCount + 2) {
          strength = 75;
          direction = 'EVEN';
        }
        break;

      case 'fibonacci':
        // Based on Fibonacci sequence patterns
        const fibPattern = checkFibonacciPattern(recentHistory);
        if (fibPattern.found) {
          strength = 80;
          direction = fibPattern.nextExpected % 2 === 0 ? 'EVEN' : 'ODD';
        }
        break;

      case 'scalping':
        // Quick trades on small patterns
        if (currentDigit === 0 || currentDigit === 9) {
          strength = 85;
          direction = currentDigit === 0 ? 'ODD' : 'EVEN';
        }
        break;
    }

    // Market condition adjustments
    if (marketCondition === 'volatile') {
      strength *= 1.2; // Increase confidence in volatile markets
    } else if (marketCondition === 'stable') {
      strength *= 0.8; // Decrease confidence in stable markets
    }

    return { strength: Math.min(100, strength), direction };
  };

  // Calculate streak length for pattern analysis
  const calculateStreakLength = (digits: number[]): number => {
    if (digits.length < 2) return 0;

    let streak = 1;
    const lastType = digits[digits.length - 1] % 2;

    for (let i = digits.length - 2; i >= 0; i--) {
      if (digits[i] % 2 === lastType) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  };

  // Check for Fibonacci sequence patterns
  const checkFibonacciPattern = (history: number[]) => {
    const fibSeq = [0, 1, 1, 2, 3, 5, 8];
    const recent = history.slice(-5);

    for (let i = 0; i <= recent.length - 3; i++) {
      const seq = recent.slice(i, i + 3);
      for (let j = 0; j <= fibSeq.length - 3; j++) {
        if (JSON.stringify(seq) === JSON.stringify(fibSeq.slice(j, j + 3))) {
          const nextInSeq = fibSeq[j + 3] || (fibSeq[j + 1] + fibSeq[j + 2]);
          return { found: true, nextExpected: nextInSeq % 10 };
        }
      }
    }

    return { found: false, nextExpected: 0 };
  };

  // Execute speed trade with advanced logic
  const executeSpeedTrade = useCallback(async (lastDigit: number, signals: {strength: number, direction: string}) => {
    if (!isAuthorized || !tradingEngine.isEngineConnected() || pendingTrades.size > 0) {
      return;
    }

    // Determine contract type based on signals
    let actualContractType = contractType;
    let prediction = '';
    let shouldExecute = false;

    // Smart contract selection based on analysis
    if (signals.direction === 'EVEN' && signals.strength > 70) {
      actualContractType = 'DIGITEVEN';
      prediction = 'EVEN';
      shouldExecute = true;
    } else if (signals.direction === 'ODD' && signals.strength > 70) {
      actualContractType = 'DIGITODD';
      prediction = 'ODD';
      shouldExecute = true;
    } else if (lastDigit > 4 && signals.strength > 75) {
      actualContractType = 'DIGITUNDER';
      prediction = `UNDER 5`;
      shouldExecute = true;
    } else if (lastDigit < 5 && signals.strength > 75) {
      actualContractType = 'DIGITOVER';
      prediction = `OVER 4`;
      shouldExecute = true;
    }

    // Apply alternating logic if enabled
    if (alternateOnLoss && lastTradeResult === 'loss') {
      actualContractType = getAlternateContract(actualContractType);
    }

    if (shouldExecute) {
      try {
        setPendingTrades(prev => new Set(prev).add(actualContractType));

        console.log(`🚀 Speed Bot executing ${actualContractType} trade - Signal strength: ${signals.strength}%`);

        // Apply strategy-specific stake adjustments
        let adjustedStake = currentStake;

        switch (strategyMode) {
          case 'martingale':
            if (lastTradeResult === 'loss') {
              adjustedStake = currentStake * martingaleMultiplier;
            }
            break;
          case 'dalembert':
            if (lastTradeResult === 'loss') {
              adjustedStake = currentStake + stakeAmount * 0.1;
            } else if (lastTradeResult === 'win') {
              adjustedStake = Math.max(stakeAmount, currentStake - stakeAmount * 0.1);
            }
            break;
          case 'fibonacci':
            // Implement Fibonacci sequence for stakes
            const fibStakes = [1, 1, 2, 3, 5, 8, 13];
            const lossIndex = Math.min(consecutiveLosses, fibStakes.length - 1);
            adjustedStake = stakeAmount * fibStakes[lossIndex];
            break;
        }

        setCurrentStake(adjustedStake);

        const proposalRequest: any = {
          amount: adjustedStake,
          basis: 'stake',
          contract_type: actualContractType,
          currency: 'USD',
          symbol: selectedSymbol,
          duration: 1,
          duration_unit: 't'
        };

        // Add barriers for over/under contracts
        if (actualContractType === 'DIGITOVER') {
          proposalRequest.barrier = 4;
        } else if (actualContractType === 'DIGITUNDER') {
          proposalRequest.barrier = 5;
        } else if (actualContractType === 'DIGITMATCH' || actualContractType === 'DIGITDIFF') {
          proposalRequest.barrier = matchDifferDigit;
        }

        const proposalResponse = await tradingEngine.getProposal(proposalRequest);

        if (proposalResponse.proposal) {
          const purchaseResponse = await tradingEngine.buyContract(
            proposalResponse.proposal.id,
            proposalResponse.proposal.ask_price
          );

          if (purchaseResponse.buy) {
            const trade: TradeResult = {
              id: `speed_${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              symbol: selectedSymbol,
              contractType: actualContractType,
              prediction,
              actual: 'PENDING',
              result: 'pending',
              stake: adjustedStake,
              payout: 0,
              profit: 0,
              contractId: purchaseResponse.buy.contract_id,
              tickValue: lastDigit,
            };

            setTradeHistory(prev => [trade, ...prev.slice(0, 49)]);
            setTotalTrades(prev => prev + 1);

            console.log(`✅ Speed trade executed - Contract ID: ${purchaseResponse.buy.contract_id}`);
          }
        }
      } catch (error) {
        console.error('❌ Speed trade failed:', error);
      } finally {
        setPendingTrades(prev => {
          const newSet = new Set(prev);
          newSet.delete(actualContractType);
          return newSet;
        });
      }
    }
  }, [isAuthorized, tradingEngine, pendingTrades, contractType, lastTradeResult, alternateOnLoss, currentStake, martingaleMultiplier, stakeAmount, consecutiveLosses, selectedSymbol, matchDifferDigit, strategyMode]);

  // Enhanced executeTradeOnTick that integrates with speed bot
  const executeTradeOnTick = useCallback(async (tick: number) => {
    const currentTime = Date.now();

    // Run speed bot analysis on every tick
    speedBotTickAnalysis(tick, currentTime);

    // Regular trading logic (only if speed bot is not active)
    if (!speedBotActive) {
      const lastDigit = Math.floor(Math.abs(tick * 100000)) % 10;

      // Determine which contract to use based on alternating settings
      let actualContractType = contractType;

      if (alternateMarketType) {
        actualContractType = currentContractChoice;
      } else if (alternateOnLoss && lastTradeResult === 'loss') {
        actualContractType = getAlternateContract(contractType);
      }

      let prediction: string;
      let shouldTrade = false;
      let actualResult: string;
      let barrier = overUnderValue;

      // Determine prediction and result based on contract type
      switch (actualContractType) {
        case 'DIGITEVEN':
          prediction = 'EVEN';
          actualResult = lastDigit % 2 === 0 ? 'EVEN' : 'ODD';
          shouldTrade = true;
          break;
        case 'DIGITODD':
          prediction = 'ODD';
          actualResult = lastDigit % 2 === 1 ? 'ODD' : 'EVEN';
          shouldTrade = true;
          break;
        case 'DIGITOVER':
          prediction = `OVER ${barrier}`;
          actualResult = lastDigit > barrier ? `OVER ${barrier}` : `UNDER ${barrier}`;
          shouldTrade = true;
          break;
        case 'DIGITUNDER':
          prediction = `UNDER ${barrier}`;
          actualResult = lastDigit < barrier ? `UNDER ${barrier}` : `OVER ${barrier}`;
          shouldTrade = true;
          break;
        case 'DIGITMATCH':
          prediction = `MATCHES ${matchDifferDigit}`;
          actualResult = lastDigit === matchDifferDigit ? `MATCHES ${matchDifferDigit}` : `DIFFERS ${matchDifferDigit}`;
          shouldTrade = true;
          break;
        case 'DIGITDIFF':
          prediction = `DIFFERS ${matchDifferDigit}`;
          actualResult = lastDigit !== matchDifferDigit ? `DIFFERS ${matchDifferDigit}` : `MATCHES ${matchDifferDigit}`;
          shouldTrade = true;
          break;
        case 'CALL':
          prediction = 'RISE';
          actualResult = Math.random() > 0.5 ? 'RISE' : 'FALL';
          shouldTrade = true;
          break;
        case 'PUT':
          prediction = 'FALL';
          actualResult = Math.random() > 0.5 ? 'FALL' : 'RISE';
          shouldTrade = true;
          break;
        default:
          return;
      }

      if (shouldTrade && !pendingTrades.has(actualContractType)) {
        const isLoggedIn = localStorage.getItem('active_loginid') || 
                          localStorage.getItem('client_accounts') ||
                          localStorage.getItem('is_logged_in') === 'true' ||
                          isAuthorized;

        if (isLoggedIn && tradingEngine.isEngineConnected()) {
          try {
            setPendingTrades(prev => new Set(prev).add(actualContractType));

            console.log(`🚀 Executing regular ${actualContractType} trade on ${selectedSymbol} with stake ${currentStake}`);

            const proposalRequest: any = {
              amount: currentStake,
              basis: 'stake',
              contract_type: actualContractType,
              currency: 'USD',
              symbol: selectedSymbol,
              duration: 1,
              duration_unit: 't'
            };

            if (actualContractType === 'DIGITOVER' || actualContractType === 'DIGITUNDER') {
              proposalRequest.barrier = barrier;
            } else if (actualContractType === 'DIGITMATCH' || actualContractType === 'DIGITDIFF') {
              proposalRequest.barrier = matchDifferDigit;
            }

            const proposalResponse = await tradingEngine.getProposal(proposalRequest);

            if (proposalResponse.proposal) {
              const purchaseResponse = await tradingEngine.buyContract(
                proposalResponse.proposal.id,
                proposalResponse.proposal.ask_price
              );

              if (purchaseResponse.buy) {
                const trade: TradeResult = {
                  id: `regular_trade_${Date.now()}`,
                  timestamp: new Date().toLocaleTimeString(),
                  symbol: selectedSymbol,
                  contractType: actualContractType,
                  prediction,
                  actual: 'PENDING',
                  result: 'pending',
                  stake: currentStake,
                  payout: 0,
                  profit: 0,
                  contractId: purchaseResponse.buy.contract_id,
                  tickValue: lastDigit,
                };

                setTradeHistory(prev => [trade, ...prev.slice(0, 49)]);
                setTotalTrades(prev => prev + 1);

                console.log(`✅ Regular trade executed - Contract ID: ${purchaseResponse.buy.contract_id}`);
              }
            }
          } catch (error) {
            console.error('❌ Regular trade failed:', error);
          } finally {
            setPendingTrades(prev => {
              const newSet = new Set(prev);
              newSet.delete(actualContractType);
              return newSet;
            });
          }
        }

        if (alternateMarketType) {
          setCurrentContractChoice(getAlternateContract(currentContractChoice));
        }
      }
    }
  }, [speedBotActive, speedBotTickAnalysis, contractType, selectedSymbol, currentStake, isAuthorized, pendingTrades, alternateMarketType, alternateOnLoss, lastTradeResult, currentContractChoice, overUnderValue, matchDifferDigit]);



  const handleContractUpdate = useCallback((contract: any) => {
    if (contract.contract_id) {
      setTradeHistory(prev => prev.map(trade => {
        if (trade.contractId === contract.contract_id) {
          const isWin = contract.status === 'won';
          const payout = contract.payout || 0;
          const profit = payout - trade.stake;

          // Update martingale based on real trade result
          if (useMartingale) {
            if (isWin) {
              setCurrentStake(stakeAmount);
              setConsecutiveLosses(0);
            } else {
              setConsecutiveLosses(prev => prev + 1);
              setCurrentStake(prev => prev * martingaleMultiplier);
            }
          }

          setLastTradeResult(isWin ? 'win' : 'loss');

          return {
            ...trade,
            actual: contract.status === 'won' ? trade.prediction : getOppositeResult(trade.prediction),
            result: isWin ? 'win' : 'loss',
            payout,
            profit,
          };
        }
        return trade;
      }));

      const updatedTrade = tradeHistory.find(t => t.contractId === contract.contract_id);
      if (updatedTrade && contract.status) {
        const profit = (contract.payout || 0) - updatedTrade.stake;
        setTotalProfit(prev => prev + profit);

        const isWin = contract.status === 'won';
        setWinRate(prev => {
          const wins = tradeHistory.filter(t => t.result === 'win').length + (isWin ? 1 : 0);
          return (wins / totalTrades) * 100;
        });

        // Check thresholds
        const newTotalProfit = totalProfit + profit;
        if (newTotalProfit >= totalProfitTarget || newTotalProfit <= lossThreshold) {
          console.log(`🛑 Stopping trading - Threshold reached: ${newTotalProfit}`);
          setIsTrading(false);
        }
      }
    }
  }, [tradeHistory, totalTrades, totalProfit, useMartingale, stakeAmount, martingaleMultiplier, totalProfitTarget, lossThreshold]);

  const getOppositeResult = (prediction: string): string => {
    const opposites: { [key: string]: string } = {
      'EVEN': 'ODD',
      'ODD': 'EVEN',
      'RISE': 'FALL',
      'FALL': 'RISE',
    };

    if (prediction.includes('OVER')) return prediction.replace('OVER', 'UNDER');
    if (prediction.includes('UNDER')) return prediction.replace('UNDER', 'OVER');
    if (prediction.includes('MATCHES')) return prediction.replace('MATCHES', 'DIFFERS');
    if (prediction.includes('DIFFERS')) return prediction.replace('DIFFERS', 'MATCHES');

    return opposites[prediction] || prediction;
  };

  const startTrading = () => {
    if (!isConnected) {
      alert('Please connect to the API first');
      return;
    }

    // Check if user is logged in via various methods
    const isLoggedIn = localStorage.getItem('active_loginid') || 
                      localStorage.getItem('client_accounts') ||
                      localStorage.getItem('is_logged_in') === 'true' ||
                      isAuthorized;

    if (!isLoggedIn) {
      // Show login dialog or redirect to login
      const loginDialog = document.createElement('div');
      loginDialog.innerHTML = `
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                    background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
                    z-index: 10000; text-align: center;">
          <h3>Please log in to your Deriv account</h3>
          <p>You need to be logged in to start real money trading</p>
          <button onclick="window.location.href='/'" style="background: #ff444f; color: white; border: none; 
                  padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px;">
            Go to Login
          </button>
          <button onclick="this.parentElement.parentElement.remove()" style="background: #ccc; color: black; 
                  border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px;">
            Cancel
          </button>
        </div>
      `;
      document.body.appendChild(loginDialog);
      ```text      return;
    }

    // Reset martingale state
    setCurrentStake(stakeAmount);
    setConsecutiveLosses(0);
    setLastTradeResult(null);
    setCurrentContractChoice(contractType);

    setIsTrading(true);
  };

  const stopTrading = () => {
    setIsTrading(false);
    setPendingTrades(new Set());
  };

  const resetStats = () => {
    setTotalTrades(0);
    setWinRate(0);
    setTotalProfit(0);
    setTradeHistory([]);
    setCurrentStake(stakeAmount);
    setConsecutiveLosses(0);
    setLastTradeResult(null);
  };

  useEffect(() => {
    connectToAPI();

    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [selectedSymbol, useBulkTrading, connectToAPI]);

  // Initialize bulk trading functionality with the provided WebSocket code
  const initializeBulkTrading = useCallback(() => {
    if (!useBulkTrading) return;

    // Inject the bulk trading WebSocket script
    const script = document.createElement('script');
    script.textContent = 
      'let derivWs,reconnectTimeout;let tickHistory=[],currentSymbol="' + selectedSymbol + '",tickCount=120,decimalPlaces=2,overUnderBarrier=' + overUnderValue + ',isInitialized=false,reconnectAttempts=0,MAX_RECONNECT_ATTEMPTS=5;' +

      'function startWebSocket(){' +
        'if(console.log("🔌 Connecting to WebSocket API"),reconnectTimeout&&clearTimeout(reconnectTimeout),derivWs){' +
          'try{derivWs.onclose=null,derivWs.close(),console.log("Closed existing connection")}catch(e){console.error("Error closing existing connection:",e)}' +
          'derivWs=null' +
        '}' +
        'try{' +
          '(derivWs=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=75771")).onopen=function(){' +
            'console.log("✅ WebSocket connection established"),reconnectAttempts=0,notifyConnectionStatus("connected"),setTimeout(()=>{' +
              'try{derivWs&&derivWs.readyState===WebSocket.OPEN&&(console.log("Sending authorization request"),derivWs.send(JSON.stringify({app_id:75771})),requestTickHistory())}catch(e){console.error("Error during init requests:",e)}' +
            '},500)' +
          '},' +
          'derivWs.onmessage=function(e){' +
            'try{' +
              'let t=JSON.parse(e.data);' +
              'if(t.error){console.error("❌ WebSocket API error:",t.error),notifyConnectionStatus("error",t.error.message);return}' +
              'if(t.history)console.log("📊 Received history for "+currentSymbol+": "+t.history.prices.length+" ticks"),tickHistory=t.history.prices.map((e,o)=>({time:t.history.times[o],quote:parseFloat(e)})),detectDecimalPlaces(),updateUI();' +
              'else if(t.tick){let e=parseFloat(t.tick.quote);tickHistory.push({time:t.tick.epoch,quote:e}),tickHistory.length>tickCount&&tickHistory.shift(),updateUI()}' +
              'else t.ping&&derivWs.send(JSON.stringify({pong:1}))' +
            '}catch(e){console.error("Error processing message:",e)}' +
          '},' +
          'derivWs.onerror=function(e){console.error("❌ WebSocket error:",e),notifyConnectionStatus("error","Connection error"),scheduleReconnect()},' +
          'derivWs.onclose=function(e){console.log("🔄 WebSocket connection closed",e.code,e.reason),notifyConnectionStatus("disconnected"),scheduleReconnect()},' +
          'window.derivWs=derivWs' +
        '}catch(e){console.error("Failed to create WebSocket:",e),notifyConnectionStatus("error",e.message),scheduleReconnect()}' +
      '}' +

      'function scheduleReconnect(){' +
        'if(++reconnectAttempts>5){console.log("⚠️ Maximum reconnection attempts (5) reached. Stopping attempts."),notifyConnectionStatus("error","Maximum reconnection attempts reached");return}' +
        'let e=Math.min(1e3*Math.pow(1.5,reconnectAttempts-1),3e4);' +
        'console.log("🔄 Scheduling reconnect attempt "+reconnectAttempts+" in "+e+"ms"),reconnectTimeout=setTimeout(()=>{console.log("🔄 Attempting to reconnect ("+reconnectAttempts+"/5)..."),startWebSocket()},e)' +
      '}' +

      'function requestTickHistory(){' +
        'let e={ticks_history:currentSymbol,count:tickCount,end:"latest",style:"ticks",subscribe:1};' +
        'if(derivWs&&derivWs.readyState===WebSocket.OPEN){console.log("📡 Requesting tick history for "+currentSymbol+" ("+tickCount+" ticks)");try{derivWs.send(JSON.stringify(e))}catch(e){console.error("Error sending tick history request:",e),scheduleReconnect()}}' +
        'else console.error("❌ WebSocket not ready to request history, readyState:",derivWs?derivWs.readyState:"undefined"),scheduleReconnect()' +
      '}' +

      'function detectDecimalPlaces(){if(0!==tickHistory.length)decimalPlaces=Math.max(...tickHistory.map(e=>(e.quote.toString().split(".")[1]||"").length),2)}' +

      'function getLastDigit(e){let t=e.toString().split(".")[1]||"";for(;t.length<decimalPlaces;)t+="0";return Number(t.slice(-1))}' +

      'function notifyConnectionStatus(e,t=null){window.postMessage({type:"ANALYZER_CONNECTION_STATUS",status:e,error:t},"*")}' +

      'function updateUI(){' +
        'if(0===tickHistory.length){console.warn("⚠️ No tick history available for analysis");return}' +
        'let e=tickHistory[tickHistory.length-1].quote.toFixed(decimalPlaces);' +
        'window.postMessage({type:"PRICE_UPDATE",price:e,symbol:currentSymbol},"*"),sendAnalysisData()' +
      '}' +

      'function sendAnalysisData(){' +
        'if(!tickHistory||0===tickHistory.length){console.warn("⚠️ No data available for analysis");return}' +
        'try{' +
          'let t=Array(10).fill(0);' +
          'tickHistory.forEach(e=>{let o=getLastDigit(e.quote);t[o]++});' +
          'let o=tickHistory.length,r=t.filter((e,t)=>t%2==0).reduce((e,t)=>e+t,0),i=t.filter((e,t)=>t%2!=0).reduce((e,t)=>e+t,0),n=(r/o*100).toFixed(2),s=(i/o*100).toFixed(2);' +
          'if(n > 60 || s > 60 || window.speedBotBulkTrade) {' +
            'window.postMessage({type:"BULK_TRADE_SIGNAL",data:{evenProb:n,oddProb:s,symbol:currentSymbol}},"*");' +
          '}' +
        '}catch(e){console.error("❌ Error in sendAnalysisData:",e)}' +
      '}' +

      'if(!isInitialized){isInitialized=true,console.log("🚀 Initializing bulk trading volatility analyzer"),startWebSocket()}';
    `;

    document.head.appendChild(script);

    // Listen for bulk trading signals
    const handleBulkMessage = (event) => {
      if (event.data?.type === 'BULK_TRADE_SIGNAL' && useBulkTrading && isTrading) {
        const { evenProb, oddProb } = event.data.data;
        executeBulkTrades(parseFloat(evenProb), parseFloat(oddProb));
      }
    };

    window.addEventListener('message', handleBulkMessage);

    return () => {
      window.removeEventListener('message', handleBulkMessage);
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  });
  }, [useBulkTrading, isTrading, selectedSymbol, currentStake, isAuthorized, tradingEngine, overUnderValue]);

  // Initialize bulk trading when component mounts or dependencies change
  useEffect(() => {
    if (useBulkTrading) {
      initializeBulkTrading();
    }
  }, [useBulkTrading, initializeBulkTrading]);

  const executeBulkTrades = async (evenProb: number, oddProb: number) => {
    if (!isAuthorized || !tradingEngine.isEngineConnected()) {
      console.log('⚠️ Not authorized for bulk trading');
      return;
    }

    const trades = [];

    // Determine which contracts to trade based on probabilities
    if (evenProb > 60) {
      trades.push({ type: 'DIGITEVEN', probability: evenProb });
    }
    if (oddProb > 60) {
      trades.push({ type: 'DIGITODD', probability: oddProb });
    }

    // Execute trades with staggered timing
    for (let i = 0; i < trades.length; i++) {
      setTimeout(() => {
        executeSingleBulkTrade(trades[i]);
      }, i * 200); // 200ms between each trade
    }
  };

  const executeSingleBulkTrade = async (trade: {type: string, probability: number, strategy?: string, barrier?: number}) => {
    try {
      console.log(\`💼 Executing bulk trade: \${trade.type} with \${trade.probability}% probability (Strategy: \${trade.strategy || 'default'})\`);

      const proposalRequest: any = {
        amount: currentStake,
        basis: 'stake',
        contract_type: trade.type,
        currency: 'USD',
        symbol: selectedSymbol,
        duration: 1,
        duration_unit: 't'
      };

      // Add barrier for over/under contracts
      if (trade.type === 'DIGITOVER' || trade.type === 'DIGITUNDER') {
        proposalRequest.barrier = trade.barrier || overUnderValue;
      }

      const proposalResponse = await tradingEngine.getProposal(proposalRequest);

      if (proposalResponse.proposal) {
        const purchaseResponse = await tradingEngine.buyContract(
          proposalResponse.proposal.id,
          proposalResponse.proposal.ask_price
        );

        if (purchaseResponse.buy) {
          // Create prediction text based on contract type
          let prediction = trade.type;
          if (trade.type === 'DIGITEVEN') prediction = 'EVEN';
          else if (trade.type === 'DIGITODD') prediction = 'ODD';
          else if (trade.type === 'DIGITOVER') prediction = \`OVER \${trade.barrier || overUnderValue}\`;
          else if (trade.type === 'DIGITUNDER') prediction = \`UNDER \${trade.barrier || overUnderValue}\`;

          const bulkTrade: TradeResult = {
            id: \`bulk_trade_\${Date.now()}_\${Math.random()}\`,
            timestamp: new Date().toLocaleTimeString(),
            symbol: selectedSymbol,
            contractType: trade.type,
            prediction,
            actual: 'PENDING',
            result: 'pending',
            stake: currentStake,
            payout: 0,
            profit: 0,
            contractId: purchaseResponse.buy.contract_id,
            isBulkTrade: true,
          };

          setTradeHistory(prev => [bulkTrade, ...prev.slice(0, 49)]);
          setTotalTrades(prev => prev + 1);

          console.log(\`✅ Enhanced bulk trade executed - Contract ID: \${purchaseResponse.buy.contract_id}, Strategy: \${trade.strategy || 'default'}\`);
        }
      }
    } catch (error) {
      console.error('❌ Enhanced bulk trade failed:', error);
    }
  };

  useEffect(() => {
    setCurrentStake(stakeAmount);
  }, [stakeAmount]);

  useEffect(() => {
    setCurrentContractChoice(contractType);
  }, [contractType]);

  return (
    <div className="speed-bot">
      <div className="speed-bot__header">
        <h2 className="speed-bot__title">
          <Localize i18n_default_text="Speed Bot - Real Money Trading" />
        </h2>
        <div className="speed-bot__status-group">
          <div className={\`speed-bot__status \${isConnected ? 'connected' : 'disconnected'}\`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
          <div className={\`speed-bot__status \${isAuthorized ? 'authorized' : 'unauthorized'}\`}>
            {isAuthorized ? '🔑 Authorized' : '⚠️ Please Login'}
          </div>
        </div>
      </div>

      <div className="speed-bot__trading-config">
        <div className="speed-bot__config-header">
          <h3>
            <Localize i18n_default_text="Trading Configuration" />
          </h3>
          <div className="speed-bot__bulk-toggle">
            <label>
              <Localize i18n_default_text="Bulk" />
            </label>
            <div className="speed-bot__toggle-switch">
              <input
                type="checkbox"
                checked={useBulkTrading}
                onChange={(e) => setUseBulkTrading(e.target.checked)}
                disabled={isTrading}
              />
              <span className="speed-bot__slider"></span>
            </div>
            <span className="speed-bot__toggle-text">
              {useBulkTrading ? 'TRADE BULK' : 'SINGLE TRADE'}
            </span>
          </div>
        </div>

        <div className="speed-bot__config-content">
          <div className="speed-bot__config-section">
            <div className="speed-bot__config-row">
              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="SYMBOL" />
                </label>
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  disabled={isTrading}
                  className="speed-bot__config-select"
                >
                  {volatilitySymbols.map((symbol) => (
                    <option key={symbol.value} value={symbol.value}>
                      {symbol.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="CURRENT PRICE" />
                </label>
                <div className="speed-bot__price-display">{currentPrice}</div>
              </div>
            </div>

            {/* Speed Bot Controls */}
            <div className="speed-bot__config-row">
              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="SPEED BOT MODE" />
                </label>
                <div className="speed-bot__toggle-switch">
                  <input
                    type="checkbox"
                    checked={speedBotActive}
                    onChange={(e) => setSpeedBotActive(e.target.checked)}
                    disabled={isTrading}
                  />
                  <span className="speed-bot__slider"></span>
                </div>
                <span className="speed-bot__toggle-text">
                  {speedBotActive ? 'SPEED MODE' : 'NORMAL MODE'}
                </span>
              </div>

              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="STRATEGY" />
                </label>
                <select
                  value={strategyMode}
                  onChange={(e) => setStrategyMode(e.target.value as any)}
                  disabled={isTrading}
                  className="speed-bot__config-select"
                >
                  <option value="martingale">Martingale</option>
                  <option value="dalembert">D'Alembert</option>
                  <option value="fibonacci">Fibonacci</option>
                  <option value="scalping">Scalping</option>
                </select>
              </div>
            </div>

            {/* Market Analysis Display */}
            {speedBotActive && (
              <div className="speed-bot__analysis-panel">
                <div className="speed-bot__analysis-row">
                  <div className="speed-bot__analysis-item">
                    <label>Market Condition</label>
                    <div className={\`speed-bot__market-condition \${marketCondition}\`}>
                      {marketCondition.toUpperCase()}
                    </div>
                  </div>
                  <div className="speed-bot__analysis-item">
                    <label>Signal Strength</label>
                    <div className="speed-bot__signal-strength">
                      <div 
                        className="speed-bot__signal-bar"
                        style={{width: \`\${tradeSignals.strength}%\`}}
                      ></div>
                      <span>{tradeSignals.strength.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
                <div className="speed-bot__analysis-row">
                  <div className="speed-bot__analysis-item">
                    <label>Next Signal</label>
                    <div className={\`speed-bot__next-signal \${tradeSignals.direction.toLowerCase()}\`}>
                      {tradeSignals.direction}
                    </div>
                  </div>
                  <div className="speed-bot__analysis-item">
                    <label>Ticks Analyzed</label>
                    <div className="speed-bot__tick-count">
                      {tickAnalysisHistory.length}/100
                    </div>
                  </div>
                </div>

                {/* Digit Pattern Analysis */}
                <div className="speed-bot__pattern-analysis">
                  <label>Digit Frequency</label>
                  <div className="speed-bot__digit-grid">
                    {[0,1,2,3,4,5,6,7,8,9].map(digit => (
                      <div key={digit} className="speed-bot__digit-item">
                        <span className="speed-bot__digit">{digit}</span>
                        <span className="speed-bot__frequency">
                          {digitPatterns[digit] || 0}
                        </span>
                        <div 
                          className="speed-bot__frequency-bar"
                          style={{
                            height: \`\${((digitPatterns[digit] || 0) / Math.max(...Object.values(digitPatterns).concat(1))) * 100}%\`
                          }}
                        ></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div></div>

            <div className="speed-bot__config-row">
              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="CONTRACT TYPE" />
                </label>
                <select
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                  disabled={isTrading}
                  className="speed-bot__config-select"
                >
                  {contractTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="NUMBER OF TICKS" />
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value="1"
                  disabled={isTrading}
                  className="speed-bot__config-input"
                />
              </div>
            </div>

            <div className="speed-bot__config-row">
              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="STAKE AMOUNT (USD)" />
                </label>
                <input
                  type="number"
                  min="0.35"
                  step="0.01"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(parseFloat(e.target.value))}
                  disabled={isTrading}
                  className="speed-bot__config-input"
                />
              </div>

              <div className="speed-bot__config-item">
                <label>
                  <Localize i18n_default_text="NUMBER OF TRADES" />
                </label>
                <input
                  type="number"
                  min="1"
                  value="10"
                  disabled={isTrading}
                  className="speed-bot__config-input"
                />
              </div>
            </div>

            {/* Contract-specific controls */}
            {(contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') && (
              <div className="speed-bot__config-row">
                <div className="speed-bot__config-item">
                  <label>
                    <Localize i18n_default_text="Over/Under Value:" />
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="9"
                    value={overUnderValue}
                    onChange={(e) => setOverUnderValue(parseInt(e.target.value))}
                    disabled={isTrading}
                    className="speed-bot__config-input"
                  />
                </div>
              </div>
            )}

            {(contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') && (
              <div className="speed-bot__config-row">
                <div className="speed-bot__config-item">
                  <label>
                    <Localize i18n_default_text="Target Digit:" />
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="9"
                    value={matchDifferDigit}
                    onChange={(e) => setMatchDifferDigit(parseInt(e.target.value))}
                    disabled={isTrading}
                    className="speed-bot__config-input"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="speed-bot__execute-button">
            {!isTrading ? (
              <button
                onClick={startTrading}
                disabled={!isConnected}
                className="speed-bot__execute-trades"
              >
                <Localize i18n_default_text="EXECUTE TRADES" />
              </button>
            ) : (
              <button
                onClick={stopTrading}
                className="speed-bot__execute-trades speed-bot__execute-trades--stop"
              >
                <Localize i18n_default_text="STOP TRADING" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="speed-bot__trading-results">
        <h3>
          <Localize i18n_default_text="Trading Results" />
        </h3>
        <div className="speed-bot__results-stats">
          <div className="speed-bot__stat-item">
            <div className="speed-bot__stat-number">{totalTrades}</div>
            <div className="speed-bot__stat-label">Total Trades</div>
          </div>
          <div className="speed-bot__stat-item">
            <div className="speed-bot__stat-number">{tradeHistory.filter(t => t.result === 'win').length}</div>
            <div className="speed-bot__stat-label">Won</div>
          </div>
          <div className="speed-bot__stat-item">
            <div className="speed-bot__stat-number">{tradeHistory.filter(t => t.result === 'loss').length}</div>
            <div className="speed-bot__stat-label">Lost</div>
          </div>
        </div>
      </div>

      <div className="speed-bot__stats">
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Current Price</div>
          <div className="speed-bot__stat-value">{currentPrice}</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Current Stake</div>
          <div className="speed-bot__stat-value">{currentStake.toFixed(2)}</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Total Trades</div>
          <div className="speed-bot__stat-value">{totalTrades}</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Win Rate</div>
          <div className="speed-bot__stat-value">{winRate.toFixed(1)}%</div>
        </div>
        <div className="speed-bot__stat-card">
          <div className="speed-bot__stat-label">Total P&L</div>
          <div className={\`speed-bot__stat-value \${totalProfit >= 0 ? 'profit' : 'loss'}\`}>
            {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
          </div>
        </div>
        {useMartingale && (
          <div className="speed-bot__stat-card">
            <div className="speed-bot__stat-label">Consecutive Losses</div>
            <div className="speed-bot__stat-value">{consecutiveLosses}</div>
          </div>
        )}
      </div>

      {!isAuthorized && (
        <div className="speed-bot__warning">
          <p>⚠️ <strong>Please log in to your Deriv account to start real money trading.</strong></p>
        </div>
      )}

      <div className="speed-bot__history">
        <h3 className="speed-bot__history-title">
          <Localize i18n_default_text="Recent Trades" />
        </h3>
        <div className="speed-bot__history-list">
          {tradeHistory.length === 0 ? (
            <div className="speed-bot__no-trades">
              <Localize i18n_default_text="No trades yet" />
            </div>
          ) : (
            tradeHistory.slice(0, 10).map((trade) => (
              <div key={trade.id} className={\`speed-bot__trade-item \${trade.result}\`}>
                <div className="speed-bot__trade-time">{trade.timestamp}</div>
                <div className="speed-bot__trade-details">
                  {trade.contractType} - {trade.prediction} vs {trade.actual}
                  {trade.tickValue !== undefined && <span className="speed-bot__tick-value"> (Tick: {trade.tickValue})</span>}
                  {trade.contractId && <span className="speed-bot__real-trade"> (REAL)</span>}
                  {trade.isBulkTrade && <span className="speed-bot__bulk-trade"> (BULK)</span>}
                  <span className="speed-bot__stake"> Stake: {trade.stake.toFixed(2)}</span>
                </div>
                <div className={\`speed-bot__trade-result \${trade.result}\`}>
                  {trade.result === 'win' ? '✅' : trade.result === 'loss' ? '❌' : '⏳'} {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SpeedBot;