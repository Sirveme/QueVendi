from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(prefix="/guia", tags=["guias"])
templates = Jinja2Templates(directory="app/templates")


@router.get("/shevalche", response_class=HTMLResponse)
async def guia_shevalche(request: Request):
    return templates.TemplateResponse(
        "guia/shevalche_mayo.html",
        {"request": request}
    )
