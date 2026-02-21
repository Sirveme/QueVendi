from sqlalchemy.dialects.postgresql import JSONB
"""
Modelo Store - Actualizado para Fase 1
"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Store(Base):
    __tablename__ = "stores"
    
    id = Column(Integer, primary_key=True, index=True)
    ruc = Column(String(11), unique=True, index=True, nullable=False)
    business_name = Column(String(200), nullable=False)
    commercial_name = Column(String(200), nullable=False)
    address = Column(String(300), nullable=True)
    
    # Ubicación
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    
    # Plan legacy (mantener por compatibilidad)
    plan = Column(String(20), default="freemium")
    plan_start_date = Column(DateTime(timezone=True), server_default=func.now())
    
    # Identificación y validación
    document_type = Column(String(3), nullable=True)  # 'DNI' o 'RUC'
    document_number = Column(String(11), nullable=True)
    verified = Column(Boolean, default=False)
    verification_data = Column(JSONB, nullable=True)  # Datos de APISNET
    
    # Ubicación detallada
    district = Column(String(100), nullable=True)
    province = Column(String(100), nullable=True)
    department = Column(String(100), nullable=True)
    
    # Contacto
    phone = Column(String(20), nullable=True)
    whatsapp = Column(String(20), nullable=True)
    email = Column(String(200), nullable=True)
    
    # Tipo de negocio
    business_type = Column(String(50), nullable=True)  # 'bodega', 'bazar', 'perfumeria', etc.
    business_mode = Column(String(20), default='simple')  # 'simple', 'presale', 'market'
    
    # Facturación
    can_issue_invoices = Column(Boolean, default=False)
    sunat_user = Column(String(100), nullable=True)
    sunat_password_encrypted = Column(String, nullable=True)
    
    # Configuración
    default_payment_method = Column(String(20), default='efectivo')
    requires_customer_name = Column(Boolean, default=False)
    auto_print_receipt = Column(Boolean, default=False)
    
    # Onboarding
    onboarding_completed = Column(Boolean, default=False)
    
    # Estado
    is_active = Column(Boolean, default=True)

     # ⬇️ AGREGAR ESTOS CAMPOS ⬇️
    catalog_code = Column(String(100), nullable=True)  # 🆕 Catálogo activo
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Catálogo público
    catalog_enabled = Column(Boolean, default=False)
    catalog_slug = Column(String(100), unique=True, index=True)
    delivery_enabled = Column(Boolean, default=False)
    min_delivery_amount = Column(Float, default=0)
    delivery_cost = Column(Float, default=0)
    logo_url = Column(String(500), nullable=True)

    
    # Relaciones
    users = relationship("User", back_populates="store")
    products = relationship("Product", back_populates="store")
    sales = relationship("Sale", back_populates="store")
    subscriptions = relationship("Subscription", back_populates="store")
    orders = relationship("Order", back_populates="store")
    billing_config = relationship("StoreBillingConfig", back_populates="store", uselist=False)