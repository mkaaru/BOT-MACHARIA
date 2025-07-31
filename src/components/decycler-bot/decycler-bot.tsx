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

    const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h'];

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

    // Fetch OHLC data for a specific timeframe
    const fetchOHLCData = useCallback(async (timeframe: string): Promise<any[]> => {
        try {
            // Ensure API connection is ready
            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog('🔄 API connection not ready, initializing...');
                await api_base.init();
                
                // Wait for connection to be established
                let retries = 0;
                while ((!api_base.api || api_base.api.connection.readyState !== 1) && retries < 10) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries++;
                }
                
                if (!api_base.api || api_base.api.connection.readyState !== 1) {
                    addLog('❌ Failed to establish API connection for data fetch');
                    return [];
                }
            }

            const granularity = {
                '1m': 60,
                '5m': 300,
                '15m': 900,
                '30m': 1800,
                '1h': 3600,
                '4h': 14400
            }[timeframe] || 60;

            // Check if this is a 1HZ symbol (1-second tick symbols)
            const is1HZSymbol = config.symbol.startsWith('1HZ');
            
            // For 1HZ symbols, we need more ticks to generate meaningful candles
            const tickCount = is1HZSymbol ? granularity * 200 : 100; // More ticks for 1HZ symbols
            const candleCount = is1HZSymbol ? 100 : 100;
            
            let request;
            
            if (is1HZSymbol) {
                // For 1HZ symbols, always request tick data and convert to candles
                addLog(`📍 Detected 1HZ symbol ${config.symbol} - requesting tick data for conversion`);
                request = {
                    ticks_history: config.symbol,
                    count: tickCount,
                    end: 'latest',
                    style: 'ticks',
                    req_id: `ticks_${timeframe}_${Date.now()}`
                };
            } else {
                // For regular symbols, try candles first
                const now = Math.floor(Date.now() / 1000);
                const startTime = now - (candleCount * granularity);
                
                request = {
                    ticks_history: config.symbol,
                    adjust_start_time: 1,
                    count: candleCount,
                    end: 'latest',
                    start: startTime,
                    style: 'candles',
                    granularity: granularity,
                    req_id: `candles_${timeframe}_${Date.now()}`
                };
            }

            addLog(`📡 Requesting ${timeframe} data: ${JSON.stringify(request)}`);
            
            const response = await Promise.race([
                api_base.api.send(request),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout after 15s')), 15000)
                )
            ]);

            if (response.error) {
                addLog(`❌ API error for ${timeframe}: ${response.error.message} (Code: ${response.error.code})`);
                
                // If candles failed, try ticks as fallback for non-1HZ symbols
                if (!is1HZSymbol && response.error.code === 'InputValidationFailed') {
                    addLog(`🔄 Candles not supported for ${config.symbol}, trying tick data...`);
                    
                    const tickRequest = {
                        ticks_history: config.symbol,
                        count: granularity * 150, // More ticks to build candles
                        end: 'latest',
                        style: 'ticks',
                        req_id: `ticks_fallback_${timeframe}_${Date.now()}`
                    };
                    
                    const tickResponse = await api_base.api.send(tickRequest);
                    
                    if (tickResponse.error) {
                        addLog(`❌ Tick fallback also failed: ${tickResponse.error.message}`);
                        return [];
                    }
                    
                    // Process tick response
                    if (tickResponse.history && tickResponse.history.prices && tickResponse.history.times) {
                        const prices = tickResponse.history.prices;
                        const times = tickResponse.history.times;
                        
                        addLog(`📈 Converting ${prices.length} fallback ticks to ${timeframe} candles...`);
                        const candles = convertTicksToCandles(prices, times, granularity);
                        addLog(`✅ Generated ${candles.length} candles from fallback tick data for ${timeframe}`);
                        
                        return candles;
                    }
                }
                
                return [];
            }

            // Check for direct candle response (non-1HZ symbols)
            if (response.candles && Array.isArray(response.candles) && response.candles.length > 0) {
                addLog(`✅ Received ${response.candles.length} candles for ${timeframe}`);
                
                // Validate and format candle data
                const validCandles = response.candles.filter(candle => 
                    candle && 
                    typeof candle.close !== 'undefined' && 
                    !isNaN(parseFloat(candle.close)) &&
                    typeof candle.open !== 'undefined' &&
                    typeof candle.high !== 'undefined' &&
                    typeof candle.low !== 'undefined'
                ).map(candle => ({
                    open: parseFloat(candle.open),
                    high: parseFloat(candle.high),
                    low: parseFloat(candle.low),
                    close: parseFloat(candle.close),
                    epoch: candle.epoch || candle.time
                }));
                
                if (validCandles.length !== response.candles.length) {
                    addLog(`⚠️ Filtered ${response.candles.length - validCandles.length} invalid candles for ${timeframe}`);
                }
                
                return validCandles;
            }
            
            // Check for tick data response (1HZ symbols and fallbacks)
            else if (response.history && response.history.prices && response.history.times) {
                const prices = response.history.prices;
                const times = response.history.times;
                
                addLog(`📈 Converting ${prices.length} ticks to ${timeframe} candles...`);
                
                // Convert tick data to candles
                const candles = convertTicksToCandles(prices, times, granularity);
                addLog(`✅ Generated ${candles.length} candles from tick data for ${timeframe}`);
                
                return candles;
            } else {
                addLog(`⚠️ No candle or tick data in response for ${timeframe}`);
                addLog(`🔍 Response keys: ${Object.keys(response).join(', ')}`);
                return [];
            }
        } catch (error) {
            addLog(`❌ Exception fetching ${timeframe} data: ${error?.message || 'Unknown error'}`);
            return [];
        }
    }, [config.symbol, addLog]);

    // Helper function to convert tick data to candles
    const convertTicksToCandles = useCallback((prices: number[], times: number[], granularity: number): any[] => {
        if (!prices || !times || prices.length !== times.length) {
            return [];
        }

        const candles: any[] = [];
        let currentCandle: any = null;

        for (let i = 0; i < prices.length; i++) {
            const price = prices[i];
            const time = times[i];
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
                    close: price
                };
            } else {
                // Update existing candle
                currentCandle.high = Math.max(currentCandle.high, price);
                currentCandle.low = Math.min(currentCandle.low, price);
                currentCandle.close = price;
            }
        }

        // Add the last candle
        if (currentCandle) {
            candles.push(currentCandle);
        }

        return candles;
    }, []);

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
            }
        }

        addLog(`📋 Multi-timeframe analysis complete: ${trends.length}/${timeframes.length} timeframes processed`);
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
        if (!api_base.api) {
            addLog('❌ API not connected');
            return;
        }

        try {
            const contractTypeMap = {
                rise_fall: direction === 'UP' ? 'CALL' : 'PUT',
                higher_lower: direction === 'UP' ? 'CALLE' : 'PUTE'
            };

            const contractType = contractTypeMap[config.contract_type];

            // Get proposal
            const proposalRequest = {
                proposal: 1,
                amount: config.stake,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration: config.tick_count,
                duration_unit: 't',
                symbol: config.symbol
            };

            addLog(`🔄 Getting proposal for ${contractType} on ${config.symbol}...`);
            const proposalResponse = await api_base.api.send(proposalRequest);

            if (proposalResponse.error) {
                addLog(`❌ Proposal error: ${proposalResponse.error.message}`);
                return;
            }

            const proposalId = proposalResponse.proposal.id;
            const entrySpot = proposalResponse.proposal.spot;

            // Purchase contract
            const buyRequest = {
                buy: proposalId,
                price: config.stake
            };

            addLog(`💰 Purchasing contract ${proposalId}...`);
            const buyResponse = await api_base.api.send(buyRequest);

            if (buyResponse.error) {
                addLog(`❌ Purchase error: ${buyResponse.error.message}`);
                return;
            }

            const contractId = buyResponse.buy.contract_id;
            addLog(`✅ Contract purchased: ${contractId}`);

            // Update contract info
            const newContract: ContractInfo = {
                id: contractId,
                type: contractType,
                entry_price: entrySpot,
                current_price: entrySpot,
                profit: 0,
                status: 'open',
                entry_time: Date.now(),
                direction,
                stop_loss: entrySpot + config.stop_loss,
                take_profit: entrySpot + config.take_profit,
                trailing_stop: config.use_trailing_stop ? entrySpot + config.stop_loss : 0,
                breakeven_active: false
            };

            setBotStatus(prev => ({
                ...prev,
                current_contract: newContract,
                total_trades: prev.total_trades + 1
            }));

            // Start monitoring the contract
            monitorContract(contractId);

        } catch (error) {
            addLog(`❌ Trade execution failed: ${error.message}`);
        }
    }, [config, addLog]);

    // Monitor open contract
    const monitorContract = useCallback(async (contractId: string): Promise<void> => {
        if (!api_base.api) return;

        try {
            const request = {
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            };

            const response = await api_base.api.send(request);

            if (response.error) {
                addLog(`❌ Contract monitoring error: ${response.error.message}`);
                return;
            }

            addLog(`👁️ Monitoring contract ${contractId}`);
        } catch (error) {
            addLog(`❌ Failed to monitor contract: ${error.message}`);
        }
    }, [addLog]);

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

                // Optional 10s confirmation
                if (config.use_10s_filter) {
                    addLog('⏱️ Applying 10-second confirmation filter...');
                    // Add a small delay for confirmation
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                addLog(`🎯 Strong ${direction} alignment detected - Preparing trade execution!`);
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

    // Test API connection
    const testConnection = useCallback(async (): Promise<void> => {
        try {
            addLog('🔍 Testing API connection...');
            
            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog('🔌 Initializing API connection...');
                await api_base.init();
                
                // Wait for connection
                let retries = 0;
                while ((!api_base.api || api_base.api.connection.readyState !== 1) && retries < 10) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries++;
                    addLog(`⏳ Waiting for connection... (${retries}/10)`);
                }
            }
            
            if (!api_base.api || api_base.api.connection.readyState !== 1) {
                addLog('❌ Failed to establish WebSocket connection');
                return;
            }
            
            addLog(`✅ WebSocket connected (Ready State: ${api_base.api.connection.readyState})`);
            
            // Test with a simple time request
            const response = await api_base.api.send({ time: 1 });
            
            if (response.time) {
                addLog(`✅ API communication test successful. Server time: ${new Date(response.time * 1000).toLocaleString()}`);
                
                // Test symbol data availability
                const testData = await fetchOHLCData('1m');
                if (testData.length > 0) {
                    addLog(`✅ Data retrieval test successful. Got ${testData.length} candles for ${config.symbol}`);
                } else {
                    addLog(`⚠️ No data available for symbol ${config.symbol}. Try a different symbol.`);
                }
            } else {
                addLog('❌ API communication test failed');
            }
        } catch (error) {
            addLog(`❌ Connection test failed: ${error.message}`);
        }
    }, [fetchOHLCData, config.symbol, addLog]);

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
                                const trendData = botStatus.trends.find(t => t.timeframe === timeframe);
                                return (
                                    <div key={timeframe} className="trend-item">
                                        <span className="timeframe-label">{timeframe}</span>
                                        <div 
                                            className={`trend-indicator ${trendData?.trend || 'neutral'}`}
                                            style={{ backgroundColor: getTrendColor(trendData?.trend || 'neutral') }}
                                        >
                                            {trendData?.trend?.toUpperCase() || 'LOADING'}
                                        </div>
                                        {trendData && (
                                            <span className="trend-value">{trendData.value.toFixed(5)}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {botStatus.last_update > 0 && (
                            <div className="last-update">
                                Last Update: {new Date(botStatus.last_update).toLocaleTimeString()}
                            </div>
                        )}
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