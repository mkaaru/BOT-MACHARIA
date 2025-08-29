
import React, { useState, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './higher-lower-trader.scss';

const HigherLowerTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const contractTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Trading parameters
    const [stake, setStake] = useState(1.5);
    const [durationMinutes, setDurationMinutes] = useState(0);
    const [durationSeconds, setDurationSeconds] = useState(60);
    const [barrier, setBarrier] = useState('+0.37');
    const [contractType, setContractType] = useState('CALL'); // CALL for Higher, PUT for Lower
    const [stopOnProfit, setStopOnProfit] = useState(false);
    const [targetProfit, setTargetProfit] = useState(5.0);
    const [symbol, setSymbol] = useState('R_100'); // Volatility 100 Index

    // Trading state
    const [isTrading, setIsTrading] = useState(false);
    const [currentContract, setCurrentContract] = useState<any>(null);
    const [contractProgress, setContractProgress] = useState(0);
    const [timeRemaining, setTimeRemaining] = useState(0);

    // Authentication state
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [accountCurrency, setAccountCurrency] = useState('USD');

    // Statistics
    const [totalStake, setTotalStake] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalRuns, setTotalRuns] = useState(0);
    const [contractsWon, setContractsWon] = useState(0);
    const [contractsLost, setContractsLost] = useState(0);
    const [totalProfitLoss, setTotalProfitLoss] = useState(0);

    // Current price
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [priceHistory, setPriceHistory] = useState<number[]>([]);

    const [status, setStatus] = useState('Ready to trade');

    // Initialize API connection
    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;

        // Subscribe to price updates
        const subscribeTicks = async () => {
            try {
                const { subscription } = await api.send({ 
                    ticks: symbol, 
                    subscribe: 1 
                });

                const onMessage = (event: MessageEvent) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.tick && data.tick.symbol === symbol) {
                            const price = parseFloat(data.tick.quote);
                            setCurrentPrice(price);
                            setPriceHistory(prev => [...prev.slice(-50), price]);
                        }
                    } catch (error) {
                        console.error('Error parsing tick data:', error);
                    }
                };

                api.connection?.addEventListener('message', onMessage);

                return () => {
                    api.connection?.removeEventListener('message', onMessage);
                };
            } catch (error) {
                console.error('Error subscribing to ticks:', error);
                setStatus('Failed to connect to price feed');
            }
        };

        subscribeTicks();

        return () => {
            if (contractTimerRef.current) {
                clearInterval(contractTimerRef.current);
            }
            api?.disconnect?.();
        };
    }, [symbol]);

    const authorizeIfNeeded = async () => {
        if (isAuthorized) return;
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

        // Sync with store
        try {
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {}
    };

    const startTrading = async () => {
        try {
            await authorizeIfNeeded();
            
            setIsTrading(true);
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1);
            run_panel.run_id = `higher-lower-${Date.now()}`;
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);

            await executeContract();
        } catch (error: any) {
            console.error('Error starting trading:', error);
            setStatus(`Error: ${error.message || 'Failed to start trading'}`);
            setIsTrading(false);
        }
    };

    const executeContract = async () => {
        if (!isTrading || !apiRef.current) return;

        try {
            // Calculate barrier value
            const barrierValue = parseFloat(barrier.replace('+', '').replace('-', ''));
            const isRelative = barrier.startsWith('+') || barrier.startsWith('-');
            
            // Prepare contract parameters
            const contractParams = {
                buy: 1,
                price: stake,
                parameters: {
                    amount: stake,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: accountCurrency,
                    duration: durationMinutes * 60 + durationSeconds,
                    duration_unit: 's',
                    symbol: symbol,
                    barrier: barrier
                }
            };

            // Purchase contract
            const { buy, error } = await apiRef.current.buy(contractParams);
            if (error) {
                throw new Error(error.message || 'Failed to purchase contract');
            }

            setStatus(`Contract purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id})`);
            
            // Create contract tracking
            const contract = {
                id: buy?.contract_id,
                type: contractType,
                stake: stake,
                barrier: barrier,
                entryPrice: currentPrice,
                startTime: Date.now(),
                duration: durationMinutes * 60 + durationSeconds,
                status: 'active',
                buy_price: buy?.buy_price
            };

            setCurrentContract(contract);
            setTotalStake(prev => prev + stake);
            setTotalRuns(prev => prev + 1);

            // Add to transactions
            try {
                transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: accountCurrency,
                    contract_type: contractType as any,
                    underlying: symbol,
                    display_name: `Volatility ${symbol.replace('R_', '')} Index`,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                });
            } catch {}

            run_panel.setHasOpenContract(true);
            run_panel.setContractStage(contract_stages.PURCHASE_SENT);

            // Start contract monitoring
            monitorContract(buy?.contract_id, contract.duration);

        } catch (error: any) {
            console.error('Error executing contract:', error);
            setStatus(`Error: ${error.message || 'Failed to execute contract'}`);
            stopTrading();
        }
    };

    const monitorContract = async (contractId: string, duration: number) => {
        try {
            // Subscribe to contract updates
            const { subscription } = await apiRef.current.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            });

            setTimeRemaining(duration);
            setContractProgress(0);

            contractTimerRef.current = setInterval(() => {
                setTimeRemaining(prev => {
                    if (prev <= 1) {
                        return 0;
                    }
                    const newRemaining = prev - 1;
                    setContractProgress(((duration - newRemaining) / duration) * 100);
                    return newRemaining;
                });
            }, 1000);

            // Listen for contract updates
            const onMessage = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.msg_type === 'proposal_open_contract' && 
                        String(data.proposal_open_contract?.contract_id) === String(contractId)) {
                        
                        const poc = data.proposal_open_contract;
                        transactions.onBotContractEvent(poc);
                        
                        if (poc?.is_sold || poc?.status === 'sold') {
                            finishContract(poc);
                        }
                    }
                } catch (error) {
                    console.error('Error processing contract update:', error);
                }
            };

            apiRef.current?.connection?.addEventListener('message', onMessage);

        } catch (error: any) {
            console.error('Error monitoring contract:', error);
            setStatus(`Error monitoring contract: ${error.message}`);
        }
    };

    const finishContract = (poc: any) => {
        const profit = Number(poc?.profit || 0);
        const payout = Number(poc?.payout || 0);

        setTotalPayout(prev => prev + payout);
        setTotalProfitLoss(prev => prev + profit);

        if (profit > 0) {
            setContractsWon(prev => prev + 1);
        } else {
            setContractsLost(prev => prev + 1);
        }

        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
        run_panel.setHasOpenContract(false);

        // Clear timer
        if (contractTimerRef.current) {
            clearInterval(contractTimerRef.current);
            contractTimerRef.current = null;
        }

        setCurrentContract(null);
        setContractProgress(0);
        setTimeRemaining(0);

        // Check profit target
        if (stopOnProfit && totalProfitLoss + profit >= targetProfit) {
            stopTrading();
            return;
        }

        // Auto-start next contract
        if (isTrading) {
            setTimeout(() => {
                if (isTrading) executeContract();
            }, 2000);
        }
    };

    const stopTrading = () => {
        setIsTrading(false);
        setCurrentContract(null);
        setContractProgress(0);
        setTimeRemaining(0);
        
        if (contractTimerRef.current) {
            clearInterval(contractTimerRef.current);
            contractTimerRef.current = null;
        }

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
        setStatus('Statistics reset');
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const getTotalDuration = () => durationMinutes * 60 + durationSeconds;

    return (
        <div className='higher-lower-trader'>
            <div className='higher-lower-trader__container'>
                <div className='higher-lower-trader__header'>
                    <Text size='s' weight='bold'>{localize('Higher/Lower Trading')}</Text>
                </div>

                {/* Active Contract View */}
                {isTrading && currentContract && (
                    <div className='higher-lower-trader__active-contract'>
                        <div className='higher-lower-trader__contract-header'>
                            <button
                                onClick={stopTrading}
                                className='higher-lower-trader__stop-btn'
                            >
                                {localize('Stop')}
                            </button>
                            <Text size='xs' color='general'>{localize('Contract bought')}</Text>
                        </div>

                        <div className='higher-lower-trader__contract-info'>
                            <div className='higher-lower-trader__contract-type'>
                                <div className={`higher-lower-trader__type-badge ${contractType.toLowerCase()}`}>
                                    <Text size='xs' weight='bold' color='prominent'>
                                        {contractType === 'CALL' ? '📈 Higher' : '📉 Lower'}
                                    </Text>
                                </div>
                                <Text size='xs' color='general'>Volatility {symbol.replace('R_', '')} Index</Text>
                            </div>

                            <div className='higher-lower-trader__progress'>
                                <Text size='xs' color='general'>{formatTime(timeRemaining)}</Text>
                                <div className='higher-lower-trader__progress-bar'>
                                    <div 
                                        className='higher-lower-trader__progress-fill'
                                        style={{ width: `${contractProgress}%` }}
                                    />
                                </div>
                            </div>

                            <div className='higher-lower-trader__contract-stats'>
                                <div className='higher-lower-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Total profit/loss:')}</Text>
                                    <Text size='xs' color={totalProfitLoss >= 0 ? 'profit-success' : 'loss-danger'}>
                                        {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)}
                                    </Text>
                                </div>
                                <div className='higher-lower-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Current price:')}</Text>
                                    <Text size='xs' color='prominent'>{currentPrice.toFixed(5)}</Text>
                                </div>
                                <div className='higher-lower-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Stake:')}</Text>
                                    <Text size='xs' color='prominent'>{stake.toFixed(2)}</Text>
                                </div>
                                <div className='higher-lower-trader__stat'>
                                    <Text size='xs' color='general'>{localize('Potential payout:')}</Text>
                                    <Text size='xs' color='profit-success'>{(stake * 1.8).toFixed(2)}</Text>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Setup Form */}
                {!isTrading && (
                    <div className='higher-lower-trader__form'>
                        {/* Contract Type */}
                        <div className='higher-lower-trader__field'>
                            <Text size='xs' weight='bold'>{localize('Contract Type')}</Text>
                            <div className='higher-lower-trader__contract-buttons'>
                                <button
                                    onClick={() => setContractType('CALL')}
                                    className={`higher-lower-trader__contract-btn ${contractType === 'CALL' ? 'active higher' : ''}`}
                                >
                                    📈 {localize('Higher')}
                                </button>
                                <button
                                    onClick={() => setContractType('PUT')}
                                    className={`higher-lower-trader__contract-btn ${contractType === 'PUT' ? 'active lower' : ''}`}
                                >
                                    📉 {localize('Lower')}
                                </button>
                            </div>
                        </div>

                        {/* Stake */}
                        <div className='higher-lower-trader__field'>
                            <label htmlFor='stake'>{localize('Stake')} ({accountCurrency})</label>
                            <input
                                id='stake'
                                type='number'
                                step='0.01'
                                min='0.35'
                                value={stake}
                                onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                                className='higher-lower-trader__input'
                            />
                        </div>

                        {/* Duration */}
                        <div className='higher-lower-trader__field'>
                            <Text size='xs' weight='bold'>{localize('Duration')}</Text>
                            <div className='higher-lower-trader__duration-inputs'>
                                <div className='higher-lower-trader__duration-input'>
                                    <input
                                        type='number'
                                        min='0'
                                        max='59'
                                        value={durationMinutes}
                                        onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
                                        className='higher-lower-trader__input'
                                        placeholder='Minutes'
                                    />
                                    <Text size='xs' color='general'>{localize('Minutes')}</Text>
                                </div>
                                <div className='higher-lower-trader__duration-input'>
                                    <input
                                        type='number'
                                        min='15'
                                        max='3600'
                                        value={durationSeconds}
                                        onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 15)}
                                        className='higher-lower-trader__input'
                                        placeholder='Seconds'
                                    />
                                    <Text size='xs' color='general'>{localize('Seconds')}</Text>
                                </div>
                            </div>
                            <Text size='xs' color='general'>
                                {localize('Total')}: {formatTime(getTotalDuration())}
                            </Text>
                        </div>

                        {/* Barrier */}
                        <div className='higher-lower-trader__field'>
                            <label htmlFor='barrier'>{localize('Barrier')}</label>
                            <input
                                id='barrier'
                                type='text'
                                value={barrier}
                                onChange={(e) => setBarrier(e.target.value)}
                                className='higher-lower-trader__input'
                                placeholder='+0.37'
                            />
                            <Text size='xs' color='general'>
                                {localize('Use + or - followed by the offset (e.g., +0.37, -0.25)')}
                            </Text>
                        </div>

                        {/* Stop on Profit */}
                        <div className='higher-lower-trader__field'>
                            <div className='higher-lower-trader__checkbox-wrapper'>
                                <input
                                    id='stopOnProfit'
                                    type='checkbox'
                                    checked={stopOnProfit}
                                    onChange={(e) => setStopOnProfit(e.target.checked)}
                                    className='higher-lower-trader__checkbox'
                                />
                                <label htmlFor='stopOnProfit'>{localize('Stop when in profit')}</label>
                            </div>
                            {stopOnProfit && (
                                <div className='higher-lower-trader__profit-target'>
                                    <label htmlFor='targetProfit'>{localize('Target Profit')} ({accountCurrency})</label>
                                    <input
                                        id='targetProfit'
                                        type='number'
                                        step='0.01'
                                        min='0.01'
                                        value={targetProfit}
                                        onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                                        className='higher-lower-trader__input'
                                    />
                                </div>
                            )}
                        </div>

                        {/* Start Button */}
                        <button
                            onClick={startTrading}
                            disabled={getTotalDuration() < 15 || !currentPrice}
                            className='higher-lower-trader__start-btn'
                        >
                            {localize('Start Trading')}
                        </button>
                    </div>
                )}

                {/* Statistics */}
                <div className='higher-lower-trader__stats'>
                    <div className='higher-lower-trader__stats-grid'>
                        <div className='higher-lower-trader__stat'>
                            <Text size='xs' color='general'>{localize('Total stake')}</Text>
                            <Text size='xs' weight='bold'>{totalStake.toFixed(2)}</Text>
                        </div>
                        <div className='higher-lower-trader__stat'>
                            <Text size='xs' color='general'>{localize('Total payout')}</Text>
                            <Text size='xs' weight='bold'>{totalPayout.toFixed(2)}</Text>
                        </div>
                        <div className='higher-lower-trader__stat'>
                            <Text size='xs' color='general'>{localize('No. of runs')}</Text>
                            <Text size='xs' weight='bold'>{totalRuns}</Text>
                        </div>
                        <div className='higher-lower-trader__stat'>
                            <Text size='xs' color='general'>{localize('Contracts lost')}</Text>
                            <Text size='xs' weight='bold' color='loss-danger'>{contractsLost}</Text>
                        </div>
                        <div className='higher-lower-trader__stat'>
                            <Text size='xs' color='general'>{localize('Contracts won')}</Text>
                            <Text size='xs' weight='bold' color='profit-success'>{contractsWon}</Text>
                        </div>
                        <div className='higher-lower-trader__stat'>
                            <Text size='xs' color='general'>{localize('Total profit/loss')}</Text>
                            <Text size='xs' weight='bold' color={totalProfitLoss >= 0 ? 'profit-success' : 'loss-danger'}>
                                {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLoss.toFixed(2)}
                            </Text>
                        </div>
                    </div>

                    <button
                        onClick={resetStats}
                        className='higher-lower-trader__reset-btn'
                    >
                        {localize('Reset Statistics')}
                    </button>
                </div>

                {/* Current Price */}
                {currentPrice > 0 && (
                    <div className='higher-lower-trader__price-display'>
                        <Text size='xs' color='general'>{localize('Current Price')}</Text>
                        <Text size='l' weight='bold'>{currentPrice.toFixed(5)}</Text>
                        {currentContract && (
                            <Text size='xs' color='general'>
                                {localize('Barrier')}: {barrier}
                            </Text>
                        )}
                    </div>
                )}

                {/* Status */}
                {status && (
                    <div className='higher-lower-trader__status'>
                        <Text size='xs' color={status.toLowerCase().includes('error') ? 'loss-danger' : 'general'}>
                            {status}
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
});

export default HigherLowerTrader;
