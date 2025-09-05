import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import '../smart-trader/smart-trader.scss';

const SmartTradingDisplay = observer(() => {
    const [selectedStrategy, setSelectedStrategy] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [startAmount, setStartAmount] = useState(1.0);
    const [maxLoss, setMaxLoss] = useState(100);
    const [maxProfit, setMaxProfit] = useState(100);
    const [duration, setDuration] = useState(5);
    const [symbol, setSymbol] = useState('R_100');
    const [contractType, setContractType] = useState('CALL');
    const [barrier, setBarrier] = useState('');
    const [prediction, setPrediction] = useState('');
    const [predictionDigits, setPredictionDigits] = useState(Array(5).fill(''));

    const strategiesRef = useRef(null);

    // Strategy definitions
    const strategies = [
        { id: 'martingale', name: 'Martingale', description: 'Double stake after loss' },
        { id: 'anti-martingale', name: 'Anti-Martingale', description: 'Double stake after win' },
        { id: 'fibonacci', name: 'Fibonacci', description: 'Follow Fibonacci sequence' },
        { id: 'dalembert', name: "D'Alembert", description: 'Increase stake by fixed amount after loss' },
        { id: 'oscar-grind', name: "Oscar's Grind", description: 'Progressive betting system' }
    ];

    const symbols = [
        { value: 'R_10', label: 'Volatility 10 Index' },
        { value: 'R_25', label: 'Volatility 25 Index' },
        { value: 'R_50', label: 'Volatility 50 Index' },
        { value: 'R_75', label: 'Volatility 75 Index' },
        { value: 'R_100', label: 'Volatility 100 Index' }
    ];

    const contractTypes = [
        { value: 'CALL', label: 'Rise' },
        { value: 'PUT', label: 'Fall' },
        { value: 'DIGITEVEN', label: 'Even' },
        { value: 'DIGITODD', label: 'Odd' },
        { value: 'DIGITOVER', label: 'Over' },
        { value: 'DIGITUNDER', label: 'Under' },
        { value: 'DIGITMATCH', label: 'Matches' },
        { value: 'DIGITDIFF', label: 'Differs' }
    ];

    const handleStrategySelect = useCallback((strategyId) => {
        setSelectedStrategy(strategyId);
    }, []);

    const handleRun = useCallback(() => {
        if (!selectedStrategy) {
            alert('Please select a strategy');
            return;
        }
        setIsRunning(true);
        console.log('Starting strategy:', selectedStrategy);
    }, [selectedStrategy]);

    const handleStop = useCallback(() => {
        setIsRunning(false);
        console.log('Stopping strategy');
    }, []);

    const handleDigitChange = useCallback((index, value) => {
        const newDigits = [...predictionDigits];
        newDigits[index] = value;
        setPredictionDigits(newDigits);
    }, [predictionDigits]);

    const renderStrategyCards = () => {
        return strategies.map((strategy) => (
            <div
                key={strategy.id}
                className={`smart-trader__card ${selectedStrategy === strategy.id ? 'selected' : ''}`}
                onClick={() => handleStrategySelect(strategy.id)}
                style={{ cursor: 'pointer', marginBottom: '1rem' }}
            >
                <Text size="s" weight="bold">{strategy.name}</Text>
                <Text size="xs" color="less-prominent">{strategy.description}</Text>
            </div>
        ));
    };

    const renderTradeParameters = () => {
        return (
            <div className="smart-trader__card">
                <Text size="m" weight="bold" className="smart-trader__header">
                    {localize('Trade Parameters')}
                </Text>

                <div className="smart-trader__row">
                    <div className="smart-trader__field">
                        <label>{localize('Symbol')}</label>
                        <select
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                        >
                            {symbols.map((sym) => (
                                <option key={sym.value} value={sym.value}>
                                    {sym.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="smart-trader__field">
                        <label>{localize('Contract Type')}</label>
                        <select
                            value={contractType}
                            onChange={(e) => setContractType(e.target.value)}
                        >
                            {contractTypes.map((type) => (
                                <option key={type.value} value={type.value}>
                                    {type.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="smart-trader__field">
                        <label>{localize('Duration (ticks)')}</label>
                        <input
                            type="number"
                            value={duration}
                            onChange={(e) => setDuration(Number(e.target.value))}
                            min="1"
                            max="10"
                        />
                    </div>
                </div>

                <div className="smart-trader__row">
                    <div className="smart-trader__field">
                        <label>{localize('Start Amount')}</label>
                        <input
                            type="number"
                            value={startAmount}
                            onChange={(e) => setStartAmount(Number(e.target.value))}
                            min="1"
                            step="0.01"
                        />
                    </div>

                    <div className="smart-trader__field">
                        <label>{localize('Max Loss')}</label>
                        <input
                            type="number"
                            value={maxLoss}
                            onChange={(e) => setMaxLoss(Number(e.target.value))}
                            min="1"
                        />
                    </div>

                    <div className="smart-trader__field">
                        <label>{localize('Max Profit')}</label>
                        <input
                            type="number"
                            value={maxProfit}
                            onChange={(e) => setMaxProfit(Number(e.target.value))}
                            min="1"
                        />
                    </div>
                </div>

                {(contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') && (
                    <div className="smart-trader__row--two">
                        <div className="smart-trader__field">
                            <label>{localize('Barrier')}</label>
                            <input
                                type="number"
                                value={barrier}
                                onChange={(e) => setBarrier(e.target.value)}
                                min="0"
                                max="9"
                            />
                        </div>
                    </div>
                )}

                {(contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') && (
                    <div className="smart-trader__row--two">
                        <div className="smart-trader__field">
                            <label>{localize('Prediction')}</label>
                            <input
                                type="number"
                                value={prediction}
                                onChange={(e) => setPrediction(e.target.value)}
                                min="0"
                                max="9"
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderPredictionDigits = () => {
        return (
            <div className="smart-trader__card">
                <Text size="m" weight="bold" className="smart-trader__header">
                    {localize('Last 5 Digits Prediction')}
                </Text>

                <div className="smart-trader__digits">
                    {predictionDigits.map((digit, index) => (
                        <div key={index} className="smart-trader__digit">
                            <input
                                type="number"
                                value={digit}
                                onChange={(e) => handleDigitChange(index, e.target.value)}
                                min="0"
                                max="9"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    border: 'none',
                                    background: 'transparent',
                                    textAlign: 'center',
                                    fontSize: '1.4rem',
                                    fontWeight: '800'
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="smart-trader">
            <div className="smart-trader__container">
                <div className="smart-trader__header">
                    <Text size="l" weight="bold">
                        {localize('Smart Trading Strategies')}
                    </Text>
                    <Text size="s" color="less-prominent">
                        {localize('AI-powered trading strategies for automated trading')}
                    </Text>
                </div>

                <div className="smart-trader__content">
                    <div style={{ width: '100%' }}>
                        <Text size="m" weight="bold" style={{ marginBottom: '1rem' }}>
                            {localize('Select Strategy')}
                        </Text>

                        <div ref={strategiesRef}>
                            {renderStrategyCards()}
                        </div>

                        {selectedStrategy && (
                            <>
                                {renderTradeParameters()}
                                {renderPredictionDigits()}

                                <div className="smart-trader__actions">
                                    {!isRunning ? (
                                        <button
                                            className="smart-trader__run"
                                            onClick={handleRun}
                                            disabled={!selectedStrategy}
                                        >
                                            {localize('Start Trading')}
                                        </button>
                                    ) : (
                                        <button
                                            className="smart-trader__stop"
                                            onClick={handleStop}
                                        >
                                            {localize('Stop Trading')}
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default SmartTradingDisplay;