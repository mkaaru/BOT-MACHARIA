import './during_purchase';
import './sell_at_market';
import './check_sell';
import './sell_price';
import Purchase from './purchase';
import SellAtMarket from './sell_at_market';
import ContinuousPurchase from './continuous_purchase';

Blockly.Blocks = Blockly.Blocks || {};
Blockly.JavaScript = Blockly.JavaScript || {};

Blockly.Blocks.purchase = Purchase.definition;
Blockly.JavaScript.purchase = Purchase.generator;

Blockly.Blocks.sell_at_market = SellAtMarket.definition;
Blockly.JavaScript.sell_at_market = SellAtMarket.generator;

Blockly.Blocks.continuous_purchase = ContinuousPurchase.definition;
Blockly.JavaScript.continuous_purchase = ContinuousPurchase.generator;