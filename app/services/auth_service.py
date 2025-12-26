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
        print(f"[AuthService] 🔍 Intentando decodificar token...")
        print(f"[AuthService] Token (primeros 30): {token[:30]}...")
        
        payload = decode_token(token)
        
        if not payload:
            print(f"[AuthService] ❌ decode_token retornó None")
            print(f"[AuthService] Verificar JWT_SECRET_KEY en Railway")
            return None
        
        print(f"[AuthService] ✅ Payload decodificado: {payload}")
        
        # 1. INTENTAR OBTENER ID
        user_id = payload.get("sub") or payload.get("user_id")
        
        if not user_id:
            print(f"[AuthService] ❌ No hay 'sub' ni 'user_id' en payload")
            return None
        
        print(f"[AuthService] User ID extraído: {user_id}")
        
        # 2. CONVERTIR A ENTERO
        try:
            user_id_int = int(user_id)
            print(f"[AuthService] User ID como int: {user_id_int}")
        except (ValueError, TypeError) as e:
            print(f"[AuthService] ❌ Error convirtiendo ID a int: {e}")
            return None
        
        # 3. BUSCAR EN BD
        user = self.db.query(User).filter(User.id == user_id_int).first()
        
        if not user:
            print(f"[AuthService] ❌ Usuario ID {user_id_int} no existe en BD")
            return None
        
        print(f"[AuthService] ✅ Usuario encontrado: {user.full_name}")
        return user