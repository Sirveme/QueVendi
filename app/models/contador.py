"""
Modelos del Portal Contador — multi-cliente.
Tablas: contadores, contador_stores, contador_permisos
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Contador(Base):
    __tablename__ = "contadores"

    id = Column(Integer, primary_key=True, index=True)
    dni = Column(String(8), unique=True, nullable=True, index=True)
    email = Column(String(100), unique=True, nullable=True, index=True)
    full_name = Column(String(150), nullable=False)
    phone = Column(String(20), nullable=True)
    whatsapp = Column(String(20), nullable=True, index=True)
    ruc = Column(String(11), nullable=True)
    firma_contable = Column(String(200), nullable=True)
    pin_hash = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    stores = relationship("ContadorStore", back_populates="contador", cascade="all, delete-orphan")


class ContadorStore(Base):
    __tablename__ = "contador_stores"

    id = Column(Integer, primary_key=True, index=True)
    contador_id = Column(Integer, ForeignKey("contadores.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    estado = Column(String(20), default="pendiente")  # pendiente | activo | revocado
    invitation_token = Column(String(64), nullable=True, index=True)
    invited_at = Column(DateTime(timezone=True), server_default=func.now())
    accepted_at = Column(DateTime(timezone=True), nullable=True)

    contador = relationship("Contador", back_populates="stores")
    store = relationship("Store")


class ContadorPermiso(Base):
    __tablename__ = "contador_permisos"

    id = Column(Integer, primary_key=True, index=True)
    contador_id = Column(Integer, ForeignKey("contadores.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    puede_notas = Column(Boolean, default=False)
    puede_ver_planilla = Column(Boolean, default=False)
    puede_modificar = Column(Boolean, default=False)
    puede_ver_bancario = Column(Boolean, default=False)
    notificar_owner = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    contador = relationship("Contador")
    store = relationship("Store")
