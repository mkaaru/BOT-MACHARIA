
import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

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
        
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1)
    };
};

export default getBotInterface;
// BotInterface - Core bot functionality
class BotInterface {
    constructor() {
        this.is_running = false;
        this.contracts = [];
        this.balance = 0;
    }

    start() {
        console.log('Bot starting...');
        this.is_running = true;
        // Add bot start logic here
        return Promise.resolve();
    }

    stop() {
        console.log('Bot stopping...');
        this.is_running = false;
        // Add bot stop logic here
        return Promise.resolve();
    }

    isRunning() {
        return this.is_running;
    }

    getBalance() {
        return this.balance;
    }

    setBalance(balance) {
        this.balance = balance;
    }

    addContract(contract) {
        this.contracts.push(contract);
    }

    getContracts() {
        return this.contracts;
    }

    clearContracts() {
        this.contracts = [];
    }
}

export default new BotInterface();
