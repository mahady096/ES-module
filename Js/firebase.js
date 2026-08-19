// ==========================================
// 📁 firebase.js - Firebase Setup
// ==========================================

const firebaseConfig = {
    apiKey: "AIzaSyDdPlBysAhWdbJ8KLhwoQaf2Z5EkiYdOUg",
    authDomain: "my-share-market-495aa.firebaseapp.com",
    projectId: "my-share-market-495aa",
    storageBucket: "my-share-market-495aa.firebasestorage.app",
    messagingSenderId: "1022913056078",
    appId: "1:1022913056078:web:bcc317b13a880382d2221f",
    measurementId: "G-Z3J503NM5E"
};

let auth = null;
let db = null;

if (typeof firebase !== 'undefined') {
    // Firebase initialize
    if (!firebase.apps || firebase.apps.length === 0) {
        try {
            firebase.initializeApp(firebaseConfig);
            console.log("✅ Firebase initialized");
        } catch (error) {
            console.error("❌ Firebase init failed:", error);
        }
    }

    // Auth & Firestore
    try {
        auth = firebase.auth();
        db = firebase.firestore();
        console.log("✅ Firebase Auth & Firestore ready");
    } catch (error) {
        console.error("❌ Firebase services error:", error);
    }

    // Offline persistence
    if (db && typeof db.enablePersistence === 'function' && 'indexedDB' in window) {
        db.enablePersistence({ synchronizeTabs: true })
            .then(() => console.log('✅ Offline persistence enabled'))
            .catch(() => console.warn('⚠️ Persistence not available'));
    }

    // Auth state listener
    if (auth && typeof auth.onAuthStateChanged === 'function') {
        auth.onAuthStateChanged((user) => {
            if (user) {
                console.log(`✅ User logged in: ${user.email || user.uid}`);
            } else {
                console.log('👤 User logged out');
            }
        });
    }
}

export { auth, db, firebaseConfig };
export default { auth, db, firebaseConfig };