"""
QueVendi — Módulo Cocina: endpoints
====================================

Flujo soportado (restaurantes chicos):
    cajero arma el pedido → "Enviar a cocina" → se imprime la comanda
    → cocina marca Empezar / Listo → se entrega.

Rutas:
  POST /api/v1/cocina/enviar                   → crea comanda y devuelve su número
  GET  /api/v1/cocina/pendientes               → cola de cocina (sólo hoy)
  GET  /api/v1/cocina/comanda/{id}             → detalle
  PUT  /api/v1/cocina/item/{id}/estado         → Empezar / Listo por ítem
  PUT  /api/v1/cocina/comanda/{id}/estado      → marcar entregada
  PUT  /api/v1/cocina/comanda/{id}/venta       → enlazar con la venta al cobrar

SEGURIDAD
---------
Todo endpoint que toca un recurso lo hace filtrando por el `store_id`
del token, nunca por uno recibido del cliente. Un id de otra tienda
devuelve 404, no 403: no se confirma siquiera que exista. Esto cierra
el IDOR que tiene Metraes, donde bastaba conocer el id del ítem para
mutar el pedido de otro negocio.

Todos los endpoints exigen además que la tienda tenga `kitchen_enabled`.
"""

import logging
from typing import List, Optional

from fastapi import (APIRouter, Depends, HTTPException, Query, Request,
                     WebSocket, WebSocketDisconnect)
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.services import comanda_service as cs
from app.services.comanda_print import payload_impresion
from app.services.ws_manager import (broadcast as ws_broadcast, canal_caja,
                                     canal_cocina, channels)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cocina", tags=["cocina"])
ws_router = APIRouter(prefix="/ws", tags=["cocina-ws"])


# ════════════════════════════════════════════════════════════════
# SCHEMAS
# ════════════════════════════════════════════════════════════════

class ComandaItemIn(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=200)
    cantidad: float = Field(1, gt=0)
    product_id: Optional[int] = None
    unidad: Optional[str] = None
    nota: Optional[str] = Field(None, max_length=200)


class EnviarComandaRequest(BaseModel):
    items: List[ComandaItemIn] = Field(..., min_length=1)
    sale_id: Optional[int] = None      # si ya se cobró
    nota: Optional[str] = None         # nota general ("para llevar")


class EstadoRequest(BaseModel):
    estado: str


class EnlazarVentaRequest(BaseModel):
    sale_id: int


# ════════════════════════════════════════════════════════════════
# DEPENDENCIA: tienda con cocina activa
# ════════════════════════════════════════════════════════════════

def _store_cocina(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> int:
    """
    Devuelve el store_id del usuario, exigiendo que tenga cocina activa.

    Centraliza la migración y la comprobación del feature flag, para que
    ningún endpoint pueda olvidarse de validarlo.
    """
    cs._ensure_tables(db)

    store_id = getattr(current_user, "store_id", None)
    if not store_id:
        raise HTTPException(400, "Usuario no asociado a una tienda")

    if not cs.kitchen_enabled(db, store_id):
        raise HTTPException(
            403,
            "El módulo cocina no está activado para este negocio. "
            "Actívalo en Configuración del negocio.",
        )
    return store_id


async def _store_cocina_o_device(
    request: Request,
    device_token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> int:
    """
    Acepta el JWT normal del usuario O un token de dispositivo.

    La pantalla de cocina cuelga de una pared y no tiene quien escriba
    una contraseña, así que se identifica con un token largo en la URL.
    Ese token sólo sirve para leer la cola y mover estados: no crea
    comandas ni ve ventas.
    """
    cs._ensure_tables(db)

    # 1) Token de dispositivo (query param o cabecera)
    token = device_token or request.headers.get("X-Device-Token")
    if token:
        store_id = cs.validar_device_token(db, token)
        if store_id:
            return store_id
        raise HTTPException(401, "Dispositivo no autorizado o revocado")

    # 2) Usuario autenticado normal
    try:
        user = await get_current_user(request, db)
    except HTTPException:
        raise HTTPException(401, "No autenticado")

    store_id = getattr(user, "store_id", None)
    if not store_id:
        raise HTTPException(400, "Usuario no asociado a una tienda")
    if not cs.kitchen_enabled(db, store_id):
        raise HTTPException(403, "El módulo cocina no está activado para este negocio.")
    return store_id


# ════════════════════════════════════════════════════════════════
# NOTIFICACIÓN WS (se completa en Día 3)
# ════════════════════════════════════════════════════════════════

def _notificar(canal: str, payload: dict) -> None:
    """
    Aviso en tiempo real. Best-effort: si el WS falla, la operación HTTP
    no se ve afectada — la comanda ya quedó guardada e impresa.
    """
    try:
        ws_broadcast(canal, payload)
    except Exception as e:
        logger.warning(f"[Cocina] No se pudo notificar a {canal}: {e}")


# ════════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════════

@router.post("/enviar", status_code=201)
async def enviar_a_cocina(
    req: EnviarComandaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(_store_cocina),
):
    """
    Crea una comanda y devuelve su número, listo para imprimir.

    El número es correlativo por tienda y por día operativo de Lima
    (ver comanda_service: advisory lock + UNIQUE).
    """
    try:
        comanda = cs.crear_comanda(
            db,
            store_id=store_id,
            cajero_id=getattr(current_user, "id", None),
            cajero_nombre=getattr(current_user, "full_name", None),
            sale_id=req.sale_id,
            nota=req.nota,
        )
        cs.agregar_items(db, comanda["id"], [i.dict() for i in req.items])
        db.commit()

    except RuntimeError as e:
        db.rollback()
        logger.error(f"[Cocina] {e}")
        raise HTTPException(503, "No se pudo generar el número de comanda. Reintenta.")
    except Exception as e:
        db.rollback()
        logger.error(f"[Cocina] Error creando comanda: {e}")
        raise HTTPException(500, "Error al enviar a cocina")

    detalle = cs.obtener_comanda(db, comanda["id"], store_id)

    _notificar(canal_cocina(store_id),{"tipo": "comanda_nueva", "comanda": detalle})

    logger.info(
        f"[Cocina] Comanda #{comanda['numero']} enviada — store {store_id}, "
        f"{len(req.items)} ítems"
    )

    return {
        "success": True,
        "comanda_id": comanda["id"],
        "numero": comanda["numero"],
        "fecha_operativa": comanda["fecha_operativa"].isoformat(),
        "comanda": detalle,
        # El navegador lo manda al Print Agent local. Va aquí para no
        # obligar a un segundo viaje justo cuando hay cola en la caja.
        "impresion": payload_impresion(detalle),
    }


@router.get("/comanda/{comanda_id}/impresion")
async def impresion_comanda(
    comanda_id: int,
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina),
):
    """Layout de la comanda para reimprimir (si la ticketera falló o se atascó)."""
    comanda = cs.obtener_comanda(db, comanda_id, store_id)
    if not comanda:
        raise HTTPException(404, "Comanda no encontrada")
    return {"numero": comanda["numero"], **payload_impresion(comanda)}


@router.get("/pendientes")
async def listar_pendientes(
    store_id_param: Optional[int] = Query(None, alias="store_id"),
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina_o_device),
):
    """
    Cola de cocina: comandas de HOY en estado 'sent' o 'preparing'.

    El parámetro `store_id` se acepta por comodidad del cliente, pero se
    valida: pedir el de otra tienda es 403. La consulta siempre usa el
    store_id del token.
    """
    if store_id_param is not None and store_id_param != store_id:
        raise HTTPException(403, "No puedes consultar la cocina de otro negocio")

    pendientes = cs.comandas_pendientes(db, store_id)
    return {"comandas": pendientes, "total": len(pendientes)}


@router.get("/sesion")
async def sesion_cocina(
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina_o_device),
):
    """
    Qué tienda es esta pantalla. La abre la pantalla al arrancar, porque
    con un token de dispositivo el cliente no conoce su store_id y lo
    necesita para armar la URL del WebSocket.
    """
    nombre = db.execute(
        text("SELECT COALESCE(commercial_name, business_name) FROM stores WHERE id = :s"),
        {"s": store_id},
    ).scalar()
    return {"store_id": store_id, "negocio": nombre or "Cocina"}


@router.get("/comanda/{comanda_id}")
async def detalle_comanda(
    comanda_id: int,
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina),
):
    """Detalle de una comanda de esta tienda."""
    comanda = cs.obtener_comanda(db, comanda_id, store_id)
    if not comanda:
        raise HTTPException(404, "Comanda no encontrada")
    return comanda


@router.put("/item/{item_id}/estado")
async def cambiar_estado_item(
    item_id: int,
    req: EstadoRequest,
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina_o_device),
):
    """
    Botones "Empezar" (sent→preparing) y "Listo" (preparing→ready).

    Cuando todos los ítems quedan listos, la comanda pasa sola a 'ready'
    y se avisa a caja.
    """
    try:
        r = cs.cambiar_estado_item(db, item_id, store_id, req.estado)
        db.commit()
    except LookupError:
        db.rollback()
        raise HTTPException(404, "Ítem no encontrado")
    except ValueError as e:
        db.rollback()
        raise HTTPException(409, str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"[Cocina] Error cambiando estado de ítem {item_id}: {e}")
        raise HTTPException(500, "Error al actualizar el ítem")

    _notificar(canal_cocina(store_id),{"tipo": "item_actualizado", **r})

    # La comanda quedó completa → avisar a caja para que la entreguen.
    if r["comanda_completa"]:
        _notificar(canal_caja(store_id), {
            "tipo": "comanda_lista",
            "comanda_id": r["comanda_id"],
            "numero": r["comanda_numero"],
        })

    return {"success": True, **r}


@router.put("/comanda/{comanda_id}/estado")
async def cambiar_estado_comanda(
    comanda_id: int,
    req: EstadoRequest,
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina),
):
    """
    Cambia el estado de la comanda completa. Se usa sobre todo para
    marcarla 'served' al entregarla, y así sacarla de la cola.
    """
    try:
        r = cs.cambiar_estado_comanda(db, comanda_id, store_id, req.estado)
        db.commit()
    except LookupError:
        db.rollback()
        raise HTTPException(404, "Comanda no encontrada")
    except ValueError as e:
        db.rollback()
        raise HTTPException(409, str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"[Cocina] Error cambiando estado de comanda {comanda_id}: {e}")
        raise HTTPException(500, "Error al actualizar la comanda")

    _notificar(canal_cocina(store_id),{"tipo": "comanda_actualizada", **r})
    if r["estado"] == "ready":
        _notificar(canal_caja(store_id), {
            "tipo": "comanda_lista",
            "comanda_id": r["comanda_id"],
            "numero": r["numero"],
        })

    return {"success": True, **r}


@router.get("/ws/estado")
async def estado_ws(store_id: int = Depends(_store_cocina)):
    """Cuántas pantallas hay escuchando. Útil para diagnosticar en sitio."""
    return {
        "cocina_conectadas": channels.count(canal_cocina(store_id)),
        "caja_conectadas": channels.count(canal_caja(store_id)),
    }


@router.put("/comanda/{comanda_id}/venta")
async def enlazar_venta(
    comanda_id: int,
    req: EnlazarVentaRequest,
    db: Session = Depends(get_db),
    store_id: int = Depends(_store_cocina),
):
    """
    Enlaza la comanda con la venta con que se cobró.

    Permite el flujo "manda a cocina primero, cobra al final".
    """
    try:
        r = cs.enlazar_venta(db, comanda_id, store_id, req.sale_id)
        db.commit()
    except LookupError:
        db.rollback()
        raise HTTPException(404, "Comanda no encontrada")
    except Exception as e:
        db.rollback()
        logger.error(f"[Cocina] Error enlazando venta: {e}")
        raise HTTPException(500, "Error al enlazar la venta")

    return {"success": True, **r}


# ════════════════════════════════════════════════════════════════
# DISPOSITIVOS (sólo el dueño, desde Configuración del negocio)
# ════════════════════════════════════════════════════════════════

class DeviceRequest(BaseModel):
    nombre: Optional[str] = None


@router.post("/devices", status_code=201)
async def crear_device(
    req: DeviceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(_store_cocina),
):
    """
    Genera el enlace para una pantalla de cocina.

    El token completo se devuelve UNA sola vez: después sólo se ven los
    últimos 6 caracteres para identificarlo.
    """
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede autorizar pantallas de cocina")

    d = cs.crear_device_token(db, store_id, req.nombre or "")
    db.commit()

    return {
        "success": True,
        **d,
        "url": f"/cocina?device_token={d['token']}",
        "aviso": "Guarda este enlace: el token no se vuelve a mostrar completo.",
    }


@router.get("/devices")
async def listar_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(_store_cocina),
):
    """Pantallas autorizadas, con su última conexión."""
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede ver las pantallas autorizadas")
    return {"devices": cs.listar_devices(db, store_id)}


@router.delete("/devices/{device_id}")
async def revocar_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(_store_cocina),
):
    """Revoca una pantalla (tablet perdida, personal que se va)."""
    if getattr(current_user, "role", None) not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Sólo el dueño puede revocar pantallas")

    if not cs.revocar_device(db, device_id, store_id):
        db.rollback()
        raise HTTPException(404, "Dispositivo no encontrado")
    db.commit()
    return {"success": True, "device_id": device_id}


# ════════════════════════════════════════════════════════════════
# WEBSOCKET
# ════════════════════════════════════════════════════════════════

async def _ws_suscribir(websocket: WebSocket, store_id: int,
                        token: Optional[str], device_token: Optional[str],
                        canal_fn) -> None:
    """
    Autentica por query param —JWT de usuario o token de dispositivo—
    y mantiene la suscripción al canal hasta que el cliente se va.

    Códigos de cierre, iguales a los del chat:
        4001 credencial inválida     4003 tienda ajena
        4004 cocina desactivada
    """
    token_store: Optional[int] = None

    if device_token:
        db = next(get_db())
        try:
            cs._ensure_tables(db)
            token_store = cs.validar_device_token(db, device_token)
        finally:
            db.close()
        if token_store is None:
            # Puede ser token revocado o cocina apagada: se distingue en
            # el cliente por si merece la pena reintentar.
            await websocket.close(code=4001)
            return
    else:
        payload = decode_token(token or "")
        if not payload:
            await websocket.close(code=4001)
            return
        try:
            token_store = int(payload.get("store_id")) if payload.get("store_id") else None
        except (TypeError, ValueError):
            await websocket.close(code=4001)
            return

    # Una pantalla sólo puede escuchar su propia tienda.
    if token_store != store_id:
        await websocket.close(code=4003)
        return

    if not device_token:
        db = next(get_db())
        try:
            cs._ensure_tables(db)
            if not cs.kitchen_enabled(db, store_id):
                await websocket.close(code=4004)
                return
        finally:
            db.close()

    canal = canal_fn(store_id)
    await channels.connect(websocket, canal)
    try:
        while True:
            # No esperamos mensajes del cliente: sólo mantenemos viva la
            # conexión y respondemos su heartbeat.
            data = await websocket.receive_text()
            if data:
                await websocket.send_json({"tipo": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.info(f"[Cocina WS] cierre en {canal}: {e}")
    finally:
        channels.disconnect(websocket, canal)


@ws_router.websocket("/cocina/{store_id}")
async def ws_cocina(websocket: WebSocket, store_id: int,
                    token: Optional[str] = Query(None),
                    device_token: Optional[str] = Query(None)):
    """Pantalla de cocina: recibe comandas nuevas y cambios de estado."""
    await _ws_suscribir(websocket, store_id, token, device_token, canal_cocina)


@ws_router.websocket("/caja/{store_id}")
async def ws_caja(websocket: WebSocket, store_id: int,
                  token: Optional[str] = Query(None),
                  device_token: Optional[str] = Query(None)):
    """Pantalla de venta: recibe el aviso cuando un pedido está listo."""
    await _ws_suscribir(websocket, store_id, token, device_token, canal_caja)
