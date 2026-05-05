"""
Chat en tiempo real vía WebSocket — multi-tenant por store_id.
"""
from typing import Dict, List, Optional
from datetime import datetime, timezone, timedelta

from fastapi import (
    APIRouter, WebSocket, WebSocketDisconnect,
    Depends, Query, HTTPException, Request,
    UploadFile, File, Form
)
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.mensajes import Mensaje
from app.api.dependencies import get_current_user


# ──────────────────────────────────────────────────────────────────────────
# Connection Manager
# ──────────────────────────────────────────────────────────────────────────
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


manager = ConnectionManager()


# ──────────────────────────────────────────────────────────────────────────
# Routers
# ──────────────────────────────────────────────────────────────────────────
ws_router = APIRouter(prefix="/ws", tags=["chat-ws"])
api_router = APIRouter(prefix="/chat", tags=["chat"])


# ──────────────────────────────────────────────────────────────────────────
# WebSocket /ws/chat/{store_id}?token=...
# ──────────────────────────────────────────────────────────────────────────
@ws_router.websocket("/chat/{store_id}")
async def websocket_chat(
    websocket: WebSocket,
    store_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    # Autenticación
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4001)
        return

    user_id = payload.get("user_id") or payload.get("sub")
    user_store_id = payload.get("store_id")
    full_name = payload.get("full_name", "Usuario")
    role = payload.get("role", "seller")

    try:
        user_id = int(user_id) if user_id is not None else None
        user_store_id = int(user_store_id) if user_store_id is not None else None
    except (TypeError, ValueError):
        await websocket.close(code=4001)
        return

    if not user_id:
        await websocket.close(code=4001)
        return

    if user_store_id != store_id:
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, store_id, user_id)

    # Avisar a los demás que entró
    await manager.send_to_store(
        store_id,
        {
            "type": "system",
            "content": f"{full_name} está en línea",
            "user_id": user_id,
            "full_name": full_name,
            "online_users": manager.get_online_users(store_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        exclude_user_id=user_id,
    )

    # Historial reciente (últimos 30)
    historial = (
        db.query(Mensaje)
        .filter(Mensaje.store_id == store_id)
        .order_by(Mensaje.created_at.desc())
        .limit(30)
        .all()
    )
    await websocket.send_json({
        "type": "history",
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "sender_name": m.sender.full_name if m.sender else "Sistema",
                "content": m.content,
                "msg_type": m.msg_type,
                "media_url": m.media_url,
                "timestamp": m.created_at.isoformat() if m.created_at else None,
                "is_read": bool(m.is_read),
                "own": m.sender_id == user_id,
            }
            for m in reversed(historial)
        ],
        "online_users": manager.get_online_users(store_id),
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "text")
            content = (data.get("content") or "").strip()
            receiver_id = data.get("receiver_id")  # None = broadcast
            media_url = data.get("media_url")

            # Typing indicator: broadcast efímero sin tocar la BD
            if msg_type in ("typing", "stop_typing"):
                await manager.send_to_store(
                    store_id,
                    {
                        "type": msg_type,
                        "sender_id": user_id,
                        "sender_name": full_name,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                    exclude_user_id=user_id,
                )
                continue

            # Solicitud de historial filtrado (cambio de conversación)
            if msg_type == "get_history":
                from sqlalchemy import or_, and_
                receiver_id_hist = data.get("receiver_id")
                if receiver_id_hist is None:
                    # Historial del grupo (broadcasts)
                    historial = (
                        db.query(Mensaje)
                        .filter(
                            Mensaje.store_id == store_id,
                            Mensaje.receiver_id == None,  # noqa: E711
                        )
                        .order_by(Mensaje.created_at.desc())
                        .limit(30)
                        .all()
                    )
                else:
                    # Historial privado entre dos usuarios
                    historial = (
                        db.query(Mensaje)
                        .filter(
                            Mensaje.store_id == store_id,
                            or_(
                                and_(
                                    Mensaje.sender_id == user_id,
                                    Mensaje.receiver_id == receiver_id_hist,
                                ),
                                and_(
                                    Mensaje.sender_id == receiver_id_hist,
                                    Mensaje.receiver_id == user_id,
                                ),
                            ),
                        )
                        .order_by(Mensaje.created_at.desc())
                        .limit(30)
                        .all()
                    )

                await websocket.send_json({
                    "type": "history",
                    "messages": [
                        {
                            "id": m.id,
                            "sender_id": m.sender_id,
                            "sender_name": m.sender.full_name if m.sender else "Sistema",
                            "content": m.content,
                            "msg_type": m.msg_type,
                            "media_url": m.media_url,
                            "timestamp": m.created_at.isoformat() if m.created_at else None,
                            "receiver_id": m.receiver_id,
                            "is_read": bool(m.is_read),
                            "own": m.sender_id == user_id,
                        }
                        for m in reversed(historial)
                    ],
                })
                continue

            # Mensajes con media (image/audio/video) no requieren content
            if not content and msg_type == "text":
                continue
            if msg_type in ("image", "audio", "video") and not media_url:
                continue

            mensaje = Mensaje(
                store_id=store_id,
                sender_id=user_id,
                receiver_id=receiver_id,
                content=content,
                msg_type=msg_type,
                media_url=media_url,
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )
            db.add(mensaje)
            db.commit()
            db.refresh(mensaje)

            payload_out = {
                "type": "message",
                "id": mensaje.id,
                "sender_id": user_id,
                "sender_name": full_name,
                "sender_role": role,
                "receiver_id": receiver_id,
                "content": content,
                "msg_type": msg_type,
                "media_url": mensaje.media_url,
                "timestamp": mensaje.created_at.isoformat() if mensaje.created_at else None,
            }

            if receiver_id:
                await manager.send_to_user(store_id, int(receiver_id), payload_out)
                await websocket.send_json({**payload_out, "own": True})
            else:
                await manager.send_to_store(store_id, payload_out, exclude_user_id=user_id)
                await websocket.send_json({**payload_out, "own": True})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[chat WS] error en loop user={user_id} store={store_id}: {e}")
    finally:
        manager.disconnect(store_id, user_id)
        await manager.send_to_store(
            store_id,
            {
                "type": "system",
                "content": f"{full_name} salió",
                "user_id": user_id,
                "online_users": manager.get_online_users(store_id),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )


# ──────────────────────────────────────────────────────────────────────────
# REST: marcar como leído  →  /api/v1/chat/{store_id}/read/{mensaje_id}
# ──────────────────────────────────────────────────────────────────────────
@api_router.post("/{store_id}/read/{mensaje_id}")
async def marcar_leido(
    store_id: int,
    mensaje_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.store_id != store_id:
        raise HTTPException(status_code=403, detail="No autorizado para este store")

    msg = db.query(Mensaje).filter_by(id=mensaje_id, store_id=store_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")

    if not msg.is_read:
        msg.is_read = True
        msg.read_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True, "id": msg.id, "is_read": True}


# ──────────────────────────────────────────────────────────────────────────
# REST: marcar todos como leídos  →  /api/v1/chat/mark-all-read
# ──────────────────────────────────────────────────────────────────────────
@api_router.post("/mark-all-read")
async def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Marca como leídos todos los mensajes (directos + broadcasts) que el
    usuario actual tenía pendientes en su store."""
    now = datetime.now(timezone.utc)
    updated = (
        db.query(Mensaje)
        .filter(
            Mensaje.store_id == current_user.store_id,
            Mensaje.sender_id != current_user.id,
            Mensaje.is_read == False,  # noqa: E712
            or_(
                Mensaje.receiver_id == current_user.id,
                Mensaje.receiver_id.is_(None),
            ),
        )
        .update({"is_read": True, "read_at": now}, synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "updated": int(updated)}


# ──────────────────────────────────────────────────────────────────────────
# REST: contar mensajes no leídos del usuario  →  /api/v1/chat/unread-count
# ──────────────────────────────────────────────────────────────────────────
@api_router.get("/unread-count")
async def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cuenta mensajes no leídos para el usuario actual.

    Considera tanto mensajes directos (receiver_id == me) como broadcasts
    (receiver_id IS NULL). Excluye los propios.
    """
    count = (
        db.query(Mensaje)
        .filter(
            Mensaje.store_id == current_user.store_id,
            Mensaje.sender_id != current_user.id,
            Mensaje.is_read == False,  # noqa: E712
            or_(
                Mensaje.receiver_id == current_user.id,
                Mensaje.receiver_id.is_(None),
            ),
        )
        .count()
    )
    return {"count": int(count)}


# ──────────────────────────────────────────────────────────────────────────
# REST: subir multimedia  →  /api/v1/chat/upload-media
# ──────────────────────────────────────────────────────────────────────────
ALLOWED_MEDIA_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm",
    "audio/webm", "audio/mpeg", "audio/ogg", "audio/mp4",
}

EXT_TO_CT = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
}


@api_router.post("/upload-media")
async def upload_media(
    file: UploadFile = File(...),
    store_id: int = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sube imagen/video/audio al bucket de GCS (con fallback a disco local).
    Devuelve `{url}` apuntando al endpoint proxy /api/v1/chat/media/...
    """
    import uuid
    import os
    from app.services.upload_service import get_gcs_client
    from app.core.config import settings

    if current_user.store_id != store_id:
        raise HTTPException(status_code=403, detail="No autorizado para este store")

    if file.content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo no permitido: {file.content_type}")

    raw_name = (file.filename or "blob").lower()
    ext = raw_name.rsplit(".", 1)[-1] if "." in raw_name else ""
    if not ext or len(ext) > 5:
        # Derivar extensión del content-type
        ct_to_ext = {v: k for k, v in EXT_TO_CT.items()}
        ext = ct_to_ext.get(file.content_type, "bin")

    blob_path = f"chat/{store_id}/{uuid.uuid4()}.{ext}"
    content = await file.read()

    try:
        client = get_gcs_client()
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(content, content_type=file.content_type)
        return {"url": f"/api/v1/chat/media/{blob_path}", "ok": True}
    except Exception as e:
        print(f"[chat upload] GCS falló, fallback local: {e}")
        local_dir = f"static/uploads/chat/{store_id}"
        os.makedirs(local_dir, exist_ok=True)
        local_file = f"{local_dir}/{uuid.uuid4()}.{ext}"
        with open(local_file, "wb") as f:
            f.write(content)
        return {"url": f"/{local_file}", "ok": True}


# ──────────────────────────────────────────────────────────────────────────
# REST: servir multimedia  →  /api/v1/chat/media/{path:path}
# ──────────────────────────────────────────────────────────────────────────
@api_router.get("/media/{path:path}")
async def serve_chat_media(path: str):
    """Proxy de descarga desde GCS con cache 24h."""
    import io
    from fastapi.responses import StreamingResponse
    from app.services.upload_service import get_gcs_client
    from app.core.config import settings

    try:
        client = get_gcs_client()
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        blob = bucket.blob(path)
        data = io.BytesIO()
        blob.download_to_file(data)
        data.seek(0)

        ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        content_type = EXT_TO_CT.get(ext, "application/octet-stream")

        return StreamingResponse(
            data,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[chat media] no se pudo servir {path}: {e}")
        raise HTTPException(status_code=404, detail="No encontrado")


# Compatibilidad con el spec que importa `chat.router`
router = ws_router
