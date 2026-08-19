// ==========================================
// 📂 portfolio-manager.js - Portfolio Manager
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';
import { getLatestAndPreviousPrices } from './core.js';

let currentPortfolioMeta = null;
let portfolioSummaries = {};
let currentSelectedPortfolio = 'main';

// ==========================================
// Open/Close Portfolio Manager
// ==========================================

export function openPortfolioManager() {
    const modal = document.getElementById('portfolio-manager-modal');
    if (!modal) {
        console.warn('⚠️ portfolio-manager-modal not found');
        return;
    }
    const user = auth.currentUser;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    modal.style.display = 'flex';
    loadPortfolioManagerData();
}

export function closePortfolioManager() {
    const modal = document.getElementById('portfolio-manager-modal');
    if (modal) modal.style.display = 'none';
}

// ==========================================
// Load Portfolio Manager Data
// ==========================================

export async function loadPortfolioManagerData() {
    const user = auth.currentUser;
    if (!user) return;
    const grid = document.getElementById('portfolio-cards-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">⏳ Loading portfolios...</div>';

    try {
        const meta = await getPortfolioMeta(user.uid);
        currentPortfolioMeta = meta;

        let allSales = [];
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('sales_history')
                    .select('profit_or_loss, portfolio_id')
                    .eq('user_id', user.uid);
                if (!error && data) allSales = data;
            } catch (e) {}
        }
        if (allSales.length === 0 && typeof db !== 'undefined') {
            try {
                const snap = await db.collection('sales_history')
                    .where('userId', '==', user.uid)
                    .get();
                snap.forEach(doc => {
                    const d = doc.data();
                    allSales.push({
                        profit_or_loss: d.profitOrLoss || 0,
                        portfolio_id: d.portfolioId || 'main'
                    });
                });
            } catch (e) {}
        }

        const realizedMap = new Map();
        allSales.forEach(sale => {
            const pid = sale.portfolio_id || 'main';
            const pl = parseFloat(sale.profit_or_loss) || 0;
            realizedMap.set(pid, (realizedMap.get(pid) || 0) + pl);
        });

        const summaries = {};
        for (const p of meta.portfolios) {
            const data = await unifiedEngine.calculate(user.uid, p.id, true);
            if (data) {
                const realized = realizedMap.get(p.id) || 0;
                let dailyGL = 0, totalGL = 0, totalCurrentValue = 0;
                const tickers = data.stockDetails.map(s => s.ticker);
                if (tickers.length > 0) {
                    const priceMap = await getLatestAndPreviousPrices(tickers);
                    for (const stock of data.stockDetails) {
                        const priceData = priceMap.get(stock.ticker);
                        const currentPrice = priceData?.currentPrice || 0;
                        const prevPrice = priceData?.previousPrice || 0;
                        const qty = stock.totalQty || 0;
                        const cost = stock.totalCost || 0;
                        const currentValue = qty * currentPrice;
                        totalCurrentValue += currentValue;
                        const gl = currentValue - cost;
                        totalGL += gl;
                        if (prevPrice > 0 && qty > 0) {
                            dailyGL += qty * (currentPrice - prevPrice);
                        }
                    }
                } else {
                    totalCurrentValue = data.totalInvestment || 0;
                }
                summaries[p.id] = {
                    name: p.name,
                    type: p.type,
                    isDefault: p.isDefault || false,
                    totalInvestment: data.totalInvestment || 0,
                    totalCurrentValue: totalCurrentValue,
                    totalQty: data.totalRemainingQty || 0,
                    realized: realized,
                    dailyGL: dailyGL,
                    totalGL: totalGL,
                };
            }
        }
        portfolioSummaries = summaries;

        // Grand Total
        const grandData = await unifiedEngine.calculate(user.uid, null, true);
        if (grandData) {
            let grandRealized = 0;
            for (const p of meta.portfolios) {
                grandRealized += realizedMap.get(p.id) || 0;
            }
            let grandDailyGL = 0, grandTotalGL = 0, grandTotalCurrentValue = 0;
            const tickers = grandData.stockDetails.map(s => s.ticker);
            if (tickers.length > 0) {
                const priceMap = await getLatestAndPreviousPrices(tickers);
                for (const stock of grandData.stockDetails) {
                    const priceData = priceMap.get(stock.ticker);
                    const currentPrice = priceData?.currentPrice || 0;
                    const prevPrice = priceData?.previousPrice || 0;
                    const qty = stock.totalQty || 0;
                    const cost = stock.totalCost || 0;
                    const currentValue = qty * currentPrice;
                    grandTotalCurrentValue += currentValue;
                    const gl = currentValue - cost;
                    grandTotalGL += gl;
                    if (prevPrice > 0 && qty > 0) {
                        grandDailyGL += qty * (currentPrice - prevPrice);
                    }
                }
            } else {
                grandTotalCurrentValue = grandData.totalInvestment || 0;
            }
            summaries['grand'] = {
                name: '📊 Grand Portfolio',
                type: 'main',
                isDefault: true,
                totalInvestment: grandData.totalInvestment || 0,
                totalCurrentValue: grandTotalCurrentValue,
                totalQty: grandData.totalRemainingQty || 0,
                realized: grandRealized,
                dailyGL: grandDailyGL,
                totalGL: grandTotalGL,
            };
        }

        renderPortfolioCards();
        updateAllPortfolioSelectors();
        updateSidebarPortfolioList();
        updateBuyPortfolioSelect();

    } catch (error) {
        console.error('Error loading portfolio manager:', error);
        grid.innerHTML = `<div style="text-align: center; padding: 40px; color: red;">❌ Error loading portfolios</div>`;
    }
}

// ==========================================
// Render Portfolio Cards
// ==========================================

export function renderPortfolioCards() {
    const grid = document.getElementById('portfolio-cards-grid');
    if (!grid) return;
    if (!currentPortfolioMeta || !currentPortfolioMeta.portfolios) {
        grid.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No portfolios found.</div>';
        return;
    }
    let html = '';
    const grand = portfolioSummaries['grand'];
    if (grand) {
        html += createPortfolioCardHTML('grand', grand);
    }
    for (const p of currentPortfolioMeta.portfolios) {
        const summary = portfolioSummaries[p.id];
        if (summary) {
            html += createPortfolioCardHTML(p.id, summary);
        }
    }
    grid.innerHTML = html;
}

function createPortfolioCardHTML(portfolioId, summary) {
    const isMain = portfolioId === 'grand' || summary.type === 'main';
    const isActive = summary.totalQty > 0;
    const totalInvestment = summary.totalInvestment || 0;
    const totalCurrentValue = summary.totalCurrentValue || 0;
    const dailyGL = summary.dailyGL || 0;
    const totalGL = summary.totalGL || 0;
    const realized = summary.realized || 0;
    const dailyColor = dailyGL >= 0 ? '#10b981' : '#ef4444';
    const totalColor = totalGL >= 0 ? '#10b981' : '#ef4444';
    const realizedColor = realized >= 0 ? '#10b981' : '#ef4444';
    const name = summary.name || (portfolioId === 'grand' ? '📊 Grand Portfolio' : portfolioId);
    const badgeMain = isMain ? '<span class="card-badge card-badge-main">MAIN</span>' : '';
    const badgeStatus = isActive ? '<span class="card-badge card-badge-active">🟢 Active</span>' : '<span class="card-badge card-badge-empty">⚪ Empty</span>';
    const deleteBtn = !isMain ? `<button class="btn-delete" onclick="window.deletePortfolioHandler('${portfolioId}')" ${isActive ? 'disabled' : ''}>🗑️ DELETE</button>` : '';
    const editBtn = !isMain ? `<button class="btn-edit" onclick="window.editPortfolioHandler('${portfolioId}')">✏️ EDIT</button>` : '';

    return `
        <div class="portfolio-card" style="${isMain ? 'border-left: 4px solid var(--primary-color);' : ''}">
            <div class="card-header">
                <div>
                    <span class="card-name">${name}</span>
                    ${badgeMain}
                    <div style="margin-top: 4px;">${badgeStatus}</div>
                </div>
                <span style="font-size: 12px; color: var(--text-muted);">${summary.totalQty || 0} shares</span>
            </div>
            <div class="card-stats">
                <div>
                    <div class="stat-label">Port Size</div>
                    <div class="stat-value">৳${totalInvestment.toFixed(2)}</div>
                </div>
                <div>
                    <div class="stat-label">Realized Gain</div>
                    <div class="stat-value" style="color: ${realizedColor};">${realized >= 0 ? '+' : ''}৳${realized.toFixed(2)}</div>
                </div>
            </div>
            <div class="card-pl-grid">
                <div>
                    <div class="pl-label">Value/Cost</div>
                    <div class="pl-value">${totalCurrentValue.toFixed(0)}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">/${totalInvestment.toFixed(0)}</div>
                </div>
                <div>
                    <div class="pl-label">Daily G/L</div>
                    <div class="pl-value" style="color: ${dailyColor};">${dailyGL >= 0 ? '+' : ''}${dailyGL.toFixed(2)}</div>
                </div>
                <div>
                    <div class="pl-label">Total G/L</div>
                    <div class="pl-value" style="color: ${totalColor};">${totalGL >= 0 ? '+' : ''}${totalGL.toFixed(2)}</div>
                </div>
            </div>
            <div class="card-actions">
                ${deleteBtn}
                ${editBtn}
                <button class="btn-access" onclick="window.accessPortfolioHandler('${portfolioId}')">🔍 ACCESS</button>
            </div>
        </div>
    `;
}

// ==========================================
// Portfolio Actions
// ==========================================

export async function deletePortfolioHandler(portfolioId) {
    if (portfolioId === 'main' || portfolioId === 'grand') {
        showToast('Cannot delete main portfolio', 'warning');
        return;
    }
    const name = getPortfolioNameFromMeta(portfolioId);
    if (!confirm(`Are you sure you want to delete portfolio "${name}"?`)) return;
    const user = auth.currentUser;
    if (!user) return;
    const success = await deletePortfolio(user.uid, portfolioId);
    if (success) {
        showToast('✅ Portfolio deleted successfully', 'success');
        await loadPortfolioManagerData();
        updateAllPortfolioSelectors();
    } else {
        showToast('❌ Cannot delete: portfolio may have shares', 'error');
    }
}

export function editPortfolioHandler(portfolioId) {
    const currentName = getPortfolioNameFromMeta(portfolioId);
    const newName = prompt('Enter new portfolio name:', currentName);
    if (newName && newName.trim() && newName.trim() !== currentName) {
        renamePortfolioHandler(portfolioId, newName.trim());
    }
}

async function renamePortfolioHandler(portfolioId, newName) {
    const user = auth.currentUser;
    if (!user) return;
    const success = await renamePortfolio(user.uid, portfolioId, newName);
    if (success) {
        showToast('✅ Portfolio renamed successfully', 'success');
        await loadPortfolioManagerData();
        updateAllPortfolioSelectors();
    } else {
        showToast('❌ Failed to rename portfolio', 'error');
    }
}

export function accessPortfolioHandler(portfolioId) {
    closePortfolioManager();
    if (typeof switchTab === 'function') switchTab('portfolio-analysis');
    currentSelectedPortfolio = portfolioId;
    const user = auth.currentUser;
    if (user && typeof loadPortfolioAnalysisTable === 'function') {
        loadPortfolioAnalysisTable(user.uid, portfolioId === 'grand' ? null : portfolioId, true);
    }
}

// ==========================================
// Helper Functions
// ==========================================

function getPortfolioNameFromMeta(portfolioId) {
    if (!currentPortfolioMeta) return portfolioId === 'grand' ? '📊 Grand Portfolio' : portfolioId;
    const found = currentPortfolioMeta.portfolios.find(p => p.id === portfolioId);
    return found ? found.name : (portfolioId === 'grand' ? '📊 Grand Portfolio' : portfolioId);
}

// ==========================================
// Portfolio Meta Functions
// ==========================================

export async function getPortfolioMeta(userId) {
    if (!userId) return { portfolios: [] };
    try {
        if (typeof db !== 'undefined') {
            const doc = await db.collection('portfolios_meta').doc(userId).get();
            if (doc.exists) return doc.data();
        }
        const defaultMeta = {
            portfolios: [
                { id: 'main', name: '📊 Main Portfolio', type: 'main', isDefault: true, createdAt: new Date().toISOString() }
            ]
        };
        if (typeof db !== 'undefined') {
            await db.collection('portfolios_meta').doc(userId).set(defaultMeta);
        }
        return defaultMeta;
    } catch (e) {
        console.error('Error getting portfolio meta:', e);
        return { portfolios: [{ id: 'main', name: '📊 Main Portfolio', type: 'main', isDefault: true }] };
    }
}

export async function updatePortfolioMeta(userId, meta) {
    if (!userId || !meta) return false;
    try {
        if (typeof db !== 'undefined') {
            await db.collection('portfolios_meta').doc(userId).set(meta, { merge: true });
            return true;
        }
        return false;
    } catch (e) {
        console.error('Error updating portfolio meta:', e);
        return false;
    }
}

export async function createPortfolio(userId, name) {
    if (!userId || !name || !name.trim()) return null;
    const meta = await getPortfolioMeta(userId);
    const id = 'sub_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    meta.portfolios.push({
        id,
        name: name.trim(),
        type: 'sub',
        isDefault: false,
        createdAt: new Date().toISOString()
    });
    const success = await updatePortfolioMeta(userId, meta);
    return success ? id : null;
}

export async function deletePortfolio(userId, portfolioId) {
    if (!userId || !portfolioId || portfolioId === 'main') return false;
    if (typeof db !== 'undefined') {
        const snap = await db.collection('portfolios')
            .where('userId', '==', userId)
            .where('portfolioId', '==', portfolioId)
            .get();
        if (!snap.empty) {
            let totalQty = 0;
            snap.forEach(doc => totalQty += doc.data().quantity || 0);
            if (totalQty > 0) return false;
        }
    }
    const meta = await getPortfolioMeta(userId);
    meta.portfolios = meta.portfolios.filter(p => p.id !== portfolioId);
    return await updatePortfolioMeta(userId, meta);
}

export async function renamePortfolio(userId, portfolioId, newName) {
    if (!userId || !portfolioId || !newName || !newName.trim()) return false;
    if (portfolioId === 'main') return false;
    const meta = await getPortfolioMeta(userId);
    const portfolio = meta.portfolios.find(p => p.id === portfolioId);
    if (!portfolio) return false;
    portfolio.name = newName.trim();
    return await updatePortfolioMeta(userId, meta);
}

// ==========================================
// Update Selectors
// ==========================================

export function updateAllPortfolioSelectors() {
    const selectors = document.querySelectorAll('[id$="-portfolio-select"]');
    selectors.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '';
        const grandOption = document.createElement('option');
        grandOption.value = 'grand';
        grandOption.textContent = '📊 Grand Portfolio';
        select.appendChild(grandOption);
        const mainOption = document.createElement('option');
        mainOption.value = 'main';
        mainOption.textContent = '📊 Main Portfolio';
        select.appendChild(mainOption);
        if (currentPortfolioMeta && currentPortfolioMeta.portfolios) {
            currentPortfolioMeta.portfolios.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            });
        }
        if (currentValue) select.value = currentValue;
    });
}

export function updateSidebarPortfolioList() {
    const subList = document.getElementById('portfolio-sub-list');
    if (!subList) return;
    if (!currentPortfolioMeta || !currentPortfolioMeta.portfolios) {
        subList.innerHTML = '';
        return;
    }
    let html = '';
    for (const p of currentPortfolioMeta.portfolios) {
        const isActive = currentSelectedPortfolio === p.id;
        html += `<li onclick="window.switchToPortfolio('${p.id}')" style="padding: 6px 16px; border-radius: 4px; cursor: pointer; ${isActive ? 'background: var(--sidebar-active); color: white;' : ''}">${p.name}</li>`;
    }
    subList.innerHTML = html;
}

export function updateBuyPortfolioSelect() {
    const select = document.getElementById('buy-portfolio-select');
    if (!select) return;
    if (!currentPortfolioMeta || !currentPortfolioMeta.portfolios) {
        select.innerHTML = '<option value="main">📊 Main Portfolio</option>';
        return;
    }
    let html = '';
    for (const p of currentPortfolioMeta.portfolios) {
        const selected = (currentSelectedPortfolio === p.id) ? 'selected' : '';
        html += `<option value="${p.id}" ${selected}>${p.name}</option>`;
    }
    select.innerHTML = html;
}

// ==========================================
// Switch Portfolio
// ==========================================

export function switchToPortfolio(portfolioId) {
    currentSelectedPortfolio = portfolioId;
    updateSidebarPortfolioList();
    updateBuyPortfolioSelect();
    updateAllPortfolioSelectors();
    const user = auth.currentUser;
    if (user) {
        if (typeof loadDashboardData === 'function') {
            loadDashboardData(portfolioId);
        }
        if (typeof loadPortfolioAnalysisTable === 'function') {
            loadPortfolioAnalysisTable(user.uid, portfolioId === 'grand' ? null : portfolioId, true);
        }
    }
    const name = portfolioId === 'grand' ? 'Grand Portfolio' : getPortfolioNameFromMeta(portfolioId);
    showToast(`Switched to ${name}`, 'info');
}

// ==========================================
// Create New Portfolio
// ==========================================

export function createNewPortfolioFromSidebar() {
    openPortfolioManager();
    const input = document.getElementById('new-portfolio-name-input');
    if (input) input.focus();
}

export async function createNewPortfolio() {
    const input = document.getElementById('new-portfolio-name-input');
    const status = document.getElementById('new-portfolio-status');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        if (status) status.innerText = '⚠️ Please enter a name';
        return;
    }
    const user = auth.currentUser;
    if (!user) {
        showToast('Please login first', 'error');
        return;
    }
    const id = await createPortfolio(user.uid, name);
    if (id) {
        if (status) status.innerText = '✅ Portfolio created!';
        input.value = '';
        showToast(`✅ Portfolio "${name}" created successfully`, 'success');
        await loadPortfolioManagerData();
        updateAllPortfolioSelectors();
        updateSidebarPortfolioList();
        updateBuyPortfolioSelect();
        setTimeout(() => { if (status) status.innerText = ''; }, 3000);
    } else {
        if (status) status.innerText = '❌ Failed to create portfolio';
        showToast('❌ Failed to create portfolio', 'error');
    }
}

// ==========================================
// Toggle Dropdown
// ==========================================

export function togglePortfolioDropdown() {
    const dropdown = document.getElementById('portfolio-dropdown');
    const arrow = document.getElementById('portfolio-arrow');
    if (!dropdown) return;
    if (dropdown.style.display === 'none' || dropdown.style.display === '') {
        dropdown.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
        if (auth.currentUser) {
            loadPortfolioManagerData();
        }
    } else {
        dropdown.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    }
}

console.log('✅ portfolio-manager.js loaded');