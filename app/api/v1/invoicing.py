from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import requests
from datetime import datetime

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.sale import Sale
from app.models.invoice import Invoice


router = APIRouter(prefix="/invoicing")

# Configuración PSE (ejemplo con Nubefact)
PSE_API_URL = "https://api.nubefact.com/v1"
PSE_TOKEN = "TU_TOKEN_AQUI"  # Configurar por negocio

class InvoiceService:
    def __init__(self, db: Session):
        self.db = db
    
    async def emit_ticket(self, sale_id: int, store_id: int):
        """Emitir ticket (no enviado a SUNAT)"""
        sale = self.db.query(Sale).filter(
            Sale.id == sale_id,
            Sale.store_id == store_id
        ).first()
        
        if not sale:
            raise HTTPException(404, "Venta no encontrada")
        
        # Generar número correlativo
        ticket_number = self._get_next_ticket_number(store_id)
        
        # Guardar en BD
        invoice = Invoice(
            sale_id=sale_id,
            store_id=store_id,
            type="TICKET",
            number=ticket_number,
            amount=sale.total,
            issued_at=datetime.now()
        )
        self.db.add(invoice)
        self.db.commit()
        
        return {
            "success": True,
            "ticket_number": ticket_number,
            "pdf_url": f"/api/v1/invoicing/ticket/{invoice.id}/pdf"
        }
    
    async def emit_boleta(self, sale_id: int, store_id: int, customer_data: dict):
        """Emitir boleta electrónica (enviada a SUNAT)"""
        sale = self.db.query(Sale).filter(
            Sale.id == sale_id,
            Sale.store_id == store_id
        ).first()
        
        # Preparar data para PSE
        payload = {
            "operacion": "generar_comprobante",
            "tipo_de_comprobante": "03",  # 03 = Boleta
            "serie": "B001",
            "numero": self._get_next_boleta_number(store_id),
            "cliente_tipo_de_documento": "1",  # DNI
            "cliente_numero_de_documento": customer_data.get("dni", "00000000"),
            "cliente_denominacion": customer_data.get("name", "CLIENTE VARIOS"),
            "fecha_de_emision": datetime.now().strftime("%d-%m-%Y"),
            "moneda": "PEN",
            "total_gravada": sale.total / 1.18,  # Base imponible
            "total_igv": sale.total - (sale.total / 1.18),
            "total": sale.total,
            "items": self._prepare_items(sale)
        }
        
        # Enviar a PSE
        response = requests.post(
            f"{PSE_API_URL}/comprobantes",
            json=payload,
            headers={"Authorization": f"Bearer {PSE_TOKEN}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Guardar en BD
            invoice = Invoice(
                sale_id=sale_id,
                store_id=store_id,
                type="BOLETA",
                series="B001",
                number=payload["numero"],
                amount=sale.total,
                customer_dni=customer_data.get("dni"),
                customer_name=customer_data.get("name"),
                sunat_cdr=data.get("cdr"),  # Constancia SUNAT
                pdf_url=data.get("pdf_url"),
                xml_url=data.get("xml_url"),
                issued_at=datetime.now()
            )
            self.db.add(invoice)
            self.db.commit()
            
            return {
                "success": True,
                "boleta_number": f"B001-{payload['numero']}",
                "pdf_url": data.get("pdf_url"),
                "xml_url": data.get("xml_url")
            }
        else:
            raise HTTPException(500, f"Error SUNAT: {response.text}")
    
    async def emit_factura(self, sale_id: int, store_id: int, customer_data: dict):
        """Emitir factura electrónica (enviada a SUNAT)"""
        # Similar a boleta pero tipo_de_comprobante = "01"
        # Requiere RUC del cliente
        pass

@router.post("/emit-ticket/{sale_id}")
async def emit_ticket(
    sale_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    service = InvoiceService(db)
    return await service.emit_ticket(sale_id, current_user.store_id)

@router.post("/emit-boleta/{sale_id}")
async def emit_boleta(
    sale_id: int,
    customer_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    service = InvoiceService(db)
    return await service.emit_boleta(sale_id, current_user.store_id, customer_data)

@router.post("/emit-factura/{sale_id}")
async def emit_factura(
    sale_id: int,
    customer_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    service = InvoiceService(db)
    return await service.emit_factura(sale_id, current_user.store_id, customer_data)