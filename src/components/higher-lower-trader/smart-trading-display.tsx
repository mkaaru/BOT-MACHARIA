import React, { useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { useStore } from '@/hooks/useStore';
import { Button, Text } from '@deriv-com/ui';
import { localize } from '@deriv-com/translations';
import { api_base } from '../../external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '../../external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import './smart-trading-display.scss';

const SmartTradingDisplay = observer(() => {
  const { run_panel, transactions, client } = useStore();
  const { is_drawer_open } = run_panel;

  // State management for trading strategies
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [tickCount, setTickCount] = useState(120);
  const [barrier, setBarrier] = useState(5);
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const [analysisData, setAnalysisData] = useState({
    'rise-fall': {
      prediction: 'Rise',
      confidence: 68,
      lastChange: 0.002,
      isTrading: false
    },
    'even-odd': {
      prediction: 'Even',
      confidence: 72,
      lastDigit: 4,
      isTrading: false
    },
    'even-odd-patterns': {
      prediction: 'Odd',
      confidence: 65,
      pattern: [2, 4, 6],
      isTrading: false
    },
    'over-under': {
      prediction: 'Over',
      confidence: 58,
      barrier: 5,
      isTrading: false
    },
    'over-under-patterns': {
      prediction: 'Under',
      confidence: 61,
      pattern: [3, 7, 2],
      isTrading: false
    },
    'matches-differs': {
      prediction: 'Differs',
      confidence: 75,
      targetDigit: 5,
      isTrading: false
    }
  });

  const [tradingPerformance, setTradingPerformance] = useState({
    'rise-fall': { totalTrades: 24, wins: 16, totalProfit: 12.50 },
    'even-odd': { totalTrades: 18, wins: 13, totalProfit: 8.75 },
    'even-odd-patterns': { totalTrades: 15, wins: 9, totalProfit: 5.25 },
    'over-under': { totalTrades: 21, wins: 12, totalProfit: 3.80 },
    'over-under-patterns': { totalTrades: 12, wins: 8, totalProfit: 6.40 },
    'matches-differs': { totalTrades: 9, wins: 7, totalProfit: 15.20 }
  });

  const [currentPrice, setCurrentPrice] = useState('4,521.23');

  // Trading strategies configuration
  const tradingStrategies = [
    {
      id: 'rise-fall',
      name: 'Rise/Fall',
      description: 'AI-powered trading strategies analyzing price movements'
    },
    {
      id: 'even-odd',
      name: 'Even/Odd',
      description: 'Predict if the last digit will be even or odd'
    },
    {
      id: 'even-odd-patterns',
      name: 'Even/Odd Patterns',
      description: 'Advanced pattern recognition for even/odd predictions'
    },
    {
      id: 'over-under',
      name: 'Over/Under',
      description: 'Predict if the last digit will be over or under the barrier'
    },
    {
      id: 'over-under-patterns',
      name: 'Over/Under Patterns',
      description: 'Pattern-based over/under predictions'
    },
    {
      id: 'matches-differs',
      name: 'Matches/Differs',
      description: 'Predict if the last digit matches or differs from target'
    }
  ];

  // Auto trading functions
  const startAutoTrading = useCallback((strategyId) => {
    setAnalysisData(prev => ({
      ...prev,
      [strategyId]: {
        ...prev[strategyId],
        isTrading: true
      }
    }));
    console.log(`Starting auto trading for ${strategyId}`);
  }, []);

  const stopAutoTrading = useCallback((strategyId) => {
    setAnalysisData(prev => ({
      ...prev,
      [strategyId]: {
        ...prev[strategyId],
        isTrading: false
      }
    }));
    console.log(`Stopping auto trading for ${strategyId}`);
  }, []);

  // Execute manual trade
  const executeTrade = useCallback((strategyId) => {
    console.log(`Executing manual trade for ${strategyId}`);
    // Add manual trade logic here
  }, []);

  const getConfidenceColor = (confidence) => {
    if (confidence >= 70) return 'high';
    if (confidence >= 60) return 'medium';
    return 'low';
  };

  const getPredictionColor = (prediction) => {
    if (prediction === 'Rise' || prediction === 'Over') return 'rise';
    if (prediction === 'Fall' || prediction === 'Under') return 'fall';
    return 'neutral';
  };

  return (
    <div className={classNames('smart-trading-analytics', { 'smart-trading-analytics--drawer-open': is_drawer_open })}>
      <div className="analyzer-header">
        <div className="header-content">
          <h2>{localize('Smart Trading Analytics')}</h2>
          <div className="header-actions">
            <button className="reconnect-btn">{localize('Reconnect')}</button>
          </div>
        </div>
        <div className="connection-info">
          <div className="connection-status connected">
            <span className="status-dot"></span>
            {localize('Connected')}
          </div>
        </div>
      </div>

      <div className="analyzer-controls">
        <div className="control-group">
          <label>{localize('Symbol')}</label>
          <select 
            value={selectedSymbol} 
            onChange={(e) => setSelectedSymbol(e.target.value)}
          >
            <option value="R_10">Volatility 10 Index</option>
            <option value="R_25">Volatility 25 Index</option>
            <option value="R_50">Volatility 50 Index</option>
            <option value="R_75">Volatility 75 Index</option>
            <option value="R_100">Volatility 100 Index</option>
          </select>
        </div>
        <div className="control-group">
          <label>{localize('Ticks')}</label>
          <input 
            type="number" 
            value={tickCount} 
            onChange={(e) => setTickCount(Number(e.target.value))}
            min="10"
            max="1000"
          />
        </div>
        <div className="control-group">
          <label>{localize('Current Price')}</label>
          <div className="current-price">{currentPrice}</div>
        </div>
      </div>

      <div className="trading-cards-grid">
        {tradingStrategies.map((strategy) => {
          const analysis = analysisData[strategy.id];
          const performance = tradingPerformance[strategy.id];
          const winRate = performance ? Math.round((performance.wins / performance.totalTrades) * 100) : 0;

          return (
            <div key={strategy.id} className="trading-card">
              <div className="card-header">
                <h3>{strategy.name}</h3>
                <div className={`status-indicator ${connectionStatus}`}></div>
              </div>

              <div className="card-content">
                <div className="prediction-section">
                  <div className="prediction-display">
                    <div className={`prediction-value ${getPredictionColor(analysis.prediction)}`}>
                      {analysis.prediction}
                    </div>
                    <div className={`confidence-bar confidence-${getConfidenceColor(analysis.confidence)}`}>
                      <div 
                        className="confidence-fill"
                        style={{ width: `${analysis.confidence}%` }}
                      ></div>
                      <span className="confidence-text">{analysis.confidence}%</span>
                    </div>
                  </div>
                </div>

                <div className="trading-conditions">
                  <div className="condition-item">
                    <span className="label">{localize('Trading Condition')}</span>
                    <div className="condition-controls">
                      <select>
                        <option>{localize('2 tick')}</option>
                        <option>{localize('3 tick')}</option>
                        <option>{localize('5 tick')}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="analysis-details">
                  <div className="detail-row">
                    <span className="label">{localize('Analysis')}</span>
                    <span className="value">{strategy.description}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">{localize('Performance')}</span>
                    <span className="value">
                      {performance?.totalTrades || 0} trades, {winRate}% win rate
                    </span>
                  </div>
                </div>

                <div className="stats-section">
                  <div className="stat-item">
                    <span className="stat-label">{localize('Last Result')}</span>
                    <span className="stat-value win">Win</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">{localize('Contract Value')}</span>
                    <span className="stat-value">0.5</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">{localize('Last Profit')}</span>
                    <span className="stat-value profit">+{(performance?.totalProfit / performance?.totalTrades || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="card-footer">
                <button 
                  className={`start-trading-btn ${analysis.isTrading ? 'trading-active' : ''}`}
                  onClick={() => analysis.isTrading ? stopAutoTrading(strategy.id) : startAutoTrading(strategy.id)}
                >
                  {analysis.isTrading ? localize('STOP AUTO TRADING') : localize('START AUTO TRADING')}
                </button>
                <button 
                  className="manual-trade-btn"
                  onClick={() => executeTrade(strategy.id)}
                  disabled={analysis.isTrading}
                >
                  {localize('Manual Trade')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SmartTradingDisplay;