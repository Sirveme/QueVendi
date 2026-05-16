/**
 * QueVendi — Bluetooth Thermal Printer Service
 * Compatible: Phomemo M221, ESC/POS genérico
 * Protocolo: Web Bluetooth API (Chrome Android)
 * Uso: window.BluetoothPrinter.conectar()
 */

const BluetoothPrinter = {
  device: null,
  characteristic: null,

  // UUIDs ESC/POS Bluetooth estándar
  SERVICE_UUID: '000018f0-0000-1000-8000-00805f9b34fb',
  CHAR_UUID: '00002af1-0000-1000-8000-00805f9b34fb',

  // Comandos ESC/POS
  ESC: 0x1B,
  GS: 0x1D,

  // ─────────────────────────────────────────
  // CONEXIÓN
  // ─────────────────────────────────────────

  async conectar() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth no soportado. Usa Chrome en Android.');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Q454E6222740025' },
        { namePrefix: 'QueVendi' },
        { namePrefix: 'Phomemo' },
        { namePrefix: 'M221' },
        { namePrefix: 'PT-' },
        { namePrefix: 'QS-' },
      ],
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        '0000ff00-0000-1000-8000-00805f9b34fb',
      ]
    });

    const server = await this.device.gatt.connect();

    // Intentar con UUID estándar, luego fallback
    let service;
    try {
      service = await server.getPrimaryService(this.SERVICE_UUID);
    } catch {
      const services = await server.getPrimaryServices();
      if (!services.length) throw new Error('No se encontraron servicios BT');
      service = services[0];
    }

    const chars = await service.getCharacteristics();
    this.characteristic = chars.find(c =>
      c.properties.write || c.properties.writeWithoutResponse
    );

    if (!this.characteristic) {
      throw new Error('No se encontró canal de escritura en la impresora');
    }

    localStorage.setItem('bt_printer_name', this.device.name || 'Impresora');
    return true;
  },

  async desconectar() {
    if (this.device?.gatt?.connected) {
      await this.device.gatt.disconnect();
    }
    this.device = null;
    this.characteristic = null;
  },

  estaConectado() {
    return this.device?.gatt?.connected === true;
  },

  // ─────────────────────────────────────────
  // ENVÍO DE BYTES
  // ─────────────────────────────────────────

  async enviarBytes(bytes) {
    console.log('[BT] Enviando', bytes.length, 'bytes');
    console.log('[BT] Characteristic:', this.characteristic?.uuid);
    console.log('[BT] writeWithoutResponse:',
        this.characteristic?.properties?.writeWithoutResponse);
    console.log('[BT] write:',
        this.characteristic?.properties?.write);

    if (!this.characteristic) throw new Error('Impresora no conectada');

    const CHUNK = 512;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.slice(i, i + CHUNK);
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
      await new Promise(r => setTimeout(r, 50));
    }
  },

  // ─────────────────────────────────────────
  // IMPRESIÓN RASTER (imagen)
  // ─────────────────────────────────────────

  async imprimirTicketHTML(htmlContent, config, anchoPapel = 58) {
    const anchoPixels = anchoPapel === 80 ? 576 : 384;

    // Medir altura real del contenido
    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = `
      position: fixed; left: -9999px;
      width: ${anchoPixels}px;
      font-family: monospace; font-size: 22px;
      background: white; color: black; padding: 8px;
    `;
    tempDiv.innerHTML = htmlContent;
    document.body.appendChild(tempDiv);
    const altura = tempDiv.scrollHeight + 40;
    document.body.removeChild(tempDiv);

    // Crear canvas
    const canvas = document.createElement('canvas');
    canvas.width = anchoPixels;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');

    // Fondo blanco
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, anchoPixels, altura);

    // Renderizar HTML via SVG foreignObject
    const svgData = `<svg xmlns="http://www.w3.org/2000/svg"
      width="${anchoPixels}" height="${altura}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml"
          style="font-family:monospace;font-size:22px;
                 background:white;color:black;padding:8px;
                 width:${anchoPixels}px">
          ${htmlContent}
        </div>
      </foreignObject>
    </svg>`;

    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    // Convertir a ESC/POS raster
    const imageData = ctx.getImageData(0, 0, anchoPixels, altura);
    console.log('[BT] Canvas:', anchoPixels, 'x', altura);
    console.log('[BT] ImageData size:',
        anchoPixels * altura * 4, 'bytes');
    await this._imprimirRaster(imageData, anchoPixels);
  },

  async _imprimirRaster(imageData, anchoPixels) {
    const bytes = [];
    const { data, width, height } = imageData;
    const bytesPerRow = Math.ceil(width / 8);

    // Inicializar impresora
    bytes.push(this.ESC, 0x40);       // ESC @ reset
    bytes.push(this.ESC, 0x61, 0x01); // ESC a 1 = centrado

    // GS v 0 — raster bit image
    bytes.push(this.GS, 0x76, 0x30, 0x00);
    bytes.push(bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF);
    bytes.push(height & 0xFF, (height >> 8) & 0xFF);

    for (let y = 0; y < height; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const lum = data[idx] * 0.299 +
                        data[idx + 1] * 0.587 +
                        data[idx + 2] * 0.114;
            if (lum < 128) byte |= (0x80 >> bit);
          }
        }
        bytes.push(byte);
      }
    }

    // Avanzar papel
    bytes.push(this.ESC, 0x64, 0x05); // Feed 5 líneas

    await this.enviarBytes(new Uint8Array(bytes));
  },

  // ─────────────────────────────────────────
  // GENERAR HTML DEL TICKET
  // ─────────────────────────────────────────

  generarHTMLTicket(venta, config, anchoPapel = 58) {
    const chars = anchoPapel === 80 ? 48 : 32;
    const linea = '─'.repeat(chars);

    const fmt = (n) => `S/ ${parseFloat(n || 0).toFixed(2)}`;

    const fecha = new Date().toLocaleDateString('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const hora = new Date().toLocaleTimeString('es-PE', {
      timeZone: 'America/Lima',
      hour: '2-digit', minute: '2-digit'
    });

    const items = (venta.items || []).map(item => `
      <div style="margin-bottom:4px">
        <div>${(item.name || '').substring(0, chars - 2)}</div>
        <div style="display:flex;justify-content:space-between">
          <span>${parseFloat(item.quantity).toFixed(2)} x ${fmt(item.price)}</span>
          <span>${fmt(item.quantity * item.price)}</span>
        </div>
      </div>`
    ).join('');

    return `
      <div style="text-align:center;font-weight:bold;
                  font-size:26px;margin-bottom:2px">
        ${config.nombre_comercial || config.razon_social || 'Mi Negocio'}
      </div>
      ${config.direccion ? `
        <div style="text-align:center;font-size:17px">
          ${config.direccion}
        </div>` : ''}
      ${config.ruc ? `
        <div style="text-align:center;font-size:17px">
          RUC: ${config.ruc}
        </div>` : ''}
      ${config.telefono ? `
        <div style="text-align:center;font-size:17px">
          Tel: ${config.telefono}
        </div>` : ''}
      <div style="margin:6px 0">${linea}</div>
      <div style="text-align:center;font-weight:bold;font-size:20px">
        TICKET DE VENTA
      </div>
      <div style="font-size:17px">
        N°: ${venta.sale_number || venta.id || ''}
      </div>
      <div style="font-size:17px">
        Fecha: ${fecha} ${hora}
      </div>
      <div style="margin:6px 0">${linea}</div>
      ${items}
      <div style="margin:6px 0">${linea}</div>
      <div style="display:flex;justify-content:space-between;
                  font-weight:bold;font-size:24px">
        <span>TOTAL</span>
        <span>${fmt(venta.total)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;
                  font-size:17px">
        <span>Pago:</span>
        <span>${venta.payment_method || 'Contado'}</span>
      </div>
      <div style="margin:6px 0">${linea}</div>
      <div style="text-align:center;font-size:16px;
                  margin-top:6px">
        ¡Gracias por su compra!
      </div>
      <div style="text-align:center;font-size:14px;
                  color:#666">
        quevendi.pro
      </div>`;
  }
};

window.BluetoothPrinter = BluetoothPrinter;