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
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getTotalRuns: () => tradeEngine.totalRuns,
        getTotalProfit: () => tradeEngine.totalProfit,
        getMartingaleMultiplier: () => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const multiplierVar = workspace.getVariableById('FRbI:RhI/`[lrO`o;=P,');
                if (multiplierVar) {
                    const variableModel = workspace.getVariableMap().getVariableById('FRbI:RhI/`[lrO`o;=P,');
                    return variableModel ? parseFloat(variableModel.name.split(':')[1]) || 1 : 1;
                }
            }
            return 1;
        },
        getProfitThreshold: () => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const profitVar = workspace.getVariableById('*p5|Lkk9Q^ZuPBQ-48g2');
                if (profitVar) {
                    return parseFloat(profitVar) || Infinity;
                }
            }
            return Infinity;
        },
        getLossThreshold: () => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const lossVar = workspace.getVariableById('a1BTYNHC?_yR4sfvNJ7N');
                if (lossVar) {
                    return parseFloat(lossVar) || -Infinity;
                }
            }
            return -Infinity;
        },
        getLastTradeProfit: () => {
            return tradeEngine.lastTradeProfit || 0;
        },
        setMartingaleMultiplier: (multiplier) => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const multiplierVar = workspace.getVariableById('FRbI:RhI/`[lrO`o;=P,');
                if (multiplierVar) {
                    tradeEngine.martingaleMultiplier = multiplier;
                    return true;
                }
            }
            return false;
        },
        getConsecutiveLosses: () => {
            return tradeEngine.consecutiveLosses || 0;
        },
        setCurrentPurchasePrice: (price) => {
            tradeEngine.currentPurchasePrice = price;
        },
        getCurrentPurchasePrice: () => {
            return tradeEngine.currentPurchasePrice || 0;
        },
        setBaseAmount: (amount) => {
            tradeEngine.baseAmount = amount;
        },
        getBaseAmount: () => {
            return tradeEngine.baseAmount || null;
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
```

```
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
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
        getTotalRuns: () => tradeEngine.totalRuns,
        getTotalProfit: () => tradeEngine.totalProfit,
        getMartingaleMultiplier: () => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const multiplierVar = workspace.getVariableById('FRbI:RhI/`[lrO`o;=P,');
                if (multiplierVar) {
                    const variableModel = workspace.getVariableMap().getVariableById('FRbI:RhI/`[lrO`o;=P,');
                    return variableModel ? parseFloat(variableModel.name.split(':')[1]) || 1 : 1;
                }
            }
            return 1;
        },
        getProfitThreshold: () => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const profitVar = workspace.getVariableById('*p5|Lkk9Q^ZuPBQ-48g2');
                if (profitVar) {
                    return parseFloat(profitVar) || Infinity;
                }
            }
            return Infinity;
        },
        getLossThreshold: () => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const lossVar = workspace.getVariableById('a1BTYNHC?_yR4sfvNJ7N');
                if (lossVar) {
                    return parseFloat(lossVar) || -Infinity;
                }
            }
            return -Infinity;
        },
        getLastTradeProfit: () => {
            return tradeEngine.lastTradeProfit || 0;
        },
        setMartingaleMultiplier: (multiplier) => {
            const workspace = Blockly.getMainWorkspace();
            if (workspace) {
                const multiplierVar = workspace.getVariableById('FRbI:RhI/`[lrO`o;=P,');
                if (multiplierVar) {
                    tradeEngine.martingaleMultiplier = multiplier;
                    return true;
                }
            }
            return false;
        },
        getConsecutiveLosses: () => {
            return tradeEngine.consecutiveLosses || 0;
        },
        setCurrentPurchasePrice: (price) => {
            tradeEngine.currentPurchasePrice = price;
        },
        getCurrentPurchasePrice: () => {
            return tradeEngine.currentPurchasePrice || 0;
        },
        setBaseAmount: (amount) => {
            tradeEngine.baseAmount = amount;
        },
        getBaseAmount: () => {
            return tradeEngine.baseAmount || null;
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