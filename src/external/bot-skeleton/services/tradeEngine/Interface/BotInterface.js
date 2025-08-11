
import { createDetails } from '../utils/details';

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
        
        // Enhanced bot interface methods for better martingale control
        canMakeNextPurchase: () => {
            // Check if bot can make next purchase based on current state
            const isProcessing = tradeEngine.isProcessingTrade || false;
            const hasActiveContract = tradeEngine.getOpenContract && tradeEngine.getOpenContract() && !tradeEngine.getOpenContract().is_sold;
            const contractData = tradeEngine.data?.contract;
            const hasUnfinishedContract = contractData && !contractData.is_sold && contractData.contract_id;
            
            const canPurchase = !isProcessing && !hasActiveContract && !hasUnfinishedContract;
            
            if (!canPurchase) {
                console.log('🔒 PURCHASE CHECK: Cannot make next purchase', {
                    processing: isProcessing,
                    activeContract: hasActiveContract,
                    unfinishedContract: hasUnfinishedContract
                });
            }
            
            return canPurchase;
        },
        
        // Enhanced martingale methods
        configureMartingale: (config) => {
            if (tradeEngine.configureMartingaleFromBot) {
                tradeEngine.martingaleState = {
                    ...tradeEngine.martingaleState,
                    ...config,
                    isEnabled: config.enabled !== undefined ? config.enabled : true
                };
                console.log('🔧 MARTINGALE: Configuration updated via interface', tradeEngine.martingaleState);
            }
        },
        
        applyMartingaleLogic: (profit) => {
            if (tradeEngine.applyMartingaleLogicImmediate) {
                tradeEngine.applyMartingaleLogicImmediate(profit);
            }
        },
        
        resetMartingale: () => {
            if (tradeEngine.resetMartingale) {
                tradeEngine.resetMartingale();
            }
        },
        
        getMartingaleState: () => {
            return tradeEngine.martingaleState || {};
        },
        
        // Enhanced contract waiting
        waitForContractCompletion: (callback) => {
            if (tradeEngine.waitForContractCompletion) {
                tradeEngine.waitForContractCompletion(callback);
            } else if (callback) {
                callback();
            }
        },
        
        // Force release contract wait state
        forceContractRelease: () => {
            if (tradeEngine.forceContractRelease) {
                tradeEngine.forceContractRelease();
            }
        },
        
        // Get current trade timing information
        getTradeTimingInfo: () => {
            return {
                lastPurchaseTime: tradeEngine.lastPurchaseTime || 0,
                minimumDelay: tradeEngine.minimumTradeDelay || 1000,
                isProcessing: tradeEngine.isProcessingTrade || false,
                canPurchaseNow: tradeEngine.canMakeNextPurchase ? tradeEngine.canMakeNextPurchase() : true
            };
        }
    };
};

export default getBotInterface;
