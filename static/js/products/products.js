/**
 * ProductsApp - Módulo de Gestión de Productos
 * QueVendi PRO / Metraes / Sirveme1
 * Consume endpoints /api/v1/products/v2/*
 */
const ProductsApp = (() => {

    // ══════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════
    const state = {
        products: [],
        categories: [],
        pagination: { page: 1, per_page: 50, total: 0, pages: 0 },
        filters: {
            search: '',
            category: '',
            stock_status: '',
            sort_by: 'name',
            sort_dir: 'asc'
        },
        availableCatalogs: [],
        selectedCatalogs: [],
        aliases: [],
        tags: [],
        editingId: null,
        imagenSeleccionada: null,
    };

    const API = '/api/v1/products/v2';
    let searchTimer = null;

    // ══════════════════════════════════════════════
    // SVG ICONS (clean, professional, stroke-based)
    // ══════════════════════════════════════════════
    const SVG = {
        price:    '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
        stock:    '<svg viewBox="0 0 24 24"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>',
        edit:     '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        eye:      '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        eyeOff:   '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    };

    // ══════════════════════════════════════════════
    // INIT
    // ══════════════════════════════════════════════
    async function init() {
        bindEvents();
        await Promise.all([
            loadStats(),
            loadCategories(),
            loadProducts()
        ]);
    }

    function bindEvents() {
        // Search
        const searchInput = $('#searchInput');
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const val = searchInput.value.trim();
            $('#searchClear').classList.toggle('visible', val.length > 0);
            searchTimer = setTimeout(() => {
                state.filters.search = val;
                state.pagination.page = 1;
                loadProducts();
            }, 300);
        });

        $('#searchClear').addEventListener('click', () => {
            searchInput.value = '';
            searchInput.focus();
            $('#searchClear').classList.remove('visible');
            state.filters.search = '';
            state.pagination.page = 1;
            loadProducts();
        });

        // Filters
        $('#filterCategory').addEventListener('change', (e) => {
            state.filters.category = e.target.value;
            state.pagination.page = 1;
            loadProducts();
        });

        $('#filterStock').addEventListener('change', (e) => {
            state.filters.stock_status = e.target.value;
            state.pagination.page = 1;
            loadProducts();
        });

        $('#sortBy').addEventListener('change', (e) => {
            const [field, dir] = e.target.value.split('-');
            state.filters.sort_by = field;
            state.filters.sort_dir = dir;
            state.pagination.page = 1;
            loadProducts();
        });

        // Stats bar click → filter
        $$('.stat-card').forEach(card => {
            card.addEventListener('click', () => {
                const filter = card.dataset.filter;
                $$('.stat-card').forEach(c => c.classList.remove('active'));

                if (filter === 'all' || filter === 'active') {
                    state.filters.stock_status = '';
                    $('#filterStock').value = '';
                } else {
                    state.filters.stock_status = filter;
                    $('#filterStock').value = filter;
                }

                card.classList.add('active');
                state.pagination.page = 1;
                loadProducts();
            });
        });

        // FAB
        $('#fabMain').addEventListener('click', () => {
            const menu = $('#fabMenu');
            const btn = $('#fabMain');
            menu.classList.toggle('open');
            btn.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.fab-container')) {
                $('#fabMenu').classList.remove('open');
                $('#fabMain').classList.remove('open');
            }
        });

        // Tabs
        $$('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.tab').forEach(t => t.classList.remove('active'));
                $$('.tab-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                $(`#${tab.dataset.tab}`).classList.add('active');
            });
        });

        // Chips
        setupChips('aliasInput', 'aliasesList', state.aliases);
        setupChips('tagInput', 'tagsList', state.tags);

        // Modal overlays close on backdrop click
        $$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                    document.body.style.overflow = '';
                }
            });
        });
    }

    // ══════════════════════════════════════════════
    // API CALLS
    // ══════════════════════════════════════════════
    async function apiFetch(url, options = {}) {
        const token = localStorage.getItem('token') || '';
        const defaults = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        };
        const response = await fetch(url, { ...defaults, ...options });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Error ${response.status}`);
        }
        return response.json();
    }

    // ══════════════════════════════════════════════
    // LOAD DATA
    // ══════════════════════════════════════════════
    async function loadStats() {
        try {
            const data = await apiFetch(`${API}/stats`);
            $('#statTotal').textContent = data.total;
            $('#statActive').textContent = data.active;
            $('#statLow').textContent = data.low_stock;
            $('#statOut').textContent = data.out_of_stock;
            $('#invValue').textContent = `S/ ${formatNum(data.inventory_value)}`;
            $('#invProfit').textContent = `S/ ${formatNum(data.estimated_profit)}`;
        } catch (e) {
            console.error('[Stats]', e);
        }
    }

    async function loadCategories() {
        try {
            const data = await apiFetch(`${API}/categories`);
            state.categories = data.categories;
            const sel = $('#filterCategory');
            sel.innerHTML = '<option value="">Todas las categorías</option>';
            data.categories.forEach(c => {
                sel.innerHTML += `<option value="${esc(c.name)}">${esc(c.name)} (${c.count})</option>`;
            });
            const dl = $('#categoryList');
            dl.innerHTML = '';
            data.categories.forEach(c => {
                dl.innerHTML += `<option value="${esc(c.name)}">`;
            });
        } catch (e) {
            console.error('[Categories]', e);
        }
    }

    async function loadProducts() {
        const p = state.pagination;
        const f = state.filters;
        const params = new URLSearchParams({
            page: p.page,
            per_page: p.per_page,
            sort_by: f.sort_by,
            sort_dir: f.sort_dir
        });

        if (f.search) params.set('search', f.search);
        if (f.category) params.set('category', f.category);
        if (f.stock_status) params.set('stock_status', f.stock_status);

        try {
            showLoader();
            const data = await apiFetch(`${API}/list?${params}`);
            state.products = data.products;
            state.pagination = data.pagination;
            renderProducts();
            renderPagination();
            hideLoader();
        } catch (e) {
            hideLoader();
            console.error('[Products]', e);
            showToast('Error cargando productos', 'error');
        }
    }

    // ══════════════════════════════════════════════
    // RENDER
    // ══════════════════════════════════════════════
    function renderProducts() {
        const container = $('#productsContainer');
        const empty = $('#emptyState');

        if (state.products.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        container.style.display = '';

        container.innerHTML = state.products.map(p => {
            const stockClass = p.is_out_of_stock ? 'out-of-stock'
                : p.is_low_stock ? 'low-stock' : '';
            const inactiveClass = !p.is_active ? 'inactive' : '';

            const stockBadge = p.is_out_of_stock ? '<span class="pc-stock-badge out">Agotado</span>'
                : p.is_low_stock ? `<span class="pc-stock-badge low">${p.stock}</span>`
                : `<span class="pc-stock-badge normal">${p.stock}</span>`;

            const img = p.image_url
                ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">`
                : categoryIcon(p.category);

            return `
                <div class="product-card ${stockClass} ${inactiveClass}" data-id="${p.id}">
                    <div class="pc-img">${img}</div>
                    <div class="pc-info">
                        <div class="pc-name" title="${esc(p.name)}">${esc(p.name)}</div>
                        <div class="pc-meta">
                            <span class="pc-category">${esc(p.category || 'General')}</span>
                            ${stockBadge}
                        </div>
                    </div>
                    <div class="pc-right">
                        <div class="pc-price">S/ ${parseFloat(p.sale_price).toFixed(2)}</div>
                        <div class="pc-actions">
                            <button class="pc-action-btn" title="Cambiar precio" onclick="ProductsApp.openPriceModal(${p.id})">${SVG.price}</button>
                            <button class="pc-action-btn" title="Ajustar stock" onclick="ProductsApp.openStockModal(${p.id})">${SVG.stock}</button>
                            <button class="pc-action-btn" title="Editar" onclick="ProductsApp.openEditModal(${p.id})">${SVG.edit}</button>
                            <button class="pc-action-btn danger" title="${p.is_active ? 'Desactivar' : 'Activar'}" onclick="ProductsApp.toggleProduct(${p.id})">
                                ${p.is_active ? SVG.eye : SVG.eyeOff}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderPagination() {
        const p = state.pagination;
        const el = $('#pagination');
        if (p.pages <= 1) { el.innerHTML = ''; return; }

        let html = `<button class="page-btn" ${p.page <= 1 ? 'disabled' : ''} onclick="ProductsApp.goPage(${p.page - 1})">‹</button>`;

        const maxVisible = 5;
        let start = Math.max(1, p.page - Math.floor(maxVisible / 2));
        let end = Math.min(p.pages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

        if (start > 1) html += `<button class="page-btn" onclick="ProductsApp.goPage(1)">1</button><span class="page-info">…</span>`;

        for (let i = start; i <= end; i++) {
            html += `<button class="page-btn ${i === p.page ? 'active' : ''}" onclick="ProductsApp.goPage(${i})">${i}</button>`;
        }

        if (end < p.pages) html += `<span class="page-info">…</span><button class="page-btn" onclick="ProductsApp.goPage(${p.pages})">${p.pages}</button>`;

        html += `<button class="page-btn" ${p.page >= p.pages ? 'disabled' : ''} onclick="ProductsApp.goPage(${p.page + 1})">›</button>`;
        html += `<span class="page-info">${p.total} prod.</span>`;

        el.innerHTML = html;
    }

    function goPage(page) {
        state.pagination.page = page;
        loadProducts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ══════════════════════════════════════════════
    // CREATE / EDIT PRODUCT
    // ══════════════════════════════════════════════
    function openCreateModal() {
        closeFab();
        state.editingId = null;
        $('#modalProductTitle').textContent = 'Nuevo producto';
        $('#btnSaveProduct').textContent = 'Crear producto';

        $('#formProduct').reset();
        $('#prodId').value = '';
        state.aliases = [];
        state.tags = [];
        renderChips('aliasesList', state.aliases);
        renderChips('tagsList', state.tags);
        resetImageUI();

        $$('.tab')[0].click();
        openModal('modalProduct');
    }

    async function openEditModal(productId) {
        try {
            showLoader();
            const data = await apiFetch(`${API}/${productId}`);
            const p = data.product;
            hideLoader();

            state.editingId = productId;
            $('#modalProductTitle').textContent = 'Editar producto';
            $('#btnSaveProduct').textContent = 'Guardar cambios';
            $('#prodId').value = productId;

            $('#prodName').value = p.name || '';
            $('#prodPrice').value = p.sale_price || '';
            $('#prodCost').value = p.cost_price || '';
            $('#prodStock').value = p.stock || 0;
            $('#prodMinStock').value = p.min_stock_alert || 5;
            $('#prodCategory').value = p.category || '';
            $('#prodUnit').value = p.unit || 'UND';
            const sbf = $('#edit-sell-by-fraction');
            if (sbf) sbf.checked = p.sell_by_fraction === true;
            $('#prodBrand').value = p.brand || '';
            $('#prodBarcode').value = p.barcode || '';
            $('#prodDescription').value = p.description || '';

            state.aliases = [...(p.aliases || [])];
            state.tags = [...(p.tags || [])];
            renderChips('aliasesList', state.aliases);
            renderChips('tagsList', state.tags);

            // Imagen actual del producto
            resetImageUI();
            if (p.image_url) {
                showImagePreview(p.image_url);
                $('#btn-quitar-imagen').style.display = 'inline-flex';
            }

            if (p.mayoreo) {
                $('#prodMayoreoQty').value = p.mayoreo.cantidad_min || '';
                $('#prodMayoreoPrice').value = p.mayoreo.precio || '';
                $('#prodMayoreoNote').value = p.mayoreo.nota || '';
            } else {
                $('#prodMayoreoQty').value = '';
                $('#prodMayoreoPrice').value = '';
                $('#prodMayoreoNote').value = '';
            }

            $$('.tab')[0].click();
            openModal('modalProduct');
        } catch (e) {
            hideLoader();
            showToast('Error cargando producto', 'error');
        }
    }

    async function saveProduct() {
        const name = $('#prodName').value.trim();
        const price = parseFloat($('#prodPrice').value);

        if (!name) { showToast('El nombre es obligatorio', 'error'); return; }
        if (!price || price <= 0) { showToast('El precio debe ser mayor a 0', 'error'); return; }

        const body = {
            name,
            sale_price: price,
            cost_price: parseFloat($('#prodCost').value) || 0,
            stock: parseInt($('#prodStock').value) || 0,
            min_stock_alert: parseInt($('#prodMinStock').value) || 5,
            category: $('#prodCategory').value.trim() || null,
            unit: $('#prodUnit').value,
            sell_by_fraction: !!($('#edit-sell-by-fraction')?.checked),
            brand: $('#prodBrand').value.trim() || null,
            barcode: $('#prodBarcode').value.trim() || null,
            description: $('#prodDescription').value.trim() || null,
            aliases: state.aliases,
            tags: state.tags,
            mayoreo_cantidad_min: parseInt($('#prodMayoreoQty').value) || null,
            mayoreo_precio: parseFloat($('#prodMayoreoPrice').value) || null,
            mayoreo_nota: $('#prodMayoreoNote').value.trim() || null,
        };

        try {
            showLoader();
            if (state.editingId) {
                await apiFetch(`${API}/${state.editingId}`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
                showToast('Producto actualizado', 'success');
            } else {
                await apiFetch(`${API}/create`, {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
                showToast('Producto creado', 'success');
            }

            closeModal('modalProduct');
            await Promise.all([loadProducts(), loadStats(), loadCategories()]);
            hideLoader();
        } catch (e) {
            hideLoader();
            showToast(e.message, 'error');
        }
    }

    // ══════════════════════════════════════════════
    // QUICK ACTIONS
    // ══════════════════════════════════════════════
    function openStockModal(productId) {
        const p = state.products.find(x => x.id === productId);
        if (!p) return;

        $('#stockProductId').value = productId;
        $('#stockProductName').textContent = p.name;
        $('#stockCurrent').textContent = p.stock;
        $('#stockQty').value = 0;
        $('#stockReason').value = 'Compra proveedor';

        openModal('modalStock');
    }

    function adjustStockInput(delta) {
        const input = $('#stockQty');
        input.value = parseInt(input.value || 0) + delta;
    }

    function setStockQty(value) {
        $('#stockQty').value = value;
    }

    async function saveStock() {
        const productId = parseInt($('#stockProductId').value);
        const quantity = parseInt($('#stockQty').value);
        const reason = $('#stockReason').value;

        if (quantity === 0) { showToast('Ingresa una cantidad', 'error'); return; }

        try {
            showLoader();
            const data = await apiFetch(`${API}/${productId}/stock`, {
                method: 'PUT',
                body: JSON.stringify({ quantity, reason })
            });

            showToast(data.message, 'success');
            if (data.alert === 'stock_bajo') {
                showToast(`Stock bajo: ${data.name}`, 'warning');
            }

            closeModal('modalStock');
            await Promise.all([loadProducts(), loadStats()]);
            hideLoader();
        } catch (e) {
            hideLoader();
            showToast(e.message, 'error');
        }
    }

    function openPriceModal(productId) {
        const p = state.products.find(x => x.id === productId);
        if (!p) return;

        $('#priceProductId').value = productId;
        $('#priceProductName').textContent = p.name;
        $('#priceCurrent').textContent = `S/ ${parseFloat(p.sale_price).toFixed(2)}`;
        $('#priceNew').value = p.sale_price;
        $('#priceCostNew').value = p.cost_price || '';

        openModal('modalPrice');
        setTimeout(() => $('#priceNew').select(), 100);
    }

    async function savePrice() {
        const productId = parseInt($('#priceProductId').value);
        const sale_price = parseFloat($('#priceNew').value);
        const cost_price = parseFloat($('#priceCostNew').value) || null;

        if (!sale_price || sale_price <= 0) { showToast('Precio inválido', 'error'); return; }

        try {
            showLoader();
            const body = { sale_price };
            if (cost_price) body.cost_price = cost_price;

            const data = await apiFetch(`${API}/${productId}/price`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });

            showToast(data.message, 'success');
            closeModal('modalPrice');
            await Promise.all([loadProducts(), loadStats()]);
            hideLoader();
        } catch (e) {
            hideLoader();
            showToast(e.message, 'error');
        }
    }

    async function toggleProduct(productId) {
        const p = state.products.find(x => x.id === productId);
        if (!p) return;

        const action = p.is_active ? 'desactivar' : 'activar';
        if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} "${p.name}"?`)) return;

        try {
            const data = await apiFetch(`${API}/${productId}/toggle`, { method: 'PUT' });
            showToast(data.message, 'success');
            await Promise.all([loadProducts(), loadStats()]);
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    // ══════════════════════════════════════════════
    // IMPORT CATALOG
    // ══════════════════════════════════════════════
    async function openImportModal() {
        closeFab();
        try {
            showLoader();
            const data = await apiFetch(`${API}/catalogs/status`);
            state.availableCatalogs = data.available;
            state.selectedCatalogs = [];
            hideLoader();

            renderCatalogs();
            $('#importPreview').style.display = 'none';
            $('#btnImport').disabled = true;

            openModal('modalImport');
        } catch (e) {
            hideLoader();
            showToast('Error cargando catálogos', 'error');
        }
    }

    function renderCatalogs() {
        const grid = $('#catalogsGrid');
        grid.innerHTML = state.availableCatalogs.map(c => `
            <div class="catalog-card ${c.imported ? 'imported' : ''}"
                 data-nicho="${c.nicho}"
                 onclick="ProductsApp.toggleCatalog('${c.nicho}')">
                ${c.imported ? `<span class="cc-badge">✓ ${c.imported_count}</span>` : ''}
                <div class="cc-icon">${c.icono}</div>
                <div class="cc-name">${esc(c.nombre)}</div>
                <div class="cc-count">${c.total_productos} productos</div>
            </div>
        `).join('');
    }

    async function toggleCatalog(nicho) {
        const card = $(`.catalog-card[data-nicho="${nicho}"]`);
        const idx = state.selectedCatalogs.indexOf(nicho);

        if (idx >= 0) {
            state.selectedCatalogs.splice(idx, 1);
            card.classList.remove('selected');
        } else {
            state.selectedCatalogs.push(nicho);
            card.classList.add('selected');
        }

        $('#btnImport').disabled = state.selectedCatalogs.length === 0;

        if (state.selectedCatalogs.length > 0) {
            const lastNicho = state.selectedCatalogs[state.selectedCatalogs.length - 1];
            try {
                const data = await apiFetch(`${API}/catalogs/${lastNicho}/preview`);
                const preview = $('#importPreview');
                preview.style.display = 'block';
                $('#previewTitle').textContent = lastNicho.charAt(0).toUpperCase() + lastNicho.slice(1);
                $('#previewCount').textContent = `${data.total_products} productos`;
                $('#previewCategories').innerHTML = data.categories.map(c =>
                    `<span class="preview-cat">${c.icono} ${c.nombre} (${c.productos_count})</span>`
                ).join('');
            } catch (e) { /* silent */ }
        } else {
            $('#importPreview').style.display = 'none';
        }
    }

    async function importCatalog() {
        if (state.selectedCatalogs.length === 0) return;

        try {
            showLoader();
            let totalImported = 0;
            let totalSkipped = 0;

            for (const nicho of state.selectedCatalogs) {
                const data = await apiFetch(`${API}/import`, {
                    method: 'POST',
                    body: JSON.stringify({ nicho, import_all: true })
                });
                totalImported += data.stats.imported;
                totalSkipped += data.stats.skipped;
            }

            closeModal('modalImport');

            const msg = totalSkipped > 0
                ? `Importados ${totalImported} productos (${totalSkipped} ya existían)`
                : `Importados ${totalImported} productos`;
            showToast(msg, 'success');

            await Promise.all([loadProducts(), loadStats(), loadCategories()]);
            hideLoader();
        } catch (e) {
            hideLoader();
            showToast(e.message, 'error');
        }
    }

    // ══════════════════════════════════════════════
    // CHIPS (Aliases / Tags)
    // ══════════════════════════════════════════════
    function setupChips(inputId, listId, arr) {
        const input = $(`#${inputId}`);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const val = input.value.trim().toLowerCase().replace(/,/g, '');
                if (val && !arr.includes(val)) {
                    arr.push(val);
                    renderChips(listId, arr);
                }
                input.value = '';
            }
            if (e.key === 'Backspace' && !input.value && arr.length) {
                arr.pop();
                renderChips(listId, arr);
            }
        });
    }

    function renderChips(listId, arr) {
        $(`#${listId}`).innerHTML = arr.map((val, i) =>
            `<span class="chip">${esc(val)}<span class="chip-remove" onclick="ProductsApp.removeChip('${listId}', ${i})">×</span></span>`
        ).join('');
    }

    function removeChip(listId, index) {
        const arr = listId === 'aliasesList' ? state.aliases : state.tags;
        arr.splice(index, 1);
        renderChips(listId, arr);
    }

    // ══════════════════════════════════════════════
    // IMAGEN DE PRODUCTO
    // ══════════════════════════════════════════════
    function resetImageUI() {
        state.imagenSeleccionada = null;
        const preview = $('#img-preview');
        const placeholder = $('#img-placeholder');
        const btnSubir = $('#btn-subir-imagen');
        const btnQuitar = $('#btn-quitar-imagen');
        const status = $('#img-upload-status');
        const input = $('#input-imagen');
        if (preview) { preview.src = ''; preview.style.display = 'none'; }
        if (placeholder) placeholder.style.display = 'flex';
        if (btnSubir) {
            btnSubir.style.display = 'none';
            btnSubir.disabled = false;
            btnSubir.textContent = '☁️ Subir';
        }
        if (btnQuitar) btnQuitar.style.display = 'none';
        if (status) { status.textContent = ''; status.style.color = '#666'; }
        if (input) input.value = '';
    }

    function showImagePreview(src) {
        const preview = $('#img-preview');
        const placeholder = $('#img-placeholder');
        if (preview) { preview.src = src; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
    }

    function previsualizarImagen(input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];

        if (file.size > 2 * 1024 * 1024) {
            showToast('La imagen no puede superar 2MB', 'error');
            input.value = '';
            return;
        }

        state.imagenSeleccionada = file;

        const reader = new FileReader();
        reader.onload = (e) => {
            showImagePreview(e.target.result);
            $('#btn-subir-imagen').style.display = 'inline-flex';
        };
        reader.readAsDataURL(file);
    }

    async function subirImagenProducto() {
        if (!state.imagenSeleccionada) return;
        if (!state.editingId) {
            showToast('Guarda primero el producto antes de subir su imagen', 'info');
            return;
        }

        const btn = $('#btn-subir-imagen');
        const status = $('#img-upload-status');

        btn.disabled = true;
        btn.textContent = '⏳ Subiendo...';
        status.textContent = '';

        const formData = new FormData();
        formData.append('imagen', state.imagenSeleccionada);

        try {
            const token = localStorage.getItem('token') || '';
            const res = await fetch(
                `/api/v1/products/v2/${state.editingId}/imagen`,
                {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                }
            );
            const data = await res.json();

            if (res.ok && data.ok) {
                status.textContent = '✅ Imagen subida correctamente';
                status.style.color = '#10b981';
                btn.textContent = '✅ Subida';
                $('#btn-quitar-imagen').style.display = 'inline-flex';
                showImagePreview(data.image_url);
                state.imagenSeleccionada = null;
                actualizarImagenEnGrid(state.editingId, data.image_url);
            } else {
                status.textContent = '❌ ' + (data.detail || 'Error al subir');
                status.style.color = '#e53935';
                btn.disabled = false;
                btn.textContent = '☁️ Subir';
            }
        } catch (err) {
            status.textContent = '❌ Error de conexión';
            status.style.color = '#e53935';
            btn.disabled = false;
            btn.textContent = '☁️ Subir';
        }
    }

    async function quitarImagenProducto() {
        if (!state.editingId) {
            // Aún no se ha guardado: solo limpiar UI
            resetImageUI();
            return;
        }

        const status = $('#img-upload-status');
        try {
            const token = localStorage.getItem('token') || '';
            const res = await fetch(
                `/api/v1/products/v2/${state.editingId}/imagen`,
                {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                }
            );
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.ok) {
                resetImageUI();
                actualizarImagenEnGrid(state.editingId, null);
                if (status) {
                    status.textContent = '🗑️ Imagen eliminada';
                    status.style.color = '#666';
                }
            } else {
                showToast(data.detail || 'No se pudo quitar la imagen', 'error');
            }
        } catch (err) {
            showToast('Error de conexión', 'error');
        }
    }

    function actualizarImagenEnGrid(productoId, imageUrl) {
        // Card en /productos
        const card = document.querySelector(`.product-card[data-id="${productoId}"]`);
        if (card) {
            const wrap = card.querySelector('.pc-img');
            if (wrap) {
                if (imageUrl) {
                    wrap.innerHTML = `<img src="${esc(imageUrl)}" alt="" loading="lazy">`;
                } else {
                    // Buscar producto en state para ícono por categoría
                    const p = state.products.find(x => x.id === productoId);
                    wrap.innerHTML = categoryIcon(p ? p.category : '');
                }
            }
        }
        // Sincronizar state local
        const p = state.products.find(x => x.id === productoId);
        if (p) p.image_url = imageUrl;
    }

    // ══════════════════════════════════════════════
    // MODAL HELPERS
    // ══════════════════════════════════════════════
    function openModal(id) {
        $(`#${id}`).classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(id) {
        $(`#${id}`).classList.remove('active');
        document.body.style.overflow = '';
        if (id === 'modalProduct') {
            resetImageUI();
        }
    }

    function closeFab() {
        $('#fabMenu').classList.remove('open');
        $('#fabMain').classList.remove('open');
    }

    // ══════════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════════
    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatNum(n) {
        return new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    }

    function categoryIcon(category) {
        const icons = {
            'Bebidas No Alcohólicas': '🥤', 'Bebidas Alcohólicas': '🍺',
            'Snacks, Galletas y Golosinas': '🍪', 'Abarrotes': '🛒',
            'Condimentos y Salsas': '🌶️', 'Lácteos y Huevos': '🥛',
            'Pan y Panadería': '🍞', 'Embutidos y Fiambres': '🥓',
            'Limpieza del Hogar': '🧹', 'Cuidado Personal e Higiene': '🧴',
            'Cuidado Personal': '🧴', 'Helados y Congelados': '🍦',
            'Misceláneos y Bazar': '📎',
            'Bebidas': '🥤', 'Snacks': '🍿', 'Galletas': '🍪',
            'Panadería': '🍞', 'Lácteos': '🥛', 'Limpieza': '🧹',
            'Verduras': '🥬', 'Frutas': '🍎', 'Carnes': '🥩',
        };
        return icons[category] || '📦';
    }

    // V2 Loader integration
    function showLoader() {
        if (window.Loader && typeof Loader.show === 'function') {
            Loader.show('bodega');
        }
    }
    function hideLoader() {
        if (window.Loader && typeof Loader.hide === 'function') {
            Loader.hide();
        }
    }

    // Handler del checkbox "Venta fraccionada" en el modal de edición.
    // El valor se persiste al guardar; este callback solo está para feedback inmediato.
    function toggleSellByFraction(input) {
        const on = !!(input && input.checked);
        if (typeof showToast === 'function') {
            showToast(on ? 'Venta fraccionada activada' : 'Venta fraccionada desactivada', 'info');
        }
    }

    // V2 Toast integration
    function showToast(message, type = 'info') {
        if (window.Toast && typeof Toast[type] === 'function') {
            Toast[type](message);
        } else if (window.Toast && typeof Toast.show === 'function') {
            Toast.show(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    // ══════════════════════════════════════════════
    // PUBLIC API
    // ══════════════════════════════════════════════
    return {
        init,
        goPage,
        openCreateModal,
        openEditModal,
        saveProduct,
        toggleSellByFraction,
        openStockModal,
        adjustStockInput,
        setStockQty,
        saveStock,
        openPriceModal,
        savePrice,
        toggleProduct,
        openImportModal,
        toggleCatalog,
        importCatalog,
        removeChip,
        closeModal,
        previsualizarImagen,
        subirImagenProducto,
        quitarImagenProducto,
    };

})();

// ── Auto-init ──
document.addEventListener('DOMContentLoaded', ProductsApp.init);