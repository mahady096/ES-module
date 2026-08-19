// ==========================================
// 🌍 global-fix.js - ইরর ফিক্স
// ==========================================

// গ্লোবাল ভেরিয়েবল চেক করে ডিফাইন
if (typeof window.currentDataMode === 'undefined') {
    window.currentDataMode = localStorage.getItem('dataMode') || 'firebase';
}

if (typeof window.autoRefreshInterval === 'undefined') {
    window.autoRefreshInterval = null;
}

if (typeof window.autoRefreshEnabled === 'undefined') {
    window.autoRefreshEnabled = true;
}

// advChartInstance
if (typeof window.advChartInstance !== 'undefined') {
    try { delete window.advChartInstance; } catch(e) {}
}
window.advChartInstance = null;

// Date functions (core.js এ না থাকলে)
if (typeof window.toBangladeshTime === 'undefined') {
    window.toBangladeshTime = function(date) {
        if (!date) return null;
        var jsDate = new Date(date);
        var bangladeshOffset = 6 * 60 * 60 * 1000;
        return new Date(jsDate.getTime() + bangladeshOffset);
    };
}

if (typeof window.getBangladeshDateString === 'undefined') {
    window.getBangladeshDateString = function(date) {
        if (!date) date = new Date();
        var bdDate = window.toBangladeshTime(date);
        if (!bdDate) return new Date().toISOString().split('T')[0];
        var year = bdDate.getUTCFullYear();
        var month = String(bdDate.getUTCMonth() + 1).padStart(2, '0');
        var day = String(bdDate.getUTCDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    };
}

if (typeof window.formatDisplayTime === 'undefined') {
    window.formatDisplayTime = function(date) {
        var bdDate = window.toBangladeshTime(date);
        if (!bdDate) return 'N/A';
        return bdDate.toLocaleString('bn-BD', {
            timeZone: 'Asia/Dhaka',
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    };
}

if (typeof window.getTodayDate === 'undefined') {
    window.getTodayDate = function() {
        return window.getBangladeshDateString(new Date());
    };
}

if (typeof window.debounce === 'undefined') {
    window.debounce = function(func, wait) {
        wait = wait || 300;
        var timeout;
        return function executedFunction() {
            var context = this;
            var args = arguments;
            var later = function() {
                timeout = null;
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };
}

if (typeof window.chunkArray === 'undefined') {
    window.chunkArray = function(array, chunkSize) {
        chunkSize = chunkSize || 10;
        var chunks = [];
        for (var i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    };
}

if (typeof window.safeParseDate === 'undefined') {
    window.safeParseDate = function(value) {
        if (!value) return null;
        if (value instanceof Date && !isNaN(value)) return value;
        if (typeof value === 'string' || typeof value === 'number') {
            var d = new Date(value);
            if (!isNaN(d)) return d;
        }
        if (value.seconds !== undefined) {
            var d3 = new Date(value.seconds * 1000);
            if (!isNaN(d3)) return d3;
        }
        return null;
    };
}

if (typeof window.resetUnifiedPriceCache === 'undefined') {
    window.resetUnifiedPriceCache = function() {
        if (typeof unifiedPriceCache !== 'undefined') {
            try { unifiedPriceCache.clear(); } catch(e) {}
        }
        console.log('🔄 Unified price cache reset');
    };
}

if (typeof window.resetUnifiedCache === 'undefined') {
    window.resetUnifiedCache = function() {
        if (typeof unifiedEngine !== 'undefined' && unifiedEngine.resetCache) {
            unifiedEngine.resetCache();
        }
    };
}

if (typeof window.clearAllScannerCache === 'undefined') {
    window.clearAllScannerCache = function() {
        try { sessionStorage.removeItem('all_scanner_data'); } catch(e) {}
        console.log('🔄 All scanner cache cleared');
    };
}

console.log('✅ global-fix.js loaded successfully');