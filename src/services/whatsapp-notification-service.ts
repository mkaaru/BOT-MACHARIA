
export interface WhatsAppNotificationConfig {
    channelUrl: string;
    enabled: boolean;
    messageTemplate?: string;
}

export interface TradingRecommendationForWhatsApp {
    symbol: string;
    displayName: string;
    direction: string;
    strategy: string;
    confidence: number;
    score: number;
    currentPrice: number;
    reason: string;
    timestamp: number;
}

class WhatsAppNotificationService {
    private config: WhatsAppNotificationConfig;
    private lastNotificationTime: number = 0;
    private notificationCooldown: number = 60000; // 1 minute cooldown between notifications

    constructor(config: WhatsAppNotificationConfig) {
        this.config = config;
    }

    updateConfig(config: Partial<WhatsAppNotificationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    isEnabled(): boolean {
        return this.config.enabled && !!this.config.channelUrl;
    }

    private canSendNotification(): boolean {
        const now = Date.now();
        return now - this.lastNotificationTime >= this.notificationCooldown;
    }

    private formatRecommendationMessage(recommendation: TradingRecommendationForWhatsApp): string {
        const template = this.config.messageTemplate || this.getDefaultTemplate();
        
        const timestamp = new Date(recommendation.timestamp).toLocaleString();
        const confidenceBar = '█'.repeat(Math.floor(recommendation.confidence / 10));
        const scoreEmoji = recommendation.score >= 80 ? '🟢' : recommendation.score >= 60 ? '🟡' : '🔴';
        
        return template
            .replace('{symbol}', recommendation.symbol)
            .replace('{displayName}', recommendation.displayName)
            .replace('{direction}', recommendation.direction)
            .replace('{strategy}', recommendation.strategy)
            .replace('{confidence}', recommendation.confidence.toFixed(1))
            .replace('{confidenceBar}', confidenceBar)
            .replace('{score}', recommendation.score.toFixed(0))
            .replace('{scoreEmoji}', scoreEmoji)
            .replace('{currentPrice}', recommendation.currentPrice.toFixed(5))
            .replace('{reason}', recommendation.reason)
            .replace('{timestamp}', timestamp);
    }

    private getDefaultTemplate(): string {
        return `🤖 *ML Trader Signal* 🤖

📊 *Asset:* {displayName} ({symbol})
📈 *Direction:* {direction}
🎯 *Strategy:* {strategy}

💪 *Confidence:* {confidence}% {confidenceBar}
⭐ *Score:* {scoreEmoji} {score}/100
💰 *Price:* {currentPrice}

📝 *Analysis:* {reason}

⏰ *Time:* {timestamp}

🚀 Ready to trade with TradeCortex ML Bot!`;
    }

    async sendRecommendationNotification(recommendation: TradingRecommendationForWhatsApp): Promise<boolean> {
        if (!this.isEnabled()) {
            console.log('WhatsApp notifications disabled');
            return false;
        }

        if (!this.canSendNotification()) {
            console.log('WhatsApp notification cooldown active');
            return false;
        }

        try {
            const message = this.formatRecommendationMessage(recommendation);
            const success = await this.sendToWhatsApp(message);
            
            if (success) {
                this.lastNotificationTime = Date.now();
                console.log('✅ WhatsApp notification sent successfully');
            }
            
            return success;
        } catch (error) {
            console.error('❌ Failed to send WhatsApp notification:', error);
            return false;
        }
    }

    private async sendToWhatsApp(message: string): Promise<boolean> {
        try {
            // Method 1: Try to open WhatsApp Web with pre-filled message
            const encodedMessage = encodeURIComponent(message);
            const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;
            
            // For browser environment, we'll use the Web Share API or clipboard
            if (typeof navigator !== 'undefined') {
                // Try Web Share API first
                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: 'ML Trader Recommendation',
                            text: message,
                            url: this.config.channelUrl
                        });
                        return true;
                    } catch (shareError) {
                        console.log('Web Share API failed, falling back to clipboard');
                    }
                }

                // Fallback to clipboard
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(message);
                    
                    // Show notification to user
                    this.showNotificationToUser(message);
                    
                    // Auto-open WhatsApp channel in new tab
                    window.open(this.config.channelUrl, '_blank');
                    
                    return true;
                }
            }

            // Final fallback - just open the channel
            window.open(this.config.channelUrl, '_blank');
            console.log('📋 Message ready for WhatsApp:', message);
            
            return true;
        } catch (error) {
            console.error('Error sending to WhatsApp:', error);
            return false;
        }
    }

    private showNotificationToUser(message: string): void {
        // Create a temporary notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #25D366;
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 350px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            line-height: 1.4;
        `;
        
        notification.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px;">📱 WhatsApp Message Ready!</div>
            <div style="font-size: 12px; opacity: 0.9;">Message copied to clipboard. WhatsApp channel opening...</div>
            <div style="margin-top: 8px; font-size: 10px; opacity: 0.7;">Click to dismiss</div>
        `;
        
        notification.onclick = () => notification.remove();
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    // Method to manually test the notification service
    async testNotification(): Promise<void> {
        const testRecommendation: TradingRecommendationForWhatsApp = {
            symbol: 'R_50',
            displayName: 'Volatility 50 Index',
            direction: 'CALL',
            strategy: 'rise_fall',
            confidence: 85.5,
            score: 92,
            currentPrice: 1234.56789,
            reason: 'Strong bullish trend detected with high momentum',
            timestamp: Date.now()
        };

        await this.sendRecommendationNotification(testRecommendation);
    }
}

// Create singleton instance
export const whatsAppNotificationService = new WhatsAppNotificationService({
    channelUrl: 'https://www.whatsapp.com/channel/0029Vb6SqPO4inoyArbsVb1t',
    enabled: true,
    messageTemplate: undefined // Uses default template
});

export default whatsAppNotificationService;
