from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.auth_service import AuthService
from app.models.user import User

async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    # Obtener token de cookie
    token = request.cookies.get("access_token")
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado"
        )
    
    # Remover "Bearer " si existe
    token = token.replace("Bearer ", "")
    
    auth_service = AuthService(db)
    user = auth_service.get_current_user(token)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )
    
    return user