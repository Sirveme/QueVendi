from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

# Contexto para hashing de PINs
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hashear password con bcrypt"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verificar password"""
    return pwd_context.verify(plain_password, hashed_password)


def verify_pin(plain_pin: str, hashed_pin: str) -> bool:
    """Verificar PIN hasheado"""
    return pwd_context.verify(plain_pin, hashed_pin)

def get_pin_hash(pin: str) -> str:
    """Obtener hash de PIN"""
    return pwd_context.hash(pin)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    
    #print(f"[JWT] Generando token con datos: {data}")
    #print(f"[JWT] SECRET_KEY longitud: {len(settings.JWT_SECRET_KEY)}")
    
    encoded_jwt = jwt.encode(
        to_encode, 
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )
    
    #print(f"[JWT] Token generado longitud: {len(encoded_jwt)}")
    #print(f"[JWT] Token generado (primeros 50): {encoded_jwt[:50]}")
    #print(f"[JWT] Puntos en token: {encoded_jwt.count('.')}")
    
    return encoded_jwt

def decode_token(token: str) -> Optional[dict]:
    """
    Decodificar y validar token JWT
    
    Args:
        token: Token JWT a decodificar
    
    Returns:
        Payload del token si es válido, None si no es válido
    """
    try:
        # ⬇️ DEBUG: Ver token completo
        #print(f"[JWT DEBUG] Token recibido (primeros 50 chars): {token[:50]}")
        #print(f"[JWT DEBUG] Token largo: {len(token)} caracteres")
        #print(f"[JWT DEBUG] Partes del token: {token.count('.')}")

        payload = jwt.decode(
            token, 
            settings.JWT_SECRET_KEY,  # ⬅️ CORREGIDO: usar JWT_SECRET_KEY (igual que en create)
            algorithms=[settings.JWT_ALGORITHM]
        )
        #print(f"[JWT] ✅ Decodificación exitosa: {payload}")
        return payload
    except JWTError as e:
        #print(f"[JWT] Error al decodificar token: {e}")
        #print(f"[JWT] Token problemático: {token[:100]}...")  # ⬅️ Ver token

        #print(f"[JWT] Error al decodificar token: {e}")
        return None