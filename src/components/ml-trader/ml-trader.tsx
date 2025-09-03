
import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { contract_stages } from '@/constants/contract-stage';
import { tradingEngine } from '@/components/volatility-analyzer/trading-engine';
import Text from '@/components/shared_ui/text';
import './ml-trader.scss';

const MLTrader = observer(() => {
    const { run_panel } = useStore();
    
    // Trading state
    const [isRunning, setIsRunning] = useState(false);
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [currentPrice, setCurrentPrice] = useState(null);
    const [symbol, setSymbol] = useState('R_50');
    const [tradeAmount, setTradeAmount] = useState(1);
    const [duration, setDuration] = useState(1);
    const [durationType, setDurationType] = useState('t');
    const [autoTrade, setAutoTrade] = useState(false);
    const [minConfidence, setMinConfidence] = useState(70);
    const [status, setStatus] = useState('');
    
    // ML Analysis state
    const [analysis, setAnalysis] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    
    // Statistics
    const [statistics, setStatistics] = useState({
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        profit: 0
    });

    // Check connection status
    useEffect(() => {
        const checkConnection = () => {
            if (tradingEngine.isEngineConnected()) {
                setConnectionStatus('connected');
            } else {
                setConnectionStatus('disconnected');
            }
        };

        checkConnection();
        const interval = setInterval(checkConnection, 1000);
        return () => clearInterval(interval);
    }, []);

    // Subscribe to tick data
    useEffect(() => {
        if (connectionStatus === 'connected') {
            subscribeToTicks();
        }
    }, [connectionStatus, symbol]);

    const subscribeToTicks = useCallback(async () => {
        try {
            const ws = tradingEngine.getWebSocket();
            if (!ws) return;

            const request = {
                ticks: symbol,
                subscribe: 1
            };

            ws.send(JSON.stringify(request));

            ws.addEventListener('message', (event) => {
                const data = JSON.parse(event.data);
                if (data.tick) {
                    setCurrentPrice(data.tick.quote);
                    if (isRunning) {
                        performMLAnalysis(data.tick.quote);
                    }
                }
            });
        } catch (error) {
            console.error('Error subscribing to ticks:', error);
            setStatus('Error subscribing to market data');
        }
    }, [symbol, isRunning]);

    const performMLAnalysis = useCallback(async (price) => {
        if (isAnalyzing) return;
        
        setIsAnalyzing(true);
        
        try {
            // Simulate ML analysis (replace with actual ML model)
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const riseConfidence = Math.random() * 100;
            const fallConfidence = 100 - riseConfidence;
            
            const newAnalysis = {
                riseConfidence: riseConfidence,
                fallConfidence: fallConfidence,
                recommendation: riseConfidence > fallConfidence ? 'RISE' : 'FALL',
                timestamp: Date.now()
            };
            
            setAnalysis(newAnalysis);
            
            // Auto trade if enabled and confidence is high enough
            if (autoTrade && Math.max(riseConfidence, fallConfidence) >= minConfidence) {
                const direction = newAnalysis.recommendation;
                await executeTrade(direction, true);
            }
            
        } catch (error) {
            console.error('ML Analysis error:', error);
            setStatus('ML Analysis failed');
        } finally {
            setIsAnalyzing(false);
        }
    }, [isAnalyzing, autoTrade, minConfidence]);

    const executeTrade = useCallback(async (direction, isAutoTrade = false) => {
        if (connectionStatus !== 'connected') {
            setStatus('Not connected to trading engine');
            return;
        }

        try {
            setStatus(`Executing ${direction} trade...`);
            
            // Get proposal first
            const proposalParams = {
                contract_type: direction === 'RISE' ? 'CALL' : 'PUT',
                symbol: symbol,
                amount: tradeAmount,
                duration: duration,
                duration_unit: durationType,
                basis: 'stake'
            };

            const proposal = await tradingEngine.getProposal(proposalParams);
            
            if (proposal.proposal) {
                // Buy the contract
                const buyResult = await tradingEngine.buyContract(
                    proposal.proposal.id,
                    proposal.proposal.ask_price
                );
                
                if (buyResult.buy) {
                    setStatus(`${direction} trade executed successfully`);
                    
                    // Update statistics
                    setStatistics(prev => ({
                        ...prev,
                        totalTrades: prev.totalTrades + 1
                    }));
                    
                    // Subscribe to contract updates
                    tradingEngine.subscribeToContract(buyResult.buy.contract_id);
                    
                    // Set run panel state if auto trading
                    if (isAutoTrade) {
                        run_panel.setIsRunning(true);
                        run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
                    }
                    
                } else {
                    setStatus('Trade execution failed');
                }
            } else {
                setStatus('Failed to get trade proposal');
            }
        } catch (error) {
            console.error('Trade execution error:', error);
            setStatus(`Trade failed: ${error.message}`);
        }
    }, [connectionStatus, symbol, tradeAmount, duration, durationType, run_panel]);

    const startAnalysis = useCallback(() => {
        if (connectionStatus !== 'connected') {
            setStatus('Please wait for connection...');
            return;
        }
        
        setIsRunning(true);
        setStatus('ML analysis started');
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
    }, [connectionStatus, run_panel]);

    const stopAnalysis = useCallback(() => {
        setIsRunning(false);
        setIsAutoTrading(false);
        setStatus('Analysis stopped');
        run_panel.setIsRunning(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
    }, [run_panel]);

    const toggleAutoTrading = useCallback(() => {
        if (!isRunning) {
            startAnalysis();
        }
        setIsAutoTrading(!isAutoTrading);
        setAutoTrade(!autoTrade);
    }, [isRunning, isAutoTrading, autoTrade, startAnalysis]);

    return (
        <div className='ml-trader'>
            <div className='ml-trader__header'>
                <h1>🤖 ML Trading Engine</h1>
                <div className={`ml-trader__status ${connectionStatus}`}>
                    {connectionStatus === 'connected' ? 'Connected' : 'Connecting...'}
                </div>
            </div>

            <div className='ml-trader__controls'>
                <div className='ml-trader__control-group'>
                    <label>Symbol</label>
                    <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                        <option value="R_10">Volatility 10 Index</option>
                        <option value="R_25">Volatility 25 Index</option>
                        <option value="R_50">Volatility 50 Index</option>
                        <option value="R_75">Volatility 75 Index</option>
                        <option value="R_100">Volatility 100 Index</option>
                    </select>
                </div>

                <div className='ml-trader__control-group'>
                    <label>Stake ($)</label>
                    <input
                        type="number"
                        min="1"
                        max="100"
                        value={tradeAmount}
                        onChange={(e) => setTradeAmount(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Duration</label>
                    <input
                        type="number"
                        min="1"
                        max="10"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                    />
                </div>

                <div className='ml-trader__control-group'>
                    <label>Type</label>
                    <select value={durationType} onChange={(e) => setDurationType(e.target.value)}>
                        <option value="t">Ticks</option>
                        <option value="s">Seconds</option>
                        <option value="m">Minutes</option>
                    </select>
                </div>

                <div className='ml-trader__price'>
                    ${currentPrice ? currentPrice.toFixed(5) : '--'}
                </div>
            </div>

            {analysis && (
                <div className='ml-trader__analysis'>
                    <h3>ML Analysis</h3>
                    <div className='ml-trader__analysis-section'>
                        <div className='ml-trader__progress-item'>
                            <div className='ml-trader__progress-label'>
                                <span>Rise Probability</span>
                                <span>{analysis.riseConfidence.toFixed(1)}%</span>
                            </div>
                            <div className='ml-trader__progress-bar'>
                                <div 
                                    className='ml-trader__progress-fill ml-trader__progress-fill--rise'
                                    style={{width: `${analysis.riseConfidence}%`}}
                                />
                            </div>
                        </div>

                        <div className='ml-trader__progress-item'>
                            <div className='ml-trader__progress-label'>
                                <span>Fall Probability</span>
                                <span>{analysis.fallConfidence.toFixed(1)}%</span>
                            </div>
                            <div className='ml-trader__progress-bar'>
                                <div 
                                    className='ml-trader__progress-fill ml-trader__progress-fill--fall'
                                    style={{width: `${analysis.fallConfidence}%`}}
                                />
                            </div>
                        </div>
                    </div>

                    <div className='ml-trader__recommendation'>
                        Recommendation: {analysis.recommendation}
                        <span className='ml-trader__confidence'>
                            ({Math.max(analysis.riseConfidence, analysis.fallConfidence).toFixed(1)}% confidence)
                        </span>
                    </div>
                </div>
            )}

            <div className='ml-trader__trading-condition'>
                <h4>Auto Trading Settings</h4>
                <div className='ml-trader__condition-row'>
                    <span>Enable Auto Trading</span>
                    <input
                        type='checkbox'
                        checked={autoTrade}
                        onChange={(e) => setAutoTrade(e.target.checked)}
                    />
                </div>
                <div className='ml-trader__condition-row'>
                    <span>Min Confidence %</span>
                    <input
                        type='number'
                        min={40}
                        max={95}
                        value={minConfidence}
                        onChange={(e) => setMinConfidence(Number(e.target.value))}
                    />
                </div>
            </div>

            <div className='ml-trader__buttons'>
                <button
                    className={`ml-trader__auto-trading-btn ${isAutoTrading ? 'ml-trader__auto-trading-btn--active' : ''}`}
                    onClick={toggleAutoTrading}
                    disabled={connectionStatus !== 'connected'}
                >
                    {isAutoTrading ? 'Stop Auto Trading' : 'Start Auto Trading'}
                </button>

                <div className='ml-trader__manual-buttons'>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--rise'
                        onClick={() => executeTrade('RISE')}
                        disabled={connectionStatus !== 'connected'}
                    >
                        Execute Rise Trade
                    </button>
                    <button
                        className='ml-trader__manual-btn ml-trader__manual-btn--fall'
                        onClick={() => executeTrade('FALL')}
                        disabled={connectionStatus !== 'connected'}
                    >
                        Execute Fall Trade
                    </button>
                </div>
            </div>

            <div className='ml-trader__statistics'>
                <h4>Trading Statistics</h4>
                <div className='ml-trader__stats-grid'>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs'>Total Trades</Text>
                        <Text size='s' weight='bold'>{statistics.totalTrades}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs'>Wins</Text>
                        <Text size='s' weight='bold' color='profit'>{statistics.wins}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs'>Losses</Text>
                        <Text size='s' weight='bold' color='loss-danger'>{statistics.losses}</Text>
                    </div>
                    <div className='ml-trader__stat-item'>
                        <Text size='xs'>Win Rate</Text>
                        <Text size='s' weight='bold'>{statistics.winRate.toFixed(1)}%</Text>
                    </div>
                </div>
            </div>

            {status && (
                <div className='ml-trader__status-message'>
                    <Text size='xs' color={/error|fail/i.test(status) ? 'loss-danger' : 'prominent'}>
                        {status}
                    </Text>
                </div>
            )}
        </div>
    );
});

export default MLTrader;
