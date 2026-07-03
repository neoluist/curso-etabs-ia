# Clase 03 - El puente hacia ETABS, desarmado linea por linea.
# Se conecta al ETABS que YA esta abierto, con red de seguridad (try/except)
# y deteccion de "fantasmas" (proceso muerto que responde a medias).
import comtypes.client

helper = comtypes.client.CreateObject("ETABSv1.Helper")   # el conserje de CSi
try:
    etabs = helper.GetObject("CSI.ETABS.API.ETABSObject")  # el ETABS ABIERTO
except Exception:
    etabs = None
if etabs is None:                                          # el guard: puede venir None sin error
    raise SystemExit("Abre ETABS y vuelve a correr.")

sap = etabs.SapModel                                       # LA MANIJA: de aqui cuelga TODO
if sap.GetModelFilename() is None:                         # detector de fantasmas
    raise SystemExit("ETABS fantasma: cierralo desde el Administrador de tareas y reabre.")

print("Conectado a:", sap.GetModelFilename())
