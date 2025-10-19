# Overview

Trade Cortex (TradeCortex) is an advanced AI trading bot builder platform designed to empower users to create automated trading strategies without coding. This React-based web application provides a comprehensive trading interface, featuring visual bot building with Blockly, real-time market analysis, and automated trading strategies specifically for Deriv markets. The platform aims to offer diverse trading approaches, including a visual bot builder, quick strategy templates, and an advanced AI-powered trading hub with automated strategies for volatility indices and digit trading, with the ambition of making sophisticated trading accessible to a broad user base.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript.
- **Build System**: Rsbuild with React and Sass plugins.
- **State Management**: MobX for reactive state management.
- **Styling**: SCSS with a design system and component-scoped styles.
- **UI Components**: Custom component library augmented with Deriv UI components.
- **Routing**: React Router v6 for client-side navigation.

## Visual Bot Builder
- **Blockly Integration**: Google Blockly provides a drag-and-drop visual programming interface.
- **Custom Blocks**: Trading-specific blocks extend Blockly's functionality for strategy creation.
- **Code Generation**: JavaScript code is generated from visual blocks for execution.
- **Strategy Templates**: Pre-built templates for common trading patterns are available.

## Trading Engine
- **API Integration**: Utilizes Deriv API WebSocket for real-time market data and trade execution.
- **Strategy Types**: Supports multiple automated strategies, including martingale, digit analysis, and pattern recognition.
- **Risk Management**: Implements stop-loss, take-profit, and position sizing controls.
- **Market Analysis**: Real-time tick data analysis with pattern recognition algorithms.

## Data Management
- **Local Storage**: Browser localStorage is used for strategy persistence and user preferences.
- **Session Management**: Client-side handling of authentication tokens.
- **Real-time Data**: WebSocket streams deliver live market data and trade updates.

## System Design Choices
- **Trading Hub Interface**: Features an embedded Smart Trader component for direct trading without modals, with all settings directly editable and "Start Trading" buttons initiating trades directly. It includes auto-scroll to the Smart Trader and a persistent stop button.
- **Auto-Trading System**: `ml-auto-trader.ts` service for intelligent trade execution with risk management, including configurable stake, min confidence, max trades/hour, cooldown, stop-loss, and take-profit. Features symbol rotation and a contract type alternation strategy (Equals vs. Plain contracts) based on win/loss streaks.
- **Deriv API Integration**: Corrected contract type mapping (Rise as PUT, Fall as CALL) and enforced 2-tick duration. Optimized for Step Indices to reduce API load and improve rate limit avoidance.
- **Bot Builder Market Hierarchy**: Correct XML structure for Blockly to properly populate market, submarket, and symbol dropdowns, particularly for Step Indices.
- **Intelligent ML Trader Bot (October 2025)**: Enhanced "Load to Bot Builder" feature that generates adaptive trading bots with tick-stream analysis capabilities:
  * **John Ehlers Technical Indicators**: Utilizes `ehlers-indicators.ts` with Supersmoother filter, Instantaneous Trendline, and Cyber Cycle for market analysis
  * **Adaptive Bi-Directional Trading**: Bot learns from real-time tick patterns and switches between RISE/FALL based on detected market trends with symmetric confidence scoring for both bullish and bearish alignments
  * **Confidence-Based Trading**: Only executes trades when confidence >= 70%, preventing low-quality signals
  * **Rolling Window Buffer**: Maintains 150-tick history with automatic memory management to prevent bloat
  * **Periodic Analysis**: Recalculates market direction every 60 trades using simplified trend detection (last tick vs first tick comparison)
  * **2-Tick Duration**: Uses 2 ticks for Step Indices and volatility markets
  * **Risk Management**: Preserves martingale progression and consecutive loss limits (max 5) while adding intelligent market timing
  * **Initial Bootstrap**: Starts with 75% confidence to enable initial trades, then adapts based on market learning
- **Real-Time Trend Monitoring (October 2025)**: Continuous tick stream analysis that dynamically adapts trading direction:
  * **12-Tick Trend Analysis**: `real-time-trend-monitor.ts` service maintains rolling 12-tick windows to detect BULLISH/BEARISH/NEUTRAL trends
  * **Dynamic Direction Switching**: Automatically switches between RISE and FALL trades when trend reversals are detected during auto-trading
  * **Priority System**: Trade direction determined by: Real-time trend > Reinforcement learning > AI recommendations
  * **Visual Feedback**: Live trend indicator shows current market direction, confidence, strength, and price change
  * **Trend Change Tracking**: Counts and displays trend reversals during trading sessions
- **Continuous AI Recommendations (October 2025)**: Automated trade signal generation every 3 ticks:
  * **3-Tick Analysis Cycle**: Subscribes to tick stream and generates AI recommendations every 3 ticks using `tickPredictionEngine`
  * **Auto-Execution**: Automatically executes trades when no contract is active and confidence >= 75%
  * **RISE/FALL Prediction**: Converts tick predictions (CALL/PUT) to trade directions (RISE/FALL)
  * **Contract Gating**: Only executes when `contractInProgressRef` is false, preventing overlapping trades
  * **Visual Indicator**: Blue gradient card displays current AI recommendation, tick count, confidence, and contract status
  * **Lifecycle Management**: Starts with auto-trading, cleans up properly on stop
- **ML Trader Transaction Panel Integration (October 2025)**: Unified transaction tracking with Trading Hub:
  * **Trading Hub Pattern**: Uses `transactions.onBotContractEvent()` matching Trading Hub implementation
  * **Correct Transaction IDs**: Maps `transaction_ids.buy` from actual buy transaction ID (not contract_id) for proper settlement reconciliation
  * **Multi-Currency Support**: Uses actual `account_currency` from balance response (not hardcoded USD)
  * **Live Contract Updates**: Subscribes to `proposal_open_contract` and continuously updates Run Panel with contract progress
  * **3-Second Trade Interval**: Rapid continuous trading with 3-second intervals (reduced from 12 seconds) for faster market opportunities
  * **Wrapper Function**: `executeTradeAndMapToPanel()` encapsulates trade execution, transaction mapping, and subscription management
  * **Crash Protection**: All `onBotContractEvent` calls wrapped in try-catch blocks to prevent Transactions panel crashes during active trading
  * **Complete Data**: Fetches full `proposal_open_contract` response before mapping to ensure all required fields (entry_tick, exit_tick, etc.) are present

# External Dependencies

## Core Dependencies
- **@deriv/deriv-api**: Official Deriv trading API client.
- **@deriv/deriv-charts**: Charting library.
- **@deriv-com/analytics**: Analytics and tracking.
- **@deriv-com/auth-client**: Authentication and authorization client.
- **@deriv-com/ui**: Deriv's design system components.

## Trading and Analysis
- **blockly**: Visual programming interface.
- **@deriv/js-interpreter**: JavaScript interpreter for strategy execution.
- **mobx**: Reactive state management.
- **crypto-js**: Cryptographic utilities.

## Development Tools
- **@rsbuild/core**: Build tool.
- **@typescript-eslint**: TypeScript linting rules.
- **@testing-library/react**: React component testing utilities.
- **sass**: CSS preprocessor.

## Deployment
- **Cloudflare Pages**: Static site hosting.