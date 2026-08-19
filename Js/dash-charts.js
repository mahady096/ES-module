// ==========================================
// 📊 dash-charts.js - Dashboard Charts (Fully Refactored)
//    - Firebase + Supabase dual support
//    - Optimized timeline data fetching
//    - Proper date filtering with caching
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { showToast } from './app-charts.js';
import { safeParseDate, formatDisplayTime } from './core.js';

let dashboardChartInstance = null;
let dailyPLChartInstance = null;
let historyChartInstance = null;

// ==========================================
// Render Dashboard History Chart
// ==========================================

export async function renderDashboardHistoryChart(startDate = null, endDate = null) {
    const canvas = document.getElementById('dashboardHistoryChart');
    if (!canvas) {
        console.warn('⚠️ dashboardHistoryChart canvas not found');
        return;
    }

    const parent = canvas.parentElement;
    let loadingDiv = document.getElementById('chart-loading-placeholder');
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'chart-loading-placeholder';
        loadingDiv.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            display: flex; justify-content: center; align-items: center;
            color: var(--text-muted); font-size: 14px; z-index: 10;
            background: var(--bg-secondary); border-radius: 12px;
        `;
        loadingDiv.innerHTML = '⏳ Loading portfolio history...';
        if (parent) {
            parent.style.position = 'relative';
            parent.appendChild(loadingDiv);
        }
    } else {
        loadingDiv.style.display = 'flex';
        loadingDiv.innerHTML = '⏳ Loading portfolio history...';
    }

    try {
        const historyData = await fetchPortfolioTimelineData(startDate, endDate);
        if (!historyData || historyData.length === 0) {
            if (loadingDiv) loadingDiv.innerHTML = '📭 No history data available';
            return;
        }

        let displayData = historyData;
        if (historyData.length > 100) {
            const step = Math.ceil(historyData.length / 100);
            displayData = historyData.filter((_, index) => index % step === 0);
        }

        const labels = displayData.map(item => item.date);
        const investData = displayData.map(item => item.totalInvestment);
        const valueData = displayData.map(item => item.totalCurrentValue);

        if (loadingDiv) loadingDiv.remove();

        if (dashboardChartInstance) {
            dashboardChartInstance.destroy();
            dashboardChartInstance = null;
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        const ctx = canvas.getContext('2d');
        dashboardChartInstance = new Chart(ctx, {
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

    } catch (error) {
        console.error('Chart render error:', error);
        if (loadingDiv) loadingDiv.innerHTML = '❌ Failed to load chart';
    }
}

// ==========================================
// Render Daily P&L Chart
// ==========================================

export async function renderDashboardDailyPLChart(startDate = null, endDate = null) {
    const canvas = document.getElementById('dashboardDailyPLChart');
    if (!canvas) {
        console.warn('⚠️ dashboardDailyPLChart canvas not found');
        return;
    }

    const parent = canvas.parentElement;
    let loadingDiv = document.getElementById('daily-pl-chart-loading');
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'daily-pl-chart-loading';
        loadingDiv.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            display: flex; justify-content: center; align-items: center;
            color: var(--text-muted); font-size: 14px; z-index: 10;
            background: var(--bg-secondary); border-radius: 12px;
        `;
        loadingDiv.innerHTML = '⏳ Loading daily P&L...';
        if (parent) {
            parent.style.position = 'relative';
            parent.appendChild(loadingDiv);
        }
    } else {
        loadingDiv.style.display = 'flex';
        loadingDiv.innerHTML = '⏳ Loading daily P&L...';
    }

    try {
        const historyData = await fetchPortfolioTimelineData(startDate, endDate);
        if (!historyData || historyData.length === 0) {
            if (loadingDiv) loadingDiv.innerHTML = '📭 No history data available';
            return;
        }

        const labels = historyData.map(item => item.date);
        const dailyPLData = historyData.map(item => item.dailyPL);

        let displayLabels = labels;
        let displayPL = dailyPLData;
        if (labels.length > 100) {
            const step = Math.ceil(labels.length / 100);
            displayLabels = labels.filter((_, index) => index % step === 0);
            displayPL = dailyPLData.filter((_, index) => index % step === 0);
        }

        if (loadingDiv) loadingDiv.remove();

        if (dailyPLChartInstance) {
            dailyPLChartInstance.destroy();
            dailyPLChartInstance = null;
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        const ctx = canvas.getContext('2d');
        dailyPLChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: displayLabels,
                datasets: [{
                    label: 'Daily P&L (৳)',
                    data: displayPL,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2.5,
                    tension: 0.2,
                    fill: true,
                    pointRadius: 2,
                    pointBackgroundColor: '#8b5cf6',
                    segment: {
                        borderColor: (ctx) => {
                            const value = ctx.p0.parsed.y;
                            return value >= 0 ? '#10b981' : '#ef4444';
                        }
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { 
                        display: true, 
                        position: 'top', 
                        labels: { color: textColor, boxWidth: 12, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw;
                                if (val === null || val === undefined) return null;
                                return `Daily P&L: ${val >= 0 ? '+' : ''}৳${val.toFixed(2)}`;
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
                        ticks: { color: textColor, callback: (v) => '৳' + v.toFixed(0) }, 
                        grid: { color: gridColor } 
                    }
                }
            }
        });

    } catch (error) {
        console.error('Daily PL chart error:', error);
        if (loadingDiv) loadingDiv.innerHTML = '❌ Failed to load chart';
    }
}

// ==========================================
// Date Filter Functions
// ==========================================

export function applyDashboardDateFilter() {
    const start = document.getElementById('dash-chart-start')?.value;
    const end = document.getElementById('dash-chart-end')?.value;
    if (start && end) {
        renderDashboardChartsWithRange(start, end);
    } else {
        showToast('Please select both dates.', 'warning');
    }
}

export function resetDashboardDateFilter() {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const start = thirtyDaysAgo.toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    const startInput = document.getElementById('dash-chart-start');
    const endInput = document.getElementById('dash-chart-end');
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;
    renderDashboardChartsWithRange(start, end);
}

async function renderDashboardChartsWithRange(start, end) {
    const historyData = await fetchPortfolioTimelineData(start, end);
    if (!historyData || historyData.length === 0) {
        showToast('No data in selected range.', 'warning');
        return;
    }
    await renderDashboardHistoryChart(start, end);
    await renderDashboardDailyPLChart(start, end);
}

// ==========================================
// 🔥 Core Timeline Data Fetcher (Refactored)
// ==========================================

export async function fetchPortfolioTimelineData(startDate = null, endDate = null, portfolioId = null) {
    console.log('📥 fetchPortfolioTimelineData called');
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const defaultStart = thirtyDaysAgo.toISOString().split('T')[0];
    const defaultEnd = today.toISOString().split('T')[0];
    const start = startDate || defaultStart;
    const end = endDate || defaultEnd;

    // 🔥 ক্যাশ চেক
    const cacheKey = `timeline_${user.uid}_${start}_${end}_${portfolioId || 'all'}`;
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 1800000) {
                console.log('✅ Returning cached timeline data');
                return parsed.data;
            }
        }
    } catch (e) {}

    try {
        // ==========================================
        // 1. 🔥 পোর্টফোলিও ডেটা ফেচ (Supabase First)
        // ==========================================
        let buyLots = [];
        let salesMap = new Map();

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                let query = supabase.from('portfolios').select('*').eq('user_id', user.uid);
                if (portfolioId && portfolioId !== 'grand' && portfolioId !== 'all') {
                    query = query.eq('portfolio_id', portfolioId);
                }
                const { data, error } = await query;
                if (!error && data && data.length > 0) {
                    data.forEach(item => {
                        const totalCost = (item.quantity * item.buy_price) + (item.commission || 0);
                        const perUnitCost = item.quantity > 0 ? totalCost / item.quantity : item.buy_price;
                        const date = new Date(item.date);
                        buyLots.push({
                            ticker: item.share_name,
                            qty: item.quantity,
                            buyPrice: item.buy_price,
                            perUnitCost: perUnitCost,
                            date: date,
                            buyDateStr: date.toISOString().split('T')[0]
                        });
                    });
                }
            } catch (e) {
                console.warn('⚠️ Supabase portfolio fetch failed in timeline, trying Firebase...', e);
            }
        }

        // 🔄 Firebase ফ্যালব্যাক
        if (buyLots.length === 0 && typeof db !== 'undefined') {
            try {
                let query = db.collection('portfolios').where('userId', '==', user.uid);
                if (portfolioId && portfolioId !== 'grand' && portfolioId !== 'all') {
                    query = query.where('portfolioId', '==', portfolioId);
                }
                const snap = await query.get();
                snap.forEach(doc => {
                    const data = doc.data();
                    const totalCost = (data.quantity * data.buyPrice) + (data.commission || 0);
                    const perUnitCost = data.quantity > 0 ? totalCost / data.quantity : data.buyPrice;
                    const date = data.date ? (data.date.toDate ? data.date.toDate() : new Date(data.date)) : new Date();
                    buyLots.push({
                        ticker: data.shareName,
                        qty: data.quantity,
                        buyPrice: data.buyPrice,
                        perUnitCost: perUnitCost,
                        date: date,
                        buyDateStr: date.toISOString().split('T')[0]
                    });
                });
            } catch (e) {
                console.warn('⚠️ Firebase portfolio fetch failed in timeline', e);
            }
        }

        if (buyLots.length === 0) {
            console.log('📭 No buy lots found for timeline');
            return [];
        }

        // ==========================================
        // 2. 🔥 সেলস ডেটা ফেচ (Supabase First)
        // ==========================================
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                let query = supabase.from('sales_history').select('*').eq('user_id', user.uid);
                if (portfolioId && portfolioId !== 'grand' && portfolioId !== 'all') {
                    query = query.eq('portfolio_id', portfolioId);
                }
                const { data, error } = await query;
                if (!error && data) {
                    data.forEach(item => {
                        const ticker = item.share_name;
                        salesMap.set(ticker, (salesMap.get(ticker) || 0) + (item.quantity_sold || 0));
                    });
                }
            } catch (e) {
                console.warn('⚠️ Supabase sales fetch failed in timeline, trying Firebase...', e);
            }
        }

        // 🔄 Firebase ফ্যালব্যাক
        if (salesMap.size === 0 && typeof db !== 'undefined') {
            try {
                let query = db.collection('sales_history').where('userId', '==', user.uid);
                if (portfolioId && portfolioId !== 'grand' && portfolioId !== 'all') {
                    query = query.where('portfolioId', '==', portfolioId);
                }
                const snap = await query.get();
                snap.forEach(doc => {
                    const data = doc.data();
                    const ticker = data.shareName;
                    salesMap.set(ticker, (salesMap.get(ticker) || 0) + (data.quantitySold || 0));
                });
            } catch (e) {
                console.warn('⚠️ Firebase sales fetch failed in timeline', e);
            }
        }

        // ==========================================
        // 3. ডেট রেঞ্জ তৈরি করুন
        // ==========================================
        buyLots.sort((a, b) => a.date - b.date);
        const firstBuyDate = buyLots[0].date;
        let daysDiff = Math.ceil((today - firstBuyDate) / (1000 * 60 * 60 * 24));
        if (daysDiff < 1) daysDiff = 1;
        const finalDays = Math.min(daysDiff, 365);

        const allDates = [];
        for (let i = 0; i <= finalDays; i++) {
            const d = new Date(firstBuyDate);
            d.setDate(firstBuyDate.getDate() + i);
            allDates.push(d);
        }

        // ফিল্টার প্রয়োগ
        const startObj = new Date(start);
        const endObj = new Date(end);
        startObj.setHours(0, 0, 0, 0);
        endObj.setHours(23, 59, 59, 999);

        const filteredDates = allDates.filter(d => {
            if (startObj && d < startObj) return false;
            if (endObj && d > endObj) return false;
            return true;
        });

        if (filteredDates.length === 0) return [];

        // ==========================================
        // 4. প্রতিদিনের হিসাব (FIFO + প্রাইস ফেচ)
        // ==========================================
        const dailyPortfolio = [];
        let cumulativeLots = [];
        let lotIndex = 0;
        const priceCache = {};

        // প্রাইস ফেচ করার হেলপার (Supabase → Firebase)
        async function getPriceForDate(ticker, dateStr) {
            const cacheKey2 = `${ticker}_${dateStr}`;
            if (priceCache[cacheKey2]) return priceCache[cacheKey2];

            let price = 0;

            // Supabase history_dse
            if (typeof supabase !== 'undefined' && supabase) {
                try {
                    const { data, error } = await supabase
                        .from('history_dse')
                        .select('ltp')
                        .eq('ticker', ticker)
                        .eq('date', dateStr)
                        .limit(1);
                    if (!error && data && data.length > 0) {
                        price = parseFloat(data[0].ltp) || 0;
                    }
                } catch (e) {}
            }

            // Firebase daily_prices ফ্যালব্যাক
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

            // ফ্যালব্যাক: avgCost ব্যবহার করুন
            if (price === 0) {
                const lot = buyLots.find(l => l.ticker === ticker);
                price = lot ? lot.perUnitCost : 0;
            }

            priceCache[cacheKey2] = price;
            return price;
        }

        for (const currentDate of filteredDates) {
            const dateStr = currentDate.toISOString().split('T')[0];

            // এই তারিখ পর্যন্ত Buy লট যোগ করুন
            while (lotIndex < buyLots.length && buyLots[lotIndex].date <= currentDate) {
                const lot = buyLots[lotIndex];
                cumulativeLots.push({ ...lot, remainingQty: lot.qty });
                lotIndex++;
            }

            // সেলস বিয়োগ (FIFO)
            const tempSoldMap = new Map(salesMap);
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
            for (const stock of remainingStocks) {
                const price = await getPriceForDate(stock.ticker, dateStr);
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

        // ক্যাশে সেভ
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
                timestamp: Date.now(),
                data: dailyPortfolio
            }));
        } catch (e) {}

        return dailyPortfolio;

    } catch (error) {
        console.error('❌ Error in fetchPortfolioTimelineData:', error);
        return [];
    }
}

// ==========================================
// Render History Table (for Value History Tab)
// ==========================================

export function renderHistoryTable(data) {
    const tableBody = document.getElementById('history-table-body');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">No data for selected range.</td></tr>`;
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

    const displayData = data.length > 100 ? data.slice(-100) : data;

    for (const item of displayData) {
        totalInvestment += item.totalInvestment;
        totalCurrentValue += item.totalCurrentValue;
        const pl = item.dailyPL;
        const pct = item.dailyPLPercent;
        const color = pl >= 0 ? '#10b981' : '#ef4444';
        const sign = pl >= 0 ? '+' : '';

        html += `<tr>
            <td style="padding: 8px;">${formatDisplayDate(item.date)}</td>
            <td style="padding: 8px; text-align:right;">৳${item.totalInvestment.toLocaleString('bn-BD', {minimumFractionDigits:2})}</td>
            <td style="padding: 8px; text-align:right;">৳${item.totalCurrentValue.toLocaleString('bn-BD', {minimumFractionDigits:2})}</td>
            <td style="padding: 8px; text-align:right; color:${color};">${sign}৳${pl.toLocaleString('bn-BD', {minimumFractionDigits:2})}</td>
            <td style="padding: 8px; text-align:right; color:${color};">${sign}${pct.toFixed(2)}%</td>
            <td style="padding: 8px; text-align:center;">${pl >= 0 ? '✅' : '📉'}</td>
        </tr>`;
    }

    tableBody.innerHTML = html;

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
// Render History Chart (for Value History Tab)
// ==========================================

export function renderHistoryChart(data) {
    const canvas = document.getElementById('historyChart');
    if (!canvas) return;
    if (historyChartInstance) {
        historyChartInstance.destroy();
        historyChartInstance = null;
    }
    if (data.length === 0) return;

    const displayData = data.length > 100 ? data.slice(-100) : data;

    const labels = displayData.map(item => formatShortDate(item.date));
    const investData = displayData.map(item => item.totalInvestment);
    const valueData = displayData.map(item => item.totalCurrentValue);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    historyChartInstance = new Chart(canvas, {
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
// Utility: Date Formatting
// ==========================================

function formatDisplayDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatShortDate(dateStr) {
    const date = new Date(dateStr);
    return `${date.getDate()}/${date.getMonth() + 1}`;
}

// ==========================================
// History Mode Switcher (for Value History Tab)
// ==========================================

export function setHistoryMode(mode) {
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
    if (typeof window.loadPortfolioHistory === 'function') {
        window.loadPortfolioHistory();
    }
}

console.log('✅ dash-charts.js (fully refactored) loaded');