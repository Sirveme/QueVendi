# app/main.py
"""
QueVendi - Sistema POS para Bodegas
Main Application Entry Point
"""

import os
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request, Depends, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.user import User
from app.models.product import Product
from app.api.dependencies import get_current_user

from app.api.offline import router as offline_router
from app.api.offline import verification_router

from app.routers import demo
from app.routers.billing_offline import router as billing_offline_router

from app.routers.store_config import router as store_config_router
from app.routers.user_management import router as user_mgmt_router

from dotenv import load_dotenv
load_dotenv()


# ========================================
# IMPORTAR ROUTERS API
# ========================================
from app.api.v1 import (
    auth,
    sales,
    products,
    voice,
    reports,
    stores,
    users,
    catalogs,
    voice_llm,
    incidentes,
    ubigeo,
    fiados,
    comunicaciones,
    customers,
    conversions,
    billing,
    onboarding
)

# ========================================
# CONFIGURACIÓN DE DIRECTORIOS
# ========================================
BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "app" / "templates"
STATIC_DIR = BASE_DIR / "static"

# Verificar directorios
print(f"📂 BASE_DIR: {BASE_DIR}")
print(f"📂 TEMPLATES_DIR: {TEMPLATES_DIR}")
print(f"📂 STATIC_DIR: {STATIC_DIR}")

if TEMPLATES_DIR.exists():
    print(f"✅ Templates encontrado")
else:
    print(f"⚠️ ERROR: Templates no encontrado en {TEMPLATES_DIR}")

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


# ========================================
# LIFESPAN EVENT
# ========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup y shutdown events"""
    
    # ===== STARTUP =====
    print("\n" + "="*60)
    print("🚀 QUEVENDI - SERVIDOR INICIADO")
    print("="*60)
    
    # Listar rutas registradas
    routes_html = []
    routes_api = []
    
    for route in app.routes:
        if hasattr(route, 'methods') and hasattr(route, 'path'):
            methods = ', '.join(sorted(route.methods - {'HEAD', 'OPTIONS'}))
            if not methods:
                continue
            path = route.path
            
            if path.startswith('/api/'):
                routes_api.append(f"  {methods:12} {path}")
            elif not path.startswith('/static') and not path.startswith('/openapi') and not path.startswith('/docs') and not path.startswith('/redoc'):
                routes_html.append(f"  {methods:12} {path}")
    
    print("\n📄 RUTAS HTML:")
    for route in sorted(set(routes_html)):
        print(route)
    
    print("\n🔌 RUTAS API:")
    for route in sorted(set(routes_api)):
        print(route)
    
    print("\n" + "="*60)
    print(f"✅ Servidor listo en: http://0.0.0.0:{os.getenv('PORT', '8080')}")
    print("="*60 + "\n")
    
    yield
    
    # ===== SHUTDOWN =====
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
# MIDDLEWARE - CORS
# ========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========================================
# ARCHIVOS ESTÁTICOS
# ========================================
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    print(f"📁 Archivos estáticos montados: {STATIC_DIR}")
else:
    print(f"⚠️ Directorio static/ no encontrado")


# ========================================
# ROUTERS API (prefix /api/v1)
# ========================================
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
app.include_router(incidentes.router, prefix="/api/v1", tags=["incidentes"])
app.include_router(ubigeo.router, prefix="/api/v1", tags=["ubigeo"])
app.include_router(products.router, prefix="/api/v1", tags=["products"])
app.include_router(sales.router, prefix="/api/v1", tags=["sales"])
app.include_router(voice.router, prefix="/api/v1", tags=["voice"])
app.include_router(reports.router, prefix="/api/v1", tags=["reports"])
app.include_router(stores.router, prefix="/api/v1", tags=["stores"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(catalogs.router, prefix="/api/v1", tags=["catalogs"])
app.include_router(voice_llm.router, prefix="/api/v1", tags=["voice LLM"])
app.include_router(fiados.router, prefix="/api/v1", tags=["fiados"])
app.include_router(comunicaciones.router, prefix="/api/v1", tags=["comunicaciones"])
app.include_router(customers.router, prefix="/api/v1", tags=["customers"])
app.include_router(conversions.router, prefix="/api/v1", tags=["conversions"])
app.include_router(billing.router, prefix="/api/v1", tags=["billing"])
app.include_router(onboarding.router, prefix="/api/v1", tags=["onboarding"])
app.include_router(offline_router)          # /api/v1/health + /api/v1/products/catalog
app.include_router(verification_router)     # /v/{code}
app.include_router(demo.router, prefix="/api/v1", tags=["demo"])
app.include_router(billing_offline_router, prefix="/api/v1/billing/offline")
app.include_router(store_config_router, prefix="/api/v1/store")
app.include_router(user_mgmt_router, prefix="/api/v1/users")


# ── Health check para PWA offline ──
@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "online": True}


# ========================================
# RUTAS HTML - PÚBLICAS (sin auth)
# ========================================

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Página de inicio / landing"""
    #return templates.TemplateResponse("index.html", {"request": request})
    return templates.TemplateResponse("landing.html", {"request": request})


@app.get("/demo", response_class=HTMLResponse)
async def demo_page(request: Request):
    return templates.TemplateResponse("demo.html", {"request": request})


@app.get("/auth/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Página de login"""
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/register-store", response_class=HTMLResponse)
async def register_store_page(request: Request):
    """Página de registro de tiendas"""
    return templates.TemplateResponse("register-store.html", {"request": request})


@app.get("/offline", response_class=HTMLResponse)
async def offline_page(request: Request):
    """Página offline para PWA"""
    return templates.TemplateResponse("offline.html", {"request": request})


@app.get("/health")
async def health():
    """Health check para Railway"""
    return {"status": "healthy", "app": "quevendi"}



# ========================================
# RUTAS HTML - PRIVADAS (requieren auth en frontend)
# ========================================

@app.get("/home", response_class=HTMLResponse)
async def home_page(request: Request):
    """
    Dashboard principal - Auth manejada por JavaScript
    """
    #return templates.TemplateResponse("home_v2.html", {"request": request})
    return templates.TemplateResponse("dashboard_principal.html", {"request": request})


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard_principal.html", {"request": request})


@app.get("/whitelabel", response_class=HTMLResponse)
async def whitelabel(request: Request):
    return templates.TemplateResponse("white_label.html", {"request": request})


@app.get("/mapa", response_class=HTMLResponse)
async def mapa_delitos_page(request: Request):
    """Mapa de seguridad ciudadana"""
    return templates.TemplateResponse("mapa_delitos.html", {"request": request})


@app.get("/v2", response_class=HTMLResponse)
async def home_v2_page(request: Request):
    """
    POS v2 - Nueva interfaz
    Auth manejada por JavaScript en el frontend
    """
    return templates.TemplateResponse("home_v2.html", {
        "request": request,
        "version": "2.0"
    })


@app.get("/products", response_class=HTMLResponse)
async def products_page(request: Request):
    """Página de productos"""
    return templates.TemplateResponse("products.html", {"request": request})


@app.get("/products/manage", response_class=HTMLResponse)
async def products_manage_page(request: Request):
    """Gestión de productos"""
    return templates.TemplateResponse("products.html", {"request": request})


@app.get("/reports", response_class=HTMLResponse)
async def reports_page(request: Request):
    """Página de reportes"""
    return templates.TemplateResponse("reports.html", {"request": request})


@app.get("/users/add", response_class=HTMLResponse)
async def add_user_page(request: Request):
    """Agregar usuarios"""
    return templates.TemplateResponse("add-user.html", {"request": request})


# ========================================
# RUTAS DE LANDING PAGES / CAMPAÑAS
# ========================================

@app.get("/lanza/fundadores", response_class=HTMLResponse)
async def landing_fundadores(request: Request):
    """Landing page - Campaña Fundadores"""
    return templates.TemplateResponse("lanza/fundadores/fundadores.html", {"request": request})


# ========================================
# GUÍA - ESTRATÉGICA / MAESTRA
# ========================================

@app.get("/lanza/guia", response_class=HTMLResponse)
async def guia_maestra(request: Request):
    """Landing - Guía estratégica para bodegas"""
    return templates.TemplateResponse("lanza/guia_maestra.html", {"request": request})



# ========================================
# RUTA ONBOARDING (con verificación de productos)
# ========================================

@app.get("/onboarding", response_class=HTMLResponse)
async def onboarding_page(request: Request):
    """
    Wizard de onboarding para nuevas tiendas
    """
    return templates.TemplateResponse("onboarding_wizard.html", {"request": request})


@app.get("/cobrar-fiados", response_class=HTMLResponse)
async def cobrar_fiados_page(request: Request):
    """
    Página para cobrar fiados pendientes
    """
    return templates.TemplateResponse("cobrar_fiados.html", {"request": request})



# ========================================
# RUTAS DE CONFIGURACIÓN - SOLO PROPIETARIOS
# ========================================
# En main.py agregar ruta:
@app.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    return templates.TemplateResponse("settings/settings.html", {"request": request})


@app.get("/productos", response_class=HTMLResponse)
async def productos_page(request: Request):
    return templates.TemplateResponse("products/products.html", {"request": request})


# ========================================
# RUTAS DE CONFIGURACIÓN - SOLO VENDEDORES
# ========================================
@app.get("/config/negocio", response_class=HTMLResponse)
async def config_negocio_page(request: Request):
    return templates.TemplateResponse("config_negocio.html", {"request": request})

