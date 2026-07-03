# GRILLA EXPRESS v1.0 - Curso ETABS + IA (Clase 03)
# Tu primera app: pregunta los datos de un edificio, los valida, imprime
# un resumen y ABRE ETABS dibujando la grilla. Requiere ETABS 22 + comtypes.
import comtypes.client


def pedir_luces(mensaje):
    luces = []
    for parte in input(mensaje).split(","):        # "5, 5, 5" -> ["5", " 5", " 5"]
        luces.append(float(parte.strip()))         # quita espacios y convierte a numero
    return luces


def pedir_datos():
    print("=== GRILLA EXPRESS v1.0 ===")
    pisos = int(input("Numero de pisos: "))
    h1 = float(input("Altura del 1er piso (m): "))
    ht = float(input("Altura tipica (m): "))
    lx = pedir_luces("Luces en X (ej. 5, 5, 5): ")
    ly = pedir_luces("Luces en Y (ej. 4, 4): ")
    return pisos, h1, ht, lx, ly


def validar(pisos, lx, ly):
    if pisos < 1 or pisos > 60:
        raise SystemExit("Revisa los pisos: entre 1 y 60.")
    if min(lx) != max(lx) or min(ly) != max(ly):
        raise SystemExit("v1.0 solo soporta luces IGUALES.")


def resumen(pisos, h1, ht, lx, ly):
    print(f"Edificio: {pisos} pisos | altura total {h1 + ht*(pisos-1):.2f} m")
    print(f"Planta: {sum(lx):.1f} x {sum(ly):.1f} m ({len(lx)+1} x {len(ly)+1} ejes)")


def dibujar(pisos, h1, ht, lx, ly):
    print("Abriendo ETABS... (paciencia)")
    helper = comtypes.client.CreateObject("ETABSv1.Helper")
    etabs = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
    etabs.ApplicationStart()
    sap = etabs.SapModel
    sap.InitializeNewModel(6)                                 # kN, m -- siempre PRIMERO
    sap.File.NewGridOnly(pisos, ht, h1,
                         len(lx) + 1, len(ly) + 1,            # nro de ejes = vanos + 1
                         lx[0], ly[0])                        # la luz (todas iguales)
    print("Listo: mira TU edificio en ETABS.")


def main():                                 # el DIRECTOR: los capitulos, en orden
    pisos, h1, ht, lx, ly = pedir_datos()
    validar(pisos, lx, ly)
    resumen(pisos, h1, ht, lx, ly)
    dibujar(pisos, h1, ht, lx, ly)


if __name__ == "__main__":                  # el arranque estandar de todo script del curso
    main()
