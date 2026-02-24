"""
CatalogService V2 - QueVendi.pro / Metraes.com / Sirveme1.com
Servicio para gestión de catálogos base de productos.

V2: Soporta catálogos enriquecidos con aliases, tags, complementarios,
sustitutos, mayoreo, _ia_data, imágenes y combos.

Flujo de importación:
  1. Cargar JSON del catálogo
  2. Crear productos con datos básicos + aliases + tags + mayoreo + _ia
  3. Segundo pase: resolver complementarios/sustitutos (código→ID)
  4. Registrar catalog_origin para trazabilidad
"""
import json
from pathlib import Path
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, any_
from datetime import datetime, timezone

from app.models.product import Product
from app.models.store import Store


# Ruta a los catálogos JSON
CATALOGS_DIR = Path(__file__).parent.parent / "data" / "catalogs"


class CatalogService:
    """
    Servicio para cargar catálogos base y crear productos.
    Evita duplicados verificando por nombre normalizado.
    Soporta catálogos V1 (básicos) y V2 (enriquecidos).
    """
    
    # ──────────────────────────────────────────────
    # CONSULTAR CATÁLOGOS
    # ──────────────────────────────────────────────
    
    @staticmethod
    def get_available_catalogs() -> List[Dict]:
        """Lista todos los catálogos disponibles con metadata"""
        catalogs = []
        
        if not CATALOGS_DIR.exists():
            return catalogs
        
        for file in sorted(CATALOGS_DIR.glob("*.json")):
            if file.name.startswith("_"):
                continue
            
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
                    # Contar productos reales (no confiar solo en total_productos)
                    total_real = sum(
                        len(cat.get("productos", []))
                        for cat in data.get("categorias", [])
                    )
                    
                    catalogs.append({
                        "nicho": data.get("nicho", file.stem),
                        "nombre": data.get("nombre", file.stem),
                        "icono": data.get("icono", "📦"),
                        "version": data.get("version", "1.0"),
                        "total_productos": total_real,
                        "categorias": len(data.get("categorias", [])),
                        "combos": len(data.get("combos_sugeridos", [])),
                        "has_aliases": any(
                            "aliases" in p
                            for cat in data.get("categorias", [])
                            for p in cat.get("productos", [])
                        )
                    })
            except Exception as e:
                print(f"⚠️ Error leyendo {file}: {e}")
        
        return catalogs
    
    @staticmethod
    def load_catalog(nicho: str) -> Optional[Dict]:
        """Carga un catálogo completo por nicho"""
        file_path = CATALOGS_DIR / f"{nicho}.json"
        
        if not file_path.exists():
            print(f"⚠️ Catálogo no encontrado: {nicho}")
            return None
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"❌ Error cargando catálogo {nicho}: {e}")
            return None
    
    @staticmethod
    def get_catalog_products(nicho: str) -> List[Dict]:
        """Obtiene lista plana de productos con todos los campos V2"""
        catalog = CatalogService.load_catalog(nicho)
        if not catalog:
            return []
        
        products = []
        for categoria in catalog.get("categorias", []):
            cat_name = categoria.get("nombre", "General")
            cat_icon = categoria.get("icono", "📦")
            
            for prod in categoria.get("productos", []):
                products.append({
                    # Básicos
                    "nombre": prod.get("nombre"),
                    "categoria": cat_name,
                    "categoria_icono": cat_icon,
                    "precio": prod.get("precio", 0),
                    "unidad": prod.get("unidad", "UND"),
                    "codigo": prod.get("codigo", ""),
                    "stock_inicial": prod.get("stock_inicial", 0),
                    "stock_minimo": prod.get("stock_minimo", 0),
                    "imagen": prod.get("imagen", ""),
                    # V2: Enriquecidos
                    "aliases": prod.get("aliases", []),
                    "tags": prod.get("tags", []),
                    "complementarios": prod.get("complementarios", []),  # Códigos, no IDs
                    "sustitutos": prod.get("sustitutos", []),            # Códigos, no IDs
                    "mayoreo": prod.get("mayoreo"),
                    "_ia": prod.get("_ia", {}),
                })
        
        return products
    
    @staticmethod
    def get_categories_for_nicho(nicho: str) -> List[Dict]:
        """Obtiene las categorías de un nicho con conteo"""
        catalog = CatalogService.load_catalog(nicho)
        if not catalog:
            return []
        
        return [
            {
                "nombre": cat.get("nombre"),
                "icono": cat.get("icono", "📦"),
                "productos_count": len(cat.get("productos", []))
            }
            for cat in catalog.get("categorias", [])
        ]
    
    @staticmethod
    def get_combos_for_nicho(nicho: str) -> List[Dict]:
        """Obtiene los combos sugeridos de un catálogo"""
        catalog = CatalogService.load_catalog(nicho)
        if not catalog:
            return []
        return catalog.get("combos_sugeridos", [])
    
    # ──────────────────────────────────────────────
    # IMPORTAR PRODUCTOS
    # ──────────────────────────────────────────────
    
    @staticmethod
    def import_products_to_store(
        db: Session,
        store_id: int,
        nicho: str,
        selected_products: List[str] = None,
        import_all: bool = False
    ) -> Dict:
        """
        Importa productos de un catálogo a una tienda.
        
        Proceso:
          1. Crea productos con datos básicos + aliases + tags + mayoreo + _ia
          2. Segundo pase: resuelve complementarios/sustitutos (código→ID)
          3. Actualiza active_catalogs del store
        
        Args:
            db: Sesión de base de datos
            store_id: ID de la tienda
            nicho: Tipo de negocio (bodega, minimarket, etc.)
            selected_products: Lista de códigos o nombres a importar (opcional)
            import_all: Si True, importa todos los productos del catálogo
        
        Returns:
            Dict con estadísticas de importación
        """
        stats = {
            "imported": 0,
            "skipped": 0,
            "errors": 0,
            "relations_resolved": 0,
            "products": [],
            "nicho": nicho
        }
        
        # Cargar catálogo
        catalog_products = CatalogService.get_catalog_products(nicho)
        if not catalog_products:
            return stats
        
        # Obtener nombres existentes (para evitar duplicados)
        existing = db.query(Product.name, Product.catalog_code).filter(
            Product.store_id == store_id,
            Product.deleted_at.is_(None)
        ).all()
        existing_names = {p.name.lower() for p in existing}
        existing_codes = {p.catalog_code for p in existing if p.catalog_code}
        
        # Filtrar qué importar
        if import_all:
            products_to_import = catalog_products
        elif selected_products:
            selected_lower = {s.lower() for s in selected_products}
            products_to_import = [
                p for p in catalog_products
                if p["nombre"].lower() in selected_lower
                or p["codigo"].lower() in selected_lower
            ]
        else:
            return stats
        
        # ── PASE 1: Crear productos ──
        # Mapeo código_catálogo → product_id (para resolver relaciones después)
        code_to_id = {}
        
        # También cargar códigos existentes si ya había productos de este catálogo
        existing_with_codes = db.query(Product.catalog_code, Product.id).filter(
            Product.store_id == store_id,
            Product.catalog_code.isnot(None),
            Product.deleted_at.is_(None)
        ).all()
        for ec in existing_with_codes:
            if ec.catalog_code:
                code_to_id[ec.catalog_code] = ec.id
        
        for prod_data in products_to_import:
            nombre = prod_data["nombre"]
            codigo = prod_data.get("codigo", "")
            
            # Verificar duplicados por nombre O por código
            if nombre.lower() in existing_names:
                stats["skipped"] += 1
                continue
            if codigo and codigo in existing_codes:
                stats["skipped"] += 1
                continue
            
            try:
                # Extraer mayoreo si existe
                mayoreo = prod_data.get("mayoreo")
                
                product = Product(
                    store_id=store_id,
                    name=nombre,
                    category=prod_data.get("categoria", "General"),
                    sale_price=prod_data.get("precio", 0),
                    unit=prod_data.get("unidad", "UND"),
                    catalog_code=codigo or None,
                    image_url=prod_data.get("imagen", "") or None,
                    stock=prod_data.get("stock_inicial", 0),
                    min_stock_alert=prod_data.get("stock_minimo", 5),
                    is_active=True,
                    # V2: Campos enriquecidos
                    aliases=prod_data.get("aliases", []),
                    tags=prod_data.get("tags", []),
                    mayoreo_cantidad_min=mayoreo.get("cantidad_minima") if mayoreo else None,
                    mayoreo_precio=mayoreo.get("precio_sugerido") if mayoreo else None,
                    mayoreo_nota=mayoreo.get("nota") if mayoreo else None,
                    _ia_data=prod_data.get("_ia", {}),
                    catalog_origin=nicho,
                    # Relaciones se resuelven en pase 2
                    complementarios=[],
                    sustitutos=[],
                    created_at=datetime.now(timezone.utc)
                )
                db.add(product)
                db.flush()  # Obtener ID sin commit
                
                # Registrar mapeo código→ID
                if codigo:
                    code_to_id[codigo] = product.id
                
                stats["imported"] += 1
                stats["products"].append(nombre)
                existing_names.add(nombre.lower())
                if codigo:
                    existing_codes.add(codigo)
                
            except Exception as e:
                print(f"❌ Error importando {nombre}: {e}")
                stats["errors"] += 1
        
        # ── PASE 2: Resolver relaciones complementarios/sustitutos ──
        if code_to_id:
            relations_count = CatalogService._resolve_relations(
                db, store_id, nicho, catalog_products, code_to_id
            )
            stats["relations_resolved"] = relations_count
        
        # ── COMMIT ──
        try:
            db.commit()
            
            # Actualizar active_catalogs del store
            CatalogService._update_store_catalogs(db, store_id, nicho)
            
        except Exception as e:
            db.rollback()
            print(f"❌ Error en commit: {e}")
            stats["errors"] += stats["imported"]
            stats["imported"] = 0
        
        return stats
    
    @staticmethod
    def _resolve_relations(
        db: Session,
        store_id: int,
        nicho: str,
        catalog_products: List[Dict],
        code_to_id: Dict[str, int]
    ) -> int:
        """
        Segundo pase: traduce códigos de catálogo a IDs reales
        para complementarios y sustitutos.
        
        Returns: número de relaciones resueltas
        """
        resolved = 0
        
        for prod_data in catalog_products:
            codigo = prod_data.get("codigo", "")
            if not codigo or codigo not in code_to_id:
                continue
            
            product_id = code_to_id[codigo]
            
            # Resolver complementarios
            comp_codes = prod_data.get("complementarios", [])
            comp_ids = [code_to_id[c] for c in comp_codes if c in code_to_id]
            
            # Resolver sustitutos
            sust_codes = prod_data.get("sustitutos", [])
            sust_ids = [code_to_id[s] for s in sust_codes if s in code_to_id]
            
            if comp_ids or sust_ids:
                product = db.query(Product).get(product_id)
                if product:
                    if comp_ids:
                        product.complementarios = comp_ids
                    if sust_ids:
                        product.sustitutos = sust_ids
                    resolved += 1
        
        return resolved
    
    @staticmethod
    def _update_store_catalogs(db: Session, store_id: int, nicho: str):
        """Registra el catálogo como activo en el store"""
        store = db.query(Store).get(store_id)
        if store:
            catalogs = store.active_catalogs or []
            if nicho not in catalogs:
                catalogs.append(nicho)
                store.active_catalogs = catalogs
                db.commit()
    
    # ──────────────────────────────────────────────
    # ELIMINAR CATÁLOGO
    # ──────────────────────────────────────────────
    
    @staticmethod
    def remove_catalog_from_store(
        db: Session,
        store_id: int,
        nicho: str,
        hard_delete: bool = False
    ) -> Dict:
        """
        Elimina todos los productos de un catálogo de una tienda.
        
        Args:
            db: Sesión de base de datos
            store_id: ID de la tienda
            nicho: Catálogo a eliminar ('bodega', 'minimarket', etc.)
            hard_delete: Si True, elimina de la BD. Si False, soft delete.
        
        Returns:
            Dict con estadísticas
        """
        stats = {"deleted": 0, "nicho": nicho}
        
        products = db.query(Product).filter(
            Product.store_id == store_id,
            Product.catalog_origin == nicho,
            Product.deleted_at.is_(None)
        ).all()
        
        now = datetime.now(timezone.utc)
        
        for product in products:
            if hard_delete:
                db.delete(product)
            else:
                product.deleted_at = now
                product.is_active = False
            stats["deleted"] += 1
        
        # Limpiar relaciones huérfanas en otros productos
        if stats["deleted"] > 0:
            deleted_ids = {p.id for p in products}
            CatalogService._clean_orphan_relations(db, store_id, deleted_ids)
        
        try:
            db.commit()
            
            # Actualizar active_catalogs del store
            store = db.query(Store).get(store_id)
            if store and store.active_catalogs:
                catalogs = [c for c in store.active_catalogs if c != nicho]
                store.active_catalogs = catalogs
                db.commit()
                
        except Exception as e:
            db.rollback()
            print(f"❌ Error eliminando catálogo {nicho}: {e}")
            stats["deleted"] = 0
        
        return stats
    
    @staticmethod
    def _clean_orphan_relations(db: Session, store_id: int, deleted_ids: set):
        """
        Limpia IDs eliminados de complementarios/sustitutos
        de productos que aún existen.
        """
        remaining = db.query(Product).filter(
            Product.store_id == store_id,
            Product.deleted_at.is_(None)
        ).all()
        
        for product in remaining:
            changed = False
            
            if product.complementarios:
                cleaned = [c for c in product.complementarios if c not in deleted_ids]
                if len(cleaned) != len(product.complementarios):
                    product.complementarios = cleaned
                    changed = True
            
            if product.sustitutos:
                cleaned = [s for s in product.sustitutos if s not in deleted_ids]
                if len(cleaned) != len(product.sustitutos):
                    product.sustitutos = cleaned
                    changed = True
    
    # ──────────────────────────────────────────────
    # CONSULTAS DE ESTADO
    # ──────────────────────────────────────────────
    
    @staticmethod
    def get_imported_catalog_info(db: Session, store_id: int) -> Dict:
        """Información sobre catálogos importados en la tienda"""
        
        # Productos por catalog_origin
        origin_counts = db.query(
            Product.catalog_origin,
            func.count(Product.id)
        ).filter(
            Product.store_id == store_id,
            Product.deleted_at.is_(None),
            Product.catalog_origin.isnot(None)
        ).group_by(Product.catalog_origin).all()
        
        # Productos manuales (sin catalog_origin)
        manual_count = db.query(func.count(Product.id)).filter(
            Product.store_id == store_id,
            Product.deleted_at.is_(None),
            Product.catalog_origin.is_(None)
        ).scalar()
        
        # Productos por categoría
        category_counts = db.query(
            Product.category,
            func.count(Product.id)
        ).filter(
            Product.store_id == store_id,
            Product.deleted_at.is_(None),
            Product.is_active == True
        ).group_by(Product.category).all()
        
        return {
            "catalogs": [
                {"nicho": origin, "count": count}
                for origin, count in origin_counts
            ],
            "manual_products": manual_count,
            "categories": [
                {"nombre": cat, "count": count}
                for cat, count in category_counts
            ],
            "total": sum(count for _, count in category_counts) + (manual_count or 0)
        }
    
    # ──────────────────────────────────────────────
    # BÚSQUEDA (para POS y voz)
    # ──────────────────────────────────────────────
    
    @staticmethod
    def search_products(
        db: Session,
        store_id: int,
        query: str,
        limit: int = 20,
        category: str = None,
        only_in_stock: bool = False
    ) -> List[Product]:
        """
        Búsqueda inteligente de productos por nombre y aliases.
        Pensada para el POS y especialmente para comandos de voz.
        
        Prioridad de resultados:
          1. Coincidencia exacta en nombre
          2. Nombre contiene la búsqueda
          3. Búsqueda está en aliases
          4. Búsqueda en tags
        """
        query_lower = query.strip().lower()
        if not query_lower:
            return []
        
        base = db.query(Product).filter(
            Product.store_id == store_id,
            Product.is_active == True,
            Product.deleted_at.is_(None)
        )
        
        if category:
            base = base.filter(Product.category == category)
        
        if only_in_stock:
            base = base.filter(Product.stock > 0)
        
        # Búsqueda combinada: nombre ILIKE OR alias ANY
        results = base.filter(
            or_(
                func.lower(Product.name).contains(query_lower),
                func.lower(any_(Product.aliases)).op('LIKE')(f'%{query_lower}%')
            )
        ).order_by(
            # Exact match first, then partial
            func.lower(Product.name) == query_lower,  # Exacto primero
            Product.name
        ).limit(limit).all()
        
        return results


# Instancia global del servicio
catalog_service = CatalogService()