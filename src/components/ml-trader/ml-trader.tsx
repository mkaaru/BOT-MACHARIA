
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Mock TradingEngine for demonstration purposes. In a real scenario, this would be imported and configured.
const tradingEngine = {
    isEngineConnected: () => true, // Assume connected for this example
    getProposal: async (params: any) => {
        // Simulate a successful proposal response
        return {
            proposal: {
                id: `proposal_${Math.random().toString(36).substr(2, 9)}`,
                ask_price: parseFloat((params.amount * 1.95).toFixed(2)), // Simulate a price
                longcode: `${params.contract_type} ${params.symbol}`,
                // Add other necessary proposal fields if needed
            },
            error: null,
        };
    },
    buyContract: async (proposal_id: string, price: number) => {
        // Simulate a successful contract purchase
        const contract_id = `contract_${Math.random().toString(36).substr(2, 9)}`;
        return {
            buy: {
                id: contract_id,
                contract_id: contract_id,
                buy_price: price,
                payout: price * 1.95, // Simulate payout
                transaction_id: `tx_${Math.random().toString(36).substr(2, 9)}`,
                longcode: 'Simulated Rise/Fall Contract',
                shortcode: 'RISEFALL',
                start_time: Math.floor(Date.now() / 1000),
                symbol: 'R_100', // Example symbol
                contract_type: 'CALL',
                currency: 'USD',
                // Add other necessary purchase receipt fields
            },
            error: null,
        };
    },
    subscribeToContract: async (contract_id: string) => {
        // Simulate subscription
        console.log(`Subscribing to contract ${contract_id}`);
        return { error: null };
    },
    getWebSocket: () => {
        // In a real implementation, this would return the actual WebSocket connection
        // For this mock, we'll simulate it by returning an object with addEventListener and removeEventListener
        let listeners: { [key: string]: ((event: MessageEvent) => void)[] } = {};
        return {
            addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
                if (!listeners[type]) listeners[type] = [];
                listeners[type].push(listener);
            },
            removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
                if (listeners[type]) {
                    listeners[type] = listeners[type].filter(l => l !== listener);
                }
            },
            // Mock dispatchEvent to simulate receiving messages
            dispatchEvent: (event: MessageEvent) => {
                if (listeners['message']) {
                    listeners['message'].forEach(listener => listener(event));
                }
            }
        };
    },
};

// Volatility indices for Rise/Fall trading
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
    const buy: any = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis || 'stake',
            contract_type,
            currency: trade_option.currency,
            symbol: trade_option.symbol,
        },
    };

    // Add duration
    if (trade_option.duration !== undefined && trade_option.duration_unit !== undefined) {
        buy.parameters.duration = trade_option.duration;
        buy.parameters.duration_unit = trade_option.duration_unit;
    }

    return buy;
};

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions, client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state - Rise/Fall specific
    const [symbol, setSymbol] = useState<string>('');
    const [contractType, setContractType] = useState<string>('CALL'); // CALL for Rise, PUT for Fall
    const [duration, setDuration] = useState<number>(1); // Duration in ticks for Rise/Fall
    const [durationType, setDurationType] = useState<string>('t'); // 't' for ticks
    const [stake, setStake] = useState<number>(1.0);
    const [baseStake, setBaseStake] = useState<number>(1.0);

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
    const [entrySpot, setEntrySpot] = useState<number>(0); // For Rise/Fall mode
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    // Hull Moving Average trend analysis state - using 1000 tick increments for stability
    const [hullTrends, setHullTrends] = useState({
        '1000': { trend: 'NEUTRAL', value: 0 },
        '2000': { trend: 'NEUTRAL', value: 0 },
        '3000': { trend: 'NEUTRAL', value: 0 },
        '4000': { trend: 'NEUTRAL', value: 0 }
    });
    const [tickData, setTickData] = useState<Array<{ time: number, price: number, close: number }>>([]);
    const [tradeHistory, setTradeHistory] = useState<Array<any>>([]);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);
    const lastOutcomeWasLossRef = useRef(false);

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

                if (!symbol && syn[0]?.symbol) {
                    setSymbol(syn[0].symbol);
                    startTicks(syn[0].symbol);
                }
            } catch (e: any) {
                console.error('MLTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
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
                        setEntrySpot(quote); // Update entry spot for Rise/Fall
                        setTicksProcessed(prev => prev + 1);

                        setTickData(prev => {
                            const newTickData = [...prev, {
                                time: tickTime,
                                price: quote,
                                close: quote
                            }];

                            return newTickData.slice(-4000);
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

    // Rise/Fall mode - tick-based contracts using real Deriv API
    const purchaseRiseFallContract = async () => {
        await authorizeIfNeeded();

        try {
            // Map contract types correctly for Rise/Fall
            let apiContractType = contractType;
            if (contractType === 'CALL') apiContractType = 'CALL'; // Rise
            if (contractType === 'PUT') apiContractType = 'PUT'; // Fall

            setStatus(`Getting proposal for ${apiContractType} contract...`);

            // Get proposal using real Deriv API
            const proposalParams = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: apiContractType,
                currency: account_currency,
                duration: 1, // Duration is 1 tick for Rise/Fall
                duration_unit: 't', // tick unit
                symbol: symbol,
            };

            console.log('Getting proposal for Rise/Fall:', proposalParams);

            const proposalResponse = await apiRef.current.send(proposalParams);

            if (proposalResponse.error) {
                setStatus(`Proposal failed: ${proposalResponse.error.message}`);
                console.error('Proposal error:', proposalResponse.error);
                return;
            }

            const proposal = proposalResponse.proposal;
            if (!proposal) {
                setStatus('No proposal received');
                return;
            }

            setStatus(`Purchasing ${apiContractType} contract...`);

            // Buy contract using real Deriv API
            const buyParams = {
                buy: proposal.id,
                price: proposal.ask_price
            };

            const buyResponse = await apiRef.current.send(buyParams);

            if (buyResponse.error) {
                setStatus(`Trade failed: ${buyResponse.error.message}`);
                console.error('Buy error:', buyResponse.error);
                return;
            }

            const purchase = buyResponse.buy;
            console.log('Rise/Fall Contract purchased:', purchase);

            // Update statistics
            setTotalStake(prev => prev + stake);
            setTotalRuns(prev => prev + 1);

            // Add to trade history
            const tradeRecord = {
                id: purchase.contract_id,
                symbol: symbol,
                contract_type: apiContractType,
                buy_price: purchase.buy_price,
                payout: purchase.payout,
                timestamp: new Date().toISOString(),
                status: 'purchased'
            };

            setTradeHistory(prev => [tradeRecord, ...prev.slice(0, 99)]);

            setStatus(`${apiContractType} contract purchased successfully! Contract ID: ${purchase.contract_id}`);

            // Subscribe to contract updates
            try {
                const contractSubscription = await apiRef.current.send({
                    proposal_open_contract: 1,
                    contract_id: purchase.contract_id,
                    subscribe: 1
                });

                if (contractSubscription.error) {
                    console.error('Contract subscription error:', contractSubscription.error);
                } else {
                    console.log('Subscribed to contract updates');
                }
            } catch (subscriptionError) {
                console.error('Error subscribing to contract:', subscriptionError);
            }

        } catch (error) {
            console.error('Purchase error:', error);
            setStatus(`Purchase failed: ${error}`);
        }
    };

    const handleStartTrading = () => {
        if (is_running) {
            setIsRunning(false);
            stopFlagRef.current = true;
            setStatus('Trading stopped');
        } else {
            setIsRunning(true);
            stopFlagRef.current = false;
            setStatus('Trading started');
        }
    };

    const handleManualTrade = (tradeType: string) => {
        setContractType(tradeType);
        purchaseRiseFallContract();
    };

    return (
        <div className="ml-trader">
            <div className="ml-trader__header">
                <Text size="xl" weight="bold">
                    Rise/Fall Trader
                </Text>
                <div className="ml-trader__status">
                    <Text size="sm" color={is_running ? 'success' : 'general'}>
                        {is_running ? 'Active' : 'Inactive'}
                    </Text>
                </div>
            </div>

            <div className="ml-trader__controls">
                <div className="control-group">
                    <Text size="sm" weight="bold">Symbol</Text>
                    <select 
                        value={symbol} 
                        onChange={(e) => {
                            setSymbol(e.target.value);
                            startTicks(e.target.value);
                        }}
                    >
                        {symbols.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="control-group">
                    <Text size="sm" weight="bold">Stake ({account_currency})</Text>
                    <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={stake}
                        onChange={(e) => setStake(parseFloat(e.target.value) || 1)}
                    />
                </div>

                <div className="control-group">
                    <Text size="sm" weight="bold">Duration</Text>
                    <input
                        type="number"
                        min="1"
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                    />
                    <select 
                        value={durationType} 
                        onChange={(e) => setDurationType(e.target.value)}
                    >
                        <option value="t">Ticks</option>
                    </select>
                </div>
            </div>

            <div className="ml-trader__market-info">
                <div className="market-data">
                    <Text size="sm" weight="bold">Current Price: {currentPrice.toFixed(5)}</Text>
                    <Text size="sm">Entry Spot: {entrySpot.toFixed(5)}</Text>
                    <Text size="sm">Ticks Processed: {ticksProcessed}</Text>
                </div>
            </div>

            <div className="ml-trader__actions">
                <div className="contract-buttons">
                    <button
                        className="contract-btn rise-btn"
                        onClick={() => handleManualTrade('CALL')}
                        disabled={is_running}
                    >
                        <TrendingUp size={16} />
                        Rise
                    </button>
                    <button
                        className="contract-btn fall-btn"
                        onClick={() => handleManualTrade('PUT')}
                        disabled={is_running}
                    >
                        <TrendingDown size={16} />
                        Fall
                    </button>
                </div>

                <button
                    className={`trading-btn ${is_running ? 'stop' : 'start'}`}
                    onClick={handleStartTrading}
                >
                    {is_running ? (
                        <>
                            <Square size={16} />
                            Stop Trading
                        </>
                    ) : (
                        <>
                            <Play size={16} />
                            Start Auto Trading
                        </>
                    )}
                </button>
            </div>

            <div className="ml-trader__statistics">
                <Text size="sm" weight="bold">Trading Statistics</Text>
                <div className="stats-grid">
                    <div className="stat-item">
                        <Text size="xs">Total Runs</Text>
                        <Text size="sm" weight="bold">{totalRuns}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Won</Text>
                        <Text size="sm" weight="bold" color="success">{contractsWon}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Lost</Text>
                        <Text size="sm" weight="bold" color="danger">{contractsLost}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Total Stake</Text>
                        <Text size="sm" weight="bold">{totalStake.toFixed(2)} {account_currency}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">Total Payout</Text>
                        <Text size="sm" weight="bold">{totalPayout.toFixed(2)} {account_currency}</Text>
                    </div>
                    <div className="stat-item">
                        <Text size="xs">P&L</Text>
                        <Text 
                            size="sm" 
                            weight="bold" 
                            color={totalProfitLoss >= 0 ? 'success' : 'danger'}
                        >
                            {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)} {account_currency}
                        </Text>
                    </div>
                </div>
            </div>

            {status && (
                <div className="ml-trader__status-message">
                    <Text size="sm">{status}</Text>
                </div>
            )}

            {tradeHistory.length > 0 && (
                <div className="ml-trader__history">
                    <Text size="sm" weight="bold">Recent Trades</Text>
                    <div className="history-list">
                        {tradeHistory.slice(0, 5).map((trade, index) => (
                            <div key={trade.id || index} className="history-item">
                                <Text size="xs">
                                    {trade.contract_type} - {trade.buy_price} {account_currency}
                                </Text>
                                <Text size="xs" color="general">
                                    {new Date(trade.timestamp).toLocaleTimeString()}
                                </Text>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

export default MLTrader;
