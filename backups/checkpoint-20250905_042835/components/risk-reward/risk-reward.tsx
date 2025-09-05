
import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './risk-reward.scss';

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
            barrier: trade_option.barrier,
        },
    };
    return buy;
};

const RiskReward = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [tradeType, setTradeType] = useState<string>('CALL'); // CALL for Higher, PUT for Lower
    const [stake, setStake] = useState<number>(1.0);
    const [barrier, setBarrier] = useState<string>('+0.37');
    const [durationMinutes, setDurationMinutes] = useState<number>(0);
    const [durationSeconds, setDurationSeconds] = useState<number>(30);
    const [stopOnProfit, setStopOnProfit] = useState<boolean>(false);
    const [targetProfit, setTargetProfit] = useState<number>(5.0);

    // Trading state
    const [currentContract, setCurrentContract] = useState<any>(null);
    const [totalProfit, setTotalProfit] = useState<number>(0);
    const [totalStake, setTotalStake] = useState<number>(0);
    const [totalPayout, setTotalPayout] = useState<number>(0);
    const [contractsWon, setContractsWon] = useState<number>(0);
    const [contractsLost, setContractsLost] = useState<number>(0);
    const [numberOfRuns, setNumberOfRuns] = useState<number>(0);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    useEffect(() => {
        // Initialize API connection and fetch active symbols
        const api = generateDerivApiInstance();
        apiRef.current = api;
        const init = async () => {
            try {
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;
                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);
                if (!symbol && syn[0]?.symbol) setSymbol(syn[0].symbol);
            } catch (e: any) {
                console.error('RiskReward init error', e);
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
        const { authorize, error } = await apiRef.current.authorize(token);
        if (error) {
            setStatus(`Authorization error: ${error.message || error.code}`);
            throw error;
        }
        setIsAuthorized(true);
        const loginid = authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');
        try {
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {}
    };

    const purchaseContract = async () => {
        await authorizeIfNeeded();

        const totalDuration = durationMinutes * 60 + durationSeconds;
        const trade_option: any = {
            amount: Number(stake),
            basis: 'stake',
            contractTypes: [tradeType],
            currency: account_currency,
            duration: totalDuration,
            duration_unit: 's',
            symbol,
            barrier: barrier,
        };

        const buy_req = tradeOptionToBuy(tradeType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;
        
        setStatus(`Contract purchased: ${buy?.longcode || 'Higher/Lower'}`);
        setCurrentContract(buy);
        setTotalStake(prev => prev + Number(stake));
        setNumberOfRuns(prev => prev + 1);
        
        return buy;
    };

    const onStart = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `risk-reward-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            const buy = await purchaseContract();

            // Seed transaction row
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
                    setCurrentContract(pocInit);
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
                                setCurrentContract(poc);
                                run_panel.setHasOpenContract(true);
                                
                                if (poc?.is_sold || poc?.status === 'sold') {
                                    run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                    run_panel.setHasOpenContract(false);
                                    if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                    apiRef.current?.connection?.removeEventListener('message', onMsg);
                                    
                                    const profit = Number(poc?.profit || 0);
                                    const payout = Number(poc?.payout || 0);
                                    
                                    setTotalProfit(prev => prev + profit);
                                    setTotalPayout(prev => prev + payout);
                                    
                                    if (profit > 0) {
                                        setContractsWon(prev => prev + 1);
                                        // Check if we should stop on profit
                                        if (stopOnProfit && (totalProfit + profit) >= targetProfit) {
                                            setStatus(`Target profit reached: ${(totalProfit + profit).toFixed(2)} ${account_currency}`);
                                            onStop();
                                            return;
                                        }
                                    } else {
                                        setContractsLost(prev => prev + 1);
                                    }
                                    
                                    setCurrentContract(null);
                                    setIsRunning(false);
                                    run_panel.setIsRunning(false);
                                    run_panel.setContractStage(contract_stages.NOT_RUNNING);
                                }
                            }
                        }
                    } catch {}
                };
                apiRef.current?.connection?.addEventListener('message', onMsg);
            } catch (subErr) {
                console.error('subscribe poc error', subErr);
            }

        } catch (e: any) {
            console.error('RiskReward run error', e);
            const msg = e?.message || e?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    const onStop = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        if (currentContract?.contract_id) {
            // Sell contract if still open
            apiRef.current?.sell?.({ sell: currentContract.contract_id, price: 0 });
        }
    };

    const onReset = () => {
        setTotalProfit(0);
        setTotalStake(0);
        setTotalPayout(0);
        setContractsWon(0);
        setContractsLost(0);
        setNumberOfRuns(0);
        setCurrentContract(null);
        setStatus('');
    };

    const sellContract = async () => {
        if (!currentContract?.contract_id) return;
        try {
            const { sell, error } = await apiRef.current.sell({ sell: currentContract.contract_id, price: 0 });
            if (error) throw error;
            setStatus('Contract sold successfully');
        } catch (e: any) {
            setStatus(`Sell error: ${e?.message || 'Failed to sell'}`);
        }
    };

    return (
        <div className='risk-reward'>
            <div className='risk-reward__container'>
                <div className='risk-reward__content'>
                    <div className='risk-reward__card'>
                        <Text size='s' weight='bold' className='risk-reward__title'>
                            {localize('Risk Reward - Higher/Lower Trading')}
                        </Text>

                        {!is_running && !currentContract && (
                            <div className='risk-reward__form'>
                                <div className='risk-reward__row'>
                                    <div className='risk-reward__field'>
                                        <label htmlFor='rr-symbol'>{localize('Asset')}</label>
                                        <select
                                            id='rr-symbol'
                                            value={symbol}
                                            onChange={e => setSymbol(e.target.value)}
                                        >
                                            {symbols.map(s => (
                                                <option key={s.symbol} value={s.symbol}>
                                                    {s.display_name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className='risk-reward__field'>
                                        <label htmlFor='rr-tradeType'>{localize('Prediction')}</label>
                                        <select
                                            id='rr-tradeType'
                                            value={tradeType}
                                            onChange={e => setTradeType(e.target.value)}
                                        >
                                            <option value='CALL'>{localize('Higher')}</option>
                                            <option value='PUT'>{localize('Lower')}</option>
                                        </select>
                                    </div>
                                </div>

                                <div className='risk-reward__row'>
                                    <div className='risk-reward__field'>
                                        <label htmlFor='rr-stake'>{localize('Stake')}</label>
                                        <input
                                            id='rr-stake'
                                            type='number'
                                            step='0.01'
                                            min={0.35}
                                            value={stake}
                                            onChange={e => setStake(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className='risk-reward__field'>
                                        <label htmlFor='rr-barrier'>{localize('Barrier')}</label>
                                        <input
                                            id='rr-barrier'
                                            type='text'
                                            value={barrier}
                                            onChange={e => setBarrier(e.target.value)}
                                            placeholder='+0.37'
                                        />
                                    </div>
                                </div>

                                <div className='risk-reward__row'>
                                    <div className='risk-reward__field'>
                                        <label htmlFor='rr-duration-min'>{localize('Duration (Minutes)')}</label>
                                        <input
                                            id='rr-duration-min'
                                            type='number'
                                            min={0}
                                            max={60}
                                            value={durationMinutes}
                                            onChange={e => setDurationMinutes(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className='risk-reward__field'>
                                        <label htmlFor='rr-duration-sec'>{localize('Duration (Seconds)')}</label>
                                        <input
                                            id='rr-duration-sec'
                                            type='number'
                                            min={15}
                                            max={59}
                                            value={durationSeconds}
                                            onChange={e => setDurationSeconds(Number(e.target.value))}
                                        />
                                    </div>
                                </div>

                                <div className='risk-reward__row'>
                                    <div className='risk-reward__field risk-reward__field--checkbox'>
                                        <label>
                                            <input
                                                type='checkbox'
                                                checked={stopOnProfit}
                                                onChange={e => setStopOnProfit(e.target.checked)}
                                            />
                                            {localize('Stop when in profit')}
                                        </label>
                                    </div>
                                    {stopOnProfit && (
                                        <div className='risk-reward__field'>
                                            <label htmlFor='rr-target-profit'>{localize('Target Profit')}</label>
                                            <input
                                                id='rr-target-profit'
                                                type='number'
                                                step='0.01'
                                                min={0.01}
                                                value={targetProfit}
                                                onChange={e => setTargetProfit(Number(e.target.value))}
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className='risk-reward__actions'>
                                    <button
                                        className='risk-reward__start'
                                        onClick={onStart}
                                        disabled={!symbol || stake <= 0}
                                    >
                                        {localize('Start Trading')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {(is_running || currentContract) && (
                            <div className='risk-reward__active-trade'>
                                <div className='risk-reward__trade-header'>
                                    <button className='risk-reward__stop-btn' onClick={onStop}>
                                        {localize('Stop')}
                                    </button>
                                    <Text size='xs' color='general'>
                                        {localize('Contract bought')}
                                    </Text>
                                </div>

                                <div className='risk-reward__trade-info'>
                                    <div className='risk-reward__progress-bar'>
                                        <div className='risk-reward__progress-fill'></div>
                                    </div>

                                    <div className='risk-reward__trade-details'>
                                        <div className='risk-reward__detail-row'>
                                            <Text size='xs' color='general'>{localize('Total profit/loss:')}</Text>
                                            <Text size='xs' color={totalProfit >= 0 ? 'profit-success' : 'loss-danger'}>
                                                {totalProfit.toFixed(2)}
                                            </Text>
                                        </div>
                                        <div className='risk-reward__detail-row'>
                                            <Text size='xs' color='general'>{localize('Contract value:')}</Text>
                                            <Text size='xs' color='general'>
                                                {currentContract?.bid_price?.toFixed(2) || '0.00'}
                                            </Text>
                                        </div>
                                        <div className='risk-reward__detail-row'>
                                            <Text size='xs' color='general'>{localize('Stake:')}</Text>
                                            <Text size='xs' color='general'>
                                                {stake.toFixed(2)}
                                            </Text>
                                        </div>
                                        <div className='risk-reward__detail-row'>
                                            <Text size='xs' color='general'>{localize('Potential payout:')}</Text>
                                            <Text size='xs' color='general'>
                                                {currentContract?.payout?.toFixed(2) || '0.00'}
                                            </Text>
                                        </div>
                                    </div>

                                    <button className='risk-reward__sell-btn' onClick={sellContract}>
                                        {localize('Sell')}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className='risk-reward__stats'>
                            <div className='risk-reward__stats-row'>
                                <div className='risk-reward__stat'>
                                    <Text size='xs' color='general'>{localize('Total stake')}</Text>
                                    <Text size='xs' weight='bold'>{totalStake.toFixed(2)} {account_currency}</Text>
                                </div>
                                <div className='risk-reward__stat'>
                                    <Text size='xs' color='general'>{localize('Total payout')}</Text>
                                    <Text size='xs' weight='bold'>{totalPayout.toFixed(2)} {account_currency}</Text>
                                </div>
                                <div className='risk-reward__stat'>
                                    <Text size='xs' color='general'>{localize('No. of runs')}</Text>
                                    <Text size='xs' weight='bold'>{numberOfRuns}</Text>
                                </div>
                            </div>
                            <div className='risk-reward__stats-row'>
                                <div className='risk-reward__stat'>
                                    <Text size='xs' color='general'>{localize('Contracts lost')}</Text>
                                    <Text size='xs' weight='bold'>{contractsLost}</Text>
                                </div>
                                <div className='risk-reward__stat'>
                                    <Text size='xs' color='general'>{localize('Contracts won')}</Text>
                                    <Text size='xs' weight='bold'>{contractsWon}</Text>
                                </div>
                                <div className='risk-reward__stat'>
                                    <Text size='xs' color='general'>{localize('Total profit/loss')}</Text>
                                    <Text size='xs' weight='bold' color={totalProfit >= 0 ? 'profit-success' : 'loss-danger'}>
                                        {totalProfit.toFixed(2)} {account_currency}
                                    </Text>
                                </div>
                            </div>
                            <button className='risk-reward__reset-btn' onClick={onReset}>
                                {localize('Reset')}
                            </button>
                        </div>

                        {status && (
                            <div className='risk-reward__status'>
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

export default RiskReward;
