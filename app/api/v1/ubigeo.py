# app/api/v1/ubigeo.py
"""
Endpoints para búsqueda de ubicaciones (UBIGEO Perú)
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db


router = APIRouter(prefix="/ubigeo")


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
        # Query simplificado compatible con PostgreSQL DISTINCT
        query = text("""
            SELECT distrito, provincia, departamento, latitud, longitud
            FROM ubigeo
            WHERE LOWER(distrito) LIKE LOWER(:search_pattern)
            ORDER BY distrito
            LIMIT :limit_val
        """)
        
        result = db.execute(query, {
            "search_pattern": f"%{q}%",
            "limit_val": limit
        })
        rows = result.fetchall()
        
        # Ordenar en Python: exactos primero, luego los que empiezan con q, luego el resto
        q_lower = q.lower()
        results = []
        for row in rows:
            distrito = row[0]
            distrito_lower = distrito.lower() if distrito else ""
            
            # Calcular prioridad
            if distrito_lower == q_lower:
                priority = 0
            elif distrito_lower.startswith(q_lower):
                priority = 1
            else:
                priority = 2
            
            results.append({
                "distrito": distrito,
                "provincia": row[1],
                "departamento": row[2],
                "latitud": float(row[3]) if row[3] else None,
                "longitud": float(row[4]) if row[4] else None,
                "_priority": priority
            })
        
        # Ordenar por prioridad y luego alfabéticamente
        results.sort(key=lambda x: (x["_priority"], x["distrito"] or ""))
        
        # Quitar campo de prioridad interno
        for r in results:
            del r["_priority"]
        
        return {
            "query": q,
            "count": len(results),
            "results": results
        }
        
    except Exception as e:
        print(f"[Ubigeo] Error: {e}")
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
        query = text("""
            SELECT DISTINCT departamento 
            FROM ubigeo 
            ORDER BY departamento
        """)
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
        query = text("""
            SELECT DISTINCT provincia 
            FROM ubigeo 
            WHERE LOWER(departamento) = LOWER(:depto)
            ORDER BY provincia
        """)
        result = db.execute(query, {"depto": departamento})
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
        query = text("""
            SELECT distrito, latitud, longitud 
            FROM ubigeo 
            WHERE LOWER(departamento) = LOWER(:depto)
            AND LOWER(provincia) = LOWER(:prov)
            ORDER BY distrito
        """)
        result = db.execute(query, {"depto": departamento, "prov": provincia})
        rows = result.fetchall()
        
        return {
            "departamento": departamento,
            "provincia": provincia,
            "distritos": [
                {
                    "nombre": row[0], 
                    "latitud": float(row[1]) if row[1] else None, 
                    "longitud": float(row[2]) if row[2] else None
                }
                for row in rows
            ]
        }
    except Exception as e:
        return {"distritos": [], "error": str(e)}