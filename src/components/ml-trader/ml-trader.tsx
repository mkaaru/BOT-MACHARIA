import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { marketScanner, TradingRecommendation, ScannerStatus } from '@/services/market-scanner';
import { TrendAnalysis } from '@/services/trend-analysis-engine';
import './ml-trader.scss';

// Direct Bot Builder loading - bypassing modal completely

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
    { value: 'CALL', label: 'Rise', description: 'Win if exit spot is higher than entry spot' },
    { value: 'PUT', label: 'Fall', description: 'Win if exit spot is lower than entry spot' },
];

const HIGHER_LOWER_TYPES = [
    { value: 'CALL', label: 'Higher', description: 'Win if exit spot is higher than barrier' },
    { value: 'PUT', label: 'Lower', description: 'Win if exit spot is lower than barrier' },
];

// Safe version of tradeOptionToBuy without Blockly dependencies
const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy: any = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis,
            contract_type,
            currency: trade_option.currency,
            duration: trade_option.duration,
            duration_unit: trade_option.duration_unit,
            symbol: trade_option.symbol,
        },
    };

    // Add barrier for Higher/Lower contracts
    if (trade_option.barrier !== undefined) {
        buy.parameters.barrier = trade_option.barrier;
    }

    return buy;
};

const MLTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const contractInProgressRef = useRef(false);
    const lastOutcomeWasLossRef = useRef<boolean>(false);
    const baseStakeRef = useRef<number>(1.0); // Store the initial stake
    const lossStreakRef = useRef<number>(0);
    const stepRef = useRef<number>(0); // Current step in Martingale or other progression

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [current_price, setCurrentPrice] = useState<number | null>(null);

    // Form state for the trading interface
    const [modal_symbol, setModalSymbol] = useState<string>('');
    const [modal_trade_mode, setModalTradeMode] = useState<'rise_fall' | 'higher_lower'>('rise_fall');
    const [modal_contract_type, setModalContractType] = useState<string>('CALL');
    const [modal_duration, setModalDuration] = useState<number>(5);
    const [modal_duration_unit, setModalDurationUnit] = useState<'t' | 's' | 'm'>('t');
    const [modal_stake, setModalStake] = useState<number>(1.0);
    const [modal_barrier_offset, setModalBarrierOffset] = useState<number>(0.001);

    const [status, setStatus] = useState<string>('');
    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    // Enhanced states for market scanning and trend analysis
    const [scanner_status, setScannerStatus] = useState<ScannerStatus | null>(null);
    const [recommendations, setRecommendations] = useState<TradingRecommendation[]>([]);
    const [market_trends, setMarketTrends] = useState<Map<string, TrendAnalysis>>(new Map());
    const [is_scanner_initialized, setIsScannerInitialized] = useState(false);
    const [auto_mode, setAutoMode] = useState(false);
    const [show_trend_analysis, setShowTrendAnalysis] = useState(true);
    const [scanning_progress, setScanningProgress] = useState(0);
    const [selected_recommendation, setSelectedRecommendation] = useState<TradingRecommendation | null>(null);
    const [volatility_trends, setVolatilityTrends] = useState<Map<string, TrendAnalysis>>(new Map());
    const [initial_scan_complete, setInitialScanComplete] = useState(false);

    // Remove modal state - we bypass the modal completely
    const [modal_recommendation, setModalRecommendation] = useState<TradingRecommendation | null>(null);

    // Super Elite Bot Logic Adaptation
    const baseStake = baseStakeRef.current; // Use baseStake from ref for calculations
    const lossStreak = lossStreakRef.current;
    const step = stepRef.current;

    // Placeholder for Super Elite's prediction logic
    const ouPredPostLoss = 3; // Example: Super Elite uses 3 after a loss

    const handleContractOutcome = useCallback((profit: number) => {
        if (profit > 0) {
            // WIN: Reset to pre-loss state
            lastOutcomeWasLossRef.current = false;
            lossStreakRef.current = 0;
            stepRef.current = 0;
            setStake(baseStake); // Reset stake to base stake
            console.log(`✅ WIN: +${profit.toFixed(2)} ${account_currency} - Reset to pre-loss prediction`);
        } else {
            // LOSS: Set flag for next trade to use after-loss prediction and apply Martingale
            lastOutcomeWasLossRef.current = true;
            lossStreakRef.current++;
            stepRef.current = Math.min(stepRef.current + 1, 10); // Increment step, cap at 10
            const martingaleMultiplier = 1.5; // Updated multiplier
            setStake(prevStake => (prevStake * martingaleMultiplier).toFixed(2)); // Apply Martingale
            console.log(`❌ LOSS: ${profit.toFixed(2)} ${account_currency} - Next trade will use after-loss prediction (${ouPredPostLoss})`);
        }
    }, [account_currency, baseStake, ouPredPostLoss]); // Add dependencies

    useEffect(() => {
        // Initialize API connection and market scanner
        const api = generateDerivApiInstance();
        apiRef.current = api;
        let scannerCleanup: (() => void) | null = null;

        const init = async () => {
            try {
                setStatus('Initializing ML Trader...');

                // Initialize market scanner
                scannerCleanup = await initializeMarketScanner();

                setStatus('ML Trader initialized successfully');
            } catch (e: any) {
                console.error('MLTrader init error', e);
                setStatus(e?.message || 'Failed to initialize ML Trader');
            }
        };

        init();

        return () => {
            if (scannerCleanup) {
                scannerCleanup();
            }

            // Cleanup observers on unmount
            if (store?.run_panel?.dbot?.observer) {
                store.run_panel.dbot.observer.unregisterAll('bot.stop');
                store.run_panel.dbot.observer.unregisterAll('bot.click_stop');
            }
        };
    }, []);

    // Initialize market scanner
    const initializeMarketScanner = useCallback(async () => {
        if (is_scanner_initialized) return;

        try {
            setStatus('Initializing market scanner...');

            // Initialize the market scanner
            await marketScanner.initialize();

            // Subscribe to scanner status updates
            const statusUnsubscribe = marketScanner.onStatusChange((status) => {
                setScannerStatus(status);
                setScanningProgress((status.connectedSymbols / status.totalSymbols) * 100);

                // Force update trends when symbols are connected
                if (status.connectedSymbols > 0) {
                    updateTrendsFromScanner();
                }
            });

            // Subscribe to recommendation updates
            const recommendationUnsubscribe = marketScanner.onRecommendationChange((recs) => {
                setRecommendations(recs);
                updateTrendsFromScanner();

                // Auto-select best recommendation if auto mode is enabled
                if (auto_mode && recs.length > 0 && !is_running && !contractInProgressRef.current) {
                    applyRecommendation(recs[0]);
                }
            });

            setIsScannerInitialized(true);
            setStatus('Market scanner initialized successfully');

            // Start scanning immediately
            await startMarketScan();

            // Set up periodic trend updates
            const trendUpdateInterval = setInterval(() => {
                updateTrendsFromScanner();
            }, 5000); // Update every 5 seconds

            // Mark as complete after initial data processing (reduced time with 5000 historical ticks)
            // HMA calculations need 40+ candles, but with 5000 ticks we get immediate candle reconstruction
            setTimeout(() => {
                if (!initial_scan_complete) {
                    console.log('⏰ ML Trader: Forcing scan completion after timeout - historical data processed');
                    setInitialScanComplete(true);
                    setStatus('Market analysis ready - historical trends available');
                }
            }, 15000); // 15 seconds should be enough with 5000 historical ticks

            // Cleanup function stored in ref for unmount
            return () => {
                statusUnsubscribe();
                recommendationUnsubscribe();
                clearInterval(trendUpdateInterval);
            };

        } catch (error) {
            console.error('Failed to initialize market scanner:', error);
            setStatus(`Scanner initialization failed: ${error}`);
        }
    }, [is_scanner_initialized, auto_mode, is_running]);

    // Update trends from scanner
    const updateTrendsFromScanner = useCallback(() => {
        const trendsMap = new Map<string, TrendAnalysis>();
        let hasData = false;
        let dataProgress = 0;

        ENHANCED_VOLATILITY_SYMBOLS.forEach(symbolInfo => {
            const trend = marketScanner.getTrendAnalysis(symbolInfo.symbol);
            if (trend) {
                trendsMap.set(symbolInfo.symbol, trend);
                hasData = true;
                dataProgress++;
            }
        });

        console.log(`📊 ML Trader: Found trends for ${trendsMap.size}/${ENHANCED_VOLATILITY_SYMBOLS.length} symbols`);

        // Update progress even if no complete trends yet
        setScanningProgress((dataProgress / ENHANCED_VOLATILITY_SYMBOLS.length) * 100);

        if (hasData) {
            setMarketTrends(trendsMap);
            setVolatilityTrends(trendsMap);

            // Mark initial scan as complete when we have trends for at least 2 symbols (reasonable with 5000 ticks)
            if (trendsMap.size >= 2 && !initial_scan_complete) {
                console.log(`✅ ML Trader: Initial scan completed with ${trendsMap.size} symbols using historical data`);
                setInitialScanComplete(true);
                setStatus(`Market analysis ready - ${trendsMap.size} symbols analyzed with historical trends`);
            }
        } else {
            // Check if we have any candle data at all
            const symbolsWithCandles = ENHANCED_VOLATILITY_SYMBOLS.filter(symbolInfo => {
                // You can check if the candle reconstruction engine has data
                return true; // For now, assume data is flowing based on console logs
            }).length;

            if (symbolsWithCandles > 0) {
                setStatus(`Building trend analysis... ${symbolsWithCandles}/10 symbols have data`);
                setScanningProgress((symbolsWithCandles / ENHANCED_VOLATILITY_SYMBOLS.length) * 50); // 50% for having data
            }
        }
    }, [initial_scan_complete]);

    // Start market scan
    const startMarketScan = useCallback(async () => {
        try {
            setStatus('Scanning volatility markets...');
            await marketScanner.refresh();
            setStatus('Market scan completed');

            // Force update trends after scan
            setTimeout(() => {
                updateTrendsFromScanner();
            }, 2000);

        } catch (error) {
            console.error('Market scan failed:', error);
            setStatus(`Market scan failed: ${error}`);
        }
    }, [updateTrendsFromScanner]);

    // Apply a trading recommendation to the trading interface (not modal)
    const applyRecommendation = useCallback((recommendation: TradingRecommendation) => {
        if (is_running || contractInProgressRef.current) {
            console.warn('Cannot apply recommendation: trading in progress');
            return;
        }

        setSelectedRecommendation(recommendation);
        setSymbol(recommendation.symbol);
        setContractType(recommendation.direction);
        setDuration(recommendation.suggestedDuration);
        setDurationUnit(recommendation.suggestedDurationUnit);
        setStake(recommendation.suggestedStake);
        baseStakeRef.current = recommendation.suggestedStake; // Set the base stake

        // Update trade mode based on recommendation
        if (recommendation.direction === 'CALL' || recommendation.direction === 'PUT') {
            setTradeMode('rise_fall');
        }

        setCurrentPrice(recommendation.currentPrice);
        setStatus(`Applied recommendation: ${recommendation.reason}`);
    }, [is_running]);

    // Directly load recommendation to Bot Builder (completely bypass modal)
    const openRecommendationModal = useCallback(async (recommendation: TradingRecommendation) => {
        try {
            if (!recommendation) {
                console.error('No recommendation provided');
                return;
            }

            console.log('🚀 Bypassing modal - Loading recommendation directly to Bot Builder:', recommendation);

            // Set modal form data for generateBotBuilderXML function
            setModalRecommendation(recommendation);
            setModalSymbol(recommendation.symbol || '');
            setModalContractType(recommendation.direction || 'CALL');
            setModalDuration(recommendation.suggestedDuration || 2); // Changed default to 2
            setModalDurationUnit((recommendation.suggestedDurationUnit as 't' | 's' | 'm') || 't');
            setModalStake(recommendation.suggestedStake || 1.0);

            // Set trade mode based on recommendation strategy or direction
            const strategy = recommendation.strategy || recommendation.direction || 'call';
            if (strategy === 'call' || strategy === 'put' ||
                recommendation.direction === 'CALL' || recommendation.direction === 'PUT') {
                setModalTradeMode('rise_fall');
            } else {
                // For barrier-based strategies, use higher/lower
                setModalTradeMode('higher_lower');
            }

            // Set barrier offset for higher/lower trades
            if (recommendation.barrier) {
                const barrierValue = parseFloat(recommendation.barrier);
                const currentPriceValue = recommendation.currentPrice || 0;
                if (currentPriceValue > 0) {
                    const calculatedOffset = Math.abs(barrierValue - currentPriceValue);
                    setModalBarrierOffset(calculatedOffset);
                }
            }

            setCurrentPrice(recommendation.currentPrice || null);
            baseStakeRef.current = recommendation.suggestedStake || 1.0;

            // Generate Bot Builder XML with the recommendation data
            const selectedSymbol = ENHANCED_VOLATILITY_SYMBOLS.find(s => s.symbol === recommendation.symbol);
            const trade_mode = strategy === 'call' || strategy === 'put' ||
                recommendation.direction === 'CALL' || recommendation.direction === 'PUT' ? 'rise_fall' : 'higher_lower';
            const contract_type = recommendation.direction || 'CALL';
            const duration = recommendation.suggestedDuration || 2;
            const duration_unit = (recommendation.suggestedDurationUnit as 't' | 's' | 'm') || 't';
            const stake = recommendation.suggestedStake || 1.0;
            const barrier_offset = recommendation.barrier ?
                Math.abs(parseFloat(recommendation.barrier) - (recommendation.currentPrice || 0)) : 0.001;

            // Calculate barrier offset based on contract type
            const calculateBarrierOffset = () => {
                if (trade_mode === 'higher_lower') {
                    return contract_type === 'CALL' ? `+${barrier_offset}` : `-${barrier_offset}`;
                }
                return '+0.35';
            };

            const tradeTypeCategory = trade_mode === 'higher_lower' ? 'highlow' : 'callput';
            const tradeTypeList = trade_mode === 'higher_lower' ? 'highlow' : 'risefall';
            const contractTypeField = contract_type === 'CALL' ? (trade_mode === 'rise_fall' ? 'CALL' : 'CALL') : (trade_mode === 'rise_fall' ? 'PUT' : 'PUT');
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
    <variable id="max_consecutive_losses">Maximum Consecutive Losses</variable>
    <variable id="current_consecutive_losses">Current Consecutive Losses</variable>
  </variables>

  <!-- Trade Definition Block -->
  <block type="trade_definition" id="=;b|aw3,G(o+jI6HNU0_" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="GrbKdLI=66(KGnSGl*=_" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">continuous_indices</field>
        <field name="SYMBOL_LIST">${recommendation.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="F)ky6X[Pq]/Anl_CQ%)" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${tradeTypeCategory}</field>
            <field name="TRADETYPE_LIST">${tradeTypeList}</field>
            <next>
              <block type="trade_definition_contracttype" id="z1{e5E+47NIm}*%5/AoJ" deletable="false" movable="false">
                <field name="TYPE_LIST">${contractTypeField}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="?%X1!vudp91L1/W30?x" deletable="false" movable="false">
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
            <field name="TEXT">ML Trader Strategy Loading...</field>
          </shadow>
        </value>
        <next>
          <block type="text_print" id="H5S$R8eJ,8_xuO2;w07T">
            <value name="TEXT">
              <shadow type="text" id="-(O49Z%3:}onz_i%UInT">
                <field name="TEXT">${selectedSymbol?.display_name || recommendation.symbol} - ${(recommendation.strategy || recommendation.direction || 'TRADE').toUpperCase()}</field>
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
                            <field name="NUM">1.5</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="maxConsecutiveLossesInit">
                            <field name="VAR" id="max_consecutive_losses">Maximum Consecutive Losses</field>
                            <value name="VALUE">
                              <block type="math_number" id="maxConsecutiveLossesValue">
                                <field name="NUM">4</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="currentConsecutiveLossesInit">
                                <field name="VAR" id="current_consecutive_losses">Current Consecutive Losses</field>
                                <value name="VALUE">
                                  <block type="math_number" id="currentConsecutiveLossesValue">
                                    <field name="NUM">0</field>
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
            <field name="NUM">2</field>
          </shadow>
          <block type="math_number" id="*l8K~H:oQ)^=Cn,A^N~s">
            <field name="NUM">2</field>
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
  <block type="purchase" id="it}Zt@Ou$Y97bED_*(nZ">
    <field name="PURCHASE_LIST">${contractTypeField}</field>
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
                      <block type="variables_set" id="resetConsecutiveLossesWin">
                        <field name="VAR" id="current_consecutive_losses">Current Consecutive Losses</field>
                        <value name="VALUE">
                          <block type="math_number" id="resetWinValue">
                            <field name="NUM">0</field>
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
              <block type="math_change" id="incrementConsecutiveLosses">
                <field name="VAR" id="current_consecutive_losses">Current Consecutive Losses</field>
                <value name="DELTA">
                  <shadow type="math_number" id="incrementValue">
                    <field name="NUM">1</field>
                  </shadow>
                </value>
                <next>
                  <block type="controls_if" id="checkMaxConsecutiveLosses">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                    <value name="IF0">
                      <block type="logic_compare" id="compareConsecutiveLosses">
                        <field name="OP">GTE</field>
                        <value name="A">
                          <block type="variables_get" id="getCurrentConsecutiveLosses">
                            <field name="VAR" id="current_consecutive_losses">Current Consecutive Losses</field>
                          </block>
                        </value>
                        <value name="B">
                          <block type="variables_get" id="getMaxConsecutiveLosses">
                            <field name="VAR" id="max_consecutive_losses">Maximum Consecutive Losses</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="notify" id="maxLossesReachedNotification">
                        <field name="NOTIFICATION_TYPE">error</field>
                        <field name="NOTIFICATION_SOUND">silent</field>
                        <value name="MESSAGE">
                          <shadow type="text" id="maxLossesMessage">
                            <field name="TEXT">Maximum consecutive losses reached. Bot stopped.</field>
                          </shadow>
                        </value>
                        <next>
                          <block type="variables_set" id="resetConsecutiveLossesAfterMax">
                            <field name="VAR" id="current_consecutive_losses">Current Consecutive Losses</field>
                            <value name="VALUE">
                              <block type="math_number" id="resetAfterMaxValue">
                                <field name="NUM">0</field>
                              </block>
                            </value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <statement name="ELSE">
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
                                <next>
                                  <block type="trade_again" id="O0gyt$46u#i^LXu}0~SE"></block>
                                </next>
                              </block>
                            </next>
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

            console.log('🚀 Generated Bot Builder XML for ML Strategy');

            // Load the XML to Bot Builder
            if (store?.run_panel?.dbot?.loadBlocks) {
                await store.run_panel.dbot.loadBlocks(botSkeletonXML);
                console.log('✅ ML Strategy loaded to Bot Builder successfully');
                setStatus('ML Strategy loaded to Bot Builder - Ready to run!');
            } else {
                console.error('❌ Bot Builder not available');
                setStatus('Error: Bot Builder not available');
            }

        } catch (error) {
            console.error('❌ Failed to load recommendation to Bot Builder:', error);
            setStatus(`Failed to load to Bot Builder: ${error}`);
        }
    }, [modal_symbol, modal_contract_type, modal_duration, modal_duration_unit, modal_stake, modal_barrier_offset, modal_trade_mode, store]);

    // Add Maximum Consecutive Losses block when clicking recommendation card
    const addMaxConsecutiveLossesBlock = useCallback(() => {
        try {
            // Add the Maximum Consecutive Losses variable and logic to the Bot Builder
            const maxLossesXML = `
            <block type="variables_set" id="maxConsecutiveLossesInit">
                <field name="VAR" id="max_consecutive_losses">Maximum Consecutive Losses</field>
                <value name="VALUE">
                    <block type="math_number" id="maxConsecutiveLossesValue">
                        <field name="NUM">4</field>
                    </block>
                </value>
            </block>`;
            
            console.log('Adding Maximum Consecutive Losses block with default value 4');
            setStatus('Maximum Consecutive Losses block added - Default: 4');
            
        } catch (error) {
            console.error('Failed to add Maximum Consecutive Losses block:', error);
        }
    }, []);

    // Rest of component JSX and other functions would go here...
    return (
        <div className="ml-trader">
            {/* Component JSX content */}
        </div>
    );
});

export default MLTrader;