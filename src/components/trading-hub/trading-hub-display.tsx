import React, { useState, useEffect } from 'react';
import './trading-hub-display.scss';
import { observer as globalObserver } from '../../external/bot-skeleton/utils/observer';

const TradingHubDisplay: React.FC = () => {
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        setIsInitialized(true);
        globalObserver.emit('ui.log.info', 'Trading Hub initialized - Ready to build!');
    }, []);

    return (
        <div className="trading-hub-clean">
            <div className="hub-header">
                <div className="header-content">
                    <div className="logo-section">
                        <div className="logo-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                            </svg>
                        </div>
                        <div className="title-section">
                            <h1>Trading Hub</h1>
                            <p>Clean slate - Ready to build</p>
                        </div>
                    </div>

                    <div className="status-indicator">
                        <div className={`status-dot ${isInitialized ? 'active' : 'inactive'}`}></div>
                        <span>{isInitialized ? 'Ready' : 'Initializing...'}</span>
                    </div>
                </div>
            </div>

            <div className="hub-content">
                <div className="welcome-section">
                    <div className="welcome-card">
                        <div className="card-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                <path d="M2 17l10 5 10-5"/>
                                <path d="M2 12l10 5 10-5"/>
                            </svg>
                        </div>
                        <h2>Welcome to Trading Hub</h2>
                        <p>Your clean workspace is ready. Let's start building something amazing!</p>

                        <div className="action-buttons">
                            <button className="primary-btn">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="16"/>
                                    <line x1="8" y1="12" x2="16" y2="12"/>
                                </svg>
                                Add New Feature
                            </button>
                            <button className="secondary-btn">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14,2 14,8 20,8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                    <polyline points="10,9 9,9 8,9"/>
                                </svg>
                                View Documentation
                            </button>
                        </div>
                    </div>
                </div>

                <div className="quick-stats">
                    <div className="stat-card">
                        <div className="stat-value">0</div>
                        <div className="stat-label">Active Components</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">0</div>
                        <div className="stat-label">Data Sources</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">0</div>
                        <div className="stat-label">Running Processes</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingHubDisplay;