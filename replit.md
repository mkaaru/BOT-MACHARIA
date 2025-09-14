# Overview

Trade Cortex (TradeCortex) is an advanced AI trading bot builder platform that allows users to create automated trading strategies without coding. Built as a React-based web application, it provides a comprehensive trading interface with visual bot building capabilities using Blockly, real-time market analysis, and automated trading strategies for Deriv markets.

The platform features multiple trading approaches including a visual bot builder, quick strategy templates, and an advanced AI-powered trading hub with automated strategies for volatility indices and digit trading.

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