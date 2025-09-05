
import { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { Button } from '@deriv-com/ui';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import { doUntilDone } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import './speed-bot-display.scss';

// Available symbols and their display names
const AVAILABLE_SYMBOLS = [
    // Volatility Indices
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    
    // 1-Second Volatility Indices
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
];

// Available contract types
const CONTRACT_TYPES = [
    { value: 'CALLE', label: 'Rise', description: 'Price will be higher than entry spot' },
    { value: 'PUTE', label: 'Fall', description: 'Price will be lower than entry spot' },
    { value: 'DIGITEVEN', label: 'Even', description: 'Last digit will be even (0,2,4,6,8)' },
    { value: 'DIGITODD', label: 'Odd', description: 'Last digit will be odd (1,3,5,7,9)' },
    { value: 'DIGITOVER', label: 'Over', description: 'Last digit will be over selected barrier' },
    { value: 'DIGITUNDER', label: 'Under', description: 'Last digit will be under selected barrier' },
];

const SpeedBotDisplay = observer(() => {
    const { run_panel, transactions } = useStore();
    
    // Trading configuration state
    const [selectedSymbol, setSelectedSymbol] = useState('R_100');
    const [selectedContractType, setSelectedContractType] = useState('CALLE');
    const [currentPrice, setCurrentPrice] = useState('Loading...');
    const [numberOfTicks, setNumberOfTicks] = useState<number | ''>('');
    const [stake, setStake] = useState<number | ''>('');
    const [numberOfTrades, setNumberOfTrades] = useState<number | ''>('');
    const [barrier, setBarrier] = useState<number | ''>('');
    const [tradeEachTick, setTradeEachTick] = useState(false);
    
    // Trading state
    const [isTrading, setIsTrading] = useState(false);
    const [tradesExecuted, setTradesExecuted] = useState(0);
    const [isConnected, setIsConnected] = useState(false);
    
    const [tradeResults, setTradeResults] = useState<any[]>([]);
    
    // Initialize with default values
    useEffect(() => {
        if (numberOfTicks === '') {
            setNumberOfTicks(1);
        }
        if (stake === '') {
            setStake(1.00);
        }
        if (numberOfTrades === '') {
            setNumberOfTrades(1);
        }
        if (barrier === '') {
            setBarrier(5);
        }
    }, []);

    return (
        <div className="speed-bot-display">
            <div className="speed-bot-container">
                <div className="trading-config-card">
                    <div className="config-header">
                        <h3>Speed Bot Configuration</h3>
                        <div className="trading-mode-selector">
                            <div className="mode-label">Trading Mode</div>
                            <div className="toggle-container">
                                <div className="mode-option active">Manual</div>
                                <div className="toggle-wrapper">
                                    <input 
                                        type="checkbox" 
                                        className="toggle-input"
                                        checked={tradeEachTick}
                                        onChange={(e) => setTradeEachTick(e.target.checked)}
                                    />
                                    <div className="toggle-track">
                                        <div className="toggle-thumb"></div>
                                    </div>
                                </div>
                                <div className="mode-option">Auto</div>
                            </div>
                            <div className="mode-description">
                                {tradeEachTick ? 'Automatically trade on every tick' : 'Execute specified number of trades'}
                            </div>
                        </div>
                    </div>

                    <div className="config-row">
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Symbol</label>
                                <select 
                                    className="config-select"
                                    value={selectedSymbol}
                                    onChange={(e) => setSelectedSymbol(e.target.value)}
                                >
                                    {AVAILABLE_SYMBOLS.map(symbol => (
                                        <option key={symbol.value} value={symbol.value}>
                                            {symbol.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Contract Type</label>
                                <select 
                                    className="config-select"
                                    value={selectedContractType}
                                    onChange={(e) => setSelectedContractType(e.target.value)}
                                >
                                    {CONTRACT_TYPES.map(contract => (
                                        <option key={contract.value} value={contract.value}>
                                            {contract.label}
                                        </option>
                                    ))}
                                </select>
                                <div className="contract-description">
                                    {CONTRACT_TYPES.find(ct => ct.value === selectedContractType)?.description}
                                </div>
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Current Price</label>
                                <div className={`price-display ${isConnected ? 'connected' : 'disconnected'}`}>
                                    {currentPrice}
                                    <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                                        {isConnected ? '●' : '○'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="config-row">
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Number of Ticks</label>
                                <input 
                                    type="number"
                                    className="config-input"
                                    value={numberOfTicks}
                                    onChange={(e) => setNumberOfTicks(e.target.value === '' ? '' : parseInt(e.target.value))}
                                    min="1"
                                />
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Stake Amount (USD)</label>
                                <input 
                                    type="number"
                                    className="config-input"
                                    step="0.01"
                                    value={stake}
                                    onChange={(e) => setStake(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                    min="0.01"
                                />
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Number of Trades</label>
                                <input 
                                    type="number"
                                    className="config-input"
                                    value={numberOfTrades}
                                    onChange={(e) => setNumberOfTrades(e.target.value === '' ? '' : parseInt(e.target.value))}
                                    min="1"
                                    disabled={tradeEachTick}
                                />
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="config-group">
                                <label>Barrier (for Over/Under)</label>
                                <input 
                                    type="number"
                                    className="config-input"
                                    value={barrier}
                                    onChange={(e) => setBarrier(e.target.value === '' ? '' : parseInt(e.target.value))}
                                    min="0"
                                    max="9"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="execute-section">
                        <button 
                            className={`execute-button ${isTrading ? 'stop-button' : 'start-button'}`}
                            onClick={() => setIsTrading(!isTrading)}
                        >
                            {isTrading ? 'Stop Trading' : 'Start Trading'}
                        </button>
                        {isTrading && (
                            <div className="trading-progress">
                                Trading in progress... ({tradesExecuted} trades executed)
                            </div>
                        )}
                    </div>
                </div>

                <div className="results-card">
                    <h3>Trading Results</h3>
                    <div className="results-stats">
                        <div>Trades Executed: {tradesExecuted}</div>
                        <div>Success Rate: {tradeResults.length > 0 ? 
                            Math.round(tradeResults.filter(r => r.success).length / tradeResults.length * 100) : 0}%</div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default SpeedBotDisplay;
