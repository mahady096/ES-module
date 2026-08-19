// ==========================================
// 💡 trade-suggestion.js - Buy/Sell Suggestion
// ==========================================

import { auth, db } from './firebase.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { getUnifiedPrice } from './core.js';

export async function loadSuggestionData(threshold = null, portfolioId = null) {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }

    if (threshold === null) {
        const input = document.getElementById('suggestion-threshold');
        threshold = input ? parseFloat(input.value) || 50 : 50;
    }

    threshold = Math.min(100, Math.max(1, threshold));

    const buyTbody = document.getElementById('suggestion-buy-body');
    const sellTbody = document.getElementById('suggestion-sell-body');
    if (!buyTbody || !sellTbody) return;

    buyTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">⏳ Loading buy suggestions...</td></tr>`;
    sellTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">⏳ Loading sell suggestions...</td></tr>`;

    try {
        const unifiedData = await unifiedEngine.calculate(user.uid, portfolioId || null, true);
        if (!unifiedData || unifiedData.stockDetails.length === 0) {
            buyTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No stocks in portfolio.</td></tr>`;
            sellTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No stocks in portfolio.</td></tr>`;
            return;
        }

        const tickers = unifiedData.stockDetails.map(s => s.ticker);
        const pricePromises = tickers.map(t => getUnifiedPrice(t));
        const currentPrices = await Promise.all(pricePromises);

        const stockAnalysis = [];
        for (let i = 0; i < unifiedData.stockDetails.length; i++) {
            const stock = unifiedData.stockDetails[i];
            const currentPrice = currentPrices[i] || 0;
            const totalCost = stock.totalCost || 0;
            const remainingQty = stock.totalQty || 0;
            const avgBuy = stock.avgBuyPriceWithCommission || 0;

            const currentValue = remainingQty * currentPrice;
            const unrealizedGL = currentValue - totalCost;
            const unrealizedPercent = totalCost > 0 ? (unrealizedGL / totalCost) * 100 : 0;

            stockAnalysis.push({
                ticker: stock.ticker,
                avgBuy: avgBuy,
                qty: remainingQty,
                totalCost: totalCost,
                currentValue: currentValue,
                unrealizedGL: unrealizedGL,
                unrealizedPercent: unrealizedPercent
            });
        }

        const buySuggestions = stockAnalysis
            .filter(item => item.unrealizedPercent >= threshold)
            .sort((a, b) => b.unrealizedPercent - a.unrealizedPercent);

        const sellSuggestions = stockAnalysis
            .filter(item => item.unrealizedPercent <= -threshold)
            .sort((a, b) => a.unrealizedPercent - b.unrealizedPercent);

        renderSuggestionTable(buyTbody, buySuggestions, 'buy');
        renderSuggestionTable(sellTbody, sellSuggestions, 'sell');
    } catch (error) {
        console.error('Suggestion error:', error);
        buyTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">Error loading data.</td></tr>`;
        sellTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">Error loading data.</td></tr>`;
    }
}

function renderSuggestionTable(tbody, data, type) {
    if (!data || data.length === 0) {
        const threshold = document.getElementById('suggestion-threshold')?.value || 50;
        const msg = type === 'buy'
            ? `🎉 No stocks with ${threshold}%+ gain.`
            : `😊 No stocks with ${threshold}%+ loss.`;
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">${msg}</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(item => {
        const isProfit = type === 'buy';
        const sign = isProfit ? '+' : '';
        const glValue = item.unrealizedGL;
        const percent = item.unrealizedPercent;
        const color = isProfit ? '#10b981' : '#ef4444';

        html += `<tr>
            <td style="padding: 10px; font-weight: bold; cursor: pointer; color: var(--primary-color); text-decoration: underline;"
                onclick="window.openStockDetailModal('${item.ticker}')">${item.ticker}</td>
            <td style="padding: 10px; text-align: right;">৳${item.avgBuy.toFixed(2)}</td>
            <td style="padding: 10px; text-align: right;">${item.qty}</td>
            <td style="padding: 10px; text-align: right; color: ${color}; font-weight: 600;">
                ${sign}৳${glValue.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}
            </td>
            <td style="padding: 10px; text-align: right; color: ${color}; font-weight: 600;">
                ${sign}${percent.toFixed(2)}%
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

export function initSuggestionEvents() {
    const input = document.getElementById('suggestion-threshold');
    const applyBtn = document.getElementById('suggestion-apply-btn');
    if (!input || !applyBtn) return;

    applyBtn.addEventListener('click', function() {
        const val = parseFloat(input.value) || 50;
        const portfolioId = document.getElementById('suggestion-portfolio-select')?.value || null;
        loadSuggestionData(val, portfolioId);
    });

    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = parseFloat(this.value) || 50;
            const portfolioId = document.getElementById('suggestion-portfolio-select')?.value || null;
            loadSuggestionData(val, portfolioId);
        }
    });

    input.addEventListener('change', function() {
        const val = parseFloat(this.value) || 50;
        const portfolioId = document.getElementById('suggestion-portfolio-select')?.value || null;
        loadSuggestionData(val, portfolioId);
    });
}

console.log('✅ trade-suggestion.js loaded');