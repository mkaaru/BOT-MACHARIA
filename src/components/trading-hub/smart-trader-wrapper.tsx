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
    contractType: string; // Added contractType
    barrier?: string;
    prediction?: number;
    stake: number;
    duration: number;
    durationType: string;
    // AI Auto Trade specific fields
    aiAutoTrade?: boolean;
    martingaleMultiplier?: number;
    ouPredPostLoss?: number;
    riskTolerance?: number;
    profitTarget?: number;
    stopLoss?: number; // Stop loss in USD
    takeProfit?: number; // Take profit in USD
}

interface SmartTraderWrapperProps {
    initialSettings: TradeSettings;
    onClose: () => void;
    onHide?: () => void;
    onTradingStop?: () => void;
    autoStart?: boolean; // New prop to auto-start trading
}

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

const SmartTraderWrapper: React.FC<SmartTraderWrapperProps> = observer(({ initialSettings, onClose, onHide, onTradingStop, autoStart = false }) => {
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

    // Form state from initial settings
    const [symbol, setSymbol] = useState<string>(initialSettings.symbol || '');
    const [tradeType, setTradeType] = useState<string>(initialSettings.tradeType || 'DIGITOVER');
    const [contractType, setContractType] = useState<string>(initialSettings.contractType || 'DIGITOVER'); // New state for contractType
    const [stake, setStake] = useState<number>(initialSettings.stake || 0.5);
    const [duration, setDuration] = useState<number>(initialSettings.duration || 1);
    const [durationType, setDurationType] = useState<string>(initialSettings.durationType || 't');
    const [barrier, setBarrier] = useState<string>(initialSettings.barrier || '5');
    const [prediction, setPrediction] = useState<number>(initialSettings.prediction || 5);
    const [ticks, setTicks] = useState<number>(initialSettings.duration || 1);

    // Predictions - key improvement for Over/Under after loss logic
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(parseInt(initialSettings.barrier || '5'));
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(initialSettings.ouPredPostLoss || 5);
    const [mdPrediction, setMdPrediction] = useState<number>(initialSettings.prediction || 5);

    // AI Auto Trade fields
    const [aiAutoTradeEnabled, setAiAutoTradeEnabled] = useState<boolean>(initialSettings.aiAutoTrade || false);
    const [riskTolerance, setRiskTolerance] = useState<number>(initialSettings.riskTolerance || 3);
    const [profitTarget, setProfitTarget] = useState<number>(initialSettings.profitTarget || 10);

    // Initialize ticks from duration if duration type is ticks
    React.useEffect(() => {
        if (durationType === 't') {
            setTicks(duration);
        }
    }, [duration, durationType]);

    // Martingale/recovery - Hydrate from initialSettings
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(initialSettings.martingaleMultiplier || 1.0);
    const [baseStake, setBaseStake] = useState<number>(initialSettings.stake || 0.5);
    
    // Stop loss / Take profit from initialSettings
    const [stopLoss, setStopLoss] = useState<number>(initialSettings.stopLoss || 0);
    const [takeProfit, setTakeProfit] = useState<number>(initialSettings.takeProfit || 0);
    
    // Cumulative profit tracking for stop loss/take profit
    const cumulativeProfitRef = useRef<number>(0);
    
    // Track active message handlers for cleanup
    const activeMessageHandlersRef = useRef<Set<(evt: MessageEvent) => void>>(new Set());

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

    // Rate limiting state
    const lastRequestTimeRef = useRef<number>(0);
    const requestQueueRef = useRef<Promise<any>>(Promise.resolve());

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

    // Rate limiting helper function
    const throttleApiRequest = async <T,>(requestFn: () => Promise<T>): Promise<T> => {
        const minInterval = 1500; // Minimum 1.5 seconds between API requests
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTimeRef.current;

        if (timeSinceLastRequest < minInterval) {
            const waitTime = minInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Queue requests to ensure they don't overlap
        requestQueueRef.current = requestQueueRef.current.then(async () => {
            lastRequestTimeRef.current = Date.now();
            return requestFn();
        });

        return requestQueueRef.current;
    };

    // Helper Functions
    const getHintClass = (d: number) => {
        if (tradeType === 'DIGITEVEN') return d % 2 === 0 ? 'is-green' : 'is-red';
        if (tradeType === 'DIGITODD') return d % 2 !== 0 ? 'is-green' : 'is-red';
        if ((tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER')) {
            // After a loss, use ouPredPostLoss; otherwise, use overUnderBarrier (from market scanner)
            const activePred = lastOutcomeWasLossRef.current ? ouPredPostLoss : Number(barrier);
            if (tradeType === 'DIGITOVER') {
                if (d > activePred) return 'is-green';
                if (d < activePred) return 'is-red';
                return 'is-neutral';
            }
            if (tradeType === 'DIGITUNDER') {
                if (d < activePred) return 'is-green';
                if (d > activePred) return 'is-red';
                return 'is-neutral';
            }
        }
        return '';
    };

    // Effect to initialize API connection and fetch active symbols
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

            // Cleanup observers on unmount
            if (store?.run_panel?.dbot?.observer) {
                store.run_panel.dbot.observer.unregisterAll('bot.stop');
                store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
            }
        };
    }, []);

    // Auto-start trading when autoStart prop is true
    useEffect(() => {
        if (autoStart && !is_running && symbols.length > 0) {
            console.log('🚀 Auto-starting trading from Best Opportunity panel');
            // Small delay to ensure component is fully initialized
            const timer = setTimeout(() => {
                onRun();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [autoStart, symbols.length]);

    // Register Run Panel stop observers - keep them active even when modal is hidden
    useEffect(() => {
        if (store?.run_panel?.dbot?.observer) {
            console.log('🔧 Registering Run Panel stop observers for Smart Trader');
            
            const stopHandler = async () => {
                console.log('🛑 Run Panel stop clicked - stopping Smart Trader IMMEDIATELY', { 
                    stopFlag: stopFlagRef.current,
                    activeHandlers: activeMessageHandlersRef.current.size,
                    hasOpenContract: contractInProgressRef.current
                });
                
                // CRITICAL: Set stop flag first before any async operations
                stopFlagRef.current = true;
                contractInProgressRef.current = false;
                setIsRunning(false);
                
                // Immediately update Run Panel state
                run_panel.setIsRunning(false);
                run_panel.setHasOpenContract(false);
                run_panel.setContractStage(contract_stages.NOT_RUNNING);
                
                // Stop tick stream immediately
                stopTicks();
                
                // Force cleanup of ALL active message handlers synchronously
                if (apiRef.current?.connection) {
                    console.log('🧹 Force cleaning up all WebSocket handlers');
                    
                    // Clone the set to avoid mutation during iteration
                    const handlersToRemove = Array.from(activeMessageHandlersRef.current);
                    handlersToRemove.forEach(handler => {
                        try {
                            apiRef.current?.connection?.removeEventListener('message', handler);
                        } catch (e) {
                            console.error('Error removing message listener:', e);
                        }
                    });
                    activeMessageHandlersRef.current.clear();
                    
                    // Forget all active subscriptions
                    if (tickStreamIdRef.current) {
                        try {
                            apiRef.current?.forget?.({ forget: tickStreamIdRef.current });
                            tickStreamIdRef.current = null;
                        } catch (e) {
                            console.error('Error forgetting tick stream:', e);
                        }
                    }
                    
                    // Send forget_all to ensure all subscriptions are cancelled
                    try {
                        await apiRef.current?.send?.({ forget_all: 'ticks' });
                        console.log('🧹 Sent forget_all for ticks');
                    } catch (e) {
                        console.error('Error sending forget_all:', e);
                    }
                }
                
                setStatus('Trading stopped by Run Panel');
                
                // Notify parent that trading has stopped
                if (onTradingStop) {
                    onTradingStop();
                }
                
                console.log('✅ Smart Trader fully stopped');
            };
            
            store.run_panel.dbot.observer.register('bot.stop', stopHandler);
            store.run_panel.dbot.observer.register('bot.click_stop', stopHandler);

            return () => {
                console.log('🧹 Cleaning up Run Panel stop observers');
                store.run_panel.dbot.observer.unregisterAll('bot.stop');
                store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
            };
        }
    }, [store]);

    const authorizeIfNeeded = async () => {
        if (is_authorized) return;

        return throttleApiRequest(async () => {
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
        });
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
        // Check stop flag immediately - don't start purchase if stopped
        if (stopFlagRef.current) {
            console.log('🛑 Stop flag detected in purchaseOnceWithStake - aborting purchase');
            throw new Error('Trading stopped');
        }
        
        await authorizeIfNeeded();

        const trade_option: any = {
            amount: Number(stakeAmount),
            basis: 'stake',
            contractTypes: [tradeType], // Assuming tradeType is directly usable here
            currency: account_currency,
            duration: durationType === 't' ? Number(ticks) : Number(duration),
            duration_unit: durationType,
            symbol,
        };

        // Choose prediction based on trade type and last outcome
        if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
            const isAfterLoss = lastOutcomeWasLossRef.current;
            const selectedPrediction = isAfterLoss ? ouPredPostLoss : ouPredPreLoss;
            trade_option.prediction = Number(selectedPrediction);

            console.log(`🎯 Prediction Logic:`, {
                isAfterLoss,
                selectedPrediction,
                preLossPred: ouPredPreLoss,
                postLossPred: ouPredPostLoss,
                tradeType
            });

            setStatus(`${tradeType}: ${trade_option.prediction} ${isAfterLoss ? '(after loss)' : '(pre-loss)'} - Stake: ${stakeAmount}`);
        } else if (tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') {
            trade_option.prediction = Number(mdPrediction);
            setStatus(`${tradeType}: ${mdPrediction} - Stake: ${stakeAmount}`);
        } else if (tradeType === 'CALL' || tradeType === 'PUT') {
            if (barrier) {
                trade_option.barrier = barrier;
            }
            setStatus(`${tradeType} - Stake: ${stakeAmount}`);
        } else {
            // Even/Odd doesn't need prediction
            setStatus(`${tradeType} - Stake: ${stakeAmount}`);
        }

        const buy_req = tradeOptionToBuy(tradeType, trade_option);
        console.log('📦 Buy request payload:', {
            contract_type: tradeType,
            prediction: trade_option.prediction,
            amount: stakeAmount,
            after_loss: lastOutcomeWasLossRef.current
        });

        // Handle rate limit errors
        try {
            const { buy, error } = await apiRef.current.buy(buy_req);

            if (error && (error.code === 'RateLimit' || error.message?.includes('rate limit') || error.message?.includes('too many requests'))) {
                throw new Error('Rate limit exceeded');
            }

            if (error) throw error;

            contractInProgressRef.current = true;
            console.log(`✅ Purchase confirmed: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id})`);
            return buy;
        } catch (e: any) {
             if (e.message?.includes('rate limit') || e.message?.includes('too many requests')) {
                // This specific implementation doesn't have retry logic here,
                // but it could be added if needed.
                setStatus(`Rate limit hit. Please wait and try again. ${e.message}`);
                throw e;
            }
            throw e;
        }
    };

    const onRun = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        
        // Reset cumulative profit for new trading session
        cumulativeProfitRef.current = 0;
        console.log('🔄 Cumulative profit reset for new trading session');
        
        // Register external stop handler with Run Panel
        const externalStopHandler = () => {
            console.log('🛑 External stop handler called by Run Panel');
            stopFlagRef.current = true;
            contractInProgressRef.current = false;
            setIsRunning(false);
            stopTicks();
            
            // Force cleanup of ALL active message handlers
            if (apiRef.current?.connection) {
                activeMessageHandlersRef.current.forEach(handler => {
                    try {
                        apiRef.current?.connection?.removeEventListener('message', handler);
                    } catch (e) {
                        console.error('Error removing message listener:', e);
                    }
                });
                activeMessageHandlersRef.current.clear();
            }
            
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            setStatus('Trading stopped by Run Panel');
            
            // Unregister this handler
            run_panel.unregisterExternalStopHandler();
            
            // Notify parent that trading has stopped
            if (onTradingStop) {
                onTradingStop();
            }
        };
        
        run_panel.registerExternalStopHandler(externalStopHandler);
        
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `smart-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        // Hide Smart Trader modal immediately - all control goes to Run Panel
        // Keep component mounted so trading continues
        if (onHide) {
            onHide();
        }

        try {
            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake);

            // All trade types now use rapid-fire mode (no delay between trades)
            console.log('🚀 Rapid-fire mode enabled for', tradeType);

            while (!stopFlagRef.current) {
                // CRITICAL: Multiple stop flag checks to ensure immediate break
                if (stopFlagRef.current) {
                    console.log('🛑 Stop flag detected at loop start, breaking immediately');
                    break;
                }

                const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;

                const isOU = tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER';
                if (isOU) {
                    lastOutcomeWasLossRef.current = lossStreak > 0;
                }

                setStake(effectiveStake);

                // CRITICAL: Stop flag check before purchase
                if (stopFlagRef.current) {
                    console.log('🛑 Stop flag detected before purchase, breaking immediately');
                    break;
                }

                let buy;
                try {
                    buy = await purchaseOnceWithStake(effectiveStake);
                } catch (e: any) {
                    if (e.message === 'Trading stopped' || stopFlagRef.current) {
                        console.log('🛑 Purchase aborted - stop signal received');
                        break;
                    }
                    throw e; // Re-throw other errors
                }
                
                // CRITICAL: Stop flag check after purchase
                if (stopFlagRef.current) {
                    console.log('🛑 Stop flag detected after purchase, breaking immediately');
                    break;
                }

                // No delay - all trade types now fire on every tick without waiting
                // This enables rapid-fire tick-by-tick trading for all strategies

                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: tradeType as any, // Use the selected tradeType
                        underlying: symbol,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}

                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                // ALL strategies now use rapid-fire mode: Monitor contracts in background without blocking
                // This allows trading on every tick without waiting for previous contract to close
                {
                    // Monitor contract in background without blocking
                    const monitorContract = async () => {
                        try {
                            // Check stop flag before starting monitoring
                            if (stopFlagRef.current) {
                                console.log('🛑 Stop flag detected, skipping contract monitoring');
                                return;
                            }

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
                            }

                            const onMsg = (evt: MessageEvent) => {
                                try {
                                    // Check stop flag in message handler
                                    if (stopFlagRef.current) {
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);
                                        activeMessageHandlersRef.current.delete(onMsg);
                                        return;
                                    }

                                    const data = JSON.parse(evt.data as any);
                                    if (data?.msg_type === 'proposal_open_contract') {
                                        const poc = data.proposal_open_contract;
                                        if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                                        if (String(poc?.contract_id || '') === targetId) {
                                            transactions.onBotContractEvent(poc);

                                            // Update UI state
                                            setCurrentProfit(Number(poc?.profit || 0));
                                            setContractValue(Number(poc?.bid_price || 0));
                                            setPotentialPayout(Number(poc?.payout || 0));

                                            if (poc?.is_sold || poc?.status === 'sold') {
                                                // Update run panel state
                                                run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                                run_panel.setHasOpenContract(false);
                                                contractInProgressRef.current = false;
                                                
                                                if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                                apiRef.current?.connection?.removeEventListener('message', onMsg);
                                                activeMessageHandlersRef.current.delete(onMsg);
                                                const profit = Number(poc?.profit || 0);

                                                // Update cumulative profit
                                                cumulativeProfitRef.current += profit;
                                                const totalProfit = cumulativeProfitRef.current;

                                                console.log(`💰 Cumulative Profit: ${totalProfit.toFixed(2)} ${account_currency}`);

                                                // Check stop loss condition
                                                if (stopLoss > 0 && totalProfit <= -stopLoss) {
                                                    console.log(`🛑 Stop Loss Hit: ${totalProfit.toFixed(2)} ${account_currency} (Limit: -${stopLoss})`);
                                                    setStatus(`Stop Loss reached: ${totalProfit.toFixed(2)} ${account_currency}`);
                                                    stopFlagRef.current = true; // Stop trading
                                                }

                                                // Check take profit condition
                                                if (takeProfit > 0 && totalProfit >= takeProfit) {
                                                    console.log(`🎯 Take Profit Hit: ${totalProfit.toFixed(2)} ${account_currency} (Target: ${takeProfit})`);
                                                    setStatus(`Take Profit reached: ${totalProfit.toFixed(2)} ${account_currency}`);
                                                    stopFlagRef.current = true; // Stop trading
                                                }

                                                // Handle win/loss for martingale progression
                                                if (profit > 0) {
                                                    // WIN: Reset to base stake
                                                    lastOutcomeWasLossRef.current = false;
                                                    lossStreak = 0;
                                                    step = 0;
                                                    setStake(baseStake);
                                                    console.log(`✅ ${tradeType} WIN: +${profit.toFixed(2)} ${account_currency} - Reset to base stake`);
                                                } else {
                                                    // LOSS: Increase stake for martingale
                                                    lastOutcomeWasLossRef.current = true;
                                                    lossStreak++;
                                                    step = Math.min(step + 1, 10);
                                                    console.log(`❌ ${tradeType} LOSS: ${profit.toFixed(2)} ${account_currency} - Martingale step ${step}`);
                                                }

                                                // Clear UI state
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
                            
                            // Track this handler so it can be cleaned up on stop
                            activeMessageHandlersRef.current.add(onMsg);
                            apiRef.current?.connection?.addEventListener('message', onMsg);
                        } catch (subErr) {
                            console.error('background monitor error', subErr);
                        }
                    };

                    // Start monitoring in background
                    monitorContract();

                    // Wait only for next tick (minimal delay ~1.2s per tick for rapid-fire mode)
                    // Use a cancellable delay that respects stop flag for IMMEDIATE break
                    await new Promise((resolve) => {
                        const checkInterval = 50; // Check every 50ms for faster response
                        let elapsed = 0;
                        const interval = setInterval(() => {
                            if (stopFlagRef.current) {
                                // IMMEDIATE break if stop flag is set
                                clearInterval(interval);
                                resolve(null);
                                return;
                            }
                            elapsed += checkInterval;
                            if (elapsed >= 1200) {
                                clearInterval(interval);
                                resolve(null);
                            }
                        }, checkInterval);
                    });
                }
                
                // FINAL stop flag check before next iteration
                if (stopFlagRef.current) {
                    console.log('🛑 Stop flag detected after delay, breaking immediately');
                    break;
                }

                // Check stop flag before continuing to next trade
                if (stopFlagRef.current) {
                    console.log('🛑 Stop flag detected after contract, breaking trading loop');
                    break;
                }
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
            
            // Unregister external stop handler when trading ends
            run_panel.unregisterExternalStopHandler();
        }
    };

    const stopTrading = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
        stopTicks();
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        setStatus('Trading stopped');
        
        // Notify parent that trading has stopped so modal can be fully closed/reset
        if (onTradingStop) {
            onTradingStop();
        }
    };

    const startTrading = () => {
        if (!apiRef.current) {
            setStatus('Please connect to API first');
            return;
        }
        onRun();

        // Hide the modal when trading starts (minimize without stopping)
        if (onHide) {
            setStatus('Trading started - Modal will minimize. Trading continues in background.');
            // Small delay to ensure trading starts and user sees the message
            setTimeout(() => {
                onHide();
            }, 1000);
        }
    };

    // Set initial values from Trading Hub recommendation
    // This effect MUST run whenever initialSettings changes to update all trading parameters
    useEffect(() => {
        if (initialSettings) {
            console.log('🔄 Smart Trader UPDATING with new settings:', {
                symbol: initialSettings.symbol,
                tradeType: initialSettings.tradeType,
                contractType: initialSettings.contractType,
                prediction: initialSettings.prediction,
                barrier: initialSettings.barrier,
                stake: initialSettings.stake
            });

            // Update all trading parameters from initialSettings
            setSymbol(initialSettings.symbol);
            
            // Use contractType as the primary trade type if available
            const primaryTradeType = initialSettings.contractType || initialSettings.tradeType || 'DIGITOVER';
            setTradeType(primaryTradeType);
            setContractType(primaryTradeType);
            
            setStake(initialSettings.stake || 0.5);
            setDuration(initialSettings.duration || 1);
            setDurationType(initialSettings.durationType || 't');

            // Set prediction for digits contracts - CRITICAL for correct trade execution
            if (initialSettings.prediction !== undefined) {
                setPrediction(initialSettings.prediction);
                console.log('📍 Prediction set to:', initialSettings.prediction);
            }

            // Set barrier for over/under strategies - CRITICAL for correct trade execution
            if (initialSettings.barrier) {
                setBarrier(initialSettings.barrier);
                console.log('📍 Barrier set to:', initialSettings.barrier);
            }

            console.log('✅ Smart Trader state updated with:', {
                symbol: initialSettings.symbol,
                tradeType: primaryTradeType,
                contractType: primaryTradeType,
                prediction: initialSettings.prediction,
                barrier: initialSettings.barrier
            });
        }
    }, [initialSettings.symbol, initialSettings.tradeType, initialSettings.contractType, initialSettings.prediction, initialSettings.barrier, initialSettings.stake, initialSettings.duration]);


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
                                {/* Updated to show contractType if available, otherwise tradeType */}
                                {localize('Trade Type:')} {TRADE_TYPES.find(t => t.value === contractType)?.label || TRADE_TYPES.find(t => t.value === tradeType)?.label || tradeType}
                            </Text>
                            <Text size='xs' color='general'>
                                {localize('Stake:')} ${stake.toFixed(2)}
                            </Text>
                            {(contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') && (
                                <Text size='xs' color='general'>
                                    {localize('Barrier:')} {barrier}
                                </Text>
                            )}
                            {(contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') && (
                                <Text size='xs' color='general'>
                                    {localize('Prediction:')} {mdPrediction}
                                </Text>
                            )}
                            {(contractType === 'CALL' || contractType === 'PUT') && (
                                <Text size='xs' color='general'>
                                    {localize('Barrier:')} {barrier}
                                </Text>
                            )}
                        </div>
                    </div>
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

                    {/* AI Auto Trade Configuration */}
                    {aiAutoTradeEnabled && (
                        <div className='smart-trader-wrapper__ai-config'>
                            <div className='smart-trader-wrapper__ai-header'>
                                <Text size='s' weight='bold' color='prominent'>
                                    🤖 AI Auto Trade Configuration
                                </Text>
                                <Text size='xs' color='general'>
                                    Enhanced settings for automated AI trading
                                </Text>
                            </div>
                            <div className='smart-trader-wrapper__row smart-trader-wrapper__row--three'>
                                <div className='smart-trader-wrapper__field'>
                                    <label htmlFor='st-risk-tolerance'>{localize('Risk Tolerance (1-5)')}</label>
                                    <input
                                        id='st-risk-tolerance'
                                        type='number'
                                        min={1}
                                        max={5}
                                        value={riskTolerance}
                                        onChange={e => setRiskTolerance(Math.max(1, Math.min(5, Number(e.target.value))))}
                                    />
                                </div>
                                <div className='smart-trader-wrapper__field'>
                                    <label htmlFor='st-profit-target'>{localize('Profit Target ($)')}</label>
                                    <input
                                        id='st-profit-target'
                                        type='number'
                                        min={1}
                                        step='0.5'
                                        value={profitTarget}
                                        onChange={e => setProfitTarget(Math.max(1, Number(e.target.value)))}
                                    />
                                </div>
                                <div className='smart-trader-wrapper__field'>
                                    <label htmlFor='st-ai-martingale'>{localize('AI Martingale Multiplier')}</label>
                                    <input
                                        id='st-ai-martingale'
                                        type='number'
                                        min={1}
                                        step='0.1'
                                        value={martingaleMultiplier}
                                        onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Strategy controls based on trade type */}
                    {(contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') ? (
                        <div className='smart-trader-wrapper__row'>
                            <div className='smart-trader-wrapper__field'>
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
                            <div className='smart-trader-wrapper__field'>
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
                    ) : (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') ? (
                        <div className='smart-trader-wrapper__predictions'>
                            <div className='smart-trader-wrapper__row'>
                                <div className='smart-trader-wrapper__field'>
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
                                <div className='smart-trader-wrapper__field'>
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
                            <div className='smart-trader-wrapper__field'>
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
                        <div className='smart-trader-wrapper__row'>
                            <div className='smart-trader-wrapper__field'>
                                <label htmlFor='st-barrier'>{localize('Barrier')}</label>
                                <input
                                    id='st-barrier'
                                    type='text'
                                    value={barrier}
                                    onChange={e => setBarrier(e.target.value)}
                                />
                            </div>
                            <div className='smart-trader-wrapper__field'>
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
                    {(contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') && (
                        <div className='smart-trader-wrapper__current-prediction'>
                            <Text size='xs' color={lastOutcomeWasLossRef.current ? 'profit-success' : 'prominent'}>
                                {localize('Next prediction:')} {lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss}
                                ({lastOutcomeWasLossRef.current ? localize('after loss') : localize('pre-loss')})
                            </Text>
                            {lastOutcomeWasLossRef.current && (
                                <Text size='xs' color='loss-danger'>
                                    {localize('⚠️ Using recovery prediction after loss')}
                                </Text>
                            )}
                        </div>
                    )}

                    <div className='smart-trader-wrapper__meta'>
                        <Text size='xs' color='general'>
                            {localize('Ticks Processed:')} {ticksProcessed}
                        </Text>
                        {(contractType !== 'CALL' && contractType !== 'PUT') && (
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
                            <>
                                <button className='smart-trader-wrapper__stop-btn' onClick={stopTrading}>
                                    {localize('Stop')}
                                </button>
                            </>
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