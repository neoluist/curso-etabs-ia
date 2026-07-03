# Clase 03 - El dialogo con ETABS: de Python al DIAGRAMA DE MOMENTOS
# Dibuja una viga, la empotra en sus 2 extremos, la carga y la ANALIZA.
# Luego, en ETABS: Display > Force/Stress Diagrams > Frame Forces > caso Q > M3-3
# Requisito: ETABS ABIERTO con un modelo EN BLANCO (File > New Model).
# Validado en vivo: M3 = -2400 kgf.m (= -wL2/12) y +1200 kgf.m (= +wL2/24), EXACTO.
import comtypes.client

helper = comtypes.client.CreateObject("ETABSv1.Helper")
etabs = helper.GetObject("CSI.ETABS.API.ETABSObject")
sap = etabs.SapModel
print(f"Conectado a: {sap.GetModelFilename()}")     # LEER

sap.SetPresentUnits(8)                        # kgf, m
L = 6.0                                       # luz de la viga (m)
w = 800.0                                     # carga repartida (kgf/m)

# 1) DIBUJAR: dale dos puntos y ETABS pone una barra
sap.FrameObj.AddByCoord(0.0, 0.0, 0.0, L, 0.0, 0.0, "", "Default", "VIGA", "Global")

# 2) EMPOTRAR los extremos (en un modelo nuevo se llaman "1" y "2")
empotrado = [True, True, True, True, True, True]   # UX UY UZ RX RY RZ
sap.PointObj.SetRestraint("1", empotrado, 0)
sap.PointObj.SetRestraint("2", empotrado, 0)

# 3) CARGAR: patron "Q" (sin peso propio) + w en TODA la viga
sap.LoadPatterns.Add("Q", 3, 0, True)
sap.FrameObj.SetLoadDistributed("VIGA", "Q", 1, 10, 0.0, 1.0, w, w, "Global", True, True, 0)

# 4) La PREDICCION - tus formulas de siempre:
print(f"Teoria -> M empotramiento = w*L**2/12 = {w * L**2 / 12:.0f} kgf.m")
print(f"Teoria -> M centro        = w*L**2/24 = {w * L**2 / 24:.0f} kgf.m")

# 5) GUARDAR y ANALIZAR (ETABS no analiza sin guardar antes)
sap.File.Save(r"D:\00 CURSO-IA-ETABS\viga_demo.EDB")
sap.Analyze.RunAnalysis()
print("Analizado. En ETABS: Display > Force/Stress Diagrams > Frame Forces > Q > M3-3")
