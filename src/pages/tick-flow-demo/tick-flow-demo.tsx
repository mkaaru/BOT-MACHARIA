
import React, { useState, useEffect } from 'react';
import { TickBasedCandleEngine, TickData, TickCandleData } from '../../services/tick-based-candle-engine';
import { TrendAnalysisEngine } from '../../services/trend-analysis-engine';
import './tick-flow-demo.scss';

interface TickFlowStats {
  totalTicks: number;
  completedCandles: number;
  currentBufferTicks: number;
  lastTrendAnalysis: any;
  processingRate: number;
}

export const TickFlowDemo: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<TickFlowStats>({
    totalTicks: 0,
    completedCandles: 0,
    currentBufferTicks: 0,
    lastTrendAnalysis: null,
    processingRate: 0
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [ticksPerCandle, setTicksPerCandle] = useState(5);

  // Initialize engines
  const [tickEngine] = useState(() => new TickBasedCandleEngine(ticksPerCandle));
  const [trendEngine] = useState(() => new TrendAnalysisEngine());

  useEffect(() => {
    // Subscribe to candle completion events
    const handleCandleComplete = (candle: TickCandleData) => {
      // Send completed candle to trend analysis engine
      trendEngine.addTickCandleData(candle);
      
      // Update stats
      setStats(prev => ({
        ...prev,
        completedCandles: prev.completedCandles + 1,
        lastTrendAnalysis: trendEngine.getTrendAnalysis(candle.symbol)
      }));

      // Add log entry
      const logEntry = `✅ Candle #${candle.candleNumber} completed: ${candle.open.toFixed(5)} → ${candle.close.toFixed(5)} (${candle.tickCount} ticks)`;
      setLogs(prev => [logEntry, ...prev.slice(0, 19)]); // Keep last 20 logs
    };

    // Register callback for demo symbol
    tickEngine.subscribeToCandles('1HZ100V', handleCandleComplete);

    return () => {
      tickEngine.destroy();
      trendEngine.destroy();
    };
  }, [tickEngine, trendEngine]);

  // Simulate incoming ticks
  useEffect(() => {
    if (!isRunning) return;

    let tickCount = 0;
    const startTime = Date.now();
    
    const interval = setInterval(() => {
      // Generate simulated tick data
      const basePrice = 100;
      const volatility = 0.001;
      const randomWalk = (Math.random() - 0.5) * volatility;
      const price = basePrice + Math.sin(tickCount * 0.1) * 0.5 + randomWalk;

      const tick: TickData = {
        symbol: '1HZ100V',
        epoch: Math.floor(Date.now() / 1000),
        quote: price,
        volume: Math.floor(Math.random() * 100) + 1
      };

      // Process tick through engine
      tickEngine.processTick(tick);
      tickCount++;

      // Update stats
      const currentBuffer = tickEngine.getCurrentBuffer('1HZ100V');
      const processingRate = tickCount / ((Date.now() - startTime) / 1000);
      
      setStats(prev => ({
        ...prev,
        totalTicks: tickCount,
        currentBufferTicks: currentBuffer?.tickCount || 0,
        processingRate
      }));

    }, 200); // Generate tick every 200ms

    return () => clearInterval(interval);
  }, [isRunning, tickEngine]);

  const handleToggleDemo = () => {
    setIsRunning(!isRunning);
    if (!isRunning) {
      // Clear stats when starting
      setStats({
        totalTicks: 0,
        completedCandles: 0,
        currentBufferTicks: 0,
        lastTrendAnalysis: null,
        processingRate: 0
      });
      setLogs([]);
    }
  };

  const handleUpdateTicksPerCandle = (newValue: number) => {
    if (!isRunning) {
      setTicksPerCandle(newValue);
      // Recreate engine with new tick count
      // Note: In real implementation, you'd want to preserve existing data
    }
  };

  return (
    <div className="tick-flow-demo">
      <div className="demo-header">
        <h2>🔄 Tick Flow Demonstration</h2>
        <p>Raw Ticks → TickBasedCandleEngine → N-tick Candles → TrendAnalysisEngine</p>
      </div>

      <div className="demo-controls">
        <button 
          className={`demo-button ${isRunning ? 'stop' : 'start'}`}
          onClick={handleToggleDemo}
        >
          {isRunning ? '⏸️ Stop Demo' : '▶️ Start Demo'}
        </button>
        
        <div className="config-section">
          <label>Ticks per Candle:</label>
          <select 
            value={ticksPerCandle} 
            onChange={(e) => handleUpdateTicksPerCandle(Number(e.target.value))}
            disabled={isRunning}
          >
            <option value={3}>3 ticks</option>
            <option value={5}>5 ticks</option>
            <option value={10}>10 ticks</option>
            <option value={20}>20 ticks</option>
          </select>
        </div>
      </div>

      <div className="demo-stats">
        <div className="stat-card">
          <h4>📊 Processing Stats</h4>
          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-label">Total Ticks:</span>
              <span className="stat-value">{stats.totalTicks}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Completed Candles:</span>
              <span className="stat-value">{stats.completedCandles}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Current Buffer:</span>
              <span className="stat-value">{stats.currentBufferTicks}/{ticksPerCandle} ticks</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Processing Rate:</span>
              <span className="stat-value">{stats.processingRate.toFixed(1)} ticks/s</span>
            </div>
          </div>
        </div>

        {stats.lastTrendAnalysis && (
          <div className="stat-card">
            <h4>📈 Latest Trend Analysis</h4>
            <div className="trend-grid">
              <div className="trend-item">
                <span className="trend-label">Direction:</span>
                <span className={`trend-value ${stats.lastTrendAnalysis.direction}`}>
                  {stats.lastTrendAnalysis.direction}
                </span>
              </div>
              <div className="trend-item">
                <span className="trend-label">Strength:</span>
                <span className="trend-value">{stats.lastTrendAnalysis.strength}</span>
              </div>
              <div className="trend-item">
                <span className="trend-label">Confidence:</span>
                <span className="trend-value">{stats.lastTrendAnalysis.confidence.toFixed(1)}%</span>
              </div>
              <div className="trend-item">
                <span className="trend-label">Recommendation:</span>
                <span className={`trend-value recommendation ${stats.lastTrendAnalysis.recommendation.toLowerCase()}`}>
                  {stats.lastTrendAnalysis.recommendation}
                </span>
              </div>
              <div className="trend-item">
                <span className="trend-label">Fast ROC:</span>
                <span className="trend-value">{stats.lastTrendAnalysis.fastROC?.toFixed(4)}%</span>
              </div>
              <div className="trend-item">
                <span className="trend-label">Slow ROC:</span>
                <span className="trend-value">{stats.lastTrendAnalysis.slowROC?.toFixed(4)}%</span>
              </div>
              {stats.lastTrendAnalysis.tickTrend && (
                <>
                  <div className="trend-item">
                    <span className="trend-label">60-Tick Trend:</span>
                    <span className={`trend-value ${stats.lastTrendAnalysis.tickTrend.direction.toLowerCase()}`}>
                      {stats.lastTrendAnalysis.tickTrend.direction} ({stats.lastTrendAnalysis.tickTrend.consistency.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="trend-item">
                    <span className="trend-label">Tick Movements:</span>
                    <span className="trend-value">
                      ↑{stats.lastTrendAnalysis.tickTrend.bullishCount} ↓{stats.lastTrendAnalysis.tickTrend.bearishCount}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="demo-flow-diagram">
        <h4>🔄 Data Flow Visualization</h4>
        <div className="flow-steps">
          <div className={`flow-step ${isRunning ? 'active' : ''}`}>
            <div className="step-icon">📡</div>
            <div className="step-content">
              <h5>Raw Ticks</h5>
              <p>Simulated market data</p>
              <small>{stats.totalTicks} ticks processed</small>
            </div>
          </div>
          
          <div className="flow-arrow">→</div>
          
          <div className={`flow-step ${stats.currentBufferTicks > 0 ? 'active' : ''}`}>
            <div className="step-icon">🕰️</div>
            <div className="step-content">
              <h5>Tick Buffer</h5>
              <p>Collecting {ticksPerCandle} ticks</p>
              <small>{stats.currentBufferTicks}/{ticksPerCandle} buffered</small>
            </div>
          </div>
          
          <div className="flow-arrow">→</div>
          
          <div className={`flow-step ${stats.completedCandles > 0 ? 'active' : ''}`}>
            <div className="step-icon">📊</div>
            <div className="step-content">
              <h5>N-tick Candles</h5>
              <p>OHLC candle formation</p>
              <small>{stats.completedCandles} candles formed</small>
            </div>
          </div>
          
          <div className="flow-arrow">→</div>
          
          <div className={`flow-step ${stats.lastTrendAnalysis ? 'active' : ''}`}>
            <div className="step-icon">🧠</div>
            <div className="step-content">
              <h5>Trend Analysis</h5>
              <p>ROC-based analysis</p>
              <small>{stats.lastTrendAnalysis?.recommendation || 'Waiting...'}</small>
            </div>
          </div>
        </div>
      </div>

      <div className="demo-logs">
        <h4>📝 Processing Logs</h4>
        <div className="logs-container">
          {logs.length === 0 ? (
            <div className="no-logs">No activity yet. Start the demo to see logs.</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="log-entry">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default TickFlowDemo;
