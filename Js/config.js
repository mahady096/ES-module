// ==========================================
// 📁 config.js - সব কনফিগ এক জায়গায়
// ==========================================

export const CONFIG = {
    API: {
        SCRAPER_BASE_URL: 'https://dse-scraper.vercel.app/api',
        SUPABASE_URL: 'https://dpdicusxlrdydajkcgev.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_vIexTeuEoBjiFoA0F2w2Ag_3GUn_SMX'
    },
    CACHE: {
        TTL: {
            ANALYSIS: 600000,
            PRICE: 300000,
            SCANNER: 3600000,
            UNIFIED_PRICE: 300000,
            DASHBOARD: 300000,
            CHART: 1200000,
            TIMELINE: 1800000
        }
    },
    STORAGE_KEYS: {
        THEME: 'theme',
        WATCHLIST: 'market_watch_list',
        COMMISSION: 'commissionPercent',
        DATA_MODE: 'dataMode'
    },
    DEFAULTS: {
        COMMISSION_PERCENT: 0,
        DATA_MODE: 'firebase',
        SIGNAL_THRESHOLD: 50
    },
    CALC: {
        PARABOLIC_SAR_STEP: 0.02,
        PARABOLIC_SAR_MAX_STEP: 0.20,
        RSI_PERIOD: 14
    }
};

export default CONFIG;