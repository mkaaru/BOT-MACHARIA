import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: contract_type => tradeEngine.purchase(contract_type),
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
        
        // Sequential trading methods
        isWaitingForContractClose: () => tradeEngine.isWaitingForContractClose || false,
        isWaitingForContractClosure: () => tradeEngine.isWaitingForContractClosure || false,
        canMakeNextPurchase: () => tradeEngine.canMakeNextPurchase?.() || true,
        forceReleaseContractWait: () => tradeEngine.forceReleaseContractWait?.(),

        // Utility methods
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getTotalRuns: () => tradeEngine.totalRuns,
        shouldContinueTrading: () => tradeEngine.shouldContinueTrading?.() || true,
        
        // Auto-trading functionality
        executeAutoTrade: async () => {
            try {
                // Import market analyzer dynamically
                const { default: marketAnalyzer } = await import('../../../../../../../services/market-analyzer');
                
                if (!marketAnalyzer.isReadyForTrading()) {
                    console.log('⏳ Market analyzer not ready, starting...');
                    marketAnalyzer.start();
                    await marketAnalyzer.waitForAnalysisReady();
                }
                
                const recommendation = await marketAnalyzer.getLatestRecommendation();
                
                if (recommendation && tradeEngine.canMakeNextPurchase()) {
                    console.log('🎯 Auto-trade recommendation:', recommendation);
                    
                    // Determine contract type based on recommendation
                    let contractType;
                    if (recommendation.strategy === 'over') {
                        contractType = 'DIGITOVER';
                    } else if (recommendation.strategy === 'under') {
                        contractType = 'DIGITUNDER';
                    }
                    
                    if (contractType) {
                        console.log('🚀 Executing auto-trade:', contractType, 'on', recommendation.symbol);
                        return tradeEngine.purchase(contractType);
                    }
                }
                
                console.log('⏳ No valid trading signal available');
                return Promise.resolve();
            } catch (error) {
                console.error('❌ Auto-trade execution error:', error);
                return Promise.resolve();
            }
        },
        
        canMakeNextPurchase: () => {
            const state = tradeEngine.store.getState();
            return state.scope === 'BEFORE_PURCHASE' && !tradeEngine.isWaitingForContractClose;
        },
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