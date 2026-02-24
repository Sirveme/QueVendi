/* ═══════════════════════════════════════════════════════════════════════════
   TOAST.JS - Sistema de notificaciones
   ═══════════════════════════════════════════════════════════════════════════ */

const Toast = {
    container: null,
    
    config: {
        position: 'top-right',
        duration: 3500,
        maxToasts: 4,
        showProgress: false
    },
    
    /**
     * Inicializa el sistema de toasts
     */
    init() {
        this.container = document.getElementById('toast-container');
        
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = `toast-container toast-${this.config.position}`;
            document.body.appendChild(this.container);
        }
        
        console.log('🔔 Toast inicializado');
    },
    
    /**
     * Muestra una notificación toast
     * @param {string} message - Mensaje a mostrar
     * @param {string} type - Tipo: success, error, warning, info
     * @param {string} title - Título opcional
     * @param {object} options - Opciones adicionales
     */
    show(message, type = 'info', title = '', options = {}) {
        if (!this.container) this.init();
        
        const opts = { ...this.config, ...options };
        
        // Limitar cantidad de toasts
        const existing = this.container.querySelectorAll('.toast');
        if (existing.length >= opts.maxToasts) {
            this.dismiss(existing[0]);
        }
        
        // Crear elemento
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Cerrar">×</button>
            ${opts.showProgress ? `<div class="toast-progress" style="animation-duration: ${opts.duration}ms"></div>` : ''}
        `;
        
        // Event listener para cerrar
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this.dismiss(toast);
        });
        
        // Insertar según posición
        if (opts.position.includes('bottom')) {
            this.container.prepend(toast);
        } else {
            this.container.appendChild(toast);
        }
        
        // Animar entrada
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });
        
        // Reproducir sonido
        this.playSound(type);
        
        // Auto-cerrar
        if (opts.duration > 0) {
            toast.timeoutId = setTimeout(() => {
                this.dismiss(toast);
            }, opts.duration);
        }
        
        return toast;
    },
    
    /**
     * Cierra un toast
     */
    dismiss(toast) {
        if (!toast || !toast.parentElement) return;
        
        // Cancelar timeout si existe
        if (toast.timeoutId) {
            clearTimeout(toast.timeoutId);
        }
        
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        
        setTimeout(() => {
            toast.remove();
        }, 300);
    },
    
    /**
     * Cierra todos los toasts
     */
    dismissAll() {
        const toasts = this.container?.querySelectorAll('.toast') || [];
        toasts.forEach(toast => this.dismiss(toast));
    },
    
    /**
     * Cambia la posición de los toasts
     */
    setPosition(position) {
        this.config.position = position;
        if (this.container) {
            this.container.className = `toast-container toast-${position}`;
        }
    },
    
    /**
     * Reproduce sonido según tipo
     */
    playSound(type) {
        if (typeof Sounds !== 'undefined') {
            switch (type) {
                case 'success':
                    Sounds.success();
                    break;
                case 'error':
                    Sounds.error();
                    break;
                case 'warning':
                case 'info':
                    Sounds.notification();
                    break;
            }
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // Métodos de conveniencia
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Toast de éxito
     */
    success(message, title = '') {
        return this.show(message, 'success', title);
    },
    
    /**
     * Toast de error
     */
    error(message, title = '') {
        return this.show(message, 'error', title);
    },
    
    /**
     * Toast de advertencia
     */
    warning(message, title = '') {
        return this.show(message, 'warning', title);
    },
    
    /**
     * Toast informativo
     */
    info(message, title = '') {
        return this.show(message, 'info', title);
    },
    
    /**
     * Toast de carga (no se cierra automáticamente)
     */
    loading(message = 'Cargando...') {
        return this.show(message, 'info', '', { duration: 0 });
    },
    
    /**
     * Toast con acción personalizada
     */
    withAction(message, actionText, actionCallback, type = 'info') {
        const toast = this.show(message, type, '', { duration: 0 });
        
        const actionBtn = document.createElement('button');
        actionBtn.className = 'btn btn-sm btn-ghost ml-2';
        actionBtn.textContent = actionText;
        actionBtn.addEventListener('click', () => {
            actionCallback();
            this.dismiss(toast);
        });
        
        toast.querySelector('.toast-content').appendChild(actionBtn);
        
        return toast;
    }
};


// Auto-inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    Toast.init();
});


// Exportar para uso global
window.Toast = Toast;