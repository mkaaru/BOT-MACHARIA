
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './ml-trader.scss';

// Minimal trade types we will support initially
const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
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
    if (trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    return buy;
};

const MLTrader = observer(() => {
    const { client } = useStore();
    
    // Trading configuration state
    const [selectedVolatility, setSelectedVolatility] = useState('R_10');
    const [selectedTradeType, setSelectedTradeType] = useState('DIGITOVER');
    const [durationType, setDurationType] = useState('t');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState(0.5);
    const [overPrediction, setOverPrediction] = useState(5);
    const [underPrediction, setUnderPrediction] = useState(5);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1);
    
    // Trading state
    const [isTrading, setIsTrading] = useState(false);
    const [ticksProcessed, setTicksProcessed] = useState(0);
    const [lastDigit, setLastDigit] = useState('-');
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');
    const [statusMessage, setStatusMessage] = useState('Loading historical data for all volatilities...');
    
    const derivApiRef = useRef<any>(null);

    // Initialize connection
    useEffect(() => {
        const initConnection = async () => {
            try {
                const token = V2GetActiveToken();
                if (!token) {
                    setStatusMessage('No authentication token found. Please login first.');
                    return;
                }

                const api = generateDerivApiInstance();
                const authResult = await api.authorize(token);
                
                if (authResult.error) {
                    setStatusMessage(`Authorization failed: ${authResult.error.message}`);
                    return;
                }

                derivApiRef.current = api;
                setConnectionStatus('Connected');
                setStatusMessage('Ready to start trading');
            } catch (error: any) {
                setConnectionStatus('Error');
                setStatusMessage(`Connection failed: ${error.message}`);
            }
        };

        initConnection();

        return () => {
            if (derivApiRef.current) {
                try {
                    derivApiRef.current.disconnect();
                } catch (error) {
                    console.warn('Error disconnecting:', error);
                }
            }
        };
    }, []);

    // Start trading handler
    const handleStartTrading = useCallback(async () => {
        if (!derivApiRef.current) {
            setStatusMessage('No connection available');
            return;
        }

        setIsTrading(true);
        setStatusMessage('Trading started...');

        try {
            // Subscribe to ticks for the selected volatility
            const tickResponse = await derivApiRef.current.send({
                ticks: selectedVolatility,
                subscribe: 1
            });

            if (tickResponse.error) {
                throw new Error(`Tick subscription failed: ${tickResponse.error.message}`);
            }

            // Set up tick handler
            derivApiRef.current.connection.addEventListener('message', handleTickMessage);
        } catch (error: any) {
            setIsTrading(false);
            setStatusMessage(`Error starting trading: ${error.message}`);
        }
    }, [selectedVolatility]);

    // Handle incoming tick messages
    const handleTickMessage = useCallback((event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            if (data.msg_type === 'tick' && data.tick) {
                const quote = parseFloat(data.tick.quote);
                const digit = Math.floor((quote * 10000) % 10);
                
                setLastDigit(digit.toString());
                setTicksProcessed(prev => prev + 1);
                
                // Simple trading logic based on selected trade type
                if (shouldPlaceTrade(digit)) {
                    placeTrade();
                }
            }
        } catch (error) {
            console.warn('Error parsing tick data:', error);
        }
    }, [selectedTradeType, overPrediction, underPrediction]);

    // Trading logic
    const shouldPlaceTrade = (digit: number): boolean => {
        switch (selectedTradeType) {
            case 'DIGITOVER':
                return digit > overPrediction;
            case 'DIGITUNDER':
                return digit < underPrediction;
            case 'DIGITEVEN':
                return digit % 2 === 0;
            case 'DIGITODD':
                return digit % 2 === 1;
            default:
                return false;
        }
    };

    // Place trade
    const placeTrade = useCallback(async () => {
        if (!derivApiRef.current) return;

        try {
            const tradeParams = tradeOptionToBuy(selectedTradeType, {
                amount: stake,
                basis: 'stake',
                currency: client.currency || 'USD',
                duration: duration,
                duration_unit: durationType,
                symbol: selectedVolatility,
                prediction: selectedTradeType.includes('OVER') ? overPrediction : underPrediction
            });

            const buyResponse = await derivApiRef.current.send(tradeParams);
            
            if (buyResponse.error) {
                console.error('Trade failed:', buyResponse.error.message);
            } else {
                console.log('Trade placed:', buyResponse.buy.contract_id);
            }
        } catch (error: any) {
            console.error('Error placing trade:', error.message);
        }
    }, [selectedTradeType, stake, duration, durationType, selectedVolatility, overPrediction, underPrediction, client.currency]);

    // Stop trading
    const handleStopTrading = () => {
        setIsTrading(false);
        setStatusMessage('Trading stopped');
        
        if (derivApiRef.current?.connection) {
            derivApiRef.current.connection.removeEventListener('message', handleTickMessage);
        }
    };

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
                                        onChange={(e) => setSelectedVolatility(e.target.value)}
                                        disabled={isTrading}
                                    >
                                        {VOLATILITY_INDICES.map(item => (
                                            <option key={item.value} value={item.value}>
                                                {item.label}
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
                                        <option value="t">{localize('Ticks')}</option>
                                        <option value="s">{localize('Seconds')}</option>
                                        <option value="m">{localize('Minutes')}</option>
                                    </select>
                                </div>
                                
                                <div className='ml-trader__field'>
                                    <label>{localize('Duration')}</label>
                                    <input
                                        type='number'
                                        min='1'
                                        max='10'
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
                                
                                <div className='ml-trader__predictions'>
                                    <div className='ml-trader__field'>
                                        <label>{localize('Over/Under prediction (pre-loss)')}</label>
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
                                        <label>{localize('Over/Under prediction (after loss)')}</label>
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
                            </div>
                        </div>

                        {/* Status Section */}
                        <div className='ml-trader__status'>
                            <div className='ml-trader__status-row'>
                                <Text size='s'>
                                    {localize('Ticks Processed')}: {ticksProcessed}
                                </Text>
                                <Text size='s'>
                                    {localize('Last Digit')}: {lastDigit}
                                </Text>
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
                </div>
            </div>
        </div>
    );
});

export default MLTrader;
