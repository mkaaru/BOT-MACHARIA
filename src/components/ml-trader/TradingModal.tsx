import React from 'react';
import Modal from '@/components/shared_ui/modal';
import Text from '@/components/shared_ui/text';
import Button from '@/components/shared_ui/button';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';

interface TradingRecommendation {
    symbol: string;
    strategy: string;
    barrier?: string;
    confidence: number;
    overPercentage: number;
    underPercentage: number;
    reason: string;
    timestamp: number;
    displayName?: string;
    currentPrice?: number;
    suggestedStake?: number;
    suggestedDuration?: number;
    suggestedDurationUnit?: string;
    direction?: string;
}

interface TradingModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: TradingRecommendation | null;
    account_currency: string;
    current_price: number | null;
    onLoadSettings: () => void;
    // Form state props
    symbol: string;
    setSymbol: (value: string) => void;
    trade_mode: 'rise_fall' | 'higher_lower';
    setTradeMode: (value: 'rise_fall' | 'higher_lower') => void;
    contract_type: string;
    setContractType: (value: string) => void;
    duration: number;
    setDuration: (value: number) => void;
    duration_unit: 't' | 's' | 'm';
    setDurationUnit: (value: 't' | 's' | 'm') => void;
    stake: number;
    setStake: (value: number) => void;
    barrier_offset: number;
    setBarrierOffset: (value: number) => void;
}

// Enhanced volatility symbols including 1-second indices
const ENHANCED_VOLATILITY_SYMBOLS = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index', is_1s: false },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', is_1s: false },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', is_1s: false },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', is_1s: false },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', is_1s: false },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', is_1s: true },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', is_1s: true },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', is_1s: true },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', is_1s: true },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', is_1s: true },
];

// Trade types for Rise/Fall and Higher/Lower
const TRADE_TYPES = [
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
];

const HIGHER_LOWER_TYPES = [
    { value: 'CALL', label: 'Higher' },
    { value: 'PUT', label: 'Lower' },
];

const TradingModal: React.FC<TradingModalProps> = ({
    isOpen,
    onClose,
    recommendation,
    account_currency,
    current_price,
    onLoadSettings,
    symbol,
    setSymbol,
    trade_mode,
    setTradeMode,
    contract_type,
    setContractType,
    duration,
    setDuration,
    duration_unit,
    setDurationUnit,
    stake,
    setStake,
    barrier_offset,
    setBarrierOffset,
}) => {
    const store = useStore();
    const { dashboard } = store;

    if (!isOpen || !recommendation) return null;

    const handleClose = () => {
        try {
            onClose();
        } catch (error) {
            console.error('Error closing modal:', error);
        }
    };

    const handleLoadSettings = () => {
        try {
            onLoadSettings();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    };

    // Generate Bot Builder XML for the settings
    const generateBotBuilderXML = () => {
        const selectedSymbol = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === symbol);
        const symbolDisplay = selectedSymbol?.display_name || symbol;

        // Contract type mapping - map ML Trader types to Bot Builder types
        const contractTypeMapping: Record<string, string> = {
            'CALL': trade_mode === 'rise_fall' ? 'CALL' : 'CALLE', // Rise for Rise/Fall, Higher for Higher/Lower
            'PUT': trade_mode === 'rise_fall' ? 'PUT' : 'PUTE'     // Fall for Rise/Fall, Lower for Higher/Lower
        };

        const mappedContractType = contractTypeMapping[contract_type] || (trade_mode === 'rise_fall' ? 'CALL' : 'CALLE');

        // Duration unit mapping
        const durationUnitMapping: Record<string, string> = {
            't': 't', // ticks
            's': 's', // seconds
            'm': 'm'  // minutes
        };

        const mappedDurationUnit = durationUnitMapping[duration_unit] || 't';

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable id="market">market</variable>
    <variable id="submarket">submarket</variable>
    <variable id="symbol">symbol</variable>
    <variable id="tradetypecat">tradetypecat</variable>
  </variables>
  <block type="trade_definition" id="trade_definition" x="0" y="0">
    <field name="MARKET_LIST">${selectedSymbol?.group || 'synthetic_index'}</field>
    <field name="SUBMARKET_LIST">${selectedSymbol?.submarket || 'continuous_indices'}</field>
    <field name="SYMBOL_LIST">${symbol}</field>
    <field name="TRADETYPECAT_LIST">${trade_mode === 'rise_fall' ? 'callput' : 'highlow'}</field>
    <field name="TRADETYPE_LIST">${mappedContractType}</field>
    <value name="DURATION">
      <shadow type="math_number">
        <field name="NUM">${duration}</field>
      </shadow>
    </value>
    <value name="DURATIONTYPE_LIST">
      <shadow type="text">
        <field name="TEXT">${mappedDurationUnit}</field>
      </shadow>
    </value>
    <value name="AMOUNT">
      <shadow type="math_number">
        <field name="NUM">${stake}</field>
      </shadow>
    </value>
    <value name="BARRIEROFFSETTYPE_LIST">
      <shadow type="text">
        <field name="TEXT">+</field>
      </shadow>
    </value>
    ${trade_mode === 'higher_lower' ? `
    <value name="BARRIEROFFSET">
      <shadow type="math_number">
        <field name="NUM">${barrier_offset}</field>
      </shadow>
    </value>` : ''}
    <statement name="SUBMARKET_TRADEPARAMETERS">
      <block type="trade_definition_market" id="trade_definition_market">
        <field name="MARKET_LIST">${selectedSymbol?.group || 'synthetic_index'}</field>
        <field name="SUBMARKET_LIST">${selectedSymbol?.submarket || 'continuous_indices'}</field>
        <field name="SYMBOL_LIST">${symbol}</field>
      </block>
    </statement>
  </block>
</xml>`;

        return xml;
    };

    // Load the complete bot strategy template including purchase conditions and restart logic
    const handleLoadToBotBuilder = async () => {
        try {
            console.log('🔄 Loading complete bot strategy to Bot Builder...');

            // Define the complete bot strategy XML content matching the Bot Builder template
            // Calculate barrier offset based on contract type
            const calculateBarrierOffset = () => {
                if (trade_mode === 'higher_lower') {
                    // For Higher/Lower, use the barrier offset from form
                    return contract_type === 'CALL' ? `+${barrier_offset}` : `-${barrier_offset}`;
                }
                return '+0.35'; // Default offset for Rise/Fall
            };

            const tradeTypeCategory = trade_mode === 'higher_lower' ? 'highlow' : 'callput';
            // Map 'Rise/Fall' to 'risefall' and 'Higher/Lower' to 'highlow'
            const tradeTypeList = trade_mode === 'higher_lower' ? 'highlow' : 'risefall';
            // Corrected contract type mapping for Bot Builder
            const contractTypeField = contract_type === 'CALL' ? (trade_mode === 'rise_fall' ? 'CALL' : 'CALLE') : (trade_mode === 'rise_fall' ? 'PUT' : 'PUTE');
            const barrierOffsetValue = calculateBarrierOffset();

            const botSkeletonXML = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id=":yGQ!WYKA[R_sO1MkSjL">tick1</variable>
    <variable id="y)BE|l7At6oT)ur0Dsw?">Stake</variable>
    <variable id="jZ@oue8^bFSf$W^OcBHK">predict 3</variable>
    <variable id="7S=JB!;S?@%x@F=5xFsK">tick 2</variable>
    <variable id="qQ]^z(23IIrz6z~JnY#h">tick 3</variable>
    <variable id="I4.{v(IzG;i#bX-6h(1#">win stake</variable>
    <variable id=".5ELQ4[J.e4czk,qPqKM">Martingale split</variable>
    <variable id="Result_is">Result_is</variable>
  </variables>

  <!-- Trade Definition Block -->
  <block type="trade_definition" id="=;b|aw3,G(o+jI6HNU0_" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="GrbKdLI=66(KGnSGl*=_" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">continuous_indices</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="F)ky6X[Pq]/Anl_CQ%)" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${tradeTypeCategory}</field>
            <field name="TRADETYPE_LIST">${tradeTypeList}</field>
            <next>
              <block type="trade_definition_contracttype" id="z1{e5E+47NIm}*%5/AoJ" deletable="false" movable="false">
                <field name="TYPE_LIST">${contractTypeField}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="?%X41!vudp91L1/W30?x" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="Uw+CuacxzG/2-ktTeC|P" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id=",Dtx3!}1;A5bX#kc%+@y" deletable="false" movable="false">
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

    <!-- Run once at start -->
    <statement name="INITIALIZATION">
      <block type="text_print" id="x4l[!tcMk5~9$g9tp)F.">
        <value name="TEXT">
          <shadow type="text" id="?#mD$Ejd%z^s]r*M(Co]">
            <field name="TEXT">We are about to start Trading, be Ready</field>
          </shadow>
        </value>
        <next>
          <block type="text_print" id="H5S$R8eJ,8_xuO2;w07T">
            <value name="TEXT">
              <shadow type="text" id="-(O49Z%3:}onz_i%UInT">
                <field name="TEXT">Thank you for trading with us</field>
              </shadow>
            </value>
            <next>
              <block type="variables_set" id="*k=Zh]oy^xkO%$_J}wmI">
                <field name="VAR" id="y)BE|l7At6oT)ur0Dsw?">Stake</field>
                <value name="VALUE">
                  <block type="math_number" id="TDv/W;dNI84TFbp}8X8=">
                    <field name="NUM">${stake}</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="a+aI}xH)h$*P-GA=;IJi">
                    <field name="VAR" id="I4.{v(IzG;i#bX-6h(1#">win stake</field>
                    <value name="VALUE">
                      <block type="math_number" id="9Z%4%dmqCp;/sSt8wGv#">
                        <field name="NUM">${stake}</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="}RkgwZuqtMN[-O}zHU%8">
                        <field name="VAR" id=".5ELQ4[J.e4czk,qPqKM">Martingale split</field>
                        <value name="VALUE">
                          <block type="math_number" id="Ib,KrcnUJzn1KMo9)A">
                            <field name="NUM">2.2</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="h!e/g.y@3xFBo0Q,Yzm">
                            <field name="VAR" id="jZ@oue8^bFSf$W^OcBHK">predict 3</field>
                            <value name="VALUE">
                              <block type="math_random_int" id="i0NhB-KvY:?lj+^6ymZU">
                                <value name="FROM">
                                  <shadow type="math_number" id="$A^)*y7W0([+ckWE+BCo">
                                    <field name="NUM">1</field>
                                  </shadow>
                                </value>
                                <value name="TO">
                                  <shadow type="math_number" id=",_;o3PUOp?^|_ffS^P8">
                                    <field name="NUM">1</field>
                                  </shadow>
                                </value>
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
    </statement>

    <!-- Trade options -->
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="QXj55FgjyN!H@HP]V6jI">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="${trade_mode === 'higher_lower' ? 'true' : 'false'}" has_second_barrier="false" has_prediction="false"></mutation>
        <field name="DURATIONTYPE_LIST">${duration_unit}</field>
        <value name="DURATION">
          <shadow type="math_number" id="9n#e|joMQv~[@p?0ZJ1w">
            <field name="NUM">${duration}</field>
          </shadow>
          <block type="math_number" id="*l8K~H:oQ)^=Cn,A^N~s">
            <field name="NUM">${duration}</field>
          </block>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="ziEt8|we%%I_ac)[?0aT">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="m3{*qF|69xv{GI:=Nr#R">
            <field name="VAR" id="y)BE|l7At6oT)ur0Dsw?">Stake</field>
          </block>
        </value>
        ${trade_mode === 'higher_lower' ? `
        <value name="BARRIEROFFSET">
          <shadow type="math_number" id="barrierOffsetBlock">
            <field name="NUM">${barrier_offset}</field>
          </shadow>
        </value>
        <field name="BARRIEROFFSETTYPE_LIST">${contract_type === 'CALL' ? '+' : '-'}</field>` : ''}
      </block>
    </statement>
  </block>

  <!-- Purchase conditions -->
  <block type="before_purchase" id="m^:eB90FBG!Q9f85%x-K" deletable="false" x="267" y="544">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="notify" id="^KrKto{h0?Oi5y!Uo!k">
        <field name="NOTIFICATION_TYPE">success</field>
        <field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <shadow type="text" id="OGu:tW}VqV1el7}LlhgE">
            <field name="TEXT">DUKE...>>>></field>
          </shadow>
          <block type="variables_get" id="DIO6HH*]Tf87lkH)]W1">
            <field name="VAR" id="7S=JB!;S?@%x@F=5xFsK">tick 2</field>
          </block>
        </value>
        <next>
          <block type="purchase" id="it}Zt@Ou$Y97bED_*(nZ">
            <field name="PURCHASE_LIST">${contractTypeField}</field>
          </block>
        </next>
      </block>
    </statement>
  </block>

  <!-- Restart trading conditions -->
  <block type="after_purchase" id="RSFi6b^1!S1=u5HT9ij5" x="679" y="293">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="m~FN=}k/:4T0C|!9RWv7">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="?#pF}/RWg,s)qyk6~Q4">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="VCplk%:6-m~2N?w590V3">
            <field name="VAR" id="jZ@oue8^bFSf$W^OcBHK">predict 3</field>
            <value name="VALUE">
              <block type="math_random_int" id="e!w*#f6#@(J=!w[e]aR">
                <value name="FROM">
                  <shadow type="math_number" id="|~+Cbgj^c]K~uP_)~88!">
                    <field name="NUM">1</field>
                  </shadow>
                </value>
                <value name="TO">
                  <shadow type="math_number" id="]0rAYrYh#6);#j/=i}y=">
                    <field name="NUM">1</field>
                  </shadow>
                </value>
              </block>
            </value>
            <next>
              <block type="variables_set" id="ZPFx9h$~-#?hu({nP9br">
                <field name="VAR" id="y)BE|l7At6oT)ur0Dsw?">Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="evk@VL!Cns23Tt-YO#i">
                    <field name="VAR" id="I4.{v(IzG;i#bX-6h(1#">win stake</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="setResultWin">
                    <field name="VAR" id="Result_is">Result_is</field>
                    <value name="VALUE">
                      <block type="text" id="resultWinText">
                        <field name="TEXT">Win</field>
                      </block>
                    </value>
                    <next>
                      <block type="trade_again" id=".%j%jiw_Gz{$-9+tM1sE"></block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="[]}t.-zV3B}F{r_wuWIK">
            <value name="IF0">
              <block type="contract_check_result" id="d6I:nMCIu?M|pZu?8Di">
                <field name="CHECK_RESULT">loss</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="yqjWT{JtZ.@glB=i+3kC">
                <field name="VAR" id="jZ@oue8^bFSf$W^OcBHK">predict 3</field>
                <value name="VALUE">
                  <block type="math_random_int" id="Kbr]yzFaM7h==L/mxt_">
                    <value name="FROM">
                      <shadow type="math_number" id="rbIXa)*X_r-cy5S%Rw">
                        <field name="NUM">3</field>
                      </shadow>
                    </value>
                    <value name="TO">
                      <shadow type="math_number" id="EgOTvfy4?jpKvYT{M6;8">
                        <field name="NUM">3</field>
                      </shadow>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="H%Y3[M]r3F};XmOP/iSt">
                    <field name="VAR" id="y)BE|l7At6oT)ur0Dsw?">Stake</field>
                    <value name="VALUE">
                      <block type="math_arithmetic" id="0(2SFhVd_f3.w;,4CdAW">
                        <field name="OP">MULTIPLY</field>
                        <value name="A">
                          <shadow type="math_number" id=")X~,;|04N,b=v{cA?n:y">
                            <field name="NUM">1</field>
                          </shadow>
                          <block type="variables_get" id="%#Fuv537r?g4g-8#ZNu7">
                            <field name="VAR" id="y)BE|l7At6oT)ur0Dsw?">Stake</field>
                          </block>
                        </value>
                        <value name="B">
                          <shadow type="math_number" id="D-kN(N|~hTit;*Q-HF3L">
                            <field name="NUM">1</field>
                          </shadow>
                          <block type="variables_get" id="W;ZaB.*3OzGGyV2PDE$L">
                            <field name="VAR" id=".5ELQ4[J.e4czk,qPqKM">Martingale split</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="setResultLoss">
                        <field name="VAR" id="Result_is">Result_is</field>
                        <value name="VALUE">
                          <block type="text" id="resultLossText">
                            <field name="TEXT">Loss</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="trade_again" id="O0gyt$46u#i^LXu}0~SE"></block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>

  <!-- Tick Analysis -->
  <block type="tick_analysis" id="C1)t(KjgV5)#c:5Fz2@_" collapsed="true" x="0" y="1594">
    <statement name="TICKANALYSIS_STACK">
      <block type="variables_set" id="/K_P8vj*(@v:6j]Bu~P=">
        <field name="VAR" id=":yGQ!WYKA[R_sO1MkSjL">tick1</field>
        <value name="VALUE">
          <block type="lists_getIndex" id="XSu=~QE//2Y:]d~p=P/m">
            <mutation xmlns="http://www.w3.org/1999/xhtml" statement="false" at="true"></mutation>
            <field name="MODE">GET</field>
            <field name="WHERE">FROM_END</field>
            <value name="VALUE">
              <block type="lastDigitList" id="}LYybI/S:cjI/Rcy1nY"></block>
            </value>
            <value name="AT">
              <block type="math_number" id="[_RkdoP8]lF/%Gn^">
                <field name="NUM">1</field>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="variables_set" id="3.LXWq^5JH25~0J,AR2Z">
            <field name="VAR" id="7S=JB!;S?@%x@F=5xFsK">tick 2</field>
            <value name="VALUE">
              <block type="lists_getIndex" id="rkKQ307@g~epO|6C0tAc">
                <mutation xmlns="http://www.w3.org/1999/xhtml" statement="false" at="true"></mutation>
                <field name="MODE">GET</field>
                <field name="WHERE">FROM_END</field>
                <value name="VALUE">
                  <block type="lastDigitList" id=".]BV8x.1c1)~p8t:NugU"></block>
                </value>
                <value name="AT">
                  <block type="math_number" id="iY.UfnOo*u4[q]dYMoWD">
                    <field name="NUM">2</field>
                  </block>
                </value>
              </block>
            </value>
            <next>
              <block type="variables_set" id=")$vS+D(;t!*)xtofGW9R">
                <field name="VAR" id="qQ]^z(23IIrz6z~JnY#h">tick 3</field>
                <value name="VALUE">
                  <block type="lists_getIndex" id="Di!)G4xp1N#;_bQVq8LG">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" statement="false" at="true"></mutation>
                    <field name="MODE">GET</field>
                    <field name="WHERE">FROM_END</field>
                    <value name="VALUE">
                      <block type="lastDigitList" id="E{if[4oW3+]]1Aq]d5!G"></block>
                    </value>
                    <value name="AT">
                      <block type="math_number" id="#ULUAs[:gF)![)*!]8;j">
                        <field name="NUM">3</field>
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
  </block>
</xml>`;

            console.log('📄 Loading bot skeleton XML with current settings...');

            // Close modal first
            onClose();

            // Switch to Bot Builder tab (index 1)
            dashboard.setActiveTab(1);

            // Wait for tab switch and workspace initialization
            setTimeout(async () => {
                try {
                    // Import bot skeleton functions
                    const { load } = await import('@/external/bot-skeleton');
                    const { save_types } = await import('@/external/bot-skeleton/constants/save-type');

                    // Ensure workspace is ready
                    if (window.Blockly?.derivWorkspace) {
                        console.log('📦 Loading bot skeleton strategy to workspace...');

                        await load({
                            block_string: botSkeletonXML,
                            file_name: `Bot_Skeleton_${symbol}_${Date.now()}`,
                            workspace: window.Blockly.derivWorkspace,
                            from: save_types.UNSAVED,
                            drop_event: null,
                            strategy_id: null,
                            showIncompatibleStrategyDialog: null,
                        });

                        // Center and focus workspace
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ Bot skeleton strategy loaded successfully to Bot Builder');

                    } else {
                        console.warn('⚠️ Blockly workspace not ready, using fallback method');

                        // Fallback: Direct XML loading
                        setTimeout(() => {
                            if (window.Blockly?.derivWorkspace) {
                                window.Blockly.derivWorkspace.clear();
                                const xmlDoc = window.Blockly.utils.xml.textToDom(botSkeletonXML);
                                window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                                window.Blockly.derivWorkspace.scrollCenter();
                                console.log('✅ Bot skeleton strategy loaded using fallback method');
                            }
                        }, 500);
                    }
                } catch (loadError) {
                    console.error('❌ Error loading bot skeleton strategy:', loadError);

                    // Final fallback
                    if (window.Blockly?.derivWorkspace) {
                        window.Blockly.derivWorkspace.clear();
                        const xmlDoc = window.Blockly.utils.xml.textToDom(botSkeletonXML);
                        window.Blockly.Xml.domToWorkspace(xmlDoc, window.Blockly.derivWorkspace);
                        window.Blockly.derivWorkspace.scrollCenter();
                        console.log('✅ Bot skeleton strategy loaded using final fallback');
                    }
                }
            }, 300);

        } catch (error) {
            console.error('❌ Error in handleLoadToBotBuilder:', error);
        }
    };

    return (
        <Modal
            className="trading-modal"
            is_open={isOpen}
            toggleModal={handleClose}
            title={localize('Trading Interface - ML Recommendation')}
            width="800px"
        >
            <div className="trading-modal__content">
                <div className="trading-modal__recommendation-info">
                    <div className="recommendation-info-card">
                        <div className="recommendation-header">
                            <Text size="sm" weight="bold" color="prominent">
                                {localize('Selected Recommendation')}
                            </Text>
                            <div className="recommendation-badge">
                                <Text size="xs" weight="bold" color="profit-success">
                                    {recommendation.confidence.toFixed(0)}% {localize('Confidence')}
                                </Text>
                            </div>
                        </div>

                        <div className="recommendation-details">
                            <div className="detail-row">
                                <div className="detail-item">
                                    <Text size="xs" color="general">{localize('Symbol')}</Text>
                                    <Text size="sm" weight="bold">
                                        {ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === recommendation.symbol)?.display_name || recommendation.symbol}
                                    </Text>
                                </div>
                                <div className="detail-item">
                                    <Text size="xs" color="general">{localize('Strategy')}</Text>
                                    <Text size="sm" weight="bold">
                                        {trade_mode === 'higher_lower' ?
                                            (contract_type === 'CALL' ? 'HIGHER' : 'LOWER') :
                                            (recommendation.strategy || recommendation.direction || 'CALL').toUpperCase()
                                        }
                                    </Text>
                                </div>
                            </div>

                            {recommendation.barrier && (
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <Text size="xs" color="general">{localize('Barrier')}</Text>
                                        <Text size="sm" weight="bold">{recommendation.barrier}</Text>
                                    </div>
                                    <div className="detail-item">
                                        <Text size="xs" color="general">{localize('Current Price')}</Text>
                                        <Text size="sm" weight="bold">{current_price?.toFixed(5) || 'Loading...'}</Text>
                                    </div>
                                </div>
                            )}

                            <div className="recommendation-reason">
                                <Text size="xs" color="general">{localize('Analysis')}</Text>
                                <Text size="xs" color="prominent">{recommendation.reason}</Text>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="trading-modal__trading-form">
                    <div className="form-header">
                        <Text as="h3" className="form-title">{localize('Trading Parameters')}</Text>
                        <Text size="xs" color="general">{localize('Configure your trade settings')}</Text>
                    </div>

                    <div className="form-grid">
                        <div className="form-section">
                            <Text size="sm" weight="bold" color="prominent">{localize('Market Selection')}</Text>
                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="modal-asset">{localize('Asset')}</label>
                                    <select
                                        id="modal-asset"
                                        value={symbol}
                                        onChange={(e) => setSymbol(e.target.value)}
                                    >
                                        {ENHANCED_VOLATILITY_SYMBOLS.map(s => (
                                            <option key={s.symbol} value={s.symbol}>
                                                {s.display_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-field">
                                    <label htmlFor="modal-trade-mode">{localize('Trade Mode')}</label>
                                    <select
                                        id="modal-trade-mode"
                                        value={trade_mode}
                                        onChange={(e) => setTradeMode(e.target.value as 'rise_fall' | 'higher_lower')}
                                    >
                                        <option value="rise_fall">{localize('Rise/Fall')}</option>
                                        <option value="higher_lower">{localize('Higher/Lower')}</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="form-section">
                            <Text size="sm" weight="bold" color="prominent">{localize('Trade Parameters')}</Text>
                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="modal-contract-type">{localize('Contract Type')}</label>
                                    <select
                                        id="modal-contract-type"
                                        value={contract_type}
                                        onChange={(e) => setContractType(e.target.value)}
                                    >
                                        {(() => {
                                            if (trade_mode === 'asian_up_down') return [
                                                { value: 'ASIANU', label: 'Asian Up' },
                                                { value: 'ASIAND', label: 'Asian Down' }
                                            ];
                                            if (trade_mode === 'rise_fall') return [
                                                { value: 'CALL', label: 'Rise' },
                                                { value: 'PUT', label: 'Fall' }
                                            ];
                                            return HIGHER_LOWER_TYPES;
                                        })().map(type => (
                                            <option key={type.value} value={type.value}>
                                                {type.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-field">
                                    <label htmlFor="modal-stake">{localize('Stake')} ({account_currency})</label>
                                    <div className="input-with-currency">
                                        <input
                                            id="modal-stake"
                                            type="number"
                                            value={stake}
                                            onChange={(e) => setStake(Number(e.target.value))}
                                            min="0.35"
                                            step="0.01"
                                        />
                                        <span className="currency-label">{account_currency}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="form-section">
                            <Text size="sm" weight="bold" color="prominent">{localize('Duration Settings')}</Text>
                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="modal-duration">{localize('Duration')}</label>
                                    <input
                                        id="modal-duration"
                                        type="number"
                                        value={duration}
                                        onChange={(e) => setDuration(Number(e.target.value))}
                                        min="1"
                                    />
                                </div>

                                <div className="form-field">
                                    <label htmlFor="modal-duration-unit">{localize('Duration Unit')}</label>
                                    <select
                                        id="modal-duration-unit"
                                        value={duration_unit}
                                        onChange={(e) => setDurationUnit(e.target.value as 't' | 's' | 'm')}
                                    >
                                        <option value="t">{localize('Ticks')}</option>
                                        <option value="s">{localize('Seconds')}</option>
                                        <option value="m">{localize('Minutes')}</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {trade_mode === 'higher_lower' && (
                            <div className="form-section barrier-section">
                                <Text size="sm" weight="bold" color="prominent">{localize('Barrier Settings')}</Text>
                                <div className="form-row">
                                    <div className="form-field">
                                        <label htmlFor="modal-barrier-offset">{localize('Barrier Offset')}</label>
                                        <input
                                            id="modal-barrier-offset"
                                            type="number"
                                            value={barrier_offset}
                                            onChange={(e) => setBarrierOffset(Number(e.target.value))}
                                            step="0.001"
                                        />
                                    </div>
                                    <div className="form-field">
                                        <label>{localize('Current Price')}</label>
                                        <div className="price-display">
                                            <Text size="sm" weight="bold" color="prominent">
                                                {current_price ? current_price.toFixed(5) : 'Loading...'}
                                            </Text>
                                        </div>
                                    </div>
                                </div>
                                <div className="barrier-preview">
                                    <Text size="xs" color="general">
                                        {localize('Calculated Barrier:')} {' '}
                                        <Text size="xs" weight="bold" color="prominent">
                                            {current_price ?
                                                (contract_type === 'CALL' ?
                                                    (current_price + barrier_offset).toFixed(5) :
                                                    (current_price - barrier_offset).toFixed(5)
                                                ) : 'N/A'
                                            }
                                        </Text>
                                    </Text>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="trading-modal__actions">
                    <div className="actions-info">
                        <Text size="xs" color="general">
                            {localize('Load settings to Bot Builder to customize or run the strategy')}
                        </Text>
                    </div>
                    <div className="actions-buttons">
                        <Button
                            className="modal-cancel-btn"
                            onClick={handleClose}
                            text={localize('Cancel')}
                            secondary
                        />
                        <Button
                            className="modal-load-btn"
                            onClick={handleLoadToBotBuilder}
                            text={localize('Load Settings to Bot Builder')}
                            primary
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default TradingModal;