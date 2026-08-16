"""
QueVendi — Gestor de conexiones WebSocket compartido
=====================================================

Reúne en un solo sitio las conexiones en tiempo real del sistema:

  ConnectionManager  → chat interno, indexado por (store_id, user_id).
                       Movido tal cual desde app/routers/chat.py; su
                       comportamiento no cambió, sólo su ubicación.

  ChannelManager     → canales de difusión por nombre, para pantallas
                       que no necesitan identidad de usuario:
                         cocina:{store_id}  → pantalla de cocina
                         caja:{store_id}    → avisos a la caja

Por qué dos y no uno: el chat necesita saber QUIÉN está conectado
(`send_to_user`, `get_online_users`); la pantalla de cocina no — puede
haber dos tablets mostrando lo mismo y ambas deben recibir todo.
Forzarlas al mismo modelo obligaría a inventar user_ids falsos.

LÍMITE CONOCIDO — MÚLTIPLES RÉPLICAS
------------------------------------
El estado vive en memoria del proceso. Si la aplicación corre con más
de una réplica, un evento emitido en la réplica A no llega a los
clientes conectados a la B. La solución sería un backend pub/sub
(Redis) detrás de esta misma interfaz — por eso el resto del código
sólo habla con `broadcast()` y nunca toca los diccionarios: cambiarlo
después no obliga a tocar los routers.
"""

import asyncio
import logging
from typing import Dict, List, Optional, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
# Chat: conexiones por usuario  (movido desde routers/chat.py)
# ──────────────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # { store_id: { user_id: WebSocket } }
        self.active: Dict[int, Dict[int, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, store_id: int, user_id: int):
        await websocket.accept()
        self.active.setdefault(store_id, {})[user_id] = websocket

    def disconnect(self, store_id: int, user_id: int):
        if store_id in self.active:
            self.active[store_id].pop(user_id, None)
            if not self.active[store_id]:
                del self.active[store_id]

    async def send_to_store(self, store_id: int, message: dict, exclude_user_id: int = None):
        """Broadcast a todos los conectados del store."""
        if store_id not in self.active:
            return
        dead = []
        for uid, ws in list(self.active[store_id].items()):
            if uid == exclude_user_id:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.active[store_id].pop(uid, None)

    async def send_to_user(self, store_id: int, user_id: int, message: dict):
        ws = self.active.get(store_id, {}).get(user_id)
        if not ws:
            return
        try:
            await ws.send_json(message)
        except Exception:
            self.active[store_id].pop(user_id, None)

    def get_online_users(self, store_id: int) -> List[int]:
        return list(self.active.get(store_id, {}).keys())


# ──────────────────────────────────────────────────────────────────
# Canales de difusión: cocina / caja
# ──────────────────────────────────────────────────────────────────
class ChannelManager:
    def __init__(self):
        # { "cocina:20": {WebSocket, WebSocket} }
        self.channels: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, canal: str):
        await websocket.accept()
        self.channels.setdefault(canal, set()).add(websocket)
        logger.info(f"[WS] +1 en {canal} (total {len(self.channels[canal])})")

    def disconnect(self, websocket: WebSocket, canal: str):
        conns = self.channels.get(canal)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            del self.channels[canal]

    async def send(self, canal: str, message: dict):
        """Envía a todos los suscriptores del canal. Purga los muertos."""
        conns = self.channels.get(canal)
        if not conns:
            return
        muertos = []
        for ws in list(conns):
            try:
                await ws.send_json(message)
            except Exception:
                muertos.append(ws)
        for ws in muertos:
            conns.discard(ws)
        if canal in self.channels and not self.channels[canal]:
            del self.channels[canal]

    def count(self, canal: str) -> int:
        return len(self.channels.get(canal, ()))


# Instancias compartidas por toda la aplicación.
manager = ConnectionManager()
channels = ChannelManager()


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def canal_cocina(store_id: int) -> str:
    return f"cocina:{store_id}"


def canal_caja(store_id: int) -> str:
    return f"caja:{store_id}"


def broadcast(canal: str, payload: dict) -> None:
    """
    Emite a un canal desde código síncrono.

    Los endpoints REST no pueden `await` en medio de su lógica de
    negocio, así que esto programa el envío en el event loop y vuelve
    de inmediato. Si no hay loop corriendo (un script, un test), no
    hace nada: avisar por WS nunca debe tumbar la operación principal.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug(f"[WS] Sin event loop; se omite el aviso a {canal}")
        return

    loop.create_task(_broadcast_seguro(canal, payload))


async def _broadcast_seguro(canal: str, payload: dict) -> None:
    try:
        await channels.send(canal, payload)
    except Exception as e:
        logger.warning(f"[WS] Error emitiendo a {canal}: {e}")
