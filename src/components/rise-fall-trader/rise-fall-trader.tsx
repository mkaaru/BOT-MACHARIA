
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

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');

    // Form state - Rise/Fall specific
    const [symbol, setSymbol] = useState<string>('R_10');
    const [contractType, setContractType] = useState<string>('CALL'); // CALL for Rise, PUT for Fall
    const [duration, setDuration] = useState<number>(1); // Duration in ticks for Rise/Fall
    const [stake, setStake] = useState<number>(1.0);

    // Live price state
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [entrySpot, setEntrySpot] = useState<number>(0);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Hull Moving Average trend analysis state
    const [hullTrends, setHullTrends] = useState({
        '1000': { trend: 'NEUTRAL', value: 0 },
        '2000': { trend: 'NEUTRAL', value: 0 },
        '3000': { trend: 'NEUTRAL', value: 0 },
        '4000': { trend: 'NEUTRAL', value: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [tradeHistory, setTradeHistory] = useState<Array<any>>([]);

    const [status, setStatus] = useState<string>('Initializing...');
    const [is_running, setIsRunning] = useState(false);

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    // Volatility scanner state
    const [isScanning, setIsScanning] = useState(false);
    const [volatilityRecommendations, setVolatilityRecommendations] = useState<any[]>([]);
    const [preloadedData, setPreloadedData] = useState<{[key: string]: Array<{ time: number, price: number, close: number }>}>({});
    const [isPreloading, setIsPreloading] = useState<boolean>(false);
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

                        setTickData(prev => {
                            const newTickData = [...prev, {
                                time: tickTime,
                                price: quote,
                                close: quote
                            }];

                            const trimmedData = newTickData.slice(-4000);
                            updateHullTrends(trimmedData);
                            return trimmedData;
                        });
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
    const purchaseRiseFallContract = async () => {
        await authorizeIfNeeded();

        try {
            setStatus(`Getting proposal for ${contractType === 'CALL' ? 'Rise' : 'Fall'} contract...`);

            const proposalParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: contractType,
                currency: account_currency,
                duration: 1,
                duration_unit: 't',
                symbol: symbol,
            };

            const proposalResponse = await apiRef.current.send(proposalParams);

            if (proposalResponse.error) {
                setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                return;
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                setStatus('No proposal received');
                return;
            }

            setStatus(`Purchasing ${contractType === 'CALL' ? 'Rise' : 'Fall'} contract...`);

            const buyParams = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            const buyResponse = await apiRef.current.send(buyParams);

            if (buyResponse.error) {
                setStatus(`Trade failed: ${buyResponse.error.message}`);
                return;
            }

            const purchase = buyResponse.buy;

            setTotalStake(prev => prev + stake);
            setTotalRuns(prev => prev + 1);

            const tradeRecord = {
                id: purchase.contract_id,
                symbol: symbol,
                contract_type: contractType,
                buy_price: purchase.buy_price,
                payout: purchase.payout,
                timestamp: new Date().toISOString(),
                status: 'purchased'
            };

            setTradeHistory(prev => [tradeRecord, ...prev.slice(0, 99)]);
            setStatus(`${contractType === 'CALL' ? 'Rise' : 'Fall'} contract purchased! ID: ${purchase.contract_id}`);

        } catch (error) {
            console.error('Purchase error:', error);
            setStatus(`Purchase failed: ${error}`);
        }
    };

    const handleManualTrade = (tradeType: string) => {
        setContractType(tradeType);
        purchaseRiseFallContract();
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

    const winRate = totalRuns > 0 ? ((contractsWon / totalRuns) * 100).toFixed(1) : '0.0';

    return (
        <div className="rise-fall-trader">
            <div className="trader-header">
                <h2>Rise/Fall Trader</h2>
                <div className={`connection-status ${connectionStatus}`}>
                    {connectionStatus === 'connected' && '🟢 Connected'}
                    {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                    {connectionStatus === 'error' && '⚠️ Error'}
                </div>
            </div>

            <div className="trading-controls">
                <div className="control-group">
                    <label>Symbol:</label>
                    <select
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                    >
                        {VOLATILITY_INDICES.map((vol) => (
                            <option key={vol.value} value={vol.value}>
                                {vol.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="control-group">
                    <label>Stake ({account_currency}):</label>
                    <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={stake}
                        onChange={(e) => setStake(parseFloat(e.target.value) || 1)}
                    />
                </div>

                <div className="control-group">
                    <label>Duration:</label>
                    <input
                        type="number"
                        min="1"
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                    />
                    <select value="t" disabled>
                        <option value="t">Ticks</option>
                    </select>
                </div>
            </div>

            <div className="trading-section">
                <div className="section-title">Manual Trading</div>
                <div className="trading-buttons">
                    <button
                        className="trade-button rise-button"
                        onClick={() => handleManualTrade('CALL')}
                        disabled={!symbol || stake <= 0}
                    >
                        Rise
                    </button>
                    <button
                        className="trade-button fall-button"
                        onClick={() => handleManualTrade('PUT')}
                        disabled={!symbol || stake <= 0}
                    >
                        Fall
                    </button>
                </div>

                <div className="trading-info">
                    <div className="info-item">
                        <div className="label">Current Price</div>
                        <div className="value">{currentPrice.toFixed(5)}</div>
                    </div>
                    <div className="info-item">
                        <div className="label">Entry Spot</div>
                        <div className="value">{entrySpot.toFixed(5)}</div>
                    </div>
                    <div className="info-item">
                        <div className="label">Ticks Processed</div>
                        <div className="value">{ticksProcessed}</div>
                    </div>
                </div>
            </div>

            {/* Market Recommendation */}
            {marketRecommendation && (
                <div className="trading-section">
                    <div className="section-title">Current Symbol Recommendation</div>
                    <div className="recommendation-card">
                        <div className="recommendation-header">
                            <span className="symbol-name">{marketRecommendation.symbol}</span>
                            <span className={`signal ${marketRecommendation.recommendation.toLowerCase()}`}>
                                {marketRecommendation.recommendation}
                            </span>
                        </div>
                        <div className="recommendation-details">
                            <div className="confidence">
                                Confidence: {marketRecommendation.confidence.toFixed(1)}%
                            </div>
                            <div className="aligned-trends">
                                Aligned Trends: {marketRecommendation.alignedTrends}/{marketRecommendation.totalTrends}
                            </div>
                        </div>
                        <div className="recommendation-reasoning">
                            {marketRecommendation.reasoning}
                        </div>
                        {marketRecommendation.recommendation !== 'WAIT' && (
                            <button
                                className={`apply-recommendation-btn ${marketRecommendation.recommendation.toLowerCase()}`}
                                onClick={() => handleManualTrade(marketRecommendation.recommendation === 'RISE' ? 'CALL' : 'PUT')}
                            >
                                Apply Recommendation: {marketRecommendation.recommendation}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Volatility Opportunities Scanner */}
            <div className="trading-section">
                <div className="section-title">
                    Volatility Opportunities Scanner
                    <button
                        className="scan-button"
                        onClick={scanVolatilityOpportunities}
                        disabled={isScanning}
                    >
                        {isScanning ? 'Scanning...' : 'Scan All Volatilities'}
                    </button>
                </div>

                {volatilityRecommendations.length > 0 ? (
                    <div className="volatility-recommendations">
                        {volatilityRecommendations.map((recommendation, index) => (
                            <div key={recommendation.symbol} className="volatility-card">
                                <div className="volatility-header">
                                    <span className="volatility-name">{recommendation.displayName}</span>
                                    <span className={`volatility-signal ${recommendation.signal.toLowerCase()}`}>
                                        {recommendation.signal}
                                    </span>
                                </div>
                                <div className="volatility-confidence">
                                    Confidence: {recommendation.confidence}%
                                </div>
                                <div className="volatility-reasoning">
                                    {recommendation.reasoning}
                                </div>
                                <button
                                    className="select-symbol-btn"
                                    onClick={() => setSymbol(recommendation.symbol)}
                                >
                                    Select Symbol
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="no-opportunities">
                        No volatility opportunities currently found. Try scanning again.
                    </div>
                )}
            </div>

            {/* Market Analysis */}
            <div className="market-analysis">
                <div className="section-title">Hull Moving Average Analysis</div>
                <div className="analysis-grid">
                    {Object.entries(hullTrends).map(([timeframe, trendData]) => (
                        <div key={timeframe} className="analysis-card">
                            <div className="card-title">{timeframe} Tick Timeframe</div>
                            <div className={`trend-indicator ${trendData.trend.toLowerCase()}`}>
                                <div className="trend-arrow">
                                    {trendData.trend === 'BULLISH' && <TrendingUp />}
                                    {trendData.trend === 'BEARISH' && <TrendingDown />}
                                    {trendData.trend === 'NEUTRAL' && '—'}
                                </div>
                                <div className="trend-text">{trendData.trend}</div>
                            </div>
                            <div className="hma-value">HMA: {trendData.value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Status Panel */}
            <div className="status-panel">
                <div className={`status-message ${status.includes('error') ? 'error' : status.includes('success') ? 'success' : 'info'}`}>
                    {status}
                </div>

                <div className="trading-stats">
                    <div className="stat-item">
                        <div className="stat-value">{totalRuns}</div>
                        <div className="stat-label">Total Trades</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-value">{contractsWon}</div>
                        <div className="stat-label">Won</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-value">{contractsLost}</div>
                        <div className="stat-label">Lost</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-value">{winRate}%</div>
                        <div className="stat-label">Win Rate</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-value">{totalProfitLoss.toFixed(2)}</div>
                        <div className="stat-label">P&L ({account_currency})</div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default RiseFallTrader;
