
import { getImageLocation } from '../../public-path';
import { localize } from '@deriv-com/translations';
import { TDescriptionItem } from '../../pages/bot-builder/quick-strategy/types';

export const DIGIT_PREDICTION_RECOVERY = (): TDescriptionItem[] => [
    {
        type: 'subtitle',
        content: [localize('Exploring the Digit Prediction Recovery strategy in Deriv Bot')],
        expanded: true,
        no_collapsible: false,
    },
    {
        type: 'text',
        content: [
            localize(
                'The Digit Prediction Recovery strategy uses advanced probability analysis to select the most favorable digit predictions, with a progressive recovery system to manage losses.'
            ),
            localize(
                "This strategy analyzes digit patterns and frequencies to make intelligent predictions, while employing a recovery mechanism to recoup losses through systematic stake increases."
            ),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('Key parameters')],
    },
    {
        type: 'text',
        content: [localize('These are the trade parameters used in the Digit Prediction Recovery strategy.')],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Base stake:</strong> The initial amount you are willing to place as a stake. This serves as the foundation for recovery calculations.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Recovery multiplier:</strong> The factor by which your stake increases after each loss. Default is 2x for standard martingale recovery.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Maximum recoveries:</strong> The maximum number of consecutive recovery attempts before the bot stops trading. This limits risk exposure.'
            ),
        ],
    },
    {
        type: 'text',
        content: [
            localize(
                '<strong>Session loss limit:</strong> The maximum loss amount before the bot automatically stops trading to protect your account.'
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
            localize('1. The bot analyzes digit patterns and selects the most probable digit prediction.'),
            localize('2. If the trade wins, the stake resets to the base amount.'),
            localize('3. If the trade loses, the bot enters recovery mode with an increased stake.'),
            localize('4. The recovery continues until a win occurs or limits are reached.'),
            localize('5. Built-in safety mechanisms stop trading when risk thresholds are exceeded.'),
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
                'The strategy includes multiple risk management features: maximum recovery attempts to prevent excessive losses, session loss limits for account protection, and automatic notifications to keep you informed of trading progress.'
            ),
        ],
    },
    {
        type: 'subtitle',
        content: [localize('Summary')],
    },
    {
        type: 'text',
        content: [
            localize(
                'The Digit Prediction Recovery strategy combines intelligent market analysis with systematic risk management. While it offers the potential for consistent profits through recovery mechanisms, traders should understand the associated risks and test thoroughly in demo accounts before live trading.'
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
                'Trading involves risk, and past performance does not guarantee future results. The recovery mechanism can lead to significant losses during extended losing streaks. Always trade responsibly and within your risk tolerance.'
            ),
        ],
    },
];
