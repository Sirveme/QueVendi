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
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_timeout=30,
    connect_args={
        "connect_timeout": 10,
        # ── Defensas contra el bloqueo en cascada ──
        #
        # Tres veces (13/09 y 27/09/2026) se cayó producción entera por la
        # misma secuencia: una sesión deja una transacción abierta sobre
        # store_config, un ALTER TABLE del arranque de un módulo se encola
        # esperando su lock, y en PostgreSQL un ALTER en espera hace que
        # TODOS los lectores posteriores se encolen detrás de él. Como los
        # endpoints son async con llamadas bloqueantes, se congela el event
        # loop y deja de responder hasta /health.
        #
        # Perseguir cada helper que olvide cerrar su transacción no escala:
        # basta uno nuevo para repetirlo. Esto hace que la base se defienda
        # sola, pase lo que pase en el código.
        #
        #   lock_timeout                       un DDL que no consigue su lock
        #                                      falla en 3s en vez de encolarse
        #                                      y arrastrar a todos
        #   idle_in_transaction_session_timeout PostgreSQL mata la transacción
        #                                      olvidada a los 60s
        #   statement_timeout                  ninguna consulta suelta puede
        #                                      colgar un worker indefinidamente
        "options": (
            "-c lock_timeout=3000"
            " -c idle_in_transaction_session_timeout=60000"
            " -c statement_timeout=30000"
        ),
    },
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