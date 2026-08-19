// ==========================================
// 📊 dash-cards.js - সম্পূর্ণ ইরর-ফ্রি ভার্সন
//    কার্ড: টোটাল ভ্যালু, ইনভেস্টমেন্ট, P/L, ডেইলি G/L, ইনকাম
//    🔥 ম্যাক্স সেল অ্যালার্ট (Max Sell Alert)
//    🔥 ডেইলি সামারি নোটিফিকেশন (টপ ৩ Buy/Sell সহ)
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { 
    getLatestAndPreviousPrices, getUnifiedPrice, 
    formatDisplayTime, toBangladeshTime, getBangladeshDateString,
    chunkArray, debounce, safeParseDate 
} from './core.js';
import { 
    cachedAnchoredVWAP, cachedVolumeProfile, cachedRSI,
    cachedSMA, cachedBollingerBands, cachedMACD, cachedATR,
    cachedStochastic, cachedParabolicSAR
} from './indicators.js';
import { updatePerformanceSummary } from './dash-performance.js';
import { renderDashboardHistoryChart, renderDashboardDailyPLChart } from './dash-charts.js';
import { loadSignalData } from './dash-signals.js';
// 🔥 dataService ইম্পোর্ট (ম্যাক্স সেল অ্যালার্টের জন্য)
import { dataService } from './data-service.js';

// ==========================================
// 📌 গ্লোবাল ভেরিয়েবল
// ==========================================

let currentDashboardPortfolioId = null;
let cachedDashboardData = null;
let lastDashboardLoadTime = 0;
const DASHBOARD_CACHE_TTL = 300000; // ৫ মিনিট

// ==========================================
// ১. ড্যাশবোর্ড ডেটা লোড (মূল ফাংশন)
// ==========================================

export async function loadDashboardData(portfolioId = null, forceRefresh = false) {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const startInput = document.getElementById('dash-chart-start');
    const endInput = document.getElementById('dash-chart-end');
    if (startInput) startInput.value = thirtyDaysAgo.toISOString().split('T')[0];
    if (endInput) endInput.value = today.toISOString().split('T')[0];

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        console.log('No user logged in');
        return;
    }
    window.currentDashboardPortfolioId = portfolioId;

    // ---------- ক্যাশ চেক ----------
    const cacheKey = `dashboard_${user.uid}_${portfolioId || 'all'}`;
    if (!forceRefresh) {
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < DASHBOARD_CACHE_TTL) {
                    console.log('📦 Dashboard loaded from cache');
                    const data = parsed.data;
                    updateDashboardCards(data);
                    if (typeof renderDashboardHistoryChart === 'function') {
                        renderDashboardHistoryChart();
                    }
                    if (typeof renderDashboardDailyPLChart === 'function') {
                        renderDashboardDailyPLChart();
                    }
                    if (typeof updatePerformanceSummary === 'function') {
                        updatePerformanceSummary();
                    }
                    if (typeof updateDSEXIndicator === 'function') {
                        updateDSEXIndicator();
                    }
                    if (typeof updateTotalIncomeCard === 'function') {
                        updateTotalIncomeCard();
                    }
                    if (typeof loadSignalData === 'function') {
                        loadSignalData();
                    }
                    updateTimestamp();
                    
                    // ক্যাশ থেকে লোড করার পরেও ডেইলি সাজেশন লোড
                    try {
                        if (typeof loadDailySuggestion === 'function') {
                            setTimeout(loadDailySuggestion, 400);
                        }
                    } catch (e) {
                        console.warn('Daily Suggestion (cache) load error:', e);
                    }
                    return;
                }
            }
        } catch (e) { /* ignore */ }
    }

    showDataLoading(true);
    try {
        // ১. ইউনিফাইড ক্যালকুলেশন (পোর্টফোলিও ফিল্টার সহ)
        const unifiedData = await unifiedEngine.calculate(user.uid, portfolioId, forceRefresh);
        
        let totalCurrentValue = 0;
        let totalInvestment = 0;
        let totalProfitLoss = 0;
        let totalRemainingQty = 0;

        // 🔥 ম্যাক্স সেল প্রাইস ম্যাপ তৈরি করুন (sales history থেকে)
        let maxSellPriceMap = new Map();
        try {
            const salesData = await dataService.getSalesHistory(user.uid);
            if (salesData && salesData.length > 0) {
                salesData.forEach(sale => {
                    const ticker = sale.shareName;
                    const sellPrice = sale.sellPrice || 0;
                    if (sellPrice > 0) {
                        const currentMax = maxSellPriceMap.get(ticker) || 0;
                        if (sellPrice > currentMax) {
                            maxSellPriceMap.set(ticker, sellPrice);
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('Could not fetch sales history for max sell alert:', e);
        }

        // প্রাইস ম্যাপ তৈরি করুন (অ্যালার্ট চেকের জন্য)
        let priceMap = new Map();

        if (unifiedData && unifiedData.stockDetails.length > 0) {
            const tickers = unifiedData.stockDetails.map(s => s.ticker);
            priceMap = await getLatestAndPreviousPrices(tickers);

            for (let i = 0; i < unifiedData.stockDetails.length; i++) {
                const stock = unifiedData.stockDetails[i];
                const priceData = priceMap.get(stock.ticker);
                let currentPrice = priceData?.currentPrice || 0;
                if (currentPrice === 0) currentPrice = stock.avgBuyPriceWithCommission;
                totalCurrentValue += stock.totalQty * currentPrice;
                totalRemainingQty += stock.totalQty;

                // ==========================================
                // 🔔 অ্যালার্ট চেক করুন (প্রাইস লুপের ভেতরে)
                // ==========================================
                if (currentPrice > 0 && typeof window.notificationManager !== 'undefined' && window.notificationManager) {
                    try {
                        window.notificationManager.checkPriceAlerts(stock.ticker, currentPrice);
                    } catch (e) {
                        console.warn('Alert check error for', stock.ticker, e);
                    }
                }

                // ==========================================
                // 🔔 ম্যাক্স সেল প্রাইস অ্যালার্ট (Max Sell Alert)
                // ==========================================
                const maxSell = maxSellPriceMap.get(stock.ticker) || 0;
                if (maxSell > 0 && currentPrice > maxSell) {
                    const lastNotifiedKey = `maxsell_${stock.ticker}`;
                    const lastNotified = localStorage.getItem(lastNotifiedKey);
                    const today = new Date().toISOString().split('T')[0];
                    if (lastNotified !== today) {
                        localStorage.setItem(lastNotifiedKey, today);
                        if (typeof window.notificationManager !== 'undefined' && window.notificationManager) {
                            window.notificationManager.showNotification(
                                `🚀 ${stock.ticker} Breaks Max Sell!`,
                                `Current: ৳${currentPrice.toFixed(2)} | Your Max Sell: ৳${maxSell.toFixed(2)}`
                            );
                        }
                    }
                }
            }

            totalInvestment = unifiedData.totalInvestment;
            totalProfitLoss = totalCurrentValue - totalInvestment;
        } else {
            totalInvestment = 0;
            totalCurrentValue = 0;
            totalProfitLoss = 0;
        }

        // ২. ড্যাশবোর্ড কার্ড আপডেট
        const dashTotalValue = document.getElementById('dash-total-value');
        const dashTotalCost = document.getElementById('dash-total-cost');
        const dashTotalGL = document.getElementById('dash-total-gl');
        const dashDaily = document.getElementById('dash-total-daily');
        const dashDailyPct = document.getElementById('dash-total-daily-pct');
        const dashGLPct = document.getElementById('dash-total-gl-pct');

        if (dashTotalValue) dashTotalValue.innerHTML = `৳${totalCurrentValue.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        if (dashTotalCost) dashTotalCost.innerHTML = `৳${totalInvestment.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        if (dashTotalGL) {
            dashTotalGL.innerHTML = `${totalProfitLoss >= 0 ? '+' : ''}৳${totalProfitLoss.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
            dashTotalGL.style.color = totalProfitLoss >= 0 ? '#90ffb0' : '#ffaaaa';
        }
        if (dashGLPct && totalInvestment > 0) {
            const totalPct = (totalProfitLoss / totalInvestment) * 100;
            dashGLPct.innerHTML = `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%`;
            dashGLPct.style.color = totalPct >= 0 ? '#90ffb0' : '#ffaaaa';
        }

        // ডেইলি G/L – আগের দিনের প্রাইস দিয়ে হিসাব (Supabase-first)
        if (unifiedData && unifiedData.stockDetails.length > 0) {
            const tickers = unifiedData.stockDetails.map(s => s.ticker);
            const priceMapDaily = await getLatestAndPreviousPrices(tickers);
            let dailyGL = 0, dailyPct = 0;
            for (const stock of unifiedData.stockDetails) {
                const priceData = priceMapDaily.get(stock.ticker);
                const currentPrice = priceData?.currentPrice || 0;
                const prevPrice = priceData?.previousPrice || 0;
                const qty = stock.totalQty || 0;
                if (prevPrice > 0 && qty > 0) {
                    dailyGL += qty * (currentPrice - prevPrice);
                }
            }
            if (dashDaily) {
                dashDaily.innerHTML = `${dailyGL >= 0 ? '+' : ''}৳${dailyGL.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
                dashDaily.style.color = dailyGL >= 0 ? '#90ffb0' : '#ffaaaa';
            }
            if (dashDailyPct && totalInvestment > 0) {
                dailyPct = (dailyGL / totalInvestment) * 100;
                dashDailyPct.innerHTML = `${dailyPct >= 0 ? '+' : ''}${dailyPct.toFixed(2)}%`;
                dashDailyPct.style.color = dailyPct >= 0 ? '#90ffb0' : '#ffaaaa';
            }
        } else {
            if (dashDaily) {
                dashDaily.innerHTML = '৳0.00';
                dashDaily.style.color = '#94a3b8';
            }
            if (dashDailyPct) {
                dashDailyPct.innerHTML = '0.00%';
                dashDailyPct.style.color = '#94a3b8';
            }
        }

        window.currentPortfolioTotalValue = totalCurrentValue;
        updateTimestamp();

        // ৩. ক্যাশে সেভ
        try {
            const dataToCache = {
                totalInvestment,
                totalCurrentValue,
                totalProfitLoss,
                totalRemainingQty,
                _portfolioId: portfolioId || 'all'
            };
            sessionStorage.setItem(cacheKey, JSON.stringify({
                timestamp: Date.now(),
                data: dataToCache
            }));
        } catch (e) { /* ignore */ }

        // ৪. অন্যান্য UI কম্পোনেন্ট আপডেট
        if (typeof updatePerformanceSummary === 'function') {
            await updatePerformanceSummary();
        }
        if (typeof updateDSEXIndicator === 'function') {
            await updateDSEXIndicator();
        }
        if (typeof renderDashboardHistoryChart === 'function') {
            await renderDashboardHistoryChart();
        }
        if (typeof updateTotalIncomeCard === 'function') {
            await updateTotalIncomeCard();
        }
        if (typeof renderDashboardDailyPLChart === 'function') {
            await renderDashboardDailyPLChart();
        }
        if (typeof loadSignalData === 'function') {
            await loadSignalData();
        }
        
        // ৫. ড্যাশবোর্ড সার্চ ইনিশিয়ালাইজ
        if (typeof initDashboardSearch === 'function') {
            initDashboardSearch();
        }

        // ৬. পোর্টফোলিও ম্যানেজারের জন্য সাইডবার ও সিলেক্টর আপডেট
        if (typeof updateSidebarPortfolioList === 'function') {
            updateSidebarPortfolioList();
        }
        if (typeof updateBuyPortfolioSelect === 'function') {
            updateBuyPortfolioSelect();
        }

        console.log(`✅ Dashboard loaded for ${portfolioId || 'grand'}`);

        // ==========================================
        // 🔥 ডেইলি সাজেশন লোড (Dashboard Load-এর অংশ)
        // ==========================================
        try {
            if (typeof loadDailySuggestion === 'function') {
                setTimeout(loadDailySuggestion, 600);
            } else {
                console.warn('⚠️ loadDailySuggestion function not found');
            }
        } catch (e) {
            console.warn('⚠️ Daily Suggestion load error:', e);
        }

        // ==========================================
        // 🔔 অ্যালার্ট লিস্ট লোড করুন (UI আপডেটের জন্য)
        // ==========================================
        if (typeof loadActiveAlerts === 'function') {
            setTimeout(loadActiveAlerts, 500);
        }

    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast('Error loading dashboard data', 'error');
    } finally {
        showDataLoading(false);
    }
}

// ==========================================
// ২. ড্যাশবোর্ড কার্ড আপডেট (হেলপার ফাংশন)
// ==========================================

export function updateDashboardCards(data) {
    if (!data) return;
    const dashTotalValue = document.getElementById('dash-total-value');
    const dashTotalCost = document.getElementById('dash-total-cost');
    const dashTotalGL = document.getElementById('dash-total-gl');
    const dashGLPct = document.getElementById('dash-total-gl-pct');
    const dashDaily = document.getElementById('dash-total-daily');
    const dashDailyPct = document.getElementById('dash-total-daily-pct');

    if (dashTotalValue) dashTotalValue.innerHTML = `৳${(data.totalCurrentValue || 0).toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    if (dashTotalCost) dashTotalCost.innerHTML = `৳${(data.totalInvestment || 0).toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    const pl = (data.totalCurrentValue || 0) - (data.totalInvestment || 0);
    if (dashTotalGL) {
        dashTotalGL.innerHTML = `${pl >= 0 ? '+' : ''}৳${pl.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        dashTotalGL.style.color = pl >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    if (dashGLPct && data.totalInvestment > 0) {
        const pct = (pl / data.totalInvestment) * 100;
        dashGLPct.innerHTML = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        dashGLPct.style.color = pct >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    if (data.dailyGL !== undefined && dashDaily) {
        dashDaily.innerHTML = `${data.dailyGL >= 0 ? '+' : ''}৳${data.dailyGL.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        dashDaily.style.color = data.dailyGL >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    if (data.dailyPct !== undefined && dashDailyPct && data.totalInvestment > 0) {
        dashDailyPct.innerHTML = `${data.dailyPct >= 0 ? '+' : ''}${data.dailyPct.toFixed(2)}%`;
        dashDailyPct.style.color = data.dailyPct >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    
    // ==========================================
    // 🔥 ক্যাশ হিট হলেও ডেইলি সাজেশন লোড
    // ==========================================
    try {
        if (typeof loadDailySuggestion === 'function') {
            setTimeout(loadDailySuggestion, 400);
        }
    } catch (e) {
        console.warn('Daily Suggestion (cache) load error:', e);
    }
}

// ==========================================
// ৩. অ্যানালাইসিস থেকে কার্ড আপডেট
// ==========================================

export function updateDashboardCardsFromAnalysis(totalCost, totalValue, dailyGL, totalGL) {
    const dashValue = document.getElementById('dash-total-value');
    const dashCost = document.getElementById('dash-total-cost');
    const dashDaily = document.getElementById('dash-total-daily');
    const dashDailyPct = document.getElementById('dash-total-daily-pct');
    const dashGL = document.getElementById('dash-total-gl');
    const dashGLPct = document.getElementById('dash-total-gl-pct');

    if (dashValue) dashValue.innerHTML = `৳${totalValue.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    if (dashCost) dashCost.innerHTML = `৳${totalCost.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    if (dashDaily) {
        dashDaily.innerHTML = `${dailyGL >= 0 ? '+' : ''}৳${dailyGL.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        dashDaily.style.color = dailyGL >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    if (dashDailyPct && totalCost > 0) {
        const dailyPct = (dailyGL / totalCost) * 100;
        dashDailyPct.innerHTML = `${dailyPct >= 0 ? '+' : ''}${dailyPct.toFixed(2)}%`;
        dashDailyPct.style.color = dailyPct >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    if (dashGL) {
        dashGL.innerHTML = `${totalGL >= 0 ? '+' : ''}৳${totalGL.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        dashGL.style.color = totalGL >= 0 ? '#90ffb0' : '#ffaaaa';
    }
    if (dashGLPct && totalCost > 0) {
        const totalPct = (totalGL / totalCost) * 100;
        dashGLPct.innerHTML = `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%`;
        dashGLPct.style.color = totalPct >= 0 ? '#90ffb0' : '#ffaaaa';
    }
}

// ==========================================
// ৪. টোটাল ইনকাম কার্ড আপডেট
// ==========================================

export async function updateTotalIncomeCard() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    try {
        const deposit = await window.getUserDeposit(user.uid);
        const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
        let totalCurrentValue = 0;

        if (unifiedData && unifiedData.stockDetails) {
            const tickers = unifiedData.stockDetails.map(s => s.ticker);
            const pricePromises = tickers.map(t => getUnifiedPrice(t));
            const currentPrices = await Promise.all(pricePromises);

            for (let i = 0; i < unifiedData.stockDetails.length; i++) {
                const stock = unifiedData.stockDetails[i];
                const price = currentPrices[i] || 0;
                totalCurrentValue += stock.totalQty * price;
            }
        }

        const totalIncome = totalCurrentValue - deposit;
        const profitPercent = deposit > 0 ? (totalIncome / deposit) * 100 : 0;

        const incomeElem = document.getElementById('dash-total-income');
        const pctElem = document.getElementById('dash-total-income-pct');

        if (incomeElem) {
            incomeElem.innerText = `৳${totalIncome.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
            incomeElem.style.color = totalIncome >= 0 ? '#90ffb0' : '#ffaaaa';
        }
        if (pctElem) {
            pctElem.innerText = `(${totalIncome >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`;
            pctElem.style.color = totalIncome >= 0 ? '#90ffb0' : '#ffaaaa';
        }
    } catch (error) {
        console.error('❌ Error in updateTotalIncomeCard:', error);
    }
}

// ==========================================
// ৫. ডিপোজিট মডাল ওপেন
// ==========================================

export function openDepositModal() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    const modal = document.getElementById('deposit-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    if (typeof loadDepositModalData === 'function') {
        loadDepositModalData();
    } else {
        _loadDepositModalData(user.uid);
    }
}

async function _loadDepositModalData(userId) {
    try {
        const deposit = await window.getUserDeposit(userId);
        const unifiedData = await unifiedEngine.calculate(userId, null, true);
        let totalCurrentValue = 0;
        if (unifiedData && unifiedData.stockDetails.length > 0) {
            const tickers = unifiedData.stockDetails.map(s => s.ticker);
            const pricePromises = tickers.map(t => getUnifiedPrice(t));
            const currentPrices = await Promise.all(pricePromises);
            for (let i = 0; i < unifiedData.stockDetails.length; i++) {
                const stock = unifiedData.stockDetails[i];
                totalCurrentValue += stock.totalQty * (currentPrices[i] || 0);
            }
        }

        const totalIncome = totalCurrentValue - deposit;
        const profitPercent = deposit > 0 ? (totalIncome / deposit) * 100 : 0;

        const depositInput = document.getElementById('deposit-input');
        const realizedProfit = document.getElementById('deposit-realized-profit');
        const totalIncomeElem = document.getElementById('deposit-total-income');
        const incomePctElem = document.getElementById('deposit-income-pct');

        if (depositInput) depositInput.value = deposit;
        if (realizedProfit) realizedProfit.innerHTML = `৳${totalCurrentValue.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        if (totalIncomeElem) totalIncomeElem.innerHTML = `৳${totalIncome.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        if (incomePctElem) incomePctElem.innerText = `${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%`;

        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);
        const defaultStart = thirtyDaysAgo.toISOString().split('T')[0];
        const defaultEnd = today.toISOString().split('T')[0];
        const startInput = document.getElementById('income-chart-start');
        const endInput = document.getElementById('income-chart-end');
        if (startInput) startInput.value = defaultStart;
        if (endInput) endInput.value = defaultEnd;

        if (typeof loadIncomeChartAndTable === 'function') {
            loadIncomeChartAndTable(userId, defaultStart, defaultEnd);
        }

    } catch (error) {
        console.error('❌ Error loading deposit modal data:', error);
        showToast('Error loading data', 'error');
    }
}

export function closeDepositModal() {
    const modal = document.getElementById('deposit-modal');
    if (modal) modal.style.display = 'none';
}

// ==========================================
// ৬. ডিপোজিট সেভ
// ==========================================

export async function saveDeposit() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    const input = document.getElementById('deposit-input');
    if (!input) return;
    const amount = parseFloat(input.value);
    if (isNaN(amount) || amount < 0) {
        showToast('Please enter a valid deposit amount.', 'warning');
        return;
    }
    try {
        await window.updateUserDeposit(user.uid, amount);
        showToast('Deposit updated successfully!', 'success');
        closeDepositModal();
        await updateTotalIncomeCard();
    } catch (e) {
        showToast('Failed to update deposit.', 'error');
    }
}

// ==========================================
// ৭. ডেইলি ইনকাম ডেটা ফেচ
// ==========================================

export async function getDailyIncomeData(userId) {
    if (!userId) return [];
    try {
        let salesData = [];
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data } = await supabase
                    .from('sales_history')
                    .select('profit_or_loss, date')
                    .eq('user_id', userId);
                if (data) salesData = data;
            } catch (e) { /* ignore */ }
        }
        if (salesData.length === 0 && typeof db !== 'undefined') {
            const snapshot = await db.collection('sales_history')
                .where('userId', '==', userId)
                .get();
            snapshot.forEach(doc => {
                const data = doc.data();
                salesData.push({
                    profit_or_loss: data.profitOrLoss || 0,
                    date: data.date?.toDate?.()?.toISOString?.() || new Date().toISOString()
                });
            });
        }

        const dailyMap = new Map();
        salesData.forEach(item => {
            const date = new Date(item.date);
            const dateStr = date.toISOString().split('T')[0];
            const profit = item.profit_or_loss || 0;
            dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + profit);
        });

        const sortedDates = Array.from(dailyMap.keys()).sort();
        const result = [];
        let cumulative = 0;
        for (const date of sortedDates) {
            const daily = dailyMap.get(date);
            cumulative += daily;
            result.push({ date, daily, cumulative });
        }
        return result;
    } catch (e) {
        console.error('Error fetching daily income:', e);
        return [];
    }
}

// ==========================================
// ৮. ইনকাম চার্ট ও টেবিল লোড
// ==========================================

export async function loadIncomeChartAndTable(userId, startDate = null, endDate = null) {
    const tbody = document.getElementById('income-history-tbody');
    const canvas = document.getElementById('incomeHistoryChart');
    if (!tbody || !canvas) return;

    try {
        let dailyData = await getDailyIncomeData(userId);
        if (!dailyData || dailyData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--text-muted);">No sales history found. Start selling to see income growth!</td></tr>`;
            return;
        }

        if (startDate && endDate) {
            const startObj = new Date(startDate);
            const endObj = new Date(endDate);
            startObj.setHours(0, 0, 0, 0);
            endObj.setHours(23, 59, 59, 999);
            dailyData = dailyData.filter(item => {
                const itemDate = new Date(item.date);
                return itemDate >= startObj && itemDate <= endObj;
            });
        }

        let html = '';
        for (const item of dailyData) {
            html += `<tr>
                <td style="padding:4px 8px;">${item.date}</td>
                <td style="padding:4px 8px; text-align:right;">${item.daily >= 0 ? '+' : ''}৳${item.daily.toFixed(2)}</td>
                <td style="padding:4px 8px; text-align:right; font-weight:600;">৳${item.cumulative.toFixed(2)}</td>
            </tr>`;
        }
        tbody.innerHTML = html;

        const labels = dailyData.map(d => d.date);
        const cumulativeData = dailyData.map(d => d.cumulative);

        if (window.incomeChartInstance) {
            window.incomeChartInstance.destroy();
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        const ctx = canvas.getContext('2d');
        window.incomeChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cumulative Income (৳)',
                    data: cumulativeData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 3,
                    pointBackgroundColor: '#10b981'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `Cumulative Income: ৳${ctx.raw.toFixed(2)}`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: textColor, maxRotation: 45, font: { size: 9 } }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor, callback: (v) => '৳' + v.toFixed(0) }, grid: { color: gridColor } }
                }
            }
        });
    } catch (error) {
        console.error('Error loading income chart:', error);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:red;">Error loading data: ${error.message}</td></tr>`;
    }
}

// ==========================================
// ৯. ইনকাম ফিল্টার
// ==========================================

let incomeFilterStart = null;
let incomeFilterEnd = null;

export function applyIncomeFilter() {
    const start = document.getElementById('income-chart-start')?.value;
    const end = document.getElementById('income-chart-end')?.value;
    if (start && end) {
        incomeFilterStart = start;
        incomeFilterEnd = end;
        const user = auth && auth.currentUser ? auth.currentUser : null;
        if (user) loadIncomeChartAndTable(user.uid, start, end);
    } else {
        showToast('Please select both dates.', 'warning');
    }
}

export function resetIncomeFilter() {
    incomeFilterStart = null;
    incomeFilterEnd = null;
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const startInput = document.getElementById('income-chart-start');
    const endInput = document.getElementById('income-chart-end');
    if (startInput) startInput.value = thirtyDaysAgo.toISOString().split('T')[0];
    if (endInput) endInput.value = today.toISOString().split('T')[0];
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (user) loadIncomeChartAndTable(user.uid, startInput?.value, endInput?.value);
}

// ==========================================
// 🆕 App Daily Suggestion - VWAP + Volume Profile + RSI + থ্রেশহোল্ড
// ==========================================

/**
 * ডেইলি সাজেশন লোড করে
 * পোর্টফোলিওর প্রতিটি শেয়ার অ্যানালাইসিস করে BUY/SELL সাজেশন দেয়
 */
export async function loadDailySuggestion() {
    const loader = document.getElementById('ds-loader');
    const content = document.getElementById('ds-content');
    const updateTime = document.getElementById('ds-update-time');
    
    // এলিমেন্ট না থাকলে রিটার্ন
    if (!loader || !content) {
        console.warn('⚠️ Daily Suggestion elements not found in DOM');
        return;
    }

    const user = auth?.currentUser;
    if (!user) {
        if (loader) loader.innerHTML = '⚠️ Please login first';
        return;
    }

    try {
        loader.style.display = 'block';
        content.style.display = 'none';

        // ১. পোর্টফোলিও ডেটা
        const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
        if (!unifiedData || !unifiedData.stockDetails || unifiedData.stockDetails.length === 0) {
            loader.innerHTML = '📭 No holdings found. Start buying shares!';
            return;
        }

        const stocks = unifiedData.stockDetails;
        const totalHoldings = stocks.length;
        let totalCost = 0, totalValue = 0, totalQty = 0;
        let buySuggestions = [], sellSuggestions = [];

        // ২. প্রতিটি স্টকের জন্য অ্যানালাইসিস
        const tickers = stocks.map(s => s.ticker);
        const priceMap = await getLatestAndPreviousPrices(tickers);
        const pricePromises = tickers.map(t => getUnifiedPrice(t));
        const currentPrices = await Promise.all(pricePromises);

        // প্রাইস ডেটা ফেচ (গত ৩০ দিন)
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const startDateStr = startDate.toISOString().split('T')[0];

        for (let i = 0; i < stocks.length; i++) {
            const stock = stocks[i];
            const ticker = stock.ticker;
            const qty = stock.totalQty || 0;
            const avgBuy = stock.avgBuyPriceWithCommission || stock.avgBuyPrice || 0;
            const currentPrice = currentPrices[i] || 0;
            const cost = stock.totalCost || 0;
            const value = qty * currentPrice;
            const pl = value - cost;
            const plPct = cost > 0 ? (pl / cost) * 100 : 0;

            totalCost += cost;
            totalValue += value;
            totalQty += qty;

            // ৩. মেটাডেটা (ATH/ATL/RSI/VWAP/POC)
            let ath = 0, atl = 0;
            let rsi = 50, vwap = currentPrice, pocPrice = currentPrice;

            try {
                // Supabase history_dse থেকে ডেটা ফেচ
                let priceData = [];
                if (typeof supabase !== 'undefined' && supabase) {
                    const { data, error } = await supabase
                        .from('history_dse')
                        .select('date, ltp, high, low, volume')
                        .eq('ticker', ticker)
                        .gte('date', startDateStr)
                        .order('date', { ascending: true });
                    if (!error && data && data.length > 0) {
                        priceData = data;
                    }
                }

                // Firebase ফ্যালব্যাক
                if (priceData.length === 0 && typeof db !== 'undefined') {
                    const snap = await db.collection('daily_prices')
                        .where('ticker', '==', ticker)
                        .where('date', '>=', startDateStr)
                        .orderBy('date', 'asc')
                        .get();
                    if (!snap.empty) {
                        snap.forEach(doc => {
                            const d = doc.data();
                            const price = parseFloat(d.price) || parseFloat(d.close) || 0;
                            const high = parseFloat(d.high) || price;
                            const low = parseFloat(d.low) || price;
                            if (price > 0) {
                                priceData.push({ date: d.date, ltp: price, high: high, low: low, volume: 0 });
                            }
                        });
                    }
                }

                if (priceData && priceData.length > 0) {
                    const prices = priceData.map(d => parseFloat(d.ltp));
                    const highs = priceData.map(d => parseFloat(d.high) || parseFloat(d.ltp));
                    const lows = priceData.map(d => parseFloat(d.low) || parseFloat(d.ltp));
                    ath = Math.max(...highs);
                    atl = Math.min(...lows);
                    
                    // RSI
                    const rsiCalc = cachedRSI(prices, 14);
                    if (rsiCalc && rsiCalc.length > 0) {
                        const lastRsi = rsiCalc[rsiCalc.length - 1];
                        rsi = lastRsi && lastRsi.rsi !== null ? lastRsi.rsi : 50;
                    }
                    
                    // VWAP
                    const volumes = priceData.map(d => parseFloat(d.volume) || 1);
                    const vwapCalc = cachedAnchoredVWAP(prices, volumes, 0);
                    if (vwapCalc && vwapCalc.length > 0) {
                        vwap = vwapCalc[vwapCalc.length - 1] || currentPrice;
                    }
                    
                    // Volume Profile POC
                    const volProfile = cachedVolumeProfile(prices, volumes, 20);
                    if (volProfile && volProfile.pocPrice > 0) {
                        pocPrice = volProfile.pocPrice;
                    }
                }
            } catch (e) { 
                console.warn(`⚠️ Meta data fetch failed for ${ticker}:`, e);
            }

            // ৪. থ্রেশহোল্ড ভিত্তিক স্কোর (স্ক্রিনশটের লজিক)
            let buyScore = 0, sellScore = 0;
            let reasons = [];

            // --- থ্রেশহোল্ড লজিক ---
            if (plPct <= -25) { buyScore += 5; reasons.push('-25%+ loss → Strong Buy'); }
            else if (plPct <= -15) { buyScore += 3; reasons.push('-15% loss → Buy More'); }
            else if (plPct <= -5) { buyScore += 1; reasons.push('-5% loss → Hold/Buy'); }
            else if (plPct >= 100) { sellScore += 5; reasons.push('+100% profit → Exit'); }
            else if (plPct >= 60) { sellScore += 4; reasons.push('+60% profit → Sell 40%'); }
            else if (plPct >= 45) { sellScore += 3; reasons.push('+45% profit → Sell 30%'); }
            else if (plPct >= 35) { sellScore += 2; reasons.push('+35% profit → Sell 20%'); }
            else if (plPct >= 25) { sellScore += 1; reasons.push('+25% profit → Sell 10%'); }
            else if (plPct >= 15) { /* Stay Patient */ }
            else if (plPct >= 5) { /* Hold */ }

            // --- ইন্ডিকেটর ভিত্তিক স্কোর ---
            // VWAP
            if (currentPrice > vwap * 1.02) { buyScore += 1; reasons.push('Price above VWAP'); }
            else if (currentPrice < vwap * 0.98) { sellScore += 1; reasons.push('Price below VWAP'); }

            // POC
            if (currentPrice > pocPrice * 1.02) { buyScore += 1; reasons.push('Price above POC'); }
            else if (currentPrice < pocPrice * 0.98) { sellScore += 1; reasons.push('Price below POC'); }

            // RSI
            if (rsi < 30) { buyScore += 2; reasons.push('RSI oversold (<30)'); }
            else if (rsi > 70) { sellScore += 2; reasons.push('RSI overbought (>70)'); }

            // ATH/ATL
            if (ath > 0 && currentPrice >= ath * 0.95) { sellScore += 1; reasons.push('Near ATH'); }
            if (atl > 0 && currentPrice <= atl * 1.05) { buyScore += 1; reasons.push('Near ATL'); }

            // ৫. ফাইনাল ডিসিশন
            const netScore = buyScore - sellScore;

            if (netScore >= 3) {
                buySuggestions.push({ 
                    ticker, 
                    currentPrice, 
                    avgBuy, 
                    plPct, 
                    reasons: reasons.slice(0, 3), 
                    score: netScore 
                });
            } else if (netScore <= -3) {
                sellSuggestions.push({ 
                    ticker, 
                    currentPrice, 
                    avgBuy, 
                    plPct, 
                    reasons: reasons.slice(0, 3), 
                    score: Math.abs(netScore) 
                });
            }

            // ⭐ বোনাস: জোরালো সিগন্যাল
            if (plPct >= 25 && netScore >= 1) {
                const exists = sellSuggestions.some(s => s.ticker === ticker);
                if (!exists) {
                    sellSuggestions.push({ 
                        ticker, 
                        currentPrice, 
                        avgBuy, 
                        plPct, 
                        reasons: ['+25% profit reached'], 
                        score: 3 
                    });
                }
            }
            if (plPct <= -25 && netScore >= 1) {
                const exists = buySuggestions.some(s => s.ticker === ticker);
                if (!exists) {
                    buySuggestions.push({ 
                        ticker, 
                        currentPrice, 
                        avgBuy, 
                        plPct, 
                        reasons: ['-25% loss – buy opportunity'], 
                        score: 3 
                    });
                }
            }
        }

        // ৬. সাজেশন সাজানো (স্কোর অনুযায়ী)
        buySuggestions.sort((a, b) => b.score - a.score);
        sellSuggestions.sort((a, b) => b.score - a.score);

        // ৭. UI আপডেট
        const avgBuyOverall = totalQty > 0 ? totalCost / totalQty : 0;
        const totalPlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

        const totalHoldingsEl = document.getElementById('ds-total-holdings');
        const avgBuyEl = document.getElementById('ds-avg-buy');
        const totalPlEl = document.getElementById('ds-total-pl');
        const currentValueEl = document.getElementById('ds-current-value');

        if (totalHoldingsEl) totalHoldingsEl.textContent = totalHoldings;
        if (avgBuyEl) avgBuyEl.textContent = `৳${avgBuyOverall.toFixed(2)}`;
        if (totalPlEl) {
            totalPlEl.textContent = `${totalPlPct >= 0 ? '+' : ''}${totalPlPct.toFixed(2)}%`;
            totalPlEl.style.color = totalPlPct >= 0 ? '#10b981' : '#ef4444';
        }
        if (currentValueEl) currentValueEl.textContent = `৳${totalValue.toFixed(2)}`;

        // BUY লিস্ট রেন্ডার
        renderDailySuggestionList('ds-buy-list', buySuggestions, 'buy');
        const buyCountEl = document.getElementById('ds-buy-count');
        if (buyCountEl) buyCountEl.textContent = buySuggestions.length;

        // SELL লিস্ট রেন্ডার
        renderDailySuggestionList('ds-sell-list', sellSuggestions, 'sell');
        const sellCountEl = document.getElementById('ds-sell-count');
        if (sellCountEl) sellCountEl.textContent = sellSuggestions.length;

        // থ্রেশহোল্ড সারাংশ
        const thresholdText = document.getElementById('ds-threshold-text');
        if (thresholdText) {
            if (buySuggestions.length === 0 && sellSuggestions.length === 0) {
                thresholdText.innerHTML = '⚪ No strong signals. Your portfolio is balanced. Follow the system: <strong>-5% Hold | -15% Buy More | -25% Buy More | +25% Sell 10% | +35% Sell 20% | +45% Sell 30% | +60% Sell 40% | +100% Exit</strong>';
            } else {
                let msg = '';
                if (buySuggestions.length > 0) {
                    msg += `📈 <strong>${buySuggestions.length}</strong> BUY signal(s) detected. `;
                }
                if (sellSuggestions.length > 0) {
                    msg += `📉 <strong>${sellSuggestions.length}</strong> SELL signal(s) detected. `;
                }
                msg += 'Follow the threshold system for best results.';
                thresholdText.innerHTML = msg;
            }
        }

        // সময় আপডেট
        if (updateTime) updateTime.textContent = new Date().toLocaleString();

        loader.style.display = 'none';
        content.style.display = 'block';

    } catch (error) {
        console.error('Daily Suggestion error:', error);
        loader.innerHTML = `❌ Error: ${error.message}`;
    }
}

// ==========================================
// 📋 সাজেশন লিস্ট রেন্ডার (data-ticker যোগ করা হয়েছে)
// ==========================================

export function renderDailySuggestionList(containerId, data, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:20px; opacity:0.5; font-size:13px;">No ${type} suggestions</div>`;
        return;
    }

    const isBuy = type === 'buy';
    const bgColor = isBuy ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)';
    const borderColor = isBuy ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    const signalColor = isBuy ? '#10b981' : '#ef4444';
    const signalText = isBuy ? '🟢 BUY' : '🔴 SELL';

    let html = '';
    for (const item of data) {
        const plColor = item.plPct >= 0 ? '#10b981' : '#ef4444';
        const reasonsText = item.reasons?.join(', ') || 'No specific reason';
        html += `
            <div class="ds-suggestion-item" data-ticker="${item.ticker}" 
                 onclick="if(typeof window.openStockDetailModal === 'function') window.openStockDetailModal('${item.ticker}')" style="
                background: ${bgColor};
                border: 1px solid ${borderColor};
                border-radius: 8px;
                padding: 10px 14px;
                margin-bottom: 6px;
                cursor: pointer;
                transition: all 0.2s;
            " onmouseover="this.style.transform='scale(1.01)'" onmouseout="this.style.transform='scale(1)'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-weight: 700; color: var(--primary-color); text-decoration: underline;">${item.ticker}</span>
                        <span style="font-size: 11px; opacity: 0.6; margin-left: 8px;">Avg: ৳${item.avgBuy.toFixed(2)}</span>
                        <span style="font-size: 11px; opacity: 0.6; margin-left: 8px;">LTP: ৳${item.currentPrice.toFixed(2)}</span>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: 700; font-size: 14px; color: ${signalColor};">${signalText}</div>
                        <div style="font-size: 11px; color: ${plColor};">${item.plPct >= 0 ? '+' : ''}${item.plPct.toFixed(2)}%</div>
                    </div>
                </div>
                <div style="font-size: 11px; opacity: 0.7; margin-top: 4px; border-top: 1px solid ${borderColor}; padding-top: 4px;">
                    💡 ${reasonsText}
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// ==========================================
// 🔄 ডেইলি সাজেশন রিফ্রেশ
// ==========================================

export async function refreshDailySuggestion() {
    try {
        showToast('🔄 Refreshing daily suggestion...', 'info');
        if (typeof loadDailySuggestion === 'function') {
            await loadDailySuggestion();
            showToast('✅ Daily suggestion refreshed!', 'success');
        } else {
            console.warn('⚠️ loadDailySuggestion function not found');
            showToast('⚠️ Suggestion module not loaded', 'warning');
        }
    } catch (error) {
        console.error('❌ Refresh Daily Suggestion error:', error);
        showToast('❌ Failed to refresh: ' + error.message, 'error');
    }
}

// ==========================================
// 📅 ডেইলি সামারি শিডিউলার (টপ ৩ বাই/সেল সহ)
// ==========================================

export function scheduleDailySummary() {
    const now = new Date();
    const target = new Date();
    target.setHours(9, 0, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);
    const delay = target - now;

    setTimeout(async () => {
        const user = auth?.currentUser;
        if (user && typeof window.notificationManager !== 'undefined' && window.notificationManager) {
            try {
                // ১. ডেইলি সাজেশন রিফ্রেশ করুন (BUY/SELL লিস্ট আপডেট)
                if (typeof loadDailySuggestion === 'function') {
                    await loadDailySuggestion();
                }

                // ২. টপ ৩ বাই ও সেল টিকার বের করুন
                const buyItems = document.querySelectorAll('#ds-buy-list .ds-suggestion-item');
                const sellItems = document.querySelectorAll('#ds-sell-list .ds-suggestion-item');
                
                let topBuyText = 'None';
                if (buyItems.length > 0) {
                    const topBuys = Array.from(buyItems).slice(0, 3).map(el => el.dataset.ticker).join(', ');
                    topBuyText = topBuys || 'None';
                }
                
                let topSellText = 'None';
                if (sellItems.length > 0) {
                    const topSells = Array.from(sellItems).slice(0, 3).map(el => el.dataset.ticker).join(', ');
                    topSellText = topSells || 'None';
                }

                // ৩. কাউন্ট বের করুন
                const buyCount = document.getElementById('ds-buy-count')?.innerText || '0';
                const sellCount = document.getElementById('ds-sell-count')?.innerText || '0';

                // ৪. টোটাল ভ্যালু বের করুন (ঐচ্ছিক)
                const unifiedData = await unifiedEngine.calculate(user.uid, null, true);
                let totalValue = 0, totalCost = 0;
                if (unifiedData && unifiedData.stockDetails.length > 0) {
                    const tickers = unifiedData.stockDetails.map(s => s.ticker);
                    const priceMap = await getLatestAndPreviousPrices(tickers);
                    for (let i = 0; i < unifiedData.stockDetails.length; i++) {
                        const stock = unifiedData.stockDetails[i];
                        const priceData = priceMap.get(stock.ticker);
                        const currentPrice = priceData?.currentPrice || 0;
                        const qty = stock.totalQty || 0;
                        totalValue += qty * currentPrice;
                        totalCost += stock.totalCost || 0;
                    }
                }
                const pl = totalValue - totalCost;
                const pct = totalCost > 0 ? (pl / totalCost) * 100 : 0;

                // ৫. নোটিফিকেশন পাঠান
                const notificationManager = window.notificationManager;
                notificationManager.showNotification(
                    '📊 Good Morning! Daily Suggestion',
                    `💰 Value: ৳${totalValue.toFixed(2)} | P&L: ${pl >= 0 ? '+' : ''}${pl.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)\n📈 Buy (${buyCount}): ${topBuyText}\n📉 Sell (${sellCount}): ${topSellText}`
                );

            } catch (e) {
                console.warn('Daily suggestion notification error:', e);
            }
        }
        // পরের দিনের জন্য আবার শিডিউল করুন
        scheduleDailySummary();
    }, delay);
}

// ==========================================
// 🔔 অ্যালার্ট লিস্ট লোড (ধাপ ৩ এর সাথে সম্পর্কিত)
// ==========================================

export function loadActiveAlerts() {
    const tbody = document.getElementById('alert-list-body');
    if (!tbody) return;

    if (typeof window.notificationManager === 'undefined' || !window.notificationManager) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; opacity:0.6;">Notification manager not loaded.</td></tr>`;
        return;
    }

    const alerts = window.notificationManager.getAlerts();
    const keys = Object.keys(alerts);

    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; opacity:0.6;">No alerts set.</td></tr>`;
        return;
    }

    let html = '';
    for (const ticker of keys) {
        const alert = alerts[ticker];
        const status = alert.triggered ? '🔔 Triggered' : '⏳ Active';
        const statusColor = alert.triggered ? '#f59e0b' : '#10b981';
        const directionMap = { 'up': '↑ Above', 'down': '↓ Below', 'any': '↕ Any' };

        html += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 6px 8px; font-weight: 600; color: var(--primary-color);">${ticker}</td>
                <td style="padding: 6px 8px; text-align: right;">৳${alert.target.toFixed(2)}</td>
                <td style="padding: 6px 8px; text-align: center;">${directionMap[alert.direction] || 'Any'}</td>
                <td style="padding: 6px 8px; text-align: center; color: ${statusColor};">${status}</td>
                <td style="padding: 6px 8px; text-align: center;">
                    <button onclick="window.removeAlert('${ticker}')" style="
                        background: #ef4444;
                        color: white;
                        border: none;
                        padding: 2px 10px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    ">✖</button>
                </td>
            </tr>
        `;
    }
    tbody.innerHTML = html;
}

// ==========================================
// 🗑️ অ্যালার্ট রিমুভ
// ==========================================

export function removeAlert(ticker) {
    if (!ticker) return;
    if (typeof window.notificationManager !== 'undefined' && window.notificationManager) {
        window.notificationManager.removeAlert(ticker);
        loadActiveAlerts();
        showToast(`🗑️ Alert removed for ${ticker}`, 'info');
    }
}

// ==========================================
// 📌 টাইমস্ট্যাম্প ও লোডিং (হেলপার)
// ==========================================

function updateTimestamp() {
    const timestampElem = document.getElementById('update-timestamp');
    if (!timestampElem) return;
    const mode = window.currentDataMode || 'firebase';
    timestampElem.innerHTML = `🔄 Last updated: ${formatDisplayTime(new Date())} (${mode})`;
}

function showDataLoading(isLoading) {
    // কোনো UI ব্লক করবেন না
    return;
}

// ==========================================
// 📌 ডিফল্ট এক্সপোর্ট (সমস্ত ফাংশন গ্লোবালি এক্সপোজ)
// ==========================================

export default {
    loadDashboardData,
    updateDashboardCards,
    updateDashboardCardsFromAnalysis,
    updateTotalIncomeCard,
    openDepositModal,
    closeDepositModal,
    saveDeposit,
    getDailyIncomeData,
    loadIncomeChartAndTable,
    applyIncomeFilter,
    resetIncomeFilter,
    loadDailySuggestion,
    refreshDailySuggestion,
    renderDailySuggestionList,
    scheduleDailySummary,
    loadActiveAlerts,
    removeAlert
};

console.log('✅ dash-cards.js (full error-free version) loaded successfully');