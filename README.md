# Curso ETABS + IA · Materiales

Código de arranque y "checkpoints" del curso **ETABS + Inteligencia Artificial** de
[Ingeniería Fácil](https://ingenieriafacil.com). Cada carpeta `clase-XX/` tiene el
código **terminado** de esa clase: si te atascas, abre esa carpeta y sigues con todos.

## Cómo bajarlo

En la terminal de VS Code (`Ctrl` + `ñ`):

```
git clone https://github.com/neoluist/curso-etabs-ia.git
```

> Es un repo **público**: no necesitas cuenta ni iniciar sesión. Si VS Code muestra
> una ventana "Connect to GitHub", ciérrala — tú clonas desde la terminal.

## Requisitos

- **Python 3.12** (instalado en la Clase 02)
- **comtypes** — la caja que habla con ETABS: `pip install comtypes`
- **ETABS 22** instalado (para los scripts que dibujan/leen modelos)

## Contenido

| Carpeta | Clase | Qué hay |
|---|---|---|
| `clase-02/` | Tu taller | Tus primeros scripts + el bonus que abre ETABS y dibuja una grilla |
| `clase-03/` | Python en acción | **GRILLA EXPRESS v1.0** (tu primera app) + el puente y el diálogo con ETABS |
| `clase-03/versiones/` | Checkpoints | Cada versión intermedia de GRILLA EXPRESS (v0.1 a v0.4) por si te pierdes a mitad de camino |
| `app/` | **LA APLICACIÓN** (Clase 04+) | El panel web + servidor que modela edificios E.030 completos en ETABS. Instrucciones en `app/LEEME.txt` |

## La aplicación (Clase 04 en adelante)

Desde la Clase 04 el curso usa **la app completa** (carpeta `app/`):

1. `git pull` para traer lo último.
2. Doble clic a `app\INSTALAR.bat` — **una sola vez** (instala las cajas del servidor y del panel).
3. Doble clic a `app\INICIAR.bat` — **cada vez que trabajes** (abre servidor + panel + navegador).

Detalles y solución de problemas: [`app/LEEME.txt`](app/LEEME.txt).

## Cómo ejecutar un script

1. Abre el archivo `.py` en VS Code.
2. Pulsa ▷ (Ejecutar) arriba a la derecha.
3. Responde en la terminal cuando la app te pregunte.

---
Ingeniería Fácil · Curso ETABS + IA
