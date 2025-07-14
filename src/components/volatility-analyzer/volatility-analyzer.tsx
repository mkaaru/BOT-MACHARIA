import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import './volatility-analyzer.scss';

interface AnalysisData {
  strategyId: string;
  data: {
    recommendation?: string;
    confidence?: string;
    evenProbability?: string;
    oddProbability?: string;
    overProbability?: string;
    underProbability?: string;
    riseRatio?: string;
    fallRatio?: string;
    target?: number;
    mostFrequentProbability?: string;
    barrier?: number;
    actualDigits?: number[];
    evenOddPattern?: string[];
    overUnderPattern?: string[];
    streak?: number;
    streakType?: string;
    digitFrequencies?: Array<{digit: number; percentage: string; count: number}>;
    currentLastDigit?: number;
    totalTicks?: number;
  };
}

interface ConnectionStatus {
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
}

const VolatilityAnalyzer: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');
  const [currentPrice, setCurrentPrice] = useState<string>('---');
  const [tickCount, setTickCount] = useState(120);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ status: 'disconnected' });
  const [analysisData, setAnalysisData] = useState<Record<string, AnalysisData>>({});
  const [isConnected, setIsConnected] = useState(false);

  const volatilitySymbols = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
  ];

  const initializeAnalyzer = useCallback(() => {
    const script = document.createElement('script');
    script.textContent = `
      let derivWs,reconnectTimeout;let tickHistory=[],currentSymbol="${selectedSymbol}",tickCount=${tickCount},decimalPlaces=2,overUnderBarrier=5,isInitialized=!1,reconnectAttempts=0,MAX_RECONNECT_ATTEMPTS=5;function startWebSocket(){if(console.log("🔌 Connecting to WebSocket API"),reconnectTimeout&&clearTimeout(reconnectTimeout),derivWs){try{derivWs.onclose=null,derivWs.close(),console.log("Closed existing connection")}catch(e){console.error("Error closing existing connection:",e)}derivWs=null}try{(derivWs=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=75771")).onopen=function(){console.log("✅ WebSocket connection established"),reconnectAttempts=0,notifyConnectionStatus("connected"),setTimeout(()=>{try{derivWs&&derivWs.readyState===WebSocket.OPEN&&(console.log("Sending authorization request"),derivWs.send(JSON.stringify({app_id:75771})),requestTickHistory())}catch(e){console.error("Error during init requests:",e)}},500)},derivWs.onmessage=function(e){try{let t=JSON.parse(e.data);if(t.error){console.error("❌ WebSocket API error:",t.error),notifyConnectionStatus("error",t.error.message);return}if(t.history)console.log(\`📊 Received history for \${currentSymbol}: \${t.history.prices.length} ticks\`),tickHistory=t.history.prices.map((e,o)=>({time:t.history.times[o],quote:parseFloat(e)})),detectDecimalPlaces(),updateUI();else if(t.tick){let e=parseFloat(t.tick.quote);tickHistory.push({time:t.tick.epoch,quote:e}),tickHistory.length>tickCount&&tickHistory.shift(),updateUI()}else t.ping&&derivWs.send(JSON.stringify({pong:1}))}catch(e){console.error("Error processing message:",e)}},derivWs.onerror=function(e){console.error("❌ WebSocket error:",e),notifyConnectionStatus("error","Connection error"),scheduleReconnect()},derivWs.onclose=function(e){console.log("🔄 WebSocket connection closed",e.code,e.reason),notifyConnectionStatus("disconnected"),scheduleReconnect()},window.derivWs=derivWs}catch(e){console.error("Failed to create WebSocket:",e),notifyConnectionStatus("error",e.message),scheduleReconnect()}}function scheduleReconnect(){if(++reconnectAttempts>5){console.log(\`⚠️ Maximum reconnection attempts (5) reached. Stopping attempts.\`),notifyConnectionStatus("error","Maximum reconnection attempts reached");return}let e=Math.min(1e3*Math.pow(1.5,reconnectAttempts-1),3e4);console.log(\`🔄 Scheduling reconnect attempt \${reconnectAttempts} in \${e}ms\`),reconnectTimeout=setTimeout(()=>{console.log(\`🔄 Attempting to reconnect (\${reconnectAttempts}/5)...\`),startWebSocket()},e)}function requestTickHistory(){let e={ticks_history:currentSymbol,count:tickCount,end:"latest",style:"ticks",subscribe:1};if(derivWs&&derivWs.readyState===WebSocket.OPEN){console.log(\`📡 Requesting tick history for \${currentSymbol} (\${tickCount} ticks)\`);try{derivWs.send(JSON.stringify(e))}catch(e){console.error("Error sending tick history request:",e),scheduleReconnect()}}else console.error("❌ WebSocket not ready to request history, readyState:",derivWs?derivWs.readyState:"undefined"),scheduleReconnect()}function updateSymbol(e){if(console.log(\`🔄 Updating symbol: \${currentSymbol} -> \${e}\`),currentSymbol===e&&derivWs&&derivWs.readyState===WebSocket.OPEN){console.log("Symbol unchanged, skipping reconnection");return}if(currentSymbol=e,tickHistory=[],derivWs&&derivWs.readyState===WebSocket.OPEN)try{console.log("Unsubscribing from current tick before changing symbol..."),derivWs.send(JSON.stringify({forget_all:"ticks"})),setTimeout(()=>requestTickHistory(),300)}catch(e){console.error("Error unsubscribing:",e),startWebSocket()}else startWebSocket()}function updateTickCount(e){if(console.log(\`🔄 Updating tick count: \${tickCount} -> \${e}\`),isNaN(e)||e<=0){console.error("Invalid tick count:",e);return}if(tickCount=e,tickHistory=[],derivWs&&derivWs.readyState===WebSocket.OPEN)try{console.log("Unsubscribing before changing tick count..."),derivWs.send(JSON.stringify({forget_all:"ticks"})),setTimeout(()=>requestTickHistory(),300)}catch(e){console.error("Error unsubscribing:",e),startWebSocket()}else startWebSocket()}function updateBarrier(e){console.log(\`🔄 Updating barrier: \${overUnderBarrier} -> \${e}\`),overUnderBarrier=e,updateUI()}function detectDecimalPlaces(){if(0!==tickHistory.length)decimalPlaces=Math.max(...tickHistory.map(e=>(e.quote.toString().split(".")[1]||"").length),2)}function getLastDigit(e){let t=e.toString().split(".")[1]||"";for(;t.length<decimalPlaces;)t+="0";return Number(t.slice(-1))}function getStatus(){return{connected:derivWs&&derivWs.readyState===WebSocket.OPEN,symbol:currentSymbol,tickCount:tickCount,dataAvailable:tickHistory.length>0,lastUpdate:Date.now()}}function notifyConnectionStatus(e,t=null){window.postMessage({type:"ANALYZER_CONNECTION_STATUS",status:e,error:t},"*")}function updateUI(){if(0===tickHistory.length){console.warn("⚠️ No tick history available for analysis");return}let e=tickHistory[tickHistory.length-1].quote.toFixed(decimalPlaces);window.postMessage({type:"PRICE_UPDATE",price:e,symbol:currentSymbol},"*"),sendAnalysisData()}function handleMessages(e){if(!e.data||"object"!=typeof e.data)return;let{type:t}=e.data;switch(t){case"UPDATE_SYMBOL":e.data.symbol&&(console.log("Received symbol update request:",e.data.symbol),updateSymbol(e.data.symbol));break;case"UPDATE_TICK_COUNT":let o=e.data.tickCount||e.data.count;o&&!isNaN(o)&&(console.log("Received tick count update request:",o),updateTickCount(parseInt(o,10)));break;case"UPDATE_BARRIER":e.data.barrier&&!isNaN(e.data.barrier)&&updateBarrier(parseInt(e.data.barrier,10));break;case"REQUEST_ANALYSIS":sendAnalysisData(e.data.strategyId);break;case"REQUEST_STATUS":window.postMessage({type:"ANALYZER_STATUS",status:getStatus()},"*")}}function sendAnalysisData(e=null){if(!tickHistory||0===tickHistory.length){console.warn("⚠️ No data available for analysis");return}try{let t=Array(10).fill(0);tickHistory.forEach(e=>{let o=getLastDigit(e.quote);t[o]++});let o=tickHistory.length,r=t.map(e=>(e/o*100).toFixed(2)),i=t.filter((e,t)=>t%2==0).reduce((e,t)=>e+t,0),n=t.filter((e,t)=>t%2!=0).reduce((e,t)=>e+t,0),s=(i/o*100).toFixed(2),a=(n/o*100).toFixed(2),c=0,l=0;for(let e=0;e<10;e++)e>=overUnderBarrier?c+=t[e]:l+=t[e];let d=(c/o*100).toFixed(2),u=(l/o*100).toFixed(2),y=tickHistory.slice(-10).map(e=>getLastDigit(e.quote)),g=y.map(e=>e%2==0?"E":"O"),p=y.map(e=>e>=overUnderBarrier?"O":"U"),b=1,k=y.length>0&&y[y.length-1]%2==0?"even":"odd";for(let e=y.length-2;e>=0;e--){let t=y[e]%2==0,o=y[e+1]%2==0;if(t===o)b++;else break}if(!e||"rise-fall"===e){let e=0,t=0;for(let o=1;o<tickHistory.length;o++)tickHistory[o].quote>tickHistory[o-1].quote?e++:tickHistory[o].quote<tickHistory[o-1].quote&&t++;let r=(e/(o-1)*100).toFixed(2),i=(t/(o-1)*100).toFixed(2);window.postMessage({type:"ANALYSIS_DATA",strategyId:"rise-fall",data:{recommendation:parseFloat(r)>55?"Rise":parseFloat(i)>55?"Fall":null,confidence:Math.max(parseFloat(r),parseFloat(i)).toFixed(2),riseRatio:r,fallRatio:i}},"*"),console.log(\`📊 Rise/Fall analysis sent: Rise=\${r}%, Fall=\${i}%\`)}if((!e||"even-odd"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"even-odd",data:{recommendation:parseFloat(s)>55?"Even":parseFloat(a)>55?"Odd":null,confidence:Math.max(parseFloat(s),parseFloat(a)).toFixed(2),evenProbability:s,oddProbability:a}},"*"),console.log(\`📊 Even/Odd analysis sent: Even=\${s}%, Odd=\${a}%\`)),(!e||"even-odd-2"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"even-odd-2",data:{evenProbability:s,oddProbability:a,actualDigits:y,evenOddPattern:g,streak:b,streakType:k}},"*"),console.log(\`📊 Even/Odd-2 analysis sent: Pattern=\${g.join("")}\`)),(!e||"over-under"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"over-under",data:{recommendation:d>55?"Over":u>55?"Under":null,confidence:Math.max(d,u).toFixed(2),overProbability:d,underProbability:u,barrier:overUnderBarrier}},"*"),console.log(\`📊 Over/Under analysis sent: Over=\${d}%, Under=\${u}%, Barrier=\${overUnderBarrier}\`)),(!e||"over-under-2"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"over-under-2",data:{overProbability:d,underProbability:u,actualDigits:y,overUnderPattern:p,barrier:overUnderBarrier,digitPercentages:r}},"*"),console.log(\`📊 Over/Under-2 analysis sent: Pattern=\${p.join("")}\`)),!e||"matches-differs"===e){let e=0,r=0;t.forEach((t,o)=>{t>e&&(e=t,r=o)});let i=(e/o*100).toFixed(2),n=t.map((e,t)=>({digit:t,percentage:(e/o*100).toFixed(2),count:e})),s=tickHistory&&tickHistory.length>0?getLastDigit(tickHistory[tickHistory.length-1].quote):void 0;window.postMessage({type:"ANALYSIS_DATA",strategyId:"matches-differs",data:{recommendation:parseFloat(i)>15?"Matches":"Differs",confidence:(parseFloat(i)>15?parseFloat(i):100-parseFloat(i)).toFixed(2),target:r,mostFrequentProbability:i,digitFrequencies:n,currentLastDigit:s,totalTicks:o}},"*"),console.log(\`📊 Matches/Differs analysis sent: Target=\${r}, Current=\${s}, Probability=\${i}%\`)}}catch(e){console.error("❌ Error in sendAnalysisData:",e)}}window.initVolatilityAnalyzer=function(){!isInitialized&&(isInitialized=!0,console.log("🚀 Initializing volatility analyzer"),startWebSocket(),window.addEventListener("message",handleMessages),window.volatilityAnalyzer={updateSymbol:updateSymbol,updateTickCount:updateTickCount,updateBarrier:updateBarrier,getStatus:getStatus,reconnect:startWebSocket},window.derivWs=derivWs,window.tickHistory=tickHistory,window.getLastDigit=getLastDigit,window.updateUI=updateUI,window.updateSymbol=updateSymbol,window.updateTickCount=updateTickCount,window.decimalPlaces=decimalPlaces,window.currentSymbol=currentSymbol)},window.initVolatilityAnalyzer();
    `;
    document.head.appendChild(script);
  }, [selectedSymbol, tickCount]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      const { type } = event.data;

      switch (type) {
        case 'ANALYZER_CONNECTION_STATUS':
          setConnectionStatus({
            status: event.data.status,
            error: event.data.error,
          });
          setIsConnected(event.data.status === 'connected');
          break;

        case 'PRICE_UPDATE':
          setCurrentPrice(event.data.price);
          break;

        case 'ANALYSIS_DATA':
          setAnalysisData(prev => ({
            ...prev,
            [event.data.strategyId]: event.data,
          }));
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    initializeAnalyzer();

    return () => {
      window.removeEventListener('message', handleMessage);

      // Cleanup auto-trading intervals
      Object.keys(autoTradingStatus).forEach(strategyId => {
        if (window[`${strategyId}_interval`]) {
          clearInterval(window[`${strategyId}_interval`]);
          delete window[`${strategyId}_interval`];
        }
      });
    };
  }, [initializeAnalyzer]);

  const handleSymbolChange = (symbol: string) => {
    setSelectedSymbol(symbol);
    window.postMessage({ type: 'UPDATE_SYMBOL', symbol }, '*');
  };

  const handleTickCountChange = (count: number) => {
    setTickCount(count);
    window.postMessage({ type: 'UPDATE_TICK_COUNT', tickCount: count }, '*');
  };

  const getRecommendationColor = (recommendation?: string) => {
    if (!recommendation) return 'neutral';
    if (['Rise', 'Even', 'Over', 'Matches'].includes(recommendation)) return 'positive';
    if (['Fall', 'Odd', 'Under', 'Differs'].includes(recommendation)) return 'negative';
    return 'neutral';
  };

  const [autoTradingStatus, setAutoTradingStatus] = useState<Record<string, boolean>>({});
  const [stakeAmount, setStakeAmount] = useState(1.0);
  const [tradeResults, setTradeResults] = useState<Record<string, { wins: number; losses: number; profit: number }>>({});

  const executeAutoTrade = useCallback((strategyId: string, data: any) => {
    const currentStake = stakeAmount;
    const isWin = Math.random() > 0.45; // 55% win rate simulation
    const profit = isWin ? currentStake * 0.95 : -currentStake;

    setTradeResults(prev => ({
      ...prev,
      [strategyId]: {
        wins: (prev[strategyId]?.wins || 0) + (isWin ? 1 : 0),
        losses: (prev[strategyId]?.losses || 0) + (isWin ? 0 : 1),
        profit: (prev[strategyId]?.profit || 0) + profit
      }
    }));

    console.log(`${strategyId} trade executed: ${isWin ? 'WIN' : 'LOSS'}, P&L: ${profit.toFixed(2)}`);
  }, [stakeAmount]);

  const toggleAutoTrading = useCallback((strategyId: string) => {
    setAutoTradingStatus(prev => {
      const newStatus = !prev[strategyId];

      if (newStatus) {
        // Start auto trading
        const interval = setInterval(() => {
          const data = analysisData[strategyId];
          if (data?.data?.recommendation && data?.data?.confidence > 60) {
            executeAutoTrade(strategyId, data);
          }
        }, 5000); // Execute trade every 5 seconds if conditions are met

        // Store interval ID for cleanup
        window[`${strategyId}_interval`] = interval;
      } else {
        // Stop auto trading
        if (window[`${strategyId}_interval`]) {
          clearInterval(window[`${strategyId}_interval`]);
          delete window[`${strategyId}_interval`];
        }
      }

      return { ...prev, [strategyId]: newStatus };
    });
  }, [analysisData, executeAutoTrade]);

  const renderProgressBar = (percentage: number, color: string, label: string) => (
    <div className="progress-bar-container">
      <div className="progress-bar-label">
        <span>{label}</span>
        <span>{percentage}%</span>
      </div>
      <div className="progress-bar-track">
        <div 
          className="progress-bar-fill"
          style={{ 
            width: `${percentage}%`,
            backgroundColor: color,
            transition: 'width 0.3s ease-in-out'
          }}
        />
      </div>
    </div>
  );

  const renderLastDigitPattern = (digits: number[]) => {
    if (!digits || digits.length === 0) return null;

    return (
      <div className="last-digit-pattern">
        <div className="pattern-label">Last Digits Pattern:</div>
        <div className="pattern-sequence">
          {digits.slice(-10).map((digit, index) => (
            <div 
              key={index}
              className={`digit-box ${digit % 2 === 0 ? 'even' : 'odd'}`}
            >
              {digit}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Trading conditions state
  const [tradingConditions, setTradingConditions] = useState({
    'rise-fall': { condition: 'always' },
    'even-odd': { condition: 'above60' },
    'over-under': { condition: 'always' },
    'matches-differs': { condition: 'always' },
  });

  // Martingale settings state
    const [martingaleSettings, setMartingaleSettings] = useState({
    'rise-fall': { useMartingale: false, multiplier: 2 },
    'even-odd': { useMartingale: false, multiplier: 2 },
    'over-under': { useMartingale: false, multiplier: 2 },
    'matches-differs': { useMartingale: false, multiplier: 2 },
  });

    // Function to render trading conditions based on market type
    const renderTradingConditions = (strategyId: string) => {
    return (
      <div className="trading-conditions">
        <label>Trading Condition:</label>
        <select
          value={tradingConditions[strategyId]?.condition || 'always'}
          onChange={(e) => {
            setTradingConditions(prev => ({
              ...prev,
              [strategyId]: { ...prev[strategyId], condition: e.target.value },
            }));
          }}
        >
          <option value="always">Always</option>
          <option value="above60">Confidence Above 60%</option>
          {/* Add more conditions as needed */}
        </select>
      </div>
    );
  };

  // Function to render Martingale settings
  const renderMartingaleSettings = (strategyId: string) => {
    return (
      <div className="martingale-settings">
        <label>
          Use Martingale:
          <input
            type="checkbox"
            checked={martingaleSettings[strategyId]?.useMartingale || false}
            onChange={(e) => {
              setMartingaleSettings(prev => ({
                ...prev,
                [strategyId]: { ...prev[strategyId], useMartingale: e.target.checked },
              }));
            }}
          />
        </label>
        {martingaleSettings[strategyId]?.useMartingale && (
          <>
            <label>Multiplier:</label>
            <input
              type="number"
              value={martingaleSettings[strategyId]?.multiplier || 2}
              onChange={(e) => {
                const multiplier = parseFloat(e.target.value);
                setMartingaleSettings(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], multiplier: multiplier },
                }));
              }}
            />
          </>
        )}
      </div>
    );
  };

  const renderTradingCard = (title: string, strategyId: string) => {
    const data = analysisData[strategyId];
    const recommendation = data?.data?.recommendation;
    const confidence = data?.data?.confidence;
    const isAutoTrading = autoTradingStatus[strategyId];
    const results = tradeResults[strategyId];

    return (
      <div className="trading-card" key={strategyId}>
        <div className="trading-card__header">
          <h3 className="trading-card__title">{title}</h3>
          <div className={`trading-card__status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢' : '🔴'}
          </div>
        </div>

        <div className="trading-card__content">
          <div className="trading-card__price">
            <span className="trading-card__price-label">Current Price:</span>
            <span className="trading-card__price-value">{currentPrice}</span>
          </div>

          {recommendation && (
            <div className={`trading-card__recommendation ${getRecommendationColor(recommendation)}`}>
              <span className="trading-card__recommendation-label">Recommendation:</span>
              <span className="trading-card__recommendation-value">{recommendation}</span>
            </div>
          )}

          {confidence && (
            <div className="trading-card__confidence">
              <span className="trading-card__confidence-label">Confidence:</span>
              <span className="trading-card__confidence-value">{confidence}%</span>
            </div>
          )}

          {strategyId === 'even-odd' && data?.data && (
            <div className="trading-card__details">
              {renderProgressBar(parseFloat(data.data.evenProbability), '#22c55e', 'Even')}
              {renderProgressBar(parseFloat(data.data.oddProbability), '#ef4444', 'Odd')}
              {data.data.actualDigits && renderLastDigitPattern(data.data.actualDigits)}
            </div>
          )}

          {strategyId === 'over-under' && data?.data && (
            <div className="trading-card__details">
              {renderProgressBar(parseFloat(data.data.overProbability), '#3b82f6', 'Over')}
              {renderProgressBar(parseFloat(data.data.underProbability), '#f59e0b', 'Under')}
              <div className="barrier-info">Barrier: {data.data.barrier}</div>
              {data.data.actualDigits && renderLastDigitPattern(data.data.actualDigits)}
            </div>
          )}

          {strategyId === 'rise-fall' && data?.data && (
            <div className="trading-card__details">
              {renderProgressBar(parseFloat(data.data.riseRatio), '#22c55e', 'Rise')}
              {renderProgressBar(parseFloat(data.data.fallRatio), '#ef4444', 'Fall')}
            </div>
          )}

          {strategyId === 'matches-differs' && data?.data && (
            <div className="trading-card__details">
              <div className="target-info">
                <div>Target: {data.data.target}</div>
                <div>Current: {data.data.currentLastDigit}</div>
              </div>
              {renderProgressBar(parseFloat(data.data.mostFrequentProbability), '#8b5cf6', 'Match Probability')}
              {data.data.digitFrequencies && (
                <div className="digit-frequencies">
                  {data.data.digitFrequencies.map((freq, index) => (
                    <div key={index} className="freq-item">
                      <span>{freq.digit}: {freq.percentage}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {renderTradingConditions(strategyId)}
          {renderMartingaleSettings(strategyId)}

          {results && (
            <div className="trading-card__results">
              <div className="results-stats">
                <span>W: {results.wins}</span>
                <span>L: {results.losses}</span>
                <span className={results.profit >= 0 ? 'profit' : 'loss'}>
                  P&L: {results.profit >= 0 ? '+' : ''}{results.profit.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="trading-card__footer">
          <div className="stake-input">
            <label>Stake: </label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(parseFloat(e.target.value))}
              disabled={isAutoTrading}
            />
          </div>
          <button 
            className={`trading-card__button ${isAutoTrading ? 'trading-card__button--stop' : 'trading-card__button--start'}`}
            onClick={() => toggleAutoTrading(strategyId)}
            disabled={!isConnected || (recommendation && parseFloat(confidence) < 60)}
          >
            <Localize i18n_default_text={isAutoTrading ? "Stop Trading" : "Start Auto Trading"} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="volatility-analyzer">
      <div className="volatility-analyzer__header">
        <h2 className="volatility-analyzer__title">
          <Localize i18n_default_text="Smart Trading Analytics" />
        </h2>
        <div className={`volatility-analyzer__connection ${connectionStatus.status}`}>
          <span className="volatility-analyzer__connection-text">
            {connectionStatus.status === 'connected' && <Localize i18n_default_text="Connected" />}
            {connectionStatus.status === 'disconnected' && <Localize i18n_default_text="Disconnected" />}
            {connectionStatus.status === 'error' && <Localize i18n_default_text="Error" />}
          </span>
        </div>
      </div>

      <div className="volatility-analyzer__controls">
        <div className="volatility-analyzer__control-group">
          <label htmlFor="symbol-select">
            <Localize i18n_default_text="Symbol:" />
          </label>
          <select
            id="symbol-select"
            value={selectedSymbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
            className="volatility-analyzer__select"
          >
            {volatilitySymbols.map((symbol) => (
              <option key={symbol.value} value={symbol.value}>
                {symbol.label}
              </option>
            ))}
          </select>
        </div>

        <div className="volatility-analyzer__control-group">
          <label htmlFor="tick-count">
            <Localize i18n_default_text="Tick Count:" />
          </label>
          <input
            id="tick-count"
            type="number"
            min="10"
            max="1000"
            value={tickCount}
            onChange={(e) => handleTickCountChange(parseInt(e.target.value))}
            className="volatility-analyzer__input"
          />
        </div>
      </div>

      <div className="volatility-analyzer__cards">
        {renderTradingCard('Rise/Fall', 'rise-fall')}
        {renderTradingCard('Even/Odd', 'even-odd')}
        {renderTradingCard('Over/Under', 'over-under')}
        {renderTradingCard('Matches/Differs', 'matches-differs')}
      </div>
    </div>
  );
};

export default VolatilityAnalyzer;