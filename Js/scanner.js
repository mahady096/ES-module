// ==========================================
// 🔍 scanner.js - সম্পূর্ণ ইরর-ফ্রি ভার্সন v6.0
//    All Scanner (PSAR + RSI) - Supabase-first + Firebase-fallback
//    RSI Indicator Section সহ
//    ⚡ ব্যাচ কোয়েরি দিয়ে পারফরম্যান্স অপটিমাইজড
//    🕐 ডায়নামিক ক্যাশ TTL (মার্কেট সময় অনুযায়ী)
//    ✅ পোর্টফোলিও ফিল্টার সাপোর্ট
//    ✅ null-check সহ ইরর হ্যান্ডলিং
//    ✅ সব ট্যাবের জন্য আলাদা ডেটা লোড
//    ✅ Category → cse_market_data (Supabase first)
//    ✅ ATH/ATL/RSI/PSAR → history_dse (Supabase first)
//    ✅ ইন্ডিকেটর ফাংশন indicators.js থেকে নেওয়া
//    ⚡ requestIdleCallback দিয়ে UI ফ্রিজ কমানো
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, chunkArray, debounce, getUnifiedPrice } from './core.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR, cachedRSI, cachedParabolicSAR } from './indicators.js';
import { unifiedEngine } from './app-dashboard.js';
import { getLatestAndPreviousPrices } from './core.js';

// ==========================================
// 📦 ক্যাশ ম্যানেজমেন্ট
// ==========================================
const ALL_SCANNER_CACHE_KEY = 'all_scanner_data';
const ALL_SCANNER_CACHE_TTL = 3600000; // ১ ঘন্টা

function getScannerCacheTTL() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const day = now.getDay();
    const totalMinutes = hours * 60 + minutes;
    const isMarketDay = (day >= 0 && day <= 4);
    const marketOpen = 9 * 60;
    const marketClose = 15 * 60;

    if (!isMarketDay || totalMinutes < marketOpen || totalMinutes >= marketClose) {
        let nextDay = new Date(now);
        let daysToAdd = 0;
        do {
            daysToAdd++;
            nextDay.setDate(now.getDate() + daysToAdd);
        } while (nextDay.getDay() > 4 || nextDay.getDay() < 0);
        const nextOpen = new Date(nextDay);
        nextOpen.setHours(9, 0, 0, 0);
        return Math.max(nextOpen.getTime() - now.getTime(), 0);
    } else {
        return 2 * 60 * 60 * 1000;
    }
}

function getAllScannerCache() {
    try {
        const cached = sessionStorage.getItem(ALL_SCANNER_CACHE_KEY);
        if (!cached) return null;
        const parsed = JSON.parse(cached);
        const ttl = parsed.ttl || ALL_SCANNER_CACHE_TTL;
        if (Date.now() - parsed.timestamp < ttl) return parsed.data;
        return null;
    } catch (e) { return null; }
}

function setAllScannerCache(data, ttl = null) {
    try {
        const payload = { timestamp: Date.now(), data: data };
        if (ttl) payload.ttl = ttl;
        sessionStorage.setItem(ALL_SCANNER_CACHE_KEY, JSON.stringify(payload));
    } catch (e) { console.warn('Cache save failed:', e); }
}

export function clearAllScannerCache() {
    try { sessionStorage.removeItem(ALL_SCANNER_CACHE_KEY); } catch (e) { /* ignore */ }
}

// ==========================================
// 🔍 All Scanner ডেটা লোডার (Supabase-first + requestIdleCallback)
// ==========================================
export async function loadAllScannerData(forceRefresh = false, onProgress = null) {
    if (!forceRefresh) {
        const cached = getAllScannerCache();
        if (cached) {
            console.log('✅ All Scanner data loaded from cache');
            if (typeof onProgress === 'function') onProgress(cached.length, cached.length);
            return cached;
        }
    }
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return null;
    }
    try {
        let tickers = dseStocks;
        if (tickers.length === 0) {
            showToast('No stock list available.', 'error');
            return [];
        }

        console.log(`📊 Scanning ${tickers.length} stocks...`);
        if (typeof onProgress === 'function') onProgress(0, tickers.length);

        const allResults = [];
        const BATCH_SIZE = 10;
        let supabasePriceMap = new Map();

        // ---------- ১. লাইভ প্রাইস ও ক্যাটাগরি (Supabase cse_market_data first) ----------
        if (typeof supabase !== 'undefined' && supabase) {
            const supabaseChunks = chunkArray(tickers, BATCH_SIZE);
            for (const chunk of supabaseChunks) {
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
                } catch (e) { console.warn('Supabase cse_market_data batch fetch failed:', e); }
            }
        }

        // ---------- ২. Firebase cse_detailed_data থেকে ক্যাটাগরি ফ্যালব্যাক ----------
        if (supabasePriceMap.size === 0 && typeof db !== 'undefined') {
            try {
                const fbChunks = chunkArray(tickers, BATCH_SIZE);
                for (const chunk of fbChunks) {
                    const snap = await db.collection('cse_detailed_data')
                        .where('code', 'in', chunk)
                        .orderBy('date', 'desc')
                        .limit(1)
                        .get();
                    if (!snap.empty) {
                        snap.forEach(doc => {
                            const data = doc.data();
                            const code = data.code;
                            if (code && !supabasePriceMap.has(code)) {
                                supabasePriceMap.set(code, {
                                    ltp: parseFloat(data.ltp) || 0,
                                    high: parseFloat(data.high) || 0,
                                    low: parseFloat(data.low) || 0,
                                    category: data.category || 'N/A'
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('Firebase cse_detailed_data category fallback failed:', e);
            }
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const startDateStr = startDate.toISOString().split('T')[0];

        let allHistoricData = [];

        // ---------- ৩. ঐতিহাসিক ডেটা (ATH/ATL/RSI/PSAR) → Supabase history_dse ----------
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const supabaseHistChunks = chunkArray(tickers, BATCH_SIZE);
                for (const chunk of supabaseHistChunks) {
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
            } catch (e) {
                console.warn('Supabase history_dse fetch failed in scanner:', e);
            }
        }

        // ---------- ৪. যদি history_dse-এ না থাকে, Firebase cse_detailed_data ফ্যালব্যাক ----------
        if (allHistoricData.length === 0 && typeof db !== 'undefined') {
            try {
                const firebaseChunks = chunkArray(tickers, BATCH_SIZE);
                for (const chunk of firebaseChunks) {
                    const snap = await db.collection('cse_detailed_data')
                        .where('code', 'in', chunk)
                        .where('date', '>=', startDateStr)
                        .orderBy('date', 'asc')
                        .get();
                    if (!snap.empty) {
                        snap.forEach(doc => {
                            const data = doc.data();
                            const ltp = parseFloat(data.ltp);
                            if (ltp > 0) {
                                allHistoricData.push({
                                    code: data.code,
                                    date: data.date,
                                    ltp: ltp,
                                    high: parseFloat(data.high) || ltp,
                                    low: parseFloat(data.low) || ltp
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('Firebase cse_detailed_data fallback failed:', e);
            }
        }

        // গ্রুপিং
        const groupedData = {};
        allHistoricData.forEach(item => {
            if (!groupedData[item.code]) groupedData[item.code] = [];
            groupedData[item.code].push(item);
        });

        // ==========================================
        // 🔥 requestIdleCallback দিয়ে ব্যাচ প্রসেস
        // ==========================================
        let currentBatchIndex = 0;

        function processNextBatch() {
            if (currentBatchIndex >= tickers.length) {
                const ttl = getScannerCacheTTL();
                setAllScannerCache(allResults, ttl);
                console.log(`✅ All Scanner loaded: ${allResults.length} stocks`);
                if (typeof onProgress === 'function') {
                    onProgress(allResults.length, allResults.length);
                }
                if (typeof window._scannerComplete === 'function') {
                    window._scannerComplete(allResults);
                }
                return;
            }

            const batch = tickers.slice(currentBatchIndex, currentBatchIndex + BATCH_SIZE);
            currentBatchIndex += BATCH_SIZE;

            const batchPromises = batch.map(async (ticker) => {
                try {
                    const priceData = groupedData[ticker] || [];
                    if (priceData.length < 15) return null;

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

                    return {
                        ticker: ticker,
                        currentPrice: currentPrice,
                        sar: lastSAR ? lastSAR.sar : currentPrice,
                        trend: lastSAR ? lastSAR.trend : 'up',
                        rsi: lastRSI !== null ? lastRSI : null,
                        category: category,
                        ath: ath,
                        atl: atl
                    };
                } catch (err) {
                    console.warn(`Error processing ${ticker}:`, err);
                    return null;
                }
            });

            Promise.all(batchPromises).then((results) => {
                const valid = results.filter(r => r !== null);
                allResults.push(...valid);

                if (typeof onProgress === 'function') {
                    onProgress(currentBatchIndex, tickers.length);
                }

                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => processNextBatch(), { timeout: 2000 });
                } else {
                    setTimeout(() => processNextBatch(), 50);
                }
            }).catch((err) => {
                console.error('Batch processing error:', err);
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => processNextBatch(), { timeout: 2000 });
                } else {
                    setTimeout(() => processNextBatch(), 50);
                }
            });
        }

        return new Promise((resolve) => {
            window._scannerComplete = function(data) {
                resolve(data);
                delete window._scannerComplete;
            };
            processNextBatch();
        });

    } catch (error) {
        console.error('All Scanner load error:', error);
        showToast('Error loading scanner data', 'error');
        return null;
    }
}

// ==========================================
// 🎯 Strong Buy/Sell ফিল্টার
// ==========================================
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

// ==========================================
// 🖥️ UI রেন্ডারিং
// ==========================================
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
        html += `<tr onclick="if(typeof openStockDetailModal === 'function') openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
        html += `<td style="padding:10px; font-weight:bold; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.currentPrice || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.sar || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right; color:${rsiColor}; font-weight:600;">${item.rsi !== null ? item.rsi.toFixed(2) : '-'}</td>`;
        html += `<td style="padding:10px; text-align:center; color:${signalColor}; font-weight:bold;">${signalText}</td>`;
        html += `</tr>`;
    });
    tbody.innerHTML = html;
}

function renderAllScannerAnalysisTable(data, ticker) {
    const tbody = document.getElementById('all-scanner-analysis-body');
    if (!tbody) return;
    if (!data || !Array.isArray(data) || data.length === 0 || !ticker) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Search a share to see details.</td></tr>`;
        return;
    }
    const item = data.find(d => d.ticker === ticker);
    if (!item) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No data found for ${ticker}</td></tr>`;
        return;
    }
    const isBuySignal = item.rsi < 30 && item.sar < item.currentPrice;
    const isSellSignal = item.rsi > 70 && item.sar > item.currentPrice;
    let signalText = '⚪ NEUTRAL', signalColor = '#64748b';
    if (isBuySignal) { signalText = '🟢🔥 STRONG BUY'; signalColor = '#059669'; }
    else if (isSellSignal) { signalText = '🔴🔥 STRONG SELL'; signalColor = '#dc2626'; }
    const rsiColor = item.rsi !== null ? (item.rsi < 30 ? '#10b981' : (item.rsi > 70 ? '#ef4444' : '#f59e0b')) : '#64748b';
    tbody.innerHTML = `
        <tr>
            <td style="padding:10px; font-weight:bold; color:var(--primary-color);">${item.ticker}</td>
            <td style="padding:10px; text-align:right;">৳${(item.currentPrice || 0).toFixed(2)}</td>
            <td style="padding:10px; text-align:right;">৳${(item.sar || 0).toFixed(2)}</td>
            <td style="padding:10px; text-align:right; color:${rsiColor}; font-weight:600;">${item.rsi !== null ? item.rsi.toFixed(2) : '-'}</td>
            <td style="padding:10px; text-align:center; color:${signalColor}; font-weight:bold;">${signalText}</td>
        </tr>
    `;
}

// ==========================================
// 🚀 All Scanner পেজ লোড
// ==========================================
export async function loadAllScannerPage() {
    const buyBody = document.getElementById('all-scanner-buy-body');
    const sellBody = document.getElementById('all-scanner-sell-body');
    const analysisBody = document.getElementById('all-scanner-analysis-body');
    const updateTime = document.getElementById('all-scanner-update-time');

    if (buyBody) buyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">⏳ Scanning market...</td></tr>';
    if (sellBody) sellBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">⏳ Scanning market...</td></tr>';
    if (analysisBody) analysisBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px;">🔍 Search a share above</td></tr>';

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

        window._allScannerData = allData;
        initAllScannerSearch(allData);

        if (updateTime) updateTime.innerText = new Date().toLocaleString();
        switchAllScannerTab('buy');
    } catch (error) {
        console.error('All Scanner error:', error);
        if (buyBody) buyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:red;">❌ Error loading data</td></tr>';
    }
}

function initAllScannerSearch(allData) {
    const searchInput = document.getElementById('all-scanner-analysis-search');
    const searchBtn = document.getElementById('all-scanner-analysis-search-btn');
    const suggestionBox = document.getElementById('all-scanner-analysis-suggestions');
    if (!searchInput) return;

    const searchHandler = function() {
        const query = searchInput.value.trim().toUpperCase();
        if (query) renderAllScannerAnalysisTable(allData, query);
        else {
            const tbody = document.getElementById('all-scanner-analysis-body');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Type a share name and click Search</td></tr>';
        }
    };
    searchInput.onkeypress = function(e) { if (e.key === 'Enter') searchHandler(); };
    if (searchBtn) searchBtn.onclick = searchHandler;
    if (!suggestionBox) return;

    let stockList = dseStocks;

    searchInput.oninput = function() {
        const query = this.value.trim().toUpperCase();
        suggestionBox.innerHTML = '';
        if (!query) { suggestionBox.classList.add('hidden'); return; }
        const filtered = stockList.filter(stock => stock.startsWith(query)).slice(0, 10);
        if (filtered.length > 0) {
            suggestionBox.classList.remove('hidden');
            filtered.forEach(stock => {
                const div = document.createElement('div');
                div.classList.add('suggestion-item');
                div.innerText = stock;
                div.onclick = function() {
                    searchInput.value = stock;
                    suggestionBox.classList.add('hidden');
                    renderAllScannerAnalysisTable(allData, stock);
                };
                suggestionBox.appendChild(div);
            });
        } else {
            suggestionBox.classList.add('hidden');
        }
    };
    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !suggestionBox.contains(e.target)) {
            suggestionBox.classList.add('hidden');
        }
    });
}

export function switchAllScannerTab(tab) {
    const containers = {
        buy: document.getElementById('all-scanner-buy-container'),
        sell: document.getElementById('all-scanner-sell-container'),
        analysis: document.getElementById('all-scanner-analysis-container')
    };
    const tabs = {
        buy: document.getElementById('all-scanner-tab-buy'),
        sell: document.getElementById('all-scanner-tab-sell'),
        analysis: document.getElementById('all-scanner-tab-analysis')
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
    } else if (tab === 'analysis' && containers.analysis) {
        containers.analysis.style.display = 'block';
        if (tabs.analysis) {
            tabs.analysis.style.background = 'var(--primary-color)';
            tabs.analysis.style.color = 'white';
            tabs.analysis.style.border = 'none';
        }
    }
}

export async function refreshAllScannerPage() {
    clearAllScannerCache();
    await loadAllScannerPage();
    showToast('✅ All Scanner refreshed!', 'success');
}

// ==========================================
// 📊 RSI Indicator Section (Supabase-first)
// ==========================================
let currentRSITab = 'buy';
let cachedRSIData = null;

export async function loadRSIIndicatorPage() {
    const buyBody = document.getElementById('rsi-buy-body');
    const sellBody = document.getElementById('rsi-sell-body');
    const updateTime = document.getElementById('rsi-update-time');

    if (buyBody) buyBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">⏳ Loading RSI data...</td></tr>';
    if (sellBody) sellBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">⏳ Loading RSI data...</td></tr>';

    try {
        let allData = getAllScannerCache();
        if (!allData) {
            showToast('📊 Loading market data for RSI...', 'info');
            allData = await loadAllScannerData(true);
        }
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
        html += `<tr onclick="if(typeof openStockDetailModal === 'function') openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
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
    currentRSITab = tab;
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
    clearAllScannerCache();
    await loadRSIIndicatorPage();
    showToast('✅ RSI Indicator refreshed!', 'success');
}

// ==========================================
// 📌 Screener - Parabolic SAR (Supabase-first)
// ==========================================
let currentScreenerTab = 'buy';
let screenerDataCache = null;
let screenerCacheTime = 0;
const SCREENER_CACHE_TTL = 300000;

export async function loadScreenerData(tab = 'buy', portfolioId = null) {
    currentScreenerTab = tab;
    const tbody = document.getElementById('screener-table-body');
    if (!tbody) return;

    const tabBuy = document.getElementById('screener-tab-buy');
    const tabSell = document.getElementById('screener-tab-sell');
    if (tabBuy && tabSell) {
        [tabBuy, tabSell].forEach(btn => {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.border = '1px solid var(--border-color)';
            btn.style.color = 'var(--text-primary)';
        });
        const activeBtn = document.getElementById(`screener-tab-${tab}`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.style.background = 'var(--primary-color)';
            activeBtn.style.color = 'white';
            activeBtn.style.border = 'none';
        }
    }

    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">⏳ Loading screener data...</td></tr>`;

    try {
        const user = auth && auth.currentUser ? auth.currentUser : null;
        if (!user) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:red;">Please login first.</td></tr>`;
            return;
        }

        const now = Date.now();
        if (screenerDataCache && (now - screenerCacheTime) < SCREENER_CACHE_TTL) {
            renderScreenerTable(tab, screenerDataCache);
            return;
        }

        const unifiedData = await unifiedEngine.calculate(user.uid, portfolioId || null, true);
        if (!unifiedData || !unifiedData.stockDetails || unifiedData.stockDetails.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No holdings found. Add stocks to screen.</td></tr>`;
            return;
        }

        const tickers = unifiedData.stockDetails.map(s => s.ticker);
        const start = new Date();
        start.setDate(start.getDate() - 30);
        const startDateStr = start.toISOString().split('T')[0];
        const screenerResults = [];
        const batchSize = 10;

        for (let i = 0; i < tickers.length; i += batchSize) {
            const batchTickers = tickers.slice(i, i + batchSize);
            const promises = batchTickers.map(async (ticker) => {
                try {
                    let currentPrice = await getUnifiedPrice(ticker);
                    let priceData = [];

                    if (typeof supabase !== 'undefined' && supabase) {
                        try {
                            const { data, error } = await supabase
                                .from('history_dse')
                                .select('date, ltp, high, low')
                                .eq('ticker', ticker)
                                .gte('date', startDateStr)
                                .order('date', { ascending: true });
                            if (!error && data && data.length > 0) {
                                priceData = data.map(d => ({
                                    date: d.date,
                                    ltp: parseFloat(d.ltp),
                                    high: parseFloat(d.high) || parseFloat(d.ltp),
                                    low: parseFloat(d.low) || parseFloat(d.ltp)
                                }));
                            }
                        } catch (e) {
                            console.warn(`Supabase history_dse fetch failed for ${ticker} in screener:`, e);
                        }
                    }

                    if (priceData.length === 0 && typeof db !== 'undefined') {
                        try {
                            const snap = await db.collection('daily_prices')
                                .where('ticker', '==', ticker)
                                .where('date', '>=', startDateStr)
                                .orderBy('date', 'asc')
                                .get();
                            if (!snap.empty) {
                                snap.forEach(doc => {
                                    const data = doc.data();
                                    const price = parseFloat(data.price) || parseFloat(data.close) || 0;
                                    const high = parseFloat(data.high) || price;
                                    const low = parseFloat(data.low) || price;
                                    if (price > 0) {
                                        priceData.push({ date: data.date, ltp: price, high: high, low: low });
                                    }
                                });
                            }
                        } catch (e) { /* ignore */ }
                    }

                    if (priceData.length < 2) return null;
                    const sarData = calculateParabolicSAR(priceData);
                    const lastSAR = sarData[sarData.length - 1];
                    if (currentPrice === 0) currentPrice = priceData[priceData.length - 1]?.ltp || 0;
                    return { ticker: ticker, currentPrice: currentPrice, sar: lastSAR?.sar || currentPrice, trend: lastSAR?.trend || 'up' };
                } catch (err) {
                    console.warn(`Error processing ${ticker} in screener:`, err);
                    return null;
                }
            });
            const results = await Promise.all(promises);
            results.forEach(r => { if (r) screenerResults.push(r); });
        }

        screenerDataCache = screenerResults;
        screenerCacheTime = Date.now();
        renderScreenerTable(tab, screenerResults);

        const updateTime = document.getElementById('screener-update-time');
        if (updateTime) updateTime.innerText = new Date().toLocaleString();
    } catch (error) {
        console.error('Screener error:', error);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:red;">Error: ${error.message}</td></tr>`;
    }
}

function renderScreenerTable(tab, data) {
    const tbody = document.getElementById('screener-table-body');
    if (!tbody) return;
    if (!data || !Array.isArray(data) || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No ${tab} signals found.</td></tr>`;
        return;
    }
    const filtered = data.filter(item => {
        if (tab === 'buy') return item.currentPrice > item.sar;
        else return item.currentPrice < item.sar;
    });
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No ${tab} signals found.</td></tr>`;
        return;
    }
    filtered.sort((a, b) => Math.abs(a.currentPrice - a.sar) - Math.abs(b.currentPrice - b.sar));
    let html = '';
    for (const item of filtered) {
        const diff = item.currentPrice - item.sar;
        const signalText = diff > 0 ? '🟢 Buy' : '🔴 Sell';
        html += `<tr onclick="if(typeof openStockDetailModal === 'function') openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
        html += `<td style="padding:10px; font-weight:bold; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.currentPrice || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right;">৳${(item.sar || 0).toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:center; font-weight:bold;" class="${diff > 0 ? 'up' : 'error'}">${signalText}</td>`;
        html += `</tr>`;
    }
    tbody.innerHTML = html;
}

// ==========================================
// 💰 Buy Sell Price – ডেটা জেনারেটর (শুধু ডেটা, UI নয়)
// ==========================================
export async function getBuySellPriceSignalData() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return { buy: [], sell: [] };

    try {
        const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
        if (!unifiedData || !unifiedData.stockDetails || unifiedData.stockDetails.length === 0) {
            return { buy: [], sell: [] };
        }

        let salesData = [];
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data } = await supabase
                    .from('sales_history')
                    .select('share_name, quantity_sold, sell_price, date')
                    .eq('user_id', user.uid);
                if (data) salesData = data;
            } catch (e) { /* ignore */ }
        }
        if (salesData.length === 0 && typeof db !== 'undefined') {
            try {
                const snap = await db.collection('sales_history')
                    .where('userId', '==', user.uid)
                    .get();
                snap.forEach(doc => {
                    const data = doc.data();
                    salesData.push({
                        share_name: data.shareName,
                        quantity_sold: data.quantitySold || 0,
                        sell_price: data.sellPrice || 0,
                        date: data.date?.toDate?.()?.toISOString?.() || new Date().toISOString()
                    });
                });
            } catch (e) { /* ignore */ }
        }

        const tickers = unifiedData.stockDetails.map(s => s.ticker);
        const currentPrices = {};
        const pricePromises = tickers.map(async (ticker) => {
            const price = await getUnifiedPrice(ticker);
            currentPrices[ticker] = price || 0;
        });
        await Promise.all(pricePromises);

        const buySignals = [];
        const sellSignals = [];

        for (const stock of unifiedData.stockDetails) {
            const ticker = stock.ticker;
            const currentPrice = currentPrices[ticker] || 0;

            let minBuyPrice = Infinity;
            for (const lot of stock.lots) {
                if (lot.buyPrice < minBuyPrice) minBuyPrice = lot.buyPrice;
            }
            if (minBuyPrice === Infinity) minBuyPrice = 0;

            let maxSellPrice = 0;
            const tickerSales = salesData.filter(s => s.share_name === ticker);
            for (const sale of tickerSales) {
                if (sale.sell_price > maxSellPrice) maxSellPrice = sale.sell_price;
            }

            if (currentPrice > 0 && minBuyPrice > 0 && currentPrice < minBuyPrice) {
                buySignals.push({
                    ticker: ticker,
                    price: currentPrice,
                    minBuyPrice: minBuyPrice,
                    maxSellPrice: maxSellPrice,
                    rsi: null,
                    psar: null,
                    ath: null,
                    atl: null
                });
            } else if (currentPrice > 0 && maxSellPrice > 0 && currentPrice > maxSellPrice) {
                sellSignals.push({
                    ticker: ticker,
                    price: currentPrice,
                    minBuyPrice: minBuyPrice,
                    maxSellPrice: maxSellPrice,
                    rsi: null,
                    psar: null,
                    ath: null,
                    atl: null
                });
            }
        }

        buySignals.sort((a, b) => a.price - b.price);
        sellSignals.sort((a, b) => b.price - a.price);

        return { buy: buySignals, sell: sellSignals };
    } catch (error) {
        console.error('Error in getBuySellPriceSignalData:', error);
        return { buy: [], sell: [] };
    }
}

// ==========================================
// 📌 গ্লোবালি এক্সপোজ (window-এর জন্য)
// ==========================================
export default {
    loadAllScannerData,
    filterStrongBuySignals,
    filterStrongSellSignals,
    loadAllScannerPage,
    switchAllScannerTab,
    refreshAllScannerPage,
    loadRSIIndicatorPage,
    switchRSITab,
    refreshRSIIndicator,
    loadScreenerData,
    clearAllScannerCache,
    getBuySellPriceSignalData
};

console.log('✅ scanner.js v6.0 loaded successfully');