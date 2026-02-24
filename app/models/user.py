"""
Modelo User - Actualizado para Fase 1
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    dni = Column(String(8), unique=True, index=True, nullable=False)
    pin_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    phone = Column(String(15), nullable=True)
    
    # Relación con Store
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    
    # Rol
    role = Column(String(20), default="seller")  # 'owner', 'admin', 'seller', 'cashier'
    
    # Username y avatar
    username = Column(String(100), unique=True, nullable=False)
    avatar_url = Column(String(500), nullable=True)
    
    # Permisos
    can_register_purchases = Column(Boolean, default=False)
    can_view_analytics = Column(Boolean, default=False)
    can_modify_prices = Column(Boolean, default=False)
    can_cancel_sales = Column(Boolean, default=False)
    can_view_all_sales = Column(Boolean, default=False)
    can_manage_inventory = Column(Boolean, default=False)

    # Control de primer login
    first_login = Column(Boolean, default=True)
    
    # Recuperación de contraseña
    recovery_code = Column(String(6), nullable=True)
    recovery_code_expires = Column(DateTime(timezone=True), nullable=True)
    
    # Login tracking
    last_login = Column(DateTime(timezone=True), nullable=True)
    
    # Estado
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relaciones
    store = relationship("Store", back_populates="users")
    sales = relationship("Sale", back_populates="user", foreign_keys="Sale.user_id")