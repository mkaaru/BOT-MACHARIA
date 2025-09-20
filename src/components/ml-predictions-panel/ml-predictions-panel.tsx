
import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { mlPredictionEngine, CandlePrediction } from '@/services/ml-prediction-engine';
import './ml-predictions-panel.scss';

interface MLPredictionsPanelProps {
    isMinimized?: boolean;
    onToggleMinimize?: () => void;
}

const MLPredictionsPanel: React.FC<MLPredictionsPanelProps> = observer(({
    isMinimized = false,
    onToggleMinimize
}) => {
    const [predictions, setPredictions] = useState<Map<string, CandlePrediction>>(new Map());
    const [modelStats, setModelStats] = useState<Map<string, any>>(new Map());
    const [selectedSymbol, setSelectedSymbol] = useState<string>('');

    useEffect(() => {
        const updatePredictions = () => {
            const latestPredictions = mlPredictionEngine.getAllPredictions();
            const stats = mlPredictionEngine.getModelStats();
            
            setPredictions(latestPredictions);
            setModelStats(stats);
            
            // Auto-select first symbol if none selected
            if (!selectedSymbol && latestPredictions.size > 0) {
                setSelectedSymbol(Array.from(latestPredictions.keys())[0]);
            }
        };

        // Initial load
        updatePredictions();

        // Update every 10 seconds
        const interval = setInterval(updatePredictions, 10000);

        return () => clearInterval(interval);
    }, [selectedSymbol]);

    const getConfidenceColor = (confidence: number): string => {
        if (confidence >= 80) return 'profit-success';
        if (confidence >= 65) return 'prominent';
        if (confidence >= 50) return 'general';
        return 'loss-danger';
    };

    const getDirectionIcon = (direction: string): string => {
        switch (direction) {
            case 'bullish': return '📈';
            case 'bearish': return '📉';
            default: return '➖';
        }
    };

    const getActionColor = (action: string): string => {
        switch (action) {
            case 'BUY': return 'profit-success';
            case 'SELL': return 'loss-danger';
            default: return 'general';
        }
    };

    const formatSymbolName = (symbol: string): string => {
        const symbolMap: Record<string, string> = {
            'R_10': 'Volatility 10',
            'R_25': 'Volatility 25',
            'R_50': 'Volatility 50',
            'R_75': 'Volatility 75',
            'R_100': 'Volatility 100',
            '1HZ10V': 'Vol 10 (1s)',
            '1HZ25V': 'Vol 25 (1s)',
            '1HZ50V': 'Vol 50 (1s)',
            '1HZ75V': 'Vol 75 (1s)',
            '1HZ100V': 'Vol 100 (1s)',
        };
        return symbolMap[symbol] || symbol;
    };

    if (isMinimized) {
        return (
            <div className="ml-predictions-panel ml-predictions-panel--minimized">
                <div className="ml-predictions-panel__header" onClick={onToggleMinimize}>
                    <Text size="xs" weight="bold">🤖 ML Predictions ({predictions.size})</Text>
                </div>
            </div>
        );
    }

    const rankedPredictions = mlPredictionEngine.getRankedRecommendations();
    const selectedPrediction = selectedSymbol ? predictions.get(selectedSymbol) : null;
    const selectedStats = selectedSymbol ? modelStats.get(selectedSymbol) : null;

    return (
        <div className="ml-predictions-panel">
            <div className="ml-predictions-panel__header">
                <Text size="sm" weight="bold">🤖 {localize('ML Predictions')}</Text>
                {onToggleMinimize && (
                    <button className="ml-predictions-panel__minimize" onClick={onToggleMinimize}>
                        ➖
                    </button>
                )}
            </div>

            <div className="ml-predictions-panel__content">
                {/* Top Recommendations */}
                <div className="ml-predictions-panel__top-picks">
                    <Text size="xs" weight="bold" color="prominent">
                        {localize('Top ML Recommendations')}
                    </Text>
                    <div className="top-picks-list">
                        {rankedPredictions.slice(0, 3).map((prediction, index) => (
                            <div 
                                key={prediction.symbol} 
                                className={`top-pick ${selectedSymbol === prediction.symbol ? 'selected' : ''}`}
                                onClick={() => setSelectedSymbol(prediction.symbol)}
                            >
                                <div className="top-pick__rank">#{index + 1}</div>
                                <div className="top-pick__info">
                                    <Text size="xs" weight="bold">
                                        {formatSymbolName(prediction.symbol)}
                                    </Text>
                                    <div className="top-pick__signal">
                                        <span className={`direction-icon ${prediction.nextCandleDirection}`}>
                                            {getDirectionIcon(prediction.nextCandleDirection)}
                                        </span>
                                        <Text 
                                            size="xs" 
                                            color={getActionColor(prediction.recommendation.action)}
                                            weight="bold"
                                        >
                                            {prediction.recommendation.action}
                                        </Text>
                                        <Text 
                                            size="xs" 
                                            color={getConfidenceColor(prediction.confidence)}
                                        >
                                            {prediction.confidence.toFixed(1)}%
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Symbol Selector */}
                <div className="ml-predictions-panel__selector">
                    <Text size="xs" color="general">{localize('Select Symbol:')}</Text>
                    <select 
                        value={selectedSymbol} 
                        onChange={(e) => setSelectedSymbol(e.target.value)}
                        className="symbol-selector"
                    >
                        <option value="">{localize('Choose symbol...')}</option>
                        {Array.from(predictions.keys()).map(symbol => (
                            <option key={symbol} value={symbol}>
                                {formatSymbolName(symbol)}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Detailed Prediction */}
                {selectedPrediction && (
                    <div className="ml-predictions-panel__details">
                        <div className="prediction-card">
                            <div className="prediction-card__header">
                                <Text size="sm" weight="bold">
                                    {formatSymbolName(selectedSymbol)}
                                </Text>
                                <div className="model-info">
                                    <Text size="xs" color="general">
                                        Model: {selectedStats?.accuracy.toFixed(1)}% | 
                                        Trained: {selectedStats?.trainingCount} samples
                                    </Text>
                                </div>
                            </div>

                            <div className="prediction-card__main">
                                <div className="prediction-direction">
                                    <div className={`direction-display ${selectedPrediction.nextCandleDirection}`}>
                                        <span className="direction-icon">
                                            {getDirectionIcon(selectedPrediction.nextCandleDirection)}
                                        </span>
                                        <Text size="sm" weight="bold">
                                            {selectedPrediction.nextCandleDirection.toUpperCase()}
                                        </Text>
                                    </div>
                                    <Text 
                                        size="lg" 
                                        weight="bold" 
                                        color={getConfidenceColor(selectedPrediction.confidence)}
                                    >
                                        {selectedPrediction.confidence.toFixed(1)}%
                                    </Text>
                                </div>

                                <div className="prediction-recommendation">
                                    <div className="rec-action">
                                        <Text 
                                            size="sm" 
                                            weight="bold" 
                                            color={getActionColor(selectedPrediction.recommendation.action)}
                                        >
                                            {selectedPrediction.recommendation.action}
                                        </Text>
                                        <Text size="xs" color="general">
                                            {selectedPrediction.recommendation.strength} | 
                                            {selectedPrediction.recommendation.riskLevel} Risk
                                        </Text>
                                    </div>
                                    <div className="rec-details">
                                        <Text size="xs" color="general">
                                            Duration: {selectedPrediction.recommendation.expectedDuration}s
                                        </Text>
                                        <Text size="xs" color="general">
                                            Stake: ${selectedPrediction.recommendation.stakeRecommendation}
                                        </Text>
                                    </div>
                                </div>
                            </div>

                            <div className="prediction-card__features">
                                <Text size="xs" weight="bold" color="prominent">
                                    {localize('Key Factors:')}
                                </Text>
                                <div className="feature-grid">
                                    <div className="feature-item">
                                        <Text size="xs" color="general">RSI:</Text>
                                        <Text size="xs">{selectedPrediction.features.rsi.toFixed(1)}</Text>
                                    </div>
                                    <div className="feature-item">
                                        <Text size="xs" color="general">MACD:</Text>
                                        <Text size="xs">{selectedPrediction.features.macd.toFixed(4)}</Text>
                                    </div>
                                    <div className="feature-item">
                                        <Text size="xs" color="general">Volatility:</Text>
                                        <Text size="xs">{(selectedPrediction.features.volatility * 1000).toFixed(2)}</Text>
                                    </div>
                                    <div className="feature-item">
                                        <Text size="xs" color="general">Momentum:</Text>
                                        <Text size="xs">{(selectedPrediction.features.momentum[0] * 100).toFixed(2)}%</Text>
                                    </div>
                                </div>
                            </div>

                            <div className="prediction-card__move">
                                <Text size="xs" color="general">
                                    Predicted Move: {selectedPrediction.predictedMove > 0 ? '+' : ''}{selectedPrediction.predictedMove.toFixed(4)}
                                </Text>
                            </div>
                        </div>
                    </div>
                )}

                {/* All Predictions Summary */}
                <div className="ml-predictions-panel__summary">
                    <Text size="xs" weight="bold" color="prominent">
                        {localize('All Predictions')}
                    </Text>
                    <div className="predictions-grid">
                        {Array.from(predictions.entries()).map(([symbol, prediction]) => (
                            <div 
                                key={symbol} 
                                className={`prediction-summary ${selectedSymbol === symbol ? 'selected' : ''}`}
                                onClick={() => setSelectedSymbol(symbol)}
                            >
                                <div className="prediction-summary__symbol">
                                    <Text size="xs">{formatSymbolName(symbol)}</Text>
                                </div>
                                <div className="prediction-summary__signal">
                                    <span className={`direction-icon ${prediction.nextCandleDirection}`}>
                                        {getDirectionIcon(prediction.nextCandleDirection)}
                                    </span>
                                    <Text 
                                        size="xs" 
                                        color={getConfidenceColor(prediction.confidence)}
                                    >
                                        {prediction.confidence.toFixed(0)}%
                                    </Text>
                                </div>
                                <div className="prediction-summary__action">
                                    <Text 
                                        size="xs" 
                                        color={getActionColor(prediction.recommendation.action)}
                                    >
                                        {prediction.recommendation.action}
                                    </Text>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLPredictionsPanel;
