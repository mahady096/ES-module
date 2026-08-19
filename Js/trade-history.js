// ==========================================
// 📜 trade-history.js - Buy & Sell History
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, safeParseDate, debounce, getBangladeshDateString } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';

// ==========================================
// Buy History
// ==========================================

export async function loadBuyHistory(ticker, portfolioId = null) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }

    const tbody = document.getElementById('buy-history-body');
    const footer = document.getElementById('buy-history-footer');
    if (!tbody) return;

    const avgEl = document.getElementById('buy-history-avg-price');
    const totalQtyEl = document.getElementById('buy-history-total-qty');
    const totalCostEl = document.getElementById('buy-history-total-cost');

    if (!ticker || ticker.trim() === '') {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">Search a share to see buy history.</td></tr>`;
        if (footer) footer.style.display = 'none';
        if (avgEl) avgEl.innerHTML = '📊 Avg Buy: -';
        if (totalQtyEl) totalQtyEl.innerHTML = '📦 Total Qty: -';
        if (totalCostEl) totalCostEl.innerHTML = '💰 Total Cost: -';
        return;
    }

    ticker = ticker.trim().toUpperCase();
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">Loading...</td></tr>`;
    if (footer) footer.style.display = 'table-footer-group';

    try {
        let buyData = [];
        
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                let query = supabase
                    .from('portfolios')
                    .select('*')
                    .eq('user_id', user.uid)
                    .eq('share_name', ticker)
                    .order('date', { ascending: false });
                if (portfolioId && portfolioId !== 'grand') query = query.eq('portfolio_id', portfolioId);
                const { data } = await query;
                if (data) buyData = data;
            } catch (e) {
                console.warn('Supabase buy history fetch failed', e);
            }
        }

        if (buyData.length === 0 && typeof db !== 'undefined') {
            try {
                let query = db.collection('portfolios')
                    .where('userId', '==', user.uid)
                    .where('shareName', '==', ticker)
                    .orderBy('date', 'desc');
                if (portfolioId && portfolioId !== 'grand') query = query.where('portfolioId', '==', portfolioId);
                const buySnapshot = await query.get();
                buySnapshot.forEach(doc => {
                    const data = doc.data();
                    const parsedDate = safeParseDate(data.date);
                    const parsedCreatedAt = safeParseDate(data.createdAt);
                    buyData.push({
                        id: doc.id,
                        share_name: data.shareName,
                        quantity: data.quantity,
                        buy_price: data.buyPrice,
                        date: parsedDate ? parsedDate.toISOString() : null,
                        created_at: parsedCreatedAt ? parsedCreatedAt.toISOString() : null
                    });
                });
            } catch (e) {
                console.warn('Firebase buy history fetch failed', e);
            }
        }

        if (buyData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">No buy history found for ${ticker}.</td></tr>`;
            if (footer) footer.style.display = 'none';
            if (avgEl) avgEl.innerHTML = '📊 Avg Buy: -';
            if (totalQtyEl) totalQtyEl.innerHTML = '📦 Total Qty: -';
            if (totalCostEl) totalCostEl.innerHTML = '💰 Total Cost: -';
            return;
        }

        let html = '';
        let totalQty = 0;
        let totalCost = 0;

        buyData.forEach(item => {
            const date = safeParseDate(item.date) || new Date();
            const dateStr = date.toLocaleDateString('bn-BD');
            const qty = item.quantity || 0;
            const price = item.buy_price || 0;
            const total = qty * price;

            totalQty += qty;
            totalCost += total;

            html += `<tr>
                <td style="padding: 8px;">${dateStr}</td>
                <td style="padding: 8px; font-weight: bold;">${item.share_name}</td>
                <td style="padding: 8px;">${qty}</td>
                <td style="padding: 8px;">৳${price.toFixed(2)}</td>
                <td style="padding: 8px;">৳${total.toFixed(2)}</td>
                <td style="padding: 8px;">
                    <button onclick="window.editBuyRecord('${item.id}')" style="background:#0284c7; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-right:4px;">✏️</button>
                    <button onclick="window.deleteBuyRecord('${item.id}')" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;

        const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
        if (avgEl) avgEl.innerHTML = `📊 Avg Buy: ৳${avgPrice.toFixed(2)}`;
        if (totalQtyEl) totalQtyEl.innerHTML = `📦 Total Qty: ${totalQty}`;
        if (totalCostEl) totalCostEl.innerHTML = `💰 Total Cost: ৳${totalCost.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;

        if (footer) footer.style.display = 'table-footer-group';
    } catch (error) {
        console.error('Buy history error:', error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: red;">Error loading data.</td></tr>`;
        if (footer) footer.style.display = 'none';
    }
}

export async function editBuyRecord(docId) {
    const newQty = prompt("Enter new quantity:");
    const newPrice = prompt("Enter new price:");
    if (newQty && newPrice) {
        try {
            if (typeof supabase !== 'undefined' && supabase) {
                await supabase
                    .from('portfolios')
                    .update({ quantity: parseInt(newQty), buy_price: parseFloat(newPrice) })
                    .eq('id', docId);
            }
            if (typeof db !== 'undefined') {
                await db.collection('portfolios').doc(docId).update({
                    quantity: parseInt(newQty),
                    buyPrice: parseFloat(newPrice)
                });
            }
            showToast('✅ Updated successfully!', 'success');
            const searchInput = document.getElementById('buy-history-search');
            if (searchInput) loadBuyHistory(searchInput.value);
            if (typeof resetUnifiedCache === 'function') resetUnifiedCache();
        } catch (err) {
            showToast('❌ Update failed: ' + err.message, 'error');
        }
    }
}

export async function deleteBuyRecord(docId) {
    if (!confirm('Are you sure you want to delete this buy record?')) return;
    try {
        if (typeof supabase !== 'undefined' && supabase) {
            await supabase.from('portfolios').delete().eq('id', docId);
        }
        if (typeof db !== 'undefined') {
            await db.collection('portfolios').doc(docId).delete();
        }
        showToast('✅ Deleted successfully!', 'success');
        const searchInput = document.getElementById('buy-history-search');
        if (searchInput) loadBuyHistory(searchInput.value);
        if (typeof resetUnifiedCache === 'function') resetUnifiedCache();
    } catch (err) {
        showToast('❌ Delete failed: ' + err.message, 'error');
    }
}

export function initBuyHistorySearch() {
    const searchInput = document.getElementById('buy-history-search');
    const suggestionBox = document.getElementById('buy-history-suggestion-box');
    if (!searchInput || !suggestionBox) return;

    const debouncedBuyHist = debounce(function(query) {
        suggestionBox.innerHTML = '';
        suggestionBox.classList.add('hidden');
        if (!query) {
            loadBuyHistory('');
            return;
        }
        const filtered = dseStocks.filter(stock => stock.startsWith(query));
        if (filtered.length > 0) {
            suggestionBox.classList.remove('hidden');
            const limited = filtered.slice(0, 15);
            limited.forEach(stock => {
                const div = document.createElement('div');
                div.classList.add('suggestion-item');
                div.innerText = stock;
                div.addEventListener('click', function() {
                    searchInput.value = stock;
                    suggestionBox.classList.add('hidden');
                    const portfolioId = document.getElementById('buy-history-portfolio-select')?.value || null;
                    loadBuyHistory(stock, portfolioId);
                });
                suggestionBox.appendChild(div);
            });
        } else {
            suggestionBox.classList.add('hidden');
            loadBuyHistory('');
        }
    }, 300);

    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toUpperCase();
        debouncedBuyHist(query);
    });

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const ticker = this.value.trim().toUpperCase();
            suggestionBox.classList.add('hidden');
            if (ticker && dseStocks.includes(ticker)) {
                const portfolioId = document.getElementById('buy-history-portfolio-select')?.value || null;
                loadBuyHistory(ticker, portfolioId);
            } else {
                loadBuyHistory('');
            }
        }
    });
}

// ==========================================
// Sell History
// ==========================================

export async function loadSellHistory(ticker, portfolioId = null) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }

    const tbody = document.getElementById('sell-history-body');
    const footer = document.getElementById('sell-history-footer');
    if (!tbody) return;

    const avgEl = document.getElementById('sell-history-avg-price');
    const highEl = document.getElementById('sell-history-high-price');
    const lowEl = document.getElementById('sell-history-low-price');

    if (!ticker || ticker.trim() === '') {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">Search a share to see sell history.</td></tr>`;
        if (footer) footer.style.display = 'none';
        if (avgEl) avgEl.innerHTML = '📊 Avg: -';
        if (highEl) highEl.innerHTML = '📈 High: -';
        if (lowEl) lowEl.innerHTML = '📉 Low: -';
        return;
    }

    ticker = ticker.trim().toUpperCase();
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">Loading...</td></tr>`;
    if (footer) footer.style.display = 'table-footer-group';

    try {
        let sellData = [];
        
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                let sQuery = supabase.from('sales_history')
                    .select('*')
                    .eq('user_id', user.uid)
                    .eq('share_name', ticker)
                    .order('date', { ascending: false });
                if (portfolioId && portfolioId !== 'grand') sQuery = sQuery.eq('portfolio_id', portfolioId);
                const { data } = await sQuery;
                if (data) sellData = data;
            } catch (e) {
                console.warn('Supabase sell history fetch failed', e);
            }
        }

        if (sellData.length === 0 && typeof db !== 'undefined') {
            try {
                let sQuery = db.collection('sales_history')
                    .where('userId', '==', user.uid)
                    .where('shareName', '==', ticker)
                    .orderBy('date', 'desc');
                if (portfolioId && portfolioId !== 'grand') sQuery = sQuery.where('portfolioId', '==', portfolioId);
                const sellSnapshot = await sQuery.get();
                sellSnapshot.forEach(doc => {
                    const data = doc.data();
                    const parsedDate = safeParseDate(data.date);
                    const parsedCreatedAt = safeParseDate(data.createdAt);
                    sellData.push({
                        id: doc.id,
                        share_name: data.shareName,
                        quantity_sold: data.quantitySold || 0,
                        sell_price: data.sellPrice || 0,
                        buy_price: data.buyPrice || 0,
                        profit_or_loss: data.profitOrLoss || 0,
                        date: parsedDate ? parsedDate.toISOString() : null,
                        created_at: parsedCreatedAt ? parsedCreatedAt.toISOString() : null
                    });
                });
            } catch (e) {
                console.warn('Firebase sell history fetch failed', e);
            }
        }

        if (sellData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">No sell history found for ${ticker}.</td></tr>`;
            if (footer) footer.style.display = 'none';
            if (avgEl) avgEl.innerHTML = '📊 Avg: -';
            if (highEl) highEl.innerHTML = '📈 High: -';
            if (lowEl) lowEl.innerHTML = '📉 Low: -';
            return;
        }

        let html = '';
        let totalSellValue = 0;
        let totalSellQty = 0;
        let maxPrice = 0;
        let minPrice = Infinity;

        sellData.forEach(item => {
            const date = safeParseDate(item.date) || new Date();
            const dateStr = date.toLocaleDateString('bn-BD');
            const sellQty = item.quantity_sold || 0;
            const sellPrice = item.sell_price || 0;
            const buyPrice = item.buy_price || 0;
            const totalValue = sellQty * sellPrice;
            const profit = item.profit_or_loss || (sellPrice - buyPrice) * sellQty;
            const profitClass = profit >= 0 ? 'up' : 'error';

            if (sellPrice > 0) {
                if (sellPrice > maxPrice) maxPrice = sellPrice;
                if (sellPrice < minPrice) minPrice = sellPrice;
            }

            totalSellValue += totalValue;
            totalSellQty += sellQty;

            html += `<tr>
                <td style="padding: 8px;">${dateStr}</td>
                <td style="padding: 8px; font-weight: bold;">${item.share_name}</td>
                <td style="padding: 8px;">${sellQty}</td>
                <td style="padding: 8px;">৳${sellPrice.toFixed(2)}</td>
                <td style="padding: 8px;">৳${buyPrice.toFixed(2)}</td>
                <td style="padding: 8px;">৳${totalValue.toFixed(2)}</td>
                <td style="padding: 8px;" class="${profitClass}">${profit >= 0 ? '+' : ''}৳${profit.toFixed(2)}</td>
            </tr>`;
        });

        tbody.innerHTML = html;

        const avgPrice = totalSellQty > 0 ? totalSellValue / totalSellQty : 0;
        if (avgEl) avgEl.innerHTML = `📊 Avg: ৳${avgPrice.toFixed(2)} (Qty: ${totalSellQty})`;
        if (highEl) highEl.innerHTML = `📈 High: ৳${maxPrice > 0 ? maxPrice.toFixed(2) : '-'}`;
        if (lowEl) lowEl.innerHTML = `📉 Low: ৳${minPrice !== Infinity ? minPrice.toFixed(2) : '-'}`;

        if (footer) footer.style.display = 'table-footer-group';
    } catch (error) {
        console.error('Sell history error:', error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: red;">Error loading data.</td></tr>`;
        if (footer) footer.style.display = 'none';
    }
}

export function initSellHistorySearch() {
    const searchInput = document.getElementById('sell-history-search');
    const suggestionBox = document.getElementById('sell-history-suggestion-box');
    if (!searchInput || !suggestionBox) return;

    const debouncedSellHist = debounce(function(query) {
        suggestionBox.innerHTML = '';
        suggestionBox.classList.add('hidden');
        if (!query) {
            loadSellHistory('');
            return;
        }
        const filtered = dseStocks.filter(stock => stock.startsWith(query));
        if (filtered.length > 0) {
            suggestionBox.classList.remove('hidden');
            const limited = filtered.slice(0, 15);
            limited.forEach(stock => {
                const div = document.createElement('div');
                div.classList.add('suggestion-item');
                div.innerText = stock;
                div.addEventListener('click', function() {
                    searchInput.value = stock;
                    suggestionBox.classList.add('hidden');
                    const portfolioId = document.getElementById('sell-portfolio-select')?.value || 'main';
                    loadSellHistory(stock, portfolioId);
                });
                suggestionBox.appendChild(div);
            });
        } else {
            suggestionBox.classList.add('hidden');
            loadSellHistory('');
        }
    }, 300);

    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toUpperCase();
        debouncedSellHist(query);
    });

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const ticker = this.value.trim().toUpperCase();
            suggestionBox.classList.add('hidden');
            if (ticker && dseStocks.includes(ticker)) {
                const portfolioId = document.getElementById('sell-portfolio-select')?.value || 'main';
                loadSellHistory(ticker, portfolioId);
            } else {
                loadSellHistory('');
            }
        }
    });
}

// ==========================================
// Trade History (Combined)
// ==========================================

export let allTransactions = [];

export async function loadTradeHistory() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;
    const tbody = document.getElementById('trade-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">Loading transactions...</td></tr>';

    try {
        if (typeof db === 'undefined') {
            tbody.innerHTML = '<tr><td colspan="6">Firebase not available</td></tr>';
            return;
        }
        const buySnapshot = await db.collection('portfolios')
            .where('userId', '==', user.uid)
            .get();
        const sellSnapshot = await db.collection('sales_history')
            .where('userId', '==', user.uid)
            .get();

        const transactions = [];
        buySnapshot.forEach(doc => {
            const data = doc.data();
            let dateObj = data.date ? (data.date.toDate ? data.date.toDate() : new Date(data.date)) : new Date();
            transactions.push({
                id: doc.id,
                date: dateObj,
                shareName: data.shareName,
                quantity: data.quantity,
                price: data.buyPrice,
                type: 'BUY',
                commission: data.commission || 0
            });
        });
        sellSnapshot.forEach(doc => {
            const data = doc.data();
            let dateObj = data.date ? (data.date.toDate ? data.date.toDate() : new Date(data.date)) : new Date();
            transactions.push({
                id: doc.id,
                date: dateObj,
                shareName: data.shareName,
                quantity: data.quantitySold,
                price: data.sellPrice,
                type: 'SELL',
                profitOrLoss: data.profitOrLoss
            });
        });
        transactions.sort((a, b) => b.date - a.date);
        allTransactions = transactions;

        const today = new Date();
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(today.getDate() - 3);
        const startInput = document.getElementById('trade-history-start');
        const endInput = document.getElementById('trade-history-end');
        if (startInput) startInput.value = threeDaysAgo.toISOString().split('T')[0];
        if (endInput) endInput.value = today.toISOString().split('T')[0];

        applyTradeFilter();
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6">Error loading transactions.</td></tr>';
    }
}

export function applyTradeFilter() {
    const startInput = document.getElementById('trade-history-start');
    const endInput = document.getElementById('trade-history-end');
    const startDate = startInput?.value ? new Date(startInput.value) : null;
    const endDate = endInput?.value ? new Date(endInput.value) : null;
    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);
    const filtered = allTransactions.filter(tx => {
        if (startDate && tx.date < startDate) return false;
        if (endDate && tx.date > endDate) return false;
        return true;
    });
    renderTradeTable(filtered);
}

export function resetTradeFilter() {
    const startInput = document.getElementById('trade-history-start');
    const endInput = document.getElementById('trade-history-end');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    applyTradeFilter();
}

function renderTradeTable(transactions) {
    const tbody = document.getElementById('trade-history-tbody');
    if (!tbody) return;
    if (!transactions.length) {
        tbody.innerHTML = '<tr><td colspan="6">No transactions in this period.</td></tr>';
        return;
    }
    let html = '';
    for (const tx of transactions) {
        const dateStr = tx.date.toLocaleDateString('bn-BD');
        const typeClass = tx.type === 'BUY' ? 'up' : 'error';
        html += `<tr>
            <td style="padding: 8px;">${dateStr}</td>
            <td style="padding: 8px;">${tx.shareName}</td>
            <td style="padding: 8px;">${tx.quantity}</td>
            <td style="padding: 8px;">৳${tx.price.toFixed(2)}</td>
            <td style="padding: 8px;" class="${typeClass}">${tx.type}</td>
            <td style="padding: 8px;">
                <button onclick="window.editTrade('${tx.id}', '${tx.type}')" style="background:#0284c7; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-right:4px;">✏️</button>
                <button onclick="window.deleteTrade('${tx.id}', '${tx.type}')" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
            </td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

export function editTrade(id, type) {
    if (type === 'BUY') {
        const newQty = prompt("Enter new quantity:");
        const newPrice = prompt("Enter new price:");
        if (newQty && newPrice) {
            if (typeof db !== 'undefined') {
                db.collection('portfolios').doc(id).update({
                    quantity: parseInt(newQty),
                    buyPrice: parseFloat(newPrice)
                }).then(() => {
                    showToast('✅ Updated successfully!', 'success');
                    loadTradeHistory();
                }).catch(err => {
                    showToast('❌ Update failed: ' + err.message, 'error');
                });
            }
        }
    } else {
        const newQty = prompt("Enter new quantity sold:");
        const newPrice = prompt("Enter new sell price:");
        if (newQty && newPrice) {
            if (typeof db !== 'undefined') {
                const docRef = db.collection('sales_history').doc(id);
                docRef.get().then(doc => {
                    const buyPrice = doc.data().buyPrice;
                    docRef.update({
                        quantitySold: parseInt(newQty),
                        sellPrice: parseFloat(newPrice),
                        profitOrLoss: (parseFloat(newPrice) - buyPrice) * parseInt(newQty)
                    }).then(() => {
                        showToast('✅ Updated successfully!', 'success');
                        loadTradeHistory();
                    });
                });
            }
        }
    }
}

export function deleteTrade(id, type) {
    if (!confirm("Are you sure you want to delete this transaction?")) return;
    const collection = type === 'BUY' ? 'portfolios' : 'sales_history';
    if (typeof db !== 'undefined') {
        db.collection(collection).doc(id).delete().then(() => {
            showToast('🗑️ Deleted successfully!', 'info');
            loadTradeHistory();
        }).catch(err => {
            showToast('❌ Delete failed: ' + err.message, 'error');
        });
    }
}

// ==========================================
// Init
// ==========================================

export function initBuyTabs() {
    const tabsContainer = document.querySelector('.buy-tabs');
    const buyPanel = document.getElementById('buy-tab-content');
    const historyPanel = document.getElementById('buy-history-tab-content');

    if (!tabsContainer || !buyPanel || !historyPanel) {
        console.warn('Buy tabs elements not found');
        return;
    }

    tabsContainer.addEventListener('click', function(e) {
        const tabBtn = e.target.closest('.buy-tab-btn');
        if (!tabBtn) return;
        const target = tabBtn.getAttribute('data-tab');
        if (!target) return;

        const allTabs = tabsContainer.querySelectorAll('.buy-tab-btn');
        allTabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'transparent';
            t.style.color = 'var(--text-primary)';
            t.style.border = '1px solid var(--border-color)';
            t.style.borderBottom = 'none';
        });

        tabBtn.classList.add('active');
        tabBtn.style.background = 'var(--primary-color)';
        tabBtn.style.color = 'white';
        tabBtn.style.border = 'none';

        buyPanel.style.display = 'none';
        historyPanel.style.display = 'none';

        if (target === 'buy') {
            buyPanel.style.display = 'block';
        } else if (target === 'history') {
            historyPanel.style.display = 'block';
            const searchInput = document.getElementById('buy-history-search');
            if (searchInput) {
                searchInput.value = '';
                loadBuyHistory('');
            }
        }
    });
}

export function initSellTabs() {
    const tabs = document.querySelectorAll('.sell-tab-btn');
    const panels = {
        sell: document.getElementById('sell-tab-content'),
        history: document.getElementById('sell-history-tab-content')
    };
    if (!tabs.length || !panels.sell || !panels.history) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const target = this.getAttribute('data-tab');
            tabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'transparent';
                t.style.color = 'var(--text-primary)';
                t.style.border = '1px solid var(--border-color)';
                t.style.borderBottom = 'none';
            });
            this.classList.add('active');
            this.style.background = 'var(--primary-color)';
            this.style.color = 'white';
            this.style.border = 'none';

            Object.values(panels).forEach(p => {
                if (p) p.style.display = 'none';
            });

            if (target === 'sell') {
                if (panels.sell) panels.sell.style.display = 'block';
            } else if (target === 'history') {
                if (panels.history) {
                    panels.history.style.display = 'block';
                }
            }
        });
    });
}

console.log('✅ trade-history.js loaded');