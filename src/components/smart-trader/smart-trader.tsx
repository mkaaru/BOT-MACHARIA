import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

// Contract types for different trading strategies
const CONTRACT_TYPES = {
    RISE_FALL: { CALL: 'CALL', PUT: 'PUT' },
    EVEN_ODD: { EVEN: 'DIGITEVEN', ODD: 'DIGITODD' },
    HIGHER_LOWER: { CALL: 'CALL', PUT: 'PUT' },
    OVER_UNDER: { OVER: 'DIGITOVER', UNDER: 'DIGITUNDER' },
    MATCH_DIFF: { MATCH: 'DIGITMATCH', DIFF: 'DIGITDIFF' }
};

// Trade option builder
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

    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }

    return buy;
};

const SmartTradingAnalytics = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    // API and connection state
    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);

    // Authentication and symbols
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [accountCurrency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_10');

    // Tick data and analysis
    const [tickCount, setTickCount] = useState<number>(120);
    const [barrier, setBarrier] = useState<string>('5');
    const [tickHistory, setTickHistory] = useState<number[]>([]);
    const [lastDigits, setLastDigits] = useState<number[]>([]);

    // Analysis results for different contract types
    const [riseAnalysis, setRiseAnalysis] = useState({ rise: 50.0, fall: 50.0 });
    const [evenOddAnalysis, setEvenOddAnalysis] = useState({ even: 50.0, odd: 50.0 });
    const [evenOddPattern, setEvenOddPattern] = useState({ pattern: [], streak: 'Current streak: 1 even' });

    // Trading configuration for each strategy
    const [tradingConfigs, setTradingConfigs] = useState({
        risefall: {
            condition: 'Rise Prob',
            operator: '>',
            threshold: 55,
            action: 'Buy Rise',
            stake: 0.5,
            ticks: 1,
            martingale: 1,
            isRunning: false
        },
        evenodd: {
            condition: 'Even Prob',
            operator: '>',
            threshold: 55,
            action: 'Buy Even',
            stake: 0.5,
            ticks: 1,
            martingale: 1,
            isRunning: false
        },
        evenoddpattern: {
            condition: 'Even Prob',
            operator: '>',
            threshold: 55,
            action: 'Buy Even',
            stake: 0.5,
            ticks: 1,
            martingale: 1,
            isRunning: false
        }
    });

    // Trading state
    const [status, setStatus] = useState<string>('');
    const stopFlags = useRef({ risefall: false, evenodd: false, evenoddpattern: false });

    // Initialize API and fetch symbols
    useEffect(() => {
        const initializeAPI = async () => {
            try {
                const api = generateDerivApiInstance();
                apiRef.current = api;

                const { active_symbols, error } = await api.send({ active_symbols: 'brief' });
                if (error) throw error;

                const volatilitySymbols = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));

                setSymbols(volatilitySymbols);
                if (volatilitySymbols.length > 0) {
                    setSelectedSymbol(volatilitySymbols[0].symbol);
                    startTickStream(volatilitySymbols[0].symbol);
                }
            } catch (error: any) {
                console.error('Failed to initialize API:', error);
                setStatus(`Error: ${error.message || 'Failed to connect to API'}`);
            }
        };

        initializeAPI();

        return () => {
            cleanup();
        };
    }, []);

    // Cleanup function
    const cleanup = () => {
        try {
            if (tickStreamIdRef.current && apiRef.current) {
                apiRef.current.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }
            if (messageHandlerRef.current && apiRef.current?.connection) {
                apiRef.current.connection.removeEventListener('message', messageHandlerRef.current);
                messageHandlerRef.current = null;
            }
            if (apiRef.current?.disconnect) {
                apiRef.current.disconnect();
            }
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    };

    // Start tick stream
    const startTickStream = async (symbol: string) => {
        try {
            // Stop existing stream
            if (tickStreamIdRef.current) {
                await apiRef.current.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }

            // Start new stream
            const { subscription, error } = await apiRef.current.send({ 
                ticks: symbol, 
                subscribe: 1 
            });

            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;

            // Set up message handler
            const onMessage = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === symbol) {
                        const quote = parseFloat(data.tick.quote);
                        const digit = Math.floor(Math.abs(quote * 100000)) % 10;

                        setTickHistory(prev => {
                            const newHistory = [...prev, quote].slice(-tickCount);
                            analyzePatterns(newHistory);
                            return newHistory;
                        });

                        setLastDigits(prev => {
                            const newDigits = [...prev, digit].slice(-20);
                            analyzeEvenOddPatterns(newDigits);
                            return newDigits;
                        });
                    }
                } catch (error) {
                    console.error('Message parsing error:', error);
                }
            };

            messageHandlerRef.current = onMessage;
            apiRef.current.connection.addEventListener('message', onMessage);

        } catch (error: any) {
            console.error('Failed to start tick stream:', error);
            setStatus(`Error: ${error.message || 'Failed to start tick stream'}`);
        }
    };

    // Analyze patterns for Rise/Fall
    const analyzePatterns = (history: number[]) => {
        if (history.length < 50) return;

        try {
            const recentTicks = history.slice(-50);
            let riseCount = 0;

            for (let i = 1; i < recentTicks.length; i++) {
                if (recentTicks[i] > recentTicks[i - 1]) {
                    riseCount++;
                }
            }

            const riseProb = (riseCount / (recentTicks.length - 1)) * 100;
            const fallProb = 100 - riseProb;

            setRiseAnalysis({ rise: riseProb, fall: fallProb });

            // Check trading conditions
            checkTradingConditions('risefall', { riseProb, fallProb });

        } catch (error) {
            console.error('Pattern analysis error:', error);
        }
    };

    // Analyze Even/Odd patterns
    const analyzeEvenOddPatterns = (digits: number[]) => {
        if (digits.length < 10) return;

        try {
            const recentDigits = digits.slice(-20);
            const evenCount = recentDigits.filter(d => d % 2 === 0).length;
            const oddCount = recentDigits.length - evenCount;

            const evenProb = (evenCount / recentDigits.length) * 100;
            const oddProb = (oddCount / recentDigits.length) * 100;

            setEvenOddAnalysis({ even: evenProb, odd: oddProb });

            // Analyze streak patterns
            const streaks = [];
            if (recentDigits.length > 0) {
                let currentStreakType = recentDigits[0] % 2;
                let streakLength = 1;

                for (let i = 1; i < recentDigits.length; i++) {
                    if (recentDigits[i] % 2 === currentStreakType) {
                        streakLength++;
                    } else {
                        streaks.push(streakLength);
                        currentStreakType = recentDigits[i] % 2;
                        streakLength = 1;
                    }
                }

                const avgStreak = streaks.length > 0 
                    ? (streaks.reduce((a, b) => a + b, 0) / streaks.length).toFixed(1)
                    : '---';

                const lastDigit = recentDigits[recentDigits.length - 1];
                const currentStreakType = lastDigit % 2 === 0 ? 'even' : 'odd';

                setEvenOddPattern({
                    pattern: recentDigits.slice(-10),
                    streak: `Current streak: 1 ${currentStreakType}`
                });
            }

            // Check trading conditions
            checkTradingConditions('evenodd', { evenProb, oddProb });
            checkTradingConditions('evenoddpattern', { evenProb, oddProb });

        } catch (error) {
            console.error('Even/Odd analysis error:', error);
        }
    };

    // Check if trading conditions are met
    const checkTradingConditions = (strategy: string, analysis: any) => {
        const config = tradingConfigs[strategy as keyof typeof tradingConfigs];
        if (!config || !config.isRunning) return;

        try {
            let shouldTrade = false;
            let contractType = '';

            switch (strategy) {
                case 'risefall':
                    if (config.condition === 'Rise Prob') {
                        shouldTrade = config.operator === '>' 
                            ? analysis.riseProb > config.threshold
                            : analysis.riseProb < config.threshold;
                        contractType = shouldTrade && config.action === 'Buy Rise' ? 'CALL' : 'PUT';
                    }
                    break;

                case 'evenodd':
                case 'evenoddpattern':
                    if (config.condition === 'Even Prob') {
                        shouldTrade = config.operator === '>' 
                            ? analysis.evenProb > config.threshold
                            : analysis.evenProb < config.threshold;
                        contractType = shouldTrade && config.action === 'Buy Even' ? 'DIGITEVEN' : 'DIGITODD';
                    }
                    break;
            }

            if (shouldTrade && contractType) {
                executeTrade(strategy, contractType);
            }
        } catch (error) {
            console.error(`Trading condition check error for ${strategy}:`, error);
        }
    };

    // Execute trade
    const executeTrade = async (strategy: string, contractType: string) => {
        try {
            await authorizeIfNeeded();

            const config = tradingConfigs[strategy as keyof typeof tradingConfigs];

            const tradeOption = {
                amount: config.stake,
                basis: 'stake',
                contract_type: contractType,
                currency: accountCurrency,
                duration: config.ticks,
                duration_unit: 't',
                symbol: selectedSymbol,
            };

            // Add prediction for digit-based contracts
            if (['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType)) {
                tradeOption.prediction = parseInt(barrier);
            }

            const buyRequest = tradeOptionToBuy(contractType, tradeOption);
            const { buy, error } = await apiRef.current.buy(buyRequest);

            if (error) throw error;

            setStatus(`${strategy}: Purchased ${contractType} - ${buy?.longcode || 'Contract'}`);

            // Add to transactions
            const symbolDisplay = symbols.find(s => s.symbol === selectedSymbol)?.display_name || selectedSymbol;
            transactions.onBotContractEvent({
                contract_id: buy?.contract_id,
                transaction_ids: { buy: buy?.transaction_id },
                buy_price: buy?.buy_price,
                currency: accountCurrency,
                contract_type: contractType,
                underlying: selectedSymbol,
                display_name: symbolDisplay,
                date_start: Math.floor(Date.now() / 1000),
                status: 'open',
            });

            // Update run panel
            run_panel.setHasOpenContract(true);
            run_panel.setContractStage(contract_stages.PURCHASE_SENT);

        } catch (error: any) {
            console.error(`Trade execution error for ${strategy}:`, error);
            setStatus(`${strategy} Error: ${error.message || 'Trade failed'}`);
        }
    };

    // Authorize if needed
    const authorizeIfNeeded = async () => {
        if (isAuthorized) return;

        const token = V2GetActiveToken();
        if (!token) {
            throw new Error('No token found. Please log in and select an account.');
        }

        const { authorize, error } = await apiRef.current.authorize(token);
        if (error) {
            throw new Error(`Authorization error: ${error.message || error.code}`);
        }

        setIsAuthorized(true);
        const loginid = authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');

        // Sync with stores
        try {
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch (error) {
            console.error('Store sync error:', error);
        }
    };

    // Start auto trading for a strategy
    const startAutoTrading = (strategy: string) => {
        setTradingConfigs(prev => ({
            ...prev,
            [strategy]: { ...prev[strategy as keyof typeof prev], isRunning: true }
        }));
        stopFlags.current[strategy as keyof typeof stopFlags.current] = false;

        // Update run panel
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `smart-${strategy}-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        setStatus(`${strategy}: Auto trading started`);
    };

    // Stop auto trading for a strategy
    const stopAutoTrading = (strategy: string) => {
        setTradingConfigs(prev => ({
            ...prev,
            [strategy]: { ...prev[strategy as keyof typeof prev], isRunning: false }
        }));
        stopFlags.current[strategy as keyof typeof stopFlags.current] = true;

        setStatus(`${strategy}: Auto trading stopped`);
    };

    // Update trading config
    const updateTradingConfig = (strategy: string, field: string, value: any) => {
        setTradingConfigs(prev => ({
            ...prev,
            [strategy]: { ...prev[strategy as keyof typeof prev], [field]: value }
        }));
    };

    return (
        <div className="smart-trading-analytics">
            <div className="smart-trading-analytics__header">
                <Text as="h2" size="xl" weight="bold">
                    {localize('Smart Trading Analytics')}
                </Text>
                <div className="connected-status">
                    {localize('Connected')}
                </div>
            </div>

            <div className="smart-trading-analytics__controls">
                <div className="control-group">
                    <label>{localize('Symbol:')}</label>
                    <select
                        value={selectedSymbol}
                        onChange={(e) => {
                            setSelectedSymbol(e.target.value);
                            startTickStream(e.target.value);
                        }}
                    >
                        {symbols.map(symbol => (
                            <option key={symbol.symbol} value={symbol.symbol}>
                                {symbol.display_name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="control-group">
                    <label>{localize('Tick Count:')}</label>
                    <input
                        type="number"
                        value={tickCount}
                        onChange={(e) => setTickCount(parseInt(e.target.value))}
                        min="50"
                        max="1000"
                    />
                </div>
                <div className="control-group">
                    <label>{localize('Barrier:')}</label>
                    <input
                        type="text"
                        value={barrier}
                        onChange={(e) => setBarrier(e.target.value)}
                    />
                </div>
            </div>

            <div className="smart-trading-analytics__analysis-cards">
                {/* Rise/Fall Analysis Card */}
                <div className="smart-trading-analytics__card">
                    <div className="card-header">
                        <Text as="h3" size="m" weight="bold">{localize('Rise/Fall')}</Text>
                    </div>

                    <div className="probability-bars">
                        <div className="probability-item">
                            <span className="probability-label">{localize('Rise')}</span>
                            <div className="probability-bar">
                                <div 
                                    className="probability-fill rise" 
                                    style={{ width: `${riseAnalysis.rise}%` }}
                                />
                            </div>
                            <span className="probability-value">{riseAnalysis.rise.toFixed(1)}%</span>
                        </div>
                        <div className="probability-item">
                            <span className="probability-label">{localize('Fall')}</span>
                            <div className="probability-bar">
                                <div 
                                    className="probability-fill fall" 
                                    style={{ width: `${riseAnalysis.fall}%` }}
                                />
                            </div>
                            <span className="probability-value">{riseAnalysis.fall.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div className="trading-condition">
                        <div className="condition-row">
                            <label>{localize('If')}</label>
                            <select 
                                value={tradingConfigs.risefall.condition}
                                onChange={(e) => updateTradingConfig('risefall', 'condition', e.target.value)}
                            >
                                <option value="Rise Prob">{localize('Rise Prob')}</option>
                                <option value="Fall Prob">{localize('Fall Prob')}</option>
                            </select>
                            <select
                                value={tradingConfigs.risefall.operator}
                                onChange={(e) => updateTradingConfig('risefall', 'operator', e.target.value)}
                            >
                                <option value=">">&gt;</option>
                                <option value="<">&lt;</option>
                            </select>
                            <input
                                type="number"
                                value={tradingConfigs.risefall.threshold}
                                onChange={(e) => updateTradingConfig('risefall', 'threshold', parseInt(e.target.value))}
                                min="0"
                                max="100"
                            />
                            <span>%</span>
                        </div>
                        <div className="condition-row">
                            <label>{localize('Then')}</label>
                            <select
                                value={tradingConfigs.risefall.action}
                                onChange={(e) => updateTradingConfig('risefall', 'action', e.target.value)}
                            >
                                <option value="Buy Rise">{localize('Buy Rise')}</option>
                                <option value="Buy Fall">{localize('Buy Fall')}</option>
                            </select>
                        </div>
                    </div>

                    <div className="stake-inputs">
                        <div className="input-group">
                            <label>{localize('Stake')}</label>
                            <input
                                type="number"
                                step="0.01"
                                value={tradingConfigs.risefall.stake}
                                onChange={(e) => updateTradingConfig('risefall', 'stake', parseFloat(e.target.value))}
                                min="0.35"
                            />
                        </div>
                        <div className="input-group">
                            <label>{localize('Ticks')}</label>
                            <input
                                type="number"
                                value={tradingConfigs.risefall.ticks}
                                onChange={(e) => updateTradingConfig('risefall', 'ticks', parseInt(e.target.value))}
                                min="1"
                                max="10"
                            />
                        </div>
                        <div className="input-group">
                            <label>{localize('Martingale')}</label>
                            <input
                                type="number"
                                step="0.1"
                                value={tradingConfigs.risefall.martingale}
                                onChange={(e) => updateTradingConfig('risefall', 'martingale', parseFloat(e.target.value))}
                                min="1"
                            />
                        </div>
                    </div>

                    <button
                        className={`auto-trading-button ${tradingConfigs.risefall.isRunning ? 'stop' : ''}`}
                        onClick={() => tradingConfigs.risefall.isRunning 
                            ? stopAutoTrading('risefall') 
                            : startAutoTrading('risefall')
                        }
                    >
                        {tradingConfigs.risefall.isRunning 
                            ? localize('Stop Auto Trading') 
                            : localize('Start Auto Trading')
                        }
                    </button>
                </div>

                {/* Even/Odd Analysis Card */}
                <div className="smart-trading-analytics__card">
                    <div className="card-header">
                        <Text as="h3" size="m" weight="bold">{localize('Even/Odd')}</Text>
                    </div>

                    <div className="probability-bars">
                        <div className="probability-item">
                            <span className="probability-label">{localize('Even')}</span>
                            <div className="probability-bar">
                                <div 
                                    className="probability-fill even" 
                                    style={{ width: `${evenOddAnalysis.even}%` }}
                                />
                            </div>
                            <span className="probability-value">{evenOddAnalysis.even.toFixed(1)}%</span>
                        </div>
                        <div className="probability-item">
                            <span className="probability-label">{localize('Odd')}</span>
                            <div className="probability-bar">
                                <div 
                                    className="probability-fill odd" 
                                    style={{ width: `${evenOddAnalysis.odd}%` }}
                                />
                            </div>
                            <span className="probability-value">{evenOddAnalysis.odd.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div className="trading-condition">
                        <div className="condition-row">
                            <label>{localize('If')}</label>
                            <select 
                                value={tradingConfigs.evenodd.condition}
                                onChange={(e) => updateTradingConfig('evenodd', 'condition', e.target.value)}
                            >
                                <option value="Even Prob">{localize('Even Prob')}</option>
                                <option value="Odd Prob">{localize('Odd Prob')}</option>
                            </select>
                            <select
                                value={tradingConfigs.evenodd.operator}
                                onChange={(e) => updateTradingConfig('evenodd', 'operator', e.target.value)}
                            >
                                <option value=">">&gt;</option>
                                <option value="<">&lt;</option>
                            </select>
                            <input
                                type="number"
                                value={tradingConfigs.evenodd.threshold}
                                onChange={(e) => updateTradingConfig('evenodd', 'threshold', parseInt(e.target.value))}
                                min="0"
                                max="100"
                            />
                            <span>%</span>
                        </div>
                        <div className="condition-row">
                            <label>{localize('Then')}</label>
                            <select
                                value={tradingConfigs.evenodd.action}
                                onChange={(e) => updateTradingConfig('evenodd', 'action', e.target.value)}
                            >
                                <option value="Buy Even">{localize('Buy Even')}</option>
                                <option value="Buy Odd">{localize('Buy Odd')}</option>
                            </select>
                        </div>
                    </div>

                    <div className="stake-inputs">
                        <div className="input-group">
                            <label>{localize('Stake')}</label>
                            <input
                                type="number"
                                step="0.01"
                                value={tradingConfigs.evenodd.stake}
                                onChange={(e) => updateTradingConfig('evenodd', 'stake', parseFloat(e.target.value))}
                                min="0.35"
                            />
                        </div>
                        <div className="input-group">
                            <label>{localize('Ticks')}</label>
                            <input
                                type="number"
                                value={tradingConfigs.evenodd.ticks}
                                onChange={(e) => updateTradingConfig('evenodd', 'ticks', parseInt(e.target.value))}
                                min="1"
                                max="10"
                            />
                        </div>
                        <div className="input-group">
                            <label>{localize('Martingale')}</label>
                            <input
                                type="number"
                                step="0.1"
                                value={tradingConfigs.evenodd.martingale}
                                onChange={(e) => updateTradingConfig('evenodd', 'martingale', parseFloat(e.target.value))}
                                min="1"
                            />
                        </div>
                    </div>

                    <button
                        className={`auto-trading-button ${tradingConfigs.evenodd.isRunning ? 'stop' : ''}`}
                        onClick={() => tradingConfigs.evenodd.isRunning 
                            ? stopAutoTrading('evenodd') 
                            : startAutoTrading('evenodd')
                        }
                    >
                        {tradingConfigs.evenodd.isRunning 
                            ? localize('Stop Auto Trading') 
                            : localize('Start Auto Trading')
                        }
                    </button>
                </div>

                {/* Even/Odd Pattern Analysis Card */}
                <div className="smart-trading-analytics__card">
                    <div className="card-header">
                        <Text as="h3" size="m" weight="bold">{localize('Even/Odd Pattern')}</Text>
                    </div>

                    <div className="probability-bars">
                        <div className="probability-item">
                            <span className="probability-label">{localize('Even')}</span>
                            <div className="probability-bar">
                                <div 
                                    className="probability-fill even" 
                                    style={{ width: `${evenOddAnalysis.even}%` }}
                                />
                            </div>
                            <span className="probability-value">{evenOddAnalysis.even.toFixed(1)}%</span>
                        </div>
                        <div className="probability-item">
                            <span className="probability-label">{localize('Odd')}</span>
                            <div className="probability-bar">
                                <div 
                                    className="probability-fill odd" 
                                    style={{ width: `${evenOddAnalysis.odd}%` }}
                                />
                            </div>
                            <span className="probability-value">{evenOddAnalysis.odd.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div className="pattern-display">
                        <div className="pattern-title">{localize('Last 10 Digits Pattern:')}</div>
                        <div className="digit-pattern">
                            {evenOddPattern.pattern.map((digit, index) => (
                                <div 
                                    key={index} 
                                    className={`digit ${digit % 2 === 0 ? 'even' : 'odd'}`}
                                >
                                    {digit}
                                </div>
                            ))}
                        </div>
                        <div className="streak-info">{evenOddPattern.streak}</div>
                    </div>

                    <div className="trading-condition">
                        <div className="condition-row">
                            <label>{localize('If')}</label>
                            <select 
                                value={tradingConfigs.evenoddpattern.condition}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'condition', e.target.value)}
                            >
                                <option value="Even Prob">{localize('Even Prob')}</option>
                                <option value="Odd Prob">{localize('Odd Prob')}</option>
                            </select>
                            <select
                                value={tradingConfigs.evenoddpattern.operator}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'operator', e.target.value)}
                            >
                                <option value=">">&gt;</option>
                                <option value="<">&lt;</option>
                            </select>
                            <input
                                type="number"
                                value={tradingConfigs.evenoddpattern.threshold}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'threshold', parseInt(e.target.value))}
                                min="0"
                                max="100"
                            />
                            <span>%</span>
                        </div>
                        <div className="condition-row">
                            <label>{localize('Then')}</label>
                            <select
                                value={tradingConfigs.evenoddpattern.action}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'action', e.target.value)}
                            >
                                <option value="Buy Even">{localize('Buy Even')}</option>
                                <option value="Buy Odd">{localize('Buy Odd')}</option>
                            </select>
                        </div>
                    </div>

                    <div className="stake-inputs">
                        <div className="input-group">
                            <label>{localize('Stake')}</label>
                            <input
                                type="number"
                                step="0.01"
                                value={tradingConfigs.evenoddpattern.stake}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'stake', parseFloat(e.target.value))}
                                min="0.35"
                            />
                        </div>
                        <div className="input-group">
                            <label>{localize('Ticks')}</label>
                            <input
                                type="number"
                                value={tradingConfigs.evenoddpattern.ticks}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'ticks', parseInt(e.target.value))}
                                min="1"
                                max="10"
                            />
                        </div>
                        <div className="input-group">
                            <label>{localize('Martingale')}</label>
                            <input
                                type="number"
                                step="0.1"
                                value={tradingConfigs.evenoddpattern.martingale}
                                onChange={(e) => updateTradingConfig('evenoddpattern', 'martingale', parseFloat(e.target.value))}
                                min="1"
                            />
                        </div>
                    </div>

                    <button
                        className={`auto-trading-button ${tradingConfigs.evenoddpattern.isRunning ? 'stop' : ''}`}
                        onClick={() => tradingConfigs.evenoddpattern.isRunning 
                            ? stopAutoTrading('evenoddpattern') 
                            : startAutoTrading('evenoddpattern')
                        }
                    >
                        {tradingConfigs.evenoddpattern.isRunning 
                            ? localize('Stop Auto Trading') 
                            : localize('Start Auto Trading')
                        }
                    </button>
                </div>
            </div>

            {status && (
                <div className="smart-trading-analytics__status">
                    <Text size="s" color={status.includes('Error') ? 'loss-danger' : 'prominent'}>
                        {status}
                    </Text>
                </div>
            )}
        </div>
    );
});

export default SmartTradingAnalytics;