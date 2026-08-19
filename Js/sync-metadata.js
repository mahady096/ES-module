// ==========================================
// 📁 sync-metadata.js - Sync Stock Metadata
// ==========================================

import { auth, db } from './firebase.js';
import { supabase } from './supabase.js';
import { dseStocks, chunkArray } from './core.js';
import { showToast } from './app-charts.js';
import { calculateRSI, calculateParabolicSAR } from './indicators.js';

// ==========================================
// Sync All Metadata
// ==========================================

export async function syncAllMetadata(onProgress, onComplete) {
    console.log('🔄 syncAllMetadata called');
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('⚠️ No user logged in');
            showToast('Please login first', 'error');
            if (onComplete) onComplete(0, 0);
            return;
        }

        let tickers = dseStocks;
        if (tickers.length === 0) {
            console.warn('⚠️ Stock list is empty!');
            showToast('Stock list is empty!', 'error');
            if (onComplete) onComplete(0, 0);
            return;
        }

        console.log(`📊 Found ${tickers.length} stocks to sync`);
        const total = tickers.length;
        let success = 0, fail = 0;
        if (onProgress) onProgress(0, total);

        const BATCH_SIZE = 3;
        const DELAY_BETWEEN_BATCHES = 700;

        for (let batchIdx = 0; batchIdx < tickers.length; batchIdx += BATCH_SIZE) {
            const batchTickers = tickers.slice(batchIdx, batchIdx + BATCH_SIZE);
            const promises = batchTickers.map(async (ticker) => {
                try {
                    console.log(`🔄 Processing ${ticker}...`);
                    let ath = 0, atl = Infinity, athDate = null, atlDate = null;
                    let rsi = 0, psar = 0;

                    // Get ATH/ATL from history_dse
                    if (typeof supabase !== 'undefined' && supabase) {
                        try {
                            const { data: allData, error: allError } = await supabase
                                .from('history_dse')
                                .select('date, ltp, high, low')
                                .eq('ticker', ticker)
                                .order('date', { ascending: true })
                                .limit(1000);

                            if (!allError && allData && allData.length > 0) {
                                allData.forEach(item => {
                                    const ltp = parseFloat(item.ltp);
                                    const high = parseFloat(item.high) || ltp;
                                    const low = parseFloat(item.low) || ltp;
                                    if (ltp > ath) { ath = ltp; athDate = item.date; }
                                    if (ltp > 0 && ltp < atl) { atl = ltp; atlDate = item.date; }
                                    if (high > ath) { ath = high; athDate = item.date; }
                                    if (low > 0 && low < atl) { atl = low; atlDate = item.date; }
                                });
                                if (atl === Infinity) atl = 0;
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // Get RSI/PSAR (last 30 days)
                    if (typeof supabase !== 'undefined' && supabase) {
                        try {
                            const startDate = new Date();
                            startDate.setDate(startDate.getDate() - 30);
                            const startDateStr = startDate.toISOString().split('T')[0];

                            const { data: recentData, error: recentError } = await supabase
                                .from('history_dse')
                                .select('date, ltp, high, low')
                                .eq('ticker', ticker)
                                .gte('date', startDateStr)
                                .order('date', { ascending: true })
                                .limit(100);

                            if (!recentError && recentData && recentData.length >= 15) {
                                const priceData = recentData.map(d => ({
                                    date: d.date,
                                    ltp: parseFloat(d.ltp),
                                    high: parseFloat(d.high) || parseFloat(d.ltp),
                                    low: parseFloat(d.low) || parseFloat(d.ltp)
                                }));
                                const rsiArr = calculateRSI(priceData.map(p => p.ltp), 14);
                                const lastRSI = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;
                                rsi = lastRSI !== null ? lastRSI : 0;
                                const sarData = calculateParabolicSAR(priceData);
                                const lastSAR = sarData.length > 0 ? sarData[sarData.length - 1].sar : 0;
                                psar = lastSAR;
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // Get category from cse_market_data
                    let category = 'N/A', recordDate = null, dividend = '-', peRatio = null, eps = null;
                    if (typeof supabase !== 'undefined' && supabase) {
                        try {
                            const { data: metaData, error: metaError } = await supabase
                                .from('cse_market_data')
                                .select('category, record_date, dividend, pe_ratio, eps')
                                .eq('code', ticker)
                                .order('date', { ascending: false })
                                .limit(1);
                            if (!metaError && metaData && metaData.length > 0) {
                                category = metaData[0].category || 'N/A';
                                recordDate = metaData[0].record_date || null;
                                dividend = metaData[0].dividend || '-';
                                peRatio = metaData[0].pe_ratio !== undefined ? parseFloat(metaData[0].pe_ratio) : null;
                                eps = metaData[0].eps !== undefined ? parseFloat(metaData[0].eps) : null;
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // Firebase fallback
                    if (category === 'N/A' && typeof db !== 'undefined') {
                        try {
                            const latestDoc = await db.collection('cse_detailed_data')
                                .where('code', '==', ticker)
                                .orderBy('date', 'desc')
                                .limit(1)
                                .get();
                            if (!latestDoc.empty) {
                                const latest = latestDoc.docs[0].data();
                                if (category === 'N/A') category = latest.category || 'N/A';
                                if (!recordDate) recordDate = latest.record_date || null;
                                if (dividend === '-') dividend = latest.dividend || '-';
                                if (peRatio === null) peRatio = latest.pe !== undefined ? parseFloat(latest.pe) : null;
                                if (eps === null) eps = latest.eps !== undefined ? parseFloat(latest.eps) : null;
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // Save to Firebase
                    if (typeof db !== 'undefined') {
                        await db.collection('stock_metadata').doc(ticker).set({
                            ticker,
                            ath,
                            ath_date: athDate,
                            atl,
                            atl_date: atlDate,
                            rsi,
                            psar,
                            category,
                            record_date: recordDate,
                            dividend,
                            pe: peRatio,
                            eps,
                            last_updated: new Date().toISOString()
                        }, { merge: true });
                    }

                    // Save to Supabase
                    if (typeof supabase !== 'undefined' && supabase) {
                        const supabaseData = {
                            ticker,
                            ath: ath > 0 ? ath : null,
                            ath_date: athDate || null,
                            atl: atl > 0 ? atl : null,
                            atl_date: atlDate || null,
                            rsi: rsi > 0 ? rsi : null,
                            psar: psar > 0 ? psar : null,
                            category: category || null,
                            record_date: recordDate || null,
                            dividend: dividend || null,
                            pe: peRatio !== null ? peRatio : null,
                            eps: eps !== null ? eps : null,
                            last_updated: new Date().toISOString()
                        };
                        const { error: upsertError } = await supabase
                            .from('stock_metadata')
                            .upsert(supabaseData, { onConflict: 'ticker' });
                        if (!upsertError) {
                            success++;
                            console.log(`✅ ${ticker} synced successfully`);
                        } else {
                            fail++;
                        }
                    } else {
                        success++;
                    }
                } catch (err) {
                    console.error(`❌ Error syncing ${ticker}:`, err.message);
                    fail++;
                }
            });

            await Promise.all(promises);
            const done = Math.min(batchIdx + BATCH_SIZE, total);
            if (onProgress) onProgress(done, total);

            if (batchIdx + BATCH_SIZE < tickers.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
        }

        if (onComplete) onComplete(success, fail);
        showToast(`✅ Metadata sync done! Success: ${success}, Failed: ${fail}`, success > 0 ? 'success' : 'error');
        console.log(`✅ syncAllMetadata completed: ${success} success, ${fail} failed`);
    } catch (error) {
        console.error('❌ syncAllMetadata fatal error:', error);
        showToast('❌ Sync failed: ' + error.message, 'error');
        if (onComplete) onComplete(0, 0);
    }
}

// ==========================================
// Sync with Progress (UI Button)
// ==========================================

export function syncAllMetadataWithProgress() {
    const btn = document.getElementById('btn-sync-metadata');
    const statusSpan = document.getElementById('sync-status');
    if (!btn || !statusSpan) {
        showToast('UI elements not found!', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '⏳ Syncing...';
    statusSpan.innerText = '⏳ Starting...';
    statusSpan.style.color = '#f59e0b';

    const onProgress = (current, total) => {
        const pct = Math.round((current / total) * 100);
        statusSpan.innerText = `⏳ ${current}/${total} (${pct}%)`;
        btn.innerHTML = `⏳ ${pct}%`;
    };

    const onComplete = (success, fail) => {
        btn.disabled = false;
        btn.innerHTML = '🔄 Sync Stock Metadata';
        if (success > 0 || fail > 0) {
            statusSpan.innerText = `✅ Done! ${success} success, ${fail} failed`;
            statusSpan.style.color = success > 0 ? '#10b981' : '#ef4444';
            showToast(`✅ Sync complete: ${success} success, ${fail} failed`, success > 0 ? 'success' : 'error');
        } else {
            statusSpan.innerText = '❌ No data synced';
            statusSpan.style.color = '#ef4444';
            showToast('❌ Sync failed. Check console for errors.', 'error');
        }
    };

    syncAllMetadata(onProgress, onComplete);
}

console.log('✅ sync-metadata.js loaded');