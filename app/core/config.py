"""
Configuración de la aplicación
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import List, Optional


class Settings(BaseSettings):
    # App
    PROJECT_NAME: str = "QueVendí"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    APP_NAME: str = "QUEVENDI"
    
    # Database
    DATABASE_URL: str
    
    # Security
    SECRET_KEY: str
    JWT_SECRET_KEY: str
    ALGORITHM: str = "HS256"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 días
    
    # External APIs
    APIS_NET_PE_TOKEN: str = ""
    OPENAI_API_KEY: Optional[str] = None  # Para Whisper STT
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:5050",
        "http://127.0.0.1:4040",
        "http://localhost:3030",
        "http://127.0.0.1:2020",
        "http://127.0.0.1:1010",
        "https://quevendi.pro",
        "https://www.quevendi.pro"
    ]
    
    # File Upload
    MAX_UPLOAD_SIZE: int = 5242880  # 5MB
    UPLOAD_FOLDER: str = "app/static/uploads"
    ALLOWED_EXTENSIONS: List[str] = ["jpg", "jpeg", "png", "gif", "webp"]
    
    # Subscription Plans (días de trial)
    FREEMIUM_TRIAL_DAYS: int = 30
    
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=True
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()