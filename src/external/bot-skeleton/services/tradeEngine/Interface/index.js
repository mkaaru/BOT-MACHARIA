import TradeEngine from '../trade';
import getBotInterface from './BotInterface';
import getTicksInterface from './TicksInterface';
import getToolsInterface from './ToolsInterface';

const sleep = (observer, arg = 1) => {
    return new Promise(
        r =>
            // eslint-disable-next-line no-promise-executor-return
            setTimeout(() => {
                r();
                setTimeout(() => observer.emit('CONTINUE'), 0);
            }, arg * 1000),
        () => {}
    );
};

const Interface = $scope => {
    // Validate $scope parameter
    if (!$scope || !$scope.observer) {
        console.error('Invalid scope provided to Interface');
        throw new Error('Invalid scope provided to Interface');
    }

    let tradeEngine;
    try {
        tradeEngine = new TradeEngine($scope);
    } catch (error) {
        console.error('Failed to create TradeEngine:', error);
        throw new Error('Failed to create TradeEngine: ' + error.message);
    }

    const { observer } = $scope;
    
    const getInterface = () => {
        // Validate tradeEngine is properly initialized
        if (!tradeEngine) {
            console.error('TradeEngine is not initialized');
            throw new Error('TradeEngine is not initialized');
        }
        
        let botInterface;
        try {
            botInterface = getBotInterface(tradeEngine);
        } catch (error) {
            console.error('Failed to create bot interface:', error);
            throw new Error('Failed to create bot interface: ' + error.message);
        }
        
        if (!botInterface) {
            console.error('getBotInterface returned null or undefined');
            throw new Error('getBotInterface returned null or undefined');
        }
        
        try {
            return {
                ...botInterface,
                ...getToolsInterface(tradeEngine),
                getTicksInterface: getTicksInterface(tradeEngine),
                watch: (...args) => tradeEngine.watch(...args),
            sleep: (...args) => sleep(observer, ...args),
            alert: (...args) => alert(...args), // eslint-disable-line no-alert
            prompt: (...args) => prompt(...args), // eslint-disable-line no-alert
            console: {
                log(...args) {
                    // eslint-disable-next-line no-console
                    console.log(new Date().toLocaleTimeString(), ...args);
                },
            },
            };
        } catch (error) {
            console.error('Failed to create interface object:', error);
            throw new Error('Failed to create interface object: ' + error.message);
        }
    };
    return { tradeEngine, observer, getInterface };
};

export default Interface;
