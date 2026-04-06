"""
QueVendi — Carta Virtual (pública)
===================================
Catálogo público de productos accesible sin autenticación.
URL: /carta/{telefono}

Rutas:
  GET  /carta/{telefono}                        → Template HTML
  GET  /api/public/carta/{telefono}/productos   → JSON productos agrupados
  GET  /api/public/carta/{telefono}/info         → JSON info del negocio
  POST /api/public/carta/{telefono}/visita       → Registrar visita

Registrar en main.py:
  from app.routers.carta_virtual import router as carta_router
  app.include_router(carta_router)
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import logging

from app.core.database import get_db
from app.models.store import Store
from app.models.product import Product

logger = logging.getLogger(__name__)
router = APIRouter()

# ════════════════════════════════════════════════
# MIGRACIÓN
# ════════════════════════════════════════════════
MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS carta_visitantes (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id),
    device_fingerprint VARCHAR(64),
    installed_pwa BOOLEAN DEFAULT FALSE,
    first_visit TIMESTAMP DEFAULT NOW(),
    last_visit TIMESTAMP DEFAULT NOW(),
    visit_count INTEGER DEFAULT 1,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carta_visitantes_store ON carta_visitantes(store_id);
CREATE INDEX IF NOT EXISTS idx_carta_visitantes_fp ON carta_visitantes(device_fingerprint, store_id);

CREATE TABLE IF NOT EXISTS chat_mensajes (
    id SERIAL PRIMARY KEY,
    store_id INTEGER REFERENCES stores(id),
    device_fingerprint VARCHAR(64),
    mensaje TEXT NOT NULL,
    remitente VARCHAR(10) DEFAULT 'cliente',
    leido BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_store ON chat_mensajes(store_id);
"""

def _ensure_tables(db: Session):
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[Carta] Migración: {e}")


# ════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════
def _get_store_by_phone(db: Session, telefono: str) -> Optional[Store]:
    return db.query(Store).filter(Store.phone == telefono, Store.is_active == True).first()


def _get_store_logo(db: Session, store_id: int) -> Optional[str]:
    try:
        row = db.execute(text(
            "SELECT logo FROM store_config WHERE store_id = :sid"
        ), {"sid": store_id}).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


# ════════════════════════════════════════════════
# RUTAS HTML
# ════════════════════════════════════════════════

@router.get("/carta/{telefono}", response_class=HTMLResponse)
async def carta_virtual_page(
    telefono: str,
    request: Request,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No encontrado — QueVendi</title>
<style>body{{font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;color:#334155;text-align:center}}
.box{{max-width:400px;padding:40px}}.box h1{{font-size:3rem;margin-bottom:8px;color:#ef4444}}.box p{{color:#64748b;margin-bottom:20px}}
a{{color:#10b981;text-decoration:none;font-weight:600}}</style></head>
<body><div class="box"><h1>404</h1><h2>Negocio no encontrado</h2>
<p>El numero <strong>{telefono}</strong> no tiene carta virtual activa.</p>
<a href="https://quevendi.pro">Crear mi carta en QueVendi.pro</a></div></body></html>""", status_code=404)

    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory="app/templates")
    return templates.TemplateResponse("carta_virtual.html", {
        "request": request,
        "telefono": telefono,
        "store_name": store.commercial_name or store.business_name,
        "store_id": store.id,
    })


# ════════════════════════════════════════════════
# API PÚBLICA (sin JWT)
# ════════════════════════════════════════════════

@router.get("/api/public/carta/{telefono}/productos")
async def carta_productos(telefono: str, db: Session = Depends(get_db)):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    products = db.query(Product).filter(
        Product.store_id == store.id,
        Product.is_active == True
    ).order_by(Product.category, Product.name).all()

    # Agrupar por categoría
    categorias = {}
    for p in products:
        cat = p.category or "Otros"
        if cat not in categorias:
            categorias[cat] = []
        categorias[cat].append({
            "id": p.id,
            "name": p.name,
            "price": float(p.sale_price),
            "category": cat,
            "description": p.description if hasattr(p, 'description') else None,
            "stock": p.stock,
        })

    return {"categorias": categorias, "total": len(products)}


@router.get("/api/public/carta/{telefono}/info")
async def carta_info(telefono: str, db: Session = Depends(get_db)):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    logo = _get_store_logo(db, store.id)

    # Dirección y datos extra de store_config
    extra = {}
    try:
        row = db.execute(text(
            "SELECT direccion, distrito, provincia, departamento, giro, slogan FROM store_config WHERE store_id = :sid"
        ), {"sid": store.id}).fetchone()
        if row:
            extra = {
                "direccion": row[0] or store.address,
                "distrito": row[1],
                "provincia": row[2],
                "departamento": row[3],
                "giro": row[4],
                "slogan": row[5],
            }
    except Exception:
        pass

    return {
        "nombre": store.commercial_name or store.business_name,
        "razon_social": store.business_name,
        "direccion": extra.get("direccion") or store.address or "",
        "distrito": extra.get("distrito") or "",
        "telefono": store.phone,
        "logo": logo,
        "giro": extra.get("giro") or "",
        "slogan": extra.get("slogan") or "",
    }


# ════════════════════════════════════════════════
# REGISTRO DE VISITAS
# ════════════════════════════════════════════════

class VisitaRequest(BaseModel):
    device_fingerprint: str
    installed_pwa: bool = False

@router.post("/api/public/carta/{telefono}/visita")
async def registrar_visita(
    telefono: str,
    data: VisitaRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    _ensure_tables(db)

    existing = db.execute(text("""
        SELECT id, visit_count FROM carta_visitantes
        WHERE store_id = :sid AND device_fingerprint = :fp
    """), {"sid": store.id, "fp": data.device_fingerprint}).fetchone()

    if existing:
        db.execute(text("""
            UPDATE carta_visitantes
            SET last_visit = NOW(), visit_count = visit_count + 1,
                installed_pwa = :pwa
            WHERE id = :id
        """), {"pwa": data.installed_pwa, "id": existing.id})
    else:
        db.execute(text("""
            INSERT INTO carta_visitantes (store_id, device_fingerprint, installed_pwa)
            VALUES (:sid, :fp, :pwa)
        """), {"sid": store.id, "fp": data.device_fingerprint, "pwa": data.installed_pwa})

    db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════
# CHAT DE PEDIDOS
# ════════════════════════════════════════════════

class ChatRequest(BaseModel):
    device_fingerprint: str
    mensaje: str

@router.post("/api/public/carta/{telefono}/pedido-chat")
async def pedido_chat(
    telefono: str,
    data: ChatRequest,
    db: Session = Depends(get_db)
):
    store = _get_store_by_phone(db, telefono)
    if not store:
        raise HTTPException(404, "Negocio no encontrado")

    _ensure_tables(db)

    # Guardar mensaje del cliente
    db.execute(text("""
        INSERT INTO chat_mensajes (store_id, device_fingerprint, mensaje, remitente)
        VALUES (:sid, :fp, :msg, 'cliente')
    """), {"sid": store.id, "fp": data.device_fingerprint, "msg": data.mensaje})

    # Detectar si es número de teléfono (9 dígitos)
    clean = data.mensaje.strip().replace(" ", "")
    if clean.isdigit() and len(clean) == 9:
        # Guardar teléfono del visitante
        db.execute(text("""
            UPDATE carta_visitantes SET phone = :phone
            WHERE store_id = :sid AND device_fingerprint = :fp
        """), {"phone": clean, "sid": store.id, "fp": data.device_fingerprint})
        db.commit()

        respuesta = f"📱 Perfecto, te contactamos al {clean}. ¡Gracias!"
    else:
        respuesta = "✅ ¡Recibido! Procesamos tu pedido.\n¿A qué número te avisamos cuando esté listo?"

    # Guardar respuesta automática
    db.execute(text("""
        INSERT INTO chat_mensajes (store_id, device_fingerprint, mensaje, remitente)
        VALUES (:sid, :fp, :msg, 'bot')
    """), {"sid": store.id, "fp": data.device_fingerprint, "msg": respuesta})
    db.commit()

    return {"respuesta": respuesta}
