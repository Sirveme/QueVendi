"""
QueVendi — Módulo Cocina: esquema y correlativo de comandas
===========================================================

Alcance (Opción C): la comanda es una entidad propia, independiente de
`sales`. Se envía a cocina cuando el cajero lo decide y, si más tarde
se cobra, se enlaza con la venta vía `comandas.sale_id`. Eso permite
tanto cobrar por adelantado como cobrar al final, sin duplicar el
concepto de venta.

Alcance deliberadamente ACOTADO — restaurantes chicos:
    cajero pide → cocina imprime comanda → se entrega.
No hay estaciones de cocina, ni mesas, ni zonas de mozo, ni delivery.

MIGRACIÓN
---------
El proyecto no usa Alembic (la tabla `alembic_version` está vacía). El
patrón vigente es auto-migración idempotente al primer uso, igual que
`caja.py`, `store_config.py` y `billing_offline.py`. `_ensure_tables()`
es seguro de llamar en cada request.

CORRELATIVO THREAD-SAFE
-----------------------
El número de comanda se reinicia cada día operativo de Lima y es por
tienda: el cocinero necesita ver "Comanda 7", no "Comanda 41832".

Por eso NO se usa una SEQUENCE de Postgres (es global y no reinicia por
día ni por tienda). Se usan tres capas:

  1. `pg_advisory_xact_lock(store_id, fecha)` — serializa la asignación
     entre cajeros de la MISMA tienda y día. Se libera solo al terminar
     la transacción. No bloquea a otras tiendas.
  2. `MAX(numero)+1` calculado dentro del propio INSERT, ya bajo el lock.
  3. `UNIQUE (store_id, fecha_operativa, numero)` como red de seguridad,
     con reintento si algo se cuela.

Por qué el lock es imprescindible y no basta con UNIQUE + retry: en el
nivel de aislamiento READ COMMITTED, una transacción no ve los INSERT
que otras aún no han confirmado. Sin lock, N cajeros simultáneos leen
todos el mismo MAX, uno gana y los demás reintentan contra el mismo
número una y otra vez — no convergen. Medido con 12 hilos concurrentes:
sin lock sólo 5 lograban insertar; con lock, los 12 obtienen 1..12.

Esto corrige de raíz el `MAX()+1` sin lock heredado de Metraes, donde la
colisión además se materializaba en silencio por no existir el UNIQUE.
"""

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.tiempo import dia_operativo_peru, hoy_peru

logger = logging.getLogger(__name__)

# Reintentos ante colisión de correlativo. 5 cubre de sobra la
# concurrencia real de un restaurante chico (2-3 cajas como mucho).
MAX_INTENTOS_CORRELATIVO = 5

ESTADOS_COMANDA = ("sent", "preparing", "ready", "served")
ESTADOS_ITEM = ("sent", "preparing", "ready", "served")


# ════════════════════════════════════════════════════════════════
# MIGRACIÓN IDEMPOTENTE
# ════════════════════════════════════════════════════════════════

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS comandas (
    id                SERIAL PRIMARY KEY,
    store_id          INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Correlativo visible para cocina: reinicia cada día, por tienda.
    numero            INTEGER NOT NULL,
    fecha_operativa   DATE    NOT NULL,

    -- Se enlaza al cobrar. NULL mientras el pedido no se haya cobrado.
    sale_id           INTEGER REFERENCES sales(id) ON DELETE SET NULL,

    estado            VARCHAR(20) NOT NULL DEFAULT 'sent',

    cajero_id         INTEGER REFERENCES users(id),
    cajero_nombre     VARCHAR(200),
    nota              TEXT,

    sent_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ready_at          TIMESTAMP WITH TIME ZONE,
    served_at         TIMESTAMP WITH TIME ZONE,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_comanda_store_fecha_numero
        UNIQUE (store_id, fecha_operativa, numero)
);

CREATE TABLE IF NOT EXISTS comanda_items (
    id           SERIAL PRIMARY KEY,
    comanda_id   INTEGER NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id),

    -- Snapshot del nombre: si el producto se renombra o borra, la
    -- comanda histórica sigue siendo legible.
    nombre       VARCHAR(200)  NOT NULL,
    cantidad     NUMERIC(10,3) NOT NULL DEFAULT 1,
    unidad       VARCHAR(20),
    nota         VARCHAR(200),

    estado       VARCHAR(20) NOT NULL DEFAULT 'sent',
    started_at   TIMESTAMP WITH TIME ZONE,
    ready_at     TIMESTAMP WITH TIME ZONE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Tablets/celulares autorizados a abrir la pantalla de cocina sin login.
CREATE TABLE IF NOT EXISTS cocina_devices (
    id           SERIAL PRIMARY KEY,
    store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    token        VARCHAR(64) NOT NULL UNIQUE,
    nombre       VARCHAR(100),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_cocina_devices_store
    ON cocina_devices(store_id);

CREATE INDEX IF NOT EXISTS idx_comandas_store_fecha
    ON comandas(store_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_comandas_store_estado
    ON comandas(store_id, estado);
CREATE INDEX IF NOT EXISTS idx_comandas_sale
    ON comandas(sale_id);
CREATE INDEX IF NOT EXISTS idx_comanda_items_comanda
    ON comanda_items(comanda_id);
"""

# Feature flag por tienda. Mismo patrón que caja_apertura_requerida.
MIGRATION_STORE_CONFIG_SQL = """
ALTER TABLE store_config
    ADD COLUMN IF NOT EXISTS kitchen_enabled BOOLEAN DEFAULT FALSE;
"""


def _ensure_tables(db: Session) -> None:
    """Crea tablas e índices del módulo cocina si no existen (idempotente)."""
    try:
        db.execute(text(MIGRATION_SQL))
        db.execute(text(MIGRATION_STORE_CONFIG_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[Cocina] Migración: {e}")


# ════════════════════════════════════════════════════════════════
# FEATURE FLAG
# ════════════════════════════════════════════════════════════════

def kitchen_enabled(db: Session, store_id: int) -> bool:
    """
    ¿Esta tienda tiene el módulo cocina activado?

    Por defecto FALSE: una bodega que actualice no ve ningún cambio.
    """
    try:
        row = db.execute(text(
            "SELECT kitchen_enabled FROM store_config WHERE store_id = :sid"
        ), {"sid": store_id}).fetchone()
        return bool(row[0]) if row and row[0] is not None else False
    except Exception as e:
        logger.warning(f"[Cocina] No se pudo leer kitchen_enabled: {e}")
        return False


# ════════════════════════════════════════════════════════════════
# DISPOSITIVOS DE COCINA
# ════════════════════════════════════════════════════════════════
#
# La pantalla de cocina no usa login: en un restaurante la tablet vive
# colgada junto a la plancha y nadie va a escribir usuario y contraseña
# con las manos llenas. En su lugar, el dueño genera un enlace con un
# token largo por dispositivo, lo abre una vez y lo deja fijo.
#
# El token da acceso ACOTADO: ver la cola y mover estados de su tienda.
# No permite enviar comandas, ni ver ventas, ni tocar configuración.
# Si se pierde la tablet, se revoca ese token y los demás siguen.

def crear_device_token(db: Session, store_id: int, nombre: str = "") -> dict:
    """Genera un token para una pantalla de cocina. No commitea."""
    import secrets
    token = secrets.token_urlsafe(32)
    row = db.execute(text("""
        INSERT INTO cocina_devices (store_id, token, nombre)
        VALUES (:sid, :tok, :nom)
        RETURNING id, token, nombre, created_at
    """), {"sid": store_id, "tok": token, "nom": (nombre or "Pantalla de cocina")[:100]}).fetchone()
    return {
        "id": row.id,
        "token": row.token,
        "nombre": row.nombre,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def validar_device_token(db: Session, token: str) -> Optional[int]:
    """
    Devuelve el store_id si el token es válido y está activo.

    Actualiza `last_seen_at` para que el dueño sepa qué pantallas siguen
    vivas. Devuelve None si el token no existe, está revocado o la tienda
    tiene la cocina apagada.
    """
    if not token:
        return None

    row = db.execute(text("""
        SELECT id, store_id FROM cocina_devices
        WHERE token = :tok AND is_active = TRUE
    """), {"tok": token}).fetchone()

    if not row:
        return None

    if not kitchen_enabled(db, row.store_id):
        return None

    try:
        db.execute(text("UPDATE cocina_devices SET last_seen_at = NOW() WHERE id = :id"),
                   {"id": row.id})
        db.commit()
    except Exception:
        db.rollback()   # marcar la última visita nunca debe tumbar la petición

    return row.store_id


def listar_devices(db: Session, store_id: int) -> list:
    rows = db.execute(text("""
        SELECT id, nombre, is_active, created_at, last_seen_at,
               RIGHT(token, 6) AS cola
        FROM cocina_devices WHERE store_id = :sid ORDER BY id
    """), {"sid": store_id}).fetchall()
    return [{
        "id": r.id,
        "nombre": r.nombre,
        "is_active": r.is_active,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
        "token_cola": r.cola,          # sólo el final, para identificarlo
    } for r in rows]


def revocar_device(db: Session, device_id: int, store_id: int) -> bool:
    """Desactiva un dispositivo. No commitea."""
    r = db.execute(text("""
        UPDATE cocina_devices SET is_active = FALSE
        WHERE id = :id AND store_id = :sid
        RETURNING id
    """), {"id": device_id, "sid": store_id}).fetchone()
    return r is not None


# ════════════════════════════════════════════════════════════════
# CORRELATIVO THREAD-SAFE
# ════════════════════════════════════════════════════════════════

_INSERT_COMANDA_SQL = text("""
    INSERT INTO comandas
        (store_id, fecha_operativa, numero, sale_id, estado,
         cajero_id, cajero_nombre, nota)
    SELECT
        :sid,
        :fecha,
        COALESCE(MAX(c.numero), 0) + 1,
        :sale_id,
        'sent',
        :cajero_id,
        :cajero_nombre,
        :nota
    FROM comandas c
    WHERE c.store_id = :sid AND c.fecha_operativa = :fecha
    RETURNING id, numero, sent_at
""")


def crear_comanda(
    db: Session,
    store_id: int,
    cajero_id: Optional[int] = None,
    cajero_nombre: Optional[str] = None,
    sale_id: Optional[int] = None,
    nota: Optional[str] = None,
) -> dict:
    """
    Crea una comanda con correlativo único por tienda y día operativo Lima.

    El número se calcula dentro del propio INSERT y la unicidad la impone
    el UNIQUE de la tabla. Ante colisión se reintenta (ver docstring del
    módulo). No hace commit: lo decide quien llama, para poder insertar
    los ítems en la misma transacción.

    Returns:
        {"id": int, "numero": int, "fecha_operativa": date, "sent_at": datetime}

    Raises:
        RuntimeError: si tras MAX_INTENTOS_CORRELATIVO sigue colisionando.
    """
    fecha = hoy_peru()
    params = {
        "sid": store_id,
        "fecha": fecha,
        "sale_id": sale_id,
        "cajero_id": cajero_id,
        "cajero_nombre": cajero_nombre,
        "nota": nota,
    }

    # Serializa la asignación entre cajeros de esta tienda y este día.
    # Se libera solo al commit/rollback de la transacción. Dos claves
    # int32: la tienda y la fecha como número ordinal de día.
    db.execute(
        text("SELECT pg_advisory_xact_lock(:k1, :k2)"),
        {"k1": store_id, "k2": fecha.toordinal()},
    )

    for intento in range(1, MAX_INTENTOS_CORRELATIVO + 1):
        try:
            # SAVEPOINT: si el UNIQUE falla, se deshace sólo este INSERT
            # y la sesión sigue usable para reintentar.
            with db.begin_nested():
                row = db.execute(_INSERT_COMANDA_SQL, params).fetchone()

            return {
                "id": row.id,
                "numero": row.numero,
                "fecha_operativa": fecha,
                "sent_at": row.sent_at,
            }

        except IntegrityError:
            logger.info(
                f"[Cocina] Colisión de correlativo en store {store_id} "
                f"(intento {intento}/{MAX_INTENTOS_CORRELATIVO}), reintentando"
            )
            continue

    raise RuntimeError(
        f"No se pudo asignar número de comanda para la tienda {store_id} "
        f"tras {MAX_INTENTOS_CORRELATIVO} intentos"
    )


def agregar_items(db: Session, comanda_id: int, items: list) -> int:
    """
    Agrega ítems a una comanda. No hace commit.

    Args:
        items: dicts con nombre (req.), cantidad, product_id, unidad, nota.
    """
    insertados = 0
    for it in items:
        nombre = (it.get("nombre") or it.get("product_name") or "").strip()
        if not nombre:
            continue
        db.execute(text("""
            INSERT INTO comanda_items
                (comanda_id, product_id, nombre, cantidad, unidad, nota, estado)
            VALUES
                (:cid, :pid, :nombre, :cantidad, :unidad, :nota, 'sent')
        """), {
            "cid": comanda_id,
            "pid": it.get("product_id"),
            "nombre": nombre[:200],
            "cantidad": float(it.get("cantidad") or it.get("quantity") or 1),
            "unidad": (it.get("unidad") or it.get("unit") or None),
            "nota": (it.get("nota") or None),
        })
        insertados += 1
    return insertados


# ════════════════════════════════════════════════════════════════
# TRANSICIONES DE ESTADO
# ════════════════════════════════════════════════════════════════

# Transiciones permitidas. Cualquier otra combinación se rechaza: evita
# que un doble toque en la pantalla de cocina retroceda un estado.
TRANSICIONES_ITEM = {
    "sent": ("preparing", "ready"),   # "ready" directo: platos que ya salen hechos
    "preparing": ("ready",),
    "ready": (),
    "served": (),
}

TRANSICIONES_COMANDA = {
    "sent": ("preparing", "ready", "served"),
    "preparing": ("ready", "served"),
    "ready": ("served",),
    "served": (),
}


def obtener_item(db: Session, item_id: int, store_id: int) -> Optional[dict]:
    """
    Lee un ítem verificando que pertenece a `store_id`.

    El JOIN contra comandas es la validación de tenant: un ítem de otra
    tienda simplemente no existe para este usuario. Así se cierra el IDOR
    que tiene Metraes, donde bastaba conocer el id para mutar el ítem de
    otro negocio.
    """
    row = db.execute(text("""
        SELECT ci.id, ci.comanda_id, ci.estado, ci.nombre,
               c.store_id, c.numero AS comanda_numero, c.estado AS comanda_estado
        FROM comanda_items ci
        JOIN comandas c ON c.id = ci.comanda_id
        WHERE ci.id = :iid AND c.store_id = :sid
    """), {"iid": item_id, "sid": store_id}).fetchone()

    if not row:
        return None
    return {
        "id": row.id,
        "comanda_id": row.comanda_id,
        "estado": row.estado,
        "nombre": row.nombre,
        "store_id": row.store_id,
        "comanda_numero": row.comanda_numero,
        "comanda_estado": row.comanda_estado,
    }


def cambiar_estado_item(db: Session, item_id: int, store_id: int,
                        nuevo_estado: str) -> dict:
    """
    Cambia el estado de un ítem y recalcula el de su comanda. No commitea.

    Raises:
        LookupError: el ítem no existe o es de otra tienda.
        ValueError:  la transición no está permitida.
    """
    item = obtener_item(db, item_id, store_id)
    if not item:
        raise LookupError("Ítem no encontrado")

    actual = item["estado"]
    if nuevo_estado not in TRANSICIONES_ITEM.get(actual, ()):
        raise ValueError(
            f"No se puede pasar de '{actual}' a '{nuevo_estado}'"
        )

    sets = ["estado = :estado"]
    if nuevo_estado == "preparing":
        sets.append("started_at = COALESCE(started_at, NOW())")
    elif nuevo_estado == "ready":
        sets.append("ready_at = NOW()")

    db.execute(
        text(f"UPDATE comanda_items SET {', '.join(sets)} WHERE id = :iid"),
        {"iid": item_id, "estado": nuevo_estado},
    )

    comanda = _recalcular_estado_comanda(db, item["comanda_id"])

    return {
        "item_id": item_id,
        "estado": nuevo_estado,
        "comanda_id": item["comanda_id"],
        "comanda_numero": item["comanda_numero"],
        "comanda_estado": comanda["estado"],
        "comanda_completa": comanda["completa"],
    }


def _recalcular_estado_comanda(db: Session, comanda_id: int) -> dict:
    """
    Deriva el estado de la comanda a partir de sus ítems.

    - todos ready            → comanda 'ready'  (dispara el aviso a caja)
    - alguno preparing/ready → comanda 'preparing'
    - ninguno tocado         → se queda en 'sent'

    Una comanda ya 'served' no retrocede.
    """
    row = db.execute(text("""
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE estado = 'ready')     AS listos,
               COUNT(*) FILTER (WHERE estado = 'preparing') AS preparando
        FROM comanda_items WHERE comanda_id = :cid
    """), {"cid": comanda_id}).fetchone()

    estado_actual = db.execute(
        text("SELECT estado FROM comandas WHERE id = :cid"), {"cid": comanda_id}
    ).scalar()

    if estado_actual == "served":
        return {"estado": "served", "completa": True}

    total = row.total or 0
    completa = total > 0 and row.listos == total

    if completa:
        nuevo = "ready"
    elif (row.listos or 0) > 0 or (row.preparando or 0) > 0:
        nuevo = "preparing"
    else:
        nuevo = "sent"

    if nuevo != estado_actual:
        sets = ["estado = :estado", "updated_at = NOW()"]
        if nuevo == "ready":
            sets.append("ready_at = NOW()")
        db.execute(
            text(f"UPDATE comandas SET {', '.join(sets)} WHERE id = :cid"),
            {"cid": comanda_id, "estado": nuevo},
        )

    return {"estado": nuevo, "completa": completa}


def cambiar_estado_comanda(db: Session, comanda_id: int, store_id: int,
                           nuevo_estado: str) -> dict:
    """
    Cambia el estado de una comanda completa (validando tenant). No commitea.

    Sirve para marcar 'served' cuando el pedido se entrega — sin esto las
    comandas listas se acumularían para siempre.
    """
    row = db.execute(text("""
        SELECT id, numero, estado FROM comandas
        WHERE id = :cid AND store_id = :sid
    """), {"cid": comanda_id, "sid": store_id}).fetchone()

    if not row:
        raise LookupError("Comanda no encontrada")

    if nuevo_estado not in TRANSICIONES_COMANDA.get(row.estado, ()):
        raise ValueError(f"No se puede pasar de '{row.estado}' a '{nuevo_estado}'")

    sets = ["estado = :estado", "updated_at = NOW()"]
    if nuevo_estado == "ready":
        sets.append("ready_at = COALESCE(ready_at, NOW())")
    elif nuevo_estado == "served":
        sets.append("served_at = NOW()")

    db.execute(
        text(f"UPDATE comandas SET {', '.join(sets)} WHERE id = :cid"),
        {"cid": comanda_id, "estado": nuevo_estado},
    )

    # Los ítems siguen a la comanda para que no queden a medias.
    if nuevo_estado in ("ready", "served"):
        db.execute(text("""
            UPDATE comanda_items
            SET estado = :estado,
                ready_at = COALESCE(ready_at, NOW())
            WHERE comanda_id = :cid AND estado <> :estado
        """), {"cid": comanda_id, "estado": nuevo_estado})

    return {"comanda_id": comanda_id, "numero": row.numero, "estado": nuevo_estado}


def enlazar_venta(db: Session, comanda_id: int, store_id: int,
                  sale_id: int) -> dict:
    """
    Asocia una comanda a la venta con que se cobró. No commitea.

    Es la pieza que hace útil el `sale_id` NULL-able: la comanda puede
    mandarse a cocina antes de cobrar y enlazarse después.
    """
    row = db.execute(text("""
        UPDATE comandas SET sale_id = :sale_id, updated_at = NOW()
        WHERE id = :cid AND store_id = :sid
        RETURNING id, numero, sale_id
    """), {"cid": comanda_id, "sid": store_id, "sale_id": sale_id}).fetchone()

    if not row:
        raise LookupError("Comanda no encontrada")
    return {"comanda_id": row.id, "numero": row.numero, "sale_id": row.sale_id}


# ════════════════════════════════════════════════════════════════
# CONSULTAS
# ════════════════════════════════════════════════════════════════

def obtener_comanda(db: Session, comanda_id: int, store_id: int) -> Optional[dict]:
    """Comanda completa con sus ítems, validando tenant."""
    row = db.execute(text("""
        SELECT id, numero, estado, cajero_nombre, nota, sale_id,
               sent_at, ready_at, served_at
        FROM comandas WHERE id = :cid AND store_id = :sid
    """), {"cid": comanda_id, "sid": store_id}).fetchone()

    if not row:
        return None

    items = db.execute(text("""
        SELECT id, product_id, nombre, cantidad, unidad, nota, estado
        FROM comanda_items WHERE comanda_id = :cid ORDER BY id
    """), {"cid": comanda_id}).fetchall()

    return {
        "id": row.id,
        "numero": row.numero,
        "estado": row.estado,
        "cajero_nombre": row.cajero_nombre,
        "nota": row.nota,
        "sale_id": row.sale_id,
        "sent_at": row.sent_at.isoformat() if row.sent_at else None,
        "ready_at": row.ready_at.isoformat() if row.ready_at else None,
        "served_at": row.served_at.isoformat() if row.served_at else None,
        "items": [{
            "id": i.id,
            "product_id": i.product_id,
            "nombre": i.nombre,
            "cantidad": float(i.cantidad),
            "unidad": i.unidad,
            "nota": i.nota,
            "estado": i.estado,
        } for i in items],
    }


def comandas_pendientes(db: Session, store_id: int) -> list:
    """
    Comandas del día operativo actual que cocina todavía debe atender.

    Sólo estados 'sent' y 'preparing': las servidas y las listas no se
    devuelven, para que la pantalla no acumule zombis.
    """
    dia_inicio, dia_fin = dia_operativo_peru()

    rows = db.execute(text("""
        SELECT c.id, c.numero, c.estado, c.cajero_nombre, c.nota,
               c.sent_at, c.ready_at, c.sale_id
        FROM comandas c
        WHERE c.store_id = :sid
          AND c.estado IN ('sent', 'preparing')
          AND c.sent_at >= :ini AND c.sent_at < :fin
        ORDER BY c.numero
    """), {"sid": store_id, "ini": dia_inicio, "fin": dia_fin}).fetchall()

    if not rows:
        return []

    ids = [r.id for r in rows]
    items = db.execute(text("""
        SELECT id, comanda_id, product_id, nombre, cantidad, unidad, nota, estado
        FROM comanda_items
        WHERE comanda_id = ANY(:ids)
        ORDER BY id
    """), {"ids": ids}).fetchall()

    por_comanda: dict = {}
    for it in items:
        por_comanda.setdefault(it.comanda_id, []).append({
            "id": it.id,
            "product_id": it.product_id,
            "nombre": it.nombre,
            "cantidad": float(it.cantidad),
            "unidad": it.unidad,
            "nota": it.nota,
            "estado": it.estado,
        })

    return [{
        "id": r.id,
        "numero": r.numero,
        "estado": r.estado,
        "cajero_nombre": r.cajero_nombre,
        "nota": r.nota,
        "sale_id": r.sale_id,
        "sent_at": r.sent_at.isoformat() if r.sent_at else None,
        "ready_at": r.ready_at.isoformat() if r.ready_at else None,
        "items": por_comanda.get(r.id, []),
    } for r in rows]
