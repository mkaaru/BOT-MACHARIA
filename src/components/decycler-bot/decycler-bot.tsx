import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import './decycler-bot.scss';

interface DecyclerConfig {
    app_id: number;
    symbol: string;
    stake: number;
    take_profit: number;
    stop_loss: number;
    tick_count: number;
    use_10s_filter: boolean;
    monitor_interval: number;
    contract_type: 'rise_fall' | 'higher_lower' | 'allow_equals' | 'multipliers';
    use_trailing_stop: boolean;
    trailing_step: number;
    use_breakeven: boolean;
    breakeven_trigger: number;
    alpha: number;
    min_risk_reward_ratio: number;
    max_daily_loss: number;
    max_consecutive_losses: number;
    position_sizing_method: 'fixed' | 'percentage' | 'kelly' | 'adaptive';
    account_balance: number;
    risk_per_trade: number;
    trend_strength_threshold: number;
    // Multipliers specific
    multiplier: number;
    deal_cancellation?: '5m' | '10m' | '15m' | '30m' | '60m';
    use_deal_cancellation: boolean;
}

interface TrendData {
    timeframe: string;
    trend: 'bullish' | 'bearish' | 'neutral';
    value: number;
    timestamp: number;
}

interface ContractInfo {
    id: string;
    type: string;
    entry_price: number;
    current_price: number;
    profit: number;
    status: 'open' | 'closed' | 'pending';
    entry_time: number;
    direction: 'UP' | 'DOWN';
    stop_loss: number;
    take_profit: number;
    trailing_stop: number;
    breakeven_active: boolean;
}

interface BotStatus {
    is_running: boolean;
    last_update: number;
    trends: TrendData[];
    current_contract: null;
    total_trades: number;
    winning_trades: number;
    total_pnl: number;
    error_message: string;
    alignment_status: 'aligned_bullish' | 'aligned_bearish' | 'mixed' | 'neutral';
}

const DecyclerBot: React.FC = observer(() => {
    const [config, setConfig] = useState({
        api_token: '',
        app_id: 75771,
        symbol: '1HZ100V',
        stake: 0.35,
        take_profit: 0.85,
        stop_loss: -0.35,
        tick_count: 5,
        use_10s_filter: true,
        monitor_interval: 10,
        contract_type: 'allow_equals',
        use_trailing_stop: true,
        trailing_step: 0.5,
        use_breakeven: true,
        breakeven_trigger: 2.0,
        alpha: 0.07,
        min_risk_reward_ratio: 1.5,
        max_daily_loss: 50,
        max_consecutive_losses: 3,
        position_sizing_method: 'fixed',
        account_balance: 1000,
        risk_per_trade: 2,
        trend_strength_threshold: 0.75,
        // Multipliers specific
        multiplier: 100,
        deal_cancellation: '60m',
        use_deal_cancellation: false
    });

    // Check if user is OAuth authenticated
    const isOAuthEnabled = useOauth2().isOAuth2Enabled;

    const [botStatus, setBotStatus] = useState<BotStatus>({
        is_running: false,
        last_update: 0,
        trends: [],
        current_contract: null,
        total_trades: 0,
        winning_trades: 0,
        total_pnl: 0,
        error_message: '',
        alignment_status: 'neutral'
    });

    const [logs, setLogs] = useState<string[]>([]);
    const [ohlcData, setOhlcData] = useState<{ [key: string]: any[] }>({});
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const monitorRef = useRef<NodeJS.Timeout | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const isRunningRef = useRef<boolean>(false);
    const [isConnected, setIsConnected] = useState(false);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [lastSignal, setLastSignal] = useState<string>('');
    const [performanceData, setPerformanceData] = useState({
        totalTrades: 0,
        winRate: 0,
        totalPnL: 0
    });
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [authToken, setAuthToken] = useState('');
    const [tradingEnabled, setTradingEnabled] = useState(false);
    const [currentContract, setCurrentContract] = useState<any>(null);
    const [tradeHistory, setTradeHistory] = useState<any[]>([]);
    const [dailyTradeCount, setDailyTradeCount] = useState(0);

    const timeframePresets = {
        scalping: ['1m', '2m', '3m', '4m', '5m'],
        multi: ['1m', '5m', '15m', '30m', '1h', '4h']
    };

    const [selectedTimeframePreset, setSelectedTimeframePreset] = useState<'scalping' | 'multi'>('multi');
    const timeframes = timeframePresets[selectedTimeframePreset];
    const wsRef = useRef<WebSocket | null>(null);
    const tickDataBuffer = useRef<{ [key: string]: { prices: number[]; times: number[]; } }>({});
    const symbolType = config.symbol.startsWith('1HZ') ? '1HZ' : 'Standard';

    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setLogs(prev => [...prev.slice(-99), logMessage]);
    }, []);

    const scrollToBottom = useCallback(() => {
        if (logsEndRef.current) {
            const logsContainer = logsEndRef.current.parentElement;
            if (logsContainer) {
                const isNearBottom = logsContainer.scrollTop + logsContainer.clientHeight >= logsContainer.scrollHeight - 50;
                if (isNearBottom) {
                    logsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
            }
        }
    }, []);

    useEffect(scrollToBottom, [logs]);

    // John Ehlers' Decycler implementation
    const calculateDecycler = useCallback((prices: number[], alpha: number = 0.07): number[] => {
        if (prices.length < 3) return [];

        const decycler: number[] = [];

        // Initialize first values
        decycler[0] = prices[0];
        decycler[1] = prices[1];

        // Calculate Decycler using Ehler's formula
        for (let i = 2; i < prices.length; i++) {
            const value = (alpha / 2) * (prices[i] + prices[i - 1]) + 
                         (1 - alpha) * decycler[i - 1] - 
                         ((1 - alpha) / 4) * (decycler[i - 1] - decycler[i - 2]);
            decycler[i] = value;
        }

        return decycler;
    }, []);

    // Determine trend from Decycler values
    const getTrend = useCallback((decyclerValues: number[]): 'bullish' | 'bearish' | 'neutral' => {
        if (decyclerValues.length < 3) return 'neutral';

        const current = decyclerValues[decyclerValues.length - 1];
        const previous = decyclerValues[decyclerValues.length - 2];
        const beforePrevious = decyclerValues[decyclerValues.length - 3];

        const shortTrend = current > previous;
        const mediumTrend = previous > beforePrevious;

        if (shortTrend && mediumTrend) return 'bullish';
        if (!shortTrend && !mediumTrend) return 'bearish';
        return 'neutral';
    }, []);

    // Get a day's worth of ticks (86400 seconds)
    const getDayTicks = useCallback(async (symbol: string): Promise<any[]> => {
        try {
            addLog(`📅 Fetching day's worth of ticks for ${symbol} (86400 seconds)...`);

            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog(`🔄 Initializing API connection...`);
                await api_base.init();

                let retries = 0;
                while ((!api_base.api || api_base.api.connection.readyState !== 1) && retries < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries++;
                }
            }

            const dayTickRequest = {
                ticks_history: symbol,
                count: 86400, // One day's worth of ticks
                end: 'latest',
                style: 'ticks',
                req_id: Math.floor(Math.random() * 1000000)
            };

            addLog(`📊 Requesting 86400 ticks for full day analysis...`);

            const dayTickResponse = await Promise.race([
                api_base.api.send(dayTickRequest),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Day tick request timeout')), 30000)
                )
            ]);

            if (dayTickResponse?.history?.prices && dayTickResponse?.history?.times) {
                const prices = dayTickResponse.history.prices.map(p => parseFloat(p)).filter(p => !isNaN(p));
                const times = dayTickResponse.history.times;

                addLog(`✅ Retrieved ${prices.length} ticks for day analysis`);
                return prices.map((price, index) => ({
                    price,
                    time: times[index],
                    timestamp: times[index] * 1000
                }));
            } else {
                addLog(`❌ Failed to get day ticks: ${dayTickResponse?.error?.message || 'Unknown error'}`);
                return [];
            }
        } catch (error) {
            addLog(`❌ Error fetching day ticks: ${error.message}`);
            return [];
        }
    }, [addLog]);

    // Enhanced OHLC data fetching with better error handling
    const fetchOHLCData = useCallback(async (timeframe: string): Promise<any[]> => {
        try {
            // Ensure API connection is ready with multiple attempts
            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog(`🔄 Initializing API connection for ${timeframe} data...`);
                await api_base.init();

                // Wait for connection with extended patience
                let retries = 0;
                while ((!api_base.api || api_base.api.connection.readyState !== 1) && retries < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries++;
                    if (retries % 5 === 0) {
                        addLog(`⏳ Still waiting for API connection... (${retries}/15)`);
                    }
                }

                if (!api_base.api || api_base.api.connection.readyState !== 1) {
                    addLog(`❌ Failed to establish API connection for ${timeframe} data fetch`);
                    return [];
                }
            }

            const granularity = {
                '1m': 60,
                '2m': 120,
                '3m': 180,
                '4m': 240,
                '5m': 300,
                '15m': 900,
                '30m': 1800,
                '1h': 3600,
                '4h': 14400
            }[timeframe] || 60;

            // Enhanced symbol type detection
            const is1HZSymbol = config.symbol.startsWith('1HZ');
            const isVolatilityIndex = config.symbol.startsWith('R_') || config.symbol.includes('V');
            const isCrashBoom = config.symbol.includes('CRASH') || config.symbol.includes('BOOM');

            addLog(`📊 Fetching ${timeframe} data for ${config.symbol} (Type: ${is1HZSymbol ? '1HZ' : isVolatilityIndex ? 'Volatility' : isCrashBoom ? 'CrashBoom' : 'Standard'})`);

            // Strategy 1: Try direct candle request first for most symbols
            if (!is1HZSymbol) {
                try {
                    const candleRequest = {
                        ticks_history: config.symbol,
                        adjust_start_time: 1,
                        count: Math.min(100, Math.max(20, Math.floor(granularity / 60) * 10)),
                        end: 'latest',
                        style: 'candles',
                        granularity: granularity,
                        req_id: Math.floor(Math.random() * 1000000)
                    };

                    addLog(`📡 Requesting ${timeframe} candles: ${candleRequest.count} candles`);

                    const candleResponse = await Promise.race([
                        api_base.api.send(candleRequest),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Candle request timeout')), 10000)
                        )
                    ]);

                    if (candleResponse?.candles && Array.isArray(candleResponse.candles) && candleResponse.candles.length > 0) {
                        const validCandles = candleResponse.candles
                            .filter(candle => candle && 
                                typeof candle.close !== 'undefined' && 
                                !isNaN(parseFloat(candle.close)) &&
                                typeof candle.open !== 'undefined' &&
                                typeof candle.high !== 'undefined' &&
                                typeof candle.low !== 'undefined'
                            )
                            .map(candle => ({
                                open: parseFloat(candle.open),
                                high: parseFloat(candle.high),
                                low: parseFloat(candle.low),
                                close: parseFloat(candle.close),
                                epoch: candle.epoch || candle.time,
                                timeframe: timeframe
                            }));

                        if (validCandles.length > 0) {
                            const lastCandle = validCandles[validCandles.length - 1];
                            addLog(`✅ Got ${validCandles.length} ${timeframe} candles - Latest OHLC: ${lastCandle.open}/${lastCandle.high}/${lastCandle.low}/${lastCandle.close}`);
                            return validCandles;
                        }
                    }

                    if (candleResponse?.error) {
                        addLog(`⚠️ Candle request failed: ${candleResponse.error.message}`);
                    }
                } catch (candleError) {
                    addLog(`⚠️ Candle request exception: ${candleError.message}`);
                }
            }

            // Strategy 2: Fall back to tick data and convert to candles
            const tickCount = is1HZSymbol ? 
                Math.min(granularity * 50, 3000) : // For 1HZ symbols
                Math.min(granularity * 10, 1000);   // For regular symbols

            const tickRequest = {
                ticks_history: config.symbol,
                count: tickCount,
                end: 'latest',
                style: 'ticks',
                req_id: Math.floor(Math.random() * 1000000)
            };

            addLog(`📈 Requesting ${tickCount} ticks for ${timeframe} conversion...`);

            const tickResponse = await Promise.race([
                api_base.api.send(tickRequest),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Tick request timeout')), 12000)
                )
            ]);

            if (tickResponse?.error) {
                const errorCode = tickResponse.error.code || 'Unknown';
                const errorMsg = tickResponse.error.message || 'Unknown API error';
                addLog(`❌ Tick request failed: ${errorMsg} (Code: ${errorCode})`);

                // Log specific error details for debugging
                console.error('API Error Details:', {
                    code: tickResponse.error.code,
                    message: tickResponse.error.message,
                    details: tickResponse.error.details,
                    full_response: tickResponse
                });

                return [];
            }

            if (tickResponse?.history?.prices && tickResponse?.history?.times) {
                const prices = tickResponse.history.prices.map(p => parseFloat(p)).filter(p => !isNaN(p));
                const times = tickResponse.history.times;

                if (prices.length === 0) {
                    addLog(`❌ No valid price data received for ${timeframe}`);
                    return [];
                }

                addLog(`📊 Converting ${prices.length} ticks to ${timeframe} candles...`);

                const candles = convertTicksToCandles(prices, times, granularity);

                if (candles.length > 0) {
                    const lastCandle = candles[candles.length - 1];
                    addLog(`✅ Generated ${candles.length} ${timeframe} candles - Latest OHLC: ${lastCandle.open}/${lastCandle.high}/${lastCandle.low}/${lastCandle.close}`);
                    return candles;
                } else {
                    addLog(`❌ Failed to generate candles from tick data for ${timeframe}`);
                    return [];
                }
            }

            // Strategy 3: Try simplified tick request for 1HZ symbols
            if (is1HZSymbol) {
                const simpleTickRequest = {
                    ticks_history: config.symbol,
                    count: 500, // Smaller count for testing
                    end: 'latest',
                    style: 'ticks',
                    req_id: Math.floor(Math.random() * 1000000)
                };

                addLog(`🔄 Trying simplified tick request for ${timeframe}...`);

                try {
                    const simpleResponse = await Promise.race([
                        api_base.api.send(simpleTickRequest),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Simple request timeout')), 8000)
                        )
                    ]);

                    if (simpleResponse?.error) {
                        addLog(`⚠️ Simple request error: ${simpleResponse.error.message}`);
                    } else if (simpleResponse?.history?.prices) {
                        const prices = simpleResponse.history.prices.map(p => parseFloat(p)).filter(p => !isNaN(p));
                        const times = simpleResponse.history.times || Array.from({length: prices.length}, (_, i) => Date.now()/1000 - (prices.length - i));

                        if (prices.length > 0) {
                            addLog(`📊 Simple request got ${prices.length} tick prices`);
                            const candles = convertTicksToCandles(prices, times, granularity);
                            if (candles.length > 0) {
                                addLog(`✅ Simple request succeeded - Generated ${candles.length} ${timeframe} candles`);
                                return candles;
                            }
                        }
                    }
                } catch (simpleError) {
                    addLog(`❌ Simple request failed: ${simpleError.message}`);
                }
            }

            // Strategy 4: Try very basic historical data request
            const basicRequest = {
                ticks_history: config.symbol,
                count: 100,
                end: 'latest',
                style: 'ticks',
                req_id: Math.floor(Math.random() * 1000000)
            };

            addLog(`🔄 Trying basic historical request for ${timeframe}...`);

            try {
                const basicResponse = await Promise.race([
                    api_base.api.send(basicRequest),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Basic request timeout')), 6000)
                    )
                ]);

                if (basicResponse?.history?.prices) {
                    const prices = basicResponse.history.prices.map(p => parseFloat(p)).filter(p => !isNaN(p));
                    const times = basicResponse.history.times || Array.from({length: prices.length}, (_, i) => Date.now()/1000 - (prices.length - i) * 60);

                    if (prices.length > 0) {
                        const candles = convertTicksToCandles(prices, times, granularity);
                        if (candles.length > 0) {
                            addLog(`✅ Basic request succeeded - Generated ${candles.length} ${timeframe} candles`);
                            return candles;
                        }
                    }
                }
            } catch (basicError) {
                addLog(`❌ Basic request failed: ${basicError.message}`);
            }

            addLog(`❌ All strategies failed for ${timeframe} - no data available`);
            return [];

        } catch (error) {
            let errorMessage = 'Unknown error';

            // Better error parsing
            if (error && typeof error === 'object') {
                if (error.message) {
                    errorMessage = error.message;
                } else if (error.error) {
                    errorMessage = error.error.message || JSON.stringify(error.error);
                } else if (error.code) {
                    errorMessage = `Code ${error.code}: ${error.message || 'API Error'}`;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            addLog(`❌ Exception fetching ${timeframe} data: ${errorMessage}`);
            console.error(`Detailed error for ${timeframe}:`, error);

            // Log the full error object for debugging
            if (typeof error === 'object' && error !== null) {
                console.error(`Full error object:`, JSON.stringify(error, null, 2));
            }

            return [];
        }
    }, [config.symbol, addLog]);

    // Helper function to convert tick data to candles
    const convertTicksToCandles = useCallback((prices: number[], times: number[], granularity: number): any[] => {
        try {
            if (!prices || !times || prices.length !== times.length || prices.length === 0) {
                addLog(`⚠️ Invalid tick data for candle conversion: prices=${prices?.length}, times=${times?.length}`);
                return [];
            }

            addLog(`🔄 Converting ${prices.length} ticks to candles with ${granularity}s granularity...`);

            const candles: any[] = [];
            let currentCandle: any = null;

            for (let i = 0; i < prices.length; i++) {
                const price = parseFloat(prices[i]);
                const time = parseInt(times[i]);

                if (isNaN(price) || isNaN(time) || time <= 0) {
                    continue; // Skip invalid data
                }

                const candleTime = Math.floor(time / granularity) * granularity;

                if (!currentCandle || currentCandle.epoch !== candleTime) {
                    // Start new candle
                    if (currentCandle) {
                        candles.push(currentCandle);
                    }
                    currentCandle = {
                        epoch: candleTime,
                        open: price,
                        high: price,
                        low: price,
                        close: price,
                        tick_count: 1
                    };
                } else {
                    // Update existing candle
                    currentCandle.high = Math.max(currentCandle.high, price);
                    currentCandle.low = Math.min(currentCandle.low, price);
                    currentCandle.close = price;
                    currentCandle.tick_count++;
                }
            }

            // Add the last candle
            if (currentCandle) {
                candles.push(currentCandle);
            }

            const sortedCandles = candles.sort((a, b) => a.epoch - b.epoch);
            addLog(`✅ Successfully converted ${prices.length} ticks to ${sortedCandles.length} candles`);
            return sortedCandles;

        } catch (error) {
            addLog(`❌ Error in convertTicksToCandles: ${error.message}`);
            console.error('convertTicksToCandles error:', error);
            return [];
        }
    }, [addLog]);

    // Analyze all timeframes
    const analyzeAllTimeframes = useCallback(async (): Promise<TrendData[]> => {
        const trends: TrendData[] = [];

        addLog('📊 Starting multi-timeframe analysis...');

        // Process timeframes sequentially to avoid overwhelming the API
        for (const timeframe of timeframes) {
            try {
                addLog(`🔄 Analyzing ${timeframe} timeframe...`);

                const candles = await fetchOHLCData(timeframe);
                if (candles.length === 0) {
                    addLog(`⚠️ No data received for ${timeframe} - skipping`);
                    // Add neutral trend for missing data
                    trends.push({
                        timeframe,
                        trend: 'neutral',
                        value: 0,
                        timestamp: Date.now()
                    });
                    // Update UI immediately for this timeframe
                    setTimeframeAnalysis(prev => ({
                        ...prev,
                        [timeframe]: 'NEUTRAL'
                    }));
                    continue;
                }

                const closePrices = candles.map(candle => parseFloat(candle.close));
                addLog(`📈 Processing ${closePrices.length} prices for ${timeframe}`);

                if (closePrices.length < 3) {
                    addLog(`⚠️ Insufficient data for ${timeframe} (need 3+ prices, got ${closePrices.length})`);
                    trends.push({
                        timeframe,
                        trend: 'neutral',
                        value: 0,
                        timestamp: Date.now()
                    });
                    // Update UI immediately for this timeframe
                    setTimeframeAnalysis(prev => ({
                        ...prev,
                        [timeframe]: 'NEUTRAL'
                    }));
                    continue;
                }

                const decyclerValues = calculateDecycler(closePrices, config.alpha);
                if (decyclerValues.length === 0) {
                    addLog(`⚠️ Failed to calculate Decycler for ${timeframe}`);
                    trends.push({
                        timeframe,
                        trend: 'neutral',
                        value: 0,
                        timestamp: Date.now()
                    });
                    // Update UI immediately for this timeframe
                    setTimeframeAnalysis(prev => ({
                        ...prev,
                        [timeframe]: 'NEUTRAL'
                    }));
                    continue;
                }

                const trend = getTrend(decyclerValues);
                const currentValue = decyclerValues[decyclerValues.length - 1] || 0;

                trends.push({
                    timeframe,
                    trend,
                    value: currentValue,
                    timestamp: Date.now()
                });

                // Update UI immediately for this timeframe
                const trendDisplay = trend === 'bullish' ? 'BULLISH' : trend === 'bearish' ? 'BEARISH' : 'NEUTRAL';
                setTimeframeAnalysis(prev => ({
                    ...prev,
                    [timeframe]: trendDisplay
                }));

                addLog(`✅ ${timeframe}: ${trend.toUpperCase()} (Value: ${currentValue.toFixed(5)})`);

                // Small delay between requests to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (error) {
                addLog(`❌ Error analyzing ${timeframe}: ${error.message}`);
                // Add neutral trend for error cases
                trends.push({
                    timeframe,
                    trend: 'neutral',
                    value: 0,
                    timestamp: Date.now()
                });
                // Update UI immediately for this timeframe
                setTimeframeAnalysis(prev => ({
                    ...prev,
                    [timeframe]: 'NEUTRAL'
                }));
            }
        }

        addLog(`📋 Multi-timeframe analysis complete: ${trends.length}/${timeframes.length} timeframes processed`);

        // Update overall analysis
        const analyses = trends.map(t => t.trend);
        const bullishCount = analyses.filter(a => a === 'bullish').length;
        const bearishCount = analyses.filter(a => a === 'bearish').length;

        if (bullishCount > bearishCount + 1) {
            setOverallAnalysis('BULLISH');
        } else if (bearishCount > bullishCount + 1) {
            setOverallAnalysis('BEARISH');
        } else {
            setOverallAnalysis('NEUTRAL');
        }

        return trends;
    }, [timeframes, fetchOHLCData, calculateDecycler, getTrend, config.alpha, addLog]);

    // Check trend alignment with momentum and reversal detection
    const checkAlignment = useCallback((trends: TrendData[]): 'aligned_bullish' | 'aligned_bearish' | 'mixed' | 'neutral' => {
        addLog(`🔍 DEBUG: checkAlignment called with ${trends.length} trends`);

        if (trends.length === 0) {
            addLog(`⚠️ DEBUG: No trends provided, returning 'neutral'`);
            return 'neutral';
        }

        const bullishCount = trends.filter(t => t.trend === 'bullish').length;
        const bearishCount = trends.filter(t => t.trend === 'bearish').length;
        const neutralCount = trends.filter(t => t.trend === 'neutral').length;

        const totalTrends = trends.length;
        const alignmentThreshold = Math.ceil(totalTrends * 0.8); // Increased to 80% for better quality

        addLog(`📊 DEBUG: Trend counts - Bullish: ${bullishCount}, Bearish: ${bearishCount}, Neutral: ${neutralCount}`);
        addLog(`📏 DEBUG: Alignment threshold (80%): ${alignmentThreshold}/${totalTrends}`);

        // Check for trend momentum by comparing shorter vs longer timeframe trends
        const shortTermTrends = trends.slice(0, Math.ceil(trends.length / 2));
        const longTermTrends = trends.slice(Math.ceil(trends.length / 2));

        const shortBullish = shortTermTrends.filter(t => t.trend === 'bullish').length;
        const longBullish = longTermTrends.filter(t => t.trend === 'bullish').length;

        // Detect potential reversal - if short term contradicts long term, be cautious
        const possibleReversal = (shortBullish / shortTermTrends.length) < 0.3 && (longBullish / longTermTrends.length) > 0.7 ||
                                (shortBullish / shortTermTrends.length) > 0.7 && (longBullish / longTermTrends.length) < 0.3;

        if (possibleReversal) {
            addLog(`⚠️ DEBUG: Potential trend reversal detected - avoiding trade`);
            return 'mixed';
        }

        // Perfect alignment (100%)
        if (bullishCount === totalTrends) {
            addLog(`🟢 DEBUG: Perfect bullish alignment (${bullishCount}/${totalTrends})`);
            return 'aligned_bullish';
        }
        if (bearishCount === totalTrends) {
            addLog(`🔴 DEBUG: Perfect bearish alignment (${bearishCount}/${totalTrends})`);
            return 'aligned_bearish';
        }

        // Strong alignment (80% threshold)
        if (bullishCount > bearishCount && bullishCount >= alignmentThreshold) {
            addLog(`🟢 DEBUG: Strong bullish alignment (${bullishCount}/${totalTrends} >= ${alignmentThreshold})`);
            return 'aligned_bullish';
        }
        if (bearishCount > bullishCount && bearishCount >= alignmentThreshold) {
            addLog(`🔴 DEBUG: Strong bearish alignment (${bearishCount}/${totalTrends} >= ${alignmentThreshold})`);
            return 'aligned_bearish';
        }

        addLog(`🟡 DEBUG: Mixed alignment - no clear direction`);
        return 'mixed';
    }, [addLog]);

        // Enhanced risk management checks
    const checkRiskManagement = useCallback((): boolean => {
        addLog(`🔍 Running risk management checks...`);

        // Check max daily loss
        const dailyLoss = tradeHistory
            .filter(trade => new Date(trade.timestamp).toDateString() === new Date().toDateString())
            .reduce((acc, trade) => acc + trade.profit, 0);

        if (dailyLoss < -config.max_daily_loss) {
            addLog(`❌ Max daily loss exceeded: ${dailyLoss.toFixed(2)} / ${config.max_daily_loss} - Stopping trade`);
            return false;
        }

        // Check max consecutive losses
        const lastTrades = tradeHistory.slice(0, config.max_consecutive_losses);
        const consecutiveLosses = lastTrades.every(trade => !trade.isWin);

        if (consecutiveLosses && lastTrades.length === config.max_consecutive_losses) {
            addLog(`❌ Max consecutive losses reached - Stopping trade`);
            return false;
        }

        addLog(`✅ Risk checks passed`);
        return true;
    }, [tradeHistory, config, addLog]);

    // Validate risk-to-reward ratio
    const validateRiskReward = useCallback((currentPrice: number, direction: 'UP' | 'DOWN'): boolean => {
        const potentialReward = config.take_profit;
        const potentialRisk = Math.abs(config.stop_loss);

        const riskRewardRatio = potentialReward / potentialRisk;
        addLog(`📊 Validating risk/reward ratio: ${riskRewardRatio.toFixed(2)} (Min: ${config.min_risk_reward_ratio})`);

        return riskRewardRatio >= config.min_risk_reward_ratio;
    }, [config.take_profit, config.stop_loss, config.min_risk_reward_ratio, addLog]);

    // Dynamic position sizing
    const calculatePositionSize = useCallback((direction: 'UP' | 'DOWN', trendStrengthScore: number): number => {
        let optimalStake = config.stake;

        switch (config.position_sizing_method) {
            case 'percentage': {
                const calculatedStake = (config.account_balance * (config.risk_per_trade / 100));
                optimalStake = Math.min(calculatedStake, config.stake * 2);
                break;
            }
            case 'kelly': {
                const winProbability = 0.6; // Example: can be based on backtesting
                const payoutRatio = config.take_profit / Math.abs(config.stop_loss);
                const edge = winProbability - (1 / payoutRatio);
                optimalStake = config.account_balance * edge;
                optimalStake = Math.max(config.stake * 0.5, Math.min(optimalStake, config.stake * 2)); // Cap stake
                break;
            }
            case 'adaptive': {
                // Scale stake based on trend strength (example)
                const trendFactor = Math.max(1, trendStrengthScore / config.trend_strength_threshold);
                optimalStake = config.stake * trendFactor;
                break;
            }
            case 'fixed':
            default:
                break;
        }

        return optimalStake;
    }, [config, addLog]);

    // Execute trade using direct contract purchase (OAuth authenticated)
    const executeTrade = useCallback(async (direction: 'UP' | 'DOWN'): Promise<void> => {
        addLog(`🚀 DEBUG: executeTrade called with direction: ${direction}`);

        if (!api_base.api) {
            addLog('❌ DEBUG: API not connected - api_base.api is null/undefined');
            return;
        }

        if (!isAuthorized) {
            addLog('❌ DEBUG: Not authorized for trading - please enter API token and authorize');
            return;
        }

        if (!tradingEnabled) {
            addLog('❌ DEBUG: Auto trading not enabled - please enable auto trading');
            return;
        }

        addLog(`✅ DEBUG: API connection exists, readyState: ${api_base.api.connection?.readyState}`);

        try {
            // Contract type mapping according to Deriv documentation
            let contractType: string;
            let barrier: string | undefined;

            if (config.contract_type === 'multipliers') {
                // Multipliers contracts
                if (direction === 'UP') {
                    contractType = 'MULTUP'; // Multiplier Up
                } else {
                    contractType = 'MULTDOWN'; // Multiplier Down
                }
                addLog(`📊 Using Multipliers contract: ${contractType} with ${config.multiplier}x multiplier`);
            } else if (config.contract_type === 'rise_fall') {
                // Rise/Fall contracts
                if (direction === 'UP') {
                    contractType = 'CALL'; // Rise (strict)
                } else {
                    contractType = 'PUT'; // Fall (strict)
                }
                addLog(`📊 Using Rise/Fall contract: ${contractType} (strict comparison)`);
            } else if (config.contract_type === 'higher_lower') {
                // Higher/Lower contracts with barrier
                if (direction === 'UP') {
                    contractType = 'CALLE'; // Higher (Use CALLE for Higher)
                } else {
                    contractType = 'PUTE'; // Lower (Use PUTE for Lower)
                }

                // For Higher/Lower, we need a proper barrier calculation
                // Get current market price for barrier calculation
                let currentPrice = 0;
                try {
                    // Try to get current price from recent tick data
                    const tickRequest = {
                        ticks: config.symbol,
                        subscribe: 0,
                        req_id: Math.floor(Math.random() * 1000000)
                    };

                    const tickResponse = await Promise.race([
                        api_base.api.send(tickRequest),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Current price timeout')), 3000)
                        )
                    ]);

                    if (tickResponse?.tick?.quote) {
                        currentPrice = parseFloat(tickResponse.tick.quote);
                        addLog(`📈 Current market price: ${currentPrice}`);
                    }
                } catch (error) {
                    addLog(`⚠️ Could not get current price: ${error.message}`);
                    // Use a default small offset if we can't get current price
                    currentPrice = 0;
                }

                // Calculate barrier based on volatility and trend strength
                const trendStrength = trends.filter(t => t.trend === (direction === 'UP' ? 'bullish' : 'bearish')).length / trends.length;

                if (currentPrice > 0) {
                    // Calculate percentage-based barrier for better accuracy
                    const basePercentage = 0.05; // 0.05% base offset
                    const dynamicPercentage = basePercentage * (0.5 + trendStrength);
                    const absoluteOffset = currentPrice * (dynamicPercentage / 100);

                    if (direction === 'UP') {
                        barrier = (currentPrice + absoluteOffset).toFixed(2);
                    } else {
                        barrier = (currentPrice - absoluteOffset).toFixed(2);
                    }
                    addLog(`📊 Using Higher/Lower contract: ${contractType} with absolute barrier: ${barrier} (Current: ${currentPrice})`);
                } else {
                    // Fallback to relative barrier
                    const baseOffset = 0.001;
                    const dynamicOffset = baseOffset * (0.5 + trendStrength);
                    barrier = direction === 'UP' ? `+${dynamicOffset.toFixed(3)}` : `-${dynamicOffset.toFixed(3)}`;
                    addLog(`📊 Using Higher/Lower contract: ${contractType} with relative barrier: ${barrier}`);
                }
            } else {
                // "Allow Equals" option
                if (direction === 'UP') {
                    contractType = 'CALLE'; // Rise (allows equals)
                } else {
                    contractType = 'PUTE'; // Fall (allows equals)
                }
                addLog(`📊 Using Allow Equals contract: ${contractType} (allows equal exit spot)`);
            }

            addLog(`🎯 Executing ${direction} trade: ${contractType} on ${config.symbol}`);
            addLog(`💰 Stake: $${config.stake} | Ticks: ${config.tick_count}`);
            if (barrier) {
                addLog(`🎯 Barrier: ${barrier}`);
            }

            // First, let's try a proposal to validate the parameters
            addLog(`🔍 DEBUG: Creating proposal first to validate parameters...`);
            const proposalRequest: any = {
                proposal: 1,
                contract_type: contractType,
                currency: 'USD',
                symbol: config.symbol,
                amount: config.stake,
                basis: 'stake',
                req_id: Math.floor(Math.random() * 1000000)
            };

            // Configure contract parameters based on type
            if (config.contract_type === 'multipliers') {
                // Multipliers contracts
                proposalRequest.multiplier = config.multiplier;

                // Add limit orders (take profit/stop loss)
                const limitOrder: any = {};
                if (config.take_profit > 0) {
                    limitOrder.take_profit = config.take_profit;
                }
                if (config.stop_loss < 0) {
                    limitOrder.stop_loss = Math.abs(config.stop_loss);
                }
                if (Object.keys(limitOrder).length > 0) {
                    proposalRequest.limit_order = limitOrder;
                    addLog(`🎯 DEBUG: Adding limit orders: ${JSON.stringify(limitOrder)}`);
                }

                // Add deal cancellation if enabled
                if (config.use_deal_cancellation && config.deal_cancellation) {
                    proposalRequest.cancellation = config.deal_cancellation;
                    addLog(`🎯 DEBUG: Adding deal cancellation: ${config.deal_cancellation}`);
                }

                addLog(`🎯 DEBUG: Multipliers proposal with ${config.multiplier}x multiplier`);
            } else {
                // Binary options contracts - use duration
                proposalRequest.duration = config.tick_count;
                proposalRequest.duration_unit = 't';

                // Add barrier for Higher/Lower contracts
                if (barrier && config.contract_type === 'higher_lower') {
                    // For Higher/Lower contracts, use barrier field
                    if (barrier.startsWith('+') || barrier.startsWith('-')) {
                        // Relative barrier
                        proposalRequest.barrier = barrier;
                    } else {
                        // Absolute barrier
                        proposalRequest.barrier = barrier;
                    }
                    addLog(`🎯 DEBUG: Adding barrier to proposal: ${barrier}`);
                }
            }

            addLog(`📋 DEBUG: Proposal request: ${JSON.stringify(proposalRequest, null, 2)}`);

            const proposalResponse = await Promise.race([
                api_base.api.send(proposalRequest),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Proposal timeout')), 10000)
                )
            ]).catch(error => {
                addLog(`❌ DEBUG: Proposal request failed: ${error.message}`);
                return { error: { message: error.message, code: 'RequestFailed' } };
            });

            addLog(`📨 DEBUG: Proposal response: ${JSON.stringify(proposalResponse, null, 2)}`);

            if (proposalResponse?.error) {
                addLog(`❌ DEBUG: Proposal failed: ${proposalResponse.error.message} (Code: ${proposalResponse.error.code})`);

                // Detailed error analysis
                if (proposalResponse.error.code === 'AuthorizationRequired') {
                    addLog(`🔑 DEBUG: Authorization required - user needs to login with trading permissions`);
                } else if (proposalResponse.error.code === 'InvalidSymbol') {
                    addLog(`📋 DEBUG: Invalid symbol: ${config.symbol}`);
                } else if (proposalResponse.error.code === 'InvalidContractType') {
                    addLog(`📋 DEBUG: Invalid contract type: ${contractType}`);
                } else if (proposalResponse.error.code === 'InvalidDuration') {
                    addLog(`📋 DEBUG: Invalid duration: ${config.tick_count} ticks`);
                } else if (proposalResponse.error.code === 'InvalidAmount') {
                    addLog(`📋 DEBUG: Invalid amount: $${config.stake}`);
                } else if (proposalResponse.error.code === 'InvalidBarrier') {
                    addLog(`📋 DEBUG: Invalid barrier: ${barrier} for contract type: ${contractType}`);
                    // Try without barrier as fallback for Higher/Lower
                    if (config.contract_type === 'higher_lower') {
                        addLog(`🔄 DEBUG: Retrying Higher/Lower without barrier...`);
                        delete proposalRequest.barrier;

                        const retryResponse = await Promise.race([
                            api_base.api.send(proposalRequest),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Retry proposal timeout')), 10000)
                            )
                        ]);

                        if (retryResponse?.error) {
                            addLog(`❌ DEBUG: Retry also failed: ${retryResponse.error.message}`);
                            return;
                        } else {
                            addLog(`✅ DEBUG: Retry successful without barrier`);
                            // Continue with the retry response
                            Object.assign(proposalResponse, retryResponse);
                        }
                    } else {
                        return;
                    }
                } else {
                    addLog(`📋 DEBUG: Unknown error: ${proposalResponse.error.message || 'Unknown proposal error'}`);
                    return;
                }
            }

            if (!proposalResponse?.proposal?.id) {
                addLog(`❌ DEBUG: Proposal response missing or invalid: ${JSON.stringify(proposalResponse)}`);
                return;
            }

            const proposalId = proposalResponse.proposal.id;
            const proposalPrice = proposalResponse.proposal.display_value;
            addLog(`✅ DEBUG: Proposal successful - ID: ${proposalId}, Price: ${proposalPrice}`);

            // Now purchase the contract using the proposal ID
            const buyRequest = {
                buy: proposalId,
                price: config.stake,
                req_id: Math.floor(Math.random() * 1000000)
            };

            addLog(`🔄 DEBUG: Purchasing contract with proposal ID: ${proposalId}`);
            addLog(`📋 DEBUG: Buy request: ${JSON.stringify(buyRequest, null, 2)}`);

            const buyResponse = await Promise.race([
                api_base.api.send(buyRequest),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Purchase timeout')), 15000)
                )
            ]).catch(error => {
                addLog(`❌ DEBUG: Buy request failed: ${error.message}`);
                return { error: { message: error.message, code: 'RequestFailed' } };
            });

            addLog(`📨 DEBUG: Buy response: ${JSON.stringify(buyResponse, null, 2)}`);

            if (buyResponse?.error) {
                addLog(`❌ DEBUG: Purchase error: ${buyResponse.error.message} (Code: ${buyResponse.error.code})`);

                // Log specific error details for debugging
                if (buyResponse.error.code === 'AuthorizationRequired') {
                    addLog(`🔑 DEBUG: Authentication required during purchase`);
                } else if (buyResponse.error.code === 'InsufficientBalance') {
                    addLog(`💰 DEBUG: Insufficient balance for purchase`);
                } else if (buyResponse.error.code === 'InvalidProposal') {
                    addLog(`📋 DEBUG: Invalid or expired proposal ID: ${proposalId}`);
                } else if (buyResponse.error.code === 'MarketIsClosed') {
                    addLog(`🏪 DEBUG: Market is closed for ${config.symbol}`);
                } else {
                    addLog(`📋 DEBUG: Purchase error details: ${JSON.stringify(buyResponse.error)}`);
                }
                return;
            }

            if (!buyResponse?.buy) {
                addLog(`❌ DEBUG: Buy response missing 'buy' object: ${JSON.stringify(buyResponse)}`);
                return;
            }

            if (!buyResponse.buy.contract_id) {
                addLog(`❌ DEBUG: Buy response missing contract_id: ${JSON.stringify(buyResponse.buy)}`);
                return;
            }

            const contractId = buyResponse.buy.contract_id;
            const buyPrice = buyResponse.buy.buy_price || proposalPrice;
            const balanceAfter = buyResponse.buy.balance_after;
            const transactionId = buyResponse.buy.transaction_id;
            const payout = buyResponse.buy.payout;
            const startTime = buyResponse.buy.start_time;

            addLog(`✅ DEBUG: Contract purchased successfully!`);
            addLog(`📊 DEBUG: Contract ID: ${contractId}`);
            addLog(`🆔 DEBUG: Transaction ID: ${transactionId}`);
            addLog(`💰 DEBUG: Buy Price: $${buyPrice}`);
            addLog(`🎯 DEBUG: Expected Payout: $${payout}`);
            addLog(`💳 DEBUG: Balance After: $${balanceAfter}`);
            addLog(`⏰ DEBUG: Start Time: ${startTime ? new Date(startTime * 1000).toLocaleTimeString() : 'N/A'}`);

            // Update contract info
            const newContract: ContractInfo = {
                id: contractId.toString(),
                type: contractType,
                entry_price: buyPrice || config.stake,
                current_price: buyPrice || config.stake,
                profit: 0,
                status: 'open',
                entry_time: startTime ? startTime * 1000 : Date.now(),
                direction,
                stop_loss: (buyPrice || config.stake) + config.stop_loss,
                take_profit: (buyPrice || config.stake) + config.take_profit,
                trailing_stop: config.use_trailing_stop ? (buyPrice || config.stake) + config.stop_loss : 0,
                breakeven_active: false
            };

            setBotStatus(prev => ({
                ...prev,
                current_contract: newContract,
                total_trades: prev.total_trades + 1
            }));

            addLog(`📈 DEBUG: Contract info updated in state`);

            // Start monitoring the contract
            addLog(`👁️ DEBUG: Starting contract monitoring for ID: ${contractId}`);
            monitorContract(contractId.toString());

        } catch (error) {
            addLog(`💥 DEBUG: Trade execution exception: ${error.message}`);
            addLog(`🔍 DEBUG: Error stack: ${error.stack}`);
            console.error('Trade execution error:', error);
        }
    }, [api_base.api, config, addLog]);

    // Monitor contract status with proper take profit/stop loss enforcement
    const monitorContract = useCallback(async (contractId: string): Promise<void> => {
        if (!api_base.api) return;

        try {
            const request = {
                proposal_open_contract: 1,
                contract_id: parseInt(contractId),
                subscribe: 1,
                req_id: Math.floor(Math.random() * 1000000)
            };

            addLog(`👁️ Starting to monitor contract ${contractId} with TP: $${config.take_profit}, SL: $${config.stop_loss}...`);

            const response = await api_base.api.send(request);

            if (response.error) {
                addLog(`❌ Contract monitoring error: ${response.error.message}`);
                return;
            }

            addLog(`✅ Contract monitoring established for ${contractId}`);

            // Set up subscription for contract updates
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                    const contract = data.proposal_open_contract;

                    if (contract.contract_id.toString() === contractId) {
                        const currentProfit = parseFloat(contract.profit || '0');
                        const currentSpot = contract.current_spot;
                        const isSold = contract.is_sold === 1;
                        const canSell = contract.is_sellable === 1;

                        // Check if we should manually close the contract based on our TP/SL levels
                        let shouldSell = false;
                        let sellReason = '';

                        if (!isSold && canSell) {
                            // Check take profit
                            if (currentProfit >= config.take_profit) {
                                shouldSell = true;
                                sellReason = `Take Profit reached: $${currentProfit.toFixed(2)} >= $${config.take_profit}`;
                            }
                            // Check stop loss
                            else if (currentProfit <= config.stop_loss) {
                                shouldSell = true;
                                sellReason = `Stop Loss reached: $${currentProfit.toFixed(2)} <= $${config.stop_loss}`;
                            }

                            // Execute manual sell if needed
                            if (shouldSell) {
                                addLog(`🛑 ${sellReason} - Selling contract manually...`);

                                // Send sell request
                                const sellRequest = {
                                    sell: parseInt(contractId),
                                    price: contract.bid_price || contract.payout,
                                    req_id: Math.floor(Math.random() * 1000000)
                                };

                                api_base.api.send(sellRequest).then(sellResponse => {
                                    if (sellResponse.error) {
                                        addLog(`❌ Manual sell failed: ${sellResponse.error.message}`);
                                    } else {
                                        addLog(`✅ Contract sold manually at $${currentProfit.toFixed(2)} profit`);
                                    }
                                }).catch(error => {
                                    addLog(`❌ Manual sell error: ${error.message}`);
                                });

                                return; // Exit early, let the sell response handle the rest
                            }
                        }

                        // Update current contract status
                        setBotStatus(prev => {
                            if (!prev.current_contract || prev.current_contract.id !== contractId) {
                                return prev;
                            }

                            const updatedContract: ContractInfo = {
                                ...prev.current_contract,
                                current_price: currentSpot || prev.current_contract.current_price,
                                profit: currentProfit,
                                status: isSold ? 'closed' : 'open'
                            };

                            return {
                                ...prev,
                                current_contract: updatedContract
                            };
                        });

                        // Log current status with TP/SL monitoring
                        if (currentSpot && !isSold) {
                            const tpDistance = config.take_profit - currentProfit;
                            const slDistance = currentProfit - config.stop_loss;
                            addLog(`📈 Contract ${contractId}: P&L $${currentProfit.toFixed(2)} | TP: ${tpDistance > 0 ? '+' : ''}${tpDistance.toFixed(2)} | SL: ${slDistance > 0 ? '+' : ''}${slDistance.toFixed(2)}`);
                        }

                        // Handle contract closure (natural expiry or manual sell)
                        if (isSold) {
                            const isWin = currentProfit > 0;
                            const sellPrice = contract.sell_price || 0;
                            const closingReason = contract.sell_time ? 'Manual Sell' : 'Natural Expiry';

                            addLog(`${isWin ? '🎉 WIN' : '💔 LOSS'}: Contract ${contractId} closed (${closingReason})`);
                            addLog(`💰 Final P&L: $${currentProfit.toFixed(2)}`);
                            addLog(`💵 Sell Price: $${sellPrice}`);

                            // Check if our TP/SL system worked
                            if (currentProfit >= config.take_profit) {
                                addLog(`✅ Take profit target achieved: $${config.take_profit}`);
                            } else if (currentProfit <= config.stop_loss) {
                                addLog(`🛑 Stop loss triggered: $${config.stop_loss}`);
                            }

                            // Update performance metrics
                            setBotStatus(prev => {
                                const newWinningTrades = isWin ? prev.winning_trades + 1 : prev.winning_trades;
                                const newTotalPnL = prev.total_pnl + currentProfit;

                                return {
                                    ...prev,
                                    current_contract: null,
                                    winning_trades: newWinningTrades,
                                    total_pnl: newTotalPnL
                                };
                            });

                            // Add to trade history
                            setTradeHistory(prev => [{
                                id: contractId,
                                type: botStatus.current_contract?.type || 'UNKNOWN',
                                direction: botStatus.current_contract?.direction || 'UP',
                                stake: config.stake,
                                profit: currentProfit,
                                isWin,
                                timestamp: Date.now()
                            }, ...prev.slice(0, 19)]); // Keep last 20 trades

                            // Adaptive stake sizing for next trade based on recent performance
                            const recentTrades = tradeHistory.slice(-5); // Last 5 trades
                            if (recentTrades.length > 0) {
                                const recentWinRate = recentTrades.filter(t => t.isWin).length / recentTrades.length;

                                if (recentWinRate < 0.3) {
                                    const newStake = Math.max(config.stake * 0.7, 0.35);
                                    addLog(`📉 Poor recent performance (${(recentWinRate * 100).toFixed(1)}%) - Consider reducing stake to $${newStake.toFixed(2)}`);
                                } else if (recentWinRate > 0.7) {
                                    const newStake = Math.min(config.stake * 1.2, config.stake * 2);
                                    addLog(`📈 Good recent performance (${(recentWinRate * 100).toFixed(1)}%) - Could increase stake to $${newStake.toFixed(2)}`);
                                }
                            }

                            // Unsubscribe from this contract
                            subscription.unsubscribe();
                            addLog(`📡 Stopped monitoring contract ${contractId}`);
                        }
                    }
                }
            });

        } catch (error) {
            addLog(`❌ Failed to monitor contract: ${error.message}`);
        }
    }, [config.stake, config.take_profit, config.stop_loss, addLog, botStatus.current_contract, tradeHistory]);

    // Execute trade


    // Monitor open contract


    // Main trading loop
    const tradingLoop = useCallback(async (): Promise<void> => {
        addLog(`🔍 DEBUG: tradingLoop called - bot running (state): ${botStatus.is_running}, (ref): ${isRunningRef.current}`);

        if (!isRunningRef.current) {
            addLog(`⏹️ DEBUG: Bot not running (ref check), exiting trading loop`);
            return;
        }

        try {
            addLog('🔄 Starting trading analysis cycle...');

            // Analyze all timeframes
            const trends = await analyzeAllTimeframes();
            addLog(`📊 DEBUG: Analyzed ${trends.length} timeframes`);

            if (trends.length === 0) {
                addLog('⚠️ No trend data available - will retry next cycle');
                setBotStatus(prev => ({
                    ...prev,
                    error_message: 'No trend data available',
                    last_update: Date.now()
                }));
                return;
            }

            const alignment = checkAlignment(trends);
            addLog(`🎯 DEBUG: Alignment result: ${alignment}`);

            // Update bot status with new analysis
            setBotStatus(prev => ({
                ...prev,
                trends,
                alignment_status: alignment,
                last_update: Date.now(),
                error_message: ''
            }));

            addLog(`📊 Analysis complete - Alignment: ${alignment.toUpperCase()}`);

            // Log individual timeframe results
            const bullishCount = trends.filter(t => t.trend === 'bullish').length;
            const bearishCount = trends.filter(t => t.trend === 'bearish').length;
            const neutralCount = trends.filter(t => t.trend === 'neutral').length;

            addLog(`📈 Trends: ${bullishCount} Bullish, ${bearishCount} Bearish, ${neutralCount} Neutral`);

            // Detailed trend breakdown
            trends.forEach(trend => {
                addLog(`📊 DEBUG: ${trend.timeframe}: ${trend.trend.toUpperCase()} (value: ${trend.value.toFixed(5)})`);
            });

            // Check current contract status
            addLog(`🔍 DEBUG: Current contract status: ${botStatus.current_contract ? 'ACTIVE' : 'NONE'}`);

            // Check trading conditions
            const hasStrongAlignment = alignment === 'aligned_bullish' || alignment === 'aligned_bearish';
            addLog(`🎯 DEBUG: Strong alignment detected: ${hasStrongAlignment}`);
            addLog(`📋 DEBUG: No current contract: ${!botStatus.current_contract}`);

            // Additional market condition checks
            const currentTime = new Date();
            const hour = currentTime.getHours();
            const minute = currentTime.getMinutes();

            // Allow 24/7 trading for synthetic indices
            const isHighVolatilityTime = true; // Always allow trading for synthetic indices

            // Check recent trend consistency
            const recentTrends = trends.slice(-3); // Last 3 timeframes
            const trendConsistency = recentTrends.every(t => 
                (alignment === 'aligned_bullish' && t.trend === 'bullish') ||
                (alignment === 'aligned_bearish' && t.trend === 'bearish')
            );

            // Check if we should enter a trade
            if (!botStatus.current_contract && hasStrongAlignment && isHighVolatilityTime && trendConsistency) {

                // Check authorization before attempting trade
                if (!isAuthorized) {
                    addLog(`❌ Trading signal detected but not authorized - please enter API token and authorize`);
                    return;
                }

                if (!tradingEnabled) {
                    addLog(`❌ Trading signal detected but auto trading disabled - please enable auto trading`);
                    return;
                }

                const direction = alignment === 'aligned_bullish' ? 'UP' : 'DOWN';

                // Calculate trend strength score
                const trendStrengthScore = trends.filter(t => t.trend === (direction === 'UP' ? 'bullish' : 'bearish')).length / trends.length;

                // Enhanced pre-trade validation
                addLog(`🎯 Strong ${direction} alignment detected - Running enhanced risk checks...`);

                // Check risk management rules
                if (!checkRiskManagement()) {
                    addLog(`❌ Risk management check failed - skipping trade`);
                    return;
                }

                // Validate risk-to-reward ratio
                if (!validateRiskReward(currentPrice || 0, direction)) {
                    addLog(`❌ Risk/Reward ratio below minimum threshold of ${config.min_risk_reward_ratio}:1 - skipping trade`);
                    return;
                }

                // Calculate optimal position size
                const optimalStake = calculatePositionSize(direction, trendStrengthScore);
                addLog(`💰 Calculated optimal position size: $${optimalStake.toFixed(2)} (Base: $${config.stake})`);

                // Temporarily update stake for this trade
                const originalStake = config.stake;
                setConfig(prev => ({ ...prev, stake: optimalStake }));

                addLog(`🚀 All risk checks passed - Executing ${direction} trade with $${optimalStake.toFixed(2)} stake`);

                try {
                    await executeTrade(direction);

                    // Update daily trade count
                    setDailyTradeCount(prev => prev + 1);

                } finally {
                    // Restore original stake
                    setConfig(prev => ({ ...prev, stake: originalStake }));
                }

                addLog(`🚀 DEBUG: Trade conditions met - Direction: ${direction}`);
                addLog(`⏰ DEBUG: High volatility time: ${isHighVolatilityTime}, Trend consistency: ${trendConsistency}`);

                // Optional 10s confirmation with re-analysis
                if (config.use_10s_filter) {
                    addLog('⏱️ DEBUG: Applying 10-second confirmation filter...');
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Re-analyze shorter timeframes for confirmation
                    const quickAnalysis = await analyzeAllTimeframes();
                    const quickAlignment = checkAlignment(quickAnalysis);

                    if (quickAlignment !== alignment) {
                        addLog('❌ DEBUG: Confirmation failed - trend changed during filter');
                        return;
                    }
                    addLog('✅ DEBUG: Confirmation filter passed');
                }

                addLog(`🎯 Strong ${direction} alignment detected - Preparing trade execution!`);
                addLog(`💰 DEBUG: About to call executeTrade with direction: ${direction}`);

                await executeTrade(direction);

                addLog(`✅ DEBUG: executeTrade call completed`);
            } else if (!botStatus.current_contract) {
                if (!hasStrongAlignment) {
                    addLog(`⏳ DEBUG: No strong alignment - Current: ${alignment}`);
                }
                if (!isHighVolatilityTime) {
                    addLog(`⏳ DEBUG: Low volatility time period (${hour}:${minute})`);
                }
                if (!trendConsistency) {
                    addLog(`⏳ DEBUG: Trend inconsistency detected in recent timeframes`);
                }
                addLog(`⏳ DEBUG: No trade conditions met:`);
                addLog(`   - Current contract: ${botStatus.current_contract ? 'EXISTS' : 'NONE'}`);
                addLog(`   - Alignment: ${alignment}`);
                addLog(`   - Strong alignment: ${hasStrongAlignment}`);
                addLog('⏳ Waiting for trend alignment - No trade signal yet');
            } else {
                addLog('📊 Active contract in progress - Monitoring...');
                addLog(`   - Contract ID: ${botStatus.current_contract?.id}`);
                addLog(`   - Contract Status: ${botStatus.current_contract?.status}`);
            }

        } catch (error) {
            const errorMsg = `Trading analysis error: ${error.message}`;
            addLog(`❌ DEBUG: Trading loop exception: ${errorMsg}`);
            addLog(`🔍 DEBUG: Error stack: ${error.stack}`);
            setBotStatus(prev => ({
                ...prev,
                error_message: errorMsg,
                last_update: Date.now()
            }));
        }
    }, [botStatus.is_running, botStatus.current_contract, analyzeAllTimeframes, checkAlignment, config.use_10s_filter, executeTrade, addLog]);

    // Start bot
    const startBot = useCallback(async (): Promise<void> => {
        try {
            addLog('🔄 Starting Decycler Bot...');

            // Initialize API connection
            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog('🔌 Connecting to Deriv API...');
                await api_base.init();

                // Wait for connection to be ready
                let retries = 0;
                while ((!api_base.api || api_base.api.connection.readyState !== 1) && retries < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries++;
                    const readyState = api_base.api?.connection?.readyState || 'undefined';
                    addLog(`⏳ Waiting for WebSocket connection... (${retries}/15) - State: ${readyState}`);
                }

                if (!api_base.api || api_base.api.connection.readyState !== 1) {
                    addLog('❌ Failed to establish WebSocket connection. Please check your internet connection and try again.');
                    return;
                }
            }

            // Check connection status
            const connectionStatus = api_base.getConnectionStatus();
            addLog(`📡 Connection Status: ${connectionStatus}`);

            // Check if WebSocket is actually ready
            const isReady = api_base.api?.connection?.readyState === 1;
            addLog(`🔌 WebSocket Ready State: ${api_base.api?.connection?.readyState} (${isReady ? 'OPEN' : 'NOT READY'})`);

            if (!isReady) {
                addLog('❌ WebSocket connection not ready. Please wait and try again.');
                return;
            }

            addLog('🔧 DEBUG: Setting bot status to running...');
            isRunningRef.current = true;
            setBotStatus(prev => ({ ...prev, is_running: true }));

            addLog('🚀 Decycler Multi-Timeframe Bot Started!');
            addLog(`📊 Monitoring ${timeframes.join(', ')} timeframes`);
            addLog(`🎯 Symbol: ${config.symbol} | Stake: $${config.stake}`);
            if (config.contract_type === 'multipliers') {
                addLog(`⚙️ Contract Type: MULTIPLIERS (${config.multiplier}x)`);
                if (config.use_deal_cancellation) {
                    addLog(`🛡️ Deal Cancellation: ${config.deal_cancellation}`);
                }
            } else {
                addLog(`⚙️ Contract Type: ${config.contract_type.toUpperCase()}`);
            }
            addLog(`🔧 DEBUG: isRunningRef.current set to: ${isRunningRef.current}`);

            // Start trading loop
            intervalRef.current = setInterval(tradingLoop, config.monitor_interval * 1000);

            // Run initial analysis
            await tradingLoop();
        } catch (error) {
            addLog(`❌ Error starting bot: ${error.message}`);
        }
    }, [config, timeframes, tradingLoop, addLog, botStatus.is_running]);

        // Stop bot
    const stopBot = useCallback((): void => {
        addLog('🔧 DEBUG: Stopping bot...');
        isRunningRef.current = false;
        setBotStatus(prev => ({ ...prev, is_running: false }));

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            addLog('🔧 DEBUG: Trading interval cleared');
        }

        if (monitorRef.current) {
            clearInterval(monitorRef.current);
            monitorRef.current = null;
            addLog('🔧 DEBUG: Monitor interval cleared');
        }

        addLog('⏹️ Decycler Bot Stopped');
    }, [addLog]);

    // Handle contract updates from API
    useEffect(() => {
        const handleApiResponse = (response: any) => {
            if (response && response.proposal_open_contract) {
                const contract = response.proposal_open_contract;

                setBotStatus(prev => {
                    if (!prev.current_contract || prev.current_contract.id !== contract.contract_id) {
                        return prev;
                    }

                    const updatedContract: ContractInfo = {
                        ...prev.current_contract,
                        current_price: contract.current_spot || prev.current_contract.current_price,
                        profit: contract.profit || 0,
                        status: contract.is_sold ? 'closed' : 'open'
                    };

                    // Handle risk management
                    if (config.use_trailing_stop && contract.profit > 0) {
                        const newTrailingStop = prev.current_contract.entry_price + contract.profit - config.trailing_step;
                        if (newTrailingStop > updatedContract.trailing_stop) {
                            updatedContract.trailing_stop = newTrailingStop;
                            addLog(`📈 Trailing stop updated to ${newTrailingStop.toFixed(5)}`);
                        }
                    }

                    // Handle breakeven
                    if (config.use_breakeven && !updatedContract.breakeven_active && contract.profit >= config.breakeven_trigger) {
                        updatedContract.stop_loss = prev.current_contract.entry_price;
                        updatedContract.breakeven_active = true;
                        addLog(`⚖️ Breakeven protection activated`);
                    }

                    // Check if contract closed
                    if (contract.is_sold) {
                        const isWin = contract.profit > 0;
                        addLog(`${isWin ? '🎉' : '💔'} Contract closed: ${isWin ? 'WIN' : 'LOSS'} - P&L: ${contract.profit.toFixed(2)}`);

                        return {
                            ...prev,
                            current_contract: null,
                            winning_trades: isWin ? prev.winning_trades + 1 : prev.winning_trades,
                            total_pnl: prev.total_pnl + contract.profit
                        };
                    }

                    return {
                        ...prev,
                        current_contract: updatedContract
                    };
                });
            }
        };

        // Listen for API responses
        if (typeof window !== 'undefined' && (window as any).globalObserver) {
            const globalObserver = (window as any).globalObserver;
            globalObserver.register('api.response', handleApiResponse);

            return () => {
                globalObserver.unregister('api.response', handleApiResponse);
            };
        }
    }, [config, addLog]);

    // Comprehensive API connection and data testing
    const testConnection = useCallback(async (): Promise<void> => {
        try {
            addLog('🔍 Starting comprehensive API connection test...');

            // Step 1: Test WebSocket connection
            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog('🔌 Initializing API connection...');
                await api_base.init();

                let retries = 0;
                while ((!api_base.api || api_base.api.connection.readyState !== 1) && retries < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries++;
                    if (retries % 3 === 0) {
                        addLog(`⏳ Waiting for connection... (${retries}/15)`);
                    }
                }
            }

            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog('❌ Failed to establish WebSocket connection');
                return;
            }

            addLog(`✅ WebSocket connected (Ready State: ${api_base.api.connection.readyState})`);

            // Step 2: Test basic API communication
            const timeResponse = await Promise.race([
                api_base.api.send({ time: 1 }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Time request timeout')), 5000))
            ]);

            if (timeResponse?.time) {
                addLog(`✅ API communication test successful. Server time: ${new Date(timeResponse.time * 1000).toLocaleString()}`);
            } else {
                addLog('❌ API communication test failed - no server time received');
                return;
            }

            // Step3: Test symbol existence
            addLog(`🔍 Testing symbol availability: ${config.symbol}`);

        try {
                const symbolTest = await Promise.race([
                    api_base.api.send({ 
                        active_symbols: 'brief',
                        product_type: 'basic'
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Symbol test timeout')), 8000))
                ]);

                if (symbolTest?.active_symbols) {
                    const symbolExists = symbolTest.active_symbols.some(s => s.symbol === config.symbol);
                    if (symbolExists) {
                        addLog(`✅ Symbol ${config.symbol} is available for trading`);
                    } else {
                        addLog(`⚠️ Symbol ${config.symbol} not found in active symbols list`);
                    }
                }
            } catch (symbolError) {
                addLog(`⚠️ Could not verify symbol availability: ${symbolError.message}`);
            }

            // Step 4: Test data retrieval for each timeframe
            addLog('📊 Testing data retrieval for all timeframes...');

            const testResults = {};
            for (const tf of timeframes) {
                try {
                    addLog(`🔄 Testing ${tf} data...`);
                    const testData = await fetchOHLCData(tf);
                    testResults[tf] = testData.length;

                    if (testData.length > 0) {
                        addLog(`✅ ${tf}: ${testData.length} data points retrieved`);
                    } else {
                        addLog(`❌ ${tf}: No data retrieved`);
                    }

                    // Small delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (tfError) {
                    addLog(`❌ ${tf}: Error - ${tfError.message}`);
                    testResults[tf] = 0;
                }
            }

            // Step 5: Summary
            const successfulTimeframes = Object.values(testResults).filter(count => count > 0).length;
            const totalTimeframes = timeframes.length;

            addLog(`📋 Test Summary: ${successfulTimeframes}/${totalTimeframes} timeframes working`);

            if (successfulTimeframes === 0) {
                addLog('❌ No timeframes working - try a different symbol or check API connection');
            } else if (successfulTimeframes < totalTimeframes) {
                addLog(`⚠️ Partial success - ${totalTimeframes - successfulTimeframes} timeframes failed`);
            } else {
                addLog('🎉 All timeframes working perfectly!');

                // If test was successful, run the analysis to populate the UI
                if (successfulTimeframes > 0) {
                    addLog('🔄 Running multi-timeframe analysis...');
                    await analyzeAllTimeframes();
                }
            }

        } catch (error) {
            addLog(`❌ Connection test failed: ${error.message}`);
            console.error('Detailed connection test error:', error);
        }
    }, [fetchOHLCData, config.symbol, addLog, timeframes]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (monitorRef.current) clearInterval(monitorRef.current);
        };
    }, []);

    const getTrendColor = (trend: string): string => {
        switch (trend) {
            case 'bullish': return '#00ff88';
            case 'bearish': return '#ff4757';
            default: return '#ffa502';
        }
    };

    const getAlignmentColor = (alignment: string): string => {
        switch (alignment) {
            case 'aligned_bullish': return '#00ff88';
            case 'aligned_bearish': return '#ff4757';
            case 'mixed': return '#ffa502';
            default: return '#74b9ff';
        }
    };

    // Define WebSocket and currentSymbol
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [currentSymbol, setCurrentSymbol] = useState(config.symbol);
    const [timeframeAnalysis, setTimeframeAnalysis] = useState<{ [key: string]: string }>({});
    const [overallAnalysis, setOverallAnalysis] = useState('NEUTRAL');
  const [barrier, setBarrier] = useState('');
  const [duration, setDuration] = useState(1);
  const [durationType, setDurationType] = useState('t');

    useEffect(() => {
        setCurrentSymbol(config.symbol); // Update currentSymbol when config.symbol changes
    }, [config.symbol]);

    // Establish WebSocket connection on component mount
  const authorizeAPI = async (token: string) => {
    try {
      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');

      return new Promise((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({
            authorize: token,
            req_id: Date.now()
          }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.authorize) {
            setIsAuthorized(true);
            setAuthToken(token);
            ws.close();
            resolve(data);
          } else if (data.error) {
            ws.close();
            reject(data.error);
          }
        };

        ws.onerror = (error) => {
          ws.close();
          reject(error);
        };
      });
    } catch (error) {
      console.error('Authorization failed:', error);
      throw error;
    }
  };

  // Contract Purchase Function
  const purchaseContract = async (direction: 'CALL' | 'PUT' | 'CALLE' | 'PUTE') => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            addLog('❌ WebSocket not connected');
            return;
        }

        try {
            // Get proposal first
            const proposal = await sendProposal(contractType);
            if (!proposal?.id) {
                addLog('❌ Failed to get proposal');
                return;
            }

            // Purchase contract using authenticated connection with app ID 75771
            const buyRequest = {
                buy: proposal.id,
                price: config.stake,
                app_id: 75771 // Use authenticated app ID
            };

            addLog(`🔄 Purchasing ${contractType} contract for ${config.stake} USD...`);
            addLog(`📋 Contract ID: ${proposal.id}`);

            const response = await new Promise((resolve, reject) => {
                const requestId = `buy_${Date.now()}`;

                const messageHandler = (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.req_id === requestId) {
                        ws.removeEventListener('message', messageHandler);
                        if (data.error) {
                            addLog(`❌ Purchase error: ${data.error.message}`);
                            reject(new Error(data.error.message));
                        } else {
                            const contractId = data.buy?.contract_id;
                            const buyPrice = data.buy?.buy_price;
                            addLog(`✅ Contract purchased: ID ${contractId}, Price: ${buyPrice}`);
                            resolve(data);
                        }
                    }
                };

                ws.addEventListener('message', messageHandler);
                ws.send(JSON.stringify({ ...buyRequest, req_id: requestId }));

                setTimeout(() => {
                    ws.removeEventListener('message', messageHandler);
                    reject(new Error('Purchase request timeout'));
                }, 15000);
            });

            return response;
        } catch (error) {
            addLog(`❌ Purchase failed: ${error.message}`);
            throw error;
        }
    };

  // Enhanced trading opportunity check with contract type support
    const checkTradingOpportunity = useCallback(async () => {
        if (!tradingEnabled || !isAuthorized || currentContract) return;

        const timeframes = selectedTimeframePreset === 'scalping'
            ? ['1m', '2m', '3m', '4m', '5m']
            : ['1m', '5m', '15m', '30m', '1h', '4h'];

        const bullishCount = Object.keys(timeframeAnalysis).filter(tf => timeframeAnalysis[tf] === 'BULLISH').length;
        const bearishCount = Object.keys(timeframeAnalysis).filter(tf => timeframeAnalysis[tf] === 'BEARISH').length;

        const alignmentThreshold = Math.ceil(timeframes.length * 0.7); // 70% alignment required

        // Determine trading direction based on timeframe analysis
        if (bullishCount >= alignmentThreshold) {
            const contractType = config.contract_type === 'higher_lower' ? 'CALLE' : 'CALL';
            const contractName = config.contract_type === 'higher_lower' ? 'Higher' : 'Rise';

            addLog(`🎯 ${bullishCount}/${timeframes.length} timeframes bullish - Purchasing ${contractName}`);
            setLastSignal(`${bullishCount}/${timeframes.length} timeframes bullish - Purchasing ${contractName}`);

            try {
                await purchaseContract(contractType);

                // Update performance metrics
                setBotStatus(prev => ({
                    ...prev,
                    total_trades: prev.total_trades + 1
                }));

                addLog(`✅ Contract purchase initiated successfully`);
            } catch (error) {
                addLog(`❌ Contract purchase failed: ${error.message}`);
            }
        } else if (bearishCount >= alignmentThreshold) {
            const contractType = config.contract_type === 'higher_lower' ? 'PUTE' : 'PUT';
            const contractName = config.contract_type === 'higher_lower' ? 'Lower' : 'Fall';

            addLog(`🎯 ${bearishCount}/${timeframes.length} timeframes bearish - Purchasing ${contractName}`);
            setLastSignal(`${bearishCount}/${timeframes.length} timeframes bearish - Purchasing ${contractName}`);

            try {
                await purchaseContract(contractType);

                // Update performance metrics
                setBotStatus(prev => ({
                    ...prev,
                    total_trades: prev.total_trades + 1
                }));

                addLog(`✅ Contract purchase initiated successfully`);
            } catch (error) {
                addLog(`❌ Contract purchase failed: ${error.message}`);
            }
        }
    }, [timeframeAnalysis, tradingEnabled, isAuthorized, currentContract, config, selectedTimeframePreset, addLog]);

    // Monitor current contract
    useEffect(() => {
        if (currentContract?.id) {
            monitorContract(currentContract.id);
        }
    }, [currentContract]);

    // Check for trading opportunities when trends change
    useEffect(() => {
        if (isRunning) {
            checkTradingOpportunity();
        }
    }, [timeframeAnalysis, isRunning, checkTradingOpportunity]);

    // Establish WebSocket connection on component mount
    useEffect(() => {
        const connectWebSocket = () => {
            const newWs = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=75771");

            newWs.onopen = () => {
                console.log('✅ WebSocket connected');
                setIsConnected(true);
                setWs(newWs);
            };

            newWs.onclose = () => {
                console.log('❌ WebSocket disconnected');
                setIsConnected(false);
                setWs(null);
                // Reconnect after 5 seconds
                setTimeout(connectWebSocket, 5000);
            };

            newWs.onerror = (error) => {
                console.log('❌ WebSocket error:', error);
                setIsConnected(false);
                setWs(null);
            };
        };

        connectWebSocket();

        return () => {
            if (ws) {
                ws.close();
            }
        };
    }, []);

    // Fetch market data for all timeframes when component mounts and when symbol changes
    useEffect(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            fetchAllTimeframeData();
        } else {
            console.log('⚠️ WebSocket not ready to fetch data');
        }
    }, [ws, currentSymbol]);

    const fetchMarketData = async (symbol: string, timeframe: string) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('❌ WebSocket not ready for data fetch');
          return null;
        }

        return new Promise((resolve, reject) => {
          const reqId = `candles_${timeframe}_${Date.now()}`;

          // Handle response
          const handleMessage = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data.req_id === reqId) {
                ws.removeEventListener('message', handleMessage);
                if (data.error) {
                  console.log(`❌ Error fetching ${timeframe} data:`, data.error.message);
                  reject(data.error);
                } else if (data.candles) {
                  console.log(`✅ Received ${data.candles.length} candles for ${timeframe}`);
                  console.log(`📊 Sample candle:`, data.candles[data.candles.length - 1]);
                  resolve(data.candles);
                } else if (data.history && data.history.prices) {
                  // Convert tick data to candles for 1HZ symbols
                  console.log(`📈 Converting ${data.history.prices.length} ticks to ${timeframe} candles`);
                  const candles = convertTicksToCandles(data.history.prices, data.history.times, timeframe);
                  console.log(`✅ Generated ${candles.length} candles from ticks`);
                  resolve(candles);
                } else {
                  console.log(`⚠️ No candles or tick data in response for ${timeframe}`);
                  resolve([]);
                }
              }
            } catch (error) {
              ws.removeEventListener('message', handleMessage);
              console.log(`❌ Exception processing ${timeframe} data:`, error);
              reject(error);
            }
          };

          ws.addEventListener('message', handleMessage);

          // Determine granularity based on timeframe
          const granularityMap: { [key: string]: number } = {
            '1m': 60,
            '2m': 120,
            '3m': 180,
            '4m': 240,
            '5m': 300,
            '15m': 900,
            '30m': 1800,
            '1h': 3600,
            '4h': 14400
          };

          const granularity = granularityMap[timeframe] || 60;

          // Check if symbol is 1HZ type and needs special handling
          if (symbol.startsWith('1HZ')) {
            console.log(`📍 Detected 1HZ symbol ${symbol} - requesting tick data for conversion`);

            // For 1HZ symbols, we need to request more ticks to convert to candles
            const tickCount = Math.max(granularity * 200, 12000); // Ensure enough ticks

            const tickRequest = {
              ticks_history: symbol,
              count: tickCount,
              end: "latest",
              style: "ticks",
              req_id: reqId
            };

            console.log(`📡 Requesting ${timeframe} tick data:`, JSON.stringify(tickRequest));
            ws.send(JSON.stringify(tickRequest));
          } else {
            // For regular symbols, request candles directly
            const candleRequest = {
              ticks_history: symbol,
              style: "candles",
              adjust_start_time: 1,
              count: 100,
              end: "latest",
              granularity: granularity,
              req_id: reqId
            };

            console.log(`📡 Requesting ${timeframe} candles:`, JSON.stringify(candleRequest));
            ws.send(JSON.stringify(candleRequest));
          }

          // Timeout after 15 seconds
          setTimeout(() => {
            ws.removeEventListener('message', handleMessage);
            reject(new Error(`Timeout fetching ${timeframe} data`));
          }, 15000);
        });
      };



      const analyzeTrend = (data: any[], timeframe: string) => {
        if (!data || data.length < 10) return 'LOADING';

        // Enhanced trend analysis using OHLC candle data
        const recent = data.slice(-10); // Use last 10 candles

        let bullishSignals = 0;
        let bearishSignals = 0;
        let totalVolume = 0;

        // Analyze each candle
        recent.forEach((candle, index) => {
          const open = candle.open;
          const high = candle.high;
          const low = candle.low;
          const close = candle.close;

          // Basic candle analysis
          const bodySize = Math.abs(close - open);
          const upperWick = high - Math.max(open, close);
          const lowerWick = Math.min(open, close) - low;
          const totalRange = high - low;

          // Candle type analysis
          if (close > open) {
            // Bullish candle
            bullishSignals += 1;

            // Strong bullish if body is large relative to wicks
            if (bodySize > (upperWick + lowerWick) * 1.5) {
              bullishSignals += 0.5;
            }
          } else if (close < open) {
            // Bearish candle
            bearishSignals += 1;

            // Strong bearish if body is large relative to wicks
            if (bodySize > (upperWick + lowerWick) * 1.5) {
              bearishSignals += 0.5;
            }
          }

          // Trend continuation analysis
          if (index > 0) {
            const prevCandle = recent[index - 1];
            if (close > prevCandle.close && open > prevCandle.open) {
              bullishSignals += 0.3; // Trend continuation
            } else if (close < prevCandle.close && open < prevCandle.open) {
              bearishSignals += 0.3; // Trend continuation
            }
          }

          totalVolume += totalRange; // Use range as volume proxy
        });

        // Moving average analysis
        const closePrices = recent.map(c => c.close);
        const sma5 = closePrices.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const sma10 = closePrices.reduce((a, b) => a + b, 0) / 10;
        const currentPrice = closePrices[closePrices.length - 1];

        // SMA signals
        if (sma5 > sma10 && currentPrice > sma5) {
          bullishSignals += 1;
        } else if (sma5 < sma10 && currentPrice < sma5) {
          bearishSignals += 1;
        }

        // RSI-like momentum
        let gains = 0;
        let losses = 0;
        for (let i = 1; i < closePrices.length; i++) {
          const change = closePrices[i] - closePrices[i-1];
          if (change > 0) gains += change;
          else losses += Math.abs(change);
        }

        const rs = gains / (losses || 1);
        const rsi = 100 - (100 / (1 + rs));

        if (rsi > 60) bullishSignals += 0.5;
        else if (rsi < 40) bearishSignals += 0.5;

        // Final decision
        const signalDiff = bullishSignals - bearishSignals;
        const threshold = 1.5;

        console.log(`📊 ${timeframe} Analysis: Bullish=${bullishSignals.toFixed(1)}, Bearish=${bearishSignals.toFixed(1)}, RSI=${rsi.toFixed(1)}`);

        if (signalDiff > threshold) return 'BULLISH';
        if (signalDiff < -threshold) return 'BEARISH';
        return 'NEUTRAL';
      };

      const fetchAllTimeframeData = async () => {
        console.log('📊 Fetching multi-timeframe OHLC data...');

        const newAnalysis: { [key: string]: string } = {};

        // Fetch data for each timeframe sequentially to avoid overwhelming the API
        for (const tf of timeframes) {
          try {
            console.log(`📡 Fetching ${tf} data for ${currentSymbol}...`);
            const data = await fetchMarketData(currentSymbol, tf);

            if (data && data.length > 0) {
              newAnalysis[tf] = analyzeTrend(data, tf);
              console.log(`✅ ${tf}: ${newAnalysis[tf]} (${data.length} candles)`);

              // Log sample OHLC data
              const lastCandle = data[data.length - 1];
              console.log(`📈 ${tf} Last Candle - O:${lastCandle.open} H:${lastCandle.high} L:${lastCandle.low} C:${lastCandle.close}`);
            } else {
              newAnalysis[tf] = 'LOADING';
              console.log(`⚠️ ${tf}: No data available`);
            }

            // Update UI progressively
            setTimeframeAnalysis({ ...newAnalysis });

            // Small delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));

          } catch (error) {
            console.log(`❌ Failed to fetch ${tf} data:`, error);
            newAnalysis[tf] = 'LOADING';
          }
        }

        // Update overall analysis based on all timeframes
        const analyses = Object.values(newAnalysis).filter(a => a !== 'LOADING');
        if (analyses.length > 0) {
          const bullishCount = analyses.filter(a => a === 'BULLISH').length;
          const bearishCount = analyses.filter(a => a === 'BEARISH').length;
          const neutralCount = analyses.filter(a => a === 'NEUTRAL').length;

          console.log(`📊 Overall Summary: Bullish=${bullishCount}, Bearish=${bearishCount}, Neutral=${neutralCount}`);

          if (bullishCount > bearishCount + 1) {
            setOverallAnalysis('BULLISH');
          } else if (bearishCount > bullishCount + 1) {
            setOverallAnalysis('BEARISH');
          } else {
            setOverallAnalysis('NEUTRAL');
          }
        }

        console.log('📊 Multi-timeframe analysis completed');
      };

        const fetchTimeframeData = async (timeframe: string) => {
            try {
                addLog(`📊 Fetching ${timeframe} data for ${config.symbol} (Type: ${symbolType})`);

                const granularityMap: { [key: string]: number } = {
                    '1m': 60,
                    '2m': 120,
                    '3m': 180,
                    '4m': 240,
                    '5m': 300,
                    '15m': 900,
                    '30m': 1800,
                    '1h': 3600,
                    '4h': 14400
                };

                const granularity = granularityMap[timeframe];
                if (!granularity) {
                    addLog(`❌ Invalid timeframe: ${timeframe}`);
                    return null;
                }

                // Try to get candle data directly first
                addLog(`📈 Requesting candle data for ${timeframe}...`);

                return new Promise((resolve, reject) => {
                    const candleRequest = {
                        ticks_history: config.symbol,
                        style: 'candles',
                        granularity: granularity,
                        count: 100,
                        end: 'latest',
                        adjust_start_time: 1
                    };

                    addLog(`🔄 Sending candle request: ${JSON.stringify(candleRequest)}`);
                    wsRef.current?.send(JSON.stringify(candleRequest));

                    const handleCandleResponse = (event: MessageEvent) => {
                        try {
                            const data = JSON.parse(event.data);

                            if (data.error) {
                                addLog(`❌ Candle API Error: ${data.error.message}`);
                                // Fallback to tick conversion
                                addLog(`🔄 Falling back to tick conversion for ${timeframe}...`);
                                wsRef.current?.removeEventListener('message', handleCandleResponse);
                                fetchTicksForConversion(timeframe, granularity, resolve, reject);
                                return;
                            }

                            if (data.msg_type === 'candles' && data.candles) {
                                addLog(`✅ Received ${data.candles.length} candles for ${timeframe}`);
                                wsRef.current?.removeEventListener('message', handleCandleResponse);
                                resolve(data.candles);
                            } else if (data.msg_type === 'history' && data.history) {
                                // Convert tick history to candles
                                const prices = data.history.prices || [];
                                const times = data.history.times || [];

                                if (prices.length > 0 && times.length > 0) {
                                    addLog(`📊 Converting ${prices.length} historical ticks to ${timeframe} candles...`);
                                    const candles = convertTicksToCandles(prices, times, granularity);
                                    wsRef.current?.removeEventListener('message', handleCandleResponse);
                                    resolve(candles);
                                } else {
                                    addLog(`❌ No historical data available for ${timeframe}`);
                                    wsRef.current?.removeEventListener('message', handleCandleResponse);
                                    resolve([]);
                                }
                            }
                        } catch (error) {
                            addLog(`❌ Exception processing candle data: ${error.message}`);
                            console.error('Candle processing error:', error);
                            wsRef.current?.removeEventListener('message', handleCandleResponse);
                            reject(error);
                        }
                    };

                    wsRef.current?.addEventListener('message', handleCandleResponse);

                    // Timeout after 10 seconds
                    setTimeout(() => {
                        wsRef.current?.removeEventListener('message', handleCandleResponse);
                        reject(new Error(`Timeout waiting for ${timeframe} data`));
                    }, 10000);
                });

            } catch (error) {
                addLog(`❌ Exception fetching ${timeframe} data: ${error.message}`);
                console.error('fetchTimeframeData error:', error);
                return null;
            }
        };

        const fetchTicksForConversion = (timeframe: string, granularity: number, resolve: Function, reject: Function) => {
            const tickCount = Math.min(1000, 100 * (granularity / 60)); // Adjust tick count based on granularity
            addLog(`📈 Requesting ${tickCount} ticks for ${timeframe} conversion...`);

            const tickRequest = {
                ticks: config.symbol,
                count: tickCount
            };

            wsRef.current?.send(JSON.stringify(tickRequest));

            const collectedTicks: { prices: number[], times: number[] } = { prices: [], times: [] };

            const handleTickResponse = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.error) {
                        addLog(`❌ Tick API Error: ${data.error.message}`);
                        wsRef.current?.removeEventListener('message', handleTickResponse);
                        reject(new Error(data.error.message));
                        return;
                    }

                    if (data.msg_type === 'tick' && data.tick) {
                        collectedTicks.prices.push(data.tick.quote);
                        collectedTicks.times.push(data.tick.epoch);

                        // Process when we have enough data or after reasonable collection time
                        if (collectedTicks.prices.length >= Math.min(tickCount, 50)) {
                            const candles = convertTicksToCandles(collectedTicks.prices, collectedTicks.times, granularity);
                            wsRef.current?.removeEventListener('message', handleTickResponse);
                            resolve(candles);
                        }
                    }
                } catch (error) {
                    addLog(`❌ Exception processing tick conversion: ${error.message}`);
                    wsRef.current?.removeEventListener('message', handleTickResponse);
                    reject(error);
                }
            };

            wsRef.current?.addEventListener('message', handleTickResponse);

            // Timeout after 8 seconds for tick collection
            setTimeout(() => {
                wsRef.current?.removeEventListener('message', handleTickResponse);
                if (collectedTicks.prices.length > 0) {
                    const candles = convertTicksToCandles(collectedTicks.prices, collectedTicks.times, granularity);
                    resolve(candles);
                } else {
                    reject(new Error(`No tick data collected for ${timeframe}`));
                }
            }, 8000);
        };

    const handleStartBot = async () => {
        // Skip API token requirement for OAuth authenticated users
        if (!isOAuthEnabled) {
            addLog('❌ OAuth authentication is required');
            return;
        }

        if (!config.symbol || !config.stake || !config.contract_type) {
            addLog('❌ Please configure all required settings');
            return;
        }

        try {
            addLog('🔗 Connecting to Deriv API...');

            // Initialize WebSocket connection
            const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${config.app_id}`;
            const ws = new WebSocket(wsUrl);

ws.onopen = () => {
                ```javascript
                addLog('✅ Connected to Deriv API');

                if (isOAuthEnabled) {
                    // OAuth users are automatically authenticated
                    addLog('🔐 OAuth authentication active - ready for trading');
                    setIsAuthorized(true);
                    setTradingEnabled(true);
                }  else {
                    addLog('❌ No authentication method available');
                    return;
                }
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.error) {
                    addLog(`❌ API Error: ${data.error.message}`);
                    return;
                }

                if (data.msg_type === 'authorize') {
                    addLog('✅ API Authorized');
                    setIsAuthorized(true);
                }

                // Handle other API messages
            };

            ws.onclose = () => {
                addLog('❌ Disconnected from Deriv API');
                setIsAuthorized(false);
            };

            ws.onerror = (error) => {
                addLog(`❌ WebSocket Error: ${error}`);
                setIsAuthorized(false);
            };

            wsRef.current = ws;

            // Start trading loop
            setIsRunning(true);
            intervalRef.current = setInterval(tradingLoop, config.monitor_interval * 1000);

            // Initial analysis
            tradingLoop();

        } catch (error) {
            addLog(`❌ Error starting bot: ${error}`);
        }
    };

    const handleStopBot = () => {
        setIsRunning(false);
        clearInterval(intervalRef.current);
        wsRef.current?.close();
    };

  const sendProposal = (contractType: string) => {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLog('❌ WebSocket not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }

      const proposalRequest = {
        proposal: 1,
        amount: config.stake,
        symbol: config.symbol,
        duration: duration,
        duration_unit: durationType,
        contract_type: contractType,
        currency: 'USD',
        barrier: barrier || undefined,
        app_id: 75771 // Use authenticated app ID

      };

      const reqId = `proposal_${Date.now()}`;
      const messageHandler = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.req_id === reqId) {
          ws.removeEventListener('message', messageHandler);
          if (data.error) {
            addLog(`❌ Proposal error: ${data.error.message}`);
            reject(data.error);
          } else {
            addLog(`✅ Proposal received for ${contractType}`);
            resolve(data.proposal);
          }
        }
      };

      ws.addEventListener('message', messageHandler);
      ws.send(JSON.stringify({ ...proposalRequest, req_id: reqId }));

      setTimeout(() => {
        ws.removeEventListener('message', messageHandler);
        reject(new Error('Proposal request timeout'));
      }, 10000);
    });
  };

  const handleTrade = async (tradeType: string) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            addLog('❌ WebSocket not connected');
            return;
        }

        try {
            // Construct trade request
            const tradeRequest = {
                            buy: 1,
                            parameters: {
                                contract_type: tradeType,
                                symbol: config.symbol,
                                amount: config.stake,
                                duration: 1,
                                duration_unit: 't',
                                basis: 'stake'
                            }
                        };

                        // For multiplier trades, add multiplier-specific parameters
                        if (config.contract_type === 'multipliers') {
                            tradeRequest.parameters.multiplier = config.multiplier || 10;
                            if (config.use_deal_cancellation) {
                                tradeRequest.parameters.cancellation = config.deal_cancellation_minutes * 60;
                            }
                        }
            // Send trade request
            ws.send(JSON.stringify(tradeRequest));

            // Handle trade response
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.error) {
                    addLog(`❌ Trade Error: ${data.error.message}`);
                    return;
                }

                if (data.buy) {
                    addLog(`✅ Trade successful - Contract ID: ${data.buy.contract_id}`);
                    // Update performance data
                    setPerformanceData((prevData) => ({
                        ...prevData,
                        totalTrades: prevData.totalTrades + 1
                    }));

                    // Update trade history
                    setTradeHistory((prevHistory) => [
                        ...prevHistory,
                        {
                            contractId: data.buy.contract_id,
                            type: tradeType,
                            profit: data.buy.payout - config.stake,
                            timestamp: new Date().toLocaleString(),
                        }
                    ]);
                }
            };

        } catch (error) {
            addLog(`❌ Trade failed: ${error}`);
        }
    };

    return (
        <div className="decycler-bot-container">
            <div className="decycler-header">
                <h2>🔬 Decycler Multi-Timeframe Trading Bot</h2>
                <div className={`bot-status ${isRunning ? 'running' : 'stopped'}`}>
                    <span className="status-dot"></span>
                    {isRunning ? 'RUNNING' : 'STOPPED'}
                </div>
            </div>

            <div className="decycler-grid">
                <div className="main-panel">
                    {/* Configuration Panel */}
                    <div className="config-panel">
                        <h3>⚙️ Configuration</h3>
                         <div className="config-item">
                            <label>Timeframe Preset</label>
                            <select
                                value={selectedTimeframePreset}
                                onChange={e => setSelectedTimeframePreset(e.target.value as 'scalping' | 'multi')}
                                disabled={isRunning}
                            >
                                <option value="scalping">Scalping (1m-5m)</option>
                                <option value="multi">Multi-Timeframe (1m-4h)</option>
                            </select>
                        </div>
                        <div className="config-grid">
                            <div className="config-item">
                                <label>Symbol</label>
                                <select
                                    value={config.symbol}
                                    onChange={e => setConfig(prev => ({ ...prev, symbol: e.target.value }))}
                                    disabled={isRunning}
                                >
                                    <optgroup label="Volatility Indices (1s)">
                                        <option value="1HZ10V">Volatility 10 (1s) Index</option>
                                        <option value="1HZ25V">Volatility 25 (1s) Index</option>
                                        <option value="1HZ50V">Volatility 50 (1s) Index</option>
                                        <option value="1HZ75V">Volatility 75 (1s) Index</option>
                                        <option value="1HZ100V">Volatility 100 (1s) Index</option>
                                        <option value="1HZ150V">Volatility 150 (1s) Index</option>
                                        <option value="1HZ250V">Volatility 250 (1s) Index</option>
                                    </optgroup>
                                    <optgroup label="Volatility Indices">
                                        <option value="R_10">Volatility 10 Index</option>
                                        <option value="R_25">Volatility 25 Index</option>
                                        <option value="R_50">Volatility 50 Index</option>
                                        <option value="R_75">Volatility 75 Index</option>
                                        <option value="R_100">Volatility 100 Index</option>
                                        <option value="R_200">Volatility 200 Index</option>
                                        <option value="R_300">Volatility 300 Index</option>
                                        <option value="R_500">Volatility 500 Index</option>
                                        <option value="R_1000">Volatility 1000 Index</option>
                                    </optgroup>
                                    <optgroup label="Market Indices">
                                        <option value="RDBEAR">Bear Market Index</option>
                                        <option value="RDBULL">Bull Market Index</option>
                                    </optgroup>
                                    <optgroup label="Jump Indices">
                                        <option value="BOOM500">Boom 500 Index</option>
                                        <option value="BOOM1000">Boom 1000 Index</option>
                                        <option value="CRASH500">Crash 500 Index</option>
                                        <option value="CRASH1000">Crash 1000 Index</option>
                                    </optgroup>
                                    <optgroup label="Step Index">
                                        <option value="stpRNG">Step Index</option>
                                    </optgroup>
                                    {config.contract_type === 'multipliers' && (
                                        <optgroup label="Forex (Multipliers Compatible)">
                                            <option value="frxEURUSD">EUR/USD</option>
                                            <option value="frxGBPUSD">GBP/USD</option>
                                            <option value="frxUSDJPY">USD/JPY</option>
                                            <option value="frxAUDUSD">AUD/USD</option>
                                            <option value="frxUSDCAD">USD/CAD</option>
                                            <option value="frxUSDCHF">USD/CHF</option>
                                        </optgroup>
                                    )}
                                </select>
                            </div>
                            <div className="config-item">
                                <label>Stake ($)</label>
                                <input
                                    type="number"
                                    value={config.stake}
                                    onChange={e => setConfig(prev => ({ ...prev, stake: parseFloat(e.target.value) || 1 }))}
                                    min="1"
                                    step="0.1"
                                    disabled={isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Take Profit ($)</label>
                                <input
                                    type="number"
                                    value={config.take_profit}
                                    onChange={e => setConfig(prev => ({ ...prev, take_profit: parseFloat(e.target.value) || 1.5 }))}
                                    step="0.1"
                                    disabled={isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Stop Loss ($)</label>
                                <input
                                    type="number"
                                    value={config.stop_loss}
                                    onChange={e => setConfig(prev => ({ ...prev, stop_loss: parseFloat(e.target.value) || -1 }))}
                                    step="0.1"
                                    disabled={isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Contract Type</label>
                                <select
                                    value={config.contract_type}
                                    onChange={e => setConfig(prev => ({ ...prev, contract_type: e.target.value as 'rise_fall' | 'higher_lower' | 'allow_equals' | 'multipliers' }))}
                                    disabled={isRunning}
                                >
                                    <option value="rise_fall">Rise/Fall (Strict)</option>
                                    <option value="higher_lower">Higher/Lower (with Barrier)</option>
                                    <option value="allow_equals">Allow Equals (Rise/Fall + Equals)</option>
                                    <option value="multipliers">Multipliers (Up to 2000x)</option>
                                </select>
                            </div>
                            <div className="config-item">
                                <label>Tick Count</label>
                                <input
                                    type="number"
                                    value={config.tick_count}
                                    onChange={e => setConfig(prev => ({ ...prev, tick_count: parseInt(e.target.value) || 5 }))}
                                    min="1"
                                    max="10"
                                    disabled={isRunning}
                                />
                            </div>
                            <div className="config-item">
                                <label>Barrier (optional)</label>
                                <input
                                    type="text"
                                    value={barrier}
                                    onChange={(e) => setBarrier(e.target.value)}
                                    placeholder="e.g. +0.001, -0.001, or absolute value"
                                    disabled={isRunning}
                                />
                            </div>

                            {config.contract_type === 'multipliers' ? (
                                <>
                                    <div className="config-item">
                                        <label>Multiplier (x)</label>
                                        <input
                                            type="number"
                                            value={config.multiplier}
                                            onChange={e => setConfig(prev => ({ ...prev, multiplier: parseInt(e.target.value) || 100 }))}
                                            min="1"
                                            max="2000"
                                            disabled={isRunning}
                                        />
                                    </div>
                                    <div className="config-item">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={config.use_deal_cancellation}
                                                onChange={e => setConfig(prev => ({ ...prev, use_deal_cancellation: e.target.checked }))}
                                                disabled={isRunning}
                                            />
                                            Deal Cancellation
                                        </label>
                                        {config.use_deal_cancellation && (
                                            <select
                                                value={config.deal_cancellation}
                                                onChange={e => setConfig(prev => ({ ...prev, deal_cancellation: e.target.value as '5m' | '10m' | '15m' | '30m' | '60m' }))}
                                                disabled={isRunning}
                                            >
                                                <option value="5m">5 minutes</option>
                                                <option value="10m">10 minutes</option>
                                                <option value="15m">15 minutes</option>
                                                <option value="30m">30 minutes</option>
                                                <option value="60m">60 minutes</option>
                                            </select>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="config-item">
                                    <label>Duration</label>
                                    <div className="duration-group">
                                        <input
                                            type="number"
                                            value={duration}
                                            onChange={(e) => setDuration(Number(e.target.value))}
                                            min="1"
                                            disabled={isRunning}
                                        />
                                        <select
                                            value={durationType}
                                            onChange={(e) => setDurationType(e.target.value)}
                                            disabled={isRunning}
                                        >
                                            <option value="t">Ticks</option>
                                            <option value="s">Seconds</option>
                                            <option value="m">Minutes</option>
                                            <option value="h">Hours</option>
                                            <option value="d">Days</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>

                        {isOAuthEnabled && (
                            <div className="oauth-status">
                                <span className="status-label">Authentication:</span>
                                <span className="status-value connected">
                                    ✅ OAuth Authenticated - Ready for Trading
                                </span>
                            </div>
                        )}

                        {/* Advanced Risk Management */}
                        <div className="risk-management">
                            <h4>🛡️ Risk Management</h4>
                            <div className="risk-options">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={config.use_trailing_stop}
                                        onChange={e => setConfig(prev => ({ ...prev, use_trailing_stop: e.target.checked }))}
                                        disabled={isRunning}
                                    />
                                    Trailing Stop (${config.trailing_step})
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={config.use_breakeven}
                                        onChange={e => setConfig(prev => ({ ...prev, use_breakeven: e.target.checked }))}
                                        disabled={isRunning}
                                    />
                                    Breakeven at ${config.breakeven_trigger} profit
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={config.use_10s_filter}
                                        onChange={e => setConfig(prev => ({ ...prev, use_10s_filter: e.target.checked }))}
                                        disabled={isRunning}
                                    />
                                    10-Second Confirmation Filter
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Control Panel */}
                    <div className="control-panel">
                        <h3>🎮 Controls</h3>
                        <div className="api-status">
                            <span className="status-label">API Status:</span>
                            <span className={`status-value ${api_base.api ? 'connected' : 'disconnected'}`}>
                                {api_base.api ? '🟢 Connected' : '🔴 Disconnected'}
                            </span>
                            {api_base.api && (
                                <span className="connection-status">
                                    ({api_base.getConnectionStatus()})
                                </span>
                            )}
                        </div>

          <div className="control-item">
            <span className="control-label">Trading Status:</span>
            <span className={`status ${isAuthorized ? 'connected' : 'disconnected'}`}>
              {isAuthorized ? '🟢 Authorized' : '🔴 Not Authorized'}
            </span>
          </div>



          <div className="control-item">
            <label className="control-label">
              <input
                type="checkbox"
                checked={tradingEnabled}
                onChange={(e) => setTradingEnabled(e.target.checked)}
                disabled={!isAuthorized}
                style={{ marginRight: '10px' }}
              />
              Enable Auto Trading
            </label>
          </div>

          {currentContract && (
            <div className="control-item">
              <span className="control-label">Active Contract:</span>
              <span className="status connected">
                {currentContract.type} - ${currentContract.stake} (ID: {currentContract.id.slice(-8)})
              </span>
            </div>
          )}
                        <div className="control-buttons">
                            <button
                                className={`control-btn ${isRunning ? 'stop' : 'start'}`}
                                onClick={isRunning ? handleStopBot : handleStartBot}
                            >
                                {isRunning ? '⏹️ Stop Bot' : '▶️ Start Bot'}
                            </button>
                            <button
                                className="control-btn test"
                                onClick={testConnection}
                                disabled={isRunning}
                            >
                                🔍 Test Connection
                            </button>
                            <button
                                className="control-btn day-ticks"
                                onClick={() => getDayTicks(config.symbol)}
                                disabled={isRunning}
                            >
                                📅 Get Day Ticks (86400)
                            </button>
                        </div>
                        {!api_base.api && (
                            <div className="api-warning">
                                ⚠️ API not connected. Bot will attempt to connect when started.
                            </div>
                        )}
                    </div>

                    {/* Current Contract */}
                    {currentContract && (
                        <div className="current-contract">
                            <h3>📊 Current Contract</h3>
                            <div className="contract-info">
                                <div className="contract-details">
                                    <span>ID: {currentContract.id}</span>
                                    <span>Type: {currentContract.type}</span>
                                    <span>Direction: {currentContract.direction}</span>
                                    <span>Entry: {currentContract.entry_price.toFixed(5)}</span>
                                </div>
                                <div className={`profit-display ${currentContract.profit >= 0 ? 'positive' : 'negative'}`}>
                                    P&L: ${currentContract.profit.toFixed(2)}
                                </div>
                            </div>
                            <div className="risk-status">
                                {config.use_trailing_stop && (
                                    <span>Trailing Stop: {currentContract.trailing_stop.toFixed(5)}</span>
                                )}
                                {currentContract.breakeven_active && (
                                    <span className="breakeven-active">Breakeven Active</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="side-panel">
                    {/* Timeframe Analysis */}
                    <div className="timeframe-analysis">
                        <h3>📈 Multi-Timeframe Analysis</h3>
                        <div className={`alignment-status ${overallAnalysis}`}>
                            <div 
                                className="alignment-indicator"
                                style={{ backgroundColor: getAlignmentColor(overallAnalysis) }}
                            >
                                {overallAnalysis.replace('_', ' ').toUpperCase()}
                            </div>
                        </div>
                        <div className="trends-grid">
                            {timeframes.map(timeframe => {
                                const trendData = timeframeAnalysis[timeframe];
                                const trendForColor = trendData === 'BULLISH' ? 'bullish' : 
                                                    trendData === 'BEARISH' ? 'bearish' : 'neutral';
                                return (
                                    <div key={timeframe} className="trend-item">
                                        <span className="timeframe-label">{timeframe}</span>
                                        <div 
                                            className={`trend-indicator ${trendForColor}`}
                                            style={{ backgroundColor: getTrendColor(trendForColor) }}
                                        >
                                            {trendData || 'LOADING'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Statistics */}
                    <div className="statistics">
                        <h3>📊 Performance</h3>
                        <div className="stats-grid">
                            <div className="stat-item">
                                <span className="stat-label">Total Trades</span>
                                <span className="stat-value">{performanceData.totalTrades}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Win Rate</span>
                                <span className="stat-value">
                                    {tradeHistory.length > 0 
                                        ? ((tradeHistory.filter(trade => trade.profit > 0).length / tradeHistory.length) * 100).toFixed(1) 
                                        : 0}%
                                </span>
                            </div>
                            <div className="performance-item">
            <span className="stat-label">Total P&L</span>
                                <span className={`stat-value ${tradeHistory.reduce((acc, trade) => acc + trade.profit, 0) >= 0 ? 'positive' : 'negative'}`}>
                                    ${tradeHistory.reduce((acc, trade) => acc + trade.profit, 0).toFixed(2)}
                                </span>
                            </div>
                        </div>

        {tradeHistory.length > 0 && (
          <div className="trade-history-section">
            <h3>📊 Recent Trades</h3>
            <div className="trade-history">
              {tradeHistory.slice(-5).reverse().map((trade, index) => (
                <div key={index} className="trade-item">
                  <span className="trade-type">{trade.type}</span>
                  <span className="trade-stake">${config.stake}</span>
                  <span className={`trade-result ${trade.profit > 0 ? 'win' : 'loss'}`}>
                    {trade.profit > 0 ? 'WIN' : 'LOSS'}
                  </span>
                  <span className={`trade-profit ${trade.profit >= 0 ? 'positive' : 'negative'}`}>
                    ${trade.profit.toFixed(2)}
                  </span>
                  <span className="trade-time">
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
                    </div>

                    {/* Activity Logs */}
                    <div className="activity-logs">
                        <h3>📝 Activity Logs</h3>
                        <div className="logs-container">
                            {logs.map((log, index) => (
                                <div key={index} className="log-entry">
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            </div>

            {botStatus.error_message && (
                <div className="error-message">
                    ❌ {botStatus.error_message}
                </div>
            )}
        </div>
    );
});

export default DecyclerBot;