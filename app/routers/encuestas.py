from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(prefix="/encuestas", tags=["encuestas"])
templates = Jinja2Templates(directory="app/templates")


@router.get("/casas", response_class=HTMLResponse)
async def encuesta_casas(request: Request):
    return templates.TemplateResponse(
        "encuestas/casas.html",
        {"request": request}
    )
