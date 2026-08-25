"""
QueVendi — Código de barras
============================

`products.barcode` ya existía en el esquema, vacía y sin índice. Este
módulo la pone en uso: índice, búsqueda por código exacto y el feature
flag que mantiene a las bodegas actuales sin cambios.

POR QUÉ UN ÍNDICE PARCIAL
-------------------------
Un UNIQUE normal sobre (store_id, barcode) chocaría con los 3.774
productos que tienen barcode NULL: en Postgres varios NULL no colisionan
entre sí, pero sí conviene declarar la intención de forma explícita. El
índice parcial `WHERE barcode IS NOT NULL AND barcode <> ''` deja claro
que sólo se controla la unicidad cuando hay código, y permite que dos
tiendas distintas usen el mismo EAN del mismo producto comercial.
"""

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MIGRATION_SQL = """
-- La columna ya existe; sólo se asegura por si la BD es nueva.
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);

-- Único por tienda, pero sólo cuando hay código de verdad.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_store_barcode
    ON products(store_id, barcode)
    WHERE barcode IS NOT NULL AND barcode <> '';

-- Búsqueda rápida del lector: llega el código y hay que resolverlo ya.
CREATE INDEX IF NOT EXISTS idx_products_barcode
    ON products(barcode)
    WHERE barcode IS NOT NULL AND barcode <> '';
"""

MIGRATION_STORE_CONFIG_SQL = """
ALTER TABLE store_config
    ADD COLUMN IF NOT EXISTS barcode_enabled BOOLEAN DEFAULT FALSE;
"""


# Se ejecuta una sola vez por proceso.
#
# El patrón del proyecto llama a _ensure_tables en cada request, y con
# CREATE TABLE IF NOT EXISTS eso es barato. Aquí no: ALTER TABLE y
# CREATE UNIQUE INDEX piden un lock ACCESS EXCLUSIVE, así que si otra
# conexión tiene una transacción abierta sobre `products` o
# `store_config`, el request se queda esperando. Medido: una sesión
# ociosa con una transacción abierta basta para colgarlo.
#
# Con este guard el DDL corre en el primer request tras arrancar y las
# siguientes llamadas no tocan el esquema.
_migrado = False


def _ensure_tables(db: Session, forzar: bool = False) -> None:
    """Índices y flag del módulo de código de barras (idempotente)."""
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
        logger.warning(f"[Barcode] Migración: {e}")


def barcode_enabled(db: Session, store_id: int) -> bool:
    """¿Esta tienda usa código de barras? Apagado por defecto."""
    try:
        row = db.execute(text(
            "SELECT barcode_enabled FROM store_config WHERE store_id = :sid"
        ), {"sid": store_id}).fetchone()
        return bool(row[0]) if row and row[0] is not None else False
    except Exception as e:
        logger.warning(f"[Barcode] No se pudo leer barcode_enabled: {e}")
        return False


def normalizar(codigo: str) -> str:
    """
    Limpia lo que manda un lector físico.

    Los lectores añaden un Enter y a veces espacios; algunos formatos
    traen guiones. Se conservan sólo caracteres válidos de un código.
    """
    if not codigo:
        return ""
    return "".join(ch for ch in codigo.strip() if ch.isalnum() or ch in "-_")[:64]


def buscar_por_barcode(db: Session, store_id: int, codigo: str) -> Optional[dict]:
    """
    Producto cuyo barcode coincide EXACTAMENTE, dentro de esta tienda.

    El filtro por store_id va en la consulta, no en un `if` posterior:
    un código de otra tienda simplemente no existe aquí.
    """
    codigo = normalizar(codigo)
    if not codigo:
        return None

    row = db.execute(text("""
        SELECT id, name, sale_price, stock, unit, category, barcode,
               COALESCE(sell_by_fraction, FALSE) AS sell_by_fraction
        FROM products
        WHERE store_id = :sid
          AND barcode = :code
          AND is_active = TRUE
          AND deleted_at IS NULL
        LIMIT 1
    """), {"sid": store_id, "code": codigo}).fetchone()

    if not row:
        return None

    return {
        "id": row.id,
        "name": row.name,
        "sale_price": float(row.sale_price or 0),
        "stock": float(row.stock or 0),
        "unit": row.unit,
        "category": row.category,
        "barcode": row.barcode,
        "sell_by_fraction": bool(row.sell_by_fraction),
    }


def asignar(db: Session, store_id: int, product_id: int,
            codigo: Optional[str]) -> dict:
    """
    Asigna o quita el código de un producto. No commitea.

    Raises:
        LookupError: el producto no es de esta tienda.
        ValueError:  ese código ya lo usa otro producto de la tienda.
    """
    prod = db.execute(text("""
        SELECT id FROM products WHERE id = :pid AND store_id = :sid
    """), {"pid": product_id, "sid": store_id}).fetchone()
    if not prod:
        raise LookupError("Producto no encontrado")

    codigo = normalizar(codigo or "") or None

    if codigo:
        ocupado = db.execute(text("""
            SELECT id, name FROM products
            WHERE store_id = :sid AND barcode = :code AND id <> :pid
        """), {"sid": store_id, "code": codigo, "pid": product_id}).fetchone()
        if ocupado:
            raise ValueError(f"Ese código ya lo usa «{ocupado.name}»")

    db.execute(text("UPDATE products SET barcode = :code WHERE id = :pid"),
               {"code": codigo, "pid": product_id})
    return {"product_id": product_id, "barcode": codigo}
