import React from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import Text from '@/components/shared_ui/text';
import './ml-trader.scss';

const MLTrader = observer(() => {
    return (
        <div className='ml-trader'>
            <div className='ml-trader__header'>
                <h1>{localize('ML Trader')}</h1>
                <div className='ml-trader__status inactive'>
                    {localize('Ready')}
                </div>
            </div>

            <div className='ml-trader__content'>
                <Text size='sm' color='general'>
                    {localize('ML Trader component cleared and ready for new implementation.')}
                </Text>
            </div>
        </div>
    );
});

export default MLTrader;