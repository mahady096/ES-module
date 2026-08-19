// ==========================================
// 📁 app-charts.js - অ্যাডভান্সড চার্টের কোর ফাংশন
// ==========================================

import { 
    toBangladeshTime, getBangladeshDateString, formatDisplayTime, 
    getTodayDate, getUTCFromLocalDate, getSafePrice, calculatePercentage,
    safeDivision, chunkArray, debounce, safeParseDate, 
    CommissionManager, dseStocks, getUnifiedPrice, resetUnifiedPriceCache,
    getPreviousDayPrice, getLatestAndPreviousPrices 
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
import { unifiedEngine } from './app-dashboard.js';

// ==========================================
// 📌 টোস্ট নোটিফিকেশন
// ==========================================

export function showToast(message, type = 'info', duration = 3000) {
    if (typeof document === 'undefined') return;
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 99999;
            display: flex; flex-direction: column; gap: 10px;
            max-width: 350px; width: 100%;
        `;
        document.body.appendChild(container);
    }

    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    const bgColor = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.style.cssText = `
        background: var(--bg-secondary, #ffffff);
        border-left: 4px solid ${bgColor};
        border-radius: 8px; padding: 14px 18px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.15);
        display: flex; justify-content: space-between; align-items: center;
        animation: slideIn 0.3s ease; color: var(--text-primary, #333);
        font-size: 14px; font-weight: 500;
    `;
    toast.innerHTML = `<span>${message}</span><span style="cursor:pointer; margin-left:12px; font-size:18px; opacity:0.6;" onclick="this.parentElement.remove()">×</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

// ==========================================
// 📌 গ্লোবাল ভেরিয়েবল
// ==========================================

let advMainChart = null;
let advRSIChart = null;
let advStochChart = null;
export let advChartData = null;
export let advActiveIndicators = {
    sma5: false, sma10: false, sma20: false, sma50: false,
    ema5: false, ema10: true, ema20: true, ema50: false,
    rsi: true, bollinger: true, stochastic: true,
    atr: false, forecast: false, psar: false,
    vwap: false, volprofile: false, fibonacci: false,
    aroon: false, ichimoku: false, linreg: false,
    wma: false, holtWinters: false, vwapForecast: false, macdForecast: false
};
export let advCurrentTicker = 'GP';
export let advCurrentPeriod = 30;
export let advDataSource = 'database';
export let currentChartType = 'line';
export let volumeData = [];

// ==========================================
// 📌 ব্যাক বাটন
// ==========================================

export function goBackToStockModal() {
    const params = new URLSearchParams(window.location.search);
    const ticker = params.get('ticker');
    if (ticker) {
        window.location.href = `/?ticker=${ticker}`;
    } else {
        window.history.back();
    }
}

// ==========================================
// 📌 ডেটা লোড
// ==========================================

export async function loadAdvancedChart(ticker, forceRefresh = false) {
    const searchInput = document.getElementById('adv-chart-search');
    const finalTicker = ticker || (searchInput ? searchInput.value.trim().toUpperCase() || advCurrentTicker : advCurrentTicker);
    
    if (!finalTicker) {
        showToast('Please enter a share name', 'warning');
        return;
    }
    if (!dseStocks.includes(finalTicker)) {
        showToast('Share not found. Please select from suggestions.', 'warning');
        return;
    }

    advCurrentTicker = finalTicker;
    const titleEl = document.getElementById('adv-chart-title');
    if (titleEl) titleEl.innerText = `${finalTicker} - Price History`;

    const footerSource = document.getElementById('footer-source');
    if (footerSource) {
        const sourceSelect = document.getElementById('adv-data-source');
        footerSource.innerText = sourceSelect ? sourceSelect.selectedOptions[0].text : 'Database';
    }

    const source = document.getElementById('adv-data-source')?.value || 'database';
    const period = advCurrentPeriod === 'all' ? 'all' : advCurrentPeriod;
    const cacheKey = `chart_${finalTicker}_${source}_${period}`;
    const CACHE_TTL = source === 'live' ? 120000 : 600000;

    if (forceRefresh) {
        window.CacheManager.remove(cacheKey);
    }

    const cachedData = window.CacheManager.get(cacheKey, CACHE_TTL);
    if (cachedData && cachedData.actualPrices && cachedData.actualPrices.length > 0) {
        console.log(`📊 Chart data loaded from cache for ${finalTicker}`);
        advChartData = cachedData;
        volumeData = cachedData.volumeData || [];
        updateStockInfo(advChartData);
        if (currentChartType === 'line') {
            renderAdvancedChart(advChartData);
        } else {
            window.renderCandlestickChart(advChartData);
        }
        generateSuggestion(advChartData);
        setTimeout(runDeepAnalysis, 300);
        showToast(`📊 Loaded ${finalTicker} from cache`, 'info');
        return;
    }

    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (period === 'all' ? 365 : period));
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = new Date().toISOString().split('T')[0];

        let priceData = [], labels = [], highData = [], lowData = [];
        volumeData = [];

        if (source === 'database') {
            if (typeof supabase !== 'undefined' && supabase) {
                try {
                    let query = supabase
                        .from('history_dse')
                        .select('date, ltp, high, low, volume')
                        .eq('ticker', finalTicker)
                        .gte('date', startDateStr)
                        .order('date', { ascending: true });
                    
                    const { data, error } = await query;
                    if (!error && data && data.length > 0) {
                        data.forEach(row => {
                            const price = parseFloat(row.ltp);
                            const high = parseFloat(row.high) || price;
                            const low = parseFloat(row.low) || price;
                            const volume = parseFloat(row.volume) || 0;
                            if (price > 0) {
                                labels.push(row.date);
                                priceData.push(price);
                                highData.push(high);
                                lowData.push(low);
                                volumeData.push(volume);
                            }
                        });
                    }
                } catch (e) {
                    console.warn('Supabase history_dse fetch failed:', e);
                }
            }

            if (priceData.length === 0 && typeof db !== 'undefined') {
                try {
                    let query = db.collection('daily_prices')
                        .where('ticker', '==', finalTicker)
                        .where('date', '>=', startDateStr)
                        .orderBy('date', 'asc');
                    
                    const snap = await query.get();
                    if (!snap.empty) {
                        snap.forEach(doc => {
                            const data = doc.data();
                            const price = parseFloat(data.price) || parseFloat(data.close) || 0;
                            const high = parseFloat(data.high) || price;
                            const low = parseFloat(data.low) || price;
                            if (price > 0) {
                                labels.push(data.date);
                                priceData.push(price);
                                highData.push(high);
                                lowData.push(low);
                                volumeData.push(0);
                            }
                        });
                    }
                } catch (e) {
                    console.warn('Firebase daily_prices fallback failed:', e);
                }
            }
        } else {
            const apiUrl = `https://bd-stock-api-an3n.vercel.app/v1/dse/historical?start=${startDateStr}&end=${endDateStr}&code=${finalTicker}`;
            
            try {
                const response = await fetch(apiUrl);
                const result = await response.json();
                
                if (result.success && result.data && result.data.length > 0) {
                    result.data.forEach(item => {
                        const price = parseFloat(item['LTP*']);
                        const high = parseFloat(item['HIGH']) || price;
                        const low = parseFloat(item['LOW']) || price;
                        const volume = parseFloat(item['VOLUME']) || 0;
                        if (price > 0) {
                            labels.push(item['DATE']);
                            priceData.push(price);
                            highData.push(high);
                            lowData.push(low);
                            volumeData.push(volume);
                        }
                    });
                } else {
                    showToast('No live data available for this period', 'warning');
                }
            } catch (error) {
                console.error('Live API fetch error:', error);
                showToast('Failed to load live data: ' + error.message, 'error');
            }
        }

        if (priceData.length === 0) {
            showToast('No data available for this share from selected source', 'error');
            return;
        }

        let avgBuyPrice = 0;
        const user = auth?.currentUser;
        if (user) {
            try {
                const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
                const stockData = unifiedData.stockDetails.find(s => s.ticker === finalTicker);
                if (stockData && stockData.totalQty > 0) {
                    avgBuyPrice = stockData.totalCost / stockData.totalQty;
                }
            } catch (e) { /* ignore */ }
        }

        const forecast = arimaForecast(priceData, 5);
        let forecastLabels = [], forecastValues = [];
        if (forecast) {
            const lastDate = new Date(labels[labels.length - 1]);
            forecast.forEach((f, idx) => {
                const d = new Date(lastDate);
                d.setDate(d.getDate() + idx + 1);
                forecastLabels.push(d.toISOString().split('T')[0]);
                forecastValues.push(f);
            });
        }

        const allLabels = [...labels, ...forecastLabels];
        const allPrices = [...priceData, ...forecastValues.map(() => null)];

        const chartData = {
            ticker: finalTicker,
            labels: allLabels,
            prices: allPrices,
            actualPrices: priceData,
            actualLabels: labels,
            forecastLabels,
            forecastValues,
            avgBuyPrice,
            high: Math.max(...priceData),
            low: Math.min(...priceData),
            currentPrice: priceData[priceData.length - 1] || 0,
            highData,
            lowData,
            volumeData: volumeData,
            dataSource: source
        };

        window.CacheManager.set(cacheKey, chartData, CACHE_TTL);
        console.log(`📊 Chart data cached for ${finalTicker}`);

        advChartData = chartData;
        updateStockInfo(advChartData);
        if (currentChartType === 'line') {
            renderAdvancedChart(advChartData);
        } else {
            window.renderCandlestickChart(advChartData)
        }
        generateSuggestion(advChartData);

        const updateTime = document.getElementById('adv-chart-update-time');
        if (updateTime) updateTime.innerText = new Date().toLocaleString();
        const suggestionTime = document.getElementById('suggestion-time');
        if (suggestionTime) suggestionTime.innerText = new Date().toLocaleString();
        
        setTimeout(runDeepAnalysis, 500);

    } catch (error) {
        console.error('Chart load error:', error);
        showToast('Error loading chart data: ' + error.message, 'error');
    }
}

// ==========================================
// 📌 লাইন চার্ট রেন্ডার
// ==========================================

export function renderAdvancedChart(data) {
    if (!data) return;

    const mainCanvas = document.getElementById('adv-main-chart');
    if (!mainCanvas) {
        console.error('Main chart canvas not found');
        return;
    }

    if (advMainChart) {
        advMainChart.destroy();
        advMainChart = null;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    const actualPrices = data.actualPrices;
    const labels = data.labels;
    const prices = data.prices;
    const highData = data.highData || [];
    const lowData = data.lowData || [];
    const volume = data.volumeData || [];

    const sma5 = advActiveIndicators.sma5 ? cachedSMA(actualPrices, 5) : [];
    const sma10 = advActiveIndicators.sma10 ? cachedSMA(actualPrices, 10) : [];
    const sma20 = advActiveIndicators.sma20 ? cachedSMA(actualPrices, 20) : [];
    const sma50 = advActiveIndicators.sma50 ? cachedSMA(actualPrices, 50) : [];
    
    const ema5 = advActiveIndicators.ema5 ? cachedEMA(actualPrices, 5) : [];
    const ema10 = advActiveIndicators.ema10 ? cachedEMA(actualPrices, 10) : [];
    const ema20 = advActiveIndicators.ema20 ? cachedEMA(actualPrices, 20) : [];
    const ema50 = advActiveIndicators.ema50 ? cachedEMA(actualPrices, 50) : [];
    
    const bollinger = advActiveIndicators.bollinger ? cachedBollingerBands(actualPrices, 20, 2) : null;
    const rsiData = advActiveIndicators.rsi ? cachedRSI(actualPrices, 14) : [];
    const stochastic = advActiveIndicators.stochastic ? cachedStochastic(highData, lowData, actualPrices, 14, 3) : { k: [], d: [] };
    const atr = advActiveIndicators.atr ? cachedATR(highData, lowData, actualPrices, 14) : [];
    const forecast = advActiveIndicators.forecast ? data.forecastValues : [];

    const vwap = advActiveIndicators.vwap && volume.length > 0 ? cachedAnchoredVWAP(actualPrices, volume, 0) : [];
    const volProfile = advActiveIndicators.volprofile && volume.length > 0 ? cachedVolumeProfile(actualPrices, volume, 20) : null;
    const fib = advActiveIndicators.fibonacci ? cachedFibonacci(Math.max(...actualPrices), Math.min(...actualPrices)) : null;

    let psarData = [];
    if (advActiveIndicators.psar && actualPrices.length > 0) {
        const priceDataForPSAR = data.actualLabels.map((date, i) => ({
            date: date,
            ltp: actualPrices[i],
            high: highData[i] || actualPrices[i],
            low: lowData[i] || actualPrices[i]
        }));
        const psar = cachedParabolicSAR(priceDataForPSAR);
        psarData = psar.map(p => p.sar);
        while (psarData.length < actualPrices.length) {
            psarData.unshift(null);
        }
        const forecastLen = forecast.length;
        psarData = [...psarData, ...Array(forecastLen).fill(null)];
    }

    const datasets = [];

    datasets.push({
        label: `${data.ticker} Price`,
        data: prices,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.2,
        pointRadius: 2,
        pointBackgroundColor: '#3b82f6',
        spanGaps: false
    });

    if (data.avgBuyPrice > 0) {
        datasets.push({
            label: `Avg Buy (${data.avgBuyPrice.toFixed(2)})`,
            data: new Array(prices.length).fill(data.avgBuyPrice),
            borderColor: '#f59e0b',
            borderWidth: 2,
            borderDash: [8, 6],
            fill: false,
            pointRadius: 0
        });
    }

    // SMA
    const smaMap = { sma5, sma10, sma20, sma50 };
    const smaColors = { sma5: '#8b5cf6', sma10: '#ec4899', sma20: '#f97316', sma50: '#14b8a6' };
    const smaLabels = { sma5: 'SMA 5', sma10: 'SMA 10', sma20: 'SMA 20', sma50: 'SMA 50' };
    Object.keys(smaMap).forEach(key => {
        if (advActiveIndicators[key] && smaMap[key].length > 0) {
            const smaData = [...smaMap[key], ...forecast.map(() => null)];
            datasets.push({
                label: smaLabels[key],
                data: smaData,
                borderColor: smaColors[key],
                borderWidth: 1.5,
                fill: false,
                pointRadius: 0
            });
        }
    });

    // EMA
    const emaMap = { ema5, ema10, ema20, ema50 };
    const emaColors = { ema5: '#a78bfa', ema10: '#f472b6', ema20: '#fb923c', ema50: '#2dd4bf' };
    const emaLabels = { ema5: 'EMA 5', ema10: 'EMA 10', ema20: 'EMA 20', ema50: 'EMA 50' };
    Object.keys(emaMap).forEach(key => {
        if (advActiveIndicators[key] && emaMap[key].length > 0) {
            const emaData = [...emaMap[key], ...forecast.map(() => null)];
            datasets.push({
                label: emaLabels[key],
                data: emaData,
                borderColor: emaColors[key],
                borderWidth: 1.5,
                fill: false,
                pointRadius: 0
            });
        }
    });

    // Bollinger
    if (advActiveIndicators.bollinger && bollinger) {
        const upper = [...bollinger.upper, ...forecast.map(() => null)];
        const middle = [...bollinger.middle, ...forecast.map(() => null)];
        const lower = [...bollinger.lower, ...forecast.map(() => null)];

        datasets.push({
            label: 'BB Upper',
            data: upper,
            borderColor: 'rgba(239, 68, 68, 0.5)',
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            borderDash: [4, 4]
        });
        datasets.push({
            label: 'BB Middle',
            data: middle,
            borderColor: 'rgba(239, 68, 68, 0.3)',
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            borderDash: [4, 4]
        });
        datasets.push({
            label: 'BB Lower',
            data: lower,
            borderColor: 'rgba(239, 68, 68, 0.5)',
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            borderDash: [4, 4]
        });
    }

    // Forecast
    if (advActiveIndicators.forecast && forecast.length > 0) {
        const forecastData = [...new Array(actualPrices.length).fill(null), ...forecast];
        datasets.push({
            label: 'ARIMA Forecast (5d)',
            data: forecastData,
            borderColor: '#f59e0b',
            borderDash: [6, 4],
            borderWidth: 2,
            fill: false,
            pointRadius: 4,
            pointBackgroundColor: '#f59e0b',
            pointStyle: 'rectRot'
        });
    }

    // PSAR
    if (advActiveIndicators.psar && psarData.length > 0) {
        datasets.push({
            label: 'PSAR',
            data: psarData,
            borderColor: '#ff6b6b',
            backgroundColor: 'rgba(255,107,107,0.2)',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 4,
            pointBackgroundColor: '#ff6b6b',
            pointStyle: 'rectRot',
            showLine: true,
            spanGaps: false,
            order: 2
        });
    }

    // Volume
    if (volume && volume.length > 0) {
        const volumeColors = volume.map((v, i) => {
            if (i > 0 && v > volume[i-1]) return 'rgba(16, 185, 129, 0.6)';
            return 'rgba(239, 68, 68, 0.6)';
        });
        datasets.push({
            label: 'Volume',
            data: volume,
            type: 'bar',
            backgroundColor: volumeColors,
            borderColor: 'transparent',
            yAxisID: 'y1',
            order: 10,
            barPercentage: 0.8,
            categoryPercentage: 0.9,
            pointRadius: 0
        });
    }

    // VWAP
    if (advActiveIndicators.vwap && vwap.length > 0) {
        const vwapData = [...new Array(actualPrices.length - vwap.length).fill(null), ...vwap];
        datasets.push({
            label: 'Anchored VWAP',
            data: vwapData,
            borderColor: '#f59e0b',
            borderWidth: 2,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
            order: 5
        });
    }

    // Volume Profile POC
    if (advActiveIndicators.volprofile && volProfile && volProfile.pocPrice > 0) {
        const pocData = new Array(prices.length).fill(volProfile.pocPrice);
        datasets.push({
            label: `POC (${volProfile.pocPrice.toFixed(2)})`,
            data: pocData,
            borderColor: '#8b5cf6',
            borderWidth: 2,
            borderDash: [8, 4],
            fill: false,
            pointRadius: 0,
            order: 5
        });
    }

    // Fibonacci
    if (advActiveIndicators.fibonacci && fib) {
        const fibLevels = [
            { label: '0%', value: fib.level0, color: '#ef4444' },
            { label: '23.6%', value: fib.level236, color: '#f59e0b' },
            { label: '38.2%', value: fib.level382, color: '#f97316' },
            { label: '50%', value: fib.level500, color: '#8b5cf6' },
            { label: '61.8%', value: fib.level618, color: '#ec4899' },
            { label: '100%', value: fib.level100, color: '#10b981' }
        ];
        fibLevels.forEach(level => {
            const fibData = new Array(prices.length).fill(level.value);
            datasets.push({
                label: `Fib ${level.label}`,
                data: fibData,
                borderColor: level.color,
                borderWidth: 1,
                borderDash: [6, 4],
                fill: false,
                pointRadius: 0,
                order: 5
            });
        });
    }

    const mainCtx = mainCanvas.getContext('2d');
    advMainChart = new Chart(mainCtx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, boxWidth: 12, font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            if (val === null || val === undefined) return null;
                            if (context.dataset.label === 'Volume') {
                                return `📊 Volume: ${val.toLocaleString()}`;
                            }
                            if (context.dataset.label.includes('BB')) return null;
                            if (context.dataset.label.includes('Forecast')) {
                                return `📈 ${context.dataset.label}: ৳${val.toFixed(2)}`;
                            }
                            if (context.dataset.label.includes('Avg Buy')) {
                                return `📊 Avg Buy: ৳${val.toFixed(2)}`;
                            }
                            if (context.dataset.label.includes('PSAR')) {
                                return `PSAR: ৳${val.toFixed(2)}`;
                            }
                            if (context.dataset.label.includes('POC')) {
                                return `📊 POC: ৳${val.toFixed(2)}`;
                            }
                            if (context.dataset.label.includes('VWAP')) {
                                return `📊 Anchored VWAP: ৳${val.toFixed(2)}`;
                            }
                            if (context.dataset.label.includes('Fib')) {
                                return `📊 ${context.dataset.label}: ৳${val.toFixed(2)}`;
                            }
                            return `${context.dataset.label}: ৳${val.toFixed(2)}`;
                        }
                    }
                },
                zoom: {
                    pan: { enabled: true, mode: 'x', modifierKey: 'shift' },
                    zoom: { wheel: { enabled: true, speed: 0.05 }, pinch: { enabled: true }, mode: 'x' },
                    limits: { x: { minRange: 5 } }
                }
            },
            scales: {
                x: {
                    ticks: { color: textColor, maxRotation: 45, font: { size: 10 } },
                    grid: { color: gridColor }
                },
                y: {
                    position: 'right',
                    ticks: { color: textColor, callback: (v) => '৳' + v.toFixed(0) },
                    grid: { color: gridColor }
                },
                y1: {
                    position: 'left',
                    ticks: { color: textColor, callback: (v) => v.toLocaleString() },
                    grid: { display: false },
                    min: 0
                }
            }
        }
    });

    // RSI Chart
    const rsiCanvas = document.getElementById('adv-rsi-chart');
    if (rsiCanvas && advActiveIndicators.rsi) {
        renderRSIChart(rsiData, isDark, rsiCanvas);
    } else if (rsiCanvas) {
        const ctx = rsiCanvas.getContext('2d');
        ctx.clearRect(0, 0, rsiCanvas.width, rsiCanvas.height);
        ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('RSI not active', rsiCanvas.width/2, 40);
    }

    // Stochastic Chart
    const stochCanvas = document.getElementById('adv-stochastic-chart');
    if (stochCanvas && advActiveIndicators.stochastic) {
        renderStochasticChart(stochastic, isDark, stochCanvas);
    } else if (stochCanvas) {
        const ctx = stochCanvas.getContext('2d');
        ctx.clearRect(0, 0, stochCanvas.width, stochCanvas.height);
        ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Stochastic not active', stochCanvas.width/2, 40);
    }

    updatePriceComment(data);
}

// ==========================================
// 📌 RSI চার্ট রেন্ডার
// ==========================================

export function renderRSIChart(rsiData, isDark, canvas) {
    const ctx = canvas.getContext('2d');
    if (advRSIChart) {
        advRSIChart.destroy();
        advRSIChart = null;
    }

    if (!rsiData || rsiData.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Insufficient data for RSI (need 15+ days)', canvas.width/2, 40);
        return;
    }

    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    const validRsi = rsiData.filter(d => d.rsi !== null && d.rsi !== undefined);
    if (validRsi.length < 5) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Not enough RSI data points', canvas.width/2, 40);
        return;
    }

    const labels = validRsi.map((_, i) => i);
    const rsiValues = validRsi.map(d => d.rsi);

    advRSIChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'RSI (14)',
                    data: rsiValues,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 2
                },
                {
                    label: 'Overbought (70)',
                    data: new Array(rsiValues.length).fill(70),
                    borderColor: 'rgba(239, 68, 68, 0.5)',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Oversold (30)',
                    data: new Array(rsiValues.length).fill(30),
                    borderColor: 'rgba(16, 185, 129, 0.5)',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: true,
                    labels: { color: textColor, boxWidth: 12, font: { size: 10 } }
                }
            },
            scales: {
                x: { 
                    display: false,
                    grid: { color: gridColor }
                },
                y: { 
                    min: 0, 
                    max: 100, 
                    ticks: { color: textColor, stepSize: 20 }, 
                    grid: { color: gridColor } 
                }
            }
        }
    });
}

// ==========================================
// 📌 Stochastic চার্ট রেন্ডার
// ==========================================

export function renderStochasticChart(stochData, isDark, canvas) {
    const ctx = canvas.getContext('2d');
    if (advStochChart) {
        advStochChart.destroy();
        advStochChart = null;
    }
    
    if (!stochData || !stochData.k || stochData.k.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No Stochastic data available (need High/Low data)', canvas.width/2, 40);
        return;
    }

    const validK = stochData.k.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (validK.length < 5) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Not enough Stochastic data points', canvas.width/2, 40);
        return;
    }

    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    let dValues = stochData.d || [];
    if (dValues.length < validK.length) {
        const lastD = dValues.length > 0 ? dValues[dValues.length - 1] : 50;
        while (dValues.length < validK.length) {
            dValues.push(lastD);
        }
    }

    const labels = validK.map((_, i) => i);
    const kValues = validK;
    const dFiltered = dValues.slice(0, validK.length);

    advStochChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '%K (14)',
                    data: kValues,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 2
                },
                {
                    label: '%D (3)',
                    data: dFiltered,
                    borderColor: '#f59e0b',
                    borderWidth: 2.5,
                    fill: false,
                    tension: 0.2,
                    pointRadius: 2
                },
                {
                    label: 'Overbought (80)',
                    data: new Array(kValues.length).fill(80),
                    borderColor: 'rgba(239, 68, 68, 0.5)',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Oversold (20)',
                    data: new Array(kValues.length).fill(20),
                    borderColor: 'rgba(16, 185, 129, 0.5)',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: true,
                    labels: { color: textColor, boxWidth: 12, font: { size: 10 } }
                }
            },
            scales: {
                x: { 
                    display: false,
                    grid: { color: gridColor }
                },
                y: { 
                    min: 0, 
                    max: 100, 
                    ticks: { color: textColor, stepSize: 20 }, 
                    grid: { color: gridColor } 
                }
            }
        }
    });
}

// ==========================================
// 📌 ইনফো কার্ড ও কমেন্ট
// ==========================================

export function updateStockInfo(data) {
    const price = data.currentPrice || 0;
    const prevPrice = data.actualPrices[data.actualPrices.length - 2] || price;
    const change = price - prevPrice;
    const changePercent = prevPrice > 0 ? (change / prevPrice) * 100 : 0;

    const priceEl = document.getElementById('adv-info-price');
    if (priceEl) priceEl.innerText = `৳${price.toFixed(2)}`;

    const changeEl = document.getElementById('adv-info-change');
    if (changeEl) {
        changeEl.innerText = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
        changeEl.className = `value ${change >= 0 ? 'positive' : 'negative'}`;
    }

    const highEl = document.getElementById('adv-info-high');
    if (highEl) highEl.innerText = `৳${data.high.toFixed(2)}`;
    const lowEl = document.getElementById('adv-info-low');
    if (lowEl) lowEl.innerText = `৳${data.low.toFixed(2)}`;
    const avgBuyEl = document.getElementById('adv-info-avgbuy');
    if (avgBuyEl) avgBuyEl.innerText = data.avgBuyPrice > 0 ? `৳${data.avgBuyPrice.toFixed(2)}` : '-';
}

export function updatePriceComment(data) {
    const commentDiv = document.getElementById('adv-price-comment');
    if (!commentDiv) return;
    const lastPrice = data.currentPrice;
    const prevPrice = data.actualPrices[data.actualPrices.length - 2] || lastPrice;
    const change = lastPrice - prevPrice;
    const pct = prevPrice ? (change / prevPrice) * 100 : 0;
    let comment = `📊 Last: ৳${lastPrice.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;

    if (advActiveIndicators.rsi) {
        const rsiData = cachedRSI(data.actualPrices, 14);
        const lastRSI = rsiData.length ? rsiData[rsiData.length - 1].rsi : null;
        if (lastRSI !== null) {
            if (lastRSI < 30) comment += ' | ⚡ RSI Oversold (<30)';
            else if (lastRSI > 70) comment += ' | ⚡ RSI Overbought (>70)';
            else comment += ` | RSI ${lastRSI.toFixed(1)} (Neutral)`;
        }
    }

    if (advActiveIndicators.bollinger) {
        const bb = cachedBollingerBands(data.actualPrices, 20, 2);
        if (bb && bb.upper.length) {
            const lastUpper = bb.upper[bb.upper.length - 1];
            const lastLower = bb.lower[bb.lower.length - 1];
            if (lastPrice <= lastLower) comment += ' | 📉 Price near Lower BB (Oversold)';
            else if (lastPrice >= lastUpper) comment += ' | 📈 Price near Upper BB (Overbought)';
        }
    }

    if (advActiveIndicators.psar) {
        const priceDataForPSAR = data.actualLabels.map((date, i) => ({
            date: date,
            ltp: data.actualPrices[i],
            high: data.highData[i] || data.actualPrices[i],
            low: data.lowData[i] || data.actualPrices[i]
        }));
        const psar = cachedParabolicSAR(priceDataForPSAR);
        if (psar.length) {
            const lastPSAR = psar[psar.length - 1].sar;
            if (lastPSAR < lastPrice) comment += ' | 🟢 PSAR below price (Bullish)';
            else if (lastPSAR > lastPrice) comment += ' | 🔴 PSAR above price (Bearish)';
        }
    }

    if (advActiveIndicators.vwap && volumeData.length > 0) {
        const vwap = cachedAnchoredVWAP(data.actualPrices, volumeData, 0);
        if (vwap.length > 0) {
            const lastVWAP = vwap[vwap.length - 1];
            if (lastVWAP > 0) {
                comment += ` | VWAP: ৳${lastVWAP.toFixed(2)} (${lastPrice > lastVWAP ? '🟢 Above' : '🔴 Below'})`;
            }
        }
    }

    commentDiv.textContent = comment;
    commentDiv.classList.remove('bullish', 'bearish');
    if (comment.includes('Bullish') || comment.includes('🟢')) {
        commentDiv.classList.add('bullish');
    } else if (comment.includes('Bearish') || comment.includes('🔴')) {
        commentDiv.classList.add('bearish');
    }
}

// ==========================================
// 📌 স্মার্ট সাজেশন
// ==========================================

export function generateSuggestion(data) {
    const container = document.getElementById('suggestion-content');
    if (!container) return;
    if (!data || !data.actualPrices || data.actualPrices.length < 20) {
        container.innerHTML = `<div style="text-align:center; padding:20px; opacity:0.7;">Insufficient data for suggestion</div>`;
        return;
    }

    const prices = data.actualPrices;
    const currentPrice = prices[prices.length - 1];
    const sma20 = cachedSMA(prices, 20);
    const sma50 = cachedSMA(prices, 50);
    const rsiData = cachedRSI(prices, 14);
    const lastRSI = rsiData.length > 0 ? rsiData[rsiData.length - 1].rsi : 50;
    const macdData = cachedMACD(prices, 12, 26, 9);
    const bollinger = cachedBollingerBands(prices, 20, 2);
    const stoch = cachedStochastic(data.highData || [], data.lowData || [], prices, 14, 3);
    const atr = cachedATR(data.highData || [], data.lowData || [], prices, 14);
    const atrValue = atr.length > 0 ? atr[atr.length - 1] : (currentPrice * 0.02);
    const forecast = advActiveIndicators.forecast ? data.forecastValues : [];

    let vwapScore = 0, pocScore = 0;
    if (advActiveIndicators.vwap && volumeData.length > 0) {
        const vwap = cachedAnchoredVWAP(prices, volumeData, 0);
        if (vwap.length > 0) {
            const lastVWAP = vwap[vwap.length - 1];
            if (currentPrice > lastVWAP * 1.01) vwapScore = 1;
            else if (currentPrice < lastVWAP * 0.99) vwapScore = -1;
        }
    }
    if (advActiveIndicators.volprofile && volumeData.length > 0) {
        const volProfile = cachedVolumeProfile(prices, volumeData, 20);
        if (volProfile && volProfile.pocPrice > 0) {
            if (currentPrice > volProfile.pocPrice * 1.01) pocScore = 1;
            else if (currentPrice < volProfile.pocPrice * 0.99) pocScore = -1;
        }
    }

    let psarTrend = null;
    if (advActiveIndicators.psar) {
        const priceDataForPSAR = data.actualLabels.map((date, i) => ({
            date: date,
            ltp: prices[i],
            high: data.highData[i] || prices[i],
            low: data.lowData[i] || prices[i]
        }));
        const psar = cachedParabolicSAR(priceDataForPSAR);
        if (psar.length) {
            const lastPSAR = psar[psar.length - 1];
            psarTrend = lastPSAR.sar < currentPrice ? 'Bullish' : (lastPSAR.sar > currentPrice ? 'Bearish' : 'Neutral');
        }
    }

    let buyScore = 0, sellScore = 0;
    let signals = [];

    if (lastRSI < 30) { buyScore += 2; signals.push('RSI oversold (<30)'); }
    else if (lastRSI > 70) { sellScore += 2; signals.push('RSI overbought (>70)'); }

    if (macdData && macdData.macd.length > 0) {
        const lastMacd = macdData.macd[macdData.macd.length - 1];
        const lastSig = macdData.signal[macdData.signal.length - 1];
        const prevMacd = macdData.macd[macdData.macd.length - 2];
        const prevSig = macdData.signal[macdData.signal.length - 2];
        if (prevMacd < prevSig && lastMacd > lastSig) {
            buyScore += 2; signals.push('MACD bullish crossover');
        } else if (prevMacd > prevSig && lastMacd < lastSig) {
            sellScore += 2; signals.push('MACD bearish crossover');
        }
    }

    if (sma20.length > 0 && sma50.length > 0) {
        const lastSMA20 = sma20[sma20.length - 1];
        const lastSMA50 = sma50[sma50.length - 1];
        const prevSMA20 = sma20[sma20.length - 2];
        const prevSMA50 = sma50[sma50.length - 2];
        if (prevSMA20 < prevSMA50 && lastSMA20 > lastSMA50) {
            buyScore += 3; signals.push('Golden Cross (SMA 20 > SMA 50)');
        } else if (prevSMA20 > prevSMA50 && lastSMA20 < lastSMA50) {
            sellScore += 3; signals.push('Death Cross (SMA 20 < SMA 50)');
        }
    }

    if (bollinger && bollinger.upper.length > 0) {
        const lastUpper = bollinger.upper[bollinger.upper.length - 1];
        const lastLower = bollinger.lower[bollinger.lower.length - 1];
        if (currentPrice <= lastLower) {
            buyScore += 2; signals.push('Price near lower BB (oversold)');
        } else if (currentPrice >= lastUpper) {
            sellScore += 2; signals.push('Price near upper BB (overbought)');
        }
    }

    if (stoch && stoch.k.length > 0) {
        const lastK = stoch.k[stoch.k.length - 1];
        const lastD = stoch.d[stoch.d.length - 1];
        if (lastK < 20 && lastK > lastD) {
            buyScore += 2; signals.push('Stochastic oversold crossover');
        } else if (lastK > 80 && lastK < lastD) {
            sellScore += 2; signals.push('Stochastic overbought crossover');
        }
    }

    if (forecast && forecast.length > 0) {
        const avgForecast = forecast.reduce((a,b) => a+b, 0) / forecast.length;
        if (avgForecast > currentPrice * 1.03) {
            buyScore += 1; signals.push('ARIMA predicts upward trend');
        } else if (avgForecast < currentPrice * 0.97) {
            sellScore += 1; signals.push('ARIMA predicts downward trend');
        }
    }

    if (psarTrend === 'Bullish') {
        buyScore += 1; signals.push('PSAR bullish');
    } else if (psarTrend === 'Bearish') {
        sellScore += 1; signals.push('PSAR bearish');
    }

    if (vwapScore > 0) { buyScore += 1; signals.push('Price above VWAP'); }
    else if (vwapScore < 0) { sellScore += 1; signals.push('Price below VWAP'); }
    
    if (pocScore > 0) { buyScore += 1; signals.push('Price above POC'); }
    else if (pocScore < 0) { sellScore += 1; signals.push('Price below POC'); }

    let decision = 'NEUTRAL', decisionClass = 'signal-neutral';
    let confidence = 'Medium', details = '';

    if (buyScore >= 3 && buyScore > sellScore) {
        decision = 'BUY';
        decisionClass = 'signal-buy';
        confidence = buyScore >= 5 ? 'High' : 'Medium';
    } else if (sellScore >= 3 && sellScore > buyScore) {
        decision = 'SELL';
        decisionClass = 'signal-sell';
        confidence = sellScore >= 5 ? 'High' : 'Medium';
    }
    details = `Buy Score: ${buyScore} | Sell Score: ${sellScore}`;

    const targetPrice = currentPrice + (atrValue * 2);
    const stopLoss = currentPrice - (atrValue * 1.5);

    let html = `
        <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
            <span class="signal-badge ${decisionClass}">${decision}</span>
            <span style="font-size:14px; opacity:0.8;">Confidence: <strong>${confidence}</strong></span>
            <span style="font-size:13px; opacity:0.7;">${details}</span>
        </div>
        <div class="adv-suggestion-grid">
            <div class="adv-suggestion-item">
                <div class="label">📈 Target Price</div>
                <div class="value">৳${targetPrice.toFixed(2)}</div>
                <div class="sub">+${((targetPrice/currentPrice-1)*100).toFixed(2)}% from current</div>
            </div>
            <div class="adv-suggestion-item">
                <div class="label">🛑 Stop Loss</div>
                <div class="value">৳${stopLoss.toFixed(2)}</div>
                <div class="sub">${((stopLoss/currentPrice-1)*100).toFixed(2)}% from current</div>
            </div>
            <div class="adv-suggestion-item">
                <div class="label">📊 ATR (Volatility)</div>
                <div class="value">৳${atrValue.toFixed(2)}</div>
                <div class="sub">14-day Average True Range</div>
            </div>
            <div class="adv-suggestion-item">
                <div class="label">📊 RSI</div>
                <div class="value">${lastRSI.toFixed(2)}</div>
                <div class="sub">${lastRSI < 30 ? 'Oversold' : lastRSI > 70 ? 'Overbought' : 'Neutral'}</div>
            </div>
        </div>
        <div style="margin-top: 12px; font-size: 13px; opacity: 0.7; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
            <strong>Signals:</strong> ${signals.length > 0 ? signals.join(' | ') : 'No strong signals'}
        </div>
    `;
    container.innerHTML = html;
}

// ==========================================
// 📌 ডিপ অ্যানালাইসিস
// ==========================================

export async function generateDeepAnalysis(data) {
    const loader = document.getElementById('deep-analysis-loader');
    const content = document.getElementById('deep-analysis-content');
    const timeEl = document.getElementById('deep-analysis-time');
    
    if (!data || !data.actualPrices || data.actualPrices.length < 10) {
        if (loader) loader.innerHTML = '⚠️ Insufficient data for analysis.';
        return;
    }
    
    try {
        loader.style.display = 'block';
        content.style.display = 'none';
        
        const prices = data.actualPrices;
        const volumes = data.volumeData || [];
        const currentPrice = prices[prices.length - 1];
        
        // VWAP
        const vwap = cachedAnchoredVWAP(prices, volumes, 0);
        const lastVWAP = vwap.length > 0 ? vwap[vwap.length - 1] : currentPrice;
        const vwapDiff = currentPrice - lastVWAP;
        const vwapPct = lastVWAP > 0 ? (vwapDiff / lastVWAP) * 100 : 0;
        
        let vwapStatus = 'Neutral', vwapColor = '#f59e0b', vwapSub = `VWAP: ৳${lastVWAP.toFixed(2)}`;
        if (currentPrice > lastVWAP * 1.01) {
            vwapStatus = '🟢 Above VWAP';
            vwapColor = '#10b981';
            vwapSub = `+${vwapPct.toFixed(2)}% above VWAP (Bullish)`;
        } else if (currentPrice < lastVWAP * 0.99) {
            vwapStatus = '🔴 Below VWAP';
            vwapColor = '#ef4444';
            vwapSub = `${vwapPct.toFixed(2)}% below VWAP (Bearish)`;
        } else {
            vwapStatus = '⚪ At VWAP';
            vwapColor = '#f59e0b';
            vwapSub = `Within 1% of VWAP (Neutral)`;
        }
        
        // POC
        const volProfile = cachedVolumeProfile(prices, volumes, 20);
        const pocPrice = volProfile?.pocPrice || currentPrice;
        const pocDiff = currentPrice - pocPrice;
        const pocPct = pocPrice > 0 ? (pocDiff / pocPrice) * 100 : 0;
        
        let pocStatus = 'Neutral', pocColor = '#8b5cf6', pocSub = `POC: ৳${pocPrice.toFixed(2)}`;
        if (currentPrice > pocPrice * 1.01) {
            pocStatus = '🟢 Above POC';
            pocColor = '#10b981';
            pocSub = `+${pocPct.toFixed(2)}% above POC (Bullish)`;
        } else if (currentPrice < pocPrice * 0.99) {
            pocStatus = '🔴 Below POC';
            pocColor = '#ef4444';
            pocSub = `${pocPct.toFixed(2)}% below POC (Bearish)`;
        } else {
            pocStatus = '⚪ At POC';
            pocColor = '#8b5cf6';
            pocSub = `Within 1% of POC (Neutral)`;
        }
        
        // RSI
        const rsiData = cachedRSI(prices, 14);
        const lastRSI = rsiData.length > 0 ? rsiData[rsiData.length - 1].rsi : 50;
        
        // Signal
        let buyScore = 0, sellScore = 0;
        let reasons = [];
        
        if (currentPrice > lastVWAP * 1.01) { buyScore += 3; reasons.push('Price above VWAP'); }
        else if (currentPrice < lastVWAP * 0.99) { sellScore += 3; reasons.push('Price below VWAP'); }
        
        if (currentPrice > pocPrice * 1.01) { buyScore += 3; reasons.push('Price above POC'); }
        else if (currentPrice < pocPrice * 0.99) { sellScore += 3; reasons.push('Price below POC'); }
        
        if (lastRSI < 30) { buyScore += 2; reasons.push('RSI oversold'); }
        else if (lastRSI > 70) { sellScore += 2; reasons.push('RSI overbought'); }
        
        let signal = 'NEUTRAL', signalColor = '#64748b', signalSub = 'No clear signal';
        if (buyScore >= 5 && buyScore > sellScore) {
            signal = 'BUY';
            signalColor = '#10b981';
            signalSub = `${buyScore} buy vs ${sellScore} sell signals`;
        } else if (sellScore >= 5 && sellScore > buyScore) {
            signal = 'SELL';
            signalColor = '#ef4444';
            signalSub = `${sellScore} sell vs ${buyScore} buy signals`;
        } else if (buyScore >= 3 && buyScore > sellScore) {
            signal = 'WEAK BUY';
            signalColor = '#34d399';
            signalSub = `${buyScore} buy vs ${sellScore} sell signals`;
        } else if (sellScore >= 3 && sellScore > buyScore) {
            signal = 'WEAK SELL';
            signalColor = '#f87171';
            signalSub = `${sellScore} sell vs ${buyScore} buy signals`;
        }
        
        // Update UI
        document.getElementById('da-vwap').innerHTML = `<span style="color: ${vwapColor};">${vwapStatus}</span>`;
        document.getElementById('da-vwap-sub').textContent = vwapSub;
        
        document.getElementById('da-poc').innerHTML = `<span style="color: ${pocColor};">${pocStatus}</span>`;
        document.getElementById('da-poc-sub').textContent = pocSub;
        
        document.getElementById('da-signal').innerHTML = `<span style="color: ${signalColor}; font-weight: 700; font-size: 20px;">${signal}</span>`;
        document.getElementById('da-signal-sub').textContent = signalSub;
        
        const tableBody = document.getElementById('da-table-body');
        const metrics = [
            { name: 'Current Price', value: `৳${currentPrice.toFixed(2)}`, signal: '-' },
            { name: 'VWAP', value: `৳${lastVWAP.toFixed(2)}`, signal: currentPrice > lastVWAP ? '🟢 Above' : (currentPrice < lastVWAP ? '🔴 Below' : '⚪ At') },
            { name: 'POC', value: `৳${pocPrice.toFixed(2)}`, signal: currentPrice > pocPrice ? '🟢 Above' : (currentPrice < pocPrice ? '🔴 Below' : '⚪ At') },
            { name: 'RSI (14)', value: lastRSI.toFixed(2), signal: lastRSI < 30 ? '🟢 Oversold' : (lastRSI > 70 ? '🔴 Overbought' : '⚪ Neutral') }
        ];
        
        tableBody.innerHTML = metrics.map(m => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                <td style="padding: 6px 8px;">${m.name}</td>
                <td style="padding: 6px 8px; text-align: right;">${m.value}</td>
                <td style="padding: 6px 8px; text-align: right;">${m.signal}</td>
            </tr>
        `).join('');
        
        const summaryText = document.getElementById('da-summary-text');
        const summaryDiv = document.getElementById('da-summary');
        
        if (signal === 'BUY' || signal === 'WEAK BUY') {
            summaryText.innerHTML = `📈 <strong>${signal}</strong> signal detected. ${reasons.join(', ')}. VWAP & POC both support bullish view.`;
            summaryDiv.style.borderLeftColor = '#10b981';
        } else if (signal === 'SELL' || signal === 'WEAK SELL') {
            summaryText.innerHTML = `📉 <strong>${signal}</strong> signal detected. ${reasons.join(', ')}. VWAP & POC both support bearish view.`;
            summaryDiv.style.borderLeftColor = '#ef4444';
        } else {
            summaryText.innerHTML = `⚪ <strong>NEUTRAL</strong>. ${reasons.join(', ') || 'No strong signals.'}`;
            summaryDiv.style.borderLeftColor = '#64748b';
        }
        
        if (timeEl) timeEl.textContent = `Last updated: ${new Date().toLocaleString()}`;
        
        loader.style.display = 'none';
        content.style.display = 'block';
        
    } catch (error) {
        console.error('Deep analysis error:', error);
        document.getElementById('deep-analysis-loader').innerHTML = `❌ Error: ${error.message}`;
    }
}

export function runDeepAnalysis() {
    if (advChartData) {
        generateDeepAnalysis(advChartData);
    }
}

// ==========================================
// 📌 সার্চ ফাংশন
// ==========================================

export function handleSearchInput() {
    const query = this.value.trim().toUpperCase();
    const suggestions = document.getElementById('adv-chart-suggestions');
    if (!suggestions) return;
    if (!query || !dseStocks || dseStocks.length === 0) {
        suggestions.style.display = 'none';
        return;
    }
    const filtered = dseStocks.filter(s => s.startsWith(query)).slice(0, 10);
    if (filtered.length > 0) {
        suggestions.style.display = 'block';
        suggestions.innerHTML = filtered.map(s =>
            `<div class="suggestion-item" onclick="window.selectAdvChartStock('${s}')">${s}</div>`
        ).join('');
    } else {
        suggestions.style.display = 'none';
    }
}

export function selectAdvChartStock(ticker) {
    const searchInput = document.getElementById('adv-chart-search');
    if (searchInput) searchInput.value = ticker;
    const suggestions = document.getElementById('adv-chart-suggestions');
    if (suggestions) suggestions.style.display = 'none';
    advCurrentTicker = ticker;
    loadAdvancedChart();
}

// ==========================================
// 📌 ক্যান্ডেলস্টিক চার্ট (রেফারেন্স)
// ==========================================

// নোট: এই ফাংশনটি adv-charts-extras.js-এ পূর্ণাঙ্গভাবে ডিফাইন করা আছে।
// এখানে শুধু রেফারেন্সের জন্য ডামি ফাংশন রাখা হলো, কিন্তু আমরা এটি ব্যবহার করব না।
// সার্কুলার ডিপেন্ডেন্সি এড়াতে আমরা এটি সরিয়ে দিচ্ছি।
// এখন renderCandlestickChart শুধু adv-charts-extras.js থেকে ইমপোর্ট করে ব্যবহার করবেন।