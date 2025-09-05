
import { takeField } from '../utils/math';

export const hullMovingAverage = (data, { periods = 14 } = {}) => {
    if (periods <= 0 || periods > data.length) {
        throw new Error('Invalid periods specified for Hull Moving Average');
    }

    const prices = takeField(data, 'close');
    const hmaValues = [];

    // Calculate WMA for n periods
    const calculateWMA = (values, period) => {
        if (values.length < period) return null;
        
        const weights = [];
        let weightSum = 0;
        for (let i = 1; i <= period; i++) {
            weights.push(i);
            weightSum += i;
        }
        
        const recentValues = values.slice(-period);
        let weightedSum = 0;
        
        for (let i = 0; i < period; i++) {
            weightedSum += recentValues[i] * weights[i];
        }
        
        return weightedSum / weightSum;
    };

    for (let i = periods - 1; i < prices.length; i++) {
        const currentPrices = prices.slice(0, i + 1);
        
        // Step 1: Calculate WMA(n/2)*2
        const wmaHalf = calculateWMA(currentPrices, Math.floor(periods / 2));
        
        // Step 2: Calculate WMA(n)
        const wmaFull = calculateWMA(currentPrices, periods);
        
        if (wmaHalf !== null && wmaFull !== null) {
            // Step 3: Calculate 2*WMA(n/2) - WMA(n)
            const rawHMA = 2 * wmaHalf - wmaFull;
            
            // For the final HMA, we need to maintain a series of these raw values
            // and apply WMA(sqrt(n)) to them
            hmaValues.push(rawHMA);
            
            // Calculate final HMA using WMA of sqrt(periods)
            const sqrtPeriods = Math.floor(Math.sqrt(periods));
            if (hmaValues.length >= sqrtPeriods) {
                const finalHMA = calculateWMA(hmaValues, sqrtPeriods);
                if (finalHMA !== null) {
                    // Replace the last value with the actual HMA
                    hmaValues[hmaValues.length - 1] = finalHMA;
                }
            }
        }
    }

    return hmaValues;
};

export const hullMovingAverageArray = (data, config) => {
    return hullMovingAverage(data, config);
};
