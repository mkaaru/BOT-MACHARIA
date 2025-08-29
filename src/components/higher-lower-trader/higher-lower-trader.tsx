
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
    <div className="w-full max-w-md mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4">
        <h2 className="text-lg font-semibold">Higher/Lower Trading</h2>
      </div>

      {/* Active Contract View */}
      {isTrading && currentContract && (
        <div className="p-4 border-b bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={stopTrading}
              className="px-3 py-1 bg-red-500 text-white rounded text-sm font-medium"
            >
              Stop
            </button>
            <span className="text-sm text-gray-600">Contract bought</span>
          </div>

          <div className="flex items-center space-x-2 mb-3">
            <div className="w-8 h-8 bg-purple-100 rounded flex items-center justify-center">
              {contractType === 'CALL' ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-600" />
              )}
            </div>
            <span className="font-medium">Volatility 10 (1s) Index</span>
            <span className="text-sm bg-purple-100 px-2 py-1 rounded">
              {contractType === 'CALL' ? 'Higher' : 'Lower'}
            </span>
          </div>

          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-1">{formatTime(timeRemaining)}</div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-1000"
                style={{ width: `${contractProgress}%` }}
              ></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-3">
            <div>
              <div className="text-gray-500">Total profit/loss:</div>
              <div className={`font-semibold ${totalProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
              </div>
            </div>
            <div>
              <div className="text-gray-500">Contract value:</div>
              <div className="font-semibold">{currentPrice.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500">Stake:</div>
              <div className="font-semibold">{stake.toFixed(2)} USD</div>
            </div>
            <div>
              <div className="text-gray-500">Potential payout:</div>
              <div className="font-semibold text-green-600">{(stake * 1.8).toFixed(2)} USD</div>
            </div>
          </div>

          <button
            onClick={sellContract}
            className="w-full py-2 bg-gray-600 text-white rounded font-medium hover:bg-gray-700 transition-colors"
          >
            Sell
          </button>
        </div>
      )}

      {/* Setup Form */}
      {!isTrading && (
        <div className="p-4">
          <div className="space-y-4">
            {/* Contract Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contract Type
              </label>
              <div className="flex space-x-2">
                <button
                  onClick={() => setContractType('CALL')}
                  className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                    contractType === 'CALL' 
                      ? 'bg-green-500 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <TrendingUp className="w-4 h-4 inline mr-1" />
                  Higher
                </button>
                <button
                  onClick={() => setContractType('PUT')}
                  className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                    contractType === 'PUT' 
                      ? 'bg-red-500 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <TrendingDown className="w-4 h-4 inline mr-1" />
                  Lower
                </button>
              </div>
            </div>

            {/* Stake */}
            <div>
              <label htmlFor="stake" className="block text-sm font-medium text-gray-700 mb-2">
                <DollarSign className="w-4 h-4 inline mr-1" />
                Stake (USD)
              </label>
              <input
                id="stake"
                type="number"
                step="0.01"
                min="0.35"
                value={stake}
                onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Clock className="w-4 h-4 inline mr-1" />
                Duration
              </label>
              <div className="flex space-x-2">
                <div className="flex-1">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="Minutes"
                  />
                  <div className="text-xs text-gray-500 mt-1">Minutes</div>
                </div>
                <div className="flex-1">
                  <input
                    type="number"
                    min="15"
                    max="3600"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 15)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="Seconds"
                  />
                  <div className="text-xs text-gray-500 mt-1">Seconds</div>
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Total: {formatTime(getTotalDuration())}
              </div>
            </div>

            {/* Barrier */}
            <div>
              <label htmlFor="barrier" className="block text-sm font-medium text-gray-700 mb-2">
                Barrier
              </label>
              <input
                id="barrier"
                type="text"
                value={barrier}
                onChange={(e) => setBarrier(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="+0.37"
              />
              <div className="text-xs text-gray-500 mt-1">
                Use + or - followed by the offset (e.g., +0.37, -0.25)
              </div>
            </div>

            {/* Stop on Profit */}
            <div className="border border-gray-200 rounded p-3">
              <div className="flex items-center space-x-2 mb-2">
                <input
                  id="stopOnProfit"
                  type="checkbox"
                  checked={stopOnProfit}
                  onChange={(e) => setStopOnProfit(e.target.checked)}
                  className="w-4 h-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                />
                <label htmlFor="stopOnProfit" className="text-sm font-medium text-gray-700">
                  Stop when in profit
                </label>
              </div>
              {stopOnProfit && (
                <div>
                  <label htmlFor="targetProfit" className="block text-xs font-medium text-gray-600 mb-1">
                    Target Profit (USD)
                  </label>
                  <input
                    id="targetProfit"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={targetProfit}
                    onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>

            {/* Start/Stop Button */}
            <button
              onClick={startTrading}
              disabled={getTotalDuration() < 15}
              className="w-full py-3 bg-purple-600 text-white rounded font-medium hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
            >
              <Play className="w-4 h-4" />
              <span>Start Trading</span>
            </button>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="p-4 bg-gray-50 border-t">
        <div className="grid grid-cols-3 gap-3 text-center text-sm mb-4">
          <div>
            <div className="text-gray-500">Total stake</div>
            <div className="font-semibold">{totalStake.toFixed(2)} USD</div>
          </div>
          <div>
            <div className="text-gray-500">Total payout</div>
            <div className="font-semibold">{totalPayout.toFixed(2)} USD</div>
          </div>
          <div>
            <div className="text-gray-500">No. of runs</div>
            <div className="font-semibold">{totalRuns}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center text-sm mb-4">
          <div>
            <div className="text-gray-500">Contracts lost</div>
            <div className="font-semibold text-red-600">{contractsLost}</div>
          </div>
          <div>
            <div className="text-gray-500">Contracts won</div>
            <div className="font-semibold text-green-600">{contractsWon}</div>
          </div>
          <div>
            <div className="text-gray-500">Total profit/loss</div>
            <div className={`font-semibold ${totalProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} USD
            </div>
          </div>
        </div>

        <button
          onClick={resetStats}
          className="w-full py-2 bg-gray-400 text-white rounded text-sm font-medium hover:bg-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Current Price Display */}
      <div className="p-4 border-t bg-white">
        <div className="text-center">
          <div className="text-xs text-gray-500 mb-1">Current Price</div>
          <div className="text-2xl font-bold text-gray-800">{currentPrice.toFixed(5)}</div>
          {currentContract && (
            <div className="text-xs text-gray-600 mt-1">
              Barrier: {(currentContract.entryPrice + currentContract.barrier).toFixed(5)}
            </div>
          )}
        </div>
      </div>

      {/* Trading Controls */}
      {isTrading && (
        <div className="p-4 border-t">
          <div className="flex space-x-2">
            <button
              onClick={stopTrading}
              className="flex-1 py-2 bg-red-500 text-white rounded font-medium hover:bg-red-600 transition-colors flex items-center justify-center space-x-1"
            >
              <Square className="w-4 h-4" />
              <span>Stop Bot</span>
            </button>
            {currentContract && (
              <button
                onClick={sellContract}
                className="flex-1 py-2 bg-orange-500 text-white rounded font-medium hover:bg-orange-600 transition-colors"
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
