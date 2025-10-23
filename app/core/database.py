# app/core/database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# ========================================
# CONFIGURACIÓN DE BASE DE DATOS
# ========================================
database_url = settings.DATABASE_URL

# Normalizar URL para psycopg2
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

# Forzar uso de psycopg2
if "postgresql://" in database_url and "+psycopg2" not in database_url:
    database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)

print("🔌 Conectando a base de datos...")
print(f"📡 URL (sanitizada): {database_url.split('@')[0]}@***")

# ========================================
# CREAR ENGINE
# ========================================
engine = create_engine(
    database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ========================================
# DEPENDENCY PARA FASTAPI
# ========================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()