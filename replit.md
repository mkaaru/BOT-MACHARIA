# Overview

Trade Cortex (TradeCortex) is an advanced AI trading bot builder platform that allows users to create automated trading strategies without coding. Built as a React-based web application, it provides a comprehensive trading interface with visual bot building capabilities using Blockly, real-time market analysis, and automated trading strategies for Deriv markets.

The platform features multiple trading approaches including a visual bot builder, quick strategy templates, and an advanced AI-powered trading hub with automated strategies for volatility indices and digit trading.

# Recent Changes

## October 6, 2025
- **System Restore**: Reverted Step Indices integration due to API compatibility issues
- **Working Configuration**: Restored to volatility indices only (R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V)
- **Port Configuration**: Resolved duplicate server process issue, server now runs correctly on port 5000

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