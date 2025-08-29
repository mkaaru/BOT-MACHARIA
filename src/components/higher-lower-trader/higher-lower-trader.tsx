
import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';

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
      <div className="higher-lower-trader__container">
        {/* Header */}
        <div className="higher-lower-trader__header">
          <h2 className="higher-lower-trader__title">Higher/Lower Trading</h2>
        </div>

        {/* Active Contract View */}
        {isTrading && currentContract && (
          <div className="higher-lower-trader__active-contract">
            <div className="higher-lower-trader__contract-header">
              <button
                onClick={stopTrading}
                className="higher-lower-trader__stop-btn"
              >
                Stop
              </button>
              <span className="higher-lower-trader__contract-status">Contract bought</span>
            </div>

            <div className="higher-lower-trader__contract-info">
              <div className="higher-lower-trader__contract-icon">
                {contractType === 'CALL' ? (
                  <TrendingUp className="higher-lower-trader__icon higher-lower-trader__icon--up" />
                ) : (
                  <TrendingDown className="higher-lower-trader__icon higher-lower-trader__icon--down" />
                )}
              </div>
              <span className="higher-lower-trader__symbol">Volatility 10 (1s) Index</span>
              <span className="higher-lower-trader__contract-type">
                {contractType === 'CALL' ? 'Higher' : 'Lower'}
              </span>
            </div>

            <div className="higher-lower-trader__progress">
              <div className="higher-lower-trader__time-remaining">{formatTime(timeRemaining)}</div>
              <div className="higher-lower-trader__progress-bar">
                <div 
                  className="higher-lower-trader__progress-fill"
                  style={{ width: `${contractProgress}%` }}
                ></div>
              </div>
            </div>

            <div className="higher-lower-trader__contract-stats">
              <div className="higher-lower-trader__stat">
                <div className="higher-lower-trader__stat-label">Total profit/loss:</div>
                <div className={`higher-lower-trader__stat-value ${totalProfitLoss >= 0 ? 'higher-lower-trader__stat-value--positive' : 'higher-lower-trader__stat-value--negative'}`}>
                  {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
                </div>
              </div>
              <div className="higher-lower-trader__stat">
                <div className="higher-lower-trader__stat-label">Contract value:</div>
                <div className="higher-lower-trader__stat-value">{currentPrice.toFixed(2)}</div>
              </div>
              <div className="higher-lower-trader__stat">
                <div className="higher-lower-trader__stat-label">Stake:</div>
                <div className="higher-lower-trader__stat-value">{stake.toFixed(2)} USD</div>
              </div>
              <div className="higher-lower-trader__stat">
                <div className="higher-lower-trader__stat-label">Potential payout:</div>
                <div className="higher-lower-trader__stat-value higher-lower-trader__stat-value--positive">{(stake * 1.8).toFixed(2)} USD</div>
              </div>
            </div>

            <button
              onClick={sellContract}
              className="higher-lower-trader__sell-btn"
            >
              Sell
            </button>
          </div>
        )}

        {/* Setup Form */}
        {!isTrading && (
          <div className="higher-lower-trader__setup">
            <div className="higher-lower-trader__form">
              {/* Contract Type */}
              <div className="higher-lower-trader__field">
                <label className="higher-lower-trader__label">
                  Contract Type
                </label>
                <div className="higher-lower-trader__contract-buttons">
                  <button
                    onClick={() => setContractType('CALL')}
                    className={`higher-lower-trader__contract-btn ${
                      contractType === 'CALL' 
                        ? 'higher-lower-trader__contract-btn--active higher-lower-trader__contract-btn--call' 
                        : 'higher-lower-trader__contract-btn--inactive'
                    }`}
                  >
                    <TrendingUp className="higher-lower-trader__btn-icon" />
                    Higher
                  </button>
                  <button
                    onClick={() => setContractType('PUT')}
                    className={`higher-lower-trader__contract-btn ${
                      contractType === 'PUT' 
                        ? 'higher-lower-trader__contract-btn--active higher-lower-trader__contract-btn--put' 
                        : 'higher-lower-trader__contract-btn--inactive'
                    }`}
                  >
                    <TrendingDown className="higher-lower-trader__btn-icon" />
                    Lower
                  </button>
                </div>
              </div>

              {/* Stake */}
              <div className="higher-lower-trader__field">
                <label htmlFor="stake" className="higher-lower-trader__label">
                  <DollarSign className="higher-lower-trader__label-icon" />
                  Stake (USD)
                </label>
                <input
                  id="stake"
                  type="number"
                  step="0.01"
                  min="0.35"
                  value={stake}
                  onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                  className="higher-lower-trader__input"
                />
              </div>

              {/* Duration */}
              <div className="higher-lower-trader__field">
                <label className="higher-lower-trader__label">
                  <Clock className="higher-lower-trader__label-icon" />
                  Duration
                </label>
                <div className="higher-lower-trader__duration-inputs">
                  <div className="higher-lower-trader__duration-field">
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
                      className="higher-lower-trader__input"
                      placeholder="Minutes"
                    />
                    <div className="higher-lower-trader__duration-label">Minutes</div>
                  </div>
                  <div className="higher-lower-trader__duration-field">
                    <input
                      type="number"
                      min="15"
                      max="3600"
                      value={durationSeconds}
                      onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 15)}
                      className="higher-lower-trader__input"
                      placeholder="Seconds"
                    />
                    <div className="higher-lower-trader__duration-label">Seconds</div>
                  </div>
                </div>
                <div className="higher-lower-trader__duration-total">
                  Total: {formatTime(getTotalDuration())}
                </div>
              </div>

              {/* Barrier */}
              <div className="higher-lower-trader__field">
                <label htmlFor="barrier" className="higher-lower-trader__label">
                  Barrier
                </label>
                <input
                  id="barrier"
                  type="text"
                  value={barrier}
                  onChange={(e) => setBarrier(e.target.value)}
                  className="higher-lower-trader__input"
                  placeholder="+0.37"
                />
                <div className="higher-lower-trader__field-help">
                  Use + or - followed by the offset (e.g., +0.37, -0.25)
                </div>
              </div>

              {/* Stop on Profit */}
              <div className="higher-lower-trader__profit-stop">
                <div className="higher-lower-trader__checkbox-field">
                  <input
                    id="stopOnProfit"
                    type="checkbox"
                    checked={stopOnProfit}
                    onChange={(e) => setStopOnProfit(e.target.checked)}
                    className="higher-lower-trader__checkbox"
                  />
                  <label htmlFor="stopOnProfit" className="higher-lower-trader__checkbox-label">
                    Stop when in profit
                  </label>
                </div>
                {stopOnProfit && (
                  <div className="higher-lower-trader__target-profit">
                    <label htmlFor="targetProfit" className="higher-lower-trader__label higher-lower-trader__label--small">
                      Target Profit (USD)
                    </label>
                    <input
                      id="targetProfit"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={targetProfit}
                      onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                      className="higher-lower-trader__input higher-lower-trader__input--small"
                    />
                  </div>
                )}
              </div>

              {/* Start/Stop Button */}
              <button
                onClick={startTrading}
                disabled={getTotalDuration() < 15}
                className="higher-lower-trader__start-btn"
              >
                <Play className="higher-lower-trader__btn-icon" />
                <span>Start Trading</span>
              </button>
            </div>
          </div>
        )}

        {/* Statistics */}
        <div className="higher-lower-trader__stats">
          <div className="higher-lower-trader__stats-grid">
            <div className="higher-lower-trader__stat-item">
              <div className="higher-lower-trader__stat-label">Total stake</div>
              <div className="higher-lower-trader__stat-value">{totalStake.toFixed(2)} USD</div>
            </div>
            <div className="higher-lower-trader__stat-item">
              <div className="higher-lower-trader__stat-label">Total payout</div>
              <div className="higher-lower-trader__stat-value">{totalPayout.toFixed(2)} USD</div>
            </div>
            <div className="higher-lower-trader__stat-item">
              <div className="higher-lower-trader__stat-label">No. of runs</div>
              <div className="higher-lower-trader__stat-value">{totalRuns}</div>
            </div>
          </div>

          <div className="higher-lower-trader__stats-grid">
            <div className="higher-lower-trader__stat-item">
              <div className="higher-lower-trader__stat-label">Contracts lost</div>
              <div className="higher-lower-trader__stat-value higher-lower-trader__stat-value--negative">{contractsLost}</div>
            </div>
            <div className="higher-lower-trader__stat-item">
              <div className="higher-lower-trader__stat-label">Contracts won</div>
              <div className="higher-lower-trader__stat-value higher-lower-trader__stat-value--positive">{contractsWon}</div>
            </div>
            <div className="higher-lower-trader__stat-item">
              <div className="higher-lower-trader__stat-label">Total profit/loss</div>
              <div className={`higher-lower-trader__stat-value ${totalProfitLoss >= 0 ? 'higher-lower-trader__stat-value--positive' : 'higher-lower-trader__stat-value--negative'}`}>
                {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
              </div>
            </div>
          </div>

          <button
            onClick={resetStats}
            className="higher-lower-trader__reset-btn"
          >
            Reset
          </button>
        </div>

        {/* Current Price Display */}
        <div className="higher-lower-trader__price-display">
          <div className="higher-lower-trader__price-section">
            <div className="higher-lower-trader__price-label">Current Price</div>
            <div className="higher-lower-trader__current-price">{currentPrice.toFixed(5)}</div>
            {currentContract && (
              <div className="higher-lower-trader__barrier-price">
                Barrier: {(currentContract.entryPrice + currentContract.barrier).toFixed(5)}
              </div>
            )}
          </div>
        </div>

        {/* Trading Controls */}
        {isTrading && (
          <div className="higher-lower-trader__controls">
            <div className="higher-lower-trader__control-buttons">
              <button
                onClick={stopTrading}
                className="higher-lower-trader__control-btn higher-lower-trader__control-btn--stop"
              >
                <Square className="higher-lower-trader__btn-icon" />
                <span>Stop Bot</span>
              </button>
              {currentContract && (
                <button
                  onClick={sellContract}
                  className="higher-lower-trader__control-btn higher-lower-trader__control-btn--sell"
                >
                  Sell Early
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HigherLowerTrader;
