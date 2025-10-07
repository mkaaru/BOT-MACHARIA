import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { mlAutoTrader, AutoTradeConfig, AutoTradeStats, AutoTradeResult } from '@/services/ml-auto-trader';
import './auto-trade-panel.scss';

interface AutoTradePanelProps {
    onConfigChange?: (config: AutoTradeConfig) => void;
}

export const AutoTradePanel = observer(({ onConfigChange }: AutoTradePanelProps) => {
    const [config, setConfig] = useState<AutoTradeConfig>(mlAutoTrader.getConfig());
    const [stats, setStats] = useState<AutoTradeStats>(mlAutoTrader.getStats());
    const [trade_history, setTradeHistory] = useState<AutoTradeResult[]>([]);
    const [active_contracts, setActiveContracts] = useState<AutoTradeResult[]>([]);
    const [status_message, setStatusMessage] = useState<string>('Auto-trader ready');
    const [show_settings, setShowSettings] = useState(false);

    useEffect(() => {
        mlAutoTrader.onStatusUpdate((status) => {
            setStatusMessage(status);
        });

        mlAutoTrader.onStatsUpdate((newStats) => {
            setStats(newStats);
        });

        mlAutoTrader.onTradeComplete((trade) => {
            setTradeHistory(mlAutoTrader.getTradeHistory());
        });

        const interval = setInterval(() => {
            setActiveContracts(mlAutoTrader.getActiveContracts());
            setTradeHistory(mlAutoTrader.getTradeHistory());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const handleToggleAutoTrade = () => {
        if (config.enabled) {
            mlAutoTrader.disable();
        } else {
            mlAutoTrader.enable();
        }
        setConfig(mlAutoTrader.getConfig());
    };

    const handleConfigUpdate = (key: keyof AutoTradeConfig, value: any) => {
        const newConfig = { ...config, [key]: value };
        setConfig(newConfig);
        mlAutoTrader.configure(newConfig);
        if (onConfigChange) {
            onConfigChange(newConfig);
        }
    };

    const handleReset = () => {
        if (window.confirm('Reset all auto-trade statistics? This cannot be undone.')) {
            mlAutoTrader.reset();
            setStats(mlAutoTrader.getStats());
            setTradeHistory([]);
            setActiveContracts([]);
        }
    };

    const formatProfit = (profit: number) => {
        const sign = profit >= 0 ? '+' : '';
        const color = profit >= 0 ? 'text-profit-success' : 'text-loss-danger';
        return <span className={color}>{sign}{profit.toFixed(2)}</span>;
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    };

    return (
        <div className="auto-trade-panel">
            <div className="auto-trade-panel__header">
                <div className="auto-trade-panel__title">
                    <Text size="sm" weight="bold">
                        {localize('🤖 Automated Trading System')}
                    </Text>
                    <div className={`auto-trade-panel__status ${config.enabled ? 'active' : 'inactive'}`}>
                        {config.enabled ? '● ACTIVE' : '○ INACTIVE'}
                    </div>
                </div>

                <div className="auto-trade-panel__controls">
                    <button
                        className={`auto-trade-panel__toggle ${config.enabled ? 'active' : ''}`}
                        onClick={handleToggleAutoTrade}
                    >
                        {config.enabled ? '⏸ Stop Auto-Trade' : '▶ Start Auto-Trade'}
                    </button>
                    <button
                        className="auto-trade-panel__settings-btn"
                        onClick={() => setShowSettings(!show_settings)}
                    >
                        ⚙ {show_settings ? 'Hide' : 'Settings'}
                    </button>
                    <button
                        className="auto-trade-panel__reset-btn"
                        onClick={handleReset}
                    >
                        🔄 Reset
                    </button>
                </div>
            </div>

            <div className="auto-trade-panel__status-bar">
                <Text size="xs">{status_message}</Text>
            </div>

            {show_settings && (
                <div className="auto-trade-panel__settings">
                    <div className="setting-row">
                        <label>Stake Amount:</label>
                        <input
                            type="number"
                            min="0.35"
                            step="0.5"
                            value={config.stake_amount}
                            onChange={(e) => handleConfigUpdate('stake_amount', parseFloat(e.target.value))}
                            disabled={config.enabled}
                        />
                    </div>
                    <div className="setting-row">
                        <label>Min Confidence %:</label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={config.min_confidence}
                            onChange={(e) => handleConfigUpdate('min_confidence', parseInt(e.target.value))}
                        />
                    </div>
                    <div className="setting-row">
                        <label>Max Trades/Hour:</label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={config.max_trades_per_hour}
                            onChange={(e) => handleConfigUpdate('max_trades_per_hour', parseInt(e.target.value))}
                        />
                    </div>
                    <div className="setting-row">
                        <label>Cooldown (seconds):</label>
                        <input
                            type="number"
                            min="0"
                            max="300"
                            value={config.cooldown_period_seconds}
                            onChange={(e) => handleConfigUpdate('cooldown_period_seconds', parseInt(e.target.value))}
                        />
                    </div>
                    <div className="setting-row">
                        <label>Stop Loss ($):</label>
                        <input
                            type="number"
                            value={config.stop_loss_threshold}
                            onChange={(e) => handleConfigUpdate('stop_loss_threshold', parseFloat(e.target.value))}
                        />
                    </div>
                    <div className="setting-row">
                        <label>Take Profit ($):</label>
                        <input
                            type="number"
                            value={config.take_profit_threshold}
                            onChange={(e) => handleConfigUpdate('take_profit_threshold', parseFloat(e.target.value))}
                        />
                    </div>
                </div>
            )}

            <div className="auto-trade-panel__stats">
                <div className="stat-card">
                    <div className="stat-label">Total Trades</div>
                    <div className="stat-value">{stats.total_trades}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Win Rate</div>
                    <div className="stat-value" style={{ color: stats.win_rate >= 50 ? '#4CAF50' : '#f44336' }}>
                        {stats.win_rate.toFixed(1)}%
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total P/L</div>
                    <div className="stat-value">{formatProfit(stats.total_profit)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Avg P/L</div>
                    <div className="stat-value">{formatProfit(stats.avg_profit)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Active</div>
                    <div className="stat-value">{stats.active_trades}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">This Hour</div>
                    <div className="stat-value">{stats.trades_this_hour}/{config.max_trades_per_hour}</div>
                </div>
            </div>

            {active_contracts.length > 0 && (
                <div className="auto-trade-panel__active">
                    <Text size="sm" weight="bold" className="section-title">
                        {localize('Active Contracts')}
                    </Text>
                    <div className="active-contracts-list">
                        {active_contracts.map((trade) => (
                            <div key={trade.contract_id} className="active-contract-card">
                                <div className="contract-header">
                                    <span className={`contract-type ${trade.contract_type.toLowerCase()}`}>
                                        {trade.contract_type === 'CALL' ? '📈 RISE' : '📉 FALL'}
                                    </span>
                                    <span className="contract-symbol">{trade.symbol}</span>
                                </div>
                                <div className="contract-details">
                                    <div>Stake: ${trade.stake.toFixed(2)}</div>
                                    <div>Entry: {trade.entry_price.toFixed(2)}</div>
                                    <div>Payout: ${trade.payout.toFixed(2)}</div>
                                </div>
                                <div className="contract-time">{formatTime(trade.timestamp)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="auto-trade-panel__history">
                <Text size="sm" weight="bold" className="section-title">
                    {localize('Recent Trade History')}
                </Text>
                {trade_history.length === 0 ? (
                    <div className="empty-history">
                        <Text size="xs" color="less-prominent">
                            {localize('No trades executed yet. Start auto-trading to see results here.')}
                        </Text>
                    </div>
                ) : (
                    <div className="history-list">
                        {trade_history.slice(0, 10).map((trade, index) => (
                            <div key={`${trade.contract_id}-${index}`} className={`history-item ${trade.status}`}>
                                <div className="history-main">
                                    <span className={`trade-type ${trade.contract_type.toLowerCase()}`}>
                                        {trade.contract_type === 'CALL' ? '↗' : '↘'}
                                    </span>
                                    <span className="trade-symbol">{trade.symbol}</span>
                                    <span className={`trade-status ${trade.status}`}>
                                        {trade.status === 'won' ? '✓' : '✗'}
                                    </span>
                                </div>
                                <div className="history-details">
                                    <span className="trade-time">{formatTime(trade.timestamp)}</span>
                                    <span className="trade-profit">{formatProfit(trade.profit)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});
