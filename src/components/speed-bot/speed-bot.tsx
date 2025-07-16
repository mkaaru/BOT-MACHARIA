
import React, { useState, useEffect, useCallback } from 'react';
import { Localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import './speed-bot.scss';

const SpeedBot = () => {
  const { client } = useStore();
  const [isConnected, setIsConnected] = useState(false);
  const [isTrading, setIsTrading] = useState(false);
  const [isDirectTrading, setIsDirectTrading] = useState(false);
  const [isExecutingTrade, setIsExecutingTrade] = useState(false);
  const [balance, setBalance] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [lastTradeTime, setLastTradeTime] = useState(0);
  const [ws, setWs] = useState(null);
  const [currentProposal, setCurrentProposal] = useState(null);
  const [contractSubscriptions, setContractSubscriptions] = useState(new Set());

  const connectWebSocket = useCallback(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('🔗 WebSocket already connected');
      return;
    }

    const wsUrl = 'wss://ws.derivws.com/websockets/v3?app_id=75771';
    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('✅ WebSocket connected');
      setIsConnected(true);
      
      // Authorize with user token
      const token = client.getToken();
      if (token) {
        websocket.send(JSON.stringify({
          authorize: token,
          req_id: 'auth_1'
        }));
      }
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('📨 WebSocket message:', data);

      if (data.msg_type === 'authorize') {
        console.log('🔐 Authorization successful');
        setBalance(data.authorize.balance);
        
        // Subscribe to balance updates
        websocket.send(JSON.stringify({
          balance: 1,
          subscribe: 1,
          req_id: 'balance_sub'
        }));
      }

      if (data.msg_type === 'balance') {
        console.log('💰 Balance update:', data.balance.balance);
        setBalance(data.balance.balance);
      }

      if (data.msg_type === 'proposal') {
        console.log('💡 Proposal received:', data.proposal);
        setCurrentProposal(data.proposal);
        
        // If direct trading is enabled, buy immediately
        if (isDirectTrading && !isExecutingTrade) {
          console.log('🚀 Auto-buying proposal...');
          setIsExecutingTrade(true);
          
          websocket.send(JSON.stringify({
            buy: data.proposal.id,
            price: data.proposal.ask_price,
            req_id: `buy_${Date.now()}`
          }));
        }
      }

      if (data.msg_type === 'buy') {
        console.log('✅ Purchase successful:', data.buy);
        setIsExecutingTrade(false);
        
        if (data.buy.contract_id) {
          // Create trade record
          const trade = {
            id: data.buy.contract_id,
            time: new Date().toLocaleTimeString(),
            type: 'Even/Odd',
            stake: data.buy.buy_price,
            payout: data.buy.payout,
            profit: 0,
          };

          // Only add trade to history and increment counter if still trading
          if (isTrading) {
            setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);
            setTotalTrades(prev => {
              const newTotal = prev + 1;
              console.log(`📊 Total trades incremented to: ${newTotal}`);
              return newTotal;
            });
          } else {
            console.log('🛑 Trade completed but bot stopped - not counting');
          }
          setLastTradeTime(Date.now());

          // Subscribe to contract updates
          websocket.send(JSON.stringify({
            proposal_open_contract: 1,
            contract_id: data.buy.contract_id,
            subscribe: 1,
            req_id: `contract_${data.buy.contract_id}`
          }));

          setContractSubscriptions(prev => new Set(prev).add(data.buy.contract_id));
        }

        // Get next proposal for continuous trading
        if (isTrading && isDirectTrading) {
          setTimeout(() => {
            if (isTrading && isDirectTrading && !isExecutingTrade) {
              console.log('🔄 Getting next proposal for continuous trading...');
              getPriceProposal();
            } else {
              console.log('🛑 Not getting next proposal - trading stopped or executing');
            }
          }, 500);
        } else {
          console.log('🛑 Not getting next proposal - trading or direct trading stopped');
        }
      }

      if (data.msg_type === 'proposal_open_contract') {
        console.log('📋 Contract update:', data.proposal_open_contract);
        
        const contract = data.proposal_open_contract;
        if (contract.is_sold) {
          const profit = contract.profit;
          console.log(`💰 Contract closed with profit: ${profit}`);
          
          // Update trade history with final profit
          setTradeHistory(prev => 
            prev.map(trade => 
              trade.id === contract.contract_id 
                ? { ...trade, profit }
                : trade
            )
          );
        }
      }
    };

    websocket.onclose = () => {
      console.log('🔴 WebSocket disconnected');
      setIsConnected(false);
      setWs(null);
    };

    websocket.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      setIsConnected(false);
    };

    setWs(websocket);
  }, [client, isDirectTrading, isTrading, isExecutingTrade]);

  const getPriceProposal = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('🚫 WebSocket not connected');
      return;
    }

    console.log('💳 Getting price proposal...');
    ws.send(JSON.stringify({
      proposal: 1,
      amount: 1,
      basis: 'stake',
      contract_type: 'DIGITEVEN',
      currency: 'USD',
      symbol: 'R_100',
      req_id: `proposal_${Date.now()}`
    }));
  }, [ws]);

  const startTrading = useCallback(() => {
    console.log('🚀 Starting trading...');
    setIsTrading(true);
    setIsDirectTrading(true);
    
    if (!isConnected) {
      connectWebSocket();
    }
    
    // Get first proposal
    setTimeout(() => {
      if (isConnected) {
        getPriceProposal();
      }
    }, 1000);
  }, [isConnected, connectWebSocket, getPriceProposal]);

  const stopTrading = useCallback(() => {
    console.log('🛑 Stopping trading...');
    setIsTrading(false);
    setIsDirectTrading(false);
    setIsExecutingTrade(false);
    
    // Unsubscribe from all contract updates
    if (ws && ws.readyState === WebSocket.OPEN) {
      contractSubscriptions.forEach(contractId => {
        ws.send(JSON.stringify({
          forget: `contract_${contractId}`,
          req_id: `forget_${contractId}`
        }));
      });
    }
    
    setContractSubscriptions(new Set());
    setCurrentProposal(null);
    
    // Close WebSocket connection
    if (ws) {
      ws.close();
    }
  }, [ws, contractSubscriptions]);

  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  // Sync balance with client store periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (client && client.balance) {
        setBalance(client.balance.balance);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [client]);

  return (
    <div className="speed-bot">
      <div className="speed-bot__header">
        <h2><Localize i18n_default_text="Speed Bot" /></h2>
        <div className="speed-bot__status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="speed-bot__content">
        <div className="speed-bot__controls">
          <div className="control-group">
            <button
              className={`btn ${isTrading ? 'btn-danger' : 'btn-success'}`}
              onClick={isTrading ? stopTrading : startTrading}
              disabled={!isConnected && !isTrading}
            >
              {isTrading ? 'Stop Trading' : 'Start Trading'}
            </button>
            
            <button
              className="btn btn-secondary"
              onClick={connectWebSocket}
              disabled={isConnected}
            >
              Connect
            </button>
          </div>
        </div>

        <div className="speed-bot__stats">
          <div className="stat-item">
            <label>Balance:</label>
            <span>${balance.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <label>Total Trades:</label>
            <span>{totalTrades}</span>
          </div>
          <div className="stat-item">
            <label>Status:</label>
            <span>{isTrading ? 'Trading' : 'Stopped'}</span>
          </div>
        </div>

        <div className="speed-bot__history">
          <h3>Trade History</h3>
          <div className="trade-list">
            {tradeHistory.length === 0 ? (
              <p>No trades yet</p>
            ) : (
              tradeHistory.map((trade, index) => (
                <div key={index} className="trade-item">
                  <span className="trade-time">{trade.time}</span>
                  <span className="trade-type">{trade.type}</span>
                  <span className="trade-stake">${trade.stake}</span>
                  <span className={`trade-profit ${trade.profit >= 0 ? 'profit' : 'loss'}`}>
                    {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpeedBot;
