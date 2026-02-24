/* ═══════════════════════════════════════════════════════════════════════════
   LOADER.JS - Indicador de carga global
   ═══════════════════════════════════════════════════════════════════════════ */

const Loader = {
    overlay: null,
    iconEl: null,
    textEl: null,
    
    /**
     * Iconos por tipo de negocio (nicho)
     */
    icons: {
        bodega: '🛒',
        minimarket: '🛒',
        restaurante: '🍽️',
        cafeteria: '☕',
        bar: '🍺',
        farmacia: '💊',
        ferreteria: '🔧',
        libreria: '📚',
        tienda: '🏪',
        default: '⏳'
    },
    
    /**
     * Nicho actual del negocio
     */
    currentNicho: 'bodega',
    
    /**
     * Inicializa el loader
     */
    init() {
        this.overlay = document.getElementById('loader-overlay');
        this.iconEl = document.getElementById('loader-icon');
        this.textEl = document.querySelector('.loader-text');
        
        // Si no existe el overlay, crearlo
        if (!this.overlay) {
            this.createOverlay();
        }
        
        console.log('⏳ Loader inicializado');
    },
    
    /**
     * Crea el overlay del loader si no existe
     */
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'loader-overlay';
        this.overlay.className = 'loader-overlay';
        this.overlay.innerHTML = `
            <div class="loader-icon" id="loader-icon">${this.icons[this.currentNicho]}</div>
            <div class="loader-text">Cargando...</div>
        `;
        document.body.appendChild(this.overlay);
        
        this.iconEl = this.overlay.querySelector('#loader-icon');
        this.textEl = this.overlay.querySelector('.loader-text');
    },
    
    /**
     * Establece el nicho del negocio (para el icono)
     */
    setNicho(nicho) {
        this.currentNicho = nicho;
        if (this.iconEl) {
            this.iconEl.textContent = this.icons[nicho] || this.icons.default;
        }
    },
    
    /**
     * Muestra el loader
     * @param {string} text - Texto opcional a mostrar
     * @param {string} nicho - Nicho opcional (para cambiar el icono)
     */
    show(text = 'Cargando...', nicho = null) {
        if (!this.overlay) this.init();
        
        // Actualizar icono si se especifica nicho
        if (nicho && this.iconEl) {
            this.iconEl.textContent = this.icons[nicho] || this.icons.default;
        } else if (this.iconEl) {
            this.iconEl.textContent = this.icons[this.currentNicho] || this.icons.default;
        }
        
        // Actualizar texto
        if (this.textEl) {
            this.textEl.textContent = text;
        }
        
        this.overlay.classList.add('active');
    },
    
    /**
     * Oculta el loader
     */
    hide() {
        if (this.overlay) {
            this.overlay.classList.remove('active');
        }
    },
    
    /**
     * Muestra el loader, ejecuta una función async, y oculta el loader
     * @param {function} asyncFn - Función async a ejecutar
     * @param {string} text - Texto del loader
     */
    async wrap(asyncFn, text = 'Cargando...') {
        this.show(text);
        try {
            const result = await asyncFn();
            return result;
        } finally {
            this.hide();
        }
    },
    
    /**
     * Muestra el loader por un tiempo determinado
     */
    showFor(ms, text = 'Cargando...') {
        this.show(text);
        return new Promise(resolve => {
            setTimeout(() => {
                this.hide();
                resolve();
            }, ms);
        });
    }
};


/**
 * Loader inline (pequeño, para botones o secciones)
 */
const InlineLoader = {
    /**
     * Crea un loader inline
     */
    create(text = 'Cargando...') {
        const loader = document.createElement('span');
        loader.className = 'loader-inline';
        loader.innerHTML = `
            <span class="loader-spinner"></span>
            <span>${text}</span>
        `;
        return loader;
    },
    
    /**
     * Añade loader a un botón mientras se ejecuta una acción
     */
    async wrapButton(button, asyncFn) {
        const originalContent = button.innerHTML;
        const originalDisabled = button.disabled;
        
        button.disabled = true;
        button.innerHTML = `
            <span class="loader-spinner" style="width: 14px; height: 14px; border-width: 2px;"></span>
            <span>Procesando...</span>
        `;
        
        try {
            const result = await asyncFn();
            return result;
        } finally {
            button.innerHTML = originalContent;
            button.disabled = originalDisabled;
        }
    }
};


// Auto-inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    Loader.init();
});


// Exportar para uso global
window.Loader = Loader;
window.InlineLoader = InlineLoader;