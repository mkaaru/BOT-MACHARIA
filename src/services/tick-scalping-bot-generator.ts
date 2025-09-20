
import { TickScalpingSignal } from './tick-scalping-engine';

export interface TickScalpingBotConfig {
    symbol: string;
    displayName: string;
    signal: TickScalpingSignal;
    stake: number;
    targetTicks: number;
    stopLossTicks: number;
    tradeDuration: number; // in seconds
}

export class TickScalpingBotGenerator {
    /**
     * Generate Bot Builder XML for tick scalping strategy
     */
    generateScalpingBotXML(config: TickScalpingBotConfig): string {
        const contractType = config.signal.direction === 'RISE' ? 'CALL' : 'PUT';
        const contractTypeFull = config.signal.direction === 'RISE' ? 'CALL' : 'PUT';
        
        return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="TickScalpingStake">TickScalpingStake</variable>
    <variable id="LastTickDirection">LastTickDirection</variable>
    <variable id="ConsecutiveCount">ConsecutiveCount</variable>
    <variable id="ScalpingResult">ScalpingResult</variable>
    <variable id="WinCount">WinCount</variable>
    <variable id="LossCount">LossCount</variable>
  </variables>

  <!-- Trade Definition Block -->
  <block type="trade_definition" id="TickScalpingTradeDefinition" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="ScalpingMarket" deletable="false" movable="false">
        <field name="MARKET_LIST">derived</field>
        <field name="SUBMARKET_LIST">continuous_indices</field>
        <field name="SYMBOL_LIST">${config.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="ScalpingTradeType" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">updown</field>
            <field name="TRADETYPE_LIST">risefall</field>
            <next>
              <block type="trade_definition_contracttype" id="ScalpingContractType" deletable="false" movable="false">
                <field name="TYPE_LIST">${contractTypeFull}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="ScalpingCandleInterval" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="ScalpingRestartBuySell" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="ScalpingRestartOnError" deletable="false" movable="false">
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

    <!-- Initialization -->
    <statement name="INITIALIZATION">
      <block type="text_print" id="ScalpingInitPrint">
        <value name="TEXT">
          <shadow type="text" id="ScalpingInitText">
            <field name="TEXT">⚡ Tick Scalping Bot Started - ${config.displayName}</field>
          </shadow>
        </value>
        <next>
          <block type="variables_set" id="InitStake">
            <field name="VAR" id="TickScalpingStake">TickScalpingStake</field>
            <value name="VALUE">
              <block type="math_number" id="InitStakeValue">
                <field name="NUM">${config.stake}</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="InitWinCount">
                <field name="VAR" id="WinCount">WinCount</field>
                <value name="VALUE">
                  <block type="math_number" id="InitWinValue">
                    <field name="NUM">0</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="InitLossCount">
                    <field name="VAR" id="LossCount">LossCount</field>
                    <value name="VALUE">
                      <block type="math_number" id="InitLossValue">
                        <field name="NUM">0</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>

    <!-- Trade Options -->
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="ScalpingTradeOptions">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation>
        <field name="DURATIONTYPE_LIST">s</field>
        <value name="DURATION">
          <shadow type="math_number" id="ScalpingDuration">
            <field name="NUM">${config.tradeDuration}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="ScalpingAmount">
            <field name="NUM">${config.stake}</field>
          </shadow>
          <block type="variables_get" id="GetScalpingStake">
            <field name="VAR" id="TickScalpingStake">TickScalpingStake</field>
          </block>
        </value>
      </block>
    </statement>
  </block>

  <!-- Tick Analysis for Scalping -->
  <block type="tick_analysis" id="ScalpingTickAnalysis" x="267" y="100">
    <statement name="TICKANALYSIS_STACK">
      <block type="variables_set" id="SetLastTick">
        <field name="VAR" id="LastTickDirection">LastTickDirection</field>
        <value name="VALUE">
          <block type="lists_getIndex" id="GetLastTick">
            <mutation xmlns="http://www.w3.org/1999/xhtml" statement="false" at="true"></mutation>
            <field name="MODE">GET</field>
            <field name="WHERE">FROM_END</field>
            <value name="VALUE">
              <block type="lastDigitList" id="LastTickList"></block>
            </value>
            <value name="AT">
              <block type="math_number" id="LastTickIndex">
                <field name="NUM">1</field>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="text_print" id="ScalpingTickPrint">
            <value name="TEXT">
              <shadow type="text" id="TickPrintText">
                <field name="TEXT">Tick Analysis: Scalping based on ${config.signal.method} method</field>
              </shadow>
              <block type="text_join" id="TickAnalysisJoin">
                <mutation xmlns="http://www.w3.org/1999/xhtml" items="3"></mutation>
                <value name="ADD0">
                  <shadow type="text" id="TickText1">
                    <field name="TEXT">Last Tick: </field>
                  </shadow>
                </value>
                <value name="ADD1">
                  <block type="variables_get" id="GetLastTickVar">
                    <field name="VAR" id="LastTickDirection">LastTickDirection</field>
                  </block>
                </value>
                <value name="ADD2">
                  <shadow type="text" id="TickText2">
                    <field name="TEXT"> | Signal: ${config.signal.direction}</field>
                  </shadow>
                </value>
              </block>
            </value>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- Purchase Conditions -->
  <block type="before_purchase" id="ScalpingBeforePurchase" deletable="false" x="679" y="293">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="notify" id="ScalpingNotifyPurchase">
        <field name="NOTIFICATION_TYPE">success</field>
        <field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <shadow type="text" id="PurchaseNotifyText">
            <field name="TEXT">⚡ Tick Scalping: ${contractType} ${config.symbol}</field>
          </shadow>
          <block type="text_join" id="PurchaseJoin">
            <mutation xmlns="http://www.w3.org/1999/xhtml" items="4"></mutation>
            <value name="ADD0">
              <shadow type="text" id="PurchaseText1">
                <field name="TEXT">⚡ Scalping ${contractType}: </field>
              </shadow>
            </value>
            <value name="ADD1">
              <shadow type="text" id="PurchaseText2">
                <field name="TEXT">${config.symbol}</field>
              </shadow>
            </value>
            <value name="ADD2">
              <shadow type="text" id="PurchaseText3">
                <field name="TEXT"> | Confidence: </field>
              </shadow>
            </value>
            <value name="ADD3">
              <shadow type="text" id="PurchaseText4">
                <field name="TEXT">${config.signal.confidence}%</field>
              </shadow>
            </value>
          </block>
        </value>
        <next>
          <block type="purchase" id="ScalpingPurchase">
            <field name="PURCHASE_LIST">${contractTypeFull}</field>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- After Purchase (Results Handling) -->
  <block type="after_purchase" id="ScalpingAfterPurchase" x="1000" y="400">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="ScalpingResultCheck">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="CheckWin">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="IncreaseWinCount">
            <field name="VAR" id="WinCount">WinCount</field>
            <value name="VALUE">
              <block type="math_arithmetic" id="AddWin">
                <field name="OP">ADD</field>
                <value name="A">
                  <shadow type="math_number" id="WinAdd1">
                    <field name="NUM">1</field>
                  </shadow>
                  <block type="variables_get" id="GetWinCount">
                    <field name="VAR" id="WinCount">WinCount</field>
                  </block>
                </value>
                <value name="B">
                  <shadow type="math_number" id="WinAdd1Value">
                    <field name="NUM">1</field>
                  </shadow>
                </value>
              </block>
            </value>
            <next>
              <block type="variables_set" id="SetWinResult">
                <field name="VAR" id="ScalpingResult">ScalpingResult</field>
                <value name="VALUE">
                  <block type="text" id="WinResultText">
                    <field name="TEXT">WIN</field>
                  </block>
                </value>
                <next>
                  <block type="notify" id="WinNotify">
                    <field name="NOTIFICATION_TYPE">success</field>
                    <field name="NOTIFICATION_SOUND">coins</field>
                    <value name="MESSAGE">
                      <shadow type="text" id="WinNotifyText">
                        <field name="TEXT">✅ Scalping WIN! Target reached</field>
                      </shadow>
                      <block type="text_join" id="WinJoin">
                        <mutation xmlns="http://www.w3.org/1999/xhtml" items="3"></mutation>
                        <value name="ADD0">
                          <shadow type="text" id="WinJoinText1">
                            <field name="TEXT">✅ Scalping WIN! Wins: </field>
                          </shadow>
                        </value>
                        <value name="ADD1">
                          <block type="variables_get" id="GetWinCountNotify">
                            <field name="VAR" id="WinCount">WinCount</field>
                          </block>
                        </value>
                        <value name="ADD2">
                          <shadow type="text" id="WinJoinText2">
                            <field name="TEXT"> | Method: ${config.signal.method}</field>
                          </shadow>
                        </value>
                      </block>
                    </value>
                    <next>
                      <block type="trade_again" id="WinTradeAgain"></block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="ScalpingLossCheck">
            <value name="IF0">
              <block type="contract_check_result" id="CheckLoss">
                <field name="CHECK_RESULT">loss</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="IncreaseLossCount">
                <field name="VAR" id="LossCount">LossCount</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="AddLoss">
                    <field name="OP">ADD</field>
                    <value name="A">
                      <shadow type="math_number" id="LossAdd1">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="GetLossCount">
                        <field name="VAR" id="LossCount">LossCount</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="LossAdd1Value">
                        <field name="NUM">1</field>
                      </shadow>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="SetLossResult">
                    <field name="VAR" id="ScalpingResult">ScalpingResult</field>
                    <value name="VALUE">
                      <block type="text" id="LossResultText">
                        <field name="TEXT">LOSS</field>
                      </block>
                    </value>
                    <next>
                      <block type="notify" id="LossNotify">
                        <field name="NOTIFICATION_TYPE">warn</field>
                        <field name="NOTIFICATION_SOUND">out-of-bounds</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="LossNotifyText">
                            <field name="TEXT">❌ Scalping LOSS! Stop hit</field>
                          </shadow>
                          <block type="text_join" id="LossJoin">
                            <mutation xmlns="http://www.w3.org/1999/xhtml" items="3"></mutation>
                            <value name="ADD0">
                              <shadow type="text" id="LossJoinText1">
                                <field name="TEXT">❌ Scalping LOSS! Losses: </field>
                              </shadow>
                            </value>
                            <value name="ADD1">
                              <block type="variables_get" id="GetLossCountNotify">
                                <field name="VAR" id="LossCount">LossCount</field>
                              </block>
                            </value>
                            <value name="ADD2">
                              <shadow type="text" id="LossJoinText2">
                                <field name="TEXT"> | Quick stop activated</field>
                              </shadow>
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
              <block type="trade_again" id="LossTradeAgain"></block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>

  <!-- Risk Management Block -->
  <block type="controls_if" id="ScalpingRiskManagement" x="0" y="800">
    <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
    <value name="IF0">
      <block type="logic_compare" id="MaxLossCheck">
        <field name="OP">GT</field>
        <value name="A">
          <shadow type="math_number" id="MaxLossValue">
            <field name="NUM">5</field>
          </shadow>
          <block type="variables_get" id="GetLossCountRM">
            <field name="VAR" id="LossCount">LossCount</field>
          </block>
        </value>
        <value name="B">
          <shadow type="math_number" id="MaxLossLimit">
            <field name="NUM">5</field>
          </shadow>
        </value>
      </block>
    </value>
    <statement name="DO0">
      <block type="notify" id="RiskManagementNotify">
        <field name="NOTIFICATION_TYPE">error</field>
        <field name="NOTIFICATION_SOUND">i-am-being-serious</field>
        <value name="MESSAGE">
          <shadow type="text" id="RMNotifyText">
            <field name="TEXT">🛑 RISK MANAGEMENT: Too many losses! Bot stopped for review.</field>
          </shadow>
        </value>
        <next>
          <block type="bot_stop" id="BotStopRM"></block>
        </next>
      </block>
    </statement>
    <statement name="ELSE">
      <block type="notify" id="ContinueScalping">
        <field name="NOTIFICATION_TYPE">info</field>
        <field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <shadow type="text" id="ContinueText">
            <field name="TEXT">🎯 Scalping continues... looking for next opportunity</field>
          </shadow>
        </value>
      </block>
    </statement>
  </block>
</xml>`;
    }

    /**
     * Generate a comprehensive tick scalping strategy
     */
    generateAdvancedScalpingStrategy(signals: TickScalpingSignal[], baseStake: number = 1): string {
        if (signals.length === 0) {
            throw new Error('No signals provided for strategy generation');
        }

        const primarySignal = signals[0];
        const symbol = primarySignal.symbol;
        
        return this.generateScalpingBotXML({
            symbol,
            displayName: `Tick Scalping ${symbol}`,
            signal: primarySignal,
            stake: baseStake,
            targetTicks: primarySignal.ticksToProfit,
            stopLossTicks: primarySignal.maxLossTicks,
            tradeDuration: 15 // 15 seconds for quick scalping
        });
    }
}

// Create singleton instance
export const tickScalpingBotGenerator = new TickScalpingBotGenerator();
