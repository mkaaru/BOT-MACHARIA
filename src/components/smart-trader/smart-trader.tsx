import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

// Minimal trade types we will support initially
const TRADE_TYPES = [
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
    if (trade_option.prediction !== undefined) {
        buy.parameters.selected_tick = trade_option.prediction;
    }
    if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    return buy;
};

const SmartTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    // Track last outcome for Over/Under prediction switching
    const lastOutcomeWasLossRef = useRef(false);
    const contractInProgressRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [tradeType, setTradeType] = useState<string>('DIGITOVER');
    const [ticks, setTicks] = useState<number>(1);
    const [stake, setStake] = useState<number>(0.5);
    const [baseStake, setBaseStake] = useState<number>(0.5);

    // Predictions - key improvement for Over/Under after loss logic
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(5);
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(5);
    const [mdPrediction, setMdPrediction] = useState<number>(5); // for match/diff

    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(1.0);

    // Live digits state
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    // Helper function to determine hint colors based on current prediction logic
    const getHintClass = (d: number) => {
        if (tradeType === 'DIGITEVEN') return d % 2 === 0 ? 'is-green' : 'is-red';
        if (tradeType === 'DIGITODD') return d % 2 !== 0 ? 'is-green' : 'is-red';
        if ((tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER')) {
            // Use the same logic as purchase - after loss use ouPredPostLoss, otherwise ouPredPreLoss
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
        if (tradeType === 'DIGITMATCH') {
            return d === mdPrediction ? 'is-green' : 'is-red';
        }
        if (tradeType === 'DIGITDIFF') {
            return d !== mdPrediction ? 'is-green' : 'is-red';
        }
        return '';
    };

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
                if (!symbol && syn[0]?.symbol) setSymbol(syn[0].symbol);
                if (syn[0]?.symbol) startTicks(syn[0].symbol);
            } catch (e: any) {
                console.error('SmartTrader init error', e);
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
            // Sync Smart Trader auth state into shared ClientStore so Transactions store keys correctly by account
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
        setDigits([]);
        setLastDigit(null);
        setTicksProcessed(0);
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
                        const digit = Number(String(quote).slice(-1));
                        setLastDigit(digit);
                        setDigits(prev => [...prev.slice(-8), digit]);
                        setTicksProcessed(prev => prev + 1);
                    }
                    if (data?.forget?.id && data?.forget?.id === tickStreamIdRef.current) {
                        // stopped
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const purchaseOnceWithStake = async (stakeAmount: number) => {
        await authorizeIfNeeded();

        const trade_option: any = {
            amount: Number(stakeAmount),
            basis: 'stake',
            contractTypes: [tradeType],
            currency: account_currency,
            duration: Number(ticks),
            duration_unit: 't',
            symbol,
        };

        // CORE LOGIC: Choose prediction based on trade type and last outcome
        if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
            // After a loss, use ouPredPostLoss; otherwise, use ouPredPreLoss
            const activePrediction = lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
            trade_option.prediction = Number(activePrediction);

            // Log for debugging
            const predictionType = lastOutcomeWasLossRef.current ? 'after loss' : 'pre-loss';
            console.log(`Over/Under prediction (${predictionType}): ${activePrediction}`);
            setStatus(`Using ${tradeType.toLowerCase()} prediction: ${activePrediction} (${predictionType})`);
        } else if (tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') {
            trade_option.prediction = Number(mdPrediction);
        }

        const buy_req = tradeOptionToBuy(tradeType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;

        contractInProgressRef.current = true;
        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stakeAmount}`);
        return buy;
    };

    const onRun = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1); // Transactions tab index in run panel tabs
        run_panel.run_id = `smart-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake);

            while (!stopFlagRef.current) {
                // Adjust stake based on martingale progression
                const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;
                setStake(effectiveStake);

                // For Over/Under trades, set the loss flag before purchase
                const isOU = tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER';
                if (isOU) {
                    // This determines which prediction value to use
                    lastOutcomeWasLossRef.current = lossStreak > 0;
                }

                const buy = await purchaseOnceWithStake(effectiveStake);

                // Seed an initial transaction row immediately so the UI shows a live row like Bot Builder
                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: tradeType as any,
                        underlying: symbol,
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
                    const res = await apiRef.current.send({
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
                                // capture subscription id for later forget
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

                                        if (profit > 0) {
                                            // WIN: Reset everything
                                            lastOutcomeWasLossRef.current = false;
                                            lossStreak = 0;
                                            step = 0;
                                            setStake(baseStake);
                                            setStatus(`WIN: +${profit.toFixed(2)} ${account_currency} - Next trade uses pre-loss prediction`);
                                        } else {
                                            // LOSS: Set flag for next trade
                                            lastOutcomeWasLossRef.current = true;
                                            lossStreak++;
                                            step = Math.min(step + 1, 10);
                                            setStatus(`LOSS: ${profit.toFixed(2)} ${account_currency} - Next trade uses after-loss prediction`);
                                        }
                                    }
                                }
                            }
                        } catch {
                            // noop
                        }
                    };
                    apiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    console.error('subscribe poc error', subErr);
                }

                // Wait minimally between purchases
                await new Promise(res => setTimeout(res, 1000));
            }
        } catch (e: any) {
            console.error('SmartTrader run loop error', e);
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

    const onStop = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        stopTicks();
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');
    };

    return (
        <div className='smart-trader'>
            <div className='smart-trader__container'>
                <div className='smart-trader__content'>
                    <div className='smart-trader__card'>
                        <div className='smart-trader__row smart-trader__row--two'>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-symbol'>{localize('Volatility')}</label>
                                <select
                                    id='st-symbol'
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
                            <div className='smart-trader__field'>
                                <label htmlFor='st-tradeType'>{localize('Trade type')}</label>
                                <select
                                    id='st-tradeType'
                                    value={tradeType}
                                    onChange={e => setTradeType(e.target.value)}
                                >
                                    {TRADE_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className='smart-trader__row smart-trader__row--two'>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-ticks'>{localize('Ticks')}</label>
                                <input
                                    id='st-ticks'
                                    type='number'
                                    min={1}
                                    max={10}
                                    value={ticks}
                                    onChange={e => setTicks(Number(e.target.value))}
                                />
                            </div>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-stake'>{localize('Stake')}</label>
                                <input
                                    id='st-stake'
                                    type='number'
                                    step='0.01'
                                    min={0.35}
                                    value={stake}
                                    onChange={e => setStake(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        {/* Strategy controls based on trade type */}
                        {(tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') ? (
                            <div className='smart-trader__row smart-trader__row--two'>
                                <div className='smart-trader__field'>
                                    <label htmlFor='st-md-pred'>{localize('Match/Diff prediction digit')}</label>
                                    <input
                                        id='st-md-pred'
                                        type='number'
                                        min={0}
                                        max={9}
                                        value={mdPrediction}
                                        onChange={e => {
                                            const v = Math.max(0, Math.min(9, Number(e.target.value)));
                                            setMdPrediction(v);
                                        }}
                                    />
                                </div>
                                <div className='smart-trader__field'>
                                    <label htmlFor='st-martingale'>{localize('Martingale multiplier')}</label>
                                    <input
                                        id='st-martingale'
                                        type='number'
                                        min={1}
                                        step='0.1'
                                        value={martingaleMultiplier}
                                        onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className='smart-trader__predictions'>
                                <div className='smart-trader__row smart-trader__row--two'>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-ou-pred-pre'>{localize('Over/Under prediction (pre-loss)')}</label>
                                        <input
                                            id='st-ou-pred-pre'
                                            type='number'
                                            min={0}
                                            max={9}
                                            value={ouPredPreLoss}
                                            onChange={e => setOuPredPreLoss(Math.max(0, Math.min(9, Number(e.target.value))))}
                                        />
                                    </div>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-ou-pred-post'>{localize('Over/Under prediction (after loss)')}</label>
                                        <input
                                            id='st-ou-pred-post'
                                            type='number'
                                            min={0}
                                            max={9}
                                            value={ouPredPostLoss}
                                            onChange={e => setOuPredPostLoss(Math.max(0, Math.min(9, Number(e.target.value))))}
                                        />
                                    </div>
                                </div>
                                <div className='smart-trader__field'>
                                    <label htmlFor='st-martingale'>{localize('Martingale multiplier')}</label>
                                    <input
                                        id='st-martingale'
                                        type='number'
                                        min={1}
                                        step='0.1'
                                        value={martingaleMultiplier}
                                        onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Current prediction indicator */}
                        {(tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') && (
                            <div className='smart-trader__current-prediction'>
                                <Text size='xs' color='prominent'>
                                    {localize('Current prediction:')} {lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss}
                                    ({lastOutcomeWasLossRef.current ? localize('after loss') : localize('pre-loss')})
                                </Text>
                            </div>
                        )}

                        <div className='smart-trader__digits'>
                            {digits.map((d, idx) => (
                                <div
                                    key={`${idx}-${d}`}
                                    className={`smart-trader__digit ${d === lastDigit ? 'is-current' : ''} ${getHintClass(d)}`}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>

                        <div className='smart-trader__meta'>
                            <Text size='xs' color='general'>
                                {localize('Ticks Processed:')} {ticksProcessed}
                            </Text>
                            <Text size='xs' color='general'>
                                {localize('Last Digit:')} {lastDigit ?? '-'}
                            </Text>
                        </div>

                        <div className='smart-trader__actions'>
                            <button
                                className='smart-trader__run'
                                onClick={onRun}
                                disabled={is_running || !symbol || !apiRef.current}
                            >
                                {is_running ? localize('Running...') : localize('Start Trading')}
                            </button>
                            {is_running && (
                                <button className='smart-trader__stop' onClick={onStop}>
                                    {localize('Stop')}
                                </button>
                            )}
                        </div>

                        {status && (
                            <div className='smart-trader__status'>
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

export default SmartTrader;