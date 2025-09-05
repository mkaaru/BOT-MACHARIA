
import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import { Text } from '@deriv-com/ui';
import './auto-trader.scss';

interface Strategy {
    id: string;
    name: string;
    status: 'running' | 'stopped';
    profit: number;
    trades: number;
}

const AutoTrader = observer(() => {
    const { localize } = useTranslations();
    const store = useStore();
    
    const [strategies, setStrategies] = useState<Strategy[]>([
        { id: '1', name: 'Martingale Strategy', status: 'stopped', profit: 0, trades: 0 },
        { id: '2', name: 'D\'Alembert Strategy', status: 'stopped', profit: 0, trades: 0 },
        { id: '3', name: 'Anti-Martingale', status: 'stopped', profit: 0, trades: 0 },
    ]);
    
    const [selectedStrategy, setSelectedStrategy] = useState<string>('1');
    const [isRunning, setIsRunning] = useState(false);
    const [stake, setStake] = useState('1');
    const [duration, setDuration] = useState('5');
    const [tradeType, setTradeType] = useState('callput');
    const [symbol, setSymbol] = useState('R_10');
    const [status, setStatus] = useState<string>('');
    
    // Auto trading settings
    const [autoStopLoss, setAutoStopLoss] = useState('10');
    const [autoTakeProfit, setAutoTakeProfit] = useState('20');
    const [maxTrades, setMaxTrades] = useState('100');
    const [enableAutoStop, setEnableAutoStop] = useState(true);

    if (!store) return null;
    const { is_logged_in } = store.client;

    const handleStartAuto = () => {
        if (!is_logged_in) {
            setStatus('Please log in to start auto trading');
            return;
        }
        
        setIsRunning(true);
        setStatus('Auto trading started successfully');
        
        // Update strategy status
        setStrategies(prev => 
            prev.map(strategy => 
                strategy.id === selectedStrategy 
                    ? { ...strategy, status: 'running' as const }
                    : strategy
            )
        );
    };

    const handleStopAuto = () => {
        setIsRunning(false);
        setStatus('Auto trading stopped');
        
        // Update all strategies to stopped
        setStrategies(prev => 
            prev.map(strategy => ({ ...strategy, status: 'stopped' as const }))
        );
    };

    const handleStrategySelect = (strategyId: string) => {
        if (!isRunning) {
            setSelectedStrategy(strategyId);
        }
    };

    return (
        <div className='auto-trader'>
            <div className='auto-trader__header'>
                <h2>{localize('Auto Trading')}</h2>
            </div>
            
            <div className='auto-trader__content'>
                <div className='auto-trader__section'>
                    <h3>{localize('Trading Parameters')}</h3>
                    
                    <div className='auto-trader__field'>
                        <label htmlFor='symbol'>{localize('Market')}</label>
                        <select 
                            id='symbol' 
                            value={symbol} 
                            onChange={(e) => setSymbol(e.target.value)}
                            disabled={isRunning}
                        >
                            <option value='R_10'>{localize('Volatility 10 Index')}</option>
                            <option value='R_25'>{localize('Volatility 25 Index')}</option>
                            <option value='R_50'>{localize('Volatility 50 Index')}</option>
                            <option value='R_75'>{localize('Volatility 75 Index')}</option>
                            <option value='R_100'>{localize('Volatility 100 Index')}</option>
                        </select>
                    </div>

                    <div className='auto-trader__field'>
                        <label htmlFor='trade-type'>{localize('Trade Type')}</label>
                        <select 
                            id='trade-type' 
                            value={tradeType} 
                            onChange={(e) => setTradeType(e.target.value)}
                            disabled={isRunning}
                        >
                            <option value='callput'>{localize('Rise/Fall')}</option>
                            <option value='evenodd'>{localize('Even/Odd')}</option>
                            <option value='overunder'>{localize('Over/Under')}</option>
                            <option value='matchesdiffers'>{localize('Matches/Differs')}</option>
                        </select>
                    </div>

                    <div className='auto-trader__field'>
                        <label htmlFor='stake'>{localize('Stake Amount')}</label>
                        <input
                            id='stake'
                            type='number'
                            value={stake}
                            onChange={(e) => setStake(e.target.value)}
                            min='0.35'
                            step='0.01'
                            disabled={isRunning}
                        />
                    </div>

                    <div className='auto-trader__field'>
                        <label htmlFor='duration'>{localize('Duration (ticks)')}</label>
                        <input
                            id='duration'
                            type='number'
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                            min='1'
                            max='10'
                            disabled={isRunning}
                        />
                    </div>
                </div>

                <div className='auto-trader__section'>
                    <h3>{localize('Auto Trading Settings')}</h3>
                    
                    <div className='auto-trader__field'>
                        <label>
                            <input
                                type='checkbox'
                                checked={enableAutoStop}
                                onChange={(e) => setEnableAutoStop(e.target.checked)}
                                disabled={isRunning}
                            />
                            {localize('Enable Auto Stop')}
                        </label>
                    </div>

                    {enableAutoStop && (
                        <>
                            <div className='auto-trader__field'>
                                <label htmlFor='stop-loss'>{localize('Stop Loss')}</label>
                                <input
                                    id='stop-loss'
                                    type='number'
                                    value={autoStopLoss}
                                    onChange={(e) => setAutoStopLoss(e.target.value)}
                                    min='1'
                                    disabled={isRunning}
                                />
                            </div>

                            <div className='auto-trader__field'>
                                <label htmlFor='take-profit'>{localize('Take Profit')}</label>
                                <input
                                    id='take-profit'
                                    type='number'
                                    value={autoTakeProfit}
                                    onChange={(e) => setAutoTakeProfit(e.target.value)}
                                    min='1'
                                    disabled={isRunning}
                                />
                            </div>

                            <div className='auto-trader__field'>
                                <label htmlFor='max-trades'>{localize('Max Trades')}</label>
                                <input
                                    id='max-trades'
                                    type='number'
                                    value={maxTrades}
                                    onChange={(e) => setMaxTrades(e.target.value)}
                                    min='1'
                                    disabled={isRunning}
                                />
                            </div>
                        </>
                    )}

                    <div className='auto-trader__controls'>
                        {!isRunning ? (
                            <button 
                                className='primary' 
                                onClick={handleStartAuto}
                                disabled={!is_logged_in}
                            >
                                {localize('Start Auto Trading')}
                            </button>
                        ) : (
                            <button className='danger' onClick={handleStopAuto}>
                                {localize('Stop Auto Trading')}
                            </button>
                        )}
                    </div>

                    {status && (
                        <div className={`auto-trader__status auto-trader__status--${
                            status.includes('error') || status.includes('stopped') ? 'error' : 
                            status.includes('started') || status.includes('success') ? 'success' : 'info'
                        }`}>
                            <Text size='xs'>{status}</Text>
                        </div>
                    )}
                </div>
            </div>

            <div className='auto-trader__section'>
                <h3>{localize('Trading Strategies')}</h3>
                <div className='auto-trader__strategy-list'>
                    {strategies.map((strategy) => (
                        <div 
                            key={strategy.id}
                            className={`strategy-item ${selectedStrategy === strategy.id ? 'active' : ''}`}
                            onClick={() => handleStrategySelect(strategy.id)}
                            style={{ cursor: isRunning ? 'not-allowed' : 'pointer' }}
                        >
                            <div>
                                <div className='strategy-name'>{strategy.name}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-less-prominent)' }}>
                                    {localize('Profit')}: ${strategy.profit.toFixed(2)} | {localize('Trades')}: {strategy.trades}
                                </div>
                            </div>
                            <span className={`strategy-status ${strategy.status}`}>
                                {strategy.status === 'running' ? localize('Running') : localize('Stopped')}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default AutoTrader;
