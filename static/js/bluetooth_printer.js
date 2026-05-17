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
    const log = (msg) => {
        console.log(msg);
        // Mostrar en pantalla
        let div = document.getElementById('bt-debug-log');
        if (!div) {
            div = document.createElement('div');
            div.id = 'bt-debug-log';
            div.style.cssText = 'position:fixed;bottom:0;left:0;right:0;' +
                'background:rgba(0,0,0,0.9);color:#0f0;font-size:10px;' +
                'padding:8px;z-index:9999;max-height:200px;overflow-y:auto;' +
                'font-family:monospace';
            document.body.appendChild(div);
        }
        div.innerHTML += msg + '<br>';
        div.scrollTop = div.scrollHeight;
    };

    log('UUID: ' + this.characteristic?.uuid);
    log('writeWithoutResponse: ' + this.characteristic?.properties?.writeWithoutResponse);
    log('write: ' + this.characteristic?.properties?.write);
    log('Bytes a enviar: ' + bytes.length);

    if (!this.characteristic) throw new Error('No conectado');

    const CHUNK = 512;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const chunk = bytes.slice(i, i + CHUNK);
        log('Enviando chunk ' + i + '/' + bytes.length);
        try {
            if (this.characteristic.properties.writeWithoutResponse) {
                await this.characteristic.writeValueWithoutResponse(chunk);
            } else {
                await this.characteristic.writeValue(chunk);
            }
        } catch(e) {
            log('ERROR en chunk ' + i + ': ' + e.name + ' / ' + e.message);
            throw e;
        }
        await new Promise(r => setTimeout(r, 50));
    }
    log('Envío completado OK');
  },

  // ─────────────────────────────────────────
  // IMPRESIÓN RASTER (imagen)
  // ─────────────────────────────────────────

  async imprimirTicketHTML(htmlContent, config, anchoPapel = 58) {
    // M221 siempre usa 576px internamente
    const anchoPixels = 576;

    // Crear div temporal con el ticket
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed; left: -9999px; top: 0;
        width: ${anchoPixels}px;
        background: white; color: black;
        font-family: monospace; font-size: 22px;
        padding: 8px;
    `;
    div.innerHTML = htmlContent;
    document.body.appendChild(div);

    try {
        const canvas = await html2canvas(div, {
            width: anchoPixels,
            backgroundColor: '#ffffff',
            scale: 1,
            logging: false,
            useCORS: true
        });

        const imageData = canvas.getContext('2d').getImageData(
            0, 0, canvas.width, canvas.height
        );

        // Remover ANTES de imprimir (una sola vez)
        if (div.parentNode) div.parentNode.removeChild(div);

        await this._imprimirRaster(imageData, anchoPixels);

    } catch(e) {
        if (div.parentNode) div.parentNode.removeChild(div);
        throw e;
    }
  },

  async imprimirTexto(texto, anchoPapel = 58) {
    const bytes = [];

    // Inicializar
    bytes.push(0x1B, 0x40); // ESC @

    // Codificar texto línea por línea
    const encoder = new TextEncoder();
    const lineas = texto.split('\n');

    for (const linea of lineas) {
        const encoded = encoder.encode(linea);
        for (const b of encoded) bytes.push(b);
        bytes.push(0x0A); // nueva línea
    }

    // Avanzar papel
    bytes.push(0x1B, 0x64, 0x05);

    await this.enviarBytes(new Uint8Array(bytes));
  },

  async _imprimirRaster(imageData, anchoPixels) {
    const { data, width, height } = imageData;
    const widthBytes = Math.ceil(width / 8);

    // Preparar datos raster
    const rasterData = [];
    for (let y = 0; y < height; y++) {
        for (let bx = 0; bx < widthBytes; bx++) {
            let byte = 0;
            for (let bit = 0; bit < 8; bit++) {
                const x = bx * 8 + bit;
                if (x < width) {
                    const idx = (y * width + x) * 4;
                    const lum = data[idx] * 0.299 +
                                data[idx+1] * 0.587 +
                                data[idx+2] * 0.114;
                    if (lum < 128) byte |= (0x80 >> bit);
                }
            }
            rasterData.push(byte);
        }
    }

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // 1. Init
    await this.enviarBytes(new Uint8Array([0x1b, 0x40]));
    await delay(100);

    // 2. Heat settings (ESC 7) — CRÍTICO para M221
    // maxDots=7, heatTime=120 (density 6/8), heatInterval=2
    await this.enviarBytes(new Uint8Array([0x1b, 0x37, 7, 120, 2]));
    await delay(30);

    // 3. Density command
    await this.enviarBytes(new Uint8Array([0x1d, 0x7c, 6]));
    await delay(50);

    // 4. Raster header GS v 0
    await this.enviarBytes(new Uint8Array([
        0x1d, 0x76, 0x30, 0x00,
        widthBytes & 0xFF, (widthBytes >> 8) & 0xFF,
        height & 0xFF, (height >> 8) & 0xFF
    ]));

    // 5. Datos en chunks de 128 bytes
    const CHUNK = 128;
    const bytes = new Uint8Array(rasterData);
    for (let i = 0; i < bytes.length; i += CHUNK) {
        await this.enviarBytes(bytes.slice(i, i + CHUNK));
        await delay(20);
    }

    // 6. Feed (ESC J = feed n dots, no ESC d)
    await delay(300);
    await this.enviarBytes(new Uint8Array([0x1b, 0x4a, 48]));
    await delay(800);
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
  },

  async imprimirPruebaTexto() {
    const bytes = [];

    // Comando específico Phomemo para avance
    bytes.push(0x1B, 0x64, 0x0A); // feed 10 líneas

    await this.enviarBytes(new Uint8Array(bytes));
  }
};

window.BluetoothPrinter = BluetoothPrinter;