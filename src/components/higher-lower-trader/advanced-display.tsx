
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { ProposalOpenContract } from '@deriv/api-types';
import './advanced-display.scss';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';
import { useStore } from '@/hooks/useStore';

// Symbol type for multi-symbol analysis
type SymbolType = 'R_10' | 'R_25' | 'R_50' | 'R_75' | 'R_100' | '1HZ10V' | '1HZ25V' | '1HZ50V' | '1HZ75V' | '1HZ100V';

// Trading settings interface
interface TradingSettings {
    stake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
}

// Trade result interface
interface TradeResult {
    id: number;
    contractId: number;
    type: string;
    symbol: SymbolType;
    entrySpot?: string;
    exitSpot?: string;
    stake: number;
    payout?: number;
    profit?: number;
    isWin?: boolean;
    timestamp: number;
    status?: 'open' | 'won' | 'lost' | 'pending';
}

// Constants
const STORAGE_KEYS = {
    TRADING_SETTINGS: 'trading_settings',
    TOTAL_PROFIT: 'total_profit',
    AUTH_TOKEN: 'authToken',
};

const AdvancedDisplay = observer(() => {
    // Get transactions store
    const { transactions } = useStore();

    // State
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [referenceDigit, setReferenceDigit] = useState(5);
    const [analysisCount, setAnalysisCount] = useState(120);
    const [sessionRunId, setSessionRunId] = useState<string>(`advanced_${Date.now()}`);

    // Trading settings
    const [tradingSettings, setTradingSettings] = useState<TradingSettings>(() => {
        try {
            const savedSettings = localStorage.getItem(STORAGE_KEYS.TRADING_SETTINGS);
            if (savedSettings) {
                const parsedSettings = JSON.parse(savedSettings) as TradingSettings;
                return {
                    stake: parsedSettings.stake || 1,
                    martingale: parsedSettings.martingale || 2.0,
                    takeProfit: parsedSettings.takeProfit || 10,
                    stopLoss: parsedSettings.stopLoss || 5,
                };
            }
        } catch (error) {
            console.error('Error loading trading settings from localStorage:', error);
        }

        return {
            stake: 1,
            martingale: 2.0,
            takeProfit: 10,
            stopLoss: 5,
        };
    });

    // Input states
    const [referenceDigitInput, setReferenceDigitInput] = useState('5');
    const [analysisCountInput, setAnalysisCountInput] = useState('120');
    const [stakeInput, setStakeInput] = useState('1');

    // Trade history and stats
    const [tradeHistory, setTradeHistory] = useState<TradeResult[]>([]);
    const [totalWins, setTotalWins] = useState(0);
    const [totalLosses, setTotalLosses] = useState(0);
    const [totalProfit, setTotalProfit] = useState(0);

    const tradeIdCounter = useRef(0);

    // Function to handle settings changes
    const handleSettingChange = useCallback((field: keyof TradingSettings, value: string) => {
        setTradingSettings(prev => {
            const updatedSettings = { ...prev };
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
                updatedSettings[field] = numValue;
            }

            try {
                localStorage.setItem(STORAGE_KEYS.TRADING_SETTINGS, JSON.stringify(updatedSettings));
            } catch (error) {
                console.error('Error saving trading settings to localStorage:', error);
            }

            return updatedSettings;
        });
    }, []);

    // Start/stop trading functions
    const startTrading = useCallback(() => {
        if (isRunning) return;

        setIsRunning(true);
        setStatus('Starting advanced trading analysis...');
        
        const session_id = `advanced_${Date.now()}`;
        setSessionRunId(session_id);
        globalObserver.emit('bot.started', session_id);

        // Simulate some trading activity
        setTimeout(() => {
            setStatus('Analysis complete. Ready for trading.');
        }, 2000);
    }, [isRunning]);

    const stopTrading = useCallback(() => {
        if (!isRunning) return;

        setIsRunning(false);
        setStatus('Trading stopped.');
        globalObserver.emit('bot.stop');
    }, [isRunning]);

    // Format money function
    const formatMoney = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(Math.abs(amount));
    };

    return (
        <div className="advanced-display">
            <div className="advanced-display__title">
                Advanced Trading Display
            </div>

            <div className="advanced-display__subtitle">
                AI-Powered Market Analysis & Trading
            </div>

            <div className="advanced-display__workspace">
                <div className="advanced-display__action-bar">
                    <div className="action-buttons-group">
                        <button 
                            className={`action-button ${isRunning ? 'active' : ''}`}
                            onClick={isRunning ? stopTrading : startTrading}
                        >
                            {isRunning ? 'Stop Analysis' : 'Start Analysis'}
                        </button>
                    </div>
                </div>

                <div className="settings-panel">
                    <div className="setting-group">
                        <label>Reference Digit:</label>
                        <input
                            type="number"
                            value={referenceDigitInput}
                            onChange={(e) => {
                                setReferenceDigitInput(e.target.value);
                                const num = parseInt(e.target.value);
                                if (!isNaN(num) && num >= 0 && num <= 9) {
                                    setReferenceDigit(num);
                                }
                            }}
                            min="0"
                            max="9"
                            className="setting-input"
                        />
                    </div>
                    
                    <div className="setting-group">
                        <label>Analysis Count:</label>
                        <input
                            type="number"
                            value={analysisCountInput}
                            onChange={(e) => {
                                setAnalysisCountInput(e.target.value);
                                const num = parseInt(e.target.value);
                                if (!isNaN(num) && num > 0) {
                                    setAnalysisCount(num);
                                }
                            }}
                            min="1"
                            className="setting-input"
                        />
                    </div>

                    <div className="setting-group">
                        <label>Stake ($):</label>
                        <input
                            type="number"
                            value={stakeInput}
                            onChange={(e) => {
                                setStakeInput(e.target.value);
                                handleSettingChange('stake', e.target.value);
                            }}
                            min="0.35"
                            step="0.01"
                            className="setting-input"
                        />
                    </div>

                    <div className="setting-group">
                        <label>Martingale:</label>
                        <input
                            type="number"
                            value={tradingSettings.martingale}
                            onChange={(e) => handleSettingChange('martingale', e.target.value)}
                            min="1"
                            step="0.1"
                            className="setting-input"
                        />
                    </div>
                </div>

                <div className="trade-history-summary">
                    <div className="summary-item wins">
                        <span>Wins</span>
                        <span>{totalWins}</span>
                    </div>
                    <div className="summary-item losses">
                        <span>Losses</span>
                        <span>{totalLosses}</span>
                    </div>
                    <div className="summary-item profit">
                        <span>Total Profit</span>
                        <span className={totalProfit >= 0 ? 'positive' : 'negative'}>
                            {formatMoney(totalProfit)}
                        </span>
                    </div>
                </div>
            </div>

            {status && (
                <div className={classNames('advanced-display__status', {
                    'advanced-display__status--success': status.includes('complete') || status.includes('Ready'),
                    'advanced-display__status--info': status.includes('Starting') || status.includes('Analysis'),
                    'advanced-display__status--error': status.includes('stopped') || status.includes('Error')
                })}>
                    {status}
                </div>
            )}
        </div>
    );
});

export default AdvancedDisplay;
