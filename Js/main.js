// ==========================================
// 🚀 main.js - ফাইনাল এন্ট্রি পয়েন্ট (সব ফাংশন এক্সপোজ সহ)
//    ডুপ্লিকেট ফাংশন সরানো, অ্যাসাইনমেন্ট অর্ডার ঠিক করা
// ==========================================

// ─── কোর লাইব্রেরি ────────────────────────────────────────
import * as Core from './core.js';
import * as Indicators from './indicators.js';
import CacheManager from './cache.js';
import CONFIG from './config.js';
import { auth, db, firebaseConfig } from './firebase.js';
import { supabase } from './supabase.js';
import * as DataService from './data-service.js';
import './global-fix.js';

// ─── অ্যাপ মডিউল ──────────────────────────────────────────
import * as AppCharts from './app-charts.js';
// AppDashboard থেকে শুধু unifiedEngine ও থিম ফাংশন নিন (loadDashboardData বাদ)
import { unifiedEngine, toggleDarkMode, loadSavedTheme } from './app-dashboard.js';
import * as AppFeatures from './app-features.js';

// ─── অ্যাডভান্সড চার্ট এক্সট্রা ──────────────────────────
import * as AdvChartsExtras from './adv-charts-extras.js';

// ─── ট্রেডিং ──────────────────────────────────────────────
import * as TradeBuy from './trade-buy.js';
import * as TradeSell from './trade-sell.js';
import * as TradeHistory from './trade-history.js';
import * as TradeAnalysis from './trade-analysis.js';
import * as TradeSuggestion from './trade-suggestion.js';
import * as TradeStockTable from './trade-stock-table.js';

// ─── ফিচার মডিউল ──────────────────────────────────────────
import * as Dividend from './dividend.js';
import * as PortfolioManager from './portfolio-manager.js';
import * as Scanner from './scanner.js';
import * as MarketWatch from './marketwatch.js';
import * as DeepAnalysis from './deep-analysis.js';
import * as SmartSignals from './smart-signals.js';
import * as RecordDate from './record-date.js';
import * as Notification from './notification.js';
import * as SyncMetadata from './sync-metadata.js';

// ─── ইউআই হেলপার ─────────────────────────────────────────
import * as UIHelpers from './ui-helpers.js';
import * as UIModals from './ui-modals.js';
import * as UICharts from './ui-charts.js';

// ─── ড্যাশবোর্ড সাব-মডিউল ──────────────────────────────
// গুরুত্বপূর্ণ: DashCards-এ loadDashboardData আছে, যা আমরা শেষমেশ এক্সপোজ করব
import * as DashPerformance from './dash-performance.js';
import * as DashCharts from './dash-charts.js';
import * as DashUtils from './dash-utils.js';
import * as DashSignals from './dash-signals.js';
import * as DashCards from './dash-cards.js';

// ==========================================
// 🌐 সব ফাংশনকে window-এ এক্সপোজ করা (অর্ডার ঠিক করা)
// ==========================================

// ১. কোর ও ইউটিলিটি
Object.assign(window, Core);
window.CacheManager = CacheManager;
window.CONFIG = CONFIG;
window.auth = auth;
window.db = db;
window.supabase = supabase;
window.firebaseConfig = firebaseConfig;

// ২. ইন্ডিকেটর
Object.assign(window, Indicators);


// ৩. অ্যাপ মডিউল (চার্ট, ফিচার) – কিন্তু AppDashboard থেকে শুধু আলাদা করা ফাংশন
Object.assign(window, AppCharts);
Object.assign(window, AppFeatures);
// unifiedEngine ও থিম ফাংশন আলাদাভাবে এক্সপোজ
window.unifiedEngine = unifiedEngine;
window.toggleDarkMode = toggleDarkMode;
window.loadSavedTheme = loadSavedTheme;

// ৪. অ্যাডভান্সড চার্ট এক্সট্রা
Object.assign(window, AdvChartsExtras);

// ৫. ট্রেডিং
Object.assign(window, TradeBuy, TradeSell, TradeHistory, TradeAnalysis, TradeSuggestion, TradeStockTable);

// ৬. অন্যান্য ফিচার
Object.assign(window, Dividend, PortfolioManager, Scanner, MarketWatch, DeepAnalysis, SmartSignals, RecordDate, Notification, SyncMetadata);

// ৭. ইউআই
Object.assign(window, UIHelpers, UIModals, UICharts);

// ৮. ড্যাশবোর্ড সাব-মডিউল – সবশেষে DashCards (যাতে এর loadDashboardData ওভাররাইট করে)
Object.assign(window, DashPerformance, DashCharts, DashUtils, DashSignals, DashCards);
Object.assign(window, DashCards); 
// ==========================================
// ⚠️ নাম সংঘর্ষ সমাধান (ওভাররাইট করা ফাংশন ঠিক করা)
// ==========================================

// toggleDarkMode – ui-helpers.js-এর ফাংশনটিকে অগ্রাধিকার দিন
if (typeof UIHelpers.toggleDarkMode === 'function') {
    window.toggleDarkMode = UIHelpers.toggleDarkMode;
}

// loadSavedTheme – ui-helpers.js-এর ফাংশন
if (typeof UIHelpers.loadSavedTheme === 'function') {
    window.loadSavedTheme = UIHelpers.loadSavedTheme;
}

// switchTab – ui-helpers.js-এর ফাংশন
if (typeof UIHelpers.switchTab === 'function') {
    window.switchTab = UIHelpers.switchTab;
}

// toggleLeftSidebar – ui-helpers.js-এর ফাংশন
if (typeof UIHelpers.toggleLeftSidebar === 'function') {
    window.toggleLeftSidebar = UIHelpers.toggleLeftSidebar;
}

// showToast – app-charts.js-এর ফাংশন
if (typeof AppCharts.showToast === 'function') {
    window.showToast = AppCharts.showToast;
}

// renderCandlestickChart – adv-charts-extras.js থেকে
if (typeof AdvChartsExtras.renderCandlestickChart === 'function') {
    window.renderCandlestickChart = AdvChartsExtras.renderCandlestickChart;
}

// initLoginUI – ui-helpers.js থেকে
if (typeof UIHelpers.initLoginUI === 'function') {
    window.initLoginUI = UIHelpers.initLoginUI;
}

// ==========================================
// 🔐 অথেনটিকেশন স্টেট লিসেনার (গ্লোবাল)
// ==========================================

if (auth && typeof auth.onAuthStateChanged === 'function') {
    auth.onAuthStateChanged(async (user) => {
        const loginContainer = document.getElementById('login-container');
        const appContainer = document.getElementById('app-container');
        const authError = document.getElementById('auth-error');

        if (user) {
            console.log(`✅ User logged in: ${user.email || user.uid}`);
            if (loginContainer) loginContainer.classList.add('hidden');
            if (appContainer) appContainer.classList.remove('hidden');
            if (authError) authError.innerText = '';

            // ড্যাশবোর্ড লোড (এখন DashCards থেকে loadDashboardData আসবে)
            try {
                if (typeof window.loadDashboardData === 'function') {
                    await window.loadDashboardData(null, true);
                }
                if (typeof window.loadUnifiedStockTable === 'function') {
                    await window.loadUnifiedStockTable(user.uid);
                }
                if (typeof window.loadPortfolioAnalysisTable === 'function') {
                    await window.loadPortfolioAnalysisTable(user.uid, null, true);
                }
                if (typeof window.startAutoRefresh === 'function') {
                    window.startAutoRefresh();
                }
                if (typeof window.updateAllPortfolioSelectors === 'function') {
                    await window.updateAllPortfolioSelectors();
                }
                if (typeof window.loadPortfolioManagerData === 'function') {
                    await window.loadPortfolioManagerData();
                }
                console.log('✅ Dashboard loaded successfully');
            } catch (error) {
                console.error('❌ Dashboard load error:', error);
            }

        } else {
            console.log('👤 User logged out');
            if (loginContainer) loginContainer.classList.remove('hidden');
            if (appContainer) appContainer.classList.add('hidden');
            if (authError) authError.innerText = '';
            if (typeof window.stopAutoRefresh === 'function') {
                window.stopAutoRefresh();
            }
            if (CacheManager && typeof CacheManager.clearAll === 'function') {
                CacheManager.clearAll();
            }
        }
    });
} else {
    console.warn('⚠️ Auth not available, state listener skipped.');
}

// ==========================================
// 🚀 অ্যাপ স্টার্ট (DOM রেডি হলে)
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 StockPulse (ES Module) started');

    // থিম লোড
    if (typeof window.loadSavedTheme === 'function') {
        window.loadSavedTheme();
    }

    // 🔐 লগইন UI ইনিশিয়ালাইজ
    if (typeof window.initLoginUI === 'function') {
        window.initLoginUI();
    } else if (typeof UIHelpers.initLoginUI === 'function') {
        UIHelpers.initLoginUI();
        window.initLoginUI = UIHelpers.initLoginUI;
    } else {
        console.warn('⚠️ initLoginUI not found');
    }

    // ─── অ্যাডভান্সড চার্ট পেজের জন্য ──────────────────
    const searchInput = document.getElementById('adv-chart-search');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            if (typeof window.handleSearchInput === 'function') {
                window.handleSearchInput.call(this, e);
            }
        });
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const ticker = this.value.trim().toUpperCase();
                if (ticker && typeof window.selectAdvChartStock === 'function') {
                    window.selectAdvChartStock(ticker);
                }
            }
        });
    }

    const loadBtn = document.getElementById('adv-chart-load');
    if (loadBtn) {
        loadBtn.addEventListener('click', function() {
            if (typeof window.loadAdvancedChart === 'function') {
                window.loadAdvancedChart();
            }
        });
    }

    // ─── সিগন্যাল ফিল্টার ────────────────────────────────
    const signalApplyBtn = document.getElementById('signal-apply-btn');
    if (signalApplyBtn) {
        signalApplyBtn.addEventListener('click', function() {
            if (typeof window.applySignalFilters === 'function') {
                window.applySignalFilters();
            }
        });
    }

    // ─── স্ক্যানার ট্যাব ──────────────────────────────────
    document.querySelectorAll('.all-scanner-tab-btn').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.id.replace('all-scanner-tab-', '');
            if (typeof window.switchAllScannerTab === 'function') {
                window.switchAllScannerTab(tabName);
            }
        });
    });

    // ─── আরএসআই ট্যাব ─────────────────────────────────────
    document.querySelectorAll('.rsi-tab-btn').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.id.replace('rsi-tab-', '');
            if (typeof window.switchRSITab === 'function') {
                window.switchRSITab(tabName);
            }
        });
    });

    // ─── ডার্ক মোড টগল (থিম বাটন) ──────────────────────
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            if (typeof window.toggleDarkMode === 'function') {
                window.toggleDarkMode();
            }
        });
    }

    // ─── যদি ইউজার আগে থেকে লগইন থাকে, ড্যাশবোর্ড লোড ──
    if (auth && auth.currentUser) {
        setTimeout(() => {
            if (typeof window.loadDashboardData === 'function') {
                window.loadDashboardData(null, true);
            }
            if (typeof window.loadSignalData === 'function') {
                window.loadSignalData();
            }
        }, 500);
    }

    console.log('✅ All globals exposed and UI ready');
});

// ==========================================
// 📌 পৃষ্ঠা আনলোডে ইন্টারভাল ক্লিয়ার
// ==========================================

window.addEventListener('beforeunload', function() {
    if (window.portfolioAnalysisInterval) clearInterval(window.portfolioAnalysisInterval);
    if (window.stockTableRefreshInterval) clearInterval(window.stockTableRefreshInterval);
    if (window.autoRefreshInterval) clearInterval(window.autoRefreshInterval);
    if (window.dataRefreshInterval) clearInterval(window.dataRefreshInterval);
});

console.log('✅ main.js (final) loaded successfully');