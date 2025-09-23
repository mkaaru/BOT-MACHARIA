
import React, { useState, useEffect } from 'react';
import { Modal } from '../shared_ui/modal';
import { Button } from '../shared_ui/button';
import { ToggleSwitch } from '../shared_ui/toggle-switch';
import { Text } from '../shared_ui/text';
import { trendAnalysisEngine } from '../../services/trend-analysis-engine';
import type { ROCSettings } from '../../services/trend-analysis-engine';
import './roc-settings-modal.scss';

interface ROCSettingsModalProps {
    is_open: boolean;
    onClose: () => void;
}

export const ROCSettingsModal: React.FC<ROCSettingsModalProps> = ({ is_open, onClose }) => {
    const [rocSettings, setRocSettings] = useState<ROCSettings>({
        mode: 'default',
        longTermPeriod: 30,
        shortTermPeriod: 14,
        enabled: true
    });

    useEffect(() => {
        if (is_open) {
            // Load current settings when modal opens
            const currentSettings = trendAnalysisEngine.getROCSettings();
            setRocSettings(currentSettings);
        }
    }, [is_open]);

    const handleModeChange = (mode: 'default' | 'sensitive' | 'conservative') => {
        const newSettings = { ...rocSettings, mode };
        setRocSettings(newSettings);
    };

    const handleSensitivityToggle = (enabled: boolean) => {
        const newSettings = { ...rocSettings, enabled };
        setRocSettings(newSettings);
    };

    const handleSave = () => {
        trendAnalysisEngine.setROCSettings(rocSettings);
        onClose();
    };

    const handleReset = () => {
        const defaultSettings: ROCSettings = {
            mode: 'default',
            longTermPeriod: 30,
            shortTermPeriod: 14,
            enabled: true
        };
        setRocSettings(defaultSettings);
    };

    const getEffectivePeriods = () => {
        switch (rocSettings.mode) {
            case 'sensitive':
                return {
                    longTerm: Math.floor(rocSettings.longTermPeriod * 0.7),
                    shortTerm: Math.floor(rocSettings.shortTermPeriod * 0.6)
                };
            case 'conservative':
                return {
                    longTerm: Math.floor(rocSettings.longTermPeriod * 1.3),
                    shortTerm: Math.floor(rocSettings.shortTermPeriod * 1.4)
                };
            default:
                return {
                    longTerm: rocSettings.longTermPeriod,
                    shortTerm: rocSettings.shortTermPeriod
                };
        }
    };

    const effectivePeriods = getEffectivePeriods();

    return (
        <Modal
            is_open={is_open}
            title="ROC Analysis Settings"
            onClose={onClose}
            width="480px"
        >
            <div className="roc-settings-modal">
                <div className="roc-settings-modal__header">
                    <Text size="s" color="prominent">
                        Configure Rate of Change sensitivity for trend analysis
                    </Text>
                </div>

                <div className="roc-settings-modal__section">
                    <div className="roc-settings-modal__sensitivity-section">
                        <div className="roc-settings-modal__sensitivity-header">
                            <div className="roc-settings-modal__icon">⚙️</div>
                            <div className="roc-settings-modal__sensitivity-info">
                                <Text weight="bold" size="s">
                                    ROC Sensitivity
                                </Text>
                                <Text size="xs" color="less-prominent">
                                    Default: Long-term 30, Short-term 14 periods
                                </Text>
                            </div>
                            <div className="roc-settings-modal__toggle">
                                <ToggleSwitch
                                    id="roc-sensitivity-toggle"
                                    is_enabled={rocSettings.enabled}
                                    handleToggle={handleSensitivityToggle}
                                />
                            </div>
                        </div>
                    </div>

                    {rocSettings.enabled && (
                        <>
                            <div className="roc-settings-modal__mode-section">
                                <Text weight="bold" size="s">Sensitivity Mode</Text>
                                <div className="roc-settings-modal__mode-buttons">
                                    <Button
                                        className={`roc-settings-modal__mode-button ${
                                            rocSettings.mode === 'sensitive' ? 'roc-settings-modal__mode-button--active' : ''
                                        }`}
                                        onClick={() => handleModeChange('sensitive')}
                                        secondary={rocSettings.mode !== 'sensitive'}
                                        primary={rocSettings.mode === 'sensitive'}
                                        text="Sensitive"
                                        small
                                    />
                                    <Button
                                        className={`roc-settings-modal__mode-button ${
                                            rocSettings.mode === 'default' ? 'roc-settings-modal__mode-button--active' : ''
                                        }`}
                                        onClick={() => handleModeChange('default')}
                                        secondary={rocSettings.mode !== 'default'}
                                        primary={rocSettings.mode === 'default'}
                                        text="Default"
                                        small
                                    />
                                    <Button
                                        className={`roc-settings-modal__mode-button ${
                                            rocSettings.mode === 'conservative' ? 'roc-settings-modal__mode-button--active' : ''
                                        }`}
                                        onClick={() => handleModeChange('conservative')}
                                        secondary={rocSettings.mode !== 'conservative'}
                                        primary={rocSettings.mode === 'conservative'}
                                        text="Conservative"
                                        small
                                    />
                                </div>
                            </div>

                            <div className="roc-settings-modal__current-settings">
                                <div className="roc-settings-modal__settings-icon">📊</div>
                                <div className="roc-settings-modal__settings-info">
                                    <Text weight="bold" size="s" color="prominent">
                                        Current ROC Settings
                                    </Text>
                                    <div className="roc-settings-modal__settings-details">
                                        <Text size="xs">
                                            Long-term: {effectivePeriods.longTerm} periods
                                        </Text>
                                        <Text size="xs">
                                            Short-term: {effectivePeriods.shortTerm} periods
                                        </Text>
                                        <Text size="xs">
                                            Mode: {rocSettings.mode.charAt(0).toUpperCase() + rocSettings.mode.slice(1)}
                                        </Text>
                                    </div>
                                </div>
                            </div>

                            {rocSettings.mode !== 'default' && (
                                <div className="roc-settings-modal__mode-description">
                                    <Text size="xs" color="less-prominent">
                                        {rocSettings.mode === 'sensitive' 
                                            ? '⚡ Sensitive mode uses shorter periods for faster signal detection but may generate more false signals.'
                                            : '🛡️ Conservative mode uses longer periods for more reliable signals but slower detection.'
                                        }
                                    </Text>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="roc-settings-modal__footer">
                    <Button
                        secondary
                        text="Reset to Default"
                        onClick={handleReset}
                        small
                    />
                    <div className="roc-settings-modal__action-buttons">
                        <Button
                            secondary
                            text="Cancel"
                            onClick={onClose}
                        />
                        <Button
                            primary
                            text="Apply Settings"
                            onClick={handleSave}
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default ROCSettingsModal;
