export const REQUESTS = [
    'active_symbols',
    'authorize',
    'balance',
    'buy',
    'proposal',
    'proposal_open_contract',
    'transaction',
    'ticks_history',
    'history',
];

class APIMiddleware {
    constructor(config) {
        this.config = config;
        this.debounced_calls = {};
    }

    getRequestType = request => {
        let req_type;
        REQUESTS.forEach(type => {
            if (type in request && !req_type) req_type = type;
        });

        return req_type;
    };

    defineMeasure = res_type => {
        if (res_type) {
            let measure;
            if (res_type === 'history') {
                performance.mark('ticks_history_end');
                measure = performance.measure('ticks_history', 'ticks_history_start', 'ticks_history_end');
            } else {
                performance.mark(`${res_type}_end`);
                measure = performance.measure(`${res_type}`, `${res_type}_start`, `${res_type}_end`);
            }
            return (measure.startTimeDate = new Date(Date.now() - measure.startTime));
        }
        return false;
    };

    sendIsCalled = ({ response_promise, args: [request] }) => {
        const req_type = this.getRequestType(request);
        if (req_type) performance.mark(`${req_type}_start`);
        response_promise
            .then(res => {
                const res_type = this.getRequestType(res);
                if (res_type) {
                    this.defineMeasure(res_type);
                }
            })
            .catch(() => {});
        return response_promise;
    };

    processResponse = (response, req_type) => {
        switch (req_type) {
            case 'balance': {
                console.log('Balance response received:', response.balance);
                this.setBalance(response.balance);

                // Emit balance update event for demo accounts
                if (this.account_info?.is_virtual) {
                    this.observer.emit('balance.update', {
                        balance: response.balance.balance,
                        currency: response.balance.currency,
                        is_virtual: true
                    });
                }
                break;
            }
            case 'buy': {
                // Validate contract ID for demo accounts
                if (this.account_info?.is_virtual && response.buy) {
                    const contractId = response.buy.contract_id;
                    const contractIdStr = contractId?.toString();
                    
                    if (!contractIdStr || contractIdStr === 'undefined' || isNaN(contractId)) {
                        console.error('Invalid demo contract ID from API:', contractId);
                        // Don't process invalid contract responses
                        return;
                    }
                    
                    console.log(`Demo contract validated from API - ID: ${contractId}`);
                }
                break;
            }
            // Add other cases here as needed for other response types
        }
    }

    setBalance(balance) {
        // Implementation of setBalance
    }

    get account_info() {
        return this.config.account_info;
    }

    get observer() {
        return this.config.observer;
    }
}

export default APIMiddleware;