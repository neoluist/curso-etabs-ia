# Clase 03 - El dialogo con ETABS: LEER y DIBUJAR (la espiral de Fibonacci)
# Necesitas un ETABS ABIERTO con un modelo en blanco (File > New Model).
# Validado en vivo: 12 barras, conteo exacto.
import comtypes.client
import math

helper = comtypes.client.CreateObject("ETABSv1.Helper")
etabs = helper.GetObject("CSI.ETABS.API.ETABSObject")
sap = etabs.SapModel

# LEER: le preguntamos cosas a ETABS
print(f"Modelo abierto  : {sap.GetModelFilename()}")
print(f"Barras que tiene: {sap.FrameObj.Count()}")

# MANDAR: dibujamos la ESPIRAL DE FIBONACCI con barras
sap.SetPresentUnits(8)                   # kgf, m
fibs = [1, 1]
for veces in range(10):                  # range(10) = repite 10 veces
    fibs.append(fibs[-1] + fibs[-2])     # la LEY: cada numero = suma de los 2 anteriores

x, y = 0.0, 0.0
ang = 0.0
for L in fibs:                           # una barra por cada numero de la serie
    x2 = x + L * math.cos(ang)
    y2 = y + L * math.sin(ang)
    sap.FrameObj.AddByCoord(x, y, 0.0, x2, y2, 0.0, "", "Default", "", "Global")
    x, y = x2, y2
    ang = ang + math.pi / 2              # gira un cuarto de vuelta

sap.View.RefreshView(0, False)           # refresca la pantalla de ETABS
print(f"Espiral dibujada: {fibs}")
print(f"Barras ahora    : {sap.FrameObj.Count()}")
