import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken, V2GetActiveClientId } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Minimal trade types we will support initially
const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
    // Rise/Fall Contracts
    { value: 'RISE', label: 'Rise' },
    { value: 'FALL', label: 'Fall' },
];

// Volatility indices for digit trading
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
    if (trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    // For Rise/Fall, barrier is not used directly in the same way as digits
    if (!['RISE', 'FALL'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    return buy;
};

const MLTrader = observer(() => {
    const store = useStore();
    const { client, run_panel, transactions } = store;

    // Trading configuration state
    const [selectedVolatility, setSelectedVolatility] = useState('R_10');
    const [selectedTradeType, setSelectedTradeType] = useState('DIGITOVER');
    const [durationType, setDurationType] = useState('t');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState(0.5);
    const [baseStake, setBaseStake] = useState(0.5);
    const [overPrediction, setOverPrediction] = useState(5);
    const [underPrediction, setUnderPrediction] = useState(5);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1);

    // Trading state
    const [isTrading, setIsTrading] = useState(false);
    const [ticksProcessed, setTicksProcessed] = useState(0);
    const [lastDigit, setLastDigit] = useState('-');
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');
    const [statusMessage, setStatusMessage] = useState('Loading historical data for all volatilities...');
    const [isRunning, setIsRunning] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [accountCurrency, setAccountCurrency] = useState('USD');
    const [availableSymbols, setAvailableSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Market analysis state
    const [marketAnalysis, setMarketAnalysis] = useState<Record<string, any>>({});
    const [currentPrice, setCurrentPrice] = useState('-');

    // Rise/Fall specific state
    const [riseAnalysis, setRiseAnalysis] = useState({ percentage: 0, confidence: 0 });
    const [fallAnalysis, setFallAnalysis] = useState({ percentage: 0, confidence: 0 });
    const [riseFallVolatility, setRiseFallVolatility] = useState('R_100'); // Default to R_100 for Rise/Fall
    const [tickCount, setTickCount] = useState(120); // Number of ticks to analyze for Rise/Fall
    const [barrier, setBarrier] = useState(5); // Barrier for digit prediction, not directly used for Rise/Fall, but kept for consistency if needed
    const [baseStakeRF, setBaseStakeRF] = useState(1); // Base stake for Rise/Fall
    const [ticksRF, setTicksRF] = useState(1); // Duration in ticks for Rise/Fall
    const [martingaleRF, setMartingaleRF] = useState(1); // Martingale multiplier for Rise/Fall
    const [autoTradingActive, setAutoTradingActive] = useState(false); // Flag for auto trading Rise/Fall


    // Refs for cleanup and state management
    const derivApiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const stopFlagRef = useRef<boolean>(false);
    const lastOutcomeWasLossRef = useRef(false);

    // Authorization helper
    const authorizeIfNeeded = async () => {
        if (isAuthorized) return;
        const token = V2GetActiveToken();
        if (!token) {
            setStatusMessage('No token found. Please log in and select an account.');
            throw new Error('No token');
        }
        const { authorize, error } = await derivApiRef.current.authorize(token);
        if (error) {
            setStatusMessage(`Authorization error: ${error.message || error.code}`);
            throw error;
        }
        setIsAuthorized(true);
        const loginid = authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');
        try {
            // Sync ML Trader auth state into shared ClientStore so Transactions store keys correctly by account
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {}
    };

    // Tick stream management
    const stopTicks = () => {
        try {
            if (tickStreamIdRef.current) {
                derivApiRef.current?.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }
            if (messageHandlerRef.current) {
                derivApiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                messageHandlerRef.current = null;
            }
        } catch {}
    };

    const startTicks = async (sym: string) => {
        stopTicks();
        setTicksProcessed(0);
        setLastDigit('-');
        setCurrentPrice('-');

        try {
            const { subscription, error } = await derivApiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            // Listen for streaming ticks on the raw websocket
            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const digit = Number(String(quote).slice(-1));

                        // Update current symbol data
                        if (sym === selectedVolatility) {
                            setLastDigit(digit.toString());
                            setTicksProcessed(prev => prev + 1);
                            setCurrentPrice(quote.toFixed(5));
                        }

                        // Update market analysis data for real-time tracking
                        setMarketAnalysis(prev => {
                            if (prev[sym]) {
                                return {
                                    ...prev,
                                    [sym]: {
                                        ...prev[sym],
                                        currentPrice: quote.toFixed(5)
                                    }
                                };
                            }
                            return prev;
                        });

                        // Update tick data for Rise/Fall analysis
                        setTickData(prevTickData => {
                            const newTickData = [...prevTickData, { time: data.tick.ts, quote: parseFloat(quote) }];
                            // Keep only the last `tickCount` ticks for analysis
                            return newTickData.slice(-tickCount);
                        });
                    }
                    if (data?.forget?.id && data?.forget?.id === tickStreamIdRef.current) {
                        // stopped
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            derivApiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    // Initialize connection and load historical data
    useEffect(() => {
        const initConnection = async () => {
            try {
                const api = generateDerivApiInstance();
                derivApiRef.current = api;

                // Fetch active symbols (volatility indices)
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;

                const volatilitySymbols = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol) || /1HZ.*V/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setAvailableSymbols(volatilitySymbols);
                if (!selectedVolatility && volatilitySymbols[0]?.symbol) setSelectedVolatility(volatilitySymbols[0].symbol);
                if (!riseFallVolatility && volatilitySymbols[0]?.symbol) setRiseFallVolatility(volatilitySymbols[0].symbol); // Set for Rise/Fall too

                setConnectionStatus('Connected');

                // Load historical data for all volatility markets
                for (const symbolObj of volatilitySymbols) {
                    await loadHistoricalData(symbolObj.symbol);
                    // Start ticks for the initially selected symbol
                    if (symbolObj.symbol === selectedVolatility) {
                        startTicks(symbolObj.symbol);
                    }
                }

                setStatusMessage('Ready to start trading');
            } catch (error: any) {
                setConnectionStatus('Error');
                setStatusMessage(`Connection failed: ${error.message}`);
            }
        };

        initConnection();

        return () => {
            // Clean up streams and socket
            try {
                if (tickStreamIdRef.current) {
                    derivApiRef.current?.forget({ forget: tickStreamIdRef.current });
                    tickStreamIdRef.current = null;
                }
                if (messageHandlerRef.current) {
                    derivApiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                    messageHandlerRef.current = null;
                }
                derivApiRef.current?.disconnect?.();
            } catch {}
        };
    }, []);

    // Load historical data function
    const loadHistoricalData = async (symbol: string) => {
        if (!derivApiRef.current) return;

        try {
            setStatusMessage(`Loading historical data for ${symbol}...`);

            const historyResponse = await derivApiRef.current.send({
                ticks_history: symbol,
                count: 1000,
                end: 'latest',
                style: 'ticks'
            });

            if (historyResponse.error) {
                throw new Error(`Historical data error: ${historyResponse.error.message}`);
            }

            if (historyResponse.history && historyResponse.history.prices) {
                const prices = historyResponse.history.prices.map(price => parseFloat(price));
                const times = historyResponse.history.times || [];

                console.log(`Loaded ${prices.length} historical ticks for ${symbol}`);

                // Process historical data to extract digits
                const historicalDigits = prices.map(price => {
                    const priceStr = price.toFixed(5);
                    return parseInt(priceStr.slice(-1));
                });

                // Update market analysis state
                setMarketAnalysis(prev => ({
                    ...prev,
                    [symbol]: {
                        historicalDigits,
                        averageDigit: historicalDigits.length > 0 ? historicalDigits.reduce((a, b) => a + b, 0) / historicalDigits.length : 0,
                        // Add more analysis metrics as needed
                    }
                }));

                // Update ticks processed with historical data for the selected symbol
                if (symbol === selectedVolatility) {
                    setTicksProcessed(historicalDigits.length);
                    // Set the last digit from historical data
                    if (historicalDigits.length > 0) {
                        setLastDigit(historicalDigits[historicalDigits.length - 1].toString());
                    }
                }

                setStatusMessage(`Loaded ${prices.length} historical ticks. Ready to start trading.`);
            } else {
                setStatusMessage('No historical data available. Ready to start trading.');
            }
        } catch (error: any) {
            console.error('Error loading historical data:', error);
            setStatusMessage(`Error loading historical data: ${error.message}`);
        }
    };

    // Rise/Fall analysis calculation
    const calculateRiseFallAnalysis = useCallback((tickData) => {
        if (!tickData || tickData.length < 10) {
            return { rise: 0, fall: 0 };
        }

        let riseCount = 0;
        let fallCount = 0;
        let totalMoves = 0;

        for (let i = 1; i < tickData.length; i++) {
            const prevPrice = tickData[i - 1]?.quote || tickData[i - 1];
            const currentPrice = tickData[i]?.quote || tickData[i];

            if (prevPrice !== undefined && currentPrice !== undefined) {
                if (currentPrice > prevPrice) {
                    riseCount++;
                } else if (currentPrice < prevPrice) {
                    fallCount++;
                }
                totalMoves++;
            }
        }

        const risePercentage = totalMoves > 0 ? (riseCount / totalMoves) * 100 : 0;
        const fallPercentage = totalMoves > 0 ? (fallCount / totalMoves) * 100 : 0;

        return {
            rise: risePercentage,
            fall: fallPercentage,
            totalMoves,
            riseCount,
            fallCount
        };
    }, []);

    // Update Rise/Fall analysis when tick data changes
    useEffect(() => {
        if (tickData && tickData.length > 0) {
            const analysis = calculateRiseFallAnalysis(tickData);
            setRiseAnalysis({
                percentage: analysis.rise,
                confidence: Math.max(analysis.rise, analysis.fall)
            });
            setFallAnalysis({
                percentage: analysis.fall,
                confidence: Math.max(analysis.rise, analysis.fall)
            });
        }
    }, [tickData, calculateRiseFallAnalysis]);


    // Purchase function
    const purchaseOnce = async () => {
        await authorizeIfNeeded();

        let stakeToUse = stake;
        if (selectedTradeType === 'RISE' || selectedTradeType === 'FALL') {
            stakeToUse = baseStakeRF; // Use Rise/Fall specific stake
        }

        const trade_option: any = {
            amount: Number(stakeToUse),
            basis: 'stake',
            currency: accountCurrency,
            symbol: selectedVolatility,
        };

        if (selectedTradeType === 'RISE' || selectedTradeType === 'FALL') {
            trade_option.duration = ticksRF;
            trade_option.duration_unit = 't'; // Rise/Fall typically uses ticks duration
        } else {
            trade_option.duration = Number(duration);
            trade_option.duration_unit = durationType;
        }

        // Choose prediction based on trade type and last outcome
        if (selectedTradeType === 'DIGITOVER' || selectedTradeType === 'DIGITUNDER') {
            trade_option.prediction = Number(lastOutcomeWasLossRef.current ? underPrediction : overPrediction);
        }

        const buy_req = tradeOptionToBuy(selectedTradeType, trade_option);
        const { buy, error } = await derivApiRef.current.buy(buy_req);
        if (error) throw error;
        setStatusMessage(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stakeToUse}`);
        return buy;
    };

    // Start trading handler with full run panel integration
    const handleStartTrading = useCallback(async () => {
        if (!derivApiRef.current) {
            setStatusMessage('No connection available');
            return;
        }

        setStatusMessage('');
        setIsRunning(true);
        setIsTrading(true);
        stopFlagRef.current = false;

        // Initialize run panel
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1); // Transactions tab index in run panel tabs
        run_panel.run_id = `ml-trader-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake); // Sync with general stake if not using RF stake

            while (!stopFlagRef.current) {
                // Determine which stake and duration to use based on trade type
                let currentStake = stake;
                let currentDuration = duration;
                let currentDurationType = durationType;

                if (selectedTradeType === 'RISE' || selectedTradeType === 'FALL') {
                    currentStake = baseStakeRF;
                    currentDuration = ticksRF;
                    currentDurationType = 't'; // Explicitly set to ticks for Rise/Fall
                }

                // Adjust stake based on martingale strategy
                const effectiveStake = step > 0 ? Number((currentStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : currentStake;
                setStake(effectiveStake); // Update general stake for display, but use specific ones for purchase

                // Update prediction strategy based on prior outcomes
                const isOU = selectedTradeType === 'DIGITOVER' || selectedTradeType === 'DIGITUNDER';
                if (isOU) {
                    lastOutcomeWasLossRef.current = lossStreak > 0;
                }

                const buy = await purchaseOnce();

                // Seed an initial transaction row immediately so the UI shows a live row
                try {
                    const symbol_display = availableSymbols.find(s => s.symbol === selectedVolatility)?.display_name || selectedVolatility;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: accountCurrency,
                        contract_type: selectedTradeType as any,
                        underlying: selectedVolatility,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}

                // Reflect stage immediately after successful buy
                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                // Subscribe to contract updates for this purchase and push to transactions
                try {
                    const res = await derivApiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: buy?.contract_id,
                        subscribe: 1,
                    });
                    const { error, proposal_open_contract: pocInit, subscription } = res || {};
                    if (error) throw error;

                    let pocSubId: string | null = subscription?.id || null;
                    const targetId = String(buy?.contract_id || '');

                    // Push initial snapshot if present in the first response
                    if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                        transactions.onBotContractEvent(pocInit);
                        run_panel.setHasOpenContract(true);
                    }

                    // Listen for subsequent streaming updates
                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const data = JSON.parse(evt.data as any);
                            if (data?.msg_type === 'proposal_open_contract') {
                                const poc = data.proposal_open_contract;
                                if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                                if (String(poc?.contract_id || '') === targetId) {
                                    transactions.onBotContractEvent(poc);
                                    run_panel.setHasOpenContract(true);

                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                        if (pocSubId) derivApiRef.current?.forget?.({ forget: pocSubId });
                                        derivApiRef.current?.connection?.removeEventListener('message', onMsg);

                                        const profit = Number(poc?.profit || 0);
                                        if (profit > 0) {
                                            lastOutcomeWasLossRef.current = false;
                                            lossStreak = 0;
                                            step = 0;
                                            // Reset to base stake on win
                                            setStake(baseStake); // Reset general stake
                                            if (selectedTradeType === 'RISE' || selectedTradeType === 'FALL') {
                                                setBaseStakeRF(baseStakeRF); // Ensure RF base stake is maintained or reset if needed
                                            }
                                        } else {
                                            lastOutcomeWasLossRef.current = true;
                                            lossStreak++;
                                            step = Math.min(step + 1, 10); // Cap at 10 steps to prevent excessive stake
                                        }
                                    }
                                }
                            }
                        } catch {
                            // noop
                        }
                    };
                    derivApiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    console.error('subscribe poc error', subErr);
                }

                // Wait between purchases
                await new Promise(res => setTimeout(res, 500));
            }

        } catch (error: any) {
            console.error('ML Trader run loop error', error);
            const msg = error?.message || error?.error?.message || 'Something went wrong';
            setStatusMessage(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            setIsTrading(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    }, [selectedVolatility, selectedTradeType, duration, durationType, stake, baseStake, overPrediction, underPrediction, martingaleMultiplier, accountCurrency, availableSymbols, run_panel, transactions, baseStakeRF, ticksRF, martingaleRF]);

    // Stop trading function
    const handleStopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        setIsTrading(false);
        setStatusMessage('Trading stopped');

        // Cleanup live ticks
        stopTicks();

        // Update Run Panel state
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
    };

    // Listen for Run Panel stop events
    useEffect(() => {
        const handleRunPanelStop = () => {
            if (isRunning) { // Only stop if currently trading
                handleStopTrading();
            }
        };

        // Register listener for Run Panel stop button
        if (run_panel?.dbot?.observer) {
            run_panel.dbot.observer.register('bot.stop', handleRunPanelStop);
            run_panel.dbot.observer.register('bot.click_stop', handleRunPanelStop);
        }

        return () => {
            // Cleanup listeners if they were registered
            if (run_panel?.dbot?.observer) {
                run_panel.dbot.observer.unregisterAll('bot.stop');
                run_panel.dbot.observer.unregisterAll('bot.click_stop');
            }
        };
    }, [isRunning, run_panel]);

    return (
        <div className='ml-trader'>
            <div className='ml-trader__container'>
                <div className='ml-trader__header'>
                    <h2 className='ml-trader__title'>{localize('Digit Trading System')}</h2>
                    <p className='ml-trader__subtitle'>{localize('Automated digit prediction trading')}</p>
                </div>

                <div className='ml-trader__content'>
                    <div className='ml-trader__card'>
                        <div className='ml-trader__form'>
                            {/* First Row */}
                            <div className='ml-trader__row'>
                                <div className='ml-trader__field'>
                                    <label>{localize('Volatility')}</label>
                                    <select
                                        value={selectedVolatility}
                                        onChange={(e) => {
                                            const newVolatility = e.target.value;
                                            setSelectedVolatility(newVolatility);
                                            setRiseFallVolatility(newVolatility); // Also update for Rise/Fall card
                                            if (derivApiRef.current && !isTrading) {
                                                loadHistoricalData(newVolatility);
                                                startTicks(newVolatility);
                                            }
                                        }}
                                        disabled={isTrading}
                                    >
                                        {availableSymbols.map(item => (
                                            <option key={item.symbol} value={item.symbol}>
                                                {item.display_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className='ml-trader__field'>
                                    <label>{localize('Trade type')}</label>
                                    <select
                                        value={selectedTradeType}
                                        onChange={(e) => setSelectedTradeType(e.target.value)}
                                        disabled={isTrading}
                                    >
                                        {TRADE_TYPES.map(item => (
                                            <option key={item.value} value={item.value}>
                                                {item.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Second Row */}
                            <div className='ml-trader__row'>
                                <div className='ml-trader__field'>
                                    <label>{localize('Duration Type')}</label>
                                    <select
                                        value={durationType}
                                        onChange={(e) => setDurationType(e.target.value)}
                                        disabled={isTrading || selectedTradeType === 'RISE' || selectedTradeType === 'FALL'}
                                    >
                                        <option value="t">{localize('Ticks')}</option>
                                        <option value="s">{localize('Seconds')}</option>
                                        <option value="m">{localize('Minutes')}</option>
                                    </select>
                                </div>

                                <div className='ml-trader__field'>
                                    <label>{localize('Duration')}</label>
                                    <input
                                        type='number'
                                        min='1'
                                        max='10'
                                        value={selectedTradeType === 'RISE' || selectedTradeType === 'FALL' ? ticksRF : duration}
                                        onChange={(e) => {
                                            if (selectedTradeType === 'RISE' || selectedTradeType === 'FALL') {
                                                setTicksRF(parseInt(e.target.value));
                                            } else {
                                                setDuration(parseInt(e.target.value));
                                            }
                                        }}
                                        disabled={isTrading}
                                    />
                                </div>
                            </div>

                            {/* Third Row */}
                            <div className='ml-trader__row ml-trader__row--stake'>
                                <div className='ml-trader__field'>
                                    <label>{localize('Stake')}</label>
                                    <input
                                        type='number'
                                        step='0.01'
                                        min='0.35'
                                        value={selectedTradeType === 'RISE' || selectedTradeType === 'FALL' ? baseStakeRF : stake}
                                        onChange={(e) => {
                                            if (selectedTradeType === 'RISE' || selectedTradeType === 'FALL') {
                                                setBaseStakeRF(parseFloat(e.target.value));
                                            } else {
                                                setStake(parseFloat(e.target.value));
                                            }
                                        }}
                                        disabled={isTrading}
                                    />
                                </div>

                                {(selectedTradeType === 'DIGITOVER' || selectedTradeType === 'DIGITUNDER' || selectedTradeType === 'DIGITMATCH' || selectedTradeType === 'DIGITDIFF') && (
                                    <div className='ml-trader__predictions'>
                                        <div className='ml-trader__field'>
                                            <label>{localize('Over/Under prediction (pre-loss)')}</label>
                                            <input
                                                type='number'
                                                min='0'
                                                max='9'
                                                value={overPrediction}
                                                onChange={(e) => setOverPrediction(parseInt(e.target.value))}
                                                disabled={isTrading}
                                            />
                                        </div>

                                        <div className='ml-trader__field'>
                                            <label>{localize('Over/Under prediction (after loss)')}</label>
                                            <input
                                                type='number'
                                                min='0'
                                                max='9'
                                                value={underPrediction}
                                                onChange={(e) => setUnderPrediction(parseInt(e.target.value))}
                                                disabled={isTrading}
                                            />
                                        </div>

                                        <div className='ml-trader__field'>
                                            <label>{localize('Martingale multiplier')}</label>
                                            <input
                                                type='number'
                                                step='0.1'
                                                min='1'
                                                max='3'
                                                value={martingaleMultiplier}
                                                onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value))}
                                                disabled={isTrading}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Status Section */}
                        <div className='ml-trader__status'>
                            <div className='ml-trader__status-row'>
                                <Text size='s'>
                                    {localize('Ticks Processed')}: {ticksProcessed}
                                </Text>
                                <Text size='s'>
                                    {localize('Last Digit')}: {lastDigit}
                                </Text>
                                <Text size='s'>
                                    {localize('Current Price')}: {currentPrice}
                                </Text>
                            </div>
                        </div>

                        {/* Status Message */}
                        <div className='ml-trader__message'>
                            <Text size='xs' color='general'>
                                {statusMessage}
                            </Text>
                        </div>

                        {/* Action Button */}
                        <div className='ml-trader__actions'>
                            {!isTrading ? (
                                <button
                                    className='ml-trader__btn ml-trader__btn--start'
                                    onClick={handleStartTrading}
                                    disabled={connectionStatus !== 'Connected'}
                                >
                                    {localize('Start Trading')}
                                </button>
                            ) : (
                                <button
                                    className='ml-trader__btn ml-trader__btn--stop'
                                    onClick={handleStopTrading}
                                >
                                    {localize('Stop Trading')}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Market Analysis Cards */}
                    <div className='ml-trader__analysis-cards'>
                        {availableSymbols.map(symbolObj => (
                            <div key={symbolObj.symbol} className='ml-trader__analysis-card'>
                                <h3 className='ml-trader__analysis-card-title'>{symbolObj.display_name}</h3>
                                {marketAnalysis[symbolObj.symbol] ? (
                                    <>
                                        <p>{localize('Average Digit')}: {marketAnalysis[symbolObj.symbol].averageDigit?.toFixed(2)}</p>
                                        {/* Add more analysis data here */}
                                    </>
                                ) : (
                                    <p>{localize('Loading analysis...')}</p>
                                )}
                            </div>
                        ))}

                        {/* Rise/Fall Analysis Card */}
                        <div className='ml-trader__analysis-card'>
                            <h3 className='ml-trader__analysis-card-title'>{localize('Rise/Fall Analysis')}</h3>
                            <select
                                value={riseFallVolatility}
                                onChange={(e) => {
                                    setRiseFallVolatility(e.target.value);
                                    if (!isTrading) {
                                        loadHistoricalData(e.target.value);
                                        startTicks(e.target.value); // Start ticks for the selected Rise/Fall volatility
                                    }
                                }}
                                disabled={isTrading}
                            >
                                {availableSymbols.map(item => (
                                    <option key={item.symbol} value={item.symbol}>
                                        {item.display_name}
                                    </option>
                                ))}
                            </select>
                            <div>
                                <p>{localize('Rise')}: {riseAnalysis.percentage.toFixed(2)}% (Confidence: {riseAnalysis.confidence.toFixed(2)}%)</p>
                                <p>{localize('Fall')}: {fallAnalysis.percentage.toFixed(2)}% (Confidence: {fallAnalysis.confidence.toFixed(2)}%)</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLTrader;