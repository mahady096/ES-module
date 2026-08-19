// ==========================================
// 📊 dash-performance.js - Portfolio Performance
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { getLatestAndPreviousPrices, getUnifiedPrice, formatDisplayTime } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { updateDashboardCardsFromAnalysis } from './dash-cards.js';
import { fetchPortfolioTimelineData } from './dash-charts.js';
// 🔥 FIX: dataService ইম্পোর্ট যোগ করুন
import { dataService } from './data-service.js';

let cachedAnalysisData = null;
let lastAnalysisTime = 0;
let isAnalysisLoading = false;
const ANALYSIS_CACHE_TTL = 600000;
let currentPortfolioData = [];
let currentPortfolioSortOrder = 'asc';

// ==========================================
// Load Portfolio Analysis Table
// ==========================================

export async function loadPortfolioAnalysisTable(userId, portfolioId = null, forceRefresh = false) {
    if (!userId) return;

    const cacheKey = `analysis_${userId}_${portfolioId || 'all'}`;
    let cached = null;
    try {
        const cachedStr = sessionStorage.getItem(cacheKey);
        if (cachedStr) {
            const parsed = JSON.parse(cachedStr);
            if (Date.now() - parsed.timestamp < 300000) {
                cached = parsed.data;
            }
        }
    } catch (e) { /* ignore */ }

    if (cached && !forceRefresh) {
        renderPortfolioAnalysis(cached);
        console.log(`✅ Portfolio analysis loaded from cache`);
        const timeText = document.getElementById('pa-updated-time-text');
        if (timeText) {
            timeText.innerText = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
        }
        return;
    }

    if (window.portfolioAnalysisInterval) {
        clearInterval(window.portfolioAnalysisInterval);
        window.portfolioAnalysisInterval = null;
    }

    async function fetchAndRenderAnalysis(force = false) {
        const listContainer = document.getElementById('bull-analysis-list');
        if (listContainer) {
            listContainer.innerHTML = `<div class="skeleton" style="width:95%;"></div><div class="skeleton" style="width:85%;"></div><div class="skeleton" style="width:90%;"></div>`;
        }

        const now = Date.now();
        if (!force && cachedAnalysisData && (now - lastAnalysisTime) < ANALYSIS_CACHE_TTL) {
            if (cachedAnalysisData._portfolioId === (portfolioId || 'all')) {
                renderPortfolioAnalysis(cachedAnalysisData);
                return;
            }
        }
        if (isAnalysisLoading) return;
        isAnalysisLoading = true;

        try {
            console.log(`📊 Fetching portfolio analysis...`);
            const unifiedData = await unifiedEngine.calculate(userId, portfolioId, force);
            if (!unifiedData || unifiedData.stockDetails.length === 0) {
                if (listContainer) {
                    listContainer.innerHTML = `<div style="text-align:center; padding:20px; color: var(--text-muted);">No active stocks found.</div>`;
                }
                return;
            }

            const tickers = unifiedData.stockDetails.map(s => s.ticker);
            const priceDataMap = await getLatestAndPreviousPrices(tickers);

            const portfolioDataForSorting = [];
            let grandTotalCost = 0, grandTotalCurrentValue = 0, grandTotalDailyGL = 0, grandTotalGL = 0;
            let globalPreviousDate = null;

            for (const stock of unifiedData.stockDetails) {
                const ticker = stock.ticker;
                const priceData = priceDataMap.get(ticker);
                let currentPrice = priceData?.currentPrice || 0;
                if (currentPrice === 0) {
                    currentPrice = await getUnifiedPrice(ticker);
                }
                const previousPrice = priceData?.previousPrice || 0;
                const previousDate = priceData?.previousDate || null;

                // globalPreviousDate ট্র্যাক করুন
                if (previousDate && (!globalPreviousDate || previousDate > globalPreviousDate)) {
                    globalPreviousDate = previousDate;
                }

                let dailyChange = 0;
                if (currentPrice > 0 && previousPrice > 0) {
                    dailyChange = currentPrice - previousPrice;
                }

                const totalRemainingQty = stock.totalQty;
                const totalCost = stock.totalCost;
                const avgBuyPrice = stock.avgBuyPriceWithCommission;
                const currentValue = totalRemainingQty * currentPrice;
                const totalGL = currentValue - totalCost;
                const totalGLPcnt = totalCost > 0 ? (totalGL / totalCost) * 100 : 0;
                const totalStockDailyGL = totalRemainingQty * dailyChange;
                const totalStockDailyPcnt = (currentPrice - dailyChange) > 0 ? (dailyChange / (currentPrice - dailyChange)) * 100 : 0;

                const activeLotsForDisplay = [];
                for (const lot of stock.lots) {
                    const lotCurrentValue = lot.qty * currentPrice;
                    const lotTotalGL = lotCurrentValue - lot.totalCost;
                    const lotDailyGL = lot.qty * dailyChange;
                    const lotGLPcnt = lot.totalCost > 0 ? (lotTotalGL / lot.totalCost) * 100 : 0;
                    const lotDailyPcnt = (currentPrice - dailyChange) > 0 ? (dailyChange / (currentPrice - dailyChange)) * 100 : 0;
                    activeLotsForDisplay.push({
                        qty: lot.qty,
                        buyPrice: lot.buyPrice,
                        cost: lot.totalCost,
                        currentValue: lotCurrentValue,
                        dailyGL: lotDailyGL,
                        dailyGLPcnt: lotDailyPcnt,
                        totalGL: lotTotalGL,
                        totalGLPcnt: lotGLPcnt
                    });
                }

                const livePriceClass = dailyChange >= 0 ? "bull-profit" : "bull-loss";
                const dailyGlClass = totalStockDailyGL >= 0 ? "bull-profit" : "bull-loss";
                const totalGlClass = totalGL >= 0 ? "bull-profit" : "bull-loss";
                const blockId = `block-${ticker.replace(/[^a-zA-Z0-9]/g, '')}`;

                portfolioDataForSorting.push({
                    ticker, avgBuyPrice, totalRemainingQty, totalCost, currentPrice,
                    currentValue, dailyChange, totalGL, totalGLPcnt,
                    totalStockDailyGL, totalStockDailyPcnt,
                    activeLotsForDisplay, livePriceClass, dailyGlClass, totalGlClass, blockId,
                    prevDate: previousDate // ← previousDate সংরক্ষণ
                });

                grandTotalCost += totalCost;
                grandTotalCurrentValue += currentValue;
                grandTotalDailyGL += totalStockDailyGL;
                grandTotalGL += totalGL;
            }

            cachedAnalysisData = portfolioDataForSorting;
            lastAnalysisTime = now;
            currentPortfolioData = portfolioDataForSorting;

            const sortedData = [...portfolioDataForSorting].sort((a, b) =>
                a.ticker.toUpperCase().localeCompare(b.ticker.toUpperCase())
            );
            renderPortfolioAnalysis(sortedData);

            // ==========================================
            // 🔥 FIX: previous-data-date আপডেট করা
            // ==========================================
            const prevDateElement = document.getElementById('previous-data-date');
            if (prevDateElement) {
                if (globalPreviousDate) {
                    const dateObj = new Date(globalPreviousDate);
                    prevDateElement.innerText = dateObj.toLocaleDateString('bn-BD', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                } else {
                    // 🔥 ফ্যালব্যাক: যদি কোনো previous date না থাকে, তাহলে "N/A" দেখান
                    prevDateElement.innerText = 'N/A';
                }
            }

            // ==========================================
            // 🔥 FIX: last-updated-time আপডেট করা (dataService ব্যবহার)
            // ==========================================
            const lastUpdateElement = document.getElementById('last-updated-time');
            if (lastUpdateElement) {
                try {
                    const lastUpdate = await dataService.getLastUpdateTime();
                    lastUpdateElement.innerText = lastUpdate ? formatDisplayTime(lastUpdate) : new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
                } catch (e) {
                    console.warn('Error fetching last update time:', e);
                    lastUpdateElement.innerText = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
                }
            }

            const timeText = document.getElementById('pa-updated-time-text');
            if (timeText) {
                timeText.innerText = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
            }

            try {
                sessionStorage.setItem(cacheKey, JSON.stringify({
                    timestamp: Date.now(),
                    data: portfolioDataForSorting
                }));
            } catch (e) { /* ignore */ }

        } catch (error) {
            console.error('Analysis error:', error);
            if (listContainer) {
                listContainer.innerHTML = `<div style="text-align:center; padding:20px; color:red;">Error loading data</div>`;
            }
        } finally {
            isAnalysisLoading = false;
        }
    }

    await fetchAndRenderAnalysis(forceRefresh || true);
    window.portfolioAnalysisInterval = setInterval(() => fetchAndRenderAnalysis(false), 600000);
}

// ==========================================
// Render Portfolio Analysis
// ==========================================

export function renderPortfolioAnalysis(portfolioData) {
    const listContainer = document.getElementById('bull-analysis-list');
    if (!listContainer) return;
    if (portfolioData.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:20px;">No active stocks found.</div>`;
        return;
    }

    let finalHtml = "";
    let grandTotalCost = 0, grandTotalCurrentValue = 0, grandTotalDailyGL = 0, grandTotalGL = 0;

    for (const item of portfolioData) {
        const { ticker, avgBuyPrice, totalRemainingQty, totalCost, currentPrice, dailyChange, totalGL, totalGLPcnt,
            totalStockDailyGL, totalStockDailyPcnt, activeLotsForDisplay, livePriceClass, dailyGlClass, totalGlClass, blockId } = item;
        const currentValue = totalRemainingQty * currentPrice;

        finalHtml += `<div class="stock-block" id="parent-${blockId}">
            <div class="stock-main-row" onclick="window.toggleBullLot('${blockId}'); window.openStockDetailModal('${ticker}');">
                <div class="bull-col-code">
                    <div class="ticker-title" style="color:#2563eb; text-decoration:underline; cursor:pointer;">${ticker}</div>
                    <div class="${livePriceClass}" style="font-weight:600;">৳${currentPrice.toFixed(2)} <span style="font-size:11px;">(${dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(2)})</span></div>
                    <div style="color:#64748b; font-size:12px;">৳${avgBuyPrice.toFixed(2)} x ${totalRemainingQty} shares</div>
                    <span class="toggle-text" id="btn-${blockId}">+ Show All</span>
                </div>
                <div class="bull-col-value">
                    <div>${currentValue.toLocaleString()}</div>
                    <div style="color:#64748b;">${totalCost.toLocaleString()}</div>
                </div>
                <div class="bull-col-daily ${dailyGlClass}">
                    <div>${totalStockDailyGL >= 0 ? '+' : ''}${totalStockDailyGL.toFixed(2)}</div>
                    <div>${totalStockDailyPcnt >= 0 ? '+' : ''}${totalStockDailyPcnt.toFixed(2)}%</div>
                </div>
                <div class="bull-col-total ${totalGlClass}">
                    <div>${totalGL >= 0 ? '+' : ''}${totalGL.toLocaleString()}</div>
                    <div>${totalGLPcnt >= 0 ? '+' : ''}${totalGLPcnt.toFixed(2)}%</div>
                </div>
            </div>
            <div class="lot-rows-container" id="container-${blockId}" style="display:none;">`;

        for (const lot of activeLotsForDisplay) {
            const lotDailyClass = lot.dailyGL >= 0 ? "bull-profit" : "bull-loss";
            const lotTotalClass = lot.totalGL >= 0 ? "bull-profit" : "bull-loss";
            finalHtml += `<div class="stock-lot-row">
                <div class="bull-col-code"><b>৳${lot.buyPrice.toFixed(2)}</b> x ${lot.qty} shares</div>
                <div class="bull-col-value"><div>${lot.currentValue.toFixed(2)}</div><div>${lot.cost.toFixed(2)}</div></div>
                <div class="bull-col-daily ${lotDailyClass}"><div>${lot.dailyGL >= 0 ? '+' : ''}${lot.dailyGL.toFixed(2)}</div><div>${lot.dailyGLPcnt.toFixed(2)}%</div></div>
                <div class="bull-col-total ${lotTotalClass}"><div>${lot.totalGL >= 0 ? '+' : ''}${lot.totalGL.toFixed(2)}</div><div>${lot.totalGLPcnt.toFixed(2)}%</div></div>
            </div>`;
        }
        finalHtml += `</div></div>`;

        grandTotalCost += totalCost;
        grandTotalCurrentValue += currentValue;
        grandTotalDailyGL += totalStockDailyGL;
        grandTotalGL += totalGL;
    }

    listContainer.innerHTML = finalHtml;

    // Update summary cards
    const summaryValue = document.getElementById('summary-total-value');
    const summaryCost = document.getElementById('summary-total-cost');
    const summaryDaily = document.getElementById('summary-total-daily');
    const summaryDailyPct = document.getElementById('summary-total-daily-pct');
    const summaryGL = document.getElementById('summary-total-gl');
    const summaryGLPct = document.getElementById('summary-total-gl-pct');

    if (summaryValue) summaryValue.innerHTML = `৳${grandTotalCurrentValue.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    if (summaryCost) summaryCost.innerHTML = `৳${grandTotalCost.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    if (summaryDaily) {
        summaryDaily.innerHTML = `${grandTotalDailyGL >= 0 ? '+' : ''}৳${grandTotalDailyGL.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        summaryDaily.style.color = grandTotalDailyGL >= 0 ? '#10b981' : '#ef4444';
    }
    if (summaryDailyPct && grandTotalCost > 0) {
        const dailyPct = (grandTotalDailyGL / grandTotalCost) * 100;
        summaryDailyPct.innerHTML = `${dailyPct >= 0 ? '+' : ''}${dailyPct.toFixed(2)}%`;
        summaryDailyPct.style.color = dailyPct >= 0 ? '#10b981' : '#ef4444';
    }
    if (summaryGL) {
        summaryGL.innerHTML = `${grandTotalGL >= 0 ? '+' : ''}৳${grandTotalGL.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        summaryGL.style.color = grandTotalGL >= 0 ? '#10b981' : '#ef4444';
    }
    if (summaryGLPct && grandTotalCost > 0) {
        const glPct = (grandTotalGL / grandTotalCost) * 100;
        summaryGLPct.innerHTML = `${glPct >= 0 ? '+' : ''}${glPct.toFixed(2)}%`;
        summaryGLPct.style.color = glPct >= 0 ? '#10b981' : '#ef4444';
    }

    if (typeof updateDashboardCardsFromAnalysis === 'function') {
        updateDashboardCardsFromAnalysis(grandTotalCost, grandTotalCurrentValue, grandTotalDailyGL, grandTotalGL);
    }
    window.currentPortfolioTotalValue = grandTotalCurrentValue;
}

export function toggleBullLot(blockId) {
    const container = document.getElementById(`container-${blockId}`);
    const btnText = document.getElementById(`btn-${blockId}`);
    if (!container || !btnText) return;
    if (container.style.display === 'none' || container.style.display === '') {
        container.style.display = 'block';
        btnText.innerText = "- Hide All";
    } else {
        container.style.display = 'none';
        btnText.innerText = "+ Show All";
    }
}

export function sortPortfolioAnalysis() {
    if (currentPortfolioData.length === 0) return;
    currentPortfolioSortOrder = currentPortfolioSortOrder === 'asc' ? 'desc' : 'asc';
    const sortedData = [...currentPortfolioData].sort((a, b) => {
        const nameA = a.ticker.toUpperCase(), nameB = b.ticker.toUpperCase();
        return currentPortfolioSortOrder === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
    renderPortfolioAnalysis(sortedData);
}

// ==========================================
// Update Performance Summary
// ==========================================

export async function updatePerformanceSummary() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        console.warn('⚠️ No user logged in');
        return;
    }

    try {
        console.log('📊 Fetching timeline data for performance summary...');
        
        let timelineData = await fetchPortfolioTimelineData();
        
        if (!timelineData || timelineData.length < 2) {
            console.warn('⚠️ No timeline data, trying to refresh cache...');
            if (typeof CacheManager !== 'undefined') {
                CacheManager.remove(`timeline_${user.uid}_*`);
            }
            timelineData = await fetchPortfolioTimelineData();
        }

        if (!timelineData || timelineData.length < 2) {
            console.warn('⚠️ Still no timeline data. Need at least 2 entries.');
            const ids = [
                'dash-perf-today', 'dash-perf-5d', 'dash-perf-15d', 'dash-perf-30d',
                'dash-perf-3m', 'dash-perf-6m', 'dash-perf-1y',
                'dash-bench-today', 'dash-bench-5d', 'dash-bench-15d', 'dash-bench-30d',
                'dash-bench-3m', 'dash-bench-6m', 'dash-bench-1y',
                'dash-diff-today', 'dash-diff-5d', 'dash-diff-15d', 'dash-diff-30d',
                'dash-diff-3m', 'dash-diff-6m', 'dash-diff-1y'
            ];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.innerHTML = '-'; el.style.color = '#64748b'; }
            });
            return;
        }

        console.log(`✅ Timeline data loaded: ${timelineData.length} entries`);
        
        const latest = timelineData[timelineData.length - 1];
        const latestValue = latest.totalCurrentValue;
        console.log(`📈 Latest value: ৳${latestValue.toFixed(2)}`);

        const periods = [
            { name: 'today', days: 0 },
            { name: '5d', days: 5 },
            { name: '15d', days: 15 },
            { name: '30d', days: 30 },
            { name: '3m', days: 90 },
            { name: '6m', days: 180 },
            { name: '1y', days: 365 }
        ];

        const portfolioReturns = {};

        for (const period of periods) {
            if (period.days === 0) {
                const yesterday = timelineData[timelineData.length - 2];
                if (yesterday && yesterday.totalCurrentValue > 0) {
                    portfolioReturns.today = ((latestValue - yesterday.totalCurrentValue) / yesterday.totalCurrentValue) * 100;
                } else {
                    portfolioReturns.today = 0;
                }
                continue;
            }

            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - period.days);
            const targetDateStr = targetDate.toISOString().split('T')[0];

            let pastData = null;
            for (let i = timelineData.length - 1; i >= 0; i--) {
                if (timelineData[i].date <= targetDateStr) {
                    pastData = timelineData[i];
                    break;
                }
            }

            if (pastData && pastData.totalCurrentValue > 0) {
                portfolioReturns[period.name] = ((latestValue - pastData.totalCurrentValue) / pastData.totalCurrentValue) * 100;
            } else {
                portfolioReturns[period.name] = null;
            }
        }

        console.log('📊 Portfolio returns:', portfolioReturns);

        const updateCell = (id, value) => {
            const elem = document.getElementById(id);
            if (!elem) {
                console.warn(`⚠️ Element #${id} not found`);
                return;
            }
            if (value !== null && !isNaN(value) && isFinite(value)) {
                const sign = value >= 0 ? '+' : '';
                elem.innerHTML = `${sign}${value.toFixed(2)}%`;
                elem.style.color = value >= 0 ? '#10b981' : '#ef4444';
            } else {
                elem.innerHTML = '-';
                elem.style.color = '#64748b';
            }
        };

        updateCell('dash-perf-today', portfolioReturns.today);
        updateCell('dash-perf-5d', portfolioReturns['5d']);
        updateCell('dash-perf-15d', portfolioReturns['15d']);
        updateCell('dash-perf-30d', portfolioReturns['30d']);
        updateCell('dash-perf-3m', portfolioReturns['3m']);
        updateCell('dash-perf-6m', portfolioReturns['6m']);
        updateCell('dash-perf-1y', portfolioReturns['1y']);

        let benchmarkReturns = { today: 0, '5d': null, '15d': null, '30d': null, '3m': null, '6m': null, '1y': null };
        try {
            if (typeof db !== 'undefined') {
                const snapshot = await db.collection('dse_market_data')
                    .orderBy('date', 'asc')
                    .limit(1000)
                    .get();

                if (!snapshot.empty) {
                    const dsexData = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        const dsexStr = data.dsex_index || '0';
                        const dsexValue = parseFloat(dsexStr.replace(/,/g, ''));
                        if (dsexValue && !isNaN(dsexValue) && dsexValue > 0) {
                            dsexData.push({
                                date: new Date(data.date),
                                value: dsexValue
                            });
                        }
                    });

                    if (dsexData.length > 1) {
                        dsexData.sort((a, b) => a.date - b.date);
                        const latestDSEX = dsexData[dsexData.length - 1].value;

                        if (dsexData.length >= 2) {
                            const yesterdayDSEX = dsexData[dsexData.length - 2].value;
                            if (yesterdayDSEX > 0) {
                                benchmarkReturns.today = ((latestDSEX - yesterdayDSEX) / yesterdayDSEX) * 100;
                            }
                        }

                        for (const period of periods) {
                            if (period.days === 0) continue;
                            const targetDate = new Date();
                            targetDate.setDate(targetDate.getDate() - period.days);
                            let pastDSEX = null;
                            for (let i = dsexData.length - 1; i >= 0; i--) {
                                if (dsexData[i].date <= targetDate) {
                                    pastDSEX = dsexData[i].value;
                                    break;
                                }
                            }
                            if (pastDSEX && pastDSEX > 0) {
                                benchmarkReturns[period.name] = ((latestDSEX - pastDSEX) / pastDSEX) * 100;
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('DSEX benchmark error (using 0):', err);
        }

        updateCell('dash-bench-today', benchmarkReturns.today);
        updateCell('dash-bench-5d', benchmarkReturns['5d']);
        updateCell('dash-bench-15d', benchmarkReturns['15d']);
        updateCell('dash-bench-30d', benchmarkReturns['30d']);
        updateCell('dash-bench-3m', benchmarkReturns['3m']);
        updateCell('dash-bench-6m', benchmarkReturns['6m']);
        updateCell('dash-bench-1y', benchmarkReturns['1y']);

        const updateDiffCell = (id, port, bench) => {
            const elem = document.getElementById(id);
            if (!elem) return;
            if (port !== null && bench !== null && !isNaN(port) && !isNaN(bench) && isFinite(port) && isFinite(bench)) {
                const diff = port - bench;
                elem.innerHTML = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
                elem.style.color = diff >= 0 ? '#10b981' : '#ef4444';
            } else {
                elem.innerHTML = '-';
                elem.style.color = '#64748b';
            }
        };

        updateDiffCell('dash-diff-today', portfolioReturns.today, benchmarkReturns.today);
        updateDiffCell('dash-diff-5d', portfolioReturns['5d'], benchmarkReturns['5d']);
        updateDiffCell('dash-diff-15d', portfolioReturns['15d'], benchmarkReturns['15d']);
        updateDiffCell('dash-diff-30d', portfolioReturns['30d'], benchmarkReturns['30d']);
        updateDiffCell('dash-diff-3m', portfolioReturns['3m'], benchmarkReturns['3m']);
        updateDiffCell('dash-diff-6m', portfolioReturns['6m'], benchmarkReturns['6m']);
        updateDiffCell('dash-diff-1y', portfolioReturns['1y'], benchmarkReturns['1y']);

        const timeElem = document.getElementById('dash-perf-update-time');
        if (timeElem) {
            timeElem.innerText = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
        }

        console.log('✅ Performance Summary updated successfully!');

    } catch (error) {
        console.error('❌ Performance summary error:', error);
        const ids = ['dash-perf-today', 'dash-perf-5d', 'dash-perf-15d', 'dash-perf-30d',
                     'dash-perf-3m', 'dash-perf-6m', 'dash-perf-1y'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.innerHTML = '-'; el.style.color = '#64748b'; }
        });
    }
}

// ==========================================
// Update DSEX Indicator
// ==========================================

export async function updateDSEXIndicator() {
    const valueElem = document.getElementById('dsex-value');
    const changeElem = document.getElementById('dsex-change');
    const statusElem = document.getElementById('market-status');
    const lastUpdatedElem = document.getElementById('dsex-last-updated');

    try {
        const dsexData = await getLatestDSEXFromSupabase();
        let dsexValue = null;
        let dsexDate = null;
        let pointChange = 0;
        let percentChange = 0;

        if (dsexData && dsexData.value > 0) {
            dsexValue = dsexData.value;
            dsexDate = dsexData.date;
            pointChange = dsexData.change || 0;
            percentChange = dsexData.changePercent || 0;
        } else {
            if (typeof db !== 'undefined') {
                const snapshot = await db.collection('dse_market_data')
                    .orderBy('date', 'desc')
                    .limit(2)
                    .get();
                if (!snapshot.empty) {
                    const docs = snapshot.docs;
                    const latestData = docs[0].data();
                    const prevData = docs.length > 1 ? docs[1].data() : null;
                    const dsexStr = latestData.dsex_index || '0';
                    dsexValue = parseFloat(dsexStr.replace(/,/g, ''));
                    dsexDate = latestData.date ? new Date(latestData.date) : null;
                    
                    if (prevData) {
                        const prevStr = prevData.dsex_index || '0';
                        const prevValue = parseFloat(prevStr.replace(/,/g, ''));
                        if (prevValue > 0) {
                            pointChange = dsexValue - prevValue;
                            percentChange = (pointChange / prevValue) * 100;
                        }
                    }
                }
            }
        }

        if (dsexValue !== null && !isNaN(dsexValue) && dsexValue > 0) {
            if (valueElem) valueElem.innerText = dsexValue.toFixed(2);

            if (changeElem) {
                const sign = pointChange >= 0 ? '+' : '';
                const color = pointChange >= 0 ? '#90ffb0' : '#ffaaaa';
                changeElem.innerHTML = `
                    <span style="color: ${color}; font-weight: bold;">
                        ${sign}${pointChange.toFixed(2)}
                    </span>
                    <span style="color: ${color}; font-weight: bold; margin-left: 6px;">
                        (${sign}${percentChange.toFixed(2)}%)
                    </span>
                `;
                changeElem.style.color = color;
            }
        } else {
            if (valueElem) valueElem.innerText = '--';
            if (changeElem) {
                changeElem.innerHTML = 'No data';
                changeElem.style.color = '#94a3b8';
            }
        }

        if (statusElem) {
            statusElem.innerHTML = '🟢 Market Open';
            statusElem.style.color = '#90ffb0';
        }

        if (lastUpdatedElem) {
            if (dsexDate) {
                lastUpdatedElem.innerHTML = `Last updated: ${dsexDate.toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`;
            } else {
                lastUpdatedElem.innerHTML = 'Last updated: N/A';
            }
        }

    } catch (err) {
        console.error('❌ DSEX Indicator error:', err);
        if (valueElem) valueElem.innerText = 'Error';
        if (changeElem) changeElem.innerHTML = '--';
        if (lastUpdatedElem) lastUpdatedElem.innerHTML = 'Last updated: Error';
    }
}

// ==========================================
// Helper: getLatestDSEXFromSupabase
// ==========================================

async function getLatestDSEXFromSupabase() {
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

console.log('✅ dash-performance.js loaded');