"""
Dependencies para la API de QueVendí
Contiene funciones reutilizables para endpoints
"""

from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.auth_service import AuthService
from app.models.user import User


async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    """
    Obtener el usuario actual desde el token
    Soporta tanto cookies como header Authorization
    """
    token = None
    
    # 1. Intentar obtener del header Authorization (para HTMX/fetch)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "")
        print(f"[Auth] Token desde header: {token[:20]}...")
    
    # 2. Si no está en header, intentar cookie (fallback)
    if not token:
        token = request.cookies.get("access_token")
        if token:
            print(f"[Auth] Token desde cookie: {token[:20]}...")
            # Remover "Bearer " si existe
            if token.startswith("Bearer "):
                token = token.replace("Bearer ", "")
    
    # 3. Si no hay token en ningún lado
    if not token:
        print("[Auth] ❌ No se encontró token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado. Por favor inicia sesión.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 4. Verificar token
    try:
        auth_service = AuthService(db)
        user = auth_service.get_current_user(token)
        
        if not user:
            print(f"[Auth] ❌ Usuario no encontrado en DB para este token")
            raise HTTPException(status_code=401, detail="Token válido pero usuario no existe")
            
    except Exception as e:
        # ESTO ES LO IMPORTANTE: Imprime el error real en la consola de Railway
        print(f"[Auth] 💥 Excepción al decodificar token: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Error de autenticación: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    print(f"[Auth] ✅ Usuario autenticado: {user.full_name}")
    return user


def get_current_active_owner(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Verificar que el usuario actual es dueño (owner)
    
    Args:
        current_user: Usuario actual
    
    Returns:
        Usuario si es owner
    
    Raises:
        HTTPException: Si el usuario no es owner
    """
    if current_user.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado. Solo el dueño puede realizar esta acción."
        )
    return current_user


def check_permission(permission: str):
    """
    Decorator para verificar permisos específicos
    
    Args:
        permission: Nombre del permiso a verificar
    
    Returns:
        Función de dependencia
    """
    def permission_checker(current_user: User = Depends(get_current_user)) -> User:
        # Owners tienen todos los permisos
        if current_user.role == "owner":
            return current_user
        
        # Verificar permiso específico
        if permission == "register_purchases":
            if not current_user.can_register_purchases:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No tienes permiso para registrar compras."
                )
        
        elif permission == "view_analytics":
            if not current_user.can_view_analytics:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No tienes permiso para ver reportes y analíticas."
                )
        
        return current_user
    
    return permission_checker
