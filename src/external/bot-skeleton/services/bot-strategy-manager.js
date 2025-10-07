/**
 * Bot Strategy Manager
 * Handles intelligent contract type alternation strategy for Bot Builder
 * 
 * Strategy:
 * 1. Start with Equals contracts (PUTE/CALLE)
 * 2. On loss: Switch to Plain contracts (PUT/CALL) 
 * 3. Continue alternating on each loss
 * 4. On win: Reset to Equals mode
 */

class BotStrategyManager {
    constructor() {
        this.strategy_state = {
            CALL: { mode: 'EQUALS', consecutive_losses: 0 },
            PUT: { mode: 'EQUALS', consecutive_losses: 0 }
        };
        this.last_contract_type = null;
        this.current_contract_type = null;
        this.enabled = true;
    }

    /**
     * Get the contract type to use based on alternation strategy
     * @param {string} requested_type - The contract type from the block (CALL/PUT/CALLE/PUTE)
     * @returns {string} - The actual contract type to use
     */
    getContractType(requested_type) {
        if (!this.enabled) {
            return requested_type;
        }

        // Normalize to base type (CALL/PUT)
        const base_type = requested_type.replace('E', '');
        
        // Check if this is a manual override (user specifically chose equals type)
        if (requested_type.endsWith('E') && this.strategy_state[base_type].mode === 'PLAIN') {
            // User wants equals, but we're in plain mode - allow user override
            console.log(`[Bot Strategy] User override: ${requested_type} (ignoring strategy mode)`);
            return requested_type;
        }

        const state = this.strategy_state[base_type];
        let actual_type;

        if (state.mode === 'EQUALS') {
            // Equals mode: CALL → CALLE, PUT → PUTE
            actual_type = base_type + 'E';
        } else {
            // Plain mode: use base type
            actual_type = base_type;
        }

        if (actual_type !== requested_type) {
            console.log(`[Bot Strategy] Alternation applied: ${requested_type} → ${actual_type} (Mode: ${state.mode}, Losses: ${state.consecutive_losses})`);
        }

        this.current_contract_type = actual_type;
        return actual_type;
    }

    /**
     * Update strategy based on trade result
     * @param {string} contract_type - The contract type that was executed
     * @param {string} result - 'win' or 'loss'
     */
    updateResult(contract_type, result) {
        if (!this.enabled) {
            return;
        }

        const base_type = contract_type.replace('E', '');
        const state = this.strategy_state[base_type];

        if (result === 'win') {
            console.log(`[Bot Strategy] WIN on ${contract_type} - Resetting ${base_type} to EQUALS mode`);
            state.mode = 'EQUALS';
            state.consecutive_losses = 0;
        } else if (result === 'loss') {
            state.consecutive_losses++;
            const old_mode = state.mode;
            state.mode = state.mode === 'EQUALS' ? 'PLAIN' : 'EQUALS';
            console.log(`[Bot Strategy] LOSS on ${contract_type} - Switching ${base_type} from ${old_mode} to ${state.mode} (Loss #${state.consecutive_losses})`);
        }
    }

    /**
     * Reset strategy state
     */
    reset() {
        this.strategy_state = {
            CALL: { mode: 'EQUALS', consecutive_losses: 0 },
            PUT: { mode: 'EQUALS', consecutive_losses: 0 }
        };
        console.log('[Bot Strategy] Strategy reset to EQUALS mode');
    }

    /**
     * Enable/disable strategy
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[Bot Strategy] Alternation strategy ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    /**
     * Get current strategy state
     */
    getState() {
        return {
            ...this.strategy_state,
            enabled: this.enabled
        };
    }
}

// Create singleton instance
const botStrategyManager = new BotStrategyManager();

export default botStrategyManager;
