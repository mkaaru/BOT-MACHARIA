import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Modal from '@/components/shared_ui/modal';
import Text from '@/components/shared_ui/text';
import Button from '@/components/shared_ui/button';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import './recommendation-settings-modal.scss';

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

interface RecommendationSettingsModalProps {
    is_open: boolean;
    onClose: () => void;
    recommendation: TradingRecommendation | null;
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

const RecommendationSettingsModal: React.FC<RecommendationSettingsModalProps> = observer(({
    is_open,
    onClose,
    recommendation
}) => {
    const store = useStore();
    const { dashboard } = store;

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [tradeMode, setTradeMode] = useState<'rise_fall' | 'higher_lower'>('rise_fall');
    const [contractType, setContractType] = useState<string>('CALL');
    const [duration, setDuration] = useState<number>(7);
    const [durationType, setDurationType] = useState<'t' | 's' | 'm'>('t');
    const [stake, setStake] = useState<number>(1);
    const [barrier, setBarrier] = useState<string>('');
    const [prediction, setPrediction] = useState<number>(5);

    // Initialize form with recommendation data
    useEffect(() => {
        if (recommendation && is_open) {
            setSymbol(recommendation.symbol);
            setStake(recommendation.suggestedStake || 1);

            // Use Bot Builder default values
            setDuration(20); // Default to 20 seconds to match Bot Builder
            setDurationType('s'); // Default to seconds for ML recommendations

            // Set contract type based on strategy
            if (recommendation.strategy === 'over' || recommendation.direction === 'CALL') {
                setContractType('CALL');
            } else if (recommendation.strategy === 'under' || recommendation.direction === 'PUT') {
                setContractType('PUT');
            }

            // Set barrier/prediction
            if (recommendation.barrier) {
                setBarrier(recommendation.barrier);
                setPrediction(parseInt(recommendation.barrier) || 5);
            }
        }
    }, [recommendation, is_open]);

    // Generate Bot Builder XML for the settings
    const generateBotBuilderXML = () => {
        const selectedSymbol = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === symbol);
        const symbolDisplay = selectedSymbol?.display_name || symbol;

        // Contract type mapping
        const contractTypeMapping: Record<string, string> = {
            'CALL': 'rise',
            'PUT': 'fall'
        };

        const mappedContractType = contractTypeMapping[contractType] || 'rise';

        // Generate XML for Bot Builder trade definition
        const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable id="stake_var">Stake</variable>
    <variable id="duration_var">Duration</variable>
  </variables>
  <block type="trade_definition" id="trade_def_block" x="40" y="40">
    <field name="MARKET_LIST">synthetic_index</field>
    <field name="SUBMARKET_LIST">${symbol}</field>
    <field name="SYMBOL_LIST">${symbol}</field>
    <field name="TRADETYPE_LIST">${mappedContractType}</field>
    <field name="DURATION_TYPE">${durationType}</field>
    <value name="DURATION">
      <block type="math_number">
        <field name="NUM">${duration}</field>
      </block>
    </value>
    <value name="AMOUNT">
      <block type="math_number">
        <field name="NUM">${stake}</field>
      </block>
    </value>
    <field name="BASIS_LIST">stake</field>
    ${prediction !== 5 && (recommendation?.strategy === 'over' || recommendation?.strategy === 'under') ? `
    <value name="PREDICTION">
      <block type="math_number">
        <field name="NUM">${prediction}</field>
      </block>
    </value>` : ''}
  </block>
  <block type="before_purchase" x="40" y="200">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="text_print">
        <value name="TEXT">
          <block type="text">
            <field name="TEXT">Starting trade on ${symbolDisplay} - ${contractType} - Stake: ${stake}</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" x="40" y="320">
    <statement name="AFTERPURCHASE_STACK">
      <block type="text_print">
        <value name="TEXT">
          <block type="text">
            <field name="TEXT">Trade completed - Result will be processed</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
</xml>`;

        return xml;
    };

    // Load settings to Bot Builder
    const handleLoadToBotBuilder = () => {
        try {
            const xmlContent = generateBotBuilderXML();

            // Switch to Bot Builder tab
            dashboard.setActiveTab(1); // Bot Builder tab index

            // Load the XML into Blockly workspace
            setTimeout(() => {
                if (window.Blockly?.derivWorkspace) {
                    window.Blockly.derivWorkspace.clear();
                    const xmlDoc = window.Blockly.utils.xml.textToDom(xmlContent);
                    window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);

                    // Center the workspace
                    window.Blockly.derivWorkspace.scrollCenter();
                }
            }, 500);

            onClose();
        } catch (error) {
            console.error('Error loading settings to Bot Builder:', error);
        }
    };

    if (!recommendation) return null;

    return (
        <Modal
            className="recommendation-settings-modal"
            is_open={is_open}
            toggleModal={onClose}
            title={localize('Trading Interface - ML Recommendation')}
            width="600px"
        >
            <div className="recommendation-settings-modal__content">
                <div className="recommendation-settings-modal__recommendation-info">
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

                <div className="recommendation-settings-modal__trading-form">
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
                                    value={tradeMode}
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
                                    value={contractType}
                                    onChange={(e) => setContractType(e.target.value)}
                                >
                                    {TRADE_TYPES.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-field">
                                <label htmlFor="modal-stake">{localize('Stake (USD)')}</label>
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
                                {durationType === 's' && recommendation && (
                                    <div className="duration-hint">
                                        <Text size="xs" color="general">
                                            {localize('Calculated based on signal confidence: {{confidence}}%', {
                                                confidence: recommendation.confidence.toFixed(1)
                                            })}
                                        </Text>
                                    </div>
                                )}
                            </div>

                            <div className="form-field">
                                <label htmlFor="modal-duration-unit">{localize('Duration Unit')}</label>
                                <select
                                    id="modal-duration-unit"
                                    value={durationType}
                                    onChange={(e) => setDurationType(e.target.value as 't' | 's' | 'm')}
                                >
                                    <option value="s">{localize('Seconds (Recommended)')}</option>
                                    <option value="t">{localize('Ticks')}</option>
                                    <option value="m">{localize('Minutes')}</option>
                                </select>
                            </div>
                        </div>

                        {(recommendation?.strategy === 'over' || recommendation?.strategy === 'under') && (
                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="modal-prediction">{localize('Prediction')}</label>
                                    <input
                                        id="modal-prediction"
                                        type="number"
                                        value={prediction}
                                        onChange={(e) => setPrediction(Number(e.target.value))}
                                        min="0"
                                        max="9"
                                    />
                                </div>
                                <div className="form-field">
                                    <label htmlFor="modal-barrier">{localize('Barrier')}</label>
                                    <input
                                        id="modal-barrier"
                                        type="text"
                                        value={barrier}
                                        onChange={(e) => setBarrier(e.target.value)}
                                        placeholder="e.g. 5"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="signal-info-section">
                            <Text size="sm" weight="bold" color="prominent">
                                {localize('Signal Information:')}
                            </Text>
                            <div className="signal-details">
                                <Text size="xs" color="general">
                                    {localize('Expected duration: {{duration}} seconds', { duration })}
                                </Text>
                                <Text size="xs" color="general">
                                    {localize('Signal strength: {{confidence}}%', {
                                        confidence: recommendation?.confidence.toFixed(1) || '0'
                                    })}
                                </Text>
                                <Text size="xs" color="general">
                                    {localize('Strategy: {{strategy}}', {
                                        strategy: recommendation?.strategy.toUpperCase() || 'UNKNOWN'
                                    })}
                                </Text>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="recommendation-settings-modal__actions">
                    <Button
                        className="modal-cancel-btn"
                        onClick={onClose}
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
});

export default RecommendationSettingsModal;