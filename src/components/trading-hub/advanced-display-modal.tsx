
import React, { useState, useEffect } from 'react';
import Modal from '@/components/shared_ui/modal';
import Button from '@/components/shared_ui/button';
import './advanced-display.scss';

interface AdvancedDisplayModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApplySettings: (settings: any) => void;
}

const AdvancedDisplayModal: React.FC<AdvancedDisplayModalProps> = ({
    isOpen,
    onClose,
    onApplySettings
}) => {
    const [stakeAmount, setStakeAmount] = useState('1.00');
    const [referenceDigit, setReferenceDigit] = useState('5');
    const [analysisCount, setAnalysisCount] = useState('120');
    const [activeSymbols, setActiveSymbols] = useState(['R_10', 'R_25', 'R_50', 'R_75', 'R_100']);
    const [recentTicks, setRecentTicks] = useState([1, 8, 1, 6, 4, 2, 7, 3, 5, 8]);

    const availableSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

    const handleApply = () => {
        onApplySettings({
            stake: stakeAmount,
            referenceDigit: referenceDigit,
            analysisCount: analysisCount,
            symbols: activeSymbols
        });
        onClose();
    };

    const toggleSymbol = (symbol: string) => {
        setActiveSymbols(prev => 
            prev.includes(symbol)
                ? prev.filter(s => s !== symbol)
                : [...prev, symbol]
        );
    };

    return (
        <Modal
            is_open={isOpen}
            toggleModal={onClose}
            title="Advanced Market Analysis"
            className="advanced-display-modal"
        >
            <Modal.Body>
                <div className="advanced-display-content">
                    <div className="control-section">
                        <div className="control-group">
                            <label>Stake Amount (USD):</label>
                            <input
                                type="number"
                                value={stakeAmount}
                                onChange={(e) => setStakeAmount(e.target.value)}
                                className="control-input"
                                step="0.01"
                                min="0.35"
                            />
                        </div>
                        
                        <div className="control-group">
                            <label>Reference Digit (0-9):</label>
                            <input
                                type="number"
                                value={referenceDigit}
                                onChange={(e) => setReferenceDigit(e.target.value)}
                                className="control-input"
                                min="0"
                                max="9"
                            />
                        </div>
                        
                        <div className="control-group">
                            <label>Analysis Count:</label>
                            <input
                                type="number"
                                value={analysisCount}
                                onChange={(e) => setAnalysisCount(e.target.value)}
                                className="control-input"
                                min="50"
                                max="500"
                            />
                        </div>
                    </div>

                    <div className="symbol-selector">
                        <label>Active Symbols:</label>
                        <div className="symbol-buttons">
                            {availableSymbols.map(symbol => (
                                <button
                                    key={symbol}
                                    className={`symbol-btn ${activeSymbols.includes(symbol) ? 'active' : ''}`}
                                    onClick={() => toggleSymbol(symbol)}
                                >
                                    {symbol.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="recent-ticks-section">
                        <label>Recent Tick Analysis:</label>
                        <div className="ticks-display">
                            {recentTicks.map((tick, index) => (
                                <div 
                                    key={index} 
                                    className={`tick-circle ${tick % 2 === 0 ? 'even' : 'odd'}`}
                                >
                                    {tick}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="digit-frequency">
                        <h4>Digit Frequency Analysis</h4>
                        <div className="frequency-bars">
                            {[0,1,2,3,4,5,6,7,8,9].map(digit => {
                                const frequency = recentTicks.filter(tick => tick === digit).length;
                                const percentage = (frequency / recentTicks.length) * 100;
                                return (
                                    <div key={digit} className="frequency-bar">
                                        <div className="bar-label">{digit}</div>
                                        <div className="bar-container">
                                            <div 
                                                className="bar-fill"
                                                style={{ height: `${percentage * 2}%` }}
                                            ></div>
                                        </div>
                                        <div className="bar-value">{frequency}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="pattern-analysis">
                        <h4>Pattern Recognition</h4>
                        <div className="pattern-stats">
                            <div className="stat-item">
                                <span className="stat-label">Even/Odd Ratio:</span>
                                <span className="stat-value">
                                    {recentTicks.filter(t => t % 2 === 0).length} / 
                                    {recentTicks.filter(t => t % 2 === 1).length}
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Over {referenceDigit}:</span>
                                <span className="stat-value">
                                    {recentTicks.filter(t => t > parseInt(referenceDigit)).length}
                                </span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Under {referenceDigit}:</span>
                                <span className="stat-value">
                                    {recentTicks.filter(t => t < parseInt(referenceDigit)).length}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal.Body>
            
            <Modal.Footer>
                <Button onClick={onClose} secondary>
                    Cancel
                </Button>
                <Button onClick={handleApply} primary>
                    Apply Settings
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

export default AdvancedDisplayModal;
