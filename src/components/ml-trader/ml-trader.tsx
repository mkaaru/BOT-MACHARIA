import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken, V2GetActiveClientId } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Comprehensive trade types including Rise/Fall and Higher/Lower
const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
    // Rise/Fall Contracts (no barriers)
    { value: 'CALLE', label: 'Rise' },
    { value: 'PUTE', label: 'Fall' },
    // Higher/Lower Contracts (with barriers)
    { value: 'CALL', label: 'Higher' },
    { value: 'PUT', label: 'Lower' },
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

    // Handle digit prediction contracts
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = String(trade_option.prediction);
    }

    // Handle Higher/Lower contracts with barriers (CALL/PUT)
    if (['CALL', 'PUT'].includes(contract_type) && trade_option.barrier !== undefined) {
        // For Higher/Lower contracts, barrier should be a relative offset
        let barrier = String(trade_option.barrier);
        // Ensure proper formatting - remove any existing + or - and add appropriate sign
        barrier = barrier.replace(/^[+-]/, '');
        buy.parameters.barrier = contract_type === 'CALL' ? `+${barrier}` : `-${barrier}`;
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
    const [higherBarrier, setHigherBarrier] = useState('+0.1');
    const [lowerBarrier, setLowerBarrier] = useState('-0.1');
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

    // Refs for cleanup and state management
    const derivApiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const stopFlagRef = useRef<boolean>(false);
    const lastOutcomeWasLossRef = useRef(false);

    // Authorization helper
    const authorizeIfNeeded = async () => {
        if (isAuthorized) return;
        
        const maxRetries = 3;
        let retries = 0;
        
        while (retries < maxRetries) {
            try {
                const token = V2GetActiveToken();
                if (!token) {
                    setStatusMessage('Please log in to your Deriv account first.');
                    throw new Error('No authentication token available');
                }

                setStatusMessage(`Authorizing... ${retries > 0 ? `(attempt ${retries + 1}/${maxRetries})` : ''}`);
                
                // Ensure we have a fresh API connection
                if (!derivApiRef.current || derivApiRef.current.connection?.readyState !== WebSocket.OPEN) {
                    setStatusMessage('Establishing connection...');
                    const api = generateDerivApiInstance();
                    derivApiRef.current = api;
                    
                    // Wait for connection to be ready
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
                        
                        if (api.connection.readyState === WebSocket.OPEN) {
                            clearTimeout(timeout);
                            resolve(true);
                        } else {
                            const onOpen = () => {
                                clearTimeout(timeout);
                                api.connection.removeEventListener('open', onOpen);
                                api.connection.removeEventListener('error', onError);
                                resolve(true);
                            };
                            const onError = (error: any) => {
                                clearTimeout(timeout);
                                api.connection.removeEventListener('open', onOpen);
                                api.connection.removeEventListener('error', onError);
                                reject(error);
                            };
                            
                            api.connection.addEventListener('open', onOpen);
                            api.connection.addEventListener('error', onError);
                        }
                    });
                }

                // Add a small delay to ensure connection is stable
                await new Promise(resolve => setTimeout(resolve, 500));

                const response = await derivApiRef.current.authorize(token);
                
                if (response.error) {
                    const errorMsg = response.error.message || 'Authorization failed';
                    if (retries < maxRetries - 1) {
                        console.warn(`Authorization attempt ${retries + 1} failed: ${errorMsg}, retrying...`);
                        retries++;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                    setStatusMessage(`Authorization error: ${errorMsg}`);
                    throw new Error(errorMsg);
                }

                const { authorize } = response;
                if (!authorize) {
                    throw new Error('Invalid authorization response');
                }

                setIsAuthorized(true);
                const loginid = authorize.loginid || V2GetActiveClientId();
                setAccountCurrency(authorize.currency || 'USD');
                
                try {
                    // Sync ML Trader auth state into shared ClientStore
                    store?.client?.setLoginId?.(loginid || '');
                    store?.client?.setCurrency?.(authorize.currency || 'USD');
                    store?.client?.setIsLoggedIn?.(true);
                } catch (syncError) {
                    console.warn('Failed to sync client state:', syncError);
                }

                setStatusMessage('Authorization successful');
                return; // Success, exit the retry loop
                
            } catch (error: any) {
                console.error(`Authorization attempt ${retries + 1} failed:`, error);
                
                if (retries < maxRetries - 1) {
                    retries++;
                    const delay = Math.min(1000 * Math.pow(2, retries), 5000); // Exponential backoff, max 5s
                    setStatusMessage(`Authorization failed, retrying in ${delay/1000}s... (${retries}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                // Final failure
                setIsAuthorized(false);
                const errorMessage = error?.message || 'Authorization failed';
                
                if (errorMessage.includes('network') || errorMessage.includes('connection') || errorMessage.includes('timeout')) {
                    setStatusMessage('Connection error. Please check your internet connection and try again.');
                } else {
                    setStatusMessage(`Authorization failed: ${errorMessage}. Please refresh the page and try again.`);
                }
                
                throw error;
            }
        }
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

    // Handle duration type changes for Higher/Lower contracts
    useEffect(() => {
        if (['CALL', 'PUT'].includes(selectedTradeType)) {
            // Higher/Lower contracts need time-based durations, not ticks
            if (durationType === 't') {
                setDurationType('m');
                setDuration(5); // 5 minutes default
            }
        } else if (['CALLE', 'PUTE'].includes(selectedTradeType)) {
            // Rise/Fall contracts work with ticks
            if (durationType !== 't' && durationType !== 's' && durationType !== 'm') {
                setDurationType('t');
                setDuration(1);
            }
        }
    }, [selectedTradeType]);

    // Initialize connection and load historical data
    useEffect(() => {
        const initConnection = async () => {
            try {
                setStatusMessage('Connecting to trading servers...');
                setConnectionStatus('Connecting');
                
                const api = generateDerivApiInstance();
                derivApiRef.current = api;

                // Wait for connection to be established
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
                    
                    if (api.connection.readyState === WebSocket.OPEN) {
                        clearTimeout(timeout);
                        resolve(true);
                    } else {
                        api.connection.addEventListener('open', () => {
                            clearTimeout(timeout);
                            resolve(true);
                        });
                        api.connection.addEventListener('error', (error) => {
                            clearTimeout(timeout);
                            reject(error);
                        });
                    }
                });

                setConnectionStatus('Loading symbols...');
                
                // Fetch active symbols (volatility indices)
                const response = await api.send({ active_symbols: 'brief' });
                if (response.error) {
                    throw new Error(response.error.message || 'Failed to load trading symbols');
                }

                const volatilitySymbols = (response.active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol) || /1HZ.*V/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                
                if (volatilitySymbols.length === 0) {
                    throw new Error('No volatility symbols available');
                }
                
                setAvailableSymbols(volatilitySymbols);
                if (!selectedVolatility && volatilitySymbols[0]?.symbol) {
                    setSelectedVolatility(volatilitySymbols[0].symbol);
                }

                setConnectionStatus('Connected');
                setStatusMessage('Loading market data...');

                // Load historical data for all volatility markets
                for (const symbolObj of volatilitySymbols) {
                    try {
                        await loadHistoricalData(symbolObj.symbol);
                        // Start ticks for the initially selected symbol
                        if (symbolObj.symbol === selectedVolatility) {
                            startTicks(symbolObj.symbol);
                        }
                    } catch (dataError) {
                        console.warn(`Failed to load data for ${symbolObj.symbol}:`, dataError);
                    }
                }

                setStatusMessage('Ready to start trading');
                
            } catch (error: any) {
                console.error('Connection initialization failed:', error);
                setConnectionStatus('Error');
                
                const errorMsg = error?.message || 'Connection failed';
                setStatusMessage(`Connection error: ${errorMsg}. Please refresh the page.`);
                
                // Retry connection after 5 seconds
                setTimeout(() => {
                    if (derivApiRef.current?.connection?.readyState !== WebSocket.OPEN) {
                        setStatusMessage('Retrying connection...');
                        initConnection();
                    }
                }, 5000);
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

    // Purchase function
    const purchaseOnce = async () => {
        await authorizeIfNeeded();

        // Validate duration for Higher/Lower contracts
        if (['CALL', 'PUT'].includes(selectedTradeType) && durationType === 't') {
            throw new Error('Higher/Lower contracts require time-based durations (minutes/hours), not ticks');
        }

        const trade_option: any = {
            amount: Number(stake),
            basis: 'stake',
            contractTypes: [selectedTradeType],
            currency: accountCurrency,
            duration: Number(duration),
            duration_unit: durationType,
            symbol: selectedVolatility,
        };

        // Choose prediction/barrier based on trade type and last outcome
        if (selectedTradeType === 'DIGITOVER' || selectedTradeType === 'DIGITUNDER') {
            trade_option.prediction = Number(lastOutcomeWasLossRef.current ? underPrediction : overPrediction);
        } else if (selectedTradeType === 'DIGITMATCH' || selectedTradeType === 'DIGITDIFF') {
            trade_option.prediction = Number(lastOutcomeWasLossRef.current ? underPrediction : overPrediction);
        } else if (selectedTradeType === 'CALL') {
            // For Higher contracts, use the higher barrier value
            if (!higherBarrier || higherBarrier.trim() === '') {
                throw new Error('Higher barrier is required for CALL contracts');
            }
            // Remove any + or - prefix and use just the numeric value
            const numericBarrier = higherBarrier.trim().replace(/^[+-]/, '');
            trade_option.barrier = numericBarrier;
        } else if (selectedTradeType === 'PUT') {
            // For Lower contracts, use the lower barrier value  
            if (!lowerBarrier || lowerBarrier.trim() === '') {
                throw new Error('Lower barrier is required for PUT contracts');
            }
            // Remove any + or - prefix and use just the numeric value
            const numericBarrier = lowerBarrier.trim().replace(/^[+-]/, '');
            trade_option.barrier = numericBarrier;
        } else if (selectedTradeType === 'CALLE' || selectedTradeType === 'PUTE') {
            // Rise/Fall contracts don't need barriers for basic contracts
        }

        const buy_req = tradeOptionToBuy(selectedTradeType, trade_option);
        
        // Debug logging for Higher/Lower contracts
        if (['CALL', 'PUT'].includes(selectedTradeType)) {
            console.log('📊 Higher/Lower Purchase Request:', {
                contract_type: selectedTradeType,
                barrier: buy_req.parameters.barrier,
                duration: buy_req.parameters.duration,
                duration_unit: buy_req.parameters.duration_unit,
                symbol: selectedVolatility,
                amount: buy_req.parameters.amount
            });
        }
        
        // Validate the buy request before sending
        if (['CALL', 'PUT'].includes(selectedTradeType)) {
            if (!buy_req.parameters.barrier) {
                throw new Error(`Barrier is required for ${selectedTradeType} contracts`);
            }
            if (buy_req.parameters.duration_unit === 't') {
                throw new Error('Higher/Lower contracts cannot use tick-based durations');
            }
            
            // Additional validation for barrier format
            const barrier = buy_req.parameters.barrier;
            if (!/^[+-]?\d*\.?\d+$/.test(barrier)) {
                throw new Error(`Invalid barrier format: ${barrier}. Expected format: +0.1 or -0.1`);
            }
        }

        const { buy, error } = await derivApiRef.current.buy(buy_req);
        if (error) {
            console.error('Purchase error:', error);
            throw new Error(error.message || 'Purchase failed');
        }
        
        setStatusMessage(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id}) - Stake: ${stake}`);
        return buy;
    };

    // Connection health check
    const checkConnectionHealth = async () => {
        if (!derivApiRef.current || derivApiRef.current.connection?.readyState !== WebSocket.OPEN) {
            throw new Error('Connection not available');
        }
        
        // Send a ping to verify the connection is working
        try {
            const pingResult = await derivApiRef.current.ping();
            if (pingResult.error) {
                throw new Error(`Ping failed: ${pingResult.error.message}`);
            }
        } catch (pingError) {
            throw new Error('Connection health check failed');
        }
    };

    // Start trading handler with full run panel integration
    const handleStartTrading = useCallback(async () => {
        // Pre-flight checks
        if (!selectedVolatility || availableSymbols.length === 0) {
            setStatusMessage('No trading symbols available. Please refresh the page.');
            return;
        }

        // Validate Higher/Lower contract settings
        if (['CALL', 'PUT'].includes(selectedTradeType)) {
            if (durationType === 't') {
                setStatusMessage('Error: Higher/Lower contracts require time-based durations (minutes/hours), not ticks.');
                return;
            }
            
            if (selectedTradeType === 'CALL' && (!higherBarrier || higherBarrier.trim() === '')) {
                setStatusMessage('Error: Higher barrier is required for CALL contracts.');
                return;
            }
            
            if (selectedTradeType === 'PUT' && (!lowerBarrier || lowerBarrier.trim() === '')) {
                setStatusMessage('Error: Lower barrier is required for PUT contracts.');
                return;
            }

            // Validate barrier format
            const barrierToCheck = selectedTradeType === 'CALL' ? higherBarrier : lowerBarrier;
            const barrierNum = barrierToCheck.replace(/[+-]/, '');
            if (isNaN(Number(barrierNum))) {
                setStatusMessage('Error: Invalid barrier format. Use values like +0.1 or -0.1');
                return;
            }
        }

        setStatusMessage('Performing connection health check...');
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
            // Check connection health first
            await checkConnectionHealth();
            
            // Test authorization
            await authorizeIfNeeded();
            
            setStatusMessage('Starting automated trading...');
            
        } catch (authError: any) {
            console.error('Failed to start trading:', authError);
            setIsRunning(false);
            setIsTrading(false);
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            
            const errorMsg = authError?.message || 'Failed to start trading';
            setStatusMessage(`Error: ${errorMsg}`);
            
            // Offer to retry connection if it's a connection issue
            if (errorMsg.includes('Connection') || errorMsg.includes('network') || errorMsg.includes('timeout')) {
                setTimeout(() => {
                    setStatusMessage(`${errorMsg} - Click "Start Trading" to retry.`);
                }, 3000);
            }
            
            return;
        }

        try {
            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake);

            while (!stopFlagRef.current) {
                // Adjust stake based on martingale strategy
                const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;
                setStake(effectiveStake);

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
                                            setStake(baseStake);
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
    }, [selectedVolatility, selectedTradeType, duration, durationType, stake, baseStake, overPrediction, underPrediction, higherBarrier, lowerBarrier, martingaleMultiplier, accountCurrency, availableSymbols, run_panel, transactions]);

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
                                        disabled={isTrading}
                                    >
                                        {/* Higher/Lower contracts (CALL/PUT) require time-based durations */}
                                        {['CALL', 'PUT'].includes(selectedTradeType) ? (
                                            <>
                                                <option value="m">{localize('Minutes')}</option>
                                                <option value="h">{localize('Hours')}</option>
                                                <option value="d">{localize('Days')}</option>
                                            </>
                                        ) : (
                                            <>
                                                <option value="t">{localize('Ticks')}</option>
                                                <option value="s">{localize('Seconds')}</option>
                                                <option value="m">{localize('Minutes')}</option>
                                            </>
                                        )}
                                    </select>
                                </div>

                                <div className='ml-trader__field'>
                                    <label>{localize('Duration')}</label>
                                    <input
                                        type='number'
                                        min='1'
                                        max={['CALL', 'PUT'].includes(selectedTradeType) ? '365' : '10'}
                                        value={duration}
                                        onChange={(e) => setDuration(parseInt(e.target.value))}
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
                                        value={stake}
                                        onChange={(e) => setStake(parseFloat(e.target.value))}
                                        disabled={isTrading}
                                    />
                                </div>

                                {/* Digit Predictions for Over/Under, Match/Diff */}
                                {['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedTradeType) && (
                                    <div className='ml-trader__predictions'>
                                        <div className='ml-trader__field'>
                                            <label>{localize('Digit prediction (pre-loss)')}</label>
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
                                            <label>{localize('Digit prediction (after loss)')}</label>
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

                                {/* Barriers for Higher/Lower contracts */}
                                {['CALL', 'PUT'].includes(selectedTradeType) && (
                                    <div className='ml-trader__predictions'>
                                        <div className='ml-trader__field'>
                                            <label>{localize('Higher barrier (e.g., +0.1, +0.5)')}</label>
                                            <input
                                                type='text'
                                                value={higherBarrier}
                                                onChange={(e) => {
                                                    let value = e.target.value.trim();
                                                    // Validate and format barrier
                                                    if (value && !value.startsWith('+') && !value.startsWith('-') && !isNaN(Number(value))) {
                                                        value = '+' + value;
                                                    }
                                                    setHigherBarrier(value);
                                                }}
                                                disabled={isTrading}
                                                placeholder='+0.1'
                                                pattern="^[+-]?\d*\.?\d+$"
                                                title="Enter a barrier value like +0.1 or +0.5"
                                            />
                                        </div>

                                        <div className='ml-trader__field'>
                                            <label>{localize('Lower barrier (e.g., -0.1, -0.5)')}</label>
                                            <input
                                                type='text'
                                                value={lowerBarrier}
                                                onChange={(e) => {
                                                    let value = e.target.value.trim();
                                                    // Validate and format barrier
                                                    if (value && !value.startsWith('+') && !value.startsWith('-') && !isNaN(Number(value))) {
                                                        value = '-' + value;
                                                    }
                                                    setLowerBarrier(value);
                                                }}
                                                disabled={isTrading}
                                                placeholder='-0.1'
                                                pattern="^[+-]?\d*\.?\d+$"
                                                title="Enter a barrier value like -0.1 or -0.5"
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

                                {/* Rise/Fall contracts only need Martingale */}
                                {['CALLE', 'PUTE'].includes(selectedTradeType) && (
                                    <div className='ml-trader__predictions'>
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

                                {/* Even/Odd contracts only need Martingale */}
                                {['DIGITEVEN', 'DIGITODD'].includes(selectedTradeType) && (
                                    <div className='ml-trader__predictions'>
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
                                {['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'].includes(selectedTradeType) && (
                                    <Text size='s'>
                                        {localize('Last Digit')}: {lastDigit}
                                    </Text>
                                )}
                                <Text size='s'>
                                    {localize('Current Price')}: {currentPrice}
                                </Text>
                                {['CALL', 'PUT'].includes(selectedTradeType) && (
                                    <Text size='s'>
                                        {localize('Active Barrier')}: {selectedTradeType === 'CALL' ? higherBarrier : lowerBarrier} 
                                        ({selectedTradeType === 'CALL' ? 'Higher' : 'Lower'})
                                    </Text>
                                )}
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
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLTrader;