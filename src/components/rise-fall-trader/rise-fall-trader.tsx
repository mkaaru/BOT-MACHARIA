
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Play, Square, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './rise-fall-trader.scss';

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

const RiseFallTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions, client } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state - Rise/Fall specific (fixed to Rise/Fall mode)
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
    const [entrySpot, setEntrySpot] = useState<number>(0);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

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
                console.error('RiseFallTrader init error', e);
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

    // Rise/Fall mode - tick-based contracts using real Deriv API
    const purchaseRiseFallContract = async () => {
        await authorizeIfNeeded();

        try {
            // Map contract types correctly for Rise/Fall
            let apiContractType = contractType;
            if (contractType === 'CALL') apiContractType = 'CALL'; // Rise
            if (contractType === 'PUT') apiContractType = 'PUT'; // Fall

            const proposalPayload = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: apiContractType,
                currency: account_currency,
                duration: duration,
                duration_unit: 't', // ticks
                symbol: symbol,
            };

            console.log('Rise/Fall Proposal payload:', proposalPayload);
            setStatus('Getting proposal...');

            const proposalResponse = await apiRef.current.send(proposalPayload);

            if (proposalResponse.error) {
                setStatus(`Proposal error: ${proposalResponse.error.message}`);
                console.error('Proposal error:', proposalResponse.error);
                return;
            }

            const proposal = proposalResponse.proposal;
            console.log('Rise/Fall Proposal response:', proposal);

            setStatus('Purchasing contract...');

            const buyPayload = {
                buy: proposal.id,
                price: proposal.ask_price,
            };

            console.log('Rise/Fall Buy payload:', buyPayload);

            const buyResponse = await apiRef.current.send(buyPayload);

            if (buyResponse.error) {
                setStatus(`Purchase error: ${buyResponse.error.message}`);
                console.error('Purchase error:', buyResponse.error);
                return;
            }

            const purchase = buyResponse.buy;
            console.log('Rise/Fall Purchase response:', purchase);

            setStatus(`Contract purchased: ${purchase.contract_id}`);
            setPotentialPayout(purchase.payout || 0);
            setContractValue(purchase.buy_price || 0);

            // Subscribe to contract updates
            if (purchase.contract_id) {
                try {
                    const contractResponse = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: purchase.contract_id,
                        subscribe: 1
                    });

                    if (contractResponse.subscription?.id) {
                        console.log('Subscribed to contract updates');
                    }
                } catch (contractError) {
                    console.error('Contract subscription error:', contractError);
                }
            }

            // Update statistics
            setTotalStake(prev => prev + stake);
            setTotalRuns(prev => prev + 1);

            // Handle martingale logic if the previous trade was a loss
            if (lastOutcomeWasLossRef.current) {
                setStake(prev => Math.max(0.35, prev * martingaleMultiplier));
            }

        } catch (error) {
            console.error('Rise/Fall Contract purchase error:', error);
            setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const startTrading = async () => {
        if (!symbol) {
            setStatus('Please select a symbol');
            return;
        }

        setIsRunning(true);
        stopFlagRef.current = false;
        setStatus('Starting Rise/Fall trading...');

        try {
            await authorizeIfNeeded();
            
            while (!stopFlagRef.current) {
                await purchaseRiseFallContract();
                
                // Wait for contract to complete or a timeout
                await new Promise(resolve => setTimeout(resolve, (duration + 2) * 1000)); // Wait for duration + buffer
                
                if (stopFlagRef.current) break;
            }
        } catch (error) {
            console.error('Trading error:', error);
            setStatus(`Trading error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsRunning(false);
            setStatus('Trading stopped');
        }
    };

    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        setStatus('Stopping trading...');
    };

    const resetStats = () => {
        setTotalStake(0);
        setTotalPayout(0);
        setTotalRuns(0);
        setContractsWon(0);
        setContractsLost(0);
        setTotalProfitLoss(0);
        setStake(baseStake);
    };

    return (
        <div className="rise-fall-trader">
            <div className="rise-fall-trader__container">
                <div className="rise-fall-trader__content">
                    <div className="rise-fall-trader__card">
                        <h3>{localize('Rise/Fall Trader')}</h3>
                        
                        {/* Symbol Selection */}
                        <div className="rise-fall-trader__row">
                            <div className="rise-fall-trader__field">
                                <label htmlFor="symbol">{localize('Symbol')}</label>
                                <select
                                    id="symbol"
                                    value={symbol}
                                    onChange={e => {
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
                        </div>

                        {/* Price Display */}
                        {currentPrice > 0 && (
                            <div className="rise-fall-trader__price-display">
                                <h4>{localize('Current Price')}</h4>
                                <p>{currentPrice.toFixed(5)}</p>
                                <p>{localize('Ticks processed')}: {ticksProcessed}</p>
                            </div>
                        )}

                        {/* Contract Type Selection */}
                        <div className="rise-fall-trader__row">
                            <div className="rise-fall-trader__field">
                                <label>{localize('Contract Type')}</label>
                                <div className="contract-type-buttons">
                                    <button
                                        className={`contract-btn rise-btn ${contractType === 'CALL' ? 'active' : ''}`}
                                        onClick={() => setContractType('CALL')}
                                    >
                                        {localize('Rise')}
                                    </button>
                                    <button
                                        className={`contract-btn fall-btn ${contractType === 'PUT' ? 'active' : ''}`}
                                        onClick={() => setContractType('PUT')}
                                    >
                                        {localize('Fall')}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Trading Parameters */}
                        <div className="rise-fall-trader__row rise-fall-trader__row--two">
                            <div className="rise-fall-trader__field">
                                <label htmlFor="duration">{localize('Duration (Ticks)')}</label>
                                <input
                                    id="duration"
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                />
                            </div>
                            <div className="rise-fall-trader__field">
                                <label htmlFor="stake">{localize('Stake Amount')}</label>
                                <input
                                    id="stake"
                                    type="number"
                                    step="0.01"
                                    min={0.35}
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        {/* Martingale Settings */}
                        <h4>{localize('Risk Management')}</h4>
                        <div className="rise-fall-trader__row rise-fall-trader__row--two">
                            <div className="rise-fall-trader__field">
                                <label htmlFor="martingale">{localize('Martingale Multiplier')}</label>
                                <input
                                    id="martingale"
                                    type="number"
                                    step="0.1"
                                    min={1}
                                    value={martingaleMultiplier}
                                    onChange={e => setMartingaleMultiplier(Number(e.target.value))}
                                />
                            </div>
                            <div className="rise-fall-trader__field">
                                <label htmlFor="target-profit">{localize('Target Profit')}</label>
                                <input
                                    id="target-profit"
                                    type="number"
                                    step="0.01"
                                    min={1}
                                    value={targetProfit}
                                    onChange={e => setTargetProfit(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className="rise-fall-trader__field">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={useStopOnProfit}
                                    onChange={e => setUseStopOnProfit(e.target.checked)}
                                />
                                {localize('Stop on target profit')}
                            </label>
                        </div>

                        {/* Trading Statistics */}
                        <div className="rise-fall-trader__stats">
                            <h4>{localize('Trading Statistics')}</h4>
                            <div className="stats-grid">
                                <div className="stat-item">
                                    <span>{localize('Total Runs')}</span>
                                    <span>{totalRuns}</span>
                                </div>
                                <div className="stat-item">
                                    <span>{localize('Total Stake')}</span>
                                    <span>{totalStake.toFixed(2)} {account_currency}</span>
                                </div>
                                <div className="stat-item">
                                    <span>{localize('Total Payout')}</span>
                                    <span>{totalPayout.toFixed(2)} {account_currency}</span>
                                </div>
                                <div className="stat-item">
                                    <span>{localize('Contracts Won')}</span>
                                    <span className="win">{contractsWon}</span>
                                </div>
                                <div className="stat-item">
                                    <span>{localize('Contracts Lost')}</span>
                                    <span className="loss">{contractsLost}</span>
                                </div>
                                <div className="stat-item">
                                    <span>{localize('Profit/Loss')}</span>
                                    <span className={totalProfitLoss >= 0 ? 'profit' : 'loss'}>
                                        {totalProfitLoss.toFixed(2)} {account_currency}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={resetStats}
                                className="reset-stats-btn"
                                disabled={is_running}
                            >
                                {localize('Reset Statistics')}
                            </button>
                        </div>

                        {/* Contract Information */}
                        {(contractValue > 0 || potentialPayout > 0) && (
                            <div className="rise-fall-trader__contract-info">
                                <h4>{localize('Current Contract')}</h4>
                                <div className="contract-stats">
                                    <div className="stat-item">
                                        <span>{localize('Contract Value')}</span>
                                        <span>{contractValue.toFixed(2)} {account_currency}</span>
                                    </div>
                                    <div className="stat-item">
                                        <span>{localize('Potential Payout')}</span>
                                        <span>{potentialPayout.toFixed(2)} {account_currency}</span>
                                    </div>
                                    <div className="stat-item">
                                        <span>{localize('Current P&L')}</span>
                                        <span className={currentProfit >= 0 ? 'profit' : 'loss'}>
                                            {currentProfit.toFixed(2)} {account_currency}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Trading Controls */}
                        <div className="rise-fall-trader__buttons">
                            {!is_running ? (
                                <button
                                    onClick={startTrading}
                                    className="btn-start"
                                    disabled={!symbol}
                                >
                                    <Play className="icon" />
                                    <span>{localize('Start Rise/Fall Trading')}</span>
                                </button>
                            ) : (
                                <button
                                    onClick={stopTrading}
                                    className="btn-stop"
                                >
                                    <Square className="icon" />
                                    <span>{localize('Stop Trading')}</span>
                                </button>
                            )}
                        </div>

                        {/* Status Display */}
                        {status && (
                            <div className="rise-fall-trader__status">
                                <Text size="sm">{status}</Text>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default RiseFallTrader;
