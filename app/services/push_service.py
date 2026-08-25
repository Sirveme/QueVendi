"""
QueVendi — Notificaciones push y centro de resúmenes
=====================================================

La infraestructura ya existía a medias: la tabla `push_subscriptions`,
el modelo, y el `sw.js` que sabe recibir un evento 'push'. Faltaban las
tres piezas que lo hacían funcionar — la librería, las claves VAPID y
los endpoints de suscripción — y por eso nunca llegó una notificación.

CENTRO DE RESÚMENES
-------------------
Los avisos no se escriben sueltos: cada tipo es un `TipoResumen` con su
clave, su etiqueta para el usuario y una función que arma el mensaje.
Agregar uno nuevo (el más vendido, márgenes, vencimientos de SUNAT…) es
registrar una entrada más en `TIPOS`, sin tocar el envío, ni las
preferencias, ni la UI.

En el MVP hay dos: `caja` y `stock`. El resto es roadmap y NO se
implementa todavía.

THROTTLE
--------
El aviso de stock mínimo se repetiría en cada venta del mismo producto.
`push_enviados` guarda qué se mandó y a quién, y el tipo declara su
propia ventana: stock, una vez por producto y día operativo de Lima.
"""

import json
import logging
import os
from dataclasses import dataclass
from typing import Callable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.tiempo import ahora_peru, dia_operativo_peru, hoy_peru

logger = logging.getLogger(__name__)

_migrado = False

MIGRATION_SQL = """
-- Suscripciones: la tabla ya existe (modelo PushSubscription). Aquí sólo
-- se añade lo que faltaba para operar por tienda y por preferencia.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS store_id INTEGER;
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS preferencias JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_push_subs_store ON push_subscriptions(store_id);

-- Qué se envió ya, para no repetir el mismo aviso.
CREATE TABLE IF NOT EXISTS push_enviados (
    id          SERIAL PRIMARY KEY,
    store_id    INTEGER NOT NULL,
    tipo        VARCHAR(40) NOT NULL,
    -- Identifica el hecho concreto: para stock, el id del producto.
    clave       VARCHAR(120) NOT NULL,
    fecha_operativa DATE NOT NULL,
    enviado_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_push_enviado UNIQUE (store_id, tipo, clave, fecha_operativa)
);

CREATE INDEX IF NOT EXISTS idx_push_enviados_store_fecha
    ON push_enviados(store_id, fecha_operativa);
"""

MIGRATION_STORE_CONFIG_SQL = """
ALTER TABLE store_config
    ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT FALSE;
"""


def _ensure_tables(db: Session, forzar: bool = False) -> None:
    global _migrado
    if _migrado and not forzar:
        return
    try:
        db.execute(text(MIGRATION_SQL))
        db.execute(text(MIGRATION_STORE_CONFIG_SQL))
        db.commit()
        _migrado = True
    except Exception as e:
        db.rollback()
        logger.warning(f"[Push] Migración: {e}")


def push_enabled(db: Session, store_id: int) -> bool:
    """¿La tienda tiene los avisos activados? Apagado por defecto."""
    try:
        row = db.execute(text(
            "SELECT push_enabled FROM store_config WHERE store_id = :s"
        ), {"s": store_id}).fetchone()
        return bool(row[0]) if row and row[0] is not None else False
    except Exception:
        return False


# ════════════════════════════════════════════════
# CENTRO DE RESÚMENES
# ════════════════════════════════════════════════

@dataclass(frozen=True)
class TipoResumen:
    """
    Un tipo de aviso.

    clave        identificador estable (va en las preferencias del usuario)
    etiqueta     cómo se le presenta al dueño en su perfil
    icono        emoji para la notificación
    throttle     'ninguno' → siempre se manda
                 'diario'  → una vez por clave y día operativo
    construir    (datos) -> {"titulo", "cuerpo", "url"}
    """
    clave: str
    etiqueta: str
    icono: str
    throttle: str
    construir: Callable[[dict], dict]


def _msg_caja_abierta(d: dict) -> dict:
    return {
        "titulo": f"{d.get('icono','🔓')} Caja abierta",
        "cuerpo": (f"{d.get('tienda','Tu negocio')} — abrió {d.get('usuario','alguien')} "
                   f"a las {d.get('hora','')}"),
        "url": "/caja",
    }


def _msg_caja_cerrada(d: dict) -> dict:
    monto = d.get("total", 0)
    cuerpo = f"Total del día: S/ {monto:,.2f}"
    if d.get("diferencia") is not None:
        dif = float(d["diferencia"])
        if abs(dif) > 0.10:
            cuerpo += f" · descuadre S/ {dif:,.2f}"
    return {"titulo": "🔒 Caja cerrada", "cuerpo": cuerpo, "url": "/caja"}


def _msg_stock_minimo(d: dict) -> dict:
    return {
        "titulo": "📦 Stock mínimo",
        "cuerpo": (f"{d.get('producto','Un producto')} llegó a su mínimo "
                   f"({d.get('cantidad', 0):g} restantes)"),
        "url": "/productos",
    }


# Registro de tipos. Agregar uno nuevo = añadir una entrada aquí.
#
# ROADMAP (NO implementar sin pedirlo): mayor comprador del día,
# márgenes, vencimientos SUNAT, movimientos de kardex.
TIPOS = {
    "caja_abierta": TipoResumen("caja_abierta", "Apertura de caja", "🔓",
                                "ninguno", _msg_caja_abierta),
    "caja_cerrada": TipoResumen("caja_cerrada", "Cierre de caja", "🔒",
                                "ninguno", _msg_caja_cerrada),
    "stock_minimo": TipoResumen("stock_minimo", "Stock mínimo", "📦",
                                "diario", _msg_stock_minimo),
}

# Cómo se agrupan en el perfil del usuario: una casilla por grupo.
GRUPOS = {
    "caja": ("caja_abierta", "caja_cerrada"),
    "stock": ("stock_minimo",),
}


def grupo_de(tipo: str) -> Optional[str]:
    for grupo, tipos in GRUPOS.items():
        if tipo in tipos:
            return grupo
    return None


# ════════════════════════════════════════════════
# SUSCRIPCIONES
# ════════════════════════════════════════════════

def suscribir(db: Session, user_id: int, store_id: int, sub: dict,
              user_agent: str = "", preferencias: Optional[dict] = None) -> dict:
    """
    Guarda la suscripción del navegador. No commitea.

    El endpoint es único: si el mismo dispositivo se vuelve a suscribir,
    se actualiza en vez de duplicar.
    """
    endpoint = (sub or {}).get("endpoint")
    keys = (sub or {}).get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("Suscripción incompleta")

    prefs = json.dumps(preferencias or {"caja": True, "stock": True})

    row = db.execute(text("""
        INSERT INTO push_subscriptions
            (user_id, store_id, endpoint, p256dh, auth, user_agent,
             activo, preferencias)
        VALUES (:u, :s, :e, :p, :a, :ua, TRUE, CAST(:prefs AS jsonb))
        ON CONFLICT (endpoint) DO UPDATE
            SET user_id = :u, store_id = :s, p256dh = :p, auth = :a,
                activo = TRUE, preferencias = CAST(:prefs AS jsonb),
                last_used_at = NOW()
        RETURNING id
    """), {"u": user_id, "s": store_id, "e": endpoint,
           "p": keys["p256dh"], "a": keys["auth"],
           "ua": (user_agent or "")[:500], "prefs": prefs}).fetchone()

    return {"id": row.id, "endpoint": endpoint[:40] + "…"}


def revocar(db: Session, user_id: int, endpoint: str) -> bool:
    """Da de baja un dispositivo. No commitea."""
    r = db.execute(text("""
        UPDATE push_subscriptions SET activo = FALSE
        WHERE endpoint = :e AND user_id = :u
        RETURNING id
    """), {"e": endpoint, "u": user_id}).fetchone()
    return r is not None


def preferencias_de(db: Session, user_id: int) -> dict:
    row = db.execute(text("""
        SELECT preferencias FROM push_subscriptions
        WHERE user_id = :u AND activo = TRUE
        ORDER BY id DESC LIMIT 1
    """), {"u": user_id}).fetchone()
    if not row or not row[0]:
        return {"caja": True, "stock": True}
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def guardar_preferencias(db: Session, user_id: int, prefs: dict) -> dict:
    """Qué avisos quiere recibir este usuario. No commitea."""
    limpias = {g: bool(prefs.get(g, True)) for g in GRUPOS}
    db.execute(text("""
        UPDATE push_subscriptions SET preferencias = CAST(:p AS jsonb)
        WHERE user_id = :u AND activo = TRUE
    """), {"p": json.dumps(limpias), "u": user_id})
    return limpias


# ════════════════════════════════════════════════
# ENVÍO
# ════════════════════════════════════════════════

def _destinatarios(db: Session, store_id: int, grupo: str) -> list:
    """
    Suscripciones activas de owners/admins de la tienda que quieren
    este grupo de avisos.

    El filtro por store_id va en el JOIN contra users: una suscripción
    de otra tienda no entra aunque el store_id de la fila esté mal.
    """
    filas = db.execute(text("""
        SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.preferencias
        FROM push_subscriptions ps
        JOIN users u ON u.id = ps.user_id
        WHERE u.store_id = :s
          AND u.role IN ('owner', 'admin')
          AND u.is_active = TRUE
          AND ps.activo = TRUE
    """), {"s": store_id}).fetchall()

    salida = []
    for f in filas:
        prefs = f.preferencias if isinstance(f.preferencias, dict) else (
            json.loads(f.preferencias) if f.preferencias else {})
        if prefs.get(grupo, True):
            salida.append({"id": f.id, "endpoint": f.endpoint,
                           "p256dh": f.p256dh, "auth": f.auth})
    return salida


def _ya_enviado(db: Session, store_id: int, tipo: str, clave: str) -> bool:
    """True si este aviso ya salió hoy (throttle diario)."""
    row = db.execute(text("""
        SELECT 1 FROM push_enviados
        WHERE store_id = :s AND tipo = :t AND clave = :c AND fecha_operativa = :f
    """), {"s": store_id, "t": tipo, "c": str(clave), "f": hoy_peru()}).fetchone()
    return row is not None


def _marcar_enviado(db: Session, store_id: int, tipo: str, clave: str) -> None:
    db.execute(text("""
        INSERT INTO push_enviados (store_id, tipo, clave, fecha_operativa)
        VALUES (:s, :t, :c, :f)
        ON CONFLICT (store_id, tipo, clave, fecha_operativa) DO NOTHING
    """), {"s": store_id, "t": tipo, "c": str(clave), "f": hoy_peru()})


def notificar(db: Session, store_id: int, tipo: str, datos: dict,
              clave: Optional[str] = None) -> dict:
    """
    Envía un aviso del tipo indicado a quien corresponda.

    Es best-effort en todos sus pasos: si la tienda no tiene push, si no
    hay claves VAPID o si un endpoint está muerto, se registra y se
    sigue. Un aviso nunca debe tumbar la operación que lo dispara.

    Returns:
        {"enviados": n, "motivo": str|None}
    """
    _ensure_tables(db)

    t = TIPOS.get(tipo)
    if not t:
        return {"enviados": 0, "motivo": f"tipo desconocido: {tipo}"}

    if not push_enabled(db, store_id):
        return {"enviados": 0, "motivo": "push desactivado en la tienda"}

    # Throttle
    if t.throttle == "diario":
        c = clave or tipo
        if _ya_enviado(db, store_id, tipo, c):
            return {"enviados": 0, "motivo": "ya se envió hoy"}

    grupo = grupo_de(tipo) or tipo
    subs = _destinatarios(db, store_id, grupo)
    if not subs:
        return {"enviados": 0, "motivo": "nadie suscrito"}

    mensaje = t.construir(datos)
    payload = json.dumps({
        "title": mensaje["titulo"],
        "body": mensaje["cuerpo"],
        "url": mensaje.get("url", "/"),
        "tipo": tipo,
    })

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("[Push] pywebpush no instalado — %d avisos omitidos", len(subs))
        return {"enviados": 0, "motivo": "pywebpush no instalado"}

    priv = os.getenv("VAPID_PRIVATE_KEY")
    if not priv:
        logger.warning("[Push] VAPID_PRIVATE_KEY sin configurar")
        return {"enviados": 0, "motivo": "VAPID no configurado"}

    claims = {"sub": os.getenv("VAPID_CLAIMS_EMAIL", "mailto:soporte@quevendi.pro")}
    enviados, muertos = 0, []

    for s in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": s["endpoint"],
                    "keys": {"p256dh": s["p256dh"], "auth": s["auth"]},
                },
                data=payload,
                vapid_private_key=priv,
                vapid_claims=dict(claims),
            )
            enviados += 1
        except WebPushException as e:
            # 404/410 = el navegador ya no existe: se desactiva sola.
            codigo = getattr(getattr(e, "response", None), "status_code", None)
            if codigo in (404, 410):
                muertos.append(s["id"])
            else:
                logger.warning(f"[Push] Falló envío a {s['id']}: {e}")
        except Exception as e:
            logger.warning(f"[Push] Error inesperado en {s['id']}: {e}")

    if muertos:
        db.execute(text("UPDATE push_subscriptions SET activo = FALSE WHERE id = ANY(:ids)"),
                   {"ids": muertos})

    if enviados and t.throttle == "diario":
        _marcar_enviado(db, store_id, tipo, clave or tipo)

    try:
        db.commit()
    except Exception:
        db.rollback()

    logger.info(f"[Push] {tipo} → {enviados}/{len(subs)} enviados (store {store_id})")
    return {"enviados": enviados, "motivo": None, "muertos": len(muertos)}


# ════════════════════════════════════════════════
# DISPARADORES DEL MVP
# ════════════════════════════════════════════════

def aviso_caja_abierta(db: Session, store_id: int, usuario: str,
                       tienda: str = "") -> dict:
    return notificar(db, store_id, "caja_abierta", {
        "usuario": usuario or "un usuario",
        "tienda": tienda or "Tu negocio",
        "hora": ahora_peru().strftime("%H:%M"),
    })


def aviso_caja_cerrada(db: Session, store_id: int, total: float,
                       diferencia: Optional[float] = None) -> dict:
    return notificar(db, store_id, "caja_cerrada",
                     {"total": float(total or 0), "diferencia": diferencia})


def aviso_stock_minimo(db: Session, store_id: int, product_id: int,
                       producto: str, cantidad: float) -> dict:
    """Un aviso por producto y día operativo: si no, sonaría en cada venta."""
    return notificar(db, store_id, "stock_minimo",
                     {"producto": producto, "cantidad": float(cantidad or 0)},
                     clave=str(product_id))


def revisar_stock_de_venta(db: Session, store_id: int, product_ids: list) -> int:
    """
    Tras una venta, avisa de los productos que quedaron en su mínimo.

    Se llama con los productos que acaban de moverse, no con el catálogo
    entero: sólo puede cruzar el umbral lo que se acaba de vender.
    """
    if not product_ids:
        return 0

    filas = db.execute(text("""
        SELECT id, name, stock, COALESCE(min_stock_alert, 0) AS minimo
        FROM products
        WHERE store_id = :s AND id = ANY(:ids)
          AND is_active = TRUE AND deleted_at IS NULL
          AND COALESCE(min_stock_alert, 0) > 0
          AND stock <= COALESCE(min_stock_alert, 0)
    """), {"s": store_id, "ids": list(product_ids)}).fetchall()

    n = 0
    for f in filas:
        r = aviso_stock_minimo(db, store_id, f.id, f.name, float(f.stock or 0))
        n += r.get("enviados", 0)
    return n
