// ==========================================
// 📁 supabase.js - Supabase Setup
// ==========================================

import CONFIG from './config.js';

const supabaseUrl = CONFIG.API.SUPABASE_URL;
const supabaseAnonKey = CONFIG.API.SUPABASE_ANON_KEY;

let supabaseClient = null;

if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        realtime: { autoConnect: false }
    });
    console.log('✅ Supabase client ready');
}

export { supabaseClient as supabase };
export default supabaseClient;