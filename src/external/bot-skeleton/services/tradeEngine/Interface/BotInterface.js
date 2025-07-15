import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];
    
    // Store interface state
    let stake = 1;
    let martingale_multiplier = 2;
    let initial_stake = 1;
    let current_martingale_multiplier = 1;

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: (contract_type, custom_stake) => {
            const purchase_stake = custom_stake || stake;
            return tradeEngine.purchase(contract_type, purchase_stake);
        },
        getAskPrice: contract_type => {
            const proposal = getProposal(contract_type, tradeEngine);
            return proposal ? Number(proposal.ask_price) : 0;
        },
        getPayout: contract_type => {
            const proposal = getProposal(contract_type, tradeEngine);
            return proposal ? Number(proposal.payout) : 0;
        },
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,
        isTradeAgain: result => {
            // Implement martingale logic here
            const contract_result = getDetail(10);
            
            if (contract_result === 'win') {
                // Reset stake to initial on win
                stake = initial_stake;
                current_martingale_multiplier = 1;
            } else if (contract_result === 'loss') {
                // Increase stake by multiplier on loss
                current_martingale_multiplier *= martingale_multiplier;
                stake = initial_stake * current_martingale_multiplier;
            }
            
            globalObserver.emit('bot.trade_again', result);
            return result;
        },
        readDetails: i => getDetail(i - 1),
        getStake: () => stake,
        setStake: s => {
            stake = s;
            if (initial_stake === 1) {
                initial_stake = s; // Set initial stake only once
            }
            globalObserver.emit('bot.set_stake', s);
        },
        getMartingaleMultiplier: () => martingale_multiplier,
        setMartingaleMultiplier: m => {
            martingale_multiplier = m;
            globalObserver.emit('bot.set_martingale_multiplier', m);
        },
        // Additional helper methods for martingale
        resetMartingale: () => {
            stake = initial_stake;
            current_martingale_multiplier = 1;
        },
        getInitialStake: () => initial_stake,
        setInitialStake: s => {
            initial_stake = s;
            stake = s;
            current_martingale_multiplier = 1;
        }
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