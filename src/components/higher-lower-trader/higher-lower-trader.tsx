
import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import TradingHubDisplay from './trading-hub-display';
import './higher-lower-trader.scss';

const HigherLowerTrader: React.FC = observer(() => {
    const { ui } = useStore();
    const { is_dark_mode_on } = useThemeSwitcher();
    const [activeTab, setActiveTab] = useState<'overview' | 'trading-hub'>('overview');

    return (
        <div className={`higher-lower-trader ${is_dark_mode_on ? 'dark' : 'light'}`}>
            <div className="higher-lower-trader__header">
                <h2 className="higher-lower-trader__title">Higher/Lower Trader</h2>
                <div className="higher-lower-trader__tabs">
                    <button
                        className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
                        onClick={() => setActiveTab('overview')}
                    >
                        Overview
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'trading-hub' ? 'active' : ''}`}
                        onClick={() => setActiveTab('trading-hub')}
                    >
                        Trading Hub
                    </button>
                </div>
            </div>

            <div className="higher-lower-trader__content">
                {activeTab === 'overview' && (
                    <div className="higher-lower-trader__overview">
                        <div className="overview-section">
                            <h3>Welcome to Advanced Trading</h3>
                            <p>This platform provides sophisticated trading tools and automated strategies for binary options trading.</p>
                            
                            <div className="features-grid">
                                <div className="feature-card">
                                    <h4>🎯 Trading Hub</h4>
                                    <p>Automated trading with three powerful strategies:</p>
                                    <ul>
                                        <li><strong>AutoDiffer:</strong> Random digit analysis</li>
                                        <li><strong>Auto Over/Under:</strong> AI pattern recognition</li>
                                        <li><strong>Auto O5U4:</strong> Dual digit strategy</li>
                                    </ul>
                                </div>
                                
                                <div className="feature-card">
                                    <h4>📊 Real-time Analysis</h4>
                                    <p>Advanced market analysis features:</p>
                                    <ul>
                                        <li>Live tick data processing</li>
                                        <li>Digit frequency analysis</li>
                                        <li>Pattern recognition algorithms</li>
                                        <li>Volatility calculations</li>
                                    </ul>
                                </div>
                                
                                <div className="feature-card">
                                    <h4>🛡️ Risk Management</h4>
                                    <p>Built-in protection systems:</p>
                                    <ul>
                                        <li>Martingale stake management</li>
                                        <li>Configurable loss limits</li>
                                        <li>Real-time profit tracking</li>
                                        <li>Automatic position sizing</li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div className="getting-started">
                                <h4>Getting Started</h4>
                                <ol>
                                    <li>Click on the "Trading Hub" tab above</li>
                                    <li>Configure your base stake and risk parameters</li>
                                    <li>Enable your preferred trading strategies</li>
                                    <li>Monitor the automated trading in real-time</li>
                                </ol>
                            </div>
                            
                            <div className="disclaimer">
                                <h4>⚠️ Risk Disclaimer</h4>
                                <p>Trading binary options involves substantial risk and may result in loss of capital. Past performance does not guarantee future results. Only trade with money you can afford to lose.</p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'trading-hub' && (
                    <TradingHubDisplay />
                )}
            </div>
        </div>
    );
});

export default HigherLowerTrader;
