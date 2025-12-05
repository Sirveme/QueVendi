"""
Servicio de validación de DNI/RUC usando APIs.net.pe
"""
import requests
import logging
from typing import Optional, Dict
from fastapi import HTTPException, status
from app.core.config import settings


class ApisNetPe:
    """Cliente para APIs.net.pe"""
    
    def __init__(self, token: Optional[str] = None):
        self._api_token = token.strip() if token else None
        self._api_url = "https://api.decolecta.com"
        
        if not self._api_token:
            logging.error("CRITICAL: ApisNetPe Client configured WITHOUT token!")

    def _get(self, path: str, params: dict) -> Optional[dict]:
        """Método genérico para hacer peticiones GET"""
        if not self._api_token:
            logging.error("API Token for apis.net.pe is missing.")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="External API service not configured."
            )
            
        url = f"{self._api_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._api_token}",
            "Referer": "https://quevendi.pro",
        }

        # Después de crear headers
        print(f"\n=== DEBUG API CALL ===")
        print(f"URL: {url}")
        print(f"TOKEN: |{self._api_token}|")
        print(f"HEADER: {headers}")
        print(f"PARAMS: {params}")
        print("=" * 50 + "\n")

        logging.info(f"Calling APIs.net.pe: {url} with params: {params}")

        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.HTTPError as http_err:
            logging.warning(f"HTTP error from apis.net.pe: {http_err}")
            detail = "Error consulting external service."
            try:
                error_response = http_err.response.json()
                detail = error_response.get("message", detail)
            except requests.exceptions.JSONDecodeError:
                detail = http_err.response.text if http_err.response.text else detail

            raise HTTPException(status_code=http_err.response.status_code, detail=detail)
        
        except requests.exceptions.RequestException as req_err:
            logging.error(f"Network error connecting to apis.net.pe: {req_err}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, 
                detail="Could not connect to external service."
            )

    def get_person(self, dni: str) -> Optional[dict]:
        """Consulta un DNI en RENIEC"""
        return self._get("/v1/reniec/dni", {"numero": dni})
        
    def get_company(self, ruc: str) -> Optional[dict]:
        """Consulta un RUC en SUNAT"""
        return self._get("/v1/sunat/ruc", {"numero": ruc})


class ValidationService:
    """Servicio de validación de documentos"""
    
    def __init__(self):
        self.api_client = ApisNetPe(token=settings.APIS_NET_PE_TOKEN)
    
    def validate_dni(self, dni: str) -> Dict[str, any]:
        """
        Valida un DNI y retorna los datos de la persona
        
        Returns:
            {
                'valid': bool,
                'document_number': str,
                'full_name': str,
                'raw_data': dict  # Para guardar en verification_data
            }
        """
        # Validación de formato
        if not (dni.isdigit() and len(dni) == 8):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="DNI debe tener 8 dígitos numéricos"
            )
        
        try:
            person_data = self.api_client.get_person(dni)

            # ========== DEBUG ==========
            print(f"\n🔍 PERSON_DATA RECIBIDO: {person_data}\n")
            # ===========================
            
            if not person_data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="DNI no encontrado en RENIEC"
                )
            
            # Extraer datos (Decolecta usa snake_case)
            full_name = person_data.get("full_name", "")

            if not full_name:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se pudo obtener el nombre de la persona"
                )

            return {
                'valid': True,
                'document_number': dni,
                'document_type': 'DNI',
                'full_name': full_name.strip(),
                'raw_data': person_data
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logging.error(f"Error validating DNI {dni}: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error al validar DNI"
            )
    
    def validate_ruc(self, ruc: str) -> Dict[str, any]:
        """
        Valida un RUC y retorna los datos de la empresa
        
        Returns:
            {
                'valid': bool,
                'document_number': str,
                'business_name': str,
                'commercial_name': str,
                'address': str,
                'raw_data': dict
            }
        """
        # Validación de formato
        if not (ruc.isdigit() and len(ruc) == 11 and (ruc.startswith('10') or ruc.startswith('20'))):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="RUC debe tener 11 dígitos y empezar con 10 o 20"
            )
        
        try:
            company_data = self.api_client.get_company(ruc)

            # ========== DEBUG ==========
            print(f"\n🔍 COMPANY_DATA RECIBIDO: {company_data}\n")
            # ===========================
            
            if not company_data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="RUC no encontrado en SUNAT"
                )
            
            # Extraer datos
            # Extraer datos (Decolecta usa snake_case)
            business_name = company_data.get("razon_social", "")
            commercial_name = company_data.get("nombre_comercial") or business_name
            address = company_data.get("direccion", "")

            if address == "-" or not address.strip():
                address = "Dirección no disponible"

            if not business_name:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se pudo obtener la razón social"
                )

            return {
                'valid': True,
                'document_number': ruc,
                'document_type': 'RUC',
                'business_name': business_name.strip(),
                'commercial_name': commercial_name.strip() if commercial_name else business_name.strip(),
                'address': address.strip(),
                'raw_data': company_data
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logging.error(f"Error validating RUC {ruc}: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error al validar RUC"
            )


# Instancia global
validation_service = ValidationService()