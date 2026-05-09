"""
Modelos para Múltiples Precios y Combos
- PriceTier: tipos de cliente (mayorista, vip, distribuidor, etc.)
- ProductPrice: precio por producto / tier
- Combo: paquete de productos con precio especial
- ComboItem: items que conforman un combo
"""
from sqlalchemy import (
    Column, Integer, String, Numeric, Boolean,
    Date, ForeignKey, DateTime
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class PriceTier(Base):
    __tablename__ = 'price_tiers'

    id = Column(Integer, primary_key=True)
    store_id = Column(Integer, ForeignKey('stores.id'), index=True)
    nombre = Column(String(50), nullable=False)
    descripcion = Column(String(200))
    color = Column(String(10), default='#3b82f6')
    is_active = Column(Boolean, default=True)
    orden = Column(Integer, default=0)

    precios = relationship(
        'ProductPrice',
        back_populates='tier'
    )


class ProductPrice(Base):
    __tablename__ = 'product_prices'

    id = Column(Integer, primary_key=True)
    store_id = Column(Integer, ForeignKey('stores.id'), index=True)
    product_id = Column(Integer, ForeignKey('products.id'), index=True)
    tier_id = Column(Integer, ForeignKey('price_tiers.id'), index=True)
    precio = Column(Numeric(10, 2), nullable=False)
    cantidad_minima = Column(Numeric(10, 3), default=1)
    is_active = Column(Boolean, default=True)

    tier = relationship('PriceTier', back_populates='precios')
    product = relationship('Product')


class Combo(Base):
    __tablename__ = 'combos'

    id = Column(Integer, primary_key=True)
    store_id = Column(Integer, ForeignKey('stores.id'), index=True)
    nombre = Column(String(100), nullable=False)
    descripcion = Column(String(300))
    precio_combo = Column(Numeric(10, 2))
    precio_normal = Column(Numeric(10, 2))
    imagen_url = Column(String(500))
    show_in_catalog = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    fecha_inicio = Column(Date)
    fecha_fin = Column(Date)
    created_at = Column(DateTime, server_default=func.now())

    items = relationship(
        'ComboItem',
        back_populates='combo',
        cascade='all, delete-orphan'
    )


class ComboItem(Base):
    __tablename__ = 'combo_items'

    id = Column(Integer, primary_key=True)
    combo_id = Column(Integer, ForeignKey('combos.id'))
    product_id = Column(Integer, ForeignKey('products.id'))
    quantity = Column(Numeric(10, 3), nullable=False)
    precio_unitario = Column(Numeric(10, 2))

    combo = relationship('Combo', back_populates='items')
    product = relationship('Product')
