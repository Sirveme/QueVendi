/* ═══════════════════════════════════════════════════════════════════════════
   LAYOUT.JS - Configuración global y utilidades
   Sistema unificado para: QueVendi.pro | Metraes.com | Sirveme1.com
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Settings - Gestión de preferencias del usuario
 * Maneja: tema, esquema de colores, tamaño de fuente, posición de toasts
 */
const Settings = {
    defaults: {
        theme: 'light',
        colorScheme: 'moderno',
        fontSize: 'small',
        toastPosition: 'top-right',
        soundEnabled: true
    },
    
    config: {},
    
    /**
     * Inicializa Settings cargando configuración guardada
     */
    init() {
        // Cargar configuración guardada
        const saved = JSON.parse(localStorage.getItem('userSettings') || '{}');
        this.config = { ...this.defaults, ...saved };
        
        // Aplicar configuración
        this.applyAll();
        
        // Event listeners del panel
        this.setupEventListeners();
        
        console.log('⚙️ Settings inicializado:', this.config);
    },
    
    /**
     * Configura los event listeners
     */
    setupEventListeners() {
        // Botón de abrir settings
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.openPanel());
        }
        
        // Botón de cerrar settings
        const settingsClose = document.getElementById('settings-close');
        if (settingsClose) {
            settingsClose.addEventListener('click', () => this.closePanel());
        }
        
        // Overlay para cerrar
        const settingsOverlay = document.getElementById('settings-overlay');
        if (settingsOverlay) {
            settingsOverlay.addEventListener('click', () => this.closePanel());
        }
        
        // Toggle de tema en header
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleDarkMode());
        }
        
        // Checkbox de modo oscuro en panel
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.checked = this.config.theme === 'dark';
            darkModeToggle.addEventListener('change', () => this.toggleDarkMode());
        }
    },
    
    /**
     * Aplica toda la configuración
     */
    applyAll() {
        this.setTheme(this.config.theme, false);
        this.setColorScheme(this.config.colorScheme, false);
        this.setFontSize(this.config.fontSize, false);
        this.setToastPosition(this.config.toastPosition, false);
    },
    
    /**
     * Guarda la configuración en localStorage
     */
    save() {
        this.config = {
            theme: document.documentElement.getAttribute('data-theme'),
            colorScheme: document.documentElement.getAttribute('data-color-scheme'),
            fontSize: document.documentElement.getAttribute('data-font-size'),
            toastPosition: Toast?.config?.position || 'top-right',
            soundEnabled: this.config.soundEnabled
        };
        localStorage.setItem('userSettings', JSON.stringify(this.config));
    },
    
    /**
     * Abre el panel de configuración
     */
    openPanel() {
        document.getElementById('settings-panel')?.classList.add('active');
        document.getElementById('settings-overlay')?.classList.add('active');
    },
    
    /**
     * Cierra el panel de configuración
     */
    closePanel() {
        document.getElementById('settings-panel')?.classList.remove('active');
        document.getElementById('settings-overlay')?.classList.remove('active');
    },
    
    /**
     * Establece el tema (claro/oscuro)
     */
    setTheme(theme, showToast = true) {
        document.documentElement.setAttribute('data-theme', theme);
        
        // Actualizar checkbox si existe
        const checkbox = document.getElementById('dark-mode-toggle');
        if (checkbox) checkbox.checked = theme === 'dark';
        
        this.save();
        
        if (showToast && typeof Toast !== 'undefined') {
            Toast.info(theme === 'dark' ? 'Modo oscuro' : 'Modo claro');
        }
    },
    
    /**
     * Alterna entre modo claro y oscuro
     */
    toggleDarkMode() {
        const current = document.documentElement.getAttribute('data-theme');
        this.setTheme(current === 'dark' ? 'light' : 'dark');
    },
    
    /**
     * Establece el esquema de colores
     */
    setColorScheme(scheme, showToast = true) {
        document.documentElement.setAttribute('data-color-scheme', scheme);
        
        // Actualizar botones del panel
        document.querySelectorAll('.color-scheme-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`.color-scheme-${scheme}`)?.classList.add('active');
        
        this.save();
        
        const names = { moderno: 'Moderno', calido: 'Cálido', elegante: 'Elegante' };
        if (showToast && typeof Toast !== 'undefined') {
            Toast.info(`Tema ${names[scheme]}`);
        }
    },
    
    /**
     * Establece el tamaño de fuente
     */
    setFontSize(size, showToast = true) {
        document.documentElement.setAttribute('data-font-size', size);
        
        // Actualizar botones del panel
        document.querySelectorAll('.font-size-btn').forEach(btn => {
            btn.classList.remove('active');
            const btnSize = btn.getAttribute('data-size');
            if (btnSize === size) btn.classList.add('active');
        });
        
        this.save();
        
        const names = { small: 'Pequeño', medium: 'Mediano', large: 'Grande' };
        if (showToast && typeof Toast !== 'undefined') {
            Toast.info(`Texto ${names[size]}`);
        }
    },
    
    /**
     * Establece la posición de los toasts
     */
    setToastPosition(position, showToast = true) {
        if (typeof Toast !== 'undefined') {
            Toast.setPosition(position);
        }
        
        // Actualizar botones del panel
        document.querySelectorAll('.toast-pos-btn').forEach(btn => {
            btn.classList.remove('active');
            const btnPos = btn.getAttribute('data-position');
            if (btnPos === position) btn.classList.add('active');
        });
        
        this.save();
        
        const names = {
            'top-right': 'Arriba derecha',
            'top-center': 'Arriba centro',
            'bottom-right': 'Abajo derecha',
            'bottom-center': 'Abajo centro'
        };
        if (showToast && typeof Toast !== 'undefined') {
            Toast.info(`Notificaciones: ${names[position]}`);
        }
    },
    
    /**
     * Activa/desactiva sonidos
     */
    setSoundEnabled(enabled) {
        this.config.soundEnabled = enabled;
        this.save();
    }
};


/**
 * Utilidades globales
 */
const Utils = {
    /**
     * Formatea un número como moneda (Soles)
     */
    formatCurrency(value, decimals = 2) {
        return `S/ ${parseFloat(value || 0).toFixed(decimals)}`;
    },
    
    /**
     * Formatea una fecha
     */
    formatDate(date, format = 'short') {
        const d = new Date(date);
        if (format === 'short') {
            return d.toLocaleDateString('es-PE');
        }
        return d.toLocaleDateString('es-PE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    },
    
    /**
     * Formatea fecha y hora
     */
    formatDateTime(date) {
        const d = new Date(date);
        return d.toLocaleString('es-PE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },
    
    /**
     * Debounce - Retrasa la ejecución de una función
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    /**
     * Genera un ID único
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },
    
    /**
     * Copia texto al portapapeles
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            Toast.success('Copiado al portapapeles');
            return true;
        } catch (err) {
            Toast.error('No se pudo copiar');
            return false;
        }
    },
    
    /**
     * Obtiene iniciales de un nombre
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


/**
 * Sonidos del sistema
 */
const Sounds = {
    elements: {},
    
    init() {
        // Pre-cargar sonidos
        const soundIds = [
            'sound-success', 'sound-error', 'sound-notification',
            'sound-click', 'sound-pop', 'sound-swoosh', 'sound-alert',
            'voice-confirm', 'voice-cancel', 'voice-error'
        ];
        
        soundIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) this.elements[id] = el;
        });
    },
    
    play(soundId, volume = 0.5) {
        if (!Settings.config.soundEnabled) return;
        
        const sound = this.elements[soundId];
        if (sound) {
            sound.currentTime = 0;
            sound.volume = volume;
            sound.play().catch(() => {}); // Ignorar errores de autoplay
        }
    },
    
    success() { this.play('sound-success'); },
    error() { this.play('sound-error'); },
    notification() { this.play('sound-notification'); },
    click() { this.play('sound-click', 0.3); },
    pop() { this.play('sound-pop', 0.4); }
};


/**
 * Inicialización global
 */
document.addEventListener('DOMContentLoaded', () => {
    Settings.init();
    Sounds.init();
    
    // Cerrar panels con ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            Settings.closePanel();
            if (typeof Modal !== 'undefined') {
                document.querySelectorAll('.modal-overlay.active').forEach(m => {
                    m.classList.remove('active');
                });
            }
        }
    });
});


// Exportar para uso global
window.Settings = Settings;
window.Utils = Utils;
window.Sounds = Sounds;