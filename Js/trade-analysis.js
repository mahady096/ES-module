// ==========================================
// 🔍 trade-analysis.js - Analysis & Statement
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, safeParseDate, debounce, getUnifiedPrice, getHardcodedPrice } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';

// ==========================================
// Analysis Stat
// ==========================================

export async function generateAnalysisStatement(ticker, portfolioId = null) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    const selectedText = document.getElementById('selected-analysis-ticker');
    const tableBody = document.getElementById('analysis-table-body');
    const resultContainer = document.getElementById('analysis-result-container');
    const footRemQty = document.getElementById('foot-analysis-rem-qty');
    const footTotalCost = document.getElementById('foot-analysis-total-cost');
    const footAvgPrice = document.getElementById('foot-analysis-avg-price');

    if (selectedText) selectedText.innerText = ticker;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan='9'>⏳ Loading analysis...</td></tr>`;
    if (resultContainer) resultContainer.classList.remove('hidden');

    try {
        const unifiedData = await unifiedEngine.calculate(user.uid, portfolioId, true);
        const stockData = unifiedData.stockDetails.find(s => s.ticker === ticker);

        if (!stockData || stockData.lots.length === 0) {
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="9">No active holdings for ${ticker}</td></tr>`;
            return;
        }

        let currentPrice = await getUnifiedPrice(ticker);
        if (currentPrice === 0) currentPrice = Number(getHardcodedPrice(ticker));

        let rowsHtml = '';
        let grandRemainingQty = 0;
        let grandTotalBuyCost = 0;

        for (const lot of stockData.lots) {
            const lotDate = safeParseDate(lot.date);
            const formattedDate = lotDate ? lotDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
            const remainingQty = lot.qty;
            const buyPrice = lot.buyPrice;
            const totalCost = lot.totalCost;
            const currentValue = remainingQty * currentPrice;
            const unrealizedGain = currentValue - totalCost;

            grandRemainingQty += remainingQty;
            grandTotalBuyCost += totalCost;

            rowsHtml += `<tr onclick="window.openLedgerModal('${ticker}')">
                <td>${formattedDate}</td>
                <td>${lot.qty}</td>
                <td>৳${buyPrice.toFixed(2)}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>${remainingQty}</td>
                <td>৳${currentPrice.toFixed(2)}</td>
                <td>${remainingQty > 0 ? `৳${unrealizedGain.toFixed(2)}` : '-'}</td>
            </tr>`;
        }

        if (tableBody) tableBody.innerHTML = rowsHtml || `<tr><td colspan="9">No lots found</td></tr>`;

        const grandAvgBuyPrice = grandRemainingQty > 0 ? grandTotalBuyCost / grandRemainingQty : 0;
        if (footRemQty) footRemQty.innerText = grandRemainingQty > 0 ? grandRemainingQty : "0 (Sold Out)";
        if (footTotalCost) footTotalCost.innerText = `৳${grandTotalBuyCost.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        if (footAvgPrice) footAvgPrice.innerText = `৳${grandAvgBuyPrice.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
    } catch (error) {
        console.error('Analysis error:', error);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="9">Error loading data</td></tr>`;
    }
}

export function initAnalysisSearch() {
    const tickerInput = document.getElementById('analysis-ticker');
    const suggestionBox = document.getElementById('analysis-suggestion-box');
    if (!tickerInput || !suggestionBox) return;

    const debouncedAnalysis = debounce(function(query) {
        suggestionBox.innerHTML = "";
        if (!query) {
            suggestionBox.classList.add('hidden');
            return;
        }
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
                    const portfolioId = document.getElementById('analysis-portfolio-select')?.value || null;
                    generateAnalysisStatement(stock, portfolioId);
                });
                suggestionBox.appendChild(div);
            });
        } else {
            suggestionBox.classList.add('hidden');
        }
    }, 300);

    tickerInput.addEventListener('input', function() {
        const query = this.value.trim().toUpperCase();
        debouncedAnalysis(query);
    });

    document.addEventListener('click', function(e) {
        if (!tickerInput.contains(e.target) && !suggestionBox.contains(e.target)) {
            suggestionBox.classList.add('hidden');
        }
    });
}

// ==========================================
// Statement
// ==========================================

export async function loadStatementData() {
    const tickerInput = document.getElementById('statement-ticker');
    if (!tickerInput) return;
    const ticker = tickerInput.value.trim().toUpperCase();
    if (!ticker) return;

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    const resultContainer = document.getElementById('statement-result-container');
    const selectedText = document.getElementById('selected-statement-ticker');
    const tableBody = document.getElementById('statement-table-body');
    const stmtRemSpan = document.getElementById('foot-stmt-rem-qty');
    const stmtTotalBuySpan = document.getElementById('foot-stmt-total-buy');
    const stmtAvgBuySpan = document.getElementById('foot-stmt-avg-buy');
    const stmtLtpSpan = document.getElementById('foot-stmt-ltp');
    const stmtUnrealSpan = document.getElementById('foot-stmt-unrealized');

    if (resultContainer) resultContainer.classList.remove('hidden');
    if (selectedText) selectedText.innerText = ticker;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">⏳ Loading...</td></tr>`;

    try {
        const portfolioId = document.getElementById('statement-portfolio-select')?.value || null;
        const unifiedData = await unifiedEngine.calculate(user.uid, portfolioId, true);
        const stockData = unifiedData.stockDetails.find(s => s.ticker === ticker);

        if (!stockData || stockData.lots.length === 0) {
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="7">No active holdings for ${ticker}</td></tr>`;
            return;
        }

        let transactions = [];
        let runningQty = 0;

        for (const lot of stockData.lots) {
            const dateObj = safeParseDate(lot.date) || new Date();
            transactions.push({
                date: dateObj,
                type: 'BUY',
                qty: lot.qty,
                price: lot.buyPrice,
                totalAmount: lot.qty * lot.buyPrice,
                realizedProfit: null,
                runningQty: 0
            });
        }

        transactions.sort((a, b) => a.date - b.date);
        for (let tx of transactions) {
            if (tx.type === 'BUY') runningQty += tx.qty;
            else runningQty -= tx.qty;
            tx.runningQty = runningQty;
        }

        let html = '';
        let totalBuyCost = 0;
        let totalQty = 0;

        for (const tx of transactions) {
            const dateStr = tx.date.toLocaleDateString('bn-BD');
            totalBuyCost += tx.totalAmount;
            totalQty += tx.qty;
            html += `<tr>
                <td style="padding:8px;">${dateStr}</td>
                <td style="padding:8px;" class="up">BUY</td>
                <td style="padding:8px;">${tx.qty}</td>
                <td style="padding:8px;">৳${tx.price.toFixed(2)}</td>
                <td style="padding:8px;">৳${tx.totalAmount.toFixed(2)}</td>
                <td style="padding:8px;">-</td>
                <td style="padding:8px;">${tx.runningQty}</td>
            </tr>`;
        }

        if (tableBody) tableBody.innerHTML = html;

        const remainingQty = runningQty;
        const avgBuy = remainingQty > 0 ? totalBuyCost / remainingQty : 0;
        let currentPrice = await getUnifiedPrice(ticker);
        if (currentPrice === 0) currentPrice = avgBuy;
        const unrealized = remainingQty * (currentPrice - avgBuy);

        if (stmtRemSpan) stmtRemSpan.innerText = remainingQty;
        if (stmtTotalBuySpan) stmtTotalBuySpan.innerHTML = `৳${totalBuyCost.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
        if (stmtAvgBuySpan) stmtAvgBuySpan.innerHTML = `৳${avgBuy.toFixed(2)}`;
        if (stmtLtpSpan) stmtLtpSpan.innerHTML = `৳${currentPrice.toFixed(2)}`;
        if (stmtUnrealSpan) {
            stmtUnrealSpan.innerHTML = `${unrealized >= 0 ? '+' : ''}৳${unrealized.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}`;
            stmtUnrealSpan.style.color = unrealized >= 0 ? '#10b981' : '#ef4444';
        }
    } catch (err) {
        console.error('Statement error:', err);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="7">Error loading data.</td></tr>`;
    }
}

export function initStatementSearch() {
    const tickerInput = document.getElementById('statement-ticker');
    const suggestionBox = document.getElementById('statement-suggestion-box');
    if (!tickerInput || !suggestionBox) return;

    const debouncedStatement = debounce(function(query) {
        suggestionBox.innerHTML = '';
        suggestionBox.classList.add('hidden');
        if (!query) { return; }
        const filtered = dseStocks.filter(stock => stock.startsWith(query));
        if (filtered.length > 0) {
            suggestionBox.classList.remove('hidden');
            const limited = filtered.slice(0, 15);
            limited.forEach(stock => {
                const div = document.createElement('div');
                div.classList.add('suggestion-item');
                div.innerText = stock;
                div.addEventListener('click', function() {
                    tickerInput.value = stock;
                    suggestionBox.classList.add('hidden');
                    loadStatementData();
                });
                suggestionBox.appendChild(div);
            });
        }
    }, 300);

    tickerInput.addEventListener('input', function() {
        const query = this.value.trim().toUpperCase();
        debouncedStatement(query);
    });

    tickerInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const ticker = this.value.trim().toUpperCase();
            suggestionBox.classList.add('hidden');
            if (ticker && dseStocks.includes(ticker)) {
                loadStatementData();
            } else {
                showToast('Share not found. Please select from suggestions.', 'warning');
            }
        }
    });

    document.addEventListener('click', function(e) {
        if (!tickerInput.contains(e.target) && !suggestionBox.contains(e.target)) {
            suggestionBox.classList.add('hidden');
        }
    });
}

// ==========================================
// Ledger Modal
// ==========================================

let currentEditingDividendId = null;

export async function openLedgerModal(ticker) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;
    const modal = document.getElementById('ledger-modal');
    const modalTitle = document.getElementById('modal-ticker-title');
    const listContainer = document.getElementById('modal-transaction-list');
    const editForm = document.getElementById('modal-edit-form');
    if (modalTitle) modalTitle.innerText = ticker;
    if (editForm) editForm.style.display = 'none';
    if (listContainer) listContainer.innerHTML = "<p>Loading history...</p>";
    if (modal) modal.style.display = 'flex';

    try {
        let buyData = [], sellData = [];

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data: pData } = await supabase
                    .from('portfolios')
                    .select('*')
                    .eq('user_id', user.uid)
                    .eq('share_name', ticker);
                if (pData) buyData = pData;

                const { data: sData } = await supabase
                    .from('sales_history')
                    .select('*')
                    .eq('user_id', user.uid)
                    .eq('share_name', ticker);
                if (sData) sellData = sData;
            } catch (e) {
                console.warn('Supabase fetch failed', e);
            }
        }

        if (buyData.length === 0 && typeof db !== 'undefined') {
            try {
                const buySnapshot = await db.collection("portfolios")
                    .where("userId", "==", user.uid)
                    .where("shareName", "==", ticker)
                    .get();
                buySnapshot.forEach(doc => {
                    buyData.push({ id: doc.id, ...doc.data() });
                });
            } catch (e) { /* ignore */ }
        }
        if (sellData.length === 0 && typeof db !== 'undefined') {
            try {
                const sellSnapshot = await db.collection("sales_history")
                    .where("userId", "==", user.uid)
                    .where("shareName", "==", ticker)
                    .get();
                sellSnapshot.forEach(doc => {
                    sellData.push({ id: doc.id, ...doc.data() });
                });
            } catch (e) { /* ignore */ }
        }

        let html = `<table><thead><tr><th>Type</th><th>Qty</th><th>Price</th><th>Actions</th></tr></thead><tbody>`;
        let hasData = false;
        buyData.forEach(item => {
            hasData = true;
            const qty = item.quantity || 0;
            const price = item.buyPrice || item.buy_price || 0;
            html += `<tr><td>BUY</td><td>${qty}</td><td>৳${price.toFixed(2)}</td><td><button onclick="window.showEditForm('${item.id}','BUY',${qty},${price})">Edit</button> <button onclick="window.deleteRecord('${item.id}','BUY','${ticker}')">Delete</button></td></tr>`;
        });
        sellData.forEach(item => {
            hasData = true;
            const qty = item.quantitySold || item.quantity_sold || 0;
            const price = item.sellPrice || item.sell_price || 0;
            html += `<tr><td>SELL</td><td>${qty}</td><td>৳${price.toFixed(2)}</td><td><button onclick="window.showEditForm('${item.id}','SELL',${qty},${price})">Edit</button> <button onclick="window.deleteRecord('${item.id}','SELL','${ticker}')">Delete</button></td></tr>`;
        });
        html += `</tbody></table>`;
        if (listContainer) listContainer.innerHTML = hasData ? html : "<p>No records found.</p>";
    } catch (error) {
        console.error(error);
    }
}

export function closeLedgerModal() {
    const modal = document.getElementById('ledger-modal');
    if (modal) modal.style.display = 'none';
}

export function showEditForm(id, type, qty, price) {
    const editForm = document.getElementById('modal-edit-form');
    if (editForm) editForm.style.display = 'block';
    const title = document.getElementById('edit-form-title');
    if (title) title.innerText = `Editing ${type} Entry`;
    document.getElementById('edit-doc-id').value = id;
    document.getElementById('edit-doc-type').value = type;
    document.getElementById('edit-input-qty').value = qty;
    document.getElementById('edit-input-price').value = price;
}

export async function saveEditedRecord() {
    const id = document.getElementById('edit-doc-id').value;
    const type = document.getElementById('edit-doc-type').value;
    const qty = Number(document.getElementById('edit-input-qty').value);
    const price = Number(document.getElementById('edit-input-price').value);
    const ticker = document.getElementById('modal-ticker-title')?.innerText || '';
    if (!qty || qty <= 0 || !price || price <= 0) {
        showToast("Please enter valid quantity and price.", "warning");
        return;
    }

    try {
        if (type === 'BUY') {
            if (typeof supabase !== 'undefined' && supabase) {
                await supabase
                    .from('portfolios')
                    .update({ quantity: qty, buy_price: price })
                    .eq('id', id);
            }
            if (typeof db !== 'undefined') {
                await db.collection("portfolios").doc(id).update({ quantity: qty, buyPrice: price });
            }
            if (typeof resetUnifiedCache === 'function') resetUnifiedCache();
            showToast("✅ Record updated!", "success");
        } else {
            if (typeof supabase !== 'undefined' && supabase) {
                const { data } = await supabase
                    .from('sales_history')
                    .select('buy_price')
                    .eq('id', id)
                    .single();
                const originalBuyPrice = data?.buy_price || 0;
                await supabase
                    .from('sales_history')
                    .update({
                        quantity_sold: qty,
                        sell_price: price,
                        profit_or_loss: (price - originalBuyPrice) * qty
                    })
                    .eq('id', id);
            }
            if (typeof db !== 'undefined') {
                const docSnap = await db.collection("sales_history").doc(id).get();
                const originalBuyPrice = docSnap.data()?.buyPrice || 0;
                await db.collection("sales_history").doc(id).update({
                    quantitySold: qty,
                    sellPrice: price,
                    profitOrLoss: (price - originalBuyPrice) * qty
                });
            }
            showToast("✅ Record updated!", "success");
        }
        closeLedgerModal();
        if (auth && auth.currentUser) {
            if (typeof loadUnifiedStockTable === 'function') loadUnifiedStockTable(auth.currentUser.uid);
            if (typeof generateAnalysisStatement === 'function') generateAnalysisStatement(ticker);
        }
    } catch (error) {
        console.error(error);
        showToast("Failed to update record.", "error");
    }
}

export async function deleteRecord(id, type, ticker) {
    if (!confirm(`Are you sure you want to delete this ${type} record?`)) return;
    try {
        if (type === 'BUY') {
            if (typeof supabase !== 'undefined' && supabase) {
                await supabase.from('portfolios').delete().eq('id', id);
            }
            if (typeof db !== 'undefined') {
                await db.collection("portfolios").doc(id).delete();
            }
            if (typeof resetUnifiedCache === 'function') resetUnifiedCache();
        } else {
            if (typeof supabase !== 'undefined' && supabase) {
                await supabase.from('sales_history').delete().eq('id', id);
            }
            if (typeof db !== 'undefined') {
                await db.collection("sales_history").doc(id).delete();
            }
        }
        showToast("🗑️ Deleted successfully!", "info");
        closeLedgerModal();
        if (auth && auth.currentUser) {
            if (typeof loadUnifiedStockTable === 'function') loadUnifiedStockTable(auth.currentUser.uid);
            if (typeof generateAnalysisStatement === 'function') generateAnalysisStatement(ticker);
        }
    } catch (error) {
        console.error(error);
        showToast("Failed to delete.", "error");
    }
}

console.log('✅ trade-analysis.js loaded');