
import { BehaviorSubject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface TradingSignal {
    strategy: string;
    action: 'OVER' | 'UNDER' | 'EVEN' | 'ODD' | 'MATCH' | 'DIFFER';
    barrier?: string;
    symbol: string;
    confidence: number;
    timestamp: number;
    details: string;
    source: string;
}

class SignalIntegrationService {
    private signalsSubject = new BehaviorSubject<TradingSignal[]>([]);
    private activeSignalSubject = new BehaviorSubject<TradingSignal | null>(null);

    constructor() {
        this.initializeSignalListener();
    }

    private initializeSignalListener() {
        // Listen for signals from various sources
        
        // WebSocket listener for live signals
        if (typeof window !== 'undefined') {
            window.addEventListener('message', this.handleSignalMessage.bind(this));
        }

        // Connect to signal center if available
        this.connectToSignalCenter();
    }

    private connectToSignalCenter() {
        try {
            // Check if signal center is available
            const signalFrame = document.querySelector('iframe[src*="signal"]') as HTMLIFrameElement;
            if (signalFrame) {
                // Listen for messages from signal center
                window.addEventListener('message', (event) => {
                    if (event.source === signalFrame.contentWindow) {
                        this.processSignalFromCenter(event.data);
                    }
                });
            }
        } catch (error) {
            console.warn('Signal center not available:', error);
        }
    }

    private handleSignalMessage(event: MessageEvent) {
        if (event.data && typeof event.data === 'string') {
            if (event.data.includes('📊 New signal:')) {
                this.parseAndProcessSignal(event.data);
            }
        }
    }

    private processSignalFromCenter(data: any) {
        if (data && data.type === 'TRADING_SIGNAL') {
            const signal: TradingSignal = {
                strategy: data.strategy,
                action: data.action,
                barrier: data.barrier,
                symbol: data.symbol,
                confidence: data.confidence || 75,
                timestamp: Date.now(),
                details: data.details || '',
                source: 'signal_center'
            };
            
            this.addSignal(signal);
        }
    }

    private parseAndProcessSignal(signalText: string) {
        const signal = this.parseSignalText(signalText);
        if (signal) {
            this.addSignal(signal);
        }
    }

    private parseSignalText(signalText: string): TradingSignal | null {
        try {
            // Remove timestamp and prefix
            const cleanText = signalText.replace(/^\[.*?\]\s*📊 New signal:\s*/, '');
            
            // Parse "OVER 2 on RDBULL (Most frequent digit 7 (high) with last digit 2 (low))"
            const overUnderMatch = cleanText.match(/^(OVER|UNDER)\s+(\d+)\s+on\s+(\w+)\s+\((.+)\)$/);
            if (overUnderMatch) {
                const [, action, barrier, symbol, details] = overUnderMatch;
                return {
                    strategy: 'overunder',
                    action: action as 'OVER' | 'UNDER',
                    barrier,
                    symbol,
                    confidence: this.calculateConfidence(details),
                    timestamp: Date.now(),
                    details,
                    source: 'log_parser'
                };
            }

            // Parse other formats
            const evenOddMatch = cleanText.match(/^(EVEN|ODD)\s+on\s+(\w+)\s+\((.+)\)$/);
            if (evenOddMatch) {
                const [, action, symbol, details] = evenOddMatch;
                return {
                    strategy: 'evenodd',
                    action: action as 'EVEN' | 'ODD',
                    symbol,
                    confidence: this.calculateConfidence(details),
                    timestamp: Date.now(),
                    details,
                    source: 'log_parser'
                };
            }

            return null;
        } catch (error) {
            console.error('Error parsing signal:', error);
            return null;
        }
    }

    private calculateConfidence(details: string): number {
        // Calculate confidence based on signal details
        let confidence = 70; // Base confidence
        
        if (details.includes('high')) confidence += 10;
        if (details.includes('frequent')) confidence += 5;
        if (details.includes('strong')) confidence += 15;
        
        return Math.min(confidence, 95);
    }

    private addSignal(signal: TradingSignal) {
        const currentSignals = this.signalsSubject.value;
        const updatedSignals = [...currentSignals.slice(-19), signal]; // Keep last 20 signals
        
        this.signalsSubject.next(updatedSignals);
        this.activeSignalSubject.next(signal);
        
        console.log('📊 New signal processed:', signal);
    }

    // Public methods
    getSignals(): Observable<TradingSignal[]> {
        return this.signalsSubject.asObservable();
    }

    getActiveSignal(): Observable<TradingSignal | null> {
        return this.activeSignalSubject.asObservable();
    }

    getSignalsForStrategy(strategy: string): Observable<TradingSignal[]> {
        return this.signalsSubject.pipe(
            map(signals => signals.filter(s => s.strategy === strategy))
        );
    }

    getCurrentActiveSignal(): TradingSignal | null {
        return this.activeSignalSubject.value;
    }

    clearActiveSignal() {
        this.activeSignalSubject.next(null);
    }

    // Manual signal injection for testing
    injectSignal(signal: Partial<TradingSignal>) {
        const fullSignal: TradingSignal = {
            strategy: signal.strategy || 'overunder',
            action: signal.action || 'OVER',
            barrier: signal.barrier,
            symbol: signal.symbol || 'R_75',
            confidence: signal.confidence || 75,
            timestamp: Date.now(),
            details: signal.details || 'Manual signal',
            source: 'manual'
        };
        
        this.addSignal(fullSignal);
    }
}

// Export singleton instance
export const signalIntegrationService = new SignalIntegrationService();
