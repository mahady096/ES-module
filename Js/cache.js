// ==========================================
// 📦 cache.js - Cache Manager
// ==========================================

import CONFIG from './config.js';

const PREFIX = 'stockpulse_';

export const CacheManager = {
    get(key, ttl = null) {
        try {
            const fullKey = PREFIX + key;
            const item = sessionStorage.getItem(fullKey);
            if (!item) return null;
            const data = JSON.parse(item);
            const now = Date.now();
            const effectiveTtl = ttl || data.ttl || CONFIG.CACHE.TTL.PRICE;
            if ((now - data.timestamp) > effectiveTtl) {
                sessionStorage.removeItem(fullKey);
                return null;
            }
            return data.value;
        } catch { return null; }
    },

    set(key, value, ttl = null) {
        try {
            const fullKey = PREFIX + key;
            const item = { 
                value: value, 
                timestamp: Date.now(), 
                ttl: ttl || CONFIG.CACHE.TTL.PRICE 
            };
            sessionStorage.setItem(fullKey, JSON.stringify(item));
            return true;
        } catch {
            this.clearOldest();
            try {
                const fullKey = PREFIX + key;
                const item = { 
                    value: value, 
                    timestamp: Date.now(), 
                    ttl: ttl || CONFIG.CACHE.TTL.PRICE 
                };
                sessionStorage.setItem(fullKey, JSON.stringify(item));
                return true;
            } catch { return false; }
        }
    },

    remove(key) {
        try { 
            sessionStorage.removeItem(PREFIX + key); 
            return true; 
        } catch { return false; }
    },

    clearOldest() {
        try {
            const keys = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key.startsWith(PREFIX)) {
                    try {
                        const item = JSON.parse(sessionStorage.getItem(key));
                        keys.push({ key, timestamp: item.timestamp || 0 });
                    } catch {}
                }
            }
            keys.sort((a, b) => a.timestamp - b.timestamp);
            const toDelete = keys.slice(0, Math.min(10, keys.length));
            toDelete.forEach(item => sessionStorage.removeItem(item.key));
        } catch {}
    },

    clearAll() {
        try {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key.startsWith(PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => sessionStorage.removeItem(key));
        } catch {}
    },

    clearByPattern(pattern) {
        try {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key.startsWith(PREFIX + pattern)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => sessionStorage.removeItem(key));
            return keysToRemove.length;
        } catch { return 0; }
    },

    has(key) {
        try { 
            return sessionStorage.getItem(PREFIX + key) !== null; 
        } catch { return false; }
    },

    getSize() {
        try {
            let total = 0;
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key.startsWith(PREFIX)) {
                    total += sessionStorage.getItem(key).length || 0;
                }
            }
            return (total / 1024).toFixed(2) + ' KB';
        } catch { return '0 KB'; }
    },

    getStats() {
        try {
            let count = 0, totalSize = 0, keys = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key.startsWith(PREFIX)) {
                    count++;
                    totalSize += sessionStorage.getItem(key).length || 0;
                    keys.push(key);
                }
            }
            return { count, sizeKB: (totalSize / 1024).toFixed(2), keys };
        } catch { return { count: 0, sizeKB: '0', keys: [] }; }
    }
};

export default CacheManager;