# app/main.py
from fastapi import FastAPI, Request, APIRouter, Depends, Cookie, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api.v1 import auth, sales, products, voice, reports, stores, users, catalogs, voice_llm
from typing import Optional

try:
    from app.api.v1 import catalogs
    print("✅ catalog.py importado correctamente")
except Exception as e:
    print(f"❌ ERROR al importar catalog.py: {e}")
    import traceback
    traceback.print_exc()
import os

from sqlalchemy import func

from app.core.database import SessionLocal
from app.models.user import User
from app.models.product import Product
from app.api.dependencies import get_current_user


# ========================================
# CONFIGURAR TEMPLATES CON RUTA ABSOLUTA
# ========================================
BASE_DIR = Path(__file__).resolve().parent.parent  # C:\QUEVENDI
TEMPLATES_DIR = BASE_DIR / "app" / "templates"  # ⬅️ Agregamos /app/
STATIC_DIR = BASE_DIR / "static"

print(f"📂 BASE_DIR: {BASE_DIR}")
print(f"📂 TEMPLATES_DIR: {TEMPLATES_DIR}")
print(f"📂 STATIC_DIR: {STATIC_DIR}")

# Verificar que templates existe
if not TEMPLATES_DIR.exists():
    print(f"⚠️ ERROR: No se encuentra el directorio templates en {TEMPLATES_DIR}")
    print(f"   Asegúrate de que la estructura sea:")
    print(f"   {BASE_DIR}/")
    print(f"   ├── app/")
    print(f"   ├── templates/")
    print(f"   └── static/")
else:
    print(f"✅ Templates encontrado")
    # Listar archivos en templates
    template_files = list(TEMPLATES_DIR.glob("*.html"))
    print(f"   Archivos: {[f.name for f in template_files]}")

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

router = APIRouter()

# ========================================
# LIFESPAN EVENT
# ========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ========== STARTUP ==========
    print("\n" + "="*60)
    print("🚀 SERVIDOR INICIADO")
    print("="*60)
    
    # Listar todas las rutas registradas
    print("\n📍 RUTAS REGISTRADAS:")
    print("-"*60)
    
    routes_by_type = {"HTML": [], "API": [], "STATIC": [], "OTHER": []}
    
    for route in app.routes:
        if hasattr(route, 'methods') and hasattr(route, 'path'):
            methods = ', '.join(sorted(route.methods))
            path = route.path
            
            # Clasificar rutas
            if path.startswith('/api/'):
                routes_by_type["API"].append(f"  {methods:12} {path}")
            elif path.startswith('/static'):
                routes_by_type["STATIC"].append(f"  {methods:12} {path}")
            elif any(x in path for x in ['/auth/', '/home', '/products', '/']):
                routes_by_type["HTML"].append(f"  {methods:12} {path}")
            else:
                routes_by_type["OTHER"].append(f"  {methods:12} {path}")
    
    # Mostrar rutas organizadas
    if routes_by_type["HTML"]:
        print("\n📄 RUTAS HTML (Templates):")
        for route in sorted(routes_by_type["HTML"]):
            print(route)
    
    if routes_by_type["API"]:
        print("\n🔌 RUTAS API:")
        for route in sorted(routes_by_type["API"]):
            print(route)
    
    if routes_by_type["STATIC"]:
        print("\n📁 RUTAS ESTÁTICAS:")
        for route in routes_by_type["STATIC"]:
            print(route)
    
    if routes_by_type["OTHER"]:
        print("\n🔧 OTRAS RUTAS:")
        for route in sorted(routes_by_type["OTHER"]):
            print(route)
    
    print("\n" + "="*60)
    print(f"✅ Servidor listo en: http://0.0.0.0:{os.getenv('PORT', '8080')}")
    print("="*60 + "\n")
    
    yield
    
    # ========== SHUTDOWN ==========
    print("\n👋 Servidor detenido")

# ========================================
# CREAR APP
# ========================================
app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    lifespan=lifespan
)

# ========================================
# CORS
# ========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========================================
# ARCHIVOS ESTÁTICOS - MONTAR PRIMERO
# ========================================
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    print(f"📁 Archivos estáticos montados: {STATIC_DIR}")
else:
    print(f"⚠️ Directorio static/ no encontrado en: {STATIC_DIR}")

# ========================================
# ROUTERS API - CON PREFIX /api
# ========================================
#app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(auth.router, prefix="/api/v1")
app.include_router(products.router, prefix="/api/v1")
app.include_router(sales.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(stores.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(catalogs.router, prefix="/api/v1")
app.include_router(catalogs.router)
app.include_router(voice_llm.router, prefix="/api/v1")

# ========================================
# RUTAS DE REPORTES
# ========================================
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Página de reportes"""
    return templates.TemplateResponse("index.html", {"request": request})


# ========================================
# RUTAS DE REPORTES
# ========================================
@app.get("/reports", response_class=HTMLResponse)
async def reports_page(request: Request):
    """Página de reportes"""
    return templates.TemplateResponse("reports.html", {"request": request})

@app.get("/products/manage", response_class=HTMLResponse)
async def products_manage_page(request: Request):
    """Página de gestión de productos"""
    return templates.TemplateResponse("products.html", {"request": request})

# ========================================
# RUTAS DE TEMPLATES (HTML)
# ========================================
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """Redirigir a login"""
    return RedirectResponse(url="/auth/login")

@app.get("/auth/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Página de login"""
    return templates.TemplateResponse("login.html", {"request": request})

@app.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    """Página de configuración (solo owners)"""
    return templates.TemplateResponse("settings.html", {"request": request})


@app.get("/offline", response_class=HTMLResponse)
async def offline_page(request: Request):
    """Página offline"""
    return templates.TemplateResponse("offline.html", {"request": request})


@app.get("/home", response_class=HTMLResponse)
async def home_page(request: Request):
    """
    Página principal - la autenticación se maneja en el frontend
    """
    return templates.TemplateResponse("home.html", {"request": request})


# Busca la ruta actual del home y AGREGA esta nueva ruta DESPUÉS

@app.get("/v2", response_class=HTMLResponse)
async def home_v2(
    request: Request,
    token: Optional[str] = Cookie(None)
):
    """
    Nueva versión del POS - Auth manejada por frontend
    """
    
    # Si hay token en cookie, es que ya está autenticado
    # Si no hay token, el JavaScript lo manejará
    
    return templates.TemplateResponse("home_v2.html", {
        "request": request,
        "current_user": {"name": "Usuario"},  # Placeholder
        "version": "2.0"
    })


@app.get("/products", response_class=HTMLResponse)
async def products_page(request: Request):
    """Página de productos"""
    return templates.TemplateResponse("products.html", {"request": request})


@app.get("/register-store", response_class=HTMLResponse)  # ✅ AGREGAR ESTA
async def register_store_page(request: Request):
    """Página de registro de tiendas"""
    return templates.TemplateResponse("register-store.html", {"request": request})

@app.get("/users/add", response_class=HTMLResponse)
async def add_user_page(request: Request):
    """Página para agregar usuarios"""
    return templates.TemplateResponse("add-user.html", {"request": request})



# app/api/v1/home.py (o donde tengas el home)

@app.get("/home", response_class=HTMLResponse)
async def home(
    request: Request, 
    current_user: User = Depends(get_current_user)  # ⬅️ Usar get_current_user
):
    db = SessionLocal()
    try:
        # Verificar si tiene productos
        product_count = db.query(func.count(Product.id)).filter(
            Product.store_id == current_user.store_id
        ).scalar()
        
        # Si no tiene productos, mostrar wizard
        if product_count == 0:
            return templates.TemplateResponse("onboarding_wizard.html", {
                "request": request,
                "user": current_user
            })
        
        # Si ya tiene productos, mostrar home normal
        return templates.TemplateResponse("home.html", {
            "request": request,
            "user": current_user
        })
        
    finally:
        db.close()

# ========================================
# HEALTH CHECK
# ========================================
@app.get("/health")
async def health():
    """Health check para Railway"""
    return {"status": "healthy"}


# ======================
# RUTAS DE LANDING PAGES
# ======================
@app.get("/lanza/fundadores", response_class=HTMLResponse)
async def fundadores(request: Request):
    """Página de reportes"""

    return templates.TemplateResponse("/lanza/fundadores/fundadores.html", {"request": request})
