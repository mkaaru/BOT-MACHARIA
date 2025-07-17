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

        // Method to update trade results
        updateTradeResult: (profit) => tradeEngine.updateTradeResult?.(profit),

        // Utility methods
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getTotalRuns: () => tradeEngine.totalRuns,
        shouldContinueTrading: () => tradeEngine.shouldContinueTrading?.() || true,

        /**
         * Purchase a contract
         * @param {Object} options - Purchase options
         */
        async purchase(options) {
            try {
                console.log('🚀 BotInterface: Purchasing contract with options:', options);

                // Set trade options
                if (options.amount) tradeEngine.tradeOptions.amount = options.amount;
                if (options.duration) tradeEngine.tradeOptions.duration = options.duration;
                if (options.duration_unit) tradeEngine.tradeOptions.duration_unit = options.duration_unit;
                if (options.symbol) tradeEngine.tradeOptions.symbol = options.symbol;
                if (options.contract_type) tradeEngine.tradeOptions.contract_type = options.contract_type;
                if (options.currency) tradeEngine.tradeOptions.currency = options.currency;
                if (options.basis) tradeEngine.tradeOptions.basis = options.basis;
                if (options.barrier) tradeEngine.tradeOptions.barrier = options.barrier;

                // Execute purchase through trade engine
                const result = await tradeEngine.purchase(options.contract_type || 'DIGITEVEN');
                console.log('✅ BotInterface: Purchase completed:', result);

                return result;
            } catch (error) {
                console.error('❌ BotInterface: Purchase failed:', error);
                throw error;
            }
        },

        /**
         * Set continuous purchase mode
         * @param {boolean} continuous - True for continuous, false for sequential
         */
        setContinuousMode(continuous) {
            if (tradeEngine && typeof tradeEngine.setContinuousMode === 'function') {
                tradeEngine.setContinuousMode(continuous);
                console.log(`🔧 BotInterface: Continuous mode set to ${continuous ? 'Continuous' : 'Sequential'}`);
            } else {
                console.warn('⚠️ BotInterface: setContinuousMode not available on trade engine');
            }
        },

        /**
         * Get martingale state
         */
        getMartingaleState() {
            if (tradeEngine && tradeEngine.getMartingaleMultiplier) {
                return {
                    multiplier: tradeEngine.getMartingaleMultiplier(),
                    consecutiveLosses: tradeEngine.getConsecutiveLosses(),
                    baseAmount: tradeEngine.getBaseAmount(),
                    totalProfit: tradeEngine.getTotalProfit(),
                    lastTradeProfit: tradeEngine.getLastTradeProfit()
                };
            }
            return null;
        },

        /**
         * Reset martingale strategy
         */
        resetMartingale() {
            if (tradeEngine && typeof tradeEngine.resetMartingale === 'function') {
                tradeEngine.resetMartingale();
                console.log('🔄 BotInterface: Martingale strategy reset');
            }
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