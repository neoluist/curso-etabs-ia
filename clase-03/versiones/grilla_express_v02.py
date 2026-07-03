# GRILLA EXPRESS v0.2 - La app valida (Clase 03)
print("=== GRILLA EXPRESS ===")
pisos = int(input("Numero de pisos: "))
h1 = float(input("Altura del 1er piso (m): "))
ht = float(input("Altura tipica (m): "))

if pisos < 1 or pisos > 60:
    raise SystemExit("Revisa los pisos: deben estar entre 1 y 60.")
if h1 < 2.0 or ht < 2.0:
    raise SystemExit("Ninguna altura de piso deberia bajar de 2 m.")
print("Datos validados.")
