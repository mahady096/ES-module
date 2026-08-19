// ==========================================
// 📁 app-dashboard.js - ড্যাশবোর্ড কোর (শুধু ইউনিফাইড ইঞ্জিন)
//    ড্যাশবোর্ড কার্ড, চার্ট, সিগন্যাল ইত্যাদি এখন আলাদা ফাইলে
//    (dash-cards.js, dash-charts.js, dash-signals.js)
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { getLatestAndPreviousPrices } from './core.js';

// ==========================================
// 📌 UNIFIED ENGINE (পোর্টফোলিও ক্যালকুলেশন)
// ==========================================

class UnifiedCalculationEngine {
    constructor() {
        this.cachedResult = null;
        this.cacheTime = 0;
        this.cacheTTL = 300000; // 5 মিনিট
    }

    async calculate(userId, portfolioId = null, forceRefresh = false) {
        if (!userId) return null;
        const now = Date.now();
        const cacheKey = `calc_${userId}_${portfolioId || 'all'}`;
        
        // ক্যাশ চেক
        if (!forceRefresh && this.cachedResult && (now - this.cacheTime) < this.cacheTTL) {
            if (this.cachedResult._portfolioId === (portfolioId || 'all')) {
                console.log('📦 Using cached unified calculation');
                return this.cachedResult;
            }
        }
        console.log('🔄 Calculating portfolio...');

        try {
            let portfolioData = [];
            let salesData = [];

            // ১. Supabase থেকে ডেটা
            if (typeof supabase !== 'undefined' && supabase) {
                try {
                    let pQuery = supabase.from('portfolios').select('*').eq('user_id', userId);
                    if (portfolioId) pQuery = pQuery.eq('portfolio_id', portfolioId);
                    const { data: pData, error: pError } = await pQuery;
                    if (!pError && pData) portfolioData = pData;

                    let sQuery = supabase.from('sales_history').select('*').eq('user_id', userId);
                    if (portfolioId) sQuery = sQuery.eq('portfolio_id', portfolioId);
                    const { data: sData, error: sError } = await sQuery;
                    if (!sError && sData) salesData = sData;
                } catch (e) {
                    console.warn('Supabase calc fetch failed', e);
                }
            }

            // ২. Firebase ফ্যালব্যাক
            if (portfolioData.length === 0 && typeof db !== 'undefined' && db) {
                try {
                    let pQuery = db.collection('portfolios').where('userId', '==', userId);
                    if (portfolioId) pQuery = pQuery.where('portfolioId', '==', portfolioId);
                    const snap = await pQuery.get();
                    snap.forEach(doc => {
                        const data = doc.data();
                        portfolioData.push({
                            id: doc.id,
                            user_id: data.userId,
                            share_name: data.shareName,
                            quantity: data.quantity || 0,
                            buy_price: data.buyPrice || 0,
                            commission: data.commission || 0,
                            portfolio_id: data.portfolioId || 'main',
                            date: data.date?.toDate?.()?.toISOString?.().split('T')[0] || new Date().toISOString().split('T')[0]
                        });
                    });
                } catch (e) {
                    console.warn('Firebase calc fetch failed', e);
                }
            }

            if (portfolioData.length === 0) {
                console.log('No portfolio found for user');
                return null;
            }

            // ৩. সেলস ডেটা (Supabase বা Firebase)
            if (salesData.length === 0 && typeof db !== 'undefined' && db) {
                try {
                    let sQuery = db.collection('sales_history').where('userId', '==', userId);
                    if (portfolioId) sQuery = sQuery.where('portfolioId', '==', portfolioId);
                    const snap = await sQuery.get();
                    snap.forEach(doc => {
                        const data = doc.data();
                        salesData.push({
                            share_name: data.shareName,
                            quantity_sold: data.quantitySold || 0,
                            profit_or_loss: data.profitOrLoss || 0,
                            portfolio_id: data.portfolioId || 'main'
                        });
                    });
                } catch (e) {
                    console.warn('Firebase sales fetch failed', e);
                }
            }

            // ৪. গ্রুপ ও ক্যালকুলেশন
            const tickerMap = new Map();
            portfolioData.forEach(item => {
                const ticker = item.share_name;
                if (!tickerMap.has(ticker)) {
                    tickerMap.set(ticker, { 
                        totalQty: 0, 
                        totalCost: 0, 
                        lots: [],
                        totalBuyQty: 0
                    });
                }
                const cur = tickerMap.get(ticker);
                const qty = item.quantity || 0;
                const price = item.buy_price || 0;
                const commission = item.commission || 0;
                const totalCost = (qty * price) + commission;
                cur.totalQty += qty;
                cur.totalCost += totalCost;
                cur.totalBuyQty += qty;
                cur.lots.push({
                    qty: qty,
                    buyPrice: price,
                    totalCost: totalCost,
                    commission: commission,
                    date: item.date || new Date().toISOString().split('T')[0]
                });
            });

            // ৫. সেলস ডেটা গ্রুপ
            const salesMap = new Map();
            salesData.forEach(item => {
                const ticker = item.share_name;
                if (!salesMap.has(ticker)) {
                    salesMap.set(ticker, { sellQty: 0, realizedProfit: 0 });
                }
                const cur = salesMap.get(ticker);
                cur.sellQty += item.quantity_sold || 0;
                cur.realizedProfit += item.profit_or_loss || 0;
            });

            // ৬. স্টক ডিটেইল তৈরি (সেলস বিয়োগ করে)
            const stockDetails = [];
            let grandTotalCost = 0;
            let grandTotalRemainingQty = 0;

            for (const [ticker, data] of tickerMap) {
                const sellData = salesMap.get(ticker) || { sellQty: 0, realizedProfit: 0 };
                // FIFO প্রয়োগ (সবচেয়ে পুরোনো লট থেকে sell বিয়োগ)
                let remainingLots = data.lots.map(lot => ({ ...lot }));
                let totalSold = sellData.sellQty;
                for (let lot of remainingLots) {
                    if (totalSold > 0 && lot.qty > 0) {
                        const taken = Math.min(lot.qty, totalSold);
                        lot.qty -= taken;
                        totalSold -= taken;
                    }
                }
                const remainingQty = remainingLots.reduce((sum, lot) => sum + lot.qty, 0);
                const remainingCost = remainingLots.reduce((sum, lot) => sum + (lot.qty * lot.buyPrice + (lot.qty / (lot.qty + (lot.qty === 0 ? 1 : 0)) * lot.commission)), 0);
                
                const avgBuyPriceWithCommission = remainingQty > 0 ? remainingCost / remainingQty : 0;
                const totalCost = data.totalCost;
                const totalBuyQty = data.totalBuyQty;

                stockDetails.push({
                    ticker: ticker,
                    totalQty: remainingQty,
                    totalCost: remainingCost,
                    avgBuyPriceWithCommission: avgBuyPriceWithCommission,
                    avgBuyPrice: data.totalQty > 0 ? data.totalCost / data.totalQty : 0,
                    lots: remainingLots,
                    totalBuyQty: totalBuyQty,
                    totalSoldQty: sellData.sellQty,
                    realizedProfit: sellData.realizedProfit
                });

                grandTotalCost += remainingCost;
                grandTotalRemainingQty += remainingQty;
            }

            const result = {
                _portfolioId: portfolioId || 'all',
                totalInvestment: grandTotalCost,
                totalRemainingQty: grandTotalRemainingQty,
                stockDetails: stockDetails,
                calculatedAt: now
            };

            this.cachedResult = result;
            this.cacheTime = now;
            return result;

        } catch (error) {
            console.error('Calculation error:', error);
            return null;
        }
    }

    resetCache() {
        this.cachedResult = null;
        this.cacheTime = 0;
        console.log('🔄 Unified calculation cache reset');
    }
}

export const unifiedEngine = new UnifiedCalculationEngine();

// ==========================================
// 📌 ড্যাশবোর্ড কার্ড আপডেট (অ্যানালাইসিস থেকে)
//    (শুধু হেলপার ফাংশন, মূল কার্ড আপডেট dash-cards.js-এ)
// ==========================================

export function updateDashboardCardsFromAnalysis(totalCost, totalValue, dailyGL, totalGL) {
    // এই ফাংশনটি এখন dash-cards.js-এ আছে, কিন্তু আমরা এখানেও রেখেছি
    // যাতে পুরনো কোড ভেঙে না যায়। তবে dash-cards.js-এর ফাংশনই ব্যবহৃত হবে।
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
// 📌 থিম ফাংশন (শুধু রেফারেন্সের জন্য)
//    মূল থিম ফাংশন ui-helpers.js-এ
// ==========================================

export function toggleDarkMode() {
    // ui-helpers.js-এর ফাংশন কল করবে
    if (typeof window.toggleDarkMode === 'function') {
        window.toggleDarkMode();
    } else {
        console.warn('toggleDarkMode not found in window');
    }
}

export function loadSavedTheme() {
    if (typeof window.loadSavedTheme === 'function') {
        window.loadSavedTheme();
    } else {
        console.warn('loadSavedTheme not found in window');
    }
}

console.log('✅ app-dashboard.js (core only) loaded successfully');