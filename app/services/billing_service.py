# app/services/billing_service.py
"""
Servicio de Facturación Electrónica - QueVendí
Integración con facturalo.pro para emisión de comprobantes

Basado en el patrón de ccploreto.org.pe
"""
import httpx
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from decimal import Decimal
from sqlalchemy.orm import Session

from app.models.billing import StoreBillingConfig, Comprobante
from app.models.sale import Sale, SaleItem

logger = logging.getLogger(__name__)

# Timezone Perú (UTC-5)
TZ_PERU = timezone(timedelta(hours=-5))


class BillingService:
    """Servicio para emitir comprobantes electrónicos vía facturalo.pro"""

    def __init__(self, db: Session, store_id: int):
        self.db = db
        self.store_id = store_id
        self.config = self._get_config()

    def _get_config(self) -> Optional[StoreBillingConfig]:
        """Obtiene la configuración de facturación de la tienda"""
        return self.db.query(StoreBillingConfig).filter(
            StoreBillingConfig.store_id == self.store_id,
            StoreBillingConfig.is_active == True
        ).first()

    def esta_configurado(self) -> bool:
        """Verifica si la tienda tiene facturación configurada"""
        return (
            self.config is not None
            and self.config.facturalo_token is not None
            and self.config.is_active
        )

    # ============================================
# FIX: billing_service.py
# Problema: QueVendi y facturalo.pro calculaban correlativos independientemente
# Solución: facturalo.pro es la fuente de verdad del correlativo
# ============================================

# REEMPLAZAR el método emitir_comprobante completo:

    async def emitir_comprobante(
        self,
        sale_id: int,
        tipo: str = "03",
        cliente_tipo_doc: str = "0",
        cliente_num_doc: str = "00000000",
        cliente_nombre: str = "CLIENTE VARIOS",
        cliente_direccion: str = None,
        cliente_email: str = None,
    ) -> Dict[str, Any]:
        """
        Emite un comprobante electrónico para una venta.
        
        FIX: El correlativo lo asigna facturalo.pro, no QueVendi.
        Esto evita desfases entre el número mostrado y el del PDF.
        """
        if not self.esta_configurado():
            return {"success": False, "error": "Facturación no configurada para esta tienda"}

        # Verificar que no exista comprobante EXITOSO previo
        existe = self.db.query(Comprobante).filter(
            Comprobante.sale_id == sale_id,
            Comprobante.status.in_(["accepted", "pending"])
        ).first()
        if existe:
            return {
                "success": False,
                "error": "Ya existe comprobante para esta venta",
                "comprobante_id": existe.id,
                "numero_formato": existe.numero_formato
            }

        # Obtener la venta
        sale = self.db.query(Sale).filter(Sale.id == sale_id).first()
        if not sale:
            return {"success": False, "error": "Venta no encontrada"}

        # Determinar serie
        if tipo == "01":
            serie = self.config.serie_factura
        else:
            serie = self.config.serie_boleta

        # ✅ FIX: NO pre-calculamos el número
        # El número lo asigna facturalo.pro

        # Construir items del comprobante
        items = self._construir_items(sale)

        # Calcular totales
        subtotal = Decimal(str(sale.total))
        if self.config.tipo_afectacion_igv == "10":
            igv = round(subtotal - (subtotal / Decimal("1.18")), 2)
            subtotal_sin_igv = subtotal - igv
        else:
            igv = Decimal("0")
            subtotal_sin_igv = subtotal

        # ✅ FIX: Crear comprobante con número temporal (0)
        # Se actualizará con el número real de facturalo.pro
        comprobante = Comprobante(
            store_id=self.store_id,
            sale_id=sale_id,
            tipo=tipo,
            serie=serie,
            numero=0,  # ← Temporal, se actualiza después
            subtotal=subtotal_sin_igv,
            igv=igv,
            total=subtotal,
            cliente_tipo_doc=cliente_tipo_doc,
            cliente_num_doc=cliente_num_doc,
            cliente_nombre=cliente_nombre,
            cliente_direccion=cliente_direccion,
            cliente_email=cliente_email,
            items=items,
            status="pending"
        )
        self.db.add(comprobante)
        self.db.flush()

        # Enviar a facturalo.pro
        resultado = await self._enviar_a_facturalo(comprobante)

        if resultado["success"]:
            # ✅ FIX: Usar el número que devolvió facturalo.pro
            numero_real = resultado.get("numero", 0)
            numero_formato_real = resultado.get("numero_formato", f"{serie}-{str(numero_real).zfill(8)}")
            
            comprobante.numero = numero_real
            comprobante.status = "accepted"
            comprobante.facturalo_id = resultado.get("facturalo_id")
            comprobante.facturalo_response = resultado.get("response")
            comprobante.sunat_response_code = resultado.get("sunat_code", "0")
            comprobante.sunat_response_description = resultado.get("sunat_description")
            comprobante.sunat_hash = resultado.get("hash")
            comprobante.pdf_url = resultado.get("pdf_url")
            comprobante.xml_url = resultado.get("xml_url")
            comprobante.cdr_url = resultado.get("cdr_url")

            # ✅ FIX: Actualizar correlativo en config con el número REAL
            if tipo == "01":
                self.config.ultimo_numero_factura = numero_real
            else:
                self.config.ultimo_numero_boleta = numero_real

            self.db.commit()
            
            logger.info(f"[Billing] ✅ Comprobante emitido: {numero_formato_real}")

            return {
                "success": True,
                "comprobante_id": comprobante.id,
                "serie": serie,
                "numero": numero_real,
                "numero_formato": comprobante.numero_formato,  # ✅ Usar la property
                "pdf_url": comprobante.pdf_url,
                "error": None
            }
        else:
            # Rollback: no guardar comprobantes rechazados
            self.db.rollback()
            logger.warning(f"[Billing] ❌ Comprobante rechazado: {resultado.get('error')}")

            return {
                "success": False,
                "comprobante_id": None,
                "serie": serie,
                "numero": None,
                "numero_formato": None,
                "pdf_url": None,
                "error": resultado.get("error")
            }


# ============================================
# REEMPLAZAR el método _enviar_a_facturalo:
# ============================================

    async def _enviar_a_facturalo(self, comprobante: Comprobante) -> Dict:
        """Envía el comprobante a facturalo.pro"""

        # Fecha y hora de emisión en timezone Perú
        ahora_peru = datetime.now(TZ_PERU)

        payload = {
            "tipo_comprobante": comprobante.tipo,
            "serie": comprobante.serie,
            # ✅ FIX: NO enviamos número, facturalo.pro lo asigna
            "fecha_emision": ahora_peru.strftime("%Y-%m-%d"),
            "hora_emision": ahora_peru.strftime("%H:%M:%S"),
            "moneda": "PEN",
            "forma_pago": "Contado",
            "cliente": {
                "tipo_documento": comprobante.cliente_tipo_doc,
                "numero_documento": comprobante.cliente_num_doc,
                "razon_social": comprobante.cliente_nombre,
                "direccion": comprobante.cliente_direccion,
                "email": comprobante.cliente_email
            },
            "items": [{
                "descripcion": item.get("descripcion"),
                "cantidad": item.get("cantidad", 1),
                "unidad_medida": item.get("unidad", "NIU"),
                "precio_unitario": item.get("precio_unitario"),
                "tipo_afectacion_igv": self.config.tipo_afectacion_igv
            } for item in (comprobante.items or [])],
            "enviar_email": bool(comprobante.cliente_email),
            "referencia_externa": f"QUEVENDI-VENTA-{comprobante.sale_id}"
        }

        api_url = f"{self.config.facturalo_url}/comprobantes"
        logger.info(f"[Billing] Enviando a {api_url}: serie={comprobante.serie}, tipo={comprobante.tipo}")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    api_url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "X-API-Key": self.config.facturalo_token,
                        "X-API-Secret": self.config.facturalo_secret
                    }
                )

                logger.info(f"[Billing] Respuesta: status={response.status_code}")

                try:
                    data = response.json()
                except Exception:
                    body_preview = response.text[:500] if response.text else "(vacío)"
                    logger.error(f"[Billing] Respuesta no-JSON: {body_preview}")
                    return {
                        "success": False,
                        "error": f"facturalo.pro respondió con formato inválido (HTTP {response.status_code})",
                        "response": {"raw": body_preview}
                    }

                if response.status_code in [200, 201] and data.get("exito"):
                    comp_data = data.get("comprobante", {})
                    archivos = data.get("archivos", {})
                    
                    # ✅ FIX: Extraer número y numero_formato de la respuesta
                    numero = comp_data.get("numero")
                    numero_formato = comp_data.get("numero_formato")
                    
                    logger.info(f"[Billing] ✅ facturalo.pro asignó: {numero_formato}")
                    
                    return {
                        "success": True,
                        "facturalo_id": comp_data.get("id"),
                        "numero": numero,  # ✅ Número real asignado por facturalo
                        "numero_formato": numero_formato,  # ✅ Formato completo
                        "response": data,
                        "sunat_code": comp_data.get("codigo_sunat", "0"),
                        "sunat_description": comp_data.get("mensaje_sunat"),
                        "hash": comp_data.get("hash_cpe"),
                        "pdf_url": archivos.get("pdf_url"),
                        "xml_url": archivos.get("xml_url"),
                        "cdr_url": archivos.get("cdr_url"),
                    }
                else:
                    error_msg = data.get("mensaje", data.get("error", "Error desconocido"))
                    if isinstance(data.get("detail"), dict):
                        error_msg = data["detail"].get("error", error_msg)
                    elif isinstance(data.get("detail"), str):
                        error_msg = data["detail"]
                    
                    logger.error(f"[Billing] ❌ Rechazado: {error_msg}")
                    return {
                        "success": False,
                        "error": error_msg,
                        "response": data
                    }

        except httpx.TimeoutException:
            logger.error("[Billing] Timeout conectando a facturalo.pro")
            return {"success": False, "error": "Timeout conectando a facturalo.pro"}
        except httpx.RequestError as e:
            logger.error(f"[Billing] Error de conexión: {str(e)}")
            return {"success": False, "error": f"Error de conexión: {str(e)}"}
        except Exception as e:
            logger.error(f"[Billing] Error inesperado: {str(e)}")
            return {"success": False, "error": f"Error inesperado: {str(e)}"}


    def _construir_items(self, sale: Sale) -> List[Dict]:
        """Construye la lista de items para el comprobante"""
        items = []
        for item in sale.items:
            items.append({
                "codigo": str(item.product_id),
                "descripcion": item.product.name if item.product else f"Producto #{item.product_id}",
                "unidad": "NIU",  # Unidad (NIU=unidad, KGM=kilo)
                "cantidad": item.quantity,
                "precio_unitario": float(item.unit_price),
                "valor_venta": float(item.subtotal),
                "tipo_afectacion_igv": self.config.tipo_afectacion_igv
            })
        return items

    async def _enviar_a_facturalo(self, comprobante: Comprobante) -> Dict:
        """Envía el comprobante a facturalo.pro"""

        # Fecha y hora de emisión en timezone Perú
        ahora_peru = datetime.now(TZ_PERU)

        payload = {
            "tipo_comprobante": comprobante.tipo,
            "serie": comprobante.serie,
            "fecha_emision": ahora_peru.strftime("%Y-%m-%d"),
            "hora_emision": ahora_peru.strftime("%H:%M:%S"),
            "moneda": "PEN",
            "forma_pago": "Contado",
            "cliente": {
                "tipo_documento": comprobante.cliente_tipo_doc,
                "numero_documento": comprobante.cliente_num_doc,
                "razon_social": comprobante.cliente_nombre,
                "direccion": comprobante.cliente_direccion,
                "email": comprobante.cliente_email
            },
            "items": [{
                "descripcion": item.get("descripcion"),
                "cantidad": item.get("cantidad", 1),
                "unidad_medida": item.get("unidad", "NIU"),
                "precio_unitario": item.get("precio_unitario"),
                "tipo_afectacion_igv": self.config.tipo_afectacion_igv
            } for item in (comprobante.items or [])],
            "enviar_email": bool(comprobante.cliente_email),
            "referencia_externa": f"QUEVENDI-VENTA-{comprobante.sale_id}"
        }

        api_url = f"{self.config.facturalo_url}/comprobantes"
        logger.info(f"[Billing] Enviando comprobante a {api_url}: {comprobante.serie}-{comprobante.numero}")
        logger.info(f"[Billing] Payload items: {len(payload.get('items', []))} items, tipo={payload['tipo_comprobante']}")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    api_url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "X-API-Key": self.config.facturalo_token,
                        "X-API-Secret": self.config.facturalo_secret
                    }
                )

                logger.info(f"[Billing] Respuesta facturalo.pro: status={response.status_code}")

                # Parsear respuesta JSON de forma segura
                try:
                    data = response.json()
                except Exception as json_err:
                    body_preview = response.text[:500] if response.text else "(vacío)"
                    logger.error(f"[Billing] Respuesta no-JSON de facturalo.pro: {body_preview}")
                    return {
                        "success": False,
                        "error": f"facturalo.pro respondió con formato inválido (HTTP {response.status_code})",
                        "response": {"raw": body_preview}
                    }

                if response.status_code in [200, 201] and data.get("exito"):
                    comp_data = data.get("comprobante", {})
                    archivos = data.get("archivos", {})
                    return {
                        "success": True,
                        "facturalo_id": comp_data.get("id"),
                        "response": data,
                        "sunat_code": comp_data.get("codigo_sunat", "0"),
                        "sunat_description": comp_data.get("mensaje_sunat"),
                        "hash": comp_data.get("hash_cpe"),
                        "pdf_url": archivos.get("pdf_url"),
                        "xml_url": archivos.get("xml_url"),
                        "cdr_url": archivos.get("cdr_url"),
                    }
                else:
                    error_msg = data.get("mensaje", data.get("error", "Error desconocido"))
                    logger.error(f"[Billing] facturalo.pro rechazó: {error_msg}")
                    return {
                        "success": False,
                        "error": error_msg,
                        "response": data
                    }

        except httpx.TimeoutException:
            logger.error("[Billing] Timeout conectando a facturalo.pro")
            return {"success": False, "error": "Timeout conectando a facturalo.pro"}
        except httpx.RequestError as e:
            logger.error(f"[Billing] Error de conexión: {str(e)}")
            return {"success": False, "error": f"Error de conexión: {str(e)}"}
        except Exception as e:
            logger.error(f"[Billing] Error inesperado: {str(e)}")
            return {"success": False, "error": f"Error inesperado: {str(e)}"}

    async def verificar_conexion(self) -> Dict[str, Any]:
        """Verifica la conexión con facturalo.pro"""
        if not self.config or not self.config.facturalo_token:
            return {"success": False, "error": "No hay credenciales configuradas"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.config.facturalo_url}/empresa",
                    headers={
                        "X-API-Key": self.config.facturalo_token,
                        "X-API-Secret": self.config.facturalo_secret
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    self.config.is_verified = True
                    self.db.commit()
                    return {
                        "success": True,
                        "empresa": data.get("razon_social", "Conectado"),
                        "ruc": data.get("ruc")
                    }
                else:
                    return {"success": False, "error": "Credenciales inválidas"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def obtener_comprobante(self, comprobante_id: int) -> Optional[Comprobante]:
        """Obtiene un comprobante por ID"""
        return self.db.query(Comprobante).filter(
            Comprobante.id == comprobante_id,
            Comprobante.store_id == self.store_id
        ).first()

    def obtener_comprobante_por_venta(self, sale_id: int) -> Optional[Comprobante]:
        """Obtiene el comprobante asociado a una venta"""
        return self.db.query(Comprobante).filter(
            Comprobante.sale_id == sale_id
        ).first()

    def listar_comprobantes(
        self,
        limit: int = 50,
        offset: int = 0,
        tipo: str = None,
        status: str = None
    ) -> List[Comprobante]:
        """Lista los comprobantes de la tienda"""
        query = self.db.query(Comprobante).filter(
            Comprobante.store_id == self.store_id
        )
        if tipo:
            query = query.filter(Comprobante.tipo == tipo)
        if status:
            query = query.filter(Comprobante.status == status)

        return query.order_by(Comprobante.created_at.desc()).offset(offset).limit(limit).all()


# Helper para uso simple
async def emitir_boleta(db: Session, sale_id: int, store_id: int) -> Dict:
    """Emite una boleta simple (cliente genérico)"""
    service = BillingService(db, store_id)
    return await service.emitir_comprobante(sale_id, tipo="03")


async def emitir_factura(
    db: Session,
    sale_id: int,
    store_id: int,
    ruc: str,
    razon_social: str,
    direccion: str = None
) -> Dict:
    """Emite una factura con datos del cliente"""
    service = BillingService(db, store_id)
    return await service.emitir_comprobante(
        sale_id,
        tipo="01",
        cliente_tipo_doc="6",
        cliente_num_doc=ruc,
        cliente_nombre=razon_social,
        cliente_direccion=direccion
    )
