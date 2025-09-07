
import React from 'react';
import './profit-loss-display.scss';

interface ProfitLossDisplayProps {
    totalProfit: number;
    totalStake: number;
    totalPayout: number;
    currency: string;
    winRate: number;
    totalTrades: number;
}

const ProfitLossDisplay: React.FC<ProfitLossDisplayProps> = ({
    totalProfit,
    totalStake,
    totalPayout,
    currency,
    winRate,
    totalTrades
}) => {
    const profitPercentage = totalStake > 0 ? ((totalProfit / totalStake) * 100).toFixed(2) : '0.00';
    const isProfit = totalProfit >= 0;

    return (
        <div className="profit-loss-display">
            <div className="profit-loss-header">
                <h3>Trading Performance</h3>
                <div className="summary-stats">
                    <span className="stat-item">
                        Trades: {totalTrades}
                    </span>
                    <span className="stat-item">
                        Win Rate: {winRate}%
                    </span>
                </div>
            </div>

            <div className="profit-loss-main">
                <div className={`total-profit ${isProfit ? 'profit' : 'loss'}`}>
                    <div className="profit-label">Total P&L</div>
                    <div className="profit-value">
                        {isProfit ? '+' : ''}{totalProfit.toFixed(2)} {currency}
                    </div>
                    <div className="profit-percentage">
                        ({isProfit ? '+' : ''}{profitPercentage}%)
                    </div>
                </div>

                <div className="profit-breakdown">
                    <div className="breakdown-item">
                        <span className="breakdown-label">Total Stake:</span>
                        <span className="breakdown-value">
                            {totalStake.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className="breakdown-item">
                        <span className="breakdown-label">Total Payout:</span>
                        <span className="breakdown-value">
                            {totalPayout.toFixed(2)} {currency}
                        </span>
                    </div>
                    <div className="breakdown-item">
                        <span className="breakdown-label">Net Result:</span>
                        <span className={`breakdown-value ${isProfit ? 'profit' : 'loss'}`}>
                            {isProfit ? '+' : ''}{totalProfit.toFixed(2)} {currency}
                        </span>
                    </div>
                </div>
            </div>

            <div className="profit-loss-chart">
                <div className="chart-container">
                    <div className="chart-bar stake">
                        <div className="bar-fill" style={{ width: '100%' }}></div>
                        <span className="bar-label">Stake</span>
                    </div>
                    <div className="chart-bar payout">
                        <div 
                            className="bar-fill" 
                            style={{ width: `${totalStake > 0 ? (totalPayout / totalStake) * 100 : 0}%` }}
                        ></div>
                        <span className="bar-label">Payout</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProfitLossDisplay;
