// ==========================================
// 🔔 notification.js - Notification Manager
// ==========================================

import { auth } from './firebase.js';
import { showToast } from './app-charts.js';

// ==========================================
// Configuration
// ==========================================

const NOTIFICATION_CONFIG = {
    STORAGE_KEY: 'price_alerts',
    DEFAULT_ICON: '/icons/icon-192x192.png',
    MAX_ALERTS: 50
};

const VAPID_PUBLIC_KEY = 'BIM7OOY5H_UhZAvSLqny_dP8X6v2sd2fuYUcWl4XEKkTUmZZm9wdQ8ypxosn7vBaSWMrbwE1devGNaEkzXK6wEg';
const PIPEDREAM_URL = 'https://eoq3tllbgorkvfp.m.pipedream.net';

// ==========================================
// Notification Manager Class
// ==========================================

export class NotificationManager {
    constructor() {
        this.permission = false;
        this.alerts = {};
        this.initialized = false;
        this.init();
    }

    async init() {
        try {
            if (!('Notification' in window)) {
                console.log('🔔 Notifications not supported in this browser');
                this.initialized = true;
                return;
            }

            if (Notification.permission === 'granted') {
                this.permission = true;
            } else if (Notification.permission === 'default') {
                const result = await Notification.requestPermission();
                this.permission = result === 'granted';
            }

            this.loadAlerts();
            console.log(`🔔 Notifications: ${this.permission ? '✅ Enabled' : '❌ Disabled'}`);
            this.initialized = true;
        } catch (error) {
            console.error('Notification init error:', error);
            this.initialized = true;
        }
    }

    loadAlerts() {
        try {
            const stored = localStorage.getItem(NOTIFICATION_CONFIG.STORAGE_KEY);
            if (stored) {
                this.alerts = JSON.parse(stored);
                for (const key in this.alerts) {
                    if (this.alerts[key].triggered) {
                        const triggerTime = this.alerts[key].triggeredAt || 0;
                        if (Date.now() - triggerTime > 86400000) {
                            this.alerts[key].triggered = false;
                            this.alerts[key].triggeredAt = null;
                        }
                    }
                }
                this.saveAlerts();
            }
        } catch (e) {
            console.warn('Failed to load alerts:', e);
            this.alerts = {};
        }
    }

    saveAlerts() {
        try {
            localStorage.setItem(NOTIFICATION_CONFIG.STORAGE_KEY, JSON.stringify(this.alerts));
        } catch (e) {
            console.warn('Failed to save alerts:', e);
        }
    }

    setAlert(ticker, targetPrice, direction = 'any', callback = null) {
        if (!ticker || !targetPrice || targetPrice <= 0) {
            console.warn('Invalid alert parameters');
            return false;
        }

        const keys = Object.keys(this.alerts);
        if (keys.length >= NOTIFICATION_CONFIG.MAX_ALERTS) {
            console.warn('Max alerts reached');
            return false;
        }

        this.alerts[ticker] = {
            target: targetPrice,
            direction: direction,
            triggered: false,
            triggeredAt: null,
            createdAt: Date.now(),
            callback: callback ? callback.toString() : null
        };

        this.saveAlerts();
        this.showNotification(
            `📊 Alert set for ${ticker}`,
            `Target: ৳${targetPrice.toFixed(2)} (${direction === 'any' ? 'any' : direction === 'up' ? '↑ up' : '↓ down'})`
        );
        return true;
    }

    removeAlert(ticker) {
        if (this.alerts[ticker]) {
            delete this.alerts[ticker];
            this.saveAlerts();
            this.showNotification(`🗑️ Alert removed for ${ticker}`, '');
            return true;
        }
        return false;
    }

    getAlerts() {
        return { ...this.alerts };
    }

    checkPriceAlerts(ticker, currentPrice) {
        if (!this.initialized || !this.permission) return;
        if (!ticker || currentPrice <= 0) return;

        const alert = this.alerts[ticker];
        if (!alert || alert.triggered) return;

        let shouldTrigger = false;
        let triggerMessage = '';

        if (alert.direction === 'up' && currentPrice >= alert.target) {
            shouldTrigger = true;
            triggerMessage = `📈 ${ticker} reached ৳${currentPrice.toFixed(2)} (Target: ৳${alert.target.toFixed(2)})`;
        } else if (alert.direction === 'down' && currentPrice <= alert.target) {
            shouldTrigger = true;
            triggerMessage = `📉 ${ticker} dropped to ৳${currentPrice.toFixed(2)} (Target: ৳${alert.target.toFixed(2)})`;
        } else if (alert.direction === 'any') {
            const changePercent = Math.abs((currentPrice - alert.target) / alert.target) * 100;
            if (changePercent >= 1) {
                shouldTrigger = true;
                const direction = currentPrice > alert.target ? '↑ up' : '↓ down';
                triggerMessage = `${ticker} moved ${direction} to ৳${currentPrice.toFixed(2)} (Target: ৳${alert.target.toFixed(2)})`;
            }
        }

        if (shouldTrigger) {
            alert.triggered = true;
            alert.triggeredAt = Date.now();
            this.saveAlerts();

            if (alert.callback) {
                try {
                    const fn = new Function('return ' + alert.callback)();
                    if (typeof fn === 'function') fn(ticker, currentPrice, alert.target);
                } catch (e) { /* ignore */ }
            }

            this.showNotification('🔔 Price Alert!', triggerMessage);
            this.sendPushToPipedream(ticker, currentPrice, alert.target);
        }
    }

    async sendPushToPipedream(ticker, currentPrice, targetPrice) {
        try {
            const subscriptionStr = localStorage.getItem('push_subscription');
            if (!subscriptionStr) {
                console.warn('No push subscription found.');
                return;
            }

            const subscription = JSON.parse(subscriptionStr);
            if (!subscription || !subscription.endpoint) {
                console.warn('Invalid subscription object.');
                return;
            }

            const payload = {
                title: `📈 StockPulse Alert: ${ticker}`,
                body: `Price reached ৳${currentPrice.toFixed(2)} (Target: ৳${targetPrice.toFixed(2)})`,
                icon: '/icons/icon-192x192.png',
                data: { ticker, currentPrice, targetPrice }
            };

            const response = await fetch(PIPEDREAM_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription, payload })
            });

            if (response.ok) {
                console.log('✅ Push notification sent to Pipedream');
            } else {
                console.error('❌ Pipedream request failed:', response.status);
            }
        } catch (error) {
            console.error('Error sending to Pipedream:', error);
        }
    }

    showDailySummary(pl, percentage, totalValue) {
        if (!this.initialized || !this.permission) return;
        const emoji = pl >= 0 ? '📈' : '📉';
        const body = `P&L: ${pl >= 0 ? '+' : ''}৳${pl.toFixed(2)} (${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%) | Total: ৳${totalValue.toFixed(2)}`;
        this.showNotification(`${emoji} Daily Portfolio Update`, body);
    }

    showNotification(title, body, icon = NOTIFICATION_CONFIG.DEFAULT_ICON) {
        if (!this.initialized || !this.permission) return;

        try {
            const options = {
                body: body || '',
                icon: icon,
                badge: '/icons/icon-96x96.png',
                vibrate: [200, 100, 200],
                requireInteraction: false,
                silent: false,
                tag: Date.now().toString()
            };
            new Notification(title, options);
        } catch (error) {
            console.warn('Notification show error:', error);
        }
    }

    resetAllAlerts() {
        this.alerts = {};
        this.saveAlerts();
        this.showNotification('🔄 All alerts reset', '');
    }

    getAlertStatus(ticker) {
        return this.alerts[ticker] || null;
    }

    getActiveAlerts() {
        const active = {};
        for (const [key, value] of Object.entries(this.alerts)) {
            if (!value.triggered) {
                active[key] = value;
            }
        }
        return active;
    }

    getTriggeredAlerts() {
        const triggered = {};
        for (const [key, value] of Object.entries(this.alerts)) {
            if (value.triggered) {
                triggered[key] = value;
            }
        }
        return triggered;
    }
}

// ==========================================
// Push Subscription
// ==========================================

export async function subscribeToPush() {
    try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('Push notifications not supported.');
            return null;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: VAPID_PUBLIC_KEY
            });
        }

        localStorage.setItem('push_subscription', JSON.stringify(subscription));
        console.log('✅ Push subscription saved:', subscription);
        return subscription;
    } catch (error) {
        console.error('❌ Subscription error:', error);
        return null;
    }
}

// ==========================================
// Global Notification Manager
// ==========================================

export let notificationManager = null;

try {
    notificationManager = new NotificationManager();
    if (typeof window !== 'undefined') {
        window.notificationManager = notificationManager;
        window.subscribeToPush = subscribeToPush;
    }
    console.log('✅ NotificationManager initialized with Pipedream support');
} catch (error) {
    console.error('❌ Failed to initialize NotificationManager:', error);
    notificationManager = new Proxy({}, {
        get: () => () => console.warn('NotificationManager unavailable')
    });
}

// ==========================================
// Request Notification Permission
// ==========================================

export async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('This browser does not support notifications.', 'error');
        return;
    }
    if (Notification.permission === 'granted') {
        showToast('✅ Notification already enabled!', 'success');
        await subscribeToPush();
        return;
    }
    if (Notification.permission === 'denied') {
        showToast('❌ Notification blocked. Please enable from browser settings.', 'error');
        return;
    }

    const result = await Notification.requestPermission();
    if (result === 'granted') {
        showToast('✅ Notification enabled!', 'success');
        if (notificationManager) notificationManager.permission = true;
        await subscribeToPush();
    } else {
        showToast('❌ Notification permission denied.', 'error');
    }
}

console.log('✅ notification.js loaded successfully');