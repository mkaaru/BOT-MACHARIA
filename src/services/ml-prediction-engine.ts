
import { CandleData, TickData } from './tick-stream-manager';
import { candleReconstructionEngine } from './candle-reconstruction-engine';
import { efficientHMACalculator } from './efficient-hma-calculator';
import { ehlersProcessor } from './ehlers-signal-processing';

export interface MLFeatures {
    // Price features
    ohlcRatios: number[];
    priceVelocity: number;
    priceAcceleration: number;
    volatility: number;
    
    // Technical indicators
    hmaSlope: number;
    hmaAlignment: number;
    rsi: number;
    macd: number;
    
    // Pattern features
    candleBodyRatio: number;
    wickRatios: number[];
    consecutivePattern: number[];
    
    // Volume/tick features
    tickCount: number;
    tickDensity: number;
    priceSpread: number;
    
    // Time features
    timeOfDay: number;
    dayOfWeek: number;
    
    // Market microstructure
    bidAskSpread: number;
    orderFlow: number;
    momentum: number[];
}

export interface CandlePrediction {
    symbol: string;
    nextCandleDirection: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    predictedMove: number;
    timeframe: string;
    features: MLFeatures;
    modelAccuracy: number;
    recommendation: {
        action: 'BUY' | 'SELL' | 'HOLD';
        strength: 'STRONG' | 'MODERATE' | 'WEAK';
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
        expectedDuration: number;
        stakeRecommendation: number;
    };
}

export interface MLModel {
    weights: number[][];
    biases: number[];
    accuracy: number;
    trainingCount: number;
    lastUpdate: Date;
}

export class MLPredictionEngine {
    private models: Map<string, MLModel> = new Map();
    private featureHistory: Map<string, MLFeatures[]> = new Map();
    private predictionHistory: Map<string, CandlePrediction[]> = new Map();
    private tickBuffer: Map<string, TickData[]> = new Map();
    
    private readonly FEATURE_WINDOW = 50;
    private readonly PREDICTION_HISTORY_SIZE = 100;
    private readonly MIN_TRAINING_SAMPLES = 100;
    private readonly LEARNING_RATE = 0.001;
    private readonly TICK_BUFFER_SIZE = 1000;
    
    constructor() {
        this.initializeModels();
        this.startContinuousLearning();
    }

    /**
     * Initialize ML models for each volatility symbol
     */
    private initializeModels(): void {
        const volatilitySymbols = [
            'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
            '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
        ];

        volatilitySymbols.forEach(symbol => {
            this.models.set(symbol, this.createNewModel());
            this.featureHistory.set(symbol, []);
            this.predictionHistory.set(symbol, []);
            this.tickBuffer.set(symbol, []);
        });

        console.log('🤖 ML Prediction Engine initialized for', volatilitySymbols.length, 'symbols');
    }

    /**
     * Create a new neural network model
     */
    private createNewModel(): MLModel {
        const inputSize = 25; // Number of features
        const hiddenSize = 50;
        const outputSize = 3; // bullish, bearish, neutral

        return {
            weights: [
                this.randomMatrix(inputSize, hiddenSize),
                this.randomMatrix(hiddenSize, outputSize)
            ],
            biases: [
                new Array(hiddenSize).fill(0).map(() => Math.random() * 0.1),
                new Array(outputSize).fill(0).map(() => Math.random() * 0.1)
            ],
            accuracy: 0.5,
            trainingCount: 0,
            lastUpdate: new Date()
        };
    }

    /**
     * Generate random matrix for neural network weights
     */
    private randomMatrix(rows: number, cols: number): number[][] {
        return Array.from({ length: rows }, () => 
            Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.2)
        );
    }

    /**
     * Process new tick data for ML analysis
     */
    processTick(tick: TickData): void {
        const { symbol } = tick;
        
        // Add to tick buffer
        const buffer = this.tickBuffer.get(symbol) || [];
        buffer.push(tick);
        
        // Maintain buffer size
        if (buffer.length > this.TICK_BUFFER_SIZE) {
            buffer.shift();
        }
        
        this.tickBuffer.set(symbol, buffer);
        
        // Update features when we have enough data
        if (buffer.length >= 20) {
            this.updateFeatures(symbol);
        }
    }

    /**
     * Process new candle for training and prediction
     */
    processCandle(candle: CandleData): void {
        const { symbol } = candle;
        
        // Generate features for this candle
        const features = this.extractFeatures(symbol, candle);
        if (!features) return;
        
        // Store features
        const history = this.featureHistory.get(symbol) || [];
        history.push(features);
        
        if (history.length > this.FEATURE_WINDOW) {
            history.shift();
        }
        
        this.featureHistory.set(symbol, history);
        
        // Train model if we have enough data
        if (history.length >= this.MIN_TRAINING_SAMPLES) {
            this.trainModel(symbol, history);
        }
        
        // Generate prediction for next candle
        const prediction = this.generatePrediction(symbol, features);
        if (prediction) {
            this.storePrediction(symbol, prediction);
        }
    }

    /**
     * Extract comprehensive features from market data
     */
    private extractFeatures(symbol: string, candle: CandleData): MLFeatures | null {
        const candles = candleReconstructionEngine.getCandles(symbol, 20);
        const ticks = this.tickBuffer.get(symbol) || [];
        
        if (candles.length < 10 || ticks.length < 20) return null;
        
        const { open, high, low, close } = candle;
        const recentCandles = candles.slice(-10);
        const recentTicks = ticks.slice(-100);
        
        // Price features
        const ohlcRatios = [
            (high - open) / open,
            (low - open) / open,
            (close - open) / open,
            (high - low) / low
        ];
        
        const prices = recentCandles.map(c => c.close);
        const priceVelocity = this.calculateVelocity(prices);
        const priceAcceleration = this.calculateAcceleration(prices);
        const volatility = this.calculateVolatility(prices);
        
        // Technical indicators
        const hma5 = efficientHMACalculator.getLatestHMA(symbol, 5);
        const hma40 = efficientHMACalculator.getLatestHMA(symbol, 40);
        const hmaSlope = efficientHMACalculator.getHMASlope(symbol, 5) || 0;
        const hmaAlignment = hma5 && hma40 ? (hma5.value - hma40.value) / hma40.value : 0;
        
        const rsi = this.calculateRSI(prices);
        const macd = this.calculateMACD(prices);
        
        // Pattern features
        const candleBodyRatio = Math.abs(close - open) / (high - low);
        const wickRatios = [
            (high - Math.max(open, close)) / (high - low),
            (Math.min(open, close) - low) / (high - low)
        ];
        
        const consecutivePattern = this.getConsecutivePattern(recentCandles);
        
        // Tick features
        const tickCount = recentTicks.length;
        const tickDensity = tickCount / (recentTicks.length > 0 ? 
            (recentTicks[recentTicks.length - 1].epoch - recentTicks[0].epoch) : 1);
        const priceSpread = high - low;
        
        // Time features
        const now = new Date();
        const timeOfDay = (now.getHours() * 60 + now.getMinutes()) / 1440; // 0-1
        const dayOfWeek = now.getDay() / 7; // 0-1
        
        // Market microstructure
        const bidAskSpread = priceSpread / close; // Proxy
        const orderFlow = this.calculateOrderFlow(recentTicks);
        const momentum = this.calculateMomentum(prices);
        
        return {
            ohlcRatios,
            priceVelocity,
            priceAcceleration,
            volatility,
            hmaSlope,
            hmaAlignment,
            rsi,
            macd,
            candleBodyRatio,
            wickRatios,
            consecutivePattern,
            tickCount,
            tickDensity,
            priceSpread,
            timeOfDay,
            dayOfWeek,
            bidAskSpread,
            orderFlow,
            momentum
        };
    }

    /**
     * Train neural network model
     */
    private trainModel(symbol: string, features: MLFeatures[]): void {
        const model = this.models.get(symbol);
        if (!model || features.length < 2) return;
        
        try {
            // Prepare training data
            const inputs: number[][] = [];
            const targets: number[][] = [];
            
            for (let i = 0; i < features.length - 1; i++) {
                const input = this.featuresToVector(features[i]);
                const nextCandle = candleReconstructionEngine.getCandles(symbol).slice(-features.length + i + 1)[0];
                
                if (nextCandle) {
                    const target = this.getCandleDirection(nextCandle);
                    inputs.push(input);
                    targets.push(target);
                }
            }
            
            if (inputs.length === 0) return;
            
            // Perform backpropagation
            for (let epoch = 0; epoch < 10; epoch++) {
                for (let i = 0; i < inputs.length; i++) {
                    this.backpropagate(model, inputs[i], targets[i]);
                }
            }
            
            model.trainingCount += inputs.length;
            model.lastUpdate = new Date();
            
            // Update accuracy
            model.accuracy = this.calculateModelAccuracy(symbol, inputs, targets);
            
            console.log(`🧠 ML Model trained for ${symbol}: Accuracy ${(model.accuracy * 100).toFixed(1)}%`);
            
        } catch (error) {
            console.error(`ML Training error for ${symbol}:`, error);
        }
    }

    /**
     * Convert features to input vector
     */
    private featuresToVector(features: MLFeatures): number[] {
        return [
            ...features.ohlcRatios,
            features.priceVelocity,
            features.priceAcceleration,
            features.volatility,
            features.hmaSlope,
            features.hmaAlignment,
            features.rsi,
            features.macd,
            features.candleBodyRatio,
            ...features.wickRatios,
            ...features.consecutivePattern.slice(0, 3),
            Math.log(features.tickCount + 1) / 10,
            features.tickDensity,
            features.priceSpread / 1000,
            features.timeOfDay,
            features.dayOfWeek,
            features.bidAskSpread,
            features.orderFlow,
            ...features.momentum.slice(0, 3)
        ].slice(0, 25); // Ensure exactly 25 features
    }

    /**
     * Get candle direction as one-hot encoded vector
     */
    private getCandleDirection(candle: CandleData): number[] {
        const change = (candle.close - candle.open) / candle.open;
        
        if (change > 0.0001) return [1, 0, 0]; // bullish
        if (change < -0.0001) return [0, 1, 0]; // bearish
        return [0, 0, 1]; // neutral
    }

    /**
     * Forward pass through neural network
     */
    private forwardPass(model: MLModel, input: number[]): number[] {
        let activation = input;
        
        for (let layer = 0; layer < model.weights.length; layer++) {
            const layerOutput: number[] = [];
            
            for (let neuron = 0; neuron < model.weights[layer][0].length; neuron++) {
                let sum = model.biases[layer][neuron];
                
                for (let input_idx = 0; input_idx < activation.length; input_idx++) {
                    sum += activation[input_idx] * model.weights[layer][input_idx][neuron];
                }
                
                // Apply activation function (tanh for hidden, softmax for output)
                if (layer === model.weights.length - 1) {
                    layerOutput.push(sum); // Will apply softmax later
                } else {
                    layerOutput.push(Math.tanh(sum));
                }
            }
            
            activation = layerOutput;
        }
        
        // Apply softmax to output layer
        return this.softmax(activation);
    }

    /**
     * Backpropagation training
     */
    private backpropagate(model: MLModel, input: number[], target: number[]): void {
        // Forward pass
        const activations: number[][] = [input];
        let current = input;
        
        for (let layer = 0; layer < model.weights.length; layer++) {
            const layerOutput: number[] = [];
            
            for (let neuron = 0; neuron < model.weights[layer][0].length; neuron++) {
                let sum = model.biases[layer][neuron];
                
                for (let i = 0; i < current.length; i++) {
                    sum += current[i] * model.weights[layer][i][neuron];
                }
                
                if (layer === model.weights.length - 1) {
                    layerOutput.push(sum);
                } else {
                    layerOutput.push(Math.tanh(sum));
                }
            }
            
            if (layer === model.weights.length - 1) {
                current = this.softmax(layerOutput);
            } else {
                current = layerOutput;
            }
            
            activations.push([...current]);
        }
        
        // Backward pass
        const errors: number[][] = [];
        const outputError: number[] = [];
        
        // Calculate output error
        for (let i = 0; i < current.length; i++) {
            outputError.push(target[i] - current[i]);
        }
        errors.unshift(outputError);
        
        // Calculate hidden layer errors
        for (let layer = model.weights.length - 2; layer >= 0; layer--) {
            const layerError: number[] = [];
            const nextLayerError = errors[0];
            
            for (let neuron = 0; neuron < model.weights[layer][0].length; neuron++) {
                let error = 0;
                
                for (let nextNeuron = 0; nextNeuron < nextLayerError.length; nextNeuron++) {
                    error += nextLayerError[nextNeuron] * model.weights[layer + 1][neuron][nextNeuron];
                }
                
                // Derivative of tanh
                const activation = activations[layer + 1][neuron];
                error *= (1 - activation * activation);
                layerError.push(error);
            }
            
            errors.unshift(layerError);
        }
        
        // Update weights and biases
        for (let layer = 0; layer < model.weights.length; layer++) {
            const layerError = errors[layer + 1];
            const layerInput = activations[layer];
            
            for (let neuron = 0; neuron < layerError.length; neuron++) {
                model.biases[layer][neuron] += this.LEARNING_RATE * layerError[neuron];
                
                for (let input_idx = 0; input_idx < layerInput.length; input_idx++) {
                    model.weights[layer][input_idx][neuron] += 
                        this.LEARNING_RATE * layerError[neuron] * layerInput[input_idx];
                }
            }
        }
    }

    /**
     * Softmax activation function
     */
    private softmax(values: number[]): number[] {
        const exp_values = values.map(v => Math.exp(v - Math.max(...values)));
        const sum = exp_values.reduce((a, b) => a + b, 0);
        return exp_values.map(v => v / sum);
    }

    /**
     * Generate prediction for next candle
     */
    generatePrediction(symbol: string, features: MLFeatures): CandlePrediction | null {
        const model = this.models.get(symbol);
        if (!model || model.trainingCount < 50) return null;
        
        try {
            const input = this.featuresToVector(features);
            const output = this.forwardPass(model, input);
            
            const [bullishProb, bearishProb, neutralProb] = output;
            const maxProb = Math.max(...output);
            const direction = bullishProb === maxProb ? 'bullish' : 
                            bearishProb === maxProb ? 'bearish' : 'neutral';
            
            const confidence = maxProb * 100;
            const predictedMove = this.calculatePredictedMove(features, direction, confidence);
            
            const recommendation = this.generateRecommendation(
                symbol, direction, confidence, features, model.accuracy
            );
            
            return {
                symbol,
                nextCandleDirection: direction,
                confidence,
                predictedMove,
                timeframe: '1m',
                features,
                modelAccuracy: model.accuracy * 100,
                recommendation
            };
            
        } catch (error) {
            console.error(`Prediction error for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Generate trading recommendation based on prediction
     */
    private generateRecommendation(
        symbol: string, 
        direction: 'bullish' | 'bearish' | 'neutral', 
        confidence: number, 
        features: MLFeatures, 
        modelAccuracy: number
    ): CandlePrediction['recommendation'] {
        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
        
        // Base action on direction and confidence
        if (direction === 'bullish' && confidence > 60) {
            action = 'BUY';
        } else if (direction === 'bearish' && confidence > 60) {
            action = 'SELL';
        }
        
        // Adjust strength based on confidence and model accuracy
        const combinedScore = (confidence * 0.7) + (modelAccuracy * 100 * 0.3);
        
        if (combinedScore > 80) {
            strength = 'STRONG';
            riskLevel = 'LOW';
        } else if (combinedScore > 65) {
            strength = 'MODERATE';
            riskLevel = 'MEDIUM';
        } else {
            strength = 'WEAK';
            riskLevel = 'HIGH';
        }
        
        // Calculate expected duration based on volatility
        const expectedDuration = Math.max(5, Math.min(60, 
            20 + (features.volatility * 1000) + (features.tickDensity / 10)
        ));
        
        // Calculate stake recommendation based on confidence and risk
        const baseStake = 1.0;
        const confidenceMultiplier = Math.max(0.5, Math.min(2.0, confidence / 50));
        const riskMultiplier = riskLevel === 'LOW' ? 1.2 : riskLevel === 'MEDIUM' ? 1.0 : 0.8;
        
        const stakeRecommendation = Math.round(
            (baseStake * confidenceMultiplier * riskMultiplier) * 100
        ) / 100;
        
        return {
            action,
            strength,
            riskLevel,
            expectedDuration,
            stakeRecommendation
        };
    }

    /**
     * Calculate various technical indicators and patterns
     */
    private calculateVelocity(prices: number[]): number {
        if (prices.length < 2) return 0;
        const changes = prices.slice(1).map((p, i) => p - prices[i]);
        return changes.reduce((a, b) => a + b, 0) / changes.length;
    }

    private calculateAcceleration(prices: number[]): number {
        if (prices.length < 3) return 0;
        const velocities = prices.slice(1).map((p, i) => p - prices[i]);
        const accelerations = velocities.slice(1).map((v, i) => v - velocities[i]);
        return accelerations.reduce((a, b) => a + b, 0) / accelerations.length;
    }

    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;
        const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
    }

    private calculateRSI(prices: number[]): number {
        if (prices.length < 14) return 50;
        
        const gains: number[] = [];
        const losses: number[] = [];
        
        for (let i = 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }
        
        const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
        const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    private calculateMACD(prices: number[]): number {
        if (prices.length < 26) return 0;
        
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        
        return ema12 - ema26;
    }

    private calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];
        
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    private getConsecutivePattern(candles: CandleData[]): number[] {
        const pattern: number[] = [];
        
        for (let i = 0; i < Math.min(5, candles.length); i++) {
            const candle = candles[candles.length - 1 - i];
            const direction = candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0;
            pattern.push(direction);
        }
        
        return pattern;
    }

    private calculateOrderFlow(ticks: TickData[]): number {
        if (ticks.length < 2) return 0;
        
        let buyVolume = 0;
        let sellVolume = 0;
        
        for (let i = 1; i < ticks.length; i++) {
            const priceChange = ticks[i].quote - ticks[i - 1].quote;
            if (priceChange > 0) {
                buyVolume++;
            } else if (priceChange < 0) {
                sellVolume++;
            }
        }
        
        const totalVolume = buyVolume + sellVolume;
        return totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;
    }

    private calculateMomentum(prices: number[]): number[] {
        const momentum: number[] = [];
        const periods = [3, 5, 10];
        
        periods.forEach(period => {
            if (prices.length >= period) {
                const current = prices[prices.length - 1];
                const past = prices[prices.length - period];
                momentum.push((current - past) / past);
            } else {
                momentum.push(0);
            }
        });
        
        return momentum;
    }

    private calculatePredictedMove(features: MLFeatures, direction: string, confidence: number): number {
        const volatilityFactor = features.volatility * 1000;
        const momentumFactor = Math.abs(features.momentum[0] || 0) * 100;
        
        let baseMove = (volatilityFactor + momentumFactor) * 0.5;
        baseMove *= (confidence / 100);
        
        return direction === 'bearish' ? -baseMove : baseMove;
    }

    private calculateModelAccuracy(symbol: string, inputs: number[][], targets: number[][]): number {
        const model = this.models.get(symbol);
        if (!model) return 0.5;
        
        let correct = 0;
        
        for (let i = 0; i < inputs.length; i++) {
            const prediction = this.forwardPass(model, inputs[i]);
            const predictedClass = prediction.indexOf(Math.max(...prediction));
            const actualClass = targets[i].indexOf(Math.max(...targets[i]));
            
            if (predictedClass === actualClass) {
                correct++;
            }
        }
        
        return inputs.length > 0 ? correct / inputs.length : 0.5;
    }

    private updateFeatures(symbol: string): void {
        const candles = candleReconstructionEngine.getCandles(symbol, 1);
        if (candles.length > 0) {
            const latestCandle = candles[candles.length - 1];
            this.processCandle(latestCandle);
        }
    }

    private storePrediction(symbol: string, prediction: CandlePrediction): void {
        const history = this.predictionHistory.get(symbol) || [];
        history.push(prediction);
        
        if (history.length > this.PREDICTION_HISTORY_SIZE) {
            history.shift();
        }
        
        this.predictionHistory.set(symbol, history);
        
        console.log(`🔮 ML Prediction for ${symbol}: ${prediction.nextCandleDirection.toUpperCase()} (${prediction.confidence.toFixed(1)}% confidence)`);
    }

    private startContinuousLearning(): void {
        // Retrain models periodically
        setInterval(() => {
            this.models.forEach((model, symbol) => {
                const features = this.featureHistory.get(symbol) || [];
                if (features.length >= this.MIN_TRAINING_SAMPLES) {
                    this.trainModel(symbol, features);
                }
            });
        }, 5 * 60 * 1000); // Every 5 minutes
        
        console.log('🔄 Continuous learning started');
    }

    /**
     * Get latest prediction for a symbol
     */
    getLatestPrediction(symbol: string): CandlePrediction | null {
        const history = this.predictionHistory.get(symbol) || [];
        return history.length > 0 ? history[history.length - 1] : null;
    }

    /**
     * Get all current predictions
     */
    getAllPredictions(): Map<string, CandlePrediction> {
        const predictions = new Map<string, CandlePrediction>();
        
        this.predictionHistory.forEach((history, symbol) => {
            if (history.length > 0) {
                predictions.set(symbol, history[history.length - 1]);
            }
        });
        
        return predictions;
    }

    /**
     * Get model statistics
     */
    getModelStats(): Map<string, { accuracy: number; trainingCount: number; lastUpdate: Date }> {
        const stats = new Map();
        
        this.models.forEach((model, symbol) => {
            stats.set(symbol, {
                accuracy: model.accuracy * 100,
                trainingCount: model.trainingCount,
                lastUpdate: model.lastUpdate
            });
        });
        
        return stats;
    }

    /**
     * Get ranked recommendations for all volatilities
     */
    getRankedRecommendations(): CandlePrediction[] {
        const predictions: CandlePrediction[] = [];
        
        this.getAllPredictions().forEach((prediction, symbol) => {
            if (prediction.recommendation.action !== 'HOLD') {
                predictions.push(prediction);
            }
        });
        
        // Sort by combined score of confidence and model accuracy
        return predictions.sort((a, b) => {
            const scoreA = (a.confidence * 0.7) + (a.modelAccuracy * 0.3);
            const scoreB = (b.confidence * 0.7) + (b.modelAccuracy * 0.3);
            return scoreB - scoreA;
        });
    }

    /**
     * Clean up old data
     */
    cleanup(): void {
        // This method can be called periodically to clean up old data
        console.log('🧹 ML Engine cleanup completed');
    }
}

// Create singleton instance
export const mlPredictionEngine = new MLPredictionEngine();
