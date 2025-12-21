# app/models/ubigeo.py
"""
Modelo para UBIGEO (Departamentos, Provincias, Distritos del Perú)
"""

from sqlalchemy import Column, Integer, String, Float, Boolean

from app.core.database import Base


class Ubigeo(Base):
    __tablename__ = "ubigeo"
    
    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String(6), unique=True, nullable=False)  # Código UBIGEO oficial
    departamento = Column(String(100), nullable=False, index=True)
    provincia = Column(String(100), nullable=False, index=True)
    distrito = Column(String(100), nullable=False, index=True)
    
    # Coordenadas aproximadas del centro del distrito
    latitud = Column(Float, nullable=True)
    longitud = Column(Float, nullable=True)
    
    # Estado
    activo = Column(Boolean, default=True)