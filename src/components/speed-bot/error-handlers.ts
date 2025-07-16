
export interface TradeError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
  retryable: boolean;
  retryDelay?: number;
}

export const ERROR_CODES = {
  // Connection errors
  WEBSOCKET_DISCONNECTED: 'WEBSOCKET_DISCONNECTED',
  CONNECTION_LOST: 'CONNECTION_LOST',
  NETWORK_ERROR: 'NETWORK_ERROR',
  
  // Authentication errors
  INVALID_TOKEN: 'INVALID_TOKEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // Trading errors
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_CONTRACT: 'INVALID_CONTRACT',
  MARKET_CLOSED: 'MARKET_CLOSED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  PROPOSAL_EXPIRED: 'PROPOSAL_EXPIRED',
  RATE_LIMIT: 'RATE_LIMIT',
  
  // Contract-specific errors
  INVALID_BARRIER: 'INVALID_BARRIER',
  INVALID_STAKE: 'INVALID_STAKE',
  UNSUPPORTED_SYMBOL: 'UNSUPPORTED_SYMBOL',
  CONTRACT_VALIDATION_ERROR: 'CONTRACT_VALIDATION_ERROR',
  
  // System errors
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

export const createTradeError = (
  code: string,
  message: string,
  details?: any,
  retryable: boolean = false,
  retryDelay?: number
): TradeError => {
  return {
    code,
    message,
    details,
    timestamp: Date.now(),
    retryable,
    retryDelay
  };
};

export const mapDerivErrorToTradeError = (derivError: any): TradeError => {
  const { code, message, details } = derivError;
  
  switch (code) {
    case 'InvalidContractProposal':
      return createTradeError(
        ERROR_CODES.INVALID_CONTRACT,
        'Invalid contract proposal. Please check your trade parameters.',
        details,
        true,
        2000
      );
      
    case 'InsufficientBalance':
      return createTradeError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        'Insufficient balance for this trade.',
        details,
        false
      );
      
    case 'MarketIsClosed':
      return createTradeError(
        ERROR_CODES.MARKET_CLOSED,
        'Market is closed. Please try again when market opens.',
        details,
        true,
        30000
      );
      
    case 'PriceChanged':
      return createTradeError(
        ERROR_CODES.PRICE_CHANGED,
        'Price changed during execution.',
        details,
        true,
        1000
      );
      
    case 'ProposalExpired':
      return createTradeError(
        ERROR_CODES.PROPOSAL_EXPIRED,
        'Proposal expired. Getting new proposal.',
        details,
        true,
        500
      );
      
    case 'RateLimit':
      return createTradeError(
        ERROR_CODES.RATE_LIMIT,
        'Rate limit exceeded. Please wait before making another request.',
        details,
        true,
        30000
      );
      
    case 'InvalidToken':
      return createTradeError(
        ERROR_CODES.INVALID_TOKEN,
        'Invalid authorization token. Please re-login.',
        details,
        false
      );
      
    case 'TradingDisabled':
      return createTradeError(
        ERROR_CODES.UNAUTHORIZED,
        'Trading is disabled for this account.',
        details,
        false
      );
      
    case 'ContractBuyValidationError':
      return createTradeError(
        ERROR_CODES.CONTRACT_VALIDATION_ERROR,
        'Contract validation failed. Please check your parameters.',
        details,
        true,
        1000
      );
      
    default:
      return createTradeError(
        ERROR_CODES.UNKNOWN_ERROR,
        message || 'An unknown error occurred',
        details,
        true,
        5000
      );
  }
};

export const shouldRetryError = (error: TradeError, maxRetries: number = 3): boolean => {
  return error.retryable && maxRetries > 0;
};

export const getRetryDelay = (error: TradeError, retryCount: number): number => {
  const baseDelay = error.retryDelay || 1000;
  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, retryCount);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
};

export const formatErrorMessage = (error: TradeError): string => {
  const timestamp = new Date(error.timestamp).toLocaleTimeString();
  return `[${timestamp}] ${error.message}`;
};

export const isRecoverableError = (error: TradeError): boolean => {
  const recoverableErrors = [
    ERROR_CODES.PRICE_CHANGED,
    ERROR_CODES.PROPOSAL_EXPIRED,
    ERROR_CODES.NETWORK_ERROR,
    ERROR_CODES.CONNECTION_LOST,
    ERROR_CODES.TIMEOUT,
    ERROR_CODES.CONTRACT_VALIDATION_ERROR
  ];
  
  return recoverableErrors.includes(error.code);
};

export const shouldStopTrading = (error: TradeError): boolean => {
  const stopTradingErrors = [
    ERROR_CODES.INSUFFICIENT_BALANCE,
    ERROR_CODES.INVALID_TOKEN,
    ERROR_CODES.UNAUTHORIZED,
    ERROR_CODES.TOKEN_EXPIRED
  ];
  
  return stopTradingErrors.includes(error.code);
};
