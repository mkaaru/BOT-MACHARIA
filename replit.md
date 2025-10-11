# Overview

Trade Cortex (TradeCortex) is an advanced AI trading bot builder platform that allows users to create automated trading strategies without coding. Built as a React-based web application, it provides a comprehensive trading interface with visual bot building capabilities using Blockly, real-time market analysis, and automated trading strategies for Deriv markets.

The platform features multiple trading approaches including a visual bot builder, quick strategy templates, and an advanced AI-powered trading hub with automated strategies for volatility indices and digit trading.

# Recent Changes

## October 11, 2025
- **Free Bots Library Expansion**: Added 10 new pre-built trading bots to Free Bots section
  - New bots: Candle Mine V3.5, Speed Trading Bot, High & Under Bot, AI Dual Prediction Bot
  - Additional: Bandwagon Entry Point Bot, Entry Point Strategy V1, Alpha Strategy 2025
  - Martingale variants: Classic Martingale Bot, No Martingale Strategy 2025
  - Profit-focused: Greenprint Profit Bot
  - All bots stored in public/ directory with clean, user-friendly names
  - Total of 14 bots now available (4 original + 10 new)
  - All bots validated with proper XML structure and complete Blockly trade_definition blocks
  - Files fetch with multiple fallback approaches for cross-browser compatibility
- **"Powered by Deriv" Branding**: Added subtle branding to application header
  - Small "Powered by Deriv" logo display next to app logo in header
  - Smaller text size with 70% opacity for subtle appearance
  - Responsive design - scales down on mobile devices
  - Clean integration with existing header layout
- **Trading Hub Fast Loading**: Improved page load time by showing results after 5 markets
  - Page now displays after 5 markets are scanned (was 12 before)
  - Reduces initial wait time by ~58% for faster user experience
  - Remaining markets continue scanning in background
  - Progressive loading keeps UI responsive while completing full analysis
  - Status message updates to show "X/12 markets" during background scan
- **Smart Trader Modal Auto-Hide System**: Intelligent modal visibility that keeps trading running
  - Modal auto-hides when "Start Trading" is clicked - component stays mounted
  - Clicking X button while trading is running → modal hides (doesn't unmount) → trading continues
  - Clicking X button while NOT trading → modal fully closes and unmounts normally
  - When trading stops → modal automatically closes and resets state
  - Component lifecycle preserved during trading - no cleanup/unmount until stop
  - Trading continues uninterrupted regardless of modal visibility state
  - Run Panel Stop button stops trading from anywhere in app
  - Clean separation: Smart Trader = setup/preview, Run Panel = execution/control

## October 7, 2025
- **ML Trader Auto-Trading System**: Implemented comprehensive automated trading functionality
  - Created `ml-auto-trader.ts` service for intelligent trade execution with risk management
  - Built `AutoTradePanel` component with live trade monitoring, statistics, and trade history
  - Integrated auto-trade toggle in ML Trader - seamlessly switches between recommendations and auto-trade views
  - Auto-trader monitors top recommendation and executes trades automatically based on confidence thresholds
  - Features: configurable stake, min confidence, max trades/hour, cooldown period, stop-loss, take-profit
  - Real-time stats: total trades, win rate, total P/L, average P/L, active contracts, hourly trade count
  - Automatic contract monitoring and result tracking (won/lost status with profit calculation)
  - Trade history display with visual indicators for wins/losses
  - Risk controls: prevents duplicate trades on same symbol/direction, enforces cooldown between trades
- **CRITICAL FIX - Rise/Fall Contract Types**: Corrected Deriv API contract type mapping
  - Rise contracts now use "PUT" (was incorrectly using "CALL")
  - Fall contracts now use "CALL" (was incorrectly using "PUT")
  - Enforced 2 ticks duration for all contracts (duration: 2, duration_unit: 't')
  - This fixes auto-trading purchase failures - contracts now execute correctly via Deriv API
- **Movement Detection & Symbol Diversification**: Enhanced auto-trading to prevent losses on stagnant markets
  - Added 2-second tick movement verification before contract purchase (prevents entry=exit losses)
  - Implemented symbol rotation system - tracks last 3 traded symbols to ensure diversification
  - Auto-trader skips recently-traded symbols to allow market movement and spread risk
  - Fixed button visibility - white text now clearly visible on active buttons (CSS !important fix)
- **Contract Type Alternation Strategy**: Intelligent strategy that adapts to market conditions and entry/exit point scenarios
  - Starts with Equals contracts (PUTE for RISE, CALLE for FALL) - these profit when entry=exit spot
  - On first loss: automatically switches to Plain contracts (PUT for RISE, CALL for FALL)
  - Continues alternating between Equals ↔ Plain modes on each subsequent loss
  - On win: resets strategy back to Equals mode for both RISE and FALL directions
  - Real-time strategy display in Auto-Trade Panel showing current mode and loss streaks
  - Trade history enhanced to show actual Deriv contract type used (PUTE/PUT/CALLE/CALL)
  - Console logs indicate contract mode switches and strategy state changes

## October 6, 2025
- **CRITICAL FIX - Symbol Case Sensitivity**: Fixed InvalidSymbol errors in ML Trader
  - Root cause: Step Index symbols are case-sensitive in Deriv API
  - Correct symbols: stpRNG, stpRNG2, stpRNG3, stpRNG4, stpRNG5 (lowercase 'stp', NOT uppercase 'STPRNG')
  - Updated all three core files: ml-trader.tsx, deriv-volatility-scanner.ts, tick-stream-manager.ts
  - Bot Builder detection now uses case-insensitive check: toLowerCase().startsWith('stprng')
  - This fixes the "Scanning for momentum opportunities..." infinite loop - scanner was rejecting all symbols
- **ML Trader Step Indices Configuration**: Optimized for rate limit avoidance with Step Indices only
  - Replaced 10 volatility indices with 5 Step Indices to reduce simultaneous API load by 50%
  - Step Indices use 1 tick per minute, reducing API calls compared to 1-second volatility indices
  - System fetches 500 historical ticks for each Step Index using Deriv API
  - ML Trader generates Rise/Fall recommendations for Step Indices using momentum-based analysis
- **Bot Builder Market Hierarchy**: Correct Bot Builder XML structure for Step Indices
  - Proper trade_definition block hierarchy with trade_definition_market as child block
  - Populates Market > Submarket > Symbol dropdowns correctly
  - Automatic market/submarket detection: synthetic_index/step_index for Step Indices
- **Port Configuration**: Server runs correctly on port 5000

## October 5, 2025
- **ML Trader Initialization Fix**: Resolved "symbol is not defined" error by moving variable declaration outside try-catch block scope
- **Historical Data Integration**: Fixed ML Trader to properly fetch and process 500 historical ticks from Deriv API for machine learning model training
- **Data Format Transformation**: Implemented proper TickData to scanner format conversion (quote→price, epoch→timestamp)
- **ML Analyzer Import Fix**: Removed duplicate MLTickAnalyzer class and imported the actual implementation from services/ml-tick-analyzer.ts
- **Immediate Scan Implementation**: Changed scanner to perform immediate full scan after historical data loads instead of waiting 30 seconds
- **Auto-Trading Feature**: Implemented automated trading system that continuously purchases contracts every 35 seconds based on ML recommendations
- **Dynamic Symbol Switching**: Auto-trader automatically switches to new recommended symbols when better opportunities are detected
- **Auto-Trade Statistics**: Added auto-trade counter to track automated trades separately from manual trades with visual indicators
- **Contract Loss Tracking**: Enhanced win/loss determination to use profit-based classification (profit > 0 = win, profit < 0 = loss)
- **Contract Completion Detection**: Improved isEnded function to check exit_tick_time, sell_time, status, and is_expired for accurate completion tracking
- **Server Port Configuration**: Updated Rsbuild config to serve on port 5000 for proper Replit environment compatibility

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build System**: Rsbuild with React and Sass plugins
- **State Management**: MobX for reactive state management with stores for different application domains
- **Styling**: SCSS with design system variables and component-scoped styles
- **UI Components**: Custom component library with shared UI components and Deriv UI components
- **Routing**: React Router v6 for client-side navigation

## Visual Bot Builder
- **Blockly Integration**: Google Blockly for drag-and-drop visual programming interface
- **Custom Blocks**: Extended Blockly with trading-specific blocks for strategy creation
- **Code Generation**: JavaScript code generation from visual blocks for execution
- **Strategy Templates**: Pre-built quick strategy templates for common trading patterns

## Trading Engine
- **API Integration**: Deriv API WebSocket connection for real-time market data and trade execution
- **Strategy Types**: Multiple automated trading strategies including martingale, digit analysis, and pattern recognition
- **Risk Management**: Built-in stop-loss, take-profit, and position sizing controls
- **Market Analysis**: Real-time tick data analysis with pattern recognition algorithms

## Data Management
- **Local Storage**: Browser localStorage for strategy persistence and user preferences
- **Session Management**: Client-side session handling with authentication tokens
- **Real-time Data**: WebSocket streams for live market data and trade updates

## Testing Infrastructure
- **Testing Framework**: Jest with React Testing Library for component and unit testing
- **Mocking**: Comprehensive mocking setup for external dependencies and DOM APIs
- **Coverage**: Code coverage reporting with configurable thresholds

# External Dependencies

## Core Dependencies
- **@deriv/deriv-api**: Official Deriv trading API client for market data and trade execution
- **@deriv/deriv-charts**: Charting library for market visualization
- **@deriv-com/analytics**: Analytics and tracking integration
- **@deriv-com/auth-client**: Authentication and authorization client
- **@deriv-com/ui**: Deriv's design system components

## Trading and Analysis
- **blockly**: Visual programming interface for bot building
- **@deriv/js-interpreter**: JavaScript interpreter for strategy execution
- **mobx**: Reactive state management for real-time data updates
- **crypto-js**: Cryptographic utilities for data security

## Development Tools
- **@rsbuild/core**: Modern build tool replacing Webpack
- **@typescript-eslint**: TypeScript linting rules
- **@testing-library/react**: React component testing utilities
- **sass**: CSS preprocessor for styling

## Deployment
- **Cloudflare Pages**: Static site hosting with GitHub Actions integration
- **Environment Variables**: Configuration for different deployment environments (staging, production)
- **Build Optimization**: Bundle analysis and optimization for production builds