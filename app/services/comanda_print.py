"""
QueVendi — Layout ESC/POS de la comanda de cocina
==================================================

Genera los bytes que se envían al Print Agent (C:\\QueVendiPrint) para
imprimir la comanda en la ticketera térmica.

DIFERENCIAS CON EL TICKET DEL CLIENTE
-------------------------------------
La comanda NO es un comprobante: es una orden de trabajo.
  · Sin precios, sin totales, sin IGV, sin RUC.
  · Número de comanda enorme: es lo que grita el cocinero.
  · Nombres de plato a doble tamaño, legibles a un metro y con vapor.
  · Notas del ítem destacadas ("sin ají" cambia el plato).

POR QUÉ /print/raw Y NO /print/text
-----------------------------------
El endpoint `/print/text` del agente imprime todo con la fuente por
defecto (hace `t.line(linea)` sin comandos de tamaño). La comanda
necesita doble alto y ancho, así que se generan aquí los bytes ESC/POS
y se mandan a `/print/raw`. Se incluye igualmente una versión en texto
plano como respaldo.

CODIFICACIÓN
------------
El agente inicializa la impresora en code page 858 (`ESC t 0x13`). El
`cp858` de Python produce exactamente los mismos bytes que el CHAR_MAP
del agente para el español (í→0xA1, ñ→0xA4, ú→0xA3), así que se usa el
códec estándar en vez de duplicar la tabla.
"""

import base64
from datetime import datetime
from typing import Optional

from app.core.tiempo import a_hora_peru, ahora_peru

# 80mm = 48 caracteres. A doble ancho entran la mitad.
ANCHO = 48
ANCHO_2X = ANCHO // 2

ESC = b"\x1b"
GS = b"\x1d"
LF = b"\x0a"

INIT = ESC + b"\x40"
CODEPAGE_858 = ESC + b"\x74\x13"
CHARSET_SPAIN = ESC + b"\x52\x07"

ALIGN_LEFT = ESC + b"\x61\x00"
ALIGN_CENTER = ESC + b"\x61\x01"

BOLD_ON = ESC + b"\x45\x01"
BOLD_OFF = ESC + b"\x45\x00"

SIZE_NORMAL = GS + b"\x21\x00"
SIZE_2H = GS + b"\x21\x01"
SIZE_2X = GS + b"\x21\x11"      # doble alto + doble ancho
SIZE_3X = GS + b"\x21\x22"      # triple: sólo para el número

CUT = GS + b"\x56\x41\x03"


def _enc(texto: str) -> bytes:
    """Texto → bytes en code page 858 (el que usa la impresora)."""
    return (texto or "").encode("cp858", errors="replace")


def _fmt_cantidad(c) -> str:
    """1.0 → '1'   0.5 → '0.5'   (no imprimir '1.0 x Ceviche')."""
    try:
        f = float(c)
    except (TypeError, ValueError):
        return str(c)
    return str(int(f)) if f == int(f) else ("%g" % f)


def _envolver(texto: str, ancho: int) -> list:
    """Parte un texto largo en líneas sin cortar palabras a la mitad."""
    palabras = (texto or "").split()
    if not palabras:
        return [""]
    lineas, actual = [], palabras[0]
    for p in palabras[1:]:
        if len(actual) + 1 + len(p) <= ancho:
            actual += " " + p
        else:
            lineas.append(actual)
            actual = p
    lineas.append(actual)
    return lineas


def construir_escpos(comanda: dict) -> bytes:
    """
    Bytes ESC/POS de la comanda, listos para POST a /print/raw.

    Args:
        comanda: el dict de comanda_service.obtener_comanda()
    """
    out = bytearray()
    out += INIT + CODEPAGE_858 + CHARSET_SPAIN

    # ── Cabecera: mesa (si la hay) y número, bien grandes ──
    out += ALIGN_CENTER + BOLD_ON
    mesa = (comanda.get("mesa") or "").strip()
    if mesa:
        # La mesa va primero y en el tamaño máximo: es el dato que la
        # mesera necesita leer de un vistazo al recoger el plato.
        out += SIZE_3X + _enc("MESA %s" % mesa.upper()[:12]) + LF
        out += SIZE_2X + _enc("COMANDA %s" % comanda.get("numero", "?")) + LF
    else:
        out += SIZE_2X + _enc("*** COMANDA ***") + LF
        out += SIZE_3X + _enc("N %s" % comanda.get("numero", "?")) + LF
    out += SIZE_NORMAL + BOLD_OFF
    out += _enc("=" * ANCHO) + LF

    # ── Hora y cajero ──
    hora = _hora_legible(comanda.get("sent_at"))
    cajero = (comanda.get("cajero_nombre") or "").strip()
    out += ALIGN_LEFT
    izq = "Hora: %s" % hora
    der = ("Cajero: %s" % cajero[:18]) if cajero else ""
    espacios = max(ANCHO - len(izq) - len(der), 1)
    out += _enc(izq + (" " * espacios) + der) + LF
    out += _enc("=" * ANCHO) + LF + LF

    # ── Ítems: doble tamaño ──
    for item in comanda.get("items", []):
        cant = _fmt_cantidad(item.get("cantidad", 1))
        nombre = (item.get("nombre") or "").upper()
        prefijo = "%s x " % cant

        out += BOLD_ON + SIZE_2X
        for i, linea in enumerate(_envolver(nombre, ANCHO_2X - len(prefijo))):
            out += _enc((prefijo if i == 0 else " " * len(prefijo)) + linea) + LF
        out += SIZE_NORMAL + BOLD_OFF

        # Nota del ítem: cambia cómo se cocina, va destacada.
        nota = (item.get("nota") or "").strip()
        if nota:
            out += SIZE_2H
            for linea in _envolver(">> " + nota.upper(), ANCHO):
                out += _enc("   " + linea) + LF
            out += SIZE_NORMAL
        out += LF

    # ── Nota general ──
    nota_gral = (comanda.get("nota") or "").strip()
    if nota_gral:
        out += _enc("-" * ANCHO) + LF
        out += ALIGN_CENTER + BOLD_ON + SIZE_2H
        for linea in _envolver(nota_gral.upper(), ANCHO_2X):
            out += _enc(linea) + LF
        out += SIZE_NORMAL + BOLD_OFF + ALIGN_LEFT

    out += _enc("=" * ANCHO) + LF
    out += ALIGN_CENTER + _enc("QueVendi") + LF
    out += ALIGN_LEFT

    out += LF * 2
    out += CUT
    return bytes(out)


def construir_texto(comanda: dict) -> str:
    """
    Versión en texto plano de la comanda.

    Sirve de respaldo para `/print/text` y para mostrarla en pantalla
    cuando no hay impresora conectada.
    """
    mesa = (comanda.get("mesa") or "").strip()
    if mesa:
        lineas = [
            ("MESA %s" % mesa.upper()[:12]).center(ANCHO),
            ("COMANDA %s" % comanda.get("numero", "?")).center(ANCHO),
            "=" * ANCHO,
        ]
    else:
        lineas = [
            "*** COMANDA ***".center(ANCHO),
            ("N %s" % comanda.get("numero", "?")).center(ANCHO),
            "=" * ANCHO,
        ]
    hora = _hora_legible(comanda.get("sent_at"))
    cajero = (comanda.get("cajero_nombre") or "").strip()
    izq = "Hora: %s" % hora
    der = ("Cajero: %s" % cajero[:18]) if cajero else ""
    lineas.append(izq + " " * max(ANCHO - len(izq) - len(der), 1) + der)
    lineas.append("=" * ANCHO)
    lineas.append("")

    for item in comanda.get("items", []):
        cant = _fmt_cantidad(item.get("cantidad", 1))
        lineas.append("%s x %s" % (cant, (item.get("nombre") or "").upper()))
        nota = (item.get("nota") or "").strip()
        if nota:
            lineas.append("     >> %s" % nota.upper())
        lineas.append("")

    nota_gral = (comanda.get("nota") or "").strip()
    if nota_gral:
        lineas.append("-" * ANCHO)
        lineas.append(nota_gral.upper().center(ANCHO))

    lineas.append("=" * ANCHO)
    return "\n".join(lineas)


def _hora_legible(sent_at) -> str:
    """Hora de Lima en HH:MM a partir de un ISO string o datetime."""
    if not sent_at:
        return ahora_peru().strftime("%H:%M")
    if isinstance(sent_at, str):
        try:
            sent_at = datetime.fromisoformat(sent_at)
        except ValueError:
            return ahora_peru().strftime("%H:%M")
    try:
        return a_hora_peru(sent_at).strftime("%H:%M")
    except Exception:
        return ahora_peru().strftime("%H:%M")


def payload_impresion(comanda: dict) -> dict:
    """
    Lo que el navegador necesita para imprimir.

    El Print Agent corre en la PC del cliente, no en el servidor: por eso
    el backend sólo ARMA el contenido y es el navegador quien hace el POST
    a http://localhost:9638.
    """
    escpos = construir_escpos(comanda)
    return {
        "escpos_base64": base64.b64encode(escpos).decode("ascii"),
        "texto": construir_texto(comanda),
        "bytes": len(escpos),
        "agente_url": "http://localhost:9638/print/raw",
        "agente_url_texto": "http://localhost:9638/print/text",
    }
