import sys as _sys
try:
    from fastapi import FastAPI
except ModuleNotFoundError:
    # Guard: TODO el proyecto corre en el VENV unico Python 3.12 'osenv312' (tiene
    # fastapi/uvicorn/comtypes + openseespy). Si se corre con otro Python (p.ej. `python`
    # a secas, que resuelve al 3.12 o 3.13 del sistema SIN fastapi), aparece este mensaje
    # claro en vez de un traceback cripto.
    print("=" * 72)
    print(" ERROR: 'fastapi' NO esta instalado en este Python.")
    print(f"   Python en uso: {_sys.executable}")
    print(f"   Version:       {_sys.version.split()[0]}")
    print("")
    print(" El servidor corre en el VENV unico 'osenv312' (Python 3.12 con todo).")
    print(" SOLUCION: arranca con 'INICIAR TODO.bat' (ya apunta a osenv312), o corre:")
    print(r'   "...\30 API ETABS IA\osenv312\Scripts\python.exe" etabs_server.py')
    print(r" Si falta algo:  osenv312\Scripts\python.exe -m pip install fastapi uvicorn comtypes")
    print("=" * 72)
    try:
        input("Presiona Enter para cerrar...")
    except Exception:
        pass
    _sys.exit(1)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Optional, Literal, Dict, Any, List
import comtypes
import comtypes.client
import traceback
import sys
import io
import time
import ast
import csv
import difflib
import math
import json
import os
import re
import runpy
import subprocess
import tempfile
from io import StringIO
from contextlib import contextmanager

# ============================================================
# ETABS AI BRIDGE SERVER
# ============================================================

# Version del servidor: el frontend la compara con la que espera y avisa si
# el proceso corriendo es viejo (frontend nuevo + servidor sin reiniciar era
# una fuente recurrente de errores confusos). Subir en cada cambio del server.
SERVER_VERSION = "1.31.0"

app = FastAPI(
    title="ETABS AI Bridge",
    version="3.1.0",
    description="Servidor local para ejecutar scripts seguros de ETABS API desde React."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ConnectionMode = Literal["attach", "start", "attach_or_start"]
ModelMode = Literal["keep_current", "new_blank", "open_file"]


class PreflightPayload(BaseModel):
    code: str = Field(..., min_length=1, max_length=120_000)
    strict_safety: bool = True


class ExecutePayload(BaseModel):
    code: str = Field(..., min_length=1, max_length=120_000)

    # Formato nuevo enviado por React corregido
    connection_mode: Optional[ConnectionMode] = None
    model_mode: Optional[ModelMode] = None

    model_path: Optional[str] = None
    units: Optional[int] = None

    strict_safety: bool = True
    variables: Dict[str, Any] = Field(default_factory=dict)

    # Modo "script completo": ejecuta el codigo tal cual, como desde cmd.
    # El servidor NO abre ETABS ni inyecta SapModel; el script lo hace todo
    # (import comtypes, CreateObject, ApplicationStart, etc.).
    raw_script: bool = False

    # Compatibilidad con el React anterior
    options: Optional[Dict[str, Any]] = None


class FlowPayload(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=200)
    codigo: str = Field(..., min_length=1, max_length=120_000)
    descripcion: str = ""


class LessonPayload(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=200)
    error: str = Field(..., min_length=1, max_length=4000)
    solucion: str = Field(..., min_length=1, max_length=20000)


class CleanupPayload(BaseModel):
    # True: cierra solo procesos sin ventana (colgados).
    # False: cierra TODOS los procesos de ETABS.
    solo_zombies: bool = True


class ToolRunPayload(BaseModel):
    # Despachador de herramientas del chat agentico (v1.15.0): el navegador
    # relaya aqui la herramienta que el modelo (Gemini/OpenAI/Claude) pidio.
    name: str = Field(..., min_length=1, max_length=80)
    arguments: Dict[str, Any] = Field(default_factory=dict)


class AnthropicProxyPayload(BaseModel):
    # Proxy local para Claude: el navegador no puede llamar a la API de
    # Anthropic por CORS, asi que el servidor reenvia (la key queda local).
    api_key: str = Field(..., min_length=1, max_length=400)
    model: str = Field(..., min_length=1, max_length=120)
    messages: List[Dict[str, Any]]
    system: Optional[str] = None
    tools: Optional[List[Dict[str, Any]]] = None
    max_tokens: int = 4096
    temperature: float = 0.15


class OpenSeesPayload(BaseModel):
    # Verificacion cruzada con OpenSees (v1.26.0): el frontend arma de forma
    # DETERMINISTA el modelo equivalente (spec) y el servidor lo corre en el venv
    # 3.12 dedicado (openseespy es binario para 3.12; el server va en 3.13).
    spec: Dict[str, Any]
    timeout: int = 180


CREATE_NO_WINDOW = 0x08000000


def listar_procesos_etabs() -> List[Dict[str, Any]]:
    """Lista procesos ETABS.exe con su titulo de ventana.
    Un proceso sin titulo de ventana ('N/A'/'N/D') suele ser una instancia
    colgada que rompe las conexiones attach de la API."""
    salida = subprocess.check_output(
        ["tasklist", "/FI", "IMAGENAME eq ETABS.exe", "/V", "/FO", "CSV"],
        text=True,
        creationflags=CREATE_NO_WINDOW,
    )
    procesos: List[Dict[str, Any]] = []
    for fila in csv.reader(StringIO(salida)):
        if len(fila) < 2 or not fila[1].strip().isdigit():
            continue
        titulo = fila[-1].strip() if fila else ""
        procesos.append({
            "pid": int(fila[1]),
            "memoria": fila[4].strip() if len(fila) > 4 else "",
            "titulo_ventana": titulo,
            "zombie": titulo.upper() in ("N/A", "N/D", ""),
        })
    return procesos


# ============================================================
# BIBLIOTECA DE FLUJOS VALIDADOS (persistencia en disco)
# Se guarda junto a este archivo como flujos_validados.json
# ============================================================

FLOWS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flujos_validados.json")


def load_flows() -> List[Dict[str, Any]]:
    if not os.path.exists(FLOWS_FILE):
        return []
    try:
        with open(FLOWS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_flows(flows: List[Dict[str, Any]]):
    with open(FLOWS_FILE, "w", encoding="utf-8") as f:
        json.dump(flows, f, ensure_ascii=False, indent=2)


# ============================================================
# LECCIONES APRENDIDAS (errores resueltos -> memoria persistente)
# Cuando una reparacion arregla un error, el par error->solucion
# se guarda aqui y se inyecta a la IA para no repetirlo.
# ============================================================

LESSONS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lecciones_aprendidas.json")


def load_lessons() -> List[Dict[str, Any]]:
    if not os.path.exists(LESSONS_FILE):
        return []
    try:
        with open(LESSONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_lessons(lessons: List[Dict[str, Any]]):
    with open(LESSONS_FILE, "w", encoding="utf-8") as f:
        json.dump(lessons, f, ensure_ascii=False, indent=2)


# ============================================================
# REFERENCIA OFICIAL DE LA API DE ETABS
# etabs_api_reference.json se genera con build_api_reference.py
# a partir del CHM oficial de la instalacion de ETABS 22.
# ============================================================

API_REFERENCE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "etabs_api_reference.json")
_api_reference_cache: Optional[List[Dict[str, Any]]] = None

# Sinonimos espanol -> ingles para buscar en la documentacion oficial.
SYNONYMS_ES_EN = {
    "grilla": ["grid", "gridonly"],
    "grillas": ["grid", "gridonly"],
    "malla": ["grid", "mesh"],
    "ejes": ["grid", "axis"],
    "eje": ["grid", "axis"],
    "viga": ["frame", "beam"],
    "vigas": ["frame", "beam"],
    "columna": ["frame", "column"],
    "columnas": ["frame", "column"],
    "losa": ["area", "slab", "floor"],
    "losas": ["area", "slab", "floor"],
    "muro": ["wall", "area"],
    "muros": ["wall", "area"],
    "material": ["material", "propmaterial"],
    "materiales": ["material", "propmaterial"],
    "concreto": ["concrete", "material"],
    "acero": ["steel", "material"],
    "seccion": ["section", "propframe", "rectangle"],
    "secciones": ["section", "propframe"],
    "punto": ["point", "joint", "cartesian"],
    "puntos": ["point", "joint", "cartesian"],
    "nudo": ["joint", "point"],
    "nudos": ["joint", "point"],
    "apoyo": ["restraint", "support", "spring"],
    "apoyos": ["restraint", "support", "spring"],
    "empotrado": ["restraint", "fixed"],
    "carga": ["load", "pattern", "case"],
    "cargas": ["load", "pattern", "case"],
    "sismo": ["seismic", "response", "spectrum"],
    "viento": ["wind", "load"],
    "piso": ["story", "storys"],
    "pisos": ["story", "storys"],
    "nivel": ["story", "level"],
    "niveles": ["story", "level"],
    "altura": ["height", "story"],
    "unidades": ["units", "presentunits"],
    "modelo": ["model", "file", "new"],
    "nuevo": ["new", "initialize"],
    "crear": ["new", "add", "set", "create"],
    "dibujar": ["add", "draw", "bycoord"],
    "guardar": ["save", "file"],
    "abrir": ["open", "file"],
    "analisis": ["analyze", "analysis", "run"],
    "analizar": ["analyze", "run"],
    "resultados": ["results", "forces", "displacement"],
    "reaccion": ["reaction", "results"],
    "reacciones": ["reaction", "results"],
    "desplazamiento": ["displacement", "results"],
    "diafragma": ["diaphragm"],
    "combinacion": ["combo", "combination"],
    "combinaciones": ["combo", "combination"],
    "tabla": ["table", "database"],
    "tablas": ["table", "database"],
    "asignar": ["set", "assign"],
    "borrar": ["delete", "remove"],
    "eliminar": ["delete", "remove"],
    "nombre": ["name", "getname"],
    "lista": ["namelist", "getnamelist", "list"],
}

STOPWORDS = {
    "de", "la", "el", "en", "con", "los", "las", "un", "una", "unos", "unas", "y", "o", "u",
    "a", "que", "por", "para", "del", "al", "se", "su", "sus", "mi", "mis", "es", "son",
    "the", "of", "and", "or", "to", "in", "on", "for", "with", "m", "metros", "metro",
    "cada", "entre", "distancia", "distancias", "tres", "cuatro", "cinco",
}


def load_api_reference() -> List[Dict[str, Any]]:
    global _api_reference_cache
    if _api_reference_cache is None:
        try:
            with open(API_REFERENCE_FILE, "r", encoding="utf-8") as f:
                _api_reference_cache = json.load(f)
        except Exception:
            _api_reference_cache = []
    return _api_reference_cache


def expand_query_tokens(query: str) -> List[str]:
    raw = re.findall(r"[a-z0-9_áéíóúñ]+", str(query or "").lower())
    tokens: List[str] = []
    for tok in raw:
        if tok in STOPWORDS or len(tok) < 2:
            continue
        tokens.append(tok)
        for syn in SYNONYMS_ES_EN.get(tok, []):
            tokens.append(syn)
    return list(dict.fromkeys(tokens))  # unicos, en orden


def search_api_reference(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    entries = load_api_reference()
    tokens = expand_query_tokens(query)
    if not entries or not tokens:
        return []

    scored = []
    for entry in entries:
        member = entry.get("member", "").lower()
        interface = entry.get("interface", "").lower()
        title = entry.get("title", "").lower()
        body = " ".join([
            entry.get("signature", ""),
            entry.get("remarks", ""),
            entry.get("enum_members", ""),
        ]).lower()

        score = 0
        for tok in tokens:
            if member and tok == member:
                score += 50
            elif member and tok in member:
                score += 25
            if tok in interface:
                score += 10
            if tok in title:
                score += 8
            if tok in body:
                score += 3
        if score > 0:
            if entry.get("example"):
                score += 5
            if entry.get("kind") == "method":
                score += 2
            scored.append((score, entry))

    scored.sort(key=lambda pair: -pair[0])
    results = []
    for score, entry in scored[:limit]:
        results.append({
            "score": score,
            "kind": entry.get("kind"),
            "title": entry.get("title"),
            "interface": entry.get("interface", ""),
            "member": entry.get("member", ""),
            "params": (entry.get("params") or [])[:14],
            "signature": entry.get("signature", "")[:900],
            "remarks": entry.get("remarks", "")[:500],
            "example": entry.get("example", "")[:900],
            "enum_members": entry.get("enum_members", "")[:600],
        })
    return results


# ------------------------------------------------------------
# VALIDACION DE METODOS CONTRA LA API REAL (anti-alucinacion)
# Atrapa metodos inventados (ej. SetGridLine) ANTES de ejecutar,
# comparando contra los 1529 miembros reales del CHM oficial.
# ------------------------------------------------------------
_api_member_index: Optional[Dict[str, str]] = None


def normalize_member(name: str) -> str:
    # Quita el sufijo de sobrecarga (_1, _2...) y pasa a minusculas.
    return re.sub(r"_\d+$", "", str(name or "")).lower()


def build_member_index() -> Dict[str, str]:
    """Mapa normalizado -> nombre original de TODOS los miembros de la API."""
    global _api_member_index
    if _api_member_index is None:
        index: Dict[str, str] = {}
        for entry in load_api_reference():
            member = entry.get("member")
            if member:
                index.setdefault(normalize_member(member), member)
        _api_member_index = index
    return _api_member_index


def validate_api_methods(code: str) -> List[str]:
    """
    Detecta llamadas a metodos en estilo API de ETABS (PascalCase) que NO
    existen en la documentacion oficial. Conservador: solo marca metodos que
    empiezan en mayuscula (la API CSi es toda PascalCase); los metodos de
    Python (.append, .strip, etc.) van en minuscula y se ignoran.
    """
    valid = build_member_index()
    if not valid:
        return []  # sin base de datos no validamos
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []  # el error de sintaxis se reporta por otro camino

    issues: Dict[str, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        name = node.func.attr
        if not name or name.startswith("_") or not name[0].isupper():
            continue
        if normalize_member(name) in valid:
            continue
        sugeridos = difflib.get_close_matches(normalize_member(name), list(valid.keys()), n=3, cutoff=0.72)
        sugerencia = ", ".join(sorted({valid[s] for s in sugeridos})) if sugeridos else ""
        mensaje = f"El metodo '{name}' no existe en la API de ETABS."
        if sugerencia:
            mensaje += f" Metodos parecidos que SI existen: {sugerencia}."
        issues[name] = mensaje
    return list(issues.values())


def detect_crash_patterns(code: str) -> List[str]:
    """
    Patrones que CRASHEAN el proceso de ETABS (verificado empiricamente):
    NewGridOnly con un modelo ya creado (p.ej. tras NewBlank) mata ETABS
    con error RPC, sin codigo de retorno. Mejor bloquear antes.
    """
    issues: List[str] = []
    text = str(code or "")
    if re.search(r"\.NewBlank\s*\(", text) and re.search(r"\.NewGridOnly\s*\(", text):
        issues.append(
            "El codigo llama NewBlank y NewGridOnly en el mismo script. NewGridOnly con un "
            "modelo ya creado CRASHEA el proceso de ETABS (error RPC). Usa SOLO UNO: "
            "NewGridOnly para modelo nuevo con grilla, o NewBlank para modelo vacio."
        )
    return issues


@contextmanager
def com_apartment():
    """
    Inicializa COM en el hilo actual y solo desinicializa si nosotros lo
    inicializamos. Si COM ya estaba inicializado en otro modo, comtypes lanza
    una excepcion (RPC_E_CHANGED_MODE); en ese caso NO debemos llamar a
    CoUninitialize para no desbalancear el conteo COM.
    """
    initialized_here = False
    try:
        comtypes.CoInitialize()
        initialized_here = True
    except OSError:
        # COM ya estaba inicializado en este hilo (p. ej. modo distinto).
        initialized_here = False
    try:
        yield
    finally:
        if initialized_here:
            try:
                comtypes.CoUninitialize()
            except Exception:
                pass


@contextmanager
def capture_output():
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    out = io.StringIO()
    err = io.StringIO()

    try:
        sys.stdout = out
        sys.stderr = err
        yield out, err
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr


def ok_response(output: str = "", **extra):
    return {"success": True, "ok": True, "output": output, **extra}


def error_response(message: str, **extra):
    return {"success": False, "ok": False, "error": message, **extra}


def normalize_payload_options(payload: ExecutePayload):
    """
    Permite entender el formato nuevo:
      connection_mode / model_mode

    y tambien el formato antiguo:
      options.sessionMode
    """
    connection_mode = payload.connection_mode
    model_mode = payload.model_mode
    model_path = payload.model_path
    units = payload.units

    options = payload.options or {}
    session_mode = options.get("sessionMode")

    if not connection_mode or not model_mode:
        if session_mode == "attach_or_start_new_model":
            connection_mode = "attach_or_start"
            model_mode = "new_blank"
        elif session_mode == "start_new_instance_new_model":
            connection_mode = "start"
            model_mode = "new_blank"
        elif session_mode == "attach_existing_new_model":
            connection_mode = "attach"
            model_mode = "new_blank"
        elif session_mode == "feed_current_model":
            connection_mode = "attach"
            model_mode = "keep_current"
        elif session_mode == "open_file_then_modify":
            connection_mode = "attach_or_start"
            model_mode = "open_file"
        else:
            connection_mode = connection_mode or "attach_or_start"
            model_mode = model_mode or "new_blank"

    if not model_path:
        model_path = options.get("modelFilePath") or None

    if units is None:
        try:
            units = int(options.get("selectedUnits", 6))
        except Exception:
            units = 6

    payload.connection_mode = connection_mode
    payload.model_mode = model_mode
    payload.model_path = model_path
    payload.units = units
    return payload


def extract_ret(value):
    """
    Extrae codigo ret de ETABS.
    En CSi API, ret=0 suele indicar exito.
    En Python COM, puede venir como int, tuple o None.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, tuple):
        int_values = [item for item in value if isinstance(item, int) and not isinstance(item, bool)]
        if int_values:
            # Muchas llamadas COM devuelven ret al final.
            return int_values[-1]
    return None


def check_ret(value, action: str = "Operacion ETABS"):
    ret = extract_ret(value)
    if ret is not None and ret != 0:
        raise RuntimeError(f"{action} fallo. Codigo ret={ret}. Valor devuelto={repr(value)}")
    if ret is None:
        print(f"[OK] {action}: sin codigo ret verificable")
    else:
        print(f"[OK] {action}: ret={ret}")
    return value


def safe_print_ret(value, action: str = "Operacion ETABS"):
    ret = extract_ret(value)
    print(f"{action}: ret={ret}, valor={repr(value)}")
    return value


def create_etabs_helper():
    try:
        return comtypes.client.CreateObject("ETABSv1.Helper")
    except Exception as e:
        raise RuntimeError(
            "No se pudo crear ETABSv1.Helper. Verifica que ETABS este instalado, "
            "que la API este registrada y que Python tenga la misma arquitectura que ETABS, normalmente 64 bits."
        ) from e


def attach_to_running_etabs():
    helper = create_etabs_helper()
    try:
        etabs_object = helper.GetObject("CSI.ETABS.API.ETABSObject")
        sap_model = etabs_object.SapModel
        return etabs_object, sap_model
    except Exception as e:
        raise RuntimeError(
            "No se pudo conectar a una instancia abierta de ETABS. "
            "Abre ETABS primero o usa connection_mode='attach_or_start'."
        ) from e


def wait_for_sap_model(etabs_object, timeout: float = 30.0, interval: float = 0.5):
    """
    ETABS necesita unos segundos tras ApplicationStart antes de que SapModel
    este realmente disponible. Reintentamos hasta timeout segundos.
    """
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            sap_model = etabs_object.SapModel
            if sap_model is not None:
                return sap_model
        except Exception as e:
            last_error = e
        time.sleep(interval)
    raise RuntimeError(
        f"ETABS arranco pero SapModel no estuvo disponible en {timeout}s. "
        f"Ultimo error: {last_error}"
    )


def start_new_etabs_instance():
    helper = create_etabs_helper()
    try:
        etabs_object = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
        ret = etabs_object.ApplicationStart()
        sap_model = wait_for_sap_model(etabs_object)
        return etabs_object, sap_model, ret
    except Exception as e:
        raise RuntimeError(
            "No se pudo iniciar ETABS desde la API. Verifica licencia, instalacion y permisos de Windows."
        ) from e


def get_etabs(connection_mode: ConnectionMode):
    if connection_mode == "attach":
        etabs_object, sap_model = attach_to_running_etabs()
        return etabs_object, sap_model, "attached"

    if connection_mode == "start":
        etabs_object, sap_model, ret = start_new_etabs_instance()
        return etabs_object, sap_model, f"started | ApplicationStart ret={ret}"

    if connection_mode == "attach_or_start":
        try:
            etabs_object, sap_model = attach_to_running_etabs()
            return etabs_object, sap_model, "attached"
        except Exception as attach_error:
            etabs_object, sap_model, ret = start_new_etabs_instance()
            return etabs_object, sap_model, f"started_after_attach_failed | ApplicationStart ret={ret} | attach_error={attach_error}"

    raise ValueError(f"connection_mode no reconocido: {connection_mode}")


DANGEROUS_NAMES = {
    "open", "exec", "eval", "compile", "input", "__import__",
    "globals", "locals", "vars", "dir", "getattr", "setattr", "delattr",
    "exit", "quit", "help",
}

DANGEROUS_MODULES = {
    "os", "sys", "subprocess", "socket", "requests", "urllib",
    "pathlib", "shutil", "ctypes", "multiprocessing", "threading",
    "builtins", "inspect", "importlib", "pickle", "marshal",
}

DANGEROUS_ATTRS = {
    "__class__", "__dict__", "__mro__", "__subclasses__", "__globals__",
    "__code__", "__closure__", "__func__", "__self__", "__module__",
    "__getattribute__", "__setattr__", "__delattr__",
}


def validate_code_safety(code: str) -> List[str]:
    issues: List[str] = []
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"SyntaxError: {e}"]

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            issues.append("No se permite usar import en codigo generado por IA. Usa solo SapModel y utilidades permitidas.")

        if isinstance(node, ast.Name):
            if node.id in DANGEROUS_MODULES:
                issues.append(f"No se permite usar el modulo o nombre peligroso: {node.id}")
            if node.id in DANGEROUS_NAMES:
                issues.append(f"No se permite usar la funcion peligrosa: {node.id}")

        if isinstance(node, ast.Attribute):
            # Bloqueamos solo dunders peligrosos conocidos (escape de sandbox),
            # no cualquier atributo con doble guion bajo.
            if node.attr in DANGEROUS_ATTRS:
                issues.append(f"No se permite acceder al atributo especial: {node.attr}")

        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in DANGEROUS_NAMES:
                issues.append(f"Llamada bloqueada: {node.func.id}()")

    return sorted(set(issues))


def static_etabs_warnings(code: str) -> List[str]:
    warnings: List[str] = []
    text = str(code or "")
    lower = text.lower()

    if "setpresentunits(12" in lower and ("kn" in lower or "kN" in text):
        warnings.append("Posible error de unidades: SetPresentUnits(12) es Ton_m_C, no kN_m_C. Para kN_m_C usa 6.")

    if "ret[0]" in lower:
        warnings.append("Evita ret[0]. Pasa la tupla completa a check_ret(ret, ...).")

    if "setgridlines" in lower:
        warnings.append("SetGridLines puede no existir en tu version de ETABS API. Validar antes de usar.")

    if "setgridsys" in lower and ("is_cartesian" in lower or "xnames" in lower or "ynames" in lower or "numx" in lower):
        warnings.append("SetGridSys parece estar usando firma inventada. En ETABS API 2016 usa SetGridSys(Name, x, y, RZ).")

    return sorted(set(warnings))


def prepare_model(sap_model, payload: ExecutePayload):
    code_text = payload.code or ""

    if payload.model_mode == "keep_current":
        return "current model kept"

    if payload.model_mode == "new_blank":
        if payload.units is None:
            ret_init = sap_model.InitializeNewModel()
        else:
            ret_init = sap_model.InitializeNewModel(payload.units)
        check_ret(ret_init, "Inicializar modelo nuevo")

        # Si el codigo usa NewGridOnly, no ejecutar NewBlank antes.
        # NewGridOnly ya crea el modelo desde plantilla de grilla.
        if "NewGridOnly" in code_text:
            return "model initialized only | NewGridOnly will create grid template"

        ret_blank = sap_model.File.NewBlank()
        check_ret(ret_blank, "Crear modelo en blanco")
        return "new blank model created"

    if payload.model_mode == "open_file":
        if not payload.model_path:
            raise ValueError("model_path es obligatorio cuando model_mode='open_file'.")
        ret_open = sap_model.File.OpenFile(payload.model_path)
        check_ret(ret_open, f"Abrir archivo EDB: {payload.model_path}")
        return f"file opened | path={payload.model_path}"

    raise ValueError(f"model_mode no reconocido: {payload.model_mode}")


def build_exec_environment(sap_model, etabs_object, variables: Dict[str, Any]):
    safe_builtins = {
        "print": print,
        "len": len,
        "range": range,
        "enumerate": enumerate,
        "zip": zip,
        "min": min,
        "max": max,
        "sum": sum,
        "abs": abs,
        "round": round,
        "int": int,
        "float": float,
        "str": str,
        "bool": bool,
        "list": list,
        "dict": dict,
        "tuple": tuple,
        "set": set,
        "isinstance": isinstance,
        "Exception": Exception,
        "ValueError": ValueError,
        "TypeError": TypeError,
        "RuntimeError": RuntimeError,
    }

    env = {
        "__builtins__": safe_builtins,
        "SapModel": sap_model,
        "ETABSObject": etabs_object,
        "EtabsObject": etabs_object,
        "math": math,
        "json": json,
        "extract_ret": extract_ret,
        "check_ret": check_ret,
        "safe_print_ret": safe_print_ret,
        "INPUT": variables or {},
    }
    return env


def run_raw_script(code: str, work_dir: Optional[str] = None):
    """
    Ejecuta el codigo TAL CUAL, como si fuese un script lanzado desde cmd:
      - Se permite import, CreateObject, ApplicationStart, etc.
      - Se ejecuta con __name__ == "__main__" para que corra el bloque
        if __name__ == "__main__": main()
      - __file__ apunta a un archivo real, por lo que Path(__file__).parent
        funciona (las rutas relativas del script se resuelven respecto a el).

    Se escribe el codigo en un archivo .py temporal y se ejecuta con
    runpy.run_path. Si work_dir es valido, el archivo se crea ahi para que
    las rutas relativas del script caigan donde el usuario espera.
    """
    target_dir = None
    if work_dir:
        candidate = work_dir
        # Si es un archivo (p. ej. una ruta .edb o .py), usar su carpeta.
        if os.path.splitext(candidate)[1]:
            candidate = os.path.dirname(candidate)
        if candidate and os.path.isdir(candidate):
            target_dir = candidate

    if target_dir is None:
        target_dir = tempfile.mkdtemp(prefix="etabs_script_")

    script_path = os.path.join(target_dir, "etabs_script_temp.py")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(code)

    previous_cwd = os.getcwd()
    try:
        os.chdir(target_dir)
        runpy.run_path(script_path, run_name="__main__")
    finally:
        os.chdir(previous_cwd)

    return script_path


@app.get("/")
def root():
    return {
        "success": True,
        "ok": True,
        "name": "ETABS AI Bridge",
        "version": "3.1.0",
        "endpoints": ["/status", "/preflight", "/etabs/ping", "/execute-etabs", "/flujos", "/api-docs/search", "/etabs/processes", "/etabs/cleanup"]
    }


def desanidar_com(resultado):
    """comtypes envuelve las salidas ByRef en una lista anidada: desenvolver."""
    partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
        partes = list(partes[0])
    return partes


def attach_etabs_por_pid(helper, pid: int = 0):
    """Adjunta a una instancia ETABS concreta por PID (cHelper.GetObjectProcess)
    si pid>0; si no, a la instancia registrada (GetObject). Validado en vivo:
    permite elegir entre varios ETABS abiertos."""
    try:
        if pid and int(pid) > 0:
            return helper.GetObjectProcess("CSI.ETABS.API.ETABSObject", int(pid))
        return helper.GetObject("CSI.ETABS.API.ETABSObject")
    except Exception:
        return None


# --- Helpers e inventario compartido por model-summary y diagnostico -------
def _nombres(obj):
    """Lista de nombres de un objeto CSi via GetNameList (desanidado)."""
    try:
        r = desanidar_com(obj.GetNameList(0, []))
        return [str(x) for parte in r if isinstance(parte, (list, tuple)) for x in parte]
    except Exception:
        return []


def _ret_de(p):
    """El codigo ret es el ULTIMO entero (las salidas traen enums/Color antes)."""
    ints = [x for x in p if isinstance(x, int) and not isinstance(x, bool)]
    return ints[-1] if ints else -1


def _floats_de(p):
    """Floats de un resultado desanidado, EN ORDEN (los bool no son floats)."""
    return [x for x in p if isinstance(x, float)]


# Defaults de ETABS que NO cuentan como definidos por el usuario.
MAT_DEFAULT = {"4000Psi", "A992Fy50", "A615Gr60", "A416Gr270", "A572Gr50", "A53GrB"}
SEC_DEFAULT = {"ConcCol", "ConcBm", "SteelCol", "SteelBm"}
SLAB_DEFAULT = {"Slab1", "Deck1", "Wall1", "Plank1"}
PAT_DEFAULT = {"Dead", "Live"}

# eMatType de CSi (validado en vivo: 2=concreto, 6=rebar; resto = estandar CSi).
TIPOS_MATERIAL = {1: "Acero estructural", 2: "Concreto", 3: "Sin diseño",
                  4: "Aluminio", 5: "Conformado en frío", 6: "Acero de refuerzo",
                  7: "Tendón (preesforzado)", 8: "Albañilería"}
TIPOS_PATRON = {1: "Muerta", 2: "SuperDead", 3: "Viva", 4: "Viva reducible",
                5: "Sismo", 6: "Viento", 7: "Nieve", 8: "Otra", 11: "Viva techo"}
TIPOS_CASO = {1: "Estatico lineal", 2: "Estatico no lineal", 3: "Modal",
              4: "Espectro de respuesta", 5: "Tiempo-historia lineal",
              6: "Tiempo-historia no lineal", 7: "Dinamico lineal",
              8: "Dinamico no lineal", 9: "Carga movil", 10: "Pandeo",
              11: "Estado estacionario", 12: "PSD", 13: "Estatico multipaso",
              14: "Hiperestatico"}


def extraer_inventario(sap):
    """Inventario RICO del modelo abierto, con las PROPIEDADES de cada elemento:
    materiales (concreto f'c y modulo E; acero Fy/Fu), secciones de viga y
    columna (material, base x peralte en cm), losas (tipo, espesor cm), muros
    (espesor cm), conteos, patrones (con tipo), casos (con tipo) y combinaciones
    (con formula). Las propiedades de material/seccion/losa/muro se leen en
    kgf-cm (unidades 14) -> f'c y Fy en kg/cm2, dimensiones y espesores en cm;
    se restauran las unidades previas al terminar (regla 26b)."""
    inv: Dict[str, Any] = {}

    # --- Materiales, secciones, losas y muros: leer en kgf-cm (unidades 14) ---
    try:
        unidades_prev = int(sap.GetPresentUnits())
    except Exception:
        unidades_prev = 8
    try:
        sap.SetPresentUnits(14)  # kgf_cm_C: f'c/Fy en kg/cm2, dims en cm
    except Exception:
        pass

    # Materiales: se capturan TODOS (incluidos los que trae ETABS por defecto,
    # marcados con "default": True) para que el diagnostico refleje EXACTO lo que
    # hay en el modelo. El conteo de pasos (en /diagnostico) usa solo los del
    # usuario (default=False). Concreto (tipo 2) -> f'c+E; rebar (tipo 6) ->
    # Fy/Fu; otros tipos (acero estructural, tendon, etc.) -> tipo + modulo E.
    concretos, aceros, otros_mat = [], [], []
    for m in _nombres(sap.PropMaterial):
        es_def = m in MAT_DEFAULT
        try:
            t = desanidar_com(sap.PropMaterial.GetTypeOAPI(m, 0, 0))
            tipo = next((x for x in t if isinstance(x, int) and not isinstance(x, bool)), None)
        except Exception:
            tipo = None
        if tipo == 2:  # concreto
            fc = modulo = None
            try:
                oc = desanidar_com(sap.PropMaterial.GetOConcrete_1(
                    m, 0.0, False, 0.0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
                fs = _floats_de(oc)
                fc = round(fs[0], 2) if fs else None
            except Exception:
                pass
            try:
                mp = desanidar_com(sap.PropMaterial.GetMPIsotropic(m, 0.0, 0.0, 0.0, 0.0, 0.0))
                fs = _floats_de(mp)
                modulo = round(fs[0], 2) if fs else None
            except Exception:
                pass
            concretos.append({"nombre": m, "fc": fc, "modulo": modulo, "default": es_def})
        elif tipo == 6:  # acero de refuerzo
            fy = fu = None
            try:
                orb = desanidar_com(sap.PropMaterial.GetORebar_1(
                    m, 0.0, 0.0, 0.0, 0.0, 0, 0, 0.0, 0.0, 0.0, False, 0.0))
                fs = _floats_de(orb)
                if len(fs) >= 2:
                    fy, fu = round(fs[0], 2), round(fs[1], 2)
            except Exception:
                pass
            aceros.append({"nombre": m, "fy": fy, "fu": fu, "default": es_def})
        else:  # acero estructural, tendon, albanileria, aluminio, etc.
            modulo = None
            try:
                mp = desanidar_com(sap.PropMaterial.GetMPIsotropic(m, 0.0, 0.0, 0.0, 0.0, 0.0))
                fs = _floats_de(mp)
                modulo = round(fs[0], 2) if fs else None
            except Exception:
                pass
            otros_mat.append({"nombre": m, "tipo": TIPOS_MATERIAL.get(tipo, f"tipo {tipo}"),
                              "modulo": modulo, "default": es_def})

    # Secciones frame: solo RECTANGULARES de CONCRETO (este filtro excluye el
    # catalogo de perfiles de acero W/HSS, que NO es informacion del modelo sino
    # un catalogo). Las secciones por defecto (ConcCol/ConcBm) SI se muestran,
    # marcadas con "default": True. base x peralte en cm.
    mats_concreto = {c["nombre"] for c in concretos} | {"4000Psi"}
    vigas_sec, col_sec = [], []
    for s in _nombres(sap.PropFrame):
        try:
            gr = desanidar_com(sap.PropFrame.GetRectangle(s, "", "", 0.0, 0.0, 0, "", ""))
            if _ret_de(gr) != 0:
                continue  # no es rectangular (perfil de acero, etc.)
        except Exception:
            continue
        strs = [x for x in gr if isinstance(x, str)]
        mat = strs[1] if len(strs) >= 2 else (strs[0] if strs else "")
        if mat not in mats_concreto:
            continue  # rectangular pero no de concreto
        fs = _floats_de(gr)  # [T3=peralte, T2=base]
        item = {"nombre": s, "material": mat,
                "peralte": round(fs[0], 1) if len(fs) >= 1 else None,
                "base": round(fs[1], 1) if len(fs) >= 2 else None,
                "default": s in SEC_DEFAULT}
        # Clasificar por el TIPO de refuerzo: GetTypeRebar MyType
        # (1 = columna P-M2-M3, 2 = viga M3 only). GetRebarColumn/Beam dan
        # ret=0 para ambos, asi que NO sirven para discriminar.
        try:
            tr = desanidar_com(sap.PropFrame.GetTypeRebar(s, 0))
            ints = [x for x in tr if isinstance(x, int) and not isinstance(x, bool)]
            mytype = ints[0] if ints else 0
        except Exception:
            mytype = 0
        (col_sec if mytype == 1 else vigas_sec).append(item)

    # Propiedades de area: losas (0=maciza,3=1D,4=2D) y muros. Las propiedades
    # por defecto (Slab1/Deck1/Wall1/Plank1) SI se muestran, marcadas con
    # "default": True.
    losa_m, losa1, losa2, muros = [], [], [], []
    for a in _nombres(sap.PropArea):
        es_def_a = a in SLAB_DEFAULT
        try:
            rw = desanidar_com(sap.PropArea.GetWall(a, 0, 0, "", 0.0, 0, "", ""))
            if _ret_de(rw) == 0:
                strs = [x for x in rw if isinstance(x, str) and x]
                fs = _floats_de(rw)
                muros.append({"nombre": a, "material": strs[0] if strs else "",
                              "espesor": round(fs[0], 1) if fs else None, "default": es_def_a})
                continue
        except Exception:
            pass
        try:
            rs = desanidar_com(sap.PropArea.GetSlab(a, 0, 0, "", 0.0, 0, "", ""))
            if _ret_de(rs) == 0:
                st = rs[0] if isinstance(rs[0], int) else 0   # eSlabType
                strs = [x for x in rs if isinstance(x, str) and x]
                fs = _floats_de(rs)
                # Maciza: el Thickness de GetSlab ES el peralte. Nervada/waffle:
                # GetSlab.Thickness es la LOSITA superior -> el peralte total esta
                # en GetSlabRibbed/Waffle.OverallDepth (primer float).
                espesor = round(fs[0], 1) if fs else None
                if st == 3:
                    try:
                        rr = desanidar_com(sap.PropArea.GetSlabRibbed(a, 0.0, 0.0, 0.0, 0.0, 0.0, 0))
                        ff = _floats_de(rr)
                        if ff:
                            espesor = round(ff[0], 1)
                    except Exception:
                        pass
                elif st == 4:
                    try:
                        rr = desanidar_com(sap.PropArea.GetSlabWaffle(a, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
                        ff = _floats_de(rr)
                        if ff:
                            espesor = round(ff[0], 1)
                    except Exception:
                        pass
                tipo = {3: "Aligerada 1D (nervada)", 4: "Aligerada 2D (waffle)"}.get(st, "Maciza")
                # ShellType (modelado del area): 1=Shell-thin, 2=Shell-thick, 3=Membrana,
                # 4=Plate-thin, 5=Plate-thick, 6=Layered. Es el 2do entero de GetSlab.
                ints_slab = [x for x in rs if isinstance(x, int) and not isinstance(x, bool)]
                shell_n = ints_slab[1] if len(ints_slab) >= 2 else None
                shell = {1: "Shell-thin", 2: "Shell-thick", 3: "Membrana",
                         4: "Plate-thin", 5: "Plate-thick", 6: "Layered"}.get(shell_n, f"tipo {shell_n}")
                item = {"nombre": a, "material": strs[0] if strs else "",
                        "espesor": espesor, "tipo": tipo, "shell": shell, "shell_n": shell_n,
                        "default": es_def_a}
                (losa1 if st == 3 else losa2 if st == 4 else losa_m).append(item)
        except Exception:
            pass

    try:
        sap.SetPresentUnits(unidades_prev or 8)
    except Exception:
        pass

    # --- Conteos de objetos dibujados ---
    def _conteo(obj):
        try:
            r = desanidar_com(obj.GetNameList(0, []))
            return r[0] if r and isinstance(r[0], int) else 0
        except Exception:
            return 0

    # --- Patrones / casos / combos con detalle (independiente de unidades) ---
    patrones = []
    for p in _nombres(sap.LoadPatterns):
        es_def_p = p in PAT_DEFAULT
        try:
            t = desanidar_com(sap.LoadPatterns.GetLoadType(p, 0))
            tn = next((x for x in t if isinstance(x, int) and not isinstance(x, bool)), None)
            patrones.append({"nombre": p, "tipo": TIPOS_PATRON.get(tn, f"tipo {tn}"), "default": es_def_p})
        except Exception:
            patrones.append({"nombre": p, "tipo": "?", "default": es_def_p})

    casos = []
    for c in _nombres(sap.LoadCases):
        try:
            t = desanidar_com(sap.LoadCases.GetTypeOAPI(c, 0, 0))
            tn = next((x for x in t if isinstance(x, int) and not isinstance(x, bool)), None)
            casos.append({"nombre": c, "tipo": TIPOS_CASO.get(tn, f"tipo {tn}")})
        except Exception:
            casos.append({"nombre": c, "tipo": "?"})

    combos = []
    for c in _nombres(sap.RespCombo):
        try:
            cl = desanidar_com(sap.RespCombo.GetCaseList(c, 0, [], [], []))
            listas = [pp for pp in cl if isinstance(pp, (list, tuple))]
            nombres_c = [str(x) for x in listas[1]] if len(listas) > 1 else []
            factores = [float(x) for x in listas[2]] if len(listas) > 2 else []
            formula = " + ".join(f"{f:g}*{n}" for n, f in zip(nombres_c, factores))
            combos.append({"nombre": c, "formula": formula})
        except Exception:
            combos.append({"nombre": c, "formula": "?"})

    inv.update({
        "concretos": concretos, "aceros": aceros, "otros_materiales": otros_mat,
        "secciones_viga": vigas_sec, "secciones_columna": col_sec,
        "losas_maciza": losa_m, "losas_1d": losa1, "losas_2d": losa2, "muros": muros,
        "num_frames": _conteo(sap.FrameObj), "num_areas": _conteo(sap.AreaObj),
        "num_puntos": _conteo(sap.PointObj),
        "patrones": patrones, "casos": casos, "combinaciones": combos,
    })
    return inv


def extraer_geometria(sap):
    """Lee el sistema de GRILLA (ejes X/Y) y los PISOS (base, nombres,
    elevaciones). Fuerza kgf-m (unidad 8) para que ordenadas y elevaciones
    salgan en METROS y restaura las unidades previas. Compartido por
    model-summary y diagnostico."""
    geo: Dict[str, Any] = {}
    try:
        unidades_prev = int(sap.GetPresentUnits())
    except Exception:
        unidades_prev = 8
    try:
        sap.SetPresentUnits(8)  # kgf_m_C: ordenadas/elevaciones en metros
    except Exception:
        pass
    try:
        res = desanidar_com(sap.Story.GetStories_2(0.0, 0, [], [], [], [], [], [], [], []))
        geo["base_z"] = float(res[0])
        geo["pisos"] = [str(x) for x in res[2]]
        geo["elevaciones"] = [float(x) for x in res[3]]
    except Exception:
        geo["pisos"] = []
        geo["elevaciones"] = []
    try:
        partes = desanidar_com(sap.DatabaseTables.GetTableForEditingArray("Grid Definitions - Grid Lines", "", 0, [], 0, []))
        campos = [str(c) for c in partes[1]]
        datos = [str(d) for d in partes[3]]
        n = len(campos)
        filas = [datos[i * n:(i + 1) * n] for i in range(partes[2])]
        idx_t = next(i for i, c in enumerate(campos) if "linetype" in c.lower())
        idx_o = next(i for i, c in enumerate(campos) if "ordinate" in c.lower())
        geo["grilla_x"] = sorted(float(f[idx_o]) for f in filas if f[idx_t].upper().startswith("X"))
        geo["grilla_y"] = sorted(float(f[idx_o]) for f in filas if f[idx_t].upper().startswith("Y"))
    except Exception:
        geo["grilla_x"] = []
        geo["grilla_y"] = []
    try:
        sap.SetPresentUnits(unidades_prev or 8)
    except Exception:
        pass
    return geo


@app.get("/etabs/modelo-geometria")
def etabs_modelo_geometria(pid: int = 0):
    """Lee la GEOMETRIA del modelo abierto para el MODELADOR: frames (clasificados
    columna/viga) y areas (losa/muro) con sus COORDENADAS en metros, seccion y nivel,
    mas la grilla y los pisos. Asi el Modelador refleja lo que YA hay en ETABS, en vez
    del dibujo local. (v3.21.7). pid: instancia ETABS concreta (0 = la registrada).
    Validado en vivo: 260 frames (100 col + 160 vigas) + 64 losas de Proyecto2."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            if sap.GetModelFilename() is None:
                return error_response("Instancia de ETABS colgada (fantasma). Cierra procesos y reabre.")

            def listar(x):
                return list(x) if isinstance(x, (list, tuple)) else []

            geo = extraer_geometria(sap)  # grilla + pisos (gestiona sus unidades)
            base_z = float(geo.get("base_z", 0.0) or 0.0)
            elevaciones = [float(z) for z in geo.get("elevaciones", [])]
            niveles = sorted(set([base_z] + elevaciones))

            def nivel_de(z):
                return min(range(len(niveles)), key=lambda i: abs(niveles[i] - z)) if niveles else 0

            try:
                sap.SetPresentUnits(8)  # kgf, m -> coordenadas en metros
            except Exception:
                pass

            cache: Dict[str, tuple] = {}
            def coord(pt):
                if pt not in cache:
                    r = desanidar_com(sap.PointObj.GetCoordCartesian(pt, 0.0, 0.0, 0.0))
                    cache[pt] = (round(float(r[0]), 4), round(float(r[1]), 4), round(float(r[2]), 4))
                return cache[pt]

            TOL = 0.05
            elementos: List[Dict[str, Any]] = []
            # FRAMES -> columna (vertical) / viga (horizontal).
            fn = desanidar_com(sap.FrameObj.GetNameList())
            for nm in (listar(fn[1]) if len(fn) > 1 else []):
                try:
                    gp = desanidar_com(sap.FrameObj.GetPoints(nm, "", ""))
                    c1, c2 = coord(str(gp[0])), coord(str(gp[1]))
                    sec = str(desanidar_com(sap.FrameObj.GetSection(nm, ""))[0])
                    vertical = (abs(c1[0] - c2[0]) < TOL and abs(c1[1] - c2[1]) < TOL
                                and abs(c1[2] - c2[2]) > TOL)
                    if vertical:
                        zb, zt = min(c1[2], c2[2]), max(c1[2], c2[2])
                        elementos.append({"tipo": "columna", "name": str(nm), "x": c1[0], "y": c1[1],
                                          "zBot": zb, "zTop": zt, "nivel": nivel_de(zt), "sec": sec})
                    else:
                        z = round((c1[2] + c2[2]) / 2, 4)
                        elementos.append({"tipo": "viga", "name": str(nm), "x1": c1[0], "y1": c1[1],
                                          "x2": c2[0], "y2": c2[1], "z": z, "nivel": nivel_de(z), "sec": sec})
                except Exception:
                    continue
            # AREAS -> losa (horizontal) / muro (panel vertical).
            an = desanidar_com(sap.AreaObj.GetNameList())
            for nm in (listar(an[1]) if len(an) > 1 else []):
                try:
                    gp = desanidar_com(sap.AreaObj.GetPoints(nm, 0, []))
                    pts = [coord(str(p)) for p in listar(gp[1])]
                    if len(pts) < 3:
                        continue
                    sec = str(desanidar_com(sap.AreaObj.GetProperty(nm, ""))[0])
                    zs = [p[2] for p in pts]
                    if (max(zs) - min(zs)) > TOL:
                        zb, zt = min(zs), max(zs)
                        base = [p for p in pts if abs(p[2] - zb) < TOL]
                        if len(base) >= 2:
                            elementos.append({"tipo": "muro", "name": str(nm), "x1": base[0][0], "y1": base[0][1],
                                              "x2": base[1][0], "y2": base[1][1],
                                              "zBot": zb, "zTop": zt, "nivel": nivel_de(zt), "sec": sec})
                    else:
                        z = round(sum(zs) / len(zs), 4)
                        elementos.append({"tipo": "losa", "name": str(nm),
                                          "pts": [{"x": p[0], "y": p[1]} for p in pts],
                                          "z": z, "nivel": nivel_de(z), "sec": sec})
                except Exception:
                    continue

            conteo = {t: sum(1 for e in elementos if e["tipo"] == t)
                      for t in ("columna", "viga", "losa", "muro")}
            return {"success": True, "ok": True,
                    "grilla_x": geo.get("grilla_x", []), "grilla_y": geo.get("grilla_y", []),
                    "base_z": base_z, "elevaciones": elevaciones, "pisos": geo.get("pisos", []),
                    "niveles": niveles, "elementos": elementos, "conteo": conteo}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


def leer_masas_por_piso(sap):
    """Masa por piso de la tabla 'Mass Summary by Story' (requiere el modelo analizado).
    En kN-m la masa (UX/UY) sale en tonne (= ton metrica, comparable con OpenSees).
    Devuelve [] si no esta disponible."""
    try:
        prev = int(sap.GetPresentUnits())
    except Exception:
        prev = 8
    out = []
    try:
        sap.SetPresentUnits(6)  # kN, m, C -> masa en tonne (Mg)
        db = sap.DatabaseTables
        r = desanidar_com(db.GetTableForDisplayArray(
            "Mass Summary by Story", [], "", 0, [], 0, []))
        listas = [p for p in r if isinstance(p, (list, tuple))]
        if len(listas) < 2:
            return []
        campos = [str(c) for c in listas[-2]]
        datos = [str(d) for d in listas[-1]]
        nc = len(campos)
        if nc == 0 or campos == ["None"]:
            return []
        idx = {c.lower(): i for i, c in enumerate(campos)}

        def col(*subs):
            for k, i in idx.items():
                if any(s in k for s in subs):
                    return i
            return None

        i_story = col("story", "label")
        i_mx = col("ux", "massx", "mass x")
        i_my = col("uy", "massy", "mass y")
        i_mmi = col("mmi", "rz", "moment")
        filas = [datos[k * nc:(k + 1) * nc] for k in range(len(datos) // nc)]
        for f in filas:
            try:
                def num(i):
                    return float(f[i]) if i is not None and i < len(f) and f[i] not in ("", None) else 0.0
                out.append({"piso": f[i_story] if i_story is not None else "?",
                            "masa_x": round(num(i_mx), 2), "masa_y": round(num(i_my), 2),
                            "mmi": round(num(i_mmi), 1)})
            except Exception:
                continue
    except Exception:
        out = []
    finally:
        try:
            sap.SetPresentUnits(prev)
        except Exception:
            pass
    return out


def leer_max_avg_drifts(sap, casos=None):
    """Lee la tabla 'Story Max Over Avg Drifts' (razon Delta_max / Delta_prom de la
    deriva de entrepiso en los EXTREMOS, por piso/caso/direccion X-Y) — la base de la
    irregularidad TORSIONAL E.030. Requiere el modelo ANALIZADO. Columnas validadas en
    vivo (ETABS 22): Story, OutputCase, CaseType, StepType, StepNumber, StepLabel,
    Direction, Max Drift, Avg Drift, Ratio. Devuelve [] si no hay datos.
    `casos` (lista) selecciona que casos/combos incluye la tabla."""
    out = []
    try:
        db = sap.DatabaseTables
        if casos:
            try:
                db.SetLoadCasesSelectedForDisplay([str(c) for c in casos])
            except Exception:
                pass
        r = desanidar_com(db.GetTableForDisplayArray(
            "Story Max Over Avg Drifts", [], "", 0, [], 0, []))
        listas = [p for p in r if isinstance(p, (list, tuple))]
        if len(listas) < 2:
            return []
        campos = [str(c) for c in listas[-2]]
        datos = [str(d) for d in listas[-1]]
        nc = len(campos)
        if nc == 0 or campos == ["None"]:
            return []
        idx = {c.lower(): i for i, c in enumerate(campos)}

        def col(*subs):
            for k, i in idx.items():
                if any(s in k for s in subs):
                    return i
            return None

        i_story = col("story")
        i_caso = col("outputcase", "output case")
        i_dir = col("direction")
        i_max = col("max drift", "maxdrift")
        i_avg = col("avg drift", "avgdrift")
        i_ratio = col("ratio")
        filas = [datos[k * nc:(k + 1) * nc] for k in range(len(datos) // nc)]
        for f in filas:
            def num(i):
                try:
                    return float(f[i]) if i is not None and i < len(f) and f[i] not in ("", None) else 0.0
                except Exception:
                    return 0.0

            def txt(i):
                return f[i] if i is not None and i < len(f) else ""

            out.append({"piso": txt(i_story), "caso": txt(i_caso), "dir": txt(i_dir),
                        "max_drift": round(num(i_max), 6), "avg_drift": round(num(i_avg), 6),
                        "ratio": round(num(i_ratio), 4)})
    except Exception:
        out = []
    return out


def leer_rigidez_piso(sap, casos=None):
    """Lee la tabla 'Story Stiffness' (rigidez lateral de entrepiso K = V_entrepiso /
    Delta_relativo en el centro de masas, por piso/caso/direccion) — base de la
    irregularidad de RIGIDEZ / PISO BLANDO E.030. Columnas validadas en vivo (ETABS 22):
    Story, OutputCase, ShearX, DriftX, StiffXh, StiffX (kgf/m), ShearY, DriftY, StiffYh,
    StiffY (kgf/m), Irregular. Devuelve [{piso, caso, stiffX, stiffY}] en el orden de la
    tabla (tope -> base) o [] si no hay datos. OJO: StiffX se matchea EXACTO (StiffXh
    tambien contiene 'stiffx')."""
    out = []
    try:
        db = sap.DatabaseTables
        if casos:
            try:
                db.SetLoadCasesSelectedForDisplay([str(c) for c in casos])
            except Exception:
                pass
        r = desanidar_com(db.GetTableForDisplayArray(
            "Story Stiffness", [], "", 0, [], 0, []))
        listas = [p for p in r if isinstance(p, (list, tuple))]
        if len(listas) < 2:
            return []
        campos = [str(c) for c in listas[-2]]
        datos = [str(d) for d in listas[-1]]
        nc = len(campos)
        if nc == 0 or campos == ["None"]:
            return []
        norm = {c.lower().replace(" ", ""): i for i, c in enumerate(campos)}

        def coleq(*names):
            for n in names:
                if n in norm:
                    return norm[n]
            return None

        i_story = coleq("story")
        i_caso = coleq("outputcase")
        i_sx = coleq("stiffx")
        i_sy = coleq("stiffy")
        filas = [datos[k * nc:(k + 1) * nc] for k in range(len(datos) // nc)]
        for f in filas:
            def num(i):
                try:
                    return float(f[i]) if i is not None and i < len(f) and f[i] not in ("", None) else 0.0
                except Exception:
                    return 0.0

            def txt(i):
                return f[i] if i is not None and i < len(f) else ""

            out.append({"piso": txt(i_story), "caso": txt(i_caso),
                        "stiffX": round(num(i_sx), 3), "stiffY": round(num(i_sy), 3)})
    except Exception:
        out = []
    return out


@app.get("/etabs/torsion")
def etabs_torsion(pid: int = 0, casos: str = ""):
    """Razon Delta_max/Delta_prom por piso/caso/direccion (tabla 'Story Max Over Avg
    Drifts') para verificar la irregularidad TORSIONAL E.030 (Ip). `casos` =
    casos/combos sismicos separados por coma (se seleccionan para que la tabla los
    incluya). Requiere el modelo analizado. (v1.29.0)."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            if sap.GetModelFilename() is None:
                return error_response("Instancia de ETABS colgada (fantasma). Cierra procesos y reabre.")
            lista_casos = [c.strip() for c in casos.split(",") if c.strip()]
            filas = leer_max_avg_drifts(sap, lista_casos or None)
            return {"success": True, "ok": True, "drifts": filas}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.get("/etabs/rigidez")
def etabs_rigidez(pid: int = 0, casos: str = ""):
    """Rigidez lateral de entrepiso (tabla 'Story Stiffness') para la irregularidad de
    RIGIDEZ / PISO BLANDO E.030 (Ia). `casos` = casos sismicos separados por coma (se
    seleccionan para que la tabla los incluya). Requiere el modelo analizado. (v1.30.0)."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            if sap.GetModelFilename() is None:
                return error_response("Instancia de ETABS colgada (fantasma). Cierra procesos y reabre.")
            lista_casos = [c.strip() for c in casos.split(",") if c.strip()]
            filas = leer_rigidez_piso(sap, lista_casos or None)
            return {"success": True, "ok": True, "rigidez": filas}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


def leer_cortante_sistema(sap, caso_x, caso_y):
    """% del cortante en la base que toman los MUROS por direccion -> clasificar el SISTEMA
    ESTRUCTURAL E.030 (Tabla N°8: porticos / muros / dual). vTotal = |BaseReact| del caso sismico;
    vMuros = suma de |V2| (cortante EN EL PLANO del muro) de los piers en el piso BASE (Location
    'Bottom'). Requiere el modelo analizado y los muros modelados como PIER. Unidades kgf-m."""
    res = {"vTotalX": 0.0, "vTotalY": 0.0, "vMurosX": 0.0, "vMurosY": 0.0,
           "fracX": None, "fracY": None, "tienePiers": False, "pisoBase": None,
           "casoX": caso_x, "casoY": caso_y}
    try:
        prev = int(sap.GetPresentUnits())
    except Exception:
        prev = 8
    try:
        sap.SetPresentUnits(8)
        setup = sap.Results.Setup

        def base_shear(caso):
            setup.DeselectAllCasesAndCombosForOutput()
            if setup.SetCaseSelectedForOutput(caso, True) != 0:
                setup.SetComboSelectedForOutput(caso, True)
            r = desanidar_com(sap.Results.BaseReact(0, [], [], [], [], [], [], [], [], [], 0.0, 0.0, 0.0))
            fx = [abs(float(x)) for x in (list(r[4]) if isinstance(r[4], (list, tuple)) else [])]
            fy = [abs(float(x)) for x in (list(r[5]) if isinstance(r[5], (list, tuple)) else [])]
            return (max(fx) if fx else 0.0, max(fy) if fy else 0.0)

        if caso_x:
            res["vTotalX"] = round(base_shear(caso_x)[0], 1)
        if caso_y:
            res["vTotalY"] = round(base_shear(caso_y)[1], 1)

        # piso base = el de menor elevacion
        geo = extraer_geometria(sap)
        pisos = geo.get("pisos", []) or []
        elevs = geo.get("elevaciones", []) or []
        if pisos and elevs and len(pisos) == len(elevs):
            res["pisoBase"] = pisos[min(range(len(elevs)), key=lambda i: elevs[i])]

        db = sap.DatabaseTables

        def muro_shear(caso):
            try:
                db.SetLoadCasesSelectedForDisplay([str(caso)])
            except Exception:
                pass
            r = desanidar_com(db.GetTableForDisplayArray("Pier Forces", [], "", 0, [], 0, []))
            listas = [p for p in r if isinstance(p, (list, tuple))]
            if len(listas) < 2:
                return 0.0, False
            campos = [str(c) for c in listas[-2]]
            datos = [str(d) for d in listas[-1]]
            nc = len(campos)
            if nc == 0 or campos == ["None"]:
                return 0.0, False
            idx = {c.lower().replace(" ", ""): i for i, c in enumerate(campos)}
            i_story, i_caso = idx.get("story"), idx.get("outputcase")
            i_loc, i_v2 = idx.get("location"), idx.get("v2")
            filas = [datos[k * nc:(k + 1) * nc] for k in range(len(datos) // nc)]
            tot, hay = 0.0, False
            for f in filas:
                if i_caso is not None and str(f[i_caso]) != str(caso):
                    continue
                if res["pisoBase"] and i_story is not None and str(f[i_story]) != str(res["pisoBase"]):
                    continue
                if i_loc is not None and "bottom" not in str(f[i_loc]).lower():
                    continue
                hay = True
                try:
                    tot += abs(float(f[i_v2])) if i_v2 is not None else 0.0
                except Exception:
                    pass
            return tot, hay

        if caso_x:
            vmx, h1 = muro_shear(caso_x); res["vMurosX"] = round(vmx, 1); res["tienePiers"] = res["tienePiers"] or h1
        if caso_y:
            vmy, h2 = muro_shear(caso_y); res["vMurosY"] = round(vmy, 1); res["tienePiers"] = res["tienePiers"] or h2
        if res["vTotalX"] > 0:
            res["fracX"] = round(res["vMurosX"] / res["vTotalX"], 4)
        if res["vTotalY"] > 0:
            res["fracY"] = round(res["vMurosY"] / res["vTotalY"], 4)
    except Exception as e:
        res["error_detalle"] = str(e)
    finally:
        try:
            sap.SetPresentUnits(prev)
        except Exception:
            pass
    return res


@app.get("/etabs/cortante-sistema")
def etabs_cortante_sistema(pid: int = 0, casoX: str = "CSX", casoY: str = "CSY"):
    """% del cortante basal que toman los MUROS por direccion -> clasificar el sistema estructural
    E.030 (Tabla N°8). Requiere el modelo analizado con muros como Pier. (v1.31.0)."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            if sap.GetModelFilename() is None:
                return error_response("Instancia de ETABS colgada (fantasma). Cierra procesos y reabre.")
            return {"success": True, "ok": True, **leer_cortante_sistema(sap, casoX.strip() or None, casoY.strip() or None)}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.get("/etabs/extraer-modelo")
def etabs_extraer_modelo(pid: int = 0):
    """Extrae del modelo ETABS los datos para COMPARAR con OpenSees: conteos
    (columnas/vigas/losas/muros), secciones de columna/viga con A/E/Iy/Iz, losas con
    su TIPO DE SHELL (membrana/shell-thin) y masas por piso. (v1.27.0)."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            if sap.GetModelFilename() is None:
                return error_response("Instancia de ETABS colgada (fantasma). Cierra procesos y reabre.")

            inv = extraer_inventario(sap)   # secciones, losas (con shell), materiales

            E_de = {cc["nombre"]: cc.get("modulo") for cc in inv.get("concretos", [])}  # kg/cm2

            def sec_props(s):
                b = (s.get("base") or 0) / 100.0
                h = (s.get("peralte") or 0) / 100.0
                Ekg = E_de.get(s.get("material"))
                E = round(Ekg * 98.0665) if Ekg else None   # kg/cm2 -> kN/m2
                return {"nombre": s.get("nombre"), "material": s.get("material"),
                        "base": s.get("base"), "peralte": s.get("peralte"),
                        "A": round(b * h, 5), "E": E,
                        "Iy": round(b * h ** 3 / 12.0, 6), "Iz": round(h * b ** 3 / 12.0, 6)}

            columnas_sec = [sec_props(s) for s in inv.get("secciones_columna", [])]
            vigas_sec = [sec_props(s) for s in inv.get("secciones_viga", [])]
            losas = inv.get("losas_maciza", []) + inv.get("losas_1d", []) + inv.get("losas_2d", [])

            # --- Conteo de ELEMENTOS por tipo (clasificacion por orientacion) ---
            def listar(x):
                return list(x) if isinstance(x, (list, tuple)) else []
            try:
                sap.SetPresentUnits(8)  # kgf, m -> coords en metros
            except Exception:
                pass
            cache: Dict[str, tuple] = {}

            def coord(pt):
                if pt not in cache:
                    r = desanidar_com(sap.PointObj.GetCoordCartesian(pt, 0.0, 0.0, 0.0))
                    cache[pt] = (float(r[0]), float(r[1]), float(r[2]))
                return cache[pt]

            TOL = 0.05
            n_col = n_vig = n_losa = n_muro = 0
            fn = desanidar_com(sap.FrameObj.GetNameList())
            for nm in (listar(fn[1]) if len(fn) > 1 else []):
                try:
                    gp = desanidar_com(sap.FrameObj.GetPoints(nm, "", ""))
                    c1, c2 = coord(str(gp[0])), coord(str(gp[1]))
                    if abs(c1[0] - c2[0]) < TOL and abs(c1[1] - c2[1]) < TOL and abs(c1[2] - c2[2]) > TOL:
                        n_col += 1
                    else:
                        n_vig += 1
                except Exception:
                    continue
            an = desanidar_com(sap.AreaObj.GetNameList())
            for nm in (listar(an[1]) if len(an) > 1 else []):
                try:
                    gp = desanidar_com(sap.AreaObj.GetPoints(nm, 0, []))
                    pts = [coord(str(p)) for p in listar(gp[1])]
                    if len(pts) < 3:
                        continue
                    zs = [p[2] for p in pts]
                    if (max(zs) - min(zs)) > TOL:
                        n_muro += 1
                    else:
                        n_losa += 1
                except Exception:
                    continue

            masas = leer_masas_por_piso(sap)

            return {"success": True, "ok": True,
                    "conteo": {"columna": n_col, "viga": n_vig, "losa": n_losa,
                               "muro": n_muro, "nudos": inv.get("num_puntos", 0)},
                    "columnas_sec": columnas_sec, "vigas_sec": vigas_sec, "losas": losas,
                    "masas_piso": masas, "concretos": inv.get("concretos", [])}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.get("/etabs/estado-modelo")
def etabs_estado_modelo(pid: int = 0):
    """Estado rapido del modelo abierto: si esta BLOQUEADO (candado, tras correr el
    analisis) hay que desbloquearlo para poder modificarlo (agregar/borrar elementos).
    Lo usa el Modelador antes de "Llevar a ETABS". (v3.21.9). pid: 0 = la registrada."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            archivo = sap.GetModelFilename()
            if archivo is None:
                return error_response("Instancia de ETABS colgada (fantasma). Cierra procesos y reabre.")
            try:
                bloqueado = bool(sap.GetModelIsLocked())
            except Exception:
                bloqueado = False
            return {"success": True, "ok": True, "bloqueado": bloqueado, "modelo": archivo}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.get("/etabs/elegir-ruta-edb")
def etabs_elegir_ruta_edb(nombre: str = "modelo"):
    """Abre un dialogo NATIVO "Guardar como" (tkinter) en la maquina del servidor
    (que es LOCAL, la misma que corre ETABS) para que el usuario elija donde guardar
    el .EDB, y devuelve la ruta elegida. `ruta` vacia = el usuario cancelo. El navegador
    no puede abrir un dialogo de sistema, por eso lo abre el servidor. (v3.21.11)."""
    try:
        import subprocess
        import sys as _sys
        carpeta_def = os.path.join(os.path.expanduser("~"), "Documents", "ETABS_API_modelos")
        try:
            os.makedirs(carpeta_def, exist_ok=True)
        except Exception:
            carpeta_def = os.path.expanduser("~")
        nombre_def = "".join(c for c in (nombre or "modelo") if c not in '<>:"/\\|?*').strip() or "modelo"
        script = (
            "import sys, tkinter as tk\n"
            "from tkinter import filedialog\n"
            "r = tk.Tk(); r.withdraw()\n"
            "try:\n"
            "    r.attributes('-topmost', True)\n"
            "except Exception:\n"
            "    pass\n"
            "p = filedialog.asksaveasfilename(parent=r, title='Guardar modelo ETABS (.EDB)', "
            "defaultextension='.EDB', "
            "filetypes=[('Modelo ETABS', '*.EDB'), ('Todos los archivos', '*.*')], "
            "initialdir=sys.argv[1], initialfile=sys.argv[2])\n"
            "r.destroy()\n"
            "sys.stdout.buffer.write((p or '').encode('utf-8'))\n"
        )
        res = subprocess.run(
            [_sys.executable, "-c", script, carpeta_def, nombre_def],
            capture_output=True, timeout=300,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        ruta = res.stdout.decode("utf-8", "replace").strip()
        if ruta:
            ruta = os.path.normpath(ruta)
            if not ruta.lower().endswith(".edb"):
                ruta += ".EDB"
        return {"success": True, "ok": True, "ruta": ruta, "cancelado": not ruta}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


# ---- OpenSeesPy (verificacion cruzada): venv 3.12 dedicado + motor ----
_OPENSEES_DIR = os.path.dirname(os.path.abspath(__file__))
OPENSEES_ENGINE = os.path.join(_OPENSEES_DIR, "opensees_engine.py")
OPENSEES_VENV_PY = os.path.join(_OPENSEES_DIR, "osenv312", "Scripts", "python.exe")


@app.get("/opensees/estado")
def opensees_estado():
    """Comprueba que el entorno OpenSees (osenv312 + openseespy) esta listo.
    Desde v1.27.2 TODO corre en el venv unico osenv312 (Python 3.12); OpenSees se
    sigue invocando por SUBPROCESO (mismo interprete) para aislarlo del servidor."""
    if not os.path.exists(OPENSEES_VENV_PY):
        return {"ok": False, "disponible": False,
                "error": "Falta el venv 3.12 (osenv312\\Scripts\\python.exe)."}
    if not os.path.exists(OPENSEES_ENGINE):
        return {"ok": False, "disponible": False, "error": "Falta opensees_engine.py."}
    try:
        res = subprocess.run(
            [OPENSEES_VENV_PY, "-c", "import openseespy.opensees as o; print('ok')"],
            capture_output=True, timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        ok = res.returncode == 0 and b"ok" in res.stdout
        return {"ok": ok, "disponible": ok,
                "detalle": (res.stdout or res.stderr).decode("utf-8", "replace")[-300:]}
    except Exception as e:
        return {"ok": False, "disponible": False, "error": str(e)}


@app.post("/opensees/verificar")
def opensees_verificar(payload: OpenSeesPayload):
    """Corre el motor OpenSees (venv 3.12) con el modelo (spec) recibido y
    devuelve el JSON de resultados (modal + espectral) para la verificacion
    cruzada contra ETABS. El spec lo arma el frontend de forma determinista."""
    if not os.path.exists(OPENSEES_VENV_PY):
        return error_response("El entorno OpenSees (venv 3.12) no esta instalado en el servidor.")
    if not os.path.exists(OPENSEES_ENGINE):
        return error_response("Falta opensees_engine.py en la carpeta del servidor.")
    tmp = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(payload.spec, f, ensure_ascii=False)
            tmp = f.name
        res = subprocess.run(
            [OPENSEES_VENV_PY, OPENSEES_ENGINE, tmp],
            capture_output=True, timeout=int(payload.timeout or 180),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out = res.stdout.decode("utf-8", "replace")
        # El motor imprime el JSON en la ULTIMA linea (openseespy escribe avisos antes).
        linea = next((ln for ln in reversed(out.splitlines()) if ln.strip().startswith("{")), "")
        if not linea:
            return error_response(
                "OpenSees no devolvio resultados.",
                stdout=out[-1200:],
                stderr=res.stderr.decode("utf-8", "replace")[-1200:],
            )
        data = json.loads(linea)
        return {"success": True, **data}
    except subprocess.TimeoutExpired:
        return error_response("OpenSees tardo demasiado (timeout). Modelo muy grande o solver lento.")
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass


@app.get("/etabs/model-summary")
def etabs_model_summary(pid: int = 0):
    """Lee un resumen del modelo ABIERTO (inspirado en los getters de FEA-MCP):
    unidades, pisos, grilla, materiales, secciones y conteos. La IA lo recibe
    para conocer los nombres REALES en vez de adivinarlos. pid: instancia ETABS
    concreta (0 = la registrada)."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            nombre = sap.GetModelFilename()
            if nombre is None:
                return error_response(
                    "Instancia de ETABS colgada (fantasma): GetModelFilename devolvio None. "
                    "Cierra procesos ETABS y abre el modelo de nuevo."
                )

            resumen: Dict[str, Any] = {"modelo": str(nombre)}
            try:
                resumen["unidades"] = int(sap.GetPresentUnits())
            except Exception:
                resumen["unidades"] = None
            # Geometria (grilla X/Y + pisos) e inventario rico (materiales/
            # secciones/losas/muros con propiedades, patrones/casos/combos),
            # ambos compartidos con el diagnostico.
            resumen.update(extraer_geometria(sap))
            resumen.update(extraer_inventario(sap))

            return {"success": True, "ok": True, "resumen": resumen}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.get("/etabs/diagnostico")
def etabs_diagnostico(pid: int = 0):
    """Conecta al modelo (por pid opcional) y EXTRAE que esta definido y que no,
    mapeado a los pasos del flujo guiado. Sirve para retomar un proyecto: la app
    auto-marca los pasos ya hechos en el modelo REAL."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            nombre = sap.GetModelFilename()
            if nombre is None:
                return error_response("Instancia de ETABS colgada (fantasma).")

            det: Dict[str, Any] = {"modelo": str(nombre)}

            # Sistema de GRILLA (ejes X/Y) y PISOS (nombres + elevaciones + base).
            geo = extraer_geometria(sap)
            det.update(geo)
            grilla = (len(geo.get("grilla_x", [])) + len(geo.get("grilla_y", []))) >= 2

            # Inventario RICO (materiales/secciones/losas/muros CON propiedades,
            # patrones/casos con tipo, combos con formula). Mismo extractor que
            # alimenta a model-summary / la IA, asi no se duplica logica COM.
            inv = extraer_inventario(sap)
            det.update(inv)

            # Apoyos: hay al menos un punto restringido?
            apoyos = False
            try:
                for ptn in _nombres(sap.PointObj)[:400]:
                    rr = desanidar_com(sap.PointObj.GetRestraint(ptn, []))
                    if any(bool(b) for parte in rr if isinstance(parte, (list, tuple)) for b in parte):
                        apoyos = True
                        break
            except Exception:
                pass

            # Analisis corrido: algun caso con estado 4 (terminado)?
            analizado = False
            try:
                r = desanidar_com(sap.Analyze.GetCaseStatus(0, [], []))
                estados = [int(x) for parte in r if isinstance(parte, (list, tuple)) for x in parte if isinstance(x, int)]
                analizado = any(e == 4 for e in estados)
            except Exception:
                pass

            det["apoyos"] = apoyos
            det["analizado"] = analizado

            # Para auto-marcar pasos contamos solo lo del USUARIO (el inventario
            # ahora incluye los elementos por defecto de ETABS, marcados
            # default=True, para mostrarlos; pero esos NO cuentan como "hecho").
            def n_usuario(lst):
                return sum(1 for x in lst if not x.get("default"))
            patrones_user = [p for p in inv["patrones"] if not p.get("default")]
            tiene_sismo = any(c["nombre"].upper().startswith("CS") for c in inv["casos"])

            # Mapa a los pasos del flujo (ids de WORKFLOW_STEPS del frontend).
            pasos = {
                "grid": grilla,
                "material": n_usuario(inv["concretos"]) > 0,
                "acero": n_usuario(inv["aceros"]) > 0,
                "viga": n_usuario(inv["secciones_viga"]) > 0,
                "columna": n_usuario(inv["secciones_columna"]) > 0,
                "losa1d": n_usuario(inv["losas_1d"]) > 0,
                "losa2d": n_usuario(inv["losas_2d"]) > 0,
                "losamaciza": n_usuario(inv["losas_maciza"]) > 0,
                "muro": n_usuario(inv["muros"]) > 0,
                "porticos": inv["num_frames"] > 0, "dibviga": inv["num_frames"] > 0, "dibcolumna": inv["num_frames"] > 0,
                "dibujarlosa": inv["num_areas"] > 0, "diblosa1d": inv["num_areas"] > 0, "diblosa2d": inv["num_areas"] > 0,
                "diblosamaciza": inv["num_areas"] > 0, "dibmuro": n_usuario(inv["muros"]) > 0 and inv["num_areas"] > 0,
                "apoyos": apoyos,
                "patrones": len(patrones_user) > 0, "casos": len(patrones_user) > 0,
                "espectro": tiene_sismo,
                "combos": len(inv["combinaciones"]) > 0,
                "analizar": analizado,
            }
            det["pasos"] = pasos
            return {"success": True, "ok": True, "diagnostico": det}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.get("/etabs/resultados")
def etabs_resultados(derivas: str = "DERVX,DERVY", limite: float = 0.007,
                     cortantes: str = "CM,CV,CSX,CSY", modal: str = "Modal",
                     desplaz: str = "CSX,CSY", pid: int = 0):
    """Lee los RESULTADOS del modelo analizado (v3.0, validado en sandbox):
    - estado de los casos (Analyze.GetCaseStatus; 4 = terminado)
    - modal: periodos y masa participativa acumulada (chequeo >= 90%)
    - derivas de piso para los casos/combos pedidos (chequeo <= limite E.030)
    - cortante basal por caso (BaseReact)
    - desplazamientos maximos por piso (Story Response, JointDrifts) en mm (v3.21.5)
    Unidades de salida: kgf, m (SetPresentUnits 8); desplazamientos convertidos a mm.
    Requiere analisis corrido. pid: instancia ETABS concreta (0 = la registrada)."""
    try:
        with com_apartment():
            helper = comtypes.client.CreateObject("ETABSv1.Helper")
            etabs = attach_etabs_por_pid(helper, pid)
            if etabs is None:
                return error_response("No hay ETABS abierto (o el PID indicado ya no existe).")
            sap = etabs.SapModel
            if sap.GetModelFilename() is None:
                return error_response(
                    "Instancia de ETABS colgada (fantasma). Cierra procesos y reabre el modelo."
                )

            def listar(x):
                return list(x) if isinstance(x, (list, tuple)) else []

            # 0) Estado del analisis: el caso modal debe estar terminado (4).
            r = desanidar_com(sap.Analyze.GetCaseStatus(0, [], []))
            estados = {str(n): int(e) for n, e in zip(listar(r[1]), listar(r[2]))}
            nombres_estado = {1: "sin correr", 2: "no pudo iniciar", 3: "no termino", 4: "terminado"}
            estado_casos = {n: nombres_estado.get(e, str(e)) for n, e in estados.items()}
            if estados.get(modal, 1) != 4:
                return error_response(
                    f"El caso modal '{modal}' no esta analizado (estado: "
                    f"{estado_casos.get(modal, 'no existe')}). Ejecuta el paso Analizar primero.",
                    estado_casos=estado_casos,
                )

            try:
                sap.SetPresentUnits(8)  # kgf, m: los valores salen en kgf
            except Exception:
                pass

            # Elevaciones de piso (m) — compartidas por el PERFIL de derivas y por
            # los desplazamientos (eje vertical de los graficos tipo Story Response).
            try:
                st0 = desanidar_com(sap.Story.GetStories_2())
                base_z_g = float(st0[0])
                elev_de_g = {str(p): float(z) for p, z in zip(listar(st0[2]), listar(st0[3]))}
            except Exception:
                base_z_g, elev_de_g = 0.0, {}

            resultados: Dict[str, Any] = {"estado_casos": estado_casos, "unidades": "kgf, m"}
            setup = sap.Results.Setup

            # 1) Modal: periodos + masa participativa.
            try:
                setup.DeselectAllCasesAndCombosForOutput()
                setup.SetCaseSelectedForOutput(modal, True)
                r = desanidar_com(sap.Results.ModalParticipatingMassRatios(
                    0, [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []))
                n = int(r[0])
                periodos = [float(x) for x in listar(r[4])]
                ux = [float(x) for x in listar(r[5])]
                uy = [float(x) for x in listar(r[6])]
                sum_ux = [float(x) for x in listar(r[8])]
                sum_uy = [float(x) for x in listar(r[9])]
                resultados["modal"] = {
                    "caso": modal,
                    "modos": n,
                    "T1": periodos[0] if periodos else None,
                    "masa_x": sum_ux[-1] if sum_ux else 0.0,
                    "masa_y": sum_uy[-1] if sum_uy else 0.0,
                    "tabla": [
                        {"modo": i + 1, "T": round(periodos[i], 4), "UX": round(ux[i], 4),
                         "UY": round(uy[i], 4), "sumUX": round(sum_ux[i], 4), "sumUY": round(sum_uy[i], 4)}
                        for i in range(n)
                    ],
                }
            except Exception as e:
                resultados["modal_error"] = str(e)

            # 2) Derivas de piso para los casos/combos pedidos.
            try:
                pedidos = [c.strip() for c in derivas.split(",") if c.strip()]
                setup.DeselectAllCasesAndCombosForOutput()
                no_encontrados = []
                for nombre in pedidos:
                    # Puede ser combo (DERVX) o caso (CSX): probar ambos.
                    if setup.SetComboSelectedForOutput(nombre, True) != 0:
                        if setup.SetCaseSelectedForOutput(nombre, True) != 0:
                            no_encontrados.append(nombre)
                r = desanidar_com(sap.Results.StoryDrifts(0, [], [], [], [], [], [], [], [], [], []))
                n = int(r[0])
                pisos = [str(x) for x in listar(r[1])]
                casos_d = [str(x) for x in listar(r[2])]
                dirs = [str(x) for x in listar(r[5])]
                valores = [float(x) for x in listar(r[6])]
                # El espectro reporta Max y Min: deduplicar con el maximo absoluto.
                unicas: Dict[tuple, float] = {}
                orden = []
                for i in range(n):
                    clave = (pisos[i], casos_d[i], dirs[i])
                    if clave not in unicas:
                        orden.append(clave)
                        unicas[clave] = abs(valores[i])
                    else:
                        unicas[clave] = max(unicas[clave], abs(valores[i]))
                filas = [
                    {"piso": p, "caso": c, "direccion": d,
                     "deriva": round(unicas[(p, c, d)], 6),
                     "cumple": unicas[(p, c, d)] <= limite}
                    for (p, c, d) in orden
                ]
                # Perfil por caso/combo para el grafico tipo "Story Response": por
                # piso, el drift en X (dx) y en Y (dy). Reusa las elevaciones globales.
                perfil_d: Dict[str, dict] = {}
                for f in filas:
                    fila_p = perfil_d.setdefault(f["caso"], {}).setdefault(f["piso"], {
                        "piso": f["piso"], "elev": round(elev_de_g.get(f["piso"], 0.0), 3),
                        "dx": 0.0, "dy": 0.0})
                    if f["direccion"].strip().upper().startswith("X"):
                        fila_p["dx"] = max(fila_p["dx"], f["deriva"])
                    elif f["direccion"].strip().upper().startswith("Y"):
                        fila_p["dy"] = max(fila_p["dy"], f["deriva"])
                perfil_d = {c: sorted(v.values(), key=lambda x: x["elev"]) for c, v in perfil_d.items()}
                resultados["derivas"] = {
                    "casos": pedidos, "no_encontrados": no_encontrados,
                    "limite": limite, "filas": filas,
                    "perfil": perfil_d, "base_z": round(base_z_g, 3),
                    "cumple_todo": bool(filas) and all(f["cumple"] for f in filas),
                    "peor": max(filas, key=lambda f: f["deriva"]) if filas else None,
                }
            except Exception as e:
                resultados["derivas_error"] = str(e)

            # 3) Cortante basal por caso (FX, FY) y peso (FZ).
            try:
                pedidos = [c.strip() for c in cortantes.split(",") if c.strip()]
                setup.DeselectAllCasesAndCombosForOutput()
                for nombre in pedidos:
                    if setup.SetCaseSelectedForOutput(nombre, True) != 0:
                        setup.SetComboSelectedForOutput(nombre, True)
                r = desanidar_com(sap.Results.BaseReact(
                    0, [], [], [], [], [], [], [], [], [], 0.0, 0.0, 0.0))
                n = int(r[0])
                casos_b = [str(x) for x in listar(r[1])]
                fx = [float(x) for x in listar(r[4])]
                fy = [float(x) for x in listar(r[5])]
                fz = [float(x) for x in listar(r[6])]
                vistos = {}
                for i in range(n):
                    if casos_b[i] not in vistos:  # el espectro repite Max/Min
                        vistos[casos_b[i]] = {"FX": round(abs(fx[i]), 1), "FY": round(abs(fy[i]), 1), "FZ": round(abs(fz[i]), 1)}
                resultados["cortante_basal"] = vistos
            except Exception as e:
                resultados["cortante_error"] = str(e)

            # 3b) Desplazamientos MAXIMOS por piso (Story Response) para los casos
            #     pedidos. JointDrifts da el desplazamiento de cada nudo por piso;
            #     el maximo por piso (en X y en Y) = "Maximum Story Displacement" de
            #     ETABS. Se convierte de m a mm. Validado en vivo (CSX Story4 = 25.27 mm).
            try:
                pedidos = [c.strip() for c in desplaz.split(",") if c.strip()]
                setup.DeselectAllCasesAndCombosForOutput()
                no_encontrados_d = []
                for nombre in pedidos:
                    if setup.SetCaseSelectedForOutput(nombre, True) != 0:
                        if setup.SetComboSelectedForOutput(nombre, True) != 0:
                            no_encontrados_d.append(nombre)
                # Elevaciones de piso: reusa las globales (mismas que el perfil de derivas).
                base_z = base_z_g
                elev_de = elev_de_g
                r = desanidar_com(sap.Results.JointDrifts(
                    0, [], [], [], [], [], [], [], [], [], []))
                n = int(r[0])
                pisos_j = [str(x) for x in listar(r[1])]
                casos_j = [str(x) for x in listar(r[4])]
                dispx = [float(x) for x in listar(r[7])]
                dispy = [float(x) for x in listar(r[8])]
                agg: Dict[tuple, list] = {}
                for i in range(n):
                    clave = (casos_j[i], pisos_j[i])
                    ux = abs(dispx[i]) * 1000.0  # m -> mm
                    uy = abs(dispy[i]) * 1000.0
                    if clave not in agg:
                        agg[clave] = [ux, uy]
                    else:
                        agg[clave][0] = max(agg[clave][0], ux)
                        agg[clave][1] = max(agg[clave][1], uy)
                por_caso: Dict[str, list] = {}
                for (caso, piso), (ux, uy) in agg.items():
                    por_caso.setdefault(caso, []).append({
                        "piso": piso, "elev": round(elev_de.get(piso, 0.0), 3),
                        "ux": round(ux, 3), "uy": round(uy, 3),
                    })
                for caso in por_caso:
                    por_caso[caso].sort(key=lambda f: f["elev"])
                resultados["desplazamientos"] = {
                    "casos": pedidos, "no_encontrados": no_encontrados_d,
                    "unidad": "mm", "base_z": round(base_z, 3),
                    "por_caso": por_caso,
                }
            except Exception as e:
                resultados["desplazamientos_error"] = str(e)

            # 4) Chequeos E.030 resumidos (semaforos del frontend).
            modal_r = resultados.get("modal") or {}
            derivas_r = resultados.get("derivas") or {}
            resultados["chequeos"] = {
                "masa_90": {
                    "cumple": (modal_r.get("masa_x", 0) >= 0.90 and modal_r.get("masa_y", 0) >= 0.90),
                    "detalle": f"Masa acumulada X={modal_r.get('masa_x', 0) * 100:.1f}% "
                               f"Y={modal_r.get('masa_y', 0) * 100:.1f}% (minimo 90%)",
                },
                "derivas": {
                    "cumple": derivas_r.get("cumple_todo", False),
                    "detalle": (
                        f"Peor deriva {derivas_r['peor']['deriva']:.5f} en {derivas_r['peor']['piso']} "
                        f"{derivas_r['peor']['direccion']} ({derivas_r['peor']['caso']}), limite {limite}"
                        if derivas_r.get("peor") else "Sin filas de derivas"
                    ),
                },
            }
            return {"success": True, "ok": True, "resultados": resultados}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


# ============================================================
# CHAT AGENTICO: PUENTE DE HERRAMIENTAS (v1.15.0)
# Catalogo unico de herramientas (las mismas que el servidor MCP) expuesto
# para que el chat de la app las use como function-calling con Gemini, OpenAI
# o Claude. El navegador define el formato por proveedor; AQUI vive la
# ejecucion real (con las validaciones anti-alucinacion y anti-crash) y el
# proxy de Claude (CORS). Las herramientas de ACCION llevan requires_confirmation
# y el navegador exige un clic del usuario antes de relayarlas.
# ============================================================

GUIA_SCRIPTS_CHAT = (
    "REGLAS CRITICAS PARA SCRIPTS DE ETABS (errores reales ya resueltos):\n"
    "1. Script COMPLETO Y AUTONOMO: import comtypes.client, conexion, funciones, main().\n"
    "2. Conexion validada (copiala de un flujo con obtener_flujo): helper.GetObject\n"
    "   puede devolver None sin excepcion; GetModelFilename() None = proceso fantasma.\n"
    "3. ETABS nuevo: helper.CreateObject(ruta exe) con fallback CreateObjectProgID.\n"
    "4. Modelo nuevo: InitializeNewModel(6) antes de tocar SapModel; UNO de NewGridOnly\n"
    "   o NewBlank, nunca ambos (crashea).\n"
    "5. comtypes envuelve salidas en lista anidada: desanidar con\n"
    "   while len(p)==1 and isinstance(p[0],(list,tuple)): p=list(p[0]). ret=0 exito.\n"
    "6. Parametros ByRef se pasan como relleno del tipo ('' 0.0 0 []).\n"
    "7. DatabaseTables: Get -> modificar -> Set -> Apply; TableData lista PLANA.\n"
    "8. Secciones: SetRectangle(Name,Mat,T3=peralte,T2=base); viga=SetRebarBeam,\n"
    "   columna=SetRebarColumn. La API 22 NO tiene FuncRS.SetUser (espectro via tablas).\n"
    "9. Verifica cada llamada (ret!=0 -> RuntimeError) y relee para confirmar.\n"
    "10. No ejecutar RunAnalysis salvo pedido explicito del usuario."
)

AI_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "obtener_guia_scripts", "category": "lectura", "requires_confirmation": False,
        "description": "Reglas criticas para escribir scripts de ETABS sin errores (cada una de un error real). Leela ANTES de escribir codigo nuevo.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "buscar_api_etabs", "category": "lectura", "requires_confirmation": False,
        "description": "Busca en la documentacion OFICIAL de la API de ETABS 22 (1529 entradas). Acepta espanol (viga, grilla, material) o nombres de metodos. Devuelve firmas, parametros y ejemplos.",
        "parameters": {"type": "object", "properties": {
            "consulta": {"type": "string", "description": "Que buscar (espanol o nombre de metodo)."},
            "limite": {"type": "integer", "description": "Maximo de resultados (1-20).", "default": 8},
        }, "required": ["consulta"]},
    },
    {
        "name": "listar_flujos_validados", "category": "lectura", "requires_confirmation": False,
        "description": "Lista los flujos VALIDADOS por el usuario (codigo ya probado en su ETABS). Revisalo antes de escribir codigo nuevo.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "obtener_flujo", "category": "lectura", "requires_confirmation": False,
        "description": "Devuelve el codigo COMPLETO de un flujo validado (busqueda parcial por nombre). Usalo como plantilla exacta de codigo probado.",
        "parameters": {"type": "object", "properties": {
            "nombre": {"type": "string", "description": "Nombre o parte del nombre del flujo."},
        }, "required": ["nombre"]},
    },
    {
        "name": "listar_lecciones_aprendidas", "category": "lectura", "requires_confirmation": False,
        "description": "Errores REALES ya resueltos en esta maquina (par error -> solucion). Revisalos para no repetirlos.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "leer_modelo_abierto", "category": "lectura", "requires_confirmation": False,
        "description": "Lee el modelo ABIERTO en ETABS: unidades, pisos, grilla, materiales, secciones, conteos, patrones, casos y combinaciones. Usa los nombres REALES en vez de adivinar.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "leer_resultados", "category": "lectura", "requires_confirmation": False,
        "description": "Lee los resultados del modelo ANALIZADO: periodos y masa participativa (chequeo >=90%), derivas de piso (chequeo <= limite E.030), cortante basal y desplazamientos maximos por piso (mm). Requiere haber corrido el analisis.",
        "parameters": {"type": "object", "properties": {
            "derivas": {"type": "string", "description": "Casos/combos de deriva separados por coma.", "default": "DERVX,DERVY"},
            "limite": {"type": "number", "description": "Limite de deriva E.030.", "default": 0.007},
            "cortantes": {"type": "string", "description": "Casos para el cortante basal.", "default": "CM,CV,CSX,CSY"},
            "modal": {"type": "string", "description": "Nombre del caso modal.", "default": "Modal"},
            "desplaz": {"type": "string", "description": "Casos/combos para desplazamientos maximos por piso.", "default": "CSX,CSY"},
        }},
    },
    {
        "name": "procesos_etabs", "category": "lectura", "requires_confirmation": False,
        "description": "Lista los procesos de ETABS activos. Un proceso sin titulo de ventana es un fantasma que rompe la conexion.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "estado", "category": "lectura", "requires_confirmation": False,
        "description": "Estado de la infraestructura: version del servidor, tamano de la documentacion, cantidad de flujos y lecciones.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "ejecutar_flujo", "category": "accion", "requires_confirmation": True,
        "description": "EJECUTA en ETABS un flujo validado (busqueda parcial por nombre). La via mas segura: codigo ya probado. Requiere confirmacion del usuario.",
        "parameters": {"type": "object", "properties": {
            "nombre": {"type": "string", "description": "Nombre o parte del nombre del flujo a ejecutar."},
        }, "required": ["nombre"]},
    },
    {
        "name": "ejecutar_script_etabs", "category": "accion", "requires_confirmation": True,
        "description": "Ejecuta en ETABS un script Python COMPLETO y autonomo (con su propia conexion, como los flujos validados). Valida metodos contra la doc oficial y bloquea patrones que crashean ANTES de ejecutar. Requiere confirmacion del usuario.",
        "parameters": {"type": "object", "properties": {
            "codigo": {"type": "string", "description": "Script Python completo (import comtypes, conexion, main())."},
        }, "required": ["codigo"]},
    },
    {
        "name": "cerrar_procesos_etabs", "category": "accion", "requires_confirmation": True,
        "description": "Cierra TODOS los procesos de ETABS (se pierde trabajo no guardado). Usalo solo si hay procesos fantasma que rompen la conexion. Requiere confirmacion del usuario.",
        "parameters": {"type": "object", "properties": {}},
    },
]


def _run_script_validated(codigo: str) -> Dict[str, Any]:
    """Ejecuta un script con TODAS las validaciones (igual que el MCP)."""
    problemas = validate_api_methods(codigo) + detect_crash_patterns(codigo)
    if problemas:
        return {"exito": False, "bloqueado_antes_de_ejecutar": True, "problemas": problemas,
                "sugerencia": "Corrige los metodos con buscar_api_etabs y reintenta."}
    inicio = time.time()
    salida = ""
    try:
        with com_apartment():
            with capture_output() as (out_buf, err_buf):
                try:
                    run_raw_script(codigo, None)
                finally:
                    salida = out_buf.getvalue()
                    errores = err_buf.getvalue()
        return {"exito": True, "salida": salida, "stderr": errores, "segundos": round(time.time() - inicio, 2)}
    except Exception as e:
        return {"exito": False, "error": str(e), "traceback": traceback.format_exc()[-1500:],
                "salida_parcial": salida, "segundos": round(time.time() - inicio, 2)}


def _dispatch_tool(name: str, args: Dict[str, Any]) -> Any:
    """Ejecuta la herramienta pedida por el modelo reusando la logica validada."""
    if name == "obtener_guia_scripts":
        return GUIA_SCRIPTS_CHAT
    if name == "buscar_api_etabs":
        return search_api_reference(str(args.get("consulta", "")), max(1, min(int(args.get("limite", 8) or 8), 20)))
    if name == "listar_flujos_validados":
        return [{"nombre": f.get("nombre"), "descripcion": f.get("descripcion"), "fecha": f.get("fecha")} for f in load_flows()]
    if name == "obtener_flujo":
        nombre = str(args.get("nombre", "")).lower()
        flujos = load_flows()
        cand = [f for f in flujos if nombre in str(f.get("nombre", "")).lower()]
        if not cand:
            return {"error": f"No hay flujo que coincida con '{args.get('nombre')}'.", "disponibles": [f.get("nombre") for f in flujos]}
        return {"nombre": cand[0].get("nombre"), "codigo": cand[0].get("codigo", "")}
    if name == "listar_lecciones_aprendidas":
        return [{"titulo": l.get("titulo"), "error": str(l.get("error", ""))[:300], "solucion": str(l.get("solucion", ""))[:800]} for l in load_lessons()[-10:]]
    if name == "leer_modelo_abierto":
        r = etabs_model_summary()
        return r.get("resumen", r)
    if name == "leer_resultados":
        return etabs_resultados(
            derivas=str(args.get("derivas", "DERVX,DERVY")),
            limite=float(args.get("limite", 0.007) or 0.007),
            cortantes=str(args.get("cortantes", "CM,CV,CSX,CSY")),
            modal=str(args.get("modal", "Modal")),
            desplaz=str(args.get("desplaz", "CSX,CSY")),
        )
    if name == "procesos_etabs":
        return listar_procesos_etabs()
    if name == "estado":
        return {"servidor_version": SERVER_VERSION, "entradas_documentacion": len(load_api_reference()),
                "flujos_validados": len(load_flows()), "lecciones_aprendidas": len(load_lessons())}
    if name == "ejecutar_flujo":
        nombre = str(args.get("nombre", "")).lower()
        cand = [f for f in load_flows() if nombre in str(f.get("nombre", "")).lower()]
        if not cand:
            return {"exito": False, "error": f"No hay flujo que coincida con '{args.get('nombre')}'."}
        return _run_script_validated(cand[0].get("codigo", ""))
    if name == "ejecutar_script_etabs":
        return _run_script_validated(str(args.get("codigo", "")))
    if name == "cerrar_procesos_etabs":
        return etabs_cleanup(CleanupPayload(solo_zombies=False))
    return {"error": f"Herramienta desconocida: {name}"}


@app.get("/ai/tools")
def ai_tools_catalog():
    """Catalogo de herramientas para el chat agentico (el navegador lo adapta
    al formato de cada proveedor: Gemini, OpenAI, Claude)."""
    return {"success": True, "ok": True, "tools": AI_TOOLS}


@app.post("/ai/tools/run")
def ai_tools_run(payload: ToolRunPayload):
    """Ejecuta la herramienta que el modelo pidio. Las de ACCION ya pasaron por
    la confirmacion del usuario en el navegador; aqui igual se validan."""
    conocidas = {t["name"] for t in AI_TOOLS}
    if payload.name not in conocidas:
        return error_response(f"Herramienta desconocida: {payload.name}")
    try:
        resultado = _dispatch_tool(payload.name, payload.arguments or {})
        return {"success": True, "ok": True, "name": payload.name, "result": resultado}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc()[-1200:])


@app.post("/ai/anthropic")
def ai_anthropic_proxy(payload: AnthropicProxyPayload):
    """Proxy local a la API de Claude (Anthropic Messages). El navegador no
    puede llamarla por CORS; la key viaja solo a este servidor local."""
    try:
        import urllib.request
        cuerpo: Dict[str, Any] = {
            "model": payload.model,
            "max_tokens": payload.max_tokens,
            "temperature": payload.temperature,
            "messages": payload.messages,
        }
        if payload.system:
            cuerpo["system"] = payload.system
        if payload.tools:
            cuerpo["tools"] = payload.tools
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(cuerpo).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-api-key": payload.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return {"success": True, "ok": True, "response": data}
    except Exception as e:
        detalle = ""
        try:
            detalle = e.read().decode("utf-8")[:800]  # type: ignore[attr-defined]
        except Exception:
            detalle = str(e)
        return error_response(f"Error llamando a Claude: {detalle}")


@app.get("/etabs/processes")
def etabs_processes():
    try:
        procesos = listar_procesos_etabs()
        return {"success": True, "ok": True, "procesos": procesos, "total": len(procesos)}
    except Exception as e:
        return error_response(str(e))


@app.post("/etabs/cleanup")
def etabs_cleanup(payload: CleanupPayload):
    try:
        procesos = listar_procesos_etabs()
        objetivo = [p for p in procesos if (not payload.solo_zombies) or p["zombie"]]
        cerrados: List[int] = []
        errores: List[str] = []
        for proceso in objetivo:
            try:
                subprocess.check_call(
                    ["taskkill", "/PID", str(proceso["pid"]), "/F"],
                    creationflags=CREATE_NO_WINDOW,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                cerrados.append(proceso["pid"])
            except Exception as e:
                errores.append(f"PID {proceso['pid']}: {e}")
        return {
            "success": True,
            "ok": True,
            "cerrados": cerrados,
            "errores": errores,
            "restantes": listar_procesos_etabs(),
        }
    except Exception as e:
        return error_response(str(e))


EXPLORER_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "API_ETABS_Explorer.html")


@app.get("/explorer")
def api_explorer():
    """Sirve el explorador visual de la API (generado con build_api_explorer.py)."""
    if not os.path.exists(EXPLORER_FILE):
        return error_response("No existe API_ETABS_Explorer.html. Ejecuta build_api_explorer.py.")
    return FileResponse(EXPLORER_FILE, media_type="text/html")


@app.get("/api-docs/search")
def api_docs_search(q: str = "", limit: int = 8):
    """Busca en la documentacion oficial de la API de ETABS (extraida del CHM)."""
    entries = load_api_reference()
    if not entries:
        return error_response(
            "No se encontro etabs_api_reference.json. Ejecuta build_api_reference.py primero."
        )
    limit = max(1, min(int(limit or 8), 20))
    results = search_api_reference(q, limit)
    return {
        "success": True,
        "ok": True,
        "query": q,
        "total_db": len(entries),
        "results": results
    }


@app.get("/flujos")
def listar_flujos():
    return {"success": True, "ok": True, "flujos": load_flows(), "archivo": FLOWS_FILE}


@app.post("/flujos")
def agregar_flujo(payload: FlowPayload):
    flows = load_flows()
    # Si ya existe un flujo con el mismo nombre, se reemplaza (actualizar).
    flows = [f for f in flows if f.get("nombre") != payload.nombre]
    nuevo = {
        "id": str(int(time.time() * 1000)),
        "nombre": payload.nombre,
        "descripcion": payload.descripcion,
        "codigo": payload.codigo,
        "fecha": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    flows.append(nuevo)
    try:
        save_flows(flows)
    except Exception as e:
        return error_response(f"No se pudo guardar el flujo: {e}")
    return {"success": True, "ok": True, "flujo": nuevo, "flujos": flows, "archivo": FLOWS_FILE}


@app.delete("/flujos/{flujo_id}")
def borrar_flujo(flujo_id: str):
    flows = load_flows()
    nuevos = [f for f in flows if str(f.get("id")) != str(flujo_id)]
    try:
        save_flows(nuevos)
    except Exception as e:
        return error_response(f"No se pudo borrar el flujo: {e}")
    return {"success": True, "ok": True, "flujos": nuevos}


@app.get("/lecciones")
def listar_lecciones():
    return {"success": True, "ok": True, "lecciones": load_lessons(), "archivo": LESSONS_FILE}


@app.post("/lecciones")
def agregar_leccion(payload: LessonPayload):
    lecciones = load_lessons()
    nueva = {
        "id": str(int(time.time() * 1000)),
        "titulo": payload.titulo,
        "error": payload.error,
        "solucion": payload.solucion,
        "fecha": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    lecciones.append(nueva)
    # Mantener solo las 40 mas recientes para que el archivo no crezca sin limite.
    lecciones = lecciones[-40:]
    try:
        save_lessons(lecciones)
    except Exception as e:
        return error_response(f"No se pudo guardar la leccion: {e}")
    return {"success": True, "ok": True, "leccion": nueva, "lecciones": lecciones}


@app.delete("/lecciones/{leccion_id}")
def borrar_leccion(leccion_id: str):
    lecciones = [l for l in load_lessons() if str(l.get("id")) != str(leccion_id)]
    try:
        save_lessons(lecciones)
    except Exception as e:
        return error_response(f"No se pudo borrar la leccion: {e}")
    return {"success": True, "ok": True, "lecciones": lecciones}


@app.get("/status")
def status():
    return {
        "success": True,
        "ok": True,
        "message": "Servidor Python activo.",
        "server_version": SERVER_VERSION,
        "python": sys.version,
        "host": "127.0.0.1",
        "port": 8000
    }


class EspectroExcelPayload(BaseModel):
    z: float = 0.45
    u: float = 1.0
    s: float = 1.0
    tp: float = 0.6
    tl: float = 2.0
    g: float = 9.81
    r0x: float = 8.0
    iax: float = 1.0
    ipx: float = 1.0
    r0y: float = 8.0
    iay: float = 1.0
    ipy: float = 1.0
    periodos: Optional[List[float]] = None
    zona: Optional[str] = None
    suelo: Optional[str] = None
    uso: Optional[str] = None
    sistemaX: Optional[str] = None
    sistemaY: Optional[str] = None
    proyecto: Optional[str] = None


@app.post("/espectro/excel")
def espectro_excel(payload: EspectroExcelPayload):
    """Genera y devuelve una hoja Excel PRESENTABLE del espectro E.030 con FORMULAS
    VIVAS + grafico (openpyxl, espectro_excel.build_espectro_xlsx). El frontend la
    descarga. Los parametros vienen de la pestana 'El Espectro de Diseno'."""
    try:
        from espectro_excel import build_espectro_xlsx
    except Exception as e:
        return error_response(f"No se pudo cargar el generador de Excel (¿falta openpyxl?): {e}")
    try:
        data = build_espectro_xlsx(payload.dict())
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="Espectro_E030-2026.xlsx"'},
        )
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.post("/preflight")
def preflight(payload: PreflightPayload):
    issues = validate_code_safety(payload.code) if payload.strict_safety else []
    api_method_issues = validate_api_methods(payload.code) + detect_crash_patterns(payload.code)
    warnings = static_etabs_warnings(payload.code)
    bloqueantes = len(issues) + len(api_method_issues)
    return {
        "success": bloqueantes == 0,
        "ok": bloqueantes == 0,
        "message": "Preflight aprobado." if bloqueantes == 0 else "Preflight encontro problemas.",
        "issues": issues,
        "api_method_issues": api_method_issues,
        "warnings": warnings
    }


@app.get("/etabs/ping")
def etabs_ping():
    try:
        with com_apartment():
            _, sap_model = attach_to_running_etabs()
            info = {}
            try:
                info["model_filename"] = sap_model.GetModelFilename()
            except Exception:
                info["model_filename"] = None
            return {"success": True, "ok": True, "message": "Conexion con ETABS correcta.", "info": info}
    except Exception as e:
        return error_response(str(e), traceback=traceback.format_exc())


@app.post("/execute-etabs")
def execute_etabs_code(payload: ExecutePayload):
    payload = normalize_payload_options(payload)
    start_time = time.time()
    warnings = static_etabs_warnings(payload.code)

    # Validacion anti-alucinacion: bloquea metodos inventados Y patrones que
    # crashean ETABS, ANTES de abrirlo. Ahorra el arranque y una ronda de error.
    api_method_issues = validate_api_methods(payload.code) + detect_crash_patterns(payload.code)
    if api_method_issues:
        return error_response(
            "El codigo usa metodos que NO existen en la API de ETABS. Se bloqueo antes de abrir ETABS.",
            api_method_issues=api_method_issues,
            warnings=warnings,
            mode="bloqueado_validacion_api",
        )

    # ------------------------------------------------------------
    # MODO SCRIPT COMPLETO: ejecuta el codigo tal cual, sin sandbox.
    # ------------------------------------------------------------
    if payload.raw_script:
        stdout_text = ""
        stderr_text = ""
        script_path = None
        try:
            with com_apartment():
                with capture_output() as (stdout_buffer, stderr_buffer):
                    try:
                        script_path = run_raw_script(payload.code, payload.model_path)
                    finally:
                        stdout_text = stdout_buffer.getvalue()
                        stderr_text = stderr_buffer.getvalue()

            elapsed = round(time.time() - start_time, 3)
            return ok_response(
                output=stdout_text if stdout_text.strip() else "Ejecucion finalizada sin mensajes.",
                stderr=stderr_text,
                elapsed_seconds=elapsed,
                mode="raw_script",
                script_path=script_path,
                warnings=warnings
            )
        except Exception as e:
            elapsed = round(time.time() - start_time, 3)
            return error_response(
                str(e),
                traceback=traceback.format_exc(),
                output=stdout_text,
                stderr=stderr_text,
                elapsed_seconds=elapsed,
                mode="raw_script",
                script_path=script_path,
                warnings=warnings
            )

    if payload.strict_safety:
        issues = validate_code_safety(payload.code)
        if issues:
            return error_response(
                "El codigo fue bloqueado por seguridad antes de llegar a ETABS.",
                issues=issues,
                warnings=warnings
            )

    connection_status = None
    model_status = None
    stdout_text = ""
    stderr_text = ""

    try:
        with com_apartment():
            with capture_output() as (stdout_buffer, stderr_buffer):
                try:
                    etabs_object, sap_model, connection_status = get_etabs(payload.connection_mode)
                    print(f"[ETABS] connection_status={connection_status}")

                    model_status = prepare_model(sap_model, payload)
                    print(f"[ETABS] model_status={model_status}")

                    env = build_exec_environment(sap_model=sap_model, etabs_object=etabs_object, variables=payload.variables)
                    exec(payload.code, env, env)
                finally:
                    # Leer los buffers SIEMPRE, incluso si exec lanzo excepcion,
                    # para no perder el stdout/stderr ya producido.
                    stdout_text = stdout_buffer.getvalue()
                    stderr_text = stderr_buffer.getvalue()

        elapsed = round(time.time() - start_time, 3)
        return ok_response(
            output=stdout_text if stdout_text.strip() else "Ejecucion finalizada sin mensajes.",
            stderr=stderr_text,
            elapsed_seconds=elapsed,
            connection_status=connection_status,
            model_status=model_status,
            connection_mode=payload.connection_mode,
            model_mode=payload.model_mode,
            units=payload.units,
            warnings=warnings
        )
    except Exception as e:
        elapsed = round(time.time() - start_time, 3)
        return error_response(
            str(e),
            traceback=traceback.format_exc(),
            output=stdout_text,
            stderr=stderr_text,
            elapsed_seconds=elapsed,
            connection_status=connection_status,
            model_status=model_status,
            connection_mode=payload.connection_mode,
            model_mode=payload.model_mode,
            units=payload.units,
            warnings=warnings
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

