// ==========================================
// 📊 dash-signals.js - Dashboard Signals (FIXED)
//    ✅ "buy-sell-price" স্ক্যানার সাপোর্ট যোগ করা
//    ✅ Sell সিগন্যালে মার্কেট ফিল্টার + স্ক্যানার ফিল্টার সঠিকভাবে প্রয়োগ করা
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, getUnifiedPrice, chunkArray } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR } from './indicators.js';
// 🔥 Buy Sell Price স্ক্যানারের জন্য ইমপোর্ট
import { getBuySellPriceSignalData } from './scanner.js';

let currentSignalMarket = 'all';
let currentSignalScanner = 'psar';
let lastBuySignals = [];
let lastSellSignals = [];

// ==========================================
// Apply Signal Filters
// ==========================================

export function applySignalFilters() {
    const marketFilter = document.getElementById('signal-market-filter');
    const scannerFilter = document.getElementById('signal-scanner-filter');
    if (marketFilter) currentSignalMarket = marketFilter.value;
    if (scannerFilter) currentSignalScanner = scannerFilter.value;
    loadSignalData();
}

// ==========================================
// Load Signal Data (মূল ফাংশন)
// ==========================================

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
        } catch (e) { /* ignore */ }

        // ==========================================
        // 🔥 ১. "Buy Sell Price" স্ক্যানারের জন্য আলাদা হ্যান্ডলিং
        // ==========================================
        if (currentSignalScanner === 'buy-sell-price') {
            const result = await getBuySellPriceSignalData();
            
            // Buy সিগন্যাল রেন্ডার
            renderSignalList(buyContainer, result.buy, 'buy', buyCount, false, 'buy-sell-price');
            // Sell সিগন্যাল রেন্ডার (রিমেইনিং কোয়ান্টিটি দেখাতে হবে)
            renderSignalList(sellContainer, result.sell, 'sell', sellCount, true, 'buy-sell-price');
            
            if (updateTime) updateTime.innerText = new Date().toLocaleString();
            return;
        }

        // ==========================================
        // ২. বাকি স্ক্যানারগুলোর জন্য (PSAR, RSI, All Scanner, Smart Signal)
        // ==========================================
        
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
                            const snap = await db.collection('daily_prices')
                                .where('ticker', '==', ticker)
                                .where('date', '>=', startDateStr)
                                .orderBy('date', 'asc')
                                .limit(30)
                                .get();
                            if (!snap.empty) {
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    const price = parseFloat(d.price) || parseFloat(d.close) || 0;
                                    if (price > 0) {
                                        priceData.push({
                                            date: d.date,
                                            ltp: price,
                                            high: parseFloat(d.high) || price,
                                            low: parseFloat(d.low) || price
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

        // ---------- Buy সিগন্যাল ফিল্টার ----------
        let buySignals = [];
        if (currentSignalScanner === 'psar') {
            buySignals = allResults.filter(item => item.price > item.psar);
        } else if (currentSignalScanner === 'rsi') {
            buySignals = allResults.filter(item => item.rsi < 30);
        } else if (currentSignalScanner === 'all-scanner') {
            buySignals = allResults.filter(item => item.rsi < 30 && item.price > item.psar);
        } else if (currentSignalScanner === 'smart-signal') {
            buySignals = allResults.filter(item => item.rsi < 40 && item.price > item.psar);
        }

        // ---------- Sell সিগন্যাল ফিল্টার (বর্তমান মার্কেট ফিল্টার প্রয়োগ করে) ----------
        let sellCandidates = allResults;
        if (currentSignalMarket === 'portfolio') {
            sellCandidates = allResults.filter(item => portfolioQtyMap.has(item.ticker));
        } else if (currentSignalMarket === 'watchlist') {
            try {
                const wl = localStorage.getItem('market_watch_list') || '[]';
                const watchlist = JSON.parse(wl);
                sellCandidates = allResults.filter(item => watchlist.includes(item.ticker));
            } catch (e) { /* ignore */ }
        }
        // এখন স্ক্যানার ফিল্টার প্রয়োগ করুন
        let sellSignals = [];
        if (currentSignalScanner === 'psar') {
            sellSignals = sellCandidates.filter(item => item.price < item.psar);
        } else if (currentSignalScanner === 'rsi') {
            sellSignals = sellCandidates.filter(item => item.rsi > 70);
        } else if (currentSignalScanner === 'all-scanner') {
            sellSignals = sellCandidates.filter(item => item.rsi > 70 && item.price < item.psar);
        } else if (currentSignalScanner === 'smart-signal') {
            sellSignals = sellCandidates.filter(item => item.rsi > 60 && item.price < item.psar);
        }

        // সাজানো
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

// ==========================================
// 📋 সিগন্যাল লিস্ট রেন্ডার (আপডেটেড)
// ==========================================

function renderSignalList(container, data, type, countElement, showRemainingQty = false, scanner = currentSignalScanner) {
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
        
        // 🔥 Buy Sell Price এর জন্য আলাদা টেক্সট
        if (scanner === 'buy-sell-price') {
            const minBuy = item.minBuyPrice || 0;
            const maxSell = item.maxSellPrice || 0;
            filterValue = `Min Buy: ₹${minBuy.toFixed(2)} | Max Sell: ₹${maxSell.toFixed(2)}`;
        } else if (scanner === 'psar') {
            filterValue = `PSAR: ₹${item.psar.toFixed(2)}`;
        } else if (scanner === 'rsi') {
            filterValue = `RSI: ${item.rsi.toFixed(1)}`;
        } else {
            filterValue = `RSI: ${item.rsi.toFixed(1)} PSAR: ₹${item.psar.toFixed(2)}`;
        }

        const gridCols = showRemainingQty ? '1fr 0.8fr 1fr 1.5fr 0.8fr' : '1fr 1fr 1.5fr 0.8fr';

        html += `
            <div class="signal-item" style="display: grid; grid-template-columns: ${gridCols}; gap: 6px; align-items: center; padding: 6px 10px; margin-bottom: 3px; border-radius: 6px; background: var(--bg-tertiary); font-size: 12px; cursor: pointer;" 
                 onclick="window.openSignalDetailModal('${type}')" 
                 onmouseover="this.style.background='var(--hover-bg)'" 
                 onmouseout="this.style.background='var(--bg-tertiary)'">
                <span style="font-weight: 600; color: var(--primary-color); text-decoration: underline; font-size: 13px; cursor: pointer;" 
                      onclick="event.stopPropagation(); window.openStockDetailModal('${item.ticker}')">${item.ticker}</span>
                ${showRemainingQty ? `<span style="text-align: right; font-weight: 500; color: var(--text-primary);">${item.remainingQty || 0}</span>` : ''}
                <span style="text-align: right; color: var(--text-muted);">₹${item.price.toFixed(2)}</span>
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

// ==========================================
// 🔍 সিগন্যাল ডিটেইল মোডাল
// ==========================================

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
            const thead = tbody.closest('table').querySelector('thead');
            if (thead) thead.style.display = 'none';
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">No signals available.</td></tr>`;
        }
        modal.style.display = 'flex';
        return;
    }

    if (title) title.innerText = type === 'buy' ? '📈 Buy Signals' : '📉 Sell Signals';
    if (countSpan) countSpan.innerText = `${data.length} stocks`;
    if (timeSpan) timeSpan.innerText = new Date().toLocaleString();

    const showRemaining = type === 'sell';

    let theadHTML = `
        <tr>
            <th style="padding:8px; text-align:left;">Share</th>
            ${showRemaining ? '<th style="padding:8px; text-align:right;">Remaining</th>' : ''}
            <th style="padding:8px; text-align:right;">Price (৳)</th>
            <th style="padding:8px; text-align:right;">RSI</th>
            <th style="padding:8px; text-align:right;">PSAR (৳)</th>
            <th style="padding:8px; text-align:right;">ATH (৳)</th>
            <th style="padding:8px; text-align:right;">ATL (৳)</th>
            <th style="padding:8px; text-align:center;">Signal</th>
            <th style="padding:8px; text-align:center;">Action</th>
        </tr>
    `;

    const thead = tbody.closest('table').querySelector('thead');
    if (thead) {
        thead.style.display = '';
        thead.innerHTML = theadHTML;
    }

    let rowsHTML = '';
    for (const item of data) {
        const price = item.price ?? 0;
        const signalText = type === 'buy' ? '🟢 BUY' : '🔴 SELL';
        const signalColor = type === 'buy' ? '#10b981' : '#ef4444';
        const remaining = item.remainingQty || 0;
        const rsi = (item.rsi !== null && item.rsi !== undefined) ? item.rsi.toFixed(2) : '-';
        const psar = (item.psar !== null && item.psar !== undefined && item.psar > 0) ? item.psar.toFixed(2) : '-';
        const ath = (item.ath !== null && item.ath !== undefined && item.ath > 0) ? item.ath.toFixed(2) : '-';
        const atl = (item.atl !== null && item.atl !== undefined && item.atl !== Infinity && item.atl > 0) ? item.atl.toFixed(2) : '-';

        rowsHTML += `<tr onclick="window.openStockDetailModal('${item.ticker}')" style="cursor:pointer;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='transparent'">`;
        rowsHTML += `<td style="padding:8px 10px; font-weight:600; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>`;
        if (showRemaining) rowsHTML += `<td style="padding:8px 10px; text-align:right; font-weight:500;">${remaining}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:right;">৳${price.toFixed(2)}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:right; color: ${item.rsi !== null ? (item.rsi < 30 ? '#10b981' : (item.rsi > 70 ? '#ef4444' : '#f59e0b')) : '#64748b'};">${rsi}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:right;">${psar !== '-' ? '৳'+psar : '-'}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:right;">${ath !== '-' ? '৳'+ath : '-'}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:right;">${atl !== '-' ? '৳'+atl : '-'}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:center; color:${signalColor}; font-weight:bold;">${signalText}</td>`;
        rowsHTML += `<td style="padding:8px 10px; text-align:center;"><button onclick="event.stopPropagation(); window.openStockDetailModal('${item.ticker}')" style="background:var(--primary-color); color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px;">📊 View</button></td>`;
        rowsHTML += `</tr>`;
    }

    tbody.innerHTML = rowsHTML;
    modal.style.display = 'flex';
}

export function closeSignalDetailModal() {
    const modal = document.getElementById('signal-detail-modal');
    if (modal) modal.style.display = 'none';
}

document.addEventListener('click', function(e) {
    const modal = document.getElementById('signal-detail-modal');
    if (modal && e.target === modal) {
        closeSignalDetailModal();
    }
});

console.log('✅ dash-signals.js (fixed) loaded');