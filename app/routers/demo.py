# ================================================================
# QUEVENDI — Demo & Catalog Endpoints
# Archivo: app/routers/demo.py
#
# ADAPTADO al código real de QueVendi:
# - Store usa: ruc, business_name, commercial_name, business_type
# - User usa: dni, pin_hash, full_name, username, store_id, role
# - Security: create_access_token(data={"user_id":..., "store_id":...})
# - Database: get_db() desde app.core.database
# ================================================================

import json
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import create_access_token, get_pin_hash, get_current_user
from app.core.database import get_db
from app.models.store import Store
from app.models.user import User
from app.models.product import Product
from app.models.billing import StoreBillingConfig

router = APIRouter()


# ================================================================
# SCHEMAS
# ================================================================

class DemoLoginRequest(BaseModel):
    niche: str


class DemoLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    store_name: str
    niche: str
    user_id: int
    store_id: int
    is_demo: bool = True


class ImportCatalogRequest(BaseModel):
    catalog: str


class ImportCatalogResponse(BaseModel):
    imported: int
    catalog: str
    message: str


class CatalogInfo(BaseModel):
    key: str
    name: str
    description: str
    icon: str
    product_count: int


# ================================================================
# CONFIG — 7 nichos de Carlos
# ================================================================

CATALOGS_PATH = Path(__file__).parent.parent / "data" / "catalogs_demo.json"

DEMO_CONFIG = {
    "abarrotes":   {"store": "Abarrotes Demo",       "dni": "00000001", "user": "demo_abarrotes"},
    "ferreteria":  {"store": "Ferretería Demo",       "dni": "00000002", "user": "demo_ferreteria"},
    "lubricentro": {"store": "Lubricentro Demo",      "dni": "00000003", "user": "demo_lubricentro"},
    "repuestera":  {"store": "Repuestera Demo",       "dni": "00000004", "user": "demo_repuestera"},
    "ropas":       {"store": "Tienda de Ropas Demo",  "dni": "00000005", "user": "demo_ropas"},
    "zapateria":   {"store": "Zapatería Demo",        "dni": "00000006", "user": "demo_zapateria"},
    "grifo":       {"store": "Grifo Demo",            "dni": "00000007", "user": "demo_grifo"},
}

VALID_NICHES = set(DEMO_CONFIG.keys())
DEMO_PIN = "1234"
# DNI del owner de Peru Sistemas — su tienda tiene la config de Facturalo.pro
OWNER_DNI = "63100784"


# ================================================================
# HELPERS
# ================================================================

def copy_billing_config_to_demo(db: Session, demo_store_id: int):
    """
    Copia la StoreBillingConfig de Peru Sistemas al demo store.
    Todas las demos emiten comprobantes con el certificado de Peru Sistemas
    (servidor beta SUNAT).
    """
    # Buscar al owner por DNI
    owner = db.query(User).filter(User.dni == OWNER_DNI).first()
    if not owner:
        return  # Si no existe el owner, demo funciona sin billing

    # Obtener su config de billing
    source_config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == owner.store_id
    ).first()
    if not source_config:
        return

    # Verificar si el demo store ya tiene config
    existing = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == demo_store_id
    ).first()
    if existing:
        return  # Ya tiene config, no duplicar

    # Copiar config al demo store (misma conexión Facturalo, series propias para demo)
    demo_config = StoreBillingConfig(
        store_id=demo_store_id,
        ruc=source_config.ruc,
        razon_social=source_config.razon_social,
        nombre_comercial=source_config.nombre_comercial,
        direccion=source_config.direccion,
        facturalo_url=source_config.facturalo_url,
        facturalo_token=source_config.facturalo_token,
        facturalo_secret=source_config.facturalo_secret,
        serie_boleta=source_config.serie_boleta,
        serie_factura=source_config.serie_factura,
        tipo_afectacion_igv=source_config.tipo_afectacion_igv,
        is_active=True,
        is_verified=source_config.is_verified,
    )
    db.add(demo_config)
    db.flush()

def load_catalogs() -> dict:
    if not CATALOGS_PATH.exists():
        raise HTTPException(500, f"Catálogos no encontrado en {CATALOGS_PATH}")
    with open(CATALOGS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("catalogs", {})


def get_or_create_demo_store(db: Session, niche: str) -> tuple:
    """Busca o crea tienda demo + usuario demo. Retorna (store, user)"""
    cfg = DEMO_CONFIG[niche]

    # Buscar usuario demo existente por DNI
    user = db.query(User).filter(User.dni == cfg["dni"]).first()

    if user:
        store = db.query(Store).filter(Store.id == user.store_id).first()
        if store:
            # Asegurar que tenga config de billing (por si se creó antes del fix)
            copy_billing_config_to_demo(db, store.id)
            db.commit()
            return store, user

    # Crear tienda demo — solo campos del modelo Store de SQLAlchemy
    store = Store(
        ruc=f"1000000000{cfg['dni'][-1]}",
        business_name=cfg["store"],
        commercial_name=cfg["store"],
        address="Demo - Iquitos, Loreto",
        business_type=niche,
        plan="demo",
        is_active=True,
    )
    db.add(store)
    db.flush()

    # Crear usuario demo — solo campos del modelo User de SQLAlchemy
    user = User(
        store_id=store.id,
        dni=cfg["dni"],
        pin_hash=get_pin_hash(DEMO_PIN),
        full_name=f"Vendedor Demo ({niche.title()})",
        username=cfg["user"],
        role="seller",
        is_active=True,
    )
    db.add(user)
    db.flush()

    # Setear campos is_demo/niche via SQL directo (existen en BD, no en modelo)
    from sqlalchemy import text
    db.execute(text("UPDATE stores SET is_demo = TRUE, niche = :n WHERE id = :id"),
               {"n": niche, "id": store.id})
    db.execute(text("UPDATE users SET is_demo = TRUE WHERE id = :id"),
               {"id": user.id})

    # Copiar config de facturación de Peru Sistemas → demo emite a SUNAT beta
    copy_billing_config_to_demo(db, store.id)

    db.commit()
    db.refresh(store)
    db.refresh(user)

    return store, user


def import_products_from_catalog(db: Session, store_id: int, niche: str) -> int:
    """Importa productos del JSON. Limpia ventas demo y productos previos."""
    catalogs = load_catalogs()

    if niche not in catalogs:
        raise HTTPException(400, f"Catálogo '{niche}' no encontrado")

    products_data = catalogs[niche].get("products", [])

    # Limpiar en orden correcto por foreign keys:
    # comprobantes → sale_items → sales → products
    from sqlalchemy import text
    db.execute(text("""
        DELETE FROM comprobantes WHERE sale_id IN (
            SELECT id FROM sales WHERE store_id = :sid
        )
    """), {"sid": store_id})
    db.execute(text("""
        DELETE FROM sale_items WHERE sale_id IN (
            SELECT id FROM sales WHERE store_id = :sid
        )
    """), {"sid": store_id})
    db.execute(text("DELETE FROM sales WHERE store_id = :sid"), {"sid": store_id})
    db.query(Product).filter(Product.store_id == store_id).delete()

    count = 0
    for p in products_data:
        product = Product(
            store_id=store_id,
            name=p["name"],
            category=p.get("category", "General"),
            unit=p.get("unit", "unidad"),
            sale_price=p["sale_price"],
            cost_price=p.get("cost_price", 0),
            stock=p.get("stock", 0),
            aliases=p.get("aliases", []),
            is_active=True,
        )
        db.add(product)
        count += 1

    db.commit()
    return count


# ================================================================
# ENDPOINTS
# ================================================================

@router.post("/auth/demo-login", response_model=DemoLoginResponse)
async def demo_login(req: DemoLoginRequest, db: Session = Depends(get_db)):
    """
    Login demo: crea tienda+usuario si no existen, importa catálogo, retorna JWT.
    """
    if req.niche not in VALID_NICHES:
        raise HTTPException(400, f"Nicho inválido. Opciones: {', '.join(sorted(VALID_NICHES))}")

    store, user = get_or_create_demo_store(db, req.niche)

    # Importar catálogo automáticamente
    import_products_from_catalog(db, store.id, req.niche)

    # JWT compatible con tu get_current_user (busca user_id o sub, store_id, role)
    token_data = {
        "user_id": user.id,
        "sub": str(user.id),
        "store_id": store.id,
        "username": user.username,
        "role": user.role,
        "is_demo": True,
    }

    access_token = create_access_token(
        data=token_data,
        expires_delta=timedelta(hours=24)
    )

    return DemoLoginResponse(
        access_token=access_token,
        store_name=store.commercial_name,
        niche=req.niche,
        user_id=user.id,
        store_id=store.id,
    )


@router.post("/products/import-catalog", response_model=ImportCatalogResponse)
async def import_catalog(
    req: ImportCatalogRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Importa catálogo demo a la tienda del usuario autenticado.
    """
    if req.catalog not in VALID_NICHES:
        raise HTTPException(400, f"Catálogo inválido. Opciones: {', '.join(sorted(VALID_NICHES))}")

    store_id = current_user.get("store_id")
    if not store_id:
        raise HTTPException(400, "No se encontró store_id en el token")

    count = import_products_from_catalog(db, store_id, req.catalog)

    return ImportCatalogResponse(
        imported=count,
        catalog=req.catalog,
        message=f"{count} productos importados correctamente"
    )


@router.get("/catalogs/available", response_model=list[CatalogInfo])
async def list_available_catalogs():
    """Lista catálogos demo disponibles. Sin auth."""
    catalogs = load_catalogs()

    return [
        CatalogInfo(
            key=key,
            name=cat["name"],
            description=cat["description"],
            icon=cat["icon"],
            product_count=cat["product_count"],
        )
        for key, cat in catalogs.items()
    ]


# ================================================================
# ENDPOINT PARA IMPORTAR DESDE ARCHIVO (Excel/CSV)
# Para clientes reales, no demo
# ================================================================

# from fastapi import UploadFile, File
# import pandas as pd
#
# @router.post("/products/import-file")
# async def import_from_file(
#     file: UploadFile = File(...),
#     db: Session = Depends(get_db),
#     current_user: User = Depends(get_current_user)
# ):
#     """
#     Importa productos desde archivo Excel (.xlsx) o CSV.
#     Columnas esperadas: nombre, categoria, unidad, precio_venta, 
#                         precio_costo, stock
#     """
#     if file.filename.endswith('.csv'):
#         df = pd.read_csv(file.file)
#     elif file.filename.endswith(('.xlsx', '.xls')):
#         df = pd.read_excel(file.file)
#     else:
#         raise HTTPException(400, "Formato no soportado. Usa .csv o .xlsx")
#     
#     # Mapear columnas
#     column_map = {
#         'nombre': 'name', 'producto': 'name', 'descripcion': 'name',
#         'categoria': 'category', 'rubro': 'category',
#         'unidad': 'unit', 'medida': 'unit',
#         'precio': 'sale_price', 'precio_venta': 'sale_price', 'pv': 'sale_price',
#         'costo': 'cost_price', 'precio_costo': 'cost_price', 'pc': 'cost_price',
#         'stock': 'stock', 'cantidad': 'stock'
#     }
#     
#     df.columns = [column_map.get(c.lower().strip(), c) for c in df.columns]
#     
#     count = 0
#     for _, row in df.iterrows():
#         if not row.get('name'):
#             continue
#         product = Product(
#             store_id=current_user.store_id,
#             name=str(row['name']).strip(),
#             category=str(row.get('category', 'General')).strip(),
#             unit=str(row.get('unit', 'unidad')).strip(),
#             sale_price=float(row.get('sale_price', 0)),
#             cost_price=float(row.get('cost_price', 0)),
#             stock=float(row.get('stock', 0)),
#             is_active=True,
#             created_at=datetime.utcnow()
#         )
#         db.add(product)
#         count += 1
#     
#     db.commit()
#     return {"imported": count, "message": f"{count} productos importados"}


# ================================================================
# NOTAS DE INTEGRACIÓN
# ================================================================
#
# 1. Copiar catalogs_demo.json a: app/data/catalogs_demo.json
#
# 2. Agregar campos al modelo Store (si no existen):
#    - is_demo: Boolean, default=False
#    - niche: String, nullable=True
#
# 3. Agregar campos al modelo User (si no existen):
#    - is_demo: Boolean, default=False
#
# 4. En main.py, servir las páginas:
#    @app.get("/")
#    async def landing():
#        return FileResponse("templates/landing.html")
#    
#    @app.get("/demo")
#    async def demo_page():
#        return FileResponse("templates/demo.html")
#
# 5. Registrar router:
#    from app.routers import demo
#    app.include_router(demo.router, prefix="/api/v1", tags=["demo"])