/**
 * QueVendi — Ticket Builder
 * =========================
 * Genera HTML del ticket de venta para preview en dashboard.
 * Fuente de verdad: store_config en localStorage (guardado en /config/negocio)
 *
 * Usado en:
 *   dashboard_principal.js → _loadPdfPreview() → showComprobanteSuccessModal()
 *
 * Forma de pago SUNAT (solo 2 valores):
 *   Contado → pago inmediato (efectivo, yape, plin, tarjeta)
 *   Crédito → fiado / pago diferido
 *
 * Método de pago (informativo, no va a SUNAT):
 *   efectivo | yape | plin | tarjeta | fiado
 */

/**
 * Convierte un monto numérico a texto en español.
 * Rango: 0 a 9,999.99 → "CIEN CON 50/100 SOLES"
 */
function numeroALetras(monto) {
    const unidades = ['','UN','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE'];
    const especiales = ['DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE'];
    const decenas = ['','DIEZ','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
    const centenas = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];

    function convertirGrupo(n) {
        if (n === 0) return '';
        if (n === 100) return 'CIEN';
        let texto = '';
        const c = Math.floor(n / 100);
        const r = n % 100;
        if (c > 0) texto = centenas[c] + ' ';
        if (r === 0) return texto.trim();
        if (r < 10) return (texto + unidades[r]).trim();
        if (r < 16) return (texto + especiales[r - 10]).trim();
        if (r < 20) return (texto + 'DIECI' + unidades[r - 10]).trim();
        const d = Math.floor(r / 10);
        const u = r % 10;
        if (d === 2 && u > 0) return (texto + 'VEINTI' + unidades[u]).trim();
        if (u === 0) return (texto + decenas[d]).trim();
        return (texto + decenas[d] + ' Y ' + unidades[u]).trim();
    }

    const entero = Math.floor(Math.abs(monto));
    const decimales = Math.round((Math.abs(monto) - entero) * 100);

    if (entero === 0) return `CERO CON ${String(decimales).padStart(2,'0')}/100 SOLES`;

    let texto = '';
    const miles = Math.floor(entero / 1000);
    const resto = entero % 1000;

    if (miles === 1) texto = 'MIL ';
    else if (miles > 1) texto = convertirGrupo(miles) + ' MIL ';

    if (resto > 0) texto += convertirGrupo(resto);

    return `${texto.trim()} CON ${String(decimales).padStart(2,'0')}/100 SOLES`;
}

function buildTicketHtmlDesdeComprobante(comp) {

    const sc = JSON.parse(localStorage.getItem('store_config') || '{}');
    const em = comp.emisor || {};

    const fontMap = {
        playfair:'Playfair Display', oswald:'Oswald', lato:'Lato',
        ubuntu:'Ubuntu', raleway:'Raleway', bebas:'Bebas Neue',
        pacifico:'Pacifico', cinzel:'Cinzel', righteous:'Righteous',
        archivo:'Archivo Black', dm_sans:'DM Sans'
    };

    const cfg = {
        nombre_comercial: sc.nombre_comercial || em.nombre_comercial || comp.emisor_razon_social || 'TIENDA',
        razon_social:     sc.razon_social     || em.razon_social     || comp.emisor_razon_social || '',
        ruc:              sc.ruc              || em.ruc              || comp.emisor_ruc          || '',
        direccion:        sc.direccion        || em.direccion        || comp.emisor_direccion    || '',
        telefono:         sc.telefono         || em.telefono         || comp.emisor_telefono     || '',
        giro:             sc.giro             || '',
        distrito:         sc.distrito         || '',
        provincia:        sc.provincia        || '',
        departamento:     sc.departamento     || '',
        slogan:           sc.slogan           || '',
        eslogan2:         sc.eslogan2         || '',
        es_amazonia:      sc.es_amazonia      !== false,
        catalogo_activo:  sc.catalogo_activo  === true,
        logo_url:         sc.logo             || sc.logo_url         || null,
        header_style:     parseInt(sc.header_style  || '1'),
        font_decorativa:  sc.font_decorativa  || 'bebas',
        font_razon:       sc.font_razon       || 'dm_sans',
        font_numero:      sc.font_numero      || 'bebas',
        font_total:       sc.font_total       || 'archivo',
        font_slogan:      sc.font_slogan      || 'pacifico',
        size_nombre:      parseInt(sc.size_nombre  || '15'),
        size_razon:       parseInt(sc.size_razon   || '9'),
        size_ruc:         parseInt(sc.size_ruc     || '10'),
        size_numero:      parseInt(sc.size_numero  || '14'),
        size_items:       parseInt(sc.size_items   || '8'),
        size_total:       parseInt(sc.size_total   || '12'),
        size_slogan:      parseInt(sc.size_slogan  || '9'),
    };

    const fNombre = fontMap[cfg.font_decorativa] || 'Bebas Neue';
    const fRazon  = fontMap[cfg.font_razon]       || 'DM Sans';
    const fNumero = fontMap[cfg.font_numero]      || 'Bebas Neue';
    const fTotal  = fontMap[cfg.font_total]       || 'Archivo Black';
    const fSlogan = fontMap[cfg.font_slogan]      || 'Pacifico';

    // ── Datos del comprobante ─────────────────────────────────────────────────
    const tipo   = comp.tipo === '01' ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA';
    const numFmt = comp.numero_formato || `${comp.serie}-${String(comp.numero).padStart(8,'0')}`;
    const total    = parseFloat(comp.total    || 0);
    const igv      = parseFloat(comp.igv      || 0);
    const subtotal = parseFloat(comp.subtotal || 0);
    const opGravada   = igv > 0 ? subtotal : 0;
    const opExonerada = igv === 0 ? total  : 0;

    const fecha = comp.fecha_emision
        ? new Date(comp.fecha_emision).toLocaleDateString('es-PE')
        : new Date().toLocaleDateString('es-PE');
    const hora = comp.fecha_emision
        ? new Date(comp.fecha_emision).toLocaleTimeString('es-PE', {hour:'2-digit', minute:'2-digit'})
        : new Date().toLocaleTimeString('es-PE', {hour:'2-digit', minute:'2-digit'});

    // ── Forma de pago SUNAT (Contado / Crédito) ───────────────────────────────
    const esCredito = comp.is_credit || comp.payment_method === 'fiado';
    const formaPagoSunat = esCredito ? 'Crédito' : 'Contado';

    // ── Método de pago (informativo) ──────────────────────────────────────────
    const metodoPagoMap = {
        efectivo:'Efectivo', yape:'Yape', plin:'Plin',
        tarjeta:'Tarjeta', fiado:'Fiado / Crédito', credito:'Crédito',
    };
    const metodoPago = metodoPagoMap[comp.payment_method] || comp.payment_method || 'Efectivo';

    // ── Cliente ───────────────────────────────────────────────────────────────
    const cliente = comp.cliente || {};
    const tipoDocMap = {'0':'','1':'DNI','4':'CE','6':'RUC','7':'Pasaporte'};
    const tipoDocLabel = tipoDocMap[String(cliente.tipo_doc)] || '';
    const tieneCliente = (cliente.nombre && cliente.nombre !== 'CLIENTE VARIOS')
        || (cliente.num_doc && cliente.num_doc !== '00000000');

    // ── Items ─────────────────────────────────────────────────────────────────
    const items = (comp.items || []).map(i => ({
        descripcion: i.descripcion || i.product_name || '',
        cantidad:    parseFloat(i.cantidad    || i.quantity      || 1),
        precio:      parseFloat(i.precio_unitario || i.unit_price || 0),
        subtotal:    parseFloat(i.valor_venta || i.subtotal      || 0),
        unidad:      i.unidad || i.unit || 'NIU',
    }));

    const ubicacion = [cfg.distrito, cfg.provincia, cfg.departamento].filter(Boolean).join(' - ');

    // ── Código interno ────────────────────────────────────────────────────────
    const codigoInterno = comp.sunat_description && comp.sunat_description.startsWith('QVDI')
        ? comp.sunat_description : null;

    // ── Logo helpers ──────────────────────────────────────────────────────────
    const logoCenter = cfg.logo_url
        ? `<div style="text-align:center;margin-bottom:4px"><img src="${cfg.logo_url}" style="max-height:60px;max-width:160px;object-fit:contain;border-radius:4px"></div>`
        : '';
    const logoLeft = cfg.logo_url
        ? `<img src="${cfg.logo_url}" style="max-height:60px;max-width:80px;object-fit:contain;border:1px solid #eee;border-radius:4px;flex-shrink:0">`
        : '';

    // ── HEADER según estilo ───────────────────────────────────────────────────
    let headerHtml = '';
    if (cfg.header_style === 2) {
        headerHtml = `
            ${logoCenter}
            ${cfg.giro ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${cfg.size_ruc}px;text-align:center;text-transform:uppercase">${cfg.giro}</div>` : ''}
            <div style="font-family:'${fNombre}',sans-serif;font-size:${cfg.size_nombre}px;font-weight:900;text-align:center;line-height:1.2;text-transform:uppercase">${cfg.nombre_comercial}</div>
            ${cfg.razon_social && cfg.razon_social !== cfg.nombre_comercial ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${cfg.size_razon}px;text-align:center;color:#555;font-style:italic">${cfg.razon_social}</div>` : ''}
            <div style="font-size:${cfg.size_ruc}px;text-align:center">${cfg.direccion}</div>
            ${ubicacion ? `<div style="font-size:${cfg.size_ruc}px;text-align:center">${ubicacion}</div>` : ''}
            ${cfg.telefono ? `<div style="font-size:${cfg.size_ruc}px;text-align:center">CEL: ${cfg.telefono}</div>` : ''}`;
    } else if (cfg.header_style === 3) {
        headerHtml = `
            <div style="display:flex;gap:6px;align-items:flex-start">
                ${logoLeft}
                <div style="flex:1">
                    <div style="font-family:'${fNombre}',sans-serif;font-size:${cfg.size_nombre-2}px;font-weight:900;line-height:1.2;text-transform:uppercase">${cfg.nombre_comercial}</div>
                    ${cfg.razon_social && cfg.razon_social !== cfg.nombre_comercial ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${cfg.size_razon}px;color:#555;font-style:italic">${cfg.razon_social}</div>` : ''}
                    ${cfg.giro ? `<div style="font-size:${cfg.size_ruc}px;text-transform:uppercase">${cfg.giro}</div>` : ''}
                    <div style="font-size:${cfg.size_ruc}px">${cfg.direccion}</div>
                    ${ubicacion ? `<div style="font-size:${cfg.size_ruc}px">${ubicacion}</div>` : ''}
                    ${cfg.telefono ? `<div style="font-size:${cfg.size_ruc}px">CEL: ${cfg.telefono}</div>` : ''}
                </div>
            </div>`;
    } else {
        // Estilo 1 — default, centrado
        headerHtml = `
            ${logoCenter}
            <div style="font-family:'${fNombre}',sans-serif;font-size:${cfg.size_nombre}px;font-weight:900;text-align:center;line-height:1.2;text-transform:uppercase">${cfg.nombre_comercial}</div>
            ${cfg.razon_social && cfg.razon_social !== cfg.nombre_comercial ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${cfg.size_razon}px;text-align:center;color:#555;font-style:italic">${cfg.razon_social}</div>` : ''}
            ${cfg.giro ? `<div style="font-family:'${fRazon}',sans-serif;font-size:${cfg.size_ruc}px;text-align:center;text-transform:uppercase">${cfg.giro}</div>` : ''}
            <div style="font-size:${cfg.size_ruc}px;text-align:center">${cfg.direccion}</div>
            ${ubicacion ? `<div style="font-size:${cfg.size_ruc}px;text-align:center">${ubicacion}</div>` : ''}
            ${cfg.telefono ? `<div style="font-size:${cfg.size_ruc}px;text-align:center">CEL: ${cfg.telefono}</div>` : ''}`;
    }

    // ── Totales parciales ─────────────────────────────────────────────────────
    let totalesHtml = '';
    if (opGravada   > 0) totalesHtml += `<div style="display:flex;justify-content:space-between;font-size:${cfg.size_items}px"><span>Op. Gravada S/</span><span>${opGravada.toFixed(2)}</span></div>`;
    if (opExonerada > 0) totalesHtml += `<div style="display:flex;justify-content:space-between;font-size:${cfg.size_items}px"><span>Op. Exonerada S/</span><span>${opExonerada.toFixed(2)}</span></div>`;
    if (igv         > 0) totalesHtml += `<div style="display:flex;justify-content:space-between;font-size:${cfg.size_items}px"><span>IGV 18% S/</span><span>${igv.toFixed(2)}</span></div>`;

    // ── HTML COMPLETO ─────────────────────────────────────────────────────────
    return '<div style="width:300px;background:white;padding:12px 10px;font-family:\'DM Sans\',sans-serif;font-size:8pt;color:#111">'

        // BOX 0: CABECERA
        + '<div style="border:1.5px solid #bbb;border-radius:4px;padding:6px 8px;margin:0 0 4px">'
        + headerHtml
        + '</div>'

        // BOX 1: RUC + TIPO + NÚMERO
        + '<div style="border:1.5px solid #999;border-radius:4px;padding:5px 6px;margin:4px 0;text-align:center">'
        + `<div style="font-size:${cfg.size_ruc+2}px;font-weight:700">RUC: ${cfg.ruc}</div>`
        + '<div style="border-top:1px dashed #bbb;margin:3px 0"></div>'
        + `<div style="font-size:${cfg.size_items+1}px;font-weight:700;margin:2px 0">${tipo}</div>`
        + `<div style="background:#111;color:white;font-family:'${fNumero}',sans-serif;font-size:${cfg.size_numero}px;font-weight:900;padding:3px;border-radius:3px;margin:3px 2px">${numFmt}</div>`
        + '</div>'

        // FECHA / HORA / FORMA DE PAGO SUNAT
        + `<div style="display:flex;justify-content:space-between;font-size:${cfg.size_items}px;margin:3px 0">`
        + `<span>Fecha E: ${fecha}</span><span>Hora: ${hora}</span><span>F. Pago: ${formaPagoSunat}</span>`
        + '</div>'

        // BOX 2: CLIENTE
        + (tieneCliente
            ? `<div style="border:1px solid #ddd;border-radius:4px;padding:4px 6px;margin:4px 0;font-size:${cfg.size_items}px">`
            + (tipoDocLabel && cliente.num_doc && cliente.num_doc !== '00000000' ? `<div>${tipoDocLabel}: ${cliente.num_doc}</div>` : '')
            + (cliente.nombre && cliente.nombre !== 'CLIENTE VARIOS' ? `<div>Cliente: ${cliente.nombre}</div>` : '')
            + (cliente.direccion ? `<div>Dirección: ${cliente.direccion}</div>` : '')
            + '</div>'
            : '')

        // BOX 3: ITEMS
        + `<div style="border:1px solid #ccc;border-radius:4px;padding:4px 6px;margin:4px 0">`
        + `<div style="display:flex;justify-content:space-between;font-weight:700;font-size:${cfg.size_items}px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-bottom:3px">`
        + `<span style="flex:3">Producto</span><span style="width:22px;text-align:center">Cnt</span><span style="width:32px;text-align:right">P.Unit</span><span style="width:38px;text-align:right">Total</span>`
        + '</div>'
        + items.map(i =>
            `<div style="display:flex;justify-content:space-between;font-size:${cfg.size_items}px;margin-bottom:2px">`
            + `<span style="flex:3">${i.descripcion}</span>`
            + `<span style="width:22px;text-align:center">${i.cantidad}</span>`
            + `<span style="width:32px;text-align:right">${i.precio.toFixed(2)}</span>`
            + `<span style="width:38px;text-align:right;font-weight:700">${i.subtotal.toFixed(2)}</span>`
            + '</div>'
        ).join('')
        + `<div style="font-size:${cfg.size_items}px;color:#888;margin-top:3px">Items: ${items.length}</div>`
        + totalesHtml
        + '</div>'

        // BOX 4: TOTAL
        + '<div style="border:2px solid #222;border-radius:4px;padding:5px 6px;margin:4px 0">'
        + `<div style="display:flex;justify-content:space-between;font-family:'${fTotal}',sans-serif;font-size:${cfg.size_total}px;font-weight:900">`
        + `<span>TOTAL S/</span><span>${total.toFixed(2)}</span>`
        + '</div>'
        + `<div style="font-size:${cfg.size_items - 1}px;font-style:italic;text-align:center;color:#444;margin-top:2px">Son: ${numeroALetras(total)}</div>`
        + '</div>'

        // MÉTODO DE PAGO informativo
        + `<div style="font-size:${cfg.size_items}px;margin:3px 0">Método de pago: <strong>${metodoPago}</strong></div>`

        // BOX 5: CATÁLOGO VIRTUAL
        + (cfg.catalogo_activo && cfg.telefono
            ? `<div style="border:1.5px solid #4a90d9;border-radius:4px;padding:4px 6px;margin:4px 0;text-align:center">`
            + `<div style="font-size:${cfg.size_items-1}px;color:#444">&gt;&gt;&gt; Carta/Catálogo Virtual &lt;&lt;&lt;</div>`
            + `<div style="color:#4a90d9;font-weight:700;font-size:${cfg.size_items+1}px">www.quevendi.pro/${cfg.telefono}</div>`
            + `<div style="font-size:${cfg.size_items-1}px;color:#666">Pedidos para RECOGER o DELIVERY</div>`
            + '</div>'
            : '')

        // BOX 6: QR + VERIFICACIÓN + CÓDIGO INTERNO
        + '<div style="border:1px solid #ccc;border-radius:4px;padding:5px 6px;margin:4px 0">'
        + '<div style="display:flex;gap:6px;align-items:flex-start">'
        + `<div id="ticket-qr-${comp.id || 0}" class="ticket-qr-container" data-qr-url="${comp.sunat_hash ? 'https://facturalo.pro/verificar/' + comp.sunat_hash : 'https://www.sunat.gob.pe/ol-ti-itconsultaunificada/'}" style="width:100px;height:100px;flex-shrink:0;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;background:#f5f5f5;border-radius:2px;overflow:hidden"></div>`
        + `<div style="flex:1;font-size:${cfg.size_items}px;line-height:1.5">`
        + `Representación impresa de la<br><strong>${tipo}</strong><br>`
        + 'Verifique en:<br>www.facturalo.pro/verificar<br>www.sunat.gob.pe'
        + (codigoInterno ? `<br><span style="color:#888;font-size:${cfg.size_items-1}px">Interno: ${codigoInterno}</span>` : (comp.id === 0 ? `<br><span style="color:#888;font-size:${cfg.size_items-1}px">Código: PENDIENTE</span>` : ''))
        + `<br><span style="color:#888;font-size:${cfg.size_items-1}px">Hash SUNAT: ${comp.sunat_hash || '[se genera al emitir]'}</span>`
        + '</div></div></div>'

        // AMAZONIA
        + (cfg.es_amazonia
            ? `<div style="font-size:${cfg.size_items-1}px;text-align:center;font-weight:700;margin:3px 0;line-height:1.5">BIENES TRANSFERIDOS EN LA AMAZONIA<br>PARA SER CONSUMIDOS EN LA MISMA</div>`
            : '')

        // SLOGAN
        + (cfg.slogan
            ? `<div style="font-size:${cfg.size_slogan}px;text-align:center;color:#c00;font-weight:700;margin:3px 0">/// ${cfg.slogan} ///</div>`
            : '')

        // ESLOGAN DECORATIVO
        + (cfg.eslogan2
            ? `<div style="font-family:'${fSlogan}',cursive;font-size:${cfg.size_slogan}px;text-align:center;color:#555;margin:3px 0">✦ ${cfg.eslogan2} ✦</div>`
            : '')

        // BOX 7: USUARIO / CAJA
        + `<div style="border:1px solid #ddd;border-radius:4px;padding:4px 6px;margin:4px 0;font-size:${cfg.size_items-1}px;color:#666">`
        + `<div style="display:flex;justify-content:space-between"><span>Usuario: ${comp.usuario_nombre || comp.user_name || 'vendedor'}</span><span>${fecha} ${hora}</span></div>`
        + `<div style="display:flex;justify-content:space-between;margin-top:2px"><span>CAJA01</span>${cfg.telefono ? `<span>WhatsApp: ${cfg.telefono}</span>` : ''}</div>`
        + '</div>'

        // BOX 8: FOOTER
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px">'
        + '<div style="border:1px solid #ddd;border-radius:3px;padding:5px 4px;text-align:center;font-size:0.75em"><div style="font-weight:700;color:#333">Sistema de Ventas:</div><div style="color:#ff6b35;font-weight:700">quevendi.pro</div><div style="color:#777;font-size:0.9em">Usado en todo el Perú</div></div>'
        + '<div style="border:1px solid #ddd;border-radius:3px;padding:5px 4px;text-align:center;font-size:0.75em"><div style="font-weight:700;color:#333">Facturación:</div><div style="color:#2563eb;font-weight:700">facturalo.pro</div><div style="color:#777;font-size:0.9em">Contadores y Empresas</div></div>'
        + '</div>'

        + '</div>';
}

/**
 * Genera los QR reales en los contenedores del ticket.
 * Llamar DESPUÉS de insertar el HTML del ticket en el DOM.
 */
function renderTicketQRCodes() {
    if (typeof QRCode === 'undefined') return;
    document.querySelectorAll('.ticket-qr-container').forEach(container => {
        const url = container.dataset.qrUrl;
        if (!url || container.dataset.qrRendered) return;
        container.innerHTML = '';
        new QRCode(container, {
            text: url,
            width: 100,
            height: 100,
            correctLevel: QRCode.CorrectLevel.M
        });
        container.dataset.qrRendered = 'true';
    });
}

window.buildTicketHtmlDesdeComprobante = buildTicketHtmlDesdeComprobante;
window.renderTicketQRCodes = renderTicketQRCodes;