// ==========================================
// 📊 trade-stock-table.js - Unified Stock Table
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { safeParseDate, getLatestAndPreviousPrices, debounce } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
// trade-stock-table.js-তে generateAnalysisStatement ইমপোর্ট করুন
import { generateAnalysisStatement } from './trade-analysis.js';

let currentSortedColumn = null;
let currentSortDirection = 'asc';

export async function loadUnifiedStockTable(userId, portfolioId = null) {
    if (!userId) return;
    const tableBody = document.getElementById('portfolio-table-body');
    if (!tableBody) return;

    async function loadStockData() {
        try {
            tableBody.innerHTML = `<tr><td colspan="12">Loading...</td></tr>`;

            let portfolioData = [];
            let salesData = [];

            // Supabase
            if (typeof supabase !== 'undefined' && supabase) {
                try {
                    let pQuery = supabase.from('portfolios').select('*').eq('user_id', userId);
                    if (portfolioId && portfolioId !== 'grand') pQuery = pQuery.eq('portfolio_id', portfolioId);
                    const { data: pData } = await pQuery;
                    if (pData) portfolioData = pData;

                    let sQuery = supabase.from('sales_history').select('*').eq('user_id', userId);
                    if (portfolioId && portfolioId !== 'grand') sQuery = sQuery.eq('portfolio_id', portfolioId);
                    const { data: sData } = await sQuery;
                    if (sData) salesData = sData;
                } catch (e) {
                    console.warn('Supabase fetch failed', e);
                }
            }

            // Firebase fallback
            if (portfolioData.length === 0 && typeof db !== 'undefined') {
                try {
                    let pQuery = db.collection('portfolios').where('userId', '==', userId);
                    if (portfolioId && portfolioId !== 'grand') pQuery = pQuery.where('portfolioId', '==', portfolioId);
                    const snap = await pQuery.get();
                    snap.forEach(doc => {
                        const data = doc.data();
                        const parsedDate = safeParseDate(data.date);
                        const parsedCreatedAt = safeParseDate(data.createdAt);
                        portfolioData.push({
                            id: doc.id,
                            user_id: data.userId,
                            share_name: data.shareName,
                            quantity: data.quantity,
                            buy_price: data.buyPrice,
                            commission: data.commission || 0,
                            commission_percent: data.commissionPercent || 0,
                            date: parsedDate ? parsedDate.toISOString().split('T')[0] : null,
                            created_at: parsedCreatedAt ? parsedCreatedAt.toISOString() : null
                        });
                    });
                } catch (e) {
                    console.warn('Firebase portfolio fetch failed', e);
                }
            }
            if (salesData.length === 0 && typeof db !== 'undefined') {
                try {
                    let sQuery = db.collection('sales_history').where('userId', '==', userId);
                    if (portfolioId && portfolioId !== 'grand') sQuery = sQuery.where('portfolioId', '==', portfolioId);
                    const snap = await sQuery.get();
                    snap.forEach(doc => {
                        const data = doc.data();
                        const parsedDate = safeParseDate(data.date);
                        const parsedCreatedAt = safeParseDate(data.createdAt);
                        salesData.push({
                            id: doc.id,
                            user_id: data.userId,
                            share_name: data.shareName,
                            quantity_sold: data.quantitySold || 0,
                            buy_price: data.buyPrice || 0,
                            sell_price: data.sellPrice || 0,
                            profit_or_loss: data.profitOrLoss || 0,
                            commission: data.commission || 0,
                            commission_percent: data.commissionPercent || 0,
                            net_received: data.netReceived || 0,
                            date: parsedDate ? parsedDate.toISOString().split('T')[0] : null,
                            created_at: parsedCreatedAt ? parsedCreatedAt.toISOString() : null
                        });
                    });
                } catch (e) {
                    console.warn('Firebase sales fetch failed', e);
                }
            }

            if (portfolioData.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="12">No trade history found.</td></tr>`;
                return;
            }

            // Sales map
            const salesMap = new Map();
            salesData.forEach(item => {
                const ticker = item.share_name;
                if (!salesMap.has(ticker)) {
                    salesMap.set(ticker, { sellQty: 0, totalSellValue: 0, realizedProfit: 0 });
                }
                const cur = salesMap.get(ticker);
                cur.sellQty += item.quantity_sold || 0;
                cur.totalSellValue += (item.quantity_sold || 0) * (item.sell_price || 0);
                cur.realizedProfit += item.profit_or_loss || 0;
                salesMap.set(ticker, cur);
            });

            // Group by ticker
            const grouped = {};
            portfolioData.forEach(item => {
                const ticker = item.share_name;
                if (!grouped[ticker]) grouped[ticker] = [];
                grouped[ticker].push(item);
            });

            const tickers = Object.keys(grouped);
            const priceDataMap = await getLatestAndPreviousPrices(tickers);

            let rowsHtml = "";
            let grandTotalBuyQty = 0, grandTotalRemainingQty = 0, grandTotalInvestment = 0;
            let grandTotalCurrentValue = 0, grandTotalUnrealized = 0, grandTotalSellQty = 0, grandTotalRealized = 0;
            let grandTotalDailyGL = 0;

            for (const [ticker, lots] of Object.entries(grouped)) {
                let totalBuyQty = 0, totalBuyCost = 0;
                lots.forEach(lot => {
                    totalBuyQty += lot.quantity || 0;
                    totalBuyCost += (lot.quantity || 0) * (lot.buy_price || 0);
                });
                const avgBuyPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;

                // FIFO remaining
                let remainingLots = lots.map(lot => ({
                    qty: lot.quantity || 0,
                    buyPrice: lot.buy_price || 0,
                    commission: lot.commission || 0,
                    commissionPercent: lot.commission_percent || 0
                }));
                let totalSold = salesMap.get(ticker)?.sellQty || 0;
                for (let lot of remainingLots) {
                    if (totalSold > 0 && lot.qty > 0) {
                        const taken = Math.min(lot.qty, totalSold);
                        lot.qty -= taken;
                        totalSold -= taken;
                    }
                }
                const remainingQty = remainingLots.reduce((sum, lot) => sum + lot.qty, 0);
                const remainingCost = remainingLots.reduce((sum, lot) => sum + (lot.qty * lot.buyPrice), 0);
                const remainingCommission = remainingLots.reduce((sum, lot) => sum + (lot.qty * lot.commission / (lot.qty + (lot.qty === 0 ? 1 : 0))), 0);
                const totalCostWithComm = remainingCost + remainingCommission;
                const avgBuyWithComm = remainingQty > 0 ? totalCostWithComm / remainingQty : 0;

                const priceData = priceDataMap.get(ticker);
                const currentPrice = priceData?.currentPrice || 0;
                const previousPrice = priceData?.previousPrice || 0;

                const currentLiveValue = remainingQty * currentPrice;
                const unrealizedReturn = currentLiveValue - totalCostWithComm;
                const unrealizedPercent = totalCostWithComm > 0 ? (unrealizedReturn / totalCostWithComm) * 100 : 0;

                const dailyChange = currentPrice - previousPrice;
                const dailyChangePercent = previousPrice > 0 ? (dailyChange / previousPrice) * 100 : 0;
                const dailyGL = remainingQty * dailyChange;

                const sellData = salesMap.get(ticker) || { sellQty: 0, totalSellValue: 0, realizedProfit: 0 };
                const avgSellPrice = sellData.sellQty > 0 ? sellData.totalSellValue / sellData.sellQty : 0;

                let realizedValue = sellData.realizedProfit || 0;
                let nameClass = '';
                if (realizedValue > 0) nameClass = 'name-positive';
                else if (realizedValue < 0) nameClass = 'name-negative';

                grandTotalBuyQty += totalBuyQty;
                grandTotalRemainingQty += remainingQty;
                grandTotalInvestment += totalCostWithComm;
                grandTotalCurrentValue += currentLiveValue;
                grandTotalUnrealized += unrealizedReturn;
                grandTotalSellQty += sellData.sellQty;
                grandTotalRealized += sellData.realizedProfit;
                grandTotalDailyGL += dailyGL;

                rowsHtml += `<tr onclick="window.navigateToAnalysis('${ticker}')">`;
                rowsHtml += `<td class="${nameClass}"><b>${ticker}</b></td>`;
                rowsHtml += `<td>${totalBuyQty}</td>`;
                rowsHtml += `<td>৳${avgBuyPrice.toFixed(2)}</td>`;
                rowsHtml += `<td>${remainingQty}</td>`;
                rowsHtml += `<td>${remainingQty > 0 ? `৳${currentPrice.toFixed(2)}` : '-'}</td>`;
                rowsHtml += `<td>${remainingQty > 0 ? `৳${unrealizedReturn.toFixed(2)}` : '-'}</td>`;
                rowsHtml += `<td>${remainingQty > 0 ? `${unrealizedPercent >= 0 ? '+' : ''}${unrealizedPercent.toFixed(2)}%` : '-'}</td>`;
                rowsHtml += `<td>${sellData.sellQty > 0 ? sellData.sellQty : '-'}</td>`;
                rowsHtml += `<td>${sellData.sellQty > 0 ? `৳${avgSellPrice.toFixed(2)}` : '-'}</td>`;
                rowsHtml += `<td>${sellData.realizedProfit !== 0 ? `৳${sellData.realizedProfit.toLocaleString()}` : '-'}</td>`;
                rowsHtml += `<td style="color: ${dailyChangePercent >= 0 ? '#10b981' : '#ef4444'};">${dailyChangePercent >= 0 ? '+' : ''}${dailyChangePercent.toFixed(2)}%</td>`;
                rowsHtml += `<td style="color: ${dailyGL >= 0 ? '#10b981' : '#ef4444'};">${dailyGL >= 0 ? '+' : ''}৳${dailyGL.toFixed(2)}</td>`;
                rowsHtml += `</tr>`;
            }

            // Footer
            rowsHtml += `<tr style="font-weight:bold; border-top:2px solid;">`;
            rowsHtml += `<td><b>📊 TOTAL</b></td>`;
            rowsHtml += `<td><b>${grandTotalBuyQty}</b></td>`;
            rowsHtml += `<td>-</td>`;
            rowsHtml += `<td><b>${grandTotalRemainingQty}</b></td>`;
            rowsHtml += `<td><b>৳${grandTotalCurrentValue.toLocaleString()}</b></td>`;
            rowsHtml += `<td><b>${grandTotalUnrealized >= 0 ? '+' : ''}৳${grandTotalUnrealized.toLocaleString()}</b></td>`;
            rowsHtml += `<td><b>${grandTotalInvestment > 0 ? ((grandTotalUnrealized / grandTotalInvestment) * 100).toFixed(2) : '0'}%</b></td>`;
            rowsHtml += `<td><b>${grandTotalSellQty}</b></td>`;
            rowsHtml += `<td>-</td>`;
            rowsHtml += `<td><b>${grandTotalRealized >= 0 ? '+' : ''}৳${grandTotalRealized.toLocaleString()}</b></td>`;
            rowsHtml += `<td><b>${grandTotalInvestment > 0 ? ((grandTotalDailyGL / grandTotalInvestment) * 100).toFixed(2) : '0'}%</b></td>`;
            rowsHtml += `<td><b>${grandTotalDailyGL >= 0 ? '+' : ''}৳${grandTotalDailyGL.toLocaleString()}</b></td>`;
            rowsHtml += `</tr>`;

            tableBody.innerHTML = rowsHtml;
            updateFooterCards(grandTotalInvestment, grandTotalCurrentValue, grandTotalUnrealized, grandTotalRealized, grandTotalRemainingQty);

        } catch (error) {
            console.error('Error loading stock table:', error);
            tableBody.innerHTML = `<tr><td colspan="12">Error loading data.</td></tr>`;
        }
    }

    await loadStockData();
}

function updateFooterCards(totalInvestment, totalCurrentValue, totalUnrealized, totalRealized, totalRemainingQty) {
    const footTotalInvest = document.getElementById('foot-total-invest');
    const footTotalCurrentValue = document.getElementById('foot-total-current-value');
    const footUnrealized = document.getElementById('foot-total-unrealized');
    const footRealized = document.getElementById('foot-total-realized');
    const footRemainingQty = document.getElementById('foot-total-remaining-qty');
    
    if (footTotalInvest) footTotalInvest.innerText = `৳${totalInvestment.toLocaleString()}`;
    if (footTotalCurrentValue) footTotalCurrentValue.innerText = `৳${totalCurrentValue.toLocaleString()}`;
    if (footUnrealized) {
        footUnrealized.innerText = `${totalUnrealized >= 0 ? '+' : ''}৳${totalUnrealized.toLocaleString()}`;
        footUnrealized.style.color = totalUnrealized >= 0 ? '#10b981' : '#ef4444';
    }
    if (footRealized) {
        footRealized.innerText = `${totalRealized >= 0 ? '+' : ''}৳${totalRealized.toLocaleString()}`;
        footRealized.style.color = totalRealized >= 0 ? '#10b981' : '#ef4444';
    }
    if (footRemainingQty) footRemainingQty.innerText = totalRemainingQty.toLocaleString();
}

export function navigateToAnalysis(ticker) {
    if (typeof switchTab === 'function') switchTab('analysis');
    const analysisInput = document.getElementById('analysis-ticker');
    if (analysisInput) analysisInput.value = ticker;
    if (typeof generateAnalysisStatement === "function") generateAnalysisStatement(ticker);
}

export function refreshStockTable() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    showToast('🔄 Refreshing stock table...', 'info');
    loadUnifiedStockTable(user.uid).then(() => {
        showToast('✅ Stock table refreshed!', 'success');
    }).catch(() => {
        showToast('❌ Refresh failed', 'error');
    });
}

export function downloadTableAsCSV() {
    let table = document.querySelector('#sec-table .stock-table');
    if (!table) table = document.querySelector('#sec-table table');
    if (!table) {
        showToast('📋 Table not found!', 'error');
        return;
    }

    const rows = table.querySelectorAll('tr:not([style*="display: none"]):not([style*="display:none"])');
    if (rows.length === 0) {
        showToast('No visible data to download.', 'warning');
        return;
    }

    let csvContent = '';
    const BOM = '\uFEFF';

    const headerCells = rows[0].querySelectorAll('th, td');
    const headerRow = Array.from(headerCells).map(cell => {
        let text = cell.innerText.trim();
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
            text = `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }).join(',');
    csvContent += headerRow + '\n';

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.style.display === 'none') continue;
        const cells = row.querySelectorAll('th, td');
        if (cells.length === 0) continue;
        const rowData = Array.from(cells).map(cell => {
            let text = cell.innerText.trim();
            if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                text = `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        }).join(',');
        csvContent += rowData + '\n';
    }

    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `stock_portfolio_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('✅ CSV downloaded successfully!', 'success');
}

console.log('✅ trade-stock-table.js loaded');