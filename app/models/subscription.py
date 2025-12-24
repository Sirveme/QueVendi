"""
Modelos para sistema de suscripciones
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)  # 'freemium', 'pro_lite', 'pro', 'pro_plus'
    name = Column(String(100), nullable=False)
    base_price = Column(Numeric(10, 2), nullable=False)
    trial_days = Column(Integer, default=0)
    
    # Límites
    max_sellers = Column(Integer, nullable=True)  # NULL = ilimitado
    max_cashiers = Column(Integer, default=1)
    max_sales_per_month = Column(Integer, nullable=True)
    
    # Features
    can_issue_invoices = Column(Boolean, default=False)
    can_use_presale = Column(Boolean, default=False)
    can_use_qr_orders = Column(Boolean, default=False)
    can_register_purchases = Column(Boolean, default=False)
    has_advanced_reports = Column(Boolean, default=False)
    has_inventory_management = Column(Boolean, default=False)
    
    # Precios extras
    price_per_extra_seller = Column(Numeric(10, 2), default=0)
    price_per_extra_cashier = Column(Numeric(10, 2), default=0)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Subscription(Base):
    __tablename__ = "subscriptions"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    plan_code = Column(String(20), nullable=False)
    
    # Estado
    status = Column(String(20), nullable=False)  # 'trial', 'active', 'past_due', 'expired', 'cancelled'
    
    # Fechas
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    current_period_start = Column(DateTime(timezone=True), nullable=False)
    current_period_end = Column(DateTime(timezone=True), nullable=False)
    next_billing_date = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    
    # Addons (para Pro Plus)
    extra_sellers = Column(Integer, default=0)
    extra_cashiers = Column(Integer, default=0)
    
    # Pago
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    last_payment_date = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relaciones
    store = relationship("Store", back_populates="subscriptions")