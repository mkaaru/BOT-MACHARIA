import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];
    
    // Store interface state
    let stake = 1;
    let martingale_multiplier = 1;

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
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getStake: () => stake,
        setStake: s => {
            stake = s;
            globalObserver.emit('bot.set_stake', s);
        },
        getMartingaleMultiplier: () => martingale_multiplier,
        setMartingaleMultiplier: m => {
            martingale_multiplier = m;
            globalObserver.emit('bot.set_martingale_multiplier', m);
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