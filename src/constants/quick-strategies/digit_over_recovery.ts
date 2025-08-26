
import { localize } from '@deriv-com/translations';
import { TDescriptionItem } from '../../pages/bot-builder/quick-strategy/types';

export const DIGIT_OVER_RECOVERY = (): TDescriptionItem[] => [
    {
        type: 'subtitle',
        content: [localize('Exploring the Digit Over Recovery strategy in Deriv Bot')],
        expanded: true,
        no_collapsible: false,
    },
    {
        type: 'text',
        content: [
            localize(
                'The Digit Over Recovery strategy combines digit over predictions with a martingale recovery system and pattern-based trading logic. It uses a base stake that doubles after each loss to recover previous losses while implementing intelligent pattern recognition during loss streaks.'
            ),
            localize(
                'This article explores the strategy integrated into Deriv Bot, designed for trading synthetic indices with digit predictions. We will examine the strategy parameters, recovery mechanism, and essential risk management considerations.'
            ),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('Key parameters')],
    },
    {
        type: 'text',
        content: [localize('These are the trade parameters used in Deriv Bot with Digit Over Recovery strategy.')],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Initial stake:</strong> The starting amount for each trading cycle. After a win, the stake resets to this initial value.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Take profit threshold:</strong> The bot will stop trading if your total profit exceeds this amount.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Stop loss threshold:</strong> The bot will stop trading if your total loss exceeds this amount.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Prediction value:</strong> The digit threshold for over predictions (default: 2, meaning last digit > 2).'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Martingale multiplier:</strong> The factor by which stake increases after losses (typically 2x).'
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
            localize('1. Start with initial stake and digit over prediction (last digit > 2)'),
            localize('2. If trade wins: Reset stake to initial amount, turn off recovery mode'),
            localize('3. If trade loses: Double the stake using martingale, activate recovery mode'),
            localize('4. Check profit/loss thresholds - stop if limits reached'),
            localize('5. In recovery mode: Analyze last 3 digits for pattern-based trading'),
            localize('   - If last 3 digits are all odd → Place digit even trade'),
            localize('   - If last 3 digits are all even → Place digit odd trade'),
            localize('   - Otherwise continue with digit over predictions'),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('Risk management features')],
    },
    {
        type: 'text',
        content: [
            localize(
                'The strategy includes built-in risk management through take profit and stop loss thresholds. These automatically stop the bot when profit targets are reached or when losses exceed acceptable limits.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                'The recovery mode provides an additional layer by switching to pattern-based analysis during losing streaks, potentially improving the chances of recovery while maintaining disciplined stake management.'
            ),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('Important considerations')],
    },
    {
        type: 'text',
        content: [
            localize(
                'This strategy uses progressive stake increases which can lead to significant losses during extended losing streaks. The martingale component requires careful capital management and appropriate stop loss settings.'
            ),
        ],
    },
    {
        type: 'text_italic',
        content: [localize('<strong>Disclaimer:</strong>')],
    },
    {
        type: 'text_italic',
        content: [
            localize(
                'Trading with automated strategies involves substantial risk. Past performance does not guarantee future results. Only trade with capital you can afford to lose and ensure you understand the risks involved.'
            ),
        ],
    },
];
