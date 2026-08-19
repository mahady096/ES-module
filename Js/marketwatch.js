// ==========================================
// 📊 marketwatch.js - Watch List & Full Market View
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, chunkArray, debounce, getUnifiedPrice } from './core.js';
import { showToast } from './app-charts.js';

const WATCHLIST_STORAGE_KEY = 'market_watch_list';
const MARKET_DATA_CACHE_KEY = 'market_full_view_data';
const MARKET_CACHE_TTL = 600000;

// ==========================================
// Watchlist Functions
// ==========================================

export function getWatchList() {
    try {
        const data = localStorage.getItem(WATCHLIST_STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

export function saveWatchList(list) {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list));
}

export function addToWatchList(ticker) {
    if (!ticker) return;
    const list = getWatchList();
    if (list.includes(ticker)) {
        showToast(`${ticker} already in watchlist`, 'warning');
        return;
    }
    list.push(ticker);
    saveWatchList(list);
    showToast(`✅ ${ticker} added to watchlist`, 'success');
    refreshWatchList();
}

export function removeFromWatchList(ticker) {
    let list = getWatchList();
    list = list.filter(t => t !== ticker);
    saveWatchList(list);
    showToast(`🗑️ ${ticker} removed from watchlist`, 'info');
    refreshWatchList();
}

export async function refreshWatchList() {
    const list = getWatchList();
    const countEl = document.getElementById('watchlist-count');
    const badgeEl = document.getElementById('watchlist-count-badge');
    if (countEl) countEl.innerText = list.length;
    if (badgeEl) badgeEl.innerText = list.length;

    if (list.length === 0) {
        renderMarketTable([], 'watchlist-table-body', true);
        return;
    }

    const allData = await loadFullMarketData(false);
    if (!allData) return;

    const filtered = allData.filter(item => list.includes(item.ticker));
    const finalData = list.map(ticker => {
        const found = filtered.find(item => item.ticker === ticker);
        if (found) return found;
        return {
            ticker: ticker,
            category: 'N/A',
            currentPrice: 0,
            changes: { '1d': { changePct: 0 }, '3d': { changePct: 0 }, '7d': { changePct: 0 }, '15d': { changePct: 0 }, '30d': { changePct: 0 } }
        };
    });

    renderMarketTable(finalData, 'watchlist-table-body', true);
}

// ==========================================
// Market Data Functions
// ==========================================

function getCachedMarketData() {
    try {
        const cached = sessionStorage.getItem(MARKET_DATA_CACHE_KEY);
        if (!cached) return null;
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < MARKET_CACHE_TTL) {
            return parsed.data;
        }
        return null;
    } catch { return null; }
}

function setCachedMarketData(data) {
    try {
        sessionStorage.setItem(MARKET_DATA_CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: data
        }));
    } catch (e) { console.warn('Cache save failed:', e); }
}

export async function loadFullMarketData(forceRefresh = false) {
    if (!forceRefresh) {
        const cached = getCachedMarketData();
        if (cached) {
            console.log('✅ Full market data loaded from cache');
            return cached;
        }
    }

    const user = auth.currentUser;
    if (!user) {
        showToast('Please login first', 'error');
        return null;
    }

    try {
        const tickers = dseStocks;
        if (tickers.length === 0) {
            showToast('No stock list available.', 'error');
            return [];
        }

        const allData = [];
        const batchSize = 10;

        for (let i = 0; i < tickers.length; i += batchSize) {
            const batch = tickers.slice(i, i + batchSize);
            const promises = batch.map(async (ticker) => {
                try {
                    const priceData = await getHistoricalPrices(ticker);
                    let category = 'N/A';
                    if (typeof supabase !== 'undefined' && supabase) {
                        try {
                            const { data } = await supabase
                                .from('cse_market_data')
                                .select('category')
                                .eq('code', ticker)
                                .order('date', { ascending: false })
                                .limit(1);
                            if (data && data.length > 0) {
                                category = data[0].category || 'N/A';
                            }
                        } catch (e) {}
                    }
                    return {
                        ticker: ticker,
                        category: category,
                        currentPrice: priceData.currentPrice,
                        changes: priceData.changes
                    };
                } catch (err) {
                    return null;
                }
            });

            const results = await Promise.all(promises);
            const valid = results.filter(r => r !== null && r.currentPrice > 0);
            allData.push(...valid);
        }

        setCachedMarketData(allData);
        console.log(`✅ Full market data loaded: ${allData.length} stocks`);
        return allData;

    } catch (error) {
        console.error('Market data load error:', error);
        showToast('Error loading market data', 'error');
        return null;
    }
}

async function getHistoricalPrices(ticker) {
    const periods = [1, 3, 7, 15, 30];
    const result = { currentPrice: 0, changes: {} };
    
    try {
        const latestPrice = await getUnifiedPrice(ticker);
        result.currentPrice = latestPrice || 0;
        
        for (const days of periods) {
            const date = new Date();
            date.setDate(date.getDate() - days);
            const dateStr = date.toISOString().split('T')[0];
            
            let price = 0;
            if (typeof supabase !== 'undefined' && supabase) {
                try {
                    const { data } = await supabase
                        .from('cse_market_data')
                        .select('ltp')
                        .eq('code', ticker)
                        .eq('date', dateStr)
                        .limit(1);
                    if (data && data.length > 0) {
                        price = parseFloat(data[0].ltp) || 0;
                    }
                } catch (e) {}
            }
            if (price === 0 && typeof db !== 'undefined') {
                try {
                    const snap = await db.collection('daily_prices')
                        .where('ticker', '==', ticker)
                        .where('date', '==', dateStr)
                        .limit(1)
                        .get();
                    if (!snap.empty) {
                        const data = snap.docs[0].data();
                        price = parseFloat(data.price) || parseFloat(data.close) || 0;
                    }
                } catch (e) {}
            }
            
            let changePct = 0;
            if (price > 0 && result.currentPrice > 0) {
                changePct = ((result.currentPrice - price) / price) * 100;
            }
            result.changes[`${days}d`] = {
                price: price || 0,
                changePct: changePct
            };
        }
    } catch (err) {
        console.warn(`Error fetching historical prices for ${ticker}:`, err);
    }
    
    return result;
}

// ==========================================
// Render Functions
// ==========================================

function renderMarketTable(data, containerId, isWatchList = false) {
    const tbody = document.getElementById(containerId);
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">
            ${isWatchList ? 'No stocks in watchlist. Search and add above.' : 'No market data available.'}
        </td></tr>`;
        return;
    }

    let html = '';
    data.forEach(item => {
        const price = item.currentPrice || 0;
        const ch1d = item.changes?.['1d']?.changePct || 0;
        const ch3d = item.changes?.['3d']?.changePct || 0;
        const ch7d = item.changes?.['7d']?.changePct || 0;
        const ch15d = item.changes?.['15d']?.changePct || 0;
        const ch30d = item.changes?.['30d']?.changePct || 0;

        const formatPct = (val) => {
            const sign = val >= 0 ? '+' : '';
            const color = val >= 0 ? '#10b981' : '#ef4444';
            return `<span style="color:${color}; font-weight:600;">${sign}${val.toFixed(2)}%</span>`;
        };

        html += `<tr onclick="if(window.openStockDetailModal) window.openStockDetailModal('${item.ticker}')" style="cursor:pointer;">`;
        html += `<td style="padding:10px; font-weight:bold; color:var(--primary-color); text-decoration:underline;">${item.ticker}</td>`;
        html += `<td style="padding:10px;">${item.category}</td>`;
        html += `<td style="padding:10px; text-align:right; font-weight:600;">৳${price.toFixed(2)}</td>`;
        html += `<td style="padding:10px; text-align:right;">${formatPct(ch1d)}</td>`;
        html += `<td style="padding:10px; text-align:right;">${formatPct(ch3d)}</td>`;
        html += `<td style="padding:10px; text-align:right;">${formatPct(ch7d)}</td>`;
        html += `<td style="padding:10px; text-align:right;">${formatPct(ch15d)}</td>`;
        html += `<td style="padding:10px; text-align:right;">${formatPct(ch30d)}</td>`;
        if (isWatchList) {
            html += `<td style="padding:10px; text-align:center;">
                <button onclick="event.stopPropagation(); window.removeFromWatchList('${item.ticker}')" 
                        style="background:#ef4444; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px;">✖</button>
            </td>`;
        }
        html += `</tr>`;
    });
    tbody.innerHTML = html;
}

// ==========================================
// Full View Functions
// ==========================================

let fullViewData = [];
let fullViewSortColumn = null;
let fullViewSortDirection = 'asc';

export function renderFullView(data) {
    fullViewData = data;
    renderMarketTable(data, 'fullview-table-body', false);
    const countEl = document.getElementById('fullview-count');
    const badgeEl = document.getElementById('fullview-count-badge');
    if (countEl) countEl.innerText = data.length;
    if (badgeEl) badgeEl.innerText = data.length;
}

export function sortFullView(columnIndex) {
    if (fullViewData.length === 0) return;
    
    if (fullViewSortColumn === columnIndex) {
        fullViewSortDirection = fullViewSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        fullViewSortColumn = columnIndex;
        fullViewSortDirection = 'asc';
    }

    const sorted = [...fullViewData].sort((a, b) => {
        let aVal, bVal;
        switch(columnIndex) {
            case 0: aVal = a.ticker; bVal = b.ticker; break;
            case 1: aVal = a.category; bVal = b.category; break;
            case 2: aVal = a.currentPrice; bVal = b.currentPrice; break;
            case 3: aVal = a.changes?.['1d']?.changePct || 0; bVal = b.changes?.['1d']?.changePct || 0; break;
            case 4: aVal = a.changes?.['3d']?.changePct || 0; bVal = b.changes?.['3d']?.changePct || 0; break;
            case 5: aVal = a.changes?.['7d']?.changePct || 0; bVal = b.changes?.['7d']?.changePct || 0; break;
            case 6: aVal = a.changes?.['15d']?.changePct || 0; bVal = b.changes?.['15d']?.changePct || 0; break;
            case 7: aVal = a.changes?.['30d']?.changePct || 0; bVal = b.changes?.['30d']?.changePct || 0; break;
            default: aVal = a.ticker; bVal = b.ticker;
        }
        if (typeof aVal === 'string') {
            return fullViewSortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return fullViewSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    renderMarketTable(sorted, 'fullview-table-body', false);
    updateSortIndicators(columnIndex);
}

function updateSortIndicators(columnIndex) {
    const headers = document.querySelectorAll('#fullview-table thead th');
    headers.forEach((th, idx) => {
        const existing = th.querySelector('.sort-arrow');
        if (existing) existing.remove();
        if (idx === columnIndex) {
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.style.marginLeft = '5px';
            arrow.textContent = fullViewSortDirection === 'asc' ? ' ▲' : ' ▼';
            th.appendChild(arrow);
        }
    });
}

// ==========================================
// Tab Switching
// ==========================================

export function switchMarketWatchTab(tab) {
    const containers = {
        watchlist: document.getElementById('market-watchlist-container'),
        fullview: document.getElementById('market-fullview-container')
    };
    const tabs = {
        watchlist: document.getElementById('market-tab-watchlist'),
        fullview: document.getElementById('market-tab-fullview')
    };

    Object.values(containers).forEach(c => { if (c) c.style.display = 'none'; });
    Object.values(tabs).forEach(t => {
        if (t) {
            t.style.background = 'transparent';
            t.style.color = 'var(--text-primary)';
            t.style.border = '1px solid var(--border-color)';
        }
    });

    if (tab === 'watchlist' && containers.watchlist) {
        containers.watchlist.style.display = 'block';
        if (tabs.watchlist) {
            tabs.watchlist.style.background = 'var(--primary-color)';
            tabs.watchlist.style.color = 'white';
            tabs.watchlist.style.border = 'none';
        }
        refreshWatchList();
    } else if (tab === 'fullview' && containers.fullview) {
        containers.fullview.style.display = 'block';
        if (tabs.fullview) {
            tabs.fullview.style.background = 'var(--primary-color)';
            tabs.fullview.style.color = 'white';
            tabs.fullview.style.border = 'none';
        }
        if (fullViewData.length > 0) renderFullView(fullViewData);
        else loadFullMarketData(false).then(data => { if (data) renderFullView(data); });
    }
}

// ==========================================
// Watchlist Search
// ==========================================

export function initWatchlistSearch() {
    const searchInput = document.getElementById('watchlist-search');
    const suggestionBox = document.getElementById('watchlist-suggestions');
    const addBtn = document.getElementById('watchlist-add-btn');

    if (!searchInput) return;

    const showSuggestions = function(query) {
        suggestionBox.innerHTML = '';
        suggestionBox.classList.add('hidden');
        
        const trimmed = query.trim().toUpperCase();
        if (!trimmed || trimmed.length === 0) return;

        const filtered = dseStocks
            .filter(stock => stock.toUpperCase().startsWith(trimmed))
            .slice(0, 10);

        if (filtered.length > 0) {
            suggestionBox.classList.remove('hidden');
            filtered.forEach(stock => {
                const div = document.createElement('div');
                div.classList.add('suggestion-item');
                div.innerText = stock;
                div.style.cssText = `
                    cursor: pointer;
                    padding: 10px 16px;
                    border-bottom: 1px solid var(--border-color, #e2e8f0);
                    transition: background 0.2s;
                    font-size: 14px;
                    color: var(--text-primary, #1e293b);
                `;
                div.onmouseover = function() { this.style.background = 'var(--hover-bg, #f1f5f9)'; };
                div.onmouseout = function() { this.style.background = 'transparent'; };
                div.onclick = function(e) {
                    e.stopPropagation();
                    const ticker = this.innerText.trim();
                    searchInput.value = ticker;
                    suggestionBox.classList.add('hidden');
                    addToWatchList(ticker);
                    searchInput.value = '';
                };
                suggestionBox.appendChild(div);
            });
        } else {
            suggestionBox.classList.add('hidden');
        }
    };

    const debouncedSearch = debounce(showSuggestions, 250);

    searchInput.addEventListener('input', function() {
        const query = this.value;
        debouncedSearch(query);
    });

    searchInput.addEventListener('focus', function() {
        const query = this.value.trim();
        if (query) debouncedSearch(query);
    });

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = this.value.trim().toUpperCase();
            const firstSuggestion = suggestionBox.querySelector('.suggestion-item');
            if (firstSuggestion) {
                firstSuggestion.click();
            } else if (query) {
                if (dseStocks.includes(query)) {
                    addToWatchList(query);
                    this.value = '';
                    suggestionBox.classList.add('hidden');
                } else {
                    showToast('Share not found. Please select from suggestions.', 'warning');
                }
            }
        }
    });

    if (addBtn) {
        addBtn.addEventListener('click', function() {
            const query = searchInput.value.trim().toUpperCase();
            if (!query) {
                showToast('Please type a share name first.', 'warning');
                return;
            }
            if (dseStocks.includes(query)) {
                addToWatchList(query);
                searchInput.value = '';
                suggestionBox.classList.add('hidden');
            } else {
                showToast('Share not found. Please select from suggestions.', 'warning');
            }
        });
    }

    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !suggestionBox.contains(e.target)) {
            suggestionBox.classList.add('hidden');
        }
    });
}

// ==========================================
// Page Load
// ==========================================

export async function loadMarketWatchPage() {
    try {
        initWatchlistSearch();
        switchMarketWatchTab('watchlist');
        await refreshWatchList();
        const data = await loadFullMarketData(false);
        if (data) {
            renderFullView(data);
        }
    } catch (error) {
        console.error('Market watch page error:', error);
        showToast('Error loading market watch', 'error');
    }
}

console.log('✅ marketwatch.js loaded');