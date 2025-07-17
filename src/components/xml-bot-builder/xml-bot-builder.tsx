
import React, { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import Button from '../shared_ui/button';
import InputField from '../shared_ui/input-field';
import Checkbox from '../shared_ui/checkbox';
import Text from '../shared_ui/text';
import './xml-bot-builder.scss';

interface TradeResult {
  id: string;
  profit: number;
  stake: number;
  result: 'win' | 'loss';
  timestamp: number;
}

const XmlBotBuilder = observer(() => {
  const { client, run_panel } = useStore();
  
  // Bot configuration state
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [balance, setBalance] = useState(0);
  
  // Martingale configuration
  const [initialStake, setInitialStake] = useState(1);
  const [currentStake, setCurrentStake] = useState(1);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2);
  const [maxStake, setMaxStake] = useState(100);
  const [useMartingale, setUseMartingale] = useState(false);
  
  // Strategy configuration
  const [selectedSymbol, setSelectedSymbol] = useState('R_10');
  const [contractType, setContractType] = useState('DIGITEVEN');
  const [duration, setDuration] = useState(1);
  const [barrier, setBarrier] = useState(5);
  
  // Trade tracking
  const [tradeHistory, setTradeHistory] = useState<TradeResult[]>([]);
  const [lastTradeResult, setLastTradeResult] = useState<TradeResult | null>(null);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  
  // WebSocket connection
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  // Initialize WebSocket connection
  useEffect(() => {
    const initializeConnection = () => {
      try {
        const websocket = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771');
        
        websocket.onopen = () => {
          setConnectionStatus('Connected');
          console.log('XML Bot Builder: WebSocket connected');
        };
        
        websocket.onmessage = (event) => {
          handleWebSocketMessage(JSON.parse(event.data));
        };
        
        websocket.onclose = () => {
          setConnectionStatus('Disconnected');
          console.log('XML Bot Builder: WebSocket disconnected');
        };
        
        websocket.onerror = (error) => {
          console.error('XML Bot Builder: WebSocket error:', error);
        };
        
        setWs(websocket);
      } catch (error) {
        console.error('Failed to initialize WebSocket:', error);
      }
    };

    initializeConnection();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: any) => {
    if (message.msg_type === 'balance') {
      setBalance(message.balance?.balance || 0);
    } else if (message.msg_type === 'buy') {
      console.log('Purchase successful:', message);
    } else if (message.msg_type === 'proposal_open_contract') {
      handleContractUpdate(message.proposal_open_contract);
    }
  }, []);

  // Handle contract updates
  const handleContractUpdate = useCallback((contract: any) => {
    if (contract.is_sold) {
      const profit = contract.profit;
      const isWin = profit > 0;
      
      const tradeResult: TradeResult = {
        id: contract.id,
        profit: profit,
        stake: currentStake,
        result: isWin ? 'win' : 'loss',
        timestamp: Date.now()
      };
      
      setLastTradeResult(tradeResult);
      setTradeHistory(prev => [...prev, tradeResult]);
      setTotalRuns(prev => prev + 1);
      setTotalProfit(prev => prev + profit);
      
      // Apply martingale logic based on last closed trade
      if (useMartingale) {
        applyMartingaleStrategy(tradeResult);
      }
      
      // Continue trading if bot is still running
      if (isRunning) {
        setTimeout(() => {
          executeTrade();
        }, 1000);
      }
    }
  }, [currentStake, useMartingale, isRunning]);

  // Apply martingale strategy based on last closed trade
  const applyMartingaleStrategy = useCallback((lastTrade: TradeResult) => {
    if (lastTrade.result === 'loss') {
      const newStake = Math.min(currentStake * martingaleMultiplier, maxStake);
      setCurrentStake(newStake);
      setConsecutiveLosses(prev => prev + 1);
      
      console.log(`Loss detected - Increasing stake to ${newStake}`);
    } else {
      // Reset to initial stake on win
      setCurrentStake(initialStake);
      setConsecutiveLosses(0);
      
      console.log(`Win detected - Resetting stake to ${initialStake}`);
    }
  }, [currentStake, martingaleMultiplier, maxStake, initialStake]);

  // Execute trade
  const executeTrade = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    const authToken = client.getToken();
    if (!authToken) {
      console.error('No authorization token available');
      return;
    }

    // Authorize first if needed
    ws.send(JSON.stringify({
      authorize: authToken
    }));

    // Get proposal
    const proposalRequest = {
      proposal: 1,
      amount: currentStake,
      barrier: barrier.toString(),
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration: duration,
      duration_unit: "t",
      symbol: selectedSymbol
    };

    ws.send(JSON.stringify(proposalRequest));

    // Buy contract after getting proposal
    setTimeout(() => {
      const buyRequest = {
        buy: 1,
        price: currentStake
      };
      ws.send(JSON.stringify(buyRequest));
    }, 500);

  }, [ws, client, currentStake, barrier, contractType, duration, selectedSymbol]);

  // Generate XML strategy
  const generateXMLStrategy = useCallback(() => {
    const xmlContent = `
<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="initial_stake">initial_stake</variable>
    <variable id="current_stake">current_stake</variable>
    <variable id="martingale_multiplier">martingale_multiplier</variable>
    <variable id="consecutive_losses">consecutive_losses</variable>
    <variable id="last_profit">last_profit</variable>
    <variable id="max_stake">max_stake</variable>
    <variable id="trade_count">trade_count</variable>
  </variables>

  <block type="trade_definition" id="main_trade_definition" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="market_block" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${selectedSymbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="tradetype_block" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">evenodd</field>
            <next>
              <block type="trade_definition_contracttype" id="contracttype_block" deletable="false" movable="false">
                <field name="TYPE_LIST">${contractType}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="interval_block" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="restart_block" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="error_restart_block" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="trade_options_block">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number" id="duration_number">
            <field name="NUM">${duration}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <block type="variables_get">
            <field name="VAR">current_stake</field>
          </block>
        </value>
      </block>
    </statement>
  </block>

  <!-- Initialize variables on start -->
  <block type="on_start" id="on_start_block" x="0" y="400">
    <statement name="STACK">
      <block type="variables_set">
        <field name="VAR">initial_stake</field>
        <value name="VALUE">
          <shadow type="math_number">
            <field name="NUM">${initialStake}</field>
          </shadow>
        </value>
        <next>
          <block type="variables_set">
            <field name="VAR">martingale_multiplier</field>
            <value name="VALUE">
              <shadow type="math_number">
                <field name="NUM">${martingaleMultiplier}</field>
              </shadow>
            </value>
            <next>
              <block type="variables_set">
                <field name="VAR">max_stake</field>
                <value name="VALUE">
                  <shadow type="math_number">
                    <field name="NUM">${maxStake}</field>
                  </shadow>
                </value>
                <next>
                  <block type="variables_set">
                    <field name="VAR">current_stake</field>
                    <value name="VALUE">
                      <shadow type="math_number">
                        <field name="NUM">${initialStake}</field>
                      </shadow>
                    </value>
                    <next>
                      <block type="variables_set">
                        <field name="VAR">consecutive_losses</field>
                        <value name="VALUE">
                          <shadow type="math_number">
                            <field name="NUM">0</field>
                          </shadow>
                        </value>
                        <next>
                          <block type="variables_set">
                            <field name="VAR">trade_count</field>
                            <value name="VALUE">
                              <shadow type="math_number">
                                <field name="NUM">0</field>
                              </shadow>
                            </value>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- Before purchase -->
  <block type="before_purchase" id="before_purchase_block" x="400" y="400">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="text_print">
        <value name="TEXT">
          <block type="text_join">
            <mutation items="3"></mutation>
            <value name="ADD0">
              <shadow type="text">
                <field name="TEXT">📊 TRADE: </field>
              </shadow>
            </value>
            <value name="ADD1">
              <block type="variables_get">
                <field name="VAR">trade_count</field>
              </block>
            </value>
            <value name="ADD2">
              <block type="text_join">
                <mutation items="2"></mutation>
                <value name="ADD0">
                  <shadow type="text">
                    <field name="TEXT"> - Stake: </field>
                  </shadow>
                </value>
                <value name="ADD1">
                  <block type="variables_get">
                    <field name="VAR">current_stake</field>
                  </block>
                </value>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="purchase">
            <field name="PURCHASE_LIST">${contractType}</field>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- After purchase - Apply martingale based on last closed trade -->
  <block type="after_purchase" id="after_purchase_block" x="800" y="400">
    <statement name="AFTERPURCHASE_STACK">
      <block type="variables_set">
        <field name="VAR">last_profit</field>
        <value name="VALUE">
          <block type="math_arithmetic">
            <field name="OP">MINUS</field>
            <value name="A">
              <block type="sell_price"></block>
            </value>
            <value name="B">
              <block type="ask_price"></block>
            </value>
          </block>
        </value>
        <next>
          <block type="variables_set">
            <field name="VAR">trade_count</field>
            <value name="VALUE">
              <block type="math_arithmetic">
                <field name="OP">ADD</field>
                <value name="A">
                  <block type="variables_get">
                    <field name="VAR">trade_count</field>
                  </block>
                </value>
                <value name="B">
                  <shadow type="math_number">
                    <field name="NUM">1</field>
                  </shadow>
                </value>
              </block>
            </value>
            <next>
              <!-- Apply martingale logic based on last closed trade result -->
              <block type="controls_if">
                <mutation else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare">
                    <field name="OP">LT</field>
                    <value name="A">
                      <block type="variables_get">
                        <field name="VAR">last_profit</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number">
                        <field name="NUM">0</field>
                      </shadow>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <!-- On Loss: Apply martingale if stake doesn't exceed max -->
                  <block type="controls_if">
                    <value name="IF0">
                      <block type="logic_compare">
                        <field name="OP">LTE</field>
                        <value name="A">
                          <block type="math_arithmetic">
                            <field name="OP">MULTIPLY</field>
                            <value name="A">
                              <block type="variables_get">
                                <field name="VAR">current_stake</field>
                              </block>
                            </value>
                            <value name="B">
                              <block type="variables_get">
                                <field name="VAR">martingale_multiplier</field>
                              </block>
                            </value>
                          </block>
                        </value>
                        <value name="B">
                          <block type="variables_get">
                            <field name="VAR">max_stake</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <!-- Apply martingale -->
                      <block type="variables_set">
                        <field name="VAR">current_stake</field>
                        <value name="VALUE">
                          <block type="math_arithmetic">
                            <field name="OP">MULTIPLY</field>
                            <value name="A">
                              <block type="variables_get">
                                <field name="VAR">current_stake</field>
                              </block>
                            </value>
                            <value name="B">
                              <block type="variables_get">
                                <field name="VAR">martingale_multiplier</field>
                              </block>
                            </value>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set">
                            <field name="VAR">consecutive_losses</field>
                            <value name="VALUE">
                              <block type="math_arithmetic">
                                <field name="OP">ADD</field>
                                <value name="A">
                                  <block type="variables_get">
                                    <field name="VAR">consecutive_losses</field>
                                  </block>
                                </value>
                                <value name="B">
                                  <shadow type="math_number">
                                    <field name="NUM">1</field>
                                  </shadow>
                                </value>
                              </block>
                            </value>
                            <next>
                              <block type="text_print">
                                <value name="TEXT">
                                  <block type="text_join">
                                    <mutation items="2"></mutation>
                                    <value name="ADD0">
                                      <shadow type="text">
                                        <field name="TEXT">🔴 LOSS: Next stake increased to </field>
                                      </shadow>
                                    </value>
                                    <value name="ADD1">
                                      <block type="variables_get">
                                        <field name="VAR">current_stake</field>
                                      </block>
                                    </value>
                                  </block>
                                </value>
                              </block>
                            </next>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next>
                      <!-- Check if we exceeded max stake, reset if so -->
                      <block type="controls_if">
                        <value name="IF0">
                          <block type="logic_compare">
                            <field name="OP">GT</field>
                            <value name="A">
                              <block type="variables_get">
                                <field name="VAR">current_stake</field>
                              </block>
                            </value>
                            <value name="B">
                              <block type="variables_get">
                                <field name="VAR">max_stake</field>
                              </block>
                            </value>
                          </block>
                        </value>
                        <statement name="DO0">
                          <block type="variables_set">
                            <field name="VAR">current_stake</field>
                            <value name="VALUE">
                              <block type="variables_get">
                                <field name="VAR">initial_stake</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set">
                                <field name="VAR">consecutive_losses</field>
                                <value name="VALUE">
                                  <shadow type="math_number">
                                    <field name="NUM">0</field>
                                  </shadow>
                                </value>
                                <next>
                                  <block type="text_print">
                                    <value name="TEXT">
                                      <shadow type="text">
                                        <field name="TEXT">⚠️ MAX STAKE EXCEEDED: Reset to initial stake</field>
                                      </shadow>
                                    </value>
                                  </block>
                                </next>
                              </block>
                            </next>
                          </block>
                        </statement>
                      </block>
                    </next>
                  </block>
                </statement>
                <statement name="ELSE">
                  <!-- On Win: Reset to initial stake -->
                  <block type="variables_set">
                    <field name="VAR">current_stake</field>
                    <value name="VALUE">
                      <block type="variables_get">
                        <field name="VAR">initial_stake</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set">
                        <field name="VAR">consecutive_losses</field>
                        <value name="VALUE">
                          <shadow type="math_number">
                            <field name="NUM">0</field>
                          </shadow>
                        </value>
                        <next>
                          <block type="text_print">
                            <value name="TEXT">
                              <shadow type="text">
                                <field name="TEXT">🟢 WIN: Stake reset to initial amount</field>
                              </shadow>
                            </value>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </statement>
                <next>
                  <block type="trade_again"></block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`;

    return xmlContent;
  }, [selectedSymbol, contractType, duration, initialStake, martingaleMultiplier, maxStake]);

  // Load strategy into bot builder
  const loadStrategyToBuilder = useCallback(() => {
    const xmlContent = generateXMLStrategy();
    
    // Load into bot builder using existing load modal functionality
    const { load_modal } = useStore();
    if (load_modal && typeof load_modal.loadFileFromContent === 'function') {
      load_modal.loadFileFromContent(xmlContent);
    }
  }, [generateXMLStrategy]);

  // Start/Stop bot
  const toggleBot = useCallback(() => {
    if (isRunning) {
      setIsRunning(false);
      console.log('XML Bot stopped');
    } else {
      setIsRunning(true);
      setCurrentStake(initialStake);
      setConsecutiveLosses(0);
      console.log('XML Bot started');
      executeTrade();
    }
  }, [isRunning, initialStake, executeTrade]);

  return (
    <div className="xml-bot-builder">
      <div className="xml-bot-builder__header">
        <Text size="lg" weight="bold">XML Bot Builder</Text>
        <div className="xml-bot-builder__status">
          <Text size="sm" color={connectionStatus === 'Connected' ? 'success' : 'danger'}>
            {connectionStatus}
          </Text>
        </div>
      </div>

      <div className="xml-bot-builder__content">
        {/* Strategy Configuration */}
        <div className="xml-bot-builder__section">
          <Text size="md" weight="bold">Strategy Configuration</Text>
          
          <div className="xml-bot-builder__form-row">
            <InputField
              type="text"
              label="Symbol"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
            />
            <InputField
              type="text"
              label="Contract Type"
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
            />
          </div>

          <div className="xml-bot-builder__form-row">
            <InputField
              type="number"
              label="Duration (ticks)"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
            <InputField
              type="number"
              label="Barrier"
              value={barrier}
              onChange={(e) => setBarrier(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Martingale Configuration */}
        <div className="xml-bot-builder__section">
          <Text size="md" weight="bold">Martingale Settings</Text>
          
          <Checkbox
            checked={useMartingale}
            onChange={() => setUseMartingale(!useMartingale)}
            label="Enable Martingale"
          />

          {useMartingale && (
            <>
              <div className="xml-bot-builder__form-row">
                <InputField
                  type="number"
                  label="Initial Stake"
                  value={initialStake}
                  onChange={(e) => setInitialStake(Number(e.target.value))}
                />
                <InputField
                  type="number"
                  label="Multiplier"
                  value={martingaleMultiplier}
                  onChange={(e) => setMartingaleMultiplier(Number(e.target.value))}
                />
              </div>
              <InputField
                type="number"
                label="Max Stake"
                value={maxStake}
                onChange={(e) => setMaxStake(Number(e.target.value))}
              />
            </>
          )}
        </div>

        {/* Trading Stats */}
        <div className="xml-bot-builder__section">
          <Text size="md" weight="bold">Trading Statistics</Text>
          
          <div className="xml-bot-builder__stats">
            <div className="xml-bot-builder__stat">
              <Text size="sm">Balance: ${balance.toFixed(2)}</Text>
            </div>
            <div className="xml-bot-builder__stat">
              <Text size="sm">Total Runs: {totalRuns}</Text>
            </div>
            <div className="xml-bot-builder__stat">
              <Text size="sm">Current Stake: ${currentStake}</Text>
            </div>
            <div className="xml-bot-builder__stat">
              <Text size="sm">Consecutive Losses: {consecutiveLosses}</Text>
            </div>
            <div className="xml-bot-builder__stat">
              <Text size="sm">Total P&L: ${totalProfit.toFixed(2)}</Text>
            </div>
          </div>
        </div>

        {/* Last Trade Result */}
        {lastTradeResult && (
          <div className="xml-bot-builder__section">
            <Text size="md" weight="bold">Last Trade</Text>
            <div className="xml-bot-builder__last-trade">
              <Text size="sm">
                Result: {lastTradeResult.result === 'win' ? '🟢 WIN' : '🔴 LOSS'} | 
                Profit: ${lastTradeResult.profit.toFixed(2)} | 
                Stake: ${lastTradeResult.stake}
              </Text>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="xml-bot-builder__actions">
          <Button
            text="Load to Bot Builder"
            onClick={loadStrategyToBuilder}
            primary
          />
          <Button
            text={isRunning ? 'Stop Bot' : 'Start Bot'}
            onClick={toggleBot}
            color={isRunning ? 'danger' : 'success'}
            disabled={connectionStatus !== 'Connected'}
          />
        </div>
      </div>
    </div>
  );
});

export default XmlBotBuilder;
