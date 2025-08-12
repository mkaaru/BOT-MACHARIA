import React, { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';
import AnalysistoolComponent from '@/components/analysistool/analysis';
import PercentageTool from '@/components/percentage-tool/percentage-tool';
import DecyclerBot from '@/components/decycler-bot/decycler-bot';

const Chart = lazy(() => import('../chart'));
const Tutorial = lazy(() => import('../tutorials'));
const BotBuilder = lazy(() => import('../bot-builder'));

const DashboardIcon = () => (
    <svg width="20" height="20" fill="var(--text-general)" viewBox="0 0 24 24">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
    </svg>
);

const BotBuilderIcon = () => (
   <svg fill="var(--text-general)" width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" d="M20,9.85714286 L20,14.1428571 C20,15.2056811 19.0732946,16 18,16 L6,16 C4.92670537,16 4,15.2056811 4,14.1428571 L4,9.85714286 C4,8.79431889 4.92670537,8 6,8 L18,8 C19.0732946,8 20,8.79431889 20,9.85714286 Z M6,10 L6,14 L18,14 L18,10 L6,10 Z M2,19 L2,17 L22,17 L22,19 L2,19 Z M2,7 L2,5 L22,5 L22,7 L2,7 Z"/>
</svg>
);

const ChartsIcon = () => (
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21 21H7.8C6.11984 21 5.27976 21 4.63803 20.673C4.07354 20.3854 3.6146 19.9265 3.32698 19.362C3 18.7202 3 17.8802 3 16.2V3M6 15L10 11L14 15L20 9M20 9V13M20 9H16" stroke="var(--text-general)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
);

const TutorialsIcon = () => (
   <svg width="24px" height="24px" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" fill="none"><path stroke="var(--text-general)" stroke-width="12" d="M170 96c0-45-4.962-49.999-50-50H72c-45.038.001-50 5-50 50s4.962 49.999 50 50h48c45.038-.001 50-5 50-50Z"/><path stroke="var(--text-general)" stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="m82 74 34 22-34 22"/></svg>
);

const AnalysisToolIcon = () => (
    <svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M7.5 3.5V6.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M7.5 14.5V18.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M6.8 6.5C6.08203 6.5 5.5 7.08203 5.5 7.8V13.2C5.5 13.918 6.08203 14.5 6.8 14.5H8.2C8.91797 14.5 9.5 13.918 9.5 13.2V7.8C9.5 7.08203 8.91797 6.5 8.2 6.5H6.8Z" stroke="var(--text-general)"/>
<path d="M16.5 6.5V11.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M16.5 16.5V20.5" stroke="var(--text-general)" stroke-linecap="round"/>
<path d="M15.8 11.5C15.082 11.5 14.5 12.082 14.5 12.8V15.2C14.5 15.918 15.082 16.5 15.8 16.5H17.2C17.918 16.5 18.5 15.918 18.5 15.2V12.8C18.5 12.082 17.918 11.5 17.2 11.5H15.8Z" stroke="var(--text-general)"/>
</svg>
);

const SignalsIcon = () => (
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 6.00067L21 6.00139M8 12.0007L21 12.0015M8 18.0007L21 18.0015M3.5 6H3.51M3.5 12H3.51M3.5 18H3.51M4 6C4 6.27614 3.77614 6.5 3.5 6.5C3.22386 6.5 3 6.27614 3 6C3 5.72386 3.22386 5.5 3.5 5.5C3.77614 5.5 4 5.72386 4 6ZM4 12C4 12.2761 3.77614 12.5 3.5 12.5C3.22386 12.5 3 12.2761 3 12C3 11.7239 3.22386 11.5 3.5 11.5C3.77614 11.5 4 11.7239 4 12ZM4 18C4 18.2761 3.77614 18.5 3.5 18.5C3.22386 18.5 3 18.2761 3 18C3 17.7239 3.22386 17.5 3.5 17.5C3.77614 17.5 4 17.7239 4 18Z" stroke="var(--text-general)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
);

const TradingHubIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="var(--text-general)" width="24px" height="24px" viewBox="0 0 24 24"><path d="M21.49 13.926l-3.273 2.48c.054-.663.116-1.435.143-2.275.04-.89.023-1.854-.043-2.835-.043-.487-.097-.98-.184-1.467-.077-.485-.196-.982-.31-1.39-.238-.862-.535-1.68-.9-2.35-.352-.673-.786-1.173-1.12-1.462-.172-.144-.31-.248-.414-.306l-.153-.093c-.083-.05-.187-.056-.275-.003-.13.08-.175.252-.1.388l.01.02s.11.198.258.54c.07.176.155.38.223.63.08.24.14.528.206.838.063.313.114.66.17 1.03l.15 1.188c.055.44.106.826.13 1.246.03.416.033.85.026 1.285.004.872-.063 1.76-.115 2.602-.062.853-.12 1.65-.172 2.335 0 .04-.004.073-.005.11l-.115-.118-2.996-3.028-1.6.454 5.566 6.66 6.394-5.803-1.503-.677z"/><path d="M2.503 9.48L5.775 7c-.054.664-.116 1.435-.143 2.276-.04.89-.023 1.855.043 2.835.043.49.097.98.184 1.47.076.484.195.98.31 1.388.237.862.534 1.68.9 2.35.35.674.785 1.174 1.12 1.463.17.145.31.25.413.307.1.06.152.093.152.093.083.05.187.055.275.003.13-.08.175-.252.1-.388l-.01-.02s-.11-.2-.258-.54c-.07-.177-.155-.38-.223-.63-.082-.242-.14-.528-.207-.84-.064-.312-.115-.658-.15-1.19-.053-.44-.104-.825-.128-1.246-.03-.415-.033-.85-.026-1.285-.004-.872.063-1.76.115-2.603.064-.853.122-1.65.174-2.334 0-.04.004-.074.005-.11l.114.118 2.996 3.027 1.6-.454L7.394 3 1 8.804l1.503.678z"/></svg>
);

const FreeBotsIcon = () => (
   <svg fill="var(--text-general)" width="20px" height="20px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-name="Layer 1"><path d="M10,13H4a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V14A1,1,0,0,0,10,13ZM9,19H5V15H9ZM20,3H14a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,20,3ZM19,9H15V5h4Zm1,7H18V14a1,1,0,0,0-2,0v2H14a1,1,0,0,0,0,2h2v2a1,1,0,0,0,2,0V18h2a1,1,0,0,0,0-2ZM10,3H4A1,1,0,0,0,3,4v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,10,3ZM9,9H5V5H9Z"/></svg>
);

const BotIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="var(--text-general)" />
    </svg>
);

// Import actual components
import VolatilityAnalyzer from '@/components/volatility-analyzer/volatility-analyzer';
import SpeedBot from '@/components/speed-bot/speed-bot';
import TradingHubDisplay from '@/components/trading-hub-display/trading-hub-display';

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card } = useStore();
    const {
        active_tab,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
    } = dashboard;
    const { onEntered } = load_modal;
    const { is_dialog_open, dialog_options, onCancelButtonClick, onCloseDialog, onOkButtonClick, stopBot, is_drawer_open } = run_panel;
    const { cancel_button_text, ok_button_text, title, message } = dialog_options as { [key: string]: string };
    const { clear } = summary_card;
    const { FREE_BOTS, BOT_BUILDER, ANALYSIS_TOOL, SIGNALS, DASHBOARD } = DBOT_TABS;
    const { isDesktop } = useDevice();
    const location = useLocation();
    const navigate = useNavigate();

    const [bots, setBots] = useState([]);
    // Digits Trading Bot States
  const [selectedIndex, setSelectedIndex] = useState('R_100')
  const [contractType, setContractType] = useState('DIGITEVEN')
  const [predictionModel, setPredictionModel] = useState('neural_network')
  const [stakeAmount, setStakeAmount] = useState('1.00')
  const [isConnected, setIsConnected] = useState(false)
  const [isTrading, setIsTrading] = useState(false)
  const [currentTick, setCurrentTick] = useState<number | null>(null)
  const [currentPrice, setCurrentPrice] = useState<string>('---')
  const [tickHistory, setTickHistory] = useState<{[key: string]: number[]}>({})
  const [digitDistribution, setDigitDistribution] = useState<number[]>(new Array(10).fill(0))
  const [digitPercentages, setDigitPercentages] = useState<number[]>(new Array(10).fill(10))
  const [nextPrediction, setNextPrediction] = useState<string>('')
  const [confidence, setConfidence] = useState(0)
  const [predictionAccuracy, setPredictionAccuracy] = useState(0)
  const [evenOddBias, setEvenOddBias] = useState('NEUTRAL')
  const [overUnderBias, setOverUnderBias] = useState('NEUTRAL')
  const [streakPattern, setStreakPattern] = useState('---')
  const [tradingLog, setTradingLog] = useState<any[]>([])
  const [totalTrades, setTotalTrades] = useState(0)
  const [winRate, setWinRate] = useState(0)
  const [profitLoss, setProfitLoss] = useState(0)
  const [currentStreak, setCurrentStreak] = useState(0)
  const [websocket, setWebsocket] = useState<WebSocket | null>(null)
    const [pythonCode, setPythonCode] = useState('');
    const [pythonOutput, setPythonOutput] = useState([]);
    const [savedScripts, setSavedScripts] = useState([]);
    const [isExecuting, setIsExecuting] = useState(false);
    // Add new state for analysis tool URL


    // Add function to check if analysis tool is active
    const isAnalysisToolActive = active_tab === ANALYSIS_TOOL;

    useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
            if (is_bot_running) {
                clear();
                stopBot();
                api_base.setIsRunning(false);
            }
        }
    }, [clear, connectionStatus, stopBot]);

    useEffect(() => {
        // Fetch the XML files and parse them
        const fetchBots = async () => {
            // Priority bots with embedded XML content
            const priorityBots = [
                {
                    title: 'Maziwa Tele Under Bot',
                    filePath: 'Maziwa Tele Under Bot.xml',
                    xmlContent: `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="sF6($OTq!BVWswgj}4|S">Prediction before loss</variable>
    <variable id="o!-=j_eJZCfW(+iV7;MS">Tick 1</variable>
    <variable id="OPb$Wwph1|)^r0#|^^y}">Prediction after loss</variable>
    <variable id="7Q4y$nr_sr!x2NkOu%)2">Stake</variable>
    <variable id="$+Q3~hzlFiI[$SMrBNB?">Prediction</variable>
    <variable id="Y$cG[}L|(_T-=;0ZyXI.">text1</variable>
    <variable id="icmJXVK=|*WSXkYEU*E;">text</variable>
    <variable id="x\`Ia+qCu@StiaJI^X([4">Entrypoint-Digit</variable>
    <variable id=":Z8WvPXWG?qCe|8=iii1">Expected Profit</variable>
    <variable id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</variable>
    <variable id="+L:nET.PS2OXV5VNGInM">Analysis</variable>
    <variable id="L.cN$B-UUzkS|eDQm2xZ">Stop Loss</variable>
    <variable id="Op-Cim@t?DJN?i;G)w)C">Count Loss</variable>
    <variable id="~ZEk9Zr7t[g;-\`afIGOO">Initial Stake</variable>
    <variable id="!mQjsA[]viO$7Gu~UzUn">Martingale Split</variable>
    <variable id="VK7:nSRSXJ=|#p(oAU9v">Payout %</variable>
  </variables>
  <block type="trade_definition" id="deUzn(1}F)X6;d+O#$A8" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="*ZjSt,1/{;THl;IV%*sy" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">1HZ10V</field>
        <next>
          <block type="trade_definition_tradetype" id="xzc0Sl\`,#G4h{;usN50T" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">overunder</field>
            <next>
              <block type="trade_definition_contracttype" id="z9892C3%qM2{aa@jy]2]" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id=";)B,zZH~+e,96QvZt*7;" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="5E?,-;gq5Qu_eyIs.)m!" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="?u~0^reDb~fVp[b-~w|G" deletable="false" movable="false">
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
    <statement name="INITIALIZATION">
      <block type="variables_set" id="4$5m(H*{\`c4#S-)o=;aV">
        <field name="VAR" id="sF6($OTq!BVWswgj}4|S">Prediction before loss</field>
        <value name="VALUE">
          <block type="math_number" id="Ai5]{:#d~w;]%q\`:p[h,">
            <field name="NUM">9</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="f;c!1^-bb9K7rQ{#3/l0">
            <field name="VAR" id="OPb$Wwph1|)^r0#|^^y}">Prediction after loss</field>
            <value name="VALUE">
              <block type="math_number" id="gT6?xbULKjs8^Sw?0iH%">
                <field name="NUM">6</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="_aSBe^/).nS{bwLbiE9n">
                <field name="VAR" id="x\\\`Ia+qCu@StiaJI^X([4">Entrypoint-Digit</field>
                <value name="VALUE">
                  <block type="math_number" id="KR2=c$XO!b_Bgl_ASR4(">
                    <field name="NUM">7</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="y-?,og][*D.g)z\`wz~sr">
                    <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                    <value name="VALUE">
                      <block type="math_number" id="!TI[pk;TXnU%n?K/nH:^">
                        <field name="NUM">1</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="9.jN~btog59cUwf8:lPl">
                        <field name="VAR" id=":Z8WvPXWG?qCe|8=iii1">Expected Profit</field>
                        <value name="VALUE">
                          <block type="math_number" id=".\`(0weVv%;N,|MA\`*;Ll">
                            <field name="NUM">100</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="MpN0,W8A;joH2n#IXF@!">
                            <field name="VAR" id="L.cN$B-UUzkS|eDQm2xZ">Stop Loss</field>
                            <value name="VALUE">
                              <block type="math_number" id="tACLVvalL.#)Xxz\`ZoBC">
                                <field name="NUM">1000</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="-z^omJLEhTT5\`I:NZ;J=-">
                                <field name="VAR" id="~ZEk9Zr7t[g;-\\\`afIGOO">Initial Stake</field>
                                <value name="VALUE">
                                  <block type="variables_get" id="SoAC,+VI6PpU1=/|ThHQ">
                                    <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id=":y8AYtv{x\`8LFslg8@Pc">
                                    <field name="VAR" id="!mQjsA[]viO$7Gu~UzUn">Martingale Split</field>
                                    <value name="VALUE">
                                      <block type="math_number" id="LqV%S=;Xlb|o9}weJjz1">
                                        <field name="NUM">2.55</field>
                                      </block>
                                    </value>
                                    <next>
                                      <block type="variables_set" id="7A:2S/;VFh?W0fI|W^{]">
                                        <field name="VAR" id="VK7:nSRSXJ=|#p(oAU9v">Payout %</field>
                                        <value name="VALUE">
                                          <block type="math_number" id="*nsC7E\`vh$_)]~v1u.#[">
                                            <field name="NUM">39</field>
                                          </block>
                                        </value>
                                        <next>
                                          <block type="variables_set" id="i-+y35ET%iNI#gfE=j}f">
                                            <field name="VAR" id="$+Q3~hzlFiI[$SMrBNB?">Prediction</field>
                                            <value name="VALUE">
                                              <block type="variables_get" id="lz.rXO5Nim{3$+J{lQc">
                                                <field name="VAR" id="sF6($OTq!BVWswgj}4|S">Prediction before loss</field>
                                              </block>
                                            </value>
                                            <next>
                                              <block type="variables_set" id="8pGcw{d^D[X~Q9WWr9L$">
                                                <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
                                                <value name="VALUE">
                                                  <block type="text" id="CSPjU%E/2Z*fs-7r2@%|">
                                                    <field name="TEXT">analysis</field>
                                                  </block>
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
      <block type="trade_definition_tradeoptions" id="+2=*XrtB:_,H.ZbX=p:?">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number" id=".VN]5$PRz#[mu4gLEpE)">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="uDV:;sle3{o8l:/liSA4">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="e8^MR4,v|mL$uYo-N2,7">
            <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
          </block>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="C._P3Q2a(ed{Kmim3U^G">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="7M|Q{wh7BX?zpzY|TlN.">
            <field name="VAR" id="$+Q3~hzlFiI[$SMrBNB?">Prediction</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="ymTrZ2T/bD#hXN^}%;gD" x="893" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="aZ/eJwRn+2B?g?#!Rb%#">
        <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="=CPoUAxWy4D?!*TdX_:Q">
            <field name="OP">GT</field>
            <value name="A">
              <block type="total_profit" id="%W]vwSTU2OHqSjiF#6vF"></block>
            </value>
            <value name="B">
              <block type="variables_get" id="u{$,)w%F3EH+k_ppwTuh">
                <field name="VAR" id=":Z8WvPXWG?qCe|8=iii1">Expected Profit</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="text_join" id="wXlfZYv9q1.db)%Mk;n:">
            <field name="VARIABLE" id="Y$cG[}L|(_T-=;0ZyXI.">text1</field>
            <statement name="STACK">
              <block type="text_statement" id="fEODtPvxb~Pq9(wLL(7)">
                <value name="TEXT">
                  <shadow type="text" id="}G!me?B=1d+JazlN/cn9">
                    <field name="TEXT"></field>
                  </shadow>
                  <block type="text" id="}z_N)o#C_q%y%O*-06h[">
                    <field name="TEXT">Tp hit</field>
                  </block>
                </value>
                <next>
                  <block type="text_statement" id="[DYy),LGh$:we/z91nXm">
                    <value name="TEXT">
                      <shadow type="text" id="$iphA?Wh5=3Cir9KM{OT">
                        <field name="TEXT"></field>
                      </shadow>
                      <block type="text" id="cc=!2%kS#4A#EaD1emS4">
                        <field name="TEXT">&lt;&lt; CONGRATULATIONS. &gt;&gt; You have successfully printed&gt;  &amp;</field>
                      </block>
                    </value>
                    <next>
                      <block type="text_statement" id=":{/=:+zah8V6/Q?ZE{(z">
                        <value name="TEXT">
                          <shadow type="text" id="A\`([INSV+:7ygD7cZ@j;">
                            <field name="TEXT"></field>
                          </shadow>
                          <block type="total_profit" id="A~!}?z=.-$yZ3Y$\{jZ~4"></block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="text_print" id="bn4.=Kye=;B06#m*^]Mz">
                <value name="TEXT">
                  <shadow type="text" id="L;9=9qa,@)]+arRqzGT|">
                    <field name="TEXT">abc</field>
                  </shadow>
                  <block type="variables_get" id="_a38DajDS)I21w2c[1Ou">
                    <field name="VAR" id="Y$cG[}L|(_T-=;0ZyXI.">text1</field>
                  </block>
                </value>
              </block>
            </next>
          </block>
        </statement>
        <value name="IF1">
          <block type="logic_compare" id="z5WP~8PDdgsb($NhN;$|">
            <field name="OP">LTE</field>
            <value name="A">
              <block type="total_profit" id="U(mi=kxH#ytDrvpszM,|"></block>
            </value>
            <value name="B">
              <block type="math_single" id="?vi^Mf0IMKgiWl?7(kXF">
                <field name="OP">NEG</field>
                <value name="NUM">
                  <shadow type="math_number" id="G5%tZ/b;7*ZdUOhD/7]Y">
                    <field name="NUM">9</field>
                  </shadow>
                  <block type="variables_get" id="%0X#dsb^67G_o-lF}4z#">
                    <field name="VAR" id="L.cN$B-UUzkS|eDQm2xZ">Stop Loss</field>
                  </block>
                </value>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO1">
          <block type="text_print" id="W[bg\`R=Gq/~{0M#AfLt}">
            <value name="TEXT">
              <shadow type="text" id="su#SP}OYEm942K4~)nLH">
                <field name="TEXT">SL hit</field>
              </shadow>
            </value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="*Gyn=E:%D.Zg+QXU4/5B">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="4dW}cXg#gmD#,,rnEyQ*">
                <field name="CHECK_RESULT">loss</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="math_change" id="DmlXTt^a/Pz.1ZcJ1[DB">
                <field name="VAR" id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</field>
                <value name="DELTA">
                  <shadow type="math_number" id="@KJq1;gh,*]xXvHs%wR]">
                    <field name="NUM">1</field>
                  </shadow>
                  <block type="variables_get" id="5OL;;LN/RE~[8skE!\`8">
                    <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                  </block>
                </value>
                <next>
                  <block type="controls_if" id="vJz]y7]1v7[Lay.S9|RQ">
                    <value name="IF0">
                      <block type="logic_compare" id="TiYBy5{NUh21rh!]WP1{">
                        <field name="OP">GT</field>
                        <value name="A">
                          <block type="variables_get" id="_f9{!u:oct6GDaaZc/?t">
                            <field name="VAR" id="Op-Cim@t?DJN?i;G)w)C">Count Loss</field>
                          </block>
                        </value>
                        <value name="B">
                          <block type="math_number" id="!1:Qc)Cp#@{W$~?Jc;jw">
                            <field name="NUM">0</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="CB;A*!5?-TW-xF)m}DIX">
                        <field name="VAR" id="Op-Cim@t?DJN?i;G)w)C">Count Loss</field>
                        <value name="VALUE">
                          <block type="math_number" id="6)f[75M@_[kv*{G8[P6y">
                            <field name="NUM">0</field>
                          </block>
                        </value>
                      </block>
                    </statement>
                  </block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="He_x6j*4kHFBYva,NX(%">
                <field name="VAR" id="$+Q3~hzlFiI[$SMrBNB?">Prediction</field>
                <value name="VALUE">
                  <block type="variables_get" id="y!8w@QY!!M{={xj7YcAc">
                    <field name="VAR" id="OPb$Wwph1|)^r0#|^^y}">Prediction after loss</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="{Bzpl6Bze5j1=9;KTYo!">
                    <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
                    <value name="VALUE">
                      <block type="text" id="Ko,r\`,iWR)zE2?zoQPy*">
                        <field name="TEXT">gk</field>
                      </block>
                    </value>
                    <next>
                      <block type="math_change" id="[(u[h.H,+ZSePi._I#Ae">
                        <field name="VAR" id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</field>
                        <value name="DELTA">
                          <shadow type="math_number" id=";vm%OPmNCN=gCQW)(t@S">
                            <field name="NUM">1</field>
                          </shadow>
                          <block type="math_single" id=";pMO[^7+@pX!F6{PO,cu">
                            <field name="OP">NEG</field>
                            <value name="NUM">
                              <shadow type="math_number" id=")8P8lMVf0i}%mC/@]7-e">
                                <field name="NUM">9</field>
                              </shadow>
                              <block type="read_details" id="qgSZdkTT+k._L1{~5Yf|">
                                <field name="DETAIL_INDEX">4</field>
                              </block>
                            </value>
                          </block>
                        </value>
                        <next>
                          <block type="controls_if" id="KJ*,2)^Zgv|0RqFOPd5Q">
                            <value name="IF0">
                              <block type="logic_compare" id="J%ddIHb)=I-TK|Sh!0m5">
                                <field name="OP">LT</field>
                                <value name="A">
                                  <block type="variables_get" id="Mnd!\`VtpYWWTyGQ/Ln4Q">
                                    <field name="VAR" id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</field>
                                  </block>
                                </value>
                                <value name="B">
                                  <block type="math_number" id="xP:|X^Iyz=23f|,p!OT5">
                                    <field name="NUM">0</field>
                                  </block>
                                </value>
                              </block>
                            </value>
                            <statement name="DO0">
                              <block type="variables_set" id="4rv~sV-aHjztXMjoEE^Q">
                                <field name="VAR" id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</field>
                                <value name="VALUE">
                                  <block type="math_number" id="efYt//0}X;(,x:NR](*B">
                                    <field name="NUM">0</field>
                                  </block>
                                </value>
                              </block>
                            </statement>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="controls_if" id="fEu5CRw~xV5XY~ZPY6^g">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="7N2#NJB0lz;$BIBSY#7:">
                    <field name="OP">GT</field>
                    <value name="A">
                      <block type="variables_get" id="Ru9Qzl:Aj3:mEyS[xFFh">
                        <field name="VAR" id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="math_number" id="{~q2nK%||rPAI=dKBC6u">
                        <field name="NUM">0</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="variables_set" id="\`\`9Ns8YsZLkiMUlVV[f?">
                    <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
                    <value name="VALUE">
                      <block type="text" id="/U]vn-l$[/eR^sx2f@H5">
                        <field name="TEXT">Mkorean SV7</field>
                      </block>
                    </value>
                    <next>
                      <block type="math_change" id="5/jGQV7l?U^^ZK#Gl~jH">
                        <field name="VAR" id="Op-Cim@t?DJN?i;G)w)C">Count Loss</field>
                        <value name="DELTA">
                          <shadow type="math_number" id="H:-3cL?I-*LgT*^_=0cF">
                            <field name="NUM">1</field>
                          </shadow>
                        </value>
                        <next>
                          <block type="controls_if" id="poO+9^__{8%X[FxTy[Q)">
                            <value name="IF0">
                              <block type="logic_compare" id="yx3cUC728v|o(o*8tiM*">
                                <field name="OP">EQ</field>
                                <value name="A">
                                  <block type="variables_get" id="U;a?%DCjzJNaT!W%_k;p">
                                    <field name="VAR" id="Op-Cim@t?DJN?i;G)w)C">Count Loss</field>
                                  </block>
                                </value>
                                <value name="B">
                                  <block type="math_number" id="F!|~%qyh$eUvJ~Ck8DN7">
                                    <field name="NUM">1</field>
                                  </block>
                                </value>
                              </block>
                            </value>
                            <statement name="DO0">
                              <block type="variables_set" id="sJn7HO6,bB6MF!/^y8~[">
                                <field name="VAR" id="$+Q3~hzlFiI[$SMrBNB?">Prediction</field>
                                <value name="VALUE">
                                  <block type="variables_get" id="GC@fih|#VBqf!uGNE%$m">
                                    <field name="VAR" id="OPb$Wwph1|)^r0#|^^y}">Prediction after loss</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id="I2/{Y9F%^SE^zVF)-jL\`">
                                    <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                                    <value name="VALUE">
                                      <block type="math_arithmetic" id="vmwp:KfA,IW}yAO3,.F~">
                                        <field name="OP">DIVIDE</field>
                                        <value name="A">
                                          <shadow type="math_number" id="K/FHvn1QO4e4z4v:OzHy">
                                            <field name="NUM">1</field>
                                          </shadow>
                                          <block type="math_arithmetic" id="C2ia/?FqFCO|r@9|cl,;">
                                            <field name="OP">MULTIPLY</field>
                                            <value name="A">
                                              <shadow type="math_number" id="(_{7M\`XGN8N[M_7O!N,">
                                                <field name="NUM">1</field>
                                              </shadow>
                                              <block type="variables_get" id="?VzvCm3c1bSI8%=cEw|u">
                                                <field name="VAR" id="S10~wx4EJ/w3gZZ;v77Y">Total Lost</field>
                                              </block>
                                            </value>
                                            <value name="B">
                                              <shadow type="math_number" id="%^OafCLE@JX!L;@i/#n,">
                                                <field name="NUM">1</field>
                                              </shadow>
                                              <block type="math_arithmetic" id="R6m56UI(u~~z]dH/:CG\`">
                                                <field name="OP">DIVIDE</field>
                                                <value name="A">
                                                  <shadow type="math_number" id="a2wvoTV=+sFF]BZ0cL?,">
                                                    <field name="NUM">100</field>
                                                  </shadow>
                                                </value>
                                                <value name="B">
                                                  <shadow type="math_number" id="^?b7^);In|\`Ec::.uyh5">
                                                    <field name="NUM">24</field>
                                                  </shadow>
                                                  <block type="variables_get" id="]2D;spPi[pG/x~r_{wpU">
                                                    <field name="VAR" id="VK7:nSRSXJ=|#p(oAU9v">Payout %</field>
                                                  </block>
                                                </value>
                                              </block>
                                            </value>
                                          </block>
                                        </value>
                                        <value name="B">
                                          <shadow type="math_number" id="cFb#@DcZ:{~P+Fp#{adm">
                                            <field name="NUM">1</field>
                                          </shadow>
                                          <block type="variables_get" id="l3s.,44;O?Y?6Y9Wn.J[">
                                            <field name="VAR" id="!mQjsA[]viO$7Gu~UzUn">Martingale Split</field>
                                          </block>
                                        </value>
                                      </block>
                                    </value>
                                  </block>
                                </next>
                              </block>
                            </statement>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="variables_set" id=":GL+TqjAhT}R9\`R7a)r-">
                    <field name="VAR" id="Op-Cim@t?DJN?i;G)w)C">Count Loss</field>
                    <value name="VALUE">
                      <block type="math_number" id="?F8*!~Iw*,Cl2E%-xZ?f">
                        <field name="NUM">0</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="d\`pWAxZ)-H\`DyzU@)We:">
                        <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
                        <value name="VALUE">
                          <block type="text" id=",VaK^!c3pIK\`a3k:8*UG">
                            <field name="TEXT">gk</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="lZN2-r.!$w$!$0jIytwR">
                            <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                            <value name="VALUE">
                              <block type="variables_get" id="oPs59-gAp.s,G2l8JwZF">
                                <field name="VAR" id="~ZEk9Zr7t[g;-\\\`afIGOO">Initial Stake</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="tmEYS!$HHZK\`jx;}?@@$">
                                <field name="VAR" id="$+Q3~hzlFiI[$SMrBNB?">Prediction</field>
                                <value name="VALUE">
                                  <block type="variables_get" id="HmhEF.Mk,SNCZfE_et#K">
                                    <field name="VAR" id="sF6($OTq!BVWswgj}4|S">Prediction before loss</field>
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
                <next>
                  <block type="controls_if" id="J+v4dmlVZEBry+%nA/?@">
                    <value name="IF0">
                      <block type="logic_compare" id="Q$x}DoiS]BBd,.}1#?D{">
                        <field name="OP">LT</field>
                        <value name="A">
                          <block type="variables_get" id="jyfJ,z=)uq(o$?aOvJy/">
                            <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                          </block>
                        </value>
                        <value name="B">
                          <block type="math_number" id="Akj}7JIvuT)!kwrNj-JD">
                            <field name="NUM">0.35</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="|dkn|CT8tQLSHu4NmLyy">
                        <field name="VAR" id="7Q4y$nr_sr!x2NkOu%)2">Stake</field>
                        <value name="VALUE">
                          <block type="math_number" id="s(vOxwBuk{KQ7Pqc_Z3)">
                            <field name="NUM">0.35</field>
                          </block>
                        </value>
                      </block>
                    </statement>
                    <next>
                      <block type="trade_again" id="C+Xpw8f|N)y\`_}N2BA6p"></block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id=":Nx^]Pu__xj[_w$h8*VZ" x="352" y="1062">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="aZ/eJwRn+2B?g?#!Rb%#">
        <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="=CPoUAxWy4D?!*TdX_:Q">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="variables_get" id="H7PW59RD?,Kp?xpJN!c.">
                <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
              </block>
            </value>
            <value name="B">
              <block type="text" id="bl*30(v6\`wbHz=v;rA!n">
                <field name="TEXT">analysis</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="controls_if" id=")l1fu6j4Picu4#dk\`oYK">
            <value name="IF0">
              <block type="logic_compare" id="YDm+8EqUYBhaq.NKEp(~">
                <field name="OP">EQ</field>
                <value name="A">
                  <block type="variables_get" id="h+w4=F)E*A#TqpF:{tjr">
                    <field name="VAR" id="o!-=j_eJZCfW(+iV7;MS">Tick 1</field>
                  </block>
                </value>
                <value name="B">
                  <block type="variables_get" id=".b/[NSo_Mz(b6aE81#V)">
                    <field name="VAR" id="x\\\`Ia+qCu@StiaJI^X([4">Entrypoint-Digit</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="purchase" id=":Nx^]Pu__xj[_w$h8*VZ">
                <field name="PURCHASE_LIST">DIGITUNDER</field>
              </block>
            </statement>
          </block>
        </statement>
        <value name="IF1">
          <block type="logic_compare" id="xXd9JKFx4pk]?ruXi_)Q">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="variables_get" id="?W~D%e;EO6*1n?vUBo[K">
                <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
              </block>
            </value>
            <value name="B">
              <block type="text" id="S+;:1.@y=QJ|.W}#68lZ">
                <field name="TEXT">gk</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO1">
          <block type="purchase" id="zOCam5W}Z-j~)}t9XOPF">
            <field name="PURCHASE_LIST">DIGITUNDER</field>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="=#FQ-DvRG:x+k:/=:zpM">
            <value name="IF0">
              <block type="logic_compare" id=",I!4r$s27MG}~,]ac,}h">
                <field name="OP">EQ</field>
                <value name="A">
                  <block type="variables_get" id="_P#Y0$pohq8}Ts^*+c:p">
                    <field name="VAR" id="+L:nET.PS2OXV5VNGInM">Analysis</field>
                  </block>
                </value>
                <value name="B">
                  <block type="text" id="p,(0|5+OX\`Wl^!aVU)\`-">
                    <field name="TEXT">Mkorean SV7</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="timeout" id="6;XYzu@SIXmr7.^#Y)xR">
                <statement name="TIMEOUTSTACK">
                  <block type="purchase" id="BvzdHe]!O+GD=E;c7NS6">
                    <field name="PURCHASE_LIST">DIGITUNDER</field>
                  </block>
                </statement>
                <value name="SECONDS">
                  <block type="math_number" id="D\`@0lu|rfT;R}~mS;Y=0">
                    <field name="NUM">0</field>
                  </block>
                </value>
              </block>
            </statement>
          </block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="tick_analysis" id="@BqMT#eB?~r!*!lw$Cte" x="0" y="2132">
    <statement name="TICKANALYSIS_STACK">
      <block type="variables_set" id="@%.cH#mIqC)Wl4$9ol(m">
        <field name="VAR" id="o!-=j_eJZCfW(+iV7;MS">Tick 1</field>
        <value name="VALUE">
          <block type="lists_getIndex" id="HA?F321LSW(X6htiNCx{">
            <mutation xmlns="http://www.w3.org/1999/xhtml" statement="false" at="true"></mutation>
            <field name="MODE">GET</field>
            <field name="WHERE">FROM_END</field>
            <value name="VALUE">
              <block type="lastDigitList" id="gX804KiYdl6~UquqaPP)"></block>
            </value>
            <value name="AT">
              <block type="math_number" id="=edszCSX?p\`sSO0OlO0(">
                <field name="NUM">1</field>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="text_join" id="^Dv$/2iLZKC-*:6HiUe4">
            <field name="VARIABLE" id="icmJXVK=|*WSXkYEU*E;">text</field>
            <statement name="STACK">
              <block type="text_statement" id="qf8!h_@O%DMKb}A(-@cS">
                <value name="TEXT">
                  <shadow type="text" id="JXbo}srO/#6=a:~=562H">
                    <field name="TEXT"></field>
                  </shadow>
                  <block type="text" id="09l.;el1t%J@/b0N$pe5">
                    <field name="TEXT"> Last Appearing Digit&gt;  | </field>
                  </block>
                </value>
                <next>
                  <block type="text_statement" id="Id5enOrAiqU__!JA%6iF">
                    <value name="TEXT">
                      <shadow type="text" id="q/GQjv(vG!#x!_~Bcjx%">
                        <field name="TEXT"></field>
                      </shadow>
                      <block type="variables_get" id="+ww=_m@\`3vY^xU1lioSe">
                        <field name="VAR" id="o!-=j_eJZCfW(+iV7;MS">Tick 1</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`,
                    description: 'Advanced Under prediction bot with entry point analysis and martingale strategy',
                    isPlaceholder: false
                },
                {
                    title: 'Upgraded CandleMine',
                    filePath: 'Upgraded CandleMine.xml',
                    xmlContent: `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="|SPx|9Jtl7i/N2)ciVd-">Stake</variable>
    <variable id="+u-u)z[IFx8X|o3x0,-l">Martingale stake</variable>
    <variable id="3h10%8w[DY\`nltID+}ZZ">Martingale size</variable>
    <variable id="+9x$PYUowRX%@x^)Fbu)">Odd Count</variable>
    <variable id="3l2;8_qp2J#kc})!ERqK">Trade Type</variable>
    <variable id="y2g6EF=EdB(Qr1kN5fjw">Target Profit</variable>
    <variable id="3iZTdl$_k8,?$go(8cbZ">Even Count</variable>
    <variable id="5+OW~93s?I*]o.(.B\`Cx">Stop Loss</variable>
    <variable id="\`WK9u[h;rgZ{or\`uJY?$">Digit List</variable>
    <variable id="QC9nC81d79/$r4|2Cvav">text</variable>
    <variable id="%*SCxg4]28ZV!jFMop_J">i</variable>
  </variables>
  <block type="trade_definition" id="PfS{7X=LEWSRCKMw?u*U" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="3xOQ2%lpbOIK#kk2h1n7" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">1HZ10V</field>
        <next>
          <block type="trade_definition_tradetype" id="qUSe]K2o9Ri+{M)-K[9a" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">evenodd</field>
            <next>
              <block type="trade_definition_contracttype" id="!^5SYPVTTUUWFqB.#0EU" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="jP?9FF2c+3v*Vl/.7QST" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="!C$$t_f;aT([pQR4J\`)U" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id=".bQLP9AhKNiRxz|z\`(cr" deletable="false" movable="false">
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
    <statement name="INITIALIZATION">
      <block type="variables_set" id="T({5?]L$nizf_l~+u(bE">
        <field name="VAR" id="|SPx|9Jtl7i/N2)ciVd-">Ufo stake</field>
        <value name="VALUE">
          <block type="math_number" id="T{ICZN/4cZJv@C]q(\`-D">
            <field name="NUM">20</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="A)\`=b(oEYdy9*)!.zJ+R">
            <field name="VAR" id="+u-u)z[IFx8X|o3x0,-l">Ufo martingale stake</field>
            <value name="VALUE">
              <block type="variables_get" id="^mUnf,%P|mhs.3qkwfi]">
                <field name="VAR" id="|SPx|9Jtl7i/N2)ciVd-">Ufo stake</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="e4+/oS$k=B$b/i|oZR0i">
                <field name="VAR" id="3h10%8w[DY\`nltID+}ZZ">Ufo martingale size</field>
                <value name="VALUE">
                  <block type="math_number" id="ma@J58.W/J%P+l,:BUN;">
                    <field name="NUM">2</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="^58ok@\`4y-oc~N3^s(gB">
                    <field name="VAR" id="y2g6EF=EdB(Qr1kN5fjw">Ufo target profit</field>
                    <value name="VALUE">
                      <block type="math_number" id="ZQy?#~n7g2Vv)b8C/eoB">
                        <field name="NUM">100</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="@5[%GFsEkHQq\`kgy7;-Y">
                        <field name="VAR" id="5+OW~93s?I*]o.(.B\`Cx">Ufo stop loss</field>
                        <value name="VALUE">
                          <block type="math_number" id="Xk:U1wGllaK==ucc7cxB">
                            <field name="NUM">100</field>
                          </block>
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
    </statement>
    <statement name="SUBMARKET">
      <block type="controls_repeat_ext" id="?iW,=+wEGZulYHo{SJW*" collapsed="true">
        <value name="TIMES">
          <block type="math_constant" id="A7F}f[2r^=XMYReMU/Gg">
            <field name="CONSTANT">INFINITY</field>
          </block>
        </value>
        <statement name="DO">
          <block type="tick_delay" id=",M~QKq.nkux^~Z7odkr*">
            <statement name="TICKDELAYSTACK">
              <block type="variables_set" id="@tyZp_76w].C!j0.Z|zE">
                <field name="VAR" id="+9x$PYUowRX%@x^)Fbu)">Ufo odd count</field>
                <value name="VALUE">
                  <block type="math_number" id="X~rrg%ihdgi0BRd+w#YD">
                    <field name="NUM">0</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="racDt::]/CS@ti^ku1BU">
                    <field name="VAR" id="3iZTdl$_k8,?$go(8cbZ">Ufo even count</field>
                    <value name="VALUE">
                      <block type="math_number" id="EghQ-dj%vo;-wEawKk7x">
                        <field name="NUM">0</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="IYCYKkwD6XRalb5(c=2X">
                        <field name="VAR" id="\`WK9u[h;rgZ{or\`uJY?$">Ufo digit list</field>
                        <value name="VALUE">
                          <block type="lists_getSublist" id="^bqt9=UiWYZV3M,d!SbQ">
                            <mutation xmlns="http://www.w3.org/1999/xhtml" at1="true" at2="false"></mutation>
                            <field name="WHERE1">FROM_END</field>
                            <field name="WHERE2">LAST</field>
                            <value name="LIST">
                              <block type="lastDigitList" id=",Fo6p5j?.Gf;{%tUk9VK"></block>
                            </value>
                            <value name="AT1">
                              <block type="math_number" id="tT4iLZO=y(,~2?QtF:A9">
                                <field name="NUM">3</field>
                              </block>
                            </value>
                          </block>
                        </value>
                        <next>
                          <block type="text_join" id="0h]vK[FJ?q*buX$t-ys_">
                            <field name="VARIABLE" id="QC9nC81d79/$r4|2Cvav">text</field>
                            <statement name="STACK">
                              <block type="text_statement" id="UDQ](x+0br3VxL=aUAZZ">
                                <value name="TEXT">
                                  <shadow type="text" id="F%n-D3vqvKu)ce+q)Ixr">
                                    <field name="TEXT">Ufo last 3 digit scan ;</field>
                                  </shadow>
                                </value>
                                <next>
                                  <block type="text_statement" id="L,z!WV|TL.]+LtT3ukc!">
                                    <value name="TEXT">
                                      <shadow type="text" id="VKUn.F+N6dyqY~$cu?@2">
                                        <field name="TEXT"></field>
                                      </shadow>
                                      <block type="variables_get" id="nLlbC]qBgX*Fj?qEp041">
                                        <field name="VAR" id="\`WK9u[h;rgZ{or\`uJY?$">Ufo digit list</field>
                                      </block>
                                    </value>
                                  </block>
                                </next>
                              </block>
                            </statement>
                            <next>
                              <block type="notify" id="TZJ*jx68|WpZe~;K-8V;">
                                <field name="NOTIFICATION_TYPE">success</field>
                                <field name="NOTIFICATION_SOUND">silent</field>
                                <value name="MESSAGE">
                                  <shadow type="text" id="!Uaj^:/jOnboRKsxx979">
                                    <field name="TEXT">abc</field>
                                  </shadow>
                                  <block type="variables_get" id="PX;P-6#Y!3cHFU?8twn@">
                                    <field name="VAR" id="QC9nC81d79/$r4|2Cvav">text</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="controls_forEach" id="Kjb3(*fe%wE?^n-5GU{A">
                                    <field name="VAR" id="%*SCxg4]28ZV!jFMop_J">i</field>
                                    <value name="LIST">
                                      <block type="variables_get" id="fKlUmUO[%qmw,@Nx1;8=">
                                        <field name="VAR" id="\`WK9u[h;rgZ{or\`uJY?$">Ufo digit list</field>
                                      </block>
                                    </value>
                                    <statement name="DO">
                                      <block type="controls_if" id="qF]D@@F1@;#naFKygR9e">
                                        <value name="IF0">
                                          <block type="math_number_property" id="1PN;{VHI/YrMY.:WtBHn">
                                            <mutation xmlns="http://www.w3.org/1999/xhtml" divisor_input="false"></mutation>
                                            <field name="PROPERTY">EVEN</field>
                                            <value name="NUMBER_TO_CHECK">
                                              <shadow type="math_number" id="7j_Q62]1c/]G0h0{$xQV">
                                                <field name="NUM">0</field>
                                              </shadow>
                                              <block type="variables_get" id=":\`p?$T@bZQM|mxZRzp89">
                                                <field name="VAR" id="%*SCxg4]28ZV!jFMop_J">i</field>
                                              </block>
                                            </value>
                                          </block>
                                        </value>
                                        <statement name="DO0">
                                          <block type="math_change" id="Kc.1kAs:ucLP[kd6C[/?">
                                            <field name="VAR" id="3iZTdl$_k8,?$go(8cbZ">Ufo even count</field>
                                            <value name="DELTA">
                                              <shadow type="math_number" id="N7TPWO+!iYX=3)?z#?8O">
                                                <field name="NUM">1</field>
                                              </shadow>
                                            </value>
                                          </block>
                                        </statement>
                                        <next>
                                          <block type="controls_if" id="~yiY.,w[%s1nTxb:OID%">
                                            <value name="IF0">
                                              <block type="math_number_property" id=";@%Y=V3iqb{Xmp_M=\`VN">
                                                <mutation xmlns="http://www.w3.org/1999/xhtml" divisor_input="false"></mutation>
                                                <field name="PROPERTY">ODD</field>
                                                <value name="NUMBER_TO_CHECK">
                                                  <shadow type="math_number" id="7j_Q62]1c/]G0h0{$xQV">
                                                    <field name="NUM">0</field>
                                                  </shadow>
                                                  <block type="variables_get" id="EIKQq98azpR6PV5Fp#/v">
                                                    <field name="VAR" id="%*SCxg4]28ZV!jFMop_J">i</field>
                                                  </block>
                                                </value>
                                              </block>
                                            </value>
                                            <statement name="DO0">
                                              <block type="math_change" id="-QtcA_5cwlH*V_]{{m@Q">
                                                <field name="VAR" id="+9x$PYUowRX%@x^)Fbu)">Ufo odd count</field>
                                                <value name="DELTA">
                                                  <shadow type="math_number" id=",*2LW::Q6g4S0Aihi+x,">
                                                    <field name="NUM">1</field>
                                                  </shadow>
                                                </value>
                                              </block>
                                            </statement>
                                          </block>
                                        </next>
                                      </block>
                                    </statement>
                                    <next>
                                      <block type="controls_if" id="/XQj]A9sUAvhoh\`q;J86">
                                        <value name="IF0">
                                          <block type="logic_compare" id="34DL#hYy,4B$ZtZikJ4{">
                                            <field name="OP">EQ</field>
                                            <value name="A">
                                              <block type="variables_get" id="_st^N|7IZF9*T7yvR+[%">
                                                <field name="VAR" id="3iZTdl$_k8,?$go(8cbZ">Ufo even count</field>
                                              </block>
                                            </value>
                                            <value name="B">
                                              <block type="math_number" id="Jy[O*;A,2)RXj.Pi.;dR">
                                                <field name="NUM">3</field>
                                              </block>
                                            </value>
                                          </block>
                                        </value>
                                        <statement name="DO0">
                                          <block type="variables_set" id="T1N8a}/3|??AP?n5wCfS">
                                            <field name="VAR" id="3l2;8_qp2J#kc})!ERqK">Ufo trade type</field>
                                            <value name="VALUE">
                                              <block type="math_number" id="HWq2p#Dyl!5QmD|f!S@0">
                                                <field name="NUM">1</field>
                                              </block>
                                            </value>
                                            <next>
                                              <block type="controls_flow_statements" id="Hbx_OUV,*gwHz7LiYi0E">
                                                <field name="FLOW">BREAK</field>
                                              </block>
                                            </next>
                                          </block>
                                        </statement>
                                        <next>
                                          <block type="controls_if" id="XmX+58afaGQ)#ooPDfjX">
                                            <value name="IF0">
                                              <block type="logic_compare" id="sFjLnCX6ms3#s(H*Mwo1">
                                                <field name="OP">EQ</field>
                                                <value name="A">
                                                  <block type="variables_get" id="%F[?}F4Rw].Db)M{6=^I">
                                                    <field name="VAR" id="+9x$PYUowRX%@x^)Fbu)">Ufo odd count</field>
                                                  </block>
                                                </value>
                                                <value name="B">
                                                  <block type="math_number" id="+fwTv,IA=;Rl9RZ3Obi/">
                                                    <field name="NUM">3</field>
                                                  </block>
                                                </value>
                                              </block>
                                            </value>
                                            <statement name="DO0">
                                              <block type="variables_set" id="u(.udpQ(/wwf%dqdYD0;">
                                                <field name="VAR" id="3l2;8_qp2J#kc})!ERqK">Ufo trade type</field>
                                                <value name="VALUE">
                                                  <block type="math_number" id="J_XrQvoEiNE^Br+zV?~J">
                                                    <field name="NUM">2</field>
                                                  </block>
                                                </value>
                                                <next>
                                                  <block type="controls_flow_statements" id="hJEy~E3}2C:U.:)7Bqu3">
                                                    <field name="FLOW">BREAK</field>
                                                  </block>
                                                </next>
                                              </block>
                                            </statement>
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
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <value name="TICKDELAYVALUE">
              <block type="math_number" id="|?J]3^(Tu^mqw0VyLO*S">
                <field name="NUM">1</field>
              </block>
            </value>
          </block>
        </statement>
        <next>
          <block type="trade_definition_tradeoptions" id="DJD]ruf,lVvU{35I[%g2">
            <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation>
            <field name="DURATIONTYPE_LIST">t</field>
            <value name="DURATION">
              <shadow type="math_number_positive" id="Ci2?IWJ2.1)dQM~/RtkA">
                <field name="NUM">1</field>
              </shadow>
            </value>
            <value name="AMOUNT">
              <shadow type="math_number_positive" id="-bqGWk[.yLrj31cU~i)c">
                <field name="NUM">0.35</field>
              </shadow>
              <block type="variables_get" id="6[2-)-zAHmfB0EzOa;ly">
                <field name="VAR" id="+u-u)z[IFx8X|o3x0,-l">Ufo martingale stake</field>
              </block>
            </value>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="!;pFcL57s]w}830Ow($]" x="789" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="6AlrL[CW}+d@z4C1dC2N">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="-3Jn|VOB}AK%|T9X8.B+">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="VXoH+GEz2DTZu})cvL_Y">
            <field name="VAR" id="+u-u)z[IFx8X|o3x0,-l">Ufo martingale stake</field>
            <value name="VALUE">
              <block type="variables_get" id="iy84)o4]R6E~W*.#aqtQ">
                <field name="VAR" id="|SPx|9Jtl7i/N2)ciVd-">Ufo stake</field>
              </block>
            </value>
            <next>
              <block type="controls_if" id="Y?6Ra|#=05T2P;2|gQ5;">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="jQh6fONdWv?[|[v$DY]L">
                    <field name="OP">GTE</field>
                    <value name="A">
                      <block type="total_profit" id="Vn7Orbapf/*C7BF;?Vw("></block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="TRvmxknGMJN_U%#9=Lwu">
                        <field name="VAR" id="y2g6EF=EdB(Qr1kN5fjw">Ufo target profit</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="text_print" id="dD,T(RU2OoC/T=Yn%}|1">
                    <value name="TEXT">
                      <shadow type="text" id="pp4cNf0ZyUvbQ@sT0\`@p">
                        <field name="TEXT">The UFO hits target profit.</field>
                      </shadow>
                    </value>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="trade_again" id="bBO@m!D(Vy4^WL2j$f@]"></block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="variables_set" id="cQs[?Z8Z~V9%La)bB[-E">
            <field name="VAR" id="+u-u)z[IFx8X|o3x0,-l">Ufo martingale stake</field>
            <value name="VALUE">
              <block type="math_arithmetic" id="ruN3%wlOhP.=PuPIDkq9">
                <field name="OP">MULTIPLY</field>
                <value name="A">
                  <shadow type="math_number" id="We:Gw_Ox]UPaCTB=LHTN">
                    <field name="NUM">1</field>
                  </shadow>
                  <block type="variables_get" id="-DdiSNC~v4sh:{fVnZ*h">
                    <field name="VAR" id="+u-u)z[IFx8X|o3x0,-l">Ufo martingale stake</field>
                  </block>
                </value>
                <value name="B">
                  <shadow type="math_number" id="kOo5+J(z/P5IqS49;Q\`O">
                    <field name="NUM">1</field>
                  </shadow>
                  <block type="variables_get" id=")e^7V|OV]GOh)9p+Ph+$">
                    <field name="VAR" id="3h10%8w[DY\`nltID+}ZZ">Ufo martingale size</field>
                  </block>
                </value>
              </block>
            </value>
            <next>
              <block type="controls_if" id="5%Pf^Cid|2^YglkWQtYS">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="bJw!m-9],}LUV7c3@]1p">
                    <field name="OP">GTE</field>
                    <value name="A">
                      <block type="math_arithmetic" id="DxuUlOj8xuKFX/59zR9T">
                        <field name="OP">MULTIPLY</field>
                        <value name="A">
                          <shadow type="math_number" id="{l:XXKUF6qZ)WX[pq+\`q">
                            <field name="NUM">1</field>
                          </shadow>
                          <block type="total_profit" id="cp_,]Wf-,u_:I)5#pW#."/>
                        </value>
                        <value name="B">
                          <shadow type="math_number" id="X{:c|#G\`h382I5tg;u#h">
                            <field name="NUM">-1</field>
                          </shadow>
                        </value>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="oIxIz2Gaej[J7-=Tiv[|">
                        <field name="VAR" id="5+OW~93s?I*]o.(.B\`Cx">Ufo stop loss</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="text_print" id="_oT)1@rl:Ry|NQn88-ik">
                    <value name="TEXT">
                      <shadow type="text" id="$_V1z02z}yei:)H;du(!">
                        <field name="TEXT">Stop loss hit.</field>
                      </shadow>
                    </value>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="trade_again" id="NcCm[5^wae3G}7ZJrT0:"></block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="qLBMt/VnTfMu*^Y(|OWl" x="352" y="1162">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="F7RrU0xU@vkc^^IgCTxp">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="Lr2.vux1[)1[jnM/A6DN">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="variables_get" id="xX2xwTg6rAWL8{yw*uH">
                <field name="VAR" id="3l2;8_qp2J#kc})!ERqK">Ufo trade type</field>
              </block>
            </value>
            <value name="B">
              <block type="math_number" id="}QyGgnv3?G2w8xQI;OpA">
                <field name="NUM">1</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="qLBMt/VnTfMu*^Y(|OWl">
            <field name="PURCHASE_LIST">DIGITODD</field>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="purchase" id="U:F.)w|u{oPi5[K:}{j4">
            <field name="PURCHASE_LIST">DIGITEVEN</field>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>`,
                    description: 'Enhanced digit pattern analysis bot with even/odd detection and martingale system',
                    isPlaceholder: false
                }
            ];

            const botFiles = [
                'Upgraded Candlemine.xml',
                'Super Elite.xml', // Smart trading as second sub-tab
                'Super Speed Bot.xml', // Speed bot as third sub-tab
                'Envy-differ.xml',
                'H_L auto vault.xml',
                'Top-notch 2.xml',
            ];

            const loadedBots = [...priorityBots]; // Add priority bots first

            for (const file of botFiles) {
                try {
                    // Try multiple fetch approaches for better compatibility
                    let response;
                    let text = null;

                    // Try public directory with encoded URI
                    try {
                        const encodedFile = encodeURIComponent(file);
                        response = await fetch(`/${encodedFile}`);
                        if (response.ok) {
                            text = await response.text();
                        }
                    } catch (e) {
                        console.log(`Failed to fetch encoded: ${file}`);
                    }

                    // Try normal fetch if encoded didn't work
                    if (!text) {
                        try {
                            response = await fetch(`/${file}`);
                            if (response.ok) {
                                text = await response.text();
                            }
                        } catch (e) {
                            console.log(`Failed to fetch normal: ${file}`);
                        }
                    }

                    // Try without leading slash
                    if (!text) {
                        try {
                            response = await fetch(file);
                            if (response.ok) {
                                text = await response.text();
                            }
                        } catch (e) {
                            console.log(`Failed to fetch without slash: ${file}`);
                        }
                    }

                    if (!text) {
                        console.warn(`Could not load bot file: ${file}`);
                        loadedBots.push({
                            title: file.replace('.xml', ''),
                            image: 'default_image_path',
                            filePath: file,
                            xmlContent: null,
                            isPlaceholder: true
                        });
                        continue;
                    }

                    // Validate XML content
                    if (!text.trim().startsWith('<xml') && !text.trim().startsWith('<?xml')) {
                        console.warn(`Invalid XML content for ${file}`);
                        loadedBots.push({
                            title: file.replace('.xml', ''),
                            image: 'default_image_path',
                            filePath: file,
                            xmlContent: null,
                            isPlaceholder: true
                        });
                        continue;
                    }

                    const parser = new DOMParser();
                    const xml = parser.parseFromString(text, 'application/xml');

                    // Check if XML parsing was successful
                    const parseError = xml.getElementsByTagName('parsererror')[0];
                    if (parseError) {
                        console.warn(`XML parsing error for ${file}:`, parseError.textContent);
                        loadedBots.push({
                            title: file.replace('.xml', ''),
                            image: 'default_image_path',
                            filePath: file,
                            xmlContent: text, // Still include the content even if parsing failed
                            isPlaceholder: false
                        });
                        continue;
                    }

                    loadedBots.push({
                        title: file.replace('.xml', ''),
                        image: xml.getElementsByTagName('image')[0]?.textContent || 'default_image_path',
                        filePath: file,
                        xmlContent: text,
                        isPlaceholder: false
                    });

                    console.log(`Successfully loaded: ${file}`);

                } catch (error) {
                    console.error(`Error loading bot ${file}:`, error);
                    loadedBots.push({
                        title: file.replace('.xml', ''),
                        image: 'default_image_path',
                        filePath: file,
                        xmlContent: null,
                        isPlaceholder: true
                    });
                }
            }

            setBots(loadedBots);
            console.log(`Loaded ${loadedBots.length} bots total`);
            console.log(`Successful: ${loadedBots.filter(b => !b.isPlaceholder).length}`);
            console.log(`Placeholders: ${loadedBots.filter(b => b.isPlaceholder).length}`);
        };

        fetchBots();
    }, []);

    const runBot = (xmlContent: string) => {
        // Load the strategy into the bot builder
        updateWorkspaceName(xmlContent);
        console.log('Running bot with content:', xmlContent);
    };

    const handleTabChange = React.useCallback(
        (tab_index: number) => {
            setActiveTab(tab_index);
        },
        [setActiveTab]
    );

    const handleBotClick = useCallback(async (bot: { filePath: string; xmlContent: string | null; title?: string; isPlaceholder?: boolean }) => {
        try {
            console.log("=== LOADING SPECIFIC BOT ===");
            console.log("Bot Title:", bot.title);
            console.log("File Path:", bot.filePath);
            console.log("Has XML Content:", !!bot.xmlContent);
            console.log("Is Placeholder:", bot.isPlaceholder);

            let xmlContent = bot.xmlContent;

            // If it's a placeholder bot or no content, try to load the content now
            if (bot.isPlaceholder || !xmlContent) {
                console.log("Attempting to load XML content for bot...");
                try {
                    let response;
                    let success = false;

                    // Try multiple approaches with the exact file path
                    const attempts = [
                        `/${encodeURIComponent(bot.filePath)}`,
                        `/${bot.filePath}`,
                        bot.filePath,
                        `/public/${bot.filePath}`,
                        `./public/${bot.filePath}`
                    ];

                    for (const url of attempts) {
                        try {
                            console.log(`Trying to fetch: ${url}`);
                            response = await fetch(url);
                            if (response.ok) {
                                xmlContent = await response.text();
                                console.log(`Successfully loaded XML from: ${url}`);
                                console.log("Loaded content length:", xmlContent.length);
                                console.log("Content preview:", xmlContent.substring(0, 200));
                                success = true;
                                break;
                            } else {
                                console.log(`Failed with status: ${response.status} for ${url}`);
                            }
                        } catch (e) {
                            console.log(`Failed attempt with URL: ${url}`, e.message);
                        }
                    }

                    if (!success) {
                        console.warn(`Could not fetch ${bot.filePath} from any URL - bot may not exist`);
                        alert(`Could not load ${bot.title}. The bot file "${bot.filePath}" was not found.`);
                        return;
                    }
                } catch (fetchError) {
                    console.error("Failed to load bot content:", fetchError);
                    alert(`Failed to load ${bot.title}: ${fetchError.message}`);
                    return;
                }
            }

            // Validate that we have XML content
            if (!xmlContent || xmlContent.trim().length === 0) {
                console.error("No XML content available for bot:", bot.title);
                alert(`No content available for ${bot.title}. Please check if the bot file exists.`);
                return;
            }

            // Validate XML content format
            const trimmedContent = xmlContent.trim();
            if (!trimmedContent.startsWith('<xml') && !trimmedContent.startsWith('<?xml')) {
                console.error("Invalid XML format for bot:", bot.title);
                console.log("Content starts with:", trimmedContent.substring(0, 50));
                alert(`Invalid XML format for ${bot.title}`);
                return;
            }

            // Create a unique content signature for this specific bot
            const contentSignature = `${bot.title}_${bot.filePath}_${xmlContent.length}_${Date.now()}`;
            console.log(`=== LOADING ${bot.title.toUpperCase()} WITH UNIQUE SIGNATURE: ${contentSignature} ===`);

            // First switch to Bot Builder tab
            console.log("Switching to Bot Builder tab...");
            setActiveTab(DBOT_TABS.BOT_BUILDER);

            // Wait for the tab to render and workspace to be ready
            setTimeout(async () => {
                try {
                    console.log(`Attempting to load ${bot.title} with signature ${contentSignature}...`);

                    // Try multiple ways to get the workspace
                    let workspace = null;

                    // Method 1: Try derivWorkspace
                    if (window.Blockly?.derivWorkspace) {
                        workspace = window.Blockly.derivWorkspace;
                        console.log("Found derivWorkspace");
                    }

                    // Method 2: Try getMainWorkspace
                    if (!workspace && window.Blockly?.getMainWorkspace) {
                        workspace = window.Blockly.getMainWorkspace();
                        console.log("Found workspace via getMainWorkspace");
                    }

                    // Method 3: Try accessing workspace from global
                    if (!workspace && window.Blockly?.Workspace) {
                        workspace = window.Blockly.Workspace.getAll()?.[0];
                        console.log("Found workspace via getAll");
                    }

                    if (workspace && xmlContent) {
                        console.log(`=== FORCE CLEARING WORKSPACE FOR ${bot.title} ===`);

                        // Store current state to verify changes
                        const beforeClearBlocks = workspace.getAllBlocks?.(false) || [];
                        console.log(`Before clear: ${beforeClearBlocks.length} blocks`);

                        // Disable events during clearing to prevent issues
                        const eventsEnabled = workspace.recordUndo;
                        workspace.recordUndo = false;

                        // Force dispose all blocks manually with detailed logging
                        beforeClearBlocks.forEach((block, index) => {
                            try {
                                if (block && block.dispose) {
                                    console.log(`Disposing block ${index + 1}/${beforeClearBlocks.length}: ${block.type}`);
                                    block.dispose(true, true); // Force dispose with heal and no events
                                }
                            } catch (e) {
                                console.warn(`Error disposing block ${index}:`, e);
                            }
                        });

                        // Multiple clearing strategies to ensure complete reset
                        if (workspace.clear && typeof workspace.clear === 'function') {
                            workspace.clear();
                            console.log('Workspace cleared using clear()');
                        }

                        // Force clear the workspace contents
                        if (workspace.getTopBlocks) {
                            const remainingBlocks = workspace.getTopBlocks(true);
                            if (remainingBlocks.length > 0) {
                                console.log(`Force clearing ${remainingBlocks.length} remaining top blocks`);
                                remainingBlocks.forEach(block => {
                                    try {
                                        block.dispose(true, true);
                                    } catch (e) {
                                        console.warn('Error disposing remaining block:', e);
                                    }
                                });
                            }
                        }

                        // Clear variables completely
                        if (workspace.getAllVariables) {
                            const variables = workspace.getAllVariables();
                            console.log(`Force clearing ${variables.length} variables`);
                            variables.forEach(variable => {
                                try {
                                    if (workspace.deleteVariableById) {
                                        workspace.deleteVariableById(variable.getId());
                                    }
                                } catch (e) {
                                    console.warn('Error clearing variable:', e);
                                }
                            });
                        }

                        // Reset workspace state completely with unique identifiers
                        workspace.current_strategy_id = null;
                        workspace.bot_metadata = null;
                        workspace.last_loaded_bot = null;
                        console.log('Reset all workspace state');

                        // Clear undo/redo history completely
                        if (workspace.clearUndo && typeof workspace.clearUndo === 'function') {
                            workspace.clearUndo();
                        }
                        if (workspace.undoStack_) {
                            workspace.undoStack_ = [];
                        }
                        if (workspace.redoStack_) {
                            workspace.redoStack_ = [];
                        }

                        // Force render and wait for stabilization
                        if (workspace.render) {
                            workspace.render();
                        }
                        workspace.recordUndo = eventsEnabled;

                        // Extra wait to ensure workspace is completely cleared
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // Verify workspace is truly empty
                        const afterClearBlocks = workspace.getAllBlocks?.(false) || [];
                        console.log(`After clear: ${afterClearBlocks.length} blocks remaining`);

                        if (afterClearBlocks.length > 0) {
                            console.warn(`Warning: ${afterClearBlocks.length} blocks still remain after clearing!`);
                            // Force remove any remaining blocks
                            afterClearBlocks.forEach((block, index) => {
                                try {
                                    console.log(`Force removing remaining block ${index}: ${block.type}`);
                                    block.dispose(true, true);
                                } catch (e) {
                                    console.warn(`Failed to remove remaining block ${index}:`, e);
                                }
                            });
                        }

                        console.log(`=== PARSING FRESH XML FOR ${bot.title} ===`);

                        // Parse XML with fresh instance to avoid caching issues
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

                        // Check for parsing errors
                        const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
                        if (parseError) {
                            console.error("XML parsing error:", parseError.textContent);
                            alert(`XML parsing failed for ${bot.title}: ${parseError.textContent}`);
                            return;
                        }

                        const xmlElement = xmlDoc.getElementsByTagName('xml')[0];
                        if (!xmlElement) {
                            console.error("No XML root element found in content for", bot.title);
                            alert(`No valid XML content found for ${bot.title}`);
                            return;
                        }

                        console.log(`=== LOADING ${bot.title} WITH FRESH XML CONTENT ===`);

                        // Extract and log bot-specific information
                        const variableElements = xmlElement.querySelectorAll('variable');
                        const blockElements = xmlElement.querySelectorAll('block');
                        console.log(`${bot.title} XML contains:`, {
                            variables: variableElements.length,
                            blocks: blockElements.length,
                            signature: contentSignature
                        });

                        // Log first few variable names to verify uniqueness
                        const varNames = Array.from(variableElements).slice(0, 5).map(v => v.textContent);
                        console.log(`${bot.title} first 5 variables:`, varNames);

                        // Load the XML using the proper loading mechanism
                        try {
                            console.log(`Loading ${bot.title} XML using proper load function...`);
                            
                            // Use the load function from bot-skeleton which properly handles XML loading
                            const { load } = await import('@/external/bot-skeleton');
                            const { save_types } = await import('@/external/bot-skeleton/constants');
                            
                            await load({
                                block_string: xmlContent,
                                file_name: bot.title,
                                workspace: workspace,
                                from: save_types.LOCAL,
                                drop_event: {},
                                strategy_id: `${bot.title}_${Date.now()}`,
                                showIncompatibleStrategyDialog: false,
                            });

                            console.log(`Successfully loaded ${bot.title} using load function`);

                            // Set completely unique strategy ID with bot signature
                            const uniqueStrategyId = `${bot.title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                            workspace.current_strategy_id = uniqueStrategyId;
                            workspace.strategy_to_load = xmlContent;
                            
                            // Store comprehensive bot metadata with signature
                            workspace.bot_metadata = {
                                title: bot.title,
                                filePath: bot.filePath,
                                loadedAt: new Date().toISOString(),
                                strategyId: uniqueStrategyId,
                                contentSignature: contentSignature,
                                xmlLength: xmlContent.length
                            };
                            workspace.last_loaded_bot = contentSignature;

                            console.log(`Set unique metadata for ${bot.title}:`, workspace.bot_metadata);

                            // Update workspace name to reflect the specific bot
                            if (typeof updateWorkspaceName === 'function') {
                                updateWorkspaceName(`${bot.title} - ${new Date().toLocaleTimeString()}`);
                                console.log("Updated workspace name for:", bot.title);
                            }

                            // Force complete render and cleanup
                            if (workspace.render) {
                                workspace.render();
                            }

                            // Clean up layout after loading
                            setTimeout(() => {
                                if (workspace.cleanUp && typeof workspace.cleanUp === 'function') {
                                    workspace.cleanUp();
                                    console.log(`Layout cleaned for ${bot.title}`);
                                }
                            }, 200);

                            // Final verification of loaded content
                            const finalBlocks = workspace.getAllBlocks?.(false) || [];
                            const finalVariables = workspace.getAllVariables?.() || [];
                            
                            console.log(`=== FINAL VERIFICATION FOR ${bot.title} ===`);
                            console.log(`Loaded blocks: ${finalBlocks.length}`);
                            console.log(`Loaded variables: ${finalVariables.length}`);
                            console.log(`Content signature: ${contentSignature}`);

                            if (finalBlocks.length > 0) {
                                const blockTypes = finalBlocks.slice(0, 3).map(b => b.type);
                                console.log(`${bot.title} block types:`, blockTypes);
                            }

                            if (finalVariables.length > 0) {
                                const varNames = finalVariables.slice(0, 3).map(v => v.name);
                                console.log(`${bot.title} variable names:`, varNames);
                            }

                            console.log(`✅ SUCCESS: "${bot.title}" loaded with signature ${contentSignature}!`);

                        } catch (loadError) {
                            console.error(`Error loading ${bot.title} XML:`, loadError);
                            alert(`Failed to load ${bot.title}: ${loadError.message}`);
                        }

                    } else {
                        console.log("Workspace not ready, trying alternative method...");

                        try {
                            // Try using the load function directly without workspace dependency
                            const { load } = await import('@/external/bot-skeleton');
                            const { save_types } = await import('@/external/bot-skeleton/constants');
                            
                            console.log(`Using direct load function for ${bot.title}`);
                            await load({
                                block_string: xmlContent,
                                file_name: bot.title || 'Imported Bot',
                                workspace: null, // Let load function handle workspace creation
                                from: save_types.LOCAL,
                                drop_event: {},
                                strategy_id: `${bot.title}_${Date.now()}`,
                                showIncompatibleStrategyDialog: false,
                            });
                            
                            console.log(`${bot.title} loaded via direct load function with signature ${contentSignature}!`);
                        } catch (directLoadError) {
                            console.error(`Direct load error for ${bot.title}:`, directLoadError);
                            
                            // Final fallback to load_modal
                            if (load_modal?.loadFileFromContent) {
                                console.log(`Using load_modal fallback for ${bot.title}`);
                                try {
                                    await load_modal.loadFileFromContent(xmlContent, bot.title || 'Imported Bot');
                                    console.log(`${bot.title} loaded via load_modal with signature ${contentSignature}!`);
                                } catch (modalError) {
                                    console.error(`Load modal error for ${bot.title}:`, modalError);
                                    alert(`Failed to load ${bot.title}: ${modalError.message}`);
                                }
                            } else {
                                console.error("No loading method available");
                                alert(`Failed to load ${bot.title} - no loading method available`);
                            }
                        }
                    }
                } catch (loadingError) {
                    console.error(`Error in bot loading process for ${bot.title}:`, loadingError);
                    alert(`Error loading ${bot.title}: ${loadingError.message}`);
                }
            }, 1000);

        } catch (error) {
            console.error(`Error in handleBotClick for ${bot.title}:`, error);
            alert(`Error loading ${bot.title}: ${error.message}`);
        }
    }, [setActiveTab, load_modal]);

    const handleOpen = useCallback(async () => {
        await load_modal.loadFileFromRecent();
        setActiveTab(DBOT_TABS.BOT_BUILDER);
        // rudderStackSendDashboardClickEvent({ dashboard_click_name: 'open', subpage_name: 'bot_builder' });
    }, [load_modal, setActiveTab]);

    // Digits Trading Bot Functions
  const connectToAPI = async () => {
    try {
      // Close existing connection if any
      if (websocket) {
        websocket.close()
        setWebsocket(null)
      }

      setCurrentPrice('Connecting...')
      setIsConnected(false)

      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=75771')

      ws.onopen = () => {
        console.log('WebSocket connected successfully')
        setIsConnected(true)
        setWebsocket(ws)
        setCurrentPrice('Connected - Waiting for ticks...')

        // First, get historical ticks for the selected volatility
        const historyRequest = {
          ticks_history: selectedIndex,
          count: 5000,
          end: 'latest',
          style: 'ticks',
          req_id: 2
        }
        console.log('Requesting historical ticks:', historyRequest)
        ws.send(JSON.stringify(historyRequest))

        // Then subscribe to real-time tick stream
        const tickRequest = {
          ticks: selectedIndex,
          subscribe: 1,
          req_id: 1
        }
        console.log('Sending tick subscription request:', tickRequest)
        ws.send(JSON.stringify(tickRequest))
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('WebSocket message received:', data)

          // Handle historical tick data
          if (data.history && data.history.prices) {
            const symbol = data.echo_req.ticks_history
            const prices = data.history.prices.map(price => parseFloat(price))
            console.log(`Received ${prices.length} historical ticks for ${symbol}`)

            // Store historical ticks for this volatility
            setTickHistory(prev => ({
              ...prev,
              [symbol]: prices
            }))

            // Set current price to latest historical tick
            if (prices.length > 0) {
              const latestPrice = prices[prices.length - 1]
              setCurrentPrice(latestPrice.toFixed(5))

              // Calculate distributions for historical data
              calculateDigitDistribution(prices)
              analyzePatterns(prices)
              makePrediction(prices)
              calculateContractProbabilities(prices)
            }
          }

          // Handle real-time tick data
          if (data.tick && (data.tick.symbol === selectedIndex || getAlternativeSymbol(data.tick.symbol) === selectedIndex)) {
            console.log('Real-time tick received for', data.tick.symbol, ':', data.tick.quote)
            const price = parseFloat(data.tick.quote)
            if (!isNaN(price)) {
              setCurrentPrice(price.toFixed(5))
              handleNewTick(price, data.tick.symbol)
            }
          }

          // Handle subscription confirmation
          if (data.msg_type === 'tick' && data.subscription) {
            console.log('Tick subscription confirmed for:', data.subscription.id)
            setCurrentPrice('Connected - Receiving ticks for ' + selectedIndex)
          }

          // Handle errors
          if (data.error) {
            console.error('WebSocket API error:', data.error)
            setCurrentPrice(`Error: ${data.error.message}`)

            // Try alternative symbol formats for common volatility indices
            if (data.error.code === 'InvalidSymbol') {
              console.log('Invalid symbol, trying alternative format...')
              const altSymbol = getAlternativeSymbol(selectedIndex)
              if (altSymbol && altSymbol !== selectedIndex) {
                console.log('Trying alternative symbol:', altSymbol)
                const altRequest = {
                  ticks_history: altSymbol,
                  count: 5000,
                  end: 'latest',
                  style: 'ticks',
                  req_id: Date.now()
                }
                ws.send(JSON.stringify(altRequest))
              }
            }
          }

          // Handle forget_all response
          if (data.msg_type === 'forget_all') {
            console.log('All subscriptions forgotten successfully')
          }
        } catch (parseError){
          console.error('Error parsing WebSocket message:', parseError)
          setCurrentPrice('Parse Error')
        }
      }

      ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason)
        setIsConnected(false)
        setWebsocket(null)
        setCurrentPrice('Disconnected')

        // Auto-reconnect after 3 seconds if not manually closed
        if (event.code !== 1000) {
          setTimeout(() => {
            console.log('Attempting to reconnect...')
            connectToAPI()
          }, 3000)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setIsConnected(false)
        setWebsocket(null)
        setCurrentPrice('Connection Error')
      }

    } catch (error) {
      console.error('Connection failed:', error)
      setIsConnected(false)
      setCurrentPrice('Failed to connect')
    }
  }

  // Helper function to get alternative symbol formats
  const getAlternativeSymbol = (symbol) => {
    const symbolMap = {
      // Forward mapping
      'R_10': '1HZ10V',
      'R_25': '1HZ25V',
      'R_50': '1HZ50V',
      'R_75': '1HZ75V',
      'R_100': '1HZ100V',
      'R_150': '1HZ150V',
      'R_200': '1HZ200V',
      'R_250': '1HZ250V',
      'R_300': '1HZ300V',
      // Reverse mapping
      '1HZ10V': 'R_10',
      '1HZ25V': 'R_25',
      '1HZ50V': 'R_50',
      '1HZ75V': 'R_75',
      '1HZ100V': 'R_100',
      '1HZ150V': 'R_150',
      '1HZ200V': 'R_200',
      '1HZ250V': 'R_250',
      '1HZ300V': 'R_300',
      // Boom/Crash indices
      'BOOM1000': 'BOOM1000',
      'CRASH1000': 'CRASH1000',
      'BOOM500': 'BOOM500',
      'CRASH500': 'CRASH500',
      'BOOM300': 'BOOM300',
      'CRASH300': 'CRASH300'
    }
    return symbolMap[symbol] || symbol
  }

  const handleNewTick = (tick: number, symbol: string) => {
    try {
      if (typeof tick !== 'number' || isNaN(tick)) {
        console.warn('Invalid tick received:', tick)
        return
      }

      console.log('Processing tick:', tick, 'for symbol:', symbol)

      // Update current tick and price display
      setCurrentTick(tick)
      const priceStr = tick.toFixed(5)
      setCurrentPrice(priceStr)

      // Store in tick history per volatility (keep last 5000 per symbol)
      setTickHistory(prev => {
        const currentHistory = prev[symbol] || []
        const newHistory = [...currentHistory, tick].slice(-5000)

        const updated = {
          ...prev,
          [symbol]: newHistory
        }

        // Only run analysis if we have enough data for current symbol
        if (newHistory.length >= 10) {
          // Calculate digit distribution with real-time updates
          calculateDigitDistribution(newHistory)

          // Perform enhanced pattern analysis
          analyzePatterns(newHistory)

          // Make AI-powered prediction
          makePrediction(newHistory)

          // Calculate contract-specific probabilities
          calculateContractProbabilities(newHistory)
        }

        return updated
      })

      // Execute trade if trading is active
      if (isTrading) {
        executeTradeDecision(tick)
      }
    } catch (error) {
      console.error('Error handling new tick:', error)
    }
  }

  const calculateContractProbabilities = (history: number[]) => {
    if (history.length < 10) return

    const recentTicks = history.slice(-100) // Use last 100 ticks for probability calculation
    const lastDigits = recentTicks.map(tick => Math.floor(Math.abs(tick * 100000)) % 10)

    // Calculate probabilities based on contract type
    let probabilities = {}

    if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
      const evenCount = lastDigits.filter(d => d % 2 === 0).length
      const oddCount = lastDigits.length - evenCount
      const total = lastDigits.length

      probabilities = {
        even: ((evenCount / total) * 100).toFixed(1),
        odd: ((oddCount / total) * 100).toFixed(1)
      }
    } else if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') {
      const underCount = lastDigits.filter(d => d < 5).length // 0,1,2,3,4
      const overCount = lastDigits.filter(d => d >= 5).length // 5,6,7,8,9
      const total = lastDigits.length

      probabilities = {
        under: ((underCount / total) * 100).toFixed(1),
        over: ((overCount / total) * 100).toFixed(1)
      }
    } else if (contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') {
      // For match/differs, show probability for each digit
      const digitCounts = new Array(10).fill(0)
      lastDigits.forEach(d => digitCounts[d]++)
      const total = lastDigits.length

      probabilities = {}
      for (let i = 0; i < 10; i++) {
        probabilities[`digit_${i}`] = ((digitCounts[i] / total) * 100).toFixed(1)
      }
    }

    // You can use these probabilities to update UI or make trading decisions
    console.log('Contract probabilities:', probabilities)
  }

  const calculateDigitDistribution = (history: number[]) => {
    if (history.length === 0) return

    const digitCounts = new Array(10).fill(0)

    // Count occurrences of each last digit
    history.forEach(tick => {
      const lastDigit = Math.floor(Math.abs(tick * 100000)) % 10
      digitCounts[lastDigit]++
    })

    setDigitDistribution(digitCounts)

    // Calculate percentages
    const total = history.length
    const percentages = digitCounts.map(count => total > 0 ? (count / total) * 100 : 10)
    setDigitPercentages(percentages)
  }

  const analyzePatterns = (history: number[]) => {
    if (history.length < 100) return

    try {
      const recentTicks = history.slice(-100)
      const lastDigits = recentTicks.map(tick => Math.floor(Math.abs(tick * 100000)) % 10)

      // Analyze even/odd bias
      const evenCount = lastDigits.filter(d => d % 2 === 0).length
      const oddCount = lastDigits.filter(d => d % 2 === 1).length

      if (evenCount > oddCount * 1.2) {
        setEvenOddBias('EVEN BIAS')
      } else if (oddCount > evenCount * 1.2) {
        setEvenOddBias('ODD BIAS')
      } else {
        setEvenOddBias('NEUTRAL')
      }

      // Analyze over/under bias (0-4 vs 5-9)
      const underCount = lastDigits.filter(d => d < 5).length
      const overCount = lastDigits.filter(d => d >= 5).length

      if (underCount > overCount * 1.2) {
        setOverUnderBias('UNDER BIAS')
      } else if (overCount > underCount * 1.2) {
        setOverUnderBias('OVER BIAS')
      } else {
        setOverUnderBias('NEUTRAL')
      }

      // Analyze streak patterns
      const streaks = []
      if (lastDigits.length > 0) {
        let currentStreakType = lastDigits[0] % 2
        let streakLength = 1

        for (let i = 1; i < lastDigits.length; i++) {
          if (lastDigits[i] % 2 === currentStreakType) {
            streakLength++
          } else {
            streaks.push(streakLength)
            currentStreakType = lastDigits[i] % 2
            streakLength = 1
          }
        }

        if (streaks.length > 0) {
          const avgStreak = streaks.reduce((a, b) => a + b, 0) / streaks.length
          setStreakPattern(`AVG: ${avgStreak.toFixed(1)}`)
        } else {
          setStreakPattern('---')
        }
      }
    } catch (error) {
      console.error('Error in pattern analysis:', error)
    }
  }

  const makePrediction = (history: number[]) => {
    if (history.length < 50) return

    try {
      const recentTicks = history.slice(-50)
      const lastDigits = recentTicks.map(tick => Math.floor(Math.abs(tick * 100000)) % 10)

      // Advanced prediction based on contract type
      if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
        const evenCount = lastDigits.filter(d => d % 2 === 0).length
        const oddCount = lastDigits.length - evenCount

        if (contractType === 'DIGITEVEN') {
          setNextPrediction(evenCount < oddCount ? 'EVEN' : 'ODD')
          setConfidence(Math.min(95, 60 + Math.abs(evenCount - oddCount) * 2))
        } else {
          setNextPrediction(oddCount < evenCount ? 'ODD' : 'EVEN')
          setConfidence(Math.min(95, 60 + Math.abs(evenCount - oddCount) * 2))
        }
      } else if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') {
        const underCount = lastDigits.filter(d => d < 5).length
        const overCount = lastDigits.length - underCount

        if (contractType === 'DIGITOVER') {
          setNextPrediction(overCount < underCount ? 'OVER' : 'UNDER')
          setConfidence(Math.min(95, 60 + Math.abs(overCount - underCount) * 2))
        } else {
          setNextPrediction(underCount < overCount ? 'UNDER' : 'OVER')
          setConfidence(Math.min(95, 60 + Math.abs(overCount - underCount) * 2))
        }
      } else {
        // For match/differs contracts, find least frequent digit
        const digitCounts = new Array(10).fill(0)
        lastDigits.forEach(d => digitCounts[d]++)
        const minCount = Math.min(...digitCounts)
        const leastFrequentDigit = digitCounts.indexOf(minCount)

        setNextPrediction(leastFrequentDigit.toString())
        setConfidence(Math.min(95, 50 + (10 - minCount) * 5))
      }
    } catch (error) {
      console.error('Error in prediction:', error)
    }
  }

  const executeTradeDecision = (tick: number) => {
    const lastDigit = tick % 10
    const timestamp = new Date().toLocaleTimeString()

    // Simple trading logic based on prediction
    let shouldTrade = false
    let tradeType = contractType

    if (contractType === 'DIGITEVEN' && nextPrediction === 'EVEN' && confidence > 70) {
      shouldTrade = true
    } else if (contractType === 'DIGITODD' && nextPrediction === 'ODD' && confidence > 70) {
      shouldTrade = true
        }

    if (shouldTrade) {
      // Simulate trade execution
      const isWin = Math.random() > 0.45 // 55% win rate simulation
      const pnl = isWin ? parseFloat(stakeAmount) * 0.95 : -parseFloat(stakeAmount)

      setTradingLog(prev => [...prev, {
        timestamp,
        action: `${tradeType} @ ${tick}`,
        result: isWin ? 'WIN' : 'LOSS',
        pnl: (pnl > 0 ? '+' : '') + pnl.toFixed(2),
        type: isWin ? 'win' : 'loss'
      }])

      setTotalTrades(prev => prev + 1)
      setProfitLoss(prev => prev + pnl)
      setCurrentStreak(prev => isWin ? (prev > 0 ? prev + 1 : 1) : (prev < 0 ? prev - 1 : -1))

      // Update win rate
      setWinRate(prev => {
        const wins = tradingLog.filter(log => log.type === 'win').length + (isWin ? 1 : 0)
        const total = totalTrades + 1
        return (wins / total) * 100
      })
    }
  }

  const startTrading = () => {
    if (!isConnected) return
    setIsTrading(true)

    setTradingLog(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      action: 'TRADING STARTED',
      result: 'SYSTEM',
      pnl: '---',
      type: 'system'
    }])
  }

  const stopTrading = () => {
    setIsTrading(false)

    setTradingLog(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      action: 'TRADING STOPPED',
      result: 'SYSTEM',
      pnl: '---',
      type: 'system'
    }])
  }

    const executePythonCode = useCallback(async () => {
        if (!pythonCode.trim()) {
            addOutput('error', 'No Python code to execute');
            return;
        }

        setIsExecuting(true);
        addOutput('info', 'Starting Python script execution...');

        try {
            // In a real implementation, this would send the code to a Python backend
            // For demo purposes, we'll simulate execution
            const response = await fetch('/api/execute-python', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code: pythonCode }),
            });

            if (response.ok) {
                const result = await response.json();
                addOutput('success', 'Script executed successfully');
                if (result.output) {
                    result.output.split('\n').forEach(line => {
                        if (line.trim()) {
                            addOutput('output', line);
                        }
                    });
                }
            } else {
                throw new Error('Failed to execute Python script');
            }
        } catch (error) {
            // Simulate Python execution for demo
            addOutput('info', 'Simulating Python script execution...');

            setTimeout(() => {
                addOutput('output', 'Starting auto trading script...');
                addOutput('output', 'Market: EUR/USD - Price: 1.0850 - Action: HOLD');
                addOutput('output', 'Market: EUR/USD - Price: 1.0865 - Action: BUY');
                addOutput('success', 'Trade executed: {"action": "BUY", "amount": 1.0, "status": "executed"}');
                addOutput('output', 'Auto trading script completed.');
                setIsExecuting(false);
            }, 2000);

            return;
        }

        setIsExecuting(false);
    }, [pythonCode]);

    const clearPythonCode = useCallback(() => {
        setPythonCode('');
        setPythonOutput([]);
        addOutput('info', 'Editor cleared');
    }, []);

    const savePythonScript = useCallback(() => {
        if (!pythonCode.trim()) {
            addOutput('error', 'No code to save');
            return;
        }

        const scriptName = prompt('Enter script name:');
        if (scriptName) {
            const newScript = {
                name: scriptName,
                code: pythonCode,
                created: new Date().toISOString(),
            };

            const updatedScripts = [...savedScripts, newScript];
            setSavedScripts(updatedScripts);
            localStorage.setItem('pythonTradingScripts', JSON.stringify(updatedScripts));
            addOutput('success', `Script '${scriptName}' saved successfully`);
        }
    }, [pythonCode, savedScripts]);

    const loadSavedScript = useCallback((scriptName) => {
        if (!scriptName) return;

        const script = savedScripts.find(s => s.name === scriptName);
        if (script) {
            setPythonCode(script.code);
            addOutput('info', `Loaded script: ${scriptName}`);
        }
    }, [savedScripts]);

    const addOutput = useCallback((type, content) => {
        const newLine = {
            type,
            content,
            timestamp: new Date().toLocaleTimeString(),
        };
        setPythonOutput(prev => [...prev, newLine]);
    }, []);

    const loadTemplate = useCallback((templateType) => {
        const templates = {
            basic_strategy: `# Basic Trading Strategy Template
import time
from datetime import datetime

def simple_trading_strategy():
    """Basic buy/sell strategy based on price movements"""
    print("Executing basic trading strategy...")

    # Simulate market analysis
    current_price = 1.0850
    support_level = 1.0800
    resistance_level = 1.0900

    if current_price < support_level:
        print(f"Price {current_price} below support {support_level} - BUY signal")
        return "BUY"
    elif current_price > resistance_level:
        print(f"Price {current_price} above resistance {resistance_level} - SELL signal")
        return "SELL"
    else:
        print(f"Price {current_price} in range - HOLD")
        return "HOLD"

if __name__ == "__main__":
    action = simple_trading_strategy()
    print(f"Trading action: {action}")`,

            moving_average: `# Moving Average Strategy Template
import numpy as np
from datetime import datetime

def moving_average_strategy(prices, short_period=5, long_period=20):
    """Moving average crossover strategy"""
    print("Calculating moving averages...")

    # Sample price data
    prices = [1.0800, 1.0820, 1.0850, 1.0840, 1.0860, 1.0880, 1.0870, 1.0890]

    if len(prices) < long_period:
        print("Not enough data for moving average calculation")
        return "HOLD"

    short_ma = sum(prices[-short_period:]) / short_period
    long_ma = sum(prices[-long_period:]) / long_period

    print(f"Short MA ({short_period}): {short_ma:.4f}")
    print(f"Long MA ({long_period}): {long_ma:.4f}")

    if short_ma > long_ma:
        print("Short MA above Long MA - BUY signal")
        return "BUY"
    elif short_ma < long_ma:
        print("Short MA below Long MA - SELL signal")
        return "SELL"
    else:
        return "HOLD"

if __name__ == "__main__":
    action = moving_average_strategy([])
    print(f"Trading action: {action}")`,

            risk_management: `# Risk Management Template
def calculate_position_size(account_balance, risk_percent, stop_loss_pips):
    """Calculate position size based on risk management rules"""
    risk_amount = account_balance * (risk_percent / 100)
    position_size = risk_amount / stop_loss_pips

    print(f"Account Balance: ${account_balance}")
    print(f"Risk Percentage: {risk_percent}%")
    print(f"Risk Amount: ${risk_amount}")
    print(f"Stop Loss: {stop_loss_pips} pips")
    print(f"Calculated Position Size: {position_size}")

    return position_size

def risk_management_check(current_trades, max_trades, daily_loss_limit):
    """Check risk management parameters"""
    print("Performing risk management checks...")

    if current_trades >= max_trades:
        print(f"Maximum trades ({max_trades}) reached for today")
        return False

    # Simulate daily P&L check
    daily_pnl = -150  # Example loss
    if daily_pnl <= -daily_loss_limit:
        print(f"Daily loss limit (${daily_loss_limit}) reached")
        return False

    print("Risk management checks passed")
    return True

if __name__ == "__main__":
    position_size = calculate_position_size(10000, 2, 50)
    can_trade = risk_management_check(3, 5, 200)
    print(f"Can place trade: {can_trade}")`,

            api_integration: `# API Integration Template
import json
import time
from datetime import datetime

class TradingAPI:
    """Mock trading API integration"""

    def __init__(self, api_key, demo_mode=True):
        self.api_key = api_key
        self.demo_mode = demo_mode
        print(f"Initialized Trading API in {'demo' if demo_mode else 'live'} mode")

    def get_market_data(self, symbol):
        """Fetch real-time market data"""
        # Mock API response
        data = {
            'symbol': symbol,
            'bid': 1.0845,
            'ask': 1.0847,
            'timestamp': datetime.now().isoformat()
        }
        print(f"Market data for {symbol}: {data}")
        return data

    def place_order(self, symbol, order_type, volume):
        """Place trading order"""
        order = {
            'order_id': f"ORD_{int(time.time())}",
            'symbol': symbol,
            'type': order_type,
            'volume': volume,
            'status': 'filled' if self.demo_mode else 'pending',
            'timestamp': datetime.now().isoformat()
        }
        print(f"Order placed: {order}")
        return order

    def get_account_info(self):
        """Get account information"""
        account = {
            'balance': 10000.00,
            'equity': 10150.00,
            'margin': 50.00,
            'free_margin': 10100.00
        }
        print(f"Account info: {account}")
        return account

def automated_trading():
    """Main automated trading function"""
    api = TradingAPI("your_api_key_here", demo_mode=True)

    # Get account info
    account = api.get_account_info()

    # Analyze market
    market_data = api.get_market_data("EURUSD")

    # Simple trading logic
    if market_data['bid'] > 1.0850:
        order = api.place_order("EURUSD", "SELL", 0.1)
        print(f"Sell order executed: {order['order_id']}")
    elif market_data['ask'] < 1.0840:
        order = api.place_order("EURUSD", "BUY", 0.1)
        print(f"Buy order executed: {order['order_id']}")
    else:
        print("No trading signal - waiting...")

if __name__ == "__main__":
    automated_trading()`
        };

        if (templates[templateType]) {
            setPythonCode(templates[templateType]);
            addOutput('info', `Loaded ${templateType.replace('_', ' ')} template`);
        }
    }, [addOutput]);

    // Load saved scripts on component mount
    useEffect(() => {
        const saved = localStorage.getItem('pythonTradingScripts');
        if (saved) {
            try {
                setSavedScripts(JSON.parse(saved));
            } catch (error) {
                console.error('Error loading saved scripts:', error);
            }
        }
    }, []);

    useEffect(() => {
      if (active_tab === 'auto-trades') {
        // Auto trades specific logic can go here
      }

      // Cleanup WebSocket connection on unmount
      return () => {
        if (websocket) {
          websocket.close()
          setWebsocket(null)
          setIsConnected(false)
        }
      }
    }, [active_tab])

    // Reconnect when volatility changes
    useEffect(() => {
      if (isConnected && websocket && websocket.readyState === WebSocket.OPEN) {
        console.log('Volatility changed to:', selectedIndex, 'Getting data...')

        // Unsubscribe from all ticks first
        websocket.send(JSON.stringify({
          forget_all: "ticks",
          req_id: 99
        }))

        // Get historical data and subscribe to new symbol after a short delay
        setTimeout(() => {
          // Check if we already have data for this volatility
          const currentVolatilityHistory = tickHistory[selectedIndex]

          if (!currentVolatilityHistory || currentVolatilityHistory.length === 0) {
            // Request historical ticks if we don't have them
            const historyRequest = {
              ticks_history: selectedIndex,
              count: 5000,
              end: 'latest',
              style: 'ticks',
              req_id: Date.now()
            }
            console.log('Requesting historical ticks for new volatility:', historyRequest)
            websocket.send(JSON.stringify(historyRequest))
          } else {
            // Use existing data for immediate display
            calculateDigitDistribution(currentVolatilityHistory)
            analyzePatterns(currentVolatilityHistory)
            makePrediction(currentVolatilityHistory)
            calculateContractProbabilities(currentVolatilityHistory)

            if (currentVolatilityHistory.length > 0) {
              const latestPrice = currentVolatilityHistory[currentVolatilityHistory.length - 1]
              setCurrentPrice(latestPrice.toFixed(5))
            }
          }

          // Subscribe to real-time ticks
          const newTickRequest = {
            ticks: selectedIndex,
            subscribe: 1,
            req_id: Date.now() + 1
          }
          console.log('Sending new tick subscription:', newTickRequest)
          websocket.send(JSON.stringify(newTickRequest))
        }, 500)

        setCurrentPrice('Loading ' + selectedIndex + ' data...')
        setCurrentTick(null)
      } else if (!isConnected) {
        // If not connected, reset display
        setCurrentPrice('Not connected - Select ' + selectedIndex)
        setCurrentTick(null)
      }
    }, [selectedIndex, isConnected, websocket, tickHistory])


    const showRunPanel = [DBOT_TABS.BOT_BUILDER, DBOT_TABS.TRADING_HUB, DBOT_TABS.ANALYSIS_TOOL, DBOT_TABS.CHART, DBOT_TABS.SIGNALS].includes(active_tab);

    return (
        <>
            <div className='main'>
                <div className='main__container main-content'>
                    <Tabs active_index={active_tab} className='main__tabs' onTabItemChange={onEntered} onTabItemClick={handleTabChange} top>
                        <div label={<><FreeBotsIcon /><Localize i18n_default_text='Free Bots' /></>} id='id-free-bots'>
                            <div className='free-bots'>
                                <h2 className='free-bots__heading'><Localize i18n_default_text='Free Bots' /></h2>
                                <div className='free-bots__content-wrapper'>
                                    <div className='free-bots__content'>
                                        {bots.map((bot, index) => (
                                            <div
                                                className={`free-bot-card ${bot.isPlaceholder ? 'free-bot-card--loading' : ''}`}
                                                key={index}
                                                onClick={() => {
                                                    handleBotClick(bot);
                                                }}
                                                style={{
                                                    cursor: 'pointer',
                                                    opacity: bot.isPlaceholder ? 0.7 : 1
                                                }}
                                            >
                                                <div className='free-bot-card__icon'>
                                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="#1976D2">
                                                        <path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z"/>
                                                        <rect x="6" y="10" width="12" height="8" rx="2" fill="#1976D2"/>
                                                        <circle cx="9" cy="13" r="1.5" fill="white"/>
                                                        <circle cx="15" cy="13" r="1.5" fill="white"/>
                                                        <rect x="10" y="15" width="4" height="1" rx="0.5" fill="white"/>
                                                        <rect x="4" y="12" width="2" height="4" rx="1" fill="#1976D2"/>
                                                        <rect x="18" y="12" width="2" height="4" rx="1" fill="#1976D2"/>
                                                    </svg>
                                                </div>
                                                <div className='free-bot-card__details'>
                                                    <h3 className='free-bot-card__title'>{bot.title}</h3>
                                                    <p className='free-bot-card__description'>{bot.description}</p>
                                                    <p className='free-bot-card__action'>
                                                        {bot.isPlaceholder ? 'Loading bot...' : 'Click to load this bot'}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div label={<><BotBuilderIcon /><Localize i18n_default_text='Bot Builder' /></>} id='id-bot-builder'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading bot builder...')} />}>
                                {active_tab === DBOT_TABS.BOT_BUILDER && <BotBuilder key={`bot-builder-${Date.now()}`} />}
                            </Suspense>
                        </div>
                        <div label={<><BotIcon /><Localize i18n_default_text='Smart Trading' /></>} id='id-smart-trading'>
                            <VolatilityAnalyzer />
                        </div>
                        <div label={<><BotIcon /><Localize i18n_default_text='Speed Bot' /></>} id='id-speed-bot'>
                            <SpeedBot />
                        </div>
                        <div label={<><SignalsIcon /><Localize i18n_default_text='Signal Scanner' /></>} id='id-signals'>
                            <div className={classNames('dashboard__chart-wrapper', {
                                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                            })}>
                                <iframe
                                    src="https://tracktool.netlify.app/signals.html"
                                    width="100%"
                                    height="100%"
                                    style={{
                                        border: 'none',
                                        display: 'block',
                                        minHeight: '600px',
                                        height: 'calc(100vh - 200px)'
                                    }}
                                    scrolling="yes"
                                    title="Trading Signals"
                                />
                            </div>
                        </div>
                        <div label={<><AnalysisToolIcon /><Localize i18n_default_text='Analysis Tool' /></>} id='id-analysis-tool'>
                            <div className={classNames('dashboard__chart-wrapper', {
                                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                            })}>
                                <Tabs
                                    className="analysis-tool-tabs"
                                    active_tab_icon_color="var(--brand-secondary)"
                                    background_color="var(--general-main-1)"
                                    single_tab_has_no_label
                                    should_update_hash={false}
                                >
                                    <div label={<Localize i18n_default_text='Technical Analysis' />} id='technical-analysis'>
                                        <AnalysistoolComponent />
                                    </div>
                                    <div label={<Localize i18n_default_text='Market Analyzer' />} id='market-analyzer'>
                                        <iframe
                                            src="https://api.binarytool.site/"
                                            title="Market Analyzer"
                                        />
                                    </div>
                                </Tabs>
                            </div>
                        </div>
                        <div label={<><ChartsIcon /><Localize i18n_default_text='Charts' /></>} id='id-charts'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading chart...')} />}>
                                <Chart show_digits_stats={false} />                            </Suspense>
                        </div>
                        <div label={<><TutorialsIcon /><Localize i18n_default_text='Tutorials' /></>} id='id-tutorials'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading tutorials...')} />}>
                                <Tutorial handleTabChange={handleTabChange} />
                            </Suspense>
                        </div>
                        <div label={<><TradingHubIcon /><Localize i18n_default_text='Trading Hub' /></>} id='id-Trading-Hub'>
                            <TradingHubDisplay />
                        </div>
                         <div label={<><BotIcon /><Localize i18n_default_text='Decycler Bot' /></>} id='id-Decycler-Bot'>
                            <DecyclerBot />
                        </div>
                        <div label={<><DashboardIcon /><Localize i18n_default_text='Dashboard' /></>} id='id-dbot-dashboard'>
                            <Dashboard handleTabChange={handleTabChange} />
                            <button onClick={handleOpen}>Load Bot</button>
                        </div>
                    </Tabs>
                </div>
            </div>
            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    {showRunPanel && <RunPanel />}
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>
            <MobileWrapper>
                <RunPanel />
            </MobileWrapper>
            <Dialog cancel_button_text={cancel_button_text || localize('Cancel')} confirm_button_text={ok_button_text || localize('Ok')} has_close_icon is_visible={is_dialog_open} onCancel={onCancelButtonClick} onClose={onCloseDialog} onConfirm={onOkButtonClick || onCloseDialog} title={title}>
                {message}
            </Dialog>
        </>
    );
});

export default AppWrapper;