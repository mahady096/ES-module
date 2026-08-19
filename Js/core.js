// ==========================================
// 🔥 core.js - সব কোর ফাংশন (ফাইনাল)
// ==========================================

import CONFIG from './config.js';
import CacheManager from './cache.js';

// ==========================================
// 🕐 TIMEZONE FUNCTIONS
// ==========================================

export function toBangladeshTime(date) {
    if (!date) return null;
    let jsDate;
    if (typeof date.toDate === 'function') jsDate = date.toDate();
    else if (date instanceof Date) jsDate = date;
    else if (typeof date === 'string') jsDate = new Date(date);
    else if (date.seconds) jsDate = new Date(date.seconds * 1000);
    else jsDate = new Date(date);
    const bangladeshOffset = 6 * 60 * 60 * 1000;
    return new Date(jsDate.getTime() + bangladeshOffset);
}

export function formatBangladeshTime(date, showTime = true) {
    const bdDate = toBangladeshTime(date);
    if (!bdDate) return 'N/A';
    const y = bdDate.getUTCFullYear();
    const m = String(bdDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bdDate.getUTCDate()).padStart(2, '0');
    const h = String(bdDate.getUTCHours()).padStart(2, '0');
    const min = String(bdDate.getUTCMinutes()).padStart(2, '0');
    if (showTime) return `${y}-${m}-${d} ${h}:${min}`;
    return `${y}-${m}-${d}`;
}

export function getBangladeshDateString(date = new Date()) {
    const bdDate = toBangladeshTime(date);
    if (!bdDate) return new Date().toISOString().split('T')[0];
    const y = bdDate.getUTCFullYear();
    const m = String(bdDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bdDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function formatDisplayTime(date) {
    const bdDate = toBangladeshTime(date);
    if (!bdDate) return 'N/A';
    return bdDate.toLocaleString('bn-BD', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

export function getTodayDate() {
    return getBangladeshDateString(new Date());
}

export function getUTCFromLocalDate(dateString) {
    if (!dateString) return new Date();
    const [y, m, d] = dateString.split('-');
    return new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), 0, 0, 0));
}

// ==========================================
// 🛡️ UTILITY FUNCTIONS
// ==========================================

export function getSafePrice(price, fallback = 0) {
    if (price === null || price === undefined || isNaN(price) || price === 0) return fallback;
    const num = Number(price);
    return (isNaN(num) || num <= 0) ? fallback : num;
}

export function calculatePercentage(value, base) {
    if (!base || base === 0 || isNaN(base) || isNaN(value)) return 0;
    return (value / base) * 100;
}

export function safeDivision(dividend, divisor, defaultValue = 0) {
    if (!divisor || divisor === 0 || isNaN(divisor) || isNaN(dividend)) return defaultValue;
    return dividend / divisor;
}

export function chunkArray(array, chunkSize = 10) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function safeParseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value)) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!isNaN(d)) return d;
    }
    if (value.seconds !== undefined) {
        const d = new Date(value.seconds * 1000);
        if (!isNaN(d)) return d;
    }
    return null;
}

// ==========================================
// 💰 COMMISSION MANAGER
// ==========================================

export class CommissionManager {
    constructor() {
        this.STORAGE_KEY = CONFIG.STORAGE_KEYS.COMMISSION || 'commissionPercent';
        this.loadSettings();
    }

    loadSettings() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        this.percent = saved ? parseFloat(saved) : CONFIG.DEFAULTS.COMMISSION_PERCENT || 0;
    }

    saveSettings() {
        localStorage.setItem(this.STORAGE_KEY, String(this.percent));
    }

    calculateCommission(amount) {
        return amount * (this.percent / 100);
    }

    getBuyTotalWithCommission(amount) {
        return amount + this.calculateCommission(amount);
    }

    getSellNetWithCommission(amount) {
        return amount - this.calculateCommission(amount);
    }

    getPercent() {
        return this.percent;
    }

    updatePercent(percent) {
        this.percent = Math.max(0, parseFloat(percent) || 0);
        this.saveSettings();
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('commissionChanged', {
                detail: { percent: this.percent }
            }));
        }
    }

    calculateFullTransaction(buyPrice, sellPrice, qty) {
        const buyAmount = buyPrice * qty;
        const sellAmount = sellPrice * qty;
        const buyCommission = this.calculateCommission(buyAmount);
        const sellCommission = this.calculateCommission(sellAmount);
        return {
            buyAmount,
            sellAmount,
            buyCommission,
            sellCommission,
            netBuy: buyAmount + buyCommission,
            netSell: sellAmount - sellCommission,
            grossProfit: sellAmount - buyAmount,
            netProfit: (sellAmount - sellCommission) - (buyAmount + buyCommission),
            commissionPercent: this.percent
        };
    }
}

// ==========================================
// 🚦 API RATE LIMITER
// ==========================================

export class APIRateLimiter {
    constructor(maxRequestsPerSecond = 3) {
        this.queue = [];
        this.processing = false;
        this.minDelay = 1000 / maxRequestsPerSecond;
        this.lastCall = 0;
    }

    async request(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        while (this.queue.length > 0) {
            const now = Date.now();
            const timeToWait = Math.max(0, this.minDelay - (now - this.lastCall));
            if (timeToWait > 0) await new Promise(r => setTimeout(r, timeToWait));
            const { fn, resolve, reject } = this.queue.shift();
            this.lastCall = Date.now();
            try { resolve(await fn()); } catch (error) { reject(error); }
        }
        this.processing = false;
    }
}

// ==========================================
// 🔥 DSE STOCK LIST
// ==========================================

export const dseStocks = [
    "1JANATAMF", "1STPRIMFMF", "AAMRANET", "AAMRATECH", "ABB1STMF", "ABBANK", "ACFL", "ACI", "ACIFORMULA", "ACMELAB",
    "ACTIVEFINE", "ADNTEL", "ADVENT", "AFCAGRO", "AFTABAUTO", "AGNISYSL", "AGRANINS", "AIBL1STIMF", "AIL", "AL-HAJTEX",
    "ALARABANK", "ALIF", "ALLTEX", "AMANFEED", "AMBEEPHA", "ANLIMAYARN", "ANWARGALV", "APEXFOODS", "APEXFOOT", "APEXSPINN",
    "APOLOISPAT", "ARAMIT", "ARAMITCEM", "ARGONDENIM", "ASIAPACINS", "ATCSLGF", "ATLASBANG", "AZIZPIPES", "BANGAS", "BANKASIA",
    "BATASHOE", "BATBC", "BAYLEASING", "BBS", "BCC", "BDCOM", "BDFINANCE", "BDLAMPS", "BDTHAI", "BDTHAIFOOD",
    "BDWELDING", "BEACHHATCH", "BEACONPHAR", "BENGALWTL", "BERGERPBL", "BEXGSUKUK", "BEXIMCO", "BGIC", "BIFC", "BNICL",
    "BPML", "BPPL", "BRACBANK", "BSC", "BSCCL", "BSRMLTD", "BSRMSTEEL", "BXPHARMA", "CAPMBDBLMF", "CAPMIBBLMF", "BESTHLDNG",
    "CENTRALINS", "CENTRALPHL", "CITYBANK", "CNATEX", "CONFIDCEM", "CONTININS", "COPPERTECH", "CROWNCEMNT", "CVOPRL", "DACCADYE",
    "DAFODILCOM", "DBH", "DBH1STMF", "DELTALIFE", "DELTASPINN", "DESCO", "DESHBANDHU", "DHAKABANK", "DOMINAGE", "DOREENPWR",
    "DSSL", "Dulamiacot", "DUTCHBANGL", "EASTLAND", "EASTRNLUB", "EBL", "EBL1STMF", "EBLNRBMF", "ECABLES", "EGEN",
    "EMERALDOIL", "ENVOYTEX", "EPGL", "ESQUIRENIT", "ETL", "EXIM1STMF", "EXIMBANK", "FAMILYTEX", "FARCHEM", "FAREASTLIF", "FAREASTFIN",
    "FASFIN", "FBFIF", "FEDERALINS", "FEKDIL", "FINEFOODS", "FIRSTFIN", "FIRSTSBANK", "FORTUNE", "FUWANGCER",
    "FUWANGFOOD", "GBBPOWER", "GEMINISEA", "GENEXIL", "GENNEXT", "GHAIL", "GHCL", "GIB", "GLAXOSMITH", "GLOBALINS",
    "GOLDENSON", "GP", "GPHISPAT", "GQBALLPEN", "GSPFINANCE", "GRAMEENS2", "GREENDELT", "HAKKANIPUL", "HEIDELBCEM", "HFL", "HRTEX",
    "HWAWELLTEX", "IBNSINA", "IBP", "ICB", "ICB3RDNRB", "ICBAGRANI1", "ICBAMCL2ND", "ICBEPMF1S1", "IDLC", "IFADAUTOS", "ICICL",
    "IFIC", "IFIC1STMF", "IFILISLMF1", "ILFSL", "INDEXAGRO", "INTECH", "INTRACO", "IPDC", "ISLAMIBANK", "ISLAMICFIN", "ICBEPMF1S1",
    "ISNLTD", "ITC", "JAMUNABANK", "JAMUNAOIL", "JANATAINS", "JHRML", "JMISMDL", "JUTESPINN", "KARNAPHULI", "KAY&QUE",
    "KBPPWBIL", "KDSALTD", "KEYACOSMET", "KPCL", "KPPL", "LANKABAFIN", "LEGACYFOOT", "LHBL", "LIBRAINFU", "LINDEBD",
    "LOVELLO", "LRBDL", "MARICO", "MATINSPINN", "MBL1STMF", "MEGCONMILK", "MEGHNACEM", "MEGHNALIFE", "MEGHNAPET", "MERCANBANK",
    "MERCINS", "METROSPIN", "MHSML", "MIDASFIN", "MIRACLEIND", "MIRAKHTER", "MONNOAGML", "MONNOCERA", "MONNOFABR", "MONOSPOOL", "MALEKSPIN", "MPETROLEUM", "MTB", "MIDLANDBNK", "NAHEEACP", "NATLIFEINS", "NAVANACNG", "NAVANAPHAR", "NBL", "NCCBANK", "NCCBLMF1", "NEWLINE",
    "NITOLINS", "NORTHERN", "NORTHRNINS", "NPOLYMER", "NRBBANK", "NTLTUBES", "OAL", "NHFIL", "OIMEX", "OLYMPIC", "ONEBANKPLC",
    "ORIONINFU", "ORIONPHARM", "PADMALIFE", "PADMAOIL", "PARAMOUNT", "PDL", "PENINSULA", "PEOPLESINS", "PF1STMF", "PHARMAID",
    "PHENIXINS", "PHOENIXFIN", "PIONEERINS", "PLFSL", "POPULAR1MF", "POPULARLIF", "POWERGRID", "PRAGATIINS", "PRAGATILIF", "PREMIERBAN",
    "PREMIERCEM", "PREMIERLEA", "PRIME1ICBA", "PRIMEBANK", "PRIMEFIN", "PRIMEINSUR", "PRIMELIFE", "PROGRESLIF", "PROVATIINS", "PTL",
    "PUBALIBANK", "PURABIGEN", "QUASEMIND", "QUEENSOUTH", "RAHIMAFOOD", "RAKCERAMIC", "RANFOUNDRY", "RDFOOD", "RECKITTBEN", "REGENTTEX",
    "RELIANCE1", "RENATA", "REPUBLIC", "RINGSHINE", "ROBI", "RSRMSTEEL", "RUNNERAUTO", "RUPALIBANK", "RUPALIINS", "SAFKOSPINN",
    "SAIFPOWER", "SAIHAMCOT", "SAIHAMTEX", "SALAMCRST", "SALVOCHEM", "SAMATALETH", "SAMORITA", "SANDHANINS", "SAPORTL", "SAVAREFR",
    "SEAPEARL", "SEMLFBSLGF", "SEMLIBBLSF", "SEMLLECMF", "SHAHJABANK", "SHASHADNIM", "SHEPHERD", "SHURWID", "SHYAMPSUG", "SIBL",
    "SICL", "SILCOPHL", "SILVAPHL", "SIMTEX", "SINOBANGLA", "SKICL", "SONALIANSH", "SONALILIFE", "SONALIPAPR", "SONARBAINS",
    "SOUTHEASTB", "SPCERAMICS", "SQURPHARMA", "SSSTEEL", "STANCERAM", "STANDARINS", "STANDBANKL", "STYLECRAFT", "SUMITPOWER", "SUNLIFEINS",
    "TAKAFULINS", "TALLUSPIN", "TAMIJTEX", "TECHNODRUG", "TILIL", "TITASGAS", "TOSRIFA", "TRUSTBANK", "TUNGHAI", "UCB",
    "UNILEVERCL", "UNIONBANK", "UNIONCAP", "UNIONINS", "UNIQUEHRL", "UNITEDFIN", "UNITEDINS", "UPGDCL", "USMANIAGL", "UTTARABANK",
    "UTTARAFIN", "VAMLBDMF1", "VAMLRBBF", "VFSTDL", "WALTONHIL", "WATACHEM", "WMSHIPYARD", "YPL", "ZAHEENSPIN", "ZAHINTEX"
];

// ==========================================
// 📈 UNIFIED PRICE
// ==========================================

let unifiedPriceCache = new Map();
let lastUnifiedPriceUpdate = 0;
const UNIFIED_PRICE_CACHE_TTL = CONFIG.CACHE.TTL.UNIFIED_PRICE || 300000;

// --- এই ফাংশনটি এখন export করা হলো ---
export function getHardcodedPrice(ticker) {
    const prices = {
        "GP": 255.40,
        "ROBI": 26.10,
        "SQURPHARMA": 208.70,
        "BATBC": 518.00,
        "BEXIMCO": 115.20
    };
    return prices[ticker] || 0;
}

// --- getUnifiedPrice ---
export async function getUnifiedPrice(ticker, forceRefresh = false) {
    if (!ticker) return 0;
    const now = Date.now();
    const TTL = CONFIG.CACHE.TTL.UNIFIED_PRICE || 300000;
    const CACHE_KEY = `price_${ticker}`;

    if (!forceRefresh) {
        const cached = CacheManager.get(CACHE_KEY, TTL);
        if (cached !== null && typeof cached === 'object' && cached.price > 0) {
            unifiedPriceCache.set(ticker, { price: cached.price, timestamp: now });
            return cached.price;
        }
    }

    if (unifiedPriceCache.has(ticker)) {
        const memCached = unifiedPriceCache.get(ticker);
        if (now - memCached.timestamp < TTL) {
            CacheManager.set(CACHE_KEY, { price: memCached.price }, TTL);
            return memCached.price;
        } else {
            unifiedPriceCache.delete(ticker);
        }
    }

    let price = 0;

    // Supabase cse_market_data
    if (typeof supabase !== 'undefined' && supabase) {
        try {
            const { data, error } = await supabase
                .from('cse_market_data')
                .select('ltp')
                .eq('code', ticker)
                .order('date', { ascending: false })
                .limit(1);
            if (!error && data && data.length > 0) {
                const val = parseFloat(data[0].ltp);
                if (!isNaN(val) && val > 0) price = val;
            }
        } catch (e) { /* ignore */ }
    }

    // Supabase dse_live_data
    if (price === 0 && typeof supabase !== 'undefined' && supabase) {
        try {
            const { data, error } = await supabase
                .from('dse_live_data')
                .select('ltp')
                .eq('ticker', ticker)
                .order('date', { ascending: false })
                .limit(1);
            if (!error && data && data.length > 0) {
                const val = parseFloat(data[0].ltp);
                if (!isNaN(val) && val > 0) price = val;
            }
        } catch (e) { /* ignore */ }
    }

    // Firebase daily_prices
    if (price === 0 && typeof db !== 'undefined' && db) {
        try {
            const snap = await db.collection('daily_prices')
                .where('ticker', '==', ticker)
                .orderBy('date', 'desc')
                .limit(1)
                .get();
            if (!snap.empty) {
                const data = snap.docs[0].data();
                const val = parseFloat(data.price) || parseFloat(data.close) || 0;
                if (val > 0) price = val;
            }
        } catch (e) { /* ignore */ }
    }

    if (price === 0) {
        price = getHardcodedPrice(ticker);
    }

    if (price > 0) {
        unifiedPriceCache.set(ticker, { price, timestamp: now });
        CacheManager.set(CACHE_KEY, { price }, TTL);
    }

    return price;
}

// --- resetUnifiedPriceCache ---
export function resetUnifiedPriceCache() {
    unifiedPriceCache.clear();
    console.log('🔄 Unified price cache reset');
}

// ==========================================
// 📦 ক্যাশ রিসেট (Unified Engine)
// ==========================================

export function resetUnifiedCache() {
    if (window.unifiedEngine && typeof window.unifiedEngine.resetCache === 'function') {
        window.unifiedEngine.resetCache();
        console.log('🔄 Unified calculation cache reset');
    } else {
        console.warn('unifiedEngine not available');
    }
}

// ==========================================
// 📈 PREVIOUS DAY PRICE
// ==========================================

export async function getPreviousDayPrice(ticker) {
    if (!ticker) return 0;
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('dse_live_data')
                    .select('ltp')
                    .eq('ticker', ticker)
                    .eq('date', dateStr)
                    .limit(1);
                if (!error && data && data.length > 0) {
                    const val = parseFloat(data[0].ltp);
                    if (val > 0) return val;
                }
            } catch (e) {}
        }

        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('cse_market_data')
                    .select('ltp')
                    .eq('code', ticker)
                    .eq('date', dateStr)
                    .limit(1);
                if (!error && data && data.length > 0) {
                    const val = parseFloat(data[0].ltp);
                    if (val > 0) return val;
                }
            } catch (e) {}
        }

        if (typeof db !== 'undefined' && db) {
            try {
                const snap = await db.collection('daily_prices')
                    .where('ticker', '==', ticker)
                    .where('date', '==', dateStr)
                    .limit(1)
                    .get();
                if (!snap.empty) {
                    const data = snap.docs[0].data();
                    const val = parseFloat(data.price) || parseFloat(data.close) || 0;
                    if (val > 0) return val;
                }
            } catch (e) {}
        }
    }
    return 0;
}

// ==========================================
// 📈 LATEST AND PREVIOUS PRICES (Batch)
// ==========================================

export async function getLatestAndPreviousPrices(tickers, forceRefresh = false) {
    if (!tickers || !tickers.length) return new Map();

    const TTL = CONFIG.CACHE.TTL.UNIFIED_PRICE || 300000;
    const resultMap = new Map();
    const missingTickers = [];

    if (!forceRefresh) {
        for (const ticker of tickers) {
            const cacheKey = `price_detail_${ticker}`;
            const cached = CacheManager.get(cacheKey, TTL);
            if (cached && typeof cached === 'object' && cached.currentPrice > 0) {
                resultMap.set(ticker, {
                    currentPrice: cached.currentPrice,
                    currentDate: cached.currentDate || null,
                    previousPrice: cached.previousPrice || 0,
                    previousDate: cached.previousDate || null,
                    high: cached.high || 0,
                    low: cached.low || 0
                });
            } else {
                missingTickers.push(ticker);
            }
        }
        if (missingTickers.length === 0) {
            return resultMap;
        }
    } else {
        missingTickers.push(...tickers);
    }

    // Missing টিকারের জন্য ডেটা ফেচ করুন
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    const startDateStr = sevenDaysAgo.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    const fetchedData = new Map();

    // Supabase cse_market_data
    if (typeof supabase !== 'undefined' && supabase) {
        const chunks = chunkArray(missingTickers, 10);
        for (const chunk of chunks) {
            try {
                const { data, error } = await supabase
                    .from('cse_market_data')
                    .select('code, ltp, high, low, date')
                    .in('code', chunk)
                    .order('date', { ascending: false });
                if (!error && data) {
                    const seen = new Set();
                    data.forEach(row => {
                        if (!seen.has(row.code)) {
                            seen.add(row.code);
                            const val = parseFloat(row.ltp) || 0;
                            if (val > 0) {
                                if (!fetchedData.has(row.code)) {
                                    fetchedData.set(row.code, { currentPrice: 0, currentDate: null, high: 0, low: 0 });
                                }
                                const cur = fetchedData.get(row.code);
                                if (!cur.currentPrice || cur.currentPrice === 0) {
                                    cur.currentPrice = val;
                                    cur.currentDate = row.date;
                                    cur.high = parseFloat(row.high) || 0;
                                    cur.low = parseFloat(row.low) || 0;
                                }
                            }
                        }
                    });
                }
            } catch (e) {}
        }
    }

    // Firebase fallback
    if (typeof db !== 'undefined' && db) {
        const stillMissing = missingTickers.filter(t => !fetchedData.has(t) || fetchedData.get(t).currentPrice === 0);
        if (stillMissing.length > 0) {
            const chunks = chunkArray(stillMissing, 10);
            for (const chunk of chunks) {
                try {
                    const snap = await db.collection('daily_prices')
                        .where('ticker', 'in', chunk)
                        .orderBy('date', 'desc')
                        .get();
                    if (!snap.empty) {
                        const seen = new Set();
                        snap.forEach(doc => {
                            const data = doc.data();
                            if (!seen.has(data.ticker)) {
                                seen.add(data.ticker);
                                const val = parseFloat(data.price) || parseFloat(data.close) || 0;
                                if (val > 0) {
                                    if (!fetchedData.has(data.ticker)) {
                                        fetchedData.set(data.ticker, { currentPrice: 0, currentDate: null, high: 0, low: 0 });
                                    }
                                    const cur = fetchedData.get(data.ticker);
                                    if (!cur.currentPrice || cur.currentPrice === 0) {
                                        cur.currentPrice = val;
                                        cur.currentDate = data.date;
                                    }
                                }
                            }
                        });
                    }
                } catch (e) {}
            }
        }
    }

    // Previous price fetch
    const tickersWithCurrent = [];
    for (const [ticker, data] of fetchedData) {
        if (data.currentPrice > 0 && data.currentDate) {
            tickersWithCurrent.push(ticker);
        }
    }

    if (tickersWithCurrent.length > 0 && typeof supabase !== 'undefined' && supabase) {
        const chunks = chunkArray(tickersWithCurrent, 10);
        for (const chunk of chunks) {
            try {
                const { data, error } = await supabase
                    .from('cse_market_data')
                    .select('code, ltp, date')
                    .in('code', chunk)
                    .gte('date', startDateStr)
                    .order('date', { ascending: false });
                if (!error && data) {
                    const tickerDataMap = {};
                    data.forEach(row => {
                        if (!tickerDataMap[row.code]) tickerDataMap[row.code] = [];
                        tickerDataMap[row.code].push(row);
                    });
                    for (const [ticker, rows] of Object.entries(tickerDataMap)) {
                        const currentInfo = fetchedData.get(ticker);
                        if (!currentInfo || !currentInfo.currentDate) continue;
                        const currentDateObj = new Date(currentInfo.currentDate);
                        let bestPrev = null;
                        for (const row of rows) {
                            const rowDate = new Date(row.date);
                            if (rowDate < currentDateObj) {
                                if (!bestPrev || rowDate > new Date(bestPrev.date)) {
                                    bestPrev = row;
                                }
                            }
                        }
                        if (bestPrev) {
                            const val = parseFloat(bestPrev.ltp);
                            if (val > 0) {
                                currentInfo.previousPrice = val;
                                currentInfo.previousDate = bestPrev.date;
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }

    // Hardcoded fallback
    for (const ticker of missingTickers) {
        if (!fetchedData.has(ticker) || fetchedData.get(ticker).currentPrice === 0) {
            const hardcoded = getHardcodedPrice(ticker);
            if (hardcoded > 0) {
                fetchedData.set(ticker, {
                    currentPrice: hardcoded,
                    currentDate: todayStr,
                    previousPrice: 0,
                    previousDate: null,
                    high: 0,
                    low: 0
                });
            }
        }
    }

    for (const [ticker, data] of fetchedData) {
        if (data.currentPrice > 0) {
            const finalData = {
                currentPrice: data.currentPrice,
                currentDate: data.currentDate || null,
                previousPrice: data.previousPrice || 0,
                previousDate: data.previousDate || null,
                high: data.high || 0,
                low: data.low || 0
            };
            resultMap.set(ticker, finalData);
            CacheManager.set(`price_detail_${ticker}`, finalData, TTL);
        }
    }

    for (const ticker of tickers) {
        if (!resultMap.has(ticker)) {
            resultMap.set(ticker, {
                currentPrice: 0,
                currentDate: null,
                previousPrice: 0,
                previousDate: null,
                high: 0,
                low: 0
            });
        }
    }

    return resultMap;
}

// ==========================================
// 📌 DEFAULT EXPORT (সব ফাংশন এক্সপোর্ট)
// ==========================================

export default {
    toBangladeshTime,
    formatBangladeshTime,
    getBangladeshDateString,
    formatDisplayTime,
    getTodayDate,
    getUTCFromLocalDate,
    getSafePrice,
    calculatePercentage,
    safeDivision,
    chunkArray,
    debounce,
    safeParseDate,
    CommissionManager,
    APIRateLimiter,
    dseStocks,
    getUnifiedPrice,
    getHardcodedPrice,
    resetUnifiedPriceCache,
    resetUnifiedCache,
    getPreviousDayPrice,
    getLatestAndPreviousPrices
};

console.log('✅ core.js (final) loaded successfully');