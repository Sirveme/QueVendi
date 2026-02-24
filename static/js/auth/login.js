/* ═══════════════════════════════════════════════════════════════════════════
   LOGIN.JS - Lógica de autenticación
   QueVendi.pro | Metraes.com | Sirveme1.com
   ═══════════════════════════════════════════════════════════════════════════ */

const Login = {
    API_URL: window.location.origin,
    
    // ═══════════════════════════════════════════════════════════════════════
    // INICIALIZACIÓN
    // ═══════════════════════════════════════════════════════════════════════
    
    init() {
        this.setupTabs();
        this.setupForms();
        this.setupPasswordToggles();
        this.setupValidations();
        this.setupPasswordStrength();
        this.checkRememberedUser();
        
        console.log('🔐 Login inicializado');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // TABS (Login / Registro)
    // ═══════════════════════════════════════════════════════════════════════
    
    setupTabs() {
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                this.switchTab(target);
            });
        });
    },
    
    switchTab(tab) {
        // Actualizar tabs
        document.querySelectorAll('.auth-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        
        // Actualizar formularios
        document.querySelectorAll('.auth-form').forEach(f => {
            f.classList.toggle('active', f.id === `form-${tab}`);
        });
        
        // Limpiar mensajes
        this.hideMessage();
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // FORMULARIOS
    // ═══════════════════════════════════════════════════════════════════════
    
    setupForms() {
        // Formulario de Login
        const loginForm = document.getElementById('form-login');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }
        
        // Formulario de Registro
        const registerForm = document.getElementById('form-registro');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }
        
        // Formulario de Cambio de Clave (primera vez)
        const changePassForm = document.getElementById('form-change-password');
        if (changePassForm) {
            changePassForm.addEventListener('submit', (e) => this.handleChangePassword(e));
        }
        
        // Link de Olvidé mi clave
        const forgotLink = document.getElementById('forgot-password-link');
        if (forgotLink) {
            forgotLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showRecoverModal();
            });
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // TOGGLE DE CONTRASEÑA (Ojo)
    // ═══════════════════════════════════════════════════════════════════════
    
    setupPasswordToggles() {
        document.querySelectorAll('.input-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const input = toggle.parentElement.querySelector('input');
                const isPassword = input.type === 'password';
                
                input.type = isPassword ? 'text' : 'password';
                toggle.dataset.visible = isPassword ? 'true' : 'false';
            });
        });
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // VALIDACIONES EN TIEMPO REAL
    // ═══════════════════════════════════════════════════════════════════════
    
    setupValidations() {
        // DNI: Solo 8 dígitos
        document.querySelectorAll('input[data-type="dni"]').forEach(input => {
            input.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
                this.validateField(e.target);
            });
            
            input.addEventListener('blur', (e) => this.validateField(e.target));
        });
        
        // PIN: Solo 4-6 dígitos
        document.querySelectorAll('input[data-type="pin"]').forEach(input => {
            input.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
                this.validateField(e.target);
            });
        });
        
        // Teléfono: Solo 9 dígitos
        document.querySelectorAll('input[data-type="phone"]').forEach(input => {
            input.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 9);
            });
        });
    },
    
    validateField(input) {
        const type = input.dataset.type;
        const value = input.value;
        let isValid = true;
        let message = '';
        
        switch (type) {
            case 'dni':
                isValid = /^\d{8}$/.test(value);
                message = isValid ? '' : 'DNI debe tener 8 dígitos';
                break;
            case 'pin':
                isValid = /^\d{4,6}$/.test(value);
                message = isValid ? '' : 'PIN debe tener 4-6 dígitos';
                break;
        }
        
        // Mostrar/ocultar error
        const errorEl = input.parentElement.querySelector('.form-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = message ? 'block' : 'none';
        }
        
        input.classList.toggle('form-input-error', !isValid && value.length > 0);
        
        return isValid;
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // INDICADOR DE FUERZA DE CONTRASEÑA
    // ═══════════════════════════════════════════════════════════════════════
    
    setupPasswordStrength() {
        const passwordInput = document.getElementById('register-password');
        if (!passwordInput) return;
        
        passwordInput.addEventListener('input', (e) => {
            this.updatePasswordStrength(e.target.value);
            this.updatePasswordRequirements(e.target.value);
        });
    },
    
    updatePasswordStrength(password) {
        const strengthFill = document.querySelector('.password-strength-fill');
        const strengthText = document.querySelector('.password-strength-text');
        
        if (!strengthFill || !strengthText) return;
        
        const strength = this.calculatePasswordStrength(password);
        
        // Quitar clases anteriores
        strengthFill.classList.remove('weak', 'fair', 'good', 'strong');
        strengthText.classList.remove('weak', 'fair', 'good', 'strong');
        
        if (password.length === 0) {
            strengthFill.style.width = '0%';
            strengthText.textContent = '';
            return;
        }
        
        // Aplicar nueva clase
        strengthFill.classList.add(strength.level);
        strengthText.classList.add(strength.level);
        strengthText.textContent = strength.text;
    },
    
    calculatePasswordStrength(password) {
        let score = 0;
        
        if (password.length >= 6) score++;
        if (password.length >= 8) score++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        
        if (score <= 1) return { level: 'weak', text: 'Débil - Fácil de adivinar' };
        if (score === 2) return { level: 'fair', text: 'Regular - Podría ser mejor' };
        if (score === 3) return { level: 'good', text: 'Buena - Bastante segura' };
        return { level: 'strong', text: 'Excelente - Muy segura' };
    },
    
    updatePasswordRequirements(password) {
        const requirements = {
            'req-length': password.length >= 6,
            'req-uppercase': /[A-Z]/.test(password),
            'req-number': /\d/.test(password),
            'req-special': /[^a-zA-Z0-9]/.test(password)
        };
        
        Object.entries(requirements).forEach(([id, met]) => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.toggle('met', met);
                const icon = el.querySelector('.password-requirement-icon');
                if (icon) icon.textContent = met ? '✓' : '○';
            }
        });
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // RECORDAR USUARIO
    // ═══════════════════════════════════════════════════════════════════════
    
    checkRememberedUser() {
        const rememberedDni = localStorage.getItem('remembered_dni');
        if (rememberedDni) {
            const dniInput = document.getElementById('login-dni');
            const rememberCheck = document.getElementById('remember-me');
            
            if (dniInput) dniInput.value = rememberedDni;
            if (rememberCheck) rememberCheck.checked = true;
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // HANDLERS DE FORMULARIOS
    // ═══════════════════════════════════════════════════════════════════════
    
    async handleLogin(e) {
        e.preventDefault();
        
        const dni = document.getElementById('login-dni').value.trim();
        const pin = document.getElementById('login-pin').value.trim();
        const remember = document.getElementById('remember-me')?.checked;
        
        // Validaciones
        if (!dni || dni.length !== 8) {
            this.showMessage('DNI debe tener 8 dígitos', 'error');
            return;
        }
        
        if (!pin || pin.length < 4) {
            this.showMessage('PIN debe tener al menos 4 dígitos', 'error');
            return;
        }
        
        // Mostrar loading
        this.setLoading('login', true);
        
        try {
            const response = await fetch(`${this.API_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, pin })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Guardar DNI si "Recordarme" está marcado
                if (remember) {
                    localStorage.setItem('remembered_dni', dni);
                } else {
                    localStorage.removeItem('remembered_dni');
                }
                
                // Guardar token y datos
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                // Verificar si es primera vez (clave = DNI)
                if (data.first_login) {
                    this.showChangePasswordForm(data);
                    return;
                }
                
                // Éxito
                this.showMessage(`¡Bienvenido ${data.user.full_name}!`, 'success');
                
                setTimeout(() => {
                    window.location.href = '/home';
                }, 1000);
                
            } else {
                this.showMessage(data.detail || 'DNI o PIN incorrectos', 'error');
            }
            
        } catch (error) {
            console.error('Error en login:', error);
            this.showMessage('Error de conexión. Intenta nuevamente.', 'error');
        } finally {
            this.setLoading('login', false);
        }
    },
    
    async handleRegister(e) {
        e.preventDefault();
        
        const formData = {
            document_type: document.getElementById('register-doc-type').value,
            document_number: document.getElementById('register-doc-number').value.trim(),
            phone: document.getElementById('register-phone').value.trim(),
            business_type: document.getElementById('register-business-type').value,
            owner_dni: document.getElementById('register-owner-dni').value.trim(),
            owner_pin: document.getElementById('register-password').value
        };
        
        // Validaciones
        if (!formData.document_number || formData.document_number.length < 8) {
            this.showMessage('Documento inválido', 'error');
            return;
        }
        
        if (!formData.phone || formData.phone.length !== 9) {
            this.showMessage('Teléfono debe tener 9 dígitos', 'error');
            return;
        }
        
        if (!formData.owner_pin || formData.owner_pin.length < 4) {
            this.showMessage('Clave debe tener al menos 4 caracteres', 'error');
            return;
        }
        
        this.setLoading('registro', true);
        
        try {
            const response = await fetch(`${this.API_URL}/api/v1/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('user', JSON.stringify(data.user));
                localStorage.setItem('store', JSON.stringify(data.store));
                
                this.showMessage('¡Registro exitoso!', 'success');
                
                setTimeout(() => {
                    window.location.href = '/onboarding';
                }, 1000);
                
            } else {
                this.showMessage(data.detail || 'Error en el registro', 'error');
            }
            
        } catch (error) {
            console.error('Error en registro:', error);
            this.showMessage('Error de conexión. Intenta nuevamente.', 'error');
        } finally {
            this.setLoading('registro', false);
        }
    },
    
    async handleChangePassword(e) {
        e.preventDefault();
        
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        
        if (newPassword !== confirmPassword) {
            this.showMessage('Las claves no coinciden', 'error');
            return;
        }
        
        if (newPassword.length < 6) {
            this.showMessage('La nueva clave debe tener al menos 6 caracteres', 'error');
            return;
        }
        
        this.setLoading('change-password', true);
        
        try {
            const token = localStorage.getItem('access_token');
            
            const response = await fetch(`${this.API_URL}/api/v1/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ new_password: newPassword })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showMessage('¡Clave actualizada correctamente!', 'success');
                
                setTimeout(() => {
                    window.location.href = '/home';
                }, 1000);
            } else {
                this.showMessage(data.detail || 'Error al cambiar clave', 'error');
            }
            
        } catch (error) {
            console.error('Error:', error);
            this.showMessage('Error de conexión', 'error');
        } finally {
            this.setLoading('change-password', false);
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // MODAL DE RECUPERAR CONTRASEÑA
    // ═══════════════════════════════════════════════════════════════════════
    
    showRecoverModal() {
        const modalId = Modal.create({
            id: 'recover-modal',
            title: '🔑 Recuperar Acceso',
            size: 'sm',
            content: `
                <div class="recover-modal">
                    <div class="recover-icon">📱</div>
                    <p class="recover-description">
                        Ingresa tu DNI y te enviaremos un código de recuperación 
                        por WhatsApp al número registrado.
                    </p>
                    <div class="form-group">
                        <label class="form-label">DNI</label>
                        <input type="text" class="form-input" id="recover-dni" 
                               maxlength="8" placeholder="12345678" data-type="dni">
                    </div>
                </div>
            `,
            footer: `
                <button class="btn btn-secondary" onclick="Modal.close('recover-modal')">Cancelar</button>
                <button class="btn btn-primary" onclick="Login.sendRecoveryCode()">Enviar Código</button>
            `
        });
        
        Modal.open(modalId);
        
        // Setup validation
        setTimeout(() => {
            const input = document.getElementById('recover-dni');
            if (input) {
                input.addEventListener('input', (e) => {
                    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
                });
                input.focus();
            }
        }, 100);
    },
    
    async sendRecoveryCode() {
        const dni = document.getElementById('recover-dni')?.value.trim();
        
        if (!dni || dni.length !== 8) {
            Toast.error('DNI debe tener 8 dígitos');
            return;
        }
        
        try {
            const response = await fetch(`${this.API_URL}/api/v1/auth/recover-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                Modal.close('recover-modal');
                Toast.success('Código enviado a tu WhatsApp');
                this.showVerifyCodeModal(dni);
            } else {
                Toast.error(data.detail || 'No se encontró el DNI');
            }
            
        } catch (error) {
            Toast.error('Error de conexión');
        }
    },
    
    showVerifyCodeModal(dni) {
        const modalId = Modal.create({
            id: 'verify-code-modal',
            title: '✉️ Verificar Código',
            size: 'sm',
            content: `
                <div class="recover-modal">
                    <p class="recover-description">
                        Ingresa el código de 6 dígitos que enviamos a tu WhatsApp.
                    </p>
                    <div class="form-group">
                        <label class="form-label">Código</label>
                        <input type="text" class="form-input" id="verify-code" 
                               maxlength="6" placeholder="000000" style="text-align: center; font-size: 1.5rem; letter-spacing: 0.5rem;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Nueva Clave</label>
                        <input type="password" class="form-input" id="new-recovery-password" 
                               placeholder="Mínimo 6 caracteres">
                    </div>
                </div>
            `,
            footer: `
                <button class="btn btn-secondary" onclick="Modal.close('verify-code-modal')">Cancelar</button>
                <button class="btn btn-primary" onclick="Login.verifyCodeAndReset('${dni}')">Restablecer</button>
            `
        });
        
        Modal.open(modalId);
    },
    
    async verifyCodeAndReset(dni) {
        const code = document.getElementById('verify-code')?.value.trim();
        const newPassword = document.getElementById('new-recovery-password')?.value;
        
        if (!code || code.length !== 6) {
            Toast.error('Código debe tener 6 dígitos');
            return;
        }
        
        if (!newPassword || newPassword.length < 6) {
            Toast.error('La clave debe tener al menos 6 caracteres');
            return;
        }
        
        try {
            const response = await fetch(`${this.API_URL}/api/v1/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, code, new_password: newPassword })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                Modal.close('verify-code-modal');
                Toast.success('¡Clave restablecida! Ya puedes iniciar sesión.');
                
                // Pre-llenar DNI
                const dniInput = document.getElementById('login-dni');
                if (dniInput) dniInput.value = dni;
            } else {
                Toast.error(data.detail || 'Código inválido');
            }
            
        } catch (error) {
            Toast.error('Error de conexión');
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // CAMBIO DE CLAVE PRIMERA VEZ
    // ═══════════════════════════════════════════════════════════════════════
    
    showChangePasswordForm(loginData) {
        // Ocultar formularios normales
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.querySelector('.auth-tabs')?.classList.add('hidden');
        
        // Mostrar formulario de cambio
        const changeForm = document.getElementById('form-change-password');
        if (changeForm) {
            changeForm.classList.add('active');
        }
        
        this.showMessage('Por seguridad, debes cambiar tu clave antes de continuar.', 'warning');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // UTILIDADES
    // ═══════════════════════════════════════════════════════════════════════
    
    showMessage(text, type = 'info') {
        const messageEl = document.querySelector('.auth-message');
        if (!messageEl) return;
        
        messageEl.className = `auth-message ${type} show`;
        messageEl.innerHTML = `<span>${type === 'error' ? '❌' : type === 'success' ? '✅' : '⚠️'}</span> ${text}`;
    },
    
    hideMessage() {
        const messageEl = document.querySelector('.auth-message');
        if (messageEl) {
            messageEl.classList.remove('show');
        }
    },
    
    setLoading(formType, loading) {
        const form = document.getElementById(`form-${formType}`);
        if (!form) return;
        
        const button = form.querySelector('.auth-submit');
        const btnText = button?.querySelector('.btn-text');
        const btnSpinner = button?.querySelector('.spinner');
        
        if (button) button.disabled = loading;
        if (btnText) btnText.style.display = loading ? 'none' : 'inline';
        if (btnSpinner) btnSpinner.style.display = loading ? 'inline-block' : 'none';
    }
};


// Auto-inicializar
document.addEventListener('DOMContentLoaded', () => {
    Login.init();
});


// Exportar para uso global
window.Login = Login;