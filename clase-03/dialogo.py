# Clase 03 - El dialogo con ETABS: LEER y MANDAR
# Necesitas un ETABS ABIERTO con cualquier modelo (aunque sea nuevo).
import comtypes.client

helper = comtypes.client.CreateObject("ETABSv1.Helper")
etabs = helper.GetObject("CSI.ETABS.API.ETABSObject")   # el ETABS que YA esta abierto
sap = etabs.SapModel

# LEER: le preguntamos cosas a ETABS
print(f"Modelo abierto : {sap.GetModelFilename()}")
print(f"Puntos dibujados: {sap.PointObj.Count()}")
print(f"Barras dibujadas: {sap.FrameObj.Count()}")

# MANDAR: le damos una orden (mira su esquina inferior derecha)
sap.SetPresentUnits(14)                  # "ponte en kgf, cm"
input("Unidades cambiadas... Enter para devolverlas")
sap.SetPresentUnits(8)                   # cortesia: kgf, m de vuelta
