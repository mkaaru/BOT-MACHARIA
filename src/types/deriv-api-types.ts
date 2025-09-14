/**
 * Comprehensive TypeScript interfaces for Deriv API responses
 * Critical for trading system type safety and runtime error prevention
 */

// Base API response structure
export interface BaseAPIResponse {
    msg_type: string;
    req_id?: number;
    echo_req?: Record<string, any>;
    error?: APIError;
}

export interface APIError {
    code: string;
    message: string;
    details?: Record<string, any>;
}

// WebSocket API instance interface
export interface DerivAPIInstance {
    send: (request: APIRequest) => Promise<APIResponse>;
    connection: WebSocket | null;
    disconnect?: () => void;
    authorize: (token: string) => Promise<AuthorizeResponse>;
    buy: (request: BuyRequest) => Promise<BuyResponse>;
    forget: (request: ForgetRequest) => Promise<BaseAPIResponse>;
}

// Generic API request/response types
export type APIRequest = 
    | TicksRequest
    | ActiveSymbolsRequest
    | AuthorizeRequest
    | BuyRequest
    | ForgetRequest
    | ProposalOpenContractRequest;

export type APIResponse = 
    | TickResponse
    | ActiveSymbolsResponse
    | AuthorizeResponse
    | BuyResponse
    | BaseAPIResponse
    | ProposalOpenContractResponse;

// Tick-related interfaces
export interface TicksRequest {
    ticks: string;
    subscribe?: 1;
}

export interface TickResponse extends BaseAPIResponse {
    msg_type: 'tick';
    tick: TickData;
    subscription?: Subscription;
}

export interface TickData {
    epoch: number;
    symbol: string;
    quote: number;
    pip_size?: number;
}

export interface Subscription {
    id: string;
}

// Active Symbols interfaces
export interface ActiveSymbolsRequest {
    active_symbols: 'brief' | 'full';
}

export interface ActiveSymbolsResponse extends BaseAPIResponse {
    msg_type: 'active_symbols';
    active_symbols: ActiveSymbol[];
}

export interface ActiveSymbol {
    symbol: string;
    display_name: string;
    market: string;
    market_display_name: string;
    submarket: string;
    submarket_display_name: string;
    pip: number;
    exchange_is_open: 0 | 1;
    is_trading_suspended: 0 | 1;
    spot?: number;
}

// Authorization interfaces
export interface AuthorizeRequest {
    authorize: string;
}

export interface AuthorizeResponse extends BaseAPIResponse {
    msg_type: 'authorize';
    authorize: AuthorizeData;
}

export interface AuthorizeData {
    loginid: string;
    currency: string;
    email: string;
    fullname: string;
    is_virtual: 0 | 1;
    landing_company_name: string;
    landing_company_fullname: string;
    account_list: AccountInfo[];
    balance: number;
    country: string;
    local_currencies: LocalCurrency[];
}

export interface AccountInfo {
    loginid: string;
    currency: string;
    is_virtual: 0 | 1;
    is_disabled: 0 | 1;
    landing_company_name: string;
}

export interface LocalCurrency {
    currency: string;
    fractional_digits: number;
}

// Trading interfaces
export interface BuyRequest {
    buy: '1';
    price: number;
    parameters: TradeParameters;
}

export interface TradeParameters {
    amount: number;
    basis: 'payout' | 'stake';
    contract_type: ContractType;
    currency: string;
    duration: number;
    duration_unit: 't' | 's' | 'm' | 'h' | 'd';
    symbol: string;
    barrier?: number;
    barrier2?: number;
    prediction?: number;
}

export type ContractType = 
    | 'CALL' | 'PUT'           // Rise/Fall
    | 'CALLE' | 'PUTE'         // Rise/Fall Equal
    | 'DIGITODD' | 'DIGITEVEN' // Even/Odd
    | 'DIGITOVER' | 'DIGITUNDER' // Over/Under
    | 'RANGE' | 'UPORDOWN';    // In/Out

export interface BuyResponse extends BaseAPIResponse {
    msg_type: 'buy';
    buy: BuyData;
}

export interface BuyData {
    balance_after: number;
    buy_price: number;
    contract_id: number;
    longcode: string;
    payout: number;
    purchase_time: number;
    shortcode: string;
    start_time: number;
    transaction_id: number;
}

// Contract monitoring interfaces
export interface ProposalOpenContractRequest {
    proposal_open_contract: 1;
    contract_id: number;
    subscribe?: 1;
}

export interface ProposalOpenContractResponse extends BaseAPIResponse {
    msg_type: 'proposal_open_contract';
    proposal_open_contract: ContractInfo;
    subscription?: Subscription;
}

export interface ContractInfo {
    contract_id: number;
    shortcode: string;
    longcode: string;
    underlying: string;
    contract_type: ContractType;
    entry_spot: number;
    entry_spot_display_value: string;
    exit_spot?: number;
    exit_spot_display_value?: string;
    barrier: string;
    high_barrier?: string;
    low_barrier?: string;
    currency: string;
    is_expired: 0 | 1;
    is_settleable: 0 | 1;
    is_sold: 0 | 1;
    is_valid_to_sell: 0 | 1;
    profit: number;
    profit_percentage: number;
    buy_price: number;
    payout: number;
    date_start: number;
    date_expiry: number;
    purchase_time: number;
    sell_price?: number;
    sell_time?: number;
    status: 'open' | 'sold' | 'won' | 'lost';
    tick_count: number;
    current_spot?: number;
    current_spot_display_value?: string;
    audit_details?: AuditDetails;
}

export interface AuditDetails {
    all_ticks: TickInfo[];
}

export interface TickInfo {
    epoch: number;
    tick: number;
    tick_display_value: string;
}

// Forget subscription interfaces
export interface ForgetRequest {
    forget: string; // subscription_id
}

// OHLC (Candle) interfaces
export interface OHLCRequest {
    ticks_history: string;
    adjust_start_time?: 1;
    count?: number;
    end?: 'latest' | number;
    granularity?: number;
    start?: number;
    style: 'candles';
    subscribe?: 1;
}

export interface OHLCResponse extends BaseAPIResponse {
    msg_type: 'candles' | 'ohlc';
    candles?: CandleData[];
    ohlc?: OHLCData;
    subscription?: Subscription;
}

export interface CandleData {
    close: number;
    epoch: number;
    high: number;
    low: number;
    open: number;
}

export interface OHLCData {
    close: number;
    epoch: number;
    granularity: number;
    high: number;
    id: string;
    low: number;
    open: number;
    open_time: number;
    symbol: string;
}

// Price History interfaces
export interface PriceHistoryRequest {
    ticks_history: string;
    adjust_start_time?: 1;
    count?: number;
    end?: 'latest' | number;
    start?: number;
    style: 'ticks';
    subscribe?: 1;
}

export interface PriceHistoryResponse extends BaseAPIResponse {
    msg_type: 'history';
    history: HistoryData;
    subscription?: Subscription;
}

export interface HistoryData {
    prices: number[];
    times: number[];
}

// Type guards for runtime type checking
export function isTickResponse(response: any): response is TickResponse {
    return response?.msg_type === 'tick' && 
           response?.tick &&
           typeof response.tick.epoch === 'number' &&
           typeof response.tick.symbol === 'string' &&
           typeof response.tick.quote === 'number';
}

export function isActiveSymbolsResponse(response: any): response is ActiveSymbolsResponse {
    return response?.msg_type === 'active_symbols' && 
           Array.isArray(response?.active_symbols);
}

export function isAuthorizeResponse(response: any): response is AuthorizeResponse {
    return response?.msg_type === 'authorize' && 
           response?.authorize &&
           typeof response.authorize.loginid === 'string' &&
           typeof response.authorize.currency === 'string';
}

export function isBuyResponse(response: any): response is BuyResponse {
    return response?.msg_type === 'buy' && 
           response?.buy &&
           typeof response.buy.contract_id === 'number' &&
           typeof response.buy.buy_price === 'number';
}

export function isProposalOpenContractResponse(response: any): response is ProposalOpenContractResponse {
    return response?.msg_type === 'proposal_open_contract' && 
           response?.proposal_open_contract &&
           typeof response.proposal_open_contract.contract_id === 'number';
}

export function isOHLCResponse(response: any): response is OHLCResponse {
    return response?.msg_type === 'ohlc' && 
           response?.ohlc &&
           typeof response.ohlc.close === 'number';
}

export function isPriceHistoryResponse(response: any): response is PriceHistoryResponse {
    return response?.msg_type === 'history' && 
           response?.history &&
           Array.isArray(response.history.prices) &&
           Array.isArray(response.history.times);
}

export function hasAPIError(response: any): response is BaseAPIResponse & { error: APIError } {
    return response?.error && 
           typeof response.error.code === 'string' &&
           typeof response.error.message === 'string';
}

// Helper function to validate API response structure
export function validateAPIResponse(response: any): response is APIResponse {
    return response && 
           typeof response === 'object' &&
           typeof response.msg_type === 'string';
}

// Trading recommendation types for ML trader
export interface TradingRecommendationData {
    symbol: string;
    direction: 'CALL' | 'PUT';
    confidence: number;
    stake: number;
    duration: number;
    duration_unit: 't' | 's' | 'm';
    contract_type: ContractType;
    barrier_offset?: number;
    reason: string;
    timestamp: Date;
}

// Market data types
export interface MarketDataTick {
    symbol: string;
    price: number;
    timestamp: Date;
    epoch: number;
}

export interface ProcessedCandleData {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    timestamp: Date;
    epoch: number;
    volume?: number;
}

// WebSocket message types for centralized manager
export interface WebSocketMessage {
    msg_type: string;
    [key: string]: any;
}

export function isWebSocketMessage(data: any): data is WebSocketMessage {
    return data && 
           typeof data === 'object' &&
           typeof data.msg_type === 'string';
}