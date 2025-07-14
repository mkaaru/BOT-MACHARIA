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
  const [autoTradingStatus, setAutoTradingStatus] = useState<Record<string, boolean>>({
    'rise-fall': false,
    'even-odd': false,
    'even-odd-2': false,
    'over-under': false,
    'over-under-2': false,
    'matches-differs': false,
  });

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
      let derivWs,reconnectTimeout;let tickHistory=[],currentSymbol="${selectedSymbol}",tickCount=${tickCount},decimalPlaces=2,overUnderBarrier=5,isInitialized=!1,reconnectAttempts=0,MAX_RECONNECT_ATTEMPTS=5;function startWebSocket(){if(console.log("🔌 Connecting to WebSocket API"),reconnectTimeout&&clearTimeout(reconnectTimeout),derivWs){try{derivWs.onclose=null,derivWs.close(),console.log("Closed existing connection")}catch(e){console.error("Error closing existing connection:",e)}derivWs=null}try{(derivWs=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=75771")).onopen=function(){console.log("✅ WebSocket connection established"),reconnectAttempts=0,notifyConnectionStatus("connected"),setTimeout(()=>{try{derivWs&&derivWs.readyState===WebSocket.OPEN&&(console.log("Sending authorization request"),derivWs.send(JSON.stringify({app_id:75771})),requestTickHistory())}catch(e){console.error("Error during init requests:",e)}},500)},derivWs.onmessage=function(e){try{let t=JSON.parse(e.data);if(t.error){console.error("❌ WebSocket API error:",t.error),notifyConnectionStatus("error",t.error.message);return}if(t.history)console.log(\`📊 Received history for \${currentSymbol}: \${t.history.prices.length} ticks\`),tickHistory=t.history.prices.map((e,o)=>({time:t.history.times[o],quote:parseFloat(e)})),detectDecimalPlaces(),updateUI();else if(t.tick){let e=parseFloat(t.tick.quote);tickHistory.push({time:t.tick.epoch,quote:e}),tickHistory.length>tickCount&&tickHistory.shift(),updateUI()}else t.ping&&derivWs.send(JSON.stringify({pong:1}))}catch(e){console.error("Error processing message:",e)}},derivWs.onerror=function(e){console.error("❌ WebSocket error:",e),notifyConnectionStatus("error","Connection error"),scheduleReconnect()},derivWs.onclose=function(e){console.log("🔄 WebSocket connection closed",e.code,e.reason),notifyConnectionStatus("disconnected"),scheduleReconnect()},window.derivWs=derivWs}catch(e){console.error("Failed to create WebSocket:",e),notifyConnectionStatus("error",e.message),scheduleReconnect()}}function scheduleReconnect(){if(++reconnectAttempts>5){console.log(\`⚠️ Maximum reconnection attempts (5) reached. Stopping attempts.\`),notifyConnectionStatus("error","Maximum reconnection attempts reached");return}let e=Math.min(1e3*Math.pow(1.5,reconnectAttempts-1),3e4);console.log(\`🔄 Scheduling reconnect attempt \${reconnectAttempts} in \${e}ms\`),reconnectTimeout=setTimeout(()=>{console.log(\`🔄 Attempting to reconnect (\${reconnectAttempts}/5)...\`),startWebSocket()},e)}function requestTickHistory(){let e={ticks_history:currentSymbol,count:tickCount,end:"latest",style:"ticks",subscribe:1};if(derivWs&&derivWs.readyState===WebSocket.OPEN){console.log(\`📡 Requesting tick history for \${currentSymbol} (\${tickCount} ticks)\`);try{derivWs.send(JSON.stringify(e))}catch(e){console.error("Error sending tick history request:",e),scheduleReconnect()}}else console.error("❌ WebSocket not ready to request history, readyState:",derivWs?derivWs.readyState:"undefined"),scheduleReconnect()}function updateSymbol(e){if(console.log(\`🔄 Updating symbol: \${currentSymbol} -> \${e}\`),currentSymbol===e&&derivWs&&derivWs.readyState===WebSocket.OPEN){console.log("Symbol unchanged, skipping reconnection");return}if(currentSymbol=e,tickHistory=[],derivWs&&derivWs.readyState===WebSocket.OPEN)try{console.log("Unsubscribing from current tick before changing symbol..."),derivWs.send(JSON.stringify({forget_all:"ticks"})),setTimeout(()=>requestTickHistory(),300)}catch(e){console.error("Error unsubscribing:",e),startWebSocket()}else startWebSocket()}function updateTickCount(e){if(console.log(\`🔄 Updating tick count: \${tickCount} -> \${e}\`),isNaN(e)||e<=0){console.error("Invalid tick count:",e);return}if(tickCount=e,tickHistory=[],derivWs&&derivWs.readyState===WebSocket.OPEN)try{console.log("Unsubscribing before changing tick count..."),derivWs.send(JSON.stringify({forget_all:"ticks"})),setTimeout(()=>requestTickHistory(),300)}catch(e){console.error("Error unsubscribing:",e),startWebSocket()}else startWebSocket()}function updateBarrier(e){console.log(\`🔄 Updating barrier: \${overUnderBarrier} -> \${e}\`),overUnderBarrier=e,updateUI()}function detectDecimalPlaces(){if(0!==tickHistory.length)decimalPlaces=Math.max(...tickHistory.map(e=>(e.quote.toString().split(".")[1]||"").length),2)}function getLastDigit(e){let t=e.toString().split(".")[1]||"";for(;t.length<decimalPlaces;)t+="0";return Number(t.slice(-1))}function getStatus(){return{connected:derivWs&&derivWs.readyState===WebSocket.OPEN,symbol:currentSymbol,tickCount:tickCount,dataAvailable:tickHistory.length>0,lastUpdate:Date.now()}}function notifyConnectionStatus(e,t=null){window.postMessage({type:"ANALYZER_CONNECTION_STATUS",status:e,error:t},"*")}function updateUI(){if(0===tickHistory.length){console.warn("⚠️ No tick history available for analysis");return}let e=tickHistory[tickHistory.length-1].quote.toFixed(decimalPlaces);window.postMessage({type:"PRICE_UPDATE",price:e,symbol:currentSymbol},"*"),sendAnalysisData()}function handleMessages(e){if(!e.data||"object"!=typeof e.data)return;let{type:t}=e.data;switch(t){case"UPDATE_SYMBOL":e.data.symbol&&(console.log("Received symbol update request:",e.data.symbol),updateSymbol(e.data.symbol));break;case"UPDATE_TICK_COUNT":let o=e.data.tickCount||e.data.count;o&&!isNaN(o)&&(console.log("Received tick count update request:",o),updateTickCount(parseInt(o,10)));break;case"UPDATE_BARRIER":e.data.barrier&&!isNaN(e.data.barrier)&&updateBarrier(parseInt(e.data.barrier,10));break;case"REQUEST_ANALYSIS":sendAnalysisData(e.data.strategyId);break;case"REQUEST_STATUS":window.postMessage({type:"ANALYZER_STATUS",status:getStatus()},"*")}}function sendAnalysisData(e=null){if(!tickHistory||0===tickHistory.length){console.warn("⚠️ No data available for analysis");return}try{let t=Array(10).fill(0);tickHistory.forEach(e=>{let o=getLastDigit(e.quote);t[o]++});let o=tickHistory.length,r=t.map(e=>(e/o*100).toFixed(2)),i=t.filter((e,t)=>t%2==0).reduce((e,t)=>e+t,0),n=t.filter((e,t)=>t%2!=0).reduce((e,t)=>e+t,0),s=(i/o*100).toFixed(2),a=(n/o*100).toFixed(2),c=0,l=0;for(let e=0;e<10;e++)e>=overUnderBarrier?c+=t[e]:l+=t[e];let d=(c/o*100).toFixed(2),u=(l/o*100).toFixed(2),y=tickHistory.slice(-10).map(e=>getLastDigit(e.quote)),g=y.map(e=>e%2==0?"E":"O"),p=y.map(e=>e>=overUnderBarrier?"O":"U"),b=1,k=y.length>0&&y[y.length-1]%2==0?"even":"odd";for(let e=y.length-2;e>=0;e--){let t=y[e]%2==0,o=y[e+1]%2==0;if(t===o)b++;else break}if(!e||"rise-fall"===e){let e=0,t=0;for(let o=1;o<tickHistory.length;o++)tickHistory[o].quote>tickHistory[o-1].quote?e++:tickHistory[o].quote<tickHistory[o-1].quote&&t++;let r=(e/(o-1)*100).toFixed(2),i=(t/(o-1)*100).toFixed(2);window.postMessage({type:"ANALYSIS_DATA",strategyId:"rise-fall",data:{recommendation:parseFloat(r)>55?"Rise":parseFloat(i)>55?"Fall":null,confidence:Math.max(parseFloat(r),parseFloat(i)).toFixed(2),riseRatio:r,fallRatio:i}},"*"),console.log(\`📊 Rise/Fall analysis sent: Rise=\${r}%, Fall=\${i}%\`)}if((!e||"even-odd"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"even-odd",data:{recommendation:parseFloat(s)>55?"Even":parseFloat(a)>55?"Odd":null,confidence:Math.max(parseFloat(s),parseFloat(a)).toFixed(2),evenProbability:s,oddProbability:a}},"*"),console.log(\`📊 Even/Odd analysis sent: Even=\${s}%, Odd=\${a}%\`)),(!e||"even-odd-2"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"even-odd-2",data:{evenProbability:s,oddProbability:a,actualDigits:y,evenOddPattern:g,streak:b,streakType:k}},"*"),console.log(\`📊 Even/Odd-2 analysis sent: Pattern=\${g.join("")}\`)),(!e||"over-under"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"over-under",data:{recommendation:d>55?"Over":u>55?"Under":null,confidence:Math.max(d,u).toFixed(2),overProbability:d,underProbability:u,barrier:overUnderBarrier}},"*"),console.log(\`📊 Over/Under analysis sent: Over=\${d}%, Under=\${u}%, Barrier=\${overUnderBarrier}\`)),(!e||"over-under-2"===e)&&(window.postMessage({type:"ANALYSIS_DATA",strategyId:"over-under-2",data:{overProbability:d,underProbability:u,actualDigits:y,overUnderPattern:p,barrier:overUnderBarrier,digitPercentages:r}},"*"),console.log(\`📊 Over/Under-2 analysis sent: Pattern=\${p.join("")}\`)),!e||"matches-differs"===e){let e=0,r=0;t.forEach((t,o)=>{t>e&&(e=t,r=o)});let i=(e/o*100).toFixed(2),n=t.map((e,t)=>({digit:t,percentage:(e/o*100).toFixed(2),count:e})),s=tickHistory&&tickHistory.length>0?getLastDigit(tickHistory[tickHistory.length-1].quote):void 0;window.postMessage({type:"ANALYSIS_DATA",strategyId:"matches-differs",data:{recommendation:parseFloat(i)>15?"Matches":"Differs",confidence:(parseFloat(i)>15?parseFloat(i):100-parseFloat(i)).toFixed(2),target:r,mostFrequentProbability:i,digitFrequencies:n,currentLastDigit:s,totalTicks:o}},"*"),console.log(\`📊 Matches/Differs analysis sent: Target=\${r}, Current=\${s}, Probability=\${i}%\`)}catch(e){console.error("❌ Error in sendAnalysisData:",e)}}window.initVolatilityAnalyzer=function(){!isInitialized&&(isInitialized=!0,console.log("🚀 Initializing volatility analyzer"),startWebSocket(),window.addEventListener("message",handleMessages),window.volatilityAnalyzer={updateSymbol:updateSymbol,updateTickCount:updateTickCount,updateBarrier:updateBarrier,getStatus:getStatus,reconnect:startWebSocket},window.derivWs=derivWs,window.tickHistory=tickHistory,window.getLastDigit=getLastDigit,window.updateUI=updateUI,window.updateSymbol=updateSymbol,window.updateTickCount=updateTickCount,window.decimalPlaces=decimalPlaces,window.currentSymbol=currentSymbol)},window.initVolatilityAnalyzer();
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

  // Trading state
  const [stakeAmount, setStakeAmount] = useState(0.5);
  const [ticksAmount, setTicksAmount] = useState(1);
  const [martingaleAmount, setMartingaleAmount] = useState(1);
  const [tradingConditions, setTradingConditions] = useState<Record<string, any>>({
    'rise-fall': { condition: 'Rise Prob', operator: '>', value: 55 },
    'even-odd': { condition: 'Even Prob', operator: '>', value: 55 },
    'even-odd-2': { condition: 'Even Prob', operator: '>', value: 55 },
    'over-under': { condition: 'Over Prob', operator: '>', value: 55 },
    'over-under-2': { condition: 'Over Prob', operator: '>', value: 55 },
    'matches-differs': { condition: 'Matches Prob', operator: '>', value: 55 },
  });

  const executeTrade = (strategyId: string, tradeType: string) => {
    console.log(`Executing ${tradeType} trade for ${strategyId}`);
    // Here you would implement the actual trading logic
    // This is a placeholder for the trade execution
  };

  const renderProgressBar = (label: string, percentage: number, color: string) => (
    <div className="progress-item">
      <div className="progress-label">
        <span>{label}</span>
        <span className="progress-percentage">{percentage}%</span>
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );

  const renderDigitPattern = (digits: number[], type: string = 'even-odd', barrier?: number) => {
    if (!digits || digits.length === 0) return null;

    const getPatternClass = (digit: number) => {
      if (type === 'even-odd') {
        return digit % 2 === 0 ? 'even' : 'odd';
      } else if (type === 'over-under' && barrier !== undefined) {
        return digit >= barrier ? 'over' : 'under';
      }
      return 'neutral';
    };

    const getPatternText = (digit: number) => {
      if (type === 'even-odd') {
        return digit % 2 === 0 ? 'E' : 'O';
      } else if (type === 'over-under' && barrier !== undefined) {
        return digit >= barrier ? 'O' : 'U';
      }
      return digit.toString();
    };

    return (
      <div className="digit-pattern">
        <div className="pattern-label">Last Digits Pattern:</div>
        <div className="pattern-grid">
          {digits.slice(-10).map((digit, index) => (
            <div key={index} className={`digit-item ${getPatternClass(digit)}`}>
              {digit}
            </div>
          ))}
        </div>
        <div className="pattern-info">
          Recent digit pattern: {digits.slice(-5).map(digit => getPatternText(digit)).join('')}
        </div>
      </div>
    );
  };

  const renderDigitFrequencies = (frequencies: any[]) => {
    if (!frequencies) return null;

    return (
      <div className="digit-frequencies">
        <div className="frequency-label">Digit Frequency Distribution</div>
        <div className="frequency-grid">
          {frequencies.map((freq, index) => (
            <div key={index} className="frequency-item">
              <div className="frequency-digit">{freq.digit}</div>
              <div className="frequency-bar">
                <div 
                  className="frequency-fill" 
                  style={{ height: `${freq.percentage}%` }}
                />
              </div>
              <div className="frequency-percent">{freq.percentage}%</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTradingCard = (title: string, strategyId: string) => {
    const data = analysisData[strategyId];
    const condition = tradingConditions[strategyId];

    const getConditionOptions = (strategyId: string) => {
      switch (strategyId) {
        case 'rise-fall':
          return [
            { value: 'Rise Prob', label: 'Rise Prob' },
            { value: 'Fall Prob', label: 'Fall Prob' }
          ];
        case 'even-odd':
        case 'even-odd-2':
          return [
            { value: 'Even Prob', label: 'Even Prob' },
            { value: 'Odd Prob', label: 'Odd Prob' }
          ];
        case 'over-under':
        case 'over-under-2':
          return [
            { value: 'Over Prob', label: 'Over Prob' },
            { value: 'Under Prob', label: 'Under Prob' }
          ];
        case 'matches-differs':
          return [
            { value: 'Matches Prob', label: 'Matches Prob' },
            { value: 'Differs Prob', label: 'Differs Prob' }
          ];
        default:
          return [{ value: 'Even Prob', label: 'Even Prob' }];
      }
    };

    const getTradeOptions = (strategyId: string) => {
      switch (strategyId) {
        case 'rise-fall':
          return [
            { value: 'Buy Rise', label: 'Buy Rise' },
            { value: 'Buy Fall', label: 'Buy Fall' }
          ];
        case 'even-odd':
        case 'even-odd-2':
          return [
            { value: 'Buy Even', label: 'Buy Even' },
            { value: 'Buy Odd', label: 'Buy Odd' }
          ];
        case 'over-under':
        case 'over-under-2':
          return [
            { value: 'Buy Over', label: 'Buy Over' },
            { value: 'Buy Under', label: 'Buy Under' }
          ];
        case 'matches-differs':
          return [
            { value: 'Buy Matches', label: 'Buy Matches' },
            { value: 'Buy Differs', label: 'Buy Differs' }
          ];
        default:
          return [{ value: 'Buy Even', label: 'Buy Even' }];
      }
    };

    const conditionOptions = getConditionOptions(strategyId);
    const tradeOptions = getTradeOptions(strategyId);

    return (
      <div className="trading-card" key={strategyId}>
        <div className="card-header">
          <h3>{title}</h3>
        </div>

        <div className="card-content">
          {/* Rise/Fall Card */}
          {strategyId === 'rise-fall' && data?.data && (
            <>
              {renderProgressBar('Rise', parseFloat(data.data.riseRatio || '0'), '#4CAF50')}
              {renderProgressBar('Fall', parseFloat(data.data.fallRatio || '0'), '#F44336')}
            </>
          )}

          {/* Even/Odd Card */}
          {strategyId === 'even-odd' && data?.data && (
            <>
              {renderProgressBar('Even', parseFloat(data.data.evenProbability || '0'), '#4CAF50')}
              {renderProgressBar('Odd', parseFloat(data.data.oddProbability || '0'), '#F44336')}
            </>
          )}

          {/* Even/Odd 2 Card with Pattern */}
          {strategyId === 'even-odd-2' && data?.data && (
            <>
              {renderProgressBar('Even', parseFloat(data.data.evenProbability || '0'), '#4CAF50')}
              {renderProgressBar('Odd', parseFloat(data.data.oddProbability || '0'), '#F44336')}
              {data.data.actualDigits && renderDigitPattern(data.data.actualDigits, 'even-odd')}
              {data.data.streak && (
                <div className="streak-info">
                  Current streak: {data.data.streak} {data.data.streakType}
                </div>
              )}
            </>
          )}

          {/* Over/Under Card */}
          {strategyId === 'over-under' && data?.data && (
            <>
              <div className="barrier-info">Barrier: {data.data.barrier}</div>
              {renderProgressBar('Over', parseFloat(data.data.overProbability || '0'), '#2196F3')}
              {renderProgressBar('Under', parseFloat(data.data.underProbability || '0'), '#FF9800')}
            </>
          )}

          {/* Over/Under 2 Card with Pattern */}
          {strategyId === 'over-under-2' && data?.data && (
            <>
              <div className="barrier-info">Barrier: {data.data.barrier}</div>
              {renderProgressBar('Over', parseFloat(data.data.overProbability || '0'), '#2196F3')}
              {renderProgressBar('Under', parseFloat(data.data.underProbability || '0'), '#FF9800')}
              {data.data.actualDigits && renderDigitPattern(data.data.actualDigits, 'over-under', data.data.barrier)}
              {data.data.digitPercentages && renderDigitFrequencies(data.data.digitFrequencies)}
            </>
          )}

          {/* Matches/Differs Card */}
          {strategyId === 'matches-differs' && data?.data && (
            <>
              <div className="most-frequent">Most frequent: {data.data.target} ({data.data.mostFrequentProbability}%)</div>
              {renderProgressBar('Matches', parseFloat(data.data.mostFrequentProbability || '0'), '#4CAF50')}
              {renderProgressBar('Differs', (100 - parseFloat(data.data.mostFrequentProbability || '0')), '#F44336')}
              <div className="barrier-note">Barrier digit {data.data.target} appears {data.data.mostFrequentProbability}% of the time</div>
              {data.data.digitFrequencies && renderDigitFrequencies(data.data.digitFrequencies)}
            </>
          )}

          {/* Trading Condition */}
          <div className="trading-condition">
            <div className="condition-header">Trading Condition</div>
            <div className="condition-row">
              <span>If</span>
              <select 
                value={condition.condition}
                onChange={(e) => setTradingConditions(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], condition: e.target.value }
                }))}
              >
                {conditionOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select 
                value={condition.operator}
                onChange={(e) => setTradingConditions(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], operator: e.target.value }
                }))}
              >
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value="=">=</option>
              </select>
              <input 
                type="number" 
                value={condition.value}
                onChange={(e) => setTradingConditions(prev => ({
                  ...prev,
                  [strategyId]: { ...prev[strategyId], value: parseFloat(e.target.value) }
                }))}
              />
              <span>%</span>
            </div>
            <div className="condition-row">
              <span>Then</span>
              <select defaultValue={tradeOptions[0].value}>
                {tradeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Trading Controls */}
          <div className="trading-controls">
            <div className="control-group">
              <label>Stake</label>
              <input 
                type="number" 
                value={stakeAmount}
                onChange={(e) => setStakeAmount(parseFloat(e.target.value))}
                step="0.1"
                min="0.1"
              />
            </div>
            <div className="control-group">
              <label>Ticks</label>
              <input 
                type="number" 
                value={ticksAmount}
                onChange={(e) => setTicksAmount(parseInt(e.target.value))}
                min="1"
              />
            </div>
            <div className="control-group">
              <label>Martingale</label>
              <input 
                type="number" 
                value={martingaleAmount}
                onChange={(e) => setMartingaleAmount(parseFloat(e.target.value))}
                step="0.1"
                min="1"
              />
            </div>
          </div>
        </div>

        <div className="card-footer">
          <button 
            className="start-trading-btn"
            onClick={() => executeTrade(strategyId, 'auto')}
            disabled={!isConnected}
          >
            Start Auto Trading
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="volatility-analyzer">
      <div className="analyzer-header">
        <h2>Smart Trading Analytics</h2>
        <div className={`connection-status ${connectionStatus.status}`}>
          {connectionStatus.status === 'connected' && '🟢 Connected'}
          {connectionStatus.status === 'disconnected' && '🔴 Disconnected'}
          {connectionStatus.status === 'error' && '⚠️ Error'}
        </div>
      </div>

      <div className="analyzer-controls">
        <div className="control-group">
          <label>Symbol:</label>
          <select
            value={selectedSymbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
          >
            {volatilitySymbols.map((symbol) => (
              <option key={symbol.value} value={symbol.value}>
                {symbol.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Tick Count:</label>
          <input
            type="number"
            min="10"
            max="1000"
            value={tickCount}
            onChange={(e) => handleTickCountChange(parseInt(e.target.value))}
          />
        </div>
      </div>

      <div className="trading-cards-grid">
        {renderTradingCard('Rise/Fall', 'rise-fall')}
        {renderTradingCard('Even/Odd', 'even-odd')}
        {renderTradingCard('Even/Odd Pattern', 'even-odd-2')}
        {renderTradingCard('Over/Under', 'over-under')}
        {renderTradingCard('Over/Under Pattern', 'over-under-2')}
        {renderTradingCard('Matches/Differs', 'matches-differs')}
      </div>
    </div>
  );
};

export default VolatilityAnalyzer;