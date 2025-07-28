import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: contract_type => {
            return tradeEngine.purchase(contract_type);
        },
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,

        // Simplified martingale interface - delegates to tradeEngine
        getMartingaleMultiplier: () => tradeEngine.getMartingaleMultiplier?.() || 1,
        getConsecutiveLosses: () => tradeEngine.getConsecutiveLosses?.() || 0,
        getBaseAmount: () => tradeEngine.getBaseAmount?.() || null,
        getLastTradeProfit: () => tradeEngine.getLastTradeProfit?.() || 0,
        getCurrentPurchasePrice: () => tradeEngine.getCurrentPurchasePrice?.() || 0,
        getTotalProfit: () => tradeEngine.getTotalProfit?.() || 0,
        
        // Martingale control methods
        setMartingaleEnabled: (enabled) => tradeEngine.setMartingaleEnabled?.(enabled),
        setMartingaleLimits: (maxMultiplier, maxConsecutiveLosses) => tradeEngine.setMartingaleLimits?.(maxMultiplier, maxConsecutiveLosses),
        updateTradeResult: (profit) => tradeEngine.updateTradeResult?.(profit),

        // Method to update trade results
        updateTradeResult: (profit) => tradeEngine.updateTradeResult?.(profit),
        
        // Check if waiting for contract to close
        isWaitingForContractClose: () => tradeEngine.isWaitingForContractClose || false,

        // Utility methods
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getTotalRuns: () => tradeEngine.totalRuns,
        shouldContinueTrading: () => tradeEngine.shouldContinueTrading?.() || true,
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