import './during_purchase';
import './sell_at_market';
import './check_sell';
import './sell_price';

import { localize } from '@deriv-com/translations';

Blockly.Blocks.trade_again = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Trade again (wait for contract to close)'),
            colour: '#f2f2f2',
            previousStatement: null,
            tooltip: localize('This block will wait for the current contract to close before starting a new trade'),
        };
    },
    meta() {
        return {
            display_name: localize('Trade again'),
            description: localize('Wait for current contract to close before starting a new trade'),
        };
    },
    getRequiredValueInputs() {
        return {};
    },
};