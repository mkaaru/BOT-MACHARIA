
import React, { useState } from 'react';
import Modal from '@/components/shared_ui/modal';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import './volatility-selector-modal.scss';

interface VolatilitySelectorModalProps {
    is_open: boolean;
    onClose: () => void;
    onLoadSettings: (settings: TradingSettings) => void;
}

interface TradingSettings {
    symbol: string;
    trade_mode: 'rise_fall' | 'higher_lower';
    contract_type: string;
    stake: number;
    duration: number;
    duration_unit: 't' | 's' | 'm';
    barrier_offset?: number;
}

const VOLATILITY_SYMBOLS = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
];

const TRADE_MODES = [
    { value: 'rise_fall', label: 'Rise/Fall' },
    { value: 'higher_lower', label: 'Higher/Lower' },
];

const CONTRACT_TYPES_RISE_FALL = [
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
];

const CONTRACT_TYPES_HIGHER_LOWER = [
    { value: 'CALL', label: 'Higher' },
    { value: 'PUT', label: 'Lower' },
];

const DURATION_UNITS = [
    { value: 't', label: 'Ticks' },
    { value: 's', label: 'Seconds' },
    { value: 'm', label: 'Minutes' },
];

const VolatilitySelectorModal: React.FC<VolatilitySelectorModalProps> = ({
    is_open,
    onClose,
    onLoadSettings,
}) => {
    const [settings, setSettings] = useState<TradingSettings>({
        symbol: 'R_25',
        trade_mode: 'rise_fall',
        contract_type: 'PUT',
        stake: 1.8,
        duration: 3,
        duration_unit: 't',
        barrier_offset: 0.001,
    });

    const handleSettingChange = (key: keyof TradingSettings, value: any) => {
        setSettings(prev => {
            const newSettings = { ...prev, [key]: value };
            
            // Auto-adjust contract type when trade mode changes
            if (key === 'trade_mode') {
                newSettings.contract_type = value === 'rise_fall' ? 'CALL' : 'CALL';
            }
            
            return newSettings;
        });
    };

    const handleLoadSettings = () => {
        onLoadSettings(settings);
        onClose();
    };

    const getAvailableContractTypes = () => {
        return settings.trade_mode === 'rise_fall' ? CONTRACT_TYPES_RISE_FALL : CONTRACT_TYPES_HIGHER_LOWER;
    };

    const selectedSymbolInfo = VOLATILITY_SYMBOLS.find(s => s.symbol === settings.symbol);

    return (
        <Modal
            is_open={is_open}
            toggleModal={onClose}
            title={localize('Trading Interface Configuration')}
            width="600px"
            height="auto"
        >
            <div className="volatility-selector-modal">
                <div className="volatility-selector-modal__content">
                    <Text as="p" size="s" color="general" className="volatility-selector-modal__description">
                        {localize('Configure your Super Elite Bot trading parameters and load them for execution.')}
                    </Text>

                    <div className="volatility-selector-modal__form">
                        <div className="form-row">
                            <div className="form-field">
                                <Text as="label" size="xs" weight="bold">
                                    {localize('Asset')}
                                </Text>
                                <select
                                    value={settings.symbol}
                                    onChange={(e) => handleSettingChange('symbol', e.target.value)}
                                    className="form-select"
                                >
                                    {VOLATILITY_SYMBOLS.map(symbol => (
                                        <option key={symbol.symbol} value={symbol.symbol}>
                                            {symbol.display_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-field">
                                <Text as="label" size="xs" weight="bold">
                                    {localize('Trade Mode')}
                                </Text>
                                <select
                                    value={settings.trade_mode}
                                    onChange={(e) => handleSettingChange('trade_mode', e.target.value as 'rise_fall' | 'higher_lower')}
                                    className="form-select"
                                >
                                    {TRADE_MODES.map(mode => (
                                        <option key={mode.value} value={mode.value}>
                                            {mode.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-field">
                                <Text as="label" size="xs" weight="bold">
                                    {localize('Contract Type')}
                                </Text>
                                <select
                                    value={settings.contract_type}
                                    onChange={(e) => handleSettingChange('contract_type', e.target.value)}
                                    className="form-select"
                                >
                                    {getAvailableContractTypes().map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-field">
                                <Text as="label" size="xs" weight="bold">
                                    {localize('Stake (USD)')}
                                </Text>
                                <input
                                    type="number"
                                    value={settings.stake}
                                    onChange={(e) => handleSettingChange('stake', parseFloat(e.target.value) || 0)}
                                    className="form-input"
                                    min="0.35"
                                    step="0.01"
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-field">
                                <Text as="label" size="xs" weight="bold">
                                    {localize('Duration')}
                                </Text>
                                <input
                                    type="number"
                                    value={settings.duration}
                                    onChange={(e) => handleSettingChange('duration', parseInt(e.target.value) || 1)}
                                    className="form-input"
                                    min="1"
                                />
                            </div>

                            <div className="form-field">
                                <Text as="label" size="xs" weight="bold">
                                    {localize('Duration Unit')}
                                </Text>
                                <select
                                    value={settings.duration_unit}
                                    onChange={(e) => handleSettingChange('duration_unit', e.target.value as 't' | 's' | 'm')}
                                    className="form-select"
                                >
                                    {DURATION_UNITS.map(unit => (
                                        <option key={unit.value} value={unit.value}>
                                            {unit.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {settings.trade_mode === 'higher_lower' && (
                            <div className="form-row">
                                <div className="form-field">
                                    <Text as="label" size="xs" weight="bold">
                                        {localize('Barrier Offset')}
                                    </Text>
                                    <input
                                        type="number"
                                        value={settings.barrier_offset}
                                        onChange={(e) => handleSettingChange('barrier_offset', parseFloat(e.target.value) || 0)}
                                        className="form-input"
                                        step="0.001"
                                        min="0.001"
                                    />
                                </div>
                                <div className="form-field">
                                    <Text as="label" size="xs" weight="bold">
                                        {localize('Note')}
                                    </Text>
                                    <Text size="xs" color="general">
                                        {localize('Barrier will be set relative to current price')}
                                    </Text>
                                </div>
                            </div>
                        )}

                        <div className="settings-preview">
                            <Text as="h4" size="s" weight="bold" className="settings-preview__title">
                                {localize('Configuration Preview')}
                            </Text>
                            <div className="settings-preview__content">
                                <div className="preview-item">
                                    <Text size="xs" color="general">{localize('Asset:')}</Text>
                                    <Text size="xs" weight="bold">{selectedSymbolInfo?.display_name}</Text>
                                </div>
                                <div className="preview-item">
                                    <Text size="xs" color="general">{localize('Mode:')}</Text>
                                    <Text size="xs" weight="bold">{TRADE_MODES.find(m => m.value === settings.trade_mode)?.label}</Text>
                                </div>
                                <div className="preview-item">
                                    <Text size="xs" color="general">{localize('Type:')}</Text>
                                    <Text size="xs" weight="bold">{getAvailableContractTypes().find(t => t.value === settings.contract_type)?.label}</Text>
                                </div>
                                <div className="preview-item">
                                    <Text size="xs" color="general">{localize('Stake:')}</Text>
                                    <Text size="xs" weight="bold">${settings.stake}</Text>
                                </div>
                                <div className="preview-item">
                                    <Text size="xs" color="general">{localize('Duration:')}</Text>
                                    <Text size="xs" weight="bold">{settings.duration} {DURATION_UNITS.find(u => u.value === settings.duration_unit)?.label}</Text>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="volatility-selector-modal__footer">
                    <Button
                        secondary
                        onClick={onClose}
                        text={localize('Cancel')}
                    />
                    <Button
                        primary
                        onClick={handleLoadSettings}
                        text={localize('Load Settings')}
                    />
                </div>
            </div>
        </Modal>
    );
};

export default VolatilitySelectorModal;
