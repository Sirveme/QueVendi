// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════
let logoDataUrl = null;
let _configLoaded = false;

// ════════════════════════════════════════════════
// TABS
// ════════════════════════════════════════════════
function switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('stab-' + tab).classList.add('active');
    if (tab === 'devices') { loadDevices(); loadUsers(); }
    if (tab === 'print') { loadPrinters(); }
}

// ════════════════════════════════════════════════
// ZOOM PREVIEW
// ════════════════════════════════════════════════
function setZoom(size) {
    const tp = document.getElementById('ticketPreview');
    tp.className = size === 'sm' ? 'zoom-sm' : size === 'lg' ? 'zoom-lg' : '';
    document.querySelectorAll('.zoom-btn').forEach((b,i) => {
        b.classList.toggle('active', ['sm','md','lg'][i] === size);
    });
}

// ════════════════════════════════════════════════
// RUC AUTOFILL
// ════════════════════════════════════════════════
let rucTimeout = null;
function onRucChange(input) {
    clearTimeout(rucTimeout);
    updatePreview();
    const ruc = input.value.trim();
    if (ruc.length === 11) {
        rucTimeout = setTimeout(async () => {
            try {
                const token = localStorage.getItem('access_token');
                const resp = await fetch(`/api/v1/billing/consulta/ruc/${ruc}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.razon_social) {
                        document.getElementById('razon_social').value  = data.razon_social || '';
                        document.getElementById('direccion').value     = data.direccion || '';
                        document.getElementById('ruc-autofill').classList.add('show');
                        setTimeout(() => document.getElementById('ruc-autofill').classList.remove('show'), 3000);
                        updatePreview();
                    }
                }
            } catch (e) { console.warn('RUC lookup failed:', e); }
        }, 500);
    }
}

// ════════════════════════════════════════════════
// LOGO
// ════════════════════════════════════════════════
function handleLogo(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 512000) { showToast('Logo muy grande. Máximo 500KB.', 'err'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        logoDataUrl = e.target.result;
        document.getElementById('logoPreview').innerHTML = `<img src="${logoDataUrl}" alt="Logo">`;
        updatePreview();
    };
    reader.readAsDataURL(file);
}

// ════════════════════════════════════════════════
// SIZE PREVIEW (sliders)
// ════════════════════════════════════════════════
function updateSizePreview(key, val) {
    document.getElementById('sz_' + key).textContent = val;
    const el = document.getElementById('sprev_' + key);
    if (el) el.style.fontSize = val + 'px';
    // Actualizar fuente correcta en el preview del slider
    const fontMap = { playfair:'Playfair Display', oswald:'Oswald', lato:'Lato',
        ubuntu:'Ubuntu', raleway:'Raleway', bebas:'Bebas Neue',
        pacifico:'Pacifico', cinzel:'Cinzel', righteous:'Righteous', archivo:'Archivo Black' };
    if (key === 'nombre') {
        const fk = document.querySelector('input[name="font_decorativa"]:checked')?.value || 'playfair';
        if (el) el.style.fontFamily = `'${fontMap[fk]}', serif`;
    }
}

// ════════════════════════════════════════════════
// TEMPLATES / PRESETS
// ════════════════════════════════════════════════
const TEMPLATES = {
    bodega:      { font_decorativa:'lato',     font_ruc:'lato',    font_numero:'bebas',   font_total:'archivo', font_slogan:'lato',     header_style:1, es_amazonia:true },
    ferreteria:  { font_decorativa:'bebas',    font_ruc:'oswald',  font_numero:'bebas',   font_total:'bebas',   font_slogan:'oswald',   header_style:3, es_amazonia:true },
    consultorio: { font_decorativa:'cinzel',   font_ruc:'lato',    font_numero:'cinzel',  font_total:'lato',    font_slogan:'cinzel',   header_style:2, es_amazonia:false },
    gym:         { font_decorativa:'oswald',   font_ruc:'ubuntu',  font_numero:'bebas',   font_total:'archivo', font_slogan:'righteous',header_style:3, es_amazonia:false },
    salon:       { font_decorativa:'pacifico', font_ruc:'raleway', font_numero:'righteous',font_total:'raleway',font_slogan:'pacifico', header_style:2, es_amazonia:false },
    notaria:     { font_decorativa:'playfair', font_ruc:'lato',    font_numero:'playfair',font_total:'oswald',  font_slogan:'playfair', header_style:2, es_amazonia:false },
};

function applyTemplate(name) {
    const t = TEMPLATES[name];
    if (!t) return;
    // Font decorativa
    const r = document.querySelector(`input[name="font_decorativa"][value="${t.font_decorativa}"]`);
    if (r) r.checked = true;
    // Header style
    const hs = document.querySelector(`input[name="header_style"][value="${t.header_style}"]`);
    if (hs) hs.checked = true;
    // Selects
    ['font_razon','font_ruc','font_numero','font_total','font_slogan'].forEach(id => {
        const el = document.getElementById(id);
        if (el && t[id]) el.value = t[id];
    });
    // es_amazonia
    const ea = document.getElementById('es_amazonia');
    if (ea !== null) ea.checked = t.es_amazonia;
    // Marcar template activo
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
    document.getElementById('tpl-' + name)?.classList.add('active');
    updatePreview();
    showToast(`Plantilla "${name}" aplicada`, 'ok2');
}

// ════════════════════════════════════════════════
// GET FORM DATA
// ════════════════════════════════════════════════
function getFormData() {
    const v  = (id) => document.getElementById(id)?.value?.trim() || '';
    const ch = (id) => document.getElementById(id)?.checked || false;
    return {
        ruc:              v('ruc'),
        razon_social:     v('razon_social'),
        nombre_comercial: v('nombre_comercial'),
        direccion:        v('direccion'),
        cod_establecimiento: v('cod_establecimiento'),
        distrito:         v('distrito'),
        provincia:        v('provincia'),
        departamento:     v('departamento'),
        giro:             v('giro'),
        slogan:           v('slogan'),
        telefono:         v('telefono'),
        email:            v('email'),
        serie_boleta:     v('serie_boleta') || 'B001',
        serie_factura:    v('serie_factura') || 'F001',
        serie_nc_boleta:  v('serie_nc_boleta') || 'BC01',
        serie_nc_factura: v('serie_nc_factura') || 'FC01',
        tipo_igv:         v('tipo_igv') || '20',
        es_amazonia:      ch('es_amazonia'),
        print_method:     v('print_method'),
        printer_name:     v('printer_name'),
        papel_ancho:      parseInt(document.querySelector('input[name="papel_ancho"]:checked')?.value || 80),
        header_style:     parseInt(document.querySelector('input[name="header_style"]:checked')?.value || 1),
        font_decorativa:  document.querySelector('input[name="font_decorativa"]:checked')?.value || 'playfair',
        eslogan2:         v('eslogan2'),
        font_razon:       v('font_razon')  || 'lato',
        font_ruc:         v('font_ruc')    || 'lato',
        font_numero:      v('font_numero') || 'bebas',
        font_total:       v('font_total')  || 'archivo',
        font_slogan:      v('font_slogan') || 'pacifico',
        size_nombre:      parseInt(document.getElementById('size_nombre')?.value || 15),
        size_razon:       parseInt(document.getElementById('size_razon')?.value || 9),
        size_ruc:         parseInt(document.getElementById('size_ruc')?.value || 10),
        size_numero:      parseInt(document.getElementById('size_numero')?.value || 14),
        size_items:       parseInt(document.getElementById('size_items')?.value || 8),
        size_total:       parseInt(document.getElementById('size_total')?.value || 12),
        size_slogan:      parseInt(document.getElementById('size_slogan')?.value || 9),
        catalogo_activo:  ch('catalogo_activo'),
        contador_ruc:     v('contador_ruc'),
        contador_nombre:  v('contador_nombre'),
        facturalo_url:    v('facturalo_url'),
        facturalo_token:  v('facturalo_token'),
        facturalo_secret: v('facturalo_secret'),
        logo: logoDataUrl,
        promo_activo:           document.getElementById('promo_activo')?.checked || false,
        promo_tipo:             document.querySelector('input[name="promo_tipo"]:checked')?.value || 'banner',
        promo_banner_producto:  v('promo_banner_producto'),
        promo_banner_precio_normal: v('promo_banner_precio_normal'),
        promo_banner_precio_oferta: v('promo_banner_precio_oferta'),
        promo_banner_vigencia:  v('promo_banner_vigencia'),
        promo_cupon_titulo:     v('promo_cupon_titulo'),
        promo_cupon_descuento:  v('promo_cupon_descuento'),
        promo_cupon_minimo:     v('promo_cupon_minimo'),
        promo_cupon_vence:      v('promo_cupon_vence'),
        promo_ref_mensaje:      v('promo_ref_mensaje'),
        promo_ref_premio:       v('promo_ref_premio'),
        promo_texto_libre:      v('promo_texto_libre'),
    };
}

// ════════════════════════════════════════════════
// UPDATE PREVIEW — el corazón del sistema
// ════════════════════════════════════════════════
function updatePreview() {
    const d = getFormData();
    const fontMap = {
        playfair:'Playfair Display', oswald:'Oswald', lato:'Lato',
        ubuntu:'Ubuntu', raleway:'Raleway', bebas:'Bebas Neue',
        pacifico:'Pacifico', cinzel:'Cinzel', righteous:'Righteous',
        archivo:'Archivo Black'
    };
    const fNombre  = fontMap[d.font_decorativa] || 'Playfair Display';
    const fRazon   = fontMap[d.font_razon]  || 'Lato';
    const fRuc     = fontMap[d.font_ruc]    || 'Lato';
    const fNumero  = fontMap[d.font_numero] || 'Bebas Neue';
    const fTotal   = fontMap[d.font_total]  || 'Archivo Black';
    const fSlogan  = fontMap[d.font_slogan] || 'Pacifico';

    // Actualizar mini-previews de sliders de fuente
    ['razon','ruc','numero','total','slogan'].forEach(k => {
        const el = document.getElementById('prev_' + k);
        if (!el) return;
        const fk = k === 'razon' ? fRazon : k === 'ruc' ? fRuc : k === 'numero' ? fNumero : k === 'total' ? fTotal : fSlogan;
        el.style.fontFamily = `'${fk}', sans-serif`;
    });
    // Preview slider razón
    const spRazon = document.getElementById('sprev_razon');
    if (spRazon) spRazon.style.fontFamily = `'${fRazon}', sans-serif`;
    // Actualizar mini-preview del slider nombre
    const spNombre = document.getElementById('sprev_nombre');
    if (spNombre) spNombre.style.fontFamily = `'${fNombre}', serif`;

    // Construir datos del ticket
    const nombre   = d.nombre_comercial || d.razon_social || 'MI NEGOCIO';
    const razon    = d.razon_social || '';
    const ruc      = d.ruc || '00000000000';
    const dir      = d.direccion || 'Dirección del negocio';
    const cod      = d.cod_establecimiento || '0000';
    const tel      = d.telefono || '';
    const serie    = d.serie_boleta || 'B001';
    const ubicacion = [d.distrito, d.provincia, d.departamento].filter(Boolean).join(' - ');

    // Calcular totales según IGV
    const subtotal = 139.00;
    let opGravada = 0, opExonerada = 0, opInafecta = 0, igv = 0, total = subtotal;
    if (d.tipo_igv === '10') {
        opGravada = +(subtotal / 1.18).toFixed(2);
        igv = +(subtotal - opGravada).toFixed(2);
    } else if (d.tipo_igv === '20') {
        opExonerada = subtotal;
    } else {
        opInafecta = subtotal;
    }

    // Header según estilo
    let headerHtml = '';
    const logoHtml = logoDataUrl
        ? `<div class="t-logo"><img src="${logoDataUrl}"></div>`
        : '';

    if (d.header_style === 2) {
        // Logo arriba, texto abajo centrado
        headerHtml = `
            ${logoHtml}
            <div style="font-family:'${fNombre}',serif;font-size:${d.size_nombre}px;font-weight:700;text-align:center;line-height:1.2">${esc(nombre)}</div>
            ${razon && razon !== nombre ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${d.size_razon}px;text-align:center;color:#444;font-weight:600">${esc(razon)}</div>` : ''}
            ${d.giro ? `<div style="font-size:${d.size_ruc}px;text-align:center">${esc(d.giro)}</div>` : ''}
            <div style="font-size:${d.size_ruc}px;text-align:center">${esc(dir)}</div>
            ${ubicacion ? `<div style="font-size:${d.size_ruc}px;text-align:center">${esc(ubicacion)}</div>` : ''}
            ${tel ? `<div style="font-size:${d.size_ruc}px;text-align:center">CEL: ${esc(tel)}</div>` : ''}
        `;
    } else if (d.header_style === 3) {
        // Logo a la izquierda + texto a la derecha
        headerHtml = `
            <div style="display:flex;gap:6px;align-items:flex-start">
                ${logoDataUrl ? `<img src="${logoDataUrl}" style="width:32px;height:32px;object-fit:contain;flex-shrink:0">` : ''}
                <div style="flex:1">
                    <div style="font-family:'${fNombre}',serif;font-size:${Math.max(d.size_nombre-2,10)}px;font-weight:700;line-height:1.2">${esc(nombre)}</div>
                    ${razon && razon !== nombre ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${d.size_razon}px;color:#444;font-weight:600">${esc(razon)}</div>` : ''}
                    ${d.giro ? `<div style="font-size:${d.size_ruc}px">${esc(d.giro)}</div>` : ''}
                    <div style="font-size:${d.size_ruc}px">${esc(dir)}</div>
                    ${ubicacion ? `<div style="font-size:${d.size_ruc}px">${esc(ubicacion)}</div>` : ''}
                </div>
            </div>
        `;
    } else {
        // Clásico centrado (style 1)
        headerHtml = `
            ${logoHtml}
            <div style="font-family:'${fNombre}',serif;font-size:${d.size_nombre}px;font-weight:700;text-align:center;line-height:1.2">${esc(nombre)}</div>
            ${razon && razon !== nombre ? `<div style="font-size:${Math.max(d.size_ruc-1,7)}px;text-align:center;color:#555;font-style:italic">${esc(razon)}</div>` : ''}
            ${d.giro ? `<div style="font-size:${d.size_ruc}px;text-align:center">${esc(d.giro)}</div>` : ''}
            <div style="font-size:${d.size_ruc}px;text-align:center">${esc(dir)}</div>
            ${ubicacion ? `<div style="font-size:${d.size_ruc}px;text-align:center">${esc(ubicacion)}</div>` : ''}
            ${tel ? `<div style="font-size:${d.size_ruc}px;text-align:center">CEL: ${esc(tel)}</div>` : ''}
        `;
    }

    // Totales HTML
    let totalesHtml = '';
    if (opGravada   > 0) totalesHtml += `<div class="t-row" style="font-size:${d.size_items}px"><span>Op. Gravada S/</span><span>${opGravada.toFixed(2)}</span></div>`;
    if (opExonerada > 0) totalesHtml += `<div class="t-row" style="font-size:${d.size_items}px"><span>Op. Exonerada S/</span><span>${opExonerada.toFixed(2)}</span></div>`;
    if (opInafecta  > 0) totalesHtml += `<div class="t-row" style="font-size:${d.size_items}px"><span>Op. Inafecta S/</span><span>${opInafecta.toFixed(2)}</span></div>`;
    if (igv         > 0) totalesHtml += `<div class="t-row" style="font-size:${d.size_items}px"><span>IGV 18% S/</span><span>${igv.toFixed(2)}</span></div>`;

    document.getElementById('ticketPreview').innerHTML = `
        <div class="t-center">${headerHtml}</div>

        <div style="border:1.5px solid #999;border-radius:3px;padding:5px;margin:5px 0;text-align:center">
            <div style="font-family:'${fRuc}',sans-serif;font-size:${d.size_ruc+2}px;font-weight:bold">
                RUC: ${esc(ruc)}
            </div>
            ${cod !== '0000' ? `<div style="font-size:${d.size_ruc}px;color:#555">COD ESTAB: ${esc(cod)}</div>` : ''}
            <hr class="t-divider">
            <div style="font-size:${d.size_items+1}px;font-weight:bold;margin:2px 0">BOLETA DE VENTA ELECTRÓNICA</div>
            <div class="t-inverse" style="font-family:'${fNumero}',sans-serif;font-size:${d.size_numero}px;font-weight:bold">
                ${esc(serie)}-00000001
            </div>
        </div>

        <div class="t-row" style="font-size:${d.size_items}px;margin:3px 0">
            <span>Fecha E: ${new Date().toLocaleDateString('es-PE')}</span>
            <span>Hora: ${new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</span>
            <span>F.Pago: Contado</span>
        </div>

        <div style="border:1px solid #ddd;border-radius:3px;padding:4px;margin:4px 0;font-size:${d.size_items}px">
            <div>DNI: &nbsp; 05393776</div>
            <div>Cliente: DUILIO RESTUCCIA ESLAVA</div>
            <div>Dirección:</div>
        </div>

        <div style="border:1px solid #ddd;border-radius:3px;padding:4px;margin:4px 0">
            <div class="t-row t-bold" style="font-size:${d.size_items}px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-bottom:3px">
                <span style="flex:2">Producto</span>
                <span style="width:28px;text-align:center">Cant</span>
                <span style="width:40px;text-align:right">Uni Precio</span>
                <span style="width:36px;text-align:right">Total</span>
            </div>
            <div class="t-row" style="font-size:${d.size_items}px;margin-bottom:2px">
                <span style="flex:2">Cemento Sol 42.5kg</span>
                <span style="width:28px;text-align:center">2</span>
                <span style="width:40px;text-align:right">NIU 32.00</span>
                <span style="width:36px;text-align:right">64.00</span>
            </div>
            <div class="t-row" style="font-size:${d.size_items}px;margin-bottom:4px">
                <span style="flex:2">Fierro 1/2" x 9m</span>
                <span style="width:28px;text-align:center">3</span>
                <span style="width:40px;text-align:right">NIU 25.00</span>
                <span style="width:36px;text-align:right">75.00</span>
            </div>
            <div style="font-size:${d.size_items}px;color:#666">Items: 2</div>
            ${totalesHtml}
        </div>

        <div style="border:2px solid #333;border-radius:3px;padding:5px;margin:4px 0">
            <div class="t-row t-bold" style="font-family:'${fTotal}',sans-serif;font-size:${d.size_total}px">
                <span>TOTAL S/</span>
                <span>${total.toFixed(2)}</span>
            </div>
        </div>

        <div style="font-size:${d.size_items}px;margin:3px 0">
            Son: CIENTO TREINTA Y NUEVE CON 00/100 SOLES
        </div>
        <div class="t-row" style="font-size:${d.size_items}px;margin-bottom:4px">
            <span>Efectivo S/ 150.00</span>
            <span>Vuelto S/ 11.00</span>
        </div>

        ${d.catalogo_activo ? `
        <div class="t-highlight" style="font-size:${d.size_items}px">
            <div style="font-size:${d.size_items-1}px;color:#444">&gt;&gt;&gt; Visita nuestra Tienda Online &lt;&lt;&lt;</div>
            <div class="t-highlight-url">www.quevendi.pro/${tel || 'TU-NUMERO'}</div>
            <div style="font-size:${d.size_items-1}px;color:#666">Compra para RECOGER o para DELIVERY</div>
        </div>` : ''}

        <div class="t-qr" style="font-size:${d.size_items}px;margin:4px 0">
            <div>Representación impresa de la</div>
            <div style="font-weight:bold">BOLETA DE VENTA ELECTRÓNICA</div>
            <div>Verifique en:</div>
            <div>www.facturalo.pro/verificar</div>
            <div>www.sunat.gob.pe</div>
        </div>

        <div style="font-size:${d.size_items-1}px;margin:3px 0">
            <div class="t-row"><span>Usuario vendedor</span><span>${new Date().toLocaleDateString('es-PE')} ${new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</span></div>
            <div>CAJA01</div>
            <div class="t-row"><span>www.quevendi.pro</span><span>WhatsApp: ${tel || ''}</span></div>
        </div>

        ${d.es_amazonia ? `
        <div style="font-size:${d.size_items-1}px;text-align:center;font-weight:bold;margin:3px 0">
            /// ATENDEMOS TODO TIPO DE EVENTOS ///
        </div>` : ''}

        ${d.slogan ? `
        <div style="font-size:${d.size_slogan}px;text-align:center;color:#c00;font-style:italic;margin:3px 0">
            /// ${esc(d.slogan)} ///
        </div>` : ''}

        ${d.eslogan2 ? `
        <hr class="t-divider">
        <div style="font-family:'${fSlogan}',cursive;font-size:${d.size_slogan}px;text-align:center;color:#444">
            ✦ ${esc(d.eslogan2)} ✦
        </div>` : ''}

        ${d.contador_nombre ? `
        <div style="font-size:${d.size_items-1}px;text-align:center;margin-top:3px">
            Contador: ${esc(d.contador_nombre)}${d.contador_ruc ? ' · RUC: '+esc(d.contador_ruc) : ''}
        </div>` : ''}

        <hr class="t-divider">

        <div class="t-footer-boxes">
            <div class="t-footer-box">
                <div class="f-title">Sistema de Ventas:</div>
                <div class="f-url" style="color:#ff6b35">quevendi.pro</div>
                <div class="f-sub">Usado en todo el Perú</div>
            </div>
            <div class="t-footer-box">
                <div class="f-title">Sistema de Facturación:</div>
                <div class="f-url" style="color:#2563eb">facturalo.pro</div>
                <div class="f-sub">Contadores y Empresas</div>
            </div>
        </div>
    `;
}

// ════════════════════════════════════════════════
// SAVE / LOAD CONFIG
// ════════════════════════════════════════════════
async function saveConfig() {
    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    const d = getFormData();
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch('/api/v1/store/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(d)
        });
        if (resp.ok) {
            localStorage.setItem('store_config', JSON.stringify(d));
            showToast('✅ Configuración guardada', 'ok');
        } else {
            const err = await resp.json().catch(() => ({}));
            showToast(err.detail || 'Error al guardar', 'err');
        }
    } catch (e) {
        localStorage.setItem('store_config', JSON.stringify(d));
        showToast('✅ Guardado localmente (sin conexión)', 'ok2');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Guardar';
}

async function loadConfig() {
    try {
        const token = localStorage.getItem('access_token');
        if (token) {
            const resp = await fetch('/api/v1/store/config', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.configured && data.config) {
                    _applyConfig(data.config);
                    _configLoaded = true;
                    updatePreview();
                    return;
                }
            }
        }
    } catch (e) { console.warn('[Config] Servidor no disponible'); }
    try {
        const saved = JSON.parse(localStorage.getItem('store_config') || '{}');
        if (Object.keys(saved).length > 0) _applyConfig(saved);
    } catch (e) {}
    updatePreview();
}

function _applyConfig(config) {
    const fields = [
        'ruc','razon_social','nombre_comercial','direccion','cod_establecimiento',
        'distrito','provincia','departamento','giro','slogan','telefono','email',
        'serie_boleta','serie_factura','serie_nc_boleta','serie_nc_factura',
        'tipo_igv','print_method','printer_name','eslogan2',
        'contador_ruc','contador_nombre','facturalo_url','facturalo_token','facturalo_secret'
    ];
    fields.forEach(f => {
        const el = document.getElementById(f);
        if (el && config[f] !== undefined && config[f] !== null) el.value = config[f];
    });
    if (config.es_amazonia !== undefined) document.getElementById('es_amazonia').checked = config.es_amazonia;
    if (config.header_style) {
        const r = document.querySelector(`input[name="header_style"][value="${config.header_style}"]`);
        if (r) r.checked = true;
    }
    if (config.font_decorativa) {
        const r = document.querySelector(`input[name="font_decorativa"][value="${config.font_decorativa}"]`);
        if (r) r.checked = true;
    }
    ['font_ruc','font_numero','font_total','font_slogan'].forEach(id => {
        const el = document.getElementById(id);
        if (el && config[id]) el.value = config[id];
    });
    // Tamaños
    ['size_nombre','size_razon','size_ruc','size_numero','size_items','size_total','size_slogan'].forEach(id => {
        const el = document.getElementById(id);
        if (el && config[id]) {
            el.value = config[id];
            updateSizePreview(id.replace('size_',''), config[id]);
        }
    });
    if (config.papel_ancho) {
        const r = document.querySelector(`input[name="papel_ancho"][value="${config.papel_ancho}"]`);
        if (r) r.checked = true;
    }
    if (config.catalogo_activo !== undefined) {
        document.getElementById('catalogo_activo').checked = config.catalogo_activo;
        toggleCatalogoPreview();
    }
    const esl = document.getElementById('eslogan2');
    if (esl?.value) document.getElementById('eslogan2Count').textContent = esl.value.length;
    if (config.telefono) {
        const tel = config.telefono.replace(/\D/g,'');
        const m = document.getElementById('catalogoMockUrl');
        if (m) m.textContent = `www.quevendi.pro/${tel}`;
    }
    if (config.logo) {
        logoDataUrl = config.logo;
        document.getElementById('logoPreview').innerHTML = `<img src="${logoDataUrl}" alt="Logo">`;
    }
}

// ════════════════════════════════════════════════
// PRINT / AGENT
// ════════════════════════════════════════════════
async function loadPrinters() {
    try {
        const resp = await fetch('http://localhost:9638/printers', { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
            const data = await resp.json();
            const list = document.getElementById('printerList');
            if (list && data.printers?.length) {
                list.innerHTML = data.printers.map(p =>
                    `<div onclick="document.getElementById('printer_name').value='${esc(p)}'" style="padding:4px 8px;font-size:0.7rem;cursor:pointer;color:var(--cyan);background:var(--bg3);border-radius:4px;margin-top:3px">→ ${esc(p)}</div>`
                ).join('');
            }
        }
    } catch {}
}

function toggleCatalogoPreview() {
    const activo = document.getElementById('catalogo_activo')?.checked;
    const block  = document.getElementById('catalogoPreviewBlock');
    if (block) block.style.display = activo ? 'block' : 'none';
    const tel = document.getElementById('telefono')?.value?.replace(/\D/g,'') || '';
    const m   = document.getElementById('catalogoMockUrl');
    if (m) m.textContent = `www.quevendi.pro/${tel || 'TU-NUMERO'}`;
}

async function checkAgent() {
    try {
        const resp = await fetch('http://localhost:9638/status', { signal: AbortSignal.timeout(2000) });
        const ok = resp.ok;
        document.getElementById('agentDot').className = 'agent-dot ' + (ok ? 'ok' : 'err');
        document.getElementById('agentLabel').textContent = ok ? 'Impresora OK' : 'Sin impresora';
    } catch {
        document.getElementById('agentDot').className = 'agent-dot err';
        document.getElementById('agentLabel').textContent = 'Sin impresora';
    }
}

async function testPrintAgent() {
    const d = getFormData();
    const tipoIgv = d.tipo_igv || '20';
    const subtotal = 139.00;
    let opGravada = 0, opExonerada = 0, igv = 0;
    if (tipoIgv === '10') { opGravada = +(subtotal/1.18).toFixed(2); igv = +(subtotal-opGravada).toFixed(2); }
    else { opExonerada = subtotal; }
    const ticketData = {
        emisor: {
            ruc: d.ruc || '00000000000', razon_social: d.razon_social || 'MI NEGOCIO',
            nombre_comercial: d.nombre_comercial || d.razon_social || 'MI NEGOCIO',
            direccion: d.direccion || '', telefono: d.telefono || '', email: d.email || '',
            logo: logoDataUrl || null, cod_establecimiento: d.cod_establecimiento || '0000',
            giro: d.giro || '', slogan: d.slogan || '',
            distrito: d.distrito || '', provincia: d.provincia || '', departamento: d.departamento || '',
            es_amazonia: d.es_amazonia, header_style: d.header_style || 1,
            font_decorativa: d.font_decorativa || 'playfair', eslogan2: d.eslogan2 || '',
            font_ruc: d.font_ruc || 'lato', font_numero: d.font_numero || 'bebas',
            font_total: d.font_total || 'archivo', font_slogan: d.font_slogan || 'pacifico',
            font_razon:  d.font_razon  || 'lato',
            size_nombre: d.size_nombre || 15,  size_razon: d.size_razon || 9,
            size_ruc:    d.size_ruc    || 10,  size_numero: d.size_numero || 14,
            size_items:  d.size_items  || 8,   size_total: d.size_total || 12,
            size_slogan: d.size_slogan || 9,
            promo_activo: d.promo_activo || false,
            promo_tipo:   d.promo_tipo   || 'banner',
            promo_banner_producto:      d.promo_banner_producto      || '',
            promo_banner_precio_normal: d.promo_banner_precio_normal || '',
            promo_banner_precio_oferta: d.promo_banner_precio_oferta || '',
            promo_banner_vigencia:      d.promo_banner_vigencia      || '',
            promo_cupon_titulo:         d.promo_cupon_titulo         || '',
            promo_cupon_descuento:      d.promo_cupon_descuento      || '',
            promo_cupon_minimo:         d.promo_cupon_minimo         || '',
            promo_cupon_vence:          d.promo_cupon_vence          || '',
            promo_ref_mensaje:          d.promo_ref_mensaje          || '',
            promo_ref_premio:           d.promo_ref_premio           || '',
            promo_texto_libre:          d.promo_texto_libre          || '',
        },
        logo: logoDataUrl || null,
        cliente: { tipo_doc:'1', num_doc:'05393776', nombre:'DUILIO RESTUCCIA ESLAVA', direccion:'' },
        tipo:'03', serie: d.serie_boleta || 'B001', numero:1,
        numero_formato: `${d.serie_boleta || 'B001'}-00000001`,
        fecha: new Date().toLocaleDateString('es-PE'),
        hora: new Date().toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit', hour12:false }),
        fecha_iso: new Date().toISOString().split('T')[0],
        items: [
            { descripcion:'Cemento Sol 42.5kg', cantidad:2, unidad:'NIU', precio_unitario:32.00 },
            { descripcion:'Fierro 1/2" x 9m',   cantidad:3, unidad:'NIU', precio_unitario:25.00 }
        ],
        total: subtotal, op_exonerada: opExonerada, op_gravada: opGravada, igv: igv,
        payment_method:'efectivo', importe_letras:'CIENTO TREINTA Y NUEVE CON 00/100 SOLES',
        es_amazonia: d.es_amazonia, hash:'abc123hash456ejemplo', verification_code:'QVDI-00000001'
    };
    try {
        const resp = await fetch('http://localhost:9638/print/ticket', {
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify(ticketData)
        });
        const result = await resp.json();
        showToast(result.success ? '🖨️ Ticket de prueba impreso' : result.error, result.success ? 'ok' : 'err');
    } catch (e) {
        showToast('Print Agent no disponible', 'err');
    }
}

// ════════════════════════════════════════════════
// BILLING / CONNECTION
// ════════════════════════════════════════════════
async function testConnection() {
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch('/api/v1/billing/config/verify', {
            method:'POST', headers:{ 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        showToast(data.success ? `✅ Conectado: ${data.empresa}` : data.detail || 'Error de conexión', data.success ? 'ok' : 'err');
    } catch (e) { showToast('Error verificando conexión', 'err'); }
}

// ════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════
function showToast(msg, type='ok2') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ════════════════════════════════════════════════
// DEVICES
// ════════════════════════════════════════════════
const PLAN_LIMITS = { demo:2, basico:2, crece:3, pro:99 };

async function loadDevices() {
    try {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const resp = await fetch('/api/v1/billing/offline/devices', { headers:{ 'Authorization': `Bearer ${token}` } });
        if (!resp.ok) { document.getElementById('deviceList').innerHTML = '<div style="font-size:0.72rem;color:var(--text3);padding:8px">No hay dispositivos registrados</div>'; return; }
        const devices = await resp.json();
        const currentDeviceId = await _getCurrentDeviceId();
        document.getElementById('deviceCount').textContent = devices.length;
        if (devices.length === 0) { document.getElementById('deviceList').innerHTML = '<div style="font-size:0.72rem;color:var(--text3);padding:8px">Ningún dispositivo registrado.</div>'; return; }
        let html = '';
        for (const dev of devices) {
            const isThis = dev.device_id === currentDeviceId;
            const iconClass = dev.device_name.toLowerCase().includes('cel') || dev.device_name.toLowerCase().includes('phone') ? 'device-icon-mobile' : 'device-icon-pc';
            const iconName  = iconClass === 'device-icon-mobile' ? 'fa-mobile-screen' : 'fa-desktop';
            html += `<div class="device-card ${isThis?'this-device':''}">
                <div class="device-header">
                    <div style="display:flex;align-items:center">
                        <div class="device-icon ${iconClass}"><i class="fas ${iconName}"></i></div>
                        <div class="device-info"><div class="device-name">${_esc(dev.device_name||'Dispositivo')}</div><div class="device-id">${dev.device_id}</div></div>
                    </div>
                    ${isThis ? '<span class="device-this-badge"><i class="fas fa-check-circle"></i> Este dispositivo</span>' : ''}
                </div>
                <div class="device-serie"><i class="fas fa-barcode"></i> Serie: ${dev.serie}</div>
                <div class="device-stats">
                    <div class="device-stat"><strong>${dev.ultimo_numero}</strong>Último N°</div>
                    <div class="device-stat"><strong>${dev.bloques_activos>0?'Activo':'Sin bloque'}</strong>Estado</div>
                    <div class="device-stat"><strong>${_timeAgo(dev.registered_at)}</strong>Registro</div>
                </div>
                <div class="device-actions">
                    ${!isThis ? `<button onclick="revokeDevice('${dev.device_id}','${_esc(dev.device_name)}')" class="device-btn device-btn-danger"><i class="fas fa-ban"></i> Desactivar</button>` : ''}
                    <button onclick="refillBlock('${dev.serie}','${dev.device_id}')" class="device-btn"><i class="fas fa-plus"></i> Reservar números</button>
                    <button onclick="viewBlockStatus('${dev.serie}')" class="device-btn"><i class="fas fa-info-circle"></i> Ver bloques</button>
                </div>
            </div>`;
        }
        document.getElementById('deviceList').innerHTML = html;
        const plan  = localStorage.getItem('store_plan') || 'basico';
        const limit = PLAN_LIMITS[plan] || 2;
        document.getElementById('deviceLimit').textContent = limit;
        document.getElementById('planName').textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
        if (devices.length >= limit) document.getElementById('registerBox').style.display = 'none';
    } catch (e) { document.getElementById('deviceList').innerHTML = '<div style="font-size:0.72rem;color:var(--text3);padding:8px">No se pudieron cargar los dispositivos</div>'; }
}

async function _getCurrentDeviceId() {
    let id = localStorage.getItem('device_id');
    if (!id) { id = 'DEV-' + crypto.randomUUID().split('-')[0].toUpperCase(); localStorage.setItem('device_id', id); }
    return id;
}

async function registerThisDevice() {
    const deviceId = await _getCurrentDeviceId();
    const name = prompt('Nombre de este dispositivo (ej: "PC Caja", "Celular Juan"):');
    if (!name) return;
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch('/api/v1/billing/offline/device/register', {
            method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ device_id: deviceId, device_name: name, tipo:'03' })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`✅ Registrado: serie ${data.serie}`, 'ok');
            const blockResp = await fetch('/api/v1/billing/offline/reserve-block', {
                method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ serie: data.serie, device_id: deviceId, cantidad: 50 })
            });
            if (blockResp.ok) { const block = await blockResp.json(); showToast(`📦 ${block.cantidad} números reservados`, 'ok'); }
            loadDevices();
        } else { showToast(data.detail || 'Error al registrar', 'err'); }
    } catch (e) { showToast('Error de conexión', 'err'); }
}

async function revokeDevice(deviceId, deviceName) {
    if (!confirm(`¿Desactivar "${deviceName}"?`)) return;
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch(`/api/v1/billing/offline/device/${deviceId}/revoke`, { method:'POST', headers:{ 'Authorization': `Bearer ${token}` } });
        if (resp.ok) { showToast(`🚫 "${deviceName}" desactivado`, 'ok'); loadDevices(); }
        else { const data = await resp.json().catch(()=>({})); showToast(data.detail || 'Error', 'err'); }
    } catch (e) { showToast('Error de conexión', 'err'); }
}

async function refillBlock(serie, deviceId) {
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch('/api/v1/billing/offline/reserve-block', {
            method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ serie, device_id: deviceId, cantidad: 50 })
        });
        if (resp.ok) { const data = await resp.json(); showToast(`📦 +${data.cantidad} números`, 'ok'); loadDevices(); }
        else { const err = await resp.json().catch(()=>({})); showToast(err.detail || 'Error', 'err'); }
    } catch (e) { showToast('Error de conexión', 'err'); }
}

async function viewBlockStatus(serie) {
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch(`/api/v1/billing/offline/block-status/${serie}`, { headers:{ 'Authorization': `Bearer ${token}` } });
        if (!resp.ok) { showToast('Error cargando bloques', 'err'); return; }
        const data = await resp.json();
        let html = `<div style="font-size:0.72rem;font-weight:700;margin-bottom:8px">Bloques de ${serie}</div>`;
        if (!data.bloques?.length) { html += '<div style="font-size:0.7rem;color:var(--text3)">Sin bloques reservados</div>'; }
        else {
            for (const b of data.bloques) {
                const pct = b.restantes > 0 ? Math.round((1 - b.restantes / (b.hasta - b.desde + 1)) * 100) : 100;
                const color = b.restantes < 5 ? 'var(--red)' : b.restantes < 15 ? 'var(--orange)' : 'var(--green)';
                html += `<div style="padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px;border:1px solid var(--border)">
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem">
                        <span>${String(b.desde).padStart(8,'0')} — ${String(b.hasta).padStart(8,'0')}</span>
                        <span style="color:${color};font-weight:700">${b.restantes} restantes</span>
                    </div>
                    <div style="height:4px;background:var(--bg3);border-radius:2px;margin-top:4px;overflow:hidden">
                        <div style="height:100%;width:${pct}%;background:${color};border-radius:2px"></div>
                    </div>
                </div>`;
            }
        }
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px';
        modal.innerHTML = `<div style="background:var(--bg2);border-radius:14px;padding:20px;max-width:380px;width:100%;max-height:80vh;overflow-y:auto">${html}<button onclick="this.closest('div[style*=fixed]').remove()" style="width:100%;margin-top:10px;padding:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text2);font-size:0.75rem;cursor:pointer;font-family:var(--font)">Cerrar</button></div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
    } catch (e) { showToast('Error de conexión', 'err'); }
}

async function revokeAllDevices() {
    if (!confirm('⚠️ ¿DESACTIVAR TODOS los dispositivos excepto este?\n\nTodos los vendedores perderán acceso.')) return;
    showToast('🔄 Desactivando dispositivos...', 'ok2');
    try {
        const token = localStorage.getItem('access_token');
        const currentDeviceId = await _getCurrentDeviceId();
        const resp = await fetch('/api/v1/billing/offline/devices', { headers:{ 'Authorization': `Bearer ${token}` } });
        const devices = await resp.json();
        let revoked = 0;
        for (const dev of devices) {
            if (dev.device_id === currentDeviceId) continue;
            try { await fetch(`/api/v1/billing/offline/device/${dev.device_id}/revoke`, { method:'POST', headers:{ 'Authorization': `Bearer ${token}` } }); revoked++; } catch {}
        }
        showToast(`🚫 ${revoked} dispositivo(s) desactivado(s)`, 'ok');
        loadDevices();
    } catch (e) { showToast('Error', 'err'); }
}

async function generateEmergencyCode() {
    const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const el = document.getElementById('emergencyResult');
    el.style.display = 'block';
    el.innerHTML = `<div style="background:var(--bg);border:1.5px solid var(--gold);border-radius:8px;padding:12px;text-align:center"><div style="font-size:0.6rem;color:var(--text3);margin-bottom:4px">Código de emergencia (30 min)</div><div style="font-family:monospace;font-size:1.4rem;font-weight:800;color:var(--gold);letter-spacing:3px">${code}</div><div style="font-size:0.6rem;color:var(--text3);margin-top:4px">Usa este código en quevendi.pro/emergency</div></div>`;
    showToast('Código generado. Válido por 30 minutos.', 'ok');
}

function showPlanUpgrade() { showToast('Contacta a tu vendedor para mejorar de plan', 'ok2'); }

async function loadUsers() {
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch('/api/v1/users/store-users', { headers:{ 'Authorization': `Bearer ${token}` } });
        if (!resp.ok) { document.getElementById('userList').innerHTML = '<div style="color:var(--text3);font-size:0.72rem">No se pudieron cargar usuarios</div>'; return; }
        const users = await resp.json();
        const userList = Array.isArray(users) ? users : (users.users || []);
        if (!userList.length) { document.getElementById('userList').innerHTML = '<div style="color:var(--text3);font-size:0.72rem">Sin usuarios registrados</div>'; return; }
        const roles = { owner:'👑 Dueño', admin:'🔧 Admin', seller:'🛒 Vendedor', cashier:'💰 Cajero' };
        let html = '';
        for (const u of userList) {
            const active = u.is_active !== false;
            html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;${!active?'opacity:0.5':''}">
                <div><div style="font-size:0.78rem;font-weight:600">${_esc(u.full_name||u.username)}</div><div style="font-size:0.6rem;color:var(--text3)">${roles[u.role]||u.role} · DNI: ${u.dni||'-'}</div></div>
                ${u.role!=='owner'?`<button onclick="toggleUser(${u.id},${active})" class="device-btn ${active?'device-btn-danger':''}" style="font-size:0.6rem">${active?'<i class="fas fa-ban"></i> Desactivar':'<i class="fas fa-check"></i> Activar'}</button>`:'<span style="font-size:0.6rem;color:var(--green)"><i class="fas fa-shield-halved"></i></span>'}
            </div>`;
        }
        document.getElementById('userList').innerHTML = html;
    } catch (e) { document.getElementById('userList').innerHTML = '<div style="color:var(--text3);font-size:0.72rem">Error cargando usuarios</div>'; }
}

async function toggleUser(userId, currentlyActive) {
    if (!confirm(`¿${currentlyActive?'Desactivar':'Activar'} este usuario?`)) return;
    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch(`/api/v1/users/${userId}/${currentlyActive?'deactivate':'activate'}`, { method:'POST', headers:{ 'Authorization': `Bearer ${token}` } });
        if (resp.ok) { showToast(`Usuario ${currentlyActive?'desactivado':'activado'}`, 'ok'); loadUsers(); loadDevices(); }
        else { const data = await resp.json().catch(()=>({})); showToast(data.detail||'Error','err'); }
    } catch (e) { showToast('Error de conexión','err'); }
}

// ════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════
function esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function _esc(t) { return esc(t); }
function _timeAgo(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr), now = new Date(), diff = Math.floor((now-d)/1000);
    if (diff<60) return 'Ahora'; if (diff<3600) return `${Math.floor(diff/60)}min`;
    if (diff<86400) return `${Math.floor(diff/3600)}h`; if (diff<604800) return `${Math.floor(diff/86400)}d`;
    return d.toLocaleDateString('es-PE',{day:'2-digit',month:'short'});
}

// ════════════════════════════════════════════════
// BLOQUES PROMOCIONALES
// ════════════════════════════════════════════════
function togglePromoPreview() {
    const activo = document.getElementById('promo_activo')?.checked;
    document.getElementById('promoConfig').style.display = activo ? 'block' : 'none';
}

// Listeners para resaltar la card de tipo promo seleccionada
document.addEventListener('change', e => {
    if (e.target.name === 'promo_tipo') {
        const tipo = e.target.value;
        ['banner','cupon','referido','texto'].forEach(t => {
            document.getElementById(`promo-fields-${t}`).style.display = t === tipo ? 'block' : 'none';
            const lbl = document.getElementById(`lbl-promo-${t}`);
            if (lbl) lbl.style.borderColor = t === tipo ? 'var(--orange)' : 'var(--border)';
        });
    }
});

function buildPromoHtml(d) {
    const t = d.promo_tipo || 'banner';
    const sz = d.size_items;
    if (t === 'banner') {
        const prod   = d.promo_banner_producto  || 'PRODUCTO EN OFERTA';
        const pNorm  = d.promo_banner_precio_normal ? `antes S/ ${d.promo_banner_precio_normal}` : '';
        const pOfer  = d.promo_banner_precio_oferta || '??.??';
        const vig    = d.promo_banner_vigencia || '';
        return `
        <div style="border:2px solid #222;border-radius:3px;margin:4px 0;padding:5px;text-align:center;background:#f8f8f8">
            <div style="font-size:${sz-1}px;font-weight:bold;text-transform:uppercase">⭐ OFERTA DEL DÍA ⭐</div>
            <div style="font-size:${sz+1}px;font-weight:bold;margin:2px 0">${esc(prod)}</div>
            ${pNorm ? `<div style="font-size:${sz-1}px;color:#999;text-decoration:line-through">${esc(pNorm)}</div>` : ''}
            <div style="font-size:${sz+3}px;font-weight:900;color:#c00">S/ ${esc(pOfer)}</div>
            ${vig ? `<div style="font-size:${sz-1}px;color:#555">${esc(vig)}</div>` : ''}
        </div>`;
    }
    if (t === 'cupon') {
        const titulo   = d.promo_cupon_titulo    || '¡CUPÓN DE DESCUENTO!';
        const dcto     = d.promo_cupon_descuento || 'S/ 2.00 OFF';
        const minimo   = d.promo_cupon_minimo    ? `en compras mayores a ${d.promo_cupon_minimo}` : '';
        const vence    = d.promo_cupon_vence     || '';
        return `
        <div style="border:1.5px dashed #555;margin:4px 0;padding:5px;text-align:center">
            <div style="font-size:${sz-1}px;color:#888">✂ - - - RECORTA Y PRESENTA - - - ✂</div>
            <div style="font-size:${sz+1}px;font-weight:bold;margin:2px 0">${esc(titulo)}</div>
            <div style="font-size:${sz+3}px;font-weight:900;color:#c00;border:2px solid #c00;display:inline-block;padding:1px 6px;margin:2px 0">${esc(dcto)}</div>
            ${minimo ? `<div style="font-size:${sz-1}px">${esc(minimo)}</div>` : ''}
            ${vence ? `<div style="font-size:${sz-1}px;color:#777">Válido hasta: ${esc(vence)}</div>` : ''}
        </div>`;
    }
    if (t === 'referido') {
        const msg    = d.promo_ref_mensaje || '¡Trae un amigo y ambos ganan!';
        const premio = d.promo_ref_premio  || '';
        return `
        <div style="border:1.5px solid #2563eb;border-radius:3px;margin:4px 0;padding:5px;text-align:center;background:#f0f5ff">
            <div style="font-size:${sz+1}px;font-weight:bold;color:#1a3a8f">🤝 ${esc(msg)}</div>
            ${premio ? `<div style="font-size:${sz}px;color:#1a3a8f;margin-top:2px">${esc(premio)}</div>` : ''}
            <div style="font-size:${sz-1}px;color:#555;margin-top:2px">Pregunta en caja los detalles</div>
        </div>`;
    }
    if (t === 'texto') {
        const texto = d.promo_texto_libre || '';
        if (!texto) return '';
        return `
        <div style="border-top:1px dashed #bbb;border-bottom:1px dashed #bbb;margin:4px 0;padding:4px;text-align:center">
            <div style="font-size:${sz}px;line-height:1.5">${esc(texto)}</div>
        </div>`;
    }
    return '';
}

// ════════════════════════════════════════════════
// INIT — esperar que las fuentes carguen antes del primer preview
// ════════════════════════════════════════════════
document.fonts.ready.then(() => {
    loadConfig();
    setTimeout(checkAgent, 800);
    setInterval(checkAgent, 30000);
});