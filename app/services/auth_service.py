from typing import Optional
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import verify_pin, create_access_token, decode_token
from datetime import timedelta
from app.core.config import settings

class AuthService:
    def __init__(self, db: Session):
        self.db = db
    
    def authenticate_user(self, dni: str, pin: str) -> User | None:
        user = self.db.query(User).filter(
            User.dni == dni,
            User.is_active == True
        ).first()
        
        if not user:
            return None
        
        if not verify_pin(pin, user.pin_hash):
            return None
        
        return user
    
    def create_access_token_for_user(self, user: User) -> str:
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        # Usamos 'sub' que es el estándar para el ID del usuario
        access_token = create_access_token(
            data={"sub": str(user.id), "store_id": user.store_id},
            expires_delta=access_token_expires
        )
        return access_token
    
    def get_current_user(self, token: str) -> Optional[User]:
        """Obtener usuario actual desde token"""
        payload = decode_token(token)
        
        if not payload:
            return None
        
        # 1. INTENTAR OBTENER ID (Soporta 'sub' estándar y 'user_id' antiguo)
        user_id = payload.get("sub") or payload.get("user_id")
        
        if not user_id:
            return None
        
        # 2. CONVERTIR A ENTERO (Crucial para PostgreSQL/SQLAlchemy)
        try:
            user_id_int = int(user_id)
        except (ValueError, TypeError):
            # Si el ID no es un número válido, rechazamos
            return None
        
        # 3. BUSCAR EN BD
        user = self.db.query(User).filter(User.id == user_id_int).first()
        
        return user