
import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import './higher-lower-trader.scss'; // Import the SCSS file

const HigherLowerTrader = () => {
  // Trading parameters
  const [stake, setStake] = useState(1.5);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [barrier, setBarrier] = useState('+0.37');
  const [contractType, setContractType] = useState('CALL'); // CALL for Higher, PUT for Lower
  const [stopOnProfit, setStopOnProfit] = useState(false);
  const [targetProfit, setTargetProfit] = useState(5.0);

  // Trading state
  const [isTrading, setIsTrading] = useState(false);
  const [currentContract, setCurrentContract] = useState(null);
  const [contractProgress, setContractProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);

  // Mock trading data
  const [totalStake, setTotalStake] = useState(0);
  const [totalPayout, setTotalPayout] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [contractsWon, setContractsWon] = useState(0);
  const [contractsLost, setContractsLost] = useState(0);
  const [totalProfitLoss, setTotalProfitLoss] = useState(0);

  // Current price simulation
  const [currentPrice, setCurrentPrice] = useState(1.27);
  const [priceHistory, setPriceHistory] = useState([1.27]);
  
  const intervalRef = useRef(null);
  const contractTimerRef = useRef(null);

  // Simulate price movement
  useEffect(() => {
    const priceInterval = setInterval(() => {
      setCurrentPrice(prev => {
        const change = (Math.random() - 0.5) * 0.02;
        const newPrice = Math.max(0.1, prev + change);
        setPriceHistory(history => [...history.slice(-50), newPrice]);
        return newPrice;
      });
    }, 1000);

    return () => clearInterval(priceInterval);
  }, []);

  const startTrading = () => {
    setIsTrading(true);
    setCurrentContract({
      id: `contract_${Date.now()}`,
      type: contractType,
      stake: stake,
      barrier: parseFloat(barrier),
      entryPrice: currentPrice,
      startTime: Date.now(),
      duration: durationMinutes * 60 + durationSeconds,
      status: 'active'
    });

    // Start contract timer
    const duration = durationMinutes * 60 + durationSeconds;
    setTimeRemaining(duration);
    setContractProgress(0);

    contractTimerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          // Contract expired
          finishContract();
          return 0;
        }
        const newRemaining = prev - 1;
        setContractProgress(((duration - newRemaining) / duration) * 100);
        return newRemaining;
      });
    }, 1000);

    // Update stats
    setTotalStake(prev => prev + stake);
    setTotalRuns(prev => prev + 1);
  };

  const finishContract = () => {
    if (!currentContract) return;

    const barrierPrice = currentContract.entryPrice + currentContract.barrier;
    const isWin = currentContract.type === 'CALL' 
      ? currentPrice > barrierPrice 
      : currentPrice < barrierPrice;

    const payout = isWin ? stake * 1.8 : 0; // 80% payout rate
    const profit = payout - stake;

    setTotalPayout(prev => prev + payout);
    setTotalProfitLoss(prev => prev + profit);

    if (isWin) {
      setContractsWon(prev => prev + 1);
    } else {
      setContractsLost(prev => prev + 1);
    }

    // Check profit target
    if (stopOnProfit && totalProfitLoss + profit >= targetProfit) {
      stopTrading();
      return;
    }

    // Clear current contract and start next one automatically
    setCurrentContract(null);
    setContractProgress(0);
    if (contractTimerRef.current) {
      clearInterval(contractTimerRef.current);
    }

    // Auto-start next contract after brief delay
    if (isTrading) {
      setTimeout(() => {
        if (isTrading) startTrading();
      }, 2000);
    }
  };

  const stopTrading = () => {
    setIsTrading(false);
    setCurrentContract(null);
    setContractProgress(0);
    setTimeRemaining(0);
    if (contractTimerRef.current) {
      clearInterval(contractTimerRef.current);
    }
  };

  const sellContract = () => {
    if (currentContract) {
      // Early exit with partial payout
      const partialPayout = stake * 0.9; // 90% of stake for early exit
      const profit = partialPayout - stake;
      
      setTotalPayout(prev => prev + partialPayout);
      setTotalProfitLoss(prev => prev + profit);
      
      stopTrading();
    }
  };

  const resetStats = () => {
    setTotalStake(0);
    setTotalPayout(0);
    setTotalRuns(0);
    setContractsWon(0);
    setContractsLost(0);
    setTotalProfitLoss(0);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = () => durationMinutes * 60 + durationSeconds;

  return (
    <div className="higher-lower-trader">
      {/* Header */}
      <div className="trader-header">
        <h2>Higher/Lower Trading</h2>
      </div>

      {/* Active Contract View */}
      {isTrading && currentContract && (
        <div className="active-contract">
          <div className="contract-controls">
            <button
              onClick={stopTrading}
              className="btn-stop"
            >
              Stop
            </button>
            <span className="contract-status">Contract bought</span>
          </div>

          <div className="contract-info">
            <div className="contract-icon">
              {contractType === 'CALL' ? (
                <TrendingUp className="icon-higher" />
              ) : (
                <TrendingDown className="icon-lower" />
              )}
            </div>
            <span className="contract-name">Volatility 10 (1s) Index</span>
            <span className="contract-type">
              {contractType === 'CALL' ? 'Higher' : 'Lower'}
            </span>
          </div>

          <div className="contract-timer">
            <div className="timer-text">{formatTime(timeRemaining)}</div>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${contractProgress}%` }}
              ></div>
            </div>
          </div>

          <div className="contract-stats">
            <div className="stat-item">
              <div className="stat-label">Total profit/loss:</div>
              <div className={`stat-value ${totalProfitLoss >= 0 ? 'profit' : 'loss'}`}>
                {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Contract value:</div>
              <div className="stat-value">{currentPrice.toFixed(2)}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Stake:</div>
              <div className="stat-value">{stake.toFixed(2)} USD</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Potential payout:</div>
              <div className="stat-value profit">{(stake * 1.8).toFixed(2)} USD</div>
            </div>
          </div>

          <button
            onClick={sellContract}
            className="btn-sell"
          >
            Sell
          </button>
        </div>
      )}

      {/* Setup Form */}
      {!isTrading && (
        <div className="setup-form">
          <div className="form-content">
            {/* Contract Type */}
            <div className="form-group">
              <label className="form-label">
                Contract Type
              </label>
              <div className="button-group">
                <button
                  onClick={() => setContractType('CALL')}
                  className={`btn-type ${contractType === 'CALL' ? 'btn-higher active' : 'btn-higher'}`}
                >
                  <TrendingUp className="icon" />
                  Higher
                </button>
                <button
                  onClick={() => setContractType('PUT')}
                  className={`btn-type ${contractType === 'PUT' ? 'btn-lower active' : 'btn-lower'}`}
                >
                  <TrendingDown className="icon" />
                  Lower
                </button>
              </div>
            </div>

            {/* Stake */}
            <div className="form-group">
              <label htmlFor="stake" className="form-label">
                <DollarSign className="icon" />
                Stake (USD)
              </label>
              <input
                id="stake"
                type="number"
                step="0.01"
                min="0.35"
                value={stake}
                onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>

            {/* Duration */}
            <div className="form-group">
              <label className="form-label">
                <Clock className="icon" />
                Duration
              </label>
              <div className="input-group">
                <div className="input-wrapper">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
                    className="form-input"
                    placeholder="Minutes"
                  />
                  <div className="input-hint">Minutes</div>
                </div>
                <div className="input-wrapper">
                  <input
                    type="number"
                    min="15"
                    max="3600"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 15)}
                    className="form-input"
                    placeholder="Seconds"
                  />
                  <div className="input-hint">Seconds</div>
                </div>
              </div>
              <div className="duration-total">
                Total: {formatTime(getTotalDuration())}
              </div>
            </div>

            {/* Barrier */}
            <div className="form-group">
              <label htmlFor="barrier" className="form-label">
                Barrier
              </label>
              <input
                id="barrier"
                type="text"
                value={barrier}
                onChange={(e) => setBarrier(e.target.value)}
                className="form-input"
                placeholder="+0.37"
              />
              <div className="input-hint">
                Use + or - followed by the offset (e.g., +0.37, -0.25)
              </div>
            </div>

            {/* Stop on Profit */}
            <div className="form-option">
              <div className="checkbox-group">
                <input
                  id="stopOnProfit"
                  type="checkbox"
                  checked={stopOnProfit}
                  onChange={(e) => setStopOnProfit(e.target.checked)}
                  className="checkbox"
                />
                <label htmlFor="stopOnProfit" className="checkbox-label">
                  Stop when in profit
                </label>
              </div>
              {stopOnProfit && (
                <div className="option-detail">
                  <label htmlFor="targetProfit" className="option-label">
                    Target Profit (USD)
                  </label>
                  <input
                    id="targetProfit"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={targetProfit}
                    onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                    className="form-input small"
                  />
                </div>
              )}
            </div>

            {/* Start/Stop Button */}
            <button
              onClick={startTrading}
              disabled={getTotalDuration() < 15}
              className="btn-start"
            >
              <Play className="icon" />
              <span>Start Trading</span>
            </button>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="stats-panel">
        <div className="stats-grid">
          <div className="stat">
            <div className="stat-title">Total stake</div>
            <div className="stat-value">{totalStake.toFixed(2)} USD</div>
          </div>
          <div className="stat">
            <div className="stat-title">Total payout</div>
            <div className="stat-value">{totalPayout.toFixed(2)} USD</div>
          </div>
          <div className="stat">
            <div className="stat-title">No. of runs</div>
            <div className="stat-value">{totalRuns}</div>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat">
            <div className="stat-title">Contracts lost</div>
            <div className="stat-value loss">{contractsLost}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Contracts won</div>
            <div className="stat-value profit">{contractsWon}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Total profit/loss</div>
            <div className={`stat-value ${totalProfitLoss >= 0 ? 'profit' : 'loss'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
            </div>
          </div>
        </div>

        <button
          onClick={resetStats}
          className="btn-reset"
        >
          Reset
        </button>
      </div>

      {/* Current Price Display */}
      <div className="price-display">
        <div className="price-content">
          <div className="price-label">Current Price</div>
          <div className="price-value">{currentPrice.toFixed(5)}</div>
          {currentContract && (
            <div className="barrier-info">
              Barrier: {(currentContract.entryPrice + currentContract.barrier).toFixed(5)}
            </div>
          )}
        </div>
      </div>

      {/* Trading Controls */}
      {isTrading && (
        <div className="trading-controls">
          <div className="controls-group">
            <button
              onClick={stopTrading}
              className="btn-stop-bot"
            >
              <Square className="icon" />
              <span>Stop Bot</span>
            </button>
            {currentContract && (
              <button
                onClick={sellContract}
                className="btn-sell-early"
              >
                Sell Early
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HigherLowerTrader;
