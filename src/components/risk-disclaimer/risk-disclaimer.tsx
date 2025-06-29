
import React, { useState } from 'react';
import Button from '@/components/shared_ui/button';
import Modal from '@/components/shared_ui/modal';
import Text from '@/components/shared_ui/text';
import './risk-disclaimer.scss';

const RiskDisclaimer = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAcknowledged, setIsAcknowledged] = useState(() => {
        return localStorage.getItem('risk_disclaimer_acknowledged') === 'true';
    });

    const handleOpenModal = () => {
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
    };

    const handleAcknowledge = () => {
        setIsAcknowledged(true);
        localStorage.setItem('risk_disclaimer_acknowledged', 'true');
        setIsModalOpen(false);
    };

    if (isAcknowledged) {
        return (
            <>
                <button className='risk-disclaimer-button' onClick={handleOpenModal}>
                    <Text size='xs' weight='bold' color='colored-background'>
                        Risk
                    </Text>
                </button>
                {isModalOpen && (
                    <Modal
                        is_open={isModalOpen}
                        toggleModal={handleCloseModal}
                        title='Risk Disclaimer'
                        className='risk-disclaimer-modal'
                    >
                        <div className='risk-disclaimer-content'>
                            <Text size='s' line_height='m'>
                                Deriv offers complex derivatives, such as options and contracts for difference ("CFDs"). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.
                            </Text>
                            <div className='risk-disclaimer-actions'>
                                <Button primary onClick={handleCloseModal}>
                                    Close
                                </Button>
                            </div>
                        </div>
                    </Modal>
                )}
            </>
        );
    }

    return (
        <Modal
            is_open={!isAcknowledged}
            title='Risk Disclaimer'
            className='risk-disclaimer-modal'
            has_close_icon={false}
        >
            <div className='risk-disclaimer-content'>
                <Text size='s' line_height='m'>
                    Deriv offers complex derivatives, such as options and contracts for difference ("CFDs"). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.
                </Text>
                <div className='risk-disclaimer-actions'>
                    <Button primary large onClick={handleAcknowledge}>
                        I UNDERSTAND
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default RiskDisclaimer;
