/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS.JS - Panel de Configuración
   QueVendi.pro | Metraes.com | Sirveme1.com
   ═══════════════════════════════════════════════════════════════════════════ */

const Settings = {
    API_URL: window.location.origin,
    currentSection: 'negocio',
    
    // Datos cargados
    data: {
        store: {},
        users: [],
        subscription: {}
    },
    
    // Regímenes tributarios
    regimenes: [
        {
            code: 'NRUS',
            name: 'Nuevo RUS',
            icon: '🏪',
            description: 'Para pequeños negocios',
            details: [
                'Ingresos hasta S/ 96,000/año',
                'Compras hasta S/ 96,000/año',
                'No emite facturas',
                'Cuota fija mensual (S/ 20 - S/ 50)'
            ]
        },
        {
            code: 'RER',
            name: 'Régimen Especial',
            icon: '📊',
            description: 'Para empresas pequeñas',
            details: [
                'Ingresos hasta S/ 525,000/año',
                'Emite facturas y boletas',
                'IGV: 18%',
                'Renta: 1.5% mensual'
            ]
        },
        {
            code: 'MYPE',
            name: 'Mype Tributario',
            icon: '🏢',
            description: 'Para micro y pequeñas empresas',
            details: [
                'Ingresos hasta 1,700 UIT/año',
                'Emite todos los comprobantes',
                'IGV: 18%',
                'Renta: 10% (hasta 15 UIT) / 29.5%'
            ]
        },
        {
            code: 'GENERAL',
            name: 'Régimen General',
            icon: '🏛️',
            description: 'Sin límite de ingresos',
            details: [
                'Sin límite de ingresos',
                'Contabilidad completa',
                'IGV: 18%',
                'Renta: 29.5% anual'
            ]
        }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // INICIALIZACIÓN
    // ═══════════════════════════════════════════════════════════════════════
    
    init() {
        this.setupNavigation();
        this.loadData();
        this.setupEventListeners();
        
        // Mostrar sección inicial
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            this.showSection(hash);
        }
        
        console.log('⚙️ Settings inicializado');
    },
    
    setupNavigation() {
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.showSection(section);
            });
        });
    },
    
    showSection(section) {
        // Actualizar navegación
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.section === section);
        });
        
        // Mostrar sección
        document.querySelectorAll('.settings-section').forEach(s => {
            s.classList.toggle('active', s.id === `section-${section}`);
        });
        
        this.currentSection = section;
        window.location.hash = section;
        
        // Cargar datos específicos de la sección
        this.loadSectionData(section);
    },
    
    async loadData() {
        try {
            const token = localStorage.getItem('access_token');
            
            // Cargar datos de la tienda
            const storeRes = await fetch(`${this.API_URL}/api/v1/stores/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (storeRes.ok) {
                this.data.store = await storeRes.json();
                this.populateStoreData();
            }
            
            // Cargar usuarios
            const usersRes = await fetch(`${this.API_URL}/api/v1/users/list`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (usersRes.ok) {
                this.data.users = await usersRes.json();
                this.renderUsersTable();
            }
            
        } catch (error) {
            console.error('Error cargando datos:', error);
        }
    },
    
    loadSectionData(section) {
        switch (section) {
            case 'usuarios':
                this.renderUsersTable();
                break;
            case 'suscripcion':
                this.loadSubscriptionData();
                break;
        }
    },
    
    setupEventListeners() {
        // Logo upload
        const logoInput = document.getElementById('logo-input');
        if (logoInput) {
            logoInput.addEventListener('change', (e) => this.handleLogoUpload(e));
        }
        
        // Régimen cards
        document.querySelectorAll('.regimen-card').forEach(card => {
            card.addEventListener('click', () => this.selectRegimen(card));
        });
        
        // Forms
        document.getElementById('form-negocio')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveNegocio();
        });
        
        document.getElementById('form-tributario')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTributario();
        });
        
        document.getElementById('form-contador')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveContador();
        });
        
        document.getElementById('form-facturacion')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveFacturacion();
        });
        
        // Toggle switches
        document.querySelectorAll('.toggle-switch input').forEach(toggle => {
            toggle.addEventListener('change', (e) => this.handleToggle(e));
        });
        
        // Agregar usuario
        document.getElementById('btn-add-user')?.addEventListener('click', () => {
            this.showAddUserModal();
        });
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // DATOS DEL NEGOCIO
    // ═══════════════════════════════════════════════════════════════════════
    
    populateStoreData() {
        const store = this.data.store;
        
        // Datos básicos
        document.getElementById('commercial_name').value = store.commercial_name || '';
        document.getElementById('ruc').value = store.ruc || '';
        document.getElementById('business_type').value = store.business_type || '';
        document.getElementById('phone').value = store.phone || '';
        document.getElementById('whatsapp').value = store.whatsapp || '';
        document.getElementById('email').value = store.email || '';
        document.getElementById('address').value = store.address || '';
        document.getElementById('department').value = store.department || '';
        document.getElementById('province').value = store.province || '';
        document.getElementById('district').value = store.district || '';
        
        // Logo
        if (store.logo_url) {
            document.getElementById('logo-preview').innerHTML = `<img src="${store.logo_url}" alt="Logo">`;
        }
        
        // Perfil tributario
        document.getElementById('regimen').value = store.regimen || '';
        document.getElementById('ciiu_principal').value = store.ciiu_principal || '';
        document.getElementById('ciiu_secundario').value = store.ciiu_secundario || '';
        
        // Seleccionar régimen card
        if (store.regimen) {
            document.querySelector(`.regimen-card[data-regimen="${store.regimen}"]`)?.classList.add('selected');
        }
        
        // Contador
        document.getElementById('contador_nombre').value = store.contador_nombre || '';
        document.getElementById('contador_colegiatura').value = store.contador_colegiatura || '';
        document.getElementById('contador_telefono').value = store.contador_telefono || '';
        document.getElementById('contador_email').value = store.contador_email || '';
        
        // Facturación
        document.getElementById('sunat_usuario').value = store.sunat_usuario || '';
        document.getElementById('sunat_clave').value = store.sunat_clave || '';
        document.getElementById('serie_factura').value = store.serie_factura || 'F001';
        document.getElementById('serie_boleta').value = store.serie_boleta || 'B001';
    },
    
    async saveNegocio() {
        const data = {
            commercial_name: document.getElementById('commercial_name').value,
            business_type: document.getElementById('business_type').value,
            phone: document.getElementById('phone').value,
            whatsapp: document.getElementById('whatsapp').value,
            email: document.getElementById('email').value,
            address: document.getElementById('address').value,
            department: document.getElementById('department').value,
            province: document.getElementById('province').value,
            district: document.getElementById('district').value
        };
        
        await this.saveData('/api/v1/stores/me', data, 'Datos del negocio guardados');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // PERFIL TRIBUTARIO
    // ═══════════════════════════════════════════════════════════════════════
    
    selectRegimen(card) {
        document.querySelectorAll('.regimen-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        document.getElementById('regimen').value = card.dataset.regimen;
        
        // Actualizar obligaciones según régimen
        this.updateObligations(card.dataset.regimen);
    },
    
    updateObligations(regimen) {
        const container = document.getElementById('obligations-list');
        if (!container) return;
        
        const obligations = {
            'NRUS': [
                { name: 'Pago de cuota mensual', date: 'Hasta el día 20', icon: '💰' },
                { name: 'Actualización de datos en SUNAT', date: 'Cuando corresponda', icon: '📝' }
            ],
            'RER': [
                { name: 'Declaración mensual (IGV-Renta)', date: 'Hasta el día 20', icon: '📊' },
                { name: 'Libros electrónicos', date: 'Ventas y Compras', icon: '📚' },
                { name: 'Pago de IGV', date: 'Hasta el día 20', icon: '💰' },
                { name: 'Pago de Renta (1.5%)', date: 'Hasta el día 20', icon: '💰' }
            ],
            'MYPE': [
                { name: 'Declaración mensual PDT 621', date: 'Hasta el día 20', icon: '📊' },
                { name: 'Libros electrónicos', date: 'Según cronograma', icon: '📚' },
                { name: 'Declaración anual', date: 'Marzo del siguiente año', icon: '📋', warning: true },
                { name: 'Pago a cuenta IR', date: 'Hasta el día 20', icon: '💰' }
            ],
            'GENERAL': [
                { name: 'Declaración mensual PDT 621', date: 'Hasta el día 20', icon: '📊' },
                { name: 'Libros electrónicos completos', date: 'Según cronograma', icon: '📚' },
                { name: 'Declaración anual', date: 'Marzo del siguiente año', icon: '📋', warning: true },
                { name: 'Estados financieros', date: 'Anual', icon: '📈' },
                { name: 'ITF', date: 'En cada operación bancaria', icon: '🏦' }
            ]
        };
        
        const items = obligations[regimen] || [];
        
        container.innerHTML = items.map(item => `
            <div class="obligation-item ${item.warning ? 'warning' : ''}">
                <span class="obligation-icon">${item.icon}</span>
                <div class="obligation-info">
                    <div class="obligation-name">${item.name}</div>
                    <div class="obligation-date">${item.date}</div>
                </div>
            </div>
        `).join('');
    },
    
    async saveTributario() {
        const data = {
            regimen: document.getElementById('regimen').value,
            ciiu_principal: document.getElementById('ciiu_principal').value,
            ciiu_secundario: document.getElementById('ciiu_secundario').value
        };
        
        await this.saveData('/api/v1/stores/me/tributario', data, 'Perfil tributario guardado');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONTADOR
    // ═══════════════════════════════════════════════════════════════════════
    
    async saveContador() {
        const data = {
            contador_nombre: document.getElementById('contador_nombre').value,
            contador_colegiatura: document.getElementById('contador_colegiatura').value,
            contador_telefono: document.getElementById('contador_telefono').value,
            contador_email: document.getElementById('contador_email').value
        };
        
        await this.saveData('/api/v1/stores/me/contador', data, 'Datos del contador guardados');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // FACTURACIÓN ELECTRÓNICA
    // ═══════════════════════════════════════════════════════════════════════
    
    async saveFacturacion() {
        const data = {
            sunat_usuario: document.getElementById('sunat_usuario').value,
            sunat_clave: document.getElementById('sunat_clave').value,
            serie_factura: document.getElementById('serie_factura').value,
            serie_boleta: document.getElementById('serie_boleta').value
        };
        
        await this.saveData('/api/v1/stores/me/facturacion', data, 'Configuración de facturación guardada');
    },
    
    async uploadCertificate() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pfx,.p12';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const formData = new FormData();
            formData.append('certificate', file);
            
            try {
                const token = localStorage.getItem('access_token');
                const response = await fetch(`${this.API_URL}/api/v1/stores/me/certificate`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                
                if (response.ok) {
                    Toast.success('Certificado cargado correctamente');
                    document.getElementById('certificate-status').textContent = '✅ Certificado activo';
                } else {
                    Toast.error('Error al cargar certificado');
                }
            } catch (error) {
                Toast.error('Error de conexión');
            }
        };
        
        input.click();
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // USUARIOS
    // ═══════════════════════════════════════════════════════════════════════
    
    renderUsersTable() {
        const tbody = document.getElementById('users-tbody');
        if (!tbody) return;
        
        const roleLabels = {
            'owner': { text: 'Propietario', class: 'owner', icon: '👑' },
            'admin': { text: 'Administrador', class: 'admin', icon: '⚙️' },
            'seller': { text: 'Vendedor', class: 'seller', icon: '🛒' },
            'cashier': { text: 'Cajero', class: 'cashier', icon: '💰' }
        };
        
        tbody.innerHTML = this.data.users.map(user => {
            const role = roleLabels[user.role] || roleLabels.seller;
            const initials = user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            
            return `
                <tr>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar">${initials}</div>
                            <div>
                                <div class="user-name">${user.full_name}</div>
                                <div class="user-dni">DNI: ${user.dni}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="user-role ${role.class}">
                            ${role.icon} ${role.text}
                        </span>
                    </td>
                    <td>
                        <span class="user-status ${user.is_active ? 'active' : 'inactive'}"></span>
                        ${user.is_active ? 'Activo' : 'Inactivo'}
                    </td>
                    <td>
                        ${user.role !== 'owner' ? `
                            <button class="btn btn-ghost btn-sm" onclick="Settings.editUser(${user.id})">✏️</button>
                            <button class="btn btn-ghost btn-sm" onclick="Settings.toggleUserStatus(${user.id}, ${!user.is_active})">
                                ${user.is_active ? '🚫' : '✅'}
                            </button>
                        ` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    showAddUserModal() {
        Modal.show({
            title: 'Agregar Usuario',
            content: `
                <form id="form-add-user">
                    <div class="form-group">
                        <label class="form-label">Nombre completo</label>
                        <input type="text" class="form-input" id="new-user-name" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">DNI</label>
                        <input type="text" class="form-input" id="new-user-dni" maxlength="8" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Rol</label>
                        <select class="form-input form-select" id="new-user-role" required>
                            <option value="seller">Vendedor</option>
                            <option value="cashier">Cajero</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">PIN inicial (4-6 dígitos)</label>
                        <input type="password" class="form-input" id="new-user-pin" maxlength="6" placeholder="Dejar vacío = DNI">
                    </div>
                </form>
            `,
            buttons: [
                { text: 'Cancelar', variant: 'secondary', action: () => Modal.hide() },
                { text: 'Agregar', variant: 'primary', action: () => this.addUser() }
            ]
        });
    },
    
    async addUser() {
        const data = {
            full_name: document.getElementById('new-user-name').value,
            dni: document.getElementById('new-user-dni').value,
            role: document.getElementById('new-user-role').value,
            pin: document.getElementById('new-user-pin').value || null
        };
        
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${this.API_URL}/api/v1/users/add`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                Toast.success('Usuario agregado');
                Modal.hide();
                this.loadData();
            } else {
                const error = await response.json();
                Toast.error(error.detail || 'Error al agregar usuario');
            }
        } catch (error) {
            Toast.error('Error de conexión');
        }
    },
    
    async toggleUserStatus(userId, newStatus) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${this.API_URL}/api/v1/users/${userId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ is_active: newStatus })
            });
            
            if (response.ok) {
                Toast.success(newStatus ? 'Usuario activado' : 'Usuario desactivado');
                this.loadData();
            }
        } catch (error) {
            Toast.error('Error al cambiar estado');
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // SUSCRIPCIÓN
    // ═══════════════════════════════════════════════════════════════════════
    
    async loadSubscriptionData() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${this.API_URL}/api/v1/stores/me/subscription`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
                this.data.subscription = await response.json();
                this.renderSubscription();
            }
        } catch (error) {
            console.error('Error cargando suscripción:', error);
        }
    },
    
    renderSubscription() {
        const sub = this.data.subscription;
        
        document.getElementById('plan-name').textContent = sub.plan_name || 'Plan Gratuito';
        document.getElementById('plan-days').textContent = sub.days_remaining || 30;
        document.getElementById('plan-status').textContent = sub.is_active ? 'Activo' : 'Vencido';
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // PREFERENCIAS
    // ═══════════════════════════════════════════════════════════════════════
    
    handleToggle(event) {
        const toggle = event.target;
        const preference = toggle.dataset.preference;
        const value = toggle.checked;
        
        // Guardar preferencia localmente
        const prefs = JSON.parse(localStorage.getItem('preferences') || '{}');
        prefs[preference] = value;
        localStorage.setItem('preferences', JSON.stringify(prefs));
        
        // Aplicar cambios inmediatos
        switch (preference) {
            case 'sounds':
                window.soundsEnabled = value;
                break;
            case 'dark_mode':
                document.documentElement.dataset.theme = value ? 'dark' : 'light';
                break;
            case 'compact_mode':
                document.documentElement.dataset.fontSize = value ? 'small' : 'default';
                break;
        }
        
        Toast.success('Preferencia guardada');
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // LOGO
    // ═══════════════════════════════════════════════════════════════════════
    
    async handleLogoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Preview
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('logo-preview').innerHTML = `<img src="${e.target.result}" alt="Logo">`;
        };
        reader.readAsDataURL(file);
        
        // Upload
        const formData = new FormData();
        formData.append('logo', file);
        
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${this.API_URL}/api/v1/stores/me/logo`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            if (response.ok) {
                Toast.success('Logo actualizado');
            } else {
                Toast.error('Error al subir logo');
            }
        } catch (error) {
            Toast.error('Error de conexión');
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // UTILIDADES
    // ═══════════════════════════════════════════════════════════════════════
    
    async saveData(endpoint, data, successMessage) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${this.API_URL}${endpoint}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                Toast.success(successMessage);
                return true;
            } else {
                const error = await response.json();
                Toast.error(error.detail || 'Error al guardar');
                return false;
            }
        } catch (error) {
            Toast.error('Error de conexión');
            return false;
        }
    }
};


// Auto-inicializar
document.addEventListener('DOMContentLoaded', () => {
    Settings.init();
});


// Exportar
window.Settings = Settings;