/* ═══════════════════════════════════════════════════════════════════════════
   MODAL.JS - Sistema de modales/diálogos
   ═══════════════════════════════════════════════════════════════════════════ */

const Modal = {
    activeModals: [],
    
    /**
     * Abre un modal por ID
     */
    open(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.warn(`Modal #${modalId} no encontrado`);
            return;
        }
        
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        this.activeModals.push(modalId);
        
        // Focus en el primer input si existe
        setTimeout(() => {
            const firstInput = modal.querySelector('input, select, textarea');
            if (firstInput) firstInput.focus();
        }, 100);
        
        // Sonido
        if (typeof Sounds !== 'undefined') {
            Sounds.pop();
        }
        
        return modal;
    },
    
    /**
     * Cierra un modal por ID
     */
    close(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        modal.classList.remove('active');
        
        // Remover de la lista de activos
        this.activeModals = this.activeModals.filter(id => id !== modalId);
        
        // Restaurar scroll si no hay más modales
        if (this.activeModals.length === 0) {
            document.body.style.overflow = '';
        }
    },
    
    /**
     * Cierra todos los modales abiertos
     */
    closeAll() {
        this.activeModals.forEach(id => {
            const modal = document.getElementById(id);
            if (modal) modal.classList.remove('active');
        });
        this.activeModals = [];
        document.body.style.overflow = '';
    },
    
    /**
     * Modal de confirmación
     * @param {string} message - Mensaje a mostrar
     * @param {function} onConfirm - Callback al confirmar
     * @param {object} options - Opciones: title, confirmText, cancelText, type
     */
    confirm(message, onConfirm, options = {}) {
        const opts = {
            title: 'Confirmar',
            confirmText: 'Confirmar',
            cancelText: 'Cancelar',
            type: 'warning', // warning, danger, success, info
            ...options
        };
        
        // Verificar si existe el modal de confirmación
        let modal = document.getElementById('confirm-modal');
        
        if (!modal) {
            // Crear modal de confirmación
            modal = document.createElement('div');
            modal.id = 'confirm-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3 class="modal-title" id="confirm-title"></h3>
                        <button class="modal-close" onclick="Modal.close('confirm-modal')">×</button>
                    </div>
                    <div class="modal-body modal-body-centered">
                        <div class="modal-confirm-icon" id="confirm-icon"></div>
                        <p class="modal-confirm-message" id="confirm-message"></p>
                    </div>
                    <div class="modal-footer modal-footer-centered">
                        <button class="btn btn-secondary" id="confirm-cancel-btn">Cancelar</button>
                        <button class="btn" id="confirm-ok-btn">Confirmar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Click en overlay cierra
            modal.addEventListener('click', (e) => {
                if (e.target === modal) Modal.close('confirm-modal');
            });
        }
        
        // Configurar contenido
        document.getElementById('confirm-title').textContent = opts.title;
        document.getElementById('confirm-message').textContent = message;
        
        // Configurar icono según tipo
        const iconEl = document.getElementById('confirm-icon');
        const icons = {
            warning: '⚠️',
            danger: '🗑️',
            success: '✓',
            info: 'ℹ️'
        };
        iconEl.textContent = icons[opts.type] || icons.warning;
        iconEl.className = `modal-confirm-icon modal-confirm-icon-${opts.type}`;
        
        // Configurar botones
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        const okBtn = document.getElementById('confirm-ok-btn');
        
        cancelBtn.textContent = opts.cancelText;
        okBtn.textContent = opts.confirmText;
        okBtn.className = `btn btn-${opts.type === 'danger' ? 'danger' : 'primary'}`;
        
        // Event listeners (remover anteriores)
        const newCancelBtn = cancelBtn.cloneNode(true);
        const newOkBtn = okBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        okBtn.parentNode.replaceChild(newOkBtn, okBtn);
        
        newCancelBtn.addEventListener('click', () => {
            Modal.close('confirm-modal');
        });
        
        newOkBtn.addEventListener('click', () => {
            Modal.close('confirm-modal');
            if (typeof onConfirm === 'function') {
                onConfirm();
            }
        });
        
        this.open('confirm-modal');
    },
    
    /**
     * Modal de alerta (solo OK)
     */
    alert(message, title = 'Aviso', type = 'info') {
        return new Promise((resolve) => {
            this.confirm(message, resolve, {
                title,
                type,
                confirmText: 'Aceptar',
                cancelText: '' // Sin botón de cancelar
            });
            
            // Ocultar botón de cancelar
            setTimeout(() => {
                const cancelBtn = document.getElementById('confirm-cancel-btn');
                if (cancelBtn) cancelBtn.style.display = 'none';
            }, 0);
        });
    },
    
    /**
     * Modal con input (prompt)
     */
    prompt(message, defaultValue = '', options = {}) {
        return new Promise((resolve) => {
            const opts = {
                title: 'Ingrese un valor',
                confirmText: 'Aceptar',
                cancelText: 'Cancelar',
                placeholder: '',
                type: 'text',
                ...options
            };
            
            let modal = document.getElementById('prompt-modal');
            
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'prompt-modal';
                modal.className = 'modal-overlay';
                modal.innerHTML = `
                    <div class="modal modal-sm">
                        <div class="modal-header">
                            <h3 class="modal-title" id="prompt-title"></h3>
                            <button class="modal-close" onclick="Modal.close('prompt-modal')">×</button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-3" id="prompt-message"></p>
                            <input type="text" class="form-input" id="prompt-input">
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="prompt-cancel-btn">Cancelar</button>
                            <button class="btn btn-primary" id="prompt-ok-btn">Aceptar</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            
            document.getElementById('prompt-title').textContent = opts.title;
            document.getElementById('prompt-message').textContent = message;
            
            const input = document.getElementById('prompt-input');
            input.type = opts.type;
            input.placeholder = opts.placeholder;
            input.value = defaultValue;
            
            const cancelBtn = document.getElementById('prompt-cancel-btn');
            const okBtn = document.getElementById('prompt-ok-btn');
            
            cancelBtn.textContent = opts.cancelText;
            okBtn.textContent = opts.confirmText;
            
            // Event listeners
            const newCancelBtn = cancelBtn.cloneNode(true);
            const newOkBtn = okBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            
            newCancelBtn.addEventListener('click', () => {
                Modal.close('prompt-modal');
                resolve(null);
            });
            
            newOkBtn.addEventListener('click', () => {
                Modal.close('prompt-modal');
                resolve(input.value);
            });
            
            // Enter para confirmar
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    Modal.close('prompt-modal');
                    resolve(input.value);
                }
            });
            
            this.open('prompt-modal');
        });
    },
    
    /**
     * Crea un modal dinámicamente
     */
    create(options) {
        const opts = {
            id: 'dynamic-modal-' + Date.now(),
            title: '',
            content: '',
            footer: '',
            size: '', // sm, md, lg, xl
            closable: true,
            ...options
        };
        
        const modal = document.createElement('div');
        modal.id = opts.id;
        modal.className = 'modal-overlay';
        
        modal.innerHTML = `
            <div class="modal ${opts.size ? 'modal-' + opts.size : ''}">
                ${opts.title ? `
                    <div class="modal-header">
                        <h3 class="modal-title">${opts.title}</h3>
                        ${opts.closable ? `<button class="modal-close" onclick="Modal.close('${opts.id}')">×</button>` : ''}
                    </div>
                ` : ''}
                <div class="modal-body">
                    ${opts.content}
                </div>
                ${opts.footer ? `
                    <div class="modal-footer">
                        ${opts.footer}
                    </div>
                ` : ''}
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Click en overlay cierra si es closable
        if (opts.closable) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) Modal.close(opts.id);
            });
        }
        
        return opts.id;
    },
    
    /**
     * Destruye un modal dinámico
     */
    destroy(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            this.close(modalId);
            setTimeout(() => modal.remove(), 300);
        }
    }
};


// Event listener global para ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && Modal.activeModals.length > 0) {
        const lastModalId = Modal.activeModals[Modal.activeModals.length - 1];
        Modal.close(lastModalId);
    }
});


// Exportar para uso global
window.Modal = Modal;