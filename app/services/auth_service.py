from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import verify_pin, get_pin_hash, create_access_token
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
        access_token = create_access_token(
            data={"sub": str(user.id), "store_id": user.store_id},
            expires_delta=access_token_expires
        )
        return access_token
    
    def get_current_user(self, token: str) -> User | None:
        from app.core.security import decode_token
        
        payload = decode_token(token)
        if not payload:
            return None
        
        user_id = payload.get("sub")
        if not user_id:
            return None
        
        user = self.db.query(User).filter(User.id == int(user_id)).first()
        return user