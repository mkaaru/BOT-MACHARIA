import React from 'react';
import { observer } from 'mobx-react-lite';
import { Modal, Text, Button } from '@/components/shared_ui';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import './risk-disclaimer.scss';

const RiskDisclaimer = observer(() => {
    const { ui } = useStore();
    const { is_risk_disclaimer_modal_visible, setRiskDisclaimerModalVisibility } = ui;

    const handleAccept = () => {
        setRiskDisclaimerModalVisibility(false);
        // Store acceptance in localStorage
        localStorage.setItem('risk_disclaimer_accepted', 'true');
    };

    const handleDecline = () => {
        setRiskDisclaimerModalVisibility(false);
    };

    if (!is_risk_disclaimer_modal_visible) return null;

    return (
        <Modal
            className='risk-disclaimer__modal'
            is_open={is_risk_disclaimer_modal_visible}
            has_close_icon={false}
            has_outer_content={false}
            should_header_stick_body={false}
            width='44rem'
        >
            <div className='risk-disclaimer__content'>
                <Text
                    as='h2'
                    className='risk-disclaimer__content-title'
                    weight='bold'
                    size='l'
                >
                    {localize('Risk Disclaimer')}
                </Text>
                <div className='risk-disclaimer__content-text'>
                    <Text size='s' color='general'>
                        {localize(
                            'Trading financial products carries significant risk and may result in the loss of all your invested capital. You should not invest money that you cannot afford to lose and should ensure that you fully understand the risks involved.'
                        )}
                    </Text>
                    <br />
                    <Text size='s' color='general'>
                        {localize(
                            'Before using this trading system, please carefully consider your investment objectives, level of experience, and risk tolerance. Past performance is not indicative of future results.'
                        )}
                    </Text>
                    <br />
                    <Text size='s' color='general'>
                        {localize(
                            'By accepting this disclaimer, you acknowledge that you understand these risks and agree to use this platform at your own discretion.'
                        )}
                    </Text>
                </div>
            </div>
            <div className='risk-disclaimer__footer'>
                <Button
                    className='risk-disclaimer__button risk-disclaimer__button--secondary'
                    secondary
                    onClick={handleDecline}
                    text={localize('Decline')}
                />
                <Button
                    className='risk-disclaimer__button risk-disclaimer__button--primary'
                    primary
                    onClick={handleAccept}
                    text={localize('Accept')}
                />
            </div>
        </Modal>
    );
});

export default RiskDisclaimer;