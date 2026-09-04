"""
QueVendi — Reconciliación de comprobantes con SUNAT
====================================================

POR QUÉ EXISTE
--------------
Facturalo procesa en diferido. Cuando responde `exito` a una emisión,
eso significa "recibido en cola", no "SUNAT lo aceptó": el estado real
llega minutos después. El código antiguo guardaba `status='accepted'`
en ese momento, así que el sistema afirmaba que un comprobante estaba
aceptado sin tener ninguna prueba.

Con una cuenta bien configurada las dos cosas coinciden y no se nota.
Con una mal configurada, no: se midieron 65 comprobantes que QueVendi
daba por aceptados y que en Facturalo figuraban en `error`, sin código
SUNAT ni hash, y con la numeración divergida (el contador local corría
por delante del real).

Este módulo cierra ese hueco: pregunta a Facturalo el estado final de
cada comprobante y escribe lo que responda, nunca lo que se supone.

VOCABULARIO
-----------
Se espeja el de Facturalo, que es quien emite, para que los dos
sistemas hablen igual y no haya que traducir en cada lado:

    enviando     en cola; aún no hay veredicto de SUNAT
    aceptado     SUNAT lo aceptó (trae codigo_sunat y hash)
    rechazado    SUNAT lo rechazó
    desconocido  Facturalo no lo encuentra (HTTP 404)

Un estado que no se reconozca se trata como `enviando`, no como fallo:
Facturalo puede añadir estados intermedios y un comprobante en trámite
no debe aparecer como roto.

Los 404 tampoco son rechazos. Pueden ser un comprobante purgado o unas
credenciales que cambiaron; marcarlos «rechazado» sería inventar un
veredicto de SUNAT que nadie ha dado.
"""

import asyncio
import logging
from typing import Optional

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Estados propios, espejo de los de Facturalo.
ENVIANDO = "enviando"
ACEPTADO = "aceptado"
RECHAZADO = "rechazado"
DESCONOCIDO = "desconocido"

# Los que aún pueden cambiar: son los que el reconciliador vuelve a mirar.
ESTADOS_ABIERTOS = (ENVIANDO, DESCONOCIDO, "accepted", "pending")

# Cómo se traduce lo que dice Facturalo.
_MAPA = {
    "aceptado": ACEPTADO,
    "accepted": ACEPTADO,
    "rechazado": RECHAZADO,
    "rejected": RECHAZADO,
    # 'error' NO es un veredicto de SUNAT: es que Facturalo no consiguió
    # entregarlo. Puede reintentarse, así que sigue abierto.
    "error": ENVIANDO,
    "enviando": ENVIANDO,
    "pendiente": ENVIANDO,
}

TIMEOUT = 20.0
# Entre peticiones, para no castigar a Facturalo en lotes grandes.
PAUSA_ENTRE_CONSULTAS = 0.12


def _traducir(estado_facturalo: Optional[str]) -> str:
    """Estado de Facturalo → estado de QueVendi. Ante la duda, `enviando`."""
    return _MAPA.get(str(estado_facturalo or "").strip().lower(), ENVIANDO)


async def _consultar(cliente: httpx.AsyncClient, url: str, token: str,
                     secret: str, facturalo_id: str) -> dict:
    """Estado real de UN comprobante.

    Devuelve {"ok": bool, "estado": str, ...}. Nunca lanza: un fallo de
    red no debe abortar la reconciliación de los demás.
    """
    try:
        r = await cliente.get(
            f"{url}/comprobantes/{facturalo_id}",
            headers={"X-API-Key": token, "X-API-Secret": secret},
        )
    except Exception as e:
        # Sin respuesta: se reintenta en la siguiente pasada.
        return {"ok": False, "motivo": f"red: {e}"}

    if r.status_code == 404:
        return {"ok": True, "estado": DESCONOCIDO}
    if r.status_code != 200:
        return {"ok": False, "motivo": f"HTTP {r.status_code}"}

    try:
        c = r.json().get("comprobante", {}) or {}
    except Exception:
        return {"ok": False, "motivo": "respuesta no-JSON"}

    return {
        "ok": True,
        "estado": _traducir(c.get("estado")),
        "estado_facturalo": c.get("estado"),
        "codigo_sunat": c.get("codigo_sunat"),
        "hash": c.get("hash_cpe"),
        "mensaje": c.get("mensaje_sunat"),
        "numero_formato": c.get("numero_formato"),
    }


async def reconciliar_tienda(db: Session, store_id: int,
                             limite: int = 200,
                             solo_abiertos: bool = True) -> dict:
    """Actualiza los comprobantes de una tienda con lo que diga Facturalo.

    `solo_abiertos=False` revisa también los ya cerrados: se usa para la
    migración del histórico, donde todo está marcado con el `accepted`
    optimista antiguo y hay que comprobarlo uno a uno.
    """
    cfg = db.execute(text("""
        SELECT facturalo_url, facturalo_token, facturalo_secret
        FROM store_billing_configs WHERE store_id = :s
    """), {"s": store_id}).fetchone()

    if not cfg or not cfg[1] or not cfg[2]:
        return {"store_id": store_id, "revisados": 0, "motivo": "sin credenciales"}

    url, token, secret = cfg
    filtro = "AND status = ANY(:abiertos)" if solo_abiertos else ""
    params = {"s": store_id, "n": limite}
    if solo_abiertos:
        params["abiertos"] = list(ESTADOS_ABIERTOS)

    filas = db.execute(text(f"""
        SELECT id, facturalo_id, serie, numero, status
        FROM comprobantes
        WHERE store_id = :s AND facturalo_id IS NOT NULL {filtro}
        ORDER BY created_at DESC
        LIMIT :n
    """), params).fetchall()

    resumen = {"store_id": store_id, "revisados": 0, "cambiados": 0,
               "sin_respuesta": 0, "por_estado": {}}

    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        for f in filas:
            resumen["revisados"] += 1
            r = await _consultar(cliente, url, token, secret, f.facturalo_id)

            if not r["ok"]:
                # Se queda como está y se vuelve a intentar más adelante.
                resumen["sin_respuesta"] += 1
                continue

            nuevo = r["estado"]
            resumen["por_estado"][nuevo] = resumen["por_estado"].get(nuevo, 0) + 1

            if nuevo == f.status and nuevo != ACEPTADO:
                continue    # nada que escribir

            db.execute(text("""
                UPDATE comprobantes SET
                    status = :st,
                    sunat_response_code = COALESCE(:code, sunat_response_code),
                    sunat_hash = COALESCE(:hash, sunat_hash),
                    sunat_response_description = COALESCE(:msg, sunat_response_description),
                    updated_at = NOW()
                WHERE id = :id
            """), {
                "st": nuevo, "id": f.id,
                "code": r.get("codigo_sunat"),
                "hash": r.get("hash"),
                "msg": r.get("mensaje"),
            })
            if nuevo != f.status:
                resumen["cambiados"] += 1

            await asyncio.sleep(PAUSA_ENTRE_CONSULTAS)

    db.commit()
    return resumen


async def reconciliar_todas(db: Session, limite_por_tienda: int = 200,
                            solo_abiertos: bool = True) -> list:
    """Recorre todas las tiendas que tengan comprobantes pendientes de confirmar."""
    filtro = "AND c.status = ANY(:abiertos)" if solo_abiertos else ""
    params = {}
    if solo_abiertos:
        params["abiertos"] = list(ESTADOS_ABIERTOS)

    tiendas = [r[0] for r in db.execute(text(f"""
        SELECT DISTINCT c.store_id
        FROM comprobantes c
        JOIN store_billing_configs b ON b.store_id = c.store_id
        WHERE c.facturalo_id IS NOT NULL
          AND b.facturalo_token IS NOT NULL {filtro}
    """), params)]

    salida = []
    for sid in tiendas:
        try:
            salida.append(await reconciliar_tienda(
                db, sid, limite_por_tienda, solo_abiertos))
        except Exception as e:
            logger.error(f"[Reconciliación] store {sid}: {e}")
            db.rollback()
            salida.append({"store_id": sid, "error": str(e)[:120]})
    return salida


def comprobantes_estancados(db: Session, store_id: int, horas: int = 2) -> list:
    """Los que llevan demasiado tiempo sin veredicto de SUNAT.

    Es el momento en que el dueño puede hacer algo: revisar su cuenta de
    Facturalo, o avisar de que ese comprobante no está firme.
    """
    return [dict(r._mapping) for r in db.execute(text("""
        SELECT id, serie, numero, tipo, total, created_at
        FROM comprobantes
        WHERE store_id = :s
          AND status = :enviando
          AND created_at < NOW() - (:h || ' hours')::interval
        ORDER BY created_at
    """), {"s": store_id, "enviando": ENVIANDO, "h": horas})]
