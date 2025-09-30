import { getRoundedNumber } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import { LogTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { info, log } from '../utils/broadcast';

const skeleton = {
    totalProfit: 0,
    totalWins: 0,
    totalLosses: 0,
    totalStake: 0,
    totalPayout: 0,
    totalRuns: 0,
};

const globalStat = {};

export default Engine =>
    class Total extends Engine {
        constructor() {
            super();
            this.sessionRuns = 0;
            this.sessionProfit = 0;

            // Register for statistics clearing and external trade results
            globalObserver.register('statistics.clear', this.clearStatistics.bind(this));
            globalObserver.register('external.trade.result', this.handleExternalTradeResult.bind(this));
            globalObserver.register('external.trade.run', this.handleExternalTradeRun.bind(this));
        }

        // Handle trade results from external engines (Smart Trader, ML Trader, etc.)
        handleExternalTradeResult(tradeData) {
            if (!this.accountInfo) return;
            
            const { 
                sell_price: sellPrice, 
                buy_price: buyPrice, 
                currency,
                profit: providedProfit,
                is_win
            } = tradeData;

            // Use provided profit if available, otherwise calculate it
            const profit = providedProfit !== undefined ? 
                Number(providedProfit) : 
                getRoundedNumber(Number(sellPrice || 0) - Number(buyPrice || 0), currency);

            const win = is_win !== undefined ? is_win : profit > 0;

            const accountStat = this.getAccountStat();

            // Update win/loss counts
            if (win) {
                accountStat.totalWins += 1;
            } else {
                accountStat.totalLosses += 1;
            }

            // Update session and total profit
            this.sessionProfit = getRoundedNumber(Number(this.sessionProfit) + profit, currency);
            accountStat.totalProfit = getRoundedNumber(Number(accountStat.totalProfit) + profit, currency);

            // Update stake and payout totals
            if (buyPrice) {
                accountStat.totalStake = getRoundedNumber(Number(accountStat.totalStake) + Number(buyPrice), currency);
            }
            if (sellPrice) {
                accountStat.totalPayout = getRoundedNumber(Number(accountStat.totalPayout) + Number(sellPrice), currency);
            }

            // Broadcast the information
            this.broadcastStatistics(profit, tradeData, accountStat, currency);

            // Log the result
            log(win ? LogTypes.PROFIT : LogTypes.LOST, { currency, profit: Math.abs(profit) });
        }

        // Handle run count updates from external engines
        handleExternalTradeRun() {
            if (!this.accountInfo) return;
            
            this.sessionRuns++;
            const accountStat = this.getAccountStat();
            accountStat.totalRuns++;

            // Emit statistics update for run count
            globalObserver.emit('statistics.update', {
                totalProfit: accountStat.totalProfit,
                totalWins: accountStat.totalWins,
                totalLosses: accountStat.totalLosses,
                totalStake: accountStat.totalStake,
                totalPayout: accountStat.totalPayout,
                totalRuns: accountStat.totalRuns,
                currency: this.accountInfo?.currency || 'USD'
            });

            return accountStat.totalRuns;
        }

        // Centralized statistics broadcasting
        broadcastStatistics(profit, contract, accountStat, currency) {
            info({
                profit,
                contract,
                accountID: this.accountInfo.loginid,
                totalProfit: accountStat.totalProfit,
                totalWins: accountStat.totalWins,
                totalLosses: accountStat.totalLosses,
                totalStake: accountStat.totalStake,
                totalPayout: accountStat.totalPayout,
                totalRuns: accountStat.totalRuns,
            });

            // Emit statistics update for run panel
            globalObserver.emit('statistics.update', {
                totalProfit: accountStat.totalProfit,
                totalWins: accountStat.totalWins,
                totalLosses: accountStat.totalLosses,
                totalStake: accountStat.totalStake,
                totalPayout: accountStat.totalPayout,
                totalRuns: accountStat.totalRuns,
                currency
            });
        }

        clearStatistics() {
            this.sessionRuns = 0;
            this.sessionProfit = 0;
            if (!this.accountInfo) return;
            const { loginid: accountID } = this.accountInfo;
            globalStat[accountID] = { ...skeleton };
        }

        updateTotals(contract) {
            const { sell_price: sellPrice, buy_price: buyPrice, currency } = contract;

            // Ensure proper number conversion and handle potential undefined values
            const sellPriceNum = Number(sellPrice) || 0;
            const buyPriceNum = Number(buyPrice) || 0;

            // Calculate actual profit/loss - negative values indicate losses
            const profit = getRoundedNumber(sellPriceNum - buyPriceNum, currency);

            const win = profit > 0;

            const accountStat = this.getAccountStat();

            // Update win/loss counts - contracts with profit <= 0 are losses
            if (win) {
                accountStat.totalWins += 1;
            } else {
                accountStat.totalLosses += 1;
            }

            // Update session profit (can be negative for losses)
            this.sessionProfit = getRoundedNumber(Number(this.sessionProfit) + profit, currency);

            // Update total profit (can be negative for overall losses)
            accountStat.totalProfit = getRoundedNumber(Number(accountStat.totalProfit) + profit, currency);

            // Update stake and payout totals
            accountStat.totalStake = getRoundedNumber(Number(accountStat.totalStake) + buyPriceNum, currency);
            accountStat.totalPayout = getRoundedNumber(Number(accountStat.totalPayout) + sellPriceNum, currency);

            // Use centralized broadcasting
            this.broadcastStatistics(profit, contract, accountStat, currency);

            // Log with proper profit/loss indication
            log(win ? LogTypes.PROFIT : LogTypes.LOST, { currency, profit: Math.abs(profit) });
        }

        updateAndReturnTotalRuns() {
            this.sessionRuns++;
            const accountStat = this.getAccountStat();
            accountStat.totalRuns++;

            // Emit statistics update for run count
            globalObserver.emit('statistics.update', {
                totalProfit: accountStat.totalProfit,
                totalWins: accountStat.totalWins,
                totalLosses: accountStat.totalLosses,
                totalStake: accountStat.totalStake,
                totalPayout: accountStat.totalPayout,
                totalRuns: accountStat.totalRuns,
                currency: this.accountInfo?.currency || 'USD'
            });

            return accountStat.totalRuns;
        }

        /* eslint-disable class-methods-use-this */
        getTotalRuns() {
            const accountStat = this.getAccountStat();
            return accountStat.totalRuns;
        }

        getTotalProfit(toString, currency) {
            const accountStat = this.getAccountStat();

            return toString && accountStat.totalProfit !== 0
                ? getRoundedNumber(+accountStat.totalProfit, currency)
                : +accountStat.totalProfit;
        }

        /* eslint-enable */
        checkLimits(tradeOption) {
            if (!tradeOption.limitations) {
                return;
            }

            const {
                limitations: { maxLoss, maxTrades },
            } = tradeOption;

            if (maxLoss && maxTrades) {
                if (this.sessionRuns >= maxTrades) {
                    throw createError('CustomLimitsReached', localize('Maximum number of trades reached'));
                }
                if (this.sessionProfit <= -maxLoss) {
                    throw createError('CustomLimitsReached', localize('Maximum loss amount reached'));
                }
            }
        }

        /* eslint-disable class-methods-use-this */
        validateTradeOptions(tradeOptions) {
            const take_profit = tradeOptions.take_profit;
            const stop_loss = tradeOptions.stop_loss;

            if (take_profit) {
                tradeOptions.limit_order.take_profit = take_profit;
            }
            if (stop_loss) {
                tradeOptions.limit_order.stop_loss = stop_loss;
            }

            return tradeOptions;
        }

        getAccountStat() {
            const { loginid: accountID } = this.accountInfo;

            if (!(accountID in globalStat)) {
                globalStat[accountID] = { ...skeleton };
            }

            return globalStat[accountID];
        }
    };