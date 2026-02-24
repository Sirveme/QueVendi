/* ═══════════════════════════════════════════════════════════════════════════
   ONBOARDING.JS - Wizard de configuración inicial
   QueVendi.pro | Metraes.com | Sirveme1.com
   ═══════════════════════════════════════════════════════════════════════════ */

const Onboarding = {
    currentStep: 1,
    totalSteps: 5,
    API_URL: window.location.origin,
    
    // Datos recolectados
    data: {
        business_type: '',
        commercial_name: '',
        department: '',
        province: '',
        district: '',
        address: '',
        selected_products: []
    },
    
    // Catálogos pre-cargados por nicho
    catalogs: {
        bodega: [
            { category: 'Bebidas', items: [
                { name: 'Coca Cola 500ml', icon: '🥤' },
                { name: 'Inca Kola 500ml', icon: '🥤' },
                { name: 'Agua San Luis 625ml', icon: '💧' },
                { name: 'Gaseosa Fanta 500ml', icon: '🍊' },
                { name: 'Sprite 500ml', icon: '🥤' },
                { name: 'Frugos 235ml', icon: '🧃' },
                { name: 'Cerveza Pilsen 620ml', icon: '🍺' },
                { name: 'Cerveza Cristal 620ml', icon: '🍺' },
            ]},
            { category: 'Snacks', items: [
                { name: 'Papas Lays Clásicas', icon: '🥔' },
                { name: 'Doritos Nacho', icon: '🌮' },
                { name: 'Cheetos', icon: '🧀' },
                { name: 'Galletas Oreo', icon: '🍪' },
                { name: 'Galletas Soda', icon: '🍘' },
                { name: 'Chocolate Sublime', icon: '🍫' },
                { name: 'Chicle Trident', icon: '🍬' },
                { name: 'Caramelos Halls', icon: '🍬' },
            ]},
            { category: 'Abarrotes', items: [
                { name: 'Arroz Costeño 1kg', icon: '🍚' },
                { name: 'Azúcar Rubia 1kg', icon: '🧂' },
                { name: 'Aceite Primor 1L', icon: '🫒' },
                { name: 'Fideos Don Vittorio 500g', icon: '🍝' },
                { name: 'Atún Florida 170g', icon: '🐟' },
                { name: 'Leche Gloria 400g', icon: '🥛' },
                { name: 'Café Nescafé 50g', icon: '☕' },
                { name: 'Sal Marina 1kg', icon: '🧂' },
            ]},
            { category: 'Limpieza', items: [
                { name: 'Detergente Ariel 500g', icon: '🧼' },
                { name: 'Jabón Bolívar', icon: '🧼' },
                { name: 'Lejía Clorox 1L', icon: '🧴' },
                { name: 'Papel Higiénico Elite x4', icon: '🧻' },
                { name: 'Lavavajilla Ayudín', icon: '🍽️' },
            ]},
            { category: 'Lácteos', items: [
                { name: 'Yogurt Gloria 1L', icon: '🥛' },
                { name: 'Queso Fresco 250g', icon: '🧀' },
                { name: 'Mantequilla Laive', icon: '🧈' },
                { name: 'Huevos x6', icon: '🥚' },
            ]},
        ],
        minimarket: [], // Similar a bodega pero más extenso
        restaurante: [
            { category: 'Entradas', items: [
                { name: 'Papa a la Huancaína', icon: '🥔' },
                { name: 'Ceviche', icon: '🐟' },
                { name: 'Causa Limeña', icon: '🥔' },
                { name: 'Ensalada Mixta', icon: '🥗' },
            ]},
            { category: 'Platos Principales', items: [
                { name: 'Lomo Saltado', icon: '🥩' },
                { name: 'Arroz con Pollo', icon: '🍗' },
                { name: 'Ají de Gallina', icon: '🍛' },
                { name: 'Seco de Res', icon: '🥘' },
                { name: 'Pollo a la Brasa', icon: '🍗' },
                { name: 'Tallarines Rojos', icon: '🍝' },
                { name: 'Arroz Chaufa', icon: '🍚' },
                { name: 'Milanesa de Pollo', icon: '🍖' },
            ]},
            { category: 'Bebidas', items: [
                { name: 'Chicha Morada', icon: '🍇' },
                { name: 'Limonada', icon: '🍋' },
                { name: 'Gaseosa Personal', icon: '🥤' },
                { name: 'Agua Mineral', icon: '💧' },
                { name: 'Cerveza', icon: '🍺' },
            ]},
            { category: 'Postres', items: [
                { name: 'Arroz con Leche', icon: '🍚' },
                { name: 'Mazamorra Morada', icon: '🍇' },
                { name: 'Suspiro Limeño', icon: '🍮' },
                { name: 'Torta de Chocolate', icon: '🍰' },
            ]},
        ],
        cafeteria: [
            { category: 'Bebidas Calientes', items: [
                { name: 'Café Americano', icon: '☕' },
                { name: 'Cappuccino', icon: '☕' },
                { name: 'Latte', icon: '☕' },
                { name: 'Chocolate Caliente', icon: '🍫' },
                { name: 'Té Verde', icon: '🍵' },
            ]},
            { category: 'Bebidas Frías', items: [
                { name: 'Frappuccino', icon: '🧋' },
                { name: 'Smoothie de Frutas', icon: '🥤' },
                { name: 'Limonada Frozen', icon: '🍋' },
            ]},
            { category: 'Pastelería', items: [
                { name: 'Croissant', icon: '🥐' },
                { name: 'Muffin de Arándanos', icon: '🧁' },
                { name: 'Cheesecake', icon: '🍰' },
                { name: 'Brownie', icon: '🍫' },
                { name: 'Pie de Manzana', icon: '🥧' },
            ]},
            { category: 'Sándwiches', items: [
                { name: 'Sándwich de Jamón y Queso', icon: '🥪' },
                { name: 'Wrap de Pollo', icon: '🌯' },
                { name: 'Tostada con Palta', icon: '🥑' },
            ]},
        ],
        farmacia: [
            { category: 'Medicamentos', items: [
                { name: 'Paracetamol 500mg', icon: '💊' },
                { name: 'Ibuprofeno 400mg', icon: '💊' },
                { name: 'Antigripal', icon: '🤧' },
                { name: 'Alcohol 70°', icon: '🧴' },
            ]},
            { category: 'Cuidado Personal', items: [
                { name: 'Jabón Antibacterial', icon: '🧼' },
                { name: 'Shampoo', icon: '🧴' },
                { name: 'Crema Dental', icon: '🦷' },
                { name: 'Protector Solar', icon: '☀️' },
            ]},
        ],
        ferreteria: [
            { category: 'Herramientas', items: [
                { name: 'Martillo', icon: '🔨' },
                { name: 'Destornillador', icon: '🪛' },
                { name: 'Alicate', icon: '🔧' },
                { name: 'Llave Inglesa', icon: '🔧' },
                { name: 'Cinta Métrica', icon: '📏' },
            ]},
            { category: 'Electricidad', items: [
                { name: 'Foco LED', icon: '💡' },
                { name: 'Cable Eléctrico', icon: '🔌' },
                { name: 'Enchufe', icon: '🔌' },
                { name: 'Cinta Aislante', icon: '🎗️' },
            ]},
            { category: 'Pinturas', items: [
                { name: 'Pintura Látex 1gal', icon: '🎨' },
                { name: 'Brocha 3"', icon: '🖌️' },
                { name: 'Rodillo', icon: '🖌️' },
                { name: 'Thinner 1L', icon: '🧪' },
            ]},
        ],
    },
    
    // Ubigeo data (simplificado - en producción cargar de API)
    ubigeo: {
        departments: ['Lima', 'Arequipa', 'Cusco', 'La Libertad', 'Piura', 'Loreto', 'Lambayeque', 'Junín', 'Cajamarca', 'Ancash'],
        provinces: {
            'Lima': ['Lima', 'Callao', 'Huaral', 'Cañete', 'Huarochirí'],
            'Arequipa': ['Arequipa', 'Caylloma', 'Islay'],
            'Loreto': ['Maynas', 'Alto Amazonas', 'Loreto'],
            // ... más provincias
        },
        districts: {
            'Lima': ['Miraflores', 'San Isidro', 'Surco', 'La Molina', 'San Borja', 'Jesús María', 'Lince', 'San Miguel', 'Pueblo Libre', 'Magdalena', 'Barranco', 'Chorrillos', 'Villa El Salvador', 'San Juan de Miraflores', 'Villa María del Triunfo', 'San Juan de Lurigancho', 'Ate', 'Santa Anita', 'El Agustino', 'La Victoria', 'Breña', 'Rímac', 'Cercado de Lima', 'Los Olivos', 'San Martín de Porres', 'Independencia', 'Comas', 'Carabayllo', 'Puente Piedra', 'Ancón'],
            'Callao': ['Callao', 'Bellavista', 'La Perla', 'La Punta', 'Carmen de la Legua', 'Ventanilla'],
            'Maynas': ['Iquitos', 'Punchana', 'Belén', 'San Juan Bautista'],
            // ... más distritos
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // INICIALIZACIÓN
    // ═══════════════════════════════════════════════════════════════════════
    
    init() {
        this.loadSavedData();
        this.setupEventListeners();
        this.updateProgress();
        this.showStep(1);
        
        console.log('🚀 Onboarding inicializado');
    },
    
    loadSavedData() {
        // Cargar datos del registro si existen
        const store = JSON.parse(localStorage.getItem('store') || '{}');
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        
        if (store.business_type) {
            this.data.business_type = store.business_type;
        }
        if (store.commercial_name) {
            this.data.commercial_name = store.commercial_name;
        }
    },
    
    setupEventListeners() {
        // Botones de navegación
        document.querySelectorAll('[data-action="next"]').forEach(btn => {
            btn.addEventListener('click', () => this.nextStep());
        });
        
        document.querySelectorAll('[data-action="prev"]').forEach(btn => {
            btn.addEventListener('click', () => this.prevStep());
        });
        
        document.querySelectorAll('[data-action="finish"]').forEach(btn => {
            btn.addEventListener('click', () => this.finish());
        });
        
        // Tipo de negocio
        document.querySelectorAll('.business-type-card').forEach(card => {
            card.addEventListener('click', () => this.selectBusinessType(card));
        });
        
        // Ubigeo cascading
        const deptSelect = document.getElementById('department');
        const provSelect = document.getElementById('province');
        
        if (deptSelect) {
            deptSelect.addEventListener('change', () => this.onDepartmentChange());
        }
        if (provSelect) {
            provSelect.addEventListener('change', () => this.onProvinceChange());
        }
        
        // Categorías de productos
        document.querySelectorAll('.category-chip').forEach(chip => {
            chip.addEventListener('click', () => this.filterByCategory(chip));
        });
        
        // Búsqueda de productos
        const searchInput = document.getElementById('products-search');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.filterProducts(e.target.value);
            }, 300));
        }
        
        // Seleccionar todos / ninguno
        document.getElementById('select-all')?.addEventListener('click', () => this.selectAllProducts());
        document.getElementById('select-none')?.addEventListener('click', () => this.selectNoneProducts());
        
        // Copiar URL del catálogo
        document.getElementById('copy-catalog-url')?.addEventListener('click', () => this.copyCatalogUrl());
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // NAVEGACIÓN ENTRE PASOS
    // ═══════════════════════════════════════════════════════════════════════
    
    showStep(step) {
        // Ocultar todos los pasos
        document.querySelectorAll('.onboarding-step').forEach(s => {
            s.classList.remove('active');
        });
        
        // Mostrar paso actual
        const currentStepEl = document.getElementById(`step-${step}`);
        if (currentStepEl) {
            currentStepEl.classList.add('active');
        }
        
        this.currentStep = step;
        this.updateProgress();
        
        // Acciones específicas por paso
        if (step === 4) {
            this.loadProductsCatalog();
        }
        if (step === 5) {
            this.showSummary();
        }
    },
    
    nextStep() {
        if (!this.validateCurrentStep()) return;
        
        this.saveCurrentStepData();
        
        if (this.currentStep < this.totalSteps) {
            this.showStep(this.currentStep + 1);
        }
    },
    
    prevStep() {
        if (this.currentStep > 1) {
            this.showStep(this.currentStep - 1);
        }
    },
    
    updateProgress() {
        // Actualizar dots
        document.querySelectorAll('.progress-dot').forEach((dot, index) => {
            const stepNum = index + 1;
            dot.classList.remove('active', 'completed');
            
            if (stepNum === this.currentStep) {
                dot.classList.add('active');
            } else if (stepNum < this.currentStep) {
                dot.classList.add('completed');
                dot.textContent = '✓';
            } else {
                dot.textContent = stepNum;
            }
        });
        
        // Actualizar líneas
        document.querySelectorAll('.progress-line').forEach((line, index) => {
            line.classList.toggle('completed', index < this.currentStep - 1);
        });
        
        // Actualizar título
        const titles = [
            'Tipo de Negocio',
            'Datos del Negocio',
            'Ubicación',
            'Productos Iniciales',
            '¡Listo!'
        ];
        
        const titleEl = document.querySelector('.progress-title');
        const subtitleEl = document.querySelector('.progress-subtitle');
        
        if (titleEl) titleEl.textContent = titles[this.currentStep - 1];
        if (subtitleEl) subtitleEl.textContent = `Paso ${this.currentStep} de ${this.totalSteps}`;
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // VALIDACIONES
    // ═══════════════════════════════════════════════════════════════════════
    
    validateCurrentStep() {
        switch (this.currentStep) {
            case 1:
                if (!this.data.business_type) {
                    Toast.warning('Selecciona el tipo de negocio');
                    return false;
                }
                break;
                
            case 2:
                const name = document.getElementById('commercial-name')?.value.trim();
                if (!name || name.length < 3) {
                    Toast.warning('Ingresa el nombre de tu negocio');
                    return false;
                }
                break;
                
            case 3:
                const dept = document.getElementById('department')?.value;
                if (!dept) {
                    Toast.warning('Selecciona tu departamento');
                    return false;
                }
                break;
                
            case 4:
                // Productos son opcionales
                break;
        }
        
        return true;
    },
    
    saveCurrentStepData() {
        switch (this.currentStep) {
            case 2:
                this.data.commercial_name = document.getElementById('commercial-name')?.value.trim();
                this.data.phone = document.getElementById('phone')?.value.trim();
                break;
                
            case 3:
                this.data.department = document.getElementById('department')?.value;
                this.data.province = document.getElementById('province')?.value;
                this.data.district = document.getElementById('district')?.value;
                this.data.address = document.getElementById('address')?.value.trim();
                break;
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 1: TIPO DE NEGOCIO
    // ═══════════════════════════════════════════════════════════════════════
    
    selectBusinessType(card) {
        // Quitar selección anterior
        document.querySelectorAll('.business-type-card').forEach(c => {
            c.classList.remove('selected');
        });
        
        // Seleccionar nuevo
        card.classList.add('selected');
        this.data.business_type = card.dataset.type;
        
        // Sonido
        if (typeof Sounds !== 'undefined') Sounds.pop();
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 3: UBIGEO
    // ═══════════════════════════════════════════════════════════════════════
    
    onDepartmentChange() {
        const dept = document.getElementById('department').value;
        const provSelect = document.getElementById('province');
        const distSelect = document.getElementById('district');
        
        // Limpiar
        provSelect.innerHTML = '<option value="">Seleccionar...</option>';
        distSelect.innerHTML = '<option value="">Seleccionar...</option>';
        
        if (dept && this.ubigeo.provinces[dept]) {
            this.ubigeo.provinces[dept].forEach(prov => {
                provSelect.innerHTML += `<option value="${prov}">${prov}</option>`;
            });
        }
    },
    
    onProvinceChange() {
        const prov = document.getElementById('province').value;
        const distSelect = document.getElementById('district');
        
        distSelect.innerHTML = '<option value="">Seleccionar...</option>';
        
        if (prov && this.ubigeo.districts[prov]) {
            this.ubigeo.districts[prov].forEach(dist => {
                distSelect.innerHTML += `<option value="${dist}">${dist}</option>`;
            });
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 4: PRODUCTOS
    // ═══════════════════════════════════════════════════════════════════════
    
    loadProductsCatalog() {
        const catalog = this.catalogs[this.data.business_type] || this.catalogs.bodega;
        const grid = document.getElementById('products-grid');
        const categoriesContainer = document.getElementById('products-categories');
        
        if (!grid) return;
        
        // Cargar categorías
        if (categoriesContainer) {
            categoriesContainer.innerHTML = '<span class="category-chip active" data-category="all">Todos</span>';
            catalog.forEach(cat => {
                categoriesContainer.innerHTML += `
                    <span class="category-chip" data-category="${cat.category}">${cat.category}</span>
                `;
            });
            
            // Re-bind events
            categoriesContainer.querySelectorAll('.category-chip').forEach(chip => {
                chip.addEventListener('click', () => this.filterByCategory(chip));
            });
        }
        
        // Cargar productos
        grid.innerHTML = '';
        catalog.forEach(cat => {
            cat.items.forEach(item => {
                const isSelected = this.data.selected_products.includes(item.name);
                grid.innerHTML += `
                    <div class="product-card ${isSelected ? 'selected' : ''}" 
                         data-name="${item.name}" 
                         data-category="${cat.category}">
                        <div class="product-icon">${item.icon}</div>
                        <div class="product-name">${item.name}</div>
                    </div>
                `;
            });
        });
        
        // Bind click events
        grid.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', () => this.toggleProduct(card));
        });
        
        this.updateProductsCount();
    },
    
    toggleProduct(card) {
        const name = card.dataset.name;
        const index = this.data.selected_products.indexOf(name);
        
        if (index > -1) {
            this.data.selected_products.splice(index, 1);
            card.classList.remove('selected');
        } else {
            this.data.selected_products.push(name);
            card.classList.add('selected');
        }
        
        this.updateProductsCount();
        if (typeof Sounds !== 'undefined') Sounds.click();
    },
    
    filterByCategory(chip) {
        const category = chip.dataset.category;
        
        // Actualizar chips
        document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        
        // Filtrar productos
        document.querySelectorAll('.product-card').forEach(card => {
            if (category === 'all' || card.dataset.category === category) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    },
    
    filterProducts(query) {
        const searchTerm = query.toLowerCase();
        
        document.querySelectorAll('.product-card').forEach(card => {
            const name = card.dataset.name.toLowerCase();
            card.style.display = name.includes(searchTerm) ? 'block' : 'none';
        });
    },
    
    selectAllProducts() {
        document.querySelectorAll('.product-card:not([style*="display: none"])').forEach(card => {
            if (!card.classList.contains('selected')) {
                card.classList.add('selected');
                this.data.selected_products.push(card.dataset.name);
            }
        });
        this.updateProductsCount();
    },
    
    selectNoneProducts() {
        document.querySelectorAll('.product-card.selected').forEach(card => {
            card.classList.remove('selected');
        });
        this.data.selected_products = [];
        this.updateProductsCount();
    },
    
    updateProductsCount() {
        const countEl = document.getElementById('products-count');
        if (countEl) {
            countEl.innerHTML = `<strong>${this.data.selected_products.length}</strong> productos seleccionados`;
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 5: RESUMEN Y FINALIZAR
    // ═══════════════════════════════════════════════════════════════════════
    
    showSummary() {
        // Mostrar estadísticas
        document.getElementById('stat-products').textContent = this.data.selected_products.length;
        
        // Generar URL del catálogo
        const slug = this.data.commercial_name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        
        const catalogUrl = `https://quevendi.pro/c/${slug}`;
        document.getElementById('catalog-url-input').value = catalogUrl;
    },
    
    copyCatalogUrl() {
        const url = document.getElementById('catalog-url-input').value;
        Utils.copyToClipboard(url);
    },
    
    async finish() {
        this.saveCurrentStepData();
        
        // Mostrar loader
        if (typeof Loader !== 'undefined') {
            Loader.show('Guardando tu negocio...');
        }
        
        try {
            const token = localStorage.getItem('access_token');
            
            // Guardar datos del negocio
            const response = await fetch(`${this.API_URL}/api/v1/stores/complete-onboarding`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    commercial_name: this.data.commercial_name,
                    business_type: this.data.business_type,
                    department: this.data.department,
                    province: this.data.province,
                    district: this.data.district,
                    address: this.data.address,
                    selected_products: this.data.selected_products
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                // Actualizar store en localStorage
                const store = JSON.parse(localStorage.getItem('store') || '{}');
                Object.assign(store, result.store);
                store.onboarding_completed = true;
                localStorage.setItem('store', JSON.stringify(store));
                
                Toast.success('¡Tu negocio está listo!');
                
                setTimeout(() => {
                    window.location.href = '/home';
                }, 1500);
                
            } else {
                Toast.error(result.detail || 'Error al guardar');
            }
            
        } catch (error) {
            console.error('Error:', error);
            Toast.error('Error de conexión');
        } finally {
            if (typeof Loader !== 'undefined') {
                Loader.hide();
            }
        }
    }
};


// Auto-inicializar
document.addEventListener('DOMContentLoaded', () => {
    Onboarding.init();
});


// Exportar
window.Onboarding = Onboarding;