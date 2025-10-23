# app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """
    Configuración de la aplicación
    Lee variables de entorno desde .env
    """
    
    # Información de la aplicación
    APP_NAME: str = "QueVendi"
    
    # Base de datos
    DATABASE_URL: str
    
    # Seguridad JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # CORS (opcional)
    FRONTEND_URL: str = ""
    
    # Configuración de Pydantic v2
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore"  # Ignorar variables extras en .env
    )

settings = Settings()