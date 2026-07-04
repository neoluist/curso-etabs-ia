# -*- coding: utf-8 -*-
"""
Motor OpenSees para la VERIFICACION CRUZADA con ETABS (v3.23.0).

Corre en el venv Python 3.12 dedicado (osenv312) porque el binario de
openseespy en Windows esta compilado para 3.12; el servidor (3.13 + ETABS/
comtypes) lo invoca por SUBPROCESO pasandole un JSON y leyendo su JSON de salida.

Construye un modelo ELASTICO 3D equivalente al de ETABS a partir de la geometria
real (columnas/vigas con A, E, I de sus secciones), con DIAFRAGMA RIGIDO por piso
(como ETABS por defecto) y MASAS concentradas en el centro de masa de cada piso.
Analisis: MODAL (periodos + masa participativa) y ESPECTRAL E.030 (cortante basal
por SRSS de masas efectivas y derivas por SRSS de desplazamientos modales).

Unidades del modelo: kN, m, ton (Mg). g = 9.81 m/s2. Sa en m/s2.

Uso:
    python opensees_engine.py spec.json          -> imprime JSON de resultados
    python opensees_engine.py --selftest         -> modelo canonico de prueba
La entrada (spec.json), todo en kN-m-ton:
{
  "nodes":    [[id, x, y, z], ...],
  "supports": [id, ...],                      # nudos de base empotrados (6 gdl)
  "stories":  [{"nombre": "...", "z": ..., "h": ..., "nodes": [id, ...]}, ...],
  "columns":  [[id_i, id_j, A, E, G, J, Iy, Iz], ...],
  "beams":    [[id_i, id_j, A, E, G, J, Iy, Iz], ...],
  "masas_piso": {"<nombre piso>": masa_ton},  # opcional; si falta se usa masas_nodo
  "masas_nodo": [[id, m_ton], ...],           # opcional
  "spectrum": {"T": [...], "SaX": [...], "SaY": [...]},   # m/s2
  "nmodes": 12
}
"""
import sys
import json
import math

try:
    import openseespy.opensees as _ops_mod
except Exception as e:  # pragma: no cover
    print(json.dumps({"ok": False, "error": f"No se pudo importar openseespy: {e}"}))
    sys.exit(0)

G = 9.81  # m/s2


def _fmt_arg(v):
    """Formatea un argumento como en codigo Python (floats redondeados)."""
    if isinstance(v, bool):
        return repr(v)
    if isinstance(v, float):
        return repr(round(v, 6))
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_fmt_arg(x) for x in v) + "]"
    return repr(v)


class _OpsRec:
    """Envuelve el modulo openseespy y REGISTRA cada llamada (nombre + argumentos)
    como una linea de codigo, para mostrar al usuario TODO el flujo ejecutado.
    Reenvia la llamada real, asi la traza coincide exactamente con lo que corrio."""
    def __init__(self, ops_mod, log):
        self._ops = ops_mod
        self._log = log

    def __getattr__(self, name):
        attr = getattr(self._ops, name)
        if not callable(attr):
            return attr

        def wrapper(*args, **kwargs):
            a = ", ".join(_fmt_arg(x) for x in args)
            if kwargs:
                a += (", " if a else "") + ", ".join(f"{k}={_fmt_arg(v)}" for k, v in kwargs.items())
            self._log.append(f"ops.{name}({a})")
            return attr(*args, **kwargs)
        return wrapper


def _interp(xs, ys, x):
    """Interpolacion lineal de Sa(T) con extrapolacion plana en los extremos."""
    if not xs:
        return 0.0
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            t = (x - x0) / (x1 - x0) if x1 != x0 else 0.0
            return y0 + t * (y1 - y0)
    return ys[-1]


def build_and_analyze(spec):
    nmodes = int(spec.get("nmodes", 12))
    nodes = spec["nodes"]
    supports = set(spec.get("supports", []))
    stories = spec.get("stories", [])
    columns = spec.get("columns", [])
    beams = spec.get("beams", [])

    log = []                          # traza de TODAS las llamadas ops.* (para el usuario)
    ops = _OpsRec(_ops_mod, log)

    log.append("# ====== DEFINICION DEL MODELO (3D, 6 GDL por nudo) ======")
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)

    log.append("# ====== NUDOS  ops.node(id, x, y, z)  [m] ======")
    coord = {}
    for nid, x, y, z in nodes:
        ops.node(int(nid), float(x), float(y), float(z))
        coord[int(nid)] = (float(x), float(y), float(z))

    log.append("# ====== APOYOS EN LA BASE  ops.fix(id, 1,1,1,1,1,1)  (empotrados) ======")
    for nid in supports:
        ops.fix(int(nid), 1, 1, 1, 1, 1, 1)

    # Transformaciones geometricas: una para columnas (verticales) y una para
    # vigas (horizontales). El vector vecxz debe NO ser paralelo al eje local x.
    log.append("# ====== TRANSFORMACIONES GEOMETRICAS  ops.geomTransf  (1=columnas, 2=vigas) ======")
    ops.geomTransf("Linear", 1, 1.0, 0.0, 0.0)   # columnas (eje local x = Z global)
    ops.geomTransf("Linear", 2, 0.0, 0.0, 1.0)   # vigas (eje local x horizontal)

    etag = 1

    def add_elems(lst, transf):
        nonlocal etag
        for e in lst:
            ni, nj, A, E, Gm, J, Iy, Iz = e
            ops.element("elasticBeamColumn", etag, int(ni), int(nj),
                        float(A), float(E), float(Gm), float(J), float(Iy), float(Iz), transf)
            etag += 1

    log.append(f"# ====== ELEMENTOS: COLUMNAS ({len(columns)})  elasticBeamColumn(tag, ni, nj, A, E, G, J, Iy, Iz, transf) ======")
    add_elems(columns, 1)
    log.append(f"# ====== ELEMENTOS: VIGAS ({len(beams)})  elasticBeamColumn(...) ======")
    add_elems(beams, 2)

    # --- LOSAS como elementos MEMBRANA (ShellMITC4) [opcional] ---
    # Una cascara por pano de la grilla (reusa los nudos de las esquinas, sin mallar).
    # rho=0: la masa de la losa NO la lleva el elemento (sigue concentrada en el nudo
    # maestro por la fuente de masa, sin doble conteo); el comportamiento en el plano lo
    # gobierna el DIAFRAGMA RIGIDO (como ETABS con losa membrana + diafragma). El elemento
    # hace explicita la losa (conteo, tipo) y deja listo el camino a shell-thin (rho/placa).
    slabs = spec.get("slabs", [])
    slab_sec = spec.get("slab_section")
    n_losas = 0
    if slabs and slab_sec:
        sec_tag = 1
        E_s = float(slab_sec.get("E", 0.0))
        nu_s = float(slab_sec.get("nu", 0.2))
        h_s = float(slab_sec.get("h", 0.0))
        rho_s = float(slab_sec.get("rho", 0.0))
        log.append("# ====== LOSAS (membrana): seccion de placa  ops.section('ElasticMembranePlateSection', tag, E, nu, h, rho) ======")
        ops.section("ElasticMembranePlateSection", sec_tag, E_s, nu_s, h_s, rho_s)
        log.append(f"# ====== LOSAS: {len(slabs)} cascaras membrana  ops.element('ShellMITC4', tag, n1, n2, n3, n4, secTag) ======")
        for s in slabs:
            ni = [int(x) for x in s[:4]]
            if not all(n in coord for n in ni):
                continue
            ops.element("ShellMITC4", etag, ni[0], ni[1], ni[2], ni[3], sec_tag)
            etag += 1
            n_losas += 1

    # --- Masas por piso (centro de masa) + DIAFRAGMA RIGIDO ---
    log.append("# ====== MASAS Y DIAFRAGMA RIGIDO POR PISO  (nudo maestro en el centro de masa: ops.node/fix/mass/rigidDiaphragm) ======")
    masas_piso = spec.get("masas_piso", {})
    masas_nodo = {int(i): float(m) for i, m in spec.get("masas_nodo", [])}
    master_por_piso = []   # (nombre, master_id, z, h, masa, nodos)
    next_id = max(coord) + 1 if coord else 1

    for st in stories:
        snodes = [int(n) for n in st["nodes"] if int(n) in coord]
        if not snodes:
            continue
        # masa del piso
        if st.get("nombre") in masas_piso:
            mpiso = float(masas_piso[st["nombre"]])
        else:
            mpiso = sum(masas_nodo.get(n, 0.0) for n in snodes)
        if mpiso <= 0:
            continue
        # centro de masa (geometrico de los nudos del piso)
        cx = sum(coord[n][0] for n in snodes) / len(snodes)
        cy = sum(coord[n][1] for n in snodes) / len(snodes)
        cz = coord[snodes[0]][2]
        master = next_id
        next_id += 1
        ops.node(master, cx, cy, cz)
        # master: libres UX,UY,RZ ; restringidos UZ,RX,RY (fuera del plano)
        ops.fix(master, 0, 0, 1, 1, 1, 0)
        # inercia rotacional del piso respecto al centro de masa
        izz = 0.0
        for n in snodes:
            r2 = (coord[n][0] - cx) ** 2 + (coord[n][1] - cy) ** 2
            izz += masas_nodo.get(n, mpiso / len(snodes)) * r2
        if izz <= 0:
            izz = mpiso * 1e-3
        ops.mass(master, mpiso, mpiso, 0.0, 0.0, 0.0, izz)
        ops.rigidDiaphragm(3, master, *snodes)
        master_por_piso.append({
            "nombre": st.get("nombre", f"N{len(master_por_piso)+1}"),
            "master": master, "z": cz, "h": float(st.get("h", 0.0)),
            "masa": mpiso, "izz": izz,
        })

    if not master_por_piso:
        return {"ok": False, "error": "No hay masas de piso: el modelo no tiene masa sismica."}

    # --- MODAL ---
    # Solo hay 3 GDL dinamicos por piso (UX, UY, RZ del diafragma). ARPACK exige
    # pedir MENOS modos que GDL dinamicos; si no, falla. Limitamos el numero.
    gdl_din = 3 * len(master_por_piso)
    nmodes = max(1, min(nmodes, gdl_din - 1)) if gdl_din > 1 else 1
    # ARPACK (rapido) para modelos grandes; si falla (modelos chicos, pide casi
    # todos los modos) cae al fullGenLapack (denso, lento pero siempre resuelve).
    log.append(f"# ====== ANALISIS MODAL  ops.eigen({nmodes})  -> periodos y modos ======")
    try:
        eigvals = ops.eigen(nmodes)
    except Exception:
        log.append("# (ARPACK no pudo con este modelo; se usa el solver denso fullGenLapack)")
        eigvals = ops.eigen("-fullGenLapack", nmodes)
    omegas = [math.sqrt(v) if v > 0 else 0.0 for v in eigvals]
    periodos = [(2 * math.pi / w) if w > 0 else 0.0 for w in omegas]

    pisos = master_por_piso
    Mtot = sum(p["masa"] for p in pisos)

    # Participacion modal manual (robusto ante la normalizacion de eigenvectores):
    # Gamma = L/M, Meff = L^2/M ; L_X = sum m_k*phi_k(UX), M = sum m_k*phi_k^2 (+ izz*phi_rz^2)
    log.append("# ====== LECTURA DE LOS MODOS  ops.nodeEigenvector(maestro, modo, gdl)  (para masa participativa) ======")
    modos = []
    for mode in range(1, len(eigvals) + 1):
        Lx = Ly = Mgen = 0.0
        phis = []
        for p in pisos:
            ux = ops.nodeEigenvector(p["master"], mode, 1)
            uy = ops.nodeEigenvector(p["master"], mode, 2)
            rz = ops.nodeEigenvector(p["master"], mode, 6)
            phis.append((ux, uy, rz))
            Lx += p["masa"] * ux
            Ly += p["masa"] * uy
            Mgen += p["masa"] * (ux * ux + uy * uy) + p["izz"] * rz * rz
        if Mgen <= 0:
            Mgen = 1e-12
        meffx = Lx * Lx / Mgen
        meffy = Ly * Ly / Mgen
        modos.append({
            "modo": mode, "T": periodos[mode - 1], "w": omegas[mode - 1],
            "meffx": meffx, "meffy": meffy, "Mgen": Mgen,
            "gammax": Lx / Mgen, "gammay": Ly / Mgen, "phis": phis,
        })

    sum_mx = sum(m["meffx"] for m in modos)
    sum_my = sum(m["meffy"] for m in modos)

    out = {
        "ok": True,
        "n_pisos": len(pisos),
        "masa_total_ton": Mtot,
        "periodos": periodos,
        "T1": periodos[0] if periodos else 0.0,
        "modal": {
            "masa_x_pct": 100.0 * sum_mx / Mtot if Mtot else 0.0,
            "masa_y_pct": 100.0 * sum_my / Mtot if Mtot else 0.0,
            "tabla": [{
                "modo": m["modo"], "T": round(m["T"], 4),
                "masa_x_pct": round(100.0 * m["meffx"] / Mtot, 2) if Mtot else 0.0,
                "masa_y_pct": round(100.0 * m["meffy"] / Mtot, 2) if Mtot else 0.0,
            } for m in modos],
        },
    }

    # --- ESPECTRAL E.030 (SRSS) ---
    sp = spec.get("spectrum")
    if sp and sp.get("T"):
        Tsp = [float(t) for t in sp["T"]]
        SaX = [float(s) for s in sp.get("SaX", sp.get("Sa", []))]
        SaY = [float(s) for s in sp.get("SaY", SaX)]
        # Cortante basal: V = sqrt( sum_i (Sa_i * Meff_i)^2 )  (SRSS de masas efectivas)
        vx = math.sqrt(sum((_interp(Tsp, SaX, m["T"]) * m["meffx"]) ** 2 for m in modos))
        vy = math.sqrt(sum((_interp(Tsp, SaY, m["T"]) * m["meffy"]) ** 2 for m in modos))
        # Derivas: desplazamiento de piso por SRSS de respuestas modales.
        # u_k(modo) = Gamma * phi_k * Sd ; Sd = Sa / w^2
        zsorted = sorted(range(len(pisos)), key=lambda k: pisos[k]["z"])
        ux_piso = [0.0] * len(pisos)
        uy_piso = [0.0] * len(pisos)
        for ip in range(len(pisos)):
            sx2 = sy2 = 0.0
            for m in modos:
                w2 = m["w"] ** 2
                if w2 <= 0:
                    continue
                sdx = _interp(Tsp, SaX, m["T"]) / w2
                sdy = _interp(Tsp, SaY, m["T"]) / w2
                phix = m["phis"][ip][0]
                phiy = m["phis"][ip][1]
                sx2 += (m["gammax"] * phix * sdx) ** 2
                sy2 += (m["gammay"] * phiy * sdy) ** 2
            ux_piso[ip] = math.sqrt(sx2)
            uy_piso[ip] = math.sqrt(sy2)
        # derivas entre pisos consecutivos (ordenados por z)
        derivas = []
        prev_z = 0.0
        prev_ux = prev_uy = 0.0
        max_dx = max_dy = 0.0
        for k in zsorted:
            p = pisos[k]
            h = p["h"] if p["h"] > 0 else (p["z"] - prev_z) or 1.0
            dx = abs(ux_piso[k] - prev_ux) / h
            dy = abs(uy_piso[k] - prev_uy) / h
            max_dx = max(max_dx, dx)
            max_dy = max(max_dy, dy)
            derivas.append({"piso": p["nombre"], "z": round(p["z"], 3),
                            "deriva_x": dx, "deriva_y": dy,
                            "ux_m": round(ux_piso[k], 5), "uy_m": round(uy_piso[k], 5)})
            prev_z, prev_ux, prev_uy = p["z"], ux_piso[k], uy_piso[k]
        out["espectral"] = {
            "cortante_basal_x_kN": vx, "cortante_basal_y_kN": vy,
            "deriva_max_x": max_dx, "deriva_max_y": max_dy,
            "perfil": derivas,
        }

    # --- Datos colocados (resumen) + TRAZA COMPLETA de comandos (para el panel) ---
    def _secinfo(e):
        if not e:
            return None
        _, _, A, E, Gm, J, Iy, Iz = e
        return {"A": A, "E": E, "G": Gm, "J": J, "Iy": Iy, "Iz": Iz}
    out["datos"] = {
        "unidades": "kN, m, ton (g = 9.81 m/s2)",
        "n_nodos": len(nodes), "n_columnas": len(columns), "n_vigas": len(beams),
        "n_losas": n_losas, "n_apoyos": len(supports), "nmodes": nmodes,
        "losa_membrana": (slab_sec is not None and n_losas > 0),
        "seccion_columna": _secinfo(columns[0] if columns else None),
        "seccion_viga": _secinfo(beams[0] if beams else None),
        "pisos": [{"nombre": p["nombre"], "z": round(p["z"], 3), "h": round(p["h"], 3),
                   "masa_ton": round(p["masa"], 3), "inercia_izz": round(p["izz"], 3),
                   "maestro": p["master"]} for p in pisos],
        "espectro_puntos": len((spec.get("spectrum") or {}).get("T", []) or []),
    }
    out["script"] = log
    out["n_comandos"] = sum(1 for ln in log if not ln.startswith("#"))

    return out


def selftest_spec():
    """Edificio canonico 4 pisos, grilla 3x3 (ejes a 5 m), columnas 0.40x0.40,
    vigas 0.30x0.50, f'c=210 (E=2.13e7 kN/m2), masa 80 ton/piso. Para validar
    que el motor corre y da periodos/masa/cortante coherentes."""
    E = 15000.0 * math.sqrt(210.0) * 98.0665   # kgf/cm2 -> kN/m2
    nu = 0.2
    Gm = E / (2 * (1 + nu))
    # columna 0.40x0.40
    bc, hc = 0.40, 0.40
    Ac = bc * hc
    Ic = bc * hc ** 3 / 12.0
    Jc = Ic * 2
    # viga 0.30x0.50
    bv, hv = 0.30, 0.50
    Av = bv * hv
    Iv = bv * hv ** 3 / 12.0
    Jv = Iv * 1.5
    xs = [0.0, 5.0, 10.0]
    ys = [0.0, 5.0, 10.0]
    hpiso = 3.0
    npisos = 4
    nodes = []
    nid = {}
    cnt = 1
    zs = [hpiso * k for k in range(npisos + 1)]
    for k, z in enumerate(zs):
        for ix, x in enumerate(xs):
            for iy, y in enumerate(ys):
                nodes.append([cnt, x, y, z])
                nid[(ix, iy, k)] = cnt
                cnt += 1
    supports = [nid[(ix, iy, 0)] for ix in range(len(xs)) for iy in range(len(ys))]
    columns, beams = [], []
    for k in range(npisos):
        for ix in range(len(xs)):
            for iy in range(len(ys)):
                columns.append([nid[(ix, iy, k)], nid[(ix, iy, k + 1)], Ac, E, Gm, Jc, Ic, Ic])
    for k in range(1, npisos + 1):
        for iy in range(len(ys)):
            for ix in range(len(xs) - 1):
                beams.append([nid[(ix, iy, k)], nid[(ix + 1, iy, k)], Av, E, Gm, Jv, Iv, Iv])
        for ix in range(len(xs)):
            for iy in range(len(ys) - 1):
                beams.append([nid[(ix, iy, k)], nid[(ix, iy + 1, k)], Av, E, Gm, Jv, Iv, Iv])
    stories = []
    for k in range(1, npisos + 1):
        snodes = [nid[(ix, iy, k)] for ix in range(len(xs)) for iy in range(len(ys))]
        stories.append({"nombre": f"Story{k}", "z": zs[k], "h": hpiso, "nodes": snodes})
    masas_piso = {f"Story{k}": 80.0 for k in range(1, npisos + 1)}
    # losas membrana: una cascara por pano de la grilla (para probar ShellMITC4)
    slabs = []
    for k in range(1, npisos + 1):
        for ix in range(len(xs) - 1):
            for iy in range(len(ys) - 1):
                slabs.append([nid[(ix, iy, k)], nid[(ix + 1, iy, k)],
                              nid[(ix + 1, iy + 1, k)], nid[(ix, iy + 1, k)]])
    slab_section = {"E": E, "nu": 0.2, "h": 0.20, "rho": 0.0}
    # espectro E.030 simple (meseta) para probar el espectral
    Tsp = [0, 0.4, 1.0, 2.0, 3.0, 5.0, 10.0]
    Sa = [2.94, 2.94, 1.18, 0.59, 0.39, 0.24, 0.06]
    return {
        "nodes": nodes, "supports": supports, "stories": stories,
        "columns": columns, "beams": beams, "masas_piso": masas_piso,
        "slabs": slabs, "slab_section": slab_section,
        "spectrum": {"T": Tsp, "SaX": Sa, "SaY": Sa}, "nmodes": 12,
    }


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--selftest":
        spec = selftest_spec()
    elif len(sys.argv) >= 2:
        with open(sys.argv[1], "r", encoding="utf-8-sig") as f:  # tolera BOM
            spec = json.load(f)
    else:
        spec = json.load(sys.stdin)
    try:
        res = build_and_analyze(spec)
    except Exception as e:
        import traceback
        res = {"ok": False, "error": str(e), "trace": traceback.format_exc()}
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
