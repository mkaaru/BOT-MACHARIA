
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import * as tf from '@tensorflow/tfjs';
import './ml-trader.scss';

// Volatility indices for Rise/Fall trading
const VOLATILITY_INDICES = [
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
    { value: '1HZ150V', label: 'Volatility 150 (1s) Index' },
    { value: '1HZ200V', label: 'Volatility 200 (1s) Index' },
    { value: '1HZ250V', label: 'Volatility 250 (1s) Index' },
    { value: '1HZ300V', label: 'Volatility 300 (1s) Index' },
];

interface TickData {
    time: number;
    quote: number;
}

interface AnalysisData {
    recommendation?: string;
    confidence?: number;
    riseRatio?: number;
    fallRatio?: number;
    totalTicks?: number;
}

interface MLAnalysisResult {
    direction: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    recommendation: 'Rise' | 'Fall' | 'Wait';
    trendStrength: number;
    cyclePhase: number;
    decyclerValue: number;
    imaValue: number;
    priceMomentum: number;
}

const MLTrader = observer(() => {
    // WebSocket and connection state
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const derivWsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<TickData[]>([]);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);

    // Trading parameters
    const [selectedSymbol, setSelectedSymbol] = useState('R_100');
    const [tickCount, setTickCount] = useState(4500);
    const [baseStake, setBaseStake] = useState(0.5);
    const [tickDuration, setTickDuration] = useState(1);
    const [martingaleSteps, setMartingaleSteps] = useState(1);

    // Trading condition
    const [conditionType, setConditionType] = useState('Rise Prob');
    const [conditionOperator, setConditionOperator] = useState('>');
    const [conditionValue, setConditionValue] = useState(55);

    // Trading state
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [analysisData, setAnalysisData] = useState<AnalysisData>({});
    const [lossStreak, setLossStreak] = useState(0);
    const [currentStake, setCurrentStake] = useState(0.5);
    const [lastOutcome, setLastOutcome] = useState<'win' | 'loss' | null>(null);

    // Trading API
    const [tradingApi, setTradingApi] = useState<any>(null);
    const [isAuthorized, setIsAuthorized] = useState(false);

    // Statistics
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);

    // Status messages
    const [status, setStatus] = useState('');

    // Auto trading interval
    const [tradingInterval, setTradingInterval] = useState<NodeJS.Timeout | null>(null);
    const lastTradeTimeRef = useRef(0);
    const minTimeBetweenTrades = 3000;

    // ML State
    const [mlModel, setMlModel] = useState<tf.LayersModel | null>(null);
    const [isTraining, setIsTraining] = useState(false);
    const [mlAnalysis, setMlAnalysis] = useState<MLAnalysisResult | null>(null);
    const [trainingProgress, setTrainingProgress] = useState(0);
    const [modelAccuracy, setModelAccuracy] = useState(0);
    const [normalizationParams, setNormalizationParams] = useState<{mean: tf.Tensor, variance: tf.Tensor} | null>(null);

    const totalProfitLoss = totalPayout - totalStake;

    // Initialize TensorFlow.js and create ML model
    useEffect(() => {
        const initializeMLModel = async () => {
            try {
                console.log('Initializing TensorFlow.js and ML model...');
                
                // Create a neural network for time series prediction
                const model = tf.sequential();
                
                model.add(tf.layers.dense({
                    units: 64,
                    activation: 'relu',
                    inputShape: [26] // 20 price points + 6 technical indicators
                }));
                
                model.add(tf.layers.dropout({ rate: 0.2 }));
                
                model.add(tf.layers.dense({
                    units: 32,
                    activation: 'relu'
                }));
                
                model.add(tf.layers.dropout({ rate: 0.2 }));
                
                model.add(tf.layers.dense({
                    units: 16,
                    activation: 'relu'
                }));
                
                model.add(tf.layers.dense({
                    units: 3, // Output: [bullish_prob, bearish_prob, neutral_prob]
                    activation: 'softmax'
                }));
                
                model.compile({
                    optimizer: tf.train.adam(0.001),
                    loss: 'categoricalCrossentropy',
                    metrics: ['accuracy']
                });
                
                setMlModel(model);
                console.log('ML model initialized successfully');
                
            } catch (error) {
                console.error('Error initializing ML model:', error);
            }
        };

        initializeMLModel();
    }, []);

    // Initialize trading API
    useEffect(() => {
        const initTradingApi = async () => {
            try {
                const api = generateDerivApiInstance();
                setTradingApi(api);

                const token = V2GetActiveToken();
                if (token) {
                    try {
                        const { authorize, error } = await api.authorize(token);
                        if (!error && authorize) {
                            setIsAuthorized(true);
                            console.log('✅ Trading API authorized successfully');
                        }
                    } catch (authError) {
                        console.log('Trading API not authorized yet, will authorize on first trade');
                    }
                }
            } catch (error) {
                console.error('Failed to initialize trading API:', error);
            }
        };

        initTradingApi();
    }, []);

    // John Ehlers Decycler Oscillator
    const calculateDecycler = useCallback((prices: number[]): number[] => {
        const decycled: number[] = [];
        const alpha = 2 / (30 + 1); // 30-period smoothing
        
        for (let i = 0; i < prices.length; i++) {
            if (i < 2) {
                decycled.push(0);
            } else {
                // Ehlers Decycler formula
                const decycle = (1 - alpha/2) * (1 - alpha/2) * (prices[i] - 2 * prices[i-1] + prices[i-2]) 
                              + 2 * (1 - alpha) * (decycled[i-1] || 0) 
                              - (1 - alpha) * (1 - alpha) * (decycled[i-2] || 0);
                decycled.push(decycle);
            }
        }
        
        return decycled;
    }, []);

    // John Ehlers Instantaneous Moving Average
    const calculateIMA = useCallback((prices: number[]): number[] => {
        const ima: number[] = [];
        const period = 10;
        
        for (let i = 0; i < prices.length; i++) {
            if (i < period) {
                ima.push(prices[i]);
            } else {
                let sum = 0;
                for (let j = 0; j < period; j++) {
                    sum += prices[i - j];
                }
                ima.push(sum / period);
            }
        }
        
        return ima;
    }, []);

    // Calculate RSI
    const calculateRSI = useCallback((prices: number[], period: number = 14): number[] => {
        const rsi: number[] = Array(prices.length).fill(50);
        
        for (let i = period; i < prices.length; i++) {
            let gains = 0;
            let losses = 0;
            
            for (let j = 1; j <= period; j++) {
                const change = prices[i - j + 1] - prices[i - j];
                if (change > 0) {
                    gains += change;
                } else {
                    losses -= change;
                }
            }
            
            const avgGain = gains / period;
            const avgLoss = losses / period;
            
            if (avgLoss === 0) {
                rsi[i] = 100;
            } else {
                const rs = avgGain / avgLoss;
                rsi[i] = 100 - (100 / (1 + rs));
            }
        }
        
        return rsi;
    }, []);

    // Helper function for EMA calculation
    const calculateEMA = useCallback((prices: number[], period: number): number[] => {
        const ema: number[] = [];
        const multiplier = 2 / (period + 1);
        
        for (let i = 0; i < prices.length; i++) {
            if (i === 0) {
                ema.push(prices[i]);
            } else {
                ema.push((prices[i] - ema[i-1]) * multiplier + ema[i-1]);
            }
        }
        
        return ema;
    }, []);

    // Calculate MACD
    const calculateMACD = useCallback((prices: number[]): { macd: number[], signal: number[] } => {
        const ema12 = calculateEMA(prices, 12);
        const ema26 = calculateEMA(prices, 26);
        const macd: number[] = [];
        
        for (let i = 0; i < prices.length; i++) {
            macd.push(ema12[i] - ema26[i]);
        }
        
        const signalLine = calculateEMA(macd, 9);
        
        return { macd, signal: signalLine };
    }, [calculateEMA]);

    // Prepare training data for ML model
    const prepareTrainingData = useCallback((prices: number[]) => {
        const features: number[][] = [];
        const labels: number[][] = [];
        
        const decycler = calculateDecycler(prices);
        const ima = calculateIMA(prices);
        const rsi = calculateRSI(prices);
        const { macd, signal } = calculateMACD(prices);
        
        // Use a lookback window of 20 periods
        const lookback = 20;
        
        for (let i = lookback; i < prices.length - 1; i++) {
            const featureVector: number[] = [];
            
            // Add normalized price data
            for (let j = 0; j < lookback; j++) {
                featureVector.push(prices[i - j] / prices[i] - 1); // Normalize relative to current price
            }
            
            // Add technical indicators
            featureVector.push(decycler[i] / prices[i]);
            featureVector.push(ima[i] / prices[i] - 1);
            featureVector.push(rsi[i] / 100);
            featureVector.push(macd[i] / prices[i]);
            featureVector.push(signal[i] / prices[i]);
            featureVector.push((macd[i] - signal[i]) / prices[i]); // MACD histogram
            
            features.push(featureVector);
            
            // Create label (next price movement)
            const priceChange = (prices[i + 1] - prices[i]) / prices[i];
            if (priceChange > 0.0001) {
                labels.push([1, 0, 0]); // Bullish
            } else if (priceChange < -0.0001) {
                labels.push([0, 1, 0]); // Bearish
            } else {
                labels.push([0, 0, 1]); // Neutral
            }
        }
        
        return { features, labels };
    }, [calculateDecycler, calculateIMA, calculateRSI, calculateMACD]);

    // Train ML model
    const trainModel = useCallback(async (prices: number[]) => {
        if (!mlModel || prices.length < 200) return;
        
        setIsTraining(true);
        setTrainingProgress(0);
        
        try {
            const { features, labels } = prepareTrainingData(prices);
            
            if (features.length === 0) {
                console.warn('No training data available');
                return;
            }
            
            // Convert to tensors
            const featureTensor = tf.tensor2d(features);
            const labelTensor = tf.tensor2d(labels);
            
            // Normalize features
            const { mean, variance } = tf.moments(featureTensor, 0);
            const normalizedFeatures = featureTensor.sub(mean).div(variance.sqrt().add(1e-8));
            
            // Store normalization parameters
            setNormalizationParams({ mean, variance });
            
            // Train the model
            const history = await mlModel.fit(normalizedFeatures, labelTensor, {
                epochs: 30,
                batchSize: 32,
                validationSplit: 0.2,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        setTrainingProgress((epoch + 1) / 30 * 100);
                        if (logs) {
                            console.log(`Epoch ${epoch + 1}: loss = ${logs.loss?.toFixed(4)}, accuracy = ${logs.acc?.toFixed(4)}`);
                        }
                    }
                }
            });
            
            const finalAccuracy = history.history.acc ? history.history.acc[history.history.acc.length - 1] : 0;
            setModelAccuracy(finalAccuracy * 100);
            console.log('Model training completed');
            
            // Clean up tensors
            featureTensor.dispose();
            labelTensor.dispose();
            normalizedFeatures.dispose();
            
        } catch (error) {
            console.error('Error training model:', error);
            setStatus(`Training error: ${error.message}`);
        } finally {
            setIsTraining(false);
        }
    }, [mlModel, prepareTrainingData]);

    // Make prediction using ML model
    const predictWithML = useCallback(async (prices: number[]) => {
        if (!mlModel || !normalizationParams || prices.length < 50) return null;
        
        try {
            const decycler = calculateDecycler(prices);
            const ima = calculateIMA(prices);
            const rsi = calculateRSI(prices);
            const { macd, signal } = calculateMACD(prices);
            
            // Prepare current feature vector
            const currentIndex = prices.length - 1;
            const lookback = 20;
            const featureVector: number[] = [];
            
            // Add normalized price data
            for (let j = 0; j < lookback; j++) {
                featureVector.push(prices[currentIndex - j] / prices[currentIndex] - 1);
            }
            
            // Add technical indicators
            featureVector.push(decycler[currentIndex] / prices[currentIndex]);
            featureVector.push(ima[currentIndex] / prices[currentIndex] - 1);
            featureVector.push(rsi[currentIndex] / 100);
            featureVector.push(macd[currentIndex] / prices[currentIndex]);
            featureVector.push(signal[currentIndex] / prices[currentIndex]);
            featureVector.push((macd[currentIndex] - signal[currentIndex]) / prices[currentIndex]);
            
            // Normalize features using stored parameters
            const featureTensor = tf.tensor2d([featureVector]);
            const normalizedFeatures = featureTensor.sub(normalizationParams.mean).div(normalizationParams.variance.sqrt().add(1e-8));
            
            const prediction = mlModel.predict(normalizedFeatures) as tf.Tensor;
            const predictionData = await prediction.data();
            const [bullishProb, bearishProb, neutralProb] = predictionData;
            
            // Calculate trend strength from Decycler and IMA
            const trendStrength = Math.abs(decycler[currentIndex]) / prices[currentIndex] * 100;
            const cyclePhase = Math.atan2(ima[currentIndex], decycler[currentIndex]) * 180 / Math.PI;
            
            // Determine recommendation
            let recommendation: 'Rise' | 'Fall' | 'Wait' = 'Wait';
            let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
            let confidence = Math.max(bullishProb, bearishProb, neutralProb);
            
            if (bullishProb > 0.5 && bullishProb > bearishProb) {
                recommendation = 'Rise';
                direction = 'bullish';
                confidence = bullishProb;
            } else if (bearishProb > 0.5 && bearishProb > bullishProb) {
                recommendation = 'Fall';
                direction = 'bearish';
                confidence = bearishProb;
            } else {
                confidence = neutralProb;
            }
            
            // Calculate price momentum
            const priceMomentum = prices.length >= 5 ? 
                (prices[currentIndex] - prices[currentIndex - 5]) / prices[currentIndex - 5] * 100 : 0;
            
            const mlResult: MLAnalysisResult = {
                direction,
                confidence: confidence * 100,
                recommendation,
                trendStrength,
                cyclePhase,
                decyclerValue: decycler[currentIndex],
                imaValue: ima[currentIndex],
                priceMomentum
            };
            
            // Clean up tensors
            featureTensor.dispose();
            normalizedFeatures.dispose();
            prediction.dispose();
            
            return mlResult;
            
        } catch (error) {
            console.error('Error making prediction:', error);
            return null;
        }
    }, [mlModel, normalizationParams, calculateDecycler, calculateIMA, calculateRSI, calculateMACD]);

    // WebSocket connection management
    useEffect(() => {
        const MAX_RECONNECT_ATTEMPTS = 5;

        function startWebSocket() {
            console.log('🔌 Connecting to WebSocket API');

            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }

            if (derivWsRef.current) {
                try {
                    derivWsRef.current.onclose = null;
                    derivWsRef.current.close();
                } catch (error) {
                    console.error('Error closing existing connection:', error);
                }
                derivWsRef.current = null;
            }

            try {
                derivWsRef.current = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

                derivWsRef.current.onopen = function() {
                    console.log('✅ WebSocket connection established');
                    reconnectAttemptsRef.current = 0;
                    setConnectionStatus('connected');

                    setTimeout(() => {
                        try {
                            if (derivWsRef.current && derivWsRef.current.readyState === WebSocket.OPEN) {
                                derivWsRef.current.send(JSON.stringify({ app_id: 75771 }));
                                requestTickHistory();
                            }
                        } catch (error) {
                            console.error('Error during init requests:', error);
                        }
                    }, 500);
                };

                derivWsRef.current.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.error) {
                            console.error('❌ WebSocket API error:', data.error);
                            if (data.error.code === 'DisconnectByUser' || data.error.code === 'InvalidToken') {
                                setConnectionStatus('error');
                            }
                            return;
                        }

                        if (connectionStatus !== 'connected') {
                            setConnectionStatus('connected');
                        }

                        if (data.history) {
                            console.log(`📊 Received history for ${selectedSymbol}: ${data.history.prices.length} ticks`);
                            tickHistoryRef.current = data.history.prices.map((price: string, index: number) => ({
                                time: data.history.times[index],
                                quote: parseFloat(price)
                            }));
                            updateAnalysis();
                        } else if (data.tick) {
                            const quote = parseFloat(data.tick.quote);
                            tickHistoryRef.current.push({
                                time: data.tick.epoch,
                                quote: quote
                            });

                            if (tickHistoryRef.current.length > Math.max(tickCount, 5000)) {
                                tickHistoryRef.current = tickHistoryRef.current.slice(-tickCount);
                            }

                            setCurrentPrice(quote);
                            updateAnalysis();
                        } else if (data.ping) {
                            derivWsRef.current?.send(JSON.stringify({ pong: 1 }));
                        }
                    } catch (error) {
                        console.error('Error processing message:', error);
                    }
                };

                derivWsRef.current.onerror = function(error) {
                    console.error('❌ WebSocket error:', error);
                    if (reconnectAttemptsRef.current >= 2) {
                        setConnectionStatus('error');
                    }
                    scheduleReconnect();
                };

                derivWsRef.current.onclose = function(event) {
                    console.log('🔄 WebSocket connection closed', event.code, event.reason);
                    setConnectionStatus('disconnected');
                    scheduleReconnect();
                };

            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                setConnectionStatus('error');
                scheduleReconnect();
            }
        }

        function scheduleReconnect() {
            reconnectAttemptsRef.current++;
            if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
                console.log(`⚠️ Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping attempts.`);
                setConnectionStatus('error');
                return;
            }

            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000);
            console.log(`🔄 Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);

            if (reconnectAttemptsRef.current <= 3) {
                setConnectionStatus('disconnected');
            }

            reconnectTimeoutRef.current = setTimeout(() => {
                console.log(`🔄 Attempting to reconnect (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
                startWebSocket();
            }, delay);
        }

        function requestTickHistory() {
            const request = {
                ticks_history: selectedSymbol,
                count: tickCount,
                end: 'latest',
                style: 'ticks',
                subscribe: 1
            };

            if (derivWsRef.current && derivWsRef.current.readyState === WebSocket.OPEN) {
                console.log(`📡 Requesting tick history for ${selectedSymbol} (${tickCount} ticks)`);
                try {
                    derivWsRef.current.send(JSON.stringify(request));
                } catch (error) {
                    console.error('Error sending tick history request:', error);
                    scheduleReconnect();
                }
            } else {
                console.error('❌ WebSocket not ready to request history');
                scheduleReconnect();
            }
        }

        startWebSocket();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (derivWsRef.current) {
                derivWsRef.current.onclose = null;
                derivWsRef.current.close();
            }
        };
    }, [selectedSymbol, tickCount]);

    // Enhanced updateAnalysis with ML
    const updateAnalysis = useCallback(async () => {
        if (tickHistoryRef.current.length === 0) return;

        try {
            const ticks = tickHistoryRef.current;
            const prices = ticks.map(t => t.quote);
            
            // Traditional analysis
            let riseCount = 0;
            let fallCount = 0;

            for (let i = 1; i < ticks.length; i++) {
                if (ticks[i].quote > ticks[i - 1].quote) {
                    riseCount++;
                } else if (ticks[i].quote < ticks[i - 1].quote) {
                    fallCount++;
                }
            }

            const totalMoves = riseCount + fallCount;
            const riseRatio = totalMoves > 0 ? (riseCount / totalMoves) * 100 : 50;
            const fallRatio = totalMoves > 0 ? (fallCount / totalMoves) * 100 : 50;

            let recommendation = '';
            let confidence = 0;

            if (riseRatio > 50) {
                recommendation = 'Rise';
                confidence = riseRatio;
            } else if (fallRatio > 50) {
                recommendation = 'Fall';
                confidence = fallRatio;
            }

            // ML Analysis
            let mlAnalysisResult: MLAnalysisResult | null = null;
            if (prices.length >= 100) {
                mlAnalysisResult = await predictWithML(prices);
            }

            setAnalysisData({
                recommendation: mlAnalysisResult?.recommendation || recommendation,
                confidence: mlAnalysisResult?.confidence || confidence,
                riseRatio,
                fallRatio,
                totalTicks: ticks.length
            });

            setMlAnalysis(mlAnalysisResult);

        } catch (error) {
            console.error('Error in analysis:', error);
        }
    }, [predictWithML]);

    // Check trading conditions with ML integration
    const checkTradingConditions = useCallback(() => {
        if (!analysisData || Object.keys(analysisData).length === 0) {
            return false;
        }

        // Use ML analysis if available, otherwise fall back to traditional analysis
        let currentValue = 0;
        let conditionTypeToCheck = conditionType;

        if (mlAnalysis && mlAnalysis.confidence > 60) {
            // Use ML recommendation if confidence is high
            if (mlAnalysis.recommendation === 'Rise') {
                conditionTypeToCheck = 'Rise Prob';
                currentValue = mlAnalysis.confidence;
            } else if (mlAnalysis.recommendation === 'Fall') {
                conditionTypeToCheck = 'Fall Prob';
                currentValue = mlAnalysis.confidence;
            }
        } else {
            // Use traditional analysis
            switch (conditionType) {
                case 'Rise Prob':
                    currentValue = analysisData.riseRatio || 0;
                    break;
                case 'Fall Prob':
                    currentValue = analysisData.fallRatio || 0;
                    break;
                default:
                    return false;
            }
        }

        const timestamp = new Date().toLocaleTimeString();

        if (isNaN(currentValue) || currentValue === 0) {
            console.log(`[${timestamp}] Invalid value for ${conditionTypeToCheck}:`, currentValue);
            return false;
        }

        const result = (() => {
            switch (conditionOperator) {
                case '>':
                    return currentValue > conditionValue;
                case '>=':
                    return currentValue >= conditionValue;
                case '<':
                    return currentValue < conditionValue;
                case '=':
                    return Math.abs(currentValue - conditionValue) < 0.1;
                default:
                    return false;
            }
        })();

        const logStyle = result ? '🟢' : '🔴';
        console.log(`[${timestamp}] ${logStyle} Condition check:`, {
            condition: conditionTypeToCheck,
            currentValue: currentValue.toFixed(2),
            operator: conditionOperator,
            threshold: conditionValue,
            result: result ? 'MET ✅' : 'NOT MET ❌',
            mlConfidence: mlAnalysis?.confidence.toFixed(2) || 'N/A'
        });

        return result;
    }, [analysisData, conditionType, conditionOperator, conditionValue, mlAnalysis]);

    // Authorization helper
    const authorizeIfNeeded = async () => {
        if (isAuthorized || !tradingApi) return;

        const token = V2GetActiveToken();
        if (!token) {
            throw new Error('No token found. Please log in and select an account.');
        }

        const { authorize, error } = await tradingApi.authorize(token);
        if (error) {
            throw new Error(`Authorization error: ${error.message || error.code}`);
        }

        setIsAuthorized(true);
        console.log('✅ Trading API authorized successfully');
    };

    // Auto trade execution
    const executeAutoTrade = async () => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🚀 Checking auto trade conditions`);

        if (!tradingApi) {
            console.error(`[${timestamp}] Trading API not ready`);
            return;
        }

        if (!tradingApi.connection || tradingApi.connection.readyState !== WebSocket.OPEN) {
            console.error(`[${timestamp}] Trading API connection not ready`);
            return;
        }

        if (connectionStatus !== 'connected') {
            console.error(`[${timestamp}] Not connected to market data API`);
            return;
        }

        const currentTime = Date.now();
        if (currentTime - lastTradeTimeRef.current < minTimeBetweenTrades) {
            console.log(`[${timestamp}] Too soon since last trade, skipping`);
            return;
        }

        const conditionsMet = checkTradingConditions();
        if (!conditionsMet) {
            console.log(`[${timestamp}] Trading conditions not met`);
            return;
        }

        try {
            await authorizeIfNeeded();

            // Determine contract type based on ML analysis or condition
            let contractType = '';
            if (mlAnalysis && mlAnalysis.confidence > 60) {
                contractType = mlAnalysis.recommendation === 'Rise' ? 'CALL' : 'PUT';
            } else if (conditionType === 'Rise Prob') {
                contractType = 'CALL';
            } else if (conditionType === 'Fall Prob') {
                contractType = 'PUT';
            } else {
                contractType = (analysisData.riseRatio || 0) > (analysisData.fallRatio || 0) ? 'CALL' : 'PUT';
            }

            const stakeToUse = lastOutcome === 'loss' && lossStreak > 0
                ? Math.min(currentStake * martingaleSteps, baseStake * 10)
                : baseStake;

            setCurrentStake(stakeToUse);

            const buyRequest = {
                buy: '1',
                price: stakeToUse,
                parameters: {
                    amount: stakeToUse,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: 'USD',
                    duration: tickDuration,
                    duration_unit: 't',
                    symbol: selectedSymbol
                }
            };

            console.log(`[${timestamp}] Sending buy request:`, JSON.stringify(buyRequest, null, 2));
            setStatus(`Auto trading: Buying ${contractType} contract for $${stakeToUse}...`);

            lastTradeTimeRef.current = currentTime;

            const buyResponse = await tradingApi.buy(buyRequest);
            console.log(`[${timestamp}] Buy response:`, JSON.stringify(buyResponse, null, 2));

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            if (!buyResponse.buy || !buyResponse.buy.contract_id) {
                throw new Error('Invalid buy response: missing contract_id');
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`✅ Auto trade executed: ${buyResponse.buy.contract_id}`);
            console.log(`[${timestamp}] ✅ Auto trade successful: ${buyResponse.buy.contract_id}`);

            monitorContract(buyResponse.buy.contract_id, stakeToUse);

        } catch (error) {
            console.error(`[${timestamp}] ❌ Auto trade error:`, error);
            setStatus(`Auto trade error: ${error.message}`);
            setLastOutcome('loss');
            setLossStreak(prev => prev + 1);
        }
    };

    // Execute manual trade
    const executeManualTrade = async (tradeType: 'Rise' | 'Fall') => {
        if (!tradingApi) {
            setStatus('Trading API not ready');
            return;
        }

        try {
            await authorizeIfNeeded();

            const contractType = tradeType === 'Rise' ? 'CALL' : 'PUT';
            const stakeToUse = baseStake;

            const buyRequest = {
                buy: '1',
                price: stakeToUse,
                parameters: {
                    amount: stakeToUse,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: 'USD',
                    duration: tickDuration,
                    duration_unit: 't',
                    symbol: selectedSymbol
                }
            };

            setStatus(`Buying ${tradeType} contract for $${stakeToUse}...`);

            const buyResponse = await tradingApi.buy(buyRequest);

            if (buyResponse.error) {
                throw new Error(buyResponse.error.message);
            }

            setTotalRuns(prev => prev + 1);
            setTotalStake(prev => prev + stakeToUse);

            setStatus(`Contract purchased: ${buyResponse.buy.contract_id}`);

            monitorContract(buyResponse.buy.contract_id, stakeToUse);

        } catch (error) {
            console.error('Manual trade error:', error);
            setStatus(`Trade error: ${error.message}`);
        }
    };

    // Monitor contract outcome
    const monitorContract = async (contractId: string, stakeAmount: number) => {
        try {
            if (!tradingApi?.connection) {
                throw new Error('Trading API connection not available');
            }

            const subscribeRequest = {
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            };

            await tradingApi.send(subscribeRequest);

            const handleContractUpdate = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.msg_type === 'proposal_open_contract' &&
                        data.proposal_open_contract &&
                        String(data.proposal_open_contract.contract_id) === String(contractId)) {

                        const contract = data.proposal_open_contract;

                        if (contract.is_sold || contract.status === 'sold') {
                            const profit = Number(contract.profit || 0);
                            const payout = Number(contract.payout || 0);

                            setTotalPayout(prev => prev + payout);

                            if (profit > 0) {
                                setContractsWon(prev => prev + 1);
                                setLastOutcome('win');
                                setLossStreak(0);
                                setCurrentStake(baseStake);
                                setStatus(`✅ Contract won! Profit: $${profit.toFixed(2)}`);
                            } else {
                                setContractsLost(prev => prev + 1);
                                setLastOutcome('loss');
                                setLossStreak(prev => prev + 1);
                                setStatus(`❌ Contract lost. Loss: $${Math.abs(profit).toFixed(2)}`);
                            }

                            tradingApi.connection.removeEventListener('message', handleContractUpdate);
                        }
                    }
                } catch (error) {
                    console.error('Error processing contract update:', error);
                }
            };

            tradingApi.connection.addEventListener('message', handleContractUpdate);

            setTimeout(() => {
                if (tradingApi.connection) {
                    tradingApi.connection.removeEventListener('message', handleContractUpdate);
                }
            }, 300000);

        } catch (error) {
            console.error('Error monitoring contract:', error);
            setStatus(`Monitoring error: ${error.message}`);
        }
    };

    // Auto trading management
    const startAutoTrading = () => {
        if (connectionStatus !== 'connected') {
            alert('Cannot start auto trading: Not connected to market data API');
            return;
        }

        if (!tradingApi) {
            alert('Trading API not initialized');
            return;
        }

        if (!tradingApi.connection || tradingApi.connection.readyState !== WebSocket.OPEN) {
            alert('Trading API connection not ready. Please wait...');
            return;
        }

        if (tradingInterval) {
            clearInterval(tradingInterval);
            setTradingInterval(null);
        }

        setIsAutoTrading(true);
        setStatus('Auto trading started - checking conditions...');

        let intervalMs = 2000;
        if (selectedSymbol.includes('1HZ')) {
            intervalMs = 1500;
        }

        console.log(`Starting auto trading with ${intervalMs}ms interval`);

        const interval = setInterval(executeAutoTrade, intervalMs);
        setTradingInterval(interval);

        console.log('✅ Auto trading started');
    };

    const stopAutoTrading = () => {
        if (tradingInterval) {
            clearInterval(tradingInterval);
            setTradingInterval(null);
        }

        setIsAutoTrading(false);
        setStatus('Auto trading stopped');
        console.log('Auto trading stopped');
    };

    const toggleAutoTrading = () => {
        if (isAutoTrading) {
            stopAutoTrading();
        } else {
            startAutoTrading();
        }
    };

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (tradingInterval) {
                clearInterval(tradingInterval);
            }
        };
    }, [tradingInterval]);

    const winRate = totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : '0.0';

    return (
        <div className='ml-trader'>
            <div className='ml-trader__header'>
                <h1>{localize('AI ML Trader - Enhanced with Ehlers Indicators')}</h1>
                <div className={`ml-trader__status ${connectionStatus}`}>
                    {connectionStatus === 'connected' && '🟢 Connected'}
                    {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                    {connectionStatus === 'error' && '🔴 Error'}
                </div>
            </div>

            <div className='ml-trader__controls'>
                <div className='ml-trader__control-group'>
                    <label>Symbol:</label>
                    <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
                        {VOLATILITY_INDICES.map((idx) => (
                            <option key={idx.value} value={idx.value}>
                                {idx.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className='ml-trader__control-group'>
                    <label>Tick Count:</label>
                    <input
                        type='number'
                        min={50}
                        max={5000}
                        value={tickCount}
                        onChange={(e) => setTickCount(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Current Price:</label>
                    <span className='ml-trader__price'>{currentPrice.toFixed(3)}</span>
                </div>
            </div>

            <div className='ml-trader__analysis'>
                <div className='ml-trader__analysis-section'>
                    <h3>Traditional Analysis</h3>
                    <div className='ml-trader__progress-item'>
                        <div className='ml-trader__progress-label'>
                            <span>Rise</span>
                            <span>{analysisData.riseRatio?.toFixed(1) || '0.0'}%</span>
                        </div>
                        <div className='ml-trader__progress-bar'>
                            <div
                                className='ml-trader__progress-fill ml-trader__progress-fill--rise'
                                style={{ width: `${analysisData.riseRatio || 0}%` }}
                            />
                        </div>
                    </div>
                    <div className='ml-trader__progress-item'>
                        <div className='ml-trader__progress-label'>
                            <span>Fall</span>
                            <span>{analysisData.fallRatio?.toFixed(1) || '0.0'}%</span>
                        </div>
                        <div className='ml-trader__progress-bar'>
                            <div
                                className='ml-trader__progress-fill ml-trader__progress-fill--fall'
                                style={{ width: `${analysisData.fallRatio || 0}%` }}
                            />
                        </div>
                    </div>
                </div>

                {analysisData.recommendation && (
                    <div className='ml-trader__recommendation'>
                        <strong>Traditional Recommendation:</strong> {analysisData.recommendation}
                        <span className='ml-trader__confidence'>({analysisData.confidence?.toFixed(1)}%)</span>
                    </div>
                )}
            </div>

            {/* ML Analysis Section */}
            <div className='ml-trader__ml-analysis'>
                <h4>🧠 Machine Learning Analysis</h4>
                {mlAnalysis && (
                    <div className='ml-trader__ml-results'>
                        <div className='ml-trader__ml-item'>
                            <Text size='xs'>Direction: <strong>{mlAnalysis.direction}</strong></Text>
                            <Text size='xs' weight='bold' className={`ml-trader__confidence--${mlAnalysis.direction}`}>
                                Confidence: {mlAnalysis.confidence.toFixed(1)}%
                            </Text>
                        </div>
                        <div className='ml-trader__ml-item'>
                            <Text size='xs'>ML Recommendation: <strong>{mlAnalysis.recommendation}</strong></Text>
                            <Text size='xs'>Trend Strength: {mlAnalysis.trendStrength.toFixed(2)}%</Text>
                        </div>
                        <div className='ml-trader__ml-item'>
                            <Text size='xs'>Cycle Phase: {mlAnalysis.cyclePhase.toFixed(1)}°</Text>
                            <Text size='xs'>Momentum: {mlAnalysis.priceMomentum.toFixed(2)}%</Text>
                        </div>
                        <div className='ml-trader__ml-item'>
                            <Text size='xs'>Decycler: {mlAnalysis.decyclerValue.toFixed(6)}</Text>
                            <Text size='xs'>IMA: {mlAnalysis.imaValue.toFixed(4)}</Text>
                        </div>
                    </div>
                )}
                {!mlAnalysis && tickHistoryRef.current.length > 0 && (
                    <div className='ml-trader__ml-waiting'>
                        <Text size='xs'>Preparing ML analysis... Need {Math.max(0, 100 - tickHistoryRef.current.length)} more ticks</Text>
                    </div>
                )}
                {isTraining && (
                    <div className='ml-trader__training-status'>
                        <Text size='xs'>🔄 Training ML Model: {trainingProgress.toFixed(0)}%</Text>
                        <div className='ml-trader__progress-bar'>
                            <div 
                                className='ml-trader__progress-fill ml-trader__progress-fill--training'
                                style={{ width: `${trainingProgress}%` }}
                            />
                        </div>
                    </div>
                )}
                {modelAccuracy > 0 && (
                    <div className='ml-trader__model-accuracy'>
                        <Text size='xs' weight='bold' className='ml-trader__accuracy'>
                            🎯 Model Accuracy: {modelAccuracy.toFixed(1)}%
                        </Text>
                    </div>
                )}
            </div>

            {/* ML Controls */}
            <div className='ml-trader__ml-controls'>
                <button
                    className='ml-trader__train-btn'
                    onClick={() => trainModel(tickHistoryRef.current.map(t => t.quote))}
                    disabled={isTraining || tickHistoryRef.current.length < 200}
                >
                    {isTraining ? 'Training Model...' : '🎓 Train ML Model'}
                </button>
                <Text size='xs' className='ml-trader__train-info'>
                    {tickHistoryRef.current.length < 200 
                        ? `Need ${200 - tickHistoryRef.current.length} more ticks to train`
                        : 'Ready to train with current data'
                    }
                </Text>
            </div>

            <div className='ml-trader__trading-condition'>
                <h4>Trading Condition</h4>
                <div className='ml-trader__condition-row'>
                    <span>If</span>
                    <select value={conditionType} onChange={(e) => setConditionType(e.target.value)}>
                        <option value='Rise Prob'>Rise Prob</option>
                        <option value='Fall Prob'>Fall Prob</option>
                    </select>
                    <select value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value)}>
                        <option value='>'>{'>'}</option>
                        <option value='>='>{'≥'}</option>
                    </select>
                    <input
                        type='number'
                        min={50}
                        max={95}
                        value={conditionValue}
                        onChange={(e) => setConditionValue(Number(e.target.value))}
                    />
                    <span>%</span>
                </div>
                <div className='ml-trader__condition-row'>
                    <span>Then</span>
                    <span>Buy {conditionType === 'Rise Prob' ? 'Rise' : 'Fall'}</span>
                </div>
                <div className='ml-trader__ml-note'>
                    <Text size='xs'>
                        💡 ML analysis will override conditions when confidence > 60%
                    </Text>
                </div>
            </div>

            <div className='ml-trader__trading-controls'>
                <div className='ml-trader__control-group'>
                    <label>Base Stake ($)</label>
                    <input
                        type='number'
                        step='0.1'
                        min={0.35}
                        value={baseStake}
                        onChange={(e) => setBaseStake(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Ticks</label>
                    <input
                        type='number'
                        min={1}
                        max={10}
                        value={tickDuration}
                        onChange={(e) => setTickDuration(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Martingale</label>
                    <input
                        type='number'
                        step='0.1'
                        min={1}
                        max={5}
                        value={martingaleSteps}
                        onChange={(e) => setMartingaleSteps(Number(e.target.value))}
                    />
                </div>
            </div>

            <div className='ml-trader__strategy-status'>
                <div className='ml-trader__status-item'>
                    <span>Loss Streak: {lossStreak}</span>
                </div>
                <div className='ml-trader__status-item'>
                    <span>Current Stake: ${currentStake.toFixed(2)}</span>
                </div>
                <div className='ml-trader__status-item'>
                    <span>Last Outcome: {lastOutcome ? (lastOutcome === 'win' ? '✅' : '❌') : '➖'}</span>
                </div>
            </div>

            <div className='ml-trader__buttons'>
                <button
                    className={`ml-trader__auto-trading-btn ${isAutoTrading ? 'ml-trader__auto-trading-btn--active' : ''}`}
                    onClick={toggleAutoTrading}
                    disabled={!isAuthorized || connectionStatus !== 'connected'}
                >
                    {isAutoTrading ? 'STOP AUTO TRADING' : 'START AUTO TRADING'}
                </button>

                <div className='ml-trader__manual-buttons'>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--rise'
                        onClick={() => executeManualTrade('Rise')}
                        disabled={!isAuthorized || connectionStatus !== 'connected' || isAutoTrading}
                    >
                        Execute Rise Trade
                    </button>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--fall'
                        onClick={() => executeManualTrade('Fall')}
                        disabled={!isAuthorized || connectionStatus !== 'connected' || isAutoTrading}
                    >
                        Execute Fall Trade
                    </button>
                </div>
            </div>

            <div className='ml-trader__statistics'>
                <h4>Trading Statistics</h4>
                <div className='ml-trader__stats-grid'>
                    <div className='ml-trader__stat-item'>
                        <span>Total Trades:</span>
                        <span className='ml-trader__stat-value'>{totalRuns}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>Won:</span>
                        <span className='ml-trader__stat-value ml-trader__stat-value--win'>{contractsWon}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>Lost:</span>
                        <span className='ml-trader__stat-value ml-trader__stat-value--loss'>{contractsLost}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>Win Rate:</span>
                        <span className='ml-trader__stat-value'>{winRate}%</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>Total Stake:</span>
                        <span className='ml-trader__stat-value'>${totalStake.toFixed(2)}</span>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <span>Total Payout:</span>
                        <span className='ml-trader__stat-value'>${totalPayout.toFixed(2)}</span>
                    </div>
                    <div className='ml-trader__stat-item ml-trader__stat-item--total'>
                        <span>Profit/Loss:</span>
                        <span className={`ml-trader__stat-value ${totalProfitLoss >= 0 ? 'ml-trader__stat-value--win' : 'ml-trader__stat-value--loss'}`}>
                            ${totalProfitLoss.toFixed(2)}
                        </span>
                    </div>
                </div>
            </div>

            {status && (
                <div className='ml-trader__status-message'>
                    <Text size='xs' color={status.includes('error') ? 'loss-danger' : 'prominent'}>
                        {status}
                    </Text>
                </div>
            )}
        </div>
    );
});

export default MLTrader;
