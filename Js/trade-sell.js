// ==========================================
// 📤 trade-sell.js - Sell ফাংশনালিটি (ES Module)
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import {
    dseStocks, getBangladeshDateString, getUTCFromLocalDate,
    getTodayDate, debounce, safeParseDate, resetUnifiedCache,
    resetUnifiedPriceCache, CommissionManager
} from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { loadSellHistory } from './trade-history.js';

const commissionManager = new CommissionManager();

// ─── স্টেট ──────────────────────────────────────────────────

let currentActiveLots = [];
let sellBatch = [];

// ─── সেভ সেলস টু বোথ ─────────────────────────────────────

export async function saveSalesToBoth(userId, data) {
    let supabaseSuccess = false;
    let firebaseSuccess = false;

    if (typeof supabase !== 'undefined' && supabase) {
        try {
            const { error } = await supabase.from('sales_history').insert({
                user_id: userId,
                share_name: data.shareName,
                quantity_sold: data.quantitySold,
                buy_price: data.buyPrice,
                sell_price: data.sellPrice,
                profit_or_loss: data.profitOrLoss,
                commission: data.commission || 0,
                commission_percent: data.commissionPercent || 0,
                net_received: data.netReceived || 0,
                date: data.date || new Date().toISOString().split('T')[0],
                created_at: new Date().toISOString(),
                portfolio_id: data.portfolioId || 'main'
            });
            if (!error) supabaseSuccess = true;
        } catch (e) { console.warn('Supabase sales insert failed:', e); }
    }

    if (typeof db !== 'undefined' && db) {
        try {
            await db.collection('sales_history').add({
                userId: userId,
                shareName: data.shareName,
                quantitySold: data.quantitySold,
                buyPrice: data.buyPrice,
                sellPrice: data.sellPrice,
                profitOrLoss: data.profitOrLoss,
                commission: data.commission || 0,
                commissionPercent: data.commissionPercent || 0,
                netReceived: data.netReceived || 0,
                date: data.date ? new Date(data.date) : new Date(),
                createdAt: new Date(),
                portfolioId: data.portfolioId || 'main'
            });
            firebaseSuccess = true;
        } catch (e) { console.warn('Firebase sales insert failed:', e); }
    }

    return { supabaseSuccess, firebaseSuccess };
}

// ─── হোল্ডিংস ফেচ ─────────────────────────────────────────

export async function fetchHoldingsForSell(ticker, portfolioId = null) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    const selectedText = document.getElementById('selected-sell-ticker');
    const tableBody = document.getElementById('sell-portfolio-table-body');
    const container = document.getElementById('sell-holdings-container');

    if (selectedText) selectedText.innerText = ticker;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan='4'>Loading lots...</td></tr>`;
    if (container) container.classList.remove('hidden');

    try {
        let buyLots = [];
        let totalSoldBefore = 0;

        // ─── Supabase ──────────────────────────────────────
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                let pQuery = supabase.from('portfolios')
                    .select('*')
                    .eq('user_id', user.uid)
                    .eq('share_name', ticker);
                if (portfolioId && portfolioId !== 'grand') {
                    pQuery = pQuery.eq('portfolio_id', portfolioId);
                }
                const { data: pData } = await pQuery;
                if (pData && pData.length > 0) {
                    buyLots = pData.map(doc => ({ docId: doc.id, ...doc }));
                }

                let sQuery = supabase.from('sales_history')
                    .select('*')
                    .eq('user_id', user.uid)
                    .eq('share_name', ticker);
                if (portfolioId && portfolioId !== 'grand') {
                    sQuery = sQuery.eq('portfolio_id', portfolioId);
                }
                const { data: sData } = await sQuery;
                if (sData) {
                    totalSoldBefore = sData.reduce((sum, item) => sum + (item.quantity_sold || 0), 0);
                }
            } catch (e) {
                console.warn('Supabase fetch failed, trying Firebase...', e);
            }
        }

        // ─── Firebase ফ্যালব্যাক ──────────────────────────
        if (buyLots.length === 0 && typeof db !== 'undefined') {
            try {
                let pQuery = db.collection('portfolios')
                    .where('userId', '==', user.uid)
                    .where('shareName', '==', ticker);
                if (portfolioId && portfolioId !== 'grand') {
                    pQuery = pQuery.where('portfolioId', '==', portfolioId);
                }
                const buySnapshot = await pQuery.get();
                buySnapshot.forEach(doc => {
                    const data = doc.data();
                    buyLots.push({
                        docId: doc.id,
                        id: doc.id,
                        quantity: data.quantity,
                        buyPrice: data.buyPrice,
                        buy_price: data.buyPrice,
                        date: data.date,
                        commission: data.commission || 0,
                        commission_percent: data.commissionPercent || 0
                    });
                });

                let sQuery = db.collection('sales_history')
                    .where('userId', '==', user.uid)
                    .where('shareName', '==', ticker);
                if (portfolioId && portfolioId !== 'grand') {
                    sQuery = sQuery.where('portfolioId', '==', portfolioId);
                }
                const sellSnapshot = await sQuery.get();
                sellSnapshot.forEach(doc => {
                    totalSoldBefore += (doc.data().quantitySold || 0);
                });
            } catch (e) {
                console.warn('Firebase fetch failed', e);
            }
        }

        // ─── সাজানো ──────────────────────────────────────
        buyLots.sort((a, b) => {
            const timeA = a.date ? safeParseDate(a.date) : 0;
            const timeB = b.date ? safeParseDate(b.date) : 0;
            return (timeA ? timeA.getTime() : 0) - (timeB ? timeB.getTime() : 0);
        });

        currentActiveLots = [];
        if (tableBody) tableBody.innerHTML = '';

        buyLots.forEach(lot => {
            let availableQty = lot.quantity || 0;
            if (totalSoldBefore > 0) {
                if (totalSoldBefore >= availableQty) {
                    totalSoldBefore -= availableQty;
                    availableQty = 0;
                } else {
                    availableQty -= totalSoldBefore;
                    totalSoldBefore = 0;
                }
            }
            if (availableQty > 0) {
                const buyPrice = lot.buyPrice || lot.buy_price || 0;
                const docId = lot.docId || lot.id;
                currentActiveLots.push({ docId, buyPrice, availableQty });
                if (tableBody) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>৳${buyPrice.toFixed(2)}</td>
                        <td style="color:#10b981; font-weight:bold;">${availableQty}</td>
                        <td>${lot.date ? (safeParseDate(lot.date)?.toLocaleDateString() || 'N/A') : 'N/A'}</td>
                        <td>
                            <div class="sell-input-group">
                                <input type="number" id="input-sell-qty-${docId}" placeholder="Qty" min="1" max="${availableQty}">
                                <input type="number" id="input-sell-price-${docId}" placeholder="Price">
                            </div>
                            <button onclick="window.addToSellBatch('${docId}', '${ticker}', ${buyPrice}, ${availableQty})" 
                                    style="margin-top: 5px; background: #6366f1; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; width: 100%;">
                                ➕ Add to Batch
                            </button>
                        </td>
                    `;
                    tableBody.appendChild(tr);
                }
            }
        });

        if (currentActiveLots.length === 0 && tableBody) {
            tableBody.innerHTML = `<tr><td colspan='4'>No sellable shares available.</td></tr>`;
        }
    } catch (error) {
        console.error(error);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan='4'>Error loading data!</td></tr>`;
    }
}

// ─── ব্যাচ সেল ─────────────────────────────────────────────

export function addToSellBatch(lotId, ticker, buyPrice, availableQty) {
    const qtyInput = document.getElementById(`input-sell-qty-${lotId}`);
    const priceInput = document.getElementById(`input-sell-price-${lotId}`);
    if (!qtyInput || !priceInput) return;

    const sellQty = Number(qtyInput.value) || 0;
    const sellPrice = Number(priceInput.value) || 0;

    if (sellQty <= 0 || sellPrice <= 0) {
        showToast('Please enter valid quantity and price.', 'warning');
        return;
    }
    if (sellQty > availableQty) {
        showToast(`Maximum ${availableQty} shares available.`, 'warning');
        return;
    }

    sellBatch.push({
        lotId,
        ticker,
        buyPrice,
        sellQty,
        sellPrice,
        totalValue: sellQty * sellPrice
    });
    renderBatchTable();

    qtyInput.value = '';
    priceInput.value = '';
    showToast(`✅ ${ticker} added to batch (${sellQty} shares)`, 'success');
}

export function removeFromBatch(index) {
    sellBatch.splice(index, 1);
    renderBatchTable();
    showToast('🗑️ Removed from batch', 'info');
}

export function renderBatchTable() {
    const tbody = document.getElementById('batch-sell-body');
    if (!tbody) return;

    if (sellBatch.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No items added yet. Add from holdings below.</td></tr>`;
        return;
    }

    let html = '';
    let grandTotal = 0;
    sellBatch.forEach((item, index) => {
        grandTotal += item.totalValue;
        html += `<tr>
            <td style="padding: 8px; font-weight: bold;">${item.ticker}</td>
            <td style="padding: 8px;">৳${item.buyPrice.toFixed(2)}</td>
            <td style="padding: 8px;">${item.sellQty}</td>
            <td style="padding: 8px;">৳${item.sellPrice.toFixed(2)}</td>
            <td style="padding: 8px;">৳${item.totalValue.toFixed(2)}</td>
            <td style="padding: 8px;">
                <button onclick="window.removeFromBatch(${index})" style="background: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">✖</button>
            </td>
        </tr>`;
    });

    html += `<tr style="font-weight: bold; background: var(--bg-tertiary);">
        <td colspan="4" style="padding: 8px; text-align: right;">Total Sell Value</td>
        <td style="padding: 8px;">৳${grandTotal.toFixed(2)}</td>
        <td style="padding: 8px;"></td>
    </tr>`;
    tbody.innerHTML = html;
}

export async function executeBatchSell() {
    if (sellBatch.length === 0) {
        showToast('No items in batch. Add some first.', 'warning');
        return;
    }

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first.', 'error');
        return;
    }

    const portfolioSelect = document.getElementById('sell-portfolio-select');
    const portfolioId = portfolioSelect ? portfolioSelect.value : 'main';

    let totalQty = sellBatch.reduce((sum, item) => sum + item.sellQty, 0);
    let totalValue = sellBatch.reduce((sum, item) => sum + item.totalValue, 0);
    const commissionPercent = commissionManager.getPercent();
    const commissionAmount = commissionManager.calculateCommission(totalValue);
    const netReceivable = totalValue - commissionAmount;

    let confirmMsg = `📊 Batch Sell Summary:\n━━━━━━━━━━━━━━━━━━━━\n📦 Total Shares: ${totalQty}\n💰 Total Sell Value: ৳${totalValue.toFixed(2)}`;
    if (commissionPercent > 0) {
        confirmMsg += `\n💸 Commission (${commissionPercent}%): ৳${commissionAmount.toFixed(2)}`;
        confirmMsg += `\n💵 Net Receivable: ৳${netReceivable.toFixed(2)}`;
    }
    confirmMsg += `\n━━━━━━━━━━━━━━━━━━━━\n🔄 ${sellBatch.length} entry(s) will be processed.`;
    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById('btn-execute-batch-sell');
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Processing...';
        btn.style.opacity = '0.7';
    }

    try {
        const dateInput = document.getElementById('sell-trade-date');
        let selectedDate = dateInput ? dateInput.value : getBangladeshDateString();
        if (!selectedDate) selectedDate = getBangladeshDateString();
        const transactionDate = getUTCFromLocalDate(selectedDate);
        if (isNaN(transactionDate.getTime())) {
            showToast('Invalid date!', 'error');
            return;
        }

        let processedCount = 0;
        for (const item of sellBatch) {
            const saleValue = item.sellQty * item.sellPrice;
            const commission = commissionManager.calculateCommission(saleValue);

            await saveSalesToBoth(user.uid, {
                shareName: item.ticker,
                quantitySold: item.sellQty,
                buyPrice: item.buyPrice,
                sellPrice: item.sellPrice,
                profitOrLoss: (item.sellPrice - item.buyPrice) * item.sellQty,
                commission: commission,
                commissionPercent: commissionManager.getPercent(),
                netReceived: saleValue - commission,
                date: transactionDate.toISOString().split('T')[0],
                portfolioId: portfolioId
            });
            processedCount++;
        }

        showToast(`✅ ${processedCount} sale(s) processed successfully!`, 'success');

        sellBatch = [];
        renderBatchTable();

        resetUnifiedCache();
        resetUnifiedPriceCache();

        window.loadDashboardData(portfolioId, true);

        // UI রিসেট
        const tickerInput = document.getElementById('sell-ticker');
        if (tickerInput) tickerInput.value = '';
        const container = document.getElementById('sell-holdings-container');
        if (container) container.classList.add('hidden');
        if (dateInput) dateInput.value = getTodayDate();

    } catch (error) {
        console.error('Batch sell error:', error);
        showToast('❌ Failed to execute batch sales.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '✅ Execute All Sales';
            btn.style.opacity = '1';
        }
    }
}

export function clearBatch() {
    if (sellBatch.length === 0) return;
    if (!confirm('Clear all items from batch?')) return;
    sellBatch = [];
    renderBatchTable();
    showToast('Batch cleared', 'info');
}

// ─── Sell ট্যাব ─────────────────────────────────────────────

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
                    const searchInput = document.getElementById('sell-history-search');
                    if (searchInput) {
                        searchInput.value = '';
                        loadSellHistory('');
                    }
                }
            }
        });
    });
}

// ─── Sell হিস্ট্রি সার্চ ──────────────────────────────────

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

// ─── Sell সার্চ সাজেশন ────────────────────────────────────

export function initSellSearch() {
    const tickerInput = document.getElementById('sell-ticker');
    const suggestionBox = document.getElementById('sell-suggestion-box');
    const sellDateInput = document.getElementById('sell-trade-date');
    const portfolioSelect = document.getElementById('sell-portfolio-select');
    const btnExecuteSell = document.getElementById('btn-execute-sell');

    if (sellDateInput) sellDateInput.value = getBangladeshDateString();

    // ─── সাজেশন ──────────────────────────────────────────
    if (tickerInput && suggestionBox) {
        const debouncedSellSearch = debounce(function(query) {
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
                        const portfolioId = portfolioSelect ? portfolioSelect.value : 'main';
                        fetchHoldingsForSell(stock, portfolioId);
                    });
                    suggestionBox.appendChild(div);
                });
            } else {
                suggestionBox.classList.add('hidden');
            }
        }, 250);

        tickerInput.addEventListener('input', function() {
            const query = this.value.trim().toUpperCase();
            debouncedSellSearch(query);
        });

        document.addEventListener('click', function(e) {
            if (!tickerInput.contains(e.target) && !suggestionBox.contains(e.target)) {
                suggestionBox.classList.add('hidden');
            }
        });
    }

    // ─── পোর্টফোলিও সিলেক্টর ──────────────────────────
    if (portfolioSelect) {
        portfolioSelect.addEventListener('change', function() {
            const ticker = tickerInput ? tickerInput.value.trim().toUpperCase() : '';
            if (ticker) {
                fetchHoldingsForSell(ticker, this.value);
            }
        });
    }

    // ─── Sell বাটন ──────────────────────────────────────
    if (btnExecuteSell) {
        const newSellBtn = btnExecuteSell.cloneNode(true);
        btnExecuteSell.parentNode.replaceChild(newSellBtn, btnExecuteSell);
        newSellBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const user = auth && auth.currentUser ? auth.currentUser : null;
            const ticker = tickerInput ? tickerInput.value.trim().toUpperCase() : '';
            const portfolioId = portfolioSelect ? portfolioSelect.value : 'main';

            if (!user) { showToast("Please login first", "error"); return; }
            if (!ticker) { showToast("Please select a share", "warning"); return; }
            if (currentActiveLots.length === 0) { showToast("No sellable lots available!", "warning"); return; }

            let selectedDate = sellDateInput ? sellDateInput.value : getBangladeshDateString();
            if (!selectedDate) selectedDate = getBangladeshDateString();
            const transactionDate = getUTCFromLocalDate(selectedDate);
            if (isNaN(transactionDate.getTime())) { showToast("Invalid date!", "error"); return; }

            try {
                let totalSoldSuccessfully = 0, totalSellValue = 0, totalCommissionAmount = 0;

                for (let lot of currentActiveLots) {
                    const qtyField = document.getElementById(`input-sell-qty-${lot.docId}`);
                    const priceField = document.getElementById(`input-sell-price-${lot.docId}`);
                    if (qtyField && priceField) {
                        const sellQty = Number(qtyField.value) || 0;
                        const sellPrice = Number(priceField.value) || 0;
                        if (sellQty > 0 && sellPrice > 0 && sellQty <= lot.availableQty) {
                            const saleValue = sellQty * sellPrice;
                            const commission = commissionManager.calculateCommission(saleValue);
                            totalSellValue += saleValue;
                            totalCommissionAmount += commission;

                            await saveSalesToBoth(user.uid, {
                                shareName: ticker,
                                quantitySold: sellQty,
                                buyPrice: lot.buyPrice,
                                sellPrice: sellPrice,
                                profitOrLoss: (sellPrice - lot.buyPrice) * sellQty,
                                commission: commission,
                                commissionPercent: commissionManager.getPercent(),
                                netReceived: saleValue - commission,
                                date: transactionDate.toISOString().split('T')[0],
                                portfolioId: portfolioId
                            });

                            totalSoldSuccessfully += sellQty;
                        }
                    }
                }

                if (totalSoldSuccessfully === 0) {
                    showToast("Please enter quantity to sell.", "warning");
                    return;
                }

                resetUnifiedCache();
                resetUnifiedPriceCache();

                showToast(`✅ ${totalSoldSuccessfully} shares of ${ticker} sold!`, "success");

                window.loadDashboardData(portfolioId, true);

                // রিসেট
                if (tickerInput) tickerInput.value = "";
                const container = document.getElementById('sell-holdings-container');
                if (container) container.classList.add('hidden');
                currentActiveLots = [];

            } catch (error) {
                console.error(error);
                showToast("Sell failed!", "error");
            }
        });
    }
}

// ─── ডিফল্ট এক্সপোর্ট ────────────────────────────────────

export default {
    saveSalesToBoth,
    fetchHoldingsForSell,
    addToSellBatch,
    removeFromBatch,
    renderBatchTable,
    executeBatchSell,
    clearBatch,
    initSellTabs,
    initSellHistorySearch,
    initSellSearch
};

// ─── DOM রেডি হলে অটো ইনিশিয়ালাইজ ──────────────────────

document.addEventListener('DOMContentLoaded', function() {
    initSellTabs();
    initSellHistorySearch();
    initSellSearch();

    // ব্যাচ সেল বাটন
    const executeBtn = document.getElementById('btn-execute-batch-sell');
    if (executeBtn) {
        executeBtn.addEventListener('click', executeBatchSell);
    }
    const clearBtn = document.getElementById('btn-clear-batch');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearBatch);
    }

    console.log('✅ trade-sell.js initialized');
});