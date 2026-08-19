// ==========================================
// 📊 indicators.js - সব ইন্ডিকেটর
// ==========================================

// ==========================================
// 📦 ক্যাশ
// ==========================================

const indicatorCache = new Map();
const CACHE_TTL = 60000;

function buildCacheKey(fnName, args) {
    const parts = args.map(arg => {
        if (Array.isArray(arg)) {
            if (arg.length === 0) return 'empty_array';
            const firstTwo = arg.slice(0, 2).map(v => typeof v === 'number' ? v.toFixed(4) : String(v)).join(',');
            const lastTwo = arg.slice(-2).map(v => typeof v === 'number' ? v.toFixed(4) : String(v)).join(',');
            return `arr_${arg.length}_${firstTwo}_${lastTwo}`;
        } else if (typeof arg === 'object' && arg !== null) {
            try {
                const keys = Object.keys(arg).slice(0, 5);
                const vals = keys.map(k => {
                    const v = arg[k];
                    if (Array.isArray(v)) return `${k}:arr_${v.length}`;
                    return `${k}:${String(v).substring(0, 20)}`;
                }).join('|');
                return `obj_${keys.length}_${vals}`;
            } catch { return 'obj_complex'; }
        }
        return String(arg);
    }).join('_');
    return `${fnName}_${parts}`;
}

function getCachedIndicator(fnName, computeFn, ...args) {
    const cacheKey = buildCacheKey(fnName, args);
    const cached = indicatorCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data;
    }
    const result = computeFn(...args);
    if (result !== null && result !== undefined) {
        if (!Array.isArray(result) || result.length > 0) {
            indicatorCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });
        }
    }
    return result;
}

// ==========================================
// 📊 বেস ইন্ডিকেটর
// ==========================================

export function calculateSMA(data, period) {
    if (data.length < period) return [];
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j];
        result.push(sum / period);
    }
    return result;
}

export function calculateEMA(data, period) {
    if (data.length < period) return [];
    const multiplier = 2 / (period + 1);
    const result = [];
    let sma = 0;
    for (let i = 0; i < period; i++) sma += data[i];
    sma /= period;
    result.push(sma);
    for (let i = period; i < data.length; i++) {
        const ema = (data[i] - result[result.length - 1]) * multiplier + result[result.length - 1];
        result.push(ema);
    }
    return result;
}

export function calculateRSI(data, period = 14) {
    if (data.length < period + 1) return [];
    const result = [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    let rsi = 100 - (100 / (1 + (avgGain / (avgLoss || 1))));
    result.push({ rsi });
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        rsi = 100 - (100 / (1 + (avgGain / (avgLoss || 1))));
        result.push({ rsi });
    }
    return result;
}

export function calculateMACD(data, fast = 12, slow = 26, signal = 9) {
    if (data.length < slow + signal) return null;
    const emaFast = calculateEMA(data, fast);
    const emaSlow = calculateEMA(data, slow);
    const macdLine = [];
    const startIdx = data.length - emaSlow.length;
    for (let i = 0; i < emaSlow.length; i++) {
        macdLine.push(emaFast[i + startIdx] - emaSlow[i]);
    }
    const signalLine = calculateEMA(macdLine, signal);
    const histogram = [];
    const sigStart = macdLine.length - signalLine.length;
    for (let i = 0; i < signalLine.length; i++) {
        histogram.push(macdLine[i + sigStart] - signalLine[i]);
    }
    return {
        macd: macdLine.slice(-signalLine.length),
        signal: signalLine,
        histogram
    };
}

export function calculateBollingerBands(data, period = 20, stdDev = 2) {
    if (data.length < period) return null;
    const sma = calculateSMA(data, period);
    const upper = [],
        lower = [],
        middle = [];
    for (let i = period - 1; i < data.length; i++) {
        const start = i - period + 1;
        let sum = 0;
        for (let j = start; j <= i; j++) sum += Math.pow(data[j] - sma[i - period + 1], 2);
        const std = Math.sqrt(sum / period);
        upper.push(sma[i - period + 1] + stdDev * std);
        middle.push(sma[i - period + 1]);
        lower.push(sma[i - period + 1] - stdDev * std);
    }
    return { upper, middle, lower };
}

export function calculateStochastic(high, low, close, period = 14, smoothK = 3, smoothD = 3) {
    if (high.length < period || low.length < period || close.length < period) return { k: [], d: [] };
    const kValues = [];
    for (let i = period - 1; i < close.length; i++) {
        const start = i - period + 1;
        let maxHigh = -Infinity,
            minLow = Infinity;
        for (let j = start; j <= i; j++) {
            if (high[j] > maxHigh) maxHigh = high[j];
            if (low[j] < minLow) minLow = low[j];
        }
        const k = ((close[i] - minLow) / (maxHigh - minLow)) * 100;
        kValues.push(k);
    }
    const smoothKValues = [];
    for (let i = smoothK - 1; i < kValues.length; i++) {
        let sum = 0;
        for (let j = i - smoothK + 1; j <= i; j++) sum += kValues[j];
        smoothKValues.push(sum / smoothK);
    }
    const dValues = [];
    for (let i = smoothD - 1; i < smoothKValues.length; i++) {
        let sum = 0;
        for (let j = i - smoothD + 1; j <= i; j++) sum += smoothKValues[j];
        dValues.push(sum / smoothD);
    }
    return { k: smoothKValues, d: dValues };
}

export function calculateATR(high, low, close, period = 14) {
    if (high.length < period || low.length < period || close.length < period + 1) return [];
    const tr = [];
    for (let i = 1; i < close.length; i++) {
        const h = high[i] || close[i];
        const l = low[i] || close[i];
        const prevClose = close[i - 1];
        const tr1 = h - l;
        const tr2 = Math.abs(h - prevClose);
        const tr3 = Math.abs(l - prevClose);
        tr.push(Math.max(tr1, tr2, tr3));
    }
    let atr = [];
    let sum = 0;
    for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
    atr.push(sum / period);
    for (let i = period; i < tr.length; i++) {
        const prevAtr = atr[atr.length - 1];
        const newAtr = (prevAtr * (period - 1) + tr[i]) / period;
        atr.push(newAtr);
    }
    return atr;
}

export function calculateParabolicSAR(priceData, step = 0.02, maxStep = 0.20) {
    if (!priceData || priceData.length < 2) return [];
    let sar = [];
    let trend = 'up';
    let af = step;
    let ep = priceData[0].high || priceData[0].ltp || priceData[0].close || 0;
    let currentSAR = priceData[0].low || priceData[0].ltp || priceData[0].close || 0;
    sar.push({ date: priceData[0].date, sar: currentSAR, trend: trend, af: af, ep: ep });

    for (let i = 1; i < priceData.length; i++) {
        const current = priceData[i];
        const price = current.ltp || current.close || 0;
        const high = current.high || price;
        const low = current.low || price;

        let newSAR;
        if (trend === 'up') {
            newSAR = currentSAR + af * (ep - currentSAR);
        } else {
            newSAR = currentSAR - af * (currentSAR - ep);
        }

        if (trend === 'up' && price < newSAR) {
            trend = 'down';
            newSAR = ep;
            af = step;
            ep = low;
        } else if (trend === 'down' && price > newSAR) {
            trend = 'up';
            newSAR = ep;
            af = step;
            ep = high;
        } else {
            if (trend === 'up') {
                if (high > ep) {
                    ep = high;
                    af = Math.min(af + step, maxStep);
                }
            } else {
                if (low < ep) {
                    ep = low;
                    af = Math.min(af + step, maxStep);
                }
            }
        }

        sar.push({ date: current.date, sar: newSAR, trend: trend, af: af, ep: ep });
        currentSAR = newSAR;
    }
    return sar;
}

export function arimaForecast(data, steps = 5) {
    if (data.length < 3) return null;
    const n = data.length;
    let sumY = 0,
        sumY1 = 0,
        sumY1Y = 0,
        sumY1Sq = 0;
    for (let i = 1; i < n; i++) {
        sumY += data[i];
        sumY1 += data[i - 1];
        sumY1Y += data[i - 1] * data[i];
        sumY1Sq += data[i - 1] * data[i - 1];
    }
    const phi = (sumY1Y - (sumY1 * sumY) / n) / (sumY1Sq - (sumY1 * sumY1) / n);
    const c = (sumY - phi * sumY1) / n;
    const forecast = [];
    let last = data[data.length - 1];
    for (let i = 0; i < steps; i++) {
        const next = c + phi * last;
        forecast.push(next);
        last = next;
    }
    return forecast;
}

// ==========================================
// 📊 অ্যাডভান্সড ইন্ডিকেটর
// ==========================================

export function calculateAnchoredVWAP(priceData, volumeData, anchorIndex = 0) {
    if (priceData.length < 2 || volumeData.length < 2) return [];
    if (anchorIndex >= priceData.length) anchorIndex = 0;

    let cumVolume = 0,
        cumVolumePrice = 0;
    const result = [];
    const startIdx = Math.max(0, anchorIndex);

    for (let i = startIdx; i < priceData.length; i++) {
        const vol = volumeData[i] || 1;
        cumVolume += vol;
        cumVolumePrice += priceData[i] * vol;
        result.push(cumVolumePrice / cumVolume);
    }
    return result;
}

export function calculateVolumeProfile(priceData, volumeData, bins = 20) {
    if (priceData.length < 2) return { profile: {}, pocPrice: 0, pocVolume: 0 };

    const min = Math.min(...priceData);
    const max = Math.max(...priceData);
    if (min === max) return { profile: {}, pocPrice: priceData[0], pocVolume: 0 };

    const binSize = (max - min) / bins;
    const profile = {};

    for (let i = 0; i < priceData.length; i++) {
        const bin = Math.floor((priceData[i] - min) / binSize);
        const key = Math.min(bin, bins - 1);
        profile[key] = (profile[key] || 0) + (volumeData[i] || 0);
    }

    let maxVol = 0,
        pocBin = 0;
    for (const [bin, vol] of Object.entries(profile)) {
        if (vol > maxVol) {
            maxVol = vol;
            pocBin = parseFloat(bin);
        }
    }

    const pocPrice = min + (pocBin + 0.5) * binSize;
    return {
        profile,
        pocPrice,
        pocVolume: maxVol,
        binSize,
        minPrice: min,
        maxPrice: max
    };
}

export function calculateFibonacci(high, low) {
    if (!high || !low || high <= low) return null;
    const diff = high - low;
    return {
        level0: high,
        level236: high - diff * 0.236,
        level382: high - diff * 0.382,
        level500: high - diff * 0.5,
        level618: high - diff * 0.618,
        level786: high - diff * 0.786,
        level100: low,
        high: high,
        low: low,
        diff: diff
    };
}

export function calculateAroon(priceData, period = 25) {
    if (priceData.length < period) return { aroonUp: [], aroonDown: [], crossover: [] };

    const aroonUp = [],
        aroonDown = [],
        crossover = [];

    for (let i = period; i < priceData.length; i++) {
        const slice = priceData.slice(i - period, i + 1);
        const highIdx = slice.indexOf(Math.max(...slice));
        const lowIdx = slice.indexOf(Math.min(...slice));
        const up = ((period - highIdx) / period) * 100;
        const down = ((period - lowIdx) / period) * 100;
        aroonUp.push(up);
        aroonDown.push(down);

        const prevUp = aroonUp.length > 1 ? aroonUp[aroonUp.length - 2] : up;
        const prevDown = aroonDown.length > 1 ? aroonDown[aroonDown.length - 2] : down;
        if ((prevUp < prevDown && up > down) || (prevUp > prevDown && up < down)) {
            crossover.push({
                index: i,
                type: up > down ? 'bullish' : 'bearish',
                aroonUp: up,
                aroonDown: down
            });
        }
    }

    return { aroonUp, aroonDown, crossover };
}

export function calculateIchimoku(priceData, highData, lowData, tenkan = 9, kijun = 26, senkou = 52) {
    if (priceData.length < senkou || highData.length < senkou || lowData.length < senkou) {
        return null;
    }

    const result = {
        tenkanSen: [],
        kijunSen: [],
        senkouA: [],
        senkouB: [],
        chikou: []
    };

    for (let i = tenkan - 1; i < priceData.length; i++) {
        const sliceHigh = highData.slice(i - tenkan + 1, i + 1);
        const sliceLow = lowData.slice(i - tenkan + 1, i + 1);
        result.tenkanSen.push((Math.max(...sliceHigh) + Math.min(...sliceLow)) / 2);
    }

    for (let i = kijun - 1; i < priceData.length; i++) {
        const sliceHigh = highData.slice(i - kijun + 1, i + 1);
        const sliceLow = lowData.slice(i - kijun + 1, i + 1);
        result.kijunSen.push((Math.max(...sliceHigh) + Math.min(...sliceLow)) / 2);
    }

    for (let i = 0; i < result.tenkanSen.length && i < result.kijunSen.length; i++) {
        result.senkouA.push((result.tenkanSen[i] + result.kijunSen[i]) / 2);
    }

    for (let i = senkou - 1; i < priceData.length; i++) {
        const sliceHigh = highData.slice(i - senkou + 1, i + 1);
        const sliceLow = lowData.slice(i - senkou + 1, i + 1);
        result.senkouB.push((Math.max(...sliceHigh) + Math.min(...sliceLow)) / 2);
    }

    for (let i = 0; i < priceData.length; i++) {
        if (i + kijun < priceData.length) {
            result.chikou.push(priceData[i + kijun]);
        } else {
            result.chikou.push(null);
        }
    }

    return result;
}

// ==========================================
// 🔥 ক্যাশিং র‍্যাপার
// ==========================================

export function cachedSMA(data, period) {
    return getCachedIndicator('SMA', calculateSMA, data, period);
}

export function cachedEMA(data, period) {
    return getCachedIndicator('EMA', calculateEMA, data, period);
}

export function cachedRSI(data, period = 14) {
    return getCachedIndicator('RSI', calculateRSI, data, period);
}

export function cachedMACD(data, fast = 12, slow = 26, signal = 9) {
    return getCachedIndicator('MACD', calculateMACD, data, fast, slow, signal);
}

export function cachedBollingerBands(data, period = 20, stdDev = 2) {
    return getCachedIndicator('BB', calculateBollingerBands, data, period, stdDev);
}

export function cachedStochastic(high, low, close, period = 14, smoothK = 3, smoothD = 3) {
    return getCachedIndicator('STOCH', calculateStochastic, high, low, close, period, smoothK, smoothD);
}

export function cachedATR(high, low, close, period = 14) {
    return getCachedIndicator('ATR', calculateATR, high, low, close, period);
}

export function cachedParabolicSAR(priceData, step = 0.02, maxStep = 0.20) {
    return getCachedIndicator('PSAR', calculateParabolicSAR, priceData, step, maxStep);
}

export function cachedAnchoredVWAP(priceData, volumeData, anchorIndex = 0) {
    return getCachedIndicator('AnchoredVWAP', calculateAnchoredVWAP, priceData, volumeData, anchorIndex);
}

export function cachedVolumeProfile(priceData, volumeData, bins = 20) {
    return getCachedIndicator('VolumeProfile', calculateVolumeProfile, priceData, volumeData, bins);
}

export function cachedFibonacci(high, low) {
    return getCachedIndicator('Fibonacci', calculateFibonacci, high, low);
}

export function cachedAroon(priceData, period = 25) {
    return getCachedIndicator('Aroon', calculateAroon, priceData, period);
}

export function cachedIchimoku(priceData, highData, lowData, tenkan = 9, kijun = 26, senkou = 52) {
    return getCachedIndicator('Ichimoku', calculateIchimoku, priceData, highData, lowData, tenkan, kijun, senkou);
}

// ==========================================
// 📌 DEFAULT EXPORT
// ==========================================

export default {
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    calculateStochastic,
    calculateATR,
    calculateParabolicSAR,
    arimaForecast,
    calculateAnchoredVWAP,
    calculateVolumeProfile,
    calculateFibonacci,
    calculateAroon,
    calculateIchimoku,
    cachedSMA,
    cachedEMA,
    cachedRSI,
    cachedMACD,
    cachedBollingerBands,
    cachedStochastic,
    cachedATR,
    cachedParabolicSAR,
    cachedAnchoredVWAP,
    cachedVolumeProfile,
    cachedFibonacci,
    cachedAroon,
    cachedIchimoku
};