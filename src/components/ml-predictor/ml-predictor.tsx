
import React, { useState, useEffect, useCallback } from 'react';
import './ml-predictor.scss';

interface TickData {
  time: number;
  price: number;
  digit: number;
}

interface MarkovChain {
  transitions: number[][];
  counts: number[][];
}

interface FrequencyAnalysis {
  digitCounts: number[];
  transitionCounts: number[][];
  evenOddCounts: { even: number; odd: number };
}

interface PredictionResult {
  evenProbability: number;
  oddProbability: number;
  confidence: number;
  method: string;
  prediction: 'even' | 'odd';
}

const MLPredictor: React.FC = () => {
  const [tickHistory, setTickHistory] = useState<TickData[]>([]);
  const [markovChain, setMarkovChain] = useState<MarkovChain>({
    transitions: Array(10).fill(0).map(() => Array(10).fill(0)),
    counts: Array(10).fill(0).map(() => Array(10).fill(0))
  });
  const [frequencyAnalysis, setFrequencyAnalysis] = useState<FrequencyAnalysis>({
    digitCounts: Array(10).fill(0),
    transitionCounts: Array(10).fill(0).map(() => Array(10).fill(0)),
    evenOddCounts: { even: 0, odd: 0 }
  });
  const [lstmPrediction, setLstmPrediction] = useState<number>(0.5);
  const [finalPrediction, setFinalPrediction] = useState<PredictionResult | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [modelAccuracy, setModelAccuracy] = useState(0);

  // Extract last digit from price
  const getLastDigit = (price: number): number => {
    return Math.floor(Math.abs(price * 10000)) % 10;
  };

  // Build Markov Chain from tick history
  const buildMarkovChain = useCallback((history: TickData[]) => {
    const transitions = Array(10).fill(0).map(() => Array(10).fill(0));
    const counts = Array(10).fill(0).map(() => Array(10).fill(0));

    for (let i = 1; i < history.length; i++) {
      const prevDigit = history[i - 1].digit;
      const currentDigit = history[i].digit;
      
      counts[prevDigit][currentDigit]++;
    }

    // Calculate transition probabilities
    for (let i = 0; i < 10; i++) {
      const total = counts[i].reduce((sum, count) => sum + count, 0);
      if (total > 0) {
        for (let j = 0; j < 10; j++) {
          transitions[i][j] = counts[i][j] / total;
        }
      }
    }

    return { transitions, counts };
  }, []);

  // Frequency Analysis
  const analyzeFrequency = useCallback((history: TickData[]) => {
    const digitCounts = Array(10).fill(0);
    const transitionCounts = Array(10).fill(0).map(() => Array(10).fill(0));
    const evenOddCounts = { even: 0, odd: 0 };

    // Count digit frequencies
    history.forEach(tick => {
      digitCounts[tick.digit]++;
      if (tick.digit % 2 === 0) {
        evenOddCounts.even++;
      } else {
        evenOddCounts.odd++;
      }
    });

    // Count transitions
    for (let i = 1; i < history.length; i++) {
      const prevDigit = history[i - 1].digit;
      const currentDigit = history[i].digit;
      transitionCounts[prevDigit][currentDigit]++;
    }

    return { digitCounts, transitionCounts, evenOddCounts };
  }, []);

  // Simple LSTM-like prediction using weighted moving averages
  const predictLSTM = useCallback((history: TickData[], sequenceLength: number = 10) => {
    if (history.length < sequenceLength) return 0.5;

    const recentDigits = history.slice(-sequenceLength).map(tick => tick.digit);
    const weights = Array.from({ length: sequenceLength }, (_, i) => (i + 1) / sequenceLength);
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    recentDigits.forEach((digit, index) => {
      const weight = weights[index];
      weightedSum += (digit % 2) * weight; // 0 for even, 1 for odd
      totalWeight += weight;
    });

    const evenProbability = 1 - (weightedSum / totalWeight);
    return Math.max(0.1, Math.min(0.9, evenProbability));
  }, []);

  // Ensemble prediction combining all methods
  const generateEnsemblePrediction = useCallback(() => {
    if (tickHistory.length < 20) return null;

    const lastDigit = tickHistory[tickHistory.length - 1].digit;
    
    // Markov Chain prediction
    const markovEvenProb = markovChain.transitions[lastDigit]
      ? [0, 2, 4, 6, 8].reduce((sum, digit) => sum + markovChain.transitions[lastDigit][digit], 0)
      : 0.5;

    // Frequency Analysis prediction
    const totalTicks = frequencyAnalysis.evenOddCounts.even + frequencyAnalysis.evenOddCounts.odd;
    const freqEvenProb = totalTicks > 0 ? frequencyAnalysis.evenOddCounts.even / totalTicks : 0.5;

    // LSTM prediction
    const lstmEvenProb = lstmPrediction;

    // Weighted ensemble (you can adjust weights based on performance)
    const markovWeight = 0.4;
    const freqWeight = 0.3;
    const lstmWeight = 0.3;

    const ensembleEvenProb = (
      markovEvenProb * markovWeight +
      freqEvenProb * freqWeight +
      lstmEvenProb * lstmWeight
    );

    const ensembleOddProb = 1 - ensembleEvenProb;

    // Calculate confidence based on consistency of predictions
    const predictions = [markovEvenProb, freqEvenProb, lstmEvenProb];
    const variance = predictions.reduce((sum, pred) => sum + Math.pow(pred - ensembleEvenProb, 2), 0) / predictions.length;
    const confidence = Math.max(0.1, 1 - variance);

    return {
      evenProbability: ensembleEvenProb,
      oddProbability: ensembleOddProb,
      confidence,
      method: 'Ensemble ML',
      prediction: ensembleEvenProb > 0.5 ? 'even' : 'odd'
    } as PredictionResult;
  }, [tickHistory, markovChain, frequencyAnalysis, lstmPrediction]);

  // Simulate tick data (replace with real WebSocket data)
  const simulateTick = useCallback(() => {
    const price = Math.random() * 1000 + 100;
    const digit = getLastDigit(price);
    const newTick: TickData = {
      time: Date.now(),
      price,
      digit
    };

    setTickHistory(prev => {
      const updated = [...prev, newTick].slice(-200); // Keep last 200 ticks
      return updated;
    });
  }, []);

  // Update models when tick history changes
  useEffect(() => {
    if (tickHistory.length >= 10) {
      setIsTraining(true);
      
      // Update Markov Chain
      const newMarkovChain = buildMarkovChain(tickHistory);
      setMarkovChain(newMarkovChain);

      // Update Frequency Analysis
      const newFreqAnalysis = analyzeFrequency(tickHistory);
      setFrequencyAnalysis(newFreqAnalysis);

      // Update LSTM prediction
      const newLstmPred = predictLSTM(tickHistory);
      setLstmPrediction(newLstmPred);

      // Generate ensemble prediction
      setTimeout(() => {
        const prediction = generateEnsemblePrediction();
        setFinalPrediction(prediction);
        setIsTraining(false);
      }, 100);
    }
  }, [tickHistory, buildMarkovChain, analyzeFrequency, predictLSTM, generateEnsemblePrediction]);

  // Calculate model accuracy
  useEffect(() => {
    if (tickHistory.length >= 50) {
      let correct = 0;
      let total = 0;

      for (let i = 30; i < tickHistory.length - 1; i++) {
        const historySlice = tickHistory.slice(0, i);
        const actualNext = tickHistory[i + 1].digit;
        const actualEvenOdd = actualNext % 2 === 0 ? 'even' : 'odd';
        
        // Simulate prediction for this historical point
        const tempMarkov = buildMarkovChain(historySlice);
        const tempFreq = analyzeFrequency(historySlice);
        const tempLstm = predictLSTM(historySlice);
        
        const lastDigit = historySlice[historySlice.length - 1].digit;
        const markovEvenProb = tempMarkov.transitions[lastDigit]
          ? [0, 2, 4, 6, 8].reduce((sum, digit) => sum + tempMarkov.transitions[lastDigit][digit], 0)
          : 0.5;
        
        const totalTicks = tempFreq.evenOddCounts.even + tempFreq.evenOddCounts.odd;
        const freqEvenProb = totalTicks > 0 ? tempFreq.evenOddCounts.even / totalTicks : 0.5;
        
        const ensembleEvenProb = (markovEvenProb * 0.4 + freqEvenProb * 0.3 + tempLstm * 0.3);
        const predictedEvenOdd = ensembleEvenProb > 0.5 ? 'even' : 'odd';
        
        if (predictedEvenOdd === actualEvenOdd) {
          correct++;
        }
        total++;
      }

      setModelAccuracy(total > 0 ? correct / total : 0);
    }
  }, [tickHistory, buildMarkovChain, analyzeFrequency, predictLSTM]);

  // Start simulation
  useEffect(() => {
    const interval = setInterval(simulateTick, 2000);
    return () => clearInterval(interval);
  }, [simulateTick]);

  return (
    <div className="ml-predictor">
      <div className="ml-predictor__header">
        <h2>ML-Based Even/Odd Predictor</h2>
        <div className="ml-predictor__status">
          <span className={`status ${isTraining ? 'training' : 'ready'}`}>
            {isTraining ? '🧠 Training...' : '✅ Ready'}
          </span>
          <span className="accuracy">
            Accuracy: {(modelAccuracy * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="ml-predictor__content">
        {/* Current Prediction */}
        <div className="prediction-card">
          <h3>Current Prediction</h3>
          {finalPrediction ? (
            <div className="prediction-result">
              <div className={`prediction-badge ${finalPrediction.prediction}`}>
                {finalPrediction.prediction.toUpperCase()}
              </div>
              <div className="probabilities">
                <div className="prob-item">
                  <label>Even:</label>
                  <span>{(finalPrediction.evenProbability * 100).toFixed(1)}%</span>
                </div>
                <div className="prob-item">
                  <label>Odd:</label>
                  <span>{(finalPrediction.oddProbability * 100).toFixed(1)}%</span>
                </div>
              </div>
              <div className="confidence">
                <label>Confidence:</label>
                <span>{(finalPrediction.confidence * 100).toFixed(1)}%</span>
              </div>
            </div>
          ) : (
            <div className="no-prediction">
              Collecting data... (need at least 20 ticks)
            </div>
          )}
        </div>

        {/* Model Performance */}
        <div className="model-stats">
          <h3>Model Performance</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <label>Markov Chain</label>
              <span>Active with {tickHistory.length} samples</span>
            </div>
            <div className="stat-item">
              <label>Frequency Analysis</label>
              <span>
                Even: {frequencyAnalysis.evenOddCounts.even} | 
                Odd: {frequencyAnalysis.evenOddCounts.odd}
              </span>
            </div>
            <div className="stat-item">
              <label>LSTM Prediction</label>
              <span>Even: {(lstmPrediction * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* Markov Chain Visualization */}
        <div className="markov-chain">
          <h3>Markov Chain Transitions</h3>
          <div className="transition-matrix">
            {markovChain.transitions.map((row, i) => (
              <div key={i} className="matrix-row">
                <span className="row-label">{i}:</span>
                {row.map((prob, j) => (
                  <span 
                    key={j} 
                    className={`matrix-cell ${j % 2 === 0 ? 'even' : 'odd'}`}
                    style={{ opacity: prob }}
                  >
                    {(prob * 100).toFixed(0)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Recent Ticks */}
        <div className="recent-ticks">
          <h3>Recent Tick History</h3>
          <div className="tick-sequence">
            {tickHistory.slice(-20).map((tick, index) => (
              <span 
                key={index} 
                className={`tick-digit ${tick.digit % 2 === 0 ? 'even' : 'odd'}`}
              >
                {tick.digit}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MLPredictor;
