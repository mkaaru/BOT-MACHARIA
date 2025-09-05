
import React, { useState, useEffect } from 'react';
import './volatility-scanner.scss';

interface VolatilityOpportunity {
    symbol: string;
    displayName: string;
    tradingSymbol: string;
    confidence: number;
    signal: string;
    alignedCount: number;
    totalCount: number;
}

const VolatilityScanner: React.FC = () => {
    const [opportunities, setOpportunities] = useState<VolatilityOpportunity[]>([
        {
            symbol: 'R_10',
            displayName: 'Volatility 10 (1s) Index',
            tradingSymbol: '1HZ10V',
            confidence: 75,
            signal: 'HIGHER',
            alignedCount: 3,
            totalCount: 4
        }
    ]);

    const handleSelectAndTrade = (opportunity: VolatilityOpportunity) => {
        // Use the correct trading symbol for 1-second volatilities
        const symbolToUse = opportunity.tradingSymbol;
        
        // Navigate to Higher/Lower trader with the correct symbol
        const event = new CustomEvent('selectVolatilitySymbol', {
            detail: {
                symbol: symbolToUse,
                displayName: opportunity.displayName
            }
        });
        window.dispatchEvent(event);
        
        // Switch to Higher/Lower trader tab
        const higherLowerTab = document.querySelector('[data-testid="dt_higher_lower_tab"]') as HTMLElement;
        if (higherLowerTab) {
            higherLowerTab.click();
        }
    };

    return (
        <div className="volatility-scanner">
            <div className="scanner-header">
                <h3>Volatility Opportunities Scanner</h3>
                <button className="scan-all-btn">Scan All Volatilities</button>
            </div>
            
            <div className="opportunities-section">
                <h4>High-Confidence Opportunities (1)</h4>
                <p className="opportunities-subtitle">Volatilities with 3+ aligned trends</p>
                
                {opportunities.map((opportunity, index) => (
                    <div key={index} className="opportunity-card">
                        <div className="opportunity-header">
                            <span className="symbol">{opportunity.symbol}</span>
                            <span className="display-name">{opportunity.displayName}</span>
                            <span className={`confidence-badge ${opportunity.signal.toLowerCase()}`}>
                                {opportunity.signal}
                            </span>
                        </div>
                        
                        <div className="opportunity-details">
                            <div className="detail-item">
                                <span className="label">Aligned:</span>
                                <span className="value">{opportunity.alignedCount}/{opportunity.totalCount}</span>
                            </div>
                            <div className="detail-item">
                                <span className="label">Confidence:</span>
                                <span className="value">{opportunity.confidence}%</span>
                            </div>
                        </div>
                        
                        <div className="trend-indicators">
                            {[1000, 2000, 3000, 4000].map((period, idx) => (
                                <div key={period} className="trend-indicator">
                                    <span className="period">{period}</span>
                                    <span className={`signal ${idx < 3 ? 'bullish' : 'neutral'}`}>
                                        {idx < 3 ? 'B' : 'N'}
                                    </span>
                                </div>
                            ))}
                        </div>
                        
                        <button 
                            className="select-trade-btn"
                            onClick={() => handleSelectAndTrade(opportunity)}
                        >
                            Select & Trade {opportunity.signal}
                        </button>
                    </div>
                ))}
            </div>
            
            <div className="trading-stats">
                <h4>Trading Statistics</h4>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">Total Runs:</span>
                        <span className="stat-value">0</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Wins/Losses:</span>
                        <span className="stat-value">0/0</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Win Rate:</span>
                        <span className="stat-value">0.0%</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Total Stake:</span>
                        <span className="stat-value">$0.00</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Total Payout:</span>
                        <span className="stat-value">$0.00</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Net P&L:</span>
                        <span className="stat-value positive">+$0.00</span>
                    </div>
                </div>
                <button className="reset-stats-btn">Reset Statistics</button>
            </div>
        </div>
    );
};

export default VolatilityScanner;
