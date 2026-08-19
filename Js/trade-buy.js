// ==========================================
// 📥 trade-buy.js - Buy ফাংশনালিটি (ES Module)
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { getHardcodedPrice } from './core.js';
import { 
    dseStocks, getBangladeshDateString, getUTCFromLocalDate, 
    getTodayDate, debounce, getUnifiedPrice, resetUnifiedCache,
    resetUnifiedPriceCache, CommissionManager 
} from './core.js';
import { unifiedEngine } from './app-dashboard.js'; 
import { showToast } from './app-charts.js';
import { loadBuyHistory } from './trade-history.js';

const commissionManager = new CommissionManager();

// ─── হেলপার ফাংশন ─────────────────────────────────────────

export async function fetchLivePriceForBuy(ticker) {
    const priceInput = document.getElementById('trade-price');
    if (!priceInput) return;
    try {
        const cached = await getCachedPrice(ticker);
        if (cached) { priceInput.value = cached; return; }
    } catch (e) { /* ignore */ }
    priceInput.value = getHardcodedPrice(ticker);
}

export async function getCachedPrice(ticker) {
    try {
        if (typeof db === 'undefined') return null;
        const doc = await db.collection('current_prices').doc(ticker).get();
        if (doc.exists) return doc.data().price;
    } catch(e) { /* ignore */ }
    return null;
}



// ─── সেভ টু বোথ ডেটাবেস ──────────────────────────────────

export async function savePortfolioToBoth(userId, data) {
    let supabaseSuccess = false;
    let firebaseSuccess = false;

    if (typeof supabase !== 'undefined' && supabase) {
        try {
            const { error } = await supabase.from('portfolios').insert({
                user_id: userId,
                share_name: data.shareName,
                quantity: data.quantity,
                buy_price: data.buyPrice,
                commission: data.commission || 0,
                commission_percent: data.commissionPercent || 0,
                portfolio_id: data.portfolioId || 'main',
                date: data.date || new Date().toISOString().split('T')[0],
                created_at: new Date().toISOString()
            });
            if (!error) supabaseSuccess = true;
        } catch (e) { console.warn('Supabase insert failed:', e); }
    }

    if (typeof db !== 'undefined' && db) {
        try {
            await db.collection('portfolios').add({
                userId: userId,
                shareName: data.shareName,
                quantity: data.quantity,
                buyPrice: data.buyPrice,
                commission: data.commission || 0,
                commissionPercent: data.commissionPercent || 0,
                portfolioId: data.portfolioId || 'main',
                date: data.date ? new Date(data.date) : new Date(),
                createdAt: new Date()
            });
            firebaseSuccess = true;
        } catch (e) { console.warn('Firebase insert failed:', e); }
    }

    return { supabaseSuccess, firebaseSuccess };
}

// ─── Buy ট্যাব ইনিশিয়ালাইজ ──────────────────────────────

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

// ─── Buy সার্চ সাজেশন ইনিশিয়ালাইজ ──────────────────────

export function initBuySearch() {
    const tickerInput = document.getElementById('trade-ticker');
    const priceInput = document.getElementById('trade-price');
    const suggestionBox = document.getElementById('suggestion-box');
    const tradeDateInput = document.getElementById('trade-date');
    const qtyInput = document.getElementById('trade-qty');
    const btnBuy = document.querySelector('.btn-buy');
    const buyPortfolioSelect = document.getElementById('buy-portfolio-select');

    if (tradeDateInput) tradeDateInput.value = getBangladeshDateString();

    // ─── সাজেশন ──────────────────────────────────────────
    if (tickerInput && suggestionBox) {
        const debouncedSearch = debounce(function(query) {
            suggestionBox.innerHTML = "";
            if (!query) { suggestionBox.classList.add('hidden'); return; }
            const filtered = dseStocks.filter(stock => stock.startsWith(query));
            if (filtered.length > 0) {
                suggestionBox.classList.remove('hidden');
                filtered.forEach(stock => {
                    const div = document.createElement('div');
                    div.classList.add('suggestion-item');
                    div.innerText = stock;
                    div.addEventListener('click', () => {
                        tickerInput.value = stock;
                        suggestionBox.classList.add('hidden');
                        fetchLivePriceForBuy(stock);
                    });
                    suggestionBox.appendChild(div);
                });
            } else {
                suggestionBox.classList.add('hidden');
            }
        }, 250);

        tickerInput.addEventListener('input', function() {
            const query = this.value.trim().toUpperCase();
            debouncedSearch(query);
        });

        document.addEventListener('click', function(e) {
            if (!tickerInput.contains(e.target) && !suggestionBox.contains(e.target)) {
                suggestionBox.classList.add('hidden');
            }
        });
    }

    // ─── Buy বাটন ─────────────────────────────────────────
    if (btnBuy) {
        const newBtnBuy = btnBuy.cloneNode(true);
        btnBuy.parentNode.replaceChild(newBtnBuy, btnBuy);
        newBtnBuy.addEventListener('click', async () => {
            const shareName = tickerInput ? tickerInput.value.trim().toUpperCase() : '';
            const quantity = qtyInput ? qtyInput.value : '';
            const price = priceInput ? priceInput.value : '';
            const portfolioId = buyPortfolioSelect ? buyPortfolioSelect.value : 'main';
            const user = auth && auth.currentUser ? auth.currentUser : null;
            
            if (!user) { 
                showToast("Please login first", "error"); 
                return; 
            }
            if (!shareName || !quantity || !price) { 
                showToast("Please fill all fields correctly", "warning"); 
                return; 
            }

            let selectedDate = tradeDateInput ? tradeDateInput.value : getBangladeshDateString();
            if (!selectedDate) selectedDate = getBangladeshDateString();
            const transactionDate = getUTCFromLocalDate(selectedDate);
            if (isNaN(transactionDate.getTime())) { 
                showToast("Invalid date!", "error"); 
                return; 
            }

            const totalAmount = Number(quantity) * Number(price);
            const commissionPercent = commissionManager.getPercent();
            const commissionAmount = commissionManager.calculateCommission(totalAmount);
            const totalWithCommission = totalAmount + commissionAmount;

            let confirmMsg = `Buy Order Summary:\n📊 Share: ${shareName}\n📦 Quantity: ${quantity}\n💰 Price: ৳${Number(price).toFixed(2)}\n📈 Total Amount: ৳${totalAmount.toFixed(2)}`;
            if (commissionPercent > 0) {
                confirmMsg += `\n💸 Commission (${commissionPercent}%): ৳${commissionAmount.toFixed(2)}\n───────────────────────────────\n💵 Net Payable: ৳${totalWithCommission.toFixed(2)}`;
            }
            if (!confirm(confirmMsg)) return;

            try {
                const result = await savePortfolioToBoth(user.uid, {
                    shareName: shareName,
                    quantity: Number(quantity),
                    buyPrice: Number(price),
                    commission: commissionAmount,
                    commissionPercent: commissionPercent,
                    date: transactionDate.toISOString().split('T')[0],
                    portfolioId: portfolioId
                });

                if (result.supabaseSuccess || result.firebaseSuccess) {
                    // ক্যাশ রিসেট
                    resetUnifiedCache();
                    resetUnifiedPriceCache();
                    
                    // UI রিফ্রেশ
                     window.loadDashboardData(portfolioId, true);
                    
                    showToast(`✅ ${shareName} purchased successfully!`, 'success');
                    
                    // ফর্ম রিসেট
                    if (tickerInput) tickerInput.value = "";
                    if (qtyInput) qtyInput.value = "";
                    if (priceInput) priceInput.value = "";
                    if (tradeDateInput) tradeDateInput.value = getTodayDate();
                } else {
                    showToast("Failed to save purchase!", "error");
                }
            } catch (error) {
                console.error('Buy error:', error);
                showToast("Failed to save purchase!", "error");
            }
        });
    }
}

// ─── ডিফল্ট এক্সপোর্ট (ঐচ্ছিক) ──────────────────────────

export default {
    fetchLivePriceForBuy,
    getCachedPrice,
    savePortfolioToBoth,
    initBuyTabs,
    initBuySearch
};

// ─── DOM রেডি হলে অটো ইনিশিয়ালাইজ ──────────────────────

document.addEventListener('DOMContentLoaded', function() {
    initBuyTabs();
    initBuySearch();
    console.log('✅ trade-buy.js initialized');
});