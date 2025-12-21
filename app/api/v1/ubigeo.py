# app/api/v1/ubigeo.py
"""
Endpoints para búsqueda de ubicaciones (UBIGEO Perú)
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.core.database import get_db


router = APIRouter(prefix="/ubigeo", tags=["Ubigeo"])


@router.get("/search")
async def search_ubigeo(
    q: str = Query(..., min_length=2, description="Texto a buscar en distrito"),
    limit: int = Query(10, le=50),
    db: Session = Depends(get_db)
):
    """
    Busca distritos por nombre y devuelve provincia y departamento.
    """
    try:
        # Query directo a la tabla ubigeo
        query = f"""
            SELECT DISTINCT distrito, provincia, departamento, latitud, longitud
            FROM ubigeo
            WHERE LOWER(distrito) LIKE LOWER('%{q}%')
            ORDER BY 
                CASE WHEN LOWER(distrito) = LOWER('{q}') THEN 0
                     WHEN LOWER(distrito) LIKE LOWER('{q}%') THEN 1
                     ELSE 2
                END,
                distrito
            LIMIT {limit}
        """
        
        result = db.execute(query)
        rows = result.fetchall()
        
        results = []
        for row in rows:
            results.append({
                "distrito": row[0],
                "provincia": row[1],
                "departamento": row[2],
                "latitud": row[3],
                "longitud": row[4]
            })
        
        return {
            "query": q,
            "count": len(results),
            "results": results
        }
        
    except Exception as e:
        print(f"[Ubigeo] Error: {e}")
        # Fallback a búsqueda local si hay error
        return {
            "query": q,
            "count": 0,
            "results": [],
            "error": str(e)
        }


@router.get("/departamentos")
async def list_departamentos(db: Session = Depends(get_db)):
    """Lista todos los departamentos únicos."""
    try:
        query = """
            SELECT DISTINCT departamento 
            FROM ubigeo 
            ORDER BY departamento
        """
        result = db.execute(query)
        rows = result.fetchall()
        
        return {
            "departamentos": [row[0] for row in rows]
        }
    except Exception as e:
        return {"departamentos": [], "error": str(e)}


@router.get("/provincias/{departamento}")
async def list_provincias(
    departamento: str,
    db: Session = Depends(get_db)
):
    """Lista todas las provincias de un departamento."""
    try:
        query = f"""
            SELECT DISTINCT provincia 
            FROM ubigeo 
            WHERE LOWER(departamento) = LOWER('{departamento}')
            ORDER BY provincia
        """
        result = db.execute(query)
        rows = result.fetchall()
        
        return {
            "departamento": departamento,
            "provincias": [row[0] for row in rows]
        }
    except Exception as e:
        return {"provincias": [], "error": str(e)}


@router.get("/distritos/{departamento}/{provincia}")
async def list_distritos(
    departamento: str,
    provincia: str,
    db: Session = Depends(get_db)
):
    """Lista todos los distritos de una provincia."""
    try:
        query = f"""
            SELECT distrito, latitud, longitud 
            FROM ubigeo 
            WHERE LOWER(departamento) = LOWER('{departamento}')
            AND LOWER(provincia) = LOWER('{provincia}')
            ORDER BY distrito
        """
        result = db.execute(query)
        rows = result.fetchall()
        
        return {
            "departamento": departamento,
            "provincia": provincia,
            "distritos": [
                {"nombre": row[0], "latitud": row[1], "longitud": row[2]}
                for row in rows
            ]
        }
    except Exception as e:
        return {"distritos": [], "error": str(e)}