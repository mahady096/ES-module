// ==========================================
// 📅 record-date.js - Record Date Section
// ==========================================

import { supabase } from './supabase.js';
import { db } from './firebase.js';
import { showToast } from './app-charts.js';

let allRecordData = [];
let currentRecTab = 'all';
let currentRecFilter = null;

// ==========================================
// Load Record Date Section
// ==========================================

export async function loadRecordDateSection() {
    await loadAllRecordData();
    currentRecTab = 'all';
    currentRecFilter = null;
    renderRecTabButtons();
    renderRecTable();
    renderRecFilterButtons();
    attachRecTabEvents();
    attachRecFilterEvents();
}

// ==========================================
// Load All Record Data
// ==========================================

async function loadAllRecordData() {
    try {
        const companyMap = new Map();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Supabase cse_market_data
        if (typeof supabase !== 'undefined' && supabase) {
            try {
                const { data, error } = await supabase
                    .from('cse_market_data')
                    .select('code, record_date, dividend')
                    .not('record_date', 'is', null);

                if (!error && data && data.length > 0) {
                    data.forEach(item => {
                        const code = item.code;
                        if (!code) return;
                        const recordDateStr = item.record_date;
                        const dividend = item.dividend || '-';
                        const recordDateObj = parseRecordDate(recordDateStr);
                        if (!recordDateObj) return;
                        const diffTime = recordDateObj - today;
                        const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        if (!companyMap.has(code)) {
                            companyMap.set(code, {
                                code: code,
                                recordDate: recordDateStr,
                                recordDateObj: recordDateObj,
                                dividend: dividend,
                                daysDiff: daysDiff
                            });
                        } else {
                            const existing = companyMap.get(code);
                            if (recordDateObj > existing.recordDateObj) {
                                companyMap.set(code, {
                                    code: code,
                                    recordDate: recordDateStr,
                                    recordDateObj: recordDateObj,
                                    dividend: dividend,
                                    daysDiff: daysDiff
                                });
                            }
                        }
                    });
                }
            } catch (e) {
                console.warn('Supabase record date fetch failed:', e);
            }
        }

        // Firebase fallback
        if (companyMap.size === 0 && typeof db !== 'undefined') {
            try {
                const snapshot = await db.collection('cse_detailed_data')
                    .where('record_date', '!=', null)
                    .get();
                for (const doc of snapshot.docs) {
                    const data = doc.data();
                    const code = data.code;
                    if (!code) continue;
                    const recordDateStr = data.record_date;
                    const dividend = data.dividend || '-';
                    const recordDateObj = parseRecordDate(recordDateStr);
                    if (!recordDateObj) continue;
                    const diffTime = recordDateObj - today;
                    const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (!companyMap.has(code)) {
                        companyMap.set(code, {
                            code: code,
                            recordDate: recordDateStr,
                            recordDateObj: recordDateObj,
                            dividend: dividend,
                            daysDiff: daysDiff
                        });
                    }
                }
            } catch (err) {
                console.warn('Firebase record date fallback failed:', err);
            }
        }
        
        allRecordData = Array.from(companyMap.values());
        allRecordData.sort((a, b) => a.recordDateObj - b.recordDateObj);
        console.log(`✅ ${allRecordData.length} record dates loaded`);
    } catch (err) {
        console.error('Error loading record dates:', err);
        allRecordData = [];
        const tbody = document.getElementById('sec-record-date-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="4">Error loading data: ${err.message}</td></tr>`;
    }
}

// ==========================================
// Parse Record Date
// ==========================================

function parseRecordDate(dateStr) {
    if (!dateStr) return null;
    const cleaned = dateStr.replace(/,/g, '').trim();
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) return date;
    const parts = cleaned.split(' ');
    if (parts.length >= 3) {
        const day = parseInt(parts[0]);
        const month = parts[1];
        const year = parseInt(parts[2]);
        const monthMap = {
            'January':0,'February':1,'March':2,'April':3,'May':4,'June':5,
            'July':6,'August':7,'September':8,'October':9,'November':10,'December':11
        };
        const monthIdx = monthMap[month];
        if (!isNaN(day) && monthIdx !== undefined && !isNaN(year)) {
            return new Date(year, monthIdx, day);
        }
    }
    return null;
}

// ==========================================
// Render Table
// ==========================================

function renderRecTable() {
    let filteredData = [];
    if (currentRecTab === 'all') {
        filteredData = [...allRecordData];
    } else if (currentRecTab === 'upcoming') {
        filteredData = allRecordData.filter(item => item.daysDiff > 0);
    } else if (currentRecTab === 'previous') {
        filteredData = allRecordData.filter(item => item.daysDiff < 0);
    }
    
    if (currentRecFilter !== null && currentRecTab !== 'all') {
        if (currentRecTab === 'upcoming') {
            filteredData = filteredData.filter(item => item.daysDiff <= currentRecFilter);
        } else if (currentRecTab === 'previous') {
            filteredData = filteredData.filter(item => Math.abs(item.daysDiff) <= currentRecFilter);
        }
    }
    
    const tbody = document.getElementById('sec-record-date-tbody');
    if (!tbody) return;
    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4">No data found.</td></tr>`;
        return;
    }
    
    let html = '';
    for (const item of filteredData) {
        let daysText = '';
        if (currentRecTab === 'upcoming') daysText = `${item.daysDiff} days left`;
        else if (currentRecTab === 'previous') daysText = `${Math.abs(item.daysDiff)} days ago`;
        else daysText = item.daysDiff >= 0 ? `${item.daysDiff} days left` : `${Math.abs(item.daysDiff)} days ago`;
        
        html += `<tr>
            <td style="padding: 8px; cursor: pointer; color: var(--primary-color); text-decoration: underline;" 
                onclick="if(window.openStockDetailModal) window.openStockDetailModal('${item.code}')">${item.code}</td>
            <td style="padding: 8px;">${item.recordDate}</td>
            <td style="padding: 8px;">${item.dividend}</td>
            <td style="padding: 8px;">${daysText}</td>
         </tr>`;
    }
    tbody.innerHTML = html;
}

// ==========================================
// Render Filter Buttons
// ==========================================

function renderRecFilterButtons() {
    const container = document.getElementById('sec-filter-buttons-container');
    if (!container) return;
    const dayOptions = [2, 5, 7, 10, 15, 20, 30];
    
    if (currentRecTab === 'all') {
        container.style.display = 'none';
        return;
    } else {
        container.style.display = 'flex';
        let buttonsHtml = `<span style="font-size:12px; margin-right:8px;">📅 Filter by days:</span>`;
        dayOptions.forEach(days => {
            const isActive = (currentRecFilter === days);
            buttonsHtml += `<button class="rec-filter-btn" data-days="${days}" style="background: ${isActive ? 'var(--primary-color)' : 'transparent'}; border:1px solid var(--border-color); padding:4px 10px; border-radius:20px; cursor:pointer; color:var(--text-primary); margin-right:5px;">${days}</button>`;
        });
        const isAllActive = (currentRecFilter === null);
        buttonsHtml += `<button class="rec-filter-btn" data-days="all" style="background: ${isAllActive ? 'var(--primary-color)' : 'transparent'}; border:1px solid var(--border-color); padding:4px 10px; border-radius:20px; cursor:pointer; color:var(--text-primary);">All</button>`;
        container.innerHTML = buttonsHtml;
    }
}

// ==========================================
// Events
// ==========================================

function attachRecFilterEvents() {
    const btns = document.querySelectorAll('.rec-filter-btn');
    btns.forEach(btn => {
        btn.removeEventListener('click', recFilterHandler);
        btn.addEventListener('click', recFilterHandler);
    });
}

function recFilterHandler(e) {
    const daysVal = e.currentTarget.getAttribute('data-days');
    if (daysVal === 'all') {
        currentRecFilter = null;
    } else {
        currentRecFilter = parseInt(daysVal);
    }
    renderRecFilterButtons();
    renderRecTable();
    attachRecFilterEvents();
}

function renderRecTabButtons() {
    const btnAll = document.getElementById('sec-tab-all-rec');
    const btnUp = document.getElementById('sec-tab-upcoming-rec');
    const btnPrev = document.getElementById('sec-tab-previous-rec');
    const btns = [btnAll, btnUp, btnPrev];
    btns.forEach(btn => {
        if (btn) {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.border = '1px solid var(--border-color)';
            btn.style.color = 'var(--text-primary)';
        }
    });
    let activeBtn = null;
    if (currentRecTab === 'all') activeBtn = btnAll;
    else if (currentRecTab === 'upcoming') activeBtn = btnUp;
    else if (currentRecTab === 'previous') activeBtn = btnPrev;
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'var(--primary-color)';
        activeBtn.style.color = 'white';
        activeBtn.style.border = 'none';
    }
}

function attachRecTabEvents() {
    const btnAll = document.getElementById('sec-tab-all-rec');
    const btnUp = document.getElementById('sec-tab-upcoming-rec');
    const btnPrev = document.getElementById('sec-tab-previous-rec');
    
    if (btnAll) {
        btnAll.onclick = () => {
            currentRecTab = 'all';
            currentRecFilter = null;
            renderRecTabButtons();
            renderRecFilterButtons();
            renderRecTable();
            attachRecFilterEvents();
        };
    }
    if (btnUp) {
        btnUp.onclick = () => {
            currentRecTab = 'upcoming';
            currentRecFilter = null;
            renderRecTabButtons();
            renderRecFilterButtons();
            renderRecTable();
            attachRecFilterEvents();
        };
    }
    if (btnPrev) {
        btnPrev.onclick = () => {
            currentRecTab = 'previous';
            currentRecFilter = null;
            renderRecTabButtons();
            renderRecFilterButtons();
            renderRecTable();
            attachRecFilterEvents();
        };
    }
}

console.log('✅ record-date.js loaded');