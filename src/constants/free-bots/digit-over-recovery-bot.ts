
import { localize } from '@deriv-com/translations';
import { TDescriptionItem } from '../../pages/bot-builder/quick-strategy/types';

export const DIGIT_OVER_RECOVERY_BOT = (): TDescriptionItem[] => [
    {
        type: 'subtitle',
        content: [localize('Digit Over Recovery Bot Strategy')],
        expanded: true,
        no_collapsible: false,
    },
    {
        type: 'text',
        content: [
            localize(
                'This strategy uses a digit over prediction with martingale recovery system. It starts with a base stake and doubles the stake after each loss to recover previous losses.'
            ),
            localize(
                'The bot includes a recovery mode that switches to pattern-based trading when in loss, analyzing the last 3 digits to determine the next trade direction.'
            ),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('Key parameters')],
    },
    {
        type: 'text',
        content: [localize('These are the trade parameters used in this recovery bot strategy.')],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Initial stake:</strong> The starting amount for each trading cycle. The bot will return to this amount after a win.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Take profit:</strong> The bot will stop trading when total profit reaches this threshold.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Stop loss:</strong> The bot will stop trading when total loss exceeds this amount.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Martingale multiplier:</strong> The factor by which the stake is multiplied after each loss (typically 2x).'
            ),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('How the strategy works')],
    },
    {
        type: 'text',
        content: [
            localize('1. Start with digit over prediction (predicting last digit > 2)'),
            localize('2. If trade wins: Reset stake to initial amount and continue'),
            localize('3. If trade loses: Double the stake and enter recovery mode'),
            localize('4. In recovery mode: Analyze last 3 digits for pattern-based trading'),
            localize('5. Stop when take profit or stop loss threshold is reached'),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Warning:</strong> This strategy involves progressive stake increases which can lead to significant losses. Use appropriate risk management and only trade with money you can afford to lose.'
            ),
        ],
    },
];
