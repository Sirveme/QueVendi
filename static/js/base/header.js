/* ═══════════════════════════════════════════════════════════════════════════
   HEADER.JS - Lógica del header (menú usuario, notificaciones)
   ═══════════════════════════════════════════════════════════════════════════ */

const Header = {
    userMenu: null,
    
    /**
     * Inicializa el header
     */
    init() {
        this.userMenu = document.getElementById('user-menu');
        
        if (this.userMenu) {
            this.setupUserMenu();
        }
        
        this.setupNotifications();
        this.setupConnectionStatus();
        
        console.log('📌 Header inicializado');
    },
    
    /**
     * Configura el menú de usuario
     */
    setupUserMenu() {
        // Toggle del menú
        this.userMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            this.userMenu.classList.toggle('active');
        });
        
        // Cerrar al hacer click fuera
        document.addEventListener('click', () => {
            this.userMenu.classList.remove('active');
        });
        
        // Prevenir cierre al hacer click dentro del dropdown
        const dropdown = this.userMenu.querySelector('.header-dropdown');
        if (dropdown) {
            dropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    },
    
    /**
     * Configura el botón de notificaciones
     */
    setupNotifications() {
        const notifBtn = document.getElementById('notifications-btn');
        
        if (notifBtn) {
            notifBtn.addEventListener('click', () => {
                // TODO: Abrir panel de notificaciones
                Toast.info('Panel de notificaciones próximamente');
            });
        }
    },
    
    /**
     * Configura el indicador de estado de conexión
     */
    setupConnectionStatus() {
        this.updateConnectionStatus(navigator.onLine);
        
        window.addEventListener('online', () => {
            this.updateConnectionStatus(true);
            Toast.success('Conexión restablecida');
        });
        
        window.addEventListener('offline', () => {
            this.updateConnectionStatus(false);
            Toast.warning('Sin conexión a internet');
        });
    },
    
    /**
     * Actualiza el indicador de conexión
     */
    updateConnectionStatus(isOnline) {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;
        
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');
        
        if (dot) {
            dot.classList.remove('status-online', 'status-offline', 'status-syncing');
            dot.classList.add(isOnline ? 'status-online' : 'status-offline');
        }
        
        if (text) {
            text.textContent = isOnline ? 'Conectado' : 'Sin conexión';
        }
    },
    
    /**
     * Muestra estado de sincronización
     */
    showSyncing() {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;
        
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');
        
        if (dot) {
            dot.classList.remove('status-online', 'status-offline');
            dot.classList.add('status-syncing');
        }
        
        if (text) {
            text.textContent = 'Sincronizando...';
        }
    },
    
    /**
     * Actualiza el badge de notificaciones
     */
    updateNotificationBadge(count) {
        const badge = document.querySelector('#notifications-btn .badge');
        if (!badge) return;
        
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    },
    
    /**
     * Actualiza la información del usuario en el header
     */
    updateUserInfo(user) {
        if (!this.userMenu) return;
        
        const avatar = this.userMenu.querySelector('.header-user-avatar');
        const name = this.userMenu.querySelector('.header-user-name');
        const role = this.userMenu.querySelector('.header-user-role');
        
        if (avatar) {
            if (user.avatarUrl) {
                avatar.innerHTML = `<img src="${user.avatarUrl}" alt="${user.name}">`;
            } else {
                avatar.textContent = this.getInitials(user.name);
            }
        }
        
        if (name) {
            name.textContent = user.name;
        }
        
        if (role) {
            role.textContent = user.role;
        }
    },
    
    /**
     * Actualiza el logo y nombre del negocio
     */
    updateBusiness(business) {
        const logoIcon = document.querySelector('.header-logo-icon');
        const logoImg = document.querySelector('.header-logo-img');
        const logoText = document.querySelector('.header-logo-text');
        
        if (business.logoUrl && logoImg) {
            logoImg.src = business.logoUrl;
            logoImg.style.display = 'block';
            if (logoIcon) logoIcon.style.display = 'none';
        } else if (logoIcon) {
            logoIcon.textContent = business.icon || '🛒';
            logoIcon.style.display = 'flex';
            if (logoImg) logoImg.style.display = 'none';
        }
        
        if (logoText) {
            logoText.textContent = business.name;
        }
    },
    
    /**
     * Obtiene las iniciales de un nombre
     */
    getInitials(name) {
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    }
};


// Auto-inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    Header.init();
});


// Exportar para uso global
window.Header = Header;