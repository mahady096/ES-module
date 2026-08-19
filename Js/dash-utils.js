// ==========================================
// 📊 dash-utils.js - Dashboard Utilities (আপডেটেড)
//    Value History Tab সম্পূর্ণ ফিক্স
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { formatDisplayTime, toBangladeshTime, getBangladeshDateString, safeParseDate } from './core.js';
import { showToast } from './app-charts.js';
import { loadPortfolioAnalysisTable } from './dash-performance.js';
import { updatePerformanceSummary } from './dash-performance.js';
import { renderDashboardHistoryChart, renderDashboardDailyPLChart, fetchPortfolioTimelineData } from './dash-charts.js';
import { loadSignalData } from './dash-signals.js';

// ==========================================
// 📌 গ্লোবাল ভেরিয়েবল
// ==========================================

let currentDataMode = localStorage.getItem('dataMode') || 'firebase';
let autoRefreshEnabled = true;
let isManualReloading = false;
let currentHistoryMode = 'firebase';
let currentHistoryData = [];

// ==========================================
// 💰 Deposit Management
// ==========================================

export async function getUserDeposit(userId) {
    if (!userId) return 0;
    try {
        if (typeof db === 'undefined') return 0;
        const doc = await db.collection('user_meta').doc(userId).get();
        if (doc.exists) {
            return doc.data().deposit || 0;
        }
        return 0;
    } catch (e) {
        console.warn('Error getting deposit:', e);
        return 0;
    }
}

export async function updateUserDeposit(userId, amount) {
    if (!userId) return;
    try {
        if (typeof db === 'undefined') return;
        await db.collection('user_meta').doc(userId).set({
            deposit: amount,
            updatedAt: new Date()
        }, { merge: true });
    } catch (e) {
        console.error('Error updating deposit:', e);
        throw e;
    }
}

// ==========================================
// 🔄 Auto Refresh
// ==========================================

export function startAutoRefresh() {
    if (window.autoRefreshInterval) {
        clearInterval(window.autoRefreshInterval);
        window.autoRefreshInterval = null;
    }
    if (!autoRefreshEnabled) return;
    
    const REFRESH_INTERVAL = 1800000; // 30 মিনিট
    let timeLeft = REFRESH_INTERVAL / 1000;

    function updateTimer() {
        const timerEl = document.getElementById('next-refresh-timer');
        if (timerEl) {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = Math.floor(timeLeft % 60);
            timerEl.innerText = `⏳ ${minutes}m ${seconds}s`;
        }
    }

    const timerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            timeLeft = REFRESH_INTERVAL / 1000;
        }
        updateTimer();
    }, 1000);

    window.autoRefreshInterval = setInterval(() => {
        if (!document.hidden && auth && auth.currentUser) {
            console.log('🔄 Auto-refreshing dashboard...');
            if (typeof window.loadDashboardData === 'function') {
                window.loadDashboardData(null, true);
            }
            timeLeft = REFRESH_INTERVAL / 1000;
            updateTimer();
        }
    }, REFRESH_INTERVAL);
    
    updateTimer();
}

export function stopAutoRefresh() {
    if (window.autoRefreshInterval) {
        clearInterval(window.autoRefreshInterval);
        window.autoRefreshInterval = null;
    }
}

// ==========================================
// 🔄 Manual Reload
// ==========================================

export async function manualReloadDashboard() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    if (isManualReloading) {
        showToast('Already reloading...', 'info');
        return;
    }
    isManualReloading = true;
    const reloadBtn = document.getElementById('btn-manual-reload');
    const originalText = reloadBtn ? reloadBtn.innerHTML : '';
    try {
        if (reloadBtn) {
            reloadBtn.innerHTML = '⏳ Loading...';
            reloadBtn.disabled = true;
            reloadBtn.style.opacity = '0.7';
        }
        showToast('🔄 Manual refresh started...', 'info');
        if (typeof CacheManager !== 'undefined' && CacheManager.clearAll) {
            CacheManager.clearAll();
        }
        if (typeof window.loadDashboardData === 'function') {
            await window.loadDashboardData(null, true);
        }
        if (typeof loadUnifiedStockTable === 'function') {
            await loadUnifiedStockTable(user.uid);
        }
        if (typeof loadPortfolioAnalysisTable === 'function') {
            await loadPortfolioAnalysisTable(user.uid, null, true);
        }
        await updateTimestamp();
        showToast('✅ Dashboard refreshed successfully!', 'success');
    } catch (error) {
        console.error(error);
        showToast('❌ Refresh failed.', 'error');
    } finally {
        if (reloadBtn) {
            reloadBtn.innerHTML = originalText;
            reloadBtn.disabled = false;
            reloadBtn.style.opacity = '1';
        }
        isManualReloading = false;
    }
}

// ==========================================
// 🕐 Timestamp & Loading
// ==========================================

export function updateTimestamp() {
    const timestampElem = document.getElementById('update-timestamp');
    if (!timestampElem) return;

    const mode = currentDataMode === 'firebase' ? 'Firebase Cache' : 'Live API (Supabase)';

    getLatestDSEXFromSupabase()
        .then(dsexData => {
            if (dsexData && dsexData.date) {
                timestampElem.innerHTML = `🔄 Data source: ${mode} | Last scraped: ${formatDisplayTime(dsexData.date)} (BD Time)`;
            } else {
                timestampElem.innerHTML = `🔄 Last updated: ${formatDisplayTime(new Date())} (${mode})`;
            }
        })
        .catch(() => {
            timestampElem.innerHTML = `🔄 Last updated: ${formatDisplayTime(new Date())} (${mode})`;
        });
}

export function showDataLoading(isLoading) {
    // কোন UI ব্লক করবেন না
    return;
}

// ==========================================
// 📊 Get Latest DSEX from Supabase
// ==========================================

export async function getLatestDSEXFromSupabase() {
    try {
        if (typeof supabase === 'undefined' || !supabase) return null;
        const { data, error } = await supabase
            .from('dsex_index')
            .select('value, updated_at, date')
            .eq('index_name', 'DSEX')
            .order('updated_at', { ascending: false })
            .limit(2);
        if (error || !data || data.length === 0) return null;
        const latest = data[0];
        const todayValue = parseFloat(latest.value) || 0;
        const todayDate = new Date(latest.updated_at);
        let prevValue = null;
        if (data.length > 1) {
            prevValue = parseFloat(data[1].value) || 0;
        }
        let change = 0, changePercent = 0;
        if (prevValue !== null && prevValue > 0) {
            change = todayValue - prevValue;
            changePercent = (change / prevValue) * 100;
        }
        return {
            value: todayValue,
            date: todayDate,
            rawDate: latest.date,
            change: change,
            changePercent: changePercent,
            previousValue: prevValue
        };
    } catch (e) {
        console.warn('Error fetching DSEX from Supabase:', e);
        return null;
    }
}

// ==========================================
// 🔄 Refresh Widgets
// ==========================================

export async function refreshDashboardWidgets() {
    try {
        const btn = document.querySelector('[onclick="refreshDashboardWidgets()"]');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ ...';
            btn.style.opacity = '0.7';
        }
        showToast('🔄 Refreshing dashboard widgets...', 'info');
        if (typeof updatePerformanceSummary === 'function') {
            await updatePerformanceSummary();
        }
        if (typeof renderDashboardHistoryChart === 'function') {
            await renderDashboardHistoryChart();
        }
        if (typeof renderDashboardDailyPLChart === 'function') {
            await renderDashboardDailyPLChart();
        }
        if (typeof loadSignalData === 'function') {
            await loadSignalData();
        }
        const timeElem = document.getElementById('dash-perf-update-time');
        if (timeElem) {
            timeElem.innerText = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
        }
        showToast('✅ Dashboard widgets refreshed!', 'success');
    } catch (error) {
        console.error('Widget refresh error:', error);
        showToast('❌ Refresh failed: ' + error.message, 'error');
    } finally {
        const btn = document.querySelector('[onclick="refreshDashboardWidgets()"]');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔄 Refresh Widgets';
            btn.style.opacity = '1';
        }
    }
}

// ==========================================
// 🔄 Init Auto Refresh Toggle
// ==========================================

export function initAutoRefreshToggle() {
    const toggle = document.getElementById('autoRefreshToggle');
    if (!toggle) return;
    toggle.addEventListener('change', (e) => {
        autoRefreshEnabled = e.target.checked;
        if (autoRefreshEnabled) startAutoRefresh();
        else stopAutoRefresh();
    });
}

// ==========================================
// 📊 পোর্টফোলিও হিস্ট্রি (VALUE HISTORY) - সম্পূর্ণ আপডেট
// ==========================================

export async function loadPortfolioHistory() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        console.log('⚠️ No user logged in');
        return;
    }
    const tableBody = document.getElementById('history-table-body');
    if (!tableBody) {
        console.warn('⚠️ history-table-body not found');
        return;
    }
    
    // লোডিং স্টেট
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;">⏳ Loading portfolio history...</td></tr>`;
    console.log('📊 Loading portfolio history...');

    try {
        // ১. পোর্টফোলিও ও সেলস ডেটা ফেচ করুন
        let portfolioData = [];
        let salesData = [];

        // Supabase থেকে ফেচ (প্রথম অগ্রাধিকার)
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data: pData, error: pError } = await supabase
                    .from('portfolios')
                    .select('*')
                    .eq('user_id', user.uid);
                if (!pError && pData) portfolioData = pData;

                const { data: sData, error: sError } = await supabase
                    .from('sales_history')
                    .select('*')
                    .eq('user_id', user.uid);
                if (!sError && sData) salesData = sData;
            } catch (e) {
                console.warn('Supabase fetch failed, trying Firebase...', e);
            }
        }

        // Firebase ফ্যালব্যাক
        if (portfolioData.length === 0 && typeof db !== 'undefined') {
            try {
                const snap = await db.collection('portfolios')
                    .where('userId', '==', user.uid)
                    .get();
                snap.forEach(doc => {
                    const data = doc.data();
                    const date = safeParseDate(data.date);
                    portfolioData.push({
                        share_name: data.shareName,
                        quantity: data.quantity || 0,
                        buy_price: data.buyPrice || 0,
                        commission: data.commission || 0,
                        date: date ? date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                        portfolio_id: data.portfolioId || 'main'
                    });
                });
            } catch (e) {
                console.warn('Firebase portfolio fetch failed:', e);
            }
        }

        if (portfolioData.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">No transactions found. Start buying shares!</td></tr>`;
            return;
        }

        // ২. Buy Lots তৈরি করুন (সাজানো)
        const buyLots = portfolioData.map(item => {
            const totalCostWithCommission = (item.quantity * item.buy_price) + (item.commission || 0);
            const perUnitCost = item.quantity > 0 ? totalCostWithCommission / item.quantity : item.buy_price;
            const date = safeParseDate(item.date) || new Date();
            return {
                ticker: item.share_name,
                qty: item.quantity,
                buyPrice: item.buy_price,
                totalCostWithCommission: totalCostWithCommission,
                perUnitCost: perUnitCost,
                date: date,
                buyDateStr: date.toISOString().split('T')[0]
            };
        });
        buyLots.sort((a, b) => a.date - b.date);

        // ৩. সেলস ডেটা গ্রুপ করুন (টিকার ভিত্তিতে)
        const totalSoldMap = new Map();
        salesData.forEach(item => {
            const ticker = item.share_name || item.shareName;
            const qty = item.quantity_sold || item.quantitySold || 0;
            totalSoldMap.set(ticker, (totalSoldMap.get(ticker) || 0) + qty);
        });

        // ৪. ডেট রেঞ্জ তৈরি করুন (প্রথম কেনা থেকে আজ পর্যন্ত, সর্বোচ্চ ৩৬৫ দিন)
        const firstBuyDate = buyLots[0].date;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let daysDiff = Math.ceil((today - firstBuyDate) / (1000 * 60 * 60 * 24));
        if (daysDiff < 1) daysDiff = 1;
        const finalDays = Math.min(daysDiff, 365);

        const allDates = [];
        for (let i = 0; i <= finalDays; i++) {
            const d = new Date(firstBuyDate);
            d.setDate(firstBuyDate.getDate() + i);
            allDates.push(d);
        }

        // ৫. ফিল্টার (তারিখ অনুযায়ী)
        const startDateInput = document.getElementById('history-start-date');
        const endDateInput = document.getElementById('history-end-date');
        const startFilter = startDateInput?.value ? new Date(startDateInput.value) : null;
        const endFilter = endDateInput?.value ? new Date(endDateInput.value) : null;
        if (startFilter) startFilter.setHours(0, 0, 0, 0);
        if (endFilter) endFilter.setHours(23, 59, 59, 999);

        const filteredDates = allDates.filter(d => {
            if (startFilter && d < startFilter) return false;
            if (endFilter && d > endFilter) return false;
            return true;
        });

        if (filteredDates.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">No data for selected date range.</td></tr>`;
            return;
        }

        // ৬. প্রতিটি দিনের জন্য পোর্টফোলিও ভ্যালু ক্যালকুলেট করুন
        const dailyPortfolio = [];
        let cumulativeLots = []; // FIFO ট্র্যাকিং
        let lotIndex = 0;

        for (const currentDate of filteredDates) {
            const dateStr = currentDate.toISOString().split('T')[0];

            // এই দিন পর্যন্ত সব Buy লট যোগ করুন
            while (lotIndex < buyLots.length && buyLots[lotIndex].date <= currentDate) {
                const lot = buyLots[lotIndex];
                // সেলস বিয়োগ করার জন্য কপি
                cumulativeLots.push({ ...lot, remainingQty: lot.qty });
                lotIndex++;
            }

            // সেলস বিয়োগ করুন (FIFO)
            const tempSoldMap = new Map(totalSoldMap);
            for (const lot of cumulativeLots) {
                let toSell = tempSoldMap.get(lot.ticker) || 0;
                if (toSell > 0 && lot.remainingQty > 0) {
                    const taken = Math.min(lot.remainingQty, toSell);
                    lot.remainingQty -= taken;
                    toSell -= taken;
                    tempSoldMap.set(lot.ticker, toSell);
                }
            }

            // ইনভেস্টমেন্ট ও কারেন্ট ভ্যালু ক্যালকুলেট
            let totalInvestment = 0;
            const remainingStocks = [];
            for (const lot of cumulativeLots) {
                if (lot.remainingQty > 0 && lot.perUnitCost > 0) {
                    totalInvestment += lot.remainingQty * lot.perUnitCost;
                    remainingStocks.push({
                        ticker: lot.ticker,
                        qty: lot.remainingQty,
                        avgCost: lot.perUnitCost
                    });
                }
            }

            let totalCurrentValue = 0;
            // প্রতিটি স্টকের জন্য প্রাইস ফেচ করুন (Supabase → Firebase → AvgCost)
            for (const stock of remainingStocks) {
                let price = 0;
                let priceFound = false;

                // ৬.১ Supabase history_dse থেকে প্রাইস নেওয়ার চেষ্টা
                if (typeof supabase !== 'undefined' && supabase) {
                    try {
                        const { data, error } = await supabase
                            .from('history_dse')
                            .select('ltp')
                            .eq('ticker', stock.ticker)
                            .eq('date', dateStr)
                            .limit(1);
                        if (!error && data && data.length > 0) {
                            const val = parseFloat(data[0].ltp);
                            if (val > 0) {
                                price = val;
                                priceFound = true;
                            }
                        }
                    } catch (e) { /* ignore */ }
                }

                // ৬.২ Firebase daily_prices ফ্যালব্যাক
                if (!priceFound && typeof db !== 'undefined') {
                    try {
                        const snap = await db.collection('daily_prices')
                            .where('ticker', '==', stock.ticker)
                            .where('date', '==', dateStr)
                            .limit(1)
                            .get();
                        if (!snap.empty) {
                            const data = snap.docs[0].data();
                            const val = parseFloat(data.price) || parseFloat(data.close) || 0;
                            if (val > 0) {
                                price = val;
                                priceFound = true;
                            }
                        }
                    } catch (e) { /* ignore */ }
                }

                // ৬.৩ যদি কোনো প্রাইস না পাওয়া যায়, আগের দিনের প্রাইস বা AvgCost ব্যবহার করুন
                if (!priceFound) {
                    // আগের দিনের প্রাইস সংরক্ষণ করা নেই, তাই avgCost ব্যবহার করুন (রক্ষণশীল)
                    price = stock.avgCost;
                }

                totalCurrentValue += stock.qty * price;
            }

            if (totalInvestment > 0 || totalCurrentValue > 0) {
                dailyPortfolio.push({
                    date: dateStr,
                    totalInvestment: totalInvestment,
                    totalCurrentValue: totalCurrentValue,
                    dailyPL: totalCurrentValue - totalInvestment,
                    dailyPLPercent: totalInvestment > 0 ? ((totalCurrentValue - totalInvestment) / totalInvestment) * 100 : 0
                });
            }
        }

        // ৭. রেন্ডার করুন
        currentHistoryData = dailyPortfolio;
        renderHistoryTable(dailyPortfolio);
        renderHistoryChart(dailyPortfolio);

        // ৮. ফুটার আপডেট
        const footer = document.getElementById('history-table-footer');
        if (footer) footer.style.display = 'table-footer-group';

        console.log(`✅ Portfolio history loaded: ${dailyPortfolio.length} entries`);

    } catch (error) {
        console.error('❌ Error loading portfolio history:', error);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:red;">Error loading data: ${error.message}</td></tr>`;
    }
}

// ==========================================
// 📋 হিস্ট্রি টেবিল রেন্ডার
// ==========================================

function renderHistoryTable(data) {
    const tableBody = document.getElementById('history-table-body');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">No data for selected range.</td></tr>`;
        // ফুটার ক্লিয়ার
        const footerInvest = document.getElementById('history-footer-invest');
        const footerValue = document.getElementById('history-footer-value');
        const footerPL = document.getElementById('history-footer-pl');
        const footerPLPct = document.getElementById('history-footer-plpct');
        if (footerInvest) footerInvest.innerHTML = '-';
        if (footerValue) footerValue.innerHTML = '-';
        if (footerPL) footerPL.innerHTML = '-';
        if (footerPLPct) footerPLPct.innerHTML = '-';
        return;
    }

    let html = '';
    let totalInvestment = 0;
    let totalCurrentValue = 0;

    // সর্বশেষ ১০০টি ডেটা দেখান (পারফরম্যান্সের জন্য)
    const displayData = data.length > 100 ? data.slice(-100) : data;

    for (const item of displayData) {
        totalInvestment += item.totalInvestment;
        totalCurrentValue += item.totalCurrentValue;
        const pl = item.dailyPL;
        const pct = item.dailyPLPercent;
        const color = pl >= 0 ? '#10b981' : '#ef4444';
        const sign = pl >= 0 ? '+' : '';

        html += `<tr>
            <td style="padding: 8px;">${formatDate(item.date)}</td>
            <td style="padding: 8px; text-align:right;">৳${item.totalInvestment.toLocaleString('bn-BD', {minimumFractionDigits:2})}</td>
            <td style="padding: 8px; text-align:right;">৳${item.totalCurrentValue.toLocaleString('bn-BD', {minimumFractionDigits:2})}</td>
            <td style="padding: 8px; text-align:right; color:${color};">${sign}৳${pl.toLocaleString('bn-BD', {minimumFractionDigits:2})}</td>
            <td style="padding: 8px; text-align:right; color:${color};">${sign}${pct.toFixed(2)}%</td>
            <td style="padding: 8px; text-align:center;">${pl >= 0 ? '✅' : '📉'}</td>
        </tr>`;
    }

    tableBody.innerHTML = html;

    // ফুটার আপডেট
    const finalPL = totalCurrentValue - totalInvestment;
    const finalPLPct = totalInvestment > 0 ? (finalPL / totalInvestment) * 100 : 0;
    const footerInvest = document.getElementById('history-footer-invest');
    const footerValue = document.getElementById('history-footer-value');
    const footerPL = document.getElementById('history-footer-pl');
    const footerPLPct = document.getElementById('history-footer-plpct');

    if (footerInvest) footerInvest.innerHTML = `৳${totalInvestment.toLocaleString('bn-BD', {minimumFractionDigits:2})}`;
    if (footerValue) footerValue.innerHTML = `৳${totalCurrentValue.toLocaleString('bn-BD', {minimumFractionDigits:2})}`;
    if (footerPL) {
        footerPL.innerHTML = `${finalPL >= 0 ? '+' : ''}৳${finalPL.toLocaleString('bn-BD', {minimumFractionDigits:2})}`;
        footerPL.style.color = finalPL >= 0 ? '#10b981' : '#ef4444';
    }
    if (footerPLPct) {
        footerPLPct.innerHTML = `${finalPLPct >= 0 ? '+' : ''}${finalPLPct.toFixed(2)}%`;
        footerPLPct.style.color = finalPLPct >= 0 ? '#10b981' : '#ef4444';
    }
}

// ==========================================
// 📈 হিস্ট্রি চার্ট রেন্ডার
// ==========================================

function renderHistoryChart(data) {
    const canvas = document.getElementById('historyChart');
    if (!canvas) return;
    if (window.historyChartInstance) {
        window.historyChartInstance.destroy();
        window.historyChartInstance = null;
    }
    if (data.length === 0) return;

    // সর্বশেষ ১০০টি ডেটা দেখান
    const displayData = data.length > 100 ? data.slice(-100) : data;

    const labels = displayData.map(item => formatDateShort(item.date));
    const investData = displayData.map(item => item.totalInvestment);
    const valueData = displayData.map(item => item.totalCurrentValue);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    window.historyChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { 
                    label: 'Total Investment', 
                    data: investData, 
                    borderColor: '#3b82f6', 
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    borderWidth: 2.5, 
                    tension: 0.2, 
                    fill: true,
                    pointRadius: 2,
                    pointBackgroundColor: '#3b82f6'
                },
                { 
                    label: 'Current Value', 
                    data: valueData, 
                    borderColor: '#10b981', 
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    borderWidth: 2.5, 
                    tension: 0.2, 
                    fill: true,
                    pointRadius: 2,
                    pointBackgroundColor: '#10b981'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { 
                    position: 'top', 
                    labels: { color: textColor, boxWidth: 12, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const val = ctx.raw;
                            if (val === null || val === undefined) return null;
                            return `${ctx.dataset.label}: ৳${val.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
                        }
                    }
                }
            },
            scales: {
                x: { 
                    ticks: { color: textColor, maxRotation: 45, font: { size: 9 } }, 
                    grid: { color: gridColor } 
                },
                y: { 
                    ticks: { color: textColor, callback: (v) => '৳' + v.toLocaleString() }, 
                    grid: { color: gridColor } 
                }
            }
        }
    });
}

// ==========================================
// 📅 ফিল্টার ফাংশন
// ==========================================

export function filterHistoryByDate() {
    console.log('🔍 Filtering history by date...');
    loadPortfolioHistory();
}

export function resetHistoryFilter() {
    const startInput = document.getElementById('history-start-date');
    const endInput = document.getElementById('history-end-date');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    console.log('🔄 History filter reset');
    loadPortfolioHistory();
}

export function setHistoryMode(mode) {
    currentHistoryMode = mode;
    const fbBtn = document.getElementById('history-firebase-mode');
    const liveBtn = document.getElementById('history-live-mode');
    if (fbBtn && liveBtn) {
        if (mode === 'firebase') {
            fbBtn.classList.add('active');
            fbBtn.style.background = '#10b981';
            liveBtn.classList.remove('active');
            liveBtn.style.background = '#64748b';
        } else {
            liveBtn.classList.add('active');
            liveBtn.style.background = '#10b981';
            fbBtn.classList.remove('active');
            fbBtn.style.background = '#64748b';
        }
    }
    console.log(`📊 History mode set to: ${mode}`);
    loadPortfolioHistory();
}

// ==========================================
// 🧰 হেলপার ফাংশন (ডেট ফরম্যাট)
// ==========================================

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(dateStr) {
    const date = new Date(dateStr);
    return `${date.getDate()}/${date.getMonth() + 1}`;
}

// ==========================================
// ⌨️ Keyboard Shortcut (Ctrl+R)
// ==========================================

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        if (auth && auth.currentUser) manualReloadDashboard();
    }
});

console.log('✅ dash-utils.js (History Fix) loaded');