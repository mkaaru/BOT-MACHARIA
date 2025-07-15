import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: parameters => {
            return new Promise((resolve, reject) => {
                const { contract_type, amount, basis, duration, duration_unit, symbol, prediction, execution_mode } = parameters;
                const proposal = getProposal(contract_type, tradeEngine);

                if (!proposal) {
                    reject(new Error('No proposal available'));
                    return;
                }

                const buy_parameters = {
                    buy: proposal.id,
                    price: proposal.ask_price,
                    parameters: parameters,
                    execution_mode: execution_mode || 'NORMAL',
                };

                // Handle tick execution mode
                if (execution_mode === 'EVERY_TICK') {
                    tradeEngine.setupTickExecution(buy_parameters);
                } else {
                    tradeEngine.api.buy(buy_parameters).then(resolve).catch(reject);
                }
            });
        },

        setupTickExecution: buy_parameters => {
            // Set up tick-based execution
            tradeEngine.tick_execution_active = true;
            tradeEngine.tick_execution_params = buy_parameters;

            // Subscribe to tick stream if not already subscribed
            if (!tradeEngine.tick_subscription) {
                tradeEngine.tick_subscription = tradeEngine.api.subscribeTicks(buy_parameters.parameters.symbol, (tick) => {
                    if (tradeEngine.tick_execution_active) {
                        tradeEngine.executeOnTick(tick);
                    }
                });
            }
        },

        executeOnTick: tick => {
            if (!tradeEngine.tick_execution_active || !tradeEngine.tick_execution_params) return;

            // Prevent multiple simultaneous executions
            if (tradeEngine.executing_tick_trade) return;

            tradeEngine.executing_tick_trade = true;

            // Execute the purchase
            tradeEngine.api.buy(tradeEngine.tick_execution_params)
                .then((result) => {
                    globalObserver.emit('bot.purchase', result);
                    tradeEngine.executing_tick_trade = false;
                })
                .catch((error) => {
                    globalObserver.emit('bot.error', error);
                    tradeEngine.executing_tick_trade = false;
                });
        },

        stopTickExecution: () => {
            tradeEngine.tick_execution_active = false;
            tradeEngine.tick_execution_params = null;
            tradeEngine.executing_tick_trade = false;

            if (tradeEngine.tick_subscription) {
                tradeEngine.tick_subscription.unsubscribe();
                tradeEngine.tick_subscription = null;
            }
        },
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
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