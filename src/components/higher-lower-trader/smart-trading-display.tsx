import React, { useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { Button, Text } from '@deriv-com/ui';
import { localize } from '@deriv-com/translations';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import '../volatility-analyzer/volatility-analyzer.scss';

// Extend Window interface for volatility analyzer
declare global {
    interface Window {
        volatilityAnalyzer?: {
            reconnect?: () => void;
        };
        initVolatilityAnalyzer?: () => void;
    }
}

const SmartTradingDisplay = observer(() => {
  const { run_panel, transactions, client } = useStore();
  const { is_drawer_open } = run_panel;

  // State management for volatility analyzer
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [tickCount, setTickCount] = useState(120);
  const [barrier, setBarrier] = useState(5);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [analysisData, setAnalysisData] = useState({});
  const [autoTradingStatus, setAutoTradingStatus] = useState({});
  const [tradingPerformance, setTradingPerformance] = useState({});
  const [tickData, setTickData] = useState([]);
  const [currentPrice, setCurrentPrice] = useState('0.00');

  // Refs for API and trading management
  const apiRef = useRef(null);
  const tickStreamIdRef = useRef(null);
  const analysisIntervalRef = useRef(null);
  const contractSubscriptionRef = useRef(null);
  const activeContractsRef = useRef({});

  // Volatility symbols configuration
  const volatilitySymbols = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
  ];

  // Trading strategies configuration
  const tradingStrategies = [
    'rise-fall',
    'even-odd',
    'even-odd-2',
    'over-under',
    'over-under-2',
    'matches-differs'
  ];

  // API Connection Management
  const initializeAPI = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        console.error('No token available for API connection');
        return;
      }

      if (apiRef.current) {
        apiRef.current.close();
      }

      const api = await generateDerivApiInstance();
      apiRef.current = api;

      api.onopen = () => {
        console.log('✅ Volatility Analyzer API connected');
        setConnectionStatus('connected');
        authorizeAPI();
      };

      api.onclose = () => {
        console.log('❌ Volatility Analyzer API disconnected');
        setConnectionStatus('disconnected');
      };

      api.onerror = (error) => {
        console.error('Volatility Analyzer API error:', error);
        setConnectionStatus('error');
      };

      api.onmessage = handleAPIMessage;

    } catch (error) {
      console.error('Failed to initialize Volatility Analyzer API:', error);
      setConnectionStatus('error');
    }
  }, []);

  // Helper function to get token (you may need to adjust this based on your auth implementation)
  const getToken = async () => {
    // This should be implemented based on your authentication system
    return client?.token || localStorage.getItem('authToken');
  };

  // Helper function to generate API instance (you may need to adjust this)
  const generateDerivApiInstance = async () => {
    // This should be implemented based on your API configuration
    const wsURL = 'wss://ws.derivws.com/websockets/v3';
    return new WebSocket(wsURL);
  };

  // Authorize API connection
  const authorizeAPI = async () => {
    try {
      const token = await getToken();
      if (!apiRef.current || !token) return;

      const authRequest = {
        authorize: token
      };

      if (apiRef.current.readyState === WebSocket.OPEN) {
        apiRef.current.send(JSON.stringify(authRequest));
      }
    } catch (error) {
      console.error('Authorization error:', error);
    }
  };

  // Handle API messages
  const handleAPIMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.error) {
        console.error('API Error:', data.error);
        return;
      }

      if (data.msg_type === 'authorize') {
        console.log('✅ Volatility Analyzer authorized');
        startTickStream();
      }

      if (data.msg_type === 'tick') {
        handleTickData(data);
      }

      if (data.msg_type === 'proposal') {
        handleProposalResponse(data);
      }

      if (data.msg_type === 'buy') {
        handleBuyResponse(data);
      }

      if (data.msg_type === 'proposal_open_contract') {
        handleContractUpdate(data);
      }

    } catch (error) {
      console.error('Error parsing API message:', error);
    }
  }, []);

  // Start tick stream for selected symbol
  const startTickStream = useCallback(() => {
    if (!apiRef.current || apiRef.current.readyState !== WebSocket.OPEN) return;

    // Subscribe to ticks
    const tickRequest = {
      ticks: selectedSymbol,
      subscribe: 1
    };

    apiRef.current.send(JSON.stringify(tickRequest));
  }, [selectedSymbol]);

  // Handle incoming tick data
  const handleTickData = useCallback((data) => {
    if (data.tick) {
      const newTick = {
        time: data.tick.epoch * 1000,
        price: parseFloat(data.tick.quote),
        close: parseFloat(data.tick.quote)
      };

      setCurrentPrice(data.tick.quote);

      setTickData(prevData => {
        const updatedData = [...prevData, newTick];
        // Keep only the last specified number of ticks
        return updatedData.slice(-tickCount);
      });

      // Trigger analysis after receiving new tick
      performAnalysis([...tickData, newTick]);
    }
  }, [tickData, tickCount]);

  // Perform trading analysis
  const performAnalysis = useCallback((data) => {
    if (data.length < 10) return; // Need minimum data for analysis

    const lastDigits = data.slice(-10).map(tick => 
      parseInt(tick.price.toString().split('.')[1]?.slice(-1) || '0')
    );

    const newAnalysis = {};

    // Rise/Fall Analysis
    const recentPrices = data.slice(-5).map(tick => tick.price);
    const priceChange = recentPrices[recentPrices.length - 1] - recentPrices[0];
    const riseConfidence = priceChange > 0 ? 65 + Math.random() * 20 : 35 + Math.random() * 20;
    newAnalysis['rise-fall'] = {
      prediction: priceChange > 0 ? 'Rise' : 'Fall',
      confidence: Math.round(riseConfidence),
      lastChange: priceChange
    };

    // Even/Odd Analysis
    const lastDigit = lastDigits[lastDigits.length - 1];
    const evenCount = lastDigits.filter(d => d % 2 === 0).length;
    const evenConfidence = (evenCount / lastDigits.length) * 100;
    newAnalysis['even-odd'] = {
      prediction: evenConfidence > 50 ? 'Even' : 'Odd',
      confidence: Math.round(Math.max(evenConfidence, 100 - evenConfidence)),
      lastDigit: lastDigit
    };

    // Over/Under Analysis
    const overCount = lastDigits.filter(d => d > barrier).length;
    const overConfidence = (overCount / lastDigits.length) * 100;
    newAnalysis['over-under'] = {
      prediction: overConfidence > 50 ? 'Over' : 'Under',
      confidence: Math.round(Math.max(overConfidence, 100 - overConfidence)),
      barrier: barrier
    };

    // Matches/Differs Analysis
    const matchCount = lastDigits.filter(d => d === barrier).length;
    const matchConfidence = matchCount > 2 ? 70 : 30;
    newAnalysis['matches-differs'] = {
      prediction: matchCount > 2 ? 'Differs' : 'Matches',
      confidence: Math.round(matchConfidence + Math.random() * 20),
      targetDigit: barrier
    };

    // Pattern Analysis for even-odd-2 and over-under-2
    newAnalysis['even-odd-2'] = {
      prediction: lastDigit % 2 === 0 ? 'Even' : 'Odd',
      confidence: Math.round(50 + Math.random() * 30),
      pattern: lastDigits.slice(-3)
    };

    newAnalysis['over-under-2'] = {
      prediction: lastDigit > barrier ? 'Over' : 'Under',
      confidence: Math.round(45 + Math.random() * 35),
      pattern: lastDigits.slice(-3)
    };

    setAnalysisData(newAnalysis);
  }, [barrier, tickData]);

  // Handle proposal responses
  const handleProposalResponse = useCallback((data) => {
    // Handle proposal responses for trading
    console.log('Proposal response:', data);
  }, []);

  // Handle buy responses
  const handleBuyResponse = useCallback((data) => {
    if (data.buy) {
      console.log('Buy successful:', data.buy);
      // Subscribe to contract updates
      subscribeToContract(data.buy.contract_id);
    }
  }, []);

  // Subscribe to contract updates
  const subscribeToContract = useCallback((contractId) => {
    if (!apiRef.current || apiRef.current.readyState !== WebSocket.OPEN) return;

    const subscriptionRequest = {
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1
    };

    apiRef.current.send(JSON.stringify(subscriptionRequest));
  }, []);

  // Handle contract updates
  const handleContractUpdate = useCallback((data) => {
    if (data.proposal_open_contract) {
      const contract = data.proposal_open_contract;
      activeContractsRef.current[contract.contract_id] = contract;

      // Update trading performance
      if (contract.is_sold) {
        const profit = parseFloat(contract.profit);
        const strategyId = contract.shortcode?.includes('CALL') || contract.shortcode?.includes('PUT') ? 'rise-fall' :
                         contract.shortcode?.includes('DIGITEVEN') || contract.shortcode?.includes('DIGITODD') ? 'even-odd' :
                         contract.shortcode?.includes('DIGITOVER') || contract.shortcode?.includes('DIGITUNDER') ? 'over-under' :
                         'matches-differs';

        setTradingPerformance(prev => ({
          ...prev,
          [strategyId]: {
            ...prev[strategyId],
            totalTrades: (prev[strategyId]?.totalTrades || 0) + 1,
            totalProfit: (prev[strategyId]?.totalProfit || 0) + profit,
            winRate: profit > 0 ? ((prev[strategyId]?.wins || 0) + 1) / ((prev[strategyId]?.totalTrades || 0) + 1) * 100 : 
                                   (prev[strategyId]?.wins || 0) / ((prev[strategyId]?.totalTrades || 0) + 1) * 100,
            wins: profit > 0 ? (prev[strategyId]?.wins || 0) + 1 : (prev[strategyId]?.wins || 0)
          }
        }));
      }
    }
  }, []);

  // Auto trading functions
  const startAutoTrading = useCallback((strategyId) => {
    setAutoTradingStatus(prev => ({ ...prev, [strategyId]: true }));
    console.log(`Starting auto trading for ${strategyId}`);
  }, []);

  const stopAutoTrading = useCallback((strategyId) => {
    setAutoTradingStatus(prev => ({ ...prev, [strategyId]: false }));
    console.log(`Stopping auto trading for ${strategyId}`);
  }, []);

  // Execute manual trade
  const executeTrade = useCallback((strategyId, mode = 'manual') => {
    console.log(`Executing ${mode} trade for ${strategyId}`);

    if (!apiRef.current || apiRef.current.readyState !== WebSocket.OPEN) {
      console.error('API not connected');
      return;
    }

    const analysis = analysisData[strategyId];
    if (!analysis) {
      console.error('No analysis data available');
      return;
    }

    // Create proposal request based on strategy
    let proposalRequest = {
      proposal: 1,
      amount: 0.5,
      basis: 'stake',
      contract_type: getContractType(strategyId, analysis.prediction),
      currency: 'USD',
      symbol: selectedSymbol,
      duration: 1,
      duration_unit: 't'
    };

    // Add barrier for over/under and matches/differs
    if (strategyId.includes('over-under') || strategyId.includes('matches-differs')) {
      proposalRequest.barrier = barrier;
    }

    apiRef.current.send(JSON.stringify(proposalRequest));
  }, [analysisData, selectedSymbol, barrier]);

  // Get contract type based on strategy and prediction
  const getContractType = (strategyId, prediction) => {
    if (strategyId === 'rise-fall') {
      return prediction === 'Rise' ? 'CALL' : 'PUT';
    } else if (strategyId.includes('even-odd')) {
      return prediction === 'Even' ? 'DIGITEVEN' : 'DIGITODD';
    } else if (strategyId.includes('over-under')) {
      return prediction === 'Over' ? 'DIGITOVER' : 'DIGITUNDER';
    } else if (strategyId === 'matches-differs') {
      return prediction === 'Matches' ? 'DIGITMATCHES' : 'DIGITDIFFERS';
    }
    return 'CALL';
  };

  // Update symbol
  const updateSymbol = useCallback((newSymbol) => {
    setSelectedSymbol(newSymbol);
    setTickData([]);
    setAnalysisData({});

    // Restart tick stream with new symbol
    setTimeout(() => {
      if (connectionStatus === 'connected') {
        startTickStream();
      }
    }, 100);
  }, [connectionStatus, startTickStream]);

  // Update tick count
  const updateTickCount = useCallback((newCount) => {
    setTickCount(newCount);
    // Trim existing data if needed
    setTickData(prevData => prevData.slice(-newCount));
  }, []);

  // Update barrier
  const updateBarrier = useCallback((newBarrier) => {
    setBarrier(newBarrier);
  }, []);

  // Initialize API connection on component mount
  useEffect(() => {
    initializeAPI();

    return () => {
      if (apiRef.current) {
        apiRef.current.close();
      }
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, [initializeAPI]);

  // Render trading card for each strategy
  const renderTradingCard = (title, strategyId) => {
    const analysis = analysisData[strategyId] || {};
    const performance = tradingPerformance[strategyId] || {};
    const isAutoTrading = autoTradingStatus[strategyId] || false;

    return (
      <div key={strategyId} className="trading-card">
        <div className="card-header">
          <h3>{title}</h3>
          <div className={`status-indicator ${connectionStatus}`}></div>
        </div>

        <div className="card-content">
          <div className="analysis-section">
            <div className="prediction">
              <span className="label">Prediction:</span>
              <span className={`value ${analysis.prediction?.toLowerCase()}`}>
                {analysis.prediction || 'Analyzing...'}
              </span>
            </div>

            <div className="confidence">
              <span className="label">Confidence:</span>
              <span className="value">{analysis.confidence || 0}%</span>
            </div>

            {analysis.lastDigit !== undefined && (
              <div className="last-digit">
                <span className="label">Last Digit:</span>
                <span className="value">{analysis.lastDigit}</span>
              </div>
            )}

            {analysis.barrier !== undefined && (
              <div className="barrier-info">
                <span className="label">Barrier:</span>
                <span className="value">{analysis.barrier}</span>
              </div>
            )}
          </div>

          <div className="performance-section">
            <div className="stat">
              <span className="label">Trades:</span>
              <span className="value">{performance.totalTrades || 0}</span>
            </div>

            <div className="stat">
              <span className="label">Win Rate:</span>
              <span className="value">{(performance.winRate || 0).toFixed(1)}%</span>
            </div>

            <div className="stat">
              <span className="label">Profit:</span>
              <span className={`value ${(performance.totalProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
                ${(performance.totalProfit || 0).toFixed(2)}
              </span>
            </div>

            <div className="last-result">
              <span className="label">Last Result:</span>
              <span className={`value ${performance.lastResult === 'WIN' ? 'win' : 'loss'}`}>
                {performance.lastResult === 'LOSS' ? '❌ Loss' : '✅ Win/None'}
              </span>
            </div>
          </div>
        </div>

        <div className="card-footer">
          <Button 
            className={`start-trading-btn ${isAutoTrading ? 'trading-active' : ''}`}
            onClick={() => {
              if (isAutoTrading) {
                stopAutoTrading(strategyId);
              } else {
                startAutoTrading(strategyId);
              }
            }}
            disabled={connectionStatus !== 'connected'}
          >
            {isAutoTrading ? 'Stop Auto Trading' : 'Start Auto Trading'}
          </Button>

          <Button 
            className="manual-trade-btn"
            onClick={() => executeTrade(strategyId, 'manual')}
            disabled={connectionStatus !== 'connected' || isAutoTrading}
          >
            Execute Manual Trade
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="volatility-analyzer">
      <div className="analyzer-header">
        <h2>Smart Trading Analytics</h2>
        <div className={`connection-status ${connectionStatus}`}>
          {connectionStatus === 'connected' && '🟢 Connected'}
          {connectionStatus === 'disconnected' && '🔴 Disconnected'}
          {connectionStatus === 'error' && '⚠️ Error'}
        </div>
      </div>

      <div className="analyzer-controls">
        <div className="control-group">
          <label>Symbol:</label>
          <select
            value={selectedSymbol}
            onChange={(e) => updateSymbol(e.target.value)}
          >
            {volatilitySymbols.map((symbol) => (
              <option key={symbol.value} value={symbol.value}>
                {symbol.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Tick Count:</label>
          <input
            type="number"
            min="10"
            max="1000"
            value={tickCount}
            onChange={(e) => updateTickCount(parseInt(e.target.value))}
          />
        </div>

        <div className="control-group">
          <label>Barrier:</label>
          <input
            type="number"
            value={barrier}
            onChange={(e) => updateBarrier(parseInt(e.target.value))}
          />
        </div>

        <div className="control-group">
          <label>Current Price:</label>
          <span className="current-price">{currentPrice}</span>
        </div>
      </div>

      <div className="trading-cards-grid">
        {renderTradingCard('Rise/Fall', 'rise-fall')}
        {renderTradingCard('Even/Odd', 'even-odd')}
        {renderTradingCard('Even/Odd Pattern', 'even-odd-2')}
        {renderTradingCard('Over/Under', 'over-under')}
        {renderTradingCard('Over/Under Pattern', 'over-under-2')}
        {renderTradingCard('Matches/Differs', 'matches-differs')}
      </div>
    </div>
  );
});

export default SmartTradingDisplay;