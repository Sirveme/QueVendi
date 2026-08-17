"""
QueVendi — Pagos múltiples por venta
=====================================

Una venta puede cobrarse con varios métodos a la vez. En un restaurante
pasa a diario: la mesa paga S/40 por Yape, S/20 en efectivo y S/12 con
tarjeta. Antes eso obligaba a elegir UN método y el arqueo salía mal.

`sales.payment_method` se conserva como resumen histórico ('multiple',
'yape+efectivo'…), pero el detalle real —y el que usan los reportes de
caja— vive en `sale_pagos`.

La tabla se crea en comanda_service._ensure_tables (MIGRATION_SALE_PAGOS_SQL).
"""

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

METODOS = ("yape", "plin", "efectivo", "tarjeta", "transferencia", "otro")

# Tolerancia de redondeo: dos pagos de S/33.33 y S/66.67 suman 100.00,
# pero los decimales pueden dejar una diferencia de un céntimo.
TOLERANCIA = Decimal("0.01")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def resumen(db: Session, sale_id: int, store_id: int) -> Optional[dict]:
    """
    Pagos de una venta con su saldo. None si la venta no es de esta tienda.
    """
    venta = db.execute(text("""
        SELECT id, total, payment_method FROM sales
        WHERE id = :sid AND store_id = :store
    """), {"sid": sale_id, "store": store_id}).fetchone()

    if not venta:
        return None

    filas = db.execute(text("""
        SELECT id, metodo, monto, referencia, created_at
        FROM sale_pagos WHERE sale_id = :sid ORDER BY id
    """), {"sid": sale_id}).fetchall()

    pagos = [{
        "id": r.id,
        "metodo": r.metodo,
        "monto": float(r.monto),
        "referencia": r.referencia,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in filas]

    total = _dec(venta.total)
    pagado = _dec(sum(_dec(p["monto"]) for p in pagos))
    saldo = _dec(total - pagado)

    return {
        "sale_id": sale_id,
        "total": float(total),
        "total_pagado": float(pagado),
        "saldo_pendiente": float(saldo if saldo > 0 else Decimal("0.00")),
        "cubierto": saldo <= TOLERANCIA,
        "payment_method": venta.payment_method,
        "pagos": pagos,
    }


def agregar(db: Session, sale_id: int, store_id: int, metodo: str,
            monto, referencia: Optional[str] = None) -> dict:
    """
    Registra un pago parcial. No commitea.

    Raises:
        LookupError: la venta no existe o es de otra tienda.
        ValueError:  método inválido, monto <= 0 o excede el saldo.
    """
    actual = resumen(db, sale_id, store_id)
    if actual is None:
        raise LookupError("Venta no encontrada")

    metodo = (metodo or "").strip().lower()
    if metodo not in METODOS:
        raise ValueError(f"Método inválido. Opciones: {', '.join(METODOS)}")

    monto_dec = _dec(monto)
    if monto_dec <= 0:
        raise ValueError("El monto debe ser mayor a 0")

    saldo = _dec(actual["saldo_pendiente"])
    if monto_dec - saldo > TOLERANCIA:
        raise ValueError(
            f"El pago (S/ {monto_dec}) supera el saldo pendiente (S/ {saldo})"
        )

    row = db.execute(text("""
        INSERT INTO sale_pagos (sale_id, metodo, monto, referencia)
        VALUES (:sid, :met, :mon, :ref)
        RETURNING id, created_at
    """), {
        "sid": sale_id, "met": metodo, "mon": monto_dec,
        "ref": (referencia or "").strip()[:100] or None,
    }).fetchone()

    _sincronizar_payment_method(db, sale_id)

    return {
        "id": row.id,
        "sale_id": sale_id,
        "metodo": metodo,
        "monto": float(monto_dec),
        "referencia": referencia,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def eliminar(db: Session, sale_id: int, store_id: int, pago_id: int) -> bool:
    """Borra un pago mal registrado. No commitea."""
    if resumen(db, sale_id, store_id) is None:
        raise LookupError("Venta no encontrada")

    r = db.execute(text("""
        DELETE FROM sale_pagos WHERE id = :pid AND sale_id = :sid RETURNING id
    """), {"pid": pago_id, "sid": sale_id}).fetchone()

    if not r:
        return False

    _sincronizar_payment_method(db, sale_id)
    return True


def _sincronizar_payment_method(db: Session, sale_id: int) -> None:
    """
    Mantiene `sales.payment_method` legible.

    Un solo método → ese método. Varios → 'yape+efectivo'. Así los
    reportes viejos que leen esa columna siguen diciendo algo cierto.
    """
    metodos = [r[0] for r in db.execute(text("""
        SELECT DISTINCT metodo FROM sale_pagos WHERE sale_id = :sid ORDER BY metodo
    """), {"sid": sale_id}).fetchall()]

    if not metodos:
        return

    if len(metodos) == 1:
        resumen_txt = metodos[0]
    else:
        unidos = "+".join(metodos)
        # La columna es VARCHAR(20): cortar dejaría cosas como
        # 'efectivo+tarjeta+yap', que se lee como un método inventado.
        # Mejor decir 'multiple' y que el detalle se consulte en sale_pagos.
        resumen_txt = unidos if len(unidos) <= 20 else "multiple"

    db.execute(text("UPDATE sales SET payment_method = :pm WHERE id = :sid"),
               {"pm": resumen_txt[:20], "sid": sale_id})


def resumen_por_metodo(db: Session, store_id: int, desde, hasta) -> list:
    """
    Totales por método real en una ventana. Es lo que debe usar el arqueo:
    `sales.payment_method` ya no representa un pago único.
    """
    filas = db.execute(text("""
        SELECT sp.metodo, COUNT(*) AS n, COALESCE(SUM(sp.monto), 0) AS monto
        FROM sale_pagos sp
        JOIN sales s ON s.id = sp.sale_id
        WHERE s.store_id = :store
          AND s.created_at >= :desde AND s.created_at < :hasta
        GROUP BY sp.metodo ORDER BY monto DESC
    """), {"store": store_id, "desde": desde, "hasta": hasta}).fetchall()

    return [{"metodo": r.metodo, "cantidad": r.n, "monto": float(r.monto)}
            for r in filas]
