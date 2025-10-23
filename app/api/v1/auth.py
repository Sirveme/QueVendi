"""
Endpoints de autenticación para QueVendí
"""

from fastapi import APIRouter, Depends, HTTPException, status, Response, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.user import Token, UserResponse
from app.services.auth_service import AuthService

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """
    Mostrar página de login
    """
    return templates.TemplateResponse("login.html", {"request": request})


@router.post("/login")  # ✅ CORREGIDO - Sin /auth/
async def login(
    response: Response,
    dni: str = Form(...),
    pin: str = Form(...),
    db: Session = Depends(get_db)
):
    """
    Procesar login y crear sesión
    
    Args:
        dni: DNI del usuario (8 dígitos)
        pin: PIN del usuario (4 dígitos)
        db: Sesión de base de datos
    
    Returns:
        JSON con token y datos del usuario
    """
    # Validar formato
    if len(dni) != 8 or not dni.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DNI debe tener 8 dígitos"
        )
    
    if len(pin) != 4 or not pin.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PIN debe tener 4 dígitos"
        )
    
    # Autenticar usuario
    auth_service = AuthService(db)
    user = auth_service.authenticate_user(dni, pin)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DNI o PIN incorrectos"
        )
    
    # Crear token
    access_token = auth_service.create_access_token_for_user(user)
    
    # Devolver JSON (el frontend maneja la cookie)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.full_name,
            "store_id": user.store_id,
            "dni": user.dni
        }
    }


@router.post("/logout")  # ✅ CORREGIDO - Sin /auth/
async def logout():
    """
    Cerrar sesión (el frontend elimina la cookie)
    """
    return {"message": "Logout exitoso"}


@router.get("/logout")
async def logout_get(response: Response):
    """
    Cerrar sesión vía GET (para enlaces)
    """
    response = RedirectResponse(url="/auth/login", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie("access_token")
    return response