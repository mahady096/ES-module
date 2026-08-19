// ==========================================
// 🧠 smart-signals.js - AI-powered Buy/Sell Recommendations
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, getUnifiedPrice, chunkArray } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR } from './indicators.js';

let smartSignalsData = [];
let smartSortColumn = -1;
let smartSortAsc = true;

// ==========================================
// Main Load Function
// ==========================================

export async function loadSmartSignalsPage() {
    const tbody = document.getElementById('smart-signals-tbody');
    const updateTime = document.getElementById('smart-signals-update-time');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">⏳ Calculating smart signals...</td></tr>';
    if (updateTime) updateTime.innerText = new Date().toLocaleString();

    try {
        const user = auth.currentUser;
        if (!user) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:red;">Please login first.</td></tr>';
            return;
        }

        // Portfolio data
        const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
        if (!unifiedData || !unifiedData.stockDetails) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">No holdings found.</td></tr>';
            return;
        }

        const portfolioTickers = unifiedData.stockDetails.map(s => s.ticker);

        let watchlist = [];
        try {
            const wl = localStorage.getItem('market_watch_list');
            if (wl) watchlist = JSON.parse(wl);
        } catch(e) {}

        const filterValue = document.getElementById('smart-market-filter')?.value || 'portfolio';
        let targetTickers = [];
        if (filterValue === 'portfolio') targetTickers = portfolioTickers;
        else if (filterValue === 'watchlist') targetTickers = watchlist;
        else targetTickers = dseStocks;

        if (targetTickers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">No stocks found.</td></tr>';
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

                    let unrealizedPct = 0;
                    if (portfolioTickers.includes(ticker)) {
                        const stock = unifiedData.stockDetails.find(s => s.ticker === ticker);
                        if (stock) {
                            const avgBuy = stock.avgBuyPriceWithCommission || stock.avgBuyPrice;
                            const remaining = stock.totalQty || 0;
                            const cost = remaining * avgBuy;
                            const currentValue = remaining * price;
                            const pl = currentValue - cost;
                            unrealizedPct = cost > 0 ? (pl / cost) * 100 : 0;
                        }
                    }

                    // Scoring
                    let rsiScore = 0, psarScore = 0, athScore = 0, plScore = 0;

                    if (rsi < 30) rsiScore = 25;
                    else if (rsi > 70) rsiScore = -25;
                    else if (rsi < 40) rsiScore = 10;
                    else if (rsi > 60) rsiScore = -10;

                    if (psar < price) psarScore = 20;
                    else psarScore = -20;

                    if (ath > 0 && price >= ath * 0.90) athScore = -15;
                    else if (atl > 0 && price <= atl * 1.10) athScore = 15;

                    if (unrealizedPct > 20) plScore = -15;
                    else if (unrealizedPct < -20) plScore = 15;

                    const score = Math.min(100, Math.max(0, 50 + rsiScore * 0.25 + psarScore * 0.20 + athScore * 0.15 + plScore * 0.20));

                    // Recommendation
                    let rec = 'HOLD';
                    let recColor = '#f59e0b';
                    if (score >= 70) { rec = 'STRONG BUY'; recColor = '#10b981'; }
                    else if (score >= 55) { rec = 'BUY'; recColor = '#34d399'; }
                    else if (score >= 35) { rec = 'HOLD'; recColor = '#f59e0b'; }
                    else if (score >= 20) { rec = 'SELL'; recColor = '#f97316'; }
                    else { rec = 'STRONG SELL'; recColor = '#ef4444'; }

                    // Confidence
                    let confidence = 'Low';
                    let confColor = '#94a3b8';
                    if (Math.abs(rsi - 50) > 20 && Math.abs(score - 50) > 15) {
                        confidence = 'High';
                        confColor = '#10b981';
                    } else if (Math.abs(rsi - 50) > 10 || Math.abs(score - 50) > 10) {
                        confidence = 'Medium';
                        confColor = '#f59e0b';
                    }

                    return {
                        ticker,
                        price,
                        rsi,
                        psar,
                        score,
                        rec,
                        recColor,
                        confidence,
                        confColor
                    };
                } catch (err) {
                    return null;
                }
            });

            const results = await Promise.all(promises);
            const valid = results.filter(r => r !== null);
            allResults.push(...valid);
        }

        smartSignalsData = allResults;
        smartSortColumn = 4;
        smartSortAsc = false;
        applySmartSort();

        const countEl = document.getElementById('smart-signals-count');
        if (countEl) countEl.innerText = allResults.length + ' stocks';
        if (updateTime) updateTime.innerText = new Date().toLocaleString();

        initSmartFilter();

    } catch (error) {
        console.error('Smart signals error:', error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:red;">❌ Error: ${error.message}</td></tr>`;
    }
}

// ==========================================
// Sort Functions
// ==========================================

export function sortSmartTable(colIndex) {
    if (smartSortColumn === colIndex) {
        smartSortAsc = !smartSortAsc;
    } else {
        smartSortColumn = colIndex;
        smartSortAsc = true;
    }
    applySmartSort();
    updateSmartSortIndicators(colIndex);
}

function applySmartSort() {
    if (smartSortColumn === -1 || smartSignalsData.length === 0) {
        renderSmartSignalsTable(smartSignalsData);
        return;
    }

    const sorted = [...smartSignalsData].sort((a, b) => {
        let aVal, bVal;
        switch (smartSortColumn) {
            case 0: aVal = a.ticker; bVal = b.ticker; break;
            case 1: aVal = a.price; bVal = b.price; break;
            case 2: aVal = a.rsi; bVal = b.rsi; break;
            case 3: aVal = a.psar; bVal = b.psar; break;
            case 4: aVal = a.score; bVal = b.score; break;
            case 5: aVal = a.rec; bVal = b.rec; break;
            case 6: aVal = a.confidence; bVal = b.confidence; break;
            default: aVal = a.ticker; bVal = b.ticker;
        }
        if (typeof aVal === 'string') {
            return smartSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        } else {
            return smartSortAsc ? (aVal - bVal) : (bVal - aVal);
        }
    });

    renderSmartSignalsTable(sorted);
}

function updateSmartSortIndicators(colIndex) {
    const headers = document.querySelectorAll('#smart-signals-table thead th');
    headers.forEach((th, idx) => {
        const existing = th.querySelector('.sort-arrow');
        if (existing) existing.remove();
        if (idx === colIndex) {
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.style.marginLeft = '5px';
            arrow.textContent = smartSortAsc ? ' ▲' : ' ▼';
            th.appendChild(arrow);
        }
    });
}

// ==========================================
// Render Function
// ==========================================

function renderSmartSignalsTable(data) {
    const tbody = document.getElementById('smart-signals-tbody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">No signals found.</td></tr>';
        return;
    }

    let html = '';
    for (const item of data) {
        let tickerColor = 'var(--primary-color)';
        const isBuy = (item.rec === 'BUY' || item.rec === 'STRONG BUY');
        const isSell = (item.rec === 'SELL' || item.rec === 'STRONG SELL');
        if (isBuy && item.confidence === 'High') {
            tickerColor = '#10b981';
        } else if (isSell && item.confidence === 'High') {
            tickerColor = '#ef4444';
        }

        html += `<tr onclick="if(window.openStockDetailModal) window.openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
        html += `<td style="padding: 10px; font-weight: bold; color: ${tickerColor}; text-decoration: underline;">${item.ticker}</td>`;
        html += `<td style="padding: 10px; text-align: right;">৳${item.price.toFixed(2)}</td>`;
        html += `<td style="padding: 10px; text-align: right; color: ${item.rsi < 30 ? '#10b981' : (item.rsi > 70 ? '#ef4444' : '#f59e0b')};">${item.rsi.toFixed(2)}</td>`;
        html += `<td style="padding: 10px; text-align: right;">${item.psar > 0 ? '৳'+item.psar.toFixed(2) : '-'}</td>`;
        html += `<td style="padding: 10px; text-align: right; font-weight: bold;">${item.score.toFixed(0)}</td>`;
        html += `<td style="padding: 10px; text-align: center; font-weight: bold; color: ${item.recColor};">${item.rec}</td>`;
        html += `<td style="padding: 10px; text-align: center; color: ${item.confColor};">${item.confidence}</td>`;
        html += `</tr>`;
    }
    tbody.innerHTML = html;

    updateSmartSortIndicators(smartSortColumn);
}

// ==========================================
// Filter
// ==========================================

function initSmartFilter() {
    const filter = document.getElementById('smart-market-filter');
    if (filter) {
        filter.removeEventListener('change', handleSmartFilter);
        filter.addEventListener('change', handleSmartFilter);
    }
}

function handleSmartFilter() {
    loadSmartSignalsPage();
}

// ==========================================
// Refresh
// ==========================================

export async function refreshSmartSignals() {
    if (typeof clearAllScannerCache === 'function') clearAllScannerCache();
    smartSortColumn = -1;
    await loadSmartSignalsPage();
    showToast('✅ Smart Signals refreshed!', 'success');
}

console.log('✅ smart-signals.js loaded');