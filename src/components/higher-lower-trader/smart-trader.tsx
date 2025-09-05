
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

// Minimal trade types we will support initially
const TRADE_TYPES = [
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
];

// Safe version of tradeOptionToBuy without Blockly dependencies
const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis,
            contract_type,
            currency: trade_option.currency,
            duration: trade_option.duration,
            duration_unit: trade_option.duration_unit,
            symbol: trade_option.symbol,
        },
    };

    // Handle digit-based contracts
    if (trade_option.prediction !== undefined && !['CALL', 'PUT'].includes(contract_type)) {
        buy.parameters.selected_tick = trade_option.prediction;
        if (!['TICKLOW', 'TICKHIGH'].includes(contract_type)) {
            buy.parameters.barrier = trade_option.prediction;
        }
    }

    return buy;
};

const SmartTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const lastOutcomeWasLossRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [tradeType, setTradeType] = useState<string>('DIGITOVER');
    const [ticks, setTicks] = useState<number>(1);
    const [duration, setDuration] = useState<number>(46);
    const [durationType, setDurationType] = useState<string>('t');
    const [stake, setStake] = useState<number>(0.5);
    const [baseStake, setBaseStake] = useState<number>(0.5);
    
    // Predictions
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(5);
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(5);
    const [mdPrediction, setMdPrediction] = useState<number>(5);
    
    // Higher/Lower barrier
    const [barrier, setBarrier] = useState<string>('+0.37');
    
    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(1.0);

    // Contract tracking state
    const [currentProfit, setCurrentProfit] = useState<number>(0);
    const [contractValue, setContractValue] = useState<number>(0);
    const [potentialPayout, setPotentialPayout] = useState<number>(0);
    const [contractDuration, setContractDuration] = useState<string>('00:00:00');

    // Live digits state
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Hull Moving Average trend analysis state
    const [hullTrends, setHullTrends] = useState({
        '15s': { trend: 'NEUTRAL', value: 0 },
        '1m': { trend: 'NEUTRAL', value: 0 },
        '5m': { trend: 'NEUTRAL', value: 0 },
        '15m': { trend: 'NEUTRAL', value: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [allVolatilitiesData, setAllVolatilitiesData] = useState<Record<string, Array<{ time: number, price: number, close: number }>>>({});

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    // New State Variables for Run Panel Integration
    const [isTrading, setIsTrading] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [websocket, setWebsocket] = useState<any>(null);
    const [autoExecute, setAutoExecute] = useState(false);
    const [tickHistory, setTickHistory] = useState<Array<{ time: number, price: number }>([]);

    // Helper Functions
    const getHintClass = (d: number) => {
        if (tradeType === 'DIGITEVEN') return d % 2 === 0 ? 'is-green' : 'is-red';
        if (tradeType === 'DIGITODD') return d % 2 !== 0 ? 'is-green' : 'is-red';
        if ((tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER')) {
            const activePred = lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
            if (tradeType === 'DIGITOVER') {
                if (d > Number(activePred)) return 'is-green';
                if (d < Number(activePred)) return 'is-red';
                return 'is-neutral';
            }
            if (tradeType === 'DIGITUNDER') {
                if (d < Number(activePred)) return 'is-green';
                if (d > Number(activePred)) return 'is-red';
                return 'is-neutral';
            }
        }
        return '';
    };

    // Load historical data for all volatility indices
    const loadAllVolatilitiesHistoricalData = async (volatilities: Array<{ symbol: string; display_name: string }>) => {
        if (!apiRef.current) return;

        setStatus('Loading historical data for all volatilities...');

        try {
            const allData: Record<string, Array<{ time: number, price: number, close: number }>> = {};

            const batchSize = 3;
            for (let i = 0; i < volatilities.length; i += batchSize) {
                const batch = volatilities.slice(i, i + batchSize);

                const batchPromises = batch.map(async (vol) => {
                    try {
                        const request = {
                            ticks_history: vol.symbol,
                            adjust_start_time: 1,
                            count: 5000,
                            end: "latest",
                            start: 1,
                            style: "ticks"
                        };

                        const response = await apiRef.current.send(request);

                        if (response.error) {
                            console.error(`Historical ticks fetch error for ${vol.symbol}:`, response.error);
                            return;
                        }

                        if (response.history && response.history.prices && response.history.times) {
                            const historicalData = response.history.prices.map((price: string, index: number) => ({
                                time: response.history.times[index] * 1000,
                                price: parseFloat(price),
                                close: parseFloat(price)
                            }));

                            allData[vol.symbol] = historicalData;
                            console.log(`Loaded ${historicalData.length} historical ticks for ${vol.symbol}`);
                        }
                    } catch (error) {
                        console.error(`Error loading historical data for ${vol.symbol}:`, error);
                    }
                });

                await Promise.all(batchPromises);

                if (i + batchSize < volatilities.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            setAllVolatilitiesData(allData);
            setStatus(`Loaded historical data for ${Object.keys(allData).length} volatilities`);

            console.log('All volatilities historical data loaded:', Object.keys(allData));

        } catch (error) {
            console.error('Error loading all volatilities historical data:', error);
            setStatus('Failed to load historical data');
        }
    };

    // Fetch historical tick data for Hull Moving Average analysis
    const fetchHistoricalTicks = async (symbolToFetch: string) => {
        try {
            const request = {
                ticks_history: symbolToFetch,
                adjust_start_time: 1,
                count: 1000,
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

                    const trimmedData = uniqueData.slice(-2000);

                    if (tradeType === 'CALL' || tradeType === 'PUT') {
                        updateHullTrends(trimmedData);
                    }

                    return trimmedData;
                });
            }
        } catch (error) {
            console.error('Error fetching historical ticks:', error);
        }
    };

    // Hull Moving Average calculation with Weighted Moving Average
    const calculateHMA = (data: number[], period: number) => {
        if (data.length < period) return null;

        const calculateWMA = (values: number[], periods: number) => {
            if (values.length < periods) return null;
            const weights = Array.from({length: periods}, (_, i) => i + 1);
            const weightSum = weights.reduce((sum, w) => sum + w, 0);
            const recentValues = values.slice(-periods);
            
            const weightedSum = recentValues.reduce((sum, value, index) => {
                return sum + (value * weights[index]);
            }, 0);
            
            return weightedSum / weightSum;
        };

        const halfPeriod = Math.floor(period / 2);
        const sqrtPeriod = Math.floor(Math.sqrt(period));

        const wma1 = calculateWMA(data, halfPeriod);
        const wma2 = calculateWMA(data, period);

        if (wma1 === null || wma2 === null) return null;

        const rawHMA = 2 * wma1 - wma2;
        const hmaData = data.slice(-sqrtPeriod).map((_, i) => rawHMA);
        
        return calculateWMA(hmaData, sqrtPeriod);
    };

    // Update Hull trends for different timeframes
    const updateHullTrends = (data: Array<{ time: number, price: number, close: number }>) => {
        if (data.length < 100) return;

        const prices = data.map(d => d.price);
        const now = Date.now();

        // Calculate HMA for different periods
        const hma21 = calculateHMA(prices.slice(-21), 21); // 15s equivalent
        const hma50 = calculateHMA(prices.slice(-50), 50); // 1m equivalent
        const hma100 = calculateHMA(prices.slice(-100), 100); // 5m equivalent
        const hma200 = calculateHMA(prices.slice(-200), 200); // 15m equivalent

        const currentPrice = prices[prices.length - 1];

        const getTrend = (hmaValue: number | null, currentPx: number) => {
            if (hmaValue === null) return 'NEUTRAL';
            const diff = ((currentPx - hmaValue) / hmaValue) * 100;
            if (diff > 0.01) return 'BULLISH';
            if (diff < -0.01) return 'BEARISH';
            return 'NEUTRAL';
        };

        setHullTrends({
            '15s': { trend: getTrend(hma21, currentPrice), value: hma21 || 0 },
            '1m': { trend: getTrend(hma50, currentPrice), value: hma50 || 0 },
            '5m': { trend: getTrend(hma100, currentPrice), value: hma100 || 0 },
            '15m': { trend: getTrend(hma200, currentPrice), value: hma200 || 0 }
        });
    };

    // Initialize API connection
    const initializeAPI = useCallback(async () => {
        try {
            const clientId = await V2GetActiveClientId();
            const token = await V2GetActiveToken(clientId);
            
            if (!token) {
                setStatus('Please log in to start trading');
                return;
            }

            const api = await generateDerivApiInstance();
            apiRef.current = api;

            api.onopen = () => {
                setIsConnected(true);
                setStatus('Connected to API');
                authorizeAPI();
            };

            api.onclose = () => {
                setIsConnected(false);
                setStatus('Disconnected from API');
            };

            api.onerror = (error: any) => {
                console.error('API Error:', error);
                setStatus('API connection error');
            };

        } catch (error) {
            console.error('Failed to initialize API:', error);
            setStatus('Failed to initialize API');
        }
    }, []);

    // Authorize API connection
    const authorizeAPI = async () => {
        try {
            const clientId = await V2GetActiveClientId();
            const token = await V2GetActiveToken(clientId);
            
            if (!apiRef.current || !token) return;

            const authResponse = await apiRef.current.send({
                authorize: token
            });

            if (authResponse.error) {
                console.error('Authorization failed:', authResponse.error);
                setStatus('Authorization failed');
                return;
            }

            setIsAuthorized(true);
            setAccountCurrency(authResponse.authorize.currency);
            setStatus('Authorized successfully');

            await loadActiveSymbols();

        } catch (error) {
            console.error('Authorization error:', error);
            setStatus('Authorization error');
        }
    };

    // Load available trading symbols
    const loadActiveSymbols = async () => {
        try {
            if (!apiRef.current) return;

            const response = await apiRef.current.send({
                active_symbols: 'brief',
                product_type: 'basic'
            });

            if (response.error) {
                console.error('Failed to load symbols:', response.error);
                return;
            }

            if (response.active_symbols) {
                const volatilitySymbols = response.active_symbols.filter((s: any) =>
                    s.symbol.startsWith('R_') && s.market === 'synthetic_index'
                );

                setSymbols(volatilitySymbols);
                
                if (volatilitySymbols.length > 0 && !symbol) {
                    setSymbol(volatilitySymbols[0].symbol);
                }

                await loadAllVolatilitiesHistoricalData(volatilitySymbols);
            }

        } catch (error) {
            console.error('Error loading symbols:', error);
        }
    };

    // Start trading
    const startTrading = () => {
        if (!is_authorized || !symbol) {
            setStatus('Please ensure you are authorized and have selected a symbol');
            return;
        }

        setIsRunning(true);
        setIsTrading(true);
        stopFlagRef.current = false;
        setStatus('Trading started');

        // Start tick stream for the selected symbol
        startTickStream(symbol);
    };

    // Stop trading
    const stopTrading = () => {
        setIsRunning(false);
        setIsTrading(false);
        stopFlagRef.current = true;
        setStatus('Trading stopped');

        // Stop tick stream
        if (tickStreamIdRef.current && apiRef.current) {
            apiRef.current.send({
                forget: tickStreamIdRef.current
            });
            tickStreamIdRef.current = null;
        }
    };

    // Start tick stream
    const startTickStream = (symbolToStream: string) => {
        if (!apiRef.current) return;

        const tickRequest = {
            ticks: symbolToStream,
            subscribe: 1
        };

        apiRef.current.send(tickRequest).then((response: any) => {
            if (response.error) {
                console.error('Tick stream error:', response.error);
                return;
            }

            tickStreamIdRef.current = response.subscription?.id;

            // Handle tick updates
            const handleTick = (tickResponse: any) => {
                if (tickResponse.tick && tickResponse.tick.symbol === symbolToStream) {
                    const newTick = {
                        time: tickResponse.tick.epoch * 1000,
                        price: parseFloat(tickResponse.tick.quote),
                        close: parseFloat(tickResponse.tick.quote)
                    };

                    // Update tick data
                    setTickData(prev => {
                        const updated = [...prev, newTick].slice(-2000);
                        if (tradeType === 'CALL' || tradeType === 'PUT') {
                            updateHullTrends(updated);
                        }
                        return updated;
                    });

                    // Update digit tracking for digit-based contracts
                    if (['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'].includes(tradeType)) {
                        const digit = Math.floor(newTick.price * 10) % 10;
                        setLastDigit(digit);
                        setDigits(prev => [...prev, digit].slice(-10));
                        setTicksProcessed(prev => prev + 1);
                    }

                    // Add to tick history
                    setTickHistory(prev => [...prev, { time: newTick.time, price: newTick.price }].slice(-100));
                }
            };

            // Set up message handler
            if (messageHandlerRef.current) {
                apiRef.current.removeEventListener('message', messageHandlerRef.current);
            }

            messageHandlerRef.current = (evt: MessageEvent) => {
                const data = JSON.parse(evt.data);
                handleTick(data);
            };

            apiRef.current.addEventListener('message', messageHandlerRef.current);
        });
    };

    // Execute trade
    const executeTrade = async () => {
        if (!apiRef.current || !symbol) return;

        try {
            const tradeOptions = {
                amount: stake,
                basis: 'stake',
                currency: account_currency,
                duration: durationType === 't' ? ticks : duration,
                duration_unit: durationType,
                symbol: symbol,
                prediction: getPredictionValue()
            };

            const buyRequest = tradeOptionToBuy(tradeType, tradeOptions);
            
            const response = await apiRef.current.send(buyRequest);

            if (response.error) {
                console.error('Trade execution error:', response.error);
                setStatus(`Trade failed: ${response.error.message}`);
                return;
            }

            setStatus('Trade executed successfully');

            // Track the contract
            if (response.buy) {
                // Update contract tracking
                setContractValue(response.buy.balance_after - response.buy.balance_before);
                setPotentialPayout(response.buy.payout || 0);
            }

        } catch (error) {
            console.error('Error executing trade:', error);
            setStatus('Error executing trade');
        }
    };

    // Get prediction value based on trade type
    const getPredictionValue = () => {
        switch (tradeType) {
            case 'DIGITOVER':
            case 'DIGITUNDER':
                return lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
            case 'DIGITMATCH':
            case 'DIGITDIFF':
                return mdPrediction;
            default:
                return undefined;
        }
    };

    // Initialize API on component mount
    useEffect(() => {
        initializeAPI();

        return () => {
            // Cleanup
            if (tickStreamIdRef.current && apiRef.current) {
                apiRef.current.send({
                    forget: tickStreamIdRef.current
                });
            }
            if (messageHandlerRef.current && apiRef.current) {
                apiRef.current.removeEventListener('message', messageHandlerRef.current);
            }
        };
    }, [initializeAPI]);

    return (
        <div className="smart-trader">
            <div className="smart-trader__container">
                <div className="smart-trader__header">
                    <Text as="h1" weight="bold" size="l">
                        {localize('Smart Trader')}
                    </Text>
                    <Text size="s" color="less-prominent">
                        {localize('Advanced trading with Hull Moving Average analysis and multiple strategies')}
                    </Text>
                    <div className="smart-trader__status">
                        <Text size="xs" color={isConnected ? 'success' : 'danger'}>
                            {status}
                        </Text>
                    </div>
                </div>

                <div className="smart-trader__content">
                    <div className="smart-trader__card">
                        {/* Trading Configuration */}
                        <div className="smart-trader__row">
                            <div className="smart-trader__field">
                                <label>{localize('Symbol')}</label>
                                <select
                                    value={symbol}
                                    onChange={(e) => setSymbol(e.target.value)}
                                    disabled={isTrading}
                                >
                                    {symbols.map((sym) => (
                                        <option key={sym.symbol} value={sym.symbol}>
                                            {sym.display_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="smart-trader__field">
                                <label>{localize('Trade Type')}</label>
                                <select
                                    value={tradeType}
                                    onChange={(e) => setTradeType(e.target.value)}
                                    disabled={isTrading}
                                >
                                    {TRADE_TYPES.map((type) => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="smart-trader__field">
                                <label>{localize('Stake')} ({account_currency})</label>
                                <input
                                    type="number"
                                    value={stake}
                                    onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                                    disabled={isTrading}
                                    min="0.01"
                                    step="0.01"
                                />
                            </div>
                        </div>

                        {/* Duration Configuration */}
                        <div className="smart-trader__row">
                            <div className="smart-trader__field">
                                <label>{localize('Duration Type')}</label>
                                <select
                                    value={durationType}
                                    onChange={(e) => setDurationType(e.target.value)}
                                    disabled={isTrading}
                                >
                                    <option value="t">{localize('Ticks')}</option>
                                    <option value="s">{localize('Seconds')}</option>
                                    <option value="m">{localize('Minutes')}</option>
                                </select>
                            </div>

                            <div className="smart-trader__field">
                                <label>
                                    {durationType === 't' ? localize('Ticks') : 
                                     durationType === 's' ? localize('Seconds') : localize('Minutes')}
                                </label>
                                <input
                                    type="number"
                                    value={durationType === 't' ? ticks : duration}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value) || 1;
                                        if (durationType === 't') {
                                            setTicks(value);
                                        } else {
                                            setDuration(value);
                                        }
                                    }}
                                    disabled={isTrading}
                                    min="1"
                                />
                            </div>

                            <div className="smart-trader__field">
                                <label>{localize('Martingale Multiplier')}</label>
                                <input
                                    type="number"
                                    value={martingaleMultiplier}
                                    onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value) || 1)}
                                    disabled={isTrading}
                                    min="1"
                                    step="0.1"
                                />
                            </div>
                        </div>

                        {/* Prediction Configuration for Digit Trades */}
                        {(['DIGITOVER', 'DIGITUNDER'].includes(tradeType)) && (
                            <div className="smart-trader__row">
                                <div className="smart-trader__field">
                                    <label>{localize('Prediction (Pre-Loss)')}</label>
                                    <input
                                        type="number"
                                        value={ouPredPreLoss}
                                        onChange={(e) => setOuPredPreLoss(parseInt(e.target.value) || 5)}
                                        disabled={isTrading}
                                        min="0"
                                        max="9"
                                    />
                                </div>

                                <div className="smart-trader__field">
                                    <label>{localize('Prediction (Post-Loss)')}</label>
                                    <input
                                        type="number"
                                        value={ouPredPostLoss}
                                        onChange={(e) => setOuPredPostLoss(parseInt(e.target.value) || 5)}
                                        disabled={isTrading}
                                        min="0"
                                        max="9"
                                    />
                                </div>
                            </div>
                        )}

                        {(['DIGITMATCH', 'DIGITDIFF'].includes(tradeType)) && (
                            <div className="smart-trader__row">
                                <div className="smart-trader__field">
                                    <label>{localize('Digit Prediction')}</label>
                                    <input
                                        type="number"
                                        value={mdPrediction}
                                        onChange={(e) => setMdPrediction(parseInt(e.target.value) || 5)}
                                        disabled={isTrading}
                                        min="0"
                                        max="9"
                                    />
                                </div>
                            </div>
                        )}

                        {(['CALL', 'PUT'].includes(tradeType)) && (
                            <div className="smart-trader__row">
                                <div className="smart-trader__field">
                                    <label>{localize('Barrier')}</label>
                                    <input
                                        type="text"
                                        value={barrier}
                                        onChange={(e) => setBarrier(e.target.value)}
                                        disabled={isTrading}
                                        placeholder="+0.37"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Live Digits Display for Digit Trades */}
                        {(['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'].includes(tradeType)) && (
                            <div>
                                <Text size="s" weight="bold">{localize('Live Digits')}</Text>
                                <div className="smart-trader__digits">
                                    {Array.from({ length: 10 }, (_, i) => {
                                        const isLast = i === digits.length - 1;
                                        const digit = digits[i];
                                        return (
                                            <div
                                                key={i}
                                                className={`smart-trader__digit ${isLast ? 'is-current' : ''} ${digit !== undefined ? getHintClass(digit) : ''}`}
                                            >
                                                {digit !== undefined ? digit : '-'}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="smart-trader__meta">
                                    <Text size="xs">
                                        {localize('Last Digit')}: {lastDigit !== null ? lastDigit : '-'}
                                    </Text>
                                    <Text size="xs">
                                        {localize('Ticks Processed')}: {ticksProcessed}
                                    </Text>
                                </div>
                            </div>
                        )}

                        {/* Hull Moving Average Trends for Rise/Fall */}
                        {(['CALL', 'PUT'].includes(tradeType)) && (
                            <div className="smart-trader__hull-trends">
                                <div className="smart-trader__trends-header">
                                    <Text size="s" weight="bold">{localize('Hull Moving Average Trends')}</Text>
                                </div>
                                <div className="smart-trader__trends-grid">
                                    {Object.entries(hullTrends).map(([timeframe, data]) => (
                                        <div key={timeframe} className="smart-trader__trend-item">
                                            <div className="smart-trader__timeframe">{timeframe}</div>
                                            <div className={`smart-trader__trend-badge ${data.trend.toLowerCase()}`}>
                                                {data.trend}
                                            </div>
                                            <div className="smart-trader__trend-value">
                                                {data.value.toFixed(4)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Trading Controls */}
                        <div className="smart-trader__actions">
                            <button
                                className="smart-trader__run"
                                onClick={isTrading ? stopTrading : startTrading}
                                disabled={!is_authorized || !symbol}
                            >
                                {isTrading ? localize('Stop Trading') : localize('Start Trading')}
                            </button>
                            
                            {isTrading && (
                                <button
                                    className="smart-trader__run"
                                    onClick={executeTrade}
                                    disabled={!isTrading}
                                >
                                    {localize('Execute Trade')}
                                </button>
                            )}
                        </div>

                        {/* Contract Information */}
                        {(contractValue !== 0 || potentialPayout !== 0) && (
                            <div className="smart-trader__open-position">
                                <div className="smart-trader__position-header">
                                    <Text size="s" weight="bold">{localize('Active Contract')}</Text>
                                </div>
                                <div className="smart-trader__position-card">
                                    <div className="smart-trader__contract-values">
                                        <div className="smart-trader__value-row">
                                            <div className="smart-trader__value-item">
                                                <Text size="xs" color="less-prominent">{localize('Current Value')}</Text>
                                                <Text size="s" weight="bold">{contractValue.toFixed(2)} {account_currency}</Text>
                                            </div>
                                            <div className="smart-trader__value-item">
                                                <Text size="xs" color="less-prominent">{localize('Potential Payout')}</Text>
                                                <Text size="s" weight="bold">{potentialPayout.toFixed(2)} {account_currency}</Text>
                                            </div>
                                        </div>
                                        <div className="smart-trader__value-row">
                                            <div className="smart-trader__value-item">
                                                <Text size="xs" color="less-prominent">{localize('Current Profit/Loss')}</Text>
                                                <Text 
                                                    size="s" 
                                                    weight="bold" 
                                                    color={currentProfit >= 0 ? 'success' : 'danger'}
                                                >
                                                    {currentProfit >= 0 ? '+' : ''}{currentProfit.toFixed(2)} {account_currency}
                                                </Text>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default SmartTrader;
