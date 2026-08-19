// ==========================================
// 📁 ui-helpers.js - UI Helper Functions
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, debounce, getBangladeshDateString, formatDisplayTime, toBangladeshTime } from './core.js';
import { unifiedEngine } from './app-dashboard.js';
import { showToast } from './app-charts.js';

// ==========================================
// Theme Functions
// ==========================================
// ==========================================
// 🔐 লগইন UI ইনিশিয়ালাইজেশন
// ==========================================

export function initLoginUI() {
    console.log('🔐 initLoginUI called');

    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const btnLogin = document.getElementById('btn-login');
    const btnSignup = document.getElementById('btn-signup');
    const btnLogout = document.getElementById('btn-logout');
    const authError = document.getElementById('auth-error');
    const authTitle = document.getElementById('auth-title');
    const toggleAuthText = document.getElementById('toggle-auth-text');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');

    if (!btnLogin) {
        console.warn('⚠️ btnLogin not found');
        return;
    }

    let isLoginMode = true;

    // ─── টগল লগইন/সাইনআপ ──────────────────────────
    if (toggleAuthText) {
        toggleAuthText.addEventListener('click', function() {
            isLoginMode = !isLoginMode;
            if (authError) authError.innerText = "";
            if (isLoginMode) {
                if (authTitle) authTitle.innerText = "Portfolio Login";
                if (btnLogin) btnLogin.classList.remove('hidden');
                if (btnSignup) btnSignup.classList.add('hidden');
                toggleAuthText.innerText = "Don't have an account? Register here";
            } else {
                if (authTitle) authTitle.innerText = "Portfolio Register";
                if (btnLogin) btnLogin.classList.add('hidden');
                if (btnSignup) btnSignup.classList.remove('hidden');
                toggleAuthText.innerText = "Already have an account? Login here";
            }
        });
    }

    // ─── লগইন ──────────────────────────────────────
    if (btnLogin) {
        btnLogin.addEventListener('click', function() {
            console.log('🔑 Login button clicked');
            if (authError) authError.innerText = "";
            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            if (!email || !password) {
                if (authError) authError.innerText = "দয়া করে ইমেইল এবং পাসওয়ার্ড দুটিই দিন।";
                return;
            }
            if (typeof auth !== 'undefined' && auth) {
                auth.signInWithEmailAndPassword(email, password)
                    .then(() => {
                        console.log('✅ Login successful');
                    })
                    .catch((error) => {
                        if (authError) {
                            if (error.code === 'auth/user-not-found') {
                                authError.innerText = "এই ইমেইলে কোনো অ্যাকাউন্ট নেই।";
                            } else if (error.code === 'auth/wrong-password') {
                                authError.innerText = "ভুল পাসওয়ার্ড!";
                            } else {
                                authError.innerText = "লগইন ব্যর্থ: " + error.message;
                            }
                        }
                    });
            } else {
                if (authError) authError.innerText = "Firebase Auth not initialized.";
            }
        });
    }

    // ─── সাইনআপ ──────────────────────────────────────
    if (btnSignup) {
        btnSignup.addEventListener('click', function() {
            console.log('🔑 Signup button clicked');
            if (authError) authError.innerText = "";
            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            if (!email || !password) {
                if (authError) authError.innerText = "দয়া করে ইমেইল এবং পাসওয়ার্ড দুটিই দিন।";
                return;
            }
            if (password.length < 6) {
                if (authError) authError.innerText = "পাসওয়ার্ড অন্তত ৬ ডিজিটের হতে হবে।";
                return;
            }
            if (typeof auth !== 'undefined' && auth) {
                auth.createUserWithEmailAndPassword(email, password)
                    .then(() => {
                        console.log('✅ Signup successful');
                        if (typeof showToast === 'function') {
                            showToast('✅ Account created! Please login.', 'success');
                        }
                        if (toggleAuthText) toggleAuthText.click();
                    })
                    .catch((error) => {
                        if (authError) {
                            if (error.code === 'auth/email-already-in-use') {
                                authError.innerText = "এই ইমেইল ইতিমধ্যে ব্যবহার করা হয়েছে।";
                            } else {
                                authError.innerText = "অ্যাকাউন্ট তৈরি ব্যর্থ: " + error.message;
                            }
                        }
                    });
            } else {
                if (authError) authError.innerText = "Firebase Auth not initialized.";
            }
        });
    }

    // ─── লগআউট ──────────────────────────────────────
    if (btnLogout) {
        btnLogout.addEventListener('click', function() {
            if (typeof auth !== 'undefined' && auth) {
                auth.signOut();
            }
        });
    }

    console.log('✅ Login UI initialized');
}

export function toggleDarkMode() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('theme', newTheme); } catch(e) {}
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    if (text) text.textContent = newTheme === 'dark' ? 'Light' : 'Dark';
    if (typeof updateChartColors === 'function') updateChartColors();
}

export function loadSavedTheme() {
    let theme = 'light';
    try {
        const saved = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = saved || (prefersDark ? 'dark' : 'light');
    } catch(e) {}
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (text) text.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

// ==========================================
// Sidebar & Tab Functions
// ==========================================

export function toggleLeftSidebar() {
    const sidebar = document.getElementById('left-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    const isOpen = sidebar.classList.contains('active');
    if (isOpen) {
        sidebar.classList.remove('active');
        overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    } else {
        sidebar.classList.add('active');
        overlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

export function toggleRightSidebar() {
    const rightSidebar = document.getElementById('right-sidebar');
    if (rightSidebar) rightSidebar.classList.toggle('active');
}

export function switchTab(tabName) {
    // Clear intervals
    if (window.portfolioAnalysisInterval) {
        clearInterval(window.portfolioAnalysisInterval);
        window.portfolioAnalysisInterval = null;
    }
    if (window.stockTableRefreshInterval) {
        clearInterval(window.stockTableRefreshInterval);
        window.stockTableRefreshInterval = null;
    }
    if (window.autoRefreshInterval) {
        clearInterval(window.autoRefreshInterval);
        window.autoRefreshInterval = null;
    }

    // Hide all tab contents
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(content => content.classList.add('hidden'));

    // Remove active from menu items
    const menuItems = document.querySelectorAll('.left-sidebar ul li');
    menuItems.forEach(item => item.classList.remove('active'));

    // Show selected tab
    const activeSection = document.getElementById(`sec-${tabName}`);
    if (activeSection) {
        activeSection.classList.remove('hidden');
    }

    if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('active');
    }

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) return;

    setTimeout(() => {
        try {
            switch (tabName) {
                case 'dashboard':
                    if (typeof loadDashboardData === 'function') loadDashboardData(null, true);
                    break;
                case 'portfolio-analysis':
                    if (typeof loadPortfolioAnalysisTable === 'function') loadPortfolioAnalysisTable(user.uid, null, true);
                    break;
                case 'table':
                    if (typeof loadUnifiedStockTable === 'function') {
                        const pid = document.getElementById('stock-table-portfolio-select')?.value || null;
                        loadUnifiedStockTable(user.uid, pid === 'grand' ? null : pid);
                    }
                    break;
                case 'suggestion':
                    const threshold = document.getElementById('suggestion-threshold')?.value || 50;
                    const sugPid = document.getElementById('suggestion-portfolio-select')?.value || null;
                    if (typeof loadSuggestionData === 'function') {
                        loadSuggestionData(parseFloat(threshold), sugPid === 'grand' ? null : sugPid);
                    }
                    break;
                case 'dividend':
                    const divPid = document.getElementById('dividend-portfolio-select')?.value || null;
                    if (typeof loadDividendData === 'function') loadDividendData(divPid === 'grand' ? null : divPid);
                    break;
                case 'all-scanner':
                    if (typeof loadAllScannerPage === 'function') loadAllScannerPage();
                    break;
                case 'smart-signals':
                    if (typeof loadSmartSignalsPage === 'function') loadSmartSignalsPage();
                    break;
                case 'market-watch':
                    if (typeof loadMarketWatchPage === 'function') loadMarketWatchPage();
                    break;
                case 'deep-analysis':
                    if (typeof loadDeepAnalysisPage === 'function') {
                        const daPid = document.getElementById('deep-analysis-portfolio-select')?.value || null;
                        window._deepAnalysisPortfolio = daPid === 'grand' ? null : daPid;
                        loadDeepAnalysisPage();
                    }
                    break;
                case 'history':
    if (typeof window.loadPortfolioHistory === 'function') {
        window.loadPortfolioHistory();
    }
    break;
                case 'trade-history':
    if (typeof window.loadTradeHistory === 'function') {
        window.loadTradeHistory();
    }
    break;
                case 'analysis':
    if (typeof window.initAnalysisSearch === 'function') {
        window.initAnalysisSearch();
    }
    break;

case 'statement':
    if (typeof window.initStatementSearch === 'function') {
        window.initStatementSearch();
    }
    break;
                default:
                    break;
            }
        } catch (error) {
            console.error(`Error loading tab "${tabName}":`, error);
        }
    }, 300);
}

// ==========================================
// Commission Settings
// ==========================================

export function toggleCommissionSettings() {
    const panel = document.getElementById('commission-panel');
    if (panel) panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}

export function saveCommissionSettings() {
    const percentInput = document.getElementById('commission-percent');
    const percent = parseFloat(percentInput?.value) || 0;
    if (typeof commissionManager !== 'undefined' && commissionManager) {
        commissionManager.updatePercent(percent);
    }
    showToast(`Commission set to ${percent}%`, 'success');
    if (auth && auth.currentUser) {
        if (typeof loadDashboardData === 'function') loadDashboardData();
        if (typeof loadUnifiedStockTable === 'function') loadUnifiedStockTable(auth.currentUser.uid);
    }
    const panel = document.getElementById('commission-panel');
    if (panel) panel.style.display = 'none';
}

export function resetCommissionSettings() {
    if (typeof commissionManager !== 'undefined' && commissionManager) {
        commissionManager.updatePercent(0);
    }
    const percentInput = document.getElementById('commission-percent');
    if (percentInput) percentInput.value = 0;
    showToast('Commission reset to 0%', 'info');
    if (auth && auth.currentUser) {
        if (typeof loadDashboardData === 'function') loadDashboardData();
        if (typeof loadUnifiedStockTable === 'function') loadUnifiedStockTable(auth.currentUser.uid);
    }
    const panel = document.getElementById('commission-panel');
    if (panel) panel.style.display = 'none';
}

// ==========================================
// Dashboard Search
// ==========================================

export function initDashboardSearch() {
    const searchInput = document.getElementById('dashboard-search-input');
    const suggestionsBox = document.getElementById('dashboard-search-suggestions');
    if (!searchInput || !suggestionsBox) return;

    const debouncedSearch = debounce(function(query) {
        suggestionsBox.innerHTML = '';
        if (!query) { suggestionsBox.classList.add('hidden'); return; }
        const filtered = dseStocks.filter(s => s.startsWith(query));
        if (filtered.length > 0) {
            suggestionsBox.classList.remove('hidden');
            filtered.slice(0, 15).forEach(stock => {
                const div = document.createElement('div');
                div.classList.add('suggestion-item');
                div.innerText = stock;
                div.addEventListener('click', function() {
                    searchInput.value = stock;
                    suggestionsBox.classList.add('hidden');
                    if (typeof openStockDetailModal === 'function') openStockDetailModal(stock);
                });
                suggestionsBox.appendChild(div);
            });
        } else {
            suggestionsBox.classList.add('hidden');
        }
    }, 300);

    searchInput.addEventListener('input', function() {
        debouncedSearch(this.value.trim().toUpperCase());
    });

    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.add('hidden');
        }
    });

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = suggestionsBox.querySelector('.suggestion-item');
            if (first) first.click();
        }
    });
}

// ==========================================
// Backup/Restore
// ==========================================

export function downloadPortfolioData() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) { showToast('Please login first', 'error'); return; }
    if (!confirm("আপনার পোর্টফোলিও ডাটা ব্যাকআপ ডাউনলোড করতে চান?")) return;
    const loadingBtn = document.getElementById('btn-download-data');
    const originalText = loadingBtn ? loadingBtn.innerText : "ডাউনলোড";
    if (loadingBtn) { loadingBtn.innerText = "⏳ লোড হচ্ছে..."; loadingBtn.disabled = true; }
    try {
        if (typeof db === 'undefined') { showToast('Firebase not available', 'error'); return; }
        db.collection('portfolios').where('userId', '==', user.uid).get().then(buySnapshot => {
            db.collection('sales_history').where('userId', '==', user.uid).get().then(sellSnapshot => {
                const buyData = [];
                buySnapshot.forEach(doc => {
                    const d = doc.data();
                    buyData.push({
                        shareName: d.shareName,
                        quantity: d.quantity,
                        buyPrice: d.buyPrice,
                        date: d.date?.toDate?.().toISOString() || new Date().toISOString(),
                        type: "BUY"
                    });
                });
                const sellData = [];
                sellSnapshot.forEach(doc => {
                    const d = doc.data();
                    sellData.push({
                        shareName: d.shareName,
                        quantitySold: d.quantitySold,
                        sellPrice: d.sellPrice,
                        buyPrice: d.buyPrice,
                        profitOrLoss: d.profitOrLoss,
                        date: d.date?.toDate?.().toISOString() || new Date().toISOString()
                    });
                });
                const backupData = {
                    version: "1.1",
                    downloadedAt: new Date().toISOString(),
                    buyTransactions: buyData,
                    sellTransactions: sellData
                };
                const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `portfolio_${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
                showToast(`✅ ${buyData.length + sellData.length} records downloaded!`, 'success');
                if (loadingBtn) { loadingBtn.innerText = originalText; loadingBtn.disabled = false; }
            });
        });
    } catch (e) {
        console.error(e);
        showToast('Backup failed', 'error');
        if (loadingBtn) { loadingBtn.innerText = originalText; loadingBtn.disabled = false; }
    }
}

export function uploadPortfolioData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) { showToast('Please login first', 'error'); return; }
    if (!confirm("ফাইল আপলোড করবেন?")) { event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.buyTransactions || !data.sellTransactions) throw new Error("ভুল ফাইল ফরম্যাট!");
            if (typeof db === 'undefined') { showToast('Firebase not available', 'error'); return; }
            const batch = db.batch();
            data.buyTransactions.forEach(item => {
                if (item.shareName) batch.set(db.collection('portfolios').doc(), {
                    userId: user.uid,
                    shareName: item.shareName,
                    quantity: Number(item.quantity),
                    buyPrice: Number(item.buyPrice),
                    type: "BUY",
                    date: new Date(item.date),
                    createdAt: new Date()
                });
            });
            data.sellTransactions.forEach(item => {
                if (item.shareName) batch.set(db.collection('sales_history').doc(), {
                    userId: user.uid,
                    shareName: item.shareName,
                    quantitySold: Number(item.quantitySold),
                    sellPrice: Number(item.sellPrice),
                    buyPrice: Number(item.buyPrice),
                    profitOrLoss: Number(item.profitOrLoss),
                    date: new Date(item.date),
                    createdAt: new Date()
                });
            });
            await batch.commit();
            showToast('✅ Data restored successfully!', 'success');
            location.reload();
        } catch (err) {
            console.error(err);
            showToast('❌ Upload failed: ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// ==========================================
// Floating Loader
// ==========================================

export function showFloatingLoader(text = 'Loading...', subText = 'Please wait') {
    const loader = document.getElementById('floating-loader');
    const overlay = document.getElementById('loader-overlay');
    const statusText = document.getElementById('loader-status-text');
    const subTextEl = document.getElementById('loader-sub-text');
    if (loader) {
        loader.style.display = 'flex';
        if (statusText) statusText.innerText = text;
        if (subTextEl) subTextEl.innerText = subText;
    }
    if (overlay) overlay.style.display = 'block';
}

export function hideFloatingLoader() {
    const loader = document.getElementById('floating-loader');
    const overlay = document.getElementById('loader-overlay');
    if (loader) loader.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
}

// ==========================================
// Screener Dropdown
// ==========================================

export function toggleScreenerDropdown() {
    const dropdown = document.getElementById('screener-dropdown');
    const arrow = document.getElementById('screener-arrow');
    if (!dropdown) return;
    if (dropdown.style.display === 'none' || dropdown.style.display === '') {
        dropdown.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
    } else {
        dropdown.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    }
}

// ==========================================
// Delete Portfolio Confirmation
// ==========================================

export function confirmAndDeletePortfolio() {
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) { showToast('Please login first', 'error'); return; }
    if (!confirm("সতর্কতা! আপনি কি আপনার পোর্টফোলিওর সমস্ত ডাটা মুছে ফেলতে চান?")) return;
    if (!confirm("আপনি কি আসলেই সম্পূর্ণ পোর্টফোলিও ডিলিট করতে নিশ্চিত?")) return;
    try {
        if (typeof db === 'undefined') { showToast('Firebase not available', 'error'); return; }
        showToast('⏳ Deleting portfolio...', 'info');
        db.collection("portfolios").where("userId", "==", user.uid).get().then(buySnapshot => {
            db.collection("sales_history").where("userId", "==", user.uid).get().then(sellSnapshot => {
                const batch = db.batch();
                buySnapshot.forEach(doc => batch.delete(db.collection("portfolios").doc(doc.id)));
                sellSnapshot.forEach(doc => batch.delete(db.collection("sales_history").doc(doc.id)));
                batch.commit().then(() => {
                    showToast('✅ Portfolio deleted successfully!', 'success');
                    window.location.reload();
                });
            });
        });
    } catch (error) {
        console.error(error);
        showToast('❌ Failed to delete portfolio', 'error');
    }
}

// ==========================================
// Data Mode Switch
// ==========================================

export let currentDataMode = localStorage.getItem('dataMode') || 'firebase';

export async function setDatabaseMode() {
    try {
        if (currentDataMode === 'database') return;
        currentDataMode = 'database';
        window.currentDataMode = 'database';
        localStorage.setItem('dataMode', 'database');
        showToast('💾 Switching to Database Mode...', 'info');
        const dbBtn = document.getElementById('btn-database-mode');
        const liveBtn = document.getElementById('btn-live-mode');
        if (dbBtn) { dbBtn.classList.add('active'); dbBtn.style.background = 'var(--primary-color)'; dbBtn.style.color = 'white'; }
        if (liveBtn) { liveBtn.classList.remove('active'); liveBtn.style.background = 'transparent'; liveBtn.style.color = 'var(--text-primary)'; }
        const user = auth?.currentUser;
        if (user) {
            if (typeof loadDashboardData === 'function') await loadDashboardData(null, true);
            showToast('✅ Database mode activated', 'success');
        }
    } catch (error) {
        console.error('Database mode error:', error);
        showToast('❌ Failed to switch', 'error');
    }
}

export async function setLiveDataMode() {
    try {
        if (currentDataMode === 'live') return;
        currentDataMode = 'live';
        window.currentDataMode = 'live';
        localStorage.setItem('dataMode', 'live');
        showToast('📡 Switching to Live Data...', 'info');
        const dbBtn = document.getElementById('btn-database-mode');
        const liveBtn = document.getElementById('btn-live-mode');
        if (liveBtn) { liveBtn.classList.add('active'); liveBtn.style.background = 'var(--primary-color)'; liveBtn.style.color = 'white'; }
        if (dbBtn) { dbBtn.classList.remove('active'); dbBtn.style.background = 'transparent'; dbBtn.style.color = 'var(--text-primary)'; }
        const user = auth?.currentUser;
        if (user) {
            if (typeof loadLiveDashboardData === 'function') await loadLiveDashboardData();
            showToast('✅ Live mode activated', 'success');
        }
    } catch (error) {
        console.error('Live mode error:', error);
        showToast('❌ Failed to switch', 'error');
    }
}

console.log('✅ ui-helpers.js loaded');