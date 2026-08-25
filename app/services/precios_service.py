"""
QueVendi — Precios por volumen y por tipo de cliente
=====================================================

Hay DOS ejes de descuento que conviven:

  eje 'volumen'  → el que ya existía y usa Shevalche: "a partir de 6
                   unidades, S/7.50". Vive en product_prices con
                   cantidad_minima. NO se toca.

  eje 'cliente'  → nuevo: una lista de precios asociada al cliente
                   ("Mayorista", "Restaurante"). Puede ser un % de
                   descuento sobre el precio base, o precios cargados
                   uno a uno.

Ambos se calculan por separado y luego se combinan:

  · Por defecto GANA EL MEJOR (el menor de los dos). Es lo que espera
    un cliente: si por volumen le toca S/7.50 y por ser mayorista
    S/8.00, paga S/7.50, no la suma de castigos.
  · Si el dueño activa `descuentos_acumulan`, se aplica primero el de
    cliente y sobre ese resultado el porcentaje de volumen.

MODOS DEL EJE CLIENTE
---------------------
  'descuento_pct' → precio_base * (1 - pct/100). Una sola cifra para
                    todo el catálogo; el dueño no carga nada más.
  'manual'        → precio por producto en product_prices. Si un
                    producto no tiene precio en esa lista, CAE al
                    precio base en vez de quedarse sin precio.
"""

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

EJES = ("volumen", "cliente")
MODOS = ("manual", "descuento_pct")

# El DDL toca tablas grandes: se corre una vez por proceso, no en cada
# request. Ver el comentario en barcode_service para el detalle.
_migrado = False

MIGRATION_SQL = """
-- Segundo eje sobre las tablas que ya existen. Los tiers actuales
-- quedan como 'volumen', así que Shevalche no cambia.
ALTER TABLE price_tiers ADD COLUMN IF NOT EXISTS eje VARCHAR(20) DEFAULT 'volumen';
ALTER TABLE price_tiers ADD COLUMN IF NOT EXISTS modo VARCHAR(20) DEFAULT 'manual';
ALTER TABLE price_tiers ADD COLUMN IF NOT EXISTS descuento_pct DECIMAL(5,2);
ALTER TABLE price_tiers ADD COLUMN IF NOT EXISTS es_default BOOLEAN DEFAULT FALSE;

-- Lista por defecto de cada cliente.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier_id INTEGER REFERENCES price_tiers(id);

-- Auditoría: a qué cliente y con qué lista se cobró.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tier_id INTEGER REFERENCES price_tiers(id);

CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_tier ON sales(tier_id);
CREATE INDEX IF NOT EXISTS idx_price_tiers_store_eje ON price_tiers(store_id, eje);
"""

MIGRATION_STORE_CONFIG_SQL = """
ALTER TABLE store_config
    ADD COLUMN IF NOT EXISTS multiprecio_cliente_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE store_config
    ADD COLUMN IF NOT EXISTS descuentos_acumulan BOOLEAN DEFAULT FALSE;
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
        logger.warning(f"[Precios] Migración: {e}")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ════════════════════════════════════════════════
# FLAGS
# ════════════════════════════════════════════════

def multiprecio_enabled(db: Session, store_id: int) -> bool:
    """¿La tienda usa listas por tipo de cliente? Apagado por defecto."""
    try:
        row = db.execute(text(
            "SELECT multiprecio_cliente_enabled FROM store_config WHERE store_id = :s"
        ), {"s": store_id}).fetchone()
        return bool(row[0]) if row and row[0] is not None else False
    except Exception:
        return False


def descuentos_acumulan(db: Session, store_id: int) -> bool:
    """Si es True, volumen y cliente se suman en vez de competir."""
    try:
        row = db.execute(text(
            "SELECT descuentos_acumulan FROM store_config WHERE store_id = :s"
        ), {"s": store_id}).fetchone()
        return bool(row[0]) if row and row[0] is not None else False
    except Exception:
        return False


# ════════════════════════════════════════════════
# LISTAS (tiers eje='cliente')
# ════════════════════════════════════════════════

def listar_tiers(db: Session, store_id: int, eje: Optional[str] = None) -> list:
    """Tiers de la tienda, opcionalmente filtrados por eje."""
    sql = """
        SELECT id, nombre, descripcion, color, is_active, orden,
               COALESCE(eje, 'volumen') AS eje,
               COALESCE(modo, 'manual') AS modo,
               descuento_pct, COALESCE(es_default, FALSE) AS es_default,
               (SELECT COUNT(*) FROM product_prices pp
                 WHERE pp.tier_id = pt.id AND pp.is_active = TRUE) AS n_precios
        FROM price_tiers pt
        WHERE store_id = :s
    """
    params = {"s": store_id}
    if eje:
        sql += " AND COALESCE(eje, 'volumen') = :eje"
        params["eje"] = eje
    sql += " ORDER BY orden, id"

    return [{
        "id": r.id,
        "nombre": r.nombre,
        "descripcion": r.descripcion,
        "color": r.color,
        "is_active": r.is_active,
        "orden": r.orden,
        "eje": r.eje,
        "modo": r.modo,
        "descuento_pct": float(r.descuento_pct) if r.descuento_pct is not None else None,
        "es_default": r.es_default,
        "n_precios": r.n_precios,
    } for r in db.execute(text(sql), params).fetchall()]


def tier_default(db: Session, store_id: int) -> Optional[dict]:
    """Lista que se aplica cuando la venta no tiene cliente asignado."""
    filas = [t for t in listar_tiers(db, store_id, eje="cliente")
             if t["es_default"] and t["is_active"]]
    return filas[0] if filas else None


def crear_tier(db: Session, store_id: int, nombre: str, modo: str = "manual",
               descuento_pct=None, descripcion: str = "", color: str = "#3b82f6",
               es_default: bool = False) -> dict:
    """Crea una lista de precios por tipo de cliente. No commitea."""
    nombre = (nombre or "").strip()[:50]
    if not nombre:
        raise ValueError("La lista necesita un nombre")

    modo = (modo or "manual").strip().lower()
    if modo not in MODOS:
        raise ValueError(f"Modo inválido. Opciones: {', '.join(MODOS)}")

    if modo == "descuento_pct":
        if descuento_pct is None:
            raise ValueError("Falta el porcentaje de descuento")
        pct = _dec(descuento_pct)
        if pct <= 0 or pct >= 100:
            raise ValueError("El descuento debe estar entre 0 y 100")
        descuento_pct = pct
    else:
        descuento_pct = None

    dup = db.execute(text("""
        SELECT id FROM price_tiers
        WHERE store_id = :s AND LOWER(nombre) = LOWER(:n)
    """), {"s": store_id, "n": nombre}).fetchone()
    if dup:
        raise ValueError(f"Ya existe una lista llamada «{nombre}»")

    if es_default:
        _quitar_defaults(db, store_id)

    row = db.execute(text("""
        INSERT INTO price_tiers
            (store_id, nombre, descripcion, color, is_active, orden,
             eje, modo, descuento_pct, es_default)
        VALUES (:s, :n, :d, :c, TRUE,
                COALESCE((SELECT MAX(orden)+1 FROM price_tiers WHERE store_id = :s), 0),
                'cliente', :modo, :pct, :def)
        RETURNING id
    """), {"s": store_id, "n": nombre, "d": (descripcion or "")[:200],
           "c": color or "#3b82f6", "modo": modo,
           "pct": descuento_pct, "def": es_default}).fetchone()

    return {"id": row.id, "nombre": nombre, "eje": "cliente", "modo": modo,
            "descuento_pct": float(descuento_pct) if descuento_pct else None,
            "es_default": es_default}


def _quitar_defaults(db: Session, store_id: int) -> None:
    db.execute(text("""
        UPDATE price_tiers SET es_default = FALSE
        WHERE store_id = :s AND COALESCE(eje,'volumen') = 'cliente'
    """), {"s": store_id})


def actualizar_tier(db: Session, store_id: int, tier_id: int, **campos) -> dict:
    """Edita una lista de cliente. No commitea."""
    row = db.execute(text("""
        SELECT id, COALESCE(eje,'volumen') AS eje FROM price_tiers
        WHERE id = :t AND store_id = :s
    """), {"t": tier_id, "s": store_id}).fetchone()
    if not row:
        raise LookupError("Lista no encontrada")
    if row.eje != "cliente":
        raise ValueError("Esa lista es de precios por volumen, no por cliente")

    sets, params = [], {"t": tier_id, "s": store_id}

    if campos.get("nombre"):
        sets.append("nombre = :n")
        params["n"] = campos["nombre"].strip()[:50]
    if "descripcion" in campos:
        sets.append("descripcion = :d")
        params["d"] = (campos.get("descripcion") or "")[:200]
    if campos.get("color"):
        sets.append("color = :c")
        params["c"] = campos["color"]
    if "is_active" in campos:
        sets.append("is_active = :act")
        params["act"] = bool(campos["is_active"])

    if campos.get("modo"):
        modo = campos["modo"].strip().lower()
        if modo not in MODOS:
            raise ValueError("Modo inválido")
        sets.append("modo = :modo")
        params["modo"] = modo
        if modo == "manual":
            sets.append("descuento_pct = NULL")

    if campos.get("descuento_pct") is not None:
        pct = _dec(campos["descuento_pct"])
        if pct <= 0 or pct >= 100:
            raise ValueError("El descuento debe estar entre 0 y 100")
        sets.append("descuento_pct = :pct")
        params["pct"] = pct

    if campos.get("es_default"):
        _quitar_defaults(db, store_id)
        sets.append("es_default = TRUE")

    if not sets:
        return {"id": tier_id, "sin_cambios": True}

    db.execute(text(
        f"UPDATE price_tiers SET {', '.join(sets)} WHERE id = :t AND store_id = :s"
    ), params)
    return {"id": tier_id, "actualizado": True}


def borrar_tier(db: Session, store_id: int, tier_id: int) -> bool:
    """
    Borra una lista de cliente y sus precios. No commitea.

    Los clientes que la tenían asignada quedan sin lista (precio base),
    no huérfanos apuntando a algo que ya no existe.
    """
    row = db.execute(text("""
        SELECT id, COALESCE(eje,'volumen') AS eje FROM price_tiers
        WHERE id = :t AND store_id = :s
    """), {"t": tier_id, "s": store_id}).fetchone()
    if not row:
        return False
    if row.eje != "cliente":
        raise ValueError("Esa lista es de precios por volumen, no se borra desde aquí")

    # Los clientes vuelven al precio normal en cualquier caso.
    db.execute(text("UPDATE customers SET tier_id = NULL WHERE tier_id = :t AND store_id = :s"),
               {"t": tier_id, "s": store_id})

    # Si la lista ya se usó para cobrar, NO se borra: `sales.tier_id`
    # existe justamente para poder auditar con qué lista se vendió, y
    # tiene FK. Se desactiva, que a efectos del dueño es lo mismo (deja
    # de aparecer y de aplicarse) sin perder el historial.
    usada = db.execute(text(
        "SELECT COUNT(*) FROM sales WHERE tier_id = :t AND store_id = :s"
    ), {"t": tier_id, "s": store_id}).scalar()

    if usada:
        db.execute(text("""
            UPDATE price_tiers SET is_active = FALSE, es_default = FALSE
            WHERE id = :t AND store_id = :s
        """), {"t": tier_id, "s": store_id})
        db.execute(text("UPDATE product_prices SET is_active = FALSE WHERE tier_id = :t"),
                   {"t": tier_id})
        logger.info(f"[Precios] Lista {tier_id} desactivada ({usada} ventas la usan)")
        return True

    db.execute(text("DELETE FROM product_prices WHERE tier_id = :t AND store_id = :s"),
               {"t": tier_id, "s": store_id})
    db.execute(text("DELETE FROM price_tiers WHERE id = :t AND store_id = :s"),
               {"t": tier_id, "s": store_id})
    return True


# ════════════════════════════════════════════════
# CÁLCULO DEL PRECIO
# ════════════════════════════════════════════════

def precio_volumen(db: Session, store_id: int, product_id: int,
                   cantidad: float) -> Optional[Decimal]:
    """
    Precio por volumen: la misma lógica que /pricing/detectar ya usaba.
    None si no aplica ningún tramo.
    """
    row = db.execute(text("""
        SELECT pp.precio
        FROM product_prices pp
        JOIN price_tiers pt ON pt.id = pp.tier_id
        WHERE pp.store_id = :s AND pp.product_id = :p
          AND pp.is_active = TRUE
          AND COALESCE(pt.eje, 'volumen') = 'volumen'
          AND pt.is_active = TRUE
          AND pp.cantidad_minima <= :c
        ORDER BY pp.cantidad_minima DESC
        LIMIT 1
    """), {"s": store_id, "p": product_id, "c": cantidad}).fetchone()
    return _dec(row.precio) if row else None


def precio_cliente(db: Session, store_id: int, product_id: int,
                   tier_id: Optional[int], precio_base: Decimal) -> Optional[Decimal]:
    """
    Precio de la lista del cliente. None si no hay lista.

    En modo manual, un producto sin precio cargado CAE al precio base:
    es preferible cobrar el base a dejar el producto sin precio.
    """
    if not tier_id:
        return None

    tier = db.execute(text("""
        SELECT COALESCE(modo,'manual') AS modo, descuento_pct
        FROM price_tiers
        WHERE id = :t AND store_id = :s
          AND COALESCE(eje,'volumen') = 'cliente' AND is_active = TRUE
    """), {"t": tier_id, "s": store_id}).fetchone()
    if not tier:
        return None

    if tier.modo == "descuento_pct":
        pct = _dec(tier.descuento_pct or 0)
        if pct <= 0:
            return precio_base
        return _dec(precio_base * (Decimal("1") - pct / Decimal("100")))

    row = db.execute(text("""
        SELECT precio FROM product_prices
        WHERE store_id = :s AND product_id = :p AND tier_id = :t AND is_active = TRUE
        LIMIT 1
    """), {"s": store_id, "p": product_id, "t": tier_id}).fetchone()
    return _dec(row.precio) if row else precio_base


def calcular(db: Session, store_id: int, product_id: int, cantidad: float = 1,
             tier_id: Optional[int] = None) -> dict:
    """
    Precio final de un producto combinando los dos ejes.

    Devuelve el desglose completo para que la caja pueda explicar de
    dónde sale el precio, no sólo el número.
    """
    prod = db.execute(text("""
        SELECT id, name, sale_price FROM products
        WHERE id = :p AND store_id = :s
    """), {"p": product_id, "s": store_id}).fetchone()
    if not prod:
        raise LookupError("Producto no encontrado")

    base = _dec(prod.sale_price)
    p_vol = precio_volumen(db, store_id, product_id, cantidad)

    usa_cliente = multiprecio_enabled(db, store_id)
    p_cli = precio_cliente(db, store_id, product_id, tier_id, base) if usa_cliente else None

    acumulan = descuentos_acumulan(db, store_id) if usa_cliente else False

    if p_vol is None and p_cli is None:
        final, origen = base, "base"
    elif p_cli is None:
        final, origen = p_vol, "volumen"
    elif p_vol is None:
        final, origen = p_cli, "cliente"
    elif acumulan:
        # El descuento de volumen, expresado como % sobre el base, se
        # aplica encima del precio de cliente.
        factor = (p_vol / base) if base > 0 else Decimal("1")
        final, origen = _dec(p_cli * factor), "acumulado"
    else:
        # Gana el mejor para el cliente.
        final = min(p_vol, p_cli)
        origen = "volumen" if final == p_vol else "cliente"

    return {
        "product_id": product_id,
        "nombre": prod.name,
        "cantidad": float(cantidad),
        "precio_base": float(base),
        "precio_volumen": float(p_vol) if p_vol is not None else None,
        "precio_cliente": float(p_cli) if p_cli is not None else None,
        "precio_final": float(final),
        "origen": origen,
        "acumulan": acumulan,
        "tier_id": tier_id,
        "ahorro_unit": float(_dec(base - final)),
        "ahorro_total": float(_dec((base - final) * Decimal(str(cantidad)))),
    }


# ════════════════════════════════════════════════
# PRECIOS POR PRODUCTO (modo manual)
# ════════════════════════════════════════════════

def precios_de_lista(db: Session, store_id: int, tier_id: int,
                     limite: int = 500) -> list:
    """
    Productos de la tienda con el precio que tienen en esta lista.

    Los que no tienen precio cargado salen con `precio: None` para que
    la UI los marque y el dueño sepa qué le falta completar.
    """
    filas = db.execute(text("""
        SELECT p.id, p.name, p.sale_price, pp.precio, pp.id AS precio_id
        FROM products p
        LEFT JOIN product_prices pp
               ON pp.product_id = p.id AND pp.tier_id = :t
              AND pp.store_id = :s AND pp.is_active = TRUE
        WHERE p.store_id = :s AND p.is_active = TRUE AND p.deleted_at IS NULL
        ORDER BY (pp.precio IS NULL) DESC, p.name
        LIMIT :lim
    """), {"s": store_id, "t": tier_id, "lim": limite}).fetchall()

    return [{
        "product_id": r.id,
        "nombre": r.name,
        "precio_base": float(r.sale_price or 0),
        "precio": float(r.precio) if r.precio is not None else None,
        "sin_precio": r.precio is None,
    } for r in filas]


def fijar_precio(db: Session, store_id: int, tier_id: int, product_id: int,
                 precio) -> dict:
    """Fija (o borra, si precio es None) el precio de un producto. No commitea."""
    tier = db.execute(text("""
        SELECT id FROM price_tiers WHERE id = :t AND store_id = :s
    """), {"t": tier_id, "s": store_id}).fetchone()
    if not tier:
        raise LookupError("Lista no encontrada")

    prod = db.execute(text("""
        SELECT id FROM products WHERE id = :p AND store_id = :s
    """), {"p": product_id, "s": store_id}).fetchone()
    if not prod:
        raise LookupError("Producto no encontrado")

    if precio is None or str(precio).strip() == "":
        db.execute(text("""
            DELETE FROM product_prices
            WHERE store_id = :s AND tier_id = :t AND product_id = :p
        """), {"s": store_id, "t": tier_id, "p": product_id})
        return {"product_id": product_id, "precio": None}

    valor = _dec(precio)
    if valor <= 0:
        raise ValueError("El precio debe ser mayor a 0")

    existe = db.execute(text("""
        SELECT id FROM product_prices
        WHERE store_id = :s AND tier_id = :t AND product_id = :p
    """), {"s": store_id, "t": tier_id, "p": product_id}).fetchone()

    if existe:
        db.execute(text("""
            UPDATE product_prices SET precio = :v, is_active = TRUE WHERE id = :id
        """), {"v": valor, "id": existe.id})
    else:
        # cantidad_minima = 1: en el eje cliente el precio no depende
        # de cuánto lleve, sólo de quién compra.
        db.execute(text("""
            INSERT INTO product_prices
                (store_id, product_id, tier_id, precio, cantidad_minima, is_active)
            VALUES (:s, :p, :t, :v, 1, TRUE)
        """), {"s": store_id, "p": product_id, "t": tier_id, "v": valor})

    return {"product_id": product_id, "precio": float(valor)}


# ════════════════════════════════════════════════
# REPORTE
# ════════════════════════════════════════════════

def ventas_por_lista(db: Session, store_id: int, desde, hasta) -> list:
    """Cuánto se vendió con cada lista de cliente en un rango."""
    filas = db.execute(text("""
        SELECT COALESCE(pt.nombre, 'Sin lista') AS lista,
               s.tier_id,
               COUNT(*) AS n_ventas,
               COALESCE(SUM(s.total), 0) AS total
        FROM sales s
        LEFT JOIN price_tiers pt ON pt.id = s.tier_id AND pt.store_id = s.store_id
        WHERE s.store_id = :s
          AND s.created_at >= :desde AND s.created_at < :hasta
          AND COALESCE(s.status, 'completed') <> 'cancelled'
        GROUP BY 1, 2
        ORDER BY total DESC
    """), {"s": store_id, "desde": desde, "hasta": hasta}).fetchall()

    return [{"lista": r.lista, "tier_id": r.tier_id,
             "ventas": r.n_ventas, "total": float(r.total)} for r in filas]
