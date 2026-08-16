"""
QueVendi — Utilidades de tiempo para el día operativo peruano
=============================================================

POR QUÉ EXISTE ESTE MÓDULO
--------------------------
El servidor (Railway) y Postgres corren en UTC. Perú es UTC-5.
Si se calcula "hoy" con `date.today()`, `datetime.now()` o
`CURRENT_DATE`, el día cambia a las **19:00 hora Lima**, no a
medianoche. Eso rompe reportes diarios, correlativos por día y
cualquier pantalla que muestre "lo de hoy" durante la noche.

Este módulo centraliza el cálculo correcto. Úsalo SIEMPRE que la
lógica dependa de qué día es en Lima.

CUÁL USAR
---------
- `ahora_peru()`      → el instante actual, en hora de Lima (aware).
                        Para mostrar al usuario o comparar horas.
- `hoy_peru()`        → la fecha de hoy en Lima. Para etiquetar
                        ("fecha": "2026-08-15"), para correlativos
                        diarios y para valores por defecto.
- `dia_operativo_peru()` → la ventana [00:00, 24:00) de un día de
                        Lima, expresada en UTC, lista para filtrar
                        columnas timestamp en Postgres.

NO uses `date.today()`, `datetime.now()`, `datetime.utcnow()` ni
`CURRENT_DATE` para lógica de día operativo.

SOBRE `naive`
-------------
Las columnas de fecha del proyecto no son homogéneas:

  - `timestamp WITH time zone`    (sales.created_at, sales.sale_date,
    incidentes.created_at)        → usar `naive=False` (por defecto)
  - `timestamp WITHOUT time zone` (lite_ventas.created_at,
    carta_pedidos.created_at)     → usar `naive=True`

Las columnas sin timezone guardan el `NOW()` de Postgres, que con el
servidor en Etc/UTC equivale a UTC sin tzinfo. Compararlas contra un
datetime *aware* provoca una conversión implícita; por eso se ofrece
la variante naive, ya convertida a UTC.

NOTA SOBRE EL OFFSET
--------------------
Perú no aplica horario de verano desde 1994, así que el offset es
-05:00 fijo. Se usa un offset fijo en vez de `ZoneInfo("America/Lima")`
para no depender de que la imagen del contenedor traiga tzdata.
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Tuple

# Perú: UTC-5 todo el año (sin horario de verano).
PERU_TZ = timezone(timedelta(hours=-5))

__all__ = [
    "PERU_TZ",
    "ahora_peru",
    "hoy_peru",
    "dia_operativo_peru",
    "a_hora_peru",
]


def ahora_peru() -> datetime:
    """Instante actual en hora de Lima (timezone-aware, offset -05:00)."""
    return datetime.now(PERU_TZ)


def hoy_peru() -> date:
    """
    Fecha de hoy según el reloj de Lima.

    Reemplaza a `date.today()` y `datetime.now().date()`, que en un
    servidor UTC adelantan el día a partir de las 19:00 hora Lima.
    """
    return datetime.now(PERU_TZ).date()


def dia_operativo_peru(
    fecha_ref: Optional[date] = None,
    naive: bool = False,
) -> Tuple[datetime, datetime]:
    """
    Ventana [inicio, fin) de un día operativo de Lima, expresada en UTC.

    El rango es semiabierto: `inicio <= x < fin`. Filtra siempre con
    `>= inicio` y `< fin` (nunca `<= fin`, duplicarías la medianoche).

    Args:
        fecha_ref: Día de Lima a acotar. Si es None, usa hoy en Lima.
        naive: True devuelve los extremos en UTC pero sin tzinfo, para
               comparar contra columnas `timestamp WITHOUT time zone`.

    Returns:
        (inicio_utc, fin_utc)

    Ejemplo:
        >>> inicio, fin = dia_operativo_peru()          # hoy en Lima
        >>> db.query(Sale).filter(
        ...     Sale.created_at >= inicio,
        ...     Sale.created_at < fin,
        ... )
    """
    if fecha_ref is None:
        fecha_ref = hoy_peru()

    inicio_peru = datetime.combine(fecha_ref, time.min, tzinfo=PERU_TZ)
    fin_peru = datetime.combine(fecha_ref + timedelta(days=1), time.min, tzinfo=PERU_TZ)

    inicio_utc = inicio_peru.astimezone(timezone.utc)
    fin_utc = fin_peru.astimezone(timezone.utc)

    if naive:
        return inicio_utc.replace(tzinfo=None), fin_utc.replace(tzinfo=None)

    return inicio_utc, fin_utc


def a_hora_peru(dt: datetime) -> datetime:
    """
    Convierte un datetime a hora de Lima.

    Un datetime sin tzinfo se asume en UTC, que es como el proyecto
    guarda las fechas (Postgres en Etc/UTC).
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PERU_TZ)
