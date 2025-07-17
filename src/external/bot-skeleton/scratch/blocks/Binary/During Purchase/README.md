
# During Purchase Blocks

This directory contains blocks that can be used during the purchase phase of trading.

## Available Blocks

### Purchase
- **purchase**: Execute a purchase with the specified contract type
- **sell_at_market**: Sell the current position at market price

### Trading Mode Control
- **continuous_purchase**: Set the trading mode to either continuous (immediate next trade) or sequential (wait for contract close)

## Usage

The continuous_purchase block allows you to control how the bot handles successive trades:

- **Continuous Mode**: The bot will immediately start the next trade after purchasing a contract, without waiting for the previous contract to close.
- **Sequential Mode**: The bot will wait for each contract to close before starting the next trade.

This is particularly useful for martingale and other progression strategies where you need to know the result of the previous trade before determining the stake for the next trade.
