# GRILLA EXPRESS v0.4 - El resumen con f-strings (Clase 03)
print("=== GRILLA EXPRESS ===")
pisos = int(input("Numero de pisos: "))
h1 = float(input("Altura del 1er piso (m): "))
ht = float(input("Altura tipica (m): "))

texto = input("Luces en X (ej. 5, 5, 5): ")
luces_x = []
for parte in texto.split(","):
    luces_x.append(float(parte.strip()))

texto = input("Luces en Y (ej. 4, 4): ")
luces_y = []
for parte in texto.split(","):
    luces_y.append(float(parte.strip()))

if pisos < 1 or pisos > 60:
    raise SystemExit("Revisa los pisos: deben estar entre 1 y 60.")
if h1 < 2.0 or ht < 2.0:
    raise SystemExit("Ninguna altura de piso deberia bajar de 2 m.")
if min(luces_x) != max(luces_x) or min(luces_y) != max(luces_y):
    raise SystemExit("v1.0 solo soporta luces IGUALES.")

altura_total = h1 + ht * (pisos - 1)
print(f"Edificio: {pisos} pisos | altura total {altura_total:.2f} m")
print(f"Planta: {sum(luces_x):.1f} x {sum(luces_y):.1f} m "
      f"({len(luces_x)+1} x {len(luces_y)+1} ejes)")
