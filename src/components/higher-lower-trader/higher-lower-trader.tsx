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

const HigherLowerTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions, client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state - Higher/Lower specific
    const [symbol, setSymbol] = useState<string>('R_100');
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
    const [entrySpot, setEntrySpot] = useState<number>(0);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Trading statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    const [status, setStatus] = useState<string>('Initializing...');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);
    const lastOutcomeWasLossRef = useRef(false);

    // Trading mode state (Higher/Lower or Rise/Fall)
    const [tradingMode, setTradingMode] = useState<'HIGHER_LOWER' | 'RISE_FALL'>('HIGHER_LOWER');

    // --- Helper Functions ---

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
        const loginid = response.authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(response.authorize?.currency || 'USD');
        try {
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(response.authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {}
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
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    // Original Higher/Lower trading logic
    const executeHigherLowerTrade = useCallback(async () => {
        if (!apiRef.current || !symbol || !currentPrice) return;

        setIsRunning(true);
        stopFlagRef.current = false;

        try {
            const targetBarrier = parseFloat(barrier);
            const tradeContractType = currentPrice > targetBarrier ? 'CALL' : 'PUT';

            // Get proposal using current API instance
            const proposalParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: tradeContractType,
                currency: account_currency,
                duration: duration,
                duration_unit: durationType,
                symbol: symbol,
                barrier: targetBarrier.toString()
            };

            const proposalResponse = await apiRef.current.send(proposalParams);

            if (proposalResponse.error) {
                console.error('Higher/Lower proposal error:', proposalResponse.error);
                setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                setIsRunning(false);
                return;
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                setStatus('No proposal received');
                setIsRunning(false);
                return;
            }

            // Buy contract
            const buyParams = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            const buyResponse = await apiRef.current.send(buyParams);

            if (buyResponse.error) {
                console.error('Higher/Lower buy error:', buyResponse.error);
                setStatus(`Trade failed: ${buyResponse.error.message}`);
                setIsRunning(false);
                return;
            }

            const purchase_receipt = buyResponse.buy;
            const purchase_price = purchase_receipt.buy_price;

            // Update internal state for tracking
            setTotalStake(prev => prev + Number(stake));
            setTotalRuns(prev => prev + 1);
            setStatus(`Purchased ${tradeContractType} contract for ${symbol}`);

        } catch (error: any) {
            console.error('Higher/Lower trade execution failed:', error);
            setStatus(`Higher/Lower trade execution failed: ${error.message}`);
            setIsRunning(false);
        }
    }, [apiRef, symbol, currentPrice, barrier, stake, account_currency, duration, durationType]);

    const handleStart = async () => {
        if (is_running) {
            handleStop();
            return;
        }

        if (!symbol) {
            setStatus('Please select a symbol');
            return;
        }

        setIsRunning(true);
        stopFlagRef.current = false;
        setStatus('Starting trading...');

        try {
            await authorizeIfNeeded();
            await executeHigherLowerTrade();
        } catch (error: any) {
            console.error('Trading start error:', error);
            setStatus(`Failed to start trading: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    const handleStop = () => {
        stopTrading();
    };

    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        stopTicks();
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

    // Effect to initialize API connection and fetch active symbols
    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;

        const init = async () => {
            try {
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;

                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol) || s.symbol.startsWith('BOOM') || s.symbol.startsWith('CRASH') || s.symbol === 'stpRNG')
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));

                setSymbols(syn);
                setStatus('Connected and ready');

                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    startTicks(syn[0].symbol);
                }
            } catch (e: any) {
                console.error('HigherLowerTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
            }
        };

        init();

        return () => {
            try {
                stopTicks();
                api?.disconnect?.();
            } catch { /* noop */ }
        };
    }, []);

    // Update ticks when symbol changes
    useEffect(() => {
        if (symbol && apiRef.current) {
            startTicks(symbol);
        }
    }, [symbol]);

    return (
        <div className="higher-lower-trader">
            <div className="higher-lower-trader__header">
                <Text size="xl" weight="bold" color="prominent">
                    {localize('Higher/Lower Trader')}
                </Text>
                <div className="higher-lower-trader__status">
                    <Text size="s" color={status.includes('error') || status.includes('failed') ? 'loss-danger' : 'general'}>
                        {status}
                    </Text>
                </div>
            </div>

            <div className="higher-lower-trader__content">
                {/* Trading Mode Selection */}
                <div className="higher-lower-trader__section">
                    <Text size="s" weight="bold" color="prominent">
                        {localize('Trading Mode')}
                    </Text>
                    <div className="higher-lower-trader__mode-selector">
                        <button
                            className={`mode-btn ${tradingMode === 'HIGHER_LOWER' ? 'active' : ''}`}
                            onClick={() => setTradingMode('HIGHER_LOWER')}
                        >
                            Higher/Lower
                        </button>
                        <button
                            className={`mode-btn ${tradingMode === 'RISE_FALL' ? 'active' : ''}`}
                            onClick={() => setTradingMode('RISE_FALL')}
                        >
                            Rise/Fall
                        </button>
                    </div>
                </div>

                {/* Symbol Selection */}
                <div className="higher-lower-trader__section">
                    <Text size="s" weight="bold" color="prominent">
                        {localize('Symbol')}
                    </Text>
                    <select
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        className="higher-lower-trader__select"
                    >
                        {VOLATILITY_INDICES.map((index) => (
                            <option key={index.value} value={index.value}>
                                {index.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Contract Type */}
                <div className="higher-lower-trader__section">
                    <Text size="s" weight="bold" color="prominent">
                        {localize('Contract Type')}
                    </Text>
                    <div className="higher-lower-trader__contract-type">
                        <button
                            className={`contract-btn ${contractType === 'CALL' ? 'active' : ''}`}
                            onClick={() => setContractType('CALL')}
                        >
                            <TrendingUp size={16} />
                            Higher
                        </button>
                        <button
                            className={`contract-btn ${contractType === 'PUT' ? 'active' : ''}`}
                            onClick={() => setContractType('PUT')}
                        >
                            <TrendingDown size={16} />
                            Lower
                        </button>
                    </div>
                </div>

                {/* Trading Parameters */}
                <div className="higher-lower-trader__section">
                    <Text size="s" weight="bold" color="prominent">
                        {localize('Trading Parameters')}
                    </Text>
                    <div className="higher-lower-trader__params">
                        <div className="param-group">
                            <label>Stake ({account_currency})</label>
                            <input
                                type="number"
                                value={stake}
                                onChange={(e) => setStake(Number(e.target.value))}
                                min="1"
                                step="0.01"
                            />
                        </div>
                        <div className="param-group">
                            <label>Duration</label>
                            <input
                                type="number"
                                value={duration}
                                onChange={(e) => setDuration(Number(e.target.value))}
                                min="1"
                            />
                        </div>
                        {tradingMode === 'HIGHER_LOWER' && (
                            <div className="param-group">
                                <label>Barrier</label>
                                <input
                                    type="text"
                                    value={barrier}
                                    onChange={(e) => setBarrier(e.target.value)}
                                    placeholder="+0.37"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Live Data */}
                <div className="higher-lower-trader__section">
                    <Text size="s" weight="bold" color="prominent">
                        {localize('Live Data')}
                    </Text>
                    <div className="higher-lower-trader__live-data">
                        <div className="data-item">
                            <Text size="xs" color="general">Current Price</Text>
                            <Text size="s" weight="bold" color="prominent">
                                {currentPrice.toFixed(5)}
                            </Text>
                        </div>
                        <div className="data-item">
                            <Text size="xs" color="general">Ticks Processed</Text>
                            <Text size="s" weight="bold" color="prominent">
                                {ticksProcessed}
                            </Text>
                        </div>
                    </div>
                </div>

                {/* Trading Statistics */}
                <div className="higher-lower-trader__section">
                    <Text size="s" weight="bold" color="prominent">
                        {localize('Trading Statistics')}
                    </Text>
                    <div className="higher-lower-trader__stats">
                        <div className="stat-item">
                            <Text size="xs" color="general">Total Runs</Text>
                            <Text size="s" weight="bold" color="prominent">{totalRuns}</Text>
                        </div>
                        <div className="stat-item">
                            <Text size="xs" color="general">Won/Lost</Text>
                            <Text size="s" weight="bold" color="prominent">
                                {contractsWon}/{contractsLost}
                            </Text>
                        </div>
                        <div className="stat-item">
                            <Text size="xs" color="general">Total P&L</Text>
                            <Text size="s" weight="bold" color={totalProfitLoss >= 0 ? 'profit-success' : 'loss-danger'}>
                                {totalProfitLoss.toFixed(2)} {account_currency}
                            </Text>
                        </div>
                    </div>
                </div>

                {/* Trading Controls */}
                <div className="higher-lower-trader__controls">
                    <button
                        className={`control-btn start-btn ${is_running ? 'stop' : 'start'}`}
                        onClick={handleStart}
                        disabled={!symbol}
                    >
                        {is_running ? (
                            <>
                                <Square size={16} />
                                Stop Trading
                            </>
                        ) : (
                            <>
                                <Play size={16} />
                                Start Trading
                            </>
                        )}
                    </button>
                    <button
                        className="control-btn reset-btn"
                        onClick={resetStats}
                    >
                        Reset Stats
                    </button>
                </div>
            </div>
        </div>
    );
});

export default HigherLowerTrader;