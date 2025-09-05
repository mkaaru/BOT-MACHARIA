import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import './rise-fall-trader.scss';

// Volatility indices for Rise/Fall trading - only plain volatilities and 1-second volatilities
const VOLATILITY_INDICES = [
  // Plain volatility indices
  { value: 'R_10', label: 'Volatility 10 Index' },
  { value: 'R_25', label: 'Volatility 25 Index' },
  { value: 'R_50', label: 'Volatility 50 Index' },
  { value: 'R_75', label: 'Volatility 75 Index' },
  { value: 'R_100', label: 'Volatility 100 Index' },
  // 1-second volatility indices
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

const RiseFallTrader = observer(() => {
    const store = useStore();
    const { client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const autoTradingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const lastTradeResultRef = useRef<'WIN' | 'LOSS' | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');

    // Form state - Rise/Fall specific
    const [symbol, setSymbol] = useState<string>('R_10');
    const [contractType, setContractType] = useState<string>('CALL'); // CALL for Rise, PUT for Fall
    const [duration, setDuration] = useState<number>(1); // Duration in ticks for Rise/Fall
    const [stake, setStake] = useState<number>(1.0);
    const [martingaleRuns, setMartingaleRuns] = useState<number>(5); // Number of martingale steps
    const [stopLoss, setStopLoss] = useState<number>(100); // Stop loss in currency units
    const [takeProfit, setTakeProfit] = useState<number>(100); // Take profit in currency units
    const [baseStake, setBaseStake] = useState<number>(1.0); // Base stake for martingale
    const [currentMartingaleCount, setCurrentMartingaleCount] = useState<number>(0); // Current martingale step
    const [isAutoTrading, setIsAutoTrading] = useState<boolean>(false);

    // Live price state
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [entrySpot, setEntrySpot] = useState<number>(0);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Volatility scanner state
    const [isScanning, setIsScanning] = useState(false);
    const [volatilityRecommendations, setVolatilityRecommendations] = useState<any[]>([]);
    const [preloadedData, setPreloadedData] = useState<{[key: string]: Array<{ time: number, price: number, close: number }>}>({});

    // Hull Moving Average trend analysis state
    const [hullTrends, setHullTrends] = useState({
        '1000': { trend: 'NEUTRAL', value: 0 },
        '2000': { trend: 'NEUTRAL', value: 0 },
        '3000': { trend: 'NEUTRAL', value: 0 },
        '4000': { trend: 'NEUTRAL', value: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [tradeHistory, setTradeHistory] = useState<Array<any>>([]);

    // Volatility analysis state
    const [risePercentage, setRisePercentage] = useState<number>(0);
    const [fallPercentage, setFallPercentage] = useState<number>(0);
    const [tickStream, setTickStream] = useState<Array<{ time: number, price: number, direction: 'R' | 'F' | 'N' }>>([]);

    const [status, setStatus] = useState<string>('Initializing...');
    const [is_running, setIsRunning] = useState(false);

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    const [marketRecommendation, setMarketRecommendation] = useState<any>(null);

    // --- Helper Functions ---

    // Hull Moving Average calculation
    const calculateHMA = (data: number[], period: number) => {
        if (data.length < period) return null;

        const calculateWMA = (values: number[], periods: number) => {
            if (values.length < periods) return null;
            const weights = Array.from({length: periods}, (_, i) => i + 1);
            const weightSum = weights.reduce((sum, w) => sum + w, 0);
            const recentValues = values.slice(-periods);
            const weightedSum = recentValues.reduce((sum, val, i) => sum + val * weights[i], 0);
            return weightedSum / weightSum;
        };

        const halfPeriod = Math.floor(period / 2);
        const wmaHalf = calculateWMA(data, halfPeriod);
        const wmaFull = calculateWMA(data, period);

        if (wmaHalf === null || wmaFull === null) return null;

        const rawHMA = 2 * wmaHalf - wmaFull;
        return rawHMA;
    };

    // Update Hull trends
    const updateHullTrends = (newTickData: Array<{ time: number, price: number, close: number }>) => {
        const newTrends = { ...hullTrends };

        const timeframeConfigs = {
            '1000': { requiredTicks: 1000, updateEvery: 10 },
            '2000': { requiredTicks: 2000, updateEvery: 15 },
            '3000': { requiredTicks: 3000, updateEvery: 20 },
            '4000': { requiredTicks: 4000, updateEvery: 25 }
        };

        Object.entries(timeframeConfigs).forEach(([tickCountStr, config]) => {
            const recentTicks = newTickData.slice(-config.requiredTicks);

            if (recentTicks.length >= Math.min(50, config.requiredTicks)) {
                const tickPrices = recentTicks.map(tick => tick.price);
                const hmaPeriod = Math.max(8, Math.min(Math.floor(tickPrices.length * 0.3), 25));
                const hmaValue = calculateHMA(tickPrices, hmaPeriod);

                if (hmaValue !== null) {
                    let trend = 'NEUTRAL';
                    const currentPrice = tickPrices[tickPrices.length - 1];
                    const priceAboveHMA = currentPrice > hmaValue;

                    const hmaSlopeLookback = Math.max(3, Math.floor(hmaPeriod / 4));
                    const prevHMA = calculateHMA(tickPrices.slice(0, -hmaSlopeLookback), hmaPeriod);
                    const hmaSlope = prevHMA !== null ? hmaValue - prevHMA : 0;

                    const priceRange = Math.max(...tickPrices.slice(-50)) - Math.min(...tickPrices.slice(-50));
                    const slopeThreshold = priceRange * 0.001;

                    if (hmaSlope > slopeThreshold && priceAboveHMA) {
                        trend = 'BULLISH';
                    } else if (hmaSlope < -slopeThreshold && !priceAboveHMA) {
                        trend = 'BEARISH';
                    }

                    newTrends[tickCountStr as keyof typeof hullTrends] = {
                        trend,
                        value: Number(hmaValue.toFixed(5))
                    };
                }
            }
        });

        setHullTrends(newTrends);
    };

    // Update Rise/Fall percentages and tick stream direction
    const updateVolatilityAnalysis = (currentTickPrice: number, entryTickPrice: number) => {
        setTickStream(prev => {
            const direction = currentTickPrice > entryTickPrice ? 'R' : currentTickPrice < entryTickPrice ? 'F' : 'N';
            const newStream = [...prev, { time: Date.now(), price: currentTickPrice, direction }];
            return newStream.slice(-20); // Keep only the last 20 ticks for display
        });

        setTickData(prev => {
            const newTickData = [...prev, { time: Date.now(), price: currentTickPrice, close: currentTickPrice }];
            const trimmedData = newTickData.slice(-4000);
            updateHullTrends(trimmedData);
            return trimmedData;
        });

        // Calculate rise/fall percentages based on the last N ticks or a defined period
        const recentTicksForPercentage = tickData.slice(-100); // Analyze last 100 ticks for percentage
        if (recentTicksForPercentage.length > 1) {
            let rises = 0;
            let falls = 0;
            for (let i = 1; i < recentTicksForPercentage.length; i++) {
                if (recentTicksForPercentage[i].price > recentTicksForPercentage[i - 1].price) {
                    rises++;
                } else if (recentTicksForPercentage[i].price < recentTicksForPercentage[i - 1].price) {
                    falls++;
                }
            }
            const totalChanges = rises + falls;
            if (totalChanges > 0) {
                setRisePercentage((rises / totalChanges) * 100);
                setFallPercentage((falls / totalChanges) * 100);
            } else {
                setRisePercentage(50);
                setFallPercentage(50);
            }
        } else {
            setRisePercentage(50);
            setFallPercentage(50);
        }
    };


    // Fetch historical tick data
    const fetchHistoricalTicks = async (symbolToFetch: string) => {
        try {
            const request = {
                ticks_history: symbolToFetch,
                adjust_start_time: 1,
                count: 4000,
                end: "latest",
                start: 1,
                style: "ticks"
            };

            const response = await apiRef.current.send(request);

            if (response.error) {
                console.error('Historical ticks fetch error:', response.error);
                return;
            }

            if (response.history && response.history.prices && response.history.times) {
                const historicalData = response.history.prices.map((price: string, index: number) => ({
                    time: response.history.times[index] * 1000,
                    price: parseFloat(price),
                    close: parseFloat(price)
                }));

                setTickData(prev => {
                    const combinedData = [...historicalData, ...prev];
                    const uniqueData = combinedData.filter((tick, index, arr) =>
                        arr.findIndex(t => t.time === tick.time) === index
                    ).sort((a, b) => a.time - b.time);

                    const trimmedData = uniqueData.slice(-4000);
                    updateHullTrends(trimmedData);
                    return trimmedData;
                });
            }
        } catch (error) {
            console.error('Error fetching historical ticks:', error);
        }
    };

    // Initialize API and preload data
    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;

        const init = async () => {
            try {
                setConnectionStatus('connected');
                setStatus('Connected to Deriv API');

                // Fetch historical data for default symbol
                await fetchHistoricalTicks(symbol);
                startTicks(symbol);
            } catch (e: any) {
                console.error('RiseFallTrader init error', e);
                setStatus(e?.message || 'Failed to initialize');
                setConnectionStatus('error');
            }
        };

        init();

        return () => {
            try {
                if (tickStreamIdRef.current) {
                    apiRef.current?.forget({ forget: tickStreamIdRef.current });
                    tickStreamIdRef.current = null;
                }
                if (messageHandlerRef.current) {
                    apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                    messageHandlerRef.current = null;
                }
                api?.disconnect?.();
            } catch { /* noop */ }
        };
    }, []);

    // Effect to fetch historical data when symbol changes
    useEffect(() => {
        if (symbol && apiRef.current) {
            fetchHistoricalTicks(symbol);
            startTicks(symbol);
        }
    }, [symbol]);

    const authorizeIfNeeded = async () => {
        if (is_authorized) return;
        const token = V2GetActiveToken();
        if (!token) {
            setStatus('No token found. Please log in and select an account.');
            throw new Error('No token');
        }
        const response = await apiRef.current.authorize(token);
        if (response.error) {
            setStatus(`Authorization error: ${response.error.message || response.error.code}`);
            throw response.error;
        }
        setIsAuthorized(true);
        setAccountCurrency(response.authorize?.currency || 'USD');
        setBaseStake(stake); // Set base stake on successful authorization
    };

    const stopTicks = () => {
        try {
            if (tickStreamIdRef.current) {
                apiRef.current?.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }
            if (messageHandlerRef.current) {
                apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                messageHandlerRef.current = null;
            }
        } catch {}
    };

    const startTicks = async (sym: string) => {
        stopTicks();
        setTicksProcessed(0);

        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const tickTime = data.tick.epoch * 1000;

                        setCurrentPrice(quote);
                        setEntrySpot(quote);
                        setTicksProcessed(prev => prev + 1);

                        updateVolatilityAnalysis(quote, entrySpot); // Update volatility analysis

                        // Process trade result if auto-trading
                        if (isAutoTrading && lastTradeResultRef.current) {
                            handleAutoTradeCompletion(lastTradeResultRef.current, quote);
                        }
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    // Purchase Rise/Fall contract
    const purchaseRiseFallContract = async (type: 'CALL' | 'PUT') => {
        await authorizeIfNeeded();

        try {
            setStatus(`Getting proposal for ${type === 'CALL' ? 'Rise' : 'Fall'} contract...`);

            const proposalParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: type,
                currency: account_currency,
                duration: 1,
                duration_unit: 't',
                symbol: symbol,
            };

            const proposalResponse = await apiRef.current.send(proposalParams);

            if (proposalResponse.error) {
                setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                return { success: false, error: proposalResponse.error };
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                setStatus('No proposal received');
                return { success: false, error: 'No proposal received' };
            }

            setStatus(`Purchasing ${type === 'CALL' ? 'Rise' : 'Fall'} contract...`);

            const buyParams = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            const buyResponse = await apiRef.current.send(buyParams);

            if (buyResponse.error) {
                setStatus(`Trade failed: ${buyResponse.error.message}`);
                return { success: false, error: buyResponse.error };
            }

            const purchase = buyResponse.buy;

            setTotalStake(prev => prev + stake);
            setTotalRuns(prev => prev + 1);

            const tradeRecord = {
                id: purchase.contract_id,
                symbol: symbol,
                contract_type: type,
                buy_price: purchase.buy_price,
                payout: purchase.payout,
                timestamp: new Date().toISOString(),
                status: 'purchased'
            };

            setTradeHistory(prev => [tradeRecord, ...prev.slice(0, 99)]);
            setStatus(`${type === 'CALL' ? 'Rise' : 'Fall'} contract purchased! ID: ${purchase.contract_id}`);

            return { success: true, data: purchase };

        } catch (error: any) {
            console.error('Purchase error:', error);
            setStatus(`Purchase failed: ${error.message}`);
            return { success: false, error: error };
        }
    };

    const handleManualTrade = async (tradeType: 'CALL' | 'PUT') => {
        setContractType(tradeType);
        const result = await purchaseRiseFallContract(tradeType);
        if (result.success) {
            // For manual trades, we don't track martingale or auto-trading status here.
            // The result of the trade (win/loss) will be handled in a separate 'sell' event or by polling.
        }
    };

    // Get market recommendation based on Hull trends
    const getMarketRecommendation = () => {
        if (Object.keys(hullTrends).length === 0) return null;

        const trendCounts = {
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0
        };

        Object.entries(hullTrends).forEach(([, trendData]) => {
            const { trend } = trendData;
            if (trend === 'BULLISH') trendCounts.bullishCount++;
            else if (trend === 'BEARISH') trendCounts.bearishCount++;
            else trendCounts.neutralCount++;
        });

        const totalTrends = Object.keys(hullTrends).length;
        const alignedBullish = trendCounts.bullishCount;
        const alignedBearish = trendCounts.bearishCount;

        let recommendation: 'RISE' | 'FALL' | 'WAIT' = 'WAIT';
        let confidence = 0;

        if (alignedBullish >= 3) {
            recommendation = 'RISE';
            confidence = Math.min(95, (alignedBullish / totalTrends) * 100);
        } else if (alignedBearish >= 3) {
            recommendation = 'FALL';
            confidence = Math.min(95, (alignedBearish / totalTrends) * 100);
        } else if (alignedBullish === 2 && alignedBearish <= 1) {
            recommendation = 'RISE';
            confidence = 65;
        } else if (alignedBearish === 2 && alignedBullish <= 1) {
            recommendation = 'FALL';
            confidence = 65;
        }

        return {
            symbol,
            recommendation,
            confidence,
            alignedTrends: Math.max(alignedBullish, alignedBearish),
            totalTrends,
            reasoning: `${alignedBullish} bullish, ${alignedBearish} bearish, ${trendCounts.neutralCount} neutral trends detected.`
        };
    };

    // Update market recommendation when trends change
    useEffect(() => {
        const recommendation = getMarketRecommendation();
        setMarketRecommendation(recommendation);
    }, [hullTrends, symbol]);

    // Scan volatility opportunities
    const scanVolatilityOpportunities = async () => {
        if (!apiRef.current || isScanning) return;

        setIsScanning(true);
        setStatus('Scanning volatility opportunities...');

        const opportunities: any[] = [];

        try {
            for (const volatilityIndex of VOLATILITY_INDICES) {
                const symbolData = preloadedData[volatilityIndex.value];
                if (!symbolData || symbolData.length < 1000) continue;

                // Calculate trends for this symbol (simplified)
                const recentPrices = symbolData.slice(-1000).map(tick => tick.price);
                const hmaValue = calculateHMA(recentPrices, 20);

                if (hmaValue !== null) {
                    const currentPrice = recentPrices[recentPrices.length - 1];
                    const trend = currentPrice > hmaValue ? 'BULLISH' : 'BEARISH';
                    const confidence = Math.random() * 40 + 60; // Mock confidence

                    if (confidence >= 65) {
                        opportunities.push({
                            symbol: volatilityIndex.value,
                            displayName: volatilityIndex.label,
                            confidence: Math.round(confidence),
                            signal: trend === 'BULLISH' ? 'RISE' : 'FALL',
                            reasoning: `HMA analysis suggests ${trend.toLowerCase()} momentum`
                        });
                    }
                }
            }

            opportunities.sort((a, b) => b.confidence - a.confidence);
            setVolatilityRecommendations(opportunities.slice(0, 5));

        } catch (error) {
            console.error('Error scanning volatility opportunities:', error);
        } finally {
            setIsScanning(false);
            setStatus('Volatility scan completed');
        }
    };

    // Auto Trading Logic
    const startAutoTrading = async () => {
        if (!symbol || stake <= 0) {
            setStatus('Please select a symbol and set a valid stake.');
            return;
        }
        await authorizeIfNeeded();
        setIsAutoTrading(true);
        setBaseStake(stake); // Set base stake when starting auto-trading
        setCurrentMartingaleCount(0); // Reset martingale count
        setStatus('Auto trading started...');
        executeNextContract();
    };

    const stopAutoTrading = () => {
        setIsAutoTrading(false);
        if (autoTradingIntervalRef.current) {
            clearInterval(autoTradingIntervalRef.current);
            autoTradingIntervalRef.current = null;
        }
        setStatus('Auto trading stopped.');
    };

    const executeNextContract = async () => {
        if (!isAutoTrading) return;

        const currentStake = calculateMartingaleStake();
        if (currentStake <= 0) {
            setStatus('Stake is too low to continue auto-trading. Stopping.');
            stopAutoTrading();
            return;
        }
        setStake(currentStake); // Update the stake input for visibility

        const contractTypeToTrade = marketRecommendation?.recommendation === 'RISE' ? 'CALL' :
                                   marketRecommendation?.recommendation === 'FALL' ? 'PUT' :
                                   Math.random() < 0.5 ? 'CALL' : 'PUT'; // Default to random if no recommendation

        const purchaseResult = await purchaseRiseFallContract(contractTypeToTrade as any);

        if (purchaseResult.success) {
            lastTradeResultRef.current = null; // Reset last trade result until outcome is known
            // The result of the trade will be determined when the 'sell' event is received or by polling
            // For now, we just recorded the purchase.
            setStatus(`Contract purchased: ${contractTypeToTrade === 'CALL' ? 'Rise' : 'Fall'} (Stake: ${currentStake.toFixed(2)})`);
        } else {
            // If purchase failed, maybe retry or stop
            setStatus(`Contract purchase failed. Retrying after a delay...`);
            setTimeout(executeNextContract, 5000); // Retry after 5 seconds
        }
    };

    const calculateMartingaleStake = (): number => {
        if (currentMartingaleCount === 0) return baseStake;

        const previousStake = stake;
        const potentialWinAmount = stake * (1 + (0.9)); // Assuming ~90% payout for simplicity
        const requiredProfit = baseStake; // Target profit is the base stake
        const requiredStake = requiredProfit / 0.9; // Stake needed to achieve required profit

        let nextStake = previousStake * 2; // Double the stake for martingale

        // Ensure stake doesn't exceed limits or stop-loss potential
        if (currentMartingaleCount >= martingaleRuns) {
            setStatus('Maximum martingale runs reached. Resetting stake.');
            setCurrentMartingaleCount(0);
            setStake(baseStake); // Reset to base stake
            return baseStake;
        }

        // Simple check against stop loss - this is a very basic implementation
        if (totalStake + nextStake > stopLoss) {
            setStatus('Next stake exceeds stop loss. Stopping auto-trading.');
            stopAutoTrading();
            return 0; // Indicate that no stake should be placed
        }

        return nextStake;
    };

    const handleAutoTradeCompletion = (result: 'WIN' | 'LOSS', currentTick: number) => {
        if (result === 'WIN') {
            setContractsWon(prev => prev + 1);
            setTotalProfitLoss(prev => prev + stake * 0.9); // Assuming 90% payout
            setStatus('Trade Won!');
            setCurrentMartingaleCount(0); // Reset martingale count on win
            setStake(baseStake); // Reset stake to base
        } else { // LOSS
            setContractsLost(prev => prev + 1);
            setTotalProfitLoss(prev => prev - stake);
            setStatus('Trade Lost.');
            setCurrentMartingaleCount(prev => prev + 1);
            // Stake will be recalculated in the next executeNextContract call based on currentMartingaleCount
        }

        // Check take profit
        if (totalProfitLoss >= takeProfit) {
            setStatus('Take profit reached! Stopping auto-trading.');
            stopAutoTrading();
            return;
        }

        // Schedule the next contract after a short delay
        setTimeout(executeNextContract, 1000); // Wait 1 second before the next trade
        lastTradeResultRef.current = null; // Clear the last trade result
    };

    const winRate = totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : '0.0';

    return (
        <div className="rise-fall-trader">
            <div className="trader-header">
                <h2>Rise/Fall Trader</h2>
                <div className={`connection-status ${connectionStatus}`}>
                    {connectionStatus === 'connected' && '🟢 Connected'}
                    {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                    {connectionStatus === 'error' && '🔴 Error'}
                </div>
            </div>

            <div className="trader-controls">
                <div className="control-group">
                    <label>Symbol:</label>
                    <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                        {VOLATILITY_INDICES.map((idx) => (
                            <option key={idx.value} value={idx.value}>
                                {idx.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="control-group">
                    <label>Duration (Ticks):</label>
                    <input
                        type="number"
                        min="1"
                        max="10"
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value))}
                    />
                </div>

                <div className="control-group">
                    <label>Base Stake ({account_currency}):</label>
                    <input
                        type="number"
                        min="0.35"
                        step="0.01"
                        value={baseStake}
                        onChange={(e) => {
                            setBaseStake(parseFloat(e.target.value) || 1);
                            if (!isAutoTrading) setStake(parseFloat(e.target.value) || 1);
                        }}
                    />
                </div>

                <div className="control-group">
                    <label>Martingale Runs:</label>
                    <input
                        type="number"
                        min="1"
                        max="20"
                        value={martingaleRuns}
                        onChange={(e) => setMartingaleRuns(parseInt(e.target.value))}
                    />
                </div>

                <div className="control-group">
                    <label>Stop Loss ({account_currency}):</label>
                    <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(parseFloat(e.target.value))}
                    />
                </div>

                <div className="control-group">
                    <label>Take Profit ({account_currency}):</label>
                    <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={takeProfit}
                        onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
                    />
                </div>
            </div>

            <div className="live-data">
                <div className="price-display">
                    <Text size="sm" weight="bold">Current Price: {currentPrice.toFixed(5)}</Text>
                    <Text size="sm">Ticks Processed: {ticksProcessed}</Text>
                </div>

                {/* Rise/Fall Analytics borrowed from volatility analyzer */}
                <div className="rise-fall-analytics">
                    <h3>Rise/Fall Analysis</h3>
                    <div className="analytics-grid">
                        <div className="analytics-item">
                            <div className="progress-item">
                                <div className="progress-label">
                                    <span>Rise</span>
                                    <span className="progress-percentage">{risePercentage.toFixed(1)}%</span>
                                </div>
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{
                                            width: `${risePercentage}%`,
                                            backgroundColor: '#4CAF50'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="analytics-item">
                            <div className="progress-item">
                                <div className="progress-label">
                                    <span>Fall</span>
                                    <span className="progress-percentage">{fallPercentage.toFixed(1)}%</span>
                                </div>
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{
                                            width: `${fallPercentage}%`,
                                            backgroundColor: '#f44336'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tick Stream Display */}
                <div className="tick-stream">
                    <h4>Last 10 Ticks Pattern:</h4>
                    <div className="pattern-grid">
                        {tickStream.slice(-10).map((tick, index) => (
                            <div
                                key={index}
                                className={`digit-item ${tick.direction === 'R' ? 'rise' : tick.direction === 'F' ? 'fall' : 'neutral'}`}
                            >
                                {tick.direction}
                            </div>
                        ))}
                    </div>
                    <div className="pattern-info">
                        Recent pattern: {tickStream.slice(-10).map(t => t.direction).join('')}
                    </div>
                </div>
            </div>

            <div className="hull-trends">
                <h3>Hull Moving Average Trend Analysis</h3>
                <div className="trends-grid">
                    {Object.entries(hullTrends).map(([timeframe, data]) => (
                        <div key={timeframe} className={`trend-item trend-${data.trend.toLowerCase()}`}>
                            <Text size="xs" weight="bold">{timeframe} Ticks: {data.trend}</Text>
                            <Text size="xs">HMA: {data.value}</Text>
                        </div>
                    ))}
                </div>
            </div>

            {marketRecommendation && (
                <div className="market-recommendation">
                    <div className={`recommendation-card recommendation-${marketRecommendation.recommendation.toLowerCase()}`}>
                        <Text size="sm" weight="bold">Market Recommendation: {marketRecommendation.recommendation}</Text>
                        <Text size="xs">Confidence: {marketRecommendation.confidence}%</Text>
                        <Text size="xs">Signal: {marketRecommendation.signal}</Text>
                    </div>
                </div>
            )}

            <div className="trading-buttons">
                <button
                    className={`trade-btn auto-trade-btn ${isAutoTrading ? 'trading-active' : ''}`}
                    onClick={isAutoTrading ? stopAutoTrading : startAutoTrading}
                    disabled={!symbol}
                >
                    {isAutoTrading ? (
                        <>
                            <Square size={16} />
                            Stop Auto Trading
                        </>
                    ) : (
                        <>
                            <Play size={16} />
                            Start Auto Trading
                        </>
                    )}
                </button>

                <button
                    className="trade-btn rise-btn manual-trade-btn"
                    onClick={() => handleManualTrade('CALL')}
                    disabled={is_running || isAutoTrading}
                >
                    <TrendingUp size={16} />
                    Rise (Manual)
                </button>
                <button
                    className="trade-btn fall-btn manual-trade-btn"
                    onClick={() => handleManualTrade('PUT')}
                    disabled={is_running || isAutoTrading}
                >
                    <TrendingDown size={16} />
                    Fall (Manual)
                </button>
            </div>

            {/* Martingale Status */}
            {isAutoTrading && (
                <div className="martingale-status">
                    <Text size="sm">Martingale Count: {currentMartingaleCount}/{martingaleRuns}</Text>
                    <Text size="sm">Current Stake: ${stake.toFixed(2)}</Text>
                    <Text size="sm">Base Stake: ${baseStake.toFixed(2)}</Text>
                </div>
            )}

            <div className="trade-history">
                <h3>Recent Trades</h3>
                <div className="history-list">
                    {tradeHistory.slice(0, 5).map((trade, index) => (
                        <div key={index} className="history-item">
                            <Text size="xs">
                                {trade.contract_type === 'CALL' ? '⬆️' : '⬇️'} {trade.symbol} -
                                ${trade.buy_price} (Payout: ${trade.payout})
                            </Text>
                        </div>
                    ))}
                </div>
            </div>

            <div className="trading-stats">
                <div className="stats-grid">
                    <div className="stat-item">
                        <Text size="xs" weight="bold">Total Stake: ${totalStake.toFixed(2)}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" weight="bold">Total Payout: ${totalPayout.toFixed(2)}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" weight="bold">Total Runs: {totalRuns}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" weight="bold">Won: {contractsWon}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" weight="bold">Lost: {contractsLost}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs" weight="bold">P&L: ${totalProfitLoss.toFixed(2)}</Text>
                    </div>
                </div>
            </div>

            {status && (
                <div className="status-message">
                    <Text size="sm">{status}</Text>
                </div>
            )}
        </div>
    );
});

export default RiseFallTrader;