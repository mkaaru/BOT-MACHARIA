import React from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import './ml-trader.scss';

const MLTrader = observer(() => {
    return (
        <div className='ml-trader'>
            <div className='ml-trader__container'>
                <div className='ml-trader__header'>
                    <h2 className='ml-trader__title'>{localize('🤖 AI ML Trading Engine')}</h2>
                    <p className='ml-trader__subtitle'>{localize('Machine Learning powered trading system')}</p>
                </div>

                <div className='ml-trader__content'>
                    <div className='ml-trader__empty-state'>
                        <Text size='s' color='general'>
                            {localize('ML Trader component cleared. Ready for new implementation.')}
                        </Text>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MLTrader;