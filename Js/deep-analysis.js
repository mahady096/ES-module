// ==========================================
// 🔬 deep-analysis.js - 21-column Deep Analysis
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { safeParseDate, chunkArray } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR, cachedRSI, cachedParabolicSAR } from './indicators.js';

let deepAnalysisData = [];
let deepSortColumn = -1;
let deepSortAsc = true;
let expandedRows = {};
let deepFilterText = '';
let hiddenColumns = new Set();
let lotPage = {};
let currentPage = 1;
const PAGE_SIZE = 20;
const LOTS_PER_PAGE = 5;

// ==========================================
// Parse Record Date
// ==========================================

function parseRecordDate(dateStr) {
    if (!dateStr) return null;
    const cleaned = dateStr.replace(/,/g, '').trim();
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) return date;
    const parts = cleaned.split(' ');
    if (parts.length >= 3) {
        const day = parseInt(parts[0]);
        const month = parts[1];
        const year = parseInt(parts[2]);
        const monthMap = {
            'January':0,'February':1,'March':2,'April':3,'May':4,'June':5,
            'July':6,'August':7,'September':8,'October':9,'November':10,'December':11
        };
        const monthIdx = monthMap[month];
        if (!isNaN(day) && monthIdx !== undefined && !isNaN(year)) {
            return new Date(year, monthIdx, day);
        }
    }
    return null;
}

// ==========================================
// Main Load Function
// ==========================================

export async function loadDeepAnalysisPage() {
    const tbody = document.getElementById('deep-analysis-tbody');
    const updateTime = document.getElementById('deep-analysis-update-time');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="21" style="text-align:center; padding:40px;">⏳ Loading deep analysis...</td></tr>';
    if (updateTime) updateTime.innerText = new Date().toLocaleString();

    try {
        const user = auth && auth.currentUser ? auth.currentUser : null;
        if (!user) {
            tbody.innerHTML = '<tr><td colspan="21" style="text-align:center; padding:40px; color:red;">Please login first.</td></tr>';
            return;
        }

        const portfolioId = window._deepAnalysisPortfolio || null;
        const unifiedData = await unifiedEngine.calculate(user.uid, portfolioId, true);
        
        if (!unifiedData || !unifiedData.stockDetails || unifiedData.stockDetails.length === 0) {
            tbody.innerHTML = '<tr><td colspan="21" style="text-align:center; padding:40px; color:var(--text-muted);">No holdings found.</td></tr>';
            return;
        }

        const tickers = unifiedData.stockDetails.map(s => s.ticker);
        
        // Fetch metadata for each ticker
        const metaPromises = tickers.map(async (ticker) => {
            try {
                let category = 'N/A', recordDate = null;
                let ath = 0, atl = Infinity;
                let rsi = null, psar = 0;
                let eps = null;

                // ATH/ATL/RSI/PSAR from history_dse
                if (typeof supabase !== 'undefined' && supabase) {
                    try {
                        const { data, error } = await supabase
                            .from('history_dse')
                            .select('date, ltp, high, low')
                            .eq('ticker', ticker)
                            .order('date', { ascending: true });

                        if (!error && data && data.length > 0) {
                            data.forEach(d => {
                                const ltp = parseFloat(d.ltp);
                                const high = parseFloat(d.high) || ltp;
                                const low = parseFloat(d.low) || ltp;
                                if (ltp > ath) ath = ltp;
                                if (ltp > 0 && ltp < atl) atl = ltp;
                                if (high > ath) ath = high;
                                if (low > 0 && low < atl) atl = low;
                            });
                            if (atl === Infinity) atl = 0;

                            if (data.length >= 15) {
                                const priceData = data.slice(-30).map(d => ({
                                    date: d.date,
                                    ltp: parseFloat(d.ltp),
                                    high: parseFloat(d.high) || parseFloat(d.ltp),
                                    low: parseFloat(d.low) || parseFloat(d.ltp)
                                }));
                                const rsiData = cachedRSI(priceData.map(p => p.ltp), 14);
                                const lastRsi = rsiData.filter(r => r.rsi !== null).pop();
                                rsi = lastRsi ? lastRsi.rsi : null;
                                const psarData = cachedParabolicSAR(priceData);
                                psar = psarData.length > 0 ? psarData[psarData.length - 1].sar : 0;
                            }
                        }
                    } catch (e) { /* ignore */ }
                }

                // Category/Record Date/EPS from cse_market_data
                if (typeof supabase !== 'undefined' && supabase) {
                    try {
                        const { data, error } = await supabase
                            .from('cse_market_data')
                            .select('category, record_date, eps')
                            .eq('code', ticker)
                            .order('date', { ascending: false })
                            .limit(1);
                        if (!error && data && data.length > 0) {
                            category = data[0].category || 'N/A';
                            recordDate = data[0].record_date || null;
                            eps = data[0].eps !== undefined && data[0].eps !== null ? parseFloat(data[0].eps) : null;
                        }
                    } catch (e) { /* ignore */ }
                }

                return { ticker, category, recordDate, ath, atl, rsi, psar, eps };
            } catch (e) {
                return { ticker, category: 'N/A', recordDate: null, ath: 0, atl: 0, rsi: null, psar: 0, eps: null };
            }
        });
        const metaResults = await Promise.all(metaPromises);
        const metaMap = new Map();
        metaResults.forEach(m => metaMap.set(m.ticker, m));

        // Build rows
        const rows = [];
        for (let i = 0; i < unifiedData.stockDetails.length; i++) {
            const stock = unifiedData.stockDetails[i];
            const ticker = stock.ticker;
            const currentPrice = await getUnifiedPrice(ticker);
            const remainingQty = stock.totalQty || 0;
            const avgBuyWithComm = stock.avgBuyPriceWithCommission || 0;
            const buyCostWithComm = remainingQty * avgBuyWithComm;
            const currentValue = remainingQty * currentPrice;
            const unrealizedPL = currentValue - buyCostWithComm;
            const unrealizedPct = buyCostWithComm > 0 ? (unrealizedPL / buyCostWithComm) * 100 : 0;

            const meta = metaMap.get(ticker) || {};
            const recordDate = meta.recordDate || null;
            let daysLeft = null;
            if (recordDate) {
                const recDate = parseRecordDate(recordDate);
                if (recDate) {
                    const diff = Math.ceil((recDate - new Date()) / (1000 * 60 * 60 * 24));
                    daysLeft = diff;
                }
            }

            const ath = meta.ath || 0;
            const atl = meta.atl || 0;
            const rsi = meta.rsi !== undefined ? meta.rsi : null;
            const psar = meta.psar || 0;
            const eps = meta.eps !== undefined && meta.eps !== null ? meta.eps : null;

            // Signal
            let signal = 'NEUTRAL';
            let signalClass = '';
            const nearATH = (ath > 0 && currentPrice >= 0.90 * ath);
            const nearATL = (atl > 0 && currentPrice <= 1.10 * atl);
            const highUnrealized = (unrealizedPct > 20);
            const veryNegativeUnrealized = (unrealizedPct < -20);
            const rsiOverbought = (rsi !== null && rsi > 70);
            const rsiOversold = (rsi !== null && rsi < 30);
            const psarSell = (psar > 0 && psar > currentPrice);
            const psarBuy = (psar > 0 && psar < currentPrice);

            let sellScore = 0, buyScore = 0;
            if (nearATH) sellScore++;
            if (highUnrealized) sellScore++;
            if (rsiOverbought) sellScore++;
            if (psarSell) sellScore++;

            if (nearATL) buyScore++;
            if (veryNegativeUnrealized) buyScore++;
            if (rsiOversold) buyScore++;
            if (psarBuy) buyScore++;

            if (sellScore >= 2 && sellScore >= buyScore) {
                signal = 'SELL';
                signalClass = 'signal-sell';
            } else if (buyScore >= 2 && buyScore > sellScore) {
                signal = 'BUY';
                signalClass = 'signal-buy';
            }

            // Lots
            const lots = stock.lots.map(lot => {
                const lotQty = lot.qty;
                const lotBuyPrice = lot.buyPrice;
                const lotCost = lot.totalCost;
                const lotCurrentValue = lotQty * currentPrice;
                const lotUnrealized = lotCurrentValue - lotCost;
                const lotUnrealizedPct = lotCost > 0 ? (lotUnrealized / lotCost) * 100 : 0;
                const lotDate = lot.date ? new Date(lot.date) : null;
                return {
                    date: lotDate,
                    qty: lotQty,
                    buyPrice: lotBuyPrice,
                    cost: lotCost,
                    currentValue: lotCurrentValue,
                    unrealizedPL: lotUnrealized,
                    unrealizedPct: lotUnrealizedPct
                };
            });

            rows.push({
                ticker,
                category: meta.category || 'N/A',
                buyQty: stock.totalBuyQty || 0,
                avgBuy: avgBuyWithComm,
                buyCost: buyCostWithComm,
                remainingQty,
                currentPrice,
                currentValue,
                unrealizedPL,
                unrealizedPct,
                sellQty: 0,
                avgSell: 0,
                realizedValue: 0,
                realizedPct: 0,
                recordDate: recordDate || '-',
                daysLeft: daysLeft !== null ? daysLeft : '-',
                ath,
                atl,
                rsi: rsi !== null ? rsi : '-',
                psar,
                eps: eps !== null ? eps : '-',
                signal,
                signalClass,
                lots: lots
            });
        }

        deepAnalysisData = rows;
        currentPage = 1;
        deepSortColumn = 0;
        deepSortAsc = true;
        sortDeepTable(0);
        initDeepFilter();

        if (updateTime) updateTime.innerText = new Date().toLocaleString();

    } catch (error) {
        console.error('Deep analysis error:', error);
        tbody.innerHTML = `<tr><td colspan="21" style="text-align:center; padding:40px; color:red;">❌ Error loading data</td></tr>`;
    }
}

// ==========================================
// Sort Function
// ==========================================

export function sortDeepTable(colIndex) {
    if (deepSortColumn === colIndex) {
        deepSortAsc = !deepSortAsc;
    } else {
        deepSortColumn = colIndex;
        deepSortAsc = true;
    }

    const sorted = [...deepAnalysisData].sort((a, b) => {
        let aVal, bVal;
        switch (colIndex) {
            case 0: aVal = a.ticker; bVal = b.ticker; break;
            case 1: aVal = a.category; bVal = b.category; break;
            case 2: aVal = a.buyQty; bVal = b.buyQty; break;
            case 3: aVal = a.avgBuy; bVal = b.avgBuy; break;
            case 4: aVal = a.buyCost; bVal = b.buyCost; break;
            case 5: aVal = a.remainingQty; bVal = b.remainingQty; break;
            case 6: aVal = a.currentPrice; bVal = b.currentPrice; break;
            case 7: aVal = a.currentValue; bVal = b.currentValue; break;
            case 8: aVal = a.unrealizedPL; bVal = b.unrealizedPL; break;
            case 9: aVal = a.unrealizedPct; bVal = b.unrealizedPct; break;
            case 10: aVal = a.sellQty; bVal = b.sellQty; break;
            case 11: aVal = a.avgSell; bVal = b.avgSell; break;
            case 12: aVal = a.realizedValue; bVal = b.realizedValue; break;
            case 13: aVal = a.realizedPct; bVal = b.realizedPct; break;
            case 14: aVal = a.recordDate; bVal = b.recordDate; break;
            case 15: aVal = a.daysLeft; bVal = b.daysLeft; break;
            case 16: aVal = a.ath; bVal = b.ath; break;
            case 17: aVal = a.atl; bVal = b.atl; break;
            case 18: aVal = a.rsi; bVal = b.rsi; break;
            case 19: aVal = a.psar; bVal = b.psar; break;
            case 20: aVal = a.signal; bVal = b.signal; break;
            default: aVal = a.ticker; bVal = b.ticker;
        }
        if (typeof aVal === 'string') {
            return deepSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        } else {
            return deepSortAsc ? (aVal - bVal) : (bVal - aVal);
        }
    });

    deepAnalysisData = sorted;
    currentPage = 1;
    applyDeepFiltersAndRender();
    updateSortIndicators(colIndex);
}

// ==========================================
// Filter Functions
// ==========================================

export function initDeepFilter() {
    const filterInput = document.getElementById('deep-quick-filter');
    if (filterInput) {
        filterInput.removeEventListener('input', handleDeepFilter);
        filterInput.addEventListener('input', handleDeepFilter);
    }
}

function handleDeepFilter() {
    const filterInput = document.getElementById('deep-quick-filter');
    if (filterInput) {
        deepFilterText = filterInput.value.trim().toLowerCase();
        currentPage = 1;
        applyDeepFiltersAndRender();
    }
}

function getFilteredData() {
    let filtered = deepAnalysisData;
    if (deepFilterText) {
        filtered = filtered.filter(row => 
            row.ticker.toLowerCase().includes(deepFilterText) || 
            row.category.toLowerCase().includes(deepFilterText)
        );
    }
    return filtered;
}

function applyDeepFiltersAndRender() {
    const filtered = getFilteredData();
    renderDeepAnalysisTable(filtered);
    const countEl = document.getElementById('deep-filter-count');
    if (countEl) countEl.innerText = filtered.length + ' stocks';
}

// ==========================================
// Render Function
// ==========================================

function renderDeepAnalysisTable(data) {
    const tbody = document.getElementById('deep-analysis-tbody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="21" style="text-align:center; padding:40px; color:var(--text-muted);">No matching stocks.</td></tr>';
        applyColumnVisibility();
        return;
    }

    const totalPages = Math.ceil(data.length / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, data.length);
    const pageData = data.slice(start, end);

    let html = '';
    let sumBuyQty = 0, sumBuyCost = 0, sumRemaining = 0, sumCurrentValue = 0, sumUnrealizedPL = 0;

    for (const row of pageData) {
        const signalColor = row.signal === 'BUY' ? '#fbbf24' : (row.signal === 'SELL' ? '#34d399' : '');
        const isExpanded = expandedRows[row.ticker] || false;
        const toggleIcon = isExpanded ? '▼' : '▶';

        html += `<tr class="deep-main-row" data-ticker="${row.ticker}">`;
        html += `<td style="position: sticky; left: 0; background: var(--bg-secondary); z-index: 10; padding: 6px 4px; white-space: nowrap;">`;
        html += `<span class="deep-toggle" onclick="event.stopPropagation(); window.toggleDeepExpand('${row.ticker}')" style="cursor:pointer; margin-right:4px; display:inline-block; width:18px;">${toggleIcon}</span>`;
        html += `<span ${signalColor ? `style="color: ${signalColor}; font-weight: bold;"` : ''} 
                      onclick="window.toggleDeepExpand('${row.ticker}')" 
                      ondblclick="event.stopPropagation(); if(window.openStockDetailModal) window.openStockDetailModal('${row.ticker}')" 
                      style="cursor:pointer; text-decoration:underline; color: var(--primary-color);">${row.ticker}</span>`;
        html += `</td>`;
        html += `<td style="padding: 6px 8px;">${row.category}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.buyQty}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">৳${row.avgBuy.toFixed(2)}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">৳${row.buyCost.toFixed(2)}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.remainingQty}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">৳${row.currentPrice.toFixed(2)}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">৳${row.currentValue.toFixed(2)}</td>`;
        const plColor = row.unrealizedPL >= 0 ? '#10b981' : '#ef4444';
        html += `<td style="padding: 6px 8px; text-align: right; color: ${plColor};">${row.unrealizedPL >= 0 ? '+' : ''}৳${row.unrealizedPL.toFixed(2)}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right; color: ${plColor};">${row.unrealizedPct >= 0 ? '+' : ''}${row.unrealizedPct.toFixed(2)}%</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
        html += `<td style="padding: 6px 8px; text-align: left;">${row.recordDate}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.daysLeft !== '-' ? row.daysLeft : '-'}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.ath > 0 ? '৳'+row.ath.toFixed(2) : '-'}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.atl > 0 ? '৳'+row.atl.toFixed(2) : '-'}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.rsi !== '-' ? row.rsi.toFixed(2) : '-'}</td>`;
        html += `<td style="padding: 6px 8px; text-align: right;">${row.psar > 0 ? '৳'+row.psar.toFixed(2) : '-'}</td>`;
        html += `<td style="padding: 6px 8px; text-align: center; font-weight: bold; color: ${signalColor || '#64748b'};">${row.signal}</td>`;
        html += '</tr>';

        sumBuyQty += row.buyQty;
        sumBuyCost += row.buyCost;
        sumRemaining += row.remainingQty;
        sumCurrentValue += row.currentValue;
        sumUnrealizedPL += row.unrealizedPL;

        // Lots sub-row
        if (isExpanded && row.lots && row.lots.length > 0) {
            const totalLots = row.lots.length;
            const totalPagesLot = Math.ceil(totalLots / LOTS_PER_PAGE);
            if (!lotPage[row.ticker]) lotPage[row.ticker] = { page: 0 };
            const currentLotPage = lotPage[row.ticker].page || 0;
            const startLotIdx = currentLotPage * LOTS_PER_PAGE;
            const endLotIdx = Math.min(startLotIdx + LOTS_PER_PAGE, totalLots);
            const pageLots = row.lots.slice(startLotIdx, endLotIdx);

            html += `<tr class="deep-lot-row" data-ticker="${row.ticker}" style="background: var(--bg-tertiary);">`;
            html += `<td colspan="21" style="padding: 0;">`;
            html += `<div style="overflow-x: auto; padding: 4px 0; margin: 0 2px;">`;
            html += `<table style="width: 100%; border-collapse: collapse; font-size: 11px; min-width: 1100px;">`;
            html += `<thead><tr style="background: var(--bg-secondary);">`;
            html += `<th style="padding: 4px 6px; text-align: left;">Buy Date</th>`;
            html += `<th style="padding: 4px 6px; text-align: right;">Qty</th>`;
            html += `<th style="padding: 4px 6px; text-align: right;">Buy Price</th>`;
            html += `<th style="padding: 4px 6px; text-align: right;">Cost</th>`;
            html += `<th style="padding: 4px 6px; text-align: right;">Current Value</th>`;
            html += `<th style="padding: 4px 6px; text-align: right;">Unrealized P/L</th>`;
            html += `<th style="padding: 4px 6px; text-align: right;">Unrealized %</th>`;
            html += `</tr></thead><tbody>`;
            for (const lot of pageLots) {
                const dateStr = lot.date ? lot.date.toLocaleDateString() : 'N/A';
                const lotPlColor = lot.unrealizedPL >= 0 ? '#10b981' : '#ef4444';
                html += `<tr>`;
                html += `<td style="padding: 4px 6px;">${dateStr}</td>`;
                html += `<td style="padding: 4px 6px; text-align: right;">${lot.qty}</td>`;
                html += `<td style="padding: 4px 6px; text-align: right;">৳${lot.buyPrice.toFixed(2)}</td>`;
                html += `<td style="padding: 4px 6px; text-align: right;">৳${lot.cost.toFixed(2)}</td>`;
                html += `<td style="padding: 4px 6px; text-align: right;">৳${lot.currentValue.toFixed(2)}</td>`;
                html += `<td style="padding: 4px 6px; text-align: right; color: ${lotPlColor};">${lot.unrealizedPL >= 0 ? '+' : ''}৳${lot.unrealizedPL.toFixed(2)}</td>`;
                html += `<td style="padding: 4px 6px; text-align: right; color: ${lotPlColor};">${lot.unrealizedPct >= 0 ? '+' : ''}${lot.unrealizedPct.toFixed(2)}%</td>`;
                html += `</tr>`;
            }
            if (totalPagesLot > 1) {
                html += `<tfoot><tr><td colspan="7" style="padding: 4px 6px; text-align: center; background: var(--bg-secondary);">
                            <button onclick="event.stopPropagation(); window.changeLotPage('${row.ticker}', -1)" ${currentLotPage === 0 ? 'disabled' : ''} style="padding: 2px 8px;">◀</button>
                            <span style="margin: 0 8px; font-size: 11px;">Page ${currentLotPage+1} of ${totalPagesLot}</span>
                            <button onclick="event.stopPropagation(); window.changeLotPage('${row.ticker}', 1)" ${currentLotPage === totalPagesLot-1 ? 'disabled' : ''} style="padding: 2px 8px;">▶</button>
                        </td></tr></tfoot>`;
            }
            html += `</table></div></td></tr>`;
        }
    }

    // Total summary
    html += `<tr style="font-weight: bold; background: var(--bg-tertiary); border-top: 2px solid var(--border-color);">`;
    html += `<td style="position: sticky; left: 0; background: var(--bg-tertiary); z-index: 10; padding: 6px 8px; text-align: left;">📊 Total Sum</td>`;
    html += `<td style="padding: 6px 8px;">-</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">${sumBuyQty}</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">৳${sumBuyCost.toFixed(2)}</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">${sumRemaining}</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">৳${sumCurrentValue.toFixed(2)}</td>`;
    const totalPLColor = sumUnrealizedPL >= 0 ? '#10b981' : '#ef4444';
    html += `<td style="padding: 6px 8px; text-align: right; color: ${totalPLColor};">${sumUnrealizedPL >= 0 ? '+' : ''}৳${sumUnrealizedPL.toFixed(2)}</td>`;
    html += `<td style="padding: 6px 8px; text-align: right;">-</td>`;
    for (let i = 10; i < 21; i++) {
        html += `<td style="padding: 6px 8px; text-align: center;">-</td>`;
    }
    html += `</tr>`;

    // Pagination
    if (totalPages > 1) {
        html += `<tr><td colspan="21" style="text-align:center; padding:8px; background: var(--bg-tertiary);">
            <button onclick="window.changeDeepPage(-1)" ${currentPage === 1 ? 'disabled' : ''} style="padding:4px 12px;">◀ Prev</button>
            <span style="margin:0 12px; font-weight:600;">Page ${currentPage} of ${totalPages}</span>
            <button onclick="window.changeDeepPage(1)" ${currentPage === totalPages ? 'disabled' : ''} style="padding:4px 12px;">Next ▶</button>
            <span style="margin-left:12px; font-size:11px; color:var(--text-muted);">(Showing ${start+1}-${Math.min(end, data.length)} of ${data.length})</span>
        </td></tr>`;
    }

    tbody.innerHTML = html;
    applyColumnVisibility();
}

// ==========================================
// Utility Functions
// ==========================================

function updateSortIndicators(colIndex) {
    const headers = document.querySelectorAll('#deep-analysis-header-row th');
    headers.forEach((th, idx) => {
        const existing = th.querySelector('.sort-arrow');
        if (existing) existing.remove();
        if (idx === colIndex) {
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.style.marginLeft = '5px';
            arrow.textContent = deepSortAsc ? ' ▲' : ' ▼';
            th.appendChild(arrow);
        }
    });
}

export function toggleDeepExpand(ticker) {
    if (expandedRows[ticker]) {
        delete expandedRows[ticker];
    } else {
        expandedRows[ticker] = true;
        if (lotPage[ticker]) lotPage[ticker].page = 0;
    }
    applyDeepFiltersAndRender();
}

export function changeLotPage(ticker, delta) {
    if (!lotPage[ticker]) lotPage[ticker] = { page: 0 };
    const current = lotPage[ticker].page || 0;
    const newPage = current + delta;
    const row = deepAnalysisData.find(r => r.ticker === ticker);
    if (!row) return;
    const totalPages = Math.ceil(row.lots.length / LOTS_PER_PAGE);
    if (newPage < 0 || newPage >= totalPages) return;
    lotPage[ticker].page = newPage;
    applyDeepFiltersAndRender();
}

export function changeDeepPage(delta) {
    const totalRows = getFilteredData().length;
    const totalPages = Math.ceil(totalRows / PAGE_SIZE);
    const newPage = currentPage + delta;
    if (newPage < 1 || newPage > totalPages) return;
    currentPage = newPage;
    applyDeepFiltersAndRender();
}

// ==========================================
// Column Visibility
// ==========================================

export function toggleDeepColumnMenu() {
    const menu = document.getElementById('deep-column-menu');
    if (!menu) return;
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        populateColumnMenu();
        menu.style.display = 'block';
    }
}

function populateColumnMenu() {
    const menu = document.getElementById('deep-column-menu');
    const colNames = ['Share Name', 'Category', 'Buy Qty', 'Avg Buy', 'Buy Cost', 
                      'Remaining', 'Current Price', 'Current Value', 'Unrealized P/L', 
                      'Unrealized %', 'Sell Qty', 'Avg Sell', 'Realized Value', 
                      'Realized %', 'Record Date', 'Days Left', 'ATH', 'ATL', 
                      'RSI', 'PSAR', 'Signal'];
    let html = `<div style="display: flex; justify-content: space-between; padding-bottom: 4px; border-bottom: 1px solid var(--border-color);">
                    <span style="font-weight: bold;">Show/Hide Columns</span>
                    <div>
                        <button onclick="window.toggleAllColumns(true)" style="background: none; border: none; cursor: pointer; font-size: 11px; color: var(--primary-color);">All</button>
                        <button onclick="window.toggleAllColumns(false)" style="background: none; border: none; cursor: pointer; font-size: 11px; color: var(--primary-color);">None</button>
                    </div>
                </div>`;
    for (let i = 0; i < colNames.length; i++) {
        const checked = !hiddenColumns.has(i) ? 'checked' : '';
        html += `<div style="display: flex; align-items: center; gap: 6px; margin: 4px 0;">
                    <input type="checkbox" id="col-${i}" ${checked} onchange="window.toggleColumnVisibility(${i})">
                    <label for="col-${i}" style="font-size: 12px; cursor: pointer;">${colNames[i]}</label>
                </div>`;
    }
    menu.innerHTML = html;
}

export function toggleColumnVisibility(colIndex) {
    if (hiddenColumns.has(colIndex)) {
        hiddenColumns.delete(colIndex);
    } else {
        hiddenColumns.add(colIndex);
    }
    applyColumnVisibility();
    populateColumnMenu();
}

export function toggleAllColumns(show) {
    const headers = document.querySelectorAll('#deep-analysis-header-row th');
    for (let i = 0; i < headers.length; i++) {
        if (show) {
            hiddenColumns.delete(i);
        } else {
            hiddenColumns.add(i);
        }
    }
    applyColumnVisibility();
    populateColumnMenu();
}

function applyColumnVisibility() {
    const allCols = document.querySelectorAll('#deep-analysis-header-row th');
    allCols.forEach((th, idx) => {
        if (hiddenColumns.has(idx)) {
            th.style.display = 'none';
        } else {
            th.style.display = '';
        }
    });
    const allRows = document.querySelectorAll('#deep-analysis-tbody tr');
    allRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((td, idx) => {
            if (hiddenColumns.has(idx)) {
                td.style.display = 'none';
            } else {
                td.style.display = '';
            }
        });
    });
}

// ==========================================
// Refresh
// ==========================================

export async function refreshDeepAnalysis() {
    expandedRows = {};
    lotPage = {};
    hiddenColumns = new Set();
    deepFilterText = '';
    currentPage = 1;
    const filterInput = document.getElementById('deep-quick-filter');
    if (filterInput) filterInput.value = '';
    await loadDeepAnalysisPage();
    showToast('✅ Deep Analysis refreshed!', 'success');
}

console.log('✅ deep-analysis.js loaded');