/**
 * Direct Trade Executor Service
 * 
 * Executes trades directly via Deriv API without Bot Builder
 * Bypasses Blockly XML generation and uses WebSocket API directly
 */

import { generateDerivApiInstance, V2GetActiveToken, V2GetActiveClientId } from '@/external/bot-skeleton/services/api/appId';

export interface DirectTradeParams {
    symbol: string;
    contract_type: 'CALL' | 'PUT' | 'CALLE' | 'PUTE';
    stake: number;
    duration: number;
    duration_unit: 't' | 's' | 'm' | 'h' | 'd';
    currency?: string;
}

export interface DirectTradeResult {
    success: boolean;
    contract_id?: string;
    buy_price?: number;
    payout?: number;
    error?: string;
    longcode?: string;
}

/**
 * Execute a direct contract purchase via Deriv API
 * This bypasses the Bot Builder entirely
 */
export async function executeDirectTrade(params: DirectTradeParams): Promise<DirectTradeResult> {
    const api = generateDerivApiInstance();
    
    try {
        // Step 1: Authorize if needed
        const token = V2GetActiveToken();
        if (!token) {
            return {
                success: false,
                error: 'No authentication token found. Please log in.'
            };
        }

        const { authorize, error: authError } = await api.authorize(token);
        if (authError) {
            return {
                success: false,
                error: `Authorization failed: ${authError.message || authError.code}`
            };
        }

        const currency = params.currency || authorize?.currency || 'USD';

        // Step 2: Get proposal (price quote)
        console.log('📤 Requesting proposal for direct trade:', params);
        
        const proposalParams = {
            proposal: 1,
            amount: params.stake,
            basis: 'stake',
            contract_type: params.contract_type,
            currency,
            duration: params.duration,
            duration_unit: params.duration_unit,
            symbol: params.symbol
        };

        const proposalResponse = await api.send(proposalParams);

        if (proposalResponse.error) {
            console.error('❌ Proposal error:', proposalResponse.error);
            return {
                success: false,
                error: `Proposal failed: ${proposalResponse.error.message || proposalResponse.error.code}`
            };
        }

        if (!proposalResponse.proposal) {
            return {
                success: false,
                error: 'No proposal received from API'
            };
        }

        // Step 3: Purchase the contract
        console.log('💰 Purchasing contract with proposal ID:', proposalResponse.proposal.id);
        
        const buyResponse = await api.send({
            buy: proposalResponse.proposal.id,
            price: params.stake
        });

        if (buyResponse.error) {
            console.error('❌ Purchase error:', buyResponse.error);
            return {
                success: false,
                error: `Purchase failed: ${buyResponse.error.message || buyResponse.error.code}`
            };
        }

        if (buyResponse.buy) {
            const result = {
                success: true,
                contract_id: buyResponse.buy.contract_id,
                buy_price: parseFloat(buyResponse.buy.buy_price),
                payout: parseFloat(buyResponse.buy.payout || 0),
                longcode: buyResponse.buy.longcode
            };

            console.log('✅ Contract purchased successfully:', result);
            return result;
        }

        return {
            success: false,
            error: 'Unexpected API response'
        };

    } catch (error: any) {
        console.error('❌ Direct trade execution error:', error);
        return {
            success: false,
            error: error.message || 'Unknown error occurred'
        };
    } finally {
        // Cleanup: disconnect the API instance
        try {
            api?.disconnect?.();
        } catch (e) {
            // Silent cleanup
        }
    }
}

/**
 * Helper function to map recommendation action to Deriv contract type
 * 
 * IMPORTANT: For TICK-BASED contracts (duration_unit: 't'), ALWAYS use CALL/PUT
 * CALLE/PUTE are only for TIME-BASED Rise/Fall contracts (duration_unit: 's', 'm', 'h', 'd')
 */
export function getContractTypeFromAction(action: 'RISE' | 'FALL', durationUnit: 't' | 's' | 'm' | 'h' | 'd' = 't'): 'CALL' | 'PUT' | 'CALLE' | 'PUTE' {
    // For tick-based contracts, ALWAYS use CALL/PUT regardless of symbol
    if (durationUnit === 't') {
        return action === 'RISE' ? 'CALL' : 'PUT';
    }
    
    // For time-based contracts, use CALLE/PUTE (Rise/Fall)
    return action === 'RISE' ? 'CALLE' : 'PUTE';
}
