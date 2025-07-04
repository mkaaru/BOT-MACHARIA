import './trade_definition';
import './trade_definition_market';
import './trade_definition_tradetype';
import './trade_definition_contracttype';
import './trade_definition_candleinterval';
import './trade_definition_restartbuysell';
import './trade_definition_restartonerror';
import './trade_definition_tradeoptions';
import './trade_definition_multiplier';
import './multiplier_stop_loss';
import './accumulator_take_profit';
import './multiplier_take_profit';
import './trade_definition_accumulator';
import trade_definition_multi from './trade_definition_multi';

// Create default exports for missing modules
const trade_definition_accumulator = (Blockly) => {
    // Placeholder for accumulator trade definition
    console.log('Accumulator trade definition loaded');
};

const trade_definition_multiplier = (Blockly) => {
    // Placeholder for multiplier trade definition
    console.log('Multiplier trade definition loaded');
};

const trade_definition_tradeoptions = (Blockly) => {
    // Placeholder for trade options definition
    console.log('Trade options definition loaded');
};

export default ((Blockly)=>{
    trade_definition_accumulator(Blockly);
    trade_definition_multiplier(Blockly);
    trade_definition_tradeoptions(Blockly);
    trade_definition_multi(Blockly);
});