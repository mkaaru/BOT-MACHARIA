import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader-wrapper.scss';

// Minimal trade types we will support initially
const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
    { value: 'CALL', label: 'Higher' },
    { value: 'PUT', label: 'Lower' },
];

interface TradeSettings {
    symbol: string;
    tradeType: string;
    barrier?: string;
    prediction?: number;
    stake: number;
    duration: number;
    durationType: string;
}

interface SmartTraderWrapperProps {
    initialSettings: TradeSettings;
    onClose: () => void;
}

// Define interfaces for market analysis data
interface MarketStats {
    lastDigitFrequency?: Record<number, number>;
    isReady: boolean;
}

interface TradeRecommendation {
    symbol: string;
    strategy: 'over' | 'under' | 'even' | 'odd' | 'match' | 'diff';
    barrier: string;
    confidence: number;
    overPercentage: number;
    underPercentage: number;
    reason: string;
    timestamp: number;
    score: number;
}

// Mock marketAnalyzer and its methods for demonstration purposes
// In a real scenario, this would be imported from a library or service
const marketAnalyzer = {
    onAnalysis: (callback: (recommendation: TradeRecommendation, stats: Record<string, MarketStats>) => void) => {
        // Simulate receiving analysis data
        const mockStats = {
            '1HZ10V': {
                lastDigitFrequency: { 0: 10, 1: 15, 2: 20, 3: 18, 4: 12, 5: 8, 6: 5, 7: 7, 8: 6, 9: 9 },
                isReady: true,
            },
            'R_100': {
                lastDigitFrequency: { 0: 5, 1: 8, 2: 12, 3: 15, 4: 18, 5: 20, 6: 15, 7: 12, 8: 8, 9: 7 },
                isReady: true,
            },
        };
        const mockRecommendations: TradeRecommendation[] = [];
        Object.keys(mockStats).forEach(symbolKey => {
            const symbolStats = mockStats[symbolKey];
            if (symbolStats.isReady) {
                // Assuming generateOverUnderRecommendations is available
                // mockRecommendations.push(...generateOverUnderRecommendations(symbolKey, symbolStats));
            }
        });
        callback(mockRecommendations[0], mockStats); // Pass a dummy recommendation and the stats
        return () => { }; // Return a dummy unsubscribe function
    },
};


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
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }
    return buy;
};

const SmartTraderWrapper: React.FC<SmartTraderWrapperProps> = observer(({ initialSettings, onClose }) => {
    const { common } = useStore();

    // Local state
    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    const lastOutcomeWasLossRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Trade settings state
    const [symbol, setSymbol] = useState<string>(initialSettings.symbol);
    const [tradeType, setTradeType] = useState<string>(initialSettings.tradeType);
    const [ticks, setTicks] = useState<number>(initialSettings.duration);
    const [duration, setDuration] = useState<number>(initialSettings.duration);
    const [durationType, setDurationType] = useState<string>(initialSettings.durationType);
    const [stake, setStake] = useState<number>(initialSettings.stake);
    const [baseStake, setBaseStake] = useState<number>(initialSettings.stake);

    // Predictions - set from initial settings
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(initialSettings.prediction || 5);
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(initialSettings.prediction || 5);
    const [mdPrediction, setMdPrediction] = useState<number>(initialSettings.prediction || 5);

    // Higher/Lower barrier
    const [barrier, setBarrier] = useState<string>(initialSettings.barrier || '+0.37');

    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(2.0);

    // Contract tracking state
    const [currentProfit, setCurrentProfit] = useState<number>(0);
    const [contractValue, setContractValue] = useState<number>(0);
    const [potentialPayout, setPotentialPayout] = useState<number>(0);
    const [contractDuration, setContractDuration] = useState<string>('00:00:00');

    // Live digits state
    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    // Over/Under analysis state
    const [marketStats, setMarketStats] = useState<Record<string, MarketStats>>({});
    const [recommendations, setRecommendations] = useState<TradeRecommendation[]>([]);


    // Symbol mapping for display names
    const symbolMap: Record<string, string> = {
        'R_10': 'Volatility 10 Index',
        'R_25': 'Volatility 25 Index', 
        'R_50': 'Volatility 50 Index',
        'R_75': 'Volatility 75 Index',
        'R_100': 'Volatility 100 Index',
        'RDBEAR': 'Bear Market Index',
        'RDBULL': 'Bull Market Index',
        '1HZ10V': 'Volatility 10 (1s) Index',
        '1HZ25V': 'Volatility 25 (1s) Index',
        '1HZ50V': 'Volatility 50 (1s) Index',
        '1HZ75V': 'Volatility 75 (1s) Index',
        '1HZ100V': 'Volatility 100 (1s) Index'
    };

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

    // Effect to initialize API and fetch active symbols
    useEffect(() => {
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

                // Start ticks for the initial symbol
                if (symbol) startTicks(symbol);
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

    // Subscribe to market analyzer for over/under recommendations
    useEffect(() => {
        const unsubscribe = marketAnalyzer.onAnalysis((recommendation, stats) => {
            setMarketStats(stats);

            // Generate over/under recommendations for all symbols
            const allRecommendations: TradeRecommendation[] = [];

            Object.keys(stats).forEach(symbolKey => {
                const symbolStats = stats[symbolKey];
                if (symbolStats.isReady) {
                    const symbolRecommendations = generateOverUnderRecommendations(symbolKey, symbolStats);
                    allRecommendations.push(...symbolRecommendations);
                }
            });

            setRecommendations(allRecommendations);
        });

        return unsubscribe;
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

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const digit = Number(String(quote).slice(-1));
                        const tickTime = data.tick.epoch * 1000;

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
            duration: durationType === 't' ? Number(ticks) : Number(duration),
            duration_unit: durationType,
            symbol,
        };

        // Choose prediction based on trade type and last outcome
        if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
            trade_option.prediction = Number(lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss);
        } else if (tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') {
            trade_option.prediction = Number(mdPrediction);
        } else if (tradeType === 'CALL' || tradeType === 'PUT') {
            trade_option.barrier = barrier;
        }

        const buy_req = tradeOptionToBuy(tradeType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;
        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stakeAmount}`);
        return buy;
    };

    const onRun = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `smart-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake);

            while (!stopFlagRef.current) {
                const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;

                const isOU = tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER';
                if (isOU) {
                    lastOutcomeWasLossRef.current = lossStreak > 0;
                }

                setStake(effectiveStake);

                const buy = await purchaseOnceWithStake(effectiveStake);

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

                // Contract monitoring logic...
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

                                    setCurrentProfit(Number(poc?.profit || 0));
                                    setContractValue(Number(poc?.bid_price || 0));
                                    setPotentialPayout(Number(poc?.payout || 0));

                                    if (poc?.date_expiry && !poc?.is_sold) {
                                        const now = Math.floor(Date.now() / 1000);
                                        const expiry = Number(poc.date_expiry);
                                        const remaining = Math.max(0, expiry - now);
                                        const hours = Math.floor(remaining / 3600);
                                        const minutes = Math.floor((remaining % 3600) / 60);
                                        const seconds = remaining % 60;
                                        setContractDuration(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                                    }

                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);
                                        const profit = Number(poc?.profit || 0);
                                        if (profit > 0) {
                                            lastOutcomeWasLossRef.current = false;
                                            lossStreak = 0;
                                            step = 0;
                                            setStake(baseStake);
                                        } else {
                                            lastOutcomeWasLossRef.current = true;
                                            lossStreak++;
                                            step = Math.min(step + 1, 10);
                                        }
                                        setCurrentProfit(0);
                                        setContractValue(0);
                                        setPotentialPayout(0);
                                        setContractDuration('00:00:00');
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

                await new Promise(res => setTimeout(res, 500));
            }
        } catch (e: any) {
            console.error('SmartTrader run loop error', e);
            const msg = e?.message || e?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    const stopTrading = () => {
        setIsRunning(false);
        setStatus(localize('Trading stopped'));
    };

    // Generate over/under recommendations similar to the market analyzer
    const generateOverUnderRecommendations = (symbolKey: string, stats: MarketStats): TradeRecommendation[] => {
        const recommendations: TradeRecommendation[] = [];
        const { lastDigitFrequency } = stats;

        if (!lastDigitFrequency || Object.keys(lastDigitFrequency).length === 0) {
            return recommendations;
        }

        const totalTicks = Object.values(lastDigitFrequency).reduce((a, b) => a + b, 0);

        // Analyze each barrier from 0-9
        for (let barrier = 0; barrier <= 9; barrier++) {
            let overCount = 0;
            let underCount = 0;

            // Count digits over and under barrier
            for (let digit = 0; digit <= 9; digit++) {
                const frequency = lastDigitFrequency[digit] || 0;
                if (digit > barrier) {
                    overCount += frequency;
                } else if (digit < barrier) {
                    underCount += frequency;
                }
            }

            const overPercentage = (overCount / totalTicks) * 100;
            const underPercentage = (underCount / totalTicks) * 100;

            // OVER Analysis
            if (overPercentage > 55 && overCount > 0) {
                const confidence = Math.min(overPercentage + (overPercentage - 50) * 0.5, 85);
                const overDigits = [];
                for (let d = barrier + 1; d <= 9; d++) {
                    if (lastDigitFrequency[d] > 0) overDigits.push(d);
                }

                let recommendedDigit = barrier + 1;
                let maxFreq = 0;
                for (let d = barrier + 1; d <= 9; d++) {
                    if ((lastDigitFrequency[d] || 0) > maxFreq) {
                        maxFreq = lastDigitFrequency[d] || 0;
                        recommendedDigit = d;
                    }
                }

                const avgOverFreq = overCount / Math.max(1, overDigits.length);
                const entryPoints = overDigits.filter(d => 
                    (lastDigitFrequency[d] || 0) >= avgOverFreq * 0.8
                ).slice(0, 3);

                recommendations.push({
                    symbol: symbolKey,
                    strategy: 'over',
                    barrier: barrier.toString(),
                    confidence,
                    overPercentage: confidence,
                    underPercentage: 0,
                    reason: `OVER (${barrier + 1}-9) with ${confidence.toFixed(2)}% - Recommended digit: ${recommendedDigit} - Entry Points: ${entryPoints.length > 0 ? entryPoints.join(', ') : recommendedDigit}`,
                    timestamp: Date.now(),
                    score: confidence
                });
            }

            // UNDER Analysis
            if (underPercentage > 55 && underCount > 0) {
                const confidence = Math.min(underPercentage + (underPercentage - 50) * 0.5, 85);
                const underDigits = [];
                for (let d = 0; d < barrier; d++) {
                    if (lastDigitFrequency[d] > 0) underDigits.push(d);
                }

                let recommendedDigit = Math.max(0, barrier - 1);
                let maxFreq = 0;
                for (let d = 0; d < barrier; d++) {
                    if ((lastDigitFrequency[d] || 0) > maxFreq) {
                        maxFreq = lastDigitFrequency[d] || 0;
                        recommendedDigit = d;
                    }
                }

                const avgUnderFreq = underCount / Math.max(1, underDigits.length);
                const entryPoints = underDigits.filter(d => 
                    (lastDigitFrequency[d] || 0) >= avgUnderFreq * 0.8
                ).slice(0, 3);

                recommendations.push({
                    symbol: symbolKey,
                    strategy: 'under',
                    barrier: barrier.toString(),
                    confidence,
                    overPercentage: 0,
                    underPercentage: confidence,
                    reason: `UNDER (0-${barrier - 1}) with ${confidence.toFixed(2)}% - Recommended digit: ${recommendedDigit} - Entry Points: ${entryPoints.length > 0 ? entryPoints.join(', ') : recommendedDigit}`,
                    timestamp: Date.now(),
                    score: confidence
                });
            }
        }

        return recommendations.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2); // Top 2 recommendations per symbol
    };

    const startTrading = () => {
        if (!apiRef.current) {
            setStatus('Please connect to API first');
            return;
        }
        onRun();
    };

    return (
        <div className='smart-trader-wrapper'>
            <div className='smart-trader-wrapper__header'>
                <div className='smart-trader-wrapper__title'>
                    <Text size='m' weight='bold'>
                        {localize('Smart Trader - Pre-loaded Settings')}
                    </Text>
                    <Text size='s' color='general'>
                        {localize('Trade settings loaded from scanner recommendation')}
                    </Text>
                </div>
            </div>

            <div className='smart-trader-wrapper__content'>
                <div className='smart-trader-wrapper__settings-info'>
                    <div className='smart-trader-wrapper__info-card'>
                        <Text size='s' weight='bold'>{localize('Loaded Settings:')}</Text>
                        <div className='smart-trader-wrapper__info-details'>
                            <Text size='xs' color='general'>
                                {localize('Symbol:')} {symbolMap[symbol] || symbol}
                            </Text>
                            <Text size='xs' color='general'>
                                {localize('Trade Type:')} {TRADE_TYPES.find(t => t.value === tradeType)?.label || tradeType}
                            </Text>
                            <Text size='xs' color='general'>
                                {localize('Stake:')} ${stake.toFixed(2)}
                            </Text>
                            {(tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') && (
                                <Text size='xs' color='general'>
                                    {localize('Prediction:')} {ouPredPreLoss}
                                </Text>
                            )}
                            {(tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') && (
                                <Text size='xs' color='general'>
                                    {localize('Prediction:')} {mdPrediction}
                                </Text>
                            )}
                            {(tradeType === 'CALL' || tradeType === 'PUT') && (
                                <Text size='xs' color='general'>
                                    {localize('Barrier:')} {barrier}
                                </Text>
                            )}
                        </div>
                    </div>

                    {/* Display Over/Under Recommendations */}
                    {recommendations.length > 0 && (
                        <div className='smart-trader-wrapper__recommendations'>
                            <Text size='s' weight='bold'>{localize('Recommendations:')}</Text>
                            {recommendations.map((rec, index) => (
                                <div key={index} className='smart-trader-wrapper__recommendation-item'>
                                    <Text size='xs' color='general'>{rec.reason}</Text>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className='smart-trader-wrapper__form'>
                    <div className='smart-trader-wrapper__row smart-trader-wrapper__row--two'>
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-symbol'>{localize('Volatility')}</label>
                            <select
                                id='stw-symbol'
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
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-tradeType'>{localize('Trade type')}</label>
                            <select
                                id='stw-tradeType'
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

                    <div className='smart-trader-wrapper__row smart-trader-wrapper__row--two'>
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-duration-type'>{localize('Duration Type')}</label>
                            <select
                                id='stw-duration-type'
                                value={durationType}
                                onChange={e => setDurationType(e.target.value)}
                            >
                                <option value='t'>{localize('Ticks')}</option>
                                <option value='s'>{localize('Seconds')}</option>
                                <option value='m'>{localize('Minutes')}</option>
                            </select>
                        </div>
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-duration'>{localize('Duration')}</label>
                            {durationType === 't' ? (
                                <input
                                    id='stw-duration'
                                    type='number'
                                    min={1}
                                    max={10}
                                    value={ticks}
                                    onChange={e => setTicks(Number(e.target.value))}
                                />
                            ) : (
                                <input
                                    id='stw-duration'
                                    type='number'
                                    min={durationType === 's' ? 15 : 1}
                                    max={durationType === 's' ? 86400 : 1440}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                />
                            )}
                        </div>
                    </div>

                    <div className='smart-trader-wrapper__row smart-trader-wrapper__row--two'>
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-stake'>{localize('Stake')}</label>
                            <input
                                id='stw-stake'
                                type='number'
                                step='0.01'
                                min={0.35}
                                value={stake}
                                onChange={e => setStake(Number(e.target.value))}
                            />
                        </div>
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-martingale'>{localize('Martingale multiplier')}</label>
                            <input
                                id='stw-martingale'
                                type='number'
                                min={1}
                                step='0.1'
                                value={martingaleMultiplier}
                                onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                            />
                        </div>
                    </div>

                    {/* Prediction controls based on trade type */}
                    {(tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') && (
                        <div className='smart-trader-wrapper__row smart-trader-wrapper__row--two'>
                            <div className='smart-trader-wrapper__field'>
                                <label htmlFor='stw-pred-pre'>{localize('Prediction (pre-loss)')}</label>
                                <input
                                    id='stw-pred-pre'
                                    type='number'
                                    min={0}
                                    max={9}
                                    value={ouPredPreLoss}
                                    onChange={e => setOuPredPreLoss(Math.max(0, Math.min(9, Number(e.target.value))))}
                                />
                            </div>
                            <div className='smart-trader-wrapper__field'>
                                <label htmlFor='stw-pred-post'>{localize('Prediction (after loss)')}</label>
                                <input
                                    id='stw-pred-post'
                                    type='number'
                                    min={0}
                                    max={9}
                                    value={ouPredPostLoss}
                                    onChange={e => setOuPredPostLoss(Math.max(0, Math.min(9, Number(e.target.value))))}
                                />
                            </div>
                        </div>
                    )}

                    {(tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') && (
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-md-pred'>{localize('Prediction digit')}</label>
                            <input
                                id='stw-md-pred'
                                type='number'
                                min={0}
                                max={9}
                                value={mdPrediction}
                                onChange={e => setMdPrediction(Math.max(0, Math.min(9, Number(e.target.value))))}
                            />
                        </div>
                    )}

                    {(tradeType === 'CALL' || tradeType === 'PUT') && (
                        <div className='smart-trader-wrapper__field'>
                            <label htmlFor='stw-barrier'>{localize('Barrier')}</label>
                            <input
                                id='stw-barrier'
                                type='text'
                                value={barrier}
                                onChange={e => setBarrier(e.target.value)}
                                placeholder='+0.37'
                            />
                        </div>
                    )}

                    {/* Live digits display for digit trades */}
                    {(tradeType !== 'CALL' && tradeType !== 'PUT') && (
                        <div className='smart-trader-wrapper__digits'>
                            <Text size='s' weight='bold'>{localize('Live Digits:')}</Text>
                            <div className='smart-trader-wrapper__digits-row'>
                                {digits.map((d, idx) => (
                                    <div
                                        key={`${idx}-${d}`}
                                        className={`smart-trader-wrapper__digit ${d === lastDigit ? 'is-current' : ''} ${getHintClass(d)}`}
                                    >
                                        {d}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className='smart-trader-wrapper__meta'>
                        <Text size='xs' color='general'>
                            {localize('Ticks Processed:')} {ticksProcessed}
                        </Text>
                        {(tradeType !== 'CALL' && tradeType !== 'PUT') && (
                            <Text size='xs' color='general'>
                                {localize('Last Digit:')} {lastDigit ?? '-'}
                            </Text>
                        )}
                    </div>

                    <div className='smart-trader-wrapper__actions'>
                        <button
                            className='smart-trader-wrapper__start-btn'
                            onClick={startTrading}
                            disabled={is_running || !symbol || !apiRef.current}
                        >
                            {is_running ? localize('Running...') : localize('Start Trading')}
                        </button>
                        {is_running && (
                            <button className='smart-trader-wrapper__stop-btn' onClick={stopTrading}>
                                {localize('Stop')}
                            </button>
                        )}
                        <button className='smart-trader-wrapper__close-btn' onClick={onClose}>
                            {localize('Close')}
                        </button>
                    </div>

                    {status && (
                        <div className='smart-trader-wrapper__status'>
                            <Text size='xs' color={/error|fail/i.test(status) ? 'loss-danger' : 'prominent'}>
                                {status}
                            </Text>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default SmartTraderWrapper;