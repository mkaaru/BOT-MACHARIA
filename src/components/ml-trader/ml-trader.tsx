import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Correct trade types for Deriv API
const TRADE_TYPES = [
    { value: 'CALL', label: 'Rise', description: 'Win if exit spot is higher than entry spot' },
    { value: 'PUT', label: 'Fall', description: 'Win if exit spot is lower than entry spot' },
    { value: 'CALLE', label: 'Rise (Allow Equals)', description: 'Win if exit spot is higher than or equal to entry spot' },
    { value: 'PUTE', label: 'Fall (Allow Equals)', description: 'Win if exit spot is lower than or equal to entry spot' },
];

const HIGHER_LOWER_TYPES = [
    { value: 'CALL', label: 'Higher', description: 'Win if exit spot is higher than barrier' },
    { value: 'PUT', label: 'Lower', description: 'Win if exit spot is lower than barrier' },
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

    // Add barrier for Higher/Lower contracts
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }

    return buy;
};

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const contractInProgressRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);
    const [current_price, setCurrentPrice] = useState<number | null>(null);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [trade_mode, setTradeMode] = useState<'rise_fall' | 'higher_lower'>('rise_fall');
    const [contract_type, setContractType] = useState<string>('CALL');
    const [duration, setDuration] = useState<number>(5);
    const [duration_unit, setDurationUnit] = useState<'t' | 's' | 'm'>('t');
    const [stake, setStake] = useState<number>(1.0);
    const [barrier_offset, setBarrierOffset] = useState<number>(0.001);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    useEffect(() => {
        // Initialize API connection and fetch active symbols
        const api = generateDerivApiInstance();
        apiRef.current = api;

        const init = async () => {
            try {
                // Fetch active symbols (volatility indices)
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;

                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
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
            // Clean up streams and socket
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

            // Cleanup observers on unmount
            if (store?.run_panel?.dbot?.observer) {
                store.run_panel.dbot.observer.unregisterAll('bot.stop');
                store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
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

        try {
            // Sync auth state into shared ClientStore
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
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
        setCurrentPrice(null);

        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            // Listen for streaming ticks on the raw websocket
            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        setCurrentPrice(quote);
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const purchaseContract = async () => {
        await authorizeIfNeeded();

        if (!current_price && trade_mode === 'higher_lower') {
            throw new Error('Current price not available. Please wait for price data.');
        }

        const trade_option: any = {
            amount: Number(stake),
            basis: 'stake',
            currency: account_currency,
            duration: Number(duration),
            duration_unit,
            symbol,
        };

        // Add barrier for Higher/Lower trades
        if (trade_mode === 'higher_lower' && current_price) {
            const barrier_value = contract_type === 'CALL' 
                ? current_price + barrier_offset 
                : current_price - barrier_offset;
            trade_option.barrier = Number(barrier_value.toFixed(5));
        }

        const buy_req = tradeOptionToBuy(contract_type, trade_option);
        console.log('📦 Buy request:', buy_req);

        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;

        contractInProgressRef.current = true;
        console.log(`✅ Purchase confirmed: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id})`);

        setStatus(`Contract purchased: ${buy?.longcode || contract_type}`);

        return buy;
    };

    const onRun = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `ml-trader-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        // Register observers for Run Panel stop events
        if (store?.run_panel?.dbot?.observer) {
            store.run_panel.dbot.observer.register('bot.stop', handleRunPanelStop);
            store.run_panel.dbot.observer.register('bot.click_stop', handleRunPanelStop);
        }

        try {
            while (!stopFlagRef.current) {
                const buy = await purchaseContract();

                // Seed transaction row for UI
                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: contract_type as any,
                        underlying: symbol,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}

                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                // Subscribe to contract updates
                try {
                    const res = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: buy?.contract_id,
                        subscribe: 1,
                    });

                    const { error, proposal_open_contract: pocInit, subscription } = res || {};
                    if (error) throw error;

                    let pocSubId: string | null = subscription?.id || null;
                    const targetId = String(buy?.contract_id || '');

                    if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                        transactions.onBotContractEvent(pocInit);
                        run_panel.setHasOpenContract(true);
                    }

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
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);
                                        contractInProgressRef.current = false;

                                        const profit = Number(poc?.profit || 0);
                                        const result = profit > 0 ? 'WIN' : 'LOSS';
                                        console.log(`${result}: ${profit.toFixed(2)} ${account_currency}`);
                                    }
                                }
                            }
                        } catch {}
                    };
                    apiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    console.error('subscribe poc error', subErr);
                }

                // Wait before next trade
                const waitTime = 5000 + Math.random() * 3000; // 5-8 seconds
                await new Promise(res => setTimeout(res, waitTime));
            }
        } catch (e: any) {
            console.error('MLTrader run loop error', e);
            const msg = e?.message || e?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            contractInProgressRef.current = false;
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    const handleRunPanelStop = () => {
        if (is_running) {
            onStop();
        }
    };

    const onStop = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        stopTicks();
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');

        if (store?.run_panel?.dbot?.observer) {
            store.run_panel.dbot.observer.unregisterAll('bot.stop');
            store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
        }
    };

    const current_trade_types = trade_mode === 'rise_fall' ? TRADE_TYPES : HIGHER_LOWER_TYPES;

    return (
        <div className='ml-trader'>
            <div className='ml-trader__container'>
                <div className='ml-trader__content'>
                    <div className='ml-trader__card'>
                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-symbol'>{localize('Asset')}</label>
                                <select
                                    id='ml-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);
                                        startTicks(v);
                                    }}
                                >
                                    {symbols.map(s => (
                                        <option key={s.symbol} value={s.symbol}>
                                            {s.display_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-trade-mode'>{localize('Trade Mode')}</label>
                                <select
                                    id='ml-trade-mode'
                                    value={trade_mode}
                                    onChange={e => {
                                        setTradeMode(e.target.value as 'rise_fall' | 'higher_lower');
                                        setContractType(e.target.value === 'rise_fall' ? 'CALL' : 'CALL');
                                    }}
                                >
                                    <option value='rise_fall'>Rise/Fall</option>
                                    <option value='higher_lower'>Higher/Lower</option>
                                </select>
                            </div>
                        </div>

                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-contract-type'>{localize('Contract Type')}</label>
                                <select
                                    id='ml-contract-type'
                                    value={contract_type}
                                    onChange={e => setContractType(e.target.value)}
                                >
                                    {current_trade_types.map(t => (
                                        <option key={t.value} value={t.value} title={t.description}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-stake'>{localize('Stake')}</label>
                                <input
                                    id='ml-stake'
                                    type='number'
                                    step='0.01'
                                    min={0.35}
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className='ml-trader__row ml-trader__row--two'>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-duration'>{localize('Duration')}</label>
                                <input
                                    id='ml-duration'
                                    type='number'
                                    min={1}
                                    max={duration_unit === 't' ? 10 : duration_unit === 's' ? 3600 : 60}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                />
                            </div>
                            <div className='ml-trader__field'>
                                <label htmlFor='ml-duration-unit'>{localize('Duration Unit')}</label>
                                <select
                                    id='ml-duration-unit'
                                    value={duration_unit}
                                    onChange={e => setDurationUnit(e.target.value as 't' | 's' | 'm')}
                                >
                                    <option value='t'>Ticks</option>
                                    <option value='s'>Seconds</option>
                                    <option value='m'>Minutes</option>
                                </select>
                            </div>
                        </div>

                        {trade_mode === 'higher_lower' && (
                            <div className='ml-trader__row'>
                                <div className='ml-trader__field'>
                                    <label htmlFor='ml-barrier-offset'>{localize('Barrier Offset')}</label>
                                    <input
                                        id='ml-barrier-offset'
                                        type='number'
                                        step='0.001'
                                        min={0.001}
                                        max={1.0}
                                        value={barrier_offset}
                                        onChange={e => setBarrierOffset(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        )}

                        {current_price && (
                            <div className='ml-trader__price-info'>
                                <Text size='xs' color='prominent'>
                                    {localize('Current Price:')} {current_price}
                                </Text>
                                {trade_mode === 'higher_lower' && (
                                    <Text size='xs' color='general'>
                                        {localize('Barrier:')} {
                                            contract_type === 'CALL' 
                                                ? (current_price + barrier_offset).toFixed(5)
                                                : (current_price - barrier_offset).toFixed(5)
                                        }
                                    </Text>
                                )}
                            </div>
                        )}

                        <div className='ml-trader__actions'>
                            <button
                                className='ml-trader__run'
                                onClick={onRun}
                                disabled={is_running || !symbol || !apiRef.current}
                            >
                                {is_running ? localize('Running...') : localize('Start Trading')}
                            </button>
                            {is_running && (
                                <button className='ml-trader__stop' onClick={onStop}>
                                    {localize('Stop')}
                                </button>
                            )}
                        </div>

                        {status && (
                            <div className='ml-trader__status'>
                                <Text size='xs' color={/error|fail/i.test(status) ? 'loss-danger' : 'prominent'}>
                                    {status}
                                </Text>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLTrader;