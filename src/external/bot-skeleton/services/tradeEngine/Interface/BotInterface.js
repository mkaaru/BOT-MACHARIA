import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';
import botStrategyManager from '../../bot-strategy-manager';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: (contract_type, tradeEachTick = false) => {
            // Apply contract type alternation strategy
            const actual_contract_type = botStrategyManager.getContractType(contract_type);
            return tradeEngine.purchase(actual_contract_type, tradeEachTick);
        },
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => {
            const is_result = getDetail(10) === result;
            
            // Update strategy based on result (only if we have a current contract type)
            if (is_result && tradeEngine.contractId) {
                const contract_type = botStrategyManager.current_contract_type;
                if (contract_type) {
                    botStrategyManager.updateResult(contract_type, result);
                }
            }
            
            return is_result;
        },
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getBotStrategyState: () => botStrategyManager.getState(),
        resetBotStrategy: () => botStrategyManager.reset(),
        setBotStrategyEnabled: (enabled) => botStrategyManager.setEnabled(enabled),
    };
};

const getProposal = (contract_type, tradeEngine) => {
    return tradeEngine.data.proposals.find(
        proposal =>
            proposal.contract_type === contract_type &&
            proposal.purchase_reference === tradeEngine.getPurchaseReference()
    );
};

const getSellPrice = tradeEngine => {
    return tradeEngine.getSellPrice();
};

export default getBotInterface;