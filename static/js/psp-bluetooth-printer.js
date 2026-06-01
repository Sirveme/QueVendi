/**
 * PSP Bluetooth Printer Module
 * Soporta Phomemo M221, M220, M260, M200, M250 (protocolo m-series)
 * Anchos soportados: 58mm (48 bytes), 80mm (72 bytes)
 *
 * Basado en el protocolo de phomymo (transcriptionstream/phomymo)
 * Adaptado por Perú Sistemas Pro para QueVendi, PagoOK, Herramientas Cajera
 *
 * Uso:
 *   const printer = new PSPPrinter();
 *   await printer.connect();
 *   await printer.printTicket({
 *     negocio: 'POLLERIA BOLOGNESI',
 *     ruc: '20123456789',
 *     items: [{nombre: 'Pollo 1/4', cantidad: 1, precio: 18.00}],
 *     total: 18.00
 *   });
 */

(function (global) {
  'use strict';

  // ============ UUIDS DE PHOMEMO ============
  // Servicios conocidos de Phomemo (documentados por ingeniería inversa de la comunidad)
  const PHOMEMO_SERVICE_UUIDS = [
    0xff00,       // Service principal (M221, M220, M260, M250, M200)
    0xff10,       // Service alternativo en algunos modelos
    0x18f0,       // Service alternativo M-series
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ff10-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
  ];

  const WRITE_CHAR_UUID = 0xff02;
  const NOTIFY_CHAR_UUID = 0xff01;

  // Configuración BLE
  const CHUNK_SIZE = 128;        // Bytes por chunk de envío
  const CHUNK_DELAY_MS = 20;     // Delay entre chunks
  const MAX_RETRIES = 3;
  const INITIAL_RETRY_DELAY_MS = 500;

  // ============ COMANDOS ESC/POS ============
  const CMD = {
    INIT: new Uint8Array([0x1b, 0x40]),                              // ESC @ - Inicializar
    FEED: (dots) => new Uint8Array([0x1b, 0x4a, dots]),              // ESC J n - Feed n dots
    DENSITY: (level) => new Uint8Array([0x1d, 0x7c, level]),         // GS | n - Densidad
    HEAT_SETTINGS: (maxDots, heatTime, heatInterval) =>              // ESC 7 - Heat
      new Uint8Array([0x1b, 0x37, maxDots, heatTime, heatInterval]),
    LINE_SPACING: (dots) => new Uint8Array([0x1b, 0x33, dots]),      // ESC 3 - Line spacing
    RASTER_HEADER: (widthBytes, heightLines) => new Uint8Array([     // GS v 0 - Print raster
      0x1d, 0x76, 0x30, 0x00,
      widthBytes, 0x00,
      heightLines & 0xff, (heightLines >> 8) & 0xff,
    ]),
  };

  // ============ CONFIGURACIONES PRE-DEFINIDAS ============
  const ANCHOS = {
    '58mm': { widthBytes: 48, widthPx: 384, label: '58 mm' },
    '80mm': { widthBytes: 72, widthPx: 576, label: '80 mm' },
  };

  // ============ MAPEO DENSITY → HEAT TIME ============
  function densityToHeatTime(density) {
    const heatTimes = [40, 60, 80, 100, 120, 140, 160, 200];
    return heatTimes[Math.max(0, Math.min(7, density - 1))];
  }

  // ============ CLASE PRINCIPAL ============
  class PSPPrinter {
    constructor(config = {}) {
      this.device = null;
      this.server = null;
      this.service = null;
      this.writeChar = null;
      this.notifyChar = null;
      this.connected = false;

      // Configuración por defecto
      this.ancho = config.ancho || '80mm';            // '58mm' o '80mm'
      this.density = config.density || 5;             // 1-8, default 5 (medio)
      this.feedAfterPrint = config.feedAfterPrint || 60;  // dots a alimentar después
      this.onProgress = config.onProgress || null;
      this.onLog = config.onLog || ((msg) => console.log('[PSPPrinter]', msg));

      this._notificationHandler = null;
    }

    static isAvailable() {
      return 'bluetooth' in navigator;
    }

    /**
     * Conectar a la impresora Phomemo
     * Muestra el selector de Bluetooth del navegador
     */
    async connect() {
      if (!PSPPrinter.isAvailable()) {
        throw new Error('Web Bluetooth no está disponible. Use Chrome o Edge en Android/Desktop.');
      }

      if (this.isConnected()) {
        this.onLog('Ya está conectado');
        return true;
      }

      this.onLog('Preparando solicitud Bluetooth...');

      // ESTRATEGIA SIMPLIFICADA Y ROBUSTA:
      // 1. Usar acceptAllDevices (más permisivo, evita problemas de filtros)
      // 2. Solo UUIDs en formato string completo (más compatible)
      // 3. Try-catch granular en cada paso

      const SERVICIOS_STRING = [
        '0000ff00-0000-1000-8000-00805f9b34fb',  // FF00 - Servicio principal Phomemo
        '0000ff10-0000-1000-8000-00805f9b34fb',  // FF10 - Servicio alternativo
        '000018f0-0000-1000-8000-00805f9b34fb',  // 18F0 - Servicio M-series alternativo
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',  // Servicio Microchip BLE-SPP (algunos Phomemo)
      ];

      try {
        this.onLog('Mostrando selector de dispositivos Bluetooth...');
        this.onLog('IMPORTANTE: aparecerá un cuadro nativo. Seleccione su impresora.');

        // Usar acceptAllDevices que es más confiable que filtros
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: SERVICIOS_STRING,
        });
      } catch (e) {
        if (e.name === 'NotFoundError') {
          throw new Error('Usuario canceló o no se encontró ningún dispositivo. Intente de nuevo.');
        }
        throw new Error(`Error en selector: ${e.name}: ${e.message}`);
      }

      this.onLog(`✓ Dispositivo seleccionado: ${this.device.name || '(sin nombre)'}`);
      this.onLog(`  ID: ${this.device.id}`);

      // Listener para desconexión
      this.device.addEventListener('gattserverdisconnected', () => {
        this.onLog('⚠ Desconectado de la impresora');
        this.connected = false;
      });

      // Intentar conectar
      try {
        await this._connectGATT(SERVICIOS_STRING);
      } catch (e) {
        throw new Error(`Error al conectar GATT: ${e.message}`);
      }

      return true;
    }

    async _connectGATT(serviciosUUID) {
      this.onLog('Conectando a GATT server...');

      try {
        this.server = await this.device.gatt.connect();
        this.onLog('✓ GATT server conectado');
      } catch (e) {
        throw new Error(`Falló gatt.connect(): ${e.message}`);
      }

      await this._delay(200);

      // Probar cada servicio hasta encontrar uno que funcione
      this.onLog('Buscando servicio compatible...');
      let lastError = null;
      let serviciosEncontrados = [];

      // Primero, intentar listar todos los servicios disponibles (útil para debug)
      try {
        const allServices = await this.server.getPrimaryServices();
        this.onLog(`Servicios disponibles en el dispositivo: ${allServices.length}`);
        for (const svc of allServices) {
          this.onLog(`  - ${svc.uuid}`);
          serviciosEncontrados.push(svc.uuid);
        }
      } catch (e) {
        this.onLog(`No se pudieron listar servicios: ${e.message}`);
      }

      // Ahora intentar cada UUID conocido
      for (const serviceUuid of serviciosUUID) {
        try {
          this.onLog(`Probando servicio: ${serviceUuid}`);
          this.service = await this.server.getPrimaryService(serviceUuid);
          this.onLog(`✓ Servicio encontrado: ${serviceUuid}`);
          break;
        } catch (e) {
          lastError = e;
        }
      }

      // Si no encontramos en la lista predefinida, probar el primero que detectamos
      if (!this.service && serviciosEncontrados.length > 0) {
        for (const svcUuid of serviciosEncontrados) {
          // Saltar servicios genéricos
          if (svcUuid.includes('1800') || svcUuid.includes('1801') || svcUuid.includes('180a')) {
            continue;
          }
          try {
            this.onLog(`Probando servicio detectado: ${svcUuid}`);
            this.service = await this.server.getPrimaryService(svcUuid);
            this.onLog(`✓ Servicio encontrado: ${svcUuid}`);
            break;
          } catch (e) {
            lastError = e;
          }
        }
      }

      if (!this.service) {
        const detalle = serviciosEncontrados.length > 0
          ? `Servicios encontrados pero ninguno compatible: ${serviciosEncontrados.join(', ')}`
          : `No se detectaron servicios. ${lastError?.message || ''}`;
        throw new Error(`No hay servicio compatible. ${detalle}`);
      }

      // Listar características del servicio para debug
      this.onLog('Buscando característica de escritura...');
      try {
        const allChars = await this.service.getCharacteristics();
        this.onLog(`Características disponibles: ${allChars.length}`);
        for (const ch of allChars) {
          const props = ch.properties;
          const propsStr = [
            props.write && 'write',
            props.writeWithoutResponse && 'writeWithoutResponse',
            props.notify && 'notify',
            props.read && 'read',
          ].filter(Boolean).join(',');
          this.onLog(`  - ${ch.uuid} [${propsStr}]`);
        }

        // Buscar la primera característica que pueda escribir
        for (const ch of allChars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            this.writeChar = ch;
            this.onLog(`✓ Característica de escritura: ${ch.uuid}`);
            break;
          }
        }

        // Buscar característica con notify
        for (const ch of allChars) {
          if (ch.properties.notify) {
            this.notifyChar = ch;
            try {
              await ch.startNotifications();
              this._notificationHandler = (event) => {
                const data = new Uint8Array(event.target.value.buffer);
                this.onLog(`Notif: ${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
              };
              ch.addEventListener('characteristicvaluechanged', this._notificationHandler);
              this.onLog(`✓ Notificaciones habilitadas en: ${ch.uuid}`);
            } catch (e) {
              this.onLog(`Notificaciones no se pudieron habilitar: ${e.message}`);
            }
            break;
          }
        }
      } catch (e) {
        throw new Error(`Error obteniendo características: ${e.message}`);
      }

      if (!this.writeChar) {
        throw new Error('No se encontró característica de escritura en el servicio');
      }

      this.connected = true;
      this.onLog(`✓ Conexión completa con ${this.device.name}`);
    }

    async disconnect() {
      if (this.notifyChar && this._notificationHandler) {
        try {
          this.notifyChar.removeEventListener('characteristicvaluechanged', this._notificationHandler);
          await this.notifyChar.stopNotifications();
        } catch (e) {}
      }
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
      this.connected = false;
      this.onLog('Desconectado');
    }

    isConnected() {
      return this.connected && this.device?.gatt?.connected && this.writeChar !== null;
    }

    /**
     * Cambiar ancho de papel ('58mm' o '80mm')
     */
    setAncho(ancho) {
      if (!ANCHOS[ancho]) {
        throw new Error(`Ancho no soportado: ${ancho}. Use '58mm' o '80mm'`);
      }
      this.ancho = ancho;
      this.onLog(`Ancho configurado: ${ANCHOS[ancho].label}`);
    }

    /**
     * Cambiar densidad de impresión (1-8)
     * 1 = muy claro, 8 = muy oscuro
     */
    setDensity(density) {
      this.density = Math.max(1, Math.min(8, density));
      this.onLog(`Densidad configurada: ${this.density}`);
    }

    /**
     * Imprimir un canvas directamente
     */
    async printCanvas(canvas) {
      if (!this.isConnected()) {
        throw new Error('No conectado. Llame a connect() primero.');
      }

      const config = ANCHOS[this.ancho];
      const widthPx = config.widthPx;
      const widthBytes = config.widthBytes;

      // Si el canvas no tiene el ancho correcto, lo escalamos
      let canvasToUse = canvas;
      if (canvas.width !== widthPx) {
        canvasToUse = this._scaleCanvas(canvas, widthPx);
      }

      // Convertir canvas a raster bytes
      const raster = this._canvasToRaster(canvasToUse, widthBytes);
      const heightLines = canvasToUse.height;

      this.onLog(`Imprimiendo: ${widthPx}×${heightLines}px (${raster.length} bytes)`);

      // Secuencia de impresión
      await this._send(CMD.INIT);
      await this._delay(100);

      const heatTime = densityToHeatTime(this.density);
      this.onLog(`Heat time: ${heatTime}, density: ${this.density}`);
      await this._send(CMD.HEAT_SETTINGS(7, heatTime, 2));
      await this._delay(30);
      await this._send(CMD.DENSITY(this.density));
      await this._delay(50);

      // Header del raster
      await this._send(CMD.RASTER_HEADER(widthBytes, heightLines));

      // Enviar datos en chunks
      const totalChunks = Math.ceil(raster.length / CHUNK_SIZE);
      let chunksEnviados = 0;

      for (let i = 0; i < raster.length; i += CHUNK_SIZE) {
        const chunk = raster.slice(i, Math.min(i + CHUNK_SIZE, raster.length));
        await this._send(chunk);
        await this._delay(CHUNK_DELAY_MS);
        chunksEnviados++;

        if (this.onProgress) {
          this.onProgress(Math.round((chunksEnviados / totalChunks) * 100));
        }
      }

      // Feed final
      await this._delay(300);
      await this._send(CMD.FEED(this.feedAfterPrint));
      await this._delay(800);

      this.onLog('Impresión completa!');
    }

    /**
     * Imprimir un ticket de venta tipo POS
     * @param {Object} ticket
     * @param {string} ticket.negocio - Nombre del negocio
     * @param {string} ticket.ruc - RUC (opcional)
     * @param {string} ticket.direccion - Dirección (opcional)
     * @param {string} ticket.numero - Número de ticket (opcional)
     * @param {Array} ticket.items - [{nombre, cantidad, precio}]
     * @param {number} ticket.total - Total
     * @param {string} ticket.metodoPago - Método de pago (opcional)
     * @param {string} ticket.cliente - Cliente (opcional)
     * @param {string} ticket.pieMensaje - Mensaje al pie (opcional)
     */
    async printTicket(ticket) {
      const canvas = this._renderTicketCanvas(ticket);
      await this.printCanvas(canvas);
    }

    /**
     * Renderizar un ticket completo en un canvas
     */
    _renderTicketCanvas(ticket) {
      const config = ANCHOS[this.ancho];
      const W = config.widthPx;
      const PAD = 10;
      const LINEA_H = this.ancho === '58mm' ? 22 : 28;

      const fmt = (n) => 'S/ ' + parseFloat(n || 0).toFixed(2);
      const ahora = new Date();
      const fecha = ahora.toLocaleDateString('es-PE', {
        timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric'
      });
      const hora = ahora.toLocaleTimeString('es-PE', {
        timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit'
      });
      const linea = this.ancho === '58mm' ? '-'.repeat(32) : '-'.repeat(42);

      const lineas = [];

      // Cabecera
      lineas.push({ t: (ticket.negocio || 'MI NEGOCIO').toUpperCase(), s: 26, bold: true, c: true });
      if (ticket.direccion) lineas.push({ t: ticket.direccion, s: 18, c: true });
      if (ticket.ruc) lineas.push({ t: 'RUC: ' + ticket.ruc, s: 18, c: true });
      lineas.push({ t: linea, s: 18, c: true });

      // Tipo de ticket
      lineas.push({ t: 'TICKET DE VENTA', s: 22, bold: true, c: true });
      if (ticket.numero) lineas.push({ t: 'N°: ' + ticket.numero, s: 18 });
      lineas.push({ t: 'Fecha: ' + fecha + ' ' + hora, s: 18 });
      if (ticket.cliente) lineas.push({ t: 'Cliente: ' + ticket.cliente, s: 18 });
      lineas.push({ t: linea, s: 18, c: true });

      // Items
      const items = ticket.items || [];
      for (const item of items) {
        const nombre = (item.nombre || item.name || '').substring(0, this.ancho === '58mm' ? 24 : 34);
        lineas.push({ t: nombre, s: 18, bold: true });
        const qty = parseFloat(item.cantidad || item.quantity || 0).toFixed(2);
        const precio = item.precio || item.price || 0;
        const totalItem = fmt(qty * precio);
        lineas.push({ t: '  ' + qty + ' x ' + fmt(precio) + ' = ' + totalItem, s: 18 });
      }

      lineas.push({ t: linea, s: 18, c: true });

      // Total
      lineas.push({ t: 'TOTAL: ' + fmt(ticket.total), s: 26, bold: true });
      if (ticket.metodoPago) {
        lineas.push({ t: 'Pago: ' + ticket.metodoPago, s: 18 });
      }
      lineas.push({ t: linea, s: 18, c: true });

      // Pie
      if (ticket.pieMensaje) {
        const lineasPie = ticket.pieMensaje.split('\n');
        for (const lp of lineasPie) {
          lineas.push({ t: lp, s: 16, c: true });
        }
      } else {
        lineas.push({ t: '¡Gracias por su compra!', s: 18, c: true });
      }

      // Espacios al final
      lineas.push({ t: '', s: 18 });
      lineas.push({ t: '', s: 18 });

      // Calcular altura total
      const H = lineas.length * LINEA_H + PAD * 2;

      // Crear canvas
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
        ctx.font = (l.bold ? 'bold ' : '') + l.s + 'px Courier New, monospace';
        ctx.textBaseline = 'middle';
        if (l.c) {
          ctx.textAlign = 'center';
          ctx.fillText(l.t, W / 2, y);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(l.t, PAD, y);
        }
        y += LINEA_H;
      }

      return canvas;
    }

    /**
     * Escalar un canvas a un ancho específico manteniendo proporción
     */
    _scaleCanvas(sourceCanvas, targetWidth) {
      const ratio = targetWidth / sourceCanvas.width;
      const targetHeight = Math.round(sourceCanvas.height * ratio);
      const newCanvas = document.createElement('canvas');
      newCanvas.width = targetWidth;
      newCanvas.height = targetHeight;
      const ctx = newCanvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
      return newCanvas;
    }

    /**
     * Convertir un canvas a bytes raster monocromo
     */
    _canvasToRaster(canvas, widthBytes) {
      const W = canvas.width;
      const H = canvas.height;
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, W, H);
      const raster = new Uint8Array(widthBytes * H);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W && x < widthBytes * 8; x++) {
          const idx = (y * W + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          // Considerar pixeles transparentes como blancos
          const alpha = a / 255;
          const avg = (r * alpha + g * alpha + b * alpha) / 3 + 255 * (1 - alpha);

          // Threshold simple
          if (avg < 128) {
            raster[y * widthBytes + Math.floor(x / 8)] |= (0x80 >> (x % 8));
          }
        }
      }
      return raster;
    }

    /**
     * Enviar bytes a la impresora
     */
    async _send(data) {
      if (!this.writeChar) {
        throw new Error('No conectado');
      }
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

      try {
        if (this.writeChar.properties.writeWithoutResponse) {
          await this.writeChar.writeValueWithoutResponse(bytes);
        } else {
          await this.writeChar.writeValue(bytes);
        }
      } catch (e) {
        throw new Error(`Error escribiendo a la impresora: ${e.message}`);
      }
    }

    /**
     * Delay async
     */
    _delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test de impresión rápido
     */
    async printTest() {
      await this.printTicket({
        negocio: 'PRUEBA QUEVENDI',
        ruc: '20615446565',
        direccion: 'Iquitos, Loreto',
        numero: 'TEST-001',
        items: [
          { nombre: 'Item de prueba 1', cantidad: 1, precio: 10.00 },
          { nombre: 'Item de prueba 2', cantidad: 2, precio: 5.50 },
        ],
        total: 21.00,
        metodoPago: 'Efectivo',
        pieMensaje: '¡Impresion exitosa!\nquevendi.pro'
      });
    }
  }

  // Exportar al global
  global.PSPPrinter = PSPPrinter;

})(typeof window !== 'undefined' ? window : globalThis);