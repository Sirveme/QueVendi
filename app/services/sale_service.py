from datetime import datetime, timedelta
from typing import List, Dict
from sqlalchemy.orm import Session
from app.models.sale import Sale, SaleItem
from app.models.product import Product
from app.models.user import User
import pytz

# Timezone de Perú
PERU_TZ = pytz.timezone('America/Lima')

class SaleService:
    """Servicio para gestionar ventas"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create_sale(self, sale_data, user_id: int, store_id: int) -> Sale:
        """
        Crear una nueva venta con hora de Perú
        
        Args:
            sale_data: Objeto SaleCreate (Pydantic) o diccionario con items y payment_method
            user_id: ID del usuario
            store_id: ID de la tienda
        
        Returns:
            Objeto Sale creado
        
        Raises:
            ValueError: Si hay algún error en los datos
        """
        try:
            # Convertir Pydantic model a dict si es necesario
            if hasattr(sale_data, 'dict'):
                # Pydantic v1
                data = sale_data.dict()
            elif hasattr(sale_data, 'model_dump'):
                # Pydantic v2
                data = sale_data.model_dump()
            else:
                # Ya es un dict
                data = sale_data
            
            # Extraer datos
            items = data.get('items', [])
            payment_method = data.get('payment_method', 'efectivo')
            
            # Calcular el total
            total = sum(item['subtotal'] for item in items)
            
            # Crear la venta con hora de Perú (se convierte a UTC automáticamente)
            sale = Sale(
                store_id=store_id,
                user_id=user_id,
                total=total,
                payment_method=payment_method,
                sale_date=datetime.now(PERU_TZ)  # Hora de Perú
            )
            
            self.db.add(sale)
            self.db.flush()  # Para obtener el ID de la venta
            
            # Crear los items de la venta
            for item in items:
                sale_item = SaleItem(
                    sale_id=sale.id,
                    product_id=item['product_id'],
                    quantity=item['quantity'],
                    unit_price=item['unit_price'],
                    subtotal=item['subtotal']
                )
                self.db.add(sale_item)
                
                # Actualizar el stock del producto
                product = self.db.query(Product).filter(Product.id == item['product_id']).first()
                if product:
                    product.stock -= item['quantity']
            
            self.db.commit()
            self.db.refresh(sale)
            
            print(f"[SaleService] Venta creada: ID {sale.id}, Total S/ {total:.2f}, Hora Perú: {sale.sale_date}")
            
            return sale
            
        except Exception as e:
            self.db.rollback()
            print(f"[SaleService] Error al crear venta: {e}")
            raise ValueError(f"Error al crear venta: {str(e)}")
    
    def get_sales_by_date(self, store_id: int, date: datetime = None) -> List[Sale]:
        """
        Obtener ventas de un día específico en hora de Perú
        
        Args:
            store_id: ID de la tienda
            date: Fecha (por defecto hoy en hora de Perú)
        
        Returns:
            Lista de ventas
        """
        # Obtener fecha actual en hora de Perú
        if date is None:
            date = datetime.now(PERU_TZ)
        elif date.tzinfo is None:
            # Si la fecha no tiene timezone, asumimos que es hora de Perú
            date = PERU_TZ.localize(date)
        
        # Inicio y fin del día en hora de Perú
        start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        # Convertir a UTC para la consulta (la BD guarda en UTC)
        start_utc = start_of_day.astimezone(pytz.UTC)
        end_utc = end_of_day.astimezone(pytz.UTC)
        
        print(f"[SaleService] Buscando ventas del día (hora Perú):")
        print(f"[SaleService]   Desde: {start_of_day} → UTC: {start_utc}")
        print(f"[SaleService]   Hasta: {end_of_day} → UTC: {end_utc}")
        
        # Buscar ventas usando el rango UTC
        sales = self.db.query(Sale).filter(
            Sale.store_id == store_id,
            Sale.sale_date >= start_utc,
            Sale.sale_date < end_utc
        ).order_by(Sale.sale_date.desc()).all()
        
        print(f"[SaleService] Ventas encontradas: {len(sales)}")
        
        return sales
    
    def get_daily_total(self, store_id: int, date: datetime = None) -> float:
        """
        Calcular el total de ventas de un día en hora de Perú
        
        Args:
            store_id: ID de la tienda
            date: Fecha (por defecto hoy en hora de Perú)
        
        Returns:
            Total de ventas del día
        """
        sales = self.get_sales_by_date(store_id, date)
        total = sum(sale.total for sale in sales)
        
        print(f"[SaleService] Total del día: S/ {total:.2f} ({len(sales)} ventas)")
        
        return total
    
    def get_sale_by_id(self, sale_id: int) -> Sale:
        """
        Obtener una venta por su ID
        
        Args:
            sale_id: ID de la venta
        
        Returns:
            Objeto Sale
        
        Raises:
            ValueError: Si la venta no existe
        """
        sale = self.db.query(Sale).filter(Sale.id == sale_id).first()
        if not sale:
            raise ValueError(f"Venta con ID {sale_id} no encontrada")
        return sale
    
    def get_sales_by_store(self, store_id: int, limit: int = 50) -> List[Sale]:
        """
        Obtener las últimas ventas de una tienda
        
        Args:
            store_id: ID de la tienda
            limit: Límite de resultados
        
        Returns:
            Lista de ventas
        """
        return self.db.query(Sale).filter(
            Sale.store_id == store_id
        ).order_by(Sale.sale_date.desc()).limit(limit).all()
    
    def delete_sale(self, sale_id: int) -> bool:
        """
        Eliminar una venta (restaurar stock de productos)
        
        Args:
            sale_id: ID de la venta
        
        Returns:
            True si se eliminó correctamente
        
        Raises:
            ValueError: Si la venta no existe
        """
        try:
            sale = self.get_sale_by_id(sale_id)
            
            # Restaurar el stock de los productos
            for item in sale.items:
                product = self.db.query(Product).filter(Product.id == item.product_id).first()
                if product:
                    product.stock += item.quantity
            
            # Eliminar los items primero (por la foreign key)
            self.db.query(SaleItem).filter(SaleItem.sale_id == sale_id).delete()
            
            # Eliminar la venta
            self.db.delete(sale)
            self.db.commit()
            
            return True
            
        except Exception as e:
            self.db.rollback()
            raise ValueError(f"Error al eliminar venta: {str(e)}")
    
    def to_response(self, sale: Sale) -> Dict:
        """
        Convertir una venta a formato de respuesta
        
        Args:
            sale: Objeto Sale
        
        Returns:
            Diccionario con los datos de la venta compatible con SaleResponse
        """
        # Obtener nombre del usuario
        user_name = None
        if sale.user:
            user_name = getattr(sale.user, 'full_name', None) or \
                       getattr(sale.user, 'name', None) or \
                       getattr(sale.user, 'username', None) or \
                       f"Usuario {sale.user_id}"
        
        return {
            "id": sale.id,
            "store_id": sale.store_id,
            "user_id": sale.user_id,
            "total": sale.total,
            "payment_method": sale.payment_method,
            "payment_reference": getattr(sale, 'payment_reference', None),  # Puede ser None
            "customer_name": getattr(sale, 'customer_name', None),  # Puede ser None
            "is_credit": getattr(sale, 'is_credit', False),  # Default False para efectivo
            "sale_date": sale.sale_date,
            "created_at": sale.created_at,
            "user_name": user_name,  # Nombre del vendedor
            "items": [
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "product_name": item.product.name if item.product else "Producto eliminado",
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.subtotal
                }
                for item in sale.items
            ],
            "user": {
                "id": sale.user.id,
                "name": user_name,
                "identifier": getattr(sale.user, 'dni', None) or \
                             getattr(sale.user, 'email', None) or \
                             getattr(sale.user, 'phone', None)
            } if sale.user else None
        }