/**
 * BODEGA INTELIGENTE - PWA Module
 * Progressive Web App functionality
 */

const PWA = {
    deferredPrompt: null,
    
    init() {
        this.registerServiceWorker();
        this.setupInstallPrompt();
        this.requestNotificationPermission();
    },
    
    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered:', registration);
                
                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showUpdateNotification();
                        }
                    });
                });
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    },
    
    setupInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallBanner();
        });
        
        window.addEventListener('appinstalled', () => {
            console.log('PWA installed');
            this.deferredPrompt = null;
            this.hideInstallBanner();
        });
    },
    
    showInstallBanner() {
        const banner = document.createElement('div');
        banner.id = 'install-banner';
        banner.innerHTML = `
            <div class="install-banner-content">
                <div class="install-icon">📱</div>
                <div class="install-text">
                    <h4>Instala Bodega Inteligente</h4>
                    <p>Accede más rápido y recibe notificaciones</p>
                </div>
                <div class="install-actions">
                    <button class="btn btn-primary btn-small" id="install-btn">Instalar</button>
                    <button class="icon-btn" id="dismiss-install">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        banner.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: var(--bg-elevated);
            border-top: var(--border-medium);
            box-shadow: var(--shadow-xl);
            z-index: 1000;
            animation: slideUp 0.3s ease-out;
            padding: var(--spacing-lg);
        `;
        
        document.body.appendChild(banner);
        
        // Event listeners
        document.getElementById('install-btn')?.addEventListener('click', () => {
            this.promptInstall();
        });
        
        document.getElementById('dismiss-install')?.addEventListener('click', () => {
            this.hideInstallBanner();
        });
    },
    
    hideInstallBanner() {
        const banner = document.getElementById('install-banner');
        if (banner) {
            banner.style.animation = 'slideDown 0.3s ease-out';
            setTimeout(() => banner.remove(), 300);
        }
    },
    
    async promptInstall() {
        if (!this.deferredPrompt) return;
        
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        
        console.log(`User response: ${outcome}`);
        this.deferredPrompt = null;
        this.hideInstallBanner();
    },
    
    async requestNotificationPermission() {
        if ('Notification' in window && 'permissions' in navigator) {
            const permission = await Notification.requestPermission();
            
            if (permission === 'granted') {
                console.log('Notification permission granted');
                this.scheduleNotifications();
            }
        }
    },
    
    scheduleNotifications() {
        // Schedule daily reminder
        setTimeout(() => {
            this.showNotification(
                '¡Hora de mejorar tu bodega!',
                'Revisa tus acciones pendientes del día',
                '/icon-192.png'
            );
        }, 24 * 60 * 60 * 1000); // 24 hours
    },
    
    showNotification(title, body, icon = '/icon-192.png') {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body,
                icon,
                badge: '/icon-192.png',
                tag: 'bodega-inteligente',
                requireInteraction: false
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        }
    },
    
    showUpdateNotification() {
        if (window.App) {
            window.App.showNotification(
                '✨ Actualización disponible - Recarga para obtener la última versión',
                5000
            );
        }
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PWA.init());
} else {
    PWA.init();
}

window.PWA = PWA;
