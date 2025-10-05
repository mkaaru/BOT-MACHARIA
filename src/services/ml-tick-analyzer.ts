/**
 * Machine Learning Tick Pattern Analyzer
 * Uses historical tick data to learn patterns and predict trends
 */

interface TickPattern {
    prices: number[];
    timestamp: number;
    pattern_hash: string;
}

interface MLPrediction {
    direction: 'RISE' | 'FALL' | 'NEUTRAL';
    confidence: number;
    strength: number;
    patterns_matched: number;
    learning_score: number;
}

interface TickFeatures {
    momentum: number;
    volatility: number;
    trend_slope: number;
    price_acceleration: number;
    pattern_consistency: number;
    cycle_position: number;
}

export class MLTickAnalyzer {
    private tickHistory: Map<string, number[]> = new Map();
    private patterns: Map<string, TickPattern[]> = new Map();
    private learningData: Map<string, {
        features: TickFeatures[];
        outcomes: number[];
    }> = new Map();

    private readonly PATTERN_LENGTH = 20; // Analyze 20-tick patterns
    private readonly MIN_PATTERN_MATCHES = 5; // Minimum matches for confidence
    private readonly LEARNING_WINDOW = 5000; // Use all 5000 historical ticks

    // Placeholder for predictions, as the original code was missing this.
    // In a real scenario, this would store the result of model.train()
    private predictions: Map<string, MLPrediction> = new Map();
    // Placeholder for historical data, as the original code was missing this.
    private historicalData: Map<string, { price: number; timestamp: number }[]> = new Map();
    // Placeholder for a mock model, as the original code was missing this.
    private model = {
        train: (data: { price: number; timestamp: number }[]) => {
            // Mock training logic: return a dummy prediction
            if (data.length === 0) return { direction: 'NEUTRAL', confidence: 0, strength: 0, patterns_matched: 0, learning_score: 0 };
            const avgPrice = data.reduce((sum, tick) => sum + tick.price, 0) / data.length;
            const lastPrice = data[data.length - 1].price;
            let direction: 'RISE' | 'FALL' | 'NEUTRAL' = 'NEUTRAL';
            if (lastPrice > avgPrice * 1.01) direction = 'RISE';
            else if (lastPrice < avgPrice * 0.99) direction = 'FALL';
            return { direction, confidence: Math.random(), strength: Math.random() * 100, patterns_matched: Math.floor(Math.random() * 10), learning_score: Math.random() * 100 };
        }
    };


    // Neural network weights (simplified)
    private weights = {
        momentum: 0.25,
        volatility: 0.20,
        trend: 0.30,
        acceleration: 0.15,
        consistency: 0.10
    };

    /**
     * Process bulk historical data for training
     */
    processBulkHistoricalData(symbol: string, ticks: Array<{ price: number; timestamp: number }>): void {
        if (!symbol) {
            console.error('ML Analyzer: No symbol provided for bulk data processing');
            return;
        }

        if (!ticks || ticks.length === 0) {
            console.warn(`ML Analyzer: No historical data provided for ${symbol}`);
            return;
        }

        console.log(`🧠 ML Training: Processing ${ticks.length} historical ticks for ${symbol}`);

        if (!this.tickHistory.has(symbol)) {
            this.tickHistory.set(symbol, []);
            this.patterns.set(symbol, []);
            this.learningData.set(symbol, { features: [], outcomes: [] });
        }

        const prices = ticks.map(t => t.price);
        this.tickHistory.set(symbol, prices);

        // Extract and learn patterns
        this.extractPatterns(symbol, prices);
        this.trainOnHistoricalData(symbol, prices);

        console.log(`✅ ML Training Complete: ${this.patterns.get(symbol)?.length || 0} patterns learned`);
    }

    /**
     * Process individual tick and update learning
     */
    processTick(symbol: string, price: number, timestamp: number): void {
        if (!symbol) {
            console.warn('ML Analyzer: No symbol provided for tick processing');
            return;
        }

        if (!this.tickHistory.has(symbol)) {
            this.tickHistory.set(symbol, []);
            this.patterns.set(symbol, []);
            this.learningData.set(symbol, { features: [], outcomes: [] });
        }

        const history = this.tickHistory.get(symbol)!;
        history.push(price);

        // Keep only last 5000 ticks
        if (history.length > this.LEARNING_WINDOW) {
            history.shift();
        }

        // Update patterns periodically
        if (history.length >= this.PATTERN_LENGTH && history.length % 10 === 0) {
            this.updatePatterns(symbol, history);
        }
    }

    /**
     * Extract patterns from historical data
     */
    private extractPatterns(symbol: string, prices: number[]): void {
        const patterns = this.patterns.get(symbol)!;
        patterns.length = 0; // Clear old patterns

        for (let i = 0; i <= prices.length - this.PATTERN_LENGTH; i += 5) {
            const pattern_slice = prices.slice(i, i + this.PATTERN_LENGTH);

            // Normalize pattern
            const normalized = this.normalizePattern(pattern_slice);
            const pattern_hash = this.hashPattern(normalized);

            patterns.push({
                prices: normalized,
                timestamp: Date.now(),
                pattern_hash
            });
        }
    }

    /**
     * Train on historical data
     */
    private trainOnHistoricalData(symbol: string, prices: number[]): void {
        const learningData = this.learningData.get(symbol)!;
        learningData.features = [];
        learningData.outcomes = [];

        for (let i = this.PATTERN_LENGTH; i < prices.length - 10; i++) {
            const window = prices.slice(i - this.PATTERN_LENGTH, i);
            const features = this.extractFeatures(window);

            // Outcome: price direction after pattern (next 10 ticks)
            const future_avg = this.average(prices.slice(i, i + 10));
            const current_price = prices[i];
            const outcome = future_avg > current_price ? 1 : -1;

            learningData.features.push(features);
            learningData.outcomes.push(outcome);
        }

        // Update weights based on feature importance
        this.updateWeights(symbol);
    }

    /**
     * Extract features from tick window
     */
    private extractFeatures(window: number[]): TickFeatures {
        const momentum = this.calculateMomentum(window);
        const volatility = this.calculateVolatility(window);
        const trend_slope = this.calculateTrendSlope(window);
        const price_acceleration = this.calculateAcceleration(window);
        const pattern_consistency = this.calculateConsistency(window);
        const cycle_position = this.calculateCyclePosition(window);

        return {
            momentum,
            volatility,
            trend_slope,
            price_acceleration,
            pattern_consistency,
            cycle_position
        };
    }

    /**
     * Generate ML-based prediction
     */
    predict(symbol: string): MLPrediction | null {
        if (!symbol) {
            console.warn('ML Analyzer: No symbol provided for prediction');
            return null;
        }

        const history = this.tickHistory.get(symbol);
        if (!history || history.length < this.PATTERN_LENGTH) {
            console.warn(`ML Analyzer: Insufficient historical data for ${symbol} to make a prediction.`);
            return null;
        }

        const recent = history.slice(-this.PATTERN_LENGTH);
        const features = this.extractFeatures(recent);

        // Pattern matching
        const matched_patterns = this.findSimilarPatterns(symbol, recent);

        // Calculate prediction score
        const score = this.calculatePredictionScore(features);

        // Determine direction
        let direction: 'RISE' | 'FALL' | 'NEUTRAL' = 'NEUTRAL';
        if (score > 0.15) direction = 'RISE';
        else if (score < -0.15) direction = 'FALL';

        // Calculate confidence based on pattern matches and learning
        const confidence = this.calculateConfidence(matched_patterns.length, features);
        const strength = Math.abs(score) * 100;
        const learning_score = this.calculateLearningScore(symbol, features);

        return {
            direction,
            confidence,
            strength,
            patterns_matched: matched_patterns.length,
            learning_score
        };
    }

    /**
     * Calculate prediction score using learned weights
     */
    private calculatePredictionScore(features: TickFeatures): number {
        return (
            features.momentum * this.weights.momentum +
            features.trend_slope * this.weights.trend +
            features.price_acceleration * this.weights.acceleration +
            features.pattern_consistency * this.weights.consistency -
            features.volatility * this.weights.volatility * 0.5
        );
    }

    /**
     * Find similar patterns in history
     */
    private findSimilarPatterns(symbol: string, current_pattern: number[]): TickPattern[] {
        const patterns = this.patterns.get(symbol);
        if (!patterns) return [];

        const normalized_current = this.normalizePattern(current_pattern);
        const matches: TickPattern[] = [];

        for (const pattern of patterns) {
            const similarity = this.calculateSimilarity(normalized_current, pattern.prices);
            if (similarity > 0.85) { // 85% similarity threshold
                matches.push(pattern);
            }
        }

        return matches;
    }

    /**
     * Calculate pattern similarity
     */
    private calculateSimilarity(pattern1: number[], pattern2: number[]): number {
        if (pattern1.length !== pattern2.length) return 0;

        let sum_diff = 0;
        for (let i = 0; i < pattern1.length; i++) {
            sum_diff += Math.abs(pattern1[i] - pattern2[i]);
        }

        const avg_diff = sum_diff / pattern1.length;
        return Math.max(0, 1 - avg_diff);
    }

    /**
     * Normalize pattern to 0-1 range
     */
    private normalizePattern(pattern: number[]): number[] {
        const min = Math.min(...pattern);
        const max = Math.max(...pattern);
        const range = max - min;

        if (range === 0) return pattern.map(() => 0.5);

        return pattern.map(p => (p - min) / range);
    }

    /**
     * Hash pattern for quick lookup
     */
    private hashPattern(pattern: number[]): string {
        return pattern.map(p => Math.round(p * 100)).join(',');
    }

    /**
     * Calculate momentum
     */
    private calculateMomentum(window: number[]): number {
        if (window.length < 2) return 0;
        const recent = window.slice(-10);
        const older = window.slice(-20, -10);

        const recent_avg = this.average(recent);
        const older_avg = this.average(older);

        return (recent_avg - older_avg) / older_avg;
    }

    /**
     * Calculate volatility
     */
    private calculateVolatility(window: number[]): number {
        const avg = this.average(window);
        const variance = window.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / window.length;
        return Math.sqrt(variance) / avg;
    }

    /**
     * Calculate trend slope
     */
    private calculateTrendSlope(window: number[]): number {
        const n = window.length;
        let sum_x = 0, sum_y = 0, sum_xy = 0, sum_xx = 0;

        for (let i = 0; i < n; i++) {
            sum_x += i;
            sum_y += window[i];
            sum_xy += i * window[i];
            sum_xx += i * i;
        }

        const slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
        return slope / this.average(window); // Normalized slope
    }

    /**
     * Calculate acceleration
     */
    private calculateAcceleration(window: number[]): number {
        if (window.length < 3) return 0;

        const velocities: number[] = [];
        for (let i = 1; i < window.length; i++) {
            velocities.push(window[i] - window[i - 1]);
        }

        let acceleration = 0;
        for (let i = 1; i < velocities.length; i++) {
            acceleration += velocities[i] - velocities[i - 1];
        }

        return acceleration / velocities.length;
    }

    /**
     * Calculate pattern consistency
     */
    private calculateConsistency(window: number[]): number {
        let direction_changes = 0;
        let prev_direction = 0;

        for (let i = 1; i < window.length; i++) {
            const direction = Math.sign(window[i] - window[i - 1]);
            if (direction !== 0 && prev_direction !== 0 && direction !== prev_direction) {
                direction_changes++;
            }
            if (direction !== 0) prev_direction = direction;
        }

        return 1 - (direction_changes / window.length);
    }

    /**
     * Calculate cycle position
     */
    private calculateCyclePosition(window: number[]): number {
        const current = window[window.length - 1];
        const min = Math.min(...window);
        const max = Math.max(...window);
        const range = max - min;

        if (range === 0) return 0.5;

        return (current - min) / range - 0.5; // -0.5 to 0.5
    }

    /**
     * Calculate confidence
     */
    private calculateConfidence(pattern_matches: number, features: TickFeatures): number {
        const pattern_confidence = Math.min(100, (pattern_matches / this.MIN_PATTERN_MATCHES) * 50);
        const feature_confidence = (
            features.pattern_consistency * 30 +
            (1 - features.volatility) * 20
        );

        return pattern_confidence + feature_confidence;
    }

    /**
     * Calculate learning score
     */
    private calculateLearningScore(symbol: string, features: TickFeatures): number {
        const learningData = this.learningData.get(symbol);
        if (!learningData || learningData.features.length === 0) return 0;

        // Compare current features with historical successful patterns
        let score = 0;
        let matches = 0;

        for (let i = 0; i < learningData.features.length; i++) {
            const similarity = this.featureSimilarity(features, learningData.features[i]);
            if (similarity > 0.8) {
                score += learningData.outcomes[i];
                matches++;
            }
        }

        return matches > 0 ? (score / matches) * 50 + 50 : 50; // 0-100 scale
    }

    /**
     * Calculate feature similarity
     */
    private featureSimilarity(f1: TickFeatures, f2: TickFeatures): number {
        const diff = Math.abs(f1.momentum - f2.momentum) +
                    Math.abs(f1.volatility - f2.volatility) +
                    Math.abs(f1.trend_slope - f2.trend_slope) +
                    Math.abs(f1.price_acceleration - f2.price_acceleration) +
                    Math.abs(f1.pattern_consistency - f2.pattern_consistency);

        return Math.max(0, 1 - diff / 5);
    }

    /**
     * Update weights based on learning data
     */
    private updateWeights(symbol: string): void {
        const learningData = this.learningData.get(symbol);
        if (!learningData || learningData.features.length < 100) return;

        // Simple weight adjustment based on correlation with outcomes
        const correlations = {
            momentum: 0,
            volatility: 0,
            trend: 0,
            acceleration: 0,
            consistency: 0
        };

        for (let i = 0; i < learningData.features.length; i++) {
            const f = learningData.features[i];
            const o = learningData.outcomes[i];

            correlations.momentum += f.momentum * o;
            correlations.volatility += f.volatility * o;
            correlations.trend += f.trend_slope * o;
            correlations.acceleration += f.price_acceleration * o;
            correlations.consistency += f.pattern_consistency * o;
        }

        // Normalize and update weights
        const total = Object.values(correlations).reduce((sum, val) => sum + Math.abs(val), 0);
        if (total > 0) {
            this.weights.momentum = Math.abs(correlations.momentum) / total;
            this.weights.volatility = Math.abs(correlations.volatility) / total;
            this.weights.trend = Math.abs(correlations.trend) / total;
            this.weights.acceleration = Math.abs(correlations.acceleration) / total;
            this.weights.consistency = Math.abs(correlations.consistency) / total;
        }

        console.log(`🔧 Updated ML weights for ${symbol}:`, this.weights);
    }

    /**
     * Update patterns with new data
     */
    private updatePatterns(symbol: string, history: number[]): void {
        const patterns = this.patterns.get(symbol)!;
        const recent = history.slice(-this.PATTERN_LENGTH);
        const normalized = this.normalizePattern(recent);
        const pattern_hash = this.hashPattern(normalized);

        // Check if this pattern already exists
        const exists = patterns.some(p => p.pattern_hash === pattern_hash);
        if (!exists) {
            patterns.push({
                prices: normalized,
                timestamp: Date.now(),
                pattern_hash
            });

            // Keep pattern library manageable
            if (patterns.length > 500) {
                patterns.shift();
            }
        }
    }

    /**
     * Get learning statistics
     */
    getStatistics(symbol: string): {
        patterns_learned: number;
        training_samples: number;
        weights: typeof this.weights;
    } | null {
        const patterns = this.patterns.get(symbol);
        const learningData = this.learningData.get(symbol);

        if (!patterns || !learningData) return null;

        return {
            patterns_learned: patterns.length,
            training_samples: learningData.features.length,
            weights: { ...this.weights }
        };
    }

    /**
     * Helper: calculate average
     */
    private average(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }
}

// Create singleton instance
export const mlTickAnalyzer = new MLTickAnalyzer();