// ==========================================
// 📁 app-features.js - বাকি সব ফাংশন (সিগন্যাল, স্ক্যানার, ট্রেড ইত্যাদি)
// ==========================================

import { 
    getBangladeshDateString, formatDisplayTime, getTodayDate,
    chunkArray, debounce, safeParseDate,
    getUnifiedPrice, getLatestAndPreviousPrices, dseStocks 
} from './core.js';

import {
    calculateSMA, calculateEMA, calculateRSI, calculateMACD,
    calculateBollingerBands, calculateStochastic, calculateATR,
    calculateParabolicSAR, arimaForecast,
    calculateAnchoredVWAP, calculateVolumeProfile, calculateFibonacci,
    calculateAroon, calculateIchimoku,
    cachedSMA, cachedEMA, cachedRSI, cachedMACD,
    cachedBollingerBands, cachedStochastic, cachedATR,
    cachedParabolicSAR, cachedAnchoredVWAP, cachedVolumeProfile,
    cachedFibonacci, cachedAroon, cachedIchimoku
} from './indicators.js';

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { unifiedEngine } from './app-dashboard.js'; import { showToast } from './app-charts.js';

// ==========================================
// 📌 SIGNAL FUNCTIONS
// ==========================================

let lastBuySignals = [];
let lastSellSignals = [];
let currentSignalMarket = 'all';
let currentSignalScanner = 'psar';

export async function loadSignalData() {
    const buyContainer = document.getElementById('buy-signal-list');
    const sellContainer = document.getElementById('sell-signal-list');
    const buyCount = document.getElementById('buy-signal-count');
    const sellCount = document.getElementById('sell-signal-count');
    const updateTime = document.getElementById('signal-update-time');

    if (!buyContainer || !sellContainer) return;

    buyContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">⏳ Loading...</div>`;
    sellContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">⏳ Loading...</div>`;

    try {
        const user = auth && auth.currentUser ? auth.currentUser : null;
        if (!user) {
            buyContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: red;">Please login first.</div>`;
            sellContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: red;">Please login first.</div>`;
            return;
        }

        let portfolioQtyMap = new Map();
        let portfolioStockDetails = [];
        try {
            const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
            if (unifiedData && unifiedData.stockDetails) {
                portfolioStockDetails = unifiedData.stockDetails;
                unifiedData.stockDetails.forEach(s => {
                    portfolioQtyMap.set(s.ticker, s.totalQty || 0);
                });
            }
        } catch (e) {
            console.warn('Could not fetch portfolio quantities:', e);
        }

        let targetTickers = [];
        if (currentSignalMarket === 'portfolio') {
            targetTickers = portfolioStockDetails.map(s => s.ticker);
        } else if (currentSignalMarket === 'watchlist') {
            try {
                const wl = localStorage.getItem('market_watch_list');
                targetTickers = wl ? JSON.parse(wl) : [];
            } catch (e) { targetTickers = []; }
        } else {
            targetTickers = dseStocks;
        }

        if (targetTickers.length === 0) {
            buyContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">No stocks found.</div>`;
            sellContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">No stocks found.</div>`;
            return;
        }

        const allResults = [];
        const batchSize = 10;

        for (let i = 0; i < targetTickers.length; i += batchSize) {
            const batch = targetTickers.slice(i, i + batchSize);
            const promises = batch.map(async (ticker) => {
                try {
                    const price = await getUnifiedPrice(ticker);
                    if (price <= 0) return null;

                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - 30);
                    const startDateStr = startDate.toISOString().split('T')[0];

                    let priceData = [];
                    
                    if (typeof supabase !== 'undefined' && supabase) {
                        try {
                            const { data, error } = await supabase
                                .from('history_dse')
                                .select('date, ltp, high, low')
                                .eq('ticker', ticker)
                                .gte('date', startDateStr)
                                .order('date', { ascending: true })
                                .limit(30);
                            if (!error && data && data.length > 0) {
                                priceData = data.map(d => ({
                                    date: d.date,
                                    ltp: parseFloat(d.ltp),
                                    high: parseFloat(d.high) || parseFloat(d.ltp),
                                    low: parseFloat(d.low) || parseFloat(d.ltp)
                                }));
                            }
                        } catch (e) { /* ignore */ }
                    }

                    if (priceData.length === 0 && typeof db !== 'undefined') {
                        try {
                            const snap = await db.collection('cse_detailed_data')
                                .where('code', '==', ticker)
                                .where('date', '>=', startDateStr)
                                .orderBy('date', 'asc')
                                .limit(30)
                                .get();
                            if (!snap.empty) {
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    const ltp = parseFloat(d.ltp);
                                    if (ltp > 0) {
                                        priceData.push({
                                            date: d.date,
                                            ltp: ltp,
                                            high: parseFloat(d.high) || ltp,
                                            low: parseFloat(d.low) || ltp
                                        });
                                    }
                                });
                            }
                        } catch (e) { /* ignore */ }
                    }

                    if (priceData.length < 15) return null;

                    const rsiData = calculateRSI(priceData.map(p => p.ltp), 14);
                    const lastRsi = rsiData.filter(r => r.rsi !== null).pop();
                    const rsi = lastRsi ? lastRsi.rsi : 50;

                    const psarData = calculateParabolicSAR(priceData);
                    const psar = psarData.length > 0 ? psarData[psarData.length - 1].sar : price;

                    let ath = 0, atl = Infinity;
                    for (const item of priceData) {
                        const ltp = item.ltp;
                        if (ltp > ath) ath = ltp;
                        if (ltp > 0 && ltp < atl) atl = ltp;
                        if (item.high > ath) ath = item.high;
                        if (item.low > 0 && item.low < atl) atl = item.low;
                    }
                    if (atl === Infinity) atl = price;

                    const remainingQty = portfolioQtyMap.get(ticker) || 0;

                    return {
                        ticker: ticker,
                        price: price,
                        rsi: rsi,
                        psar: psar,
                        ath: ath,
                        atl: atl,
                        remainingQty: remainingQty
                    };
                } catch (err) {
                    return null;
                }
            });

            const results = await Promise.all(promises);
            const valid = results.filter(r => r !== null);
            allResults.push(...valid);
        }

        // Buy signals
        let buySignals = [];
        if (currentSignalScanner === 'psar') {
            buySignals = allResults.filter(item => item.price > item.psar);
        } else if (currentSignalScanner === 'rsi') {
            buySignals = allResults.filter(item => item.rsi < 30);
        } else if (currentSignalScanner === 'all-scanner') {
            buySignals = allResults.filter(item => item.rsi < 30 && item.price > item.psar);
        }

        // Sell signals
        let sellSignals = [];
        if (currentSignalMarket === 'portfolio') {
            const portfolioTickers = portfolioStockDetails.map(s => s.ticker);
            sellSignals = allResults.filter(item => portfolioTickers.includes(item.ticker));
        } else {
            if (currentSignalScanner === 'psar') {
                sellSignals = allResults.filter(item => item.price < item.psar);
            } else if (currentSignalScanner === 'rsi') {
                sellSignals = allResults.filter(item => item.rsi > 70);
            } else if (currentSignalScanner === 'all-scanner') {
                sellSignals = allResults.filter(item => item.rsi > 70 && item.price < item.psar);
            }
        }

        buySignals.sort((a, b) => {
            const scoreA = (a.rsi < 30 ? 2 : 0) + (a.price > a.psar ? 1 : 0);
            const scoreB = (b.rsi < 30 ? 2 : 0) + (b.price > b.psar ? 1 : 0);
            return scoreB - scoreA;
        });

        sellSignals.sort((a, b) => {
            const scoreA = (a.rsi > 70 ? 2 : 0) + (a.price < a.psar ? 1 : 0);
            const scoreB = (b.rsi > 70 ? 2 : 0) + (b.price < b.psar ? 1 : 0);
            return scoreB - scoreA;
        });

        lastBuySignals = buySignals;
        lastSellSignals = sellSignals;

        renderSignalList(buyContainer, buySignals, 'buy', buyCount, false);
        renderSignalList(sellContainer, sellSignals, 'sell', sellCount, true);

        if (updateTime) updateTime.innerText = new Date().toLocaleString();

    } catch (error) {
        console.error('Signal load error:', error);
        buyContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: red;">Error: ${error.message}</div>`;
        sellContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: red;">Error: ${error.message}</div>`;
    }
}

function renderSignalList(container, data, type, countElement, showRemainingQty = false) {
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">No ${type} signals found.</div>`;
        if (countElement) countElement.innerText = '0 stocks';
        return;
    }

    const displayData = data.slice(0, 10);
    const signalText = type === 'buy' ? '🟢 BUY' : '🔴 SELL';
    const signalColor = type === 'buy' ? '#10b981' : '#ef4444';

    let html = '';
    for (const item of displayData) {
        let filterValue = '';
        if (currentSignalScanner === 'psar') filterValue = `PSAR: ₹${item.psar.toFixed(2)}`;
        else if (currentSignalScanner === 'rsi') filterValue = `RSI: ${item.rsi.toFixed(1)}`;
        else filterValue = `RSI: ${item.rsi.toFixed(1)} PSAR: ₹${item.psar.toFixed(2)}`;

        const gridCols = showRemainingQty ? '1fr 0.8fr 1fr 1.5fr 0.8fr' : '1fr 1fr 1.5fr 0.8fr';

        html += `
            <div class="signal-item" style="display: grid; grid-template-columns: ${gridCols}; gap: 6px; align-items: center; padding: 6px 10px; margin-bottom: 3px; border-radius: 6px; background: var(--bg-tertiary); font-size: 12px; cursor: pointer;" 
                 onclick="window.openSignalDetailModal('${type}')">
                <span style="font-weight: 600; color: var(--primary-color); text-decoration: underline; cursor: pointer;" 
                      onclick="event.stopPropagation(); window.openStockDetailModal('${item.ticker}')">${item.ticker}</span>
                ${showRemainingQty ? `<span style="text-align: right; font-weight: 500;">${item.remainingQty || 0}</span>` : ''}
                <span style="text-align: right;">₹${item.price.toFixed(2)}</span>
                <span style="color: var(--text-secondary); font-size: 11px;">${filterValue}</span>
                <span style="text-align: center; color: ${signalColor}; font-weight: 600; font-size: 11px; padding: 2px 6px; border-radius: 10px; background: ${signalColor}22;">${signalText}</span>
            </div>
        `;
    }

    if (data.length > 10) {
        html += `<div style="text-align: center; padding: 8px; color: var(--primary-color); font-size: 12px; cursor: pointer; text-decoration: underline;" onclick="window.openSignalDetailModal('${type}')">See All ${data.length} stocks →</div>`;
    }

    container.innerHTML = html;
    if (countElement) countElement.innerText = `${data.length} stocks`;
}

export function applySignalFilters() {
    const marketFilter = document.getElementById('signal-market-filter');
    const scannerFilter = document.getElementById('signal-scanner-filter');

    if (marketFilter) currentSignalMarket = marketFilter.value;
    if (scannerFilter) currentSignalScanner = scannerFilter.value;

    loadSignalData();
}

export function openSignalDetailModal(type) {
    const modal = document.getElementById('signal-detail-modal');
    if (!modal) return;

    const title = document.getElementById('signal-detail-title');
    const countSpan = document.getElementById('signal-detail-count');
    const tbody = document.getElementById('signal-detail-tbody');
    const timeSpan = document.getElementById('signal-detail-time');

    let data = type === 'buy' ? lastBuySignals : lastSellSignals;
    if (!data || data.length === 0) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">No signals available.</td></tr>`;
        }
        modal.style.display = 'flex';
        return;
    }

    if (title) title.innerText = type === 'buy' ? '📈 Buy Signals' : '📉 Sell Signals';
    if (countSpan) countSpan.innerText = `${data.length} stocks`;
    if (timeSpan) timeSpan.innerText = new Date().toLocaleString();

    let rowsHTML = '';
    for (const item of data) {
        const price = item.price ?? 0;
        const signalText = type === 'buy' ? '🟢 BUY' : '🔴 SELL';
        const signalColor = type === 'buy' ? '#10b981' : '#ef4444';
        const rsi = (item.rsi !== null && item.rsi !== undefined) ? item.rsi.toFixed(2) : '-';
        const psar = (item.psar !== null && item.psar !== undefined && item.psar > 0) ? item.psar.toFixed(2) : '-';
        const ath = (item.ath !== null && item.ath !== undefined && item.ath > 0) ? item.ath.toFixed(2) : '-';
        const atl = (item.atl !== null && item.atl !== undefined && item.atl !== Infinity && item.atl > 0) ? item.atl.toFixed(2) : '-';

        rowsHTML += `<tr onclick="window.openStockDetailModal('${item.ticker}')" style="cursor:pointer;">
            <td style="padding:8px 10px; font-weight:600; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>
            <td style="padding:8px 10px; text-align:right;">৳${price.toFixed(2)}</td>
            <td style="padding:8px 10px; text-align:right; color: ${item.rsi !== null ? (item.rsi < 30 ? '#10b981' : (item.rsi > 70 ? '#ef4444' : '#f59e0b')) : '#64748b'};">${rsi}</td>
            <td style="padding:8px 10px; text-align:right;">${psar !== '-' ? '৳'+psar : '-'}</td>
            <td style="padding:8px 10px; text-align:right;">${ath !== '-' ? '৳'+ath : '-'}</td>
            <td style="padding:8px 10px; text-align:right;">${atl !== '-' ? '৳'+atl : '-'}</td>
            <td style="padding:8px 10px; text-align:center; color:${signalColor}; font-weight:bold;">${signalText}</td>
            <td style="padding:8px 10px; text-align:center;"><button onclick="event.stopPropagation(); window.openStockDetailModal('${item.ticker}')" style="background:var(--primary-color); color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px;">📊 View</button></td>
        </tr>`;
    }

    tbody.innerHTML = rowsHTML;
    modal.style.display = 'flex';
}

export function closeSignalDetailModal() {
    const modal = document.getElementById('signal-detail-modal');
    if (modal) modal.style.display = 'none';
}

// ==========================================
// 📌 SCANNER FUNCTIONS
// ==========================================

let allScannerData = [];
let cachedRSIData = null;

export async function loadAllScannerData(forceRefresh = false) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return null;
    }

    try {
        const tickers = dseStocks;
        if (tickers.length === 0) {
            showToast('Stock list is empty.', 'error');
            return [];
        }

        const allResults = [];
        const BATCH_SIZE = 10;
        let supabasePriceMap = new Map();

        // Price data
        if (typeof supabase !== 'undefined' && supabase) {
            const chunks = chunkArray(tickers, BATCH_SIZE);
            for (const chunk of chunks) {
                try {
                    const { data, error } = await supabase
                        .from('cse_market_data')
                        .select('code, ltp, high, low, category')
                        .in('code', chunk)
                        .order('date', { ascending: false });
                    if (!error && data) {
                        const seen = new Set();
                        data.forEach(row => {
                            if (!seen.has(row.code)) {
                                seen.add(row.code);
                                supabasePriceMap.set(row.code, {
                                    ltp: parseFloat(row.ltp) || 0,
                                    high: parseFloat(row.high) || 0,
                                    low: parseFloat(row.low) || 0,
                                    category: row.category || 'N/A'
                                });
                            }
                        });
                    }
                } catch (e) { /* ignore */ }
            }
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const startDateStr = startDate.toISOString().split('T')[0];

        let allHistoricData = [];

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const chunks = chunkArray(tickers, BATCH_SIZE);
                for (const chunk of chunks) {
                    const { data, error } = await supabase
                        .from('history_dse')
                        .select('ticker, date, ltp, high, low')
                        .in('ticker', chunk)
                        .gte('date', startDateStr)
                        .order('date', { ascending: true });
                    if (!error && data && data.length > 0) {
                        data.forEach(item => {
                            const ltp = parseFloat(item.ltp);
                            if (ltp > 0) {
                                allHistoricData.push({
                                    code: item.code,
                                    date: item.date,
                                    ltp: ltp,
                                    high: parseFloat(item.high) || ltp,
                                    low: parseFloat(item.low) || ltp
                                });
                            }
                        });
                    }
                }
            } catch (e) { /* ignore */ }
        }

        const groupedData = {};
        allHistoricData.forEach(item => {
            if (!groupedData[item.code]) groupedData[item.code] = [];
            groupedData[item.code].push(item);
        });

        for (const ticker of tickers) {
            try {
                const priceData = groupedData[ticker] || [];
                if (priceData.length < 15) continue;

                const sarData = calculateParabolicSAR(priceData);
                const lastSAR = sarData.length > 0 ? sarData[sarData.length - 1] : null;
                
                const rsiData = calculateRSI(priceData.map(p => p.ltp), 14);
                const lastRSI = rsiData.length > 0 ? rsiData[rsiData.length - 1].rsi : null;

                let currentPrice = priceData[priceData.length - 1]?.ltp || 0;
                let category = 'N/A';
                if (supabasePriceMap.has(ticker)) {
                    const live = supabasePriceMap.get(ticker);
                    if (live.ltp > 0) currentPrice = live.ltp;
                    category = live.category || 'N/A';
                }

                let ath = 0, atl = Infinity;
                for (const item of priceData) {
                    const ltp = item.ltp;
                    if (ltp > ath) ath = ltp;
                    if (ltp > 0 && ltp < atl) atl = ltp;
                    if (item.high > ath) ath = item.high;
                    if (item.low > 0 && item.low < atl) atl = item.low;
                }
                if (atl === Infinity) atl = 0;

                allResults.push({
                    ticker: ticker,
                    currentPrice: currentPrice,
                    sar: lastSAR ? lastSAR.sar : currentPrice,
                    trend: lastSAR ? lastSAR.trend : 'up',
                    rsi: lastRSI !== null ? lastRSI : null,
                    category: category,
                    ath: ath,
                    atl: atl
                });
            } catch (err) {
                console.warn(`Error processing ${ticker}:`, err);
            }
        }

        allScannerData = allResults;
        return allResults;

    } catch (error) {
        console.error('All Scanner load error:', error);
        showToast('Error loading scanner data', 'error');
        return null;
    }
}

export function filterStrongBuySignals(data) {
    if (!data || !Array.isArray(data)) return [];
    return data.filter(item => item.rsi !== null && item.rsi < 30 && item.sar < item.currentPrice)
        .sort((a, b) => (a.rsi || 0) - (b.rsi || 0));
}

export function filterStrongSellSignals(data) {
    if (!data || !Array.isArray(data)) return [];
    return data.filter(item => item.rsi !== null && item.rsi > 70 && item.sar > item.currentPrice)
        .sort((a, b) => (b.rsi || 0) - (a.rsi || 0));
}

export async function loadAllScannerPage() {
    const buyBody = document.getElementById('all-scanner-buy-body');
    const sellBody = document.getElementById('all-scanner-sell-body');
    const updateTime = document.getElementById('all-scanner-update-time');

    if (buyBody) buyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">⏳ Scanning market...</td></tr>';
    if (sellBody) sellBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">⏳ Scanning market...</td></tr>';

    try {
        const allData = await loadAllScannerData(false);
        if (!allData || allData.length === 0) {
            if (buyBody) buyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No market data available.</td></tr>';
            if (sellBody) sellBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No market data available.</td></tr>';
            if (updateTime) updateTime.innerText = new Date().toLocaleString();
            return;
        }

        const strongBuy = filterStrongBuySignals(allData);
        const strongSell = filterStrongSellSignals(allData);

        renderAllScannerTable(strongBuy, 'buy', 'all-scanner-buy-body');
        renderAllScannerTable(strongSell, 'sell', 'all-scanner-sell-body');

        if (updateTime) updateTime.innerText = new Date().toLocaleString();
        switchAllScannerTab('buy');
    } catch (error) {
        console.error('All Scanner error:', error);
        if (buyBody) buyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:red;">❌ Error loading data</td></tr>';
    }
}

function renderAllScannerTable(data, type, containerId) {
    const tbody = document.getElementById(containerId);
    if (!tbody) return;
    if (!data || !Array.isArray(data) || data.length === 0) {
        const msg = type === 'buy' ? 'No Strong Buy signals found.' : 'No Strong Sell signals found.';
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">${msg}</td></tr>`;
        return;
    }
    let html = '';
    data.forEach(item => {
        const isBuy = type === 'buy';
        const signalText = isBuy ? '🟢🔥 STRONG BUY' : '🔴🔥 STRONG SELL';
        const signalColor = isBuy ? '#059669' : '#dc2626';
        const rsiColor = isBuy ? '#10b981' : '#ef4444';
        html += `<tr onclick="window.openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
        html += `<td style="padding:10px; font-weight:bold; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.currentPrice || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.sar || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right; color:${rsiColor}; font-weight:600;">${item.rsi !== null ? item.rsi.toFixed(2) : '-'}</td>`;
        html += `<td style="padding:10px; text-align:center; color:${signalColor}; font-weight:bold;">${signalText}</td>`;
        html += `</tr>`;
    });
    tbody.innerHTML = html;
}

export function switchAllScannerTab(tab) {
    const containers = {
        buy: document.getElementById('all-scanner-buy-container'),
        sell: document.getElementById('all-scanner-sell-container')
    };
    const tabs = {
        buy: document.getElementById('all-scanner-tab-buy'),
        sell: document.getElementById('all-scanner-tab-sell')
    };
    Object.values(containers).forEach(c => { if (c) c.style.display = 'none'; });
    Object.values(tabs).forEach(t => {
        if (t) {
            t.style.background = 'transparent';
            t.style.color = 'var(--text-primary)';
            t.style.border = '1px solid var(--border-color)';
        }
    });
    if (tab === 'buy' && containers.buy) {
        containers.buy.style.display = 'block';
        if (tabs.buy) {
            tabs.buy.style.background = 'var(--primary-color)';
            tabs.buy.style.color = 'white';
            tabs.buy.style.border = 'none';
        }
    } else if (tab === 'sell' && containers.sell) {
        containers.sell.style.display = 'block';
        if (tabs.sell) {
            tabs.sell.style.background = 'var(--primary-color)';
            tabs.sell.style.color = 'white';
            tabs.sell.style.border = 'none';
        }
    }
}

export async function refreshAllScannerPage() {
    allScannerData = [];
    await loadAllScannerPage();
    showToast('✅ All Scanner refreshed!', 'success');
}

// ==========================================
// 📌 RSI INDICATOR FUNCTIONS
// ==========================================

export async function loadRSIIndicatorPage() {
    const buyBody = document.getElementById('rsi-buy-body');
    const sellBody = document.getElementById('rsi-sell-body');
    const updateTime = document.getElementById('rsi-update-time');

    if (buyBody) buyBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">⏳ Loading RSI data...</td></tr>';
    if (sellBody) sellBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">⏳ Loading RSI data...</td></tr>';

    try {
        const allData = await loadAllScannerData(false);
        if (!allData || allData.length === 0) {
            if (buyBody) buyBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No market data available.</td></tr>';
            if (sellBody) sellBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No market data available.</td></tr>';
            if (updateTime) updateTime.innerText = new Date().toLocaleString();
            return;
        }
        cachedRSIData = allData;
        applyRSIFilter('buy');
        applyRSIFilter('sell');
        if (updateTime) updateTime.innerText = new Date().toLocaleString();
    } catch (error) {
        console.error('RSI Indicator error:', error);
        if (buyBody) buyBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:red;">❌ Error loading data</td></tr>';
        if (sellBody) sellBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:red;">❌ Error loading data</td></tr>';
    }
}

function applyRSIFilter(tab) {
    if (!cachedRSIData) { loadRSIIndicatorPage(); return; }
    const tbodyId = tab === 'buy' ? 'rsi-buy-body' : 'rsi-sell-body';
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const threshold = tab === 'buy' ? 30 : 70;
    let filtered = [];
    if (tab === 'buy') {
        filtered = cachedRSIData.filter(item => item.rsi !== null && item.rsi < threshold)
            .sort((a, b) => (a.rsi || 0) - (b.rsi || 0));
    } else {
        filtered = cachedRSIData.filter(item => item.rsi !== null && item.rsi > threshold)
            .sort((a, b) => (b.rsi || 0) - (a.rsi || 0));
    }
    renderRSITable(filtered, tab, tbody);
}

function renderRSITable(data, tab, tbody) {
    if (!tbody) return;
    if (!data || !Array.isArray(data) || data.length === 0) {
        const msg = tab === 'buy' ? 'No stocks with RSI below 30.' : 'No stocks with RSI above 70.';
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">${msg}</td></tr>`;
        return;
    }
    let html = '';
    data.forEach(item => {
        const isBuy = tab === 'buy';
        const signalText = isBuy ? '🟢 BUY' : '🔴 SELL';
        const signalColor = isBuy ? '#10b981' : '#ef4444';
        const rsiColor = isBuy ? '#10b981' : '#ef4444';
        html += `<tr onclick="window.openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
        html += `<td style="padding:10px; font-weight:bold; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>`;
        html += `<td style="padding:10px;">${item.category || 'N/A'}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.currentPrice || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right; color:${rsiColor}; font-weight:600;">${item.rsi !== null ? item.rsi.toFixed(2) : '-'}</td>`;
        html += `<td style="padding:10px; text-align:right;">${item.ath > 0 ? '৳'+item.ath.toFixed(2) : '-'}</td>`;
        html += `<td style="padding:10px; text-align:right;">${item.atl > 0 ? '৳'+item.atl.toFixed(2) : '-'}</td>`;
        html += `<td style="padding:10px; text-align:center; color:${signalColor}; font-weight:bold;">${signalText}</td>`;
        html += `</tr>`;
    });
    tbody.innerHTML = html;
}

export function switchRSITab(tab) {
    const containers = { buy: document.getElementById('rsi-buy-container'), sell: document.getElementById('rsi-sell-container') };
    const tabs = { buy: document.getElementById('rsi-tab-buy'), sell: document.getElementById('rsi-tab-sell') };
    Object.values(containers).forEach(c => { if (c) c.style.display = 'none'; });
    Object.values(tabs).forEach(t => {
        if (t) {
            t.style.background = 'transparent';
            t.style.color = 'var(--text-primary)';
            t.style.border = '1px solid var(--border-color)';
        }
    });
    if (tab === 'buy' && containers.buy) {
        containers.buy.style.display = 'block';
        if (tabs.buy) {
            tabs.buy.style.background = 'var(--primary-color)';
            tabs.buy.style.color = 'white';
            tabs.buy.style.border = 'none';
        }
        applyRSIFilter('buy');
    } else if (tab === 'sell' && containers.sell) {
        containers.sell.style.display = 'block';
        if (tabs.sell) {
            tabs.sell.style.background = 'var(--primary-color)';
            tabs.sell.style.color = 'white';
            tabs.sell.style.border = 'none';
        }
        applyRSIFilter('sell');
    }
}

export async function refreshRSIIndicator() {
    cachedRSIData = null;
    await loadRSIIndicatorPage();
    showToast('✅ RSI Indicator refreshed!', 'success');
}

// ==========================================
// 📌 STOCK DETAIL MODAL
// ==========================================

export function openStockDetailModal(ticker) {
    const modal = document.getElementById('advanced-stock-modal');
    if (!modal) return;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    modal.style.display = 'flex';
    const tickerElem = document.getElementById('adv-modal-ticker');
    if (tickerElem) tickerElem.innerText = ticker;

    // Quick update with basic info
    getUnifiedPrice(ticker).then(price => {
        const ltpElem = document.getElementById('adv-ltp');
        if (ltpElem) ltpElem.innerHTML = `৳${price.toFixed(2)}`;
    });

    showToast(`📊 Loading ${ticker}...`, 'info');
}

export function closeAdvancedModal() {
    const modal = document.getElementById('advanced-stock-modal');
    if (modal) modal.style.display = 'none';
}

// ==========================================
// 📌 EXPORT ALL
// ==========================================

export default {
    // Signal
    loadSignalData,
    applySignalFilters,
    openSignalDetailModal,
    closeSignalDetailModal,
    
    // Scanner
    loadAllScannerData,
    filterStrongBuySignals,
    filterStrongSellSignals,
    loadAllScannerPage,
    switchAllScannerTab,
    refreshAllScannerPage,
    
    // RSI
    loadRSIIndicatorPage,
    switchRSITab,
    refreshRSIIndicator,
    
    // Modal
    openStockDetailModal,
    closeAdvancedModal
};