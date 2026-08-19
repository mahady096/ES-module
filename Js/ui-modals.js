// ==========================================
// 📁 ui-modals.js - UI Modal Functions
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { 
    getUnifiedPrice, getLatestAndPreviousPrices, 
    safeParseDate, chunkArray, getBangladeshDateString,
    formatDisplayTime, dseStocks
} from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR, cachedRSI, cachedParabolicSAR } from './indicators.js';

let modalChartStartDate = null;
let modalChartEndDate = null;
let currentModalTicker = null;

// ==========================================
// Global Overlay
// ==========================================
// ui-modals.js-এর শুরুতে currentDataMode ডিফাইন করুন
let currentDataMode = localStorage.getItem('dataMode') || 'firebase';
const globalModalOverlay = document.createElement('div');
globalModalOverlay.id = 'global-modal-overlay';
globalModalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    z-index: 9998; display: none;
`;

if (document.body) {
    document.body.appendChild(globalModalOverlay);
} else {
    document.addEventListener('DOMContentLoaded', function() {
        document.body.appendChild(globalModalOverlay);
    });
}

// ==========================================
// Modal Date Filter
// ==========================================

export function applyModalDateFilter() {
    const start = document.getElementById('modal-chart-start')?.value;
    const end = document.getElementById('modal-chart-end')?.value;
    if (start && end) {
        modalChartStartDate = start;
        modalChartEndDate = end;
        refreshModalCharts();
    } else {
        showToast('Please select both dates.', 'warning');
    }
}

export function resetModalDateFilter() {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const start = thirtyDaysAgo.toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    const startInput = document.getElementById('modal-chart-start');
    const endInput = document.getElementById('modal-chart-end');
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;
    modalChartStartDate = start;
    modalChartEndDate = end;
    refreshModalCharts();
}

function refreshModalCharts() {
    if (!currentModalTicker) return;
    const startInput = document.getElementById('modal-chart-start');
    const endInput = document.getElementById('modal-chart-end');
    const startDate = startInput ? startInput.value : null;
    const endDate = endInput ? endInput.value : null;
    if (typeof loadPriceHistoryChart === 'function') {
        loadPriceHistoryChart(currentModalTicker, startDate, endDate);
    }
    if (typeof loadRSIChart === 'function') {
        loadRSIChart(currentModalTicker, startDate, endDate);
    }
}

// ==========================================
// User Menu Modal
// ==========================================

export function openUserMenu() {
    const modal = document.getElementById('user-menu-modal');
    if (!modal) return;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    const emailSpan = document.getElementById('user-email');
    const uidSpan = document.getElementById('user-uid');
    const createdSpan = document.getElementById('user-created');
    if (emailSpan) emailSpan.innerText = user.email || 'N/A';
    if (uidSpan) uidSpan.innerText = user.uid || 'N/A';
    if (createdSpan) {
        if (user.metadata && user.metadata.creationTime) {
            createdSpan.innerText = new Date(user.metadata.creationTime).toLocaleDateString();
        } else {
            createdSpan.innerText = 'Unknown';
        }
    }
    modal.style.display = 'flex';
}

export function closeUserMenu() {
    const modal = document.getElementById('user-menu-modal');
    if (modal) modal.style.display = 'none';
    const currPwd = document.getElementById('current-password');
    const newPwd = document.getElementById('new-password');
    const confPwd = document.getElementById('confirm-password');
    const statusSpan = document.getElementById('password-status');
    if (currPwd) currPwd.value = '';
    if (newPwd) newPwd.value = '';
    if (confPwd) confPwd.value = '';
    if (statusSpan) statusSpan.innerText = '';
}

export async function changeUserPassword() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('No user logged in', 'error');
        return;
    }
    const currentPwd = document.getElementById('current-password')?.value || '';
    const newPwd = document.getElementById('new-password')?.value || '';
    const confirmPwd = document.getElementById('confirm-password')?.value || '';
    const statusSpan = document.getElementById('password-status');
    if (!currentPwd || !newPwd || !confirmPwd) {
        if (statusSpan) { statusSpan.innerText = 'Please fill all fields'; statusSpan.style.color = 'red'; }
        return;
    }
    if (newPwd !== confirmPwd) {
        if (statusSpan) { statusSpan.innerText = 'New passwords do not match'; statusSpan.style.color = 'red'; }
        return;
    }
    if (newPwd.length < 6) {
        if (statusSpan) { statusSpan.innerText = 'Password must be at least 6 characters'; statusSpan.style.color = 'red'; }
        return;
    }
    if (statusSpan) { statusSpan.innerText = 'Verifying...'; statusSpan.style.color = 'orange'; }
    try {
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPwd);
        await user.reauthenticateWithCredential(credential);
        if (statusSpan) { statusSpan.innerText = 'Updating...'; }
        await user.updatePassword(newPwd);
        if (statusSpan) { statusSpan.innerText = '✅ Password updated successfully!'; statusSpan.style.color = 'green'; }
        setTimeout(() => { closeUserMenu(); }, 1500);
    } catch (error) {
        console.error(error);
        if (statusSpan) {
            if (error.code === 'auth/wrong-password') {
                statusSpan.innerText = 'Current password is incorrect';
            } else if (error.code === 'auth/too-many-requests') {
                statusSpan.innerText = 'Too many attempts. Try again later.';
            } else {
                statusSpan.innerText = 'Error: ' + error.message;
            }
            statusSpan.style.color = 'red';
        }
    }
}

// ==========================================
// Advanced Stock Modal
// ==========================================

export async function openStockDetailModal(ticker) {
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

    const loadingIds = ['adv-ltp', 'adv-holdings-qty', 'adv-eps', 'adv-pe',
        'adv-dividend-percent', 'adv-record-date',
        'adv-highlow', 'adv-prev-close', 'adv-gain-amount',
        'adv-ath', 'adv-atl', 'adv-ath-date', 'adv-atl-date',
        'adv-dse-price', 'adv-cse-price'
    ];
    loadingIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span class="loading"></span>';
    });

    currentModalTicker = ticker;
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const start = thirtyDaysAgo.toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    const startInput = document.getElementById('modal-chart-start');
    const endInput = document.getElementById('modal-chart-end');
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;
    modalChartStartDate = start;
    modalChartEndDate = end;

    try {
        // Portfolio data
        let remainingQty = 0, avgBuyPrice = 0, totalCost = 0;
        try {
            const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
            if (unifiedData && unifiedData.stockDetails) {
                const stockData = unifiedData.stockDetails.find(s => s.ticker === ticker);
                if (stockData) {
                    remainingQty = stockData.totalQty || 0;
                    totalCost = stockData.totalCost || 0;
                    avgBuyPrice = stockData.totalQty > 0 ? stockData.totalCost / stockData.totalQty : 0;
                }
            }
        } catch (e) { /* ignore */ }

        // Price data
        const priceDataMap = await getLatestAndPreviousPrices([ticker]);
        const priceData = priceDataMap.get(ticker);
        const currentPrice = priceData?.currentPrice || 0;
        const currentDate = priceData?.currentDate || null;
        const previousPrice = priceData?.previousPrice || 0;
        const previousDate = priceData?.previousDate || null;
        let todayHigh = priceData?.high || 0;
        let todayLow = priceData?.low || 0;

        let finalHigh = todayHigh, finalLow = todayLow;
        if (finalHigh === 0 && finalLow === 0 && typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('cse_market_data')
                    .select('high, low')
                    .eq('code', ticker)
                    .order('date', { ascending: false })
                    .limit(1);
                if (!error && data && data.length > 0) {
                    finalHigh = parseFloat(data[0].high) || 0;
                    finalLow = parseFloat(data[0].low) || 0;
                }
            } catch (e) { /* ignore */ }
        }

        const dailyChange = currentPrice - previousPrice;
        const dailyChangePercent = previousPrice > 0 ? (dailyChange / previousPrice) * 100 : 0;
// ─── DSE ও CSE প্রাইস ফেচ ──────────────────────────────
let dsePrice = 0, csePrice = 0;
if (typeof supabase !== 'undefined' && supabase) {
    try {
        const { data: dseData } = await supabase
            .from('dse_live_data')
            .select('ltp')
            .eq('ticker', ticker)
            .order('date', { ascending: false })
            .limit(1);
        if (dseData && dseData.length > 0) dsePrice = parseFloat(dseData[0].ltp) || 0;
    } catch (e) { /* ignore */ }

    try {
        const { data: cseData } = await supabase
            .from('cse_market_data')
            .select('ltp')
            .eq('code', ticker)
            .order('date', { ascending: false })
            .limit(1);
        if (cseData && cseData.length > 0) csePrice = parseFloat(cseData[0].ltp) || 0;
    } catch (e) { /* ignore */ }
}

// DSE ও CSE এলিমেন্ট আপডেট করুন
const dseSpan = document.getElementById('adv-dse-price');
const cseSpan = document.getElementById('adv-cse-price');
if (dseSpan) dseSpan.innerText = dsePrice > 0 ? dsePrice.toFixed(2) : 'N/A';
if (cseSpan) cseSpan.innerText = csePrice > 0 ? csePrice.toFixed(2) : 'N/A';
        // LTP
        const ltpElem = document.getElementById('adv-ltp');
        if (ltpElem) {
            ltpElem.innerHTML = `৳${currentPrice.toFixed(2)}`;
            const changeElem = document.getElementById('adv-change');
            if (changeElem) {
                const changeStr = `${dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(2)} (${dailyChangePercent >= 0 ? '+' : ''}${dailyChangePercent.toFixed(2)}%)`;
                changeElem.innerHTML = `Change: <span style="color: ${dailyChange >= 0 ? '#90ffb0' : '#ffaaaa'};">${changeStr}</span>`;
            }
            const dateElem = document.getElementById('adv-ltp-date');
            if (dateElem && currentDate) {
                const d = new Date(currentDate);
                dateElem.innerText = d.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' });
            }
        }

        // Today's High/Low
        const highlowSpan = document.getElementById('adv-highlow');
        if (highlowSpan) {
            if (finalHigh > 0 && finalLow > 0) {
                highlowSpan.innerText = `৳${finalHigh.toFixed(2)} / ৳${finalLow.toFixed(2)}`;
            } else {
                highlowSpan.innerText = '- / -';
            }
        }

        // Previous Close
        const prevCloseElem = document.getElementById('adv-prev-close');
        if (prevCloseElem) {
            prevCloseElem.innerHTML = `৳${previousPrice > 0 ? previousPrice.toFixed(2) : '-'}`;
            const prevDateElem = document.getElementById('adv-prev-date');
            if (prevDateElem && previousDate) {
                const d = new Date(previousDate);
                prevDateElem.innerText = `as on: ${d.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' })}`;
            }
        }

        // Holdings
        const holdingsQty = document.getElementById('adv-holdings-qty');
        const avgBuySpan = document.getElementById('adv-avg-buy');
        if (holdingsQty) holdingsQty.innerText = remainingQty > 0 ? remainingQty : '0';
        if (avgBuySpan) avgBuySpan.innerText = avgBuyPrice > 0 ? avgBuyPrice.toFixed(2) : '0';

        // Gain/Loss
        const gainAmount = document.getElementById('adv-gain-amount');
        const gainPercent = document.getElementById('adv-gain-percent');
        if (remainingQty > 0 && avgBuyPrice > 0 && currentPrice > 0) {
            const pl = (currentPrice - avgBuyPrice) * remainingQty;
            const plPct = (pl / (avgBuyPrice * remainingQty)) * 100;
            if (gainAmount) {
                gainAmount.innerText = `${pl >= 0 ? '+' : ''}৳${pl.toFixed(2)}`;
                gainAmount.style.color = pl >= 0 ? '#90ffb0' : '#ffaaaa';
            }
            if (gainPercent) {
                gainPercent.innerText = `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`;
                gainPercent.style.color = plPct >= 0 ? '#90ffb0' : '#ffaaaa';
            }
        } else {
            if (gainAmount) { gainAmount.innerText = remainingQty === 0 ? 'No holdings' : 'N/A'; }
            if (gainPercent) { gainPercent.innerText = '-'; }
        }

        // Metadata
        try {
            let category = 'N/A', recordDate = '-', dividend = '-', eps = null;
            let ath = 0, atl = 0, athDate = null, atlDate = null;
            let foundInSupabase = false;

            if (typeof supabase !== 'undefined' && supabase) {
                try {
                    const { data, error } = await supabase
                        .from('stock_metadata')
                        .select('ath, ath_date, atl, atl_date, category, record_date, dividend, eps')
                        .eq('ticker', ticker)
                        .limit(1);
                    if (!error && data && data.length > 0) {
                        const meta = data[0];
                        ath = meta.ath || 0;
                        atl = meta.atl || 0;
                        athDate = meta.ath_date || null;
                        atlDate = meta.atl_date || null;
                        category = meta.category || 'N/A';
                        recordDate = meta.record_date || '-';
                        dividend = meta.dividend || '-';
                        eps = meta.eps !== undefined ? parseFloat(meta.eps) : null;
                        foundInSupabase = true;
                    }
                } catch (e) { /* ignore */ }
            }

            if (!foundInSupabase && typeof db !== 'undefined') {
                try {
                    const doc = await db.collection('stock_metadata').doc(ticker).get();
                    if (doc.exists) {
                        const data = doc.data();
                        ath = data.ath || 0;
                        atl = data.atl || 0;
                        athDate = data.ath_date || null;
                        atlDate = data.atl_date || null;
                        category = data.category || 'N/A';
                        recordDate = data.record_date || '-';
                        dividend = data.dividend || '-';
                        eps = data.eps !== undefined ? parseFloat(data.eps) : null;
                    }
                } catch (e) { /* ignore */ }
            }

            // ATH/ATL
            const athSpan = document.getElementById('adv-ath');
            const atlSpan = document.getElementById('adv-atl');
            const athDateSpan = document.getElementById('adv-ath-date');
            const atlDateSpan = document.getElementById('adv-atl-date');
            if (athSpan) athSpan.innerText = ath > 0 ? `৳${ath.toFixed(2)}` : '-';
            if (atlSpan) atlSpan.innerText = atl > 0 ? `৳${atl.toFixed(2)}` : '-';
            if (athDateSpan) {
                if (athDate) {
                    const d = new Date(athDate);
                    athDateSpan.innerText = d.toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' });
                } else {
                    athDateSpan.innerText = '-';
                }
            }
            if (atlDateSpan) {
                if (atlDate) {
                    const d = new Date(atlDate);
                    atlDateSpan.innerText = d.toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' });
                } else {
                    atlDateSpan.innerText = '-';
                }
            }

            // EPS, Dividend, Record Date
            const epsSpan = document.getElementById('adv-eps');
            if (epsSpan) epsSpan.innerText = eps !== null && eps > 0 ? `৳${eps.toFixed(2)}` : '-';

            const divSpan = document.getElementById('adv-dividend-percent');
            const recSpan = document.getElementById('adv-record-date');
            if (divSpan) {
                divSpan.innerText = dividend;
                divSpan.style.cursor = 'pointer';
                divSpan.style.textDecoration = 'underline';
                divSpan.style.color = 'var(--primary-color)';
                divSpan.onclick = function(e) {
                    e.stopPropagation();
                    if (typeof showDividendHistory === 'function') {
                        showDividendHistory(ticker);
                    }
                };
            }
            if (recSpan) {
                recSpan.innerText = recordDate;
                recSpan.style.cursor = 'pointer';
                recSpan.style.textDecoration = 'underline';
                recSpan.onclick = function(e) {
                    e.stopPropagation();
                    if (typeof showDividendHistory === 'function') {
                        showDividendHistory(ticker);
                    }
                };
            }
        } catch (e) { /* ignore */ }

        // Charts
        if (typeof loadPriceHistoryChart === 'function') loadPriceHistoryChart(ticker);
        if (typeof loadRSIChart === 'function') loadRSIChart(ticker);

        // Data source
        const sourceSpan = document.getElementById('adv-data-source');
        const timeSpan = document.getElementById('adv-updated-time');
        if (sourceSpan) sourceSpan.innerText = currentDataMode === 'firebase' ? 'Firebase Cache' : 'Live API';
        if (timeSpan) timeSpan.innerText = new Date().toLocaleString();

    } catch (error) {
        console.error('Error in openStockDetailModal:', error);
        showToast('Error loading stock details: ' + error.message, 'error');
    }
}

export function closeAdvancedModal() {
    const modal = document.getElementById('advanced-stock-modal');
    if (modal) modal.style.display = 'none';
    if (window.advChartInstance) {
        window.advChartInstance.destroy();
        window.advChartInstance = null;
    }
}

// Click outside to close
document.addEventListener('click', function(e) {
    const modal = document.getElementById('advanced-stock-modal');
    if (modal && e.target === modal) {
        closeAdvancedModal();
    }
});

// ==========================================
// Gain/Loss History Modal
// ==========================================

export async function openGainHistoryModal(ticker) {
    const modal = document.getElementById('gain-history-modal');
    const tickerSpan = document.getElementById('gl-modal-ticker');
    const tbody = document.getElementById('gl-history-body');
    const summary = document.getElementById('gl-history-summary');
    const timeSpan = document.getElementById('gl-history-time');
    if (!modal || !tbody) return;
    if (tickerSpan) tickerSpan.innerText = ticker;
    modal.style.display = 'flex';
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">⏳ Loading gain/loss history...</td></tr>`;
    if (summary) summary.innerText = '📊 Fetching data...';
    if (timeSpan) timeSpan.innerText = new Date().toLocaleTimeString();

    try {
        const user = auth && auth.currentUser ? auth.currentUser : null;
        if (!user) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">Please login first.</td></tr>`;
            return;
        }

        const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
        const stockData = unifiedData.stockDetails.find(s => s.ticker === ticker);
        if (!stockData || stockData.lots.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No active holdings for ${ticker}</td></tr>`;
            if (summary) summary.innerText = '📊 No holdings found';
            return;
        }

        if (typeof db === 'undefined') {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">Firebase not available</td></tr>`;
            return;
        }

        const buySnapshot = await db.collection('portfolios')
            .where('userId', '==', user.uid)
            .where('shareName', '==', ticker)
            .get();
        let allBuyLots = [];
        buySnapshot.forEach(doc => {
            const data = doc.data();
            const totalCost = (data.quantity * data.buyPrice) + (data.commission || 0);
            const perUnit = data.quantity > 0 ? totalCost / data.quantity : data.buyPrice;
            const date = data.date ? (data.date.toDate ? data.date.toDate() : new Date(data.date)) : new Date();
            allBuyLots.push({
                qty: data.quantity,
                buyPrice: data.buyPrice,
                perUnitCost: perUnit,
                date: date
            });
        });
        allBuyLots.sort((a, b) => a.date - b.date);

        const sellSnapshot = await db.collection('sales_history')
            .where('userId', '==', user.uid)
            .where('shareName', '==', ticker)
            .get();
        let sellTransactions = [];
        sellSnapshot.forEach(doc => {
            const data = doc.data();
            const date = data.date ? (data.date.toDate ? data.date.toDate() : new Date(data.date)) : new Date();
            sellTransactions.push({
                date: date,
                qty: data.quantitySold || 0
            });
        });
        sellTransactions.sort((a, b) => a.date - b.date);

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const startDateStr = startDate.toISOString().split('T')[0];

        let priceMap = new Map();

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('history_dse')
                    .select('date, ltp')
                    .eq('ticker', ticker)
                    .gte('date', startDateStr)
                    .order('date', { ascending: true });
                if (!error && data && data.length > 0) {
                    data.forEach(d => {
                        const price = parseFloat(d.ltp);
                        if (price > 0) priceMap.set(d.date, price);
                    });
                }
            } catch (e) { /* ignore */ }
        }

        if (priceMap.size === 0 && typeof db !== 'undefined') {
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
                        if (price > 0) priceMap.set(data.date, price);
                    });
                }
            } catch (e) { /* ignore */ }
        }

        if (priceMap.size === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No price data for last 90 days</td></tr>`;
            if (summary) summary.innerText = '📊 No price data';
            return;
        }

        const allDates = Array.from(priceMap.keys()).sort();
        let fifoLots = [];
        let sellIndex = 0;
        let tableHtml = '';
        let totalPL = 0;
        let rowCount = 0;
        let previousLTP = 0;

        for (const date of allDates) {
            const ltp = priceMap.get(date) || previousLTP;
            if (ltp === 0) continue;
            previousLTP = ltp;

            while (allBuyLots.length > 0 && allBuyLots[0].date <= new Date(date)) {
                const lot = allBuyLots.shift();
                fifoLots.push({ ...lot });
            }

            while (sellIndex < sellTransactions.length && sellTransactions[sellIndex].date <= new Date(date)) {
                let sellQty = sellTransactions[sellIndex].qty;
                while (sellQty > 0 && fifoLots.length > 0) {
                    const lot = fifoLots[0];
                    const taken = Math.min(lot.qty, sellQty);
                    lot.qty -= taken;
                    sellQty -= taken;
                    if (lot.qty === 0) fifoLots.shift();
                }
                sellIndex++;
            }

            let totalQty = 0, totalCost = 0;
            for (const lot of fifoLots) {
                totalQty += lot.qty;
                totalCost += lot.qty * lot.perUnitCost;
            }
            const avgBuy = totalQty > 0 ? totalCost / totalQty : 0;
            const currentValue = totalQty * ltp;
            const dailyPL = currentValue - totalCost;

            if (totalQty > 0 || Math.abs(dailyPL) > 0.01) {
                const dateObj = new Date(date);
                const dateStr = dateObj.toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' });
                const sign = dailyPL >= 0 ? '+' : '';
                tableHtml += `<tr>
                    <td style="padding: 8px 12px;">${dateStr}</td>
                    <td style="padding: 8px 12px; text-align: right; color: ${dailyPL >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                        ${sign}৳${dailyPL.toFixed(2)}
                    </td>
                    <td style="padding: 8px 12px; text-align: right;">${totalQty}</td>
                    <td style="padding: 8px 12px; text-align: right;">৳${avgBuy.toFixed(2)}</td>
                    <td style="padding: 8px 12px; text-align: right;">৳${ltp.toFixed(2)}</td>
                </tr>`;
                totalPL += dailyPL;
                rowCount++;
            }
        }

        if (rowCount === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No gain/loss data for this period</td></tr>`;
            if (summary) summary.innerText = '📊 No data in last 90 days';
        } else {
            tbody.innerHTML = tableHtml;
            const avgPL = totalPL / rowCount;
            if (summary) summary.innerText = `📊 ${rowCount} days shown | Avg P&L: ${avgPL >= 0 ? '+' : ''}৳${avgPL.toFixed(2)}`;
        }
        if (timeSpan) timeSpan.innerText = new Date().toLocaleString('bn-BD');
    } catch (error) {
        console.error('Gain history error:', error);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">Error: ${error.message}</td></tr>`;
        if (summary) summary.innerText = '❌ Error loading data';
    }
}

export function closeGainHistoryModal() {
    const modal = document.getElementById('gain-history-modal');
    if (modal) modal.style.display = 'none';
}

document.addEventListener('click', function(e) {
    const modal = document.getElementById('gain-history-modal');
    if (modal && e.target === modal) {
        closeGainHistoryModal();
    }
});

// ==========================================
// Dividend History Modal
// ==========================================

export async function showDividendHistory(ticker) {
    const modal = document.getElementById('dividend-history-modal');
    if (!modal) return;
    const nameSpan = document.getElementById('div-ticker-name');
    if (nameSpan) nameSpan.innerText = ticker;
    modal.style.display = 'flex';
    const tbody = document.getElementById('dividend-history-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading dividend data...</td></tr>';

    try {
        let dividendData = [];
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('dse_dividend_data')
                    .select('*')
                    .eq('code', ticker)
                    .order('date', { ascending: false });
                if (!error && data && data.length > 0) dividendData = data;
            } catch (e) { /* ignore */ }
        }

        if (dividendData.length === 0 && typeof db !== 'undefined') {
            const snapshot = await db.collection('dse_dividend_data')
                .where('code', '==', ticker)
                .get();
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const data = doc.data();
                const dividendMap = new Map();
                for (const [key, value] of Object.entries(data)) {
                    let match;
                    if (match = key.match(/^stock_dividend_(\d{4})$/)) {
                        const year = match[1];
                        const stockPercent = parseFloat(value);
                        if (!isNaN(stockPercent)) {
                            if (!dividendMap.has(year)) dividendMap.set(year, {});
                            dividendMap.get(year).stockPercent = stockPercent;
                        }
                    } else if (match = key.match(/^cash_dividend_(\d{4})$/)) {
                        const year = match[1];
                        let cashAmount = parseFloat(value);
                        if (!isNaN(cashAmount)) {
                            if (!dividendMap.has(year)) dividendMap.set(year, {});
                            dividendMap.get(year).cashAmount = cashAmount;
                        }
                    }
                }
                const years = Array.from(dividendMap.keys()).sort();
                if (years.length > 0) {
                    let html = '';
                    const chartLabels = [], stockData = [], cashData = [];
                    for (const year of years) {
                        const rec = dividendMap.get(year);
                        const stockVal = rec.stockPercent || 0;
                        const cashVal = rec.cashAmount || 0;
                        html += `<tr>
                            <td style="padding: 8px;">${year}</td>
                            <td style="padding: 8px;">${stockVal > 0 ? stockVal + '%' : '-'}</td>
                            <td style="padding: 8px;">${cashVal > 0 ? '৳' + cashVal.toFixed(2) : '-'}</td>
                            <td style="padding: 8px;">${data.record_date || '-'}</td>
                        </tr>`;
                        chartLabels.push(year);
                        stockData.push(stockVal);
                        cashData.push(cashVal);
                    }
                    if (tbody) tbody.innerHTML = html;
                    const ctx = document.getElementById('dividend-chart');
                    if (ctx) {
                        if (window.dividendChartInstance) window.dividendChartInstance.destroy();
                        window.dividendChartInstance = new Chart(ctx, {
                            type: 'bar',
                            data: {
                                labels: chartLabels,
                                datasets: [
                                    { label: 'Stock Dividend (%)', data: stockData, backgroundColor: 'rgba(54, 162, 235, 0.6)' },
                                    { label: 'Cash Dividend (৳)', data: cashData, backgroundColor: 'rgba(255, 206, 86, 0.6)' }
                                ]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: true,
                                scales: {
                                    y: { beginAtZero: true },
                                    x: { title: { display: true, text: 'Year' } }
                                }
                            }
                        });
                    }
                    return;
                }
            }
        }

        if (dividendData.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="4">No dividend records found.</td></tr>';
            return;
        }

        const dividendMap = new Map();
        for (const row of dividendData) {
            for (const [key, value] of Object.entries(row)) {
                let match;
                if (match = key.match(/^cash_dividend_(\d{4})$/)) {
                    const year = match[1];
                    const cashAmount = parseFloat(value);
                    if (!isNaN(cashAmount)) {
                        if (!dividendMap.has(year)) dividendMap.set(year, { cash: 0, stock: 0 });
                        dividendMap.get(year).cash = cashAmount;
                    }
                } else if (match = key.match(/^stock_dividend_(\d{4})$/)) {
                    const year = match[1];
                    const stockPercent = parseFloat(value);
                    if (!isNaN(stockPercent)) {
                        if (!dividendMap.has(year)) dividendMap.set(year, { cash: 0, stock: 0 });
                        dividendMap.get(year).stock = stockPercent;
                    }
                }
            }
        }

        const years = Array.from(dividendMap.keys()).sort();
        if (years.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="4">No structured dividend data.</td></tr>';
            return;
        }

        let html = '';
        const chartLabels = [], stockData = [], cashData = [];
        const recordDate = dividendData[0]?.record_date || '-';
        for (const year of years) {
            const rec = dividendMap.get(year);
            const stockVal = rec.stock || 0;
            const cashVal = rec.cash || 0;
            html += `<tr>
                <td style="padding: 8px;">${year}</td>
                <td style="padding: 8px;">${stockVal > 0 ? stockVal + '%' : '-'}</td>
                <td style="padding: 8px;">${cashVal > 0 ? '৳' + cashVal.toFixed(2) : '-'}</td>
                <td style="padding: 8px;">${recordDate}</td>
            </tr>`;
            chartLabels.push(year);
            stockData.push(stockVal);
            cashData.push(cashVal);
        }
        if (tbody) tbody.innerHTML = html;
        const ctx = document.getElementById('dividend-chart');
        if (ctx) {
            if (window.dividendChartInstance) window.dividendChartInstance.destroy();
            window.dividendChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [
                        { label: 'Stock Dividend (%)', data: stockData, backgroundColor: 'rgba(54, 162, 235, 0.6)' },
                        { label: 'Cash Dividend (৳)', data: cashData, backgroundColor: 'rgba(255, 206, 86, 0.6)' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    scales: {
                        y: { beginAtZero: true },
                        x: { title: { display: true, text: 'Year' } }
                    }
                }
            });
        }
    } catch (err) {
        console.error('Error loading dividend history:', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="4">Error loading dividend data.</td></tr>';
    }
}

export function closeDividendModal() {
    const modal = document.getElementById('dividend-history-modal');
    if (modal) modal.style.display = 'none';
    if (window.dividendChartInstance) {
        window.dividendChartInstance.destroy();
        window.dividendChartInstance = null;
    }
}

// ==========================================
// DSEX Chart Modal
// ==========================================

export async function openDSEXChartModal() {
    const modal = document.getElementById('dsex-chart-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const canvas = document.getElementById('dsex-history-chart');
    if (!canvas) return;
    canvas.style.opacity = '0.5';

    try {
        if (typeof db === 'undefined') {
            throw new Error('Firebase not available');
        }
        const snapshot = await db.collection('dse_market_data')
            .orderBy('date', 'asc')
            .get();

        if (snapshot.empty) {
            throw new Error('No documents found in dse_market_data');
        }

        const labels = [];
        const dataPoints = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const dateStr = data.date;
            const dsexStr = data.dsex_index || '0';
            const dsexValue = parseFloat(dsexStr.replace(/,/g, ''));
            if (dsexValue && !isNaN(dsexValue) && dsexValue > 0) {
                labels.push(dateStr);
                dataPoints.push(dsexValue);
            }
        });

        if (dataPoints.length === 0) {
            throw new Error('No valid DSEX values');
        }

        if (window.dsexChartInstance) window.dsexChartInstance.destroy();

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        const ctx = canvas.getContext('2d');
        window.dsexChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'DSEX Index',
                    data: dataPoints,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'top', labels: { color: textColor } },
                    tooltip: { callbacks: { label: (ctx) => `DSEX: ${ctx.raw.toFixed(2)}` } }
                },
                scales: {
                    x: { ticks: { color: textColor, maxRotation: 45 }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor }, grid: { color: gridColor } }
                }
            }
        });
        canvas.style.opacity = '1';
    } catch (err) {
        console.error('DSEX chart load failed:', err);
        canvas.style.opacity = '1';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ef4444';
        ctx.font = '14px sans-serif';
        ctx.fillText('Error: ' + err.message, 50, 50);
    }
}

export function closeDSEXChartModal() {
    const modal = document.getElementById('dsex-chart-modal');
    if (modal) modal.style.display = 'none';
    if (window.dsexChartInstance) {
        window.dsexChartInstance.destroy();
        window.dsexChartInstance = null;
    }
}

// ==========================================
// Open Advanced Chart
// ==========================================

// js/ui-modals.js - এই ফাংশনটি রিপ্লেস করুন
export function openAdvancedChartFromModal() {
    const ticker = document.getElementById('adv-modal-ticker')?.innerText;
    if (ticker) {
        // 🔥 ক্যাশ বাস্টিং যোগ করা হয়েছে (যেন ব্রাউজার পুরনো ক্যাশ না ধরে)
        const url = `adv-charts.html?ticker=${ticker}&t=${Date.now()}`;
        window.open(url, '_blank'); // নতুন ট্যাবে খোলা (সুন্দর অভিজ্ঞতার জন্য)
    } else {
        showToast('No ticker found', 'error');
    }
}

console.log('✅ ui-modals.js loaded');