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

  // Configuración BLE - AJUSTADO PARA M221
  // MTU típico BLE: ~150-180 bytes. Chunks de 128 bytes garantizan que no se corten.
  const CHUNK_SIZE = 128;        // 128 bytes - respeta MTU del M221 sin fragmentar
  const CHUNK_DELAY_MS = 10;     // 10ms entre chunks (sin flow control)
  const ACK_TIMEOUT_MS = 200;    // Timeout máximo esperando ACK
  const USE_ACK_FLOW = false;    // true = espera ACK 01 01 antes de siguiente chunk
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

  // ============ CONFIG DEL NEGOCIO EN LOCALSTORAGE ============
  const STORAGE_KEY = 'psp-printer-negocio-config';

  const NegocioConfig = {
    DEFAULT: {
      nombre_comercial: '',
      razon_social: '',
      ruc: '',
      direccion: '',
      telefono: '',
      eslogan: '',
      mensaje_pie: '¡Gracias por su compra!',
      mensaje_promo: '',
      mensaje_sorteo: '',
      mostrar_telefono: true,
      mostrar_promo: true,
    },

    load() {
      try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          return { ...this.DEFAULT, ...JSON.parse(data) };
        }
      } catch (e) {
        console.warn('Error cargando config:', e);
      }
      return { ...this.DEFAULT };
    },

    save(config) {
      try {
        const current = this.load();
        const merged = { ...current, ...config };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      } catch (e) {
        console.error('Error guardando config:', e);
        return null;
      }
    },

    clear() {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

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
      this.density = config.density || 6;             // 1-8, default 6 (más oscuro)
      this.tamanoFuente = config.tamanoFuente || 'M'; // 'S' / 'M' / 'L'
      this.feedAfterPrint = config.feedAfterPrint || 60;  // dots a alimentar después
      this.onProgress = config.onProgress || null;
      this.onLog = config.onLog || ((msg) => console.log('[PSPPrinter]', msg));

      this._notificationHandler = null;
      this._ackResolver = null;
      this._lastAck = 0;
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
                const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
                this.onLog(`Notif: ${hex}`);

                // Detectar ACK de Phomemo
                // 01 01 = chunk procesado correctamente
                // 01 07 = init ack
                if (data.length >= 2 && data[0] === 0x01 && data[1] === 0x01) {
                  if (this._ackResolver) {
                    const resolver = this._ackResolver;
                    this._ackResolver = null;
                    resolver();
                  }
                }
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
     * Cambiar tamaño base de fuente ('S' / 'M' / 'L')
     */
    setTamanoFuente(tamano) {
      if (!['S', 'M', 'L'].includes(tamano)) {
        throw new Error(`Tamaño no válido: ${tamano}. Use 'S', 'M' o 'L'`);
      }
      this.tamanoFuente = tamano;
      this.onLog(`Tamaño de fuente: ${tamano}`);
    }

    /**
     * Imprimir un canvas directamente
     */
    async printCanvas(canvas) {
      if (!this.isConnected()) {
        throw new Error('No conectado. Llame a connect() primero.');
      }

      const tStart = performance.now();
      const t = (label) => {
        const elapsed = Math.round(performance.now() - tStart);
        this.onLog(`⏱ [${elapsed}ms] ${label}`);
      };

      t('Inicio printCanvas');

      const config = ANCHOS[this.ancho];
      const widthPx = config.widthPx;
      const widthBytes = config.widthBytes;

      // Si el canvas no tiene el ancho correcto, lo escalamos
      let canvasToUse = canvas;
      if (canvas.width !== widthPx) {
        canvasToUse = this._scaleCanvas(canvas, widthPx);
        t('Canvas escalado');
      }

      // Convertir canvas a raster bytes
      const raster = this._canvasToRaster(canvasToUse, widthBytes);
      const heightLines = canvasToUse.height;
      t(`Raster generado: ${widthPx}×${heightLines}px (${raster.length} bytes)`);

      // Secuencia de impresión
      await this._send(CMD.INIT);
      t('INIT enviado');
      await this._delay(50);

      const heatTime = densityToHeatTime(this.density);
      this.onLog(`Heat time: ${heatTime}, density: ${this.density}`);
      await this._send(CMD.HEAT_SETTINGS(7, heatTime, 2));
      t('HEAT enviado');
      await this._delay(20);
      await this._send(CMD.DENSITY(this.density));
      t('DENSITY enviado');
      await this._delay(30);

      // Header del raster
      await this._send(CMD.RASTER_HEADER(widthBytes, heightLines));
      t('RASTER_HEADER enviado - INICIO DE TRANSMISIÓN');

      // Enviar datos en chunks de 128 bytes (MTU safe)
      const totalChunks = Math.ceil(raster.length / CHUNK_SIZE);
      let chunksEnviados = 0;
      this.onLog(`Enviando ${totalChunks} chunks de ${CHUNK_SIZE} bytes`);

      for (let i = 0; i < raster.length; i += CHUNK_SIZE) {
        const chunk = raster.slice(i, Math.min(i + CHUNK_SIZE, raster.length));

        if (USE_ACK_FLOW && this.notifyChar) {
          // Modo flow control: esperar ACK del chunk anterior antes de enviar el siguiente
          const ackPromise = new Promise(resolve => {
            this._ackResolver = resolve;
            // Timeout de seguridad si no llega ACK
            setTimeout(() => {
              if (this._ackResolver === resolve) {
                this._ackResolver = null;
                resolve();
              }
            }, ACK_TIMEOUT_MS);
          });

          await this._send(chunk);
          await ackPromise;
        } else {
          // Modo delay fijo
          await this._send(chunk);
          await this._delay(CHUNK_DELAY_MS);
        }

        chunksEnviados++;

        if (this.onProgress) {
          this.onProgress(Math.round((chunksEnviados / totalChunks) * 100));
        }
      }
      t(`Transmisión completa (${totalChunks} chunks)`);

      // Feed final
      await this._delay(200);
      await this._send(CMD.FEED(this.feedAfterPrint));
      await this._delay(500);
      t('Impresión finalizada');
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
     * Optimizado para legibilidad en impresora térmica 203 DPI
     *
     * Usa configuración del negocio guardada en localStorage si está disponible.
     * Los campos pasados en ticket sobreescriben los de la configuración.
     */
    _renderTicketCanvas(ticket) {
      // Cargar configuración del negocio y combinar con datos del ticket
      const cfg = NegocioConfig.load();
      const t = {
        negocio: ticket.negocio || cfg.nombre_comercial || cfg.razon_social || 'MI NEGOCIO',
        razon_social: ticket.razon_social || cfg.razon_social || '',
        ruc: ticket.ruc || cfg.ruc || '',
        direccion: ticket.direccion || cfg.direccion || '',
        telefono: ticket.telefono || (cfg.mostrar_telefono ? cfg.telefono : '') || '',
        eslogan: ticket.eslogan || cfg.eslogan || '',
        numero: ticket.numero || '',
        cliente: ticket.cliente || '',
        items: ticket.items || [],
        total: ticket.total || 0,
        metodoPago: ticket.metodoPago || '',
        mensajePromo: ticket.mensajePromo || (cfg.mostrar_promo ? cfg.mensaje_promo : '') || '',
        mensajeSorteo: ticket.mensajeSorteo || cfg.mensaje_sorteo || '',
        pieMensaje: ticket.pieMensaje || cfg.mensaje_pie || '¡Gracias por su compra!',
      };

      const config = ANCHOS[this.ancho];
      const W = config.widthPx;
      const PAD = 12;

      // Presets de tamaños (en pixels a 203 DPI)
      const PRESETS = {
        'S': { titulo: 32, datos: 22, items: 22, total: 30, pie: 20, lineaH: 30 },
        'M': { titulo: 38, datos: 26, items: 26, total: 38, pie: 22, lineaH: 36 },
        'L': { titulo: 44, datos: 30, items: 30, total: 46, pie: 26, lineaH: 42 },
      };
      const P = PRESETS[this.tamanoFuente] || PRESETS['M'];

      const fmt = (n) => 'S/ ' + parseFloat(n || 0).toFixed(2);
      const ahora = new Date();
      const fecha = ahora.toLocaleDateString('es-PE', {
        timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric'
      });
      const hora = ahora.toLocaleTimeString('es-PE', {
        timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit'
      });

      // Caracteres por línea según ancho y tamaño
      const charsXLinea = this.ancho === '58mm'
        ? (this.tamanoFuente === 'L' ? 20 : this.tamanoFuente === 'M' ? 26 : 32)
        : (this.tamanoFuente === 'L' ? 32 : this.tamanoFuente === 'M' ? 38 : 46);

      const linea = '='.repeat(charsXLinea);
      const lineaFina = '-'.repeat(charsXLinea);

      const lineas = [];

      // ── CABECERA DEL NEGOCIO ─────────────────────────────
      lineas.push({ t: t.negocio.toUpperCase(), s: P.titulo, c: true });

      if (t.razon_social && t.razon_social.toUpperCase() !== t.negocio.toUpperCase()) {
        lineas.push({ t: t.razon_social, s: P.datos, c: true });
      }
      if (t.ruc) lineas.push({ t: 'RUC: ' + t.ruc, s: P.datos, c: true });
      if (t.direccion) lineas.push({ t: t.direccion, s: P.datos, c: true });
      if (t.telefono) lineas.push({ t: 'Cel: ' + t.telefono, s: P.datos, c: true });
      if (t.eslogan) {
        lineas.push({ t: '', s: P.datos });
        lineas.push({ t: t.eslogan, s: P.datos, c: true });
      }
      lineas.push({ t: linea, s: P.datos, c: true });

      // ── DATOS DEL TICKET ─────────────────────────────────
      lineas.push({ t: 'TICKET DE VENTA', s: P.titulo - 6, c: true });
      if (t.numero) lineas.push({ t: 'N°: ' + t.numero, s: P.datos });
      lineas.push({ t: fecha + '  ' + hora, s: P.datos });
      if (t.cliente) lineas.push({ t: 'Cliente: ' + t.cliente, s: P.datos });
      lineas.push({ t: lineaFina, s: P.datos, c: true });

      // ── ITEMS ────────────────────────────────────────────
      const maxNombre = charsXLinea - 4;
      for (const item of t.items) {
        const nombre = (item.nombre || item.name || '').substring(0, maxNombre);
        lineas.push({ t: nombre, s: P.items });
        const qty = parseFloat(item.cantidad || item.quantity || 0);
        const qtyStr = qty % 1 === 0 ? qty.toString() : qty.toFixed(2);
        const precio = item.precio || item.price || 0;
        const totalItem = fmt(qty * precio);
        lineas.push({ t: '  ' + qtyStr + ' x ' + fmt(precio) + ' = ' + totalItem, s: P.items });
      }

      lineas.push({ t: lineaFina, s: P.datos, c: true });

      // ── TOTAL ────────────────────────────────────────────
      lineas.push({ t: 'TOTAL: ' + fmt(t.total), s: P.total, c: true });
      if (t.metodoPago) {
        lineas.push({ t: 'Pago: ' + t.metodoPago, s: P.datos, c: true });
      }
      lineas.push({ t: linea, s: P.datos, c: true });

      // ── MENSAJE PROMOCIONAL ──────────────────────────────
      if (t.mensajePromo) {
        const lineasPromo = t.mensajePromo.split('\n');
        for (const lp of lineasPromo) {
          if (lp.trim()) lineas.push({ t: lp, s: P.pie, c: true });
        }
        lineas.push({ t: '', s: P.datos });
      }

      // ── SORTEO ───────────────────────────────────────────
      if (t.mensajeSorteo) {
        lineas.push({ t: '★ SORTEO ★', s: P.pie, c: true });
        const lineasSorteo = t.mensajeSorteo.split('\n');
        for (const ls of lineasSorteo) {
          if (ls.trim()) lineas.push({ t: ls, s: P.pie, c: true });
        }
        lineas.push({ t: '', s: P.datos });
      }

      // ── PIE ──────────────────────────────────────────────
      if (t.pieMensaje) {
        const lineasPie = t.pieMensaje.split('\n');
        for (const lp of lineasPie) {
          if (lp.trim()) lineas.push({ t: lp, s: P.pie, c: true });
        }
      }

      // Espacios al final
      lineas.push({ t: '', s: P.datos });
      lineas.push({ t: '', s: P.datos });

      // Calcular altura total con line-height proporcional al tamaño
      let alturaTotal = PAD * 2;
      for (const l of lineas) {
        alturaTotal += Math.max(P.lineaH, l.s * 1.3);
      }

      // Crear canvas con resolución correcta
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = Math.ceil(alturaTotal);
      const ctx = canvas.getContext('2d');

      // Fondo blanco sólido
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, W, canvas.height);
      ctx.fillStyle = 'black';

      // CRÍTICO: desactivar antialiasing del texto para impresión térmica nítida
      ctx.imageSmoothingEnabled = false;
      ctx.textRendering = 'geometricPrecision';

      let y = PAD;
      for (const l of lineas) {
        const lh = Math.max(P.lineaH, l.s * 1.3);
        if (!l.t) {
          y += lh;
          continue;
        }
        // SIEMPRE en bold para legibilidad en térmica
        ctx.font = `bold ${l.s}px 'Courier New', 'Consolas', monospace`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'black';

        if (l.c) {
          ctx.textAlign = 'center';
          ctx.fillText(l.t, W / 2, y);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(l.t, PAD, y);
        }
        y += lh;
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
     * Threshold ajustado para texto nítido en impresión térmica
     */
    _canvasToRaster(canvas, widthBytes) {
      const W = canvas.width;
      const H = canvas.height;
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, W, H);
      const raster = new Uint8Array(widthBytes * H);

      // Threshold alto para que píxeles semi-grises (antialiasing) cuenten como negro
      // Esto hace el texto mucho más nítido en térmica
      const THRESHOLD = 180;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W && x < widthBytes * 8; x++) {
          const idx = (y * W + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          // Considerar pixeles transparentes como blancos
          const alpha = a / 255;
          const luminancia = (r * 0.299 + g * 0.587 + b * 0.114);
          const valor = luminancia * alpha + 255 * (1 - alpha);

          // Threshold más alto = más píxeles capturados como negro = letras más sólidas
          if (valor < THRESHOLD) {
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
        // SIEMPRE usar writeValue (con response) para garantizar orden
        // writeWithoutResponse puede causar pérdida/desorden en M221
        if (this.writeChar.properties.write) {
          await this.writeChar.writeValue(bytes);
        } else if (this.writeChar.properties.writeWithoutResponse) {
          await this.writeChar.writeValueWithoutResponse(bytes);
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
  global.PSPNegocioConfig = NegocioConfig;

})(typeof window !== 'undefined' ? window : globalThis);