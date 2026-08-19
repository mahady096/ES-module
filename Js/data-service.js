// ==========================================
// 📁 data-service.js - ডেটা ফেচিং সেন্ট্রাল লেয়ার
// ==========================================

import { supabase } from './supabase.js';
import { db } from './firebase.js';
import { chunkArray, safeParseDate } from './core.js';

class DataService {
    constructor() {
        this.cache = new Map();
        this.cacheTTL = 300000; // 5 মিনিট
        this.pendingRequests = new Map();
    }

    async getPortfolio(userId) {
        if (!userId) return null;
        const cacheKey = `portfolio_${userId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey);
        }

        const promise = this._fetchPortfolio(userId);
        this.pendingRequests.set(cacheKey, promise);

        try {
            const data = await promise;
            this.setCache(cacheKey, data);
            return data;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    async _fetchPortfolio(userId) {
        let portfolioData = [];

        // Supabase
        if (typeof supabase !== 'undefined') {
            try {
                const { data, error } = await supabase
                    .from('portfolios')
                    .select('*')
                    .eq('user_id', userId);
                if (!error && data) {
                    return data.map(item => ({
                        id: item.id,
                        userId: item.user_id,
                        shareName: item.share_name,
                        quantity: item.quantity,
                        buyPrice: item.buy_price,
                        commission: item.commission || 0,
                        commissionPercent: item.commission_percent || 0,
                        date: item.date,
                        createdAt: item.created_at,
                        portfolioId: item.portfolio_id || 'main'
                    }));
                }
            } catch (e) {
                console.warn('Supabase portfolio fetch failed', e);
            }
        }

        // Firebase fallback
        try {
            const snap = await db.collection('portfolios')
                .where('userId', '==', userId)
                .get();
            snap.forEach(doc => {
                const data = doc.data();
                portfolioData.push({
                    id: doc.id,
                    userId: data.userId,
                    shareName: data.shareName,
                    quantity: data.quantity,
                    buyPrice: data.buyPrice,
                    commission: data.commission || 0,
                    commissionPercent: data.commissionPercent || 0,
                    date: data.date ? safeParseDate(data.date)?.toISOString()?.split('T')[0] : null,
                    createdAt: data.createdAt ? safeParseDate(data.createdAt)?.toISOString() : null,
                    portfolioId: data.portfolioId || 'main'
                });
            });
        } catch (e) {
            console.error('Firebase portfolio fetch failed', e);
        }

        return portfolioData;
    }

    async getSalesHistory(userId) {
        const cacheKey = `sales_${userId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey);
        }

        const promise = this._fetchSalesHistory(userId);
        this.pendingRequests.set(cacheKey, promise);

        try {
            const data = await promise;
            this.setCache(cacheKey, data);
            return data;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    async _fetchSalesHistory(userId) {
        let salesData = [];

        if (typeof supabase !== 'undefined') {
            try {
                const { data, error } = await supabase
                    .from('sales_history')
                    .select('*')
                    .eq('user_id', userId);
                if (!error && data) {
                    return data.map(item => ({
                        id: item.id,
                        userId: item.user_id,
                        shareName: item.share_name,
                        quantitySold: item.quantity_sold,
                        buyPrice: item.buy_price,
                        sellPrice: item.sell_price,
                        profitOrLoss: item.profit_or_loss,
                        commission: item.commission || 0,
                        commissionPercent: item.commission_percent || 0,
                        netReceived: item.net_received || 0,
                        date: item.date,
                        createdAt: item.created_at,
                        portfolioId: item.portfolio_id || 'main'
                    }));
                }
            } catch (e) {}
        }

        try {
            const snap = await db.collection('sales_history')
                .where('userId', '==', userId)
                .get();
            snap.forEach(doc => {
                const data = doc.data();
                salesData.push({
                    id: doc.id,
                    userId: data.userId,
                    shareName: data.shareName,
                    quantitySold: data.quantitySold || 0,
                    buyPrice: data.buyPrice || 0,
                    sellPrice: data.sellPrice || 0,
                    profitOrLoss: data.profitOrLoss || 0,
                    commission: data.commission || 0,
                    commissionPercent: data.commissionPercent || 0,
                    netReceived: data.netReceived || 0,
                    date: data.date ? safeParseDate(data.date)?.toISOString()?.split('T')[0] : null,
                    createdAt: data.createdAt ? safeParseDate(data.createdAt)?.toISOString() : null,
                    portfolioId: data.portfolioId || 'main'
                });
            });
        } catch (e) {}

        return salesData;
    }

    // ==========================================
    // 🕐 LAST UPDATE TIME (NEW METHOD)
    // ==========================================
     // data-service.js - getLastUpdateTime() method
async getLastUpdateTime() {
    try {
        // Supabase থেকে (UTC)
        if (typeof supabase !== 'undefined' && supabase) {
            const { data, error } = await supabase
                .from('dsex_index')
                .select('updated_at')
                .order('updated_at', { ascending: false })
                .limit(1);
            if (!error && data && data.length > 0) {
                const updatedAt = new Date(data[0].updated_at);
                if (!isNaN(updatedAt.getTime())) {
                    return updatedAt;  // ← অফসেট যোগ করবেন না
                }
            }
        }

        // Firebase ফ্যালব্যাক (UTC)
        if (typeof db !== 'undefined' && db) {
            const snap = await db.collection('daily_prices')
                .orderBy('date', 'desc')
                .limit(1)
                .get();
            if (!snap.empty) {
                const data = snap.docs[0].data();
                if (data.date) {
                    let dateObj;
                    if (typeof data.date === 'string') {
                        dateObj = new Date(data.date);
                    } else if (data.date.toDate) {
                        dateObj = data.date.toDate();
                    } else {
                        dateObj = new Date(data.date);
                    }
                    if (!isNaN(dateObj.getTime())) {
                        return dateObj;  // ← অফসেট যোগ করবেন না
                    }
                }
            }
        }

        return new Date(); // fallback – current UTC time
    } catch (error) {
        console.error('Error getting last update time:', error);
        return new Date();
    }
}
    // ==========================================
    // 🗄️ ক্যাশ ম্যানেজমেন্ট
    // ==========================================
    getFromCache(key) {
        if (this.cache.has(key)) {
            const entry = this.cache.get(key);
            if (Date.now() - entry.timestamp < this.cacheTTL) {
                return entry.data;
            }
            this.cache.delete(key);
        }
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.cache.clear();
        this.pendingRequests.clear();
        console.log('🗑️ DataService cache cleared');
    }

    getUniqueTickers(portfolioData) {
        const tickers = new Set();
        portfolioData.forEach(item => {
            if (item.shareName) tickers.add(item.shareName);
        });
        return Array.from(tickers);
    }
}

// ==========================================
// 📌 এক্সপোর্ট ও গ্লোবাল ইনস্ট্যান্স
// ==========================================

export const dataService = new DataService();

// 🔥 গ্লোবালি এক্সপোজ (যাতে dash-performance.js পায়)
if (typeof window !== 'undefined') {
    window.dataService = dataService;
}

export default dataService;

console.log('✅ data-service.js loaded');