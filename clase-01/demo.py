# -*- coding: utf-8 -*-
# ============================================================================
#  MI PRIMER EDIFICIO EN ETABS... ¡HECHO CON PYTHON!
#  Curso: IA aplicada al diseño estructural — Ingeniería Fácil
#
#  Este script se conecta a ETABS y, SOLO CON PYTHON, construye un edificio
#  de 3 pisos, lo apoya, le pone cargas, lo ANALIZA y te dice su periodo y su
#  peso total. Todo automático. Corre:   python demo_etabs.py
# ============================================================================
import comtypes.client
import os
import sys
import time

# Para que las tildes se vean bien en cualquier consola de Windows:
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Ruta de tu ETABS (cambia el número de versión si usas otro):
RUTA_ETABS = r"C:\Program Files\Computers and Structures\ETABS 22\ETABS.exe"

# ---------- Datos del edificio (cámbialos y vuelve a correr) ----------
N_PISOS     = 3       # número de pisos
H_PISO      = 3.0     # altura de cada piso (m)
EJES_X      = 3       # líneas de grilla en X (3 líneas = 2 vanos)
EJES_Y      = 3       # líneas de grilla en Y
LUZ_X       = 5.0     # separación entre ejes en X (m)
LUZ_Y       = 5.0     # separación entre ejes en Y
FC          = 210     # f'c del concreto (kg/cm2)
COL_B, COL_H = 0.30, 0.30    # columna (m)
VIG_B, VIG_H = 0.25, 0.40    # viga: base x peralte (m)
CARGA_VIGA  = 1.0     # carga muerta sobreimpuesta en vigas (tonf/m)

def linea(): print("-" * 64)

# ---------- 1) CONECTAR CON ETABS ----------
# Este script ABRE su propio ETABS usando la versión de RUTA_ETABS: así SIEMPRE
# usa la versión que quieres y empieza con un modelo limpio. (Si prefieres
# conectarte al ETABS que YA tengas abierto, pon CONECTAR_A_ABIERTO = True.)
CONECTAR_A_ABIERTO = False

if not os.path.exists(RUTA_ETABS):
    print("NO encuentro ETABS en esta ruta:")
    print("   " + RUTA_ETABS)
    print("Corrige RUTA_ETABS arriba (revisa el número: ETABS 20, 22, 23...).")
    sys.exit(1)

print("Conectando con ETABS...")
helper = comtypes.client.CreateObject("ETABSv1.Helper")
if CONECTAR_A_ABIERTO:
    etabs = helper.GetObject("CSI.ETABS.API.ETABSObject")   # usa el ETABS ya abierto
else:
    print("Abriendo ETABS (espera unos segundos)...")
    etabs = helper.CreateObject(RUTA_ETABS)                 # abre ESTA versión
    etabs.ApplicationStart()
    time.sleep(2)
sap = etabs.SapModel
print("¡Conectado! Ahora Python manda.")

# ¿Qué versión de ETABS es? (las versiones viejas no aceptan algunas cargas por API)
try:
    info = sap.GetVersion("", 0.0)
    version_txt = str(info[0])
    major = int(version_txt.split(".")[0])
except Exception:
    version_txt, major = "?", 99   # si no se puede leer, asumimos moderna
print(f"Versión de ETABS: {version_txt}")

# ---------- 2) MODELO NUEVO + GRILLA + PISOS (una sola línea) ----------
sap.InitializeNewModel(12)  # 12 = unidades Tonf, metro, °C
sap.File.NewGridOnly(N_PISOS, H_PISO, H_PISO, EJES_X, EJES_Y, LUZ_X, LUZ_Y)
print(f"Grilla creada: {EJES_X}x{EJES_Y} ejes, {N_PISOS} pisos de {H_PISO} m.")

# ---------- 3) MATERIAL (concreto) ----------
E = 15000 * (FC ** 0.5) * 10.0   # E = 15000*raiz(f'c) kg/cm2 -> tonf/m2
sap.PropMaterial.SetMaterial("CONCRETO", 2)          # 2 = Concreto
sap.PropMaterial.SetMPIsotropic("CONCRETO", E, 0.2, 1.0e-5)
sap.PropMaterial.SetWeightAndMass("CONCRETO", 1, 2.4)  # peso propio 2.4 tonf/m3
print(f"Concreto definido: f'c={FC} kg/cm2, E={E:,.0f} tonf/m2.")

# ---------- 4) SECCIONES (columna y viga) ----------
sap.PropFrame.SetRectangle("COLUMNA", "CONCRETO", COL_H, COL_B)  # T3=peralte, T2=base
sap.PropFrame.SetRectangle("VIGA",    "CONCRETO", VIG_H, VIG_B)
print(f"Secciones: COLUMNA {COL_B}x{COL_H} m · VIGA {VIG_B}x{VIG_H} m.")

# ---------- 5) DIBUJAR el edificio (columnas + vigas por coordenadas) ----------
xs = [i * LUZ_X for i in range(EJES_X)]
ys = [j * LUZ_Y for j in range(EJES_Y)]
zs = [0.0] + [(k + 1) * H_PISO for k in range(N_PISOS)]   # 0, 3, 6, 9...

n_col = 0
vigas = []   # guardamos el NOMBRE de cada viga para cargarla después
# Columnas: en cada cruce de ejes, de un nivel al siguiente
for x in xs:
    for y in ys:
        for k in range(len(zs) - 1):
            sap.FrameObj.AddByCoord(x, y, zs[k], x, y, zs[k + 1], "", "COLUMNA", "", "Global")
            n_col += 1
# Vigas: en cada nivel (menos la base), a lo largo de los ejes X e Y.
# AddByCoord nos devuelve el nombre que ETABS le puso a la viga -> lo guardamos.
def nombre_de(r):
    # AddByCoord puede devolver (Name, ret) o Name suelto -> tomamos el nombre:
    return str(r[0]) if isinstance(r, (list, tuple)) else str(r)

for z in zs[1:]:
    for y in ys:
        for i in range(len(xs) - 1):
            r = sap.FrameObj.AddByCoord(xs[i], y, z, xs[i + 1], y, z, "", "VIGA", "", "Global")
            vigas.append(nombre_de(r))
    for x in xs:
        for j in range(len(ys) - 1):
            r = sap.FrameObj.AddByCoord(x, ys[j], z, x, ys[j + 1], z, "", "VIGA", "", "Global")
            vigas.append(nombre_de(r))
print(f"Dibujado: {n_col} columnas y {len(vigas)} vigas.")

# ---------- 6) APOYOS EMPOTRADOS en la base (z = 0) ----------
res = sap.PointObj.GetNameList(0, [])
puntos = [str(p) for p in res[1]]
n_apoyos = 0
for p in puntos:
    c = sap.PointObj.GetCoordCartesian(p, 0.0, 0.0, 0.0)
    if abs(float(c[2])) < 0.001:      # z ~ 0 -> es base
        sap.PointObj.SetRestraint(p, [True, True, True, True, True, True])
        n_apoyos += 1
print(f"Apoyos empotrados en la base: {n_apoyos} nudos.")

# ---------- 7) CARGA en las vigas (patrón CV) ----------
sap.LoadPatterns.Add("CV", 3, 0.0, True)   # 3 = Live
if major >= 22:
    for f in vigas:   # usamos los nombres que guardamos al dibujar
        sap.FrameObj.SetLoadDistributed(f, "CV", 1, 10, 0.0, 1.0, CARGA_VIGA, CARGA_VIGA, "Global", True, True)
    print(f"Carga de {CARGA_VIGA} tonf/m aplicada en {len(vigas)} vigas (patrón CV).")
else:
    print(f"(ETABS {major}: su API antigua no acepta la carga en vigas; analizo con el peso propio.)")

# ---------- 8) FUENTE DE MASA (para el periodo) ----------
sap.PropMaterial.SetMassSource_1(True, True, False, 0, [], [])

# ---------- 9) ANALIZAR ----------
carpeta = os.path.join(os.path.expanduser("~"), "Documents", "ETABS_API_modelos")
os.makedirs(carpeta, exist_ok=True)
ruta = os.path.join(carpeta, "DEMO_Python.EDB")
sap.File.Save(ruta)
print("Modelo guardado. Analizando... (unos segundos)")
sap.Analyze.RunAnalysis()
print("¡ANÁLISIS TERMINADO!")

# ---------- 10) LEER RESULTADOS ----------
linea()
print("RESULTADOS (Python los leyó de ETABS):")
setup = sap.Results.Setup

# Periodo fundamental (caso Modal)
try:
    setup.DeselectAllCasesAndCombosForOutput()
    setup.SetCaseSelectedForOutput("Modal")
    rp = sap.Results.ModalPeriod(0, [], [], [], [], [], [], [])
    T1 = float(rp[4][0])
    print(f"   Periodo fundamental  T1 = {T1:.3f} s")
except Exception as e:
    print(f"   (No se pudo leer el periodo: {e})")

# Peso total (reacción vertical del caso Dead = peso propio)
try:
    setup.DeselectAllCasesAndCombosForOutput()
    setup.SetCaseSelectedForOutput("Dead")
    rb = sap.Results.BaseReact(0, [], [], [], [], [], [], [], [], [], 0.0, 0.0, 0.0)
    FZ = abs(float(rb[6][0]))
    print(f"   Peso propio del edificio  FZ = {FZ:,.1f} tonf")
except Exception as e:
    print(f"   (No se pudo leer el peso: {e})")

linea()
print("Abre ETABS y verás TU edificio dibujado y analizado.")
print("Todo esto lo hizo Python en segundos. Eso es controlar ETABS con código.")
