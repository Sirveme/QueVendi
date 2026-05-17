/**
 * QueVendi — Bluetooth Thermal Printer Service
 * Compatible: Phomemo M221, ESC/POS
 * Protocolo basado en phomymo (transcriptionstream/phomymo)
 * UUIDs: SERVICE=0xff00, WRITE=0xff02
 */

const BluetoothPrinter = {
  device: null,
  characteristic: null,
  notifyChar: null,

  SERVICE_UUID: 0xff00,
  WRITE_CHAR_UUID: 0xff02,
  NOTIFY_CHAR_UUID: 0xff03,

  ALT_SERVICE_UUIDS: [
    0xff00,
    0xffe0,
    0xae30,
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
  ],

  async conectar() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth no soportado. Usa Chrome en Android.');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'M' },
        { namePrefix: 'D' },
        { namePrefix: 'P' },
        { namePrefix: 'Q' },
        { namePrefix: 'T' },
        { namePrefix: 'A' },
        { namePrefix: 'Phomemo' },
        { namePrefix: 'QueVendi' },
      ],
      optionalServices: this.ALT_SERVICE_UUIDS
    });

    const server = await this.device.gatt.connect();
    await this._delay(100);

    let service = null;
    for (const uuid of this.ALT_SERVICE_UUIDS) {
      try {
        service = await server.getPrimaryService(uuid);
        break;
      } catch (e) { /* siguiente */ }
    }

    if (!service) throw new Error('No se encontró servicio Bluetooth compatible');

    this.characteristic = await service.getCharacteristic(this.WRITE_CHAR_UUID);

    try {
      this.notifyChar = await service.getCharacteristic(this.NOTIFY_CHAR_UUID);
      await this.notifyChar.startNotifications();
    } catch (e) { /* sin notificaciones */ }

    localStorage.setItem('bt_printer_name', this.device.name || 'Impresora');
    return true;
  },

  async desconectar() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null;
    this.characteristic = null;
    this.notifyChar = null;
  },

  estaConectado() {
    return !!(this.device?.gatt?.connected && this.characteristic);
  },

  async _send(bytes) {
    if (!this.characteristic) throw new Error('No conectado');
    const buffer = new Uint8Array(bytes).buffer;
    if (this.characteristic.properties.writeWithoutResponse) {
      await this.characteristic.writeValueWithoutResponse(buffer);
    } else {
      await this.characteristic.writeValue(buffer);
    }
  },

  async _sendChunked(data, chunkSize = 128, delayMs = 20) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < bytes.length; i += chunkSize) {
      await this._send(bytes.slice(i, i + chunkSize));
      await this._delay(delayMs);
    }
  },

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  async imprimirTicketHTML(htmlContent, config, anchoPapel = 58) {
    const anchoPixels = 576; // M221 siempre 576px

    const div = document.createElement('div');
    div.style.cssText = `position:fixed;left:-9999px;top:0;width:${anchoPixels}px;background:white;color:black;font-family:monospace;font-size:22px;padding:8px;box-sizing:border-box;`;
    div.innerHTML = htmlContent;
    document.body.appendChild(div);

    let canvas;
    try {
      canvas = await html2canvas(div, {
        width: anchoPixels,
        backgroundColor: '#ffffff',
        scale: 1,
        logging: false,
        useCORS: true,
      });
      alert('Canvas: ' + canvas.width + 'x' + canvas.height);
    } finally {
      if (div.parentNode) div.parentNode.removeChild(div);
    }

    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    await this._imprimirRaster(imageData, anchoPixels);
  },

  async _imprimirRaster(imageData, anchoPixels) {
    const { data, width, height } = imageData;
    const widthBytes = Math.ceil(width / 8);

    // Bitmap 1-bit
    const rasterData = new Uint8Array(widthBytes * height);
    for (let y = 0; y < height; y++) {
      for (let bx = 0; bx < widthBytes; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const lum = data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114;
            if (lum < 128) byte |= (0x80 >> bit);
          }
        }
        rasterData[y * widthBytes + bx] = byte;
      }
    }

    // Protocolo phomymo printBLE — cada comando independiente
    await this._send([0x1b, 0x40]);           // Init
    await this._delay(100);
    await this._send([0x1b, 0x37, 7, 120, 2]); // Heat settings
    await this._delay(30);
    await this._send([0x1d, 0x7c, 6]);          // Density
    await this._delay(50);
    await this._send([                           // Raster header
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xFF, (widthBytes >> 8) & 0xFF,
      height & 0xFF, (height >> 8) & 0xFF,
    ]);
    await this._sendChunked(rasterData, 128, 20); // Datos
    await this._delay(300);
    await this._send([0x1b, 0x4a, 48]);           // Feed
    await this._delay(800);
  },

  async imprimirPruebaTexto() {
    const enc = new TextEncoder();
    await this._send([0x1b, 0x40]);
    await this._delay(100);
    await this._send([0x1b, 0x37, 7, 120, 2]);
    await this._delay(30);
    await this._sendChunked(enc.encode('PRUEBA QUEVENDI\n\n\n'), 128, 20);
    await this._delay(300);
    await this._send([0x1b, 0x4a, 48]);
    await this._delay(500);
  },

  async imprimirVenta(venta, config, anchoPapel = 58) {
    const canvas = this._renderTicketEnCanvas(venta, config);
    const { data, widthBytes, height } = this._canvasARaster(canvas);
    await this._enviarRaster(data, widthBytes, height);
  },

  _renderTicketEnCanvas(venta, config) {
    const W = 576;
    const LINEA_H = 26;
    const PAD = 12;
    const fmt = (n) => 'S/ ' + parseFloat(n || 0).toFixed(2);
    const fecha = new Date().toLocaleDateString('es-PE', {
        timeZone: 'America/Lima', day:'2-digit',
        month:'2-digit', year:'numeric'
    });
    const hora = new Date().toLocaleTimeString('es-PE', {
        timeZone: 'America/Lima',
        hour:'2-digit', minute:'2-digit'
    });
    const linea = '─'.repeat(36);
    const nombre = config.nombre_comercial ||
                   config.razon_social || 'Mi Negocio';
    const items = venta.items || [];

    const lineas = [];
    lineas.push({t: nombre, s: 32, bold: true, c: true});
    if (config.direccion) lineas.push({t: config.direccion, s: 22, c: true});
    if (config.ruc) lineas.push({t: 'RUC: '+config.ruc, s: 22, c: true});
    lineas.push({t: linea, s: 22, c: true});
    lineas.push({t: 'TICKET DE VENTA', s: 28, bold: true, c: true});
    lineas.push({t: 'N°: '+(venta.sale_number||''), s: 22});
    lineas.push({t: 'Fecha: '+fecha+' '+hora, s: 22});
    lineas.push({t: linea, s: 22, c: true});
    for (const item of items) {
        lineas.push({t: (item.name||'').substring(0,28), s: 22});
        const qty = parseFloat(item.quantity||0).toFixed(2);
        const total = fmt((item.quantity||0)*(item.price||0));
        lineas.push({t: '  '+qty+' x '+fmt(item.price)+' = '+total, s: 22});
    }
    lineas.push({t: linea, s: 22, c: true});
    lineas.push({t: 'TOTAL:', s: 28, bold: true, c: true});
    lineas.push({t: fmt(venta.total), s: 32, bold: true, c: true});
    lineas.push({t: 'Pago: '+(venta.payment_method||'Contado'), s: 22});
    lineas.push({t: linea, s: 22, c: true});
    lineas.push({t: '¡Gracias por su compra!', s: 22, c: true});
    lineas.push({t: 'quevendi.pro', s: 18, c: true});
    lineas.push({t: '', s: 22});

    const H = lineas.length * LINEA_H + PAD * 2;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'black';
    let y = PAD + LINEA_H;
    for (const l of lineas) {
        if (!l.t) { y += LINEA_H; continue; }
        ctx.font = (l.bold ? 'bold ' : '') + l.s + 'px monospace';
        ctx.textBaseline = 'middle';
        if (l.c) {
            ctx.textAlign = 'center';
            ctx.fillText(l.t, W/2, y);
        } else {
            ctx.textAlign = 'left';
            ctx.fillText(l.t, PAD, y);
        }
        y += LINEA_H;
    }
    return canvas;
  },

  _canvasARaster(canvas) {
    const ctx = canvas.getContext('2d');
    const {width: W, height: H} = canvas;
    const {data} = ctx.getImageData(0, 0, W, H);
    const widthBytes = Math.ceil(W / 8);
    const raster = new Uint8Array(widthBytes * H);
    const gray = new Float32Array(W * H);
    const gi = 1/1.3;
    for (let i = 0; i < W*H; i++) {
        const idx = i*4;
        let g = 0.299*data[idx] + 0.587*data[idx+1] + 0.114*data[idx+2];
        if (data[idx+3] < 255) g = g*(data[idx+3]/255) + 255*(1-data[idx+3]/255);
        gray[i] = 255 * Math.pow(g/255, gi);
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y*W + x;
            const old = gray[i];
            const nw = old < 128 ? 0 : 255;
            const err = old - nw;
            gray[i] = nw;
            if (nw === 0) raster[y*widthBytes + Math.floor(x/8)] |= (1 << (7-(x%8)));
            if (x+1 < W) gray[i+1] += err*7/16;
            if (y+1 < H) {
                if (x > 0) gray[(y+1)*W+(x-1)] += err*3/16;
                gray[(y+1)*W+x] += err*5/16;
                if (x+1 < W) gray[(y+1)*W+(x+1)] += err*1/16;
            }
        }
    }
    return {data: raster, widthBytes, height: H};
  },

  async _enviarRaster(data, widthBytes, height) {
    await this._send([0x1b, 0x40]);
    await this._delay(100);
    await this._send([0x1b, 0x37, 7, 120, 2]);
    await this._delay(30);
    await this._send([0x1d, 0x7c, 6]);
    await this._delay(50);
    // Enviar en bloques de máx 255 líneas
    const MAX_LINEAS = 255;
    let lineaActual = 0;
    while (lineaActual < height) {
        const bloque = Math.min(MAX_LINEAS, height - lineaActual);
        await this._send([
            0x1d, 0x76, 0x30, 0x00,
            widthBytes & 0xFF, (widthBytes >> 8) & 0xFF,
            bloque & 0xFF, (bloque >> 8) & 0xFF,
        ]);
        const offset = lineaActual * widthBytes;
        await this._sendChunked(
            data.slice(offset, offset + bloque * widthBytes),
            128, 20
        );
        lineaActual += bloque;
    }
    await this._delay(300);
    await this._send([0x1b, 0x4a, 48]);
    await this._delay(800);
  },

  generarHTMLTicket(venta, config, anchoPapel = 58) {
    const fmt = (n) => `S/ ${parseFloat(n || 0).toFixed(2)}`;
    const fecha = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = new Date().toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' });
    const items = (venta.items || []).map(item => `
      <div style="margin-bottom:4px">
        <div>${(item.name||'').substring(0,30)}</div>
        <div style="display:flex;justify-content:space-between">
          <span>${parseFloat(item.quantity||0).toFixed(2)} x ${fmt(item.price)}</span>
          <span>${fmt((item.quantity||0)*(item.price||0))}</span>
        </div>
      </div>`).join('');
    const linea = '─'.repeat(36);
    return `
      <div style="text-align:center;font-weight:bold;font-size:26px;margin-bottom:2px">${config.nombre_comercial||config.razon_social||'Mi Negocio'}</div>
      ${config.direccion?`<div style="text-align:center;font-size:17px">${config.direccion}</div>`:''}
      ${config.ruc?`<div style="text-align:center;font-size:17px">RUC: ${config.ruc}</div>`:''}
      <div style="margin:6px 0">${linea}</div>
      <div style="text-align:center;font-weight:bold;font-size:20px">TICKET DE VENTA</div>
      <div style="font-size:17px">N°: ${venta.sale_number||venta.id||''}</div>
      <div style="font-size:17px">Fecha: ${fecha} ${hora}</div>
      <div style="margin:6px 0">${linea}</div>
      ${items}
      <div style="margin:6px 0">${linea}</div>
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:24px"><span>TOTAL</span><span>${fmt(venta.total)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:17px"><span>Pago:</span><span>${venta.payment_method||'Contado'}</span></div>
      <div style="margin:6px 0">${linea}</div>
      <div style="text-align:center;font-size:16px;margin-top:6px">¡Gracias por su compra!</div>
      <div style="text-align:center;font-size:14px;color:#666">quevendi.pro</div>`;
  },

  async enviarBytes(bytes) {
    await this._sendChunked(bytes, 512, 50);
  },
};

window.BluetoothPrinter = BluetoothPrinter;