import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    contract_type: 'rise_fall' | 'higher_lower';
    use_trailing_stop: boolean;
    trailing_step: number;
    use_breakeven: boolean;
    breakeven_trigger: number;
    alpha: number;
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
    const [config, setConfig] = useState<DecyclerConfig>({
        app_id: 75771,
        symbol: '1HZ100V',
        stake: 1.0,
        take_profit: 1.5,
        stop_loss: -1.0,
        tick_count: 5,
        use_10s_filter: true,
        monitor_interval: 10,
        contract_type: 'rise_fall',
        use_trailing_stop: true,
        trailing_step: 0.5,
        use_breakeven: true,
        breakeven_trigger: 2.0,
        alpha: 0.07
    });

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

    // Check trend alignment
    const checkAlignment = useCallback((trends: TrendData[]): 'aligned_bullish' | 'aligned_bearish' | 'mixed' | 'neutral' => {
        if (trends.length === 0) return 'neutral';

        const bullishCount = trends.filter(t => t.trend === 'bullish').length;
        const bearishCount = trends.filter(t => t.trend === 'bearish').length;
        const neutralCount = trends.filter(t => t.trend === 'neutral').length;

        if (bullishCount === trends.length) return 'aligned_bullish';
        if (bearishCount === trends.length) return 'aligned_bearish';
        if (bullishCount > bearishCount && bullishCount >= trends.length * 0.7) return 'aligned_bullish';
        if (bearishCount > bullishCount && bearishCount >= trends.length * 0.7) return 'aligned_bearish';
        return 'mixed';
    }, []);

    // Execute trade
    const executeTrade = useCallback(async (direction: 'UP' | 'DOWN'): Promise<void> => {
        if (!api_base.api || api_base.api.connection.readyState !== 1) {
            addLog('❌ API not connected or WebSocket not ready');
            return;
        }

        try {
            addLog(`🎯 Executing ${direction} trade on ${config.symbol}...`);

            // Map contract types correctly for Deriv API
            const contractTypeMap = {
                rise_fall: direction === 'UP' ? 'CALL' : 'PUT',
                higher_lower: direction === 'UP' ? 'CALLE' : 'PUTE'
            };

            const contractType = contractTypeMap[config.contract_type];
            
            // Get current server time for proposal
            const timeResponse = await api_base.api.send({ time: 1 });
            if (timeResponse.error) {
                addLog(`❌ Failed to get server time: ${timeResponse.error.message}`);
                return;
            }

            // Create proposal request
            const proposalRequest = {
                proposal: 1,
                amount: config.stake,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration: config.tick_count,
                duration_unit: 't',
                symbol: config.symbol,
                req_id: `proposal_${Date.now()}`
            };

            addLog(`📋 Getting proposal: ${contractType} ${config.stake} USD on ${config.symbol} for ${config.tick_count} ticks`);
            
            const proposalResponse = await Promise.race([
                api_base.api.send(proposalRequest),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Proposal timeout')), 10000)
                )
            ]);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message} (Code: ${proposalResponse.error.code})`);
                
                // Log additional error details for debugging
                if (proposalResponse.error.details) {
                    addLog(`📋 Error details: ${JSON.stringify(proposalResponse.error.details)}`);
                }
                return;
            }

            if (!proposalResponse.proposal) {
                addLog(`❌ No proposal received from API`);
                return;
            }

            const proposalId = proposalResponse.proposal.id;
            const entrySpot = proposalResponse.proposal.spot;
            const payout = proposalResponse.proposal.payout;
            const displayValue = proposalResponse.proposal.display_value;

            addLog(`📊 Proposal received: ID ${proposalId}, Entry spot: ${entrySpot}, Payout: ${payout}`);

            // Purchase contract
            const buyRequest = {
                buy: proposalId,
                price: config.stake,
                req_id: `buy_${Date.now()}`
            };

            addLog(`💰 Purchasing contract with proposal ID: ${proposalId}...`);
            
            const buyResponse = await Promise.race([
                api_base.api.send(buyRequest),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Purchase timeout')), 15000)
                )
            ]);

            if (buyResponse.error) {
                addLog(`❌ Purchase error: ${buyResponse.error.message} (Code: ${buyResponse.error.code})`);
                
                // Check for specific error codes
                if (buyResponse.error.code === 'InsufficientBalance') {
                    addLog(`💰 Insufficient balance. Please add funds to your account.`);
                } else if (buyResponse.error.code === 'InvalidProposal') {
                    addLog(`📋 Proposal expired. Market conditions may have changed.`);
                } else if (buyResponse.error.code === 'MarketIsClosed') {
                    addLog(`🕐 Market is closed for ${config.symbol}`);
                }
                return;
            }

            if (!buyResponse.buy) {
                addLog(`❌ No purchase confirmation received`);
                return;
            }

            const contractId = buyResponse.buy.contract_id;
            const buyPrice = buyResponse.buy.buy_price;
            const startTime = buyResponse.buy.start_time;

            addLog(`✅ Contract purchased successfully!`);
            addLog(`📄 Contract ID: ${contractId}`);
            addLog(`💰 Buy Price: ${buyPrice} USD`);
            addLog(`📊 Entry Spot: ${entrySpot}`);
            addLog(`🎯 Direction: ${direction}`);
            addLog(`⏰ Start Time: ${new Date(startTime * 1000).toLocaleTimeString()}`);

            // Create contract info
            const newContract: ContractInfo = {
                id: contractId,
                type: contractType,
                entry_price: parseFloat(entrySpot),
                current_price: parseFloat(entrySpot),
                profit: 0,
                status: 'open',
                entry_time: startTime * 1000,
                direction,
                stop_loss: parseFloat(entrySpot) + config.stop_loss,
                take_profit: parseFloat(entrySpot) + config.take_profit,
                trailing_stop: config.use_trailing_stop ? parseFloat(entrySpot) + config.stop_loss : 0,
                breakeven_active: false
            };

            setBotStatus(prev => ({
                ...prev,
                current_contract: newContract,
                total_trades: prev.total_trades + 1
            }));

            // Start monitoring the contract
            await monitorContract(contractId);

            addLog(`👁️ Contract monitoring started for ${contractId}`);

        } catch (error) {
            const errorMessage = error.message || 'Unknown error occurred';
            addLog(`❌ Trade execution failed: ${errorMessage}`);
            console.error('Trade execution error:', error);
            
            // Reset contract status on error
            setBotStatus(prev => ({
                ...prev,
                current_contract: null,
                error_message: `Trade execution failed: ${errorMessage}`
            }));
        }
    }, [config, addLog, monitorContract, setBotStatus]);

    // Monitor open contract
    const monitorContract = useCallback(async (contractId: string): Promise<void> => {
        if (!api_base.api || api_base.api.connection.readyState !== 1) {
            addLog('❌ API not available for contract monitoring');
            return;
        }

        try {
            const request = {
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
                req_id: `monitor_${contractId}`
            };

            addLog(`👁️ Starting contract monitoring for ${contractId}...`);
            
            const response = await Promise.race([
                api_base.api.send(request),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Monitor subscription timeout')), 10000)
                )
            ]);

            if (response.error) {
                addLog(`❌ Contract monitoring error: ${response.error.message}`);
                // Don't return here, we might still want to try monitoring
            } else if (response.proposal_open_contract) {
                addLog(`✅ Contract monitoring subscription successful`);
                
                // Log initial contract details
                const contract = response.proposal_open_contract;
                addLog(`📊 Contract Status: ${contract.status || 'open'}`);
                if (contract.current_spot) {
                    addLog(`📈 Current Spot: ${contract.current_spot}`);
                }
                if (contract.profit) {
                    addLog(`💰 Current P&L: ${contract.profit}`);
                }
            }

            // Set up periodic contract status checking as backup
            const statusCheckInterval = setInterval(async () => {
                if (!botStatus.current_contract || botStatus.current_contract.id !== contractId) {
                    clearInterval(statusCheckInterval);
                    return;
                }

                try {
                    const statusRequest = {
                        proposal_open_contract: 1,
                        contract_id: contractId,
                        req_id: `status_${Date.now()}`
                    };

                    const statusResponse = await api_base.api.send(statusRequest);
                    
                    if (statusResponse.proposal_open_contract) {
                        const contract = statusResponse.proposal_open_contract;
                        
                        // Update contract info in state
                        setBotStatus(prev => {
                            if (!prev.current_contract || prev.current_contract.id !== contractId) {
                                return prev;
                            }

                            const updatedContract = {
                                ...prev.current_contract,
                                current_price: contract.current_spot || prev.current_contract.current_price,
                                profit: contract.profit || 0,
                                status: contract.is_sold ? 'closed' : 'open'
                            };

                            return {
                                ...prev,
                                current_contract: updatedContract
                            };
                        });

                        // Check if contract is finished
                        if (contract.is_sold) {
                            clearInterval(statusCheckInterval);
                            const isWin = contract.profit > 0;
                            
                            addLog(`🏁 Contract ${contractId} finished!`);
                            addLog(`${isWin ? '🎉 WIN' : '💔 LOSS'} - Final P&L: ${contract.profit.toFixed(2)} USD`);
                            addLog(`📊 Final spot: ${contract.current_spot}`);
                            addLog(`⏰ Duration: ${Math.round((Date.now() - botStatus.current_contract?.entry_time) / 1000)}s`);

                            // Update final stats
                            setBotStatus(prev => ({
                                ...prev,
                                current_contract: null,
                                winning_trades: isWin ? prev.winning_trades + 1 : prev.winning_trades,
                                total_pnl: prev.total_pnl + contract.profit
                            }));
                        }
                    }
                } catch (statusError) {
                    addLog(`⚠️ Status check failed: ${statusError.message}`);
                }
            }, 2000); // Check every 2 seconds

            // Clean up interval after 5 minutes maximum
            setTimeout(() => {
                clearInterval(statusCheckInterval);
                addLog(`⏰ Contract monitoring timeout for ${contractId}`);
            }, 300000);

        } catch (error) {
            const errorMessage = error.message || 'Unknown monitoring error';
            addLog(`❌ Failed to monitor contract: ${errorMessage}`);
            console.error('Contract monitoring error:', error);
        }
    }, [addLog, botStatus.current_contract, setBotStatus]);

    // Main trading loop
    const tradingLoop = useCallback(async (): Promise<void> => {
        if (!botStatus.is_running) return;

        try {
            addLog('🔄 Starting trading analysis cycle...');

            // Analyze all timeframes
            const trends = await analyzeAllTimeframes();

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

            // Check if we should enter a trade
            if (!botStatus.current_contract && (alignment === 'aligned_bullish' || alignment === 'aligned_bearish')) {
                const direction = alignment === 'aligned_bullish' ? 'UP' : 'DOWN';

                // Check if API is properly connected and authenticated
                if (!api_base.api || api_base.api.connection.readyState !== 1) {
                    addLog('❌ API connection lost - cannot execute trade');
                    return;
                }

                // Check account balance before trading
                try {
                    const balanceResponse = await api_base.api.send({ balance: 1, account: 'all' });
                    
                    if (balanceResponse.error) {
                        addLog(`❌ Cannot check balance: ${balanceResponse.error.message}`);
                        return;
                    }

                    const currentBalance = balanceResponse.balance?.balance || 0;
                    addLog(`💰 Current balance: ${currentBalance} USD`);

                    if (currentBalance < config.stake) {
                        addLog(`❌ Insufficient balance: ${currentBalance} USD < ${config.stake} USD required`);
                        addLog('💡 Please add funds to your account to continue trading');
                        return;
                    }

                    if (currentBalance < config.stake * 3) {
                        addLog(`⚠️ Low balance warning: Only ${currentBalance} USD remaining`);
                    }

                } catch (balanceError) {
                    addLog(`⚠️ Balance check failed: ${balanceError.message} - Proceeding with trade attempt`);
                }

                // Optional 10s confirmation
                if (config.use_10s_filter) {
                    addLog('⏱️ Applying 10-second confirmation filter...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Re-check alignment after delay
                    const reconfirmTrends = await analyzeAllTimeframes();
                    const reconfirmAlignment = checkAlignment(reconfirmTrends);
                    
                    if (reconfirmAlignment !== alignment) {
                        addLog(`⚠️ Trend alignment changed during confirmation: ${alignment} → ${reconfirmAlignment}`);
                        addLog('❌ Trade cancelled due to alignment change');
                        return;
                    }
                    
                    addLog('✅ Trend alignment confirmed after 10s filter');
                }

                addLog(`🎯 Strong ${direction} alignment detected - Executing trade!`);
                addLog(`📊 Alignment: ${alignment.toUpperCase()}`);
                addLog(`📈 Direction: ${direction}`);
                addLog(`💰 Stake: ${config.stake} USD`);
                addLog(`📋 Contract: ${config.contract_type.toUpperCase()}`);
                addLog(`⏰ Duration: ${config.tick_count} ticks`);
                
                await executeTrade(direction);
            } else if (!botStatus.current_contract) {
                addLog('⏳ Waiting for trend alignment - No trade signal yet');
            } else {
                addLog('📊 Active contract in progress - Monitoring...');
            }

        } catch (error) {
            const errorMsg = `Trading analysis error: ${error.message}`;
            addLog(`❌ ${errorMsg}`);
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

            setBotStatus(prev => ({ ...prev, is_running: true }));
            addLog('🚀 Decycler Multi-Timeframe Bot Started!');
            addLog(`📊 Monitoring ${timeframes.join(', ')} timeframes`);
            addLog(`🎯 Symbol: ${config.symbol} | Stake: $${config.stake}`);
            addLog(`⚙️ Contract Type: ${config.contract_type.toUpperCase()}`);

            // Start trading loop
            intervalRef.current = setInterval(tradingLoop, config.monitor_interval * 1000);

            // Run initial analysis
            await tradingLoop();
        } catch (error) {
            addLog(`❌ Error starting bot: ${error.message}`);
        }
    }, [config, timeframes, tradingLoop, addLog]);

        // Stop bot
    const stopBot = useCallback((): void => {
        setBotStatus(prev => ({ ...prev, is_running: false }));

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        if (monitorRef.current) {
            clearInterval(monitorRef.current);
            monitorRef.current = null;
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

    useEffect(() => {
        setCurrentSymbol(config.symbol); // Update currentSymbol when config.symbol changes
    }, [config.symbol]);

    // Establish WebSocket connection on component mount
    useEffect(() => {
        const connectWebSocket = () => {
            const newWs = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=75771");

            newWs.onopen = () => {
                console.log('✅ WebSocket connected');
                setWs(newWs);
            };

            newWs.onclose = () => {
                console.log('❌ WebSocket disconnected');
                setWs(null);
                // Reconnect after 5 seconds
                setTimeout(connectWebSocket, 5000);
            };

            newWs.onerror = (error) => {
                console.log('❌ WebSocket error:', error);
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

    return (
        <div className="decycler-bot-container">
            <div className="decycler-header">
                <h2>🔬 Decycler Multi-Timeframe Trading Bot</h2>
                <div className={`bot-status ${botStatus.is_running ? 'running' : 'stopped'}`}>
                    <span className="status-dot"></span>
                    {botStatus.is_running ? 'RUNNING' : 'STOPPED'}
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
                                disabled={botStatus.is_running}
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
                                    disabled={botStatus.is_running}
                                >
                                    <option value="1HZ10V">Volatility 10 (1s) Index</option>
                                    <option value="1HZ25V">Volatility 25 (1s) Index</option>
                                    <option value="1HZ50V">Volatility 50 (1s) Index</option>
                                    <option value="1HZ75V">Volatility 75 (1s) Index</option>
                                    <option value="1HZ100V">Volatility 100 (1s) Index</option>
                                    <option value="1HZ150V">Volatility 150 (1s) Index</option>
                                    <option value="1HZ250V">Volatility 250 (1s) Index</option>
                                    <option value="R_10">Volatility 10 Index</option>
                                    <option value="R_25">Volatility 25 Index</option>
                                    <option value="R_50">Volatility 50 Index</option>
                                    <option value="R_75">Volatility 75 Index</option>
                                    <option value="R_100">Volatility 100 Index</option>
                                    <option value="R_200">Volatility 200 Index</option>
                                    <option value="R_300">Volatility 300 Index</option>
                                    <option value="R_500">Volatility 500 Index</option>
                                    <option value="R_1000">Volatility 1000 Index</option>
                                    <option value="RDBEAR">Bear Market Index</option>
                                    <option value="RDBULL">Bull Market Index</option>
                                    <option value="BOOM500">Boom 500 Index</option>
                                    <option value="BOOM1000">Boom 1000 Index</option>
                                    <option value="CRASH500">Crash 500 Index</option>
                                    <option value="CRASH1000">Crash 1000 Index</option>
                                    <option value="stpRNG">Step Index</option>
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
                                    disabled={botStatus.is_running}
                                />
                            </div>
                            <div className="config-item">
                                <label>Take Profit ($)</label>
                                <input
                                    type="number"
                                    value={config.take_profit}
                                    onChange={e => setConfig(prev => ({ ...prev, take_profit: parseFloat(e.target.value) || 1.5 }))}
                                    step="0.1"
                                    disabled={botStatus.is_running}
                                />
                            </div>
                            <div className="config-item">
                                <label>Stop Loss ($)</label>
                                <input
                                    type="number"
                                    value={config.stop_loss}
                                    onChange={e => setConfig(prev => ({ ...prev, stop_loss: parseFloat(e.target.value) || -1 }))}
                                    step="0.1"
                                    disabled={botStatus.is_running}
                                />
                            </div>
                            <div className="config-item">
                                <label>Contract Type</label>
                                <select
                                    value={config.contract_type}
                                    onChange={e => setConfig(prev => ({ ...prev, contract_type: e.target.value as 'rise_fall' | 'higher_lower' }))}
                                    disabled={botStatus.is_running}
                                >
                                    <option value="rise_fall">Rise/Fall (Strict)</option>
                                    <option value="higher_lower">Higher/Lower (Equals)</option>
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
                                    disabled={botStatus.is_running}
                                />
                            </div>
                        </div>

                        {/* Advanced Risk Management */}
                        <div className="risk-management">
                            <h4>🛡️ Risk Management</h4>
                            <div className="risk-options">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={config.use_trailing_stop}
                                        onChange={e => setConfig(prev => ({ ...prev, use_trailing_stop: e.target.checked }))}
                                        disabled={botStatus.is_running}
                                    />
                                    Trailing Stop (${config.trailing_step})
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={config.use_breakeven}
                                        onChange={e => setConfig(prev => ({ ...prev, use_breakeven: e.target.checked }))}
                                        disabled={botStatus.is_running}
                                    />
                                    Breakeven at ${config.breakeven_trigger} profit
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={config.use_10s_filter}
                                        onChange={e => setConfig(prev => ({ ...prev, use_10s_filter: e.target.checked }))}
                                        disabled={botStatus.is_running}
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
                        <div className="control-buttons">
                            <button
                                className={`control-btn ${botStatus.is_running ? 'stop' : 'start'}`}
                                onClick={botStatus.is_running ? stopBot : startBot}
                            >
                                {botStatus.is_running ? '⏹️ Stop Bot' : '▶️ Start Bot'}
                            </button>
                            <button
                                className="control-btn test"
                                onClick={testConnection}
                                disabled={botStatus.is_running}
                            >
                                🔍 Test Connection
                            </button>
                        </div>
                        {!api_base.api && (
                            <div className="api-warning">
                                ⚠️ API not connected. Bot will attempt to connect when started.
                            </div>
                        )}
                    </div>

                    {/* Current Contract */}
                    {botStatus.current_contract && (
                        <div className="current-contract">
                            <h3>📊 Current Contract</h3>
                            <div className="contract-info">
                                <div className="contract-details">
                                    <span>ID: {botStatus.current_contract.id}</span>
                                    <span>Type: {botStatus.current_contract.type}</span>
                                    <span>Direction: {botStatus.current_contract.direction}</span>
                                    <span>Entry: {botStatus.current_contract.entry_price.toFixed(5)}</span>
                                </div>
                                <div className={`profit-display ${botStatus.current_contract.profit >= 0 ? 'positive' : 'negative'}`}>
                                    P&L: ${botStatus.current_contract.profit.toFixed(2)}
                                </div>
                            </div>
                            <div className="risk-status">
                                {config.use_trailing_stop && (
                                    <span>Trailing Stop: {botStatus.current_contract.trailing_stop.toFixed(5)}</span>
                                )}
                                {botStatus.current_contract.breakeven_active && (
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
                        <div className={`alignment-status ${botStatus.alignment_status}`}>
                            <div 
                                className="alignment-indicator"
                                style={{ backgroundColor: getAlignmentColor(botStatus.alignment_status) }}
                            >
                                {botStatus.alignment_status.replace('_', ' ').toUpperCase()}
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
                                <span className="stat-value">{botStatus.total_trades}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Win Rate</span>
                                <span className="stat-value">
                                    {botStatus.total_trades > 0 
                                        ? ((botStatus.winning_trades / botStatus.total_trades) * 100).toFixed(1) 
                                        : 0}%
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Total P&L</span>
                                <span className={`stat-value ${botStatus.total_pnl >= 0 ? 'positive' : 'negative'}`}>
                                    ${botStatus.total_pnl.toFixed(2)}
                                </span>
                            </div>
                        </div>
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