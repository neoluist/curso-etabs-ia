# Clase 02 (BONUS) - Python abre ETABS y dibuja una grilla
# Requiere ETABS 22 instalado. Abre un ETABS NUEVO (no necesitas tener uno abierto).
import comtypes.client

print("Abriendo un ETABS nuevo... (paciencia: puede tardar un minuto)")
helper = comtypes.client.CreateObject("ETABSv1.Helper")
etabs = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")   # un ETABS NUEVO
etabs.ApplicationStart()                                          # ...y se abre solo

sap = etabs.SapModel                       # la manija de TODO el modelo
sap.InitializeNewModel(6)                  # modelo nuevo en kN, m (siempre PRIMERO)

sap.File.NewGridOnly(4, 3.0, 3.5,          # 4 pisos: tipico 3.0 m, primer piso 3.5 m
                     5, 4,                 # 5 ejes en X, 4 ejes en Y
                     5.0, 4.0)             # luces: 5.0 m en X, 4.0 m en Y

print("Mira ETABS: un edificio de 4 pisos con grilla 5x4, dibujado por TU script.")
# Juega: cambia el 4 (pisos) por 10, o el 5.0 por 6.0, y vuelve a correr.
