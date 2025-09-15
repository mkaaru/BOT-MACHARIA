import React from 'react';
import Modal from '@/components/shared_ui/modal';
import Text from '@/components/shared_ui/text';
import Button from '@/components/shared_ui/button';
import { localize } from '@deriv-com/translations';

interface TradingRecommendation {
    symbol: string;
    strategy: string;
    barrier?: string;
    confidence: number;
    overPercentage: number;
    underPercentage: number;
    reason: string;
    timestamp: number;
    displayName?: string;
    currentPrice?: number;
    suggestedStake?: number;
    suggestedDuration?: number;
    suggestedDurationUnit?: string;
    direction?: string;
}

interface TradingModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: TradingRecommendation | null;
    account_currency: string;
    current_price: number | null;
    onLoadSettings: () => void;
    // Form state props
    symbol: string;
    setSymbol: (value: string) => void;
    trade_mode: 'rise_fall' | 'higher_lower';
    setTradeMode: (value: 'rise_fall' | 'higher_lower') => void;
    contract_type: string;
    setContractType: (value: string) => void;
    duration: number;
    setDuration: (value: number) => void;
    duration_unit: 't' | 's' | 'm';
    setDurationUnit: (value: 't' | 's' | 'm') => void;
    stake: number;
    setStake: (value: number) => void;
    barrier_offset: number;
    setBarrierOffset: (value: number) => void;
}

// Enhanced volatility symbols including 1-second indices
const ENHANCED_VOLATILITY_SYMBOLS = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s: false },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s: false },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s: false },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s: false },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s: false },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', is_1s: true },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', is_1s: true },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', is_1s: true },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', is_1s: true },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', is_1s: true },
];

// Trade types for Rise/Fall and Higher/Lower
const TRADE_TYPES = [
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
];

const HIGHER_LOWER_TYPES = [
    { value: 'CALL', label: 'Higher' },
    { value: 'PUT', label: 'Lower' },
];

const TradingModal: React.FC<TradingModalProps> = ({
    isOpen,
    onClose,
    recommendation,
    account_currency,
    current_price,
    onLoadSettings,
    symbol,
    setSymbol,
    trade_mode,
    setTradeMode,
    contract_type,
    setContractType,
    duration,
    setDuration,
    duration_unit,
    setDurationUnit,
    stake,
    setStake,
    barrier_offset,
    setBarrierOffset,
}) => {
    if (!isOpen || !recommendation) return null;

    const handleClose = () => {
        try {
            onClose();
        } catch (error) {
            console.error('Error closing modal:', error);
        }
    };

    const handleLoadSettings = () => {
        try {
            onLoadSettings();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    };

    // Generate Bot Builder XML for the settings
    const generateBotBuilderXML = () => {
        const selectedSymbol = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === symbol);
        const symbolDisplay = selectedSymbol?.display_name || symbol;

        // Contract type mapping - map ML Trader types to Bot Builder types
        const contractTypeMapping: Record<string, string> = {
            'CALL': trade_mode === 'rise_fall' ? 'CALL' : 'CALLE', // Rise for Rise/Fall, Higher for Higher/Lower
            'PUT': trade_mode === 'rise_fall' ? 'PUT' : 'PUTE'     // Fall for Rise/Fall, Lower for Higher/Lower
        };

        const mappedContractType = contractTypeMapping[contract_type] || 'CALL';

        // Duration unit mapping
        const durationUnitMapping: Record<string, string> = {
            't': 't', // ticks
            's': 's', // seconds  
            'm': 'm'  // minutes
        };

        const mappedDurationUnit = durationUnitMapping[duration_unit] || 't';

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable id="market">market</variable>
    <variable id="submarket">submarket</variable>
    <variable id="symbol">symbol</variable>
    <variable id="tradetypecat">tradetypecat</variable>
  </variables>
  <block type="trade_definition" id="trade_definition" x="0" y="0">
    <field name="MARKET_LIST">${selectedSymbol?.group || 'synthetic_index'}</field>
    <field name="SUBMARKET_LIST">${selectedSymbol?.submarket || 'continuous_indices'}</field>
    <field name="SYMBOL_LIST">${symbol}</field>
    <field name="TRADETYPECAT_LIST">${trade_mode === 'rise_fall' ? 'callput' : 'highlow'}</field>
    <field name="TRADETYPE_LIST">${mappedContractType}</field>
    <value name="DURATION">
      <shadow type="math_number">
        <field name="NUM">${duration}</field>
      </shadow>
    </value>
    <value name="DURATIONTYPE_LIST">
      <shadow type="text">
        <field name="TEXT">${mappedDurationUnit}</field>
      </shadow>
    </value>
    <value name="AMOUNT">
      <shadow type="math_number">
        <field name="NUM">${stake}</field>
      </shadow>
    </value>
    <value name="BARRIEROFFSETTYPE_LIST">
      <shadow type="text">
        <field name="TEXT">+</field>
      </shadow>
    </value>
    ${trade_mode === 'higher_lower' ? `
    <value name="BARRIEROFFSET">
      <shadow type="math_number">
        <field name="NUM">${barrier_offset}</field>
      </shadow>
    </value>` : ''}
    <statement name="SUBMARKET_TRADEPARAMETERS">
      <block type="trade_definition_market" id="trade_definition_market">
        <field name="MARKET_LIST">${selectedSymbol?.group || 'synthetic_index'}</field>
        <field name="SUBMARKET_LIST">${selectedSymbol?.submarket || 'continuous_indices'}</field>
        <field name="SYMBOL_LIST">${symbol}</field>
      </block>
    </statement>
  </block>
</xml>`;

        return xml;
    };

    // Load settings to Bot Builder
    const handleLoadToBotBuilder = () => {
        try {
            // Import required dependencies
            const { load } = require('@/external/bot-skeleton');
            const { save_types } = require('@/external/bot-skeleton/constants/save-type');

            const xmlContent = generateBotBuilderXML();

            // Close modal first
            onClose();

            // Switch to Bot Builder tab
            setTimeout(() => {
                // Set active tab to Bot Builder (index 1)
                if (window.location.hash !== '#bot_builder') {
                    window.location.hash = '#bot_builder';
                }

                // Load the strategy into Bot Builder
                setTimeout(async () => {
                    if (window.Blockly?.derivWorkspace) {
                        try {
                            await load({
                                block_string: xmlContent,
                                file_name: `ML_Recommendation_${recommendation?.symbol}_${Date.now()}`,
                                workspace: window.Blockly.derivWorkspace,
                                from: save_types.UNSAVED,
                                drop_event: null,
                                strategy_id: null,
                                showIncompatibleStrategyDialog: null,
                            });

                            // Center the workspace
                            window.Blockly.derivWorkspace.scrollCenter();

                            console.log('✅ Settings loaded to Bot Builder successfully');
                        } catch (loadError) {
                            console.error('Error loading strategy:', loadError);
                            // Fallback to direct XML loading
                            window.Blockly.derivWorkspace.clear();
                            const xmlDoc = window.Blockly.utils.xml.textToDom(xmlContent);
                            window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                            window.Blockly.derivWorkspace.scrollCenter();
                        }
                    }
                }, 100);
            }, 100);
        } catch (error) {
            console.error('Error loading settings to Bot Builder:', error);
            onClose();
        }
    };

    return (
        <Modal
            className="trading-modal"
            is_open={isOpen}
            toggleModal={handleClose}
            title={localize('Trading Interface - ML Recommendation')}
            width="700px"
        >
            <div className="trading-modal__content">
                <div className="trading-modal__recommendation-info">
                    <div className="recommendation-info-card">
                        <Text size="sm" weight="bold" color="prominent">
                            {localize('Selected Recommendation:')}
                        </Text>
                        <div className="recommendation-details">
                            <Text size="xs">
                                {localize('Symbol:')} {ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === recommendation.symbol)?.display_name || recommendation.symbol}
                            </Text>
                            <Text size="xs">
                                {localize('Strategy:')} {recommendation.strategy.toUpperCase()}
                            </Text>
                            <Text size="xs">
                                {localize('Confidence:')} {recommendation.confidence.toFixed(1)}%
                            </Text>
                            {recommendation.barrier && (
                                <Text size="xs">
                                    {localize('Barrier:')} {recommendation.barrier}
                                </Text>
                            )}
                            <Text size="xs" color="general">
                                {recommendation.reason}
                            </Text>
                        </div>
                    </div>
                </div>

                <div className="trading-modal__trading-form">
                    <Text as="h3" className="form-title">{localize('Trading Interface')}</Text>

                    <div className="form-grid">
                        <div className="form-row">
                            <div className="form-field">
                                <label htmlFor="modal-asset">{localize('Asset')}</label>
                                <select
                                    id="modal-asset"
                                    value={symbol}
                                    onChange={(e) => setSymbol(e.target.value)}
                                >
                                    {ENHANCED_VOLATILITY_SYMBOLS.map(s => (
                                        <option key={s.symbol} value={s.symbol}>
                                            {s.display_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-field">
                                <label htmlFor="modal-trade-mode">{localize('Trade Mode')}</label>
                                <select
                                    id="modal-trade-mode"
                                    value={trade_mode}
                                    onChange={(e) => setTradeMode(e.target.value as 'rise_fall' | 'higher_lower')}
                                >
                                    <option value="rise_fall">{localize('Rise/Fall')}</option>
                                    <option value="higher_lower">{localize('Higher/Lower')}</option>
                                </select>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-field">
                                <label htmlFor="modal-contract-type">{localize('Contract Type')}</label>
                                <select
                                    id="modal-contract-type"
                                    value={contract_type}
                                    onChange={(e) => setContractType(e.target.value)}
                                >
                                    {(trade_mode === 'rise_fall' ? TRADE_TYPES : HIGHER_LOWER_TYPES).map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-field">
                                <label htmlFor="modal-stake">{localize('Stake')} ({account_currency})</label>
                                <input
                                    id="modal-stake"
                                    type="number"
                                    value={stake}
                                    onChange={(e) => setStake(Number(e.target.value))}
                                    min="0.35"
                                    step="0.01"
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-field">
                                <label htmlFor="modal-duration">{localize('Duration')}</label>
                                <input
                                    id="modal-duration"
                                    type="number"
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    min="1"
                                />
                            </div>

                            <div className="form-field">
                                <label htmlFor="modal-duration-unit">{localize('Duration Unit')}</label>
                                <select
                                    id="modal-duration-unit"
                                    value={duration_unit}
                                    onChange={(e) => setDurationUnit(e.target.value as 't' | 's' | 'm')}
                                >
                                    <option value="t">{localize('Ticks')}</option>
                                    <option value="s">{localize('Seconds')}</option>
                                    <option value="m">{localize('Minutes')}</option>
                                </select>
                            </div>
                        </div>

                        {trade_mode === 'higher_lower' && (
                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="modal-barrier-offset">{localize('Barrier Offset')}</label>
                                    <input
                                        id="modal-barrier-offset"
                                        type="number"
                                        value={barrier_offset}
                                        onChange={(e) => setBarrierOffset(Number(e.target.value))}
                                        step="0.001"
                                    />
                                </div>
                                <div className="form-field">
                                    <label>{localize('Current Price')}</label>
                                    <Text>{current_price ? current_price.toFixed(5) : 'Loading...'}</Text>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="trading-modal__actions">
                    <Button
                        className="modal-cancel-btn"
                        onClick={handleClose}
                        text={localize('Cancel')}
                        secondary
                    />
                    <Button
                        className="modal-load-btn"
                        onClick={handleLoadToBotBuilder}
                        text={localize('Load Settings')}
                        primary
                    />
                </div>
            </div>
        </Modal>
    );
};

export default TradingModal;