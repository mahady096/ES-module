// ==========================================
// 📁 ui-charts.js - UI Chart Rendering
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { getUnifiedPrice, getLatestAndPreviousPrices, safeParseDate } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR, cachedRSI, cachedParabolicSAR } from './indicators.js';

// ==========================================
// Price History Chart
// ==========================================

export async function loadPriceHistoryChart(ticker, startDate = null, endDate = null) {
    if (!ticker) return;
    const canvas = document.getElementById('adv-stock-chart');
    if (!canvas) return;
    if (window.advMainChart) {
        window.advMainChart.destroy();
        window.advMainChart = null;
    }

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    let start = startDate ? new Date(startDate) : new Date();
    if (!startDate) start.setDate(start.getDate() - 30);
    let end = endDate ? new Date(endDate) : new Date();
    const startDateStr = start.toISOString().split('T')[0];
    const endDateStr = end.toISOString().split('T')[0];

    const prices = [], labels = [], highData = [], lowData = [];

    // Supabase history_dse
    if (typeof supabase !== 'undefined' && supabase) {
        try {
            let query = supabase
                .from('history_dse')
                .select('date, ltp, high, low')
                .eq('code', ticker)
                .gte('date', startDateStr)
                .order('date', { ascending: true });
            if (endDateStr) {
                query = query.lte('date', endDateStr);
            }
            const { data, error } = await query;
            if (!error && data && data.length > 0) {
                data.forEach(row => {
                    const price = parseFloat(row.ltp);
                    const high = parseFloat(row.high) || price;
                    const low = parseFloat(row.low) || price;
                    if (price > 0) {
                        prices.push(price);
                        highData.push(high);
                        lowData.push(low);
                        labels.push(row.date);
                    }
                });
            }
        } catch (e) { /* ignore */ }
    }

    // Firebase fallback
    if (prices.length === 0 && typeof db !== 'undefined') {
        try {
            let query = db.collection('daily_prices')
                .where('ticker', '==', ticker)
                .where('date', '>=', startDateStr)
                .orderBy('date', 'asc');
            if (endDateStr) query = query.where('date', '<=', endDateStr);
            const snap = await query.get();
            if (!snap.empty) {
                snap.forEach(doc => {
                    const data = doc.data();
                    const price = parseFloat(data.price) || parseFloat(data.close) || 0;
                    const high = parseFloat(data.high) || price;
                    const low = parseFloat(data.low) || price;
                    if (price > 0) {
                        prices.push(price);
                        highData.push(high);
                        lowData.push(low);
                        labels.push(data.date);
                    }
                });
            }
        } catch (e) { /* ignore */ }
    }

    if (prices.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#64748b';
        ctx.font = '14px sans-serif';
        ctx.fillText('No price data available for selected range', 10, 50);
        return;
    }

    // PSAR
    const priceDataForSAR = labels.map((date, idx) => ({
        date: date,
        ltp: prices[idx],
        high: highData[idx] || prices[idx],
        low: lowData[idx] || prices[idx]
    }));
    const sarData = calculateParabolicSAR(priceDataForSAR);

    // Avg Buy Price
    let avgBuyPrice = 0;
    try {
        const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
        if (unifiedData && unifiedData.stockDetails) {
            const stockData = unifiedData.stockDetails.find(s => s.ticker === ticker);
            if (stockData && stockData.totalQty > 0) {
                avgBuyPrice = stockData.totalCost / stockData.totalQty;
            }
        }
    } catch (e) { /* ignore */ }
    const avgBuyLine = new Array(prices.length).fill(avgBuyPrice);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    const sarColors = sarData.map(p => p.trend === 'up' ? '#10b981' : '#ef4444');

    const ctx = canvas.getContext('2d');
    window.advMainChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `${ticker} Price`,
                    data: prices,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointBackgroundColor: '#3b82f6'
                },
                {
                    label: `Your Avg Buy (${avgBuyPrice > 0 ? '৳' + avgBuyPrice.toFixed(2) : 'N/A'})`,
                    data: avgBuyLine,
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    borderDash: [8, 6],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Parabolic SAR',
                    data: sarData.map(p => p.sar),
                    type: 'scatter',
                    backgroundColor: sarColors,
                    borderColor: sarColors,
                    pointRadius: 5,
                    pointStyle: 'rectRot',
                    showInLegend: true,
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: textColor } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.label.includes('Parabolic SAR')) {
                                const idx = ctx.dataIndex;
                                const trend = sarData[idx]?.trend || 'neutral';
                                return `PSAR: ৳${ctx.raw.toFixed(2)} (${trend === 'up' ? '🟢 Up' : '🔴 Down'})`;
                            }
                            return ctx.dataset.label.includes('Price') ?
                                `${ctx.dataset.label}: ৳${ctx.raw.toFixed(2)}` :
                                ctx.dataset.label;
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { color: textColor, maxRotation: 45 }, grid: { color: gridColor } },
                y: { ticks: { color: textColor, callback: (v) => '৳' + v.toFixed(0) }, grid: { color: gridColor } }
            }
        }
    });
}

// ==========================================
// RSI Chart
// ==========================================

export async function loadRSIChart(ticker, startDate = null, endDate = null) {
    if (!ticker) return;
    const canvas = document.getElementById('adv-rsi-chart');
    if (!canvas) return;
    if (window.rsiChartInstance) {
        window.rsiChartInstance.destroy();
        window.rsiChartInstance = null;
    }

    let start = startDate ? new Date(startDate) : new Date();
    if (!startDate) start.setDate(start.getDate() - 30);
    let end = endDate ? new Date(endDate) : new Date();
    const startDateStr = start.toISOString().split('T')[0];
    const endDateStr = end.toISOString().split('T')[0];

    let priceData = [];

    if (typeof supabase !== 'undefined' && supabase) {
        try {
            let query = supabase
                .from('history_dse')
                .select('date, ltp')
                .eq('code', ticker)
                .gte('date', startDateStr)
                .order('date', { ascending: true });
            if (endDateStr) {
                query = query.lte('date', endDateStr);
            }
            const { data, error } = await query;
            if (!error && data && data.length > 0) {
                priceData = data.map(d => ({ date: d.date, ltp: parseFloat(d.ltp) }));
            }
        } catch (e) { /* ignore */ }
    }

    if (priceData.length === 0 && typeof db !== 'undefined') {
        try {
            let query = db.collection('daily_prices')
                .where('ticker', '==', ticker)
                .where('date', '>=', startDateStr)
                .orderBy('date', 'asc');
            if (endDateStr) {
                query = query.where('date', '<=', endDateStr);
            }
            const snap = await query.get();
            if (!snap.empty) {
                snap.forEach(doc => {
                    const data = doc.data();
                    const price = parseFloat(data.price) || parseFloat(data.close) || 0;
                    if (price > 0) {
                        priceData.push({ date: data.date, ltp: price });
                    }
                });
            }
        } catch (e) { /* ignore */ }
    }

    if (priceData.length < 15) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#64748b';
        ctx.font = '14px sans-serif';
        ctx.fillText('Insufficient data for RSI (need 15+ days)', 10, 50);
        return;
    }

    const rsiData = calculateRSI(priceData.map(p => p.ltp), 14);
    const labels = rsiData.map((d, i) => priceData[i]?.date || i);
    const rsiValues = rsiData.map(d => d.rsi);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    const ctx = canvas.getContext('2d');
    window.rsiChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'RSI (14)',
                data: rsiValues,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 2,
                pointBackgroundColor: '#8b5cf6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: textColor } },
                tooltip: { callbacks: { label: (ctx) => `RSI: ${ctx.raw.toFixed(2)}` } }
            },
            scales: {
                x: { ticks: { color: textColor, maxRotation: 45 }, grid: { color: gridColor } },
                y: { ticks: { color: textColor, callback: (v) => v.toFixed(0) }, grid: { color: gridColor }, min: 0, max: 100 }
            }
        }
    });
}

// ==========================================
// Gain/Loss Chart
// ==========================================

export async function loadGainAnalysisChart(ticker, startDate = null, endDate = null) {
    if (!ticker) return;
    const canvas = document.getElementById('adv-gain-chart');
    if (!canvas) return;
    if (window.gainChartInstance) {
        window.gainChartInstance.destroy();
        window.gainChartInstance = null;
    }

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    let start = startDate ? new Date(startDate) : new Date();
    if (!startDate) start.setDate(start.getDate() - 90);
    let end = endDate ? new Date(endDate) : new Date();
    const startDateStr = start.toISOString().split('T')[0];
    const endDateStr = end.toISOString().split('T')[0];

    try {
        if (typeof db === 'undefined') return;

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

        let priceMap = new Map();

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                let query = supabase
                    .from('history_dse')
                    .select('date, ltp')
                    .eq('code', ticker)
                    .gte('date', startDateStr)
                    .order('date', { ascending: true });
                if (endDateStr) {
                    query = query.lte('date', endDateStr);
                }
                const { data, error } = await query;
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
                let query = db.collection('daily_prices')
                    .where('ticker', '==', ticker)
                    .where('date', '>=', startDateStr)
                    .orderBy('date', 'asc');
                if (endDateStr) {
                    query = query.where('date', '<=', endDateStr);
                }
                const snap = await query.get();
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
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#64748b';
            ctx.font = '14px sans-serif';
            ctx.fillText('No price data for selected range', 10, 50);
            return;
        }

        const allDates = Array.from(priceMap.keys()).sort();
        let fifoLots = [];
        let sellIndex = 0;
        const chartLabels = [];
        const plData = [];

        let buyLotIndex = 0;
        let tempAllBuyLots = [...allBuyLots];

        for (const date of allDates) {
            const ltp = priceMap.get(date) || 0;
            if (ltp === 0) continue;

            while (buyLotIndex < tempAllBuyLots.length && tempAllBuyLots[buyLotIndex].date <= new Date(date)) {
                fifoLots.push({ ...tempAllBuyLots[buyLotIndex] });
                buyLotIndex++;
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
            const currentValue = totalQty * ltp;
            const dailyPL = currentValue - totalCost;

            chartLabels.push(date);
            plData.push(dailyPL);
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        const datasets = [{
            label: 'Unrealized P&L (৳)',
            data: plData,
            type: 'line',
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            borderWidth: 3,
            tension: 0.2,
            fill: true,
            pointRadius: 2,
            pointBackgroundColor: '#3b82f6',
            order: 1,
            segment: {
                borderColor: (ctx) => {
                    const value = ctx.p0.parsed.y;
                    return value >= 0 ? '#10b981' : '#ef4444';
                }
            }
        }];

        const ctx = canvas.getContext('2d');
        window.gainChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: chartLabels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: true, position: 'top', labels: { color: textColor } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.parsed.y;
                                return `${val >= 0 ? '+' : ''}৳${val.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: textColor, maxRotation: 45 }, grid: { color: gridColor, display: false } },
                    y: { ticks: { color: textColor, callback: (v) => '৳' + v.toFixed(0) }, grid: { color: gridColor } }
                }
            }
        });
    } catch (error) {
        console.error('Gain chart error:', error);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ef4444';
        ctx.font = '14px sans-serif';
        ctx.fillText('Error loading gain chart', 10, 50);
    }
}

// ==========================================
// Modal Performance Table
// ==========================================

export async function loadModalPerformanceTable(ticker) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    let currentPrice = await getUnifiedPrice(ticker);
    if (currentPrice === 0) {
        const priceData = await getLatestAndPreviousPrices([ticker]);
        currentPrice = priceData.get(ticker)?.currentPrice || 0;
    }

    const periods = [
        { name: 'today', days: 0, label: 'Today' },
        { name: '5d', days: 5, label: '5 Days' },
        { name: '15d', days: 15, label: '15 Days' },
        { name: '30d', days: 30, label: '30 Days' },
        { name: '3m', days: 90, label: '3 Months' },
        { name: '6m', days: 180, label: '6 Months' },
        { name: '1y', days: 365, label: '1 Year' }
    ];

    const returns = {};
    for (const period of periods) {
        if (period.days === 0) {
            const priceData = await getLatestAndPreviousPrices([ticker]);
            const prevPrice = priceData.get(ticker)?.previousPrice || 0;
            if (prevPrice > 0) {
                returns.today = ((currentPrice - prevPrice) / prevPrice) * 100;
            } else {
                returns.today = 0;
            }
            continue;
        }

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - period.days);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        let pastPrice = 0;

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('history_dse')
                    .select('ltp')
                    .eq('code', ticker)
                    .eq('date', targetDateStr)
                    .limit(1);
                if (!error && data && data.length > 0) {
                    pastPrice = parseFloat(data[0].ltp) || 0;
                }
            } catch (e) { /* ignore */ }
        }

        if (pastPrice === 0 && typeof db !== 'undefined') {
            try {
                const snap = await db.collection('daily_prices')
                    .where('ticker', '==', ticker)
                    .where('date', '==', targetDateStr)
                    .limit(1)
                    .get();
                if (!snap.empty) {
                    const data = snap.docs[0].data();
                    pastPrice = parseFloat(data.price) || parseFloat(data.close) || 0;
                }
            } catch (e) { /* ignore */ }
        }

        if (pastPrice && pastPrice > 0) {
            returns[period.name] = ((currentPrice - pastPrice) / pastPrice) * 100;
        } else {
            returns[period.name] = null;
        }
    }

    const updateCell = (id, value) => {
        const elem = document.getElementById(id);
        if (elem) {
            if (value === null || value === undefined) {
                elem.innerHTML = '-';
                elem.style.color = '#64748b';
            } else {
                elem.innerHTML = `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
                elem.style.color = value >= 0 ? '#10b981' : '#ef4444';
            }
        }
    };
    updateCell('modal-perf-today', returns.today);
    updateCell('modal-perf-5d', returns['5d']);
    updateCell('modal-perf-15d', returns['15d']);
    updateCell('modal-perf-30d', returns['30d']);
    updateCell('modal-perf-3m', returns['3m']);
    updateCell('modal-perf-6m', returns['6m']);
    updateCell('modal-perf-1y', returns['1y']);
}

console.log('✅ ui-charts.js loaded');