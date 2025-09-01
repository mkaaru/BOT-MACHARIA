import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './higher-lower-trader.scss';

// Volatility indices for Higher/Lower trading
const VOLATILITY_INDICES = [
  { value: 'R_10', label: 'Volatility 10 (1s) Index' },
  { value: 'R_25', label: 'Volatility 25 (1s) Index' },
  { value: 'R_50', label: 'Volatility 50 (1s) Index' },
  { value: 'R_75', label: 'Volatility 75 (1s) Index' },
  { value: 'R_100', label: 'Volatility 100 (1s) Index' },
  { value: 'BOOM500', label: 'Boom 500 Index' },
  { value: 'BOOM1000', label: 'Boom 1000 Index' },
  { value: 'CRASH500', label: 'Crash 500 Index' },
  { value: 'CRASH1000', label: 'Crash 1000 Index' },
  { value: 'stpRNG', label: 'Step Index' },
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
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }
    return buy;
};

const HigherLowerTrader = observer(() => {
    const store = useStore();

    // Safe store access with fallbacks
    const run_panel = store?.run_panel || {
        toggleDrawer: () => {},
        setActiveTabIndex: () => {},
        setIsRunning: () => {},
        setHasOpenContract: () => {},
        setContractStage: () => {},
        onContractStatusEvent: () => {},
        onBotContractEvent: () => {},
        run_id: null
    };

    const transactions = store?.transactions || {
        onBotContractEvent: () => {}
    };

    const client = store?.client || {
        balance: null,
        is_logged_in: false
    };

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state - Higher/Lower specific
    const [symbol, setSymbol] = useState<string>('R_10');
    const [contractType, setContractType] = useState<string>('CALL'); // CALL for Higher, PUT for Lower
    const [duration, setDuration] = useState<number>(60); // Duration in seconds
    const [durationType, setDurationType] = useState<string>('s'); // 's' for seconds, 'm' for minutes
    const [stake, setStake] = useState<number>(1.0);
    const [baseStake, setBaseStake] = useState<number>(1.0);
    const [barrier, setBarrier] = useState<string>('+0.37');

    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(2.0);
    const [useStopOnProfit, setUseStopOnProfit] = useState<boolean>(false);
    const [targetProfit, setTargetProfit] = useState<number>(10.0);

    // Contract tracking state
    const [currentProfit, setCurrentProfit] = useState<number>(0);
    const [contractValue, setContractValue] = useState<number>(0);
    const [potentialPayout, setPotentialPayout] = useState<number>(0);
    const [contractDuration, setContractDuration] = useState<string>('00:00:00');

    // Live price state
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Basic trend analysis state
    const [trendDirection, setTrendDirection] = useState<'BULLISH' | 'BEARISH' | 'NEUTRAL'>('NEUTRAL');
    const [trendStrength, setTrendStrength] = useState<number>(0);

    const [status, setStatus] = useState<string>('Initializing...');
    const [is_running, setIsRunning] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const stopFlagRef = useRef<boolean>(false);

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    // Simple trend calculation
    const calculateSimpleTrend = useCallback((prices: number[]) => {
        if (prices.length < 20) return { direction: 'NEUTRAL', strength: 0 };

        const recent = prices.slice(-10);
        const previous = prices.slice(-20, -10);

        const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
        const previousAvg = previous.reduce((sum, p) => sum + p, 0) / previous.length;

        const change = ((recentAvg - previousAvg) / previousAvg) * 100;
        const strength = Math.min(Math.abs(change) * 10, 100);

        return {
            direction: change > 0.1 ? 'BULLISH' : change < -0.1 ? 'BEARISH' : 'NEUTRAL',
            strength
        };
    }, []);

    // Effect to initialize API connection
    useEffect(() => {
        let isMounted = true;

        const initializeAPI = async () => {
            try {
                setStatus('Connecting to API...');
                const api = generateDerivApiInstance();
                apiRef.current = api;

                // Wait for connection
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

                    api.onOpen = () => {
                        clearTimeout(timeout);
                        if (isMounted) {
                            setConnectionStatus('connected');
                            setStatus('Connected successfully');
                            resolve(true);
                        }
                    };

                    api.onClose = () => {
                        if (isMounted) {
                            setConnectionStatus('disconnected');
                            setStatus('Connection lost');
                        }
                    };

                    api.onError = (error: any) => {
                        clearTimeout(timeout);
                        if (isMounted) {
                            setConnectionStatus('disconnected');
                            setStatus(`Connection error: ${error.message || 'Unknown error'}`);
                            reject(error);
                        }
                    };
                });

                if (!isMounted) return;

                // Fetch active symbols
                try {
                    const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                    if (asErr) throw asErr;

                    const volatilitySymbols = (active_symbols || [])
                        .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol) || /^(BOOM|CRASH|stpRNG)/.test(s.symbol))
                        .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));

                    if (isMounted) {
                        setSymbols(volatilitySymbols);
                        setStatus('Ready to trade');
                    }
                } catch (symbolError) {
                    console.warn('Failed to fetch symbols:', symbolError);
                    if (isMounted) {
                        setSymbols(VOLATILITY_INDICES.map(vi => ({ symbol: vi.value, display_name: vi.label })));
                        setStatus('Using default symbols');
                    }
                }

            } catch (error: any) {
                console.error('API initialization error:', error);
                if (isMounted) {
                    setConnectionStatus('disconnected');
                    setStatus(`Failed to connect: ${error.message || 'Unknown error'}`);
                }
            }
        };

        initializeAPI();

        return () => {
            isMounted = false;
            try {
                if (tickStreamIdRef.current && apiRef.current) {
                    apiRef.current.forget({ forget: tickStreamIdRef.current });
                    tickStreamIdRef.current = null;
                }
                if (messageHandlerRef.current && apiRef.current?.connection) {
                    apiRef.current.connection.removeEventListener('message', messageHandlerRef.current);
                    messageHandlerRef.current = null;
                }
                if (apiRef.current?.disconnect) {
                    apiRef.current.disconnect();
                }
            } catch (error) {
                console.warn('Cleanup error:', error);
            }
        };
    }, []);

    const authorizeIfNeeded = async () => {
        if (is_authorized) return;

        const token = V2GetActiveToken();
        if (!token) {
            setStatus('No token found. Please log in and select an account.');
            throw new Error('No token');
        }

        const { authorize, error } = await apiRef.current.authorize(token);
        if (error) {
            setStatus(`Authorization error: ${error.message || error.code}`);
            throw error;
        }

        setIsAuthorized(true);
        const loginid = authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');

        // Safely update client store if available
        try {
            if (store?.client) {
                store.client.setLoginId?.(loginid || '');
                store.client.setCurrency?.(authorize?.currency || 'USD');
                store.client.setIsLoggedIn?.(true);
            }
        } catch (error) {
            console.warn('Store update error:', error);
        }
    };

    const startTicks = async (sym: string) => {
        if (!apiRef.current) return;

        try {
            // Stop existing tick stream
            if (tickStreamIdRef.current) {
                await apiRef.current.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }

            setTicksProcessed(0);
            const tickHistory: number[] = [];

            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;

            if (subscription?.id) {
                tickStreamIdRef.current = subscription.id;
            }

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;

                        setCurrentPrice(quote);
                        setTicksProcessed(prev => prev + 1);

                        // Update trend analysis
                        tickHistory.push(quote);
                        if (tickHistory.length > 50) {
                            tickHistory.shift();
                        }

                        if (tickHistory.length >= 20) {
                            const trend = calculateSimpleTrend(tickHistory);
                            setTrendDirection(trend.direction as any);
                            setTrendStrength(trend.strength);
                        }
                    }
                } catch (error) {
                    console.warn('Tick processing error:', error);
                }
            };

            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
            setStatus(`Tick stream error: ${e.message || 'Unknown error'}`);
        }
    };

    const purchaseContract = async (stakeAmount: number) => {
        await authorizeIfNeeded();

        const trade_option: any = {
            amount: Number(stakeAmount),
            basis: 'stake',
            contractTypes: [contractType],
            currency: account_currency,
            duration: durationType === 's' ? Number(duration) : Number(duration * 60),
            duration_unit: durationType,
            symbol,
            barrier: barrier
        };

        const buy_req = tradeOptionToBuy(contractType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;

        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stakeAmount}`);
        return buy;
    };

    const onRun = async () => {
        if (!apiRef.current || connectionStatus !== 'connected') {
            setStatus('Please wait for connection before starting');
            return;
        }

        setStatus('Starting Higher/Lower trader...');
        setIsRunning(true);
        stopFlagRef.current = false;

        // Set up run panel safely
        try {
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1);
            run_panel.run_id = `higher-lower-${Date.now()}`;
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);
        } catch (error) {
            console.warn('Run panel setup error:', error);
        }

        try {
            await authorizeIfNeeded();
            setStatus('Authorization successful, starting trading...');

            let step = 0;
            if (baseStake !== stake) setBaseStake(stake);

            while (!stopFlagRef.current) {
                try {
                    const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;
                    setStake(effectiveStake);

                    setStatus(`Placing ${contractType === 'CALL' ? 'Higher' : 'Lower'} trade with stake ${effectiveStake} ${account_currency}...`);

                    const buy = await purchaseContract(effectiveStake);

                    if (!buy?.contract_id) {
                        throw new Error('Failed to get contract ID from purchase');
                    }

                    // Update statistics
                    setTotalStake(prev => prev + effectiveStake);
                    setTotalRuns(prev => prev + 1);

                    // Safely notify transaction store
                    try {
                        const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                        transactions.onBotContractEvent({
                            contract_id: buy.contract_id,
                            transaction_ids: { buy: buy.transaction_id },
                            buy_price: buy.buy_price,
                            longcode: buy.longcode,
                            start_time: buy.start_time,
                            shortcode: buy.shortcode,
                            underlying: symbol,
                            contract_type: contractType,
                            is_completed: false,
                            profit: 0,
                            profit_percentage: 0
                        });
                    } catch (e) {
                        console.warn('Failed to notify transaction store:', e);
                    }

                    run_panel.setContractStage(contract_stages.PURCHASE_SENT);
                    run_panel.setHasOpenContract(true);

                    setStatus(`📈 ${contractType} contract started with barrier ${barrier} for $${effectiveStake}`);

                    // Initialize contract display values
                    setContractValue(effectiveStake);
                    setPotentialPayout(buy.payout ? Number(buy.payout) : effectiveStake * 1.95);
                    setCurrentProfit(0);

                    // Wait for contract completion
                    const contractResult = await new Promise((resolve, reject) => {
                        let pollCount = 0;
                        const maxPolls = 300;

                        const checkContract = async () => {
                            try {
                                pollCount++;
                                if (pollCount > maxPolls) {
                                    throw new Error('Contract polling timeout');
                                }

                                const response = await apiRef.current.send({
                                    proposal_open_contract: 1,
                                    contract_id: buy.contract_id
                                });

                                const contract = response.proposal_open_contract;
                                if (!contract) {
                                    throw new Error('Contract not found');
                                }

                                if (contract.is_sold) {
                                    const profit = Number(contract.profit || 0);
                                    const isWin = profit > 0;

                                    resolve({
                                        profit,
                                        isWin,
                                        sell_price: contract.sell_price,
                                        sell_transaction_id: contract.transaction_ids?.sell,
                                        contract_id: buy.contract_id,
                                        transaction_id: buy.transaction_id,
                                        buy_price: buy.buy_price,
                                        longcode: buy.longcode,
                                        start_time: buy.start_time,
                                        shortcode: buy.shortcode,
                                        underlying: symbol,
                                        entry_tick_display_value: contract.entry_tick_display_value,
                                        exit_tick_display_value: contract.exit_tick_display_value,
                                        payout: contract.sell_price
                                    });
                                } else {
                                    // Contract still running - update UI
                                    const currentBidPrice = Number(contract.bid_price || 0);
                                    const currentProfit = Number(contract.profit || 0);
                                    const potentialPayout = contract.payout ? Number(contract.payout) :
                                                          (currentBidPrice > 0 ? currentBidPrice :
                                                           (effectiveStake + currentProfit));

                                    setContractValue(currentBidPrice);
                                    setPotentialPayout(potentialPayout);
                                    setCurrentProfit(currentProfit);

                                    const duration_left = (contract.date_expiry || 0) - Date.now() / 1000;
                                    if (duration_left > 0) {
                                        const hours = Math.floor(duration_left / 3600);
                                        const minutes = Math.floor((duration_left % 3600) / 60);
                                        const seconds = Math.floor(duration_left % 60);
                                        setContractDuration(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                                    }

                                    setTimeout(checkContract, 1000);
                                }
                            } catch (error) {
                                console.error('Contract polling error:', error);
                                reject(error);
                            }
                        };

                        setTimeout(checkContract, 2000);
                    });

                    // Process contract result
                    const { profit, isWin } = contractResult as any;

                    setTotalPayout(prev => prev + Number((contractResult as any).sell_price || 0));
                    setTotalProfitLoss(prev => prev + profit);

                    // Update statistics
                    if (profit > 0) {
                        setContractsWon(prev => prev + 1);
                        setStatus(`✅ Contract won! Profit: $${profit.toFixed(2)}`);
                        step = 0; // Reset martingale
                    } else {
                        setContractsLost(prev => prev + 1);
                        setStatus(`❌ Contract lost! Loss: $${Math.abs(profit).toFixed(2)}`);
                        step++; // Increase martingale step
                    }

                    run_panel.setHasOpenContract(false);

                    // Check stop conditions
                    const newTotalProfit = totalProfitLoss + profit;
                    if (useStopOnProfit && newTotalProfit >= targetProfit) {
                        setStatus(`🎯 Target profit reached: ${newTotalProfit.toFixed(2)} ${account_currency}. Stopping bot.`);
                        stopFlagRef.current = true;
                        break;
                    }

                    // Wait between trades
                    if (!stopFlagRef.current) {
                        setStatus(`Waiting 3 seconds before next trade...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                } catch (error: any) {
                    console.error('Trade execution error:', error);
                    setStatus(`❌ Trade error: ${error.message || 'Unknown error'}`);

                    if (error.code === 'AuthorizationRequired' || error.message?.includes('authorization')) {
                        setIsAuthorized(false);
                        setStatus('❌ Authorization lost. Please refresh and try again.');
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error: any) {
            console.error('Higher/Lower trader error:', error);
            setStatus(`❌ Trading error: ${error.message || 'Unknown error'}`);
        } finally {
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            setStatus('Higher/Lower trader stopped.');
        }
    };

    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');
    };

    const resetStats = () => {
        setTotalStake(0);
        setTotalPayout(0);
        setTotalRuns(0);
        setContractsWon(0);
        setContractsLost(0);
        setTotalProfitLoss(0);
    };

    // Start tick stream when symbol changes
    useEffect(() => {
        if (symbol && connectionStatus === 'connected') {
            startTicks(symbol);
        }
    }, [symbol, connectionStatus]);

    const getTrendIcon = () => {
        switch (trendDirection) {
            case 'BULLISH': return <TrendingUp className="trend-icon bullish" />;
            case 'BEARISH': return <TrendingDown className="trend-icon bearish" />;
            default: return <Clock className="trend-icon neutral" />;
        }
    };

    const getRecommendation = () => {
        if (trendStrength < 30) return 'Wait for stronger signal';
        if (trendDirection === 'BULLISH') return 'Consider HIGHER contract';
        if (trendDirection === 'BEARISH') return 'Consider LOWER contract';
        return 'No clear recommendation';
    };

    return (
        <div className="higher-lower-trader">
            <div className="higher-lower-trader__container">
                <div className="higher-lower-trader__content">

                    {/* Connection Status */}
                    <div className="connection-status">
                        <div className={`status-indicator ${connectionStatus}`}></div>
                        <span className="status-text">
                            Status: {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                        </span>
                    </div>

                    {/* Trading Parameters */}
                    <div className="higher-lower-trader__card">
                        <h3>Trading Parameters</h3>

                        <div className="higher-lower-trader__row">
                            <div className="higher-lower-trader__field">
                                <label>Symbol</label>
                                <select
                                    value={symbol}
                                    onChange={(e) => setSymbol(e.target.value)}
                                    disabled={is_running}
                                >
                                    {symbols.length > 0 ? symbols.map((sym) => (
                                        <option key={sym.symbol} value={sym.symbol}>
                                            {sym.display_name}
                                        </option>
                                    )) : VOLATILITY_INDICES.map((vi) => (
                                        <option key={vi.value} value={vi.value}>
                                            {vi.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="higher-lower-trader__row--two">
                            <div className="higher-lower-trader__field">
                                <label>Trade Type</label>
                                <select
                                    value={contractType}
                                    onChange={(e) => setContractType(e.target.value)}
                                    disabled={is_running}
                                >
                                    <option value="CALL">Higher</option>
                                    <option value="PUT">Lower</option>
                                </select>
                            </div>
                            <div className="higher-lower-trader__field">
                                <label>Barrier</label>
                                <input
                                    type="text"
                                    value={barrier}
                                    onChange={(e) => setBarrier(e.target.value)}
                                    disabled={is_running}
                                    placeholder="+0.37"
                                />
                            </div>
                        </div>

                        <div className="higher-lower-trader__row--two">
                            <div className="higher-lower-trader__field">
                                <label>Duration</label>
                                <input
                                    type="number"
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    disabled={is_running}
                                    min="5"
                                    max="3600"
                                />
                            </div>
                            <div className="higher-lower-trader__field">
                                <label>Duration Type</label>
                                <select
                                    value={durationType}
                                    onChange={(e) => setDurationType(e.target.value)}
                                    disabled={is_running}
                                >
                                    <option value="s">Seconds</option>
                                    <option value="m">Minutes</option>
                                </select>
                            </div>
                        </div>

                        <div className="higher-lower-trader__row--two">
                            <div className="higher-lower-trader__field">
                                <label>Stake ({account_currency})</label>
                                <input
                                    type="number"
                                    value={stake}
                                    onChange={(e) => setStake(Number(e.target.value))}
                                    disabled={is_running}
                                    min="0.35"
                                    step="0.01"
                                />
                            </div>
                            <div className="higher-lower-trader__field">
                                <label>Martingale Multiplier</label>
                                <input
                                    type="number"
                                    value={martingaleMultiplier}
                                    onChange={(e) => setMartingaleMultiplier(Number(e.target.value))}
                                    disabled={is_running}
                                    min="1.01"
                                    max="10"
                                    step="0.01"
                                />
                            </div>
                        </div>

                        <div className="higher-lower-trader__row">
                            <div className="higher-lower-trader__field">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={useStopOnProfit}
                                        onChange={(e) => setUseStopOnProfit(e.target.checked)}
                                        disabled={is_running}
                                    />
                                    Stop on Target Profit
                                </label>
                                {useStopOnProfit && (
                                    <input
                                        type="number"
                                        value={targetProfit}
                                        onChange={(e) => setTargetProfit(Number(e.target.value))}
                                        disabled={is_running}
                                        min="1"
                                        step="0.01"
                                        placeholder="Target profit"
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Current Price Display */}
                    {currentPrice > 0 && (
                        <div className="higher-lower-trader__price-display">
                            <h4>Live Price: {currentPrice.toFixed(5)}</h4>
                            <p>Ticks processed: {ticksProcessed}</p>
                        </div>
                    )}

                    {/* Simple Trend Analysis */}
                    <div className="higher-lower-trader__card">
                        <h4>
                            {getTrendIcon()}
                            Market Trend Analysis
                        </h4>
                        <div className="trend-info">
                            <p><strong>Direction:</strong> <span className={`trend-${trendDirection.toLowerCase()}`}>{trendDirection}</span></p>
                            <p><strong>Strength:</strong> {trendStrength.toFixed(1)}%</p>
                            <p><strong>Recommendation:</strong> {getRecommendation()}</p>
                        </div>
                    </div>

                    {/* Contract Information */}
                    {is_running && (
                        <div className="higher-lower-trader__contract-info">
                            <h4>Current Contract</h4>
                            <div className="contract-stats">
                                <div className="stat-item">
                                    <span>Stake:</span>
                                    <span>${stake.toFixed(2)}</span>
                                </div>
                                <div className="stat-item">
                                    <span>Current Value:</span>
                                    <span>${contractValue.toFixed(2)}</span>
                                </div>
                                <div className="stat-item">
                                    <span>Potential Payout:</span>
                                    <span>${potentialPayout.toFixed(2)}</span>
                                </div>
                                <div className="stat-item">
                                    <span>Current P&L:</span>
                                    <span className={currentProfit >= 0 ? 'profit' : 'loss'}>
                                        ${currentProfit.toFixed(2)}
                                    </span>
                                </div>
                                <div className="stat-item">
                                    <span>Time Remaining:</span>
                                    <span>{contractDuration}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Trading Statistics */}
                    <div className="higher-lower-trader__stats">
                        <h4>Trading Statistics</h4>
                        <div className="stats-grid">
                            <div className="stat-item">
                                <span>Total Runs:</span>
                                <span>{totalRuns}</span>
                            </div>
                            <div className="stat-item">
                                <span>Contracts Won:</span>
                                <span className="win">{contractsWon}</span>
                            </div>
                            <div className="stat-item">
                                <span>Contracts Lost:</span>
                                <span className="loss">{contractsLost}</span>
                            </div>
                            <div className="stat-item">
                                <span>Total Stake:</span>
                                <span>${totalStake.toFixed(2)}</span>
                            </div>
                            <div className="stat-item">
                                <span>Total Payout:</span>
                                <span>${totalPayout.toFixed(2)}</span>
                            </div>
                            <div className="stat-item">
                                <span>Net P&L:</span>
                                <span className={totalProfitLoss >= 0 ? 'profit' : 'loss'}>
                                    ${totalProfitLoss.toFixed(2)}
                                </span>
                            </div>
                        </div>
                        <button
                            className="reset-stats-btn"
                            onClick={resetStats}
                            disabled={is_running}
                        >
                            Reset Statistics
                        </button>
                    </div>

                    {/* Trading Controls */}
                    <div className="higher-lower-trader__buttons">
                        {!is_running ? (
                            <button
                                className="btn-start"
                                onClick={onRun}
                                disabled={connectionStatus !== 'connected'}
                            >
                                <Play className="icon" />
                                Start Trading
                            </button>
                        ) : (
                            <button
                                className="btn-stop"
                                onClick={stopTrading}
                            >
                                <Square className="icon" />
                                Stop Trading
                            </button>
                        )}
                    </div>

                    {/* Status Display */}
                    <div className="higher-lower-trader__status">
                        <Text size="s" color="general">
                            {status}
                        </Text>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default HigherLowerTrader;