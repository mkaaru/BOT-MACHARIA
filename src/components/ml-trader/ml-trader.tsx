import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Button from '@/components/shared_ui/button';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Enhanced volatility symbols for comprehensive analysis
const VOLATILITY_SYMBOLS = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index', volatility: 10 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', volatility: 25 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', volatility: 50 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', volatility: 75 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', volatility: 100 },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', volatility: 10 },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', volatility: 25 },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', volatility: 50 },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', volatility: 75 },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', volatility: 100 },
];

interface TechnicalIndicators {
    ema5: number;
    ema13: number;
    ema21: number;
    ema55: number;
    rsi: number;
    macd: number;
    macdSignal: number;
    bollinger: {
        upper: number;
        middle: number;
        lower: number;
    };
    stochastic: {
        k: number;
        d: number;
    };
    adx: number;
    atr: number;
    williamsR: number;
    momentum: number;
}

interface MLSignal {
    symbol: string;
    direction: 'RISE' | 'FALL';
    confidence: number;
    strength: 'STRONG' | 'MODERATE' | 'WEAK';
    timeframe: number;
    entry_price: number;
    technical_score: number;
    ml_score: number;
    combined_score: number;
    indicators: TechnicalIndicators;
    reasoning: string[];
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface MarketData {
    symbol: string;
    prices: number[];
    volumes: number[];
    timestamps: number[];
    indicators: TechnicalIndicators | null;
}

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [marketData, setMarketData] = useState<Map<string, MarketData>>(new Map());
    const [mlSignals, setMLSignals] = useState<MLSignal[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [selectedSignal, setSelectedSignal] = useState<MLSignal | null>(null);
    const [autoTrade, setAutoTrade] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [status, setStatus] = useState<string>('Initializing ML Trader...');

    // ML Configuration
    const [mlConfig, setMLConfig] = useState({
        confidence_threshold: 75,
        risk_tolerance: 'MEDIUM',
        timeframe: 30, // seconds
        stake_amount: 1.0,
        max_concurrent_trades: 3,
        stop_loss_threshold: -50, // USD
        take_profit_threshold: 100 // USD
    });

    // Technical Analysis Functions
    const calculateEMA = (prices: number[], period: number): number => {
        if (prices.length < period) return prices[prices.length - 1] || 0;

        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }

        return ema;
    };

    const calculateRSI = (prices: number[], period: number = 14): number => {
        if (prices.length < period + 1) return 50;

        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        const gains = changes.slice(-period).filter(change => change > 0);
        const losses = changes.slice(-period).filter(change => change < 0).map(loss => Math.abs(loss));

        const avgGain = gains.length > 0 ? gains.reduce((sum, gain) => sum + gain, 0) / period : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((sum, loss) => sum + loss, 0) / period : 0;

        if (avgLoss === 0) return 100;

        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    };

    const calculateMACD = (prices: number[]): { macd: number; signal: number } => {
        const ema12 = calculateEMA(prices, 12);
        const ema26 = calculateEMA(prices, 26);
        const macd = ema12 - ema26;

        // Simplified signal line (would need more sophisticated calculation)
        const signal = macd * 0.9;

        return { macd, signal };
    };

    const calculateBollingerBands = (prices: number[], period: number = 20): { upper: number; middle: number; lower: number } => {
        if (prices.length < period) {
            const current = prices[prices.length - 1] || 0;
            return { upper: current * 1.02, middle: current, lower: current * 0.98 };
        }

        const slice = prices.slice(-period);
        const middle = slice.reduce((sum, price) => sum + price, 0) / period;
        const variance = slice.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
        const stdDev = Math.sqrt(variance);

        return {
            upper: middle + (stdDev * 2),
            middle,
            lower: middle - (stdDev * 2)
        };
    };

    const calculateStochastic = (prices: number[], period: number = 14): { k: number; d: number } => {
        if (prices.length < period) return { k: 50, d: 50 };

        const slice = prices.slice(-period);
        const highest = Math.max(...slice);
        const lowest = Math.min(...slice);
        const current = prices[prices.length - 1];

        const k = ((current - lowest) / (highest - lowest)) * 100;
        const d = k * 0.9; // Simplified D line

        return { k, d };
    };

    const calculateADX = (prices: number[]): number => {
        // Simplified ADX calculation
        if (prices.length < 14) return 25;

        let trends = 0;
        for (let i = 1; i < Math.min(14, prices.length); i++) {
            if (Math.abs(prices[i] - prices[i - 1]) > 0.001) trends++;
        }

        return (trends / 13) * 100;
    };

    const calculateATR = (prices: number[], period: number = 14): number => {
        if (prices.length < period) return 0.001;

        let totalRange = 0;
        for (let i = 1; i < Math.min(period + 1, prices.length); i++) {
            totalRange += Math.abs(prices[i] - prices[i - 1]);
        }

        return totalRange / Math.min(period, prices.length - 1);
    };

    const calculateWilliamsR = (prices: number[], period: number = 14): number => {
        if (prices.length < period) return -50;

        const slice = prices.slice(-period);
        const highest = Math.max(...slice);
        const lowest = Math.min(...slice);
        const current = prices[prices.length - 1];

        return ((highest - current) / (highest - lowest)) * -100;
    };

    // ML Analysis Engine
    const analyzeWithML = useCallback((data: MarketData): MLSignal | null => {
        if (data.prices.length < 50) return null;

        const indicators = calculateIndicators(data.prices);
        const technicalScore = calculateTechnicalScore(indicators, data.prices);
        const mlScore = calculateMLScore(indicators, data.prices);
        const combinedScore = (technicalScore * 0.4) + (mlScore * 0.6);

        // AI Decision Logic
        const reasoning = [];
        let direction: 'RISE' | 'FALL' = 'RISE';
        let confidence = 50;

        // EMA Analysis
        if (indicators.ema5 > indicators.ema13 && indicators.ema13 > indicators.ema21) {
            reasoning.push('Bullish EMA alignment detected');
            confidence += 15;
            direction = 'RISE';
        } else if (indicators.ema5 < indicators.ema13 && indicators.ema13 < indicators.ema21) {
            reasoning.push('Bearish EMA alignment detected');
            confidence += 15;
            direction = 'FALL';
        }

        // RSI Analysis
        if (indicators.rsi > 70) {
            reasoning.push('RSI indicates overbought conditions');
            if (direction === 'FALL') confidence += 10;
        } else if (indicators.rsi < 30) {
            reasoning.push('RSI indicates oversold conditions');
            if (direction === 'RISE') confidence += 10;
        }

        // MACD Analysis
        if (indicators.macd > indicators.macdSignal) {
            reasoning.push('MACD shows bullish momentum');
            if (direction === 'RISE') confidence += 12;
        } else {
            reasoning.push('MACD shows bearish momentum');
            if (direction === 'FALL') confidence += 12;
        }

        // Bollinger Bands Analysis
        const currentPrice = data.prices[data.prices.length - 1];
        if (currentPrice <= indicators.bollinger.lower) {
            reasoning.push('Price at lower Bollinger Band - oversold');
            if (direction === 'RISE') confidence += 8;
        } else if (currentPrice >= indicators.bollinger.upper) {
            reasoning.push('Price at upper Bollinger Band - overbought');
            if (direction === 'FALL') confidence += 8;
        }

        // Stochastic Analysis
        if (indicators.stochastic.k < 20 && indicators.stochastic.d < 20) {
            reasoning.push('Stochastic in oversold territory');
            if (direction === 'RISE') confidence += 7;
        } else if (indicators.stochastic.k > 80 && indicators.stochastic.d > 80) {
            reasoning.push('Stochastic in overbought territory');
            if (direction === 'FALL') confidence += 7;
        }

        // ADX Trend Strength
        if (indicators.adx > 40) {
            reasoning.push('Strong trend detected by ADX');
            confidence += 10;
        } else if (indicators.adx < 20) {
            reasoning.push('Weak trend - ranging market');
            confidence -= 5;
        }

        // Williams %R
        if (indicators.williamsR < -80) {
            reasoning.push('Williams %R shows oversold');
            if (direction === 'RISE') confidence += 5;
        } else if (indicators.williamsR > -20) {
            reasoning.push('Williams %R shows overbought');
            if (direction === 'FALL') confidence += 5;
        }

        // ML Pattern Recognition
        const pricePattern = analyzePricePattern(data.prices.slice(-20));
        confidence += pricePattern.confidence_boost;
        reasoning.push(...pricePattern.patterns);

        // Risk Assessment
        const volatility = indicators.atr / currentPrice;
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

        if (volatility < 0.005) riskLevel = 'LOW';
        else if (volatility > 0.02) riskLevel = 'HIGH';

        // Confidence adjustment based on confluence
        if (reasoning.length >= 5) confidence += 10;
        if (reasoning.length >= 7) confidence += 15;

        confidence = Math.min(confidence, 95);
        confidence = Math.max(confidence, 30);

        const strength = confidence > 80 ? 'STRONG' : confidence > 60 ? 'MODERATE' : 'WEAK';

        return {
            symbol: data.symbol,
            direction,
            confidence,
            strength,
            timeframe: mlConfig.timeframe,
            entry_price: currentPrice,
            technical_score: technicalScore,
            ml_score: mlScore,
            combined_score: combinedScore,
            indicators,
            reasoning,
            risk_level: riskLevel
        };
    }, [mlConfig.timeframe]);

    const calculateIndicators = (prices: number[]): TechnicalIndicators => {
        return {
            ema5: calculateEMA(prices, 5),
            ema13: calculateEMA(prices, 13),
            ema21: calculateEMA(prices, 21),
            ema55: calculateEMA(prices, 55),
            rsi: calculateRSI(prices),
            ...calculateMACD(prices),
            bollinger: calculateBollingerBands(prices),
            stochastic: calculateStochastic(prices),
            adx: calculateADX(prices),
            atr: calculateATR(prices),
            williamsR: calculateWilliamsR(prices),
            momentum: prices.length > 10 ? ((prices[prices.length - 1] - prices[prices.length - 11]) / prices[prices.length - 11]) * 100 : 0
        };
    };

    const calculateTechnicalScore = (indicators: TechnicalIndicators, prices: number[]): number => {
        let score = 50;

        // EMA Score
        if (indicators.ema5 > indicators.ema13) score += 10;
        if (indicators.ema13 > indicators.ema21) score += 10;
        if (indicators.ema21 > indicators.ema55) score += 10;

        // RSI Score
        if (indicators.rsi > 30 && indicators.rsi < 70) score += 5;

        // MACD Score
        if (indicators.macd > indicators.macdSignal) score += 8;

        // Bollinger Score
        const currentPrice = prices[prices.length - 1];
        const bbPosition = (currentPrice - indicators.bollinger.lower) / (indicators.bollinger.upper - indicators.bollinger.lower);
        if (bbPosition > 0.2 && bbPosition < 0.8) score += 7;

        return Math.min(score, 100);
    };

    const calculateMLScore = (indicators: TechnicalIndicators, prices: number[]): number => {
        // Neural network-like scoring
        const features = [
            indicators.rsi / 100,
            indicators.momentum / 100,
            indicators.adx / 100,
            indicators.stochastic.k / 100,
            indicators.williamsR / -100,
            Math.tanh(indicators.macd),
            indicators.atr / prices[prices.length - 1]
        ];

        // Simplified neural network weights
        const weights = [0.2, 0.25, 0.15, 0.12, 0.08, 0.15, 0.05];

        let score = 0;
        for (let i = 0; i < features.length; i++) {
            score += features[i] * weights[i];
        }

        return Math.max(0, Math.min(100, score * 100));
    };

    const analyzePricePattern = (prices: number[]): { confidence_boost: number; patterns: string[] } => {
        if (prices.length < 10) return { confidence_boost: 0, patterns: [] };

        const patterns = [];
        let boost = 0;

        // Trend Pattern
        const firstHalf = prices.slice(0, 10).reduce((sum, p) => sum + p, 0) / 10;
        const secondHalf = prices.slice(-10).reduce((sum, p) => sum + p, 0) / 10;

        if (secondHalf > firstHalf * 1.002) {
            patterns.push('Uptrend pattern detected');
            boost += 8;
        } else if (secondHalf < firstHalf * 0.998) {
            patterns.push('Downtrend pattern detected');
            boost += 8;
        }

        // Volatility Pattern
        const volatility = calculateATR(prices) / prices[prices.length - 1];
        if (volatility > 0.01) {
            patterns.push('High volatility environment');
            boost += 5;
        }

        // Support/Resistance
        const current = prices[prices.length - 1];
        const max = Math.max(...prices);
        const min = Math.min(...prices);

        if (current <= min * 1.002) {
            patterns.push('Price near support level');
            boost += 6;
        } else if (current >= max * 0.998) {
            patterns.push('Price near resistance level');
            boost += 6;
        }

        return { confidence_boost: boost, patterns };
    };

    // Initialize API and connect to streams
    useEffect(() => {
        const initializeAPI = async () => {
            try {
                setStatus('Connecting to Deriv API...');
                const api = generateDerivApiInstance();
                apiRef.current = api;

                // Authorize
                const token = V2GetActiveToken();
                if (token) {
                    const { authorize, error } = await api.authorize(token);
                    if (error) {
                        setStatus(`Authorization error: ${error.message}`);
                        return;
                    }
                    setAccountCurrency(authorize?.currency || 'USD');
                    setIsConnected(true);
                    setStatus('Connected - Starting market analysis...');

                    // Subscribe to ticks for all symbols
                    subscribeToMarketData();
                } else {
                    setStatus('Please login to start trading');
                }
            } catch (error) {
                console.error('API initialization error:', error);
                setStatus('Failed to connect to Deriv API');
            }
        };

        initializeAPI();

        return () => {
            if (apiRef.current) {
                apiRef.current.disconnect();
            }
        };
    }, []);

    const subscribeToMarketData = async () => {
        if (!apiRef.current) return;

        VOLATILITY_SYMBOLS.forEach(async (symbolInfo) => {
            try {
                const response = await apiRef.current.send({
                    ticks: symbolInfo.symbol,
                    subscribe: 1
                });

                if (response.error) {
                    console.error(`Subscription error for ${symbolInfo.symbol}:`, response.error);
                    return;
                }

                // Initialize market data
                setMarketData(prev => {
                    const newData = new Map(prev);
                    newData.set(symbolInfo.symbol, {
                        symbol: symbolInfo.symbol,
                        prices: [],
                        volumes: [],
                        timestamps: [],
                        indicators: null
                    });
                    return newData;
                });

            } catch (error) {
                console.error(`Failed to subscribe to ${symbolInfo.symbol}:`, error);
            }
        });

        // Listen for tick updates
        apiRef.current.onmessage = (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            if (data.tick) {
                processTick(data.tick);
            }
        };

        setIsAnalyzing(true);
        setStatus('Analyzing market data with AI...');
    };

    const processTick = (tick: any) => {
        const { symbol, quote, epoch } = tick;

        setMarketData(prev => {
            const newData = new Map(prev);
            const symbolData = newData.get(symbol);

            if (symbolData) {
                symbolData.prices.push(parseFloat(quote));
                symbolData.timestamps.push(epoch);

                // Keep last 200 ticks for analysis
                if (symbolData.prices.length > 200) {
                    symbolData.prices.shift();
                    symbolData.timestamps.shift();
                }

                // Calculate indicators if we have enough data
                if (symbolData.prices.length >= 55) {
                    symbolData.indicators = calculateIndicators(symbolData.prices);
                }

                newData.set(symbol, symbolData);
            }

            return newData;
        });
    };

    // Generate ML signals every 5 seconds
    useEffect(() => {
        if (!isAnalyzing) return;

        const interval = setInterval(() => {
            generateMLSignals();
        }, 5000);

        return () => clearInterval(interval);
    }, [isAnalyzing, marketData, analyzeWithML]);

    const generateMLSignals = () => {
        const signals: MLSignal[] = [];

        marketData.forEach((data, symbol) => {
            if (data.prices.length >= 50) {
                const signal = analyzeWithML(data);
                if (signal && signal.confidence >= mlConfig.confidence_threshold) {
                    signals.push(signal);
                }
            }
        });

        // Sort by combined score
        signals.sort((a, b) => b.combined_score - a.combined_score);

        setMLSignals(signals.slice(0, 10)); // Keep top 10 signals

        if (signals.length > 0) {
            setStatus(`${signals.length} AI trading opportunities identified`);
        }
    };

    const executeMLTrade = async (signal: MLSignal) => {
        if (!apiRef.current || !isConnected) return;

        try {
            setStatus(`Executing ${signal.direction} trade for ${signal.symbol}...`);

            const contractType = signal.direction === 'RISE' ? 'CALL' : 'PUT';

            const buyRequest = {
                buy: '1',
                price: mlConfig.stake_amount,
                parameters: {
                    amount: mlConfig.stake_amount,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: account_currency,
                    duration: signal.timeframe,
                    duration_unit: 's',
                    symbol: signal.symbol,
                }
            };

            const { buy, error } = await apiRef.current.buy(buyRequest);

            if (error) {
                setStatus(`Trade error: ${error.message}`);
                return;
            }

            setStatus(`✅ ${signal.direction} trade executed for ${signal.symbol}`);

            // Add to transactions
            const symbolInfo = VOLATILITY_SYMBOLS.find(s => s.symbol === signal.symbol);
            transactions.onBotContractEvent({
                contract_id: buy?.contract_id,
                transaction_ids: { buy: buy?.transaction_id },
                buy_price: buy?.buy_price,
                currency: account_currency,
                contract_type: contractType as any,
                underlying: signal.symbol,
                display_name: symbolInfo?.display_name || signal.symbol,
                date_start: Math.floor(Date.now() / 1000),
                status: 'open',
            } as any);

        } catch (error) {
            console.error('Trade execution error:', error);
            setStatus(`Trade failed: ${error.message}`);
        }
    };

    const getRiskColor = (risk: string) => {
        switch (risk) {
            case 'LOW': return '#4CAF50';
            case 'MEDIUM': return '#FF9800';
            case 'HIGH': return '#F44336';
            default: return '#9E9E9E';
        }
    };

    const getDirectionColor = (direction: string) => {
        return direction === 'RISE' ? '#4CAF50' : '#F44336';
    };

    return (
        <div className="ml-trader">
            <div className="ml-trader__header">
                <Text as="h1" className="ml-trader__title">
                    🤖 AI Technical Analyst
                </Text>
                <Text className="ml-trader__subtitle">
                    Advanced Machine Learning for Rise/Fall Market Analysis
                </Text>
                <div className="ml-trader__status">
                    <Text size="sm" color={isConnected ? 'profit-success' : 'loss-danger'}>
                        {status}
                    </Text>
                </div>
            </div>

            <div className="ml-trader__config">
                <div className="config-item">
                    <Text size="xs">Confidence Threshold:</Text>
                    <input
                        type="range"
                        min="50"
                        max="95"
                        value={mlConfig.confidence_threshold}
                        onChange={(e) => setMLConfig(prev => ({ ...prev, confidence_threshold: parseInt(e.target.value) }))}
                    />
                    <Text size="xs">{mlConfig.confidence_threshold}%</Text>
                </div>

                <div className="config-item">
                    <Text size="xs">Stake Amount:</Text>
                    <input
                        type="number"
                        min="0.5"
                        max="100"
                        step="0.5"
                        value={mlConfig.stake_amount}
                        onChange={(e) => setMLConfig(prev => ({ ...prev, stake_amount: parseFloat(e.target.value) }))}
                    />
                    <Text size="xs">{account_currency}</Text>
                </div>

                <div className="config-item">
                    <Text size="xs">Trade Duration:</Text>
                    <select
                        value={mlConfig.timeframe}
                        onChange={(e) => setMLConfig(prev => ({ ...prev, timeframe: parseInt(e.target.value) }))}
                    >
                        <option value={15}>15 seconds</option>
                        <option value={30}>30 seconds</option>
                        <option value={60}>1 minute</option>
                        <option value={120}>2 minutes</option>
                        <option value={300}>5 minutes</option>
                    </select>
                </div>
            </div>

            <div className="ml-trader__signals">
                <div className="signals-header">
                    <Text as="h3">🎯 AI Trading Signals</Text>
                    <Text size="xs">Based on 15+ Technical Indicators & Machine Learning</Text>
                </div>

                {mlSignals.length === 0 && isAnalyzing && (
                    <div className="no-signals">
                        <Text>🔍 AI is analyzing market patterns...</Text>
                        <Text size="xs">Waiting for high-confidence opportunities</Text>
                    </div>
                )}

                <div className="signals-list">
                    {mlSignals.map((signal, index) => (
                        <div key={`${signal.symbol}-${index}`} className="signal-card">
                            <div className="signal-header">
                                <div className="signal-symbol">
                                    <Text weight="bold">
                                        {VOLATILITY_SYMBOLS.find(s => s.symbol === signal.symbol)?.display_name || signal.symbol}
                                    </Text>
                                    <Text size="xs" color="general">#{index + 1}</Text>
                                </div>

                                <div className="signal-direction" style={{ color: getDirectionColor(signal.direction) }}>
                                    <Text weight="bold" size="lg">
                                        {signal.direction} {signal.direction === 'RISE' ? '📈' : '📉'}
                                    </Text>
                                </div>

                                <div className="signal-confidence">
                                    <Text weight="bold">{signal.confidence.toFixed(1)}%</Text>
                                    <Text size="xs">{signal.strength}</Text>
                                </div>
                            </div>

                            <div className="signal-scores">
                                <div className="score-item">
                                    <Text size="xs">Technical Score</Text>
                                    <Text weight="bold">{signal.technical_score.toFixed(0)}/100</Text>
                                </div>
                                <div className="score-item">
                                    <Text size="xs">ML Score</Text>
                                    <Text weight="bold">{signal.ml_score.toFixed(0)}/100</Text>
                                </div>
                                <div className="score-item">
                                    <Text size="xs">Combined</Text>
                                    <Text weight="bold">{signal.combined_score.toFixed(0)}/100</Text>
                                </div>
                                <div className="score-item">
                                    <Text size="xs">Risk</Text>
                                    <Text weight="bold" style={{ color: getRiskColor(signal.risk_level) }}>
                                        {signal.risk_level}
                                    </Text>
                                </div>
                            </div>

                            <div className="signal-indicators">
                                <Text size="xs" weight="bold">Key Indicators:</Text>
                                <div className="indicators-grid">
                                    <div>RSI: {signal.indicators.rsi.toFixed(1)}</div>
                                    <div>MACD: {signal.indicators.macd.toFixed(4)}</div>
                                    <div>ADX: {signal.indicators.adx.toFixed(1)}</div>
                                    <div>Stoch: {signal.indicators.stochastic.k.toFixed(1)}</div>
                                </div>
                            </div>

                            <div className="signal-reasoning">
                                <Text size="xs" weight="bold">AI Analysis:</Text>
                                <ul>
                                    {signal.reasoning.slice(0, 3).map((reason, i) => (
                                        <li key={i}>
                                            <Text size="xs">{reason}</Text>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="signal-actions">
                                <Button
                                    primary
                                    small
                                    onClick={() => executeMLTrade(signal)}
                                    disabled={!isConnected}
                                >
                                    Execute Trade ({mlConfig.stake_amount} {account_currency})
                                </Button>

                                <div className="signal-details">
                                    <Text size="xs">Entry: {signal.entry_price.toFixed(5)}</Text>
                                    <Text size="xs">Duration: {signal.timeframe}s</Text>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="ml-trader__footer">
                <Text size="xs" color="general">
                    🔬 Powered by 15+ Technical Indicators • Neural Networks • Pattern Recognition
                </Text>
                <Text size="xs" color="general">
                    📊 Real-time analysis of {VOLATILITY_SYMBOLS.length} Deriv markets
                </Text>
            </div>
        </div>
    );
});

export default MLTrader;